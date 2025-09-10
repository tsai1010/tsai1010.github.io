/*!
 * MIDI File Player UI -> handleInput({data}) or midi_synth.send([...])
 * - 優先呼叫 window.handleInput({ data: Uint8Array })
 * - 若無 handleInput，退回呼叫 window.midi_synth.send(bytes)
 * - 合併 Play/Pause；提供循環播放；Stop/Seek/Loop 時清理所有預約事件並三連 OFF（含關踏板）
 * - 內建 SMF 解析 (Format 0/1, PPQ, Tempo Map)
 * - 不自動掛載：請自行呼叫 MidiFilePlayerUI.mount(container)
 */

(function () {
  'use strict';

  // ===== Utilities =====
  const el = (tag, props = {}, children = []) => {
    const n = document.createElement(tag);
    Object.assign(n, props);
    for (const c of [].concat(children)) {
      if (typeof c === 'string') n.appendChild(document.createTextNode(c));
      else if (c) n.appendChild(c);
    }
    return n;
  };
  const pad2 = (n) => String(n).padStart(2, '0');
  const fmtTime = (ms) => {
    ms = Math.max(0, Math.floor(ms));
    const s = Math.floor(ms / 1000);
    return `${pad2(Math.floor(s / 60))}:${pad2(s % 60)}`;
  };

  // ===== Sink forwarding (handleInput -> midi_synth) =====
  function forward(bytes) {
    const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    if (typeof window.handleInput === 'function') {
      window.handleInput({ data: arr });
    } else if (window.midi_synth && typeof window.midi_synth.send === 'function') {
      window.midi_synth.send(arr);
    } else {
      // no sink, ignore
    }
  }

  // ===== Minimal SMF (.mid) Parser (Format 0/1, PPQ only) =====
  function parseSMF(arrayBuffer) {
    const data = new Uint8Array(arrayBuffer);
    let p = 0;
    const u32 = () => (data[p++] << 24) | (data[p++] << 16) | (data[p++] << 8) | data[p++];
    const u16 = () => (data[p++] << 8) | data[p++];
    const str = (n) => { const s = data.slice(p, p + n); p += n; return String.fromCharCode(...s); };
    const vlq = () => { let v = 0, b; do { b = data[p++]; v = (v << 7) | (b & 0x7f); } while (b & 0x80); return v; };

    if (str(4) !== 'MThd') throw new Error('Not a MIDI file');
    const hdrLen = u32();
    const format = u16(); // 0/1
    const ntrks = u16();
    const division = u16();
    if (division & 0x8000) throw new Error('SMPTE time division not supported');
    const ppq = division;
    if (hdrLen > 6) p += hdrLen - 6;

    const tempoMap = [{ tick: 0, usPerQN: 500000 }]; // 120 BPM
    const chanEvents = [];
    let totalTicks = 0;

    for (let t = 0; t < ntrks; t++) {
      if (str(4) !== 'MTrk') throw new Error('Bad track chunk');
      const len = u32();
      const end = p + len;

      let absTick = 0, runningStatus = 0;
      while (p < end) {
        const delta = vlq();
        absTick += delta;
        totalTicks = Math.max(totalTicks, absTick);

        let status = data[p++];
        if (status < 0x80) { p--; status = runningStatus; if (!status) throw new Error('Running status without status byte'); }
        else { runningStatus = status; }

        if (status === 0xFF) {
          const type = data[p++], l = vlq();
          if (type === 0x51 && l === 3) {
            const usPerQN = (data[p] << 16) | (data[p + 1] << 8) | data[p + 2];
            tempoMap.push({ tick: absTick, usPerQN });
          }
          p += l;
        } else if (status === 0xF0 || status === 0xF7) {
          const l = vlq(); p += l; // skip SysEx
        } else {
          const hi = status & 0xF0, lo = status & 0x0F;
          let d1 = data[p++], d2 = 0;
          if (hi !== 0xC0 && hi !== 0xD0) d2 = data[p++];
          if (hi === 0x90 && d2 === 0) chanEvents.push({ tick: absTick, bytes: [0x80 | lo, d1, 0] });
          else chanEvents.push({ tick: absTick, bytes: (hi === 0xC0 || hi === 0xD0) ? [status, d1] : [status, d1, d2] });
        }
      }
      if (p !== end) p = end;
    }

    chanEvents.sort((a, b) => a.tick - b.tick);
    tempoMap.sort((a, b) => a.tick - b.tick);
    if (tempoMap[0].tick !== 0) tempoMap.unshift({ tick: 0, usPerQN: 500000 });

    let accumMs = 0;
    for (let i = 0; i < tempoMap.length; i++) {
      const cur = tempoMap[i]; cur.accumMs = accumMs;
      const next = tempoMap[i + 1];
      if (next) {
        const dt = next.tick - cur.tick;
        accumMs += (dt / ppq) * (cur.usPerQN / 1000);
      }
    }
    const ticksToMs = (tick) => {
      let i = tempoMap.length - 1;
      while (i > 0 && tempoMap[i].tick > tick) i--;
      const seg = tempoMap[i];
      return seg.accumMs + ((tick - seg.tick) / ppq) * (seg.usPerQN / 1000);
    };

    const eventsMs = chanEvents.map(e => ({ t: ticksToMs(e.tick), bytes: e.bytes }));
    const durationMs = (() => {
      const last = tempoMap[tempoMap.length - 1];
      const tail = Math.max(0, (totalTicks - last.tick) / ppq * (last.usPerQN / 1000));
      const byTempoTail = last.accumMs + tail;
      const byEvents = eventsMs.length ? eventsMs[eventsMs.length - 1].t : 0;
      return Math.max(byTempoTail, byEvents);
    })();

    return { ppq, tempoMap, eventsMs, durationMs, totalTicks };
  }

  // ===== Scheduler with pending cancel + triple OFF =====
  function makePlayer() {
    let events = [];
    let duration = 0;
    let playing = false;
    let startPerf = 0;
    let offsetMs = 0;
    let nextIndex = 0;
    let lookahead = 120;
    let interval = 25;
    let schedTimer = null;
    let raf = null;

    // 新增：追蹤所有 setTimeout，與「回合」標記
    let pendingTimers = new Set();
    let session = 0;

    function resetState() {
      playing = false; startPerf = 0; offsetMs = 0; nextIndex = 0;
      clearInterval(schedTimer); schedTimer = null;
      cancelAnimationFrame(raf); raf = null;
    }
    function clearPending() {
      for (const id of pendingTimers) clearTimeout(id);
      pendingTimers.clear();
    }

    function drainAllOffBurst() {
      // 先關踏板（避免延音）
      for (let ch = 0; ch < 16; ch++) forward([0xB0 | ch, 64, 0]); // CC64=0
      const once = () => {
        for (let ch = 0; ch < 16; ch++) {
          forward([0xB0 | ch, 123, 0]); // All Notes Off
          forward([0xB0 | ch, 120, 0]); // All Sound Off
        }
      };
      once();
      setTimeout(once, 25);
      setTimeout(once, 120);
    }

    function scheduleWindow() {
      const nowPerf = performance.now();
      const playHeadMs = nowPerf - startPerf;
      const horizon = playHeadMs + lookahead;

      while (nextIndex < events.length && events[nextIndex].t - offsetMs <= horizon) {
        const ev = events[nextIndex++];
        const fireAt = startPerf + (ev.t - offsetMs);
        const mySession = session;
        const id = setTimeout(() => {
          pendingTimers.delete(id);
          if (mySession === session) forward(ev.bytes);
        }, Math.max(0, fireAt - performance.now()));
        pendingTimers.add(id);
      }

      if (playHeadMs + 1 >= (duration - offsetMs)) {
        if (loopEnabled) {
          clearPending(); session++;
          drainAllOffBurst();
          offsetMs = 0; nextIndex = 0; startPerf = performance.now();
          onTime?.(0, duration);
        } else {
          stop(false);
        }
      }
    }

    function start() {
      if (!events.length || playing) return;
      playing = true;
      startPerf = performance.now();
      schedTimer = setInterval(scheduleWindow, interval);
      const tick = () => {
        if (!playing) return;
        onTime?.(Math.min(duration, offsetMs + (performance.now() - startPerf)), duration);
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
      if (typeof window.playInput !== 'undefined') window.playInput = true;
      onState?.('play');
    }

    function pause() {
      if (!playing) return;
      offsetMs += performance.now() - startPerf;
      clearInterval(schedTimer); schedTimer = null;
      cancelAnimationFrame(raf); raf = null;
      clearPending(); session++;
      playing = false;
      if (typeof window.playInput !== 'undefined') window.playInput = false;
      onState?.('pause');
    }

    function stop(notify = true) {
      clearInterval(schedTimer); schedTimer = null;
      cancelAnimationFrame(raf); raf = null;
      clearPending(); session++;
      drainAllOffBurst();
      resetState();
      if (typeof window.playInput !== 'undefined') window.playInput = false;
      onTime?.(0, duration);
      if (notify) onState?.('stop');
    }

    function seek(ms) {
      ms = Math.max(0, Math.min(duration, ms));
      const wasPlaying = playing;
      if (wasPlaying) pause();
      clearPending(); session++;
      offsetMs = ms;
      nextIndex = 0;
      while (nextIndex < events.length && events[nextIndex].t < offsetMs) nextIndex++;
      onTime?.(offsetMs, duration);
      if (wasPlaying) start();
    }

    function setLoop(enabled) { loopEnabled = !!enabled; }
    let loopEnabled = false;

    let onTime = null, onState = null;

    return {
      load(parsed) {
        events = parsed.eventsMs;
        duration = Math.max(parsed.durationMs, events.length ? events[events.length - 1].t : 0);
        resetState(); onTime?.(0, duration);
      },
      play: start,
      pause,
      stop,
      seek,
      setLoop,
      onTime(fn) { onTime = fn; },
      onState(fn) { onState = fn; },
      getDuration() { return duration; },
      isPlaying() { return playing; },
      isLoop() { return loopEnabled; }
    };
  }

  // ===== UI =====
  function mountUI(container) {
    const root = el('div', { className: 'midi-ui-root', style: `
      font: 14px/1.4 system-ui, -apple-system, Segoe UI, Roboto, Noto Sans, Arial;
      color: #111; background: #fff; border:1px solid #e5e7eb; border-radius: 12px;
      box-shadow: 0 6px 24px rgba(0,0,0,.12); padding: 12px; width: 320px;
    `});
    const row = (gap=8) => el('div', { style: `display:flex; gap:${gap}px; align-items:center; flex-wrap:wrap;` });

    const file = el('input', { type: 'file', accept: '.mid,.midi', style: 'width:100%;' });
    const btnPlayPause = el('button', { textContent: '▶ Play', disabled: true, style: btnStyle() });
    const btnStop = el('button', { textContent: '⏹ Stop', disabled: true, style: btnStyle() });

    const loopWrap = row(6);
    const loopChk = el('input', { type: 'checkbox', id: 'mfp_loop' });
    const loopLbl = el('label', { htmlFor: 'mfp_loop', textContent: '循環播放', style: 'user-select:none;' });
    loopWrap.appendChild(loopChk); loopWrap.appendChild(loopLbl);

    const seek = el('input', { type: 'range', min: 0, max: 1000, value: 0, disabled: true, style: 'width:100%;' });
    const time = el('div', { textContent: '00:00 / 00:00', style: 'font-size:12px; color:#6b7280; text-align:right;' });
    const name = el('div', { textContent: '— 尚未載入檔案 —', style: 'font-size:12px; color:#374151; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;' });

    root.appendChild(row().appendChild(name).parentNode);
    root.appendChild(row().appendChild(file).parentNode);
    const ctrlRow = row(6); ctrlRow.appendChild(btnPlayPause); ctrlRow.appendChild(btnStop); ctrlRow.appendChild(loopWrap);
    root.appendChild(ctrlRow);
    root.appendChild(row().appendChild(seek).parentNode);
    root.appendChild(time);

    (container || document.body).appendChild(root);

    function btnStyle() {
      return `padding:8px 10px; background:#fff; border:1px solid #d1d5db; border-radius:8px; cursor:pointer; flex:1 1 120px`;
    }

    const player = makePlayer();
    let duration = 0;

    player.onTime((cur, dur) => {
      duration = dur;
      seek.disabled = !dur;
      seek.value = String(dur ? Math.floor((cur / dur) * 1000) : 0);
      time.textContent = `${fmtTime(cur)} / ${fmtTime(dur)}`;
    });

    player.onState((st) => {
      if (st === 'play') {
        btnPlayPause.textContent = '⏸ Pause';
        btnPlayPause.disabled = false;
        btnStop.disabled = false;
      } else if (st === 'pause') {
        btnPlayPause.textContent = '▶ Play';
        btnPlayPause.disabled = false;
        btnStop.disabled = false;
      } else if (st === 'stop') {
        btnPlayPause.textContent = '▶ Play';
        btnPlayPause.disabled = false;
        btnStop.disabled = true;
      }
    });

    async function loadFile(f) {
      name.textContent = f.name;
      const buf = await f.arrayBuffer();
      const parsed = parseSMF(buf);
      player.load(parsed);
      btnPlayPause.disabled = false;
      btnStop.disabled = true;
      seek.disabled = false;
    }

    file.addEventListener('change', async (e) => {
      const f = e.target.files?.[0];
      if (!f) return;
      try { await loadFile(f); } catch (err) {
        console.error(err);
        alert('解析 MIDI 檔失敗：' + err.message);
      }
    });

    btnPlayPause.addEventListener('click', () => {
      if (player.isPlaying()) player.pause();
      else player.play();
    });

    btnStop.addEventListener('click', () => player.stop());

    loopChk.addEventListener('change', () => {
      player.setLoop(loopChk.checked);
    });

    seek.addEventListener('input', () => {
      if (!duration) return;
      const pos = (Number(seek.value) / 1000) * duration;
      player.seek(pos);
    });

    return {
      player,
      elements: { root, file, btnPlayPause, btnStop, loopChk, seek, time, name }
    };
  }

  // Public API（不自動掛載）
  function mount(container) { try { return mountUI(container); } catch (e) { console.error('[midi-player] mount failed', e); } }
  window.MidiFilePlayerUI = { mount, parseSMF };
})();
