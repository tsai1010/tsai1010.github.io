// MIDI CC 控制面板（功能版 / 原生 JS + 內建 CSS + Web MIDI 可選）
// 功能：CC1(Modulation)、Pitch Bend、CC64(Sustain)、Channel 指定 / ALL、鍵盤控制、旋鈕發光、PB 自動回正
// 你也可以用自定義 Hook 取代 Web MIDI：在 window.midiCcPanelHooks 設定 onCC/onPitchBend（見下方）

window.midiCcPanelGetChannel  = window.midiCcPanelGetChannel  || function(){ return 14; }; // 15 = CH16（0-based）
window.midiCcPanelGetVelocity = window.midiCcPanelGetVelocity || function(){ return 70; };

(function () {
  const STYLE_ID = "midi-cc-panel-styles";
  const CSS = `
  .mcp-root{
    position:fixed; inset:0; z-index:9998; background:transparent;
    pointer-events:none; /* 不擋底下頁面 */
  }
  .mcp-card{
    width:100%; max-width:880px; border:1px solid rgba(63,63,70,.6);
    background:rgba(24,24,27,.6); backdrop-filter:blur(8px);
    box-shadow:0 20px 40px rgba(0,0,0,.45); border-radius:16px;
  }
  .mcp-p6{padding:24px}
  .mcp-row{display:flex;align-items:center;justify-content:space-between}
  .mcp-row-gap{display:flex;align-items:center;gap:12px}
  .mcp-title{font-size:20px;font-weight:600;color:#e4e4e7;letter-spacing:.3px}
  .mcp-sub{font-size:12px;color:#a1a1aa}
  .mcp-badge{font-size:12px;color:#e5e7eb;background:#27272a;border:1px solid rgba(82,82,91,.6);
    padding:2px 8px;border-radius:8px}
  .mcp-hr{border:none;border-top:1px solid rgba(63,63,70,.6);margin:16px 0}
  .mcp-grid{display:grid;gap:24px}
  @media(min-width:640px){.mcp-grid-3{grid-template-columns:1fr 1fr 1fr}}
  @media(min-width:768px){.mcp-grid-2{grid-template-columns:1fr 1fr}}
  .mcp-label{font-size:13px;color:#a1a1aa;margin-bottom:8px}
  .mcp-select{width:100%;appearance:none;background:rgba(24,24,27,.8);color:#e4e4e7;border:1px solid #27272a;
    border-radius:8px;padding:8px 28px 8px 10px;outline:none}
    /* Velocity 欄位用的數字輸入與滑桿 */
    .mcp-num {
        width: 64px; appearance: textfield;
        background: rgba(24,24,27,.8); color: #e4e4e7; border: 1px solid #27272a;
        border-radius: 8px; padding: 6px 8px; outline: none; text-align: center;
    }
    .mcp-range {
        width: 100%;
    }
    .mcp-range input[type="range"] {
        width: 100%;
    }
    .mcp-num {
        width: 64px; appearance: textfield;
        background: rgba(24,24,27,.85); color:#e4e4e7; border:1px solid #27272a;
        border-radius:8px; padding:6px 8px; outline:none; text-align:center;
    }
    .mcp-num:focus { box-shadow:0 0 0 2px rgba(99,102,241,.35) inset; }

    /* Velocity：滑桿（自訂樣式 + 動態填色） */
    .mcp-range input[type="range"]{
        -webkit-appearance:none; appearance:none; width:100%; height:6px; border-radius:9999px; outline:none;
        background: linear-gradient(to right, #6366f1 var(--val,0%), #3f3f46 var(--val,0%));
        border:1px solid #27272a;
    }
    .mcp-range input[type="range"]::-webkit-slider-thumb{
        -webkit-appearance:none; appearance:none; width:16px; height:16px; border-radius:50%;
        background:#e5e7eb; border:1px solid #c7c9d1;
        box-shadow: 0 1px 3px rgba(0,0,0,.35), 0 0 0 4px rgba(99,102,241,.25);
        cursor:pointer;
    }
    .mcp-range input[type="range"]::-moz-range-thumb{
        width:16px; height:16px; border:none; border-radius:50%;
        background:#e5e7eb; box-shadow: 0 1px 3px rgba(0,0,0,.35), 0 0 0 4px rgba(99,102,241,.25);
        cursor:pointer;
    }
    .mcp-range input[type="range"]::-moz-range-track{
        height:6px; border-radius:9999px; background:transparent;
    }
  .mcp-select-wrap{position:relative}
  .mcp-select-wrap:after{content:"▾";position:absolute;right:8px;top:50%;transform:translateY(-50%);color:#71717a;pointer-events:none}
  .mcp-tile{border:1px solid #27272a;background:rgba(24,24,27,.4);border-radius:16px;padding:16px}
  .mcp-sustain-dot{width:12px;height:12px;border-radius:50%}
  .mcp-switch{position:relative;width:44px;height:24px;border-radius:9999px;background:#3f3f46;cursor:pointer}
  .mcp-switch-knob{position:absolute;top:3px;left:3px;width:18px;height:18px;border-radius:50%;background:#fff;
    box-shadow:0 2px 6px rgba(0,0,0,.3);transition:transform .18s}
  .mcp-switch-on{background:#10b981}
  .mcp-switch-on .mcp-switch-knob{transform:translateX(20px)}
  .mcp-knob{position:relative;width:128px;height:128px;border-radius:50%;border:1px solid #27272a;
    background:linear-gradient(135deg,#3f3f46,#18181b);box-shadow:inset 0 10px 22px rgba(0,0,0,.45);
    display:grid;place-items:center;user-select:none; transition:box-shadow .12s}
  .mcp-knob-cap{width:32px;height:32px;border-radius:50%;background:#52525b;border:1px solid #52525b}
  .mcp-ticks{position:absolute;inset:0}
  .mcp-tick{position:absolute;left:50%;top:6px;width:2px;height:8px;background:#71717a;transform-origin:bottom}
  .mcp-needle{position:absolute;width:3px;height:50%;background:#e5e7eb;border-radius:2px;transform-origin:bottom}
  .mcp-field{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px}
  .mcp-label2{color:#e4e4e7;font-weight:500; display:flex; align-items:center; gap:8px}
  .mcp-kbhint{display:inline-flex; gap:6px; opacity:.9}
  .mcp-k{font-size:10px; line-height:1; color:#e5e7eb; background:#3f3f46; border:1px solid #52525b;
    border-radius:4px; padding:2px 4px}
  .mcp-note{font-size:12px;color:#a1a1aa}
  .mcp-reset{font-size:12px;color:#a1a1aa;background:transparent;border:none;cursor:pointer}
  .mcp-reset:hover{color:#fff}

  .mcp-leftbtn{position:fixed;left:12px;top:50%;transform:translateY(-50%);z-index:10001;pointer-events:auto}
  .mcp-iconbtn{width:40px;height:40px;border-radius:9999px;border:1px solid rgba(82,82,91,.6);
    background:rgba(24,24,27,.8);color:#e5e7eb;cursor:pointer}
  .mcp-iconbtn:hover{color:#fff}

  .mcp-panel{
    position:fixed; z-index:9999;
    left: var(--mcp-left, 24px);
    top:  var(--mcp-top,  24px);
    transition:transform .35s cubic-bezier(.2,.8,.2,1),opacity .25s;
    pointer-events:auto; /* 面板可互動 */
  }
  .mcp-hidden{pointer-events:none;opacity:0;transform:translateX(-105%)}

  /* 三欄格：Ch 放第1欄、Sustain 放第3欄（最右） */
  @media (min-width: 640px) {
    .mcp-col-1 { grid-column: 1 / 2; }
    .mcp-col-3 { grid-column: 3 / 4; justify-self: end; }
  }

  /* 旋鈕發光效果（值變動時閃一下） */
  .mcp-glow { box-shadow: 0 0 0 0 rgba(99,102,241,.6), 0 0 18px 6px rgba(99,102,241,.35) inset; }
  `;

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = CSS;
    document.head.appendChild(style);
  }


  // ---------- MIDI 送訊層（可用 hooks 或 Web MIDI） ----------
  const hooks = (window.midiCcPanelHooks || {});
  let midiOutputs = [];

  function initWebMIDIOnce() {
    if (!navigator.requestMIDIAccess) return;
    if (initWebMIDIOnce._called) return;
    initWebMIDIOnce._called = true;
    navigator.requestMIDIAccess({ sysex:false }).then(access => {
      midiOutputs = [];
      access.outputs.forEach(o => midiOutputs.push(o));
      access.onstatechange = () => {
        midiOutputs = [];
        access.outputs.forEach(o => midiOutputs.push(o));
      };
    }).catch(()=>{});
  }

  function forEachChannel(sel, fn) {
    if (sel === "all") {
      for (let ch=1; ch<=16; ch++) fn(ch);
    } else {
      fn(parseInt(sel,10));
    }
  }

  function sendCC(channelSel, cc, value) {
    if (typeof hooks.onCC === "function") {
      forEachChannel(channelSel, ch => hooks.onCC(ch, cc, value));
      return;
    }
    // Web MIDI fallback
    if (!midiOutputs.length) initWebMIDIOnce();
    forEachChannel(channelSel, ch => {
      const status = 0xB0 | ((ch-1) & 0x0F);
      const data = [status, cc & 0x7F, value & 0x7F];
      midiOutputs.forEach(out => out.send(data));
    });
  }

  function sendPitchBend(channelSel, value /* -8192..8191 */) {
    if (typeof hooks.onPitchBend === "function") {
      forEachChannel(channelSel, ch => hooks.onPitchBend(ch, value));
      return;
    }
    if (!midiOutputs.length) initWebMIDIOnce();
    const v = value + 8192; // -> 0..16383
    const lsb = v & 0x7F, msb = (v >> 7) & 0x7F;
    forEachChannel(channelSel, ch => {
      const status = 0xE0 | ((ch-1) & 0x0F);
      midiOutputs.forEach(out => out.send([status, lsb, msb]));
    });
  }

  // ---------- 工具 ----------
  function clamp(v, min, max) { return Math.min(max, Math.max(min, v)); }
  function angleToValue(deg, min, max) { const t = (deg + 135) / 270; return Math.round(min + t * (max - min)); }
  function pointerDegFromCenter(cx, cy, px, py) {
    const dx = px - cx, dy = py - cy;
    let deg = Math.atan2(dx, -dy) * 180 / Math.PI; // -180~180，0 在上方
    if (deg > 135) deg = 135;
    if (deg < -135) deg = -135;
    return deg;
  }
  function svgChevron(dir){
    const s = document.createElementNS("http://www.w3.org/2000/svg","svg");
    s.setAttribute("viewBox","0 0 24 24"); s.setAttribute("width","20"); s.setAttribute("height","20");
    s.setAttribute("fill","none"); s.setAttribute("stroke","currentColor");
    s.setAttribute("stroke-width","2"); s.setAttribute("stroke-linecap","round"); s.setAttribute("stroke-linejoin","round");
    const p = document.createElementNS("http://www.w3.org/2000/svg","path");
    p.setAttribute("d", dir==="left" ? "M15 18l-6-6 6-6" : "M9 18l6-6-6-6"); s.appendChild(p); return s;
  }
  function svgKbHint(arr){ // arr: ['↑','↓'] 等
    const wrap = document.createElement("span"); wrap.className = "mcp-kbhint";
    arr.forEach(k => { const t=document.createElement("span"); t.className="mcp-k"; t.textContent=k; wrap.appendChild(t); });
    return wrap;
  }
  function flashGlow(el){
    el.classList.add("mcp-glow");
    clearTimeout(el._glowT);
    el._glowT = setTimeout(()=>el.classList.remove("mcp-glow"), 180);
  }
  function normalizeUnit(v){ if (typeof v === "number") return v + "px"; if (typeof v === "string") return v; return "0px"; }

  // ---------- 旋鈕 ----------
  function createKnob({ label, subtitle, min, max, value, onChange, kbHint }) {
    const wrap = document.createElement("div");

    const field = document.createElement("div");
    field.className = "mcp-field";
    const labelWrap = document.createElement("div");
    const h3 = document.createElement("div");
    h3.className = "mcp-label2"; h3.textContent = label;
    if (kbHint) h3.appendChild(kbHint);
    const sub = document.createElement("div");
    sub.className = "mcp-note"; sub.textContent = subtitle || "";
    labelWrap.appendChild(h3); if (subtitle) labelWrap.appendChild(sub);
    const badge = document.createElement("span");
    badge.className = "mcp-badge"; badge.textContent = String(value);
    field.appendChild(labelWrap); field.appendChild(badge);

    const box = document.createElement("div"); box.style.display="flex"; box.style.justifyContent="center";
    const knob = document.createElement("div"); knob.className = "mcp-knob"; knob.tabIndex = 0;

    const ticks = document.createElement("div"); ticks.className = "mcp-ticks";
    for (let i = 0; i <= 10; i++) {
      const t = document.createElement("div"); t.className = "mcp-tick";
      t.style.transform = `rotate(${(-135 + (i * 270) / 10)}deg) translateX(-50%)`; ticks.appendChild(t);
    }
    const needle = document.createElement("div"); needle.className = "mcp-needle";
    const cap = document.createElement("div"); cap.className = "mcp-knob-cap";
    knob.appendChild(ticks); knob.appendChild(needle); knob.appendChild(cap); box.appendChild(knob);

    function syncNeedle() {
      const a = (value - min) / (max - min);
      const deg = -135 + a * 270;
      needle.style.transform = `rotate(${deg}deg)`;
      badge.textContent = String(value);
    }
    syncNeedle();

    let dragging = false;
    knob.addEventListener("pointerdown", (e) => { knob.setPointerCapture(e.pointerId); dragging = true; });
    knob.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      const r = knob.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const deg = pointerDegFromCenter(cx, cy, e.clientX, e.clientY);
      value = clamp(angleToValue(deg, min, max), min, max);
      syncNeedle(); onChange && onChange(value); flashGlow(knob);
    });
    knob.addEventListener("pointerup", (e) => { knob.releasePointerCapture(e.pointerId); dragging = false; });
    knob.addEventListener("wheel", (e) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -1 : 1;
      value = clamp(value + delta * Math.ceil((max - min) / 100), min, max);
      syncNeedle(); onChange && onChange(value); flashGlow(knob);
    });
    // 雙擊回中
    knob.addEventListener("dblclick", () => {
      value = clamp((min + max) >> 1, min, max);
      syncNeedle(); onChange && onChange(value); flashGlow(knob);
    });

    wrap.appendChild(field); wrap.appendChild(box);

    return {
      el: wrap, knobEl: knob,
      set(v){ value = clamp(v, min, max); syncNeedle(); },
      get(){ return value; },
      focus(){ knob.focus(); }
    };
  }

  // ---------- 面板 ----------
  function createPanel(container, options = {}) {
    injectStyles();
    const root = document.createElement("div"); root.className = "mcp-root";

    // 左側收合按鈕
    const leftBtnWrap = document.createElement("div"); leftBtnWrap.className = "mcp-leftbtn";
    const leftBtn = document.createElement("button"); leftBtn.className = "mcp-iconbtn";
    leftBtn.appendChild(svgChevron("left")); leftBtnWrap.appendChild(leftBtn); root.appendChild(leftBtnWrap);

    // 面板
    const panel = document.createElement("div"); panel.className = "mcp-panel mcp-card";
    const inner = document.createElement("div"); inner.className = "mcp-p6";
    panel.appendChild(inner); root.appendChild(panel);

    //config
    const cfg = {
        modStep: 2,        // ↑↓ 基本步長（原本是 1）
        modStepBig: 8,    // Shift+↑↓ 大步
        pbStep: 512,      // ←→ 基本步長（原本是 256）
        pbStepBig: 2048,   // Shift+←→ 大步
        repeatHz: 40,      // 長按重複頻率（次/秒）
        accel: 1.4,        // 長按每次微加速倍數
        pbReturnMs: 180    // PB 鬆開回正時間
    };
    Object.assign(cfg, options);

    // Header
    const header = document.createElement("div"); header.className = "mcp-row";
    const hleft = document.createElement("div"); hleft.className = "mcp-row-gap";
    const icon = document.createElement("div");
    Object.assign(icon.style,{width:"40px",height:"40px",borderRadius:"16px",
      background:"linear-gradient(135deg,#6366f1,#38bdf8)",display:"grid",placeItems:"center",
      boxShadow:"0 6px 14px rgba(0,0,0,.25)"});
    const iconDot = document.createElement("div");
    Object.assign(iconDot.style,{width:"16px",height:"16px",borderRadius:"50%",background:"#fff"});
    icon.appendChild(iconDot);
    const titleWrap = document.createElement("div");
    const title = document.createElement("div"); title.className = "mcp-title"; title.textContent = "MIDI CC 控制面板";
    const sub = document.createElement("div"); sub.className = "mcp-sub"; sub.textContent = "功能（Modulation、Pitch Bend、延音踏板）";
    titleWrap.appendChild(title); titleWrap.appendChild(sub);
    hleft.appendChild(icon); hleft.appendChild(titleWrap);

    const hright = document.createElement("div");
    const chBadge = document.createElement("span"); chBadge.className = "mcp-badge"; hright.appendChild(chBadge);
    header.appendChild(hleft); header.appendChild(hright);

    const hr = document.createElement("hr"); hr.className = "mcp-hr";

    // 狀態
    let state = {
      collapsed: true,
      channel: "all",
      mod: 0,
      bend: 0,
      sustain: false,
      vel: 70
    };

    // 上排：Channel + Sustain
    const gridTop = document.createElement("div"); gridTop.className = "mcp-grid mcp-grid-3";

    // Channel (col 1)
    const chBox = document.createElement("div"); chBox.className = "mcp-col-1";
    const chLabel = document.createElement("div"); chLabel.className = "mcp-label"; chLabel.textContent = "指定 Channel";
    const chWrap = document.createElement("div"); chWrap.className = "mcp-select-wrap";
    const chSel = document.createElement("select"); chSel.className = "mcp-select";
    const optAll = document.createElement("option"); optAll.value = "all"; optAll.textContent = "ALL"; chSel.appendChild(optAll);
    for (let i=1;i<=16;i++){ const o=document.createElement("option"); o.value=String(i); o.textContent="CH "+String(i).padStart(2,"0"); chSel.appendChild(o); }
    chWrap.appendChild(chSel); chBox.appendChild(chLabel); chBox.appendChild(chWrap);

    // Velocity (col 2)
    const velBox = document.createElement("div"); // 第2欄不需特別標，預設就會落在中間欄
    const velLabel = document.createElement("div");
    velLabel.className = "mcp-label";
    velLabel.textContent = "Velocity（1–127）";

    const velRow = document.createElement("div");
    velRow.className = "mcp-row-gap";

    // 數字輸入
    const velNum = document.createElement("input");
    velNum.className = "mcp-num";
    velNum.type = "number";
    velNum.min = "1";   // 避免 0 導致 note-on=note-off；若你要允許 0，就把這行改成 "0"
    velNum.max = "127";
    velNum.value = String(state.vel);

    // 滑桿
    const velRangeWrap = document.createElement("div");
    velRangeWrap.className = "mcp-range";
    const velRange = document.createElement("input");
    velRange.type = "range";
    velRange.min = "1";  // 同上，若要允許 0，把這行改為 "0"
    velRange.max = "127";
    velRange.value = String(state.vel);
    velRangeWrap.appendChild(velRange);

    velRow.appendChild(velNum);
    velRow.appendChild(velRangeWrap);

    velBox.appendChild(velLabel);
    velBox.appendChild(velRow);

    // 綁定事件
    function syncVel(v){
        v = Math.max(1, Math.min(127, v)); // 如果你允許 0，改成 Math.max(0, Math.min(127, v))
        state.vel = v;
        velNum.value = String(v);
        velRange.value = String(v);
        styleRangeFill(velRange);            // ← 同步填色
        localStorage.setItem('mcp_velocity', String(v)); // 你若已加記憶功能就保留
    }
    velNum.addEventListener("input", () => {
    const v = parseInt(velNum.value || "0", 10);
        syncVel(isNaN(v) ? state.vel : v);
    });
    velRange.addEventListener("input", () => {
        syncVel(parseInt(velRange.value, 10));
    });

    // —— 讓 Velocity 的數字框選完就失焦 ——
    // 按 Enter 或 change 就失焦；並避免字母鍵穿透
    velNum.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); velNum.blur(); }
    // 阻擋 A~Z 與逗號這種會被你的琴鍵接手的字元
    const code = e.keyCode || e.which;
    if ((code >= 65 && code <= 90) || code === 188) { e.preventDefault(); e.stopPropagation(); }
    });
    velNum.addEventListener('change', () => velNum.blur());

    // —— 讓滑桿放開就失焦 ——
    // 拖曳結束（pointerup/keyup/change）就失焦，避免還要點背景
    velRange.addEventListener('pointerup', () => velRange.blur());
    velRange.addEventListener('keyup',      () => velRange.blur());
    velRange.addEventListener('change',     () => velRange.blur());


    function styleRangeFill(el){
        const min = +el.min || 0, max = +el.max || 100, val = +el.value || 0;
        const pct = ((val - min) / (max - min)) * 100;
        el.style.setProperty('--val', pct + '%');
    }

    // 初始化一次
    styleRangeFill(velRange);


    // Sustain (col 3)
    const susWrap = document.createElement("div"); susWrap.className = "mcp-col-3";
    const susBox = document.createElement("div"); susBox.className = "mcp-tile";
    const susLabel = document.createElement("div"); susLabel.className = "mcp-label"; susLabel.textContent = "延音踏板（Sustain / CC64）";
    const susRow = document.createElement("div"); susRow.className = "mcp-row";
    const susLeft = document.createElement("div"); susLeft.className = "mcp-row-gap";
    const susDot = document.createElement("div"); susDot.className = "mcp-sustain-dot"; susDot.style.background="#52525b";
    const susTxt = document.createElement("span"); susTxt.className = "mcp-note"; susTxt.style.color="#e5e7eb"; susTxt.textContent="OFF（0）";
    susLeft.appendChild(susDot); susLeft.appendChild(susTxt);
    const susSwitch = document.createElement("div"); susSwitch.className = "mcp-switch";
    const susKnob = document.createElement("div"); susKnob.className = "mcp-switch-knob";
    susSwitch.appendChild(susKnob);
    susRow.appendChild(susLeft); susRow.appendChild(susSwitch);
    susBox.appendChild(susLabel); susBox.appendChild(susRow);
    susWrap.appendChild(susBox);

    // 下排：旋鈕（加上鍵盤提示）
    const gridKnobs = document.createElement("div"); gridKnobs.className = "mcp-grid mcp-grid-2";
    const modTile = document.createElement("div"); modTile.className = "mcp-tile";
    const bendTile = document.createElement("div"); bendTile.className = "mcp-tile";

    

    function toZeroBasedChannel(sel, fallback = 14) {
        if (sel === "all") return fallback;
        const n = parseInt(sel, 10);
        return isNaN(n) ? fallback : (n - 1);
    }

    window.midiCcPanelGetChannel = () => toZeroBasedChannel(state.channel, 14);
    window.midiCcPanelGetVelocity = () => state.vel;
    window.midiCcPanelGetSustain = () => state.sustain;


    // Knobs + keyboard hints
    const modKnob = createKnob({
      label: "Modulation",
      subtitle: "CC1 ・ 0–127",
      min: 0, max: 127, value: state.mod,
      onChange: (v) => { state.mod = v; sendCC(state.channel, 1, v); },
      kbHint: svgKbHint(["↑","↓"])
    });
    const bendKnob = createKnob({
      label: "Pitch Bend",
      subtitle: "-8192 ~ 0 ~ +8191",
      min: -8192, max: 8191, value: state.bend,
      onChange: (v) => { state.bend = v; sendPitchBend(state.channel, v); },
      kbHint: svgKbHint(["←","→"])
    });
    modTile.appendChild(modKnob.el);
    bendTile.appendChild(bendKnob.el);

    // Footer
    const footer = document.createElement("div"); footer.className = "mcp-row";
    const noteWrap = document.createElement("div"); noteWrap.className = "mcp-row-gap";
    const note = document.createElement("span"); note.className = "mcp-note";
    note.textContent = "鍵盤：↑↓ = Mod、    ←→ = Pitch Bend（鬆開自動回正）。";
    noteWrap.appendChild(document.createTextNode("")); noteWrap.appendChild(note);
    const resetBtn = document.createElement("button"); resetBtn.className = "mcp-reset"; resetBtn.textContent = "全部重設";

    // 組裝
    const containerEl = (container instanceof HTMLElement ? container : document.querySelector(container));
    if (!containerEl) return console.warn("createMidiCcPanel: container not found");
    containerEl.appendChild(root);

    inner.appendChild(header); inner.appendChild(hr);
    gridTop.appendChild(chBox); gridTop.appendChild(velBox); gridTop.appendChild(susWrap); inner.appendChild(gridTop);
    const hr2 = document.createElement("hr"); hr2.className = "mcp-hr"; inner.appendChild(hr2);
    gridKnobs.appendChild(modTile); gridKnobs.appendChild(bendTile); inner.appendChild(gridKnobs);
    const hr3 = document.createElement("hr"); hr3.className = "mcp-hr"; inner.appendChild(hr3);
    inner.appendChild(footer); footer.appendChild(noteWrap); footer.appendChild(resetBtn);

    // 同步顯示
    function syncHeader(){ chBadge.textContent = "CH " + (state.channel === "all" ? "ALL" : String(state.channel).padStart(2,"0")); }
    syncHeader();

    // 事件：Channel / Sustain
    chSel.addEventListener("change", () => {
        state.channel = chSel.value;
        localStorage.setItem('mcp_channel', state.channel); // 你如果已經有這行就保留
        syncHeader();
        // 關鍵：把焦點移走，避免下一個字母鍵把 select 又選回 ALL
        chSel.blur();
    });
    susSwitch.addEventListener("click", () => {
      state.sustain = !state.sustain;
      susSwitch.classList.toggle("mcp-switch-on", state.sustain);
      susDot.style.background = state.sustain ? "#34d399" : "#52525b";
      susDot.style.boxShadow = state.sustain ? "0 0 0 3px rgba(16,185,129,.15)" : "none";
      susTxt.textContent = state.sustain ? "ON（127）" : "OFF（0）";
      sendCC(state.channel, 64, state.sustain ? 127 : 0);

      // 廣播：讓外部知道 Sustain 狀態變化
      window.dispatchEvent(new CustomEvent('mcp:sustain', { detail: { on: state.sustain } }));
    });

    resetBtn.addEventListener("click", () => {
      state.channel = "all"; chSel.value = "all"; syncHeader();
      state.mod = 0; modKnob.set(0); sendCC(state.channel, 1, 0); flashGlow(modKnob.knobEl);
      state.bend = 0; bendKnob.set(0); sendPitchBend(state.channel, 0); flashGlow(bendKnob.knobEl);
      state.sustain = false; susSwitch.classList.remove("mcp-switch-on");
      susDot.style.background = "#52525b"; susDot.style.boxShadow = "none"; susTxt.textContent = "OFF（0）";
      state.vel = 70; velNum.value = "70"; velRange.value = "70";
      sendCC(state.channel, 64, 0);
    });

    // 收合/展開（預設收合）
    let collapsed = true;
    function setCollapsed(v){
      collapsed = !!v;
      panel.classList.toggle("mcp-hidden", collapsed);
      leftBtn.replaceChildren(svgChevron(collapsed ? "right" : "left"));
      if (!collapsed) initWebMIDIOnce(); // 展開時初始化 Web MIDI（若可用）
    }
    leftBtn.addEventListener("click", () => setCollapsed(!collapsed));
    setCollapsed(true);

    // —— 鍵盤控制（面板展開時才吃；避免滾動）——
    let modHeldDir = 0;   // -1=↓ +1=↑ 0=無
    let pbHeldDir  = 0;   // -1=← +1=→ 0=無
    let repeatRAF  = null;
    let repeatLast = 0;
    let stepGain   = 1;

    function stepMod(dir, big) {
        const step = (big ? cfg.modStepBig : cfg.modStep) * dir * stepGain;
        const v = clamp(state.mod + step, 0, 127);
        if (v !== state.mod) {
            state.mod = v; modKnob.set(v);
            sendCC(state.channel, 1, v); flashGlow(modKnob.knobEl);
        }
    }

    function stepPB(dir, big) {
        const step = (big ? cfg.pbStepBig : cfg.pbStep) * dir * stepGain;
        const v = clamp(state.bend + step, -8192, 8191);
        if (v !== state.bend) {
            state.bend = v; bendKnob.set(v);
            sendPitchBend(state.channel, v); flashGlow(bendKnob.knobEl);
        }
    }

    let pbReturnAnim = null;
    function startPbReturn() {
        if (pbReturnAnim) cancelAnimationFrame(pbReturnAnim);
        const start = performance.now();
        const startVal = state.bend;
        const dur = cfg.pbReturnMs;
        (function tick(t0){
            const t = Math.min(1, (t0 - start)/dur);
            const eased = 1 - Math.pow(1 - t, 3);
            const v = Math.round(startVal + (0 - startVal) * eased);
            state.bend = v; bendKnob.set(v); sendPitchBend(state.channel, v);
            if (t < 1 && pbHeldDir === 0) {
            pbReturnAnim = requestAnimationFrame(tick);
            } else {
            pbReturnAnim = null;
            }
        })(start);
    }

    function repeatLoop(ts) {
        if (collapsed) { repeatRAF = null; return; }
        const interval = 1000 / cfg.repeatHz;
        if (!repeatLast) repeatLast = ts;
        const dt = ts - repeatLast;
        if (dt >= interval) {
            const big = window.event && window.event.shiftKey; // 盡量讀取 Shift 狀態
            if (modHeldDir) stepMod(modHeldDir, big);
            if (pbHeldDir)  stepPB(pbHeldDir,  big);
            repeatLast = ts;
            // 每次觸發稍微加速（上限 3 倍）
            stepGain = Math.min(3, stepGain * cfg.accel);
        }
        repeatRAF = requestAnimationFrame(repeatLoop);
    }

    function ensureRepeatLoop() {
        if (!repeatRAF) {
            stepGain = 1;
            repeatLast = 0;
            repeatRAF = requestAnimationFrame(repeatLoop);
        }
    }

    function stopRepeatIfIdle() {
        if (!modHeldDir && !pbHeldDir) {
            if (repeatRAF) cancelAnimationFrame(repeatRAF);
            repeatRAF = null;
            stepGain = 1;
        }
    }

    function onKeyDown(e) {
        if (collapsed) return;
        const k = e.key;
        if (["ArrowUp","ArrowDown","ArrowLeft","ArrowRight"].includes(k)) e.preventDefault();

        if (k === "ArrowUp")    { modHeldDir = +1; stepMod(+1, e.shiftKey); ensureRepeatLoop(); }
        if (k === "ArrowDown")  { modHeldDir = -1; stepMod(-1, e.shiftKey); ensureRepeatLoop(); }
        if (k === "ArrowLeft")  { pbHeldDir  = -1; stepPB(-1, e.shiftKey);  ensureRepeatLoop(); }
        if (k === "ArrowRight") { pbHeldDir  = +1; stepPB(+1, e.shiftKey);  ensureRepeatLoop(); }
    }

    function onKeyUp(e) {
        if (collapsed) return;
        const k = e.key;

        if (k === "ArrowUp"   && modHeldDir > 0) modHeldDir = 0;
        if (k === "ArrowDown" && modHeldDir < 0) modHeldDir = 0;

        if (k === "ArrowLeft" && pbHeldDir < 0)  { pbHeldDir = 0; startPbReturn(); }
        if (k === "ArrowRight"&& pbHeldDir > 0)  { pbHeldDir = 0; startPbReturn(); }

        stopRepeatIfIdle();
    }

    window.addEventListener("keydown", onKeyDown, { passive:false });
    window.addEventListener("keyup",   onKeyUp,   { passive:false });

    // 對外 API
    panel.style.setProperty('--mcp-left', '24px');
    panel.style.setProperty('--mcp-top',  '24px');

    return {
      getState(){ return { ...state, collapsed }; },
      setMod(v){ state.mod = clamp(v, 0, 127); modKnob.set(state.mod); sendCC(state.channel,1,state.mod); },
      setBend(v){ state.bend = clamp(v, -8192, 8191); bendKnob.set(state.bend); sendPitchBend(state.channel,state.bend); },
      setSustain(on){ state.sustain = !!on; susSwitch.classList.toggle("mcp-switch-on", state.sustain);
        susDot.style.background = on? "#34d399":"#52525b"; susDot.style.boxShadow = on? "0 0 0 3px rgba(16,185,129,.15)":"none";
        susTxt.textContent = on? "ON（127）":"OFF（0）"; sendCC(state.channel,64, on?127:0); },
      setChannel(ch){ chSel.value = ch; chSel.dispatchEvent(new Event("change")); },
      collapse(){ setCollapsed(true); },
      expand(){ setCollapsed(false); },
      setOffset(x,y){ panel.style.setProperty('--mcp-left', normalizeUnit(x)); panel.style.setProperty('--mcp-top', normalizeUnit(y)); }
    };
  }

  window.createMidiCcPanel = function (container, options) {
        if (window.__mcpInstance) return window.__mcpInstance;  // ← 防重複建立
        window.__mcpInstance = createPanel(container, options);
        return window.__mcpInstance;
    };
})();
