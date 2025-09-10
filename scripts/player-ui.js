// PlayerUI — MIDI Player UI (Style 6)
// Clean fixed build: marquee-hold (single text, center hold), loop icon spin,
// strip extension from title, unified width & centered layout, safe global attach.

; (function (global) {
  const STYLE_ID = 'pui-style';

  const SVG = {
    play:  '<path d="M8 5v14l11-7z"/>',
    pause: '<rect x="6" y="5" width="4.5" height="14" rx="1.5"></rect><rect x="13.5" y="5" width="4.5" height="14" rx="1.5"></rect>',
    stop:  '<rect x="6" y="6" width="12" height="12" rx="2"/>',
    loop:  '<path d="M3 11a6 6 0 0 1 6-6h7"/><path d="M16 2l3 3-3 3"/><path d="M21 13a6 6 0 0 1-6 6H8"/><path d="M8 22l-3-3 3-3"/>',
    file:  '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6"/>',
    chevron: '<path d="M7 10l5 5 5-5" fill="none" stroke="#e5e7eb" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
    reset: '<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v6h6"/>'
  };

  const CSS = `
/* ===== Layout (unified width & centered) ===== */
.pui-wrap{
  --pui-max: clamp(320px, 90vw, 640px);
  width: var(--pui-max);
  margin: 40px auto;
  position: relative;
  color:#e5e7eb;
  font:14px/1.5 system-ui,-apple-system,Segoe UI,Roboto,Noto Sans,Arial;
  display:grid;
  justify-items:center;
}
.pui-player{ width:100%; display:grid; gap:12px; justify-items:center; text-align:center; transition: transform .28s cubic-bezier(.2,.9,.2,1), opacity .28s ease }
.pui-wrap.collapsed .pui-player{ transform: translateY(26px); opacity:0; pointer-events:none }

/* ===== Main controls ===== */
.pui-play{ width:88px; height:88px; border-radius:50%; display:grid; place-items:center; border:1px solid rgba(255,255,255,.16); background:rgba(255,255,255,.06); backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px); box-shadow:0 10px 24px rgba(124,58,237,.25); transition:transform .15s ease, background .2s ease, box-shadow .2s ease }
.pui-play:hover{ background:rgba(255,255,255,.10); transform:scale(1.04) }
.pui-play svg{ width:32px; height:32px; fill:#fff }

.pui-toolbar{ display:grid; grid-template-columns: 1fr auto 1fr; align-items:center; gap:12px; width:100% }
.pui-side{ display:flex; gap:10px }
.pui-side.left{ justify-content:flex-start }
.pui-side.right{ justify-content:flex-end }
.pui-icon{ width:42px; height:42px; display:grid; place-items:center; border-radius:12px; border:1px solid rgba(255,255,255,.12); background:rgba(255,255,255,.06); opacity:.9; box-shadow:0 6px 14px rgba(0,0,0,.18); transition: transform .18s cubic-bezier(.2,.9,.2,1), background .2s ease, box-shadow .2s ease; will-change: transform, background, box-shadow; cursor:pointer }
.pui-icon:hover{ background:rgba(255,255,255,.10); transform: translateY(-6px); box-shadow:0 14px 30px rgba(0,0,0,.28) }
.pui-icon:active{ transform: translateY(-2px); box-shadow:0 8px 18px rgba(0,0,0,.24) }
.pui-icon svg{ width:20px; height:20px; fill:#e5e7eb }
.pui-icon.is-on{ background:rgba(34,211,238,.16); border-color:rgba(34,211,238,.35); box-shadow:0 8px 22px rgba(34,211,238,.25) }
.pui-file{ position:relative }
.pui-file input{ position:absolute; inset:0; opacity:0; cursor:pointer }

/* ===== Title with gradient + single-span marquee (center hold) ===== */
.pui-titleRow{ display:flex; align-items:center; justify-content:center; gap:10px; width:100%; margin-inline:auto }
.pui-title{ position:relative; width:100%; white-space:nowrap; overflow:hidden; text-overflow:clip; opacity:.95; font-size:22px; font-weight:700; text-align:center; --pui-marquee-dur:12s; }
.pui-title{ mask-image: linear-gradient(to right, transparent 0, black 10px, black calc(100% - 10px), transparent 100%); -webkit-mask-image: linear-gradient(to right, transparent 0, black 10px, black calc(100% - 10px), transparent 100%); }
.pui-titleText{ display:inline-block; padding-inline: 0; background: linear-gradient(30deg, #B15BFF 25%, #AE00AE, #820041 65%); -webkit-background-clip:text; background-clip:text; color:transparent; -webkit-text-fill-color: transparent; }
/* 標題跑馬燈綁新動畫：pui-marquee-solo2 */
.pui-title.is-marquee .pui-titleText{
  animation: pui-marquee-solo2 var(--pui-marquee-dur) linear infinite;
  will-change: transform, opacity;
}

/* 中間停留的單字串跑馬燈 */
@keyframes pui-marquee-hold{
  0%   { transform: translateX(var(--pui-start-x));  opacity:0 }
  15%  { opacity:1 }
  25%  { transform: translateX(var(--pui-center-x)); opacity:1 }  /* 到中央 */
  75%  { transform: translateX(var(--pui-center-x)); opacity:1 }  /* 中央停留 */
  85%  { opacity:1 }
  100% { transform: translateX(var(--pui-end-x));    opacity:0 }  /* 左側外淡出 */
}

/* ===== Seek & time ===== */
.pui-seek{ width:100%; height:10px; border-radius:999px; border:1px solid rgba(255,255,255,.10); background:rgba(255,255,255,.05); overflow:hidden; position:relative; touch-action:none; margin-inline:auto }
.pui-fill{ position:absolute; inset:0 auto 0 0; width:0%; height:100%; background:linear-gradient(90deg, #22d3ee, #7c3aed) }
.pui-thumb{ position:absolute; top:50%; left:0%; transform:translate(-50%,-50%); width:16px; height:16px; border-radius:50%; background:linear-gradient(180deg,#fff,#e5e7eb); box-shadow:0 2px 8px rgba(0,0,0,.45) }
.pui-time{ width:100%; margin-inline:auto; font-variant-numeric:tabular-nums; color:#cbd5e1; opacity:.85; text-align:right }

/* ===== Toggle & reset ===== */
.pui-toggle, .pui-reset{ position:absolute; width:40px; height:40px; border-radius:12px; border:1px solid rgba(255,255,255,.12); background:rgba(255,255,255,.06); display:grid; place-items:center; cursor:pointer; transition:transform .2s ease, background .2s ease; box-shadow:0 6px 14px rgba(0,0,0,.18) }
.pui-toggle:hover, .pui-reset:hover{ background:rgba(255,255,255,.10); transform: translateY(-4px); box-shadow:0 12px 24px rgba(0,0,0,.24) }
.pui-toggle:active, .pui-reset:active{ transform: translateY(-1px); box-shadow:0 8px 16px rgba(0,0,0,.22) }
.pui-toggle{ right:56px; bottom:-20px }
.pui-reset{  right:8px;  bottom:-20px }
.pui-wrap.collapsed .pui-toggle svg{ transform:rotate(180deg) }
.pui-toggle svg, .pui-reset svg{ width:18px; height:18px }

/* ===== Loop on: rotate + glow ===== */
.pui-loop{ color:#e5e7eb }
.pui-loop svg{ stroke: currentColor !important; fill:none }
.pui-loop.is-on{ color:#22d3ee }
.pui-loop.is-on svg{ animation: pui-loop-spin 1.6s linear infinite; filter: drop-shadow(0 0 6px rgba(34,211,238,.45)) }
@keyframes pui-loop-spin{ to{ transform: rotate(360deg) } }

/* ===== Keyboard flash (Reset) ===== */
@keyframes pui-kb-flash { 0% { filter:none; } 25% { filter:brightness(1.4) saturate(1.1); } 100% { filter:none; } }
.pui-flash-once { animation: pui-kb-flash 220ms ease-out }

@media (prefers-reduced-motion: reduce){
  .pui-icon, .pui-toggle, .pui-reset, .pui-play { transition:none !important }
  .pui-icon:hover, .pui-toggle:hover, .pui-reset:hover, .pui-play:hover { transform:none !important }
  .pui-title.is-marquee .pui-titleText { animation: none !important }
}
/* 時間置中 */
.pui-time{
  width:100%;
  margin-inline:auto;
  font-variant-numeric:tabular-nums;
  color:#cbd5e1; opacity:.85;
  text-align:center; /* ← 改成置中 */
}
@keyframes pui-marquee-solo{
  0%   { transform: translateX(var(--pui-start-x));        opacity:0 }
  2%   { transform: translateX(var(--pui-start-x));        opacity:1 } /* 很短的進場停留（由 8% → 2%） */
  22%  { transform: translateX(var(--pui-center-right-x)); opacity:1 } /* 更早到中央右側（30% → 22%） */
  78%  { transform: translateX(var(--pui-center-left-x));  opacity:1 } /* 更晚離開中央（70% → 78%） */
  98%  { transform: translateX(var(--pui-end-x));          opacity:1 } /* 很短的離場停留（92% → 98%） */
  100% { transform: translateX(var(--pui-end-x));          opacity:0 } /* 立刻進入下一輪 */
}
@keyframes pui-marquee-solo2{
  0%   { transform: translateX(var(--pui-start-x));        opacity:0 }
  1.5% { transform: translateX(var(--pui-start-x));        opacity:1 } /* 極短進場 */
  25%  { transform: translateX(var(--pui-center-right-x)); opacity:1 } /* 快到中央右側 */
  75%  { transform: translateX(var(--pui-center-left-x));  opacity:1 } /* 在中央區域花最多時間 */
  98.5%{ transform: translateX(var(--pui-end-x));          opacity:1 } /* 極短離場 */
  100% { transform: translateX(var(--pui-end-x));          opacity:0 } /* 完全消失 → 下一輪從右邊進場 */
}
`;

  function injectStyleOnce() {
    if (!document.getElementById(STYLE_ID)) {
      const s = document.createElement('style');
      s.id = STYLE_ID;
      s.textContent = CSS;
      document.head.appendChild(s);
    }
  }

  function injectForceMarqueeStyle(){
        var id = 'pui-force-marquee-style';
        if (document.getElementById(id)) return;
        var st = document.createElement('style');
        st.id = id;
        st.textContent = `
            .pui-title.pui-force-marquee .pui-titleText{
            animation: pui-marquee-solo2 var(--pui-marquee-dur) linear infinite !important;
            }
        `;
        document.head.appendChild(st);
    }

  function fmt(t){ if (!isFinite(t) || t < 0) t = 0; const m = Math.floor(t/60), s = Math.floor(t%60); return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`; }
  function stripExt(name){ try { return String(name).replace(/\.[^\.\/]+$/,''); } catch(_) { return name; } }

  function tryResumeAudio(){
    try { if (global.Tone && Tone.context && typeof Tone.context.resume==='function' && Tone.context.state!=='running') Tone.context.resume(); } catch(_) {}
    try {
      const ac = global.audioCtx || global.audioContext || (global.midi_synth && (global.midi_synth.audioContext || global.midi_synth.ctx));
      if (ac && typeof ac.resume==='function' && ac.state!=='running') ac.resume();
    } catch(_) {}
  }

  // Wrap common player shapes into a unified adapter
  function makeAdapter(p){
    const has = (fn)=> p && typeof p[fn]==='function';
    return {
      play: ()=> has('play') && p.play(),
      pause: ()=> has('pause') && p.pause(),
      stop: ()=> has('stop') && p.stop(),
      seek: (t)=> has('seek') ? p.seek(t) : (has('setPosition') && p.setPosition(t)),
      getDuration: ()=> has('getDuration') ? p.getDuration() : (p && p.duration || 0),
      getPosition: ()=> has('getPosition') ? p.getPosition() : (p && p.position || 0),
      setLoop: (on)=> has('setLoop') ? p.setLoop(on) : (p ? (p.loop = !!on) : void 0),
      onEnded: (cb)=> { if (!p) return; if (has('on')) p.on('ended', cb); else if (has('addEventListener')) p.addEventListener('ended', cb); }
    };
  }
  function resolveAdapter(opts){
    if (opts && opts.adapter) return opts.adapter;
    const inst = (opts && opts.player) || global.midiFilePlayer || global.MidiFilePlayer || global.player || null;
    return inst ? makeAdapter(inst) : null;
  }

  function templateHTML(){
    return `
      <div class="pui-player" role="group" aria-label="MIDI Player">
        <button class="pui-play" aria-label="Play/Pause" aria-pressed="false">
          <svg viewBox="0 0 24 24">${SVG.play}</svg>
        </button>

        <div class="pui-toolbar">
          <div class="pui-side left">
            <label class="pui-icon pui-file" title="選擇檔案" aria-label="選擇檔案">
              <svg viewBox="0 0 24 24">${SVG.file}</svg>
              <input type="file" accept=".mid,.midi"/>
            </label>
          </div>
          <div class="pui-titleRow">
            <div class="pui-title"><span class="pui-titleText">未載入檔名</span></div>
          </div>
          <div class="pui-side right">
            <button class="pui-icon pui-stop" title="停止" aria-label="停止">
              <svg viewBox="0 0 24 24">${SVG.stop}</svg>
            </button>
            <button class="pui-icon pui-loop" title="循環播放" aria-label="循環播放" aria-pressed="false">
              <svg viewBox="0 0 24 24" fill="none" stroke="#e5e7eb" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${SVG.loop}</svg>
            </button>
          </div>
        </div>

        <div class="pui-seek" role="slider" aria-label="Seek bar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
          <span class="pui-fill"></span>
          <span class="pui-thumb"></span>
        </div>
        <div class="pui-time">00:00 / --:--</div>
      </div>

      <button class="pui-toggle" aria-label="收合/展開">
        <svg viewBox="0 0 24 24">${SVG.chevron}</svg>
      </button>
      <button class="pui-reset" aria-label="重置琴鍵">
        <svg viewBox="0 0 24 24" fill="none" stroke="#e5e7eb" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${SVG.reset}</svg>
      </button>
    `;
  }

  function mount(container, opts = {}){
    const alwaysMarquee = (opts.alwaysMarquee !== undefined) ? !!opts.alwaysMarquee : true;
    injectStyleOnce();
    if (alwaysMarquee) { try { injectForceMarqueeStyle(); } catch(_){} }

    // 跑馬燈額外參數（可在 mount 時透過 opts 傳入覆蓋）
    const titlePadSpaces = Number.isFinite(opts.titlePadSpaces) ? Math.max(0, opts.titlePadSpaces|0) : 0; // 播放時在檔名前後補 NBSP
    const NBSP = '\u00A0';

    // 只顯示一個 <span>，避免舊版 clone 殘留
    function ensureSingleTitleSpan(){
        const spans = titleWrap.querySelectorAll('.pui-titleText');
        spans.forEach((s,i)=>{ if (i>0) s.remove(); });
    }

    // 依照是否要補空白來渲染文字（用 NBSP，避免空白被合併）
    function renderTitle(paddingActive){
        const base = titleSpan.dataset.baseTitle || titleSpan.textContent || '—';
        const pad  = (paddingActive ? titlePadSpaces : 0);
        const spacer = pad ? NBSP.repeat(pad) : '';
        titleSpan.textContent = spacer + base + spacer;
    }


    const elRoot = (typeof container === 'string') ? document.querySelector(container) : container;
    if (!elRoot) throw new Error('PlayerUI.mount: container not found');

    const wrap = document.createElement('div');
    wrap.className = 'pui-wrap';
    if (opts.width) wrap.style.setProperty('--pui-max', String(opts.width)); // optional external sizing
    wrap.innerHTML = templateHTML();
    elRoot.appendChild(wrap);

    // refs
    const playBtn   = wrap.querySelector('.pui-play');
    const stopBtn   = wrap.querySelector('.pui-stop');
    const loopBtn   = wrap.querySelector('.pui-loop');
    const fileInp   = wrap.querySelector('.pui-file input');
    const titleWrap = wrap.querySelector('.pui-title');
    const titleSpan = wrap.querySelector('.pui-titleText');
    const timeEl    = wrap.querySelector('.pui-time');
    const seekEl    = wrap.querySelector('.pui-seek');
    const fillEl    = wrap.querySelector('.pui-fill');
    const thumbEl   = wrap.querySelector('.pui-thumb');
    const toggle    = wrap.querySelector('.pui-toggle');
    const reset     = wrap.querySelector('.pui-reset');

    const player = resolveAdapter(opts);
    if (!player) console.warn('[PlayerUI] No player resolved. Pass {player} or {adapter}.');
    const state = { isPlaying:false, loop:false, duration:0, raf:0, dragging:false };

    function ensureSingleTitleSpan(){
      const spans = titleWrap.querySelectorAll('.pui-titleText');
      spans.forEach((s,i)=>{ if (i>0) s.remove(); });
    }

    function setPlayUI(playing){
      state.isPlaying = playing;
      playBtn.setAttribute('aria-pressed', playing ? 'true' : 'false');
      const svg = playBtn.querySelector('svg'); if (svg) svg.innerHTML = playing ? SVG.pause : SVG.play;
      applyMarquee(playing);
    }
    function setLoopUI(on){
      state.loop = !!on;
      loopBtn.classList.toggle('is-on', state.loop);
      loopBtn.setAttribute('aria-pressed', state.loop ? 'true' : 'false');
      player && player.setLoop && player.setLoop(state.loop);
    }

    function getDur(){ return player && player.getDuration ? player.getDuration() : 0; }
    function getPos(){ return player && player.getPosition ? player.getPosition() : 0; }

    function updateTimeAndBar(){
      if (!player) return;
      const dur = getDur(); if (dur) state.duration = dur;
      const pos = getPos();
      if (state.duration > 0){
        const pct = Math.max(0, Math.min(1, pos/state.duration));
        fillEl.style.width = `${pct*100}%`;
        thumbEl.style.left = `${pct*100}%`;
        seekEl.setAttribute('aria-valuenow', Math.round(pct*100));
        timeEl.textContent = `${fmt(pos)} / ${fmt(state.duration)}`;
      } else {
        timeEl.textContent = `${fmt(pos)} / --:--`;
      }
      if (state.isPlaying && !state.loop && state.duration>0 && pos >= state.duration - 0.02){
        player.pause && player.pause();
        player.seek && player.seek(state.duration);
        setPlayUI(false);
        try { global.allNotesOff && global.allNotesOff(); } catch(e){}
        cancelAnimationFrame(state.raf); state.raf = 0; return;
      }
      state.raf = requestAnimationFrame(updateTimeAndBar);
    }

    function seekToClientX(clientX){
      const rect = seekEl.getBoundingClientRect();
      const pct = Math.max(0, Math.min(1, (clientX - rect.left)/rect.width));
      const t = (state.duration||0) * pct;
      fillEl.style.width = `${pct*100}%`;
      thumbEl.style.left = `${pct*100}%`;
      seekEl.setAttribute('aria-valuenow', Math.round(pct*100));
      if (player && player.seek) player.seek(t);
      timeEl.textContent = `${fmt(t)} / ${fmt(state.duration)}`;
    }

    function applyMarquee(playing){
        // 清乾淨，確保單一 span、沒有殘留樣式
        if (typeof ensureSingleTitleSpan === 'function') ensureSingleTitleSpan();
        titleWrap.classList.remove('is-marquee','pui-force-marquee');
        try{
            titleSpan.style.removeProperty('animation');
            titleSpan.style.removeProperty('--pui-start-x');
            titleSpan.style.removeProperty('--pui-center-right-x');
            titleSpan.style.removeProperty('--pui-center-left-x');
            titleSpan.style.removeProperty('--pui-end-x');
        }catch(_){}

        // 若你有「補空白」方案，這裡可視 playing 狀態決定是否補（沒有就忽略）
        if (typeof renderTitle === 'function') renderTitle(playing && titlePadSpaces > 0);

        requestAnimationFrame(()=>{
            const wrapW = titleWrap.clientWidth;
            const textW = titleSpan.scrollWidth;
            const need  = playing && (alwaysMarquee || textW > wrapW + 4);
            if (!need) return;

            // 邊緣額外距離：小一點 → 邊緣不會待太久；可用 opts.marqueeMarginPx 覆蓋
            const margin = (typeof opts.marqueeMarginPx === 'number')
            ? Math.max(0, opts.marqueeMarginPx)
            : 80; // 預設 80px

            // 中央慢區寬度：大一點 → 視覺上「在中間更久」，可用 opts.marqueeSlowZonePx 覆蓋
            const slowZone = (typeof opts.marqueeSlowZonePx === 'number')
            ? Math.max(40, opts.marqueeSlowZonePx)
            : Math.max( Math.min(textW, wrapW * 0.9), 160 ); // 預設：min(文字寬, 容器 60%)，至少 160px

            // 位置參數：右外 → 中央右 → 中央左 → 左外
            const startX  = wrapW + margin;
            const endX    = -textW - margin;
            const centerX = (wrapW - textW) / 2;
            const centerRightX = centerX + slowZone/2;
            const centerLeftX  = centerX - slowZone/2;

            // 總距離與時間：略調快，避免你覺得「消失很久」
            const dist = startX - endX;                  // 正值
            const dur  = Math.max(6, Math.min(22, dist/65)); // 6–22s/輪、基準 ~55 px/s

            // 賦值給 CSS 變數
            titleWrap.style.setProperty('--pui-marquee-dur', `${dur}s`);
            titleSpan.style.setProperty('--pui-start-x', `${startX}px`);
            titleSpan.style.setProperty('--pui-center-right-x', `${centerRightX}px`);
            titleSpan.style.setProperty('--pui-center-left-x', `${centerLeftX}px`);
            titleSpan.style.setProperty('--pui-end-x', `${endX}px`);

            // 啟動新動畫
            titleSpan.style.animation = `pui-marquee-solo2 ${dur}s linear infinite`;
            titleWrap.classList.add('is-marquee');
            if (alwaysMarquee) titleWrap.classList.add('pui-force-marquee');
        });
    }





    function setTitleText(t){
        ensureSingleTitleSpan();
        const base = stripExt(t || '—');
        titleSpan.dataset.baseTitle = base;

        // 預設不補空白（播放時 applyMarquee 會再補）
        renderTitle(false);

        titleWrap.classList.remove('is-marquee','pui-force-marquee');
        try{
            titleSpan.style.removeProperty('animation');
            titleSpan.style.removeProperty('--pui-start-x');
            titleSpan.style.removeProperty('--pui-center-right-x');
            titleSpan.style.removeProperty('--pui-center-left-x');
            titleSpan.style.removeProperty('--pui-end-x');
        }catch(_){}
    }

    // events
    seekEl.addEventListener('pointerdown', (e)=>{ state.dragging=true; seekEl.setPointerCapture(e.pointerId); seekToClientX(e.clientX); e.preventDefault(); });
    seekEl.addEventListener('pointermove', (e)=>{ if (state.dragging) seekToClientX(e.clientX); });
    seekEl.addEventListener('pointerup',   (e)=>{ state.dragging=false; seekEl.releasePointerCapture(e.pointerId); });
    seekEl.addEventListener('pointercancel', ()=> state.dragging=false);

    fileInp.addEventListener('change', async (e)=>{
      const f = e.target.files && e.target.files[0];
      if (!f) return;
      setTitleText(f.name);
      try{
        if (typeof (opts.loadFile) === 'function') {
          await opts.loadFile(f);
        } else if (opts.player) {
          if (typeof opts.player.loadFile === 'function') await opts.player.loadFile(f);
          else if (typeof opts.player.load === 'function') { const buf = await f.arrayBuffer(); await opts.player.load(buf); }
          else if (typeof opts.player.open === 'function') await opts.player.open(f);
        }
        state.duration = getDur();
        setPlayUI(false);
        // reset progress
        timeEl.textContent = `00:00 / ${state.duration?fmt(state.duration):'--:--'}`;
        fillEl.style.width = '0%'; thumbEl.style.left = '0%';
        opts.onFileLoaded && opts.onFileLoaded(f);
      }catch(err){ console.warn('[PlayerUI] Load MIDI failed:', err); }
    });

    playBtn.addEventListener('click', ()=>{
      tryResumeAudio();
      if (!player || !player.play) { console.warn('[PlayerUI] No player.play()'); return; }
      if (state.isPlaying) { player.pause && player.pause(); setPlayUI(false); }
      else { player.play(); setPlayUI(true); if (!state.raf) state.raf = requestAnimationFrame(updateTimeAndBar); }
    });

    stopBtn.addEventListener('click', ()=>{
      if (!player) return;
      player.stop && player.stop();
      player.seek && player.seek(0);
      setPlayUI(false);
      fillEl.style.width = '0%'; thumbEl.style.left = '0%';
      timeEl.textContent = `00:00 / ${state.duration?fmt(state.duration):'--:--'}`;
      try { global.allNotesOff && global.allNotesOff(); } catch(e){}
    });

    loopBtn.addEventListener('click', ()=> setLoopUI(!state.loop));
    toggle.addEventListener('click', ()=> wrap.classList.toggle('collapsed'));

    reset.addEventListener('click', ()=>{
      try { global.allNotesOff && global.allNotesOff(); } catch(e){ console.warn(e); }
      const kb = document.querySelector(opts.keyboardSelector || '.keyboard') ||
                 document.querySelector('#keyboard') ||
                 document.querySelector('[data-keyboard]') || wrap;
      if (kb) { kb.classList.remove('pui-flash-once'); void kb.offsetWidth; kb.classList.add('pui-flash-once'); }
    });

    if (player && player.onEnded) {
      player.onEnded(()=>{ if (!state.loop) { setPlayUI(false); try { global.allNotesOff && global.allNotesOff(); } catch(e){} } });
    }

    // resize re-eval marquee
    let resizeRAF = 0;
    window.addEventListener('resize', ()=>{
      if (resizeRAF) cancelAnimationFrame(resizeRAF);
      resizeRAF = requestAnimationFrame(()=> applyMarquee(state.isPlaying));
    });

    // public API
    return {
      root: wrap,
      setTitle: (t)=> { setTitleText(t); applyMarquee(state.isPlaying); },
      setLoop: (on)=> setLoopUI(!!on),
      setPlaying: (on)=> {
        if (!player) return;
        if (on) { tryResumeAudio(); player.play && player.play(); setPlayUI(true); if (!state.raf) state.raf = requestAnimationFrame(updateTimeAndBar); }
        else    { player.pause && player.pause(); setPlayUI(false); }
      },
      collapse: ()=> wrap.classList.add('collapsed'),
      expand:   ()=> wrap.classList.remove('collapsed'),
      destroy:  ()=> { cancelAnimationFrame(state.raf); wrap.remove(); }
    };
  }

  // safe global attach
  var _g = (typeof globalThis !== 'undefined') ? globalThis
         : (typeof window !== 'undefined')     ? window
         : (typeof self !== 'undefined')       ? self
         : this;
  _g.PlayerUI = _g.PlayerUI || {};
  _g.PlayerUI.mount = mount;

})( (typeof window !== 'undefined') ? window
   : (typeof self !== 'undefined')   ? self
   : this );
