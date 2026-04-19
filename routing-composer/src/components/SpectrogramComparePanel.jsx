import React, { useEffect, useMemo, useRef, useState } from "react";
import FFT from "fft.js";

const buttonClass =
  "px-3 py-1 rounded-xl border border-white/10 shadow hover:bg-white/5 active:scale-[.98] transition";

const panelClass =
  "rounded-2xl shadow-lg border border-white/10 bg-neutral-900/70 backdrop-blur p-4";

function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}

function rms(arr, start, end) {
  let sum = 0;
  const e = Math.min(arr.length, end);
  for (let i = start; i < e; i++) {
    const x = arr[i];
    sum += x * x;
  }
  const n = Math.max(1, e - start);
  return Math.sqrt(sum / n);
}

function downmixToMono(audioBuffer) {
  const channels = audioBuffer.numberOfChannels || 1;
  const length = audioBuffer.length;
  const out = new Float32Array(length);
  for (let ch = 0; ch < channels; ch++) {
    const data = audioBuffer.getChannelData(ch);
    for (let i = 0; i < length; i++) out[i] += data[i] / channels;
  }
  return out;
}

function trimByOnsets(samples, sampleRate) {
  if (!samples?.length || !sampleRate) return null;

  const frameSize = 1024;
  const hop = 256;
  const energies = [];
  for (let start = 0; start + frameSize <= samples.length; start += hop) {
    energies.push(rms(samples, start, start + frameSize));
  }
  if (!energies.length) {
    return { samples, sampleRate, startSample: 0, endSample: samples.length - 1 };
  }

  const baselineCount = Math.max(4, Math.min(16, Math.floor(energies.length * 0.1)));
  let baseline = 0;
  for (let i = 0; i < baselineCount; i++) baseline += energies[i];
  baseline /= baselineCount;

  const maxEnergy = Math.max(...energies);
  const onsetThreshold = Math.max(baseline * 4, maxEnergy * 0.12, 0.002);
  const secondThreshold = Math.max(baseline * 5, maxEnergy * 0.16, 0.003);

  let firstOnsetFrame = -1;
  for (let i = 0; i < energies.length; i++) {
    if (energies[i] >= onsetThreshold) {
      firstOnsetFrame = i;
      break;
    }
  }
  if (firstOnsetFrame < 0) {
    return { samples, sampleRate, startSample: 0, endSample: samples.length - 1 };
  }

  const minGapFrames = Math.max(6, Math.round(0.18 * sampleRate / hop));
  let secondOnsetFrame = -1;
  for (let i = firstOnsetFrame + minGapFrames; i < energies.length; i++) {
    const prev = energies[Math.max(0, i - 1)] || 1e-6;
    const ratio = energies[i] / prev;
    if (energies[i] >= secondThreshold && ratio > 1.25) {
      secondOnsetFrame = i;
      break;
    }
  }

  const preRoll = Math.round(0.015 * sampleRate);
  const startSample = Math.max(0, firstOnsetFrame * hop - preRoll);

  let endSample;
  if (secondOnsetFrame > 0) {
    endSample = Math.max(startSample + Math.round(0.1 * sampleRate), secondOnsetFrame * hop);
  } else {
    const silenceThreshold = Math.max(baseline * 1.8, 0.0008);
    const minFramesAfterOnset = Math.round(0.25 * sampleRate / hop);
    const sustainSilenceFrames = Math.round(0.2 * sampleRate / hop);
    let silenceRun = 0;
    endSample = samples.length;

    for (let i = firstOnsetFrame + minFramesAfterOnset; i < energies.length; i++) {
      if (energies[i] < silenceThreshold) silenceRun += 1;
      else silenceRun = 0;

      if (silenceRun >= sustainSilenceFrames) {
        endSample = Math.min(samples.length, (i - sustainSilenceFrames + 1) * hop + frameSize);
        break;
      }
    }
  }

  const sliced = samples.slice(startSample, Math.min(samples.length, endSample));
  return {
    samples: sliced,
    sampleRate,
    startSample,
    endSample: Math.min(samples.length, endSample),
  };
}

function normalizeAudio(samples) {
  const out = new Float32Array(samples.length);
  let peak = 0;
  for (let i = 0; i < samples.length; i++) peak = Math.max(peak, Math.abs(samples[i]));
  const gain = peak > 1e-6 ? 1 / peak : 1;
  for (let i = 0; i < samples.length; i++) out[i] = samples[i] * gain;
  return out;
}

function hann(n, size) {
  return 0.5 - 0.5 * Math.cos((2 * Math.PI * n) / (size - 1));
}

const fftPlanCache = new Map();

function getFFTPlan(fftSize) {
  let plan = fftPlanCache.get(fftSize);
  if (plan) return plan;

  const fft = new FFT(fftSize);
  const input = new Float32Array(fftSize);
  const output = fft.createComplexArray(); // 長度 = fftSize * 2

  plan = { fft, input, output };
  fftPlanCache.set(fftSize, plan);
  return plan;
}

function computeFFTMagnitude(frame, fftSize) {
  const bins = fftSize >> 1;
  const out = new Float32Array(bins);

  const plan = getFFTPlan(fftSize);
  const { fft, input, output } = plan;

  // 複製進可重用 input buffer
  input.set(frame);

  // realTransform: real input -> packed complex spectrum
  fft.realTransform(output, input);
  fft.completeSpectrum(output);

  for (let k = 0; k < bins; k++) {
    const re = output[2 * k];
    const im = output[2 * k + 1];
    out[k] = Math.sqrt(re * re + im * im);
  }

  return out;
}

function frameEnergy(frame) {
  let e = 0;
  for (let i = 0; i < frame.length; i++) e += frame[i] * frame[i];
  return e;
}

function cloneFrame(frame) {
  return new Float32Array(frame);
}

function lerpFrames(a, b, t) {
  const out = new Float32Array(a.length);
  for (let i = 0; i < a.length; i++) {
    out[i] = a[i] + (b[i] - a[i]) * t;
  }
  return out;
}

function repairSpectrogramFrames(frames) {
  if (!frames.length) return frames;

  const energies = frames.map(frameEnergy);
  const maxE = Math.max(...energies, 1e-12);
  const gapThreshold = maxE * 1e-6;

  const repaired = frames.map((f) => cloneFrame(f));
  const isGap = energies.map((e) => e < gapThreshold);

  for (let i = 0; i < repaired.length; i++) {
    if (!isGap[i]) continue;

    let prev = i - 1;
    while (prev >= 0 && isGap[prev]) prev--;

    let next = i + 1;
    while (next < repaired.length && isGap[next]) next++;

    if (prev >= 0 && next < repaired.length) {
      const t = (i - prev) / (next - prev);
      repaired[i] = lerpFrames(repaired[prev], repaired[next], t);
    } else if (prev >= 0) {
      repaired[i] = cloneFrame(repaired[prev]);
    } else if (next < repaired.length) {
      repaired[i] = cloneFrame(repaired[next]);
    }
  }

  return repaired;
}

function buildSpectrogram(samples, sampleRate, opts = {}) {
  const fftSize = opts.fftSize || 1024;
  const hop = opts.hop || 256;

  if (!samples?.length || samples.length < fftSize) {
    return {
      frames: [],
      sampleRate,
      fftSize,
      hop,
      freqBins: fftSize >> 1,
      durationSec: (samples?.length || 0) / (sampleRate || 1),
    };
  }

  const rawFrames = [];
  const windowed = new Float32Array(fftSize);

  for (let start = 0; start + fftSize <= samples.length; start += hop) {
    for (let i = 0; i < fftSize; i++) {
      windowed[i] = samples[start + i] * hann(i, fftSize);
    }
    rawFrames.push(computeFFTMagnitude(windowed, fftSize));
  }

  const frames = repairSpectrogramFrames(rawFrames);

  return {
    frames,
    sampleRate,
    fftSize,
    hop,
    freqBins: fftSize >> 1,
    durationSec: samples.length / sampleRate,
  };
}

function computeEnvelope(samples, sampleRate, windowMs = 15) {
  const size = Math.max(64, Math.round(sampleRate * (windowMs / 1000)));
  const hop = Math.max(32, Math.floor(size / 2));
  const values = [];
  const times = [];
  for (let start = 0; start + size <= samples.length; start += hop) {
    values.push(rms(samples, start, start + size));
    times.push((start + size * 0.5) / sampleRate);
  }
  return { values, times, hop };
}

function average(arr) {
  if (!arr.length) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function linearSlope(xs, ys) {
  if (xs.length !== ys.length || xs.length < 2) return 0;
  const mx = average(xs);
  const my = average(ys);
  let num = 0;
  let den = 0;
  for (let i = 0; i < xs.length; i++) {
    const dx = xs[i] - mx;
    num += dx * (ys[i] - my);
    den += dx * dx;
  }
  return den > 1e-9 ? num / den : 0;
}

function computeFeatures(samples, sampleRate) {
  const normalized = normalizeAudio(samples);
  const spec = buildSpectrogram(normalized, sampleRate, {
    fftSize: 2048,
    hop: 256,
  });
  const env = computeEnvelope(normalized, sampleRate, 20);

  const attackWindowSec = 0.08;
  const attackSamples = Math.max(1, Math.floor(sampleRate * attackWindowSec));
  const attackSlice = normalized.slice(0, Math.min(normalized.length, attackSamples));
  const attackSpec = buildSpectrogram(attackSlice, sampleRate, { fftSize: 1024, hop: 256 });
  const attackFrame = attackSpec.frames[0] || new Float32Array(256);

  let sumMag = 0;
  let centroidNum = 0;
  let totalAttackEnergy = 0;
  for (let i = 0; i < attackFrame.length; i++) {
    const freq = (i * sampleRate) / attackSpec.fftSize;
    const mag = attackFrame[i];
    centroidNum += freq * mag;
    sumMag += mag;
    totalAttackEnergy += mag * mag;
  }
  const attackCentroid = sumMag > 0 ? centroidNum / sumMag : 0;

  const envDb = env.values.map((v) => 20 * Math.log10(Math.max(v, 1e-8)));
  const peakDb = envDb.length ? Math.max(...envDb) : -120;
  let decay20dB = env.times[env.times.length - 1] || 0;
  for (let i = 0; i < envDb.length; i++) {
    if (envDb[i] <= peakDb - 20) {
      decay20dB = env.times[i];
      break;
    }
  }

  const bandDefs = [
    { name: "low", min: 60, max: 500 },
    { name: "mid", min: 500, max: 2500 },
    { name: "high", min: 2500, max: 9000 },
  ];

  const bandSlopes = {};
  const bandCentroids = {};
  for (const band of bandDefs) {
    const xs = [];
    const ys = [];
    let weighted = 0;
    let weightTotal = 0;
    for (let frameIdx = 0; frameIdx < spec.frames.length; frameIdx++) {
      const frame = spec.frames[frameIdx];
      let energy = 0;
      for (let bin = 0; bin < frame.length; bin++) {
        const freq = (bin * sampleRate) / spec.fftSize;
        if (freq < band.min || freq >= band.max) continue;
        const mag = frame[bin];
        energy += mag * mag;
        weighted += freq * mag;
        weightTotal += mag;
      }
      xs.push((frameIdx * spec.hop) / sampleRate);
      ys.push(10 * Math.log10(Math.max(energy, 1e-10)));
    }
    bandSlopes[band.name] = linearSlope(xs, ys);
    bandCentroids[band.name] = weightTotal > 0 ? weighted / weightTotal : 0;
  }

  const logBands = [];
  const fMin = 80;
  const fMax = Math.min(8000, sampleRate * 0.5 * 0.95);
  const bandCount = 8;
  const baseFrame = spec.frames[Math.min(spec.frames.length - 1, Math.max(0, Math.round((0.05 * sampleRate) / spec.hop)))] || [];
  for (let i = 0; i < bandCount; i++) {
    const b0 = fMin * Math.pow(fMax / fMin, i / bandCount);
    const b1 = fMin * Math.pow(fMax / fMin, (i + 1) / bandCount);
    let e = 0;
    for (let bin = 0; bin < baseFrame.length; bin++) {
      const freq = (bin * sampleRate) / spec.fftSize;
      if (freq >= b0 && freq < b1) {
        const mag = baseFrame[bin];
        e += mag * mag;
      }
    }
    logBands.push(e);
  }
  const bandSum = logBands.reduce((a, b) => a + b, 0) || 1;
  const normalizedBands = logBands.map((v) => v / bandSum);

  return {
    durationSec: normalized.length / sampleRate,
    attackCentroid,
    attackEnergy: totalAttackEnergy,
    decay20dB,
    bandSlopes,
    bandCentroids,
    normalizedBands,
    spectrogram: spec,
  };
}

function scoreDifference(a, b, scale) {
  return clamp(1 - Math.abs(a - b) / scale, 0, 1);
}

function compareFeatureSets(ref, test) {
  if (!ref || !test) return null;

  const attack = scoreDifference(ref.attackCentroid, test.attackCentroid, Math.max(400, ref.attackCentroid * 0.45));
  const decay = scoreDifference(ref.decay20dB, test.decay20dB, Math.max(0.25, ref.decay20dB * 0.6));

  const slopeNames = ["low", "mid", "high"];
  const slopeScore = average(
    slopeNames.map((name) => scoreDifference(ref.bandSlopes[name], test.bandSlopes[name], 24))
  );

  const bandShapeScore = average(
    ref.normalizedBands.map((v, i) => scoreDifference(v, test.normalizedBands[i], 0.18))
  );

  const total = Math.round(
    100 * (attack * 0.28 + decay * 0.24 + slopeScore * 0.28 + bandShapeScore * 0.20)
  );

  return {
    total,
    attack: Math.round(attack * 100),
    decay: Math.round(decay * 100),
    bandDecay: Math.round(slopeScore * 100),
    bandShape: Math.round(bandShapeScore * 100),
  };
}

function drawSpectrogram(canvas, spectrogram, opts = {}) {
  if (!canvas) return;

  const ctx = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#050816";
  ctx.fillRect(0, 0, width, height);

  const frames = spectrogram?.frames || [];
  if (!frames.length) return;

  const sampleRate = spectrogram.sampleRate;
  const fftSize = spectrogram.fftSize;
  const nyquist = sampleRate * 0.5;

  const topHz = Math.min(opts.topHz || 9000, nyquist * 0.98);
  const bottomHz = Math.max(40, opts.bottomHz || 40);
  const useLogFreq = opts.logFreq !== false;   // 預設開啟
  const dynamicRangeDb = opts.dynamicRangeDb || 70;

  let maxDb = -120;
  for (const frame of frames) {
    for (let i = 0; i < frame.length; i++) {
      const db = 20 * Math.log10(Math.max(frame[i], 1e-9));
      if (db > maxDb) maxDb = db;
    }
  }
  const minDb = maxDb - dynamicRangeDb;

  const hzToBin = (hz) => {
    const bin = Math.round((hz / sampleRate) * fftSize);
    return Math.max(0, Math.min((fftSize >> 1) - 1, bin));
  };

  const yToHz = (y) => {
    const t = 1 - y / Math.max(1, height - 1);
    if (!useLogFreq) {
      return t * topHz;
    }
    return bottomHz * Math.pow(topHz / bottomHz, t);
  };

  for (let x = 0; x < width; x++) {
    const f0 = Math.floor((x / width) * frames.length);
    const f1 = Math.max(f0 + 1, Math.floor(((x + 1) / width) * frames.length));

    for (let y = 0; y < height; y++) {
      const hz0 = yToHz(y + 1);
      const hz1 = yToHz(y);

      const loHz = Math.min(hz0, hz1);
      const hiHz = Math.max(hz0, hz1);

      const b0 = hzToBin(loHz);
      const b1 = Math.max(b0 + 1, hzToBin(hiHz));

      let mag = 0;
      let count = 0;

      for (let fi = f0; fi < f1; fi++) {
        const frame = frames[fi];
        for (let bin = b0; bin <= b1 && bin < frame.length; bin++) {
          mag += frame[bin];
          count++;
        }
      }

      mag /= Math.max(1, count);

      const db = 20 * Math.log10(Math.max(mag, 1e-9));
      const t = clamp((db - minDb) / Math.max(1e-6, dynamicRangeDb), 0, 1);

      const r = Math.floor(255 * Math.pow(t, 0.7));
      const g = Math.floor(220 * Math.pow(t, 1.3));
      const b = Math.floor(255 * Math.pow(t, 2.2));

      ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
      ctx.fillRect(x, y, 1, 1);
    }
  }
}

function MetricCard({ label, value, hint }) {
  return (
    <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 min-w-[110px]">
      <div className="text-[11px] uppercase tracking-wide opacity-60">{label}</div>
      <div className="text-lg font-semibold">{value}</div>
      {hint ? <div className="text-[11px] opacity-60 mt-1">{hint}</div> : null}
    </div>
  );
}

export default function SpectrogramComparePanel({ engine }) {
  const [showSpectrogram, setShowSpectrogram] = useState(true);
  const [reference, setReference] = useState(null);
  const [testClip, setTestClip] = useState(null);
  const [referenceMeta, setReferenceMeta] = useState(null);
  const [captureState, setCaptureState] = useState("idle");

  const refCanvasRef = useRef(null);
  const testCanvasRef = useRef(null);

  useEffect(() => {
    if (!engine || typeof engine.addCaptureListener !== "function") return undefined;

    const off = engine.addCaptureListener((payload) => {
      setCaptureState("done");
      if (!payload?.samples?.length) return;

      const trimmed = trimByOnsets(payload.samples, payload.sampleRate) || {
        samples: payload.samples,
        sampleRate: payload.sampleRate,
      };

      let samples = trimmed.samples;

      // 如果已經有 reference，就把右邊裁成跟左邊一樣長
      if (reference?.samples?.length) {
        const targetLength = reference.samples.length;

        if (samples.length > targetLength) {
          samples = samples.slice(0, targetLength);
        } else if (samples.length < targetLength) {
          // 太短就補 0，讓時間軸一致
          const padded = new Float32Array(targetLength);
          padded.set(samples, 0);
          samples = padded;
        }
      }

      samples = normalizeAudio(samples);

      setTestClip({
        ...payload,
        samples,
        sampleRate: trimmed.sampleRate,
        features: computeFeatures(samples, trimmed.sampleRate),
        payloadDurationSec: payload.samples.length / payload.sampleRate,
      });
    });

    return () => {
      if (typeof off === "function") off();
    };
  }, [engine, reference]);

  useEffect(() => {
    if (showSpectrogram && reference?.features?.spectrogram) {
      drawSpectrogram(refCanvasRef.current, reference.features.spectrogram);
    }
  }, [showSpectrogram, reference]);

  useEffect(() => {
    if (showSpectrogram && testClip?.features?.spectrogram) {
      drawSpectrogram(testCanvasRef.current, testClip.features.spectrogram);
    }
  }, [showSpectrogram, testClip]);

  const score = useMemo(() => compareFeatureSets(reference?.features, testClip?.features), [reference, testClip]);

  const handleReferenceUpload = async (file) => {
    if (!file || !engine?.actx) return;
    try {
      const buf = await file.arrayBuffer();
      const audioBuffer = await engine.actx.decodeAudioData(buf.slice(0));
      const mono = downmixToMono(audioBuffer);
      const trimmed = trimByOnsets(mono, audioBuffer.sampleRate);
      const samples = normalizeAudio(trimmed.samples);
      const features = computeFeatures(samples, trimmed.sampleRate);
      setReference({ samples, sampleRate: trimmed.sampleRate, features });
      setReferenceMeta({
        fileName: file.name,
        durationSec: samples.length / trimmed.sampleRate,
        startMs: (trimmed.startSample / trimmed.sampleRate) * 1000,
        endMs: (trimmed.endSample / trimmed.sampleRate) * 1000,
      });
    } catch (e) {
      console.warn("[RC][Compare] reference upload failed", e);
    }
  };

  const captureNextNote = () => {
    if (!engine?.startCapture) return;
    setCaptureState("armed");
    engine.startCapture();
  };

  return (
    <div className={panelClass}>
      <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
        <div>
          <div className="text-sm font-semibold">Timbre Compare</div>
          <div className="text-xs opacity-70">
            上傳 reference wav 後，自動抓第一個 attack 到第二個 attack 之前；再用 Capture next note 錄下一次 synth 單音並算分數。
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <label className={`${buttonClass} cursor-pointer`}>
            Upload reference wav
            <input
              type="file"
              accept="audio/*,.wav"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleReferenceUpload(f);
                e.target.value = "";
              }}
            />
          </label>
          <button className={buttonClass} onClick={captureNextNote}>
            Capture next note
          </button>
          <button
            className={buttonClass}
            onClick={() => setShowSpectrogram((v) => !v)}
          >
            {showSpectrogram ? "Hide spectrogram" : "Show spectrogram"}
          </button>
        </div>
      </div>

      <div className="flex gap-3 flex-wrap mb-4">
        <MetricCard label="Score" value={score ? `${score.total}/100` : "—"} hint="整體相似度" />
        <MetricCard label="Attack" value={score ? `${score.attack}` : "—"} hint="起音亮度 / 質感" />
        <MetricCard label="Decay" value={score ? `${score.decay}` : "—"} hint="主體衰減" />
        <MetricCard label="Band Decay" value={score ? `${score.bandDecay}` : "—"} hint="低 / 中 / 高頻衰減" />
        <MetricCard label="Band Shape" value={score ? `${score.bandShape}` : "—"} hint="attack 頻帶分布" />
        <MetricCard label="Capture" value={captureState} hint="idle / armed / done" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-xl border border-white/10 bg-black/20 p-3">
          <div className="flex items-center justify-between mb-2 gap-2">
            <div>
              <div className="text-sm font-medium">Reference</div>
              <div className="text-xs opacity-60">
                {referenceMeta
                  ? `${referenceMeta.fileName} · ${referenceMeta.durationSec.toFixed(2)}s · ${referenceMeta.startMs.toFixed(0)}ms → ${referenceMeta.endMs.toFixed(0)}ms`
                  : "還沒上傳 reference wav"}
              </div>
            </div>
            <div className="text-xs opacity-70">
              {reference?.sampleRate ? `${reference.sampleRate} Hz` : ""}
            </div>
          </div>
          {showSpectrogram ? (
            <canvas ref={refCanvasRef} width={520} height={220} className="w-full rounded-lg border border-white/10 bg-[#050816]" />
          ) : (
            <div className="h-[220px] rounded-lg border border-white/10 bg-[#050816] grid place-items-center text-sm opacity-50">
              spectrogram hidden
            </div>
          )}
        </div>

        <div className="rounded-xl border border-white/10 bg-black/20 p-3">
          <div className="flex items-center justify-between mb-2 gap-2">
            <div>
              <div className="text-sm font-medium">Synth capture</div>
              <div className="text-sm opacity-70">
                {testClip
                  ? `${(testClip.payloadDurationSec ?? 0).toFixed(2)}s captured / ${(testClip.samples.length / testClip.sampleRate).toFixed(2)}s shown`
                  : "按 Capture next note 後彈一次單音"}
              </div>
            </div>
            <div className="text-xs opacity-70">
              {testClip?.sampleRate ? `${testClip.sampleRate} Hz` : ""}
            </div>
          </div>
          {showSpectrogram ? (
            <canvas ref={testCanvasRef} width={520} height={220} className="w-full rounded-lg border border-white/10 bg-[#050816]" />
          ) : (
            <div className="h-[220px] rounded-lg border border-white/10 bg-[#050816] grid place-items-center text-sm opacity-50">
              spectrogram hidden
            </div>
          )}
        </div>
      </div>

      <div className="mt-3 text-xs opacity-65 leading-5">
        目前這版是最小可用版：reference 會自動切第一個 onset 到第二個 onset 前；synth 端會在 analyser 模組後自動等下一次有聲音才開始錄，靜音一段時間後自動停止。
        分數先用 attack centroid、-20 dB decay、三段頻帶 decay slope、以及 attack 頻帶分布計算。
      </div>
    </div>
  );
}
