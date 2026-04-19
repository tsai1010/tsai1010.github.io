export const CAPTURE_WORKLET_SOURCE = `
class CaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();

    this.captureActive = false;
    this.captureStarted = false;
    this.threshold = 0.01;
    this.maxFrames = Math.floor(sampleRate * 4); // 保底 4 秒
    this.captured = new Float32Array(this.maxFrames);
    this.writeIndex = 0;

    this.port.onmessage = (e) => {
      const msg = e.data || {};
      switch (msg.type) {
        case "start":
          this.captureActive = true;
          this.captureStarted = false;
          this.threshold =
            typeof msg.threshold === "number" ? msg.threshold : 0.01;
          this.writeIndex = 0;
          break;

        case "stop":
          this.flush();
          this.captureActive = false;
          this.captureStarted = false;
          break;

        case "reset":
          this.captureActive = false;
          this.captureStarted = false;
          this.writeIndex = 0;
          break;
      }
    };
  }

  flush() {
    const out = this.captured.slice(0, this.writeIndex);
    this.port.postMessage({
      type: "captureComplete",
      samples: out,
      sampleRate,
    });
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0]) return true;
    if (!this.captureActive) return true;

    const ch0 = input[0];

    let peak = 0;
    for (let i = 0; i < ch0.length; i++) {
      const a = Math.abs(ch0[i]);
      if (a > peak) peak = a;
    }

    if (!this.captureStarted) {
      if (peak < this.threshold) return true;
      this.captureStarted = true;
    }

    const remain = this.captured.length - this.writeIndex;
    const copyLen = Math.min(remain, ch0.length);

    if (copyLen > 0) {
      this.captured.set(ch0.subarray(0, copyLen), this.writeIndex);
      this.writeIndex += copyLen;
    }

    if (this.writeIndex >= this.captured.length) {
      this.flush();
      this.captureActive = false;
      this.captureStarted = false;
    }

    return true;
  }
}

registerProcessor("capture-processor", CaptureProcessor);
`;