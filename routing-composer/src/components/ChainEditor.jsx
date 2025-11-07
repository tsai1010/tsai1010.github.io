// routing-composer/src/components/ChainEditor.jsx
// -------------------------------------------------------------
// Main GUI: manages multiple chains, drag/drop, duplication, deletion,
// import/export, and connects to AudioEngine + MidiSynth
// -------------------------------------------------------------

import React, { useEffect, useState, useRef } from "react";
import ChainModuleCard from "./ChainModuleCard.jsx";
import { AudioEngine } from "../core/AudioEngine.js";

// Tailwind base styles
const buttonClass =
  "px-3 py-1 rounded-xl border border-white/10 shadow hover:bg-white/5 active:scale-[.98] transition";
const cardClass =
  "rounded-2xl shadow-lg border border-white/10 bg-neutral-900/70 backdrop-blur p-3 select-none";

// 可改成獨立檔 registry
const MODULES = ["ks_source", "source", "filter", "delay", "reverb", "convolver_ir", "gain", "analyzer"];

const DEFAULT_PARAMS = {
  ks_source: { smoothingMode: "auto", smoothingFactor: 0.2, velScale: 1.0, seedNoiseType: "pink", useSynthA4: true, ch: "all", program: 0 },
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

export default function ChainEditor({ synth }) {
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

  // 全域 MIDI 入口（供 routingComposer.onNoteOn 呼叫）
  useEffect(() => {
    window.__RC_HANDLE__ = {
        midi: (data) => {
            try { engine.handleMIDIMsg && engine.handleMIDIMsg(data); console.log('[RC] MIDI -> engine', data); }
            catch (e) { console.warn('[RC] MIDI ingress failed', e); }
        },
        engine // ★ 讓你能在 Console 看到 engine.liveNodes
    };
    return () => { try { delete window.__RC_HANDLE__; } catch(_){} };
  }, [engine]);

  // 狀態：chains
  const [chains, setChains] = useState([
    [
      { id: uid("src"), kind: "source", enabled: true, params: { ...DEFAULT_PARAMS.source } },
      { id: uid("gain"), kind: "gain", enabled: true, params: { ...DEFAULT_PARAMS.gain } },
      { id: uid("an"), kind: "analyzer", enabled: true, params: {} },
    ],
  ]);

  // 刪除確認彈窗
  const [confirmDel, setConfirmDel] = useState({ open: false, idx: null, step: 1 });
  const requestDeleteChain = (idx) => setConfirmDel({ open: true, idx, step: 1 });
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
    } catch (e) {
        console.warn('[RC] buildMany failed', e);
    }
  }, [JSON.stringify(chains)]);

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
  const onAdd = (chainIdx, kind) =>
    setChains((cc) => {
      const copy = cc.map((c) => [...c]);
      copy[chainIdx] = [
        ...copy[chainIdx],
        { id: uid(kind), kind, enabled: true, params: { ...DEFAULT_PARAMS[kind] } },
      ];
      return copy;
    });

  const onToggle = (chainIdx, id) =>
    setChains((cc) =>
      cc.map((c, i) =>
        i !== chainIdx
          ? c
          : c.map((m) => (m.id === id ? { ...m, enabled: !m.enabled } : m))
      )
    );

  const onRemove = (chainIdx, id) =>
    setChains((cc) =>
      cc.map((c, i) => (i !== chainIdx ? c : c.filter((m) => m.id !== id)))
    );

  const onParam = (chainIdx, id, k, v) =>{
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
    setDrag({ chain: chainIdx, from: modIdx });
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", `${chainIdx}:${modIdx}`);
  };
  const onDropCard = (chainIdx, modIdx) => (e) => {
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
          {MODULES.map((k) => (
            <button
              key={`add-${k}`}
              className={buttonClass}
              onClick={() => onAdd(0, k)}
            >
              + {k}
            </button>
          ))}
          <button className={buttonClass} onClick={() => engine.resume()}>
            Resume Audio
          </button>
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
        {chains.map((chain, chainIdx) => (
          <div key={chainIdx} className="mb-6">
            <div className="flex items-center justify-between mb-2">
              <div className="text-sm opacity-80">Chain #{chainIdx + 1}</div>
              <div className="flex gap-2">
                <button className={buttonClass} onClick={() => duplicateChain(chainIdx)}>
                  Duplicate chain
                </button>
                <button className={buttonClass} onClick={() => requestDeleteChain(chainIdx)}>
                  Delete chain
                </button>
              </div>
            </div>

            <div className="flex gap-3 items-stretch">
              {chain.map((mod, modIdx) => (
                <div
                  key={mod.id}
                  draggable
                  onDragStart={onDragStartCard(chainIdx, modIdx)}
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
        ))}
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
