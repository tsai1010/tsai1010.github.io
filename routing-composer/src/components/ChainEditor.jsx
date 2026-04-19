// routing-composer/src/components/ChainEditor.jsx
// -------------------------------------------------------------
// Main GUI: manages multiple chains, drag/drop, duplication, deletion,
// import/export, and connects to AudioEngine + MidiSynth
// -------------------------------------------------------------

import React, { useEffect, useState, useRef } from "react";
import ChainModuleCard from "./ChainModuleCard.jsx";
import { AudioEngine } from "../core/AudioEngine.js";
import { normalizeRoutingState, normalizeSingleChain } from "../core/routingIO.js";
import SpectrogramComparePanel from "./SpectrogramComparePanel.jsx";

// Tailwind base styles
const buttonClass =
  "px-3 py-1 rounded-xl border border-white/10 shadow hover:bg-white/5 active:scale-[.98] transition";
const cardClass =
  "rounded-2xl shadow-lg border border-white/10 bg-neutral-900/70 backdrop-blur p-3 select-none";

// 可改成獨立檔 registry
const MODULES = ["ks_source", "source", "filter", "delay", "reverb", "convolver_ir", "gain", "analyzer"];

const DEFAULT_PARAMS = {
  ks_source: {
    smoothingMode: "auto",
    smoothingFactor: 0.2,
    autoSmoothingProfile: "steel",
    smoothingOffset: 0.0,
    velScale: 1.0,
    seedNoiseType: "pink",
    useSynthA4: true,
    ch: "all",
    program: "all",
  },
  source: {
    type: "sawtooth",
    ch: "all",
    adsr: { a: 0.003, d: 0.08, s: 0.4, r: 0.2 },
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
  const midiAccessRef = useRef(null);

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
  }, [synth, engine]);

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

  // UI state
  const [showSpectrogramCompare, setShowSpectrogramCompare] = useState(
    Boolean(initialState?.ui?.showSpectrogramCompare ?? false)
  );
  const [ksRuntimeInfo, setKsRuntimeInfo] = useState({});

  const [midiSupported, setMidiSupported] = useState(
    typeof navigator !== "undefined" &&
      typeof navigator.requestMIDIAccess === "function"
  );

  const [midiInputs, setMidiInputs] = useState([]);
  const [midiInputMode, setMidiInputMode] = useState(
    initialState?.ui?.midiInputMode ?? "all"
  );
  const [selectedMidiInputId, setSelectedMidiInputId] = useState(
    initialState?.ui?.selectedMidiInputId ?? ""
  );

  const midiModeRef = useRef(midiInputMode);
  const selectedMidiInputIdRef = useRef(selectedMidiInputId);
  const midiInputsBoundRef = useRef(false);
  const midiIngressBusyRef = useRef(false);

  useEffect(() => {
    midiModeRef.current = midiInputMode;
  }, [midiInputMode]);

  useEffect(() => {
    selectedMidiInputIdRef.current = selectedMidiInputId;
  }, [selectedMidiInputId]);

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
    direction: 0,
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

    const scrollOuter = 100;
    const glowOuter = 350;

    if (x <= glowOuter && canScrollLeft) {
      clearInterval(glowFadeTimers.current[chainIdx]);
      glowFadeTimers.current[chainIdx] = null;

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
        haltAutoScrollOnly();
      }
      return;
    }

    if (x >= rect.width - glowOuter && canScrollRight) {
      clearInterval(glowFadeTimers.current[chainIdx]);
      glowFadeTimers.current[chainIdx] = null;

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
        haltAutoScrollOnly();
      }
      return;
    }

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

      if (json?.ui && typeof json.ui === "object") {
        if (typeof json.ui.showSpectrogramCompare === "boolean") {
          setShowSpectrogramCompare(json.ui.showSpectrogramCompare);
        }
        if (typeof json.ui.midiInputMode === "string") {
          setMidiInputMode(json.ui.midiInputMode);
        }
        if (typeof json.ui.selectedMidiInputId === "string") {
          setSelectedMidiInputId(json.ui.selectedMidiInputId);
        }
      }

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

  const isChainLocked = (chainIdx) =>
    chainMeta?.[chainIdx]?.locked === true;

  // -------------------------------------------------------------
  // ⚠️ IMPORTANT: MIDI binding design (DO NOT change lightly)
  //
  // 我們目前採用「所有 MIDI inputs 綁一次 + handler 內過濾」的方式，
  // 而不是在 UI 切換時反覆 clear / rebind input.onmidimessage。
  //
  // ❗ 為什麼這樣做：
  // 舊實作（clear + rebind）在某些環境（例如 VMPK / 虛擬 MIDI port）會出問題：
  // - 切換 port 後仍然收到其他 port 的訊息
  // - 某些 input handler 在 statechange / refresh 後殘留或被重建
  // - 造成 MIDI 訊息重複觸發，甚至形成類似「無限迴圈」的現象
  // - GUI 會被大量 MIDI event 卡死（主執行緒被塞爆）
  //
  // ✅ 現在的設計：
  // - 所有 input.onmidimessage 只在初始化時綁一次
  // - 每個 event 進來時才判斷：
  //     - midiInputMode === "none"     → 忽略
  //     - midiInputMode === "all"      → 全部通過
  //     - midiInputMode === "selected" → 只允許特定 input.id
  //
  // - 使用 useRef（midiModeRef / selectedMidiInputIdRef）避免 closure 問題
  // - 使用 midiIngressBusyRef 防止高頻 event 導致 re-entry / freeze
  //
  // ❗ 絕對不要改回：
  // - 每次 mode 改變就 clear 所有 input.onmidimessage 再重新綁
  // - 或在 useEffect 中反覆 applyMidiBindings()
  //
  // 如果要修改這段，請先確認：
  // - 不會造成 handler 重複綁定
  // - 不會讓非選定 port 的訊號進入 engine
  // - 不會在高頻 MIDI input 下造成 UI freeze
  // -------------------------------------------------------------

  // ------------------------------
  // MIDI input management (GUI controlled)
  // ------------------------------
  const refreshMidiInputs = async () => {
    if (typeof navigator === "undefined" || typeof navigator.requestMIDIAccess !== "function") {
      setMidiSupported(false);
      setMidiInputs([]);
      midiAccessRef.current = null;
      midiInputsBoundRef.current = false;
      return;
    }

    try {
      const access = await navigator.requestMIDIAccess();
      midiAccessRef.current = access;

      const nextInputs = Array.from(access.inputs.values()).map((input) => ({
        id: String(input.id),
        name: input.name || input.manufacturer || `MIDI Input ${input.id}`,
      }));

      setMidiSupported(true);
      setMidiInputs(nextInputs);

      setSelectedMidiInputId((prev) => {
        if (prev && nextInputs.some((x) => x.id === prev)) return prev;
        return nextInputs[0]?.id || "";
      });

      // 只在第一次（或新 access）時綁一次
      if (!midiInputsBoundRef.current) {
        for (const input of access.inputs.values()) {
          input.onmidimessage = (msg) => {
            const mode = midiModeRef.current;
            const selectedId = selectedMidiInputIdRef.current;

            if (mode === "none") return;
            if (mode === "selected" && String(input.id) !== String(selectedId)) return;

            // 防止訊息暴衝時主執行緒被重入卡死
            if (midiIngressBusyRef.current) return;
            midiIngressBusyRef.current = true;

            try {
              engine.handleMIDIMsg?.(msg.data);
            } catch (e) {
              console.warn("[RC] MIDI input handling failed", e);
            } finally {
              queueMicrotask(() => {
                midiIngressBusyRef.current = false;
              });
            }
          };
        }

        midiInputsBoundRef.current = true;
      }
    } catch (e) {
      console.warn("[RC] requestMIDIAccess failed", e);
      setMidiSupported(false);
      setMidiInputs([]);
      midiAccessRef.current = null;
      midiInputsBoundRef.current = false;
    }
  };

  useEffect(() => {
    refreshMidiInputs();

    return () => {
      const access = midiAccessRef.current;
      if (!access) return;

      for (const input of access.inputs.values()) {
        try {
          input.onmidimessage = null;
        } catch {}
      }

      midiInputsBoundRef.current = false;
    };
  }, []);

  useEffect(() => {
    const access = midiAccessRef.current;
    if (!access) return;

    const onStateChange = async () => {
      midiInputsBoundRef.current = false;
      await refreshMidiInputs();
    };

    access.onstatechange = onStateChange;

    return () => {
      if (access.onstatechange === onStateChange) {
        access.onstatechange = null;
      }
    };
  }, [midiInputs]);
  

  

  useEffect(() => {
    const id = setInterval(() => {
      const next = {};

      for (const chain of chains) {
        for (const mod of chain) {
          if (mod?.kind !== "ks_source") continue;
          const info = engine.getKSLastSmoothInfo?.(mod.id) || null;
          if (info) next[mod.id] = info;
        }
      }

      setKsRuntimeInfo((prev) => {
        const prevKeys = Object.keys(prev);
        const nextKeys = Object.keys(next);
        if (prevKeys.length !== nextKeys.length) return next;

        for (const key of nextKeys) {
          const a = prev[key];
          const b = next[key];
          if (!a || !b) return next;
          if (
            a.updatedAt !== b.updatedAt ||
            a.finalSmooth !== b.finalSmooth ||
            a.autoSmooth !== b.autoSmooth
          ) {
            return next;
          }
        }

        return prev;
      });
    }, 250);

    return () => clearInterval(id);
  }, [engine, chains]);

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
      loadFromURL,
      loadChainFromURL,

      getState: () => ({
        chains,
        chainMeta,
        mutes: chainMutes,
        ui: {
          showSpectrogramCompare,
          midiInputMode,
          selectedMidiInputId,
        },
      }),

      setChainMeta: (idx, patch) => {
        const i = idx | 0;
        if (!patch || typeof patch !== "object") return;
        setChainMeta((mm) =>
          (Array.isArray(mm) ? mm : []).map((m, k) =>
            k === i ? { ...(m || {}), ...patch } : m
          )
        );
      },

      setChainMute: (idx, muted) => {
        const i = idx | 0;
        setChainMutes((prev) =>
          (Array.isArray(prev) ? prev : []).map((v, k) => (k === i ? !!muted : v))
        );
      },
    };

    return () => {
      try {
        delete window.__RC_HANDLE__;
      } catch (_) {}
    };
  }, [
    engine,
    chains,
    chainMeta,
    chainMutes,
    showSpectrogramCompare,
    midiInputMode,
    selectedMidiInputId,
  ]);

  useEffect(() => {
    if (!onChange) return;
    onChange({
      chains,
      mutes: chainMutes,
      chainMeta,
      ui: {
        showSpectrogramCompare,
        midiInputMode,
        selectedMidiInputId,
      },
    });
  }, [
    chains,
    chainMutes,
    chainMeta,
    onChange,
    showSpectrogramCompare,
    midiInputMode,
    selectedMidiInputId,
  ]);

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
        : [[
            { id: uid("src"), kind: "source", enabled: true, params: { ...DEFAULT_PARAMS.source } },
            { id: uid("gain"), kind: "gain", enabled: true, params: { ...DEFAULT_PARAMS.gain } },
            { id: uid("an"), kind: "analyzer", enabled: true, params: {} },
          ]];
    });
    cancelDelete();
  };

  // 改變 chain 後重建音訊路徑
  useEffect(() => {
    try {
      engine.buildMany(chains);
      engine.resume && engine.resume();

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

    if (k === "gain") {
      const ok = engine.updateGainNodeById(id, v);
      if (!ok) console.warn("[RC] gain node not found for id:", id);
    }

    setChains((cc) => cc.map((c, i) =>
      (i !== chainIdx ? c : c.map((m) => (m.id === id ? { ...m, params: { ...m.params, [k]: v } } : m)))
    ));
  };

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

  const addChain = () =>
    setChains((cc) => [...cc, []]);

  const exportJSON = () => {
    const payload = {
      version: 2,
      chains,
      chainMeta,
      mutes: chainMutes,
      global: getSynthGlobalState(synth),
      ui: {
        showSpectrogramCompare,
        midiInputMode,
        selectedMidiInputId,
      },
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

      if (json?.ui && typeof json.ui === "object") {
        if (typeof json.ui.showSpectrogramCompare === "boolean") {
          setShowSpectrogramCompare(json.ui.showSpectrogramCompare);
        }
        if (typeof json.ui.midiInputMode === "string") {
          setMidiInputMode(json.ui.midiInputMode);
        }
        if (typeof json.ui.selectedMidiInputId === "string") {
          setSelectedMidiInputId(json.ui.selectedMidiInputId);
        }
      }
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
                e.target.value = "";
              }}
            />
          </label>

          <button
            className={buttonClass}
            onClick={() => setShowSpectrogramCompare((v) => !v)}
          >
            Spectrogram: {showSpectrogramCompare ? "On" : "Off"}
          </button>

          {midiSupported ? (
            <>
              <select
                className="bg-neutral-900 text-white border border-white/20 rounded-lg px-2 py-1 text-sm"
                value={midiInputMode}
                onChange={(e) => {
                  setMidiInputMode(e.target.value);
                  e.target.blur();
                }}
                title="MIDI input mode"
              >
                <option value="all">MIDI: All</option>
                <option value="none">MIDI: None</option>
                <option value="selected">MIDI: Selected</option>
              </select>

              {midiInputMode === "selected" && (
                <select
                  className="bg-neutral-900 text-white border border-white/20 rounded-lg px-2 py-1 text-sm max-w-[220px]"
                  value={selectedMidiInputId}
                  onChange={(e) => {
                    setSelectedMidiInputId(e.target.value);
                    e.target.blur();
                  }}
                  title="Selected MIDI input port"
                >
                  {midiInputs.length === 0 ? (
                    <option value="">No MIDI inputs</option>
                  ) : (
                    midiInputs.map((input) => (
                      <option key={input.id} value={input.id}>
                        {input.name}
                      </option>
                    ))
                  )}
                </select>
              )}

              <button className={buttonClass} onClick={refreshMidiInputs}>
                Refresh MIDI
              </button>
            </>
          ) : (
            <span className="text-xs opacity-60">Web MIDI unavailable</span>
          )}

          <button
            className={buttonClass}
            onClick={() => {
              if (typeof engine.buildMultiFrom === "function") {
                engine.buildMultiFrom(chains[0], Array.from({ length: 16 }, (_, i) => i));
              } else {
                setChains((cc) => {
                  const template = cc[0] || [];
                  const all = Array.from({ length: 16 }, (_, ch) =>
                    template.map((m) => ({
                      ...m,
                      id: uid(m.kind) + `_ch${ch}`,
                      params: m.kind === "ks_source"
                        ? { ...m.params, ch: String(ch) }
                        : { ...m.params },
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

      {showSpectrogramCompare && (
        <div className="mb-4">
          <SpectrogramComparePanel engine={engine} />
        </div>
      )}

      {/* Main chain list */}
      <div className="relative border border-dashed border-white/20 rounded-2xl p-4">
        {chains.map((chain, chainIdx) => {
          const locked = isChainLocked(chainIdx);

          return (
            <div
              key={chainIdx}
              className={`relative mb-6 rounded-lg p-2 overflow-hidden ${
                locked ? "bg-neutral-900/60 border border-yellow-500/40" : ""
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <div className="text-sm opacity-80">
                  {chainMeta[chainIdx]?.name ?? `Chain #${chainIdx + 1}`}
                </div>

                {locked && (
                  <span
                    className="text-xs px-2 py-0.5 rounded border border-yellow-400 text-yellow-400 bg-transparent opacity-100"
                    title="This chain is locked (GUI editing disabled)"
                  >
                    🔒 Locked
                  </span>
                )}

                <div className="flex gap-2 items-center">
                  <button
                    className={buttonClass}
                    onClick={() => toggleChainMute(chainIdx)}
                    title={chainMutes[chainIdx] ? "Unmute chain" : "Mute chain"}
                  >
                    {chainMutes[chainIdx] ? "🔇" : "🔊"}
                  </button>

                  <button
                    className={buttonClass}
                    onClick={() => exportChain(chainIdx)}
                  >
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

              <div className="relative rounded-xl overflow-hidden">
                <div
                  className="pointer-events-none absolute inset-y-0 left-0 w-32 z-10 transition-opacity duration-150"
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

                <div
                  className="pointer-events-none absolute inset-y-0 right-0 w-32 z-10 transition-opacity duration-150"
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
                          runtimeInfo={mod.kind === "ks_source" ? ksRuntimeInfo[mod.id] || null : null}
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

        <div className="mt-2 flex justify-center">
          <button className={buttonClass} onClick={addChain}>
            + Add chain
          </button>
        </div>
      </div>

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