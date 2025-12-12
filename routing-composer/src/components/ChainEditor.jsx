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

export default function ChainEditor({ 
  synth,
  initialState,
  onChange, 
}) {
  const engineRef = useRef(null);
  if (!engineRef.current) engineRef.current = new AudioEngine();
  const engine = engineRef.current;

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

      console.log("[RC] routing loaded from URL:", url);
    } catch (e) {
      console.warn("[RC] loadFromURL failed:", e);
    }
  };

  async function loadChainFromURL(chainIdx, url) {
    const idx = chainIdx | 0;
    if (idx < 0) return;
    if (isChainLocked(idx)) return;

    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();

      const normalized = normalizeSingleChain(json);
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
    const normalized = chain; // 這裡先直接用現有資料

    const blob = new Blob([JSON.stringify(normalized, null, 2)], {
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
    if (isChainLocked(chainIdx)) return;

    const text = await file.text();
    try {
      const arr = JSON.parse(text);
      if (!Array.isArray(arr)) return;

      // 重新產生 module id，避免與其他 chain 撞 id
      const normalized = arr.map((m) => ({
        id: uid(m.kind || "mod"),
        kind: m.kind || "gain",
        enabled: m.enabled !== false,
        params: m.params || {},
      }));

      setChains((cc) =>
        cc.map((c, i) => (i === idx ? normalized : c))
      );
    } catch (e) {
      console.warn("[RC] importChain failed", e);
    }
  };

  // 新增一條空的 chain（不含任何 module，預設無聲）
  const addChain = () =>
    setChains((cc) => [...cc, []]);


  // 匯出 / 匯入 JSON
  const exportJSON = () => {
    const blob = new Blob([JSON.stringify(chains, null, 2)], { type: "application/json" });
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
      const arr = JSON.parse(text);
      if (Array.isArray(arr) && Array.isArray(arr[0])) setChains(arr);
    } catch (e) {
      console.warn("Invalid chain JSON", e);
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
      <div className="relative border border-dashed border-white/20 rounded-2xl p-4 overflow-x-auto">
        {chains.map((chain, chainIdx) => {
          const locked = isChainLocked(chainIdx);

          return (
          <div
            key={chainIdx}
            className={`mb-6 rounded-lg p-2
              ${locked ? "bg-neutral-900/60 border border-yellow-500/40" : ""}`}
          >
            <div className="flex items-center justify-between mb-2">
              <div className="text-sm opacity-80">{chainMeta[chainIdx]?.name ?? `Chain #${chainIdx + 1}`}</div>
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

                {/* 保留原本的 Duplicate / Delete */}
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

            <div className="flex gap-3 items-stretch">
              {chain.map((mod, modIdx) => (
                <div
                  key={mod.id}
                  onDrop={onDropCard(chainIdx, modIdx)}
                  onDragOver={(e) => e.preventDefault()}
                  className="hover:border-white/20 transition border border-transparent rounded-2xl"
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
                className="w-12 rounded-xl border-2 border-dashed border-white/10 hover:border-white/20 flex items-center justify-center opacity-60"
                onDragOver={(e) => e.preventDefault()}
                onDrop={onDropToEnd(chainIdx)}
              >
                →
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
        )})}

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
