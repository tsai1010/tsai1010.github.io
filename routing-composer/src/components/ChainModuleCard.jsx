// routing-composer/src/components/ChainModuleCard.jsx
// -------------------------------------------------------------
// Single module card UI (params panel per kind)
// Props:
//   - mod: { id, kind, enabled, params }
//   - onToggle(): void
//   - onRemove(): void
//   - onParam(key, value): void
// -------------------------------------------------------------

import React from "react";

// (可集中到 ui/tokens.js，暫時放這裡方便開始)
const cardClass =
  "rounded-2xl shadow-lg border border-white/10 bg-neutral-900/70 backdrop-blur p-3 select-none";
const buttonClass =
  "px-3 py-1 rounded-xl border border-white/10 shadow hover:bg-white/5 active:scale-[.98] transition";

// 小工具滑桿
function ParamSlider({ label, min, max, step = 0.01, value, onChange, suffix }) {
    const shown =
        typeof value === "number"
            ? (Math.round(value * 100) / 100).toFixed(2)
            : String(value ?? "");
    const v = Number(value ?? 0);
    const a = Number(min ?? 0);
    const b = Number(max ?? 1);
    const pos = Math.max(0, Math.min(1, (v - a) / (b - a))) * 100; // 百分比

  return (
    <div className="flex items-center gap-3">
      <div className="w-24 text-sm opacity-80">{label}</div>
      <input
        type="range"
        className="w-48 rc-slider"
        min={min}
        max={max}
        step={step}
        value={Number(value ?? 0)}
        onChange={(e) => onChange(Number(e.target.value))}
        onMouseUp={(e) => e.currentTarget.blur()}
        onTouchEnd={(e) => e.currentTarget.blur()}
        style={{ "--rc-pos": `${pos}%` }}
      />
      <div className="w-20 tabular-nums text-right text-xs opacity-70">
        {shown}
        {suffix ? <span className="opacity-60">{suffix}</span> : null}
      </div>
    </div>
  );
}

export default function ChainModuleCard({ mod, onToggle, onRemove, onParam, onDragStart }) {
  const { kind, enabled, params = {} } = mod;

  return (
    <div className={`${cardClass} w-[280px]`}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {/* 拖動把手：只有這顆可以啟動拖曳 */}
          <div
            className="cursor-grab active:cursor-grabbing text-xs opacity-60 select-none"
            draggable={!!onDragStart}
            onDragStart={onDragStart}
            title="Drag to reorder"
          >
            ☰
          </div>
          <div className="font-semibold capitalize">{kind}</div>
        </div>
        <div className="flex gap-2">
          <button className={buttonClass} onClick={onToggle}>
            {enabled ? "Bypass" : "Enable"}
          </button>
          <button className={buttonClass} onClick={onRemove} title="Remove module">
            ×
          </button>
        </div>
      </div>
      <div className="mt-2 text-xs opacity-70">{enabled ? "active" : "bypassed"}</div>

      {/* Body */}
      <div className="mt-3 space-y-2">
        {/* ks_source params */}
        {kind === "ks_source" && (
          <>
            {/* MIDI ch */}
            <div className="flex items-center gap-2">
              <div className="w-24 text-sm opacity-80">MIDI ch</div>
              <select
                className="bg-neutral-900 text-white border border-white/20 rounded-lg px-2 py-1 text-sm"
                value={String(params.ch ?? "all")}
                onChange={(e) => {
                  onParam("ch", e.target.value);
                  e.target.blur();
                }}
              >
                <option value="all">all</option>
                {Array.from({ length: 16 }, (_, i) => (
                  <option key={i} value={String(i)}>
                    {i}
                  </option>
                ))}
              </select>
            </div>

            {/* Program match (含 all) */}
            <div className="flex items-center gap-2">
              <div className="w-24 text-sm opacity-80">Program</div>
              <select
                className="bg-neutral-900 text-white border border-white/20 rounded-lg px-2 py-1 text-sm"
                value={String(params.program ?? "all")}
                onChange={(e) => {
                  onParam("program", e.target.value);
                  e.target.blur();
                }}
              >
                <option value="all">all</option>
                {Array.from({ length: 128 }, (_, i) => (
                  <option key={i} value={String(i)}>
                    {i}
                  </option>
                ))}
              </select>
            </div>

            {/* Smoothing mode */}
            <div className="flex items-center gap-2">
              <div className="w-24 text-sm opacity-80">smoothing</div>
              <select
                className="bg-neutral-900 text-white border border-white/20 rounded-lg px-2 py-1 text-sm"
                value={String(params.smoothingMode ?? "auto")}
                onChange={(e) => {
                  onParam("smoothingMode", e.target.value);
                  e.target.blur();
                }}
              >
                {["auto", "manual"].map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>

            {/* Manual smoothing slider */}
            {String(params.smoothingMode ?? "auto") === "manual" && (
              <ParamSlider
                label="smooth"
                min={0}
                max={1}
                value={Number(params.smoothingFactor ?? 0.2)}
                onChange={(v) => onParam("smoothingFactor", v)}
              />
            )}

            {/* Velocity scale */}
            <ParamSlider
              label="velScale"
              min={0}
              max={1}
              value={Number(params.velScale ?? 1)}
              onChange={(v) => onParam("velScale", v)}
            />

            {/* KS Duration */}
            <ParamSlider
              label="KS dur"
              min={0.1}
              max={10}
              step={0.1}
              value={Number(params.ksDurSec ?? 1)}
              onChange={(v) => onParam("ksDurSec", v)}
              suffix="s"
            />

            {/* KS Release */}
            <ParamSlider
              label="Release"
              min={0}
              max={1}
              step={0.01}
              value={Number(params.ksRelease ?? 0.5)}
              onChange={(v) => onParam("ksRelease", v)}
            />

            {/* Seed type - 音樂化 Soft/Warm/Bright/Mix（擴充版） */}
            <div className="flex items-center gap-2">
              <div className="w-24 text-sm opacity-80">Noise</div>
              <select
                className="bg-neutral-900 text-white border border-white/20 rounded-lg px-2 py-1 text-sm"
                value={String(params.seedNoiseType ?? "pink")}
                onChange={(e) => {
                  onParam("seedNoiseType", e.target.value);
                  e.target.blur();
                }}
              >
                {/* 你原本的四種 */}
                <option value="brown">Soft</option>
                <option value="softBrown">Extra Soft</option>
                <option value="red">Deep Soft</option>

                <option value="pink">Warm</option>
                <option value="softPink">Warm Soft</option>

                <option value="white">Bright</option>

                <option value="blue">Airy</option>
                <option value="violet">Breathy</option>

                <option value="wind">Windy</option>
                <option value="perlin">Organic</option>
                <option value="formant">Body</option>
                <option value="dust">Dusty</option>
                <option value="wood">Woody</option>

                <option value="grey">Mix</option>
              </select>
            </div>



            {String(params.smoothingMode ?? "auto") === "auto" && (
              <div className="text-[11px] opacity-70">
                auto: smoothing 依據 synth.options[ch].stringDamping / variation 與 note 計算
              </div>
            )}
          </>
        )}


        {/* basic oscillator source */}
        {kind === "source" && (
          <>
            <div className="flex items-center gap-2">
                <div className="w-24 text-sm opacity-80">MIDI ch</div>
                <select
                    className="bg-neutral-900 text-white border border-white/20 rounded-lg px-2 py-1 text-sm"
                    value={String(mod.params.ch ?? "all")}
                    onChange={(e) => {
                      onParam("ch", e.target.value);
                      e.target.blur();
                    }}
                >
                    <option value="all">all</option>
                    {Array.from({ length: 16 }, (_, i) => (
                        <option key={i} value={String(i)}>{i}</option>
                ))}
                </select>
            </div>

            <div className="flex items-center gap-2">
                <div className="w-24 text-sm opacity-80">wave</div>
                <select
                    className="bg-neutral-900 text-white border border-white/20 rounded-lg px-2 py-1 text-sm"
                    value={String(mod.params.type)}
                    onChange={(e) => {
                      onParam("type", e.target.value);
                      e.target.blur();
                    }}
                >
                    {["sine", "square", "sawtooth", "triangle"].map((t) => (
                    <option key={t} value={t}>{t}</option>
                    ))}
                </select>
            </div>

            {/* ADSR */}
            <ParamSlider label="attack"  min={0} max={0.2}
                value={Number(mod.params.adsr?.a ?? 0.003)}
                onChange={(v) => onParam("adsr", { ...(mod.params.adsr||{}), a: v })} />
            <ParamSlider label="decay"   min={0} max={1.0}
                value={Number(mod.params.adsr?.d ?? 0.08)}
                onChange={(v) => onParam("adsr", { ...(mod.params.adsr||{}), d: v })} />
            <ParamSlider label="sustain" min={0} max={1.0}
                value={Number(mod.params.adsr?.s ?? 0.4)}
                onChange={(v) => onParam("adsr", { ...(mod.params.adsr||{}), s: v })} />
            <ParamSlider label="release" min={0} max={2.0}
                value={Number(mod.params.adsr?.r ?? 0.2)}
                onChange={(v) => onParam("adsr", { ...(mod.params.adsr||{}), r: v })} />
          </>
        )}

        {/* biquad filter */}
        {kind === "filter" && (
          <>
            <div className="flex items-center gap-2">
              <div className="w-24 text-sm opacity-80">mode</div>
              <select
                className="bg-neutral-900 text-white border border-white/20 rounded-lg px-2 py-1 text-sm"
                value={String(params.mode ?? "lowpass")}
                onChange={(e) => {
                  onParam("mode", e.target.value);
                  e.target.blur();
                }}
              >
                {["lowpass", "highpass", "bandpass", "notch"].map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
            <ParamSlider
              label="freq"
              min={50}
              max={12000}
              value={Number(params.freq ?? 1200)}
              onChange={(v) => onParam("freq", v)}
            />
            <ParamSlider
              label="Q"
              min={0.1}
              max={20}
              value={Number(params.q ?? 0.7)}
              onChange={(v) => onParam("q", v)}
            />
          </>
        )}

        {/* delay */}
        {kind === "delay" && (
          <>
            <ParamSlider
              label="time"
              min={0.01}
              max={1.2}
              value={Number(params.time ?? 0.25)}
              onChange={(v) => onParam("time", v)}
            />
            <ParamSlider
              label="feedback"
              min={0}
              max={0.95}
              value={Number(params.feedback ?? 0.35)}
              onChange={(v) => onParam("feedback", v)}
            />
            <ParamSlider
              label="mix"
              min={0}
              max={1}
              value={Number(params.mix ?? 0.3)}
              onChange={(v) => onParam("mix", v)}
            />
          </>
        )}

        {/* simple reverb */}
        {kind === "reverb" && (
          <>
            <ParamSlider
              label="decay"
              min={0.2}
              max={6}
              value={Number(params.decay ?? 2)}
              onChange={(v) => onParam("decay", v)}
            />
            <ParamSlider
              label="mix"
              min={0}
              max={1}
              value={Number(params.mix ?? 0.25)}
              onChange={(v) => onParam("mix", v)}
            />
          </>
        )}

        {/* convolver with IR catalog */}
        {kind === "convolver_ir" && (
          <>
            <div className="flex items-center gap-2">
              <div className="w-24 text-sm opacity-80">IR</div>
              <select
                className="bg-neutral-900 text-white border border-white/20 rounded-lg px-2 py-1 text-sm"
                value={String(params.irId ?? "IR_Gibson")}
                onChange={(e) => {
                  onParam("irId", e.target.value);
                  e.target.blur();
                }}
              >
                {/* 這裡先列出已知 key；若你有 registry，可改成動態 */}
                {["IR_Gibson", "IR_piezo"].map((id) => (
                  <option key={id} value={id}>
                    {id}
                  </option>
                ))}
              </select>
            </div>
            <ParamSlider
              label="mix"
              min={0}
              max={1}
              value={Number(params.mix ?? 0.3)}
              onChange={(v) => onParam("mix", v)}
            />
          </>
        )}

        {/* gain */}
        {kind === "gain" && (
          <ParamSlider
            label="gain"
            min={0}
            max={1.5}
            value={Number(params.gain ?? 0.8)}
            onChange={(v) => onParam("gain", v)}
          />
        )}

        {/* analyzer */}
        {kind === "analyzer" && (
          <div className="text-xs opacity-70">tap to scope (no sound change)</div>
        )}
      </div>
    </div>
  );
}
