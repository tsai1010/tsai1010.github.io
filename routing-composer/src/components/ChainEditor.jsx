// routing-composer/src/components/ChainEditor.jsx
// -------------------------------------------------------------
// Main GUI: manages multiple chains, drag/drop, duplication, deletion,
// import/export, and connects to AudioEngine + MidiSynth
// -------------------------------------------------------------

import React, { useEffect, useState, useRef } from "react";
import ChainModuleCard from "./ChainModuleCard.jsx";
import { AudioEngine } from "../core/AudioEngine.js";
import { normalizeRoutingState, normalizeSingleChain } from "../core/routingIO.js";

// Tailwind base styles
const buttonClass =
  "px-3 py-1 rounded-xl border border-white/10 shadow hover:bg-white/5 active:scale-[.98] transition";
const cardClass =
  "rounded-2xl shadow-lg border border-white/10 bg-neutral-900/70 backdrop-blur p-3 select-none";

// 可改成獨立檔 registry
const MODULES = ["ks_source", "source", "filter", "delay", "reverb", "convolver_ir", "gain", "analyzer"];

const DEFAULT_PARAMS = {
  ks_source: { smoothingMode: "auto", smoothingFactor: 0.2, velScale: 1.0, seedNoiseType: "pink", useSynthA4: true, ch: "all", program: "all" },
  source: { 
    type: "sawtooth",
    ch: "all",                 // ← 新增：目標 MIDI channel（"all" | 0..15）
    adsr: { a: 0.003, d: 0.08, s: 0.4, r: 0.2 }  // ← 新增：每個 source 的 ADSR
  },
  filter: { mode: "lowpass", freq: 1200, q: 0.7 },
  delay: { time: 0.25, feedback: 0.35, mix: 0.3 },
  reverb: { decay: 2.0, mix: 0.25 },
  convolver_ir: { irId: "IR_Gibson", mix: 0.3 },
  gain: { gain: 0.8 },
  analyzer: {},
};

// 小工具
function uid(prefix = "m") {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`;
}
function arrayMove(arr, from, to) {
  const c = arr.slice();
  const s = Math.max(0, Math.min(c.length - 1, from));
  const it = c.splice(s, 1)[0];
  const e = Math.max(0, Math.min(c.length, to));
  c.splice(e, 0, it);
  return c;
}

function getSynthGlobalState(synth) {
  if (!synth) return null;

  const out = {};
  const a4 = Number(synth?.a4_freq);
  const masterVol = Number(synth?.masterVol);

  if (Number.isFinite(a4)) out.a4 = a4;
  if (Number.isFinite(masterVol)) out.masterVol = masterVol;

  return Object.keys(out).length ? out : null;
}

function applySynthGlobalState(synth, globalState) {
  if (!synth || !globalState || typeof globalState !== "object") return;

  if (typeof globalState.a4 === "number" && Number.isFinite(globalState.a4)) {
    synth.a4_freq = globalState.a4;
  }

  if (typeof globalState.masterVol === "number" && Number.isFinite(globalState.masterVol)) {
    if (typeof synth.setMasterVol === "function") {
      synth.setMasterVol(globalState.masterVol);
    } else {
      synth.masterVol = globalState.masterVol;
    }
  }
}

export default function ChainEditor({ 
  synth,
  initialState,
  onChange, 
}) {
  const engineRef = useRef(null);
  if (!engineRef.current) engineRef.current = new AudioEngine();
  const engine = engineRef.current;

  const chainScrollRefs = useRef([]);

  // 初始化：讓音引擎知道 midi_synth
  useEffect(() => {
    if (synth && typeof engine.setMidiSynth === "function") {
      try {
        engine.setMidiSynth(synth);
        console.log("[RC] midi_synth attached to engine");
      } catch (e) {
        console.warn("[RC] setMidiSynth failed", e);
      }
    }
  }, [synth]);

  const makeDefaultChains = () => [[
    { id: uid("ks"), kind: "ks_source", enabled: true, params: { ...DEFAULT_PARAMS.ks_source } },
    { id: uid("gain"), kind: "gain", enabled: true, params: { ...DEFAULT_PARAMS.gain } },
    { id: uid("an"), kind: "analyzer", enabled: true, params: {} },
  ]];

  // 狀態：chains（Step 3：支援 initialState）
  const [chains, setChains] = useState(() => {
    const c = initialState?.chains;
    return (Array.isArray(c) && c.length > 0) ? c : makeDefaultChains();
  });

  // ✅ Step 3：每條 chain 的顯示名稱 / 鎖定狀態
  const [chainMeta, setChainMeta] = useState(() => {
    const m = initialState?.chainMeta;
    return Array.isArray(m) ? m : [];
  });

  // 每條 chain 的 mute 狀態（用 index 對應）
  const [chainMutes, setChainMutes] = useState(() => {
    const m = initialState?.mutes;
    return Array.isArray(m) ? m : [];
  });

  
  const chainMutesRef = useRef(chainMutes);
  useEffect(() => {
    chainMutesRef.current = chainMutes;
  }, [chainMutes]);

  // 當 chains 長度變動時，調整 chainMutes 長度（新 chain 預設不 mute）
  useEffect(() => {
    setChainMutes((prev) => {
      const next = prev.slice(0, chains.length);
      while (next.length < chains.length) next.push(false);
      return next;
    });
  }, [chains.length]);

  useEffect(() => {
    setChainMeta((prev) => {
      const next = (Array.isArray(prev) ? prev : []).slice(0, chains.length);
      while (next.length < chains.length) next.push({});
      return next;
    });
  }, [chains.length]);

  const scrollChainToRight = (chainIdx) => {
    requestAnimationFrame(() => {
      const el = chainScrollRefs.current[chainIdx];
      if (!el) return;

      el.scrollTo({
        left: el.scrollWidth,
        behavior: "smooth",
      });
    });
  };

  const chainAutoScrollRef = useRef({
    activeChainIdx: null,
    direction: 0, // -1 = left, 1 = right, 0 = stop
    rafId: null,
  });

  const startAutoScroll = (chainIdx, direction, strength = 1) => {
    clearInterval(glowFadeTimers.current[chainIdx]);
    glowFadeTimers.current[chainIdx] = null;
    const state = chainAutoScrollRef.current;

    state.activeChainIdx = chainIdx;
    state.direction = direction;
    state.strength = strength;

    if (state.rafId) return;

    const tick = () => {
      const { activeChainIdx, direction, strength } = chainAutoScrollRef.current;
      
      if (activeChainIdx == null || direction === 0) {
        chainAutoScrollRef.current.rafId = null;
        return;
      }

      const el = chainScrollRefs.current[activeChainIdx];
      if (!el) {
        chainAutoScrollRef.current.rafId = null;
        return;
      }

      const minSpeed = 2;
      const maxSpeed = 12;
      const speed = minSpeed + (maxSpeed - minSpeed) * (strength || 0);
      el.scrollLeft += direction * speed;

      chainAutoScrollRef.current.rafId = requestAnimationFrame(tick);
    };

    state.rafId = requestAnimationFrame(tick);
  };

  const stopAutoScroll = () => {
    const state = chainAutoScrollRef.current;
    const activeIdx = state.activeChainIdx;

    if (state.rafId) {
      cancelAnimationFrame(state.rafId);
      state.rafId = null;
    }

    state.direction = 0;
    state.strength = 0;
    state.activeChainIdx = null;

    if (activeIdx != null) {
      fadeOutGlow(activeIdx);
    }
  };

  const handleChainMouseMove = (chainIdx, e) => {
    const el = chainScrollRefs.current[chainIdx];
    if (!el) return;

    const rect = el.getBoundingClientRect();
    const x = e.clientX - rect.left;

    const canScrollLeft = el.scrollLeft > 0;
    const canScrollRight = el.scrollLeft < el.scrollWidth - el.clientWidth - 1;

    const scrollOuter = 100; // 真正開始 auto-scroll 的範圍
    const glowOuter = 250;   // 先發亮提示的範圍

    // ---------- 左邊 ----------
    if (x <= glowOuter && canScrollLeft) {
      const glowStrength = Math.max(
        0.3,
        Math.min(1, (glowOuter - x) / glowOuter)
      );

      setChainEdgeGlow((prev) =>
        prev.map((g, i) =>
          i === chainIdx ? { left: glowStrength, right: 0 } : g
        )
      );

      if (x <= scrollOuter) {
        const scrollStrength = Math.max(
          0.15,
          Math.min(1, (scrollOuter - x) / scrollOuter)
        );
        startAutoScroll(chainIdx, -1, scrollStrength);
      } else {
        // 只停捲動，不觸發 fadeOut，保留 glow 提示
        haltAutoScrollOnly();
      }
      return;
    }

    // ---------- 右邊 ----------
    if (x >= rect.width - glowOuter && canScrollRight) {
      const dist = rect.width - x;
      const glowStrength = Math.max(
        0.3,
        Math.min(1, (glowOuter - dist) / glowOuter)
      );

      setChainEdgeGlow((prev) =>
        prev.map((g, i) =>
          i === chainIdx ? { left: 0, right: glowStrength } : g
        )
      );

      if (dist <= scrollOuter) {
        const scrollStrength = Math.max(
          0.15,
          Math.min(1, (scrollOuter - dist) / scrollOuter)
        );
        startAutoScroll(chainIdx, 1, scrollStrength);
      } else {
        // 只停捲動，不觸發 fadeOut，保留 glow 提示
        haltAutoScrollOnly();
      }
      return;
    }

    // 完全離開 glow 區
    stopAutoScroll();
  };

  useEffect(() => {
    return () => {
      stopAutoScroll();
    };
  }, []);

  const [chainEdgeGlow, setChainEdgeGlow] = useState([]);

  useEffect(() => {
    setChainEdgeGlow((prev) => {
      const next = Array.isArray(prev) ? prev.slice(0, chains.length) : [];
      while (next.length < chains.length) next.push({ left: 0, right: 0 });
      return next;
    });
  }, [chains.length]);

  const glowFadeTimers = useRef({});

  const fadeOutGlow = (chainIdx) => {
    clearInterval(glowFadeTimers.current[chainIdx]);

    glowFadeTimers.current[chainIdx] = setInterval(() => {
      let shouldStop = false;

      setChainEdgeGlow((prev) => {
        const next = prev.map((g, i) => {
          if (i !== chainIdx) return g;

          const left = (g?.left ?? 0) * 0.9;
          const right = (g?.right ?? 0) * 0.9;

          if (left < 0.02 && right < 0.02) {
            shouldStop = true;
            return { left: 0, right: 0 };
          }

          return { left, right };
        });

        return next;
      });

      if (shouldStop) {
        clearInterval(glowFadeTimers.current[chainIdx]);
        glowFadeTimers.current[chainIdx] = null;
      }
    }, 50);
  };

  const haltAutoScrollOnly = () => {
    const state = chainAutoScrollRef.current;

    if (state.rafId) {
      cancelAnimationFrame(state.rafId);
      state.rafId = null;
    }

    state.direction = 0;
    state.strength = 0;
    state.activeChainIdx = null;
  };

  // ------------------------------
  // Step 3-2: URL / JSON loaders
  // ------------------------------

  const loadFromURL = async (url) => {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();

      const normalized = normalizeRoutingState(json);
      if (!normalized) throw new Error("Invalid routing JSON");

      setChains(normalized.chains);
      setChainMeta(normalized.chainMeta);
      setChainMutes(normalized.mutes);
      applySynthGlobalState(synth, normalized.global);

      console.log("[RC] routing loaded from URL:", url);
    } catch (e) {
      console.warn("[RC] loadFromURL failed:", e);
    }
  };

  async function loadChainFromURL(chainIdx, url, opts = {}) {
    const idx = chainIdx | 0;
    if (idx < 0) return;
    if (!opts.force && isChainLocked(idx)) return;

    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();

      const normalized = normalizeSingleChain(json, { idPrefix: `c${idx}_` });
      if (!normalized || !normalized.chain) throw new Error("Invalid chain JSON");

      // 1) chains：確保長度 >= idx+1，再替換
      setChains((cc) => {
        const next = Array.isArray(cc) ? cc.slice() : [];
        while (next.length < idx + 1) next.push([]); // ✅ 自動補空 chain
        next[idx] = normalized.chain;
        return next;
      });

      // 2) meta：確保長度 >= idx+1，再替換
      setChainMeta((mm) => {
        const next = Array.isArray(mm) ? mm.slice() : [];
        while (next.length < idx + 1) next.push({});
        next[idx] = normalized.meta || {};
        return next;
      });

      // 3) mutes：確保長度 >= idx+1，再替換
      setChainMutes((mm) => {
        const next = Array.isArray(mm) ? mm.slice() : [];
        while (next.length < idx + 1) next.push(false);
        next[idx] = !!normalized.mute;
        return next;
      });

      console.log("[RC] chain loaded from URL:", idx, url);
    } catch (e) {
      console.warn("[RC] loadChainFromURL failed:", e);
    }
  }



  const toggleChainMute = (idx) => {
    setChainMutes((prev) => {
      const next = [...prev];
      next[idx] = !next[idx];
      return next;
    });
  };

  // 🔒 Step 3：判斷該 chain 是否被鎖定
  const isChainLocked = (chainIdx) =>
    chainMeta?.[chainIdx]?.locked === true;

  // 全域 MIDI 入口（供 routingComposer.onNoteOn 呼叫）
  useEffect(() => {
    window.__RC_HANDLE__ = {
      midi: (data) => {
        try {
          engine.handleMIDIMsg && engine.handleMIDIMsg(data);
          console.log("[RC] MIDI -> engine", data);
        } catch (e) {
          console.warn("[RC] MIDI ingress failed", e);
        }
      },

      engine,

      // Step 3-2 loaders（你已經做好的話就留著）
      loadFromURL,
      loadChainFromURL,

      // Step 3: state access
      getState: () => ({
        chains,
        chainMeta,
        mutes: chainMutes,
      }),

      // Step 3: meta setters (for lock/name flags)
      setChainMeta: (idx, patch) => {
        const i = idx | 0;
        if (!patch || typeof patch !== "object") return;
        setChainMeta((mm) =>
          (Array.isArray(mm) ? mm : []).map((m, k) =>
            k === i ? { ...(m || {}), ...patch } : m
          )
        );
      },

      // Step 3: mute setter (optional but handy)
      setChainMute: (idx, muted) => {
        const i = idx | 0;
        setChainMutes((prev) =>
          (Array.isArray(prev) ? prev : []).map((v, k) => (k === i ? !!muted : v))
        );
      },
    };

    return () => {
      try { delete window.__RC_HANDLE__; } catch (_) {}
    };
  }, [
    engine,
    chains,
    chainMeta,
    chainMutes,
  ]);

  useEffect(() => {
    if (!onChange) return;
    onChange({
      chains,
      mutes: chainMutes,
      chainMeta,
    });
  }, [chains, chainMutes, chainMeta, onChange]);

  // 刪除確認彈窗
  const [confirmDel, setConfirmDel] = useState({ open: false, idx: null, step: 1 });
  const requestDeleteChain = (idx) => {
    if (isChainLocked(idx)) return;
    setConfirmDel({ open: true, idx, step: 1 });
  };
  const cancelDelete = () => setConfirmDel({ open: false, idx: null, step: 1 });
  const proceedDelete = () => setConfirmDel((s) => ({ ...s, step: 2 }));
  const confirmDelete = () => {
    setChains((cc) => {
      const next = cc.filter((_, i) => i !== confirmDel.idx);
      return next.length
        ? next
        : [
            [
              { id: uid("src"), kind: "source", enabled: true, params: { ...DEFAULT_PARAMS.source } },
              { id: uid("gain"), kind: "gain", enabled: true, params: { ...DEFAULT_PARAMS.gain } },
              { id: uid("an"), kind: "analyzer", enabled: true, params: {} },
            ],
          ];
    });
    cancelDelete();
  };

  // 改變 chain 後重建音訊路徑
  useEffect(() => {
    try {
      engine.buildMany(chains);
      engine.resume && engine.resume();

      // 建完圖之後，把目前的 mute 狀態套用一次
      chainMutesRef.current.forEach((muted, idx) => {
        if (typeof engine.setChainMute === "function") {
          engine.setChainMute(idx, muted);
        }
      });
    } catch (e) {
      console.warn("[RC] buildMany failed", e);
    }
  }, [engine, JSON.stringify(chains)]);

  // 當 mute state 改變時，即時套用 mute（不用重建 graph）
  useEffect(() => {
    chainMutes.forEach((muted, idx) => {
      if (typeof engine.setChainMute === "function") {
        engine.setChainMute(idx, muted);
      }
    });
  }, [engine, chainMutes]);


  // MIDI Access
  useEffect(() => {
    if (!navigator.requestMIDIAccess) return;
    navigator.requestMIDIAccess().then((midi) => {
      for (const input of midi.inputs.values()) {
        input.onmidimessage = (msg) => engine.handleMIDIMsg(msg.data);
      }
    });
  }, []);

  // --- 事件操作 ---
  const onAdd = (chainIdx, kind) => {
    if (isChainLocked(chainIdx)) return;

    setChains((cc) => {
      const copy = cc.map((c) => [...c]);
      copy[chainIdx] = [
        ...copy[chainIdx],
        { id: uid(kind), kind, enabled: true, params: { ...DEFAULT_PARAMS[kind] } },
      ];
      return copy;
    });

    scrollChainToRight(chainIdx);
  };

  const onToggle = (chainIdx, id) => {
    if (isChainLocked(chainIdx)) return;
    setChains((cc) =>
      cc.map((c, i) =>
        i !== chainIdx
          ? c
          : c.map((m) => (m.id === id ? { ...m, enabled: !m.enabled } : m))
      )
    );
  };

  const onRemove = (chainIdx, id) => {
    if (isChainLocked(chainIdx)) return;
    setChains((cc) =>
      cc.map((c, i) => (i !== chainIdx ? c : c.filter((m) => m.id !== id)))
    );
  };

  const onParam = (chainIdx, id, k, v) => {
    if (isChainLocked(chainIdx)) return;

    // 先即時推到現役 GainNode（避免必須重建）
    if (k === "gain") {
        const ok = engine.updateGainNodeById(id, v);
        if (!ok) console.warn("[RC] gain node not found for id:", id);
    }
    // 再更新 state（保留 preset / 匯出）
    setChains((cc) => cc.map((c, i) =>
        (i !== chainIdx ? c : c.map((m) => (m.id === id ? { ...m, params: { ...m.params, [k]: v } } : m)))
    ));
  }
    
    // setChains((cc) =>
    //   cc.map((c, i) =>
    //     i !== chainIdx
    //       ? c
    //       : c.map((m) =>
    //           m.id === id ? { ...m, params: { ...m.params, [k]: v } } : m
    //         )
    //   )
    // );

  // 拖曳排序
  const [drag, setDrag] = useState(null);
  const onDragStartCard = (chainIdx, modIdx) => (e) => {
    if (isChainLocked(chainIdx)) return;

    setDrag({ chain: chainIdx, from: modIdx });
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", `${chainIdx}:${modIdx}`);
  };
  const onDropCard = (chainIdx, modIdx) => (e) => {
    if (isChainLocked(chainIdx)) return;

    e.preventDefault();
    if (!drag || drag.chain !== chainIdx) return;
    setChains((cc) =>
      cc.map((c, i) =>
        i !== chainIdx ? c : arrayMove(c, drag.from, modIdx)
      )
    );
    setDrag(null);
  };
  const onDropToEnd = (chainIdx) => (e) => {
    if (isChainLocked(chainIdx)) return;

    e.preventDefault();
    if (!drag || drag.chain !== chainIdx) return;
    setChains((cc) =>
      cc.map((c, i) =>
        i !== chainIdx ? c : arrayMove(c, drag.from, c.length)
      )
    );
    setDrag(null);
  };

  // 複製整條 chain
  const duplicateChain = (idx) =>
    setChains((cc) => {
      const copy = cc.map((c) => [...c]);
      const cloned = copy[idx].map((m) => ({ ...m, id: uid(m.kind) }));
      copy.splice(idx + 1, 0, cloned);
      return copy;
    });


  // 單一 chain 匯出
  const exportChain = (idx) => {
    const chain = chains[idx];
    if (!chain) return;

    const payload = {
      version: 1,
      chain,
      meta: chainMeta?.[idx] || {},
      mute: !!chainMutes?.[idx],
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `audio-chain-${idx + 1}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // 單一 chain 匯入（會取代該條線路）
  const importChain = async (idx, file) => {
    if (isChainLocked(idx)) return;

    const text = await file.text();
    try {
      const json = JSON.parse(text);
      const normalized = normalizeSingleChain(json, { idPrefix: `c${idx}_` });
      if (!normalized || !normalized.chain) throw new Error("Invalid single-chain JSON");

      setChains((cc) => {
        const next = Array.isArray(cc) ? cc.slice() : [];
        while (next.length < idx + 1) next.push([]);
        next[idx] = normalized.chain;
        return next;
      });

      setChainMeta((mm) => {
        const next = Array.isArray(mm) ? mm.slice() : [];
        while (next.length < idx + 1) next.push({});
        next[idx] = normalized.meta || {};
        return next;
      });

      setChainMutes((mm) => {
        const next = Array.isArray(mm) ? mm.slice() : [];
        while (next.length < idx + 1) next.push(false);
        next[idx] = !!normalized.mute;
        return next;
      });
    } catch (e) {
      console.warn("[RC] importChain failed", e);
    }
  };

  // 新增一條空的 chain（不含任何 module，預設無聲）
  const addChain = () =>
    setChains((cc) => [...cc, []]);


  // 匯出 / 匯入 JSON
  const exportJSON = () => {
    const payload = {
      version: 2,
      chains,
      chainMeta,
      mutes: chainMutes,
      global: getSynthGlobalState(synth),
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "audio-chains.json";
    a.click();
    URL.revokeObjectURL(url);
  };
  const importJSON = async (file) => {
    const text = await file.text();
    try {
      const json = JSON.parse(text);
      const normalized = normalizeRoutingState(json);
      if (!normalized) throw new Error("Invalid routing JSON");

      setChains(normalized.chains);
      setChainMeta(normalized.chainMeta);
      setChainMutes(normalized.mutes);
      applySynthGlobalState(synth, normalized.global);
    } catch (e) {
      console.warn("[RC] importJSON failed", e);
    }
  };

  return (
    <div className="p-6 text-white">
      {/* Toolbar */}
      <div className="flex items-center justify-between mb-4">
        
        <div className="flex items-center gap-2 flex-wrap">
          <button className={buttonClass} onClick={exportJSON}>
            Export
          </button>
          <label className={`${buttonClass} cursor-pointer`}>
            Import
            <input
              type="file"
              accept="application/json"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) importJSON(f);
              }}
            />
          </label>
          <button
            className={buttonClass}
            onClick={() => {
                // 優先用 engine.buildMultiFrom；沒有就用狀態層手動複製
                if (typeof engine.buildMultiFrom === 'function') {
                    engine.buildMultiFrom(chains[0], Array.from({ length: 16 }, (_, i) => i));
                } else {
                    setChains((cc) => {
                        const template = cc[0] || [];
                        const all = Array.from({ length: 16 }, (_, ch) =>
                            template.map((m) => ({
                            ...m,
                            id: uid(m.kind) + `_ch${ch}`,
                            params: m.kind === 'ks_source'
                                ? { ...m.params, ch: String(ch) }
                                : { ...m.params }
                            }))
                        );
                        return all;
                    });
                }
            }}
          >
            Duplicate to 16 channels
          </button>
        </div>
      </div>

      {/* Main chain list */}
      <div className="relative border border-dashed border-white/20 rounded-2xl p-4">
        {chains.map((chain, chainIdx) => {
          const locked = isChainLocked(chainIdx);

          return (
            <div
              key={chainIdx}
              className={`relative mb-6 rounded-lg p-2 overflow-hidden
                ${locked ? "bg-neutral-900/60 border border-yellow-500/40" : ""}`}
            >
              <div className="flex items-center justify-between mb-2">
                <div className="text-sm opacity-80">
                  {chainMeta[chainIdx]?.name ?? `Chain #${chainIdx + 1}`}
                </div>

                {locked && (
                  <span
                    className="text-xs px-2 py-0.5 rounded
                              border border-yellow-400
                              text-yellow-400
                              bg-transparent
                              opacity-100"
                    title="This chain is locked (GUI editing disabled)"
                  >
                    🔒 Locked
                  </span>
                )}

                <div className="flex gap-2 items-center">
                  {/* 🔊 / 🔇 */}
                  <button
                    className={buttonClass}
                    onClick={() => toggleChainMute(chainIdx)}
                    title={chainMutes[chainIdx] ? "Unmute chain" : "Mute chain"}
                  >
                    {chainMutes[chainIdx] ? "🔇" : "🔊"}
                  </button>

                  {/* 單一 chain 匯出 */}
                  <button
                    className={buttonClass}
                    onClick={() => exportChain(chainIdx)}
                  >
                    Export
                  </button>

                  {/* 單一 chain 匯入（取代這條） */}
                  <label className={`${buttonClass} cursor-pointer`}>
                    Import
                    <input
                      type="file"
                      accept="application/json"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) importChain(chainIdx, f);
                        e.target.value = "";
                      }}
                    />
                  </label>

                  <button
                    className={buttonClass}
                    onClick={() => duplicateChain(chainIdx)}
                  >
                    Duplicate
                  </button>

                  <button
                    className={buttonClass}
                    onClick={() => requestDeleteChain(chainIdx)}
                  >
                    Delete
                  </button>
                </div>
              </div>

              {/* ✅ 每條 chain 自己的水平 scroll 容器 */}
              <div className="relative rounded-xl overflow-hidden">
                {/* 左側 U 型 glow */}
                <div
                  className="pointer-events-none absolute inset-y-0 left-0 w-32 z-10 transition-opacity duration-100"
                  style={{
                    opacity: (chainEdgeGlow[chainIdx]?.left ?? 0) > 0
                      ? 0.35 + (chainEdgeGlow[chainIdx]?.left ?? 0) * 0.65
                      : 0,
                    background: `
                      radial-gradient(120px 80px at top left, rgba(125, 211, 252, ${0.7 * (chainEdgeGlow[chainIdx]?.left ?? 0)}), rgba(125, 211, 252, 0) 70%),
                      radial-gradient(120px 80px at bottom left, rgba(125, 211, 252, ${0.4 * (chainEdgeGlow[chainIdx]?.left ?? 0)}), rgba(125, 211, 252, 0) 70%),
                      linear-gradient(to right, rgba(125, 211, 252, ${0.5 * (chainEdgeGlow[chainIdx]?.left ?? 0)}), rgba(125, 211, 252, 0))
                    `,
                  }}
                />

                {/* 右側 U 型 glow */}
                <div
                  className="pointer-events-none absolute inset-y-0 right-0 w-32 z-10 transition-opacity duration-100"
                  style={{
                    opacity: (chainEdgeGlow[chainIdx]?.right ?? 0) > 0
                      ? 0.35 + (chainEdgeGlow[chainIdx]?.right ?? 0) * 0.65
                      : 0,
                    background: `
                      radial-gradient(120px 80px at top right, rgba(125, 211, 252, ${0.7 * (chainEdgeGlow[chainIdx]?.right ?? 0)}), rgba(125, 211, 252, 0) 70%),
                      radial-gradient(120px 80px at bottom right, rgba(125, 211, 252, ${0.4 * (chainEdgeGlow[chainIdx]?.right ?? 0)}), rgba(125, 211, 252, 0) 70%),
                      linear-gradient(to left, rgba(125, 211, 252, ${0.5 * (chainEdgeGlow[chainIdx]?.right ?? 0)}), rgba(125, 211, 252, 0))
                    `,
                  }}
                />

                <div
                  ref={(el) => {
                    chainScrollRefs.current[chainIdx] = el;
                  }}
                  className="overflow-x-auto overflow-y-hidden pb-2"
                  onMouseMove={(e) => handleChainMouseMove(chainIdx, e)}
                  onMouseLeave={() => {
                    stopAutoScroll();
                  }}
                >
                <div className="flex gap-3 items-stretch min-w-max">
                  {chain.map((mod, modIdx) => (
                    <div
                      key={mod.id}
                      onDrop={onDropCard(chainIdx, modIdx)}
                      onDragOver={(e) => e.preventDefault()}
                      className="hover:border-white/20 transition border border-transparent rounded-2xl shrink-0"
                      title="Drag to reorder"
                    >
                      <ChainModuleCard
                        mod={mod}
                        onToggle={() => onToggle(chainIdx, mod.id)}
                        onRemove={() => onRemove(chainIdx, mod.id)}
                        onParam={(k, v) => onParam(chainIdx, mod.id, k, v)}
                        onDragStart={onDragStartCard(chainIdx, modIdx)}
                      />
                    </div>
                  ))}

                  <div
                    className="w-12 rounded-xl border-2 border-dashed border-white/10 hover:border-white/20 flex items-center justify-center opacity-60 shrink-0"
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={onDropToEnd(chainIdx)}
                  >
                    →
                  </div>
                </div>
              </div>
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                {MODULES.map((k) => (
                  <button
                    key={`${chainIdx}-${k}`}
                    className={buttonClass}
                    onClick={() => onAdd(chainIdx, k)}
                  >
                    + {k}
                  </button>
                ))}
              </div>
            </div>
          );
        })}

        {/* 新增線路按鈕：加在所有 chain 的最底下 */}
        <div className="mt-2 flex justify-center">
          <button className={buttonClass} onClick={addChain}>
            + Add chain
          </button>
        </div>
      </div>

      {/* 刪除確認彈窗 */}
      {confirmDel.open && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-neutral-900 border border-white/10 rounded-2xl p-5 w-[420px] shadow-xl">
            {confirmDel.step === 1 ? (
              <>
                <div className="text-lg font-semibold mb-2">Delete this chain?</div>
                <p className="text-sm opacity-80 mb-4">Confirm to continue.</p>
                <div className="flex justify-end gap-2">
                  <button className={buttonClass} onClick={cancelDelete}>
                    Cancel
                  </button>
                  <button className={buttonClass} onClick={proceedDelete}>
                    Next
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="text-lg font-semibold mb-2">Are you sure?</div>
                <p className="text-sm opacity-80 mb-4">This cannot be undone.</p>
                <div className="flex justify-end gap-2">
                  <button className={buttonClass} onClick={cancelDelete}>
                    Cancel
                  </button>
                  <button className={buttonClass} onClick={confirmDelete}>
                    Delete
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
