// routing-composer/src/components/AudioPatchbay.jsx
// -------------------------------------------------------------
// Outer shell: a floating button that opens a modal panel
// Renders ChainEditor inside the panel
// Props:
//   - synth: your MidiSynth instance
//   - buttonTarget: HTMLElement (optional) — where the button portal mounts
//   - autoTailwind: boolean — auto-inject Tailwind CDN (default false)
// -------------------------------------------------------------

import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom";
import ChainEditor from "./ChainEditor.jsx";

export default function AudioPatchbay({ synth, buttonTarget, autoTailwind = false }) {
  const [open, setOpen] = useState(false);

    const [a4, setA4] = useState(() => synth?.a4_freq ?? 440);
    useEffect(() => { if (typeof synth?.a4_freq === 'number') setA4(synth.a4_freq); }, [synth]);   
    
    // 計算百分比
    const a = 420, b = 460;
    const pos = Math.max(0, Math.min(1, (a4 - a) / (b - a))) * 100;

  // Optional: auto inject Tailwind CDN
  useEffect(() => {
    if (!autoTailwind) return;
    const hasTW =
      !!document.querySelector('script[data-rc-tailwind]') ||
      !!document.querySelector('script[src*="tailwindcss"]');
    if (hasTW) return;
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4";
    s.dataset.rcTailwind = "1";
    document.head.appendChild(s);
  }, [autoTailwind]);

  // Button component (can be portal-ed to buttonTarget)
  const ButtonPortal = () => (
    <button
      className="rc-toggle-btn"
      title="Open Routing Composer"
      onClick={() => setOpen(true)}
    >
      Routing Composer
    </button>
  );

  return (
    <div>
      <style>{`
        :root { --rc-bg1:#0f1022; --rc-bg2:#2a2b55; --rc-card:rgba(22,22,34,.92); --rc-border:rgba(255,255,255,.1); --rc-text:#f5f7ff; }
        .rc-toggle-btn { padding:10px 14px; border-radius:999px; border:1px solid var(--rc-border); background:rgba(255,255,255,.08); color:var(--rc-text); backdrop-filter:blur(8px); box-shadow:0 6px 24px rgba(0,0,0,.35); cursor:pointer; z-index:9999; }
        .rc-toggle-btn:hover { background:rgba(255,255,255,.12); }
        .rc-overlay { position:fixed; inset:0; background:rgba(0,0,0,.45); backdrop-filter:blur(2px); display:flex; align-items:center; justify-content:center; z-index:9998; }
        .rc-panel { width:min(1120px,96vw); height:min(88vh,900px); background:var(--rc-card); border:1px solid var(--rc-border); border-radius:18px; box-shadow:0 20px 60px rgba(0,0,0,.5); color:var(--rc-text); display:flex; flex-direction:column; overflow:hidden; }
        .rc-header { display:flex; align-items:center; justify-content:space-between; padding:14px 16px; border-bottom:1px solid var(--rc-border); font-weight:700; letter-spacing:.2px; }
        .rc-close { padding:8px 12px; border-radius:10px; border:1px solid var(--rc-border); background:rgba(255,255,255,.06); color:var(--rc-text); cursor:pointer; }
        .rc-close:hover { background:rgba(255,255,255,.1); }
        .rc-body { flex:1; overflow:auto; padding:8px 10px; }
        .rc-fixed-default { position:fixed; top:12px; left:12px; }
        /* === Gradient progress slider (cross-browser) === */
        .rc-slider {
            -webkit-appearance: none;
            appearance: none;
            width: 100%;
            height: 6px;
            border-radius: 5px;
            /* 兩層背景：前景=漸層(只畫到 --rc-pos)，底層=未填灰 */
            background:
                linear-gradient(15deg,
                hsla(275, 70%, 35%, 1) 20%,
                hsla(280, 70%, 60%, 1) 50%,
                hsla(285, 70%, 80%, 1) 80%) 0% 0% / var(--rc-pos, 0%) 100% no-repeat,
                rgba(255,255,255,0.12);
            outline: none;
            transition: filter .2s ease;
        }
        .rc-slider:active { filter: brightness(1.1); }

        /* Chrome / Edge 軌道 */
        .rc-slider::-webkit-slider-runnable-track {
            height: 6px;
            background: transparent; /* 讓上面 .rc-slider 的多重背景生效 */
            border-radius: 5px;
        }

        /* Chrome / Edge 拇指 */
        .rc-slider::-webkit-slider-thumb {
            -webkit-appearance: none;
            appearance: none;
            width: 14px;
            height: 14px;
            border-radius: 50%;
            background: radial-gradient(circle at 30% 30%, #fff 10%, hsla(285, 80%, 75%, 1) 60%);
            box-shadow: 0 0 4px rgba(255,255,255,0.5);
            cursor: pointer;
            margin-top: -4px; /* 讓拇指垂直置中軌道（依瀏覽器可微調） */
        }

        /* Firefox 軌道（未填） */
        .rc-slider::-moz-range-track {
            height: 6px;
            background: rgba(255,255,255,0.12);
            border: none;
            border-radius: 5px;
        }

        /* Firefox 已填部分（畫漸層） */
        .rc-slider::-moz-range-progress {
            height: 6px;
            background: linear-gradient(15deg,
                hsla(275, 70%, 35%, 1) 20%,
                hsla(280, 70%, 60%, 1) 50%,
                hsla(285, 70%, 80%, 1) 80%);
            border-radius: 5px 0 0 5px;
        }

        /* Firefox 拇指 */
        .rc-slider::-moz-range-thumb {
            width: 14px;
            height: 14px;
            border: none;
            border-radius: 50%;
            background: radial-gradient(circle at 30% 30%, #fff 10%, hsla(285, 80%, 75%, 1) 60%);
            box-shadow: 0 0 4px rgba(255,255,255,0.5);
            cursor: pointer;
        }
        input[type=range] { accent-color: #3b82f6; }
      `}</style>

      {/* Prefer mounting the button into a given target; fallback to fixed top-left */}
      {buttonTarget
        ? ReactDOM.createPortal(<ButtonPortal />, buttonTarget)
        : (
          <div className="rc-fixed-default">
            <ButtonPortal />
          </div>
        )
      }

      {/* Modal panel */}
      <div
        className="rc-overlay"
        style={{ display: open ? 'flex' : 'none' }}
        onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}
      >
        
        <div className="rc-panel" role="dialog" aria-modal="true">
          
            <div className="rc-header">
                <div className="flex items-center gap-4">
                    <div>Routing Composer</div>

                    {/* 全域 A4 調整 */}
                    <div className="flex items-center gap-2 text-sm opacity-90">
                    <span>A4</span>
                    <input
                        type="range"
                        min="420"
                        max="460"
                        step="0.1"
                        defaultValue={synth?.a4_freq ?? 440}
                        className="rc-slider"
                        style={{ "--rc-pos": `${pos}%`, width: 160 }}
                        onChange={(e) => {
                        const v = Number(e.target.value);
                        if (synth && typeof v === "number") synth.a4_freq = v;
                        }}
                    />
                    <span>{synth?.a4_freq?.toFixed?.(1) ?? 440}Hz</span>
                    </div>
                </div>

                <div className="flex items-center gap-2">
                    {/* Resume Audio 按鈕 */}
                    <button
                    className="rc-close"
                    style={{ background: "rgba(255,255,255,0.1)" }}
                    onClick={() => synth?.actx?.resume?.()}
                    >
                    Resume Audio
                    </button>

                    {/* Close */}
                    <button className="rc-close" onClick={() => setOpen(false)}>Close</button>
                </div>
            </div>

          <div className="rc-body">
            <ChainEditor synth={synth} />
          </div>
        </div>
      </div>

    </div>
  );
}
