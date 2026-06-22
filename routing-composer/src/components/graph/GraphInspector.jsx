import React, { useEffect, useState } from "react";

function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}

function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function ParamSlider({ label, value, min, max, step = 0.01, suffix = "", onChange }) {
  const safe = clamp(num(value, min), min, max);
  const [text, setText] = useState(String(Number(safe.toFixed(4))));
  useEffect(() => setText(String(Number(safe.toFixed(4)))), [safe]);
  const commit = () => {
    const v = clamp(num(text, safe), min, max);
    onChange(v);
    setText(String(Number(v.toFixed(4))));
  };
  return (
    <div className="rcg-param">
      <label><span>{label}</span><span>{Number(safe).toFixed(step < 0.01 ? 3 : 2)}{suffix}</span></label>
      <div className="rcg-param-row">
        <input type="range" min={min} max={max} step={step} value={safe} onChange={(e) => onChange(Number(e.target.value))} />
        <input className="rcg-num" value={text} onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === "Enter") commit(); }} />
      </div>
    </div>
  );
}

function SelectParam({ label, value, options, onChange }) {
  return (
    <div className="rcg-param">
      <label><span>{label}</span></label>
      <select value={String(value)} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => <option key={o.value ?? o} value={o.value ?? o}>{o.label ?? o}</option>)}
      </select>
    </div>
  );
}

function TextParam({ label, value, onChange }) {
  return (
    <div className="rcg-param">
      <label><span>{label}</span></label>
      <input type="text" value={value ?? ""} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

function ADSR({ adsr = {}, onChange }) {
  const update = (k, v) => onChange({ ...adsr, [k]: v });
  return (
    <>
      <ParamSlider label="Attack" min={0.001} max={2} step={0.001} value={adsr.a ?? 0.003} suffix="s" onChange={(v) => update("a", v)} />
      <ParamSlider label="Decay" min={0.001} max={4} step={0.001} value={adsr.d ?? 0.08} suffix="s" onChange={(v) => update("d", v)} />
      <ParamSlider label="Sustain" min={0} max={1} step={0.01} value={adsr.s ?? 0.4} onChange={(v) => update("s", v)} />
      <ParamSlider label="Release" min={0.001} max={4} step={0.001} value={adsr.r ?? 0.2} suffix="s" onChange={(v) => update("r", v)} />
    </>
  );
}

export default function GraphInspector({ selectedNode, selectedEdge, onParam, onNodePatch, onDeleteNode, onDeleteEdge }) {
  if (selectedEdge) {
    return (
      <aside className="rcg-inspector">
        <div className="rcg-insp-title">Connection</div>
        <div className="rcg-insp-body">
          <div className="rcg-sub">{selectedEdge.from} out → {selectedEdge.to} in</div>
          <button className="rcg-btn rcg-danger" onClick={() => onDeleteEdge(selectedEdge.id)}>Delete connection</button>
          <div className="rcg-help">也可以選線後按 Delete / Backspace。</div>
        </div>
      </aside>
    );
  }

  if (!selectedNode) {
    return (
      <aside className="rcg-inspector">
        <div className="rcg-insp-title">Inspector</div>
        <div className="rcg-empty">
          <div>
            Select a module
            <div className="rcg-help">Right-click empty space to add modules.<br/>Drag out → in to connect.<br/>Right-click a line to delete.</div>
          </div>
        </div>
      </aside>
    );
  }

  const p = selectedNode.params || {};
  const patchParam = (key, value) => onParam(selectedNode.id, key, value);

  return (
    <aside className="rcg-inspector">
      <div className="rcg-insp-title">{selectedNode.kind}</div>
      <div className="rcg-insp-body">
        {selectedNode.kind === "ks_source" && (
          <>
            <SelectParam label="smoothing" value={p.smoothingMode ?? "auto"} options={["auto", "manual"]} onChange={(v) => patchParam("smoothingMode", v)} />
            {(p.smoothingMode ?? "auto") === "auto" && (
              <SelectParam label="Profile" value={p.autoSmoothingProfile ?? "steel"} options={["steel", "nylon"]} onChange={(v) => patchParam("autoSmoothingProfile", v)} />
            )}
            {(p.smoothingMode ?? "auto") === "manual" && (
              <ParamSlider label="smooth" min={0} max={1} step={0.001} value={p.smoothingFactor ?? 0.2} onChange={(v) => patchParam("smoothingFactor", v)} />
            )}
            {(p.smoothingMode ?? "auto") === "auto" && (
              <ParamSlider label="offset" min={-0.2} max={0.2} step={0.001} value={p.smoothingOffset ?? 0} onChange={(v) => patchParam("smoothingOffset", v)} />
            )}
            <ParamSlider label="velScale" min={0} max={1} step={0.01} value={p.velScale ?? 1} onChange={(v) => patchParam("velScale", v)} />
            <ParamSlider label="KS dur" min={0.1} max={10} step={0.1} value={p.ksDurSec ?? 1} suffix="s" onChange={(v) => patchParam("ksDurSec", v)} />
            <ParamSlider label="Release" min={0} max={1} step={0.01} value={p.ksRelease ?? 0.5} onChange={(v) => patchParam("ksRelease", v)} />
            <SelectParam label="Noise" value={p.seedNoiseType ?? "pink"} options={["brown", "softBrown", "red", "pink", "softPink", "white", "blue", "violet", "wind", "perlin", "grey"]} onChange={(v) => patchParam("seedNoiseType", v)} />
          </>
        )}

        {selectedNode.kind === "source" && (
          <>
            <SelectParam label="type" value={p.type ?? "sawtooth"} options={["sine", "sawtooth", "square", "triangle"]} onChange={(v) => patchParam("type", v)} />
            <ParamSlider label="level" min={0} max={1} step={0.01} value={p.level ?? 0.15} onChange={(v) => patchParam("level", v)} />
            <ADSR adsr={p.adsr || {}} onChange={(v) => patchParam("adsr", v)} />
          </>
        )}

        {selectedNode.kind === "filter" && (
          <>
            <SelectParam label="mode" value={p.mode ?? "lowpass"} options={["lowpass", "highpass", "bandpass", "notch", "lowshelf", "highshelf", "peaking", "allpass"]} onChange={(v) => patchParam("mode", v)} />
            <ParamSlider label="freq" min={20} max={20000} step={1} value={p.freq ?? 1200} suffix="Hz" onChange={(v) => patchParam("freq", v)} />
            <ParamSlider label="Q" min={0.001} max={20} step={0.001} value={p.q ?? 0.7} onChange={(v) => patchParam("q", v)} />
            {(p.mode === "lowshelf" || p.mode === "highshelf" || p.mode === "peaking") && (
              <ParamSlider label="gain" min={-24} max={24} step={0.1} value={p.gain ?? 0} suffix="dB" onChange={(v) => patchParam("gain", v)} />
            )}
          </>
        )}

        {selectedNode.kind === "delay" && (
          <>
            <ParamSlider label="time" min={0} max={2} step={0.001} value={p.time ?? 0.25} suffix="s" onChange={(v) => patchParam("time", v)} />
            <ParamSlider label="feedback" min={0} max={0.95} step={0.01} value={p.feedback ?? 0.35} onChange={(v) => patchParam("feedback", v)} />
            <ParamSlider label="mix" min={0} max={1} step={0.01} value={p.mix ?? 0.3} onChange={(v) => patchParam("mix", v)} />
          </>
        )}

        {selectedNode.kind === "gain" && (
          <ParamSlider label="gain" min={0} max={3} step={0.01} value={p.gain ?? 0.8} onChange={(v) => patchParam("gain", v)} />
        )}

        {selectedNode.kind === "convolver_ir" && (
          <>
            <SelectParam label="IR" value={p.irId ?? "IR_Gibson"} options={["IR_Gibson", "IR_piezo"]} onChange={(v) => patchParam("irId", v)} />
            <ParamSlider label="mix" min={0} max={1} step={0.01} value={p.mix ?? 0.3} onChange={(v) => patchParam("mix", v)} />
          </>
        )}

        {selectedNode.kind === "reverb" && (
          <>
            <ParamSlider label="decay" min={0.1} max={8} step={0.1} value={p.decay ?? 2} suffix="s" onChange={(v) => patchParam("decay", v)} />
            <ParamSlider label="mix" min={0} max={1} step={0.01} value={p.mix ?? 0.25} onChange={(v) => patchParam("mix", v)} />
          </>
        )}

        {selectedNode.kind === "analyzer" && <div className="rcg-help">Analyzer taps the signal for visualization/capture.</div>}
        {selectedNode.kind === "output" && <div className="rcg-help">Output is the end point of this chain.</div>}

        <label className="rcg-check"><input type="checkbox" checked={selectedNode.enabled !== false} onChange={(e) => onNodePatch(selectedNode.id, { enabled: e.target.checked })} /> enabled</label>
        {selectedNode.kind !== "output" && (
          <button className="rcg-btn rcg-danger" onClick={() => onDeleteNode(selectedNode.id)}>Delete module</button>
        )}
      </div>
    </aside>
  );
}
