// routing-composer/src/core/AudioEngine.js
// -------------------------------------------------------------
// Handles all Web Audio graph building, node routing, and MIDI triggers.
// Connects dynamically to an external MidiSynth instance.
// -------------------------------------------------------------

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
  build(chain) {
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
        const p = chain.find(m => m.kind === "ks_source" || m.kind === "source");
        const chSel = (p?.params?.ch ?? "all");
        const channels = (chSel === "all") ? Array.from({ length: 16 }, (_, i) => i) : [Number(chSel)];
        for (const ch of channels) {
            const mix = this.mixers[ch];
            if (tail && mix) {
            tail.connect(mix);
            }
        }
    } catch (e) {
        console.warn("[RC] mixer connect failed", e);
    }

    if (tail && m.kind === "gain") {
        tail.connect(this.mixers[ch]); // 最後的 gain → mixer
    }

    
  }

  // --------------------------------------------------------------------
  // buildMany — For multiple chains
  // --------------------------------------------------------------------
  buildMany(chains) {
    this.liveNodes.clear();
    const prev = this.liveNodes;
    const buildOne = (c) => {
      const tmp = new Map();
      this.liveNodes = tmp;
      this.build(c);
      for (const [k, v] of this.liveNodes.entries()) prev.set(k, v);
      this.liveNodes = prev;
    };
    chains.forEach(buildOne);
  }

  // --------------------------------------------------------------------
  // MIDI Note Handling
  // --------------------------------------------------------------------
  gate(on, velocity = 0.8, ch = 0, note = 69) {
    const now = this.actx.currentTime;

    // === 1️⃣ 先試 KS ===
    let triggered = false;
    if (on) {
        triggered = this.pluckKS(ch, note ?? 69, velocity);
    }

    // === 2️⃣ 若 KS 沒命中 → 動態建立 OSC 音 ===
    if (on && !triggered) {
        const a4 = (this.midiSynth && typeof this.midiSynth.a4_freq === "number") ? this.midiSynth.a4_freq : 440;
        const f = a4 * Math.pow(2, (note - 69) / 12);
        const now = this.actx.currentTime;

        // 掃描所有 source module，挑出 ch 符合的
        const sources = [];
        for (const [k, v] of this.liveNodes.entries()) {
            if (k.endsWith(":oscType")) {
            const modId = k.split(":")[0];
            const chSel = this.liveNodes.get(modId + ":ch") ?? "all";
            const adsr  = this.liveNodes.get(modId + ":adsr") || { a:0.003, d:0.08, s:0.4, r:0.2 };
            const type  = v || "sawtooth";
            const chOK  = (chSel === "all") || (Number(chSel) === ch);
            if (chOK) sources.push({ modId, type, adsr });
            }
        }

        // 若沒有任何 source 符合，就直接用 __oscType__ + 預設 ADSR 當作 fallback
        if (!sources.length) {
            const type = this.liveNodes.get("__oscType__") || "sawtooth";
            sources.push({ modId: null, type, adsr: { a:0.003,d:0.08,s:0.4,r:0.2 } });
        }

        const tail = this.liveNodes.get("__chainTail__");
        const head = this.liveNodes.get("__chainHead__");
        const kbt  = this.liveNodes.get("keyboardTarget");
        const chVol = this.midiSynth?.chvol?.[ch];

        // 確保 voice map：按 channel 分組
        if (!this.liveNodes.has("__oscVoices__")) this.liveNodes.set("__oscVoices__", {});
        const voicesByCh = this.liveNodes.get("__oscVoices__");
        if (!voicesByCh[ch]) voicesByCh[ch] = {};

        for (const src of sources) {
            const osc = this.actx.createOscillator();
            try { osc.type = src.type; } catch { osc.type = "sawtooth"; }
                osc.frequency.setValueAtTime(f, now);

                // === modulation & pitch bend ===
                try {
                // (a) mod wheel：你的 chmod[ch] → detune（保持不變）
                const modNode = this.midiSynth?.chmod?.[ch];
                if (modNode && osc.detune) modNode.connect(osc.detune);

                // (b) pitch bend：每個 ch 一顆 ConstantSource，連到 detune
                const bendCS = this.getBendNode(ch);
                if (osc.detune && bendCS) {
                    // 避免重覆連線（瀏覽器通常允許重覆，不過保險寫法）
                    bendCS.connect(osc.detune);
                }

                // 初值同步目前 synth 的 bend（若有）
                if (typeof this.midiSynth?.bend?.[ch] === 'number') {
                    this.updateBend(ch, this.midiSynth.bend[ch]);
                }
            } catch (e) {
                console.warn('[RC] osc detune connect failed', e);
            }

            const env = this.actx.createGain();
            env.gain.setValueAtTime(0, now);

            // 使用該 source 的 ADSR
            const { a, d, s, r } = src.adsr;
            env.gain.linearRampToValueAtTime(velocity, now + (a ?? 0.003));
            env.gain.linearRampToValueAtTime((s ?? 0.4) * velocity, now + (a ?? 0.003) + (d ?? 0.08));

            osc.connect(env);

            // 避免把聲音塞進關著的 keyboardTarget，優先 tail → 再 head → 再 chvol
            let inject = null;
            if (head && head !== kbt) inject = head;
            else if (tail)           inject = tail;
            else if (chVol)          inject = chVol;
            if (!inject && chVol)    inject = chVol;
            if (inject) {
                env.connect(inject);
                // 一次性確保 tail → chvol[ch]
                try {
                    const tag = `__tail_to_chvol_${ch}__`;
                    
                    try {
                        const mix = this.mixers?.[ch];
                        if (tail && mix) {
                                // 同一個 context 才能接
                                if (tail.context === this.actx && mix.context === this.actx) {
                                tail.connect(mix);
                                // console.log(`[RC] chain tail connected -> mixer ch=${ch}`);
                            } else {
                                console.warn('[RC] context mismatch detected, re-adopting synth context');
                                this.setMidiSynth(this.midiSynth); // 重新採用並重建
                                try {
                                    const m2 = this.mixers?.[ch];
                                    if (tail.context === this.actx && m2?.context === this.actx) {
                                    tail.connect(m2);
                                    }
                                } catch {}
                            }
                        }
                    } catch (e) {
                        console.warn('[RC] mixer connect failed', e);
                    }

                } catch {}
            }

            osc.start(now);

            // 以 ch 分組、每顆 voice 有自己的 id（支援同 note 疊音）
            const vid = `${note}_${performance.now().toFixed(1)}_${Math.random().toString(36).slice(2,5)}`;
            voicesByCh[ch][vid] = { note, osc, env, r: (r ?? 0.2) };

            // 診斷
            // console.log(`[RC] osc start ch=${ch} note=${note} type=${src.type} adsr=`, src.adsr);
        }
    }

    // === 3️⃣ noteOff：停止該音 ===
    if (!on) {
        const now2 = this.actx.currentTime;
        const voicesByCh = this.liveNodes.get("__oscVoices__");
        if (!voicesByCh || !voicesByCh[ch]) return;

        const entries = Object.entries(voicesByCh[ch]).filter(([id, v]) => v.note === note);
        for (const [id, v] of entries) {
            const { osc, env, r = 0.2 } = v;
            try {
                env.gain.cancelScheduledValues(now2);
                env.gain.setValueAtTime(env.gain.value ?? 0, now2);
                env.gain.linearRampToValueAtTime(0, now2 + r);
                osc.stop(now2 + r + 0.05);
                setTimeout(() => {
                    try { osc.disconnect(); env.disconnect(); } catch {}
                    delete voicesByCh[ch][id];
                }, (r + 0.1) * 1000);
                // console.log(`[RC] osc stop ch=${ch} note=${note} id=${id}`);
                } catch (e) {
                // console.warn('[RC] osc stop failed', e);
                delete voicesByCh[ch][id];
            }
        }
    }
  }


  

  // --------------------------------------------------------------------
  // Karplus-Strong trigger — uses midi_synth.asmWrapper[ch].pluck
  // --------------------------------------------------------------------
  pluckKS(ch, note, velocity) {
        const allKs = Array.from(this.liveNodes.entries()).filter(([k]) => k.endsWith(":ksOut"));
        if (!allKs.length) return false;
        

        // 先找出符合的 ks_source（ch / program）
        let chosen = null;
        let chosenParams = {};
        const curPg = Number(this.midiSynth && this.midiSynth.pg ? this.midiSynth.pg[ch] : 0);

        for (const [k, out] of allKs) {
            const p = this.liveNodes.get(k.replace(":ksOut", ":ksParams")) || {};
            const mch = p.ch != null ? p.ch : "all";
            const prog = Number(p.program != null ? p.program : 0);
            const chMatch = mch === "all" || Number(mch) === ch;
            const pgMatch = prog === curPg;
            if (chMatch && pgMatch) { chosen = [k, out]; chosenParams = p; break; }
        }

        // 沒有任何匹配 → 回傳 false，讓 gate() fallback 到 osc
        if (!chosen) {
            console.warn('[RC] no ks_source matches ch/pg', { ch, curPg });
            return false;
        }

        const key = chosen[0];
        const outNode = chosen[1];
        const params = chosenParams;

        // 計算頻率（用全域 A4）
        const a4 = (this.midiSynth && typeof this.midiSynth.a4_freq === "number") ? this.midiSynth.a4_freq : 440;
        const f = a4 * Math.pow(2, (note - 69) / 12);

        // 準備 seed（優先使用 synth.generateSeedPinkNoise）
        const sr = this.actx.sampleRate;
        let seed = undefined;
        try {
            if (params.seedNoiseType === 'synthPink' && this.midiSynth && typeof this.midiSynth.generateSeedPinkNoise === 'function') {
                const period = Math.max(1, Math.round(sr / Math.max(1e-6, f)));
                seed = this.midiSynth.generateSeedPinkNoise(65535, period);
            } else {
                // fallback pink
                const len = Math.max(2048, Math.round(sr / Math.max(1e-6, f)));
                const makePinkSeed = (L=4096) => {
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
                seed = makePinkSeed(len);
            }
        } catch {}

        console.log("[RC] seed check", seed?.length, seed?.[0]);

        // 建 buffer
        const bf = this.actx.createBuffer(2, sr, sr);

        // smoothing（auto from options）
        let smoothingFactor = 0.2;
        try {
            const inv127 = this.midiSynth?.inv127 ?? (1/127);
            const nn = Math.pow(note/64, 0.5) || 0;
            const baseDamp = (note * inv127) * 0.85 + 0.15;
            const varAmt = Number(this.midiSynth?.options?.[ch]?.stringDampingVariation ?? 0);
            smoothingFactor = baseDamp + nn*(1-baseDamp)*0.5 + (1-baseDamp)*Math.random()*varAmt;
        } catch {}

        const velScale = Number(params.velScale == null ? 1 : params.velScale);

        // 修正 opts 未定義問題
        const opts = this.midiSynth?.options?.[ch] ?? {};
        if (Object.keys(opts).length === 0) {
            opts.stringDamping = 0.5;
            opts.stringDampingVariation = 0.2;
        }

        // smoothing 預設
        if (!Number.isFinite(smoothingFactor)) smoothingFactor = 0.2;

        // seed 安全檢查
        if (!seed || !seed.length) {
            console.warn("[RC] seed invalid, injecting pink noise");
            const len = Math.max(2048, Math.round(sr / Math.max(1e-6, f)));
            seed = new Float32Array(len);
            for (let i = 0; i < len; i++) seed[i] = Math.random() * 2 - 1;
        }

        // 呼叫 asm pluck
        try {
            const aw = this.midiSynth?.asmWrapper?.[ch];
            const opts = this.midiSynth?.options?.[ch] ?? {};
            if (aw && typeof aw.pluck === "function") {
                aw.pluck(bf, seed, sr, f, smoothingFactor, velocity * velScale, opts, 0.2);
            }
        } catch (e) {
            console.warn("[RC] pluck error", e);
        }

        // 建 BufferSource 並接 detune（mod / bend）
        const bfs = this.actx.createBufferSource();
        bfs.buffer = bf;

        try { const modNode = this.midiSynth?.chmod?.[ch]; if (modNode && bfs.detune) modNode.connect(bfs.detune); } catch {}
        try { const bendVal = this.midiSynth?.bend?.[ch]; if (typeof bendVal === "number" && bfs.detune) bfs.detune.value = bendVal; } catch {}

        // 清理 bfSet
        bfs.addEventListener("ended", () => {
            try {
                if (this.midiSynth?.bfSet?.[ch]?.[note] === bfs) this.midiSynth.bfSet[ch][note] = null;
            } catch {}
        });
        try {
            if (!this.midiSynth.bfSet) this.midiSynth.bfSet = {};
            if (!this.midiSynth.bfSet[ch]) this.midiSynth.bfSet[ch] = {};
            this.midiSynth.bfSet[ch][note] = bfs;
        } catch {}

        // 確保 chain tail 連到 chvol[ch]（只接一次）
        try {
            const tailKey = key.replace(":ksOut", ":tail");
            const tail = this.liveNodes.get(tailKey) || this.liveNodes.get("__chainTail__");
            const chVol = this.midiSynth?.chvol?.[ch];
            const tag = `__tail_to_chvol_${ch}__`;
            // if (tail && chVol && !this.liveNodes.has(tag)) {
            //     tail.connect(chVol);
            //     this.liveNodes.set(tag, true);
            //     console.log(`[RC] tail connected -> chvol[${ch}]`);
            // }
            
            try {
                const mix = this.mixers?.[ch];
                if (tail && mix) {
                    // 同一個 context 才能接
                    if (tail.context === this.actx && mix.context === this.actx) {
                        tail.connect(mix);
                        // console.log(`[RC] chain tail connected -> mixer ch=${ch}`);
                    } else {
                        console.warn('[RC] context mismatch detected, re-adopting synth context');
                        this.setMidiSynth(this.midiSynth); // 重新採用並重建
                        try {
                            const m2 = this.mixers?.[ch];
                            if (tail.context === this.actx && m2?.context === this.actx) {
                                tail.connect(m2);
                            }
                        } catch {}
                    }
                }
            } catch (e) {
                console.warn('[RC] mixer connect failed', e);
            }

        } catch {}

        // 連上 ks_source 的 out（讓後續節點運作）
        bfs.connect(outNode);
        bfs.start();
        return true;
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
