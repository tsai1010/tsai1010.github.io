// routing-composer/src/components/ChainModuleCard.jsx
// -------------------------------------------------------------
// Single module card UI (params panel per kind)
// Props:
//   - mod: { id, kind, enabled, params }
//   - onToggle(): void
//   - onRemove(): void
//   - onParam(key, value): void
// -------------------------------------------------------------

import React, { useEffect, useState } from "react";

// (可集中到 ui/tokens.js，暫時放這裡方便開始)
const cardClass =
  "rounded-2xl shadow-lg border border-white/10 bg-neutral-900/70 backdrop-blur p-3 select-none";
const buttonClass =
  "px-3 py-1 rounded-xl border border-white/10 shadow hover:bg-white/5 active:scale-[.98] transition";

// ------------------------------
// helpers
// ------------------------------
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

// 小工具滑桿 + 數字輸入
function ParamSlider({
  label,
  min,
  max,
  step = 0.01,
  value,
  onChange,
  suffix,
}) {
  const a = Number(min ?? 0);
  const b = Number(max ?? 1);
  const s = Number(step ?? 0.01);

  const numericValue = Number.isFinite(Number(value)) ? Number(value) : a;
  const clampedValue = clamp(numericValue, a, b);
  const pos = Math.max(0, Math.min(1, (clampedValue - a) / (b - a))) * 100;

  const [inputValue, setInputValue] = useState(formatNumber(clampedValue, s));

  // 外部 value 改變時，同步更新 input 顯示
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

    // 依 step 做對齊
    if (s > 0) {
      parsed = Math.round(parsed / s) * s;
      parsed = clamp(parsed, a, b);
    }

    onChange(parsed);
    setInputValue(formatNumber(parsed, s));
  };

  return (
    <div className="flex items-center gap-3">
      <div className="w-24 text-sm opacity-80">{label}</div>

      <input
        type="range"
        className="w-40 rc-slider"
        min={a}
        max={b}
        step={s}
        value={clampedValue}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (Number.isNaN(v)) return;
          onChange(v);
        }}
        onMouseUp={(e) => e.currentTarget.blur()}
        onTouchEnd={(e) => e.currentTarget.blur()}
        style={{ "--rc-pos": `${pos}%` }}
      />

      <div className="flex items-center gap-1 w-24">
        <input
          type="number"
          className="w-16 bg-neutral-900 text-white border border-white/20 rounded-lg px-2 py-1 text-xs text-right tabular-nums"
          min={a}
          max={b}
          step={s}
          value={inputValue}
          onChange={(e) => {
            setInputValue(e.target.value);
          }}
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
          <span className="text-xs opacity-60 w-6">{suffix}</span>
        ) : (
          <span className="w-6" />
        )}
      </div>
    </div>
  );
}

export default function ChainModuleCard({
  mod,
  runtimeInfo = null,
  onToggle,
  onRemove,
  onParam,
  onDragStart,
}) {
  const { kind, enabled, params = {} } = mod;

  return (
    <div className={`${cardClass} w-[300px]`}>
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
          <button
            className={buttonClass}
            onClick={onRemove}
            title="Remove module"
          >
            ×
          </button>
        </div>
      </div>

      <div className="mt-2 text-xs opacity-70">
        {enabled ? "active" : "bypassed"}
      </div>

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
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>

            {String(params.smoothingMode ?? "auto") === "auto" && (
              <div className="flex items-center gap-2">
                <div className="w-24 text-sm opacity-80">Profile</div>
                <select
                  className="bg-neutral-900 text-white border border-white/20 rounded-lg px-2 py-1 text-sm"
                  value={String(params.autoSmoothingProfile ?? "steel")}
                  onChange={(e) => {
                    onParam("autoSmoothingProfile", e.target.value);
                    e.target.blur();
                  }}
                >
                  <option value="steel">steel</option>
                  <option value="nylon">nylon</option>
                </select>
              </div>
            )}

            {/* Manual smoothing slider */}
            {String(params.smoothingMode ?? "auto") === "manual" && (
              <ParamSlider
                label="smooth"
                min={0}
                max={1}
                step={0.001}
                value={Number(params.smoothingFactor ?? 0.2)}
                onChange={(v) => onParam("smoothingFactor", v)}
              />
            )}

            {String(params.smoothingMode ?? "auto") === "auto" && (
              <ParamSlider
                label="offset"
                min={-0.2}
                max={0.2}
                step={0.001}
                value={Number(params.smoothingOffset ?? 0)}
                onChange={(v) => onParam("smoothingOffset", v)}
              />
            )}

            {String(params.smoothingMode ?? "auto") === "auto" && (
              <div className="rounded-lg border border-white/10 bg-black/15 px-3 py-2 text-xs space-y-1">
                <div className="flex justify-between gap-4">
                  <span className="opacity-70">Auto</span>
                  <span className="tabular-nums">
                    {Number.isFinite(Number(runtimeInfo?.autoSmooth))
                      ? Number(runtimeInfo.autoSmooth).toFixed(3)
                      : "—"}
                  </span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="opacity-70">Final</span>
                  <span className="tabular-nums">
                    {Number.isFinite(Number(runtimeInfo?.finalSmooth))
                      ? Number(runtimeInfo.finalSmooth).toFixed(3)
                      : "—"}
                  </span>
                </div>
              </div>
            )}

            {/* Velocity scale */}
            <ParamSlider
              label="velScale"
              min={0}
              max={1}
              step={0.01}
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

            {/* Seed type */}
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
                  <option key={i} value={String(i)}>
                    {i}
                  </option>
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
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>

            {/* ADSR */}
            <ParamSlider
              label="attack"
              min={0}
              max={0.2}
              step={0.001}
              value={Number(mod.params.adsr?.a ?? 0.003)}
              onChange={(v) =>
                onParam("adsr", { ...(mod.params.adsr || {}), a: v })
              }
            />
            <ParamSlider
              label="decay"
              min={0}
              max={1.0}
              step={0.01}
              value={Number(mod.params.adsr?.d ?? 0.08)}
              onChange={(v) =>
                onParam("adsr", { ...(mod.params.adsr || {}), d: v })
              }
            />
            <ParamSlider
              label="sustain"
              min={0}
              max={1.0}
              step={0.01}
              value={Number(mod.params.adsr?.s ?? 0.4)}
              onChange={(v) =>
                onParam("adsr", { ...(mod.params.adsr || {}), s: v })
              }
            />
            <ParamSlider
              label="release"
              min={0}
              max={2.0}
              step={0.01}
              value={Number(mod.params.adsr?.r ?? 0.2)}
              onChange={(v) =>
                onParam("adsr", { ...(mod.params.adsr || {}), r: v })
              }
            />
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
              step={1}
              value={Number(params.freq ?? 1200)}
              onChange={(v) => onParam("freq", v)}
            />
            <ParamSlider
              label="Q"
              min={0.1}
              max={20}
              step={0.01}
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
              step={0.01}
              value={Number(params.time ?? 0.25)}
              onChange={(v) => onParam("time", v)}
            />
            <ParamSlider
              label="feedback"
              min={0}
              max={0.95}
              step={0.01}
              value={Number(params.feedback ?? 0.35)}
              onChange={(v) => onParam("feedback", v)}
            />
            <ParamSlider
              label="mix"
              min={0}
              max={1}
              step={0.01}
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
              step={0.1}
              value={Number(params.decay ?? 2)}
              onChange={(v) => onParam("decay", v)}
            />
            <ParamSlider
              label="mix"
              min={0}
              max={1}
              step={0.01}
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
              step={0.01}
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
            step={0.01}
            value={Number(params.gain ?? 0.8)}
            onChange={(v) => onParam("gain", v)}
          />
        )}

        {/* analyzer */}
        {kind === "analyzer" && (
          <div className="text-xs opacity-70">
            tap to scope (no sound change)
          </div>
        )}
      </div>
    </div>
  );
}