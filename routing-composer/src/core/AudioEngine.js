// routing-composer/src/core/AudioEngine.js
// -------------------------------------------------------------
// Handles all Web Audio graph building, node routing, and MIDI triggers.
// Connects dynamically to an external MidiSynth instance.
// -------------------------------------------------------------

import { generatePianoExcitation } from "./excitation.js";

export class AudioEngine {
  constructor(actx) {
    this.midiSynth = undefined;
    this.actx = actx || new (window.AudioContext || window.webkitAudioContext)();

    this.masterGain = this.actx.createGain();
    this.masterGain.gain.value = 0.9;
    this.masterGain.connect(this.actx.destination);

    this.analyser = this.actx.createAnalyser();
    this.analyser.fftSize = 2048;

    this.liveNodes = new Map(); // all active WebAudio nodes per chain

    this.irBuffers = new Map(); // key: irId, value: AudioBuffer

    this.chainMuteStates = new Map();
    

    // ★ 新增：每個 channel 共用一顆 ConstantSource 做 bend（單位：cents）
    this._bendCS = Object.create(null);

    this.liveNodes = new Map();
    // 每個 channel 各自有一顆 mixer
    this.mixers = Array.from({ length: 16 }, () => {
        const g = this.actx.createGain();
        g.gain.value = 1.0;
        return g;
    });

    // mixer -> chvol
    setTimeout(() => {
    if (this.midiSynth?.chvol) {
        for (let ch = 0; ch < 16; ch++) {
            try {
                this.mixers[ch].connect(this.midiSynth.chvol[ch]);
                console.log(`[RC] mixer[ch${ch}] -> chvol[ch${ch}]`);
            } catch (e) {
                console.warn(`[RC] mixer[ch${ch}] connect failed`, e);
            }
        }
    }
    }, 1000);

    // 🔄 自動監看狀態，防止被暫停
    setInterval(() => {
        try {
            if (this.actx?.state === "suspended") this.actx.resume();
            if (this.midiSynth?.actx?.state === "suspended") this.midiSynth.actx.resume();
        } catch {}
    }, 2000);

  }

  setIRBuffer(irId, audioBuffer) {
        console.log("[RC][IR] register IR buffer:", irId, audioBuffer);
        this.irBuffers.set(String(irId), audioBuffer);
    }

  updateGainNodeById(id, value) {
    const node = this.liveNodes?.get(id + ":node");
    if (!node || !node.gain) return false;
    const now = this.actx.currentTime;
    try {
        node.gain.cancelScheduledValues(now);
        node.gain.setTargetAtTime(Number(value) || 0, now, 0.01); // 10ms 平滑
    } catch {
        node.gain.value = Number(value) || 0;
    }
    return true;
  }


  /** 取得/建立此 channel 的 bend ConstantSource（單位：cents） */
  getBendNode(ch) {
    // ★ 防呆：確保容器存在
    if (!this._bendCS) this._bendCS = Object.create(null);

    // 正規化 channel
    ch = (ch | 0) & 0x0f;

    // 若已存在直接回傳
    if (this._bendCS[ch]) return this._bendCS[ch];

    // 建立並啟動 ConstantSource
    const cs = this.actx.createConstantSource();
    cs.offset.value = 0; // 初始 0 cent
    cs.start();
    this._bendCS[ch] = cs;
    return cs;
  }

    /** 更新某 channel 的 bend（單位：cents），立刻影響所有連上的 voices */
  updateBend(ch, cents) {
    if (!this._bendCS) this._bendCS = Object.create(null);
    ch = (ch | 0) & 0x0f;

    const cs = this.getBendNode(ch);
    const v = Number.isFinite(cents) ? cents : 0;

    // 直接設值；若要更平滑可改用 setTargetAtTime
    try {
        const now = this.actx.currentTime;
        cs.offset.cancelScheduledValues(now);
        cs.offset.setTargetAtTime(v, now, 0.01); // 10ms 平滑
    } catch {
        // 退而求其次
        cs.offset.value = v;
    }
  }

  // --------------------------------------------------------------------
  // Attach to external synth (adopt its AudioContext if needed)
  // --------------------------------------------------------------------
  setMidiSynth(obj) {
    this.midiSynth = obj;
    const extCtx = obj && (obj.actx || obj.audioContext);

    // 若外部有提供 context 且不同於現在，就切換過去
    if (extCtx && extCtx !== this.actx) {
        // 1) 斷開舊 graph
        try { this.masterGain?.disconnect(); } catch {}

        // 2) 採用外部 context
        this.actx = extCtx;

        // 3) 用新 context 重建所有 context 綁定的 node
        this.masterGain = this.actx.createGain();
        this.masterGain.gain.value = 0.9;
        this.masterGain.connect(this.actx.destination);

        this.analyser = this.actx.createAnalyser();
        this.analyser.fftSize = 2048;

        // 重新建立每個 channel 的 mixer（新的 context）
        this.mixers = Array.from({ length: 16 }, () => {
            const g = this.actx.createGain();
            g.gain.value = 1.0;
            return g;
        });

        console.log('[RC] adopted synth AudioContext and rebuilt mixers');
    }

    // 4) 重新把 mixers 接回 synth 的 chvol（同一 context 了）
    if (obj?.chvol && this.mixers) {
        for (let ch = 0; ch < 16; ch++) {
            try {
                // 先保守地斷開再接
                try { this.mixers[ch].disconnect(); } catch {}
                this.mixers[ch].connect(obj.chvol[ch]);
            } catch (e) {
                console.warn(`[RC] mixer[ch${ch}] -> chvol connect failed`, e);
            }
        }
    }
  }

  async resume() {
    if (this.actx.state !== 'running') await this.actx.resume();
    try {
      if (this.midiSynth?.actx?.state !== 'running') {
        await this.midiSynth.actx.resume();
      }
    } catch {}
  }

  // --------------------------------------------------------------------
  // build(chain) — Build a single chain of modules into WebAudio graph
  // --------------------------------------------------------------------
  build(chain, chainIdx = 0) {
    this.liveNodes.clear();

    const createNode = (mod) => {
        const k = mod.kind;
        const p = mod.params || {};
        const ctx = this.actx;

        // bypassed module → transparent Gain
        if (!mod.enabled) {
            const g = ctx.createGain();
            return { in: g, out: g };
        }

        switch (k) {
            // === KS source ===
            case "ks_source": {
                const out = ctx.createGain();
                // 把此 KS 的輸出與參數記錄到 liveNodes
                this.liveNodes.set(mod.id + ":ksOut", out);
                this.liveNodes.set(mod.id + ":ksParams", p);
                this.liveNodes.set(mod.id + ":chainIdx", chainIdx | 0);
                this.liveNodes.set("__lastKsId__", mod.id);
                this.liveNodes.set("keyboardTarget", out);
                return { in: out, out: out };
            }

            // === basic oscillator source ===
            case "source": {
                const osc = ctx.createOscillator();
                osc.type = p.type || "sawtooth";
                const env = ctx.createGain();
                env.gain.value = 0;
                osc.connect(env);
                osc.start();

                // 為 noteOn 時可用 frequency.setValueAtTime()
                this.liveNodes.set(mod.id + ":osc", osc);
                this.liveNodes.set(mod.id + ":env", env);
                this.liveNodes.set(mod.id + ":oscType", osc.type);  // ← 新增
                this.liveNodes.set(mod.id + ":ch", (p.ch ?? "all")); // 目標 ch
                this.liveNodes.set(mod.id + ":adsr", (p.adsr || { a:0.003,d:0.08,s:0.4,r:0.2 })); // ADSR
                this.liveNodes.set(mod.id + ":level", 
                    Number.isFinite(p.level) ? p.level : 0.15
                );
                this.liveNodes.set("__oscType__", osc.type);        // ← 新增（給 gate() 快速取）
                this.liveNodes.set("keyboardTarget", env);
                return { in: env, out: env };
            }

            case "gain": {
                const g = this.actx.createGain();
                g.gain.value = Number(p.gain ?? 1.0);
                this.liveNodes.set(mod.id + ":node", g);
                return { in: g, out: g };
            }

            case "filter": {
                const biq = ctx.createBiquadFilter();
                biq.type = p.mode || "lowpass";
                biq.frequency.value = Number(p.freq || 1200);
                biq.Q.value = Number(p.q || 0.7);
                this.liveNodes.set(mod.id + ":node", biq);
                return { in: biq, out: biq };
            }

            case "delay": {
                const d = ctx.createDelay(2);
                d.delayTime.value = Number(p.time || 0.25);
                const fb = ctx.createGain();
                fb.gain.value = Number(p.feedback || 0.3);
                const mix = ctx.createGain();
                mix.gain.value = Number(p.mix || 0.3);

                const input = ctx.createGain();
                const output = ctx.createGain();
                const dry = ctx.createGain();
                dry.gain.value = 1 - mix.gain.value;

                input.connect(d);
                input.connect(dry);
                d.connect(fb).connect(d);
                d.connect(mix);
                dry.connect(output);
                mix.connect(output);

                this.liveNodes.set(mod.id + ":node", { input, output, delay: d, fb, mix });
                return { in: input, out: output };
            }

            case "convolver_ir": {
                const conv = ctx.createConvolver();

                const wet = ctx.createGain();
                const dry = ctx.createGain();
                const out = ctx.createGain();

                const input = ctx.createGain();

                const mix = Math.max(0, Math.min(1, Number(p.mix ?? 0.3)));
                wet.gain.value = mix;
                dry.gain.value = 1 - mix;

                const irId = String(p.irId ?? "IR_Gibson");

                // === DEBUG LOG 1：build 時看到的參數 ===
                console.log("[RC][IR] build convolver_ir", {
                    chain: chainIdx,
                    modId: mod.id,
                    irId,
                    mix,
                });

                // === DEBUG LOG 2：目前 AudioEngine 註冊了哪些 IR ===
                if (!this.irBuffers || this.irBuffers.size === 0) {
                    console.warn("[RC][IR] irBuffers is empty");
                } else {
                    console.log(
                    "[RC][IR] available IR buffers:",
                    Array.from(this.irBuffers.keys())
                    );
                }

                const buf = this.irBuffers && this.irBuffers.get(irId);

                // === DEBUG LOG 3：是否真的拿到 AudioBuffer ===
                if (!buf) {
                    console.warn("[RC][IR] IR buffer NOT found for", irId);
                } else {
                    console.log("[RC][IR] IR buffer found:", irId, {
                    length: buf.length,
                    sampleRate: buf.sampleRate,
                    duration: buf.duration,
                    });
                    conv.buffer = buf; // ✅ 真正掛上 IR
                }

                // routing
                input.connect(dry);
                dry.connect(out);

                input.connect(conv);
                conv.connect(wet);
                wet.connect(out);

                // 存起來（方便之後即時調整或 debug）
                this.liveNodes.set(mod.id + ":conv", conv);
                this.liveNodes.set(mod.id + ":wet", wet);
                this.liveNodes.set(mod.id + ":dry", dry);

                return { in: input, out };
            }



            case "analyzer": {
                const tap = ctx.createGain();
                tap.connect(this.analyser);
                this.liveNodes.set(mod.id + ":node", tap);
                return { in: tap, out: tap };
            }

            default: {
                const pass = ctx.createGain();
                return { in: pass, out: pass };
            }
        }
    };


    // connect modules sequentially
    let head = null, tail = null;
    for (const m of chain) {
      const { in: ni, out: no } = createNode(m);
      if (!head) head = ni;
      if (tail) tail.connect(ni);
      tail = no;
    }

    if (head) {
        this.liveNodes.set("__chainHead__", head);
    }
    if (tail) {
        this.liveNodes.set("__chainTail__", tail);
    }

    // 把每條 chain 的尾巴接到該 channel 的 mixer
    try {
        if (!tail) return;

        // 為這條 chain 建一顆 gain（用來做 mute）
        const chainId = chainIdx | 0;
        const chainGain = this.actx.createGain();
        chainGain.gain.value = 1.0;
        this.liveNodes.set(`chainGain:${chainId}`, chainGain);

        tail.connect(chainGain);

        const p = chain.find(m => m.kind === "ks_source" || m.kind === "source");
        const chSel = (p?.params?.ch ?? "all");
        const channels =
          (chSel === "all")
            ? Array.from({ length: 16 }, (_, i) => i)
            : [Number(chSel)];

        for (const ch of channels) {
            const mix = this.mixers[ch];
            if (mix) {
              chainGain.connect(mix);
            }
        }
    } catch (e) {
        console.warn("[RC] mixer connect failed", e);
    }

    // if (tail && m.kind === "gain") {
    //     tail.connect(this.mixers[ch]); // 最後的 gain → mixer
    // }

    
  }

  // --------------------------------------------------------------------
  // buildMany — For multiple chains
  // --------------------------------------------------------------------
  buildMany(chains) {
    const prev = this.liveNodes;
    // 把目前還在發聲的 fallback osc voice map（給 gate 的 noteOff 用）先暫存
    const oscVoices = prev.get("__oscVoices__");

    // ✅ 新增：也保留 KS 的 voice map
    const ksVoices  = prev.get("__ksVoices__");

    const merged = new Map();  // 不再從 prev 開始

    chains.forEach((chain, idx) => {
      const temp = new Map();
      this.liveNodes = temp;
      this.build(chain, idx);   // 傳 chainIdx 進去

      for (const [k, v] of temp.entries()) {
        merged.set(k, v);
      }
    });

    // 把還在發聲的 fallback voices 放回去（可有可無，不留也只是有時候 noteOff 找不到它們而已）
    if (oscVoices) {
      merged.set("__oscVoices__", oscVoices);
    }

    // ✅ 新增：把 KS voices 也放回來
    if (ksVoices)  merged.set("__ksVoices__", ksVoices);

    this.liveNodes = merged;

    // ⭐ 重套 mute 狀態（避免 rebuild 後狀態跑掉）
    if (this.chainMuteStates) {
        const now = this.actx.currentTime;

        for (const [idx, muted] of this.chainMuteStates.entries()) {
            const g = this.liveNodes.get(`chainGain:${idx}`);
            if (g?.gain) {
                const v = muted ? 0 : 1;
                g.gain.cancelScheduledValues(now);
                g.gain.value = v;
                g.gain.setValueAtTime(v, now);
            }
        }
    }
  }


  setChainMute(chainIdx, muted) {
        try {
            const id = chainIdx | 0;
            const key = `chainGain:${id}`;
            const g = this.liveNodes && this.liveNodes.get(key);

            // ⭐ 真正狀態來源（不要再靠 gain.value）
            if (!this.chainMuteStates) this.chainMuteStates = new Map();
            this.chainMuteStates.set(id, !!muted);

            if (!g || !g.gain) {
                console.warn("[RC] setChainMute: chainGain not found", key);
                return false;
            }

            const now = this.actx.currentTime;

            // 清掉 automation
            g.gain.cancelScheduledValues(now);

            const v = muted ? 0.0 : 1.0;

            // ⭐ 雙寫，避免 value / automation 不一致
            g.gain.value = v;
            g.gain.setValueAtTime(v, now);

            return true;
        } catch (e) {
            console.warn("[RC] setChainMute failed", chainIdx, e);
            return false;
        }
    }


  // --------------------------------------------------------------------
  // MIDI Note Handling
  // --------------------------------------------------------------------
  gate(on, velocity = 0.8, ch = 0, note = 69) {
    const now = this.actx.currentTime;
    const nn  = (note == null ? 69 : note) | 0;

    // === 1️⃣ Note On：先試 KS + GUI 內的 source（gateOsc）===
    let triggered = false;

    if (on) {
      const ksOk  = this.pluckKS(ch, note == null ? 69 : note, velocity) === true;
      const oscOk = this.gateOsc(ch, note, velocity) === true;
      triggered   = ksOk || oscOk;
    }

    // === 2️⃣ 如果 KS + gateOsc 都沒命中，再用舊的 fallback 動態 OSC ===
    //     （這一段只有在沒有任何 GUI module 可以處理時才會跑）
    if (on && !triggered) {
      const a4 = (this.midiSynth && typeof this.midiSynth.a4_freq === "number")
        ? this.midiSynth.a4_freq
        : 440;
      const f = a4 * Math.pow(2, (nn - 69) / 12);

      // 掃描所有 source module，挑出 ch 符合的
      const sources = [];
      for (const [k, v] of this.liveNodes.entries()) {
        if (k.endsWith(":oscType")) {
          const modId = k.split(":")[0];
          const chSel = this.liveNodes.get(modId + ":ch") ?? "all";
          const adsr  = this.liveNodes.get(modId + ":adsr") || { a: 0.003, d: 0.08, s: 0.4, r: 0.2 };
          const type  = v || "sawtooth";
          const chOK  = (chSel === "all") || (Number(chSel) === ch);
          if (chOK) sources.push({ modId, type, adsr });
        }
      }

      // 若沒有任何 source 符合，就直接不出聲（不再使用預設 fallback OSC）
      if (!sources.length) {
        return;
      }

      const tail  = this.liveNodes.get("__chainTail__");
      const head  = this.liveNodes.get("__chainHead__");
      const kbt   = this.liveNodes.get("keyboardTarget");
      const chVol = this.midiSynth?.chvol?.[ch];

      // 確保 voice map：按 channel 分組
      if (!this.liveNodes.has("__oscVoices__")) this.liveNodes.set("__oscVoices__", {});
      const voicesByCh = this.liveNodes.get("__oscVoices__");
      if (!voicesByCh[ch]) voicesByCh[ch] = {};

      for (const src of sources) {
        const osc = this.actx.createOscillator();
        try { osc.type = src.type; } catch { osc.type = "sawtooth"; }
        osc.frequency.setValueAtTime(f, now);

        // modulation & pitch bend
        try {
          const modNode = this.midiSynth?.chmod?.[ch];
          if (modNode && osc.detune) modNode.connect(osc.detune);

          const bendCS = this.getBendNode(ch);
          if (osc.detune && bendCS) bendCS.connect(osc.detune);

          if (typeof this.midiSynth?.bend?.[ch] === "number") {
            this.updateBend(ch, this.midiSynth.bend[ch]);
          }
        } catch (e) {
          console.warn("[RC] osc detune connect failed", e);
        }

        const env = this.actx.createGain();
        env.gain.setValueAtTime(0, now);

        // 使用該 source 的 ADSR
        const { a, d, s, r } = src.adsr;
        env.gain.linearRampToValueAtTime(velocity, now + (a ?? 0.003));
        env.gain.linearRampToValueAtTime(
          (s ?? 0.4) * velocity,
          now + (a ?? 0.003) + (d ?? 0.08)
        );

        osc.connect(env);

        // 避免把聲音塞進關著的 keyboardTarget，優先 tail → 再 head → 再 chvol
        let inject = null;
        if (head && head !== kbt) inject = head;
        else if (tail)           inject = tail;
        else if (chVol)          inject = chVol;
        if (!inject && chVol)    inject = chVol;

        if (inject) {
          env.connect(inject);
        }

        osc.start(now);

        // 以 ch 分組、每顆 voice 有自己的 id（支援同 note 疊音）
        const vid = `${nn}_${performance.now().toFixed(1)}_${Math.random()
          .toString(36)
          .slice(2, 5)}`;
        voicesByCh[ch][vid] = { note: nn, osc, env, r: (r ?? 0.2) };
      }
    }

    // === 3️⃣ Note Off：KS + OSC ===
    if (!on) {
        const now2 = this.actx.currentTime;

        // --------------------------------------------------
        //  KS 先處理（含延音 pedal）
        // --------------------------------------------------

        const ksVoicesByCh = this.liveNodes.get("__ksVoices__");
        const sustainOn = (this.midiSynth?.pedal?.[ch] ?? 0) >= 64;

        if (ksVoicesByCh && ksVoicesByCh[ch]) {
            const entriesKS = Object.entries(ksVoicesByCh[ch]).filter(
                ([id, v]) => v.note === nn
            );

            for (const [id, v] of entriesKS) {
                const { bfs, env } = v;

                // ⭐ 踏板按著：不 release，只做標記
                if (sustainOn) {
                    v.sustained = true;
                    continue;
                }

                // ⭐ 沒踩踏板 → 正常 KS release
                try {
                    const relCtrl = Number(v.params?.ksRelease ?? 0.5);
                    const minR = 0.02;
                    const maxR = 1.5;
                    const rKs = minR + (maxR - minR) * Math.pow(relCtrl, 2.0);

                    env.gain.cancelScheduledValues(now2);
                    env.gain.setValueAtTime(env.gain.value ?? 1, now2);
                    env.gain.linearRampToValueAtTime(0, now2 + rKs);

                    bfs.stop(now2 + rKs + 0.05);

                    setTimeout(() => {
                        try {
                            bfs.disconnect();
                            env.disconnect();
                        } catch {}
                        delete ksVoicesByCh[ch][id];
                    }, (rKs + 0.05) * 1000);

                } catch (e) {
                    delete ksVoicesByCh[ch][id];
                }
            }
        }

        // --------------------------------------------------
        //  OSC：你的原本 fallback poly osc 的收尾
        // --------------------------------------------------

        // const voicesByCh = this.liveNodes.get("__oscVoices__");
        // if (!voicesByCh || !voicesByCh[ch]) return;

        // const entries = Object.entries(voicesByCh[ch]).filter(
        //     ([id, v]) => v.note === nn
        // );

        // for (const [id, v] of entries) {
        //     const { osc, env, r = 0.2 } = v;
        //     try {
        //         env.gain.cancelScheduledValues(now2);
        //         env.gain.setValueAtTime(env.gain.value ?? 0, now2);
        //         env.gain.linearRampToValueAtTime(0, now2 + r);
        //         osc.stop(now2 + r + 0.05);

        //         setTimeout(() => {
        //             try { osc.disconnect(); env.disconnect(); } catch {}
        //             delete voicesByCh[ch][id];
        //         }, (r + 0.1) * 1000);

        //     } catch (e) {
        //         delete voicesByCh[ch][id];
        //     }
        // }

        // --------------------------------------------------
        //  OSC：統一交給 releaseOsc()
        // --------------------------------------------------
        this.releaseSourceEnv(ch, nn);
        this.releaseOsc(ch, nn);
        return;
    }

  }



  

  // --------------------------------------------------------------------
  // Karplus-Strong trigger — uses midi_synth.asmWrapper[ch].pluck
  // --------------------------------------------------------------------

  pluckKS(ch, note, velocity) {
    const allKs = Array.from(this.liveNodes.entries()).filter(([k]) => k.endsWith(":ksOut"));
    if (!allKs.length) return false;

    const curPg = Number(this.midiSynth && this.midiSynth.pg ? this.midiSynth.pg[ch] : 0);

    // ✅ 收集所有「符合 ch/pg 且未 mute」的 ks_source
    const matches = [];
    for (const [k, outNode] of allKs) {
        const modId = k.replace(":ksOut", "");
        const p = this.liveNodes.get(modId + ":ksParams") || {};

        // ch match
        const mch = p.ch != null ? String(p.ch) : "all";
        const chMatch = (mch === "all") || (Number(mch) === ch);

        // program match
        let progParam = p.program;
        if (progParam === undefined || progParam === null || progParam === "all") progParam = "all";
        const prog = progParam === "all" ? null : Number(progParam);
        const pgMatch = (prog === null) || (prog === curPg);

        if (!(chMatch && pgMatch)) continue;

        // ✅ mute chain 不參與
        const chainIdx = (this.liveNodes.get(modId + ":chainIdx") ?? -1) | 0;
        if (chainIdx >= 0) {
            const muted = !!this.chainMuteStates?.get(chainIdx);
            if (muted) continue;
        }

        matches.push({ modId, outNode, params: p });
    }

    if (!matches.length) {
        return false;
    }

    const now = this.actx.currentTime;
    const a4 = (this.midiSynth && typeof this.midiSynth.a4_freq === "number")
        ? this.midiSynth.a4_freq
        : 440;
    const f = a4 * Math.pow(2, (note - 69) / 12);
    const sr = this.actx.sampleRate;

    // KS voice registry（讓 noteOff / sustain release 用）
    if (!this.liveNodes.has("__ksVoices__")) this.liveNodes.set("__ksVoices__", {});
    const ksVoicesByCh = this.liveNodes.get("__ksVoices__");
    if (!ksVoicesByCh[ch]) ksVoicesByCh[ch] = {};

    // ✅ 確保 bfSet 容器存在（給 MidiSynthCore.setBend 用）
    try {
        if (!this.midiSynth.bfSet) this.midiSynth.bfSet = {};
        if (!this.midiSynth.bfSet[ch]) this.midiSynth.bfSet[ch] = {};
    } catch {}

    let any = false;

    for (const m of matches) {
        const params = m.params || {};

        // === seed noise ===
        let seed = null;
        try {
            const type = String(params.seedNoiseType ?? "pink");
            const len = Math.max(2048, Math.round(sr / Math.max(1e-6, f)));

            const makeWhite = (L) => {
                const out = new Float32Array(L);
                for (let i = 0; i < L; i++) out[i] = Math.random() * 2 - 1;
                return out;
            };

            const makePink = (L) => {
                const out = new Float32Array(L);
                let b0=0,b1=0,b2=0,b3=0,b4=0,b5=0,b6=0;
                for (let i=0;i<L;i++){
                    const w = Math.random()*2-1;
                    b0 = 0.99886*b0 + w*0.0555179;
                    b1 = 0.99332*b1 + w*0.0750759;
                    b2 = 0.969  *b2 + w*0.153852;
                    b3 = 0.8665 *b3 + w*0.3104856;
                    b4 = 0.55   *b4 + w*0.5329522;
                    b5 = -0.7616*b5 - w*0.016898;
                    out[i] = (b0+b1+b2+b3+b4+b5+b6*0.5362)*0.11;
                    b6 = w*0.115926;
                }
                return out;
            };

            const makeBrown = (L) => {
                const out = new Float32Array(L);
                let acc = 0;
                for (let i = 0; i < L; i++) {
                    acc += Math.random()*2 - 1;
                    acc = Math.max(-8, Math.min(8, acc));
                    out[i] = acc / 8;
                }
                return out;
            };

            const makeGrey = (L) => {
                const w = makeWhite(L);
                const p = makePink(L);
                const out = new Float32Array(L);
                for (let i = 0; i < L; i++) out[i] = 0.6 * w[i] + 0.4 * p[i];
                return out;
            };

            const makeRed = (L) => {
                const out = new Float32Array(L);
                let x = 0, y = 0;
                for (let i = 0; i < L; i++) {
                    x += (Math.random()*2 - 1) * 0.02;
                    y += x;
                    out[i] = y * 0.0005;
                }
                return out;
            };

            const makeBlue = (L) => {
                const tmp = new Float32Array(L);
                let last = 0;
                for (let i = 0; i < L; i++) {
                    const w = Math.random()*2 - 1;
                    tmp[i] = w - last;
                    last = w;
                }
                const out = new Float32Array(L);
                let lp = 0;
                for (let i = 0; i < L; i++) {
                    lp = lp * 0.992 + tmp[i] * 0.008;
                    out[i] = lp;
                }
                return out;
            };

            const makeViolet = (L) => {
                const tmp = new Float32Array(L);
                let last = 0;
                for (let i = 0; i < L; i++) {
                    const w = Math.random()*2 - 1;
                    tmp[i] = w - last;
                    last = w;
                }
                const out = new Float32Array(L);
                let lp = 0;
                for (let i = 0; i < L; i++) {
                    lp = lp * 0.995 + tmp[i] * 0.005;
                    out[i] = lp;
                }
                return out;
            };

            const makeSoftBrown = (L) => {
                const brown = makeBrown(L);
                const out = new Float32Array(L);
                let lp = 0;
                for (let i = 0; i < L; i++) {
                    lp = lp * 0.995 + brown[i] * 0.005;
                    out[i] = lp * 0.9;
                }
                return out;
            };

            const makeSoftPink = (L) => {
                const pink = makePink(L);
                const out = new Float32Array(L);
                let lp = 0;
                for (let i = 0; i < L; i++) {
                    lp = lp * 0.993 + pink[i] * 0.007;
                    out[i] = lp * 0.9;
                }
                return out;
            };

            const makeWind = (L) => {
                const out = new Float32Array(L);
                let lp = 0;
                let env = 0;
                for (let i = 0; i < L; i++) {
                    const w = Math.random()*2 - 1;
                    lp = lp * 0.985 + w * 0.015;
                    env = env * 0.995 + (Math.random()*2 - 1) * 0.005;
                    const e = 0.6 + 0.4 * env;
                    out[i] = lp * e;
                }
                return out;
            };

            const makePerlin = (L) => {
                const out = new Float32Array(L);
                const seg = Math.max(8, Math.floor(L / 64));
                const points = [];
                const nPoints = Math.floor(L / seg) + 2;
                for (let i = 0; i < nPoints; i++) points[i] = Math.random()*2 - 1;
                const fade = (t) => t*t*t*(t*(t*6 - 15) + 10);
                for (let i = 0; i < L; i++) {
                    const x = i / seg;
                    const i0 = Math.floor(x);
                    const t = x - i0;
                    const a = points[i0];
                    const b = points[i0+1];
                    const ft = fade(t);
                    out[i] = (a*(1-ft) + b*ft) * 0.9;
                }
                return out;
            };

            const makeFormant = (L) => {
                const out = new Float32Array(L);
                const base = makeWhite(L);
                const f1 = 300, f2 = 800, f3 = 2500;
                for (let i = 0; i < L; i++) {
                    const t = i / sr;
                    const mm =
                        1.0
                        + 0.6 * Math.sin(2 * Math.PI * f1 * t)
                        + 0.4 * Math.sin(2 * Math.PI * f2 * t + 1.3)
                        + 0.25 * Math.sin(2 * Math.PI * f3 * t + 0.7);
                    out[i] = base[i] * (mm * 0.25);
                }
                return out;
            };

            const makeDust = (L) => {
                const out = new Float32Array(L);
                let current = 0;
                const p = 0.004;
                for (let i = 0; i < L; i++) {
                    if (Math.random() < p) current += (Math.random() * 2 - 1) * 0.9;
                    current *= 0.96;
                    out[i] = current;
                }
                return out;
            };

            const makeWood = (L) => {
                const base = makeSoftPink(L);
                const out = new Float32Array(L);
                const fLow = 220;
                const fMid = 550;
                for (let i = 0; i < L; i++) {
                    const t = i / sr;
                    const tone =
                        0.5 * Math.sin(2*Math.PI*fLow*t) +
                        0.35 * Math.sin(2*Math.PI*fMid*t + 1.1);
                    out[i] = base[i] * (1.0 + 0.4 * tone);
                }
                return out;
            };

            if (type === "piano") {
                const pianoExc = generatePianoExcitation({
                    freq: f,
                    velocity,
                    sampleRate: sr,

                    // 先保守一點，之後再微調
                    tonalGain: 1.0,
                    noiseGain: 1.0,

                    tonalOptions: {
                    gain: 0.25,
                    attackMs: 2,
                    cycles: 8,
                    },

                    noiseOptions: {
                    gain: 1.0,
                    attackWindowMs: 2,
                    },

                    maxDurationSec: 0.08,
                    minDurationSec: 0.004,
                });

                seed = new Float32Array(len);

                // excitation 比 len 短就補 0；比 len 長就截掉
                const copyLen = Math.min(len, pianoExc.length);
                seed.set(pianoExc.subarray(0, copyLen), 0);
            }
            else{
                switch (type) {
                    case "white":      seed = makeWhite(len); break;
                    case "pink":       seed = makePink(len); break;
                    case "brown":      seed = makeBrown(len); break;
                    case "softBrown":  seed = makeSoftBrown(len); break;
                    case "softPink":   seed = makeSoftPink(len); break;
                    case "red":        seed = makeRed(len); break;
                    case "blue":       seed = makeBlue(len); break;
                    case "violet":     seed = makeViolet(len); break;
                    case "gray":       seed = makeGrey(len); break;
                    case "wind":       seed = makeWind(len); break;
                    case "perlin":     seed = makePerlin(len); break;
                    case "formant":    seed = makeFormant(len); break;
                    case "dust":       seed = makeDust(len); break;
                    case "wood":       seed = makeWood(len); break;
                    default:           seed = makePink(len); break;
                }
            }

            

        } catch (e) {
            console.warn("[RC] seed generation failed, fallback pink", e);
            const fallbackLen = 2048;
            seed = new Float32Array(fallbackLen);
            for (let i = 0; i < fallbackLen; i++) seed[i] = Math.random()*2 - 1;
        }

        // dur
        let durSec = Number(params.ksDurSec);
        if (!Number.isFinite(durSec)) durSec = 1.0;
        durSec = Math.min(Math.max(durSec, 0.1), 10.0);

        const frames = Math.round(sr * durSec);
        const bf = this.actx.createBuffer(2, frames, sr);

        // smoothing
        const mode = String(params.smoothingMode ?? "auto");
        const opts = this.midiSynth?.options?.[ch] ?? {};
        let smoothingFactor;

        if (mode === "manual") {
            let s = Number(params.smoothingFactor);
            if (!Number.isFinite(s)) s = 0.2;
            if (s < 0.01) s = 0.01;
            if (s > 0.99) s = 0.99;
            smoothingFactor = s;
        } else {
            try {
                const inv127 = this.midiSynth?.inv127 ?? (1 / 127);
                const nn = Math.pow(note / 64, 0.5) || 0;
                let stringDamping = (note * inv127) * 0.85 + 0.15;
                if (typeof opts.stringDamping === "number") {
                    stringDamping = opts.stringDamping;
                } else if (this.midiSynth?.options?.[ch]) {
                    this.midiSynth.options[ch].stringDamping = stringDamping;
                }
                const varAmt = Number(opts.stringDampingVariation ?? 0);
                smoothingFactor =
                    stringDamping +
                    nn * (1 - stringDamping) * 0.5 +
                    (1 - stringDamping) * Math.random() * varAmt;
            } catch {
                smoothingFactor = 0.2;
            }
        }
        if (!Number.isFinite(smoothingFactor)) smoothingFactor = 0.2;

        const velScale = Number(params.velScale == null ? 1 : params.velScale);

        // asm pluck
        try {
            const aw = this.midiSynth?.asmWrapper?.[ch];
            if (aw && typeof aw.pluck === "function") {
                aw.pluck(
                    bf,
                    seed,
                    sr,
                    f,
                    smoothingFactor,
                    velocity * velScale,
                    opts,
                    0.2
                );
            }
        } catch (e) {
            console.warn("[RC] pluck error", e);
            continue;
        }

        // BufferSource + env
        const bfs = this.actx.createBufferSource();
        bfs.buffer = bf;

        // modulation + pitch bend（✅ 改成持續追蹤）
        try {
            const modNode = this.midiSynth?.chmod?.[ch];
            if (modNode && bfs.detune) modNode.connect(bfs.detune);
        } catch (e) {
            console.warn("[RC] mod connect failed", e);
        }

        try {
            const bendCS = this.getBendNode(ch);
            if (bfs.detune && bendCS) bendCS.connect(bfs.detune);

            if (typeof this.midiSynth?.bend?.[ch] === "number") {
                this.updateBend(ch, this.midiSynth.bend[ch]);
            }
        } catch (e) {
            console.warn("[RC] bend connect failed", e);
        }

        const env = this.actx.createGain();
        env.gain.setValueAtTime(1, now);

        const voiceId =
            `${m.modId}_${note}_${performance.now().toFixed(1)}_${Math.random().toString(36).slice(2, 5)}`;

        ksVoicesByCh[ch][voiceId] = {
            note,
            bfs,
            env,
            params,
            sustained: false
        };

        // ✅ 註冊回 MidiSynthCore 的 bfSet，讓 core setBend 也能掃到
        try {
            this.midiSynth.bfSet[ch][note] = bfs;
        } catch {}

        bfs.addEventListener("ended", () => {
            try {
                if (this.midiSynth?.bfSet?.[ch]?.[note] === bfs) {
                    this.midiSynth.bfSet[ch][note] = null;
                }
            } catch {}

            try {
                const map = this.liveNodes.get("__ksVoices__");
                if (map && map[ch] && map[ch][voiceId]) {
                    delete map[ch][voiceId];
                }
            } catch {}
        });

        bfs.connect(env);
        try {
            env.connect(m.outNode);
        } catch (e) {
            console.warn("[RC] env.connect ksOut failed", e);
            try {
                if (this.midiSynth?.bfSet?.[ch]?.[note] === bfs) {
                    this.midiSynth.bfSet[ch][note] = null;
                }
            } catch {}
            delete ksVoicesByCh[ch][voiceId];
            continue;
        }

        bfs.start(now);
        any = true;
    }

    return any;
}


//   pluckKS(ch, note, velocity) {
//         const allKs = Array.from(this.liveNodes.entries()).filter(([k]) => k.endsWith(":ksOut"));
//         if (!allKs.length) return false;
        

//         // 先找出符合的 ks_source（ch / program）
//         let chosen = null;            // 第一個匹配，用來決定 params
//         let chosenParams = {};
//         const targets = [];           // 所有符合的 outNode
//         const curPg = Number(this.midiSynth && this.midiSynth.pg ? this.midiSynth.pg[ch] : 0);

//         for (const [k, out] of allKs) {
//             const p = this.liveNodes.get(k.replace(":ksOut", ":ksParams")) || {};
//             // ch: "all" 或 0~15
//             const mch = p.ch != null ? String(p.ch) : "all";
//             const chMatch = (mch === "all") || (Number(mch) === ch);

//             // program: "all" 或 0~127（GUI 預設就是 "all"）
//             let progParam = p.program;
//             if (progParam === undefined || progParam === null || progParam === "all") {
//                 progParam = "all";
//             }
//             const prog = progParam === "all" ? null : Number(progParam);
//             const pgMatch = (prog === null) || (prog === curPg);

//             if (chMatch && pgMatch) {
//                 // 記住第一個匹配的，當作主要 params 來源
//                 if (!chosen) {
//                     chosen = [k, out];
//                     chosenParams = p;
//                 }
//                 // 所有符合的 outNode 都當作目標（支援多條 KS 線路）
//                 targets.push(out);
//             }
//         }

//         // 沒有任何匹配 → 回傳 false，讓 gate() fallback 到 osc
//         if (!chosen) {
//             console.warn('[RC] no ks_source matches ch/pg', { ch, curPg });
//             return false;
//         }

//         const key = chosen[0];
//         const outNode = chosen[1];
//         const params = chosenParams;

//         // 計算頻率（用全域 A4）
//         const a4 = (this.midiSynth && typeof this.midiSynth.a4_freq === "number") ? this.midiSynth.a4_freq : 440;
//         const f = a4 * Math.pow(2, (note - 69) / 12);

//         // === 準備 seed 噪音 ===
//         const sr = this.actx.sampleRate;
//         let seed = null;

//         try {
//             const type = String(params.seedNoiseType ?? "pink");

//             // 建議長度：跟頻率有關
//             const len = Math.max(2048, Math.round(sr / Math.max(1e-6, f)));

//             // === 基本噪音 ===
//             const makeWhite = (L) => {
//                 const out = new Float32Array(L);
//                 for (let i = 0; i < L; i++) out[i] = Math.random() * 2 - 1;
//                 return out;
//             };

//             const makePink = (L) => {
//                 const out = new Float32Array(L);
//                 let b0=0,b1=0,b2=0,b3=0,b4=0,b5=0,b6=0;
//                 for (let i=0;i<L;i++){
//                     const w = Math.random()*2-1;
//                     b0 = 0.99886*b0 + w*0.0555179;
//                     b1 = 0.99332*b1 + w*0.0750759;
//                     b2 = 0.969  *b2 + w*0.153852;
//                     b3 = 0.8665 *b3 + w*0.3104856;
//                     b4 = 0.55   *b4 + w*0.5329522;
//                     b5 = -0.7616*b5 - w*0.016898;
//                     out[i] = (b0+b1+b2+b3+b4+b5+b6*0.5362)*0.11;
//                     b6 = w*0.115926;
//                 }
//                 return out;
//             };

//             const makeBrown = (L) => {
//                 const out = new Float32Array(L);
//                 let acc = 0;
//                 for (let i = 0; i < L; i++) {
//                     acc += Math.random()*2 - 1;
//                     acc = Math.max(-8, Math.min(8, acc));
//                     out[i] = acc / 8;
//                 }
//                 return out;
//             };

//             const makeGrey = (L) => {
//                 const w = makeWhite(L);
//                 const p = makePink(L);
//                 const out = new Float32Array(L);
//                 for (let i = 0; i < L; i++) {
//                     out[i] = 0.6 * w[i] + 0.4 * p[i];
//                 }
//                 return out;
//             };

//             // === 已有：更 soft / 彩色的變體 ===

//             // 🔴 Red Noise（Brown 的二次積分 = 最 soft）
//             const makeRed = (L) => {
//                 const out = new Float32Array(L);
//                 let x = 0, y = 0;
//                 for (let i = 0; i < L; i++) {
//                     x += (Math.random()*2 - 1) * 0.02;
//                     y += x;
//                     out[i] = y * 0.0005; // scale
//                 }
//                 return out;
//             };

//             // 🔵 Blue Noise（差分）+ 強 LP → 柔和 friction 用
//             const makeBlue = (L) => {
//                 const tmp = new Float32Array(L);
//                 let last = 0;
//                 for (let i = 0; i < L; i++) {
//                     const w = Math.random()*2 - 1;
//                     tmp[i] = w - last;
//                     last = w;
//                 }
//                 // soft 化
//                 const out = new Float32Array(L);
//                 let lp = 0;
//                 for (let i = 0; i < L; i++) {
//                     lp = lp * 0.992 + tmp[i] * 0.008;
//                     out[i] = lp;
//                 }
//                 return out;
//             };

//             // 🟣 Violet Noise（高頻多）→ heavy LPF → 氣音
//             const makeViolet = (L) => {
//                 const tmp = new Float32Array(L);
//                 let last = 0;
//                 for (let i = 0; i < L; i++) {
//                     const w = Math.random()*2 - 1;
//                     tmp[i] = w - last;
//                     last = w;
//                 }
//                 const out = new Float32Array(L);
//                 let lp = 0;
//                 for (let i = 0; i < L; i++) {
//                     lp = lp * 0.995 + tmp[i] * 0.005;
//                     out[i] = lp;
//                 }
//                 return out;
//             };

//             // 🍫 Soft Brown：Brown → LPF
//             const makeSoftBrown = (L) => {
//                 const brown = makeBrown(L);
//                 const out = new Float32Array(L);
//                 let lp = 0;
//                 for (let i = 0; i < L; i++) {
//                     lp = lp * 0.995 + brown[i] * 0.005;
//                     out[i] = lp * 0.9;
//                 }
//                 return out;
//             };

//             // 🌸 Soft Pink：Pink → LPF
//             const makeSoftPink = (L) => {
//                 const pink = makePink(L);
//                 const out = new Float32Array(L);
//                 let lp = 0;
//                 for (let i = 0; i < L; i++) {
//                     lp = lp * 0.993 + pink[i] * 0.007;
//                     out[i] = lp * 0.9;
//                 }
//                 return out;
//             };

//             // === 新增：Wind / Perlin / Formant / Dust / Wood ===

//             // 🌪 Wind / Turbulence：有緩慢 gust 的風聲感
//             const makeWind = (L) => {
//                 const out = new Float32Array(L);
//                 let lp = 0;     // 基本低通（風本身）
//                 let env = 0;    // gust 包絡
//                 for (let i = 0; i < L; i++) {
//                     const w = Math.random()*2 - 1;
//                     // 低通，讓能量偏低中頻
//                     lp = lp * 0.985 + w * 0.015;
//                     // 緩慢變化的 gust 包絡
//                     env = env * 0.995 + (Math.random()*2 - 1) * 0.005;
//                     const e = 0.6 + 0.4 * env;  // 0.2 ~ 1.0 左右
//                     out[i] = lp * e;
//                 }
//                 return out;
//             };

//             // 🧊 Perlin-like：平滑、有機的 value noise
//             const makePerlin = (L) => {
//                 const out = new Float32Array(L);
//                 const seg = Math.max(8, Math.floor(L / 64)); // 64 個控制點左右
//                 const points = [];
//                 const nPoints = Math.floor(L / seg) + 2;
//                 for (let i = 0; i < nPoints; i++) {
//                     points[i] = Math.random()*2 - 1;
//                 }
//                 const fade = (t) => t*t*t*(t*(t*6 - 15) + 10); // Perlin 常用 fade
//                 for (let i = 0; i < L; i++) {
//                     const x = i / seg;
//                     const i0 = Math.floor(x);
//                     const t = x - i0;
//                     const a = points[i0];
//                     const b = points[i0+1];
//                     const ft = fade(t);
//                     out[i] = (a*(1-ft) + b*ft) * 0.9;
//                 }
//                 return out;
//             };

//             // 🎵 Formant Noise：白噪 + 幾個「元音」共鳴調制
//             const makeFormant = (L) => {
//                 const out = new Float32Array(L);
//                 const base = makeWhite(L);
//                 // 簡單 A / O 類 formant 頻率（Hz）
//                 const f1 = 300, f2 = 800, f3 = 2500;
//                 for (let i = 0; i < L; i++) {
//                     const t = i / sr;
//                     const m =
//                         1.0
//                         + 0.6 * Math.sin(2 * Math.PI * f1 * t)
//                         + 0.4 * Math.sin(2 * Math.PI * f2 * t + 1.3)
//                         + 0.25 * Math.sin(2 * Math.PI * f3 * t + 0.7);
//                     // 約略正常化
//                     out[i] = base[i] * (m * 0.25);
//                 }
//                 return out;
//             };

//             // ⚡ Dust Noise：稀疏 impulsive，像指甲 / 靜電
//             const makeDust = (L) => {
//                 const out = new Float32Array(L);
//                 let current = 0;
//                 const p = 0.004; // 密度（越大越多顆粒）
//                 for (let i = 0; i < L; i++) {
//                     if (Math.random() < p) {
//                         // 觸發一顆粒子（帶一點隨機極性）
//                         current += (Math.random() * 2 - 1) * 0.9;
//                     }
//                     current *= 0.96; // 快速衰減
//                     out[i] = current;
//                 }
//                 return out;
//             };

//             // 🪵 Wood Noise：木箱體感，softPink + mid formant
//             const makeWood = (L) => {
//                 const base = makeSoftPink(L);
//                 const out = new Float32Array(L);
//                 const fLow = 220;   // 箱體低共鳴
//                 const fMid = 550;   // 木頭中頻
//                 for (let i = 0; i < L; i++) {
//                     const t = i / sr;
//                     const tone =
//                         0.5 * Math.sin(2*Math.PI*fLow*t) +
//                         0.35 * Math.sin(2*Math.PI*fMid*t + 1.1);
//                     // noise * (1 + 一點木頭共鳴調制)
//                     out[i] = base[i] * (1.0 + 0.4 * tone);
//                 }
//                 return out;
//             };

//             // === 選擇對應類型 ===
//             switch (type) {
//                 case "white":      seed = makeWhite(len); break;
//                 case "pink":       seed = makePink(len); break;
//                 case "brown":      seed = makeBrown(len); break;
//                 case "softBrown":  seed = makeSoftBrown(len); break;
//                 case "softPink":   seed = makeSoftPink(len); break;
//                 case "red":        seed = makeRed(len); break;
//                 case "blue":       seed = makeBlue(len); break;
//                 case "violet":     seed = makeViolet(len); break;
//                 case "gray":       seed = makeGrey(len); break;

//                 case "wind":       seed = makeWind(len); break;
//                 case "perlin":     seed = makePerlin(len); break;
//                 case "formant":    seed = makeFormant(len); break;
//                 case "dust":       seed = makeDust(len); break;
//                 case "wood":       seed = makeWood(len); break;

//                 default:           seed = makePink(len); break;
//             }

//         } catch (e) {
//             console.warn("[RC] seed generation failed, fallback pink", e);
//             // 簡單 fallback
//             const fallbackLen = 2048;
//             seed = new Float32Array(fallbackLen);
//             for (let i = 0; i < fallbackLen; i++) {
//                 seed[i] = Math.random()*2 - 1;
//             }
//         }



//         console.log("[RC] seed check", seed?.length, seed?.[0]);

//         // seed 安全檢查（保持你原本的 fallback）
//         if (!seed || !seed.length) {
//             console.warn("[RC] seed invalid, injecting pink noise");
//             const len = Math.max(2048, Math.round(sr / Math.max(1e-6, f)));
//             seed = new Float32Array(len);
//             for (let i = 0; i < len; i++) seed[i] = Math.random() * 2 - 1;
//         }


//         // 建 buffer
//         let durSec = Number(params.ksDurSec);
//         if (!Number.isFinite(durSec)) durSec = 1.0;
//         durSec = Math.min(Math.max(durSec, 0.1), 10.0);

//         const frames = Math.round(sr * durSec);
//         const bf = this.actx.createBuffer(2, frames, sr);

//         // === smoothingFactor：支援 auto / manual ===
//         const mode = String(params.smoothingMode ?? "auto");
//         const opts = this.midiSynth?.options?.[ch] ?? {};

//         let smoothingFactor;

//         if (mode === "manual") {
//             // 手動模式：直接吃 GUI 的 smoothingFactor（0..1）
//             let s = Number(params.smoothingFactor);
//             if (!Number.isFinite(s)) s = 0.2;

//             // 稍微夾一下範圍，避免 0 或 1 太極端
//             if (s < 0.01) s = 0.01;
//             if (s > 0.99) s = 0.99;

//             smoothingFactor = s;
//         } else {
//             // auto 模式：沿用原本 midi_synth-gui.js 的算法
//             try {
//                 const inv127 = this.midiSynth?.inv127 ?? (1 / 127);
//                 const nn = Math.pow(note / 64, 0.5) || 0;

//                 // 基本 damping，跟 note 有關
//                 let stringDamping = (note * inv127) * 0.85 + 0.15;

//                 // 若 options[ch].stringDamping 有被 GUI 改過，就尊重它
//                 if (typeof opts.stringDamping === "number") {
//                     stringDamping = opts.stringDamping;
//                 } else if (this.midiSynth?.options?.[ch]) {
//                     // 順便寫回去，跟舊版行為接近
//                     this.midiSynth.options[ch].stringDamping = stringDamping;
//                 }

//                 const varAmt = Number(opts.stringDampingVariation ?? 0);

//                 smoothingFactor =
//                     stringDamping +
//                     nn * (1 - stringDamping) * 0.5 +
//                     (1 - stringDamping) * Math.random() * varAmt;
//             } catch {
//                 smoothingFactor = 0.2;
//             }
//         }

//         if (!Number.isFinite(smoothingFactor)) smoothingFactor = 0.2;


//         const velScale = Number(params.velScale == null ? 1 : params.velScale);

//         // 修正 opts 未定義問題
//         // const opts = this.midiSynth?.options?.[ch] ?? {};
//         if (Object.keys(opts).length === 0) {
//             opts.stringDamping = 0.5;
//             opts.stringDampingVariation = 0.2;
//         }

//         // smoothing 預設
//         if (!Number.isFinite(smoothingFactor)) smoothingFactor = 0.2;

//         // seed 安全檢查
//         if (!seed || !seed.length) {
//             console.warn("[RC] seed invalid, injecting pink noise");
//             const len = Math.max(2048, Math.round(sr / Math.max(1e-6, f)));
//             seed = new Float32Array(len);
//             for (let i = 0; i < len; i++) seed[i] = Math.random() * 2 - 1;
//         }

//         // 呼叫 asm pluck
//         try {
//             const aw = this.midiSynth?.asmWrapper?.[ch];
//             if (aw && typeof aw.pluck === "function") {
//                 aw.pluck(
//                     bf, 
//                     seed, 
//                     sr, 
//                     f, 
//                     smoothingFactor, 
//                     velocity * velScale, 
//                     opts, 
//                     0.2);
//             }
//         } catch (e) {
//             console.warn("[RC] pluck error", e);
//         }

//         // 建 BufferSource 並接 detune（mod / bend）
//         const bfs = this.actx.createBufferSource();
//         bfs.buffer = bf;

//         try {
//             const modNode = this.midiSynth?.chmod?.[ch];
//             if (modNode && bfs.detune) modNode.connect(bfs.detune);
//         } catch {}
//         try {
//             const bendVal = this.midiSynth?.bend?.[ch];
//             if (typeof bendVal === "number" && bfs.detune) bfs.detune.value = bendVal;
//         } catch {}

//         // ⭐ 每個 KS voice 自己的 envelope，用來做 noteOff 的漸弱
//         const env = this.actx.createGain();
//         env.gain.setValueAtTime(1, this.actx.currentTime);

//         // ⭐ KS voice registry（讓 gate() 的 noteOff 找得到）
//         if (!this.liveNodes.has("__ksVoices__")) this.liveNodes.set("__ksVoices__", {});
//         const ksVoicesByCh = this.liveNodes.get("__ksVoices__");
//         if (!ksVoicesByCh[ch]) ksVoicesByCh[ch] = {};

//         // 允許同一個 note 疊音 → 給每個 voice 一個 id
//         const voiceId = `${note}_${performance.now().toFixed(1)}_${Math.random().toString(36).slice(2, 5)}`;

//         ksVoicesByCh[ch][voiceId] = {
//             note,
//             bfs,
//             env,
//             params,      // 之後 noteOff 要讀 ksRelease 等可以從這裡拿
//             sustained: false
//         };

//         // 清理 bfSet & __ksVoices__（當 buffer 播完時）
//         bfs.addEventListener("ended", () => {
//             try {
//                 if (this.midiSynth?.bfSet?.[ch]?.[note] === bfs) {
//                     this.midiSynth.bfSet[ch][note] = null;
//                 }
//             } catch {}

//             try {
//                 const map = this.liveNodes.get("__ksVoices__");
//                 if (map && map[ch] && map[ch][voiceId]) {
//                     delete map[ch][voiceId];
//                 }
//             } catch {}
//         });

//         // 原本的 bfSet 註冊保留
//         try {
//             if (!this.midiSynth.bfSet) this.midiSynth.bfSet = {};
//             if (!this.midiSynth.bfSet[ch]) this.midiSynth.bfSet[ch] = {};
//             this.midiSynth.bfSet[ch][note] = bfs;
//         } catch {}

//         // 確保 chain tail 連到 mixer（保留你原來這一大段）
//         try {
//             const tailKey = key.replace(":ksOut", ":tail");
//             const tail = this.liveNodes.get(tailKey) || this.liveNodes.get("__chainTail__");
//             // const chVol = this.midiSynth?.chvol?.[ch];

//             // try {
//             //     const mix = this.mixers?.[ch];
//             //     if (tail && mix) {
//             //         if (tail.context === this.actx && mix.context === this.actx) {
//             //             tail.connect(mix);
//             //         } else {
//             //             console.warn('[RC] context mismatch detected, re-adopting synth context');
//             //             this.setMidiSynth(this.midiSynth);
//             //             try {
//             //                 const m2 = this.mixers?.[ch];
//             //                 if (tail.context === this.actx && m2?.context === this.actx) {
//             //                     tail.connect(m2);
//             //                 }
//             //             } catch {}
//             //         }
//             //     }
//             // } catch (e) {
//             //     console.warn('[RC] mixer connect failed', e);
//             // }

//         } catch {}

//         // ⭐ 這裡改成：bfs → env → ksOut
//         bfs.connect(env);
//         for (const node of targets) {
//             try {
//                 env.connect(node);
//             } catch (e) {
//                 console.warn("[RC] env.connect ksOut failed", e);
//             }
//         }

//         bfs.start();
//         return true;
//     }


    gateOsc(ch, note, velocity) {
        const allOsc = Array.from(this.liveNodes.entries()).filter(([k]) => k.endsWith(":osc"));
        if (!allOsc.length) return false;

        let triggered = false;
        const nn = (note == null ? 69 : note) | 0;
        const now = this.actx.currentTime;
        const a4  = (this.midiSynth && typeof this.midiSynth.a4_freq === "number") ? this.midiSynth.a4_freq : 440;
        const f   = a4 * Math.pow(2, (nn - 69) / 12);

        for (const [key, osc] of allOsc) {
            // 看這個 source 設定的 ch 是否符合
            const modId = key.replace(":osc", "");
            const chSel = this.liveNodes.get(modId + ":ch") ?? "all";
            const chOK  = (chSel === "all") || (Number(chSel) === ch);
            if (!chOK) continue;

            const env = this.liveNodes.get(modId + ":env");
            const adsr = this.liveNodes.get(modId + ":adsr") || { a:0.003, d:0.08, s:0.4, r:0.2 };
            if (!env) continue;

            try {
                osc.frequency.setValueAtTime(f, now);
            } catch {}

            const { a, d, s, r } = adsr;
            const rawLevel = Number(this.liveNodes.get(modId + ":level"));
            const level = Number.isFinite(rawLevel) ? rawLevel : 0.15;

            const peak = velocity * level;

            const A = a ?? 0.003;
            const D = d ?? 0.08;
            const S = s ?? 0.4;
            const R = r ?? 0.2;

            env.gain.cancelScheduledValues(now);
            env.gain.setValueAtTime(0, now);

            // ✅ 用 peak
            env.gain.linearRampToValueAtTime(peak, now + A);

            // ✅ sustain 也用 peak（不是 velocity）
            env.gain.linearRampToValueAtTime(S * peak, now + A + D);

            // // ✅ release to 0（如果你這裡其實是想做 AR 一次性音色，這樣OK）
            // env.gain.linearRampToValueAtTime(0, now + A + D + R);

            triggered = true;
        }

        return triggered;
    }

    releaseSourceEnv(ch, note) {
        const now = this.actx.currentTime;
        const sustainOn = (this.midiSynth?.pedal?.[ch] ?? 0) >= 64;
        if (sustainOn) return false;

        let any = false;
        const allOsc = Array.from(this.liveNodes.entries()).filter(([k]) => k.endsWith(":osc"));
        if (!allOsc.length) return false;

        for (const [key] of allOsc) {
            const modId = key.replace(":osc", "");
            const chSel = this.liveNodes.get(modId + ":ch") ?? "all";
            const chOK  = (chSel === "all") || (Number(chSel) === ch);
            if (!chOK) continue;

            const env  = this.liveNodes.get(modId + ":env");
            const adsr = this.liveNodes.get(modId + ":adsr") || { r: 0.2 };
            if (!env?.gain) continue;

            const R = Math.max(0.001, Number(adsr.r ?? 0.2));

            try {
            env.gain.cancelScheduledValues(now);
            env.gain.setValueAtTime(env.gain.value ?? 0, now);
            env.gain.linearRampToValueAtTime(0, now + R);
            any = true;
            } catch {}
        }

        return any;
    }



    releaseSustainKSForChannel(ch) {
        const now = this.actx.currentTime;
        const ksVoicesByCh = this.liveNodes.get("__ksVoices__");
        if (!ksVoicesByCh || !ksVoicesByCh[ch]) return;

        for (const [id, v] of Object.entries(ksVoicesByCh[ch])) {
            if (!v.sustained) continue;

            const { bfs, env, params } = v;
            const relCtrl = Number(params?.ksRelease ?? 0.5);
            const minR = 0.02;
            const maxR = 1.5;
            const rKs = minR + (maxR - minR) * Math.pow(relCtrl, 2.0);

            env.gain.cancelScheduledValues(now);
            env.gain.setValueAtTime(env.gain.value ?? 1, now);
            env.gain.linearRampToValueAtTime(0, now + rKs);
            bfs.stop(now + rKs + 0.05);

            v.sustained = false;

            setTimeout(() => {
                try { bfs.disconnect(); env.disconnect(); } catch {}
                delete ksVoicesByCh[ch][id];
            }, (rKs + 0.05) * 1000);
        }
    }

    releaseOsc(ch, note) {
        const voicesByCh = this.liveNodes && this.liveNodes.get("__oscVoices__");
        if (!voicesByCh || !voicesByCh[ch]) return false;

        const now = this.actx.currentTime;

        // ✅ 用 pedal（你目前用 pedal 才是主狀態）
        const sustainOn = (this.midiSynth?.pedal?.[ch] ?? 0) >= 64;

        // voicesByCh[ch] = { [id]: { note, osc, env, adsr|r, sustained? } }
        const entries = Object.entries(voicesByCh[ch]).filter(([, v]) => v && v.note === note);
        if (!entries.length) return false;

        for (const [id, v] of entries) {
            // sustain pedal：先標記，等 pedal 放開再一起 release
            if (sustainOn) {
            v.sustained = true;
            continue;
            }

            const env = v.env;
            const osc = v.osc;

            // 兼容你兩種寫法：v.r 或 v.adsr.r
            const R =
            (v.adsr && Number.isFinite(v.adsr.r)) ? v.adsr.r :
            (Number.isFinite(v.r) ? v.r : 0.2);

            const rel = Math.max(0.001, R);

            try {
            if (env && env.gain) {
                env.gain.cancelScheduledValues(now);
                // 從當下值開始放，避免 pop
                env.gain.setValueAtTime(env.gain.value ?? 0, now);
                env.gain.linearRampToValueAtTime(0, now + rel);
            }
            } catch {}

            try {
            if (osc && typeof osc.stop === "function") {
                osc.stop(now + rel + 0.02);
            }
            } catch {}

            // 延後清理（讓 stop/尾巴跑完）
            setTimeout(() => {
            try { osc && osc.disconnect && osc.disconnect(); } catch {}
            try { env && env.disconnect && env.disconnect(); } catch {}
            try { delete voicesByCh[ch][id]; } catch {}
            }, (rel + 0.05) * 1000);
        }

        return true;
    }



    releaseAllSustainedOsc(ch) {
        const voicesByCh = this.liveNodes && this.liveNodes.get("__oscVoices__");
        if (!voicesByCh || !voicesByCh[ch]) return;

        const now = this.actx.currentTime;

        for (const [id, v] of Object.entries(voicesByCh[ch])) {
            if (!v || !v.sustained) continue;

            const env = v.env;
            const osc = v.osc;
            const R =
            (v.adsr && Number.isFinite(v.adsr.r)) ? v.adsr.r :
            (Number.isFinite(v.r) ? v.r : 0.2);

            const rel = Math.max(0.001, R);

            try {
                env.gain.cancelScheduledValues(now);
                env.gain.setValueAtTime(env.gain.value ?? 0, now);
                env.gain.linearRampToValueAtTime(0, now + rel);
            } catch {}

            try { osc.stop(now + rel + 0.02); } catch {}

            v.sustained = false;

            setTimeout(() => {
                try { osc.disconnect(); env.disconnect(); } catch {}
                delete voicesByCh[ch][id];
            }, (rel + 0.05) * 1000);
        }
    }





  // --------------------------------------------------------------------
  // Receive raw MIDI data (Uint8Array)
  // --------------------------------------------------------------------
  handleMIDIMsg = (data) => {
    const st  = data[0], d1 = data[1], d2 = data[2];
    const cmd = st & 0xf0;
    const ch  = st & 0x0f;

    if (cmd === 0x90 && d2 > 0) {
        // Note On
        this.gate(true, d2 / 127, ch, d1);
    } else if (cmd === 0x80 || (cmd === 0x90 && d2 === 0)) {
        // Note Off（包括 velocity = 0 的 Note On）
        this.gate(false, 0, ch, d1);
    }
  };
}
