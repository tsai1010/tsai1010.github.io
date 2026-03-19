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

function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}

function countDecimals(n) {
  const s = String(n ?? "");
  if (!s.includes(".")) return 0;
  return s.split(".")[1].length;
}

function formatNumber(value, step = 0.01) {
  if (!Number.isFinite(value)) return "";
  const decimals = Math.min(6, Math.max(0, countDecimals(step)));
  return Number(value).toFixed(decimals);
}

function SyncedNumberInput({
  value,
  min,
  max,
  step = 0.01,
  onCommit,
  suffix,
  className = "",
}) {
  const a = Number(min ?? 0);
  const b = Number(max ?? 1);
  const s = Number(step ?? 0.01);
  const numericValue = Number.isFinite(Number(value)) ? Number(value) : a;
  const clampedValue = clamp(numericValue, a, b);

  const [inputValue, setInputValue] = useState(formatNumber(clampedValue, s));

  useEffect(() => {
    setInputValue(formatNumber(clampedValue, s));
  }, [clampedValue, s]);

  const commitInput = () => {
    let parsed = Number(inputValue);

    if (inputValue === "" || Number.isNaN(parsed)) {
      setInputValue(formatNumber(clampedValue, s));
      return;
    }

    parsed = clamp(parsed, a, b);

    if (s > 0) {
      parsed = Math.round(parsed / s) * s;
      parsed = clamp(parsed, a, b);
    }

    onCommit(parsed);
    setInputValue(formatNumber(parsed, s));
  };

  return (
    <div className={`flex items-center gap-1 ${className}`}>
      <input
        type="number"
        className="w-20 bg-neutral-900 text-white border border-white/20 rounded-lg px-2 py-1 text-xs text-right tabular-nums"
        min={a}
        max={b}
        step={s}
        value={inputValue}
        onChange={(e) => setInputValue(e.target.value)}
        onBlur={commitInput}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            commitInput();
            e.currentTarget.blur();
          }
          if (e.key === "Escape") {
            setInputValue(formatNumber(clampedValue, s));
            e.currentTarget.blur();
          }
        }}
      />
      {suffix ? (
        <span className="text-xs opacity-70 w-8">{suffix}</span>
      ) : null}
    </div>
  );
}

export default function AudioPatchbay({
  synth,
  buttonTarget,
  autoTailwind = false,
  showButton = true,
  initialState,
  onChange,
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const resumeAll = async () => {
      try {
        await __RC_HANDLE__?.engine?.resume?.();
        if (window.synth?.actx?.state === "suspended") await window.synth.actx.resume();
      } catch (e) {
        console.warn("[RC] resumeAll failed", e);
      }
    };
    resumeAll();
  }, [open]);

  const [masterVol, setMasterVol] = useState(() => {
    if (typeof synth?.masterVol === "number") return Number(synth.masterVol);
    return 0.3;
  });

  const [a4, setA4] = useState(() => synth?.a4_freq ?? 440);

  useEffect(() => {
    if (typeof synth?.a4_freq === "number") setA4(Number(synth.a4_freq));
    if (typeof synth?.masterVol === "number") setMasterVol(Number(synth.masterVol));
  }, [synth]);

  useEffect(() => {
    let last = a4;
    const id = setInterval(() => {
      const cur = Number(synth?.a4_freq ?? 440);
      if (!Number.isNaN(cur) && cur !== last) {
        last = cur;
        setA4(cur);
      }
    }, 250);
    return () => clearInterval(id);
  }, [synth, a4]);

  useEffect(() => {
    let last = masterVol;
    const id = setInterval(() => {
      const cur = Number(synth?.masterVol ?? 0.3);
      if (!Number.isNaN(cur) && cur !== last) {
        last = cur;
        setMasterVol(cur);
      }
    }, 250);
    return () => clearInterval(id);
  }, [synth, masterVol]);

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

  const ButtonPortal = () => (
    <button
      className="rc-toggle-btn"
      onClick={async () => {
        requestAnimationFrame(() => setOpen(true));
        try {
          await __RC_HANDLE__?.engine?.resume?.();
          if (window.synth?.actx?.state === "suspended") await window.synth.actx.resume();
        } catch (e) {}
      }}
      title="Open Routing Composer"
    >
      Routing Composer
    </button>
  );

  const setA4Value = (v) => {
    const next = clamp(Number(v), 420, 460);
    if (Number.isNaN(next)) return;
    setA4(next);
    if (synth) synth.a4_freq = next;
  };

  const setMasterVolValue = (v) => {
    const next = clamp(Number(v), 0, 1);
    if (Number.isNaN(next)) return;
    setMasterVol(next);
    if (synth?.setMasterVol) {
      synth.setMasterVol(next);
    } else if (synth) {
      synth.masterVol = next;
    }
  };

  return (
    <div>
      <style>{`
        :root { --rc-bg1:#0f1022; --rc-bg2:#2a2b55; --rc-card:rgba(22,22,34,.92); --rc-border:rgba(255,255,255,.1); --rc-text:#f5f7ff; }

        :root {
          --rc-toggle-text: #38bdf8;
        }

        @media (prefers-color-scheme: dark) {
          :root {
            --rc-toggle-text: #7dd3fc;
          }
        }

        .rc-toggle-btn {
          color: var(--rc-toggle-text) !important;
        }

        .rc-toggle-btn {
          padding:10px 14px;
          border-radius:999px;
          border:1px solid var(--rc-border);
          background:rgba(255,255,255,.08);
          color:var(--rc-text);
          box-shadow:0 6px 24px rgba(0,0,0,.35);
          cursor:pointer;
          z-index:9999;
        }

        .rc-toggle-btn:hover { background:rgba(255,255,255,.12); }

        .rc-overlay {
          position:fixed;
          inset:0;
          background:rgba(0,0,0,.45);
          display:flex;
          align-items:center;
          justify-content:center;
          z-index:9998;
        }

        .rc-panel {
          width:min(1120px,96vw);
          height:min(88vh,900px);
          background:var(--rc-card);
          border:1px solid var(--rc-border);
          border-radius:18px;
          box-shadow:0 20px 60px rgba(0,0,0,.5);
          color:var(--rc-text);
          display:flex;
          flex-direction:column;
          overflow:hidden;
        }

        .rc-header {
          display:flex;
          align-items:center;
          justify-content:space-between;
          padding:14px 16px;
          border-bottom:1px solid var(--rc-border);
          font-weight:700;
          letter-spacing:.2px;
        }

        .rc-close {
          padding:8px 12px;
          border-radius:10px;
          border:1px solid var(--rc-border);
          background:rgba(255,255,255,.06);
          color:var(--rc-text);
          cursor:pointer;
        }

        .rc-close:hover { background:rgba(255,255,255,.1); }

        .rc-body { flex:1; overflow:auto; padding:8px 10px; }
        .rc-fixed-default { position:fixed; top:12px; left:12px; }

        .rc-slider {
          -webkit-appearance: none;
          appearance: none;
          width: 100%;
          height: 6px;
          border-radius: 5px;
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

        .rc-slider::-webkit-slider-runnable-track {
          height: 6px;
          background: transparent;
          border-radius: 5px;
        }

        .rc-slider::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 14px;
          height: 14px;
          border-radius: 50%;
          background: radial-gradient(circle at 30% 30%, #fff 10%, hsla(285, 80%, 75%, 1) 60%);
          box-shadow: 0 0 4px rgba(255,255,255,0.5);
          cursor: pointer;
          margin-top: -4px;
        }

        .rc-slider::-moz-range-track {
          height: 6px;
          background: rgba(255,255,255,0.12);
          border: none;
          border-radius: 5px;
        }

        .rc-slider::-moz-range-progress {
          height: 6px;
          background: linear-gradient(15deg,
            hsla(275, 70%, 35%, 1) 20%,
            hsla(280, 70%, 60%, 1) 50%,
            hsla(285, 70%, 80%, 1) 80%);
          border-radius: 5px 0 0 5px;
        }

        .rc-slider::-moz-range-thumb {
          width: 14px;
          height: 14px;
          border: none;
          border-radius: 50%;
          background: radial-gradient(circle at 30% 30%, #fff 10%, hsla(285, 80%, 75%, 1) 60%);
          box-shadow: 0 0 4px rgba(255,255,255,0.5);
          cursor: pointer;
        }

        .rc-overlay::before {
          content: "";
          position: absolute;
          inset: 0;
          background: linear-gradient(135deg,#0b0d1f99,#272b5277);
          opacity: .9;
          pointer-events: none;
        }

        input[type=range] { accent-color: #3b82f6; }

        /* remove number spinners */
        input[type=number]::-webkit-inner-spin-button,
        input[type=number]::-webkit-outer-spin-button {
          -webkit-appearance: none;
          margin: 0;
        }

        input[type=number] {
          -moz-appearance: textfield;
          appearance: textfield;
        }
      `}</style>

      {showButton && (
        buttonTarget
          ? ReactDOM.createPortal(<ButtonPortal />, buttonTarget)
          : (
              <div className="rc-fixed-default">
                <ButtonPortal />
              </div>
            )
      )}

      <div
        className="rc-overlay"
        style={{ display: open ? "flex" : "none" }}
        onClick={(e) => {
          if (e.target === e.currentTarget) setOpen(false);
        }}
      >
        <div className="rc-panel" role="dialog" aria-modal="true">
          <div className="rc-header">
            <div className="flex items-center gap-4 flex-wrap">
              <div>Routing Composer</div>

              <div className="flex items-center gap-2 text-sm opacity-90">
                <span>A4</span>
                <input
                  type="range"
                  min="420"
                  max="460"
                  step="0.1"
                  value={a4}
                  className="rc-slider"
                  style={{ "--rc-pos": `${((a4 - 420) / 40) * 100}%`, width: 160 }}
                  onChange={(e) => setA4Value(e.target.value)}
                />
                <SyncedNumberInput
                  value={a4}
                  min={420}
                  max={460}
                  step={0.1}
                  suffix="Hz"
                  onCommit={setA4Value}
                />
              </div>

              <div className="flex items-center gap-2 text-sm opacity-90">
                <span>Vol</span>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={masterVol}
                  className="rc-slider"
                  style={{ "--rc-pos": `${masterVol * 100}%`, width: 160 }}
                  onChange={(e) => setMasterVolValue(e.target.value)}
                />
                <SyncedNumberInput
                  value={masterVol}
                  min={0}
                  max={1}
                  step={0.01}
                  suffix=""
                  onCommit={setMasterVolValue}
                />
                <span className="w-12 text-xs opacity-80 tabular-nums text-right">
                  {(masterVol * 100).toFixed(0)}%
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                className="rc-close"
                onClick={() => synth?.actx?.resume?.()}
              >
                Resume Audio
              </button>

              <button className="rc-close" onClick={() => setOpen(false)}>
                Close
              </button>
            </div>
          </div>

          <div className="rc-body">
            <ChainEditor
              synth={synth}
              initialState={initialState}
              onChange={onChange}
            />
          </div>
        </div>
      </div>
    </div>
  );
}