// karplus-strong-processor.js
class KarplusStrongProcessor extends AudioWorkletProcessor {
    constructor() {
      super();
      this.buffer = [];
      this.pointer = 0;
      this.decay = 0.996;
      this.lowpassEnabled = false;
      this.lastSample = 0;
  
      this.port.onmessage = (event) => {
        const { freq, sampleRate, harmonics, lowpass } = event.data;
        const length = Math.floor(sampleRate / freq);
        this.buffer = new Array(length).fill(0).map(() => {
          return (Math.random() * 2 - 1) * (1 - harmonics) + (Math.random() * harmonics);
        });
        this.pointer = 0;
        this.lowpassEnabled = lowpass ?? false;
        this.c = Math.exp(-2*Math.PI*6000/sampleRate);
      };
    }
  
    lowpassFilter(current, previous, alpha = 0.5) {
      return alpha * current + (1 - alpha) * previous;
    }
  
    process(inputs, outputs, parameters) {
      const input = inputs[0][0];
      const output = outputs[0][0];
      for (let i = 0; i < output.length; i++) {
        const current = this.buffer[this.pointer];
        const next = this.buffer[(this.pointer + 1) % this.buffer.length];
        let avg = 0.5 * (current + next) * this.decay;
  
        if (this.lowpassEnabled) {
          avg = this.lowpassFilter(avg, this.lastSample, this.c); // alpha 可微調
          this.lastSample = avg;
        }
  
        output[i] = current;
        this.buffer[this.pointer] = avg;
        this.pointer = (this.pointer + 1) % this.buffer.length;
      }
      return true;
    }
  }
  
  registerProcessor('karplus-strong-processor', KarplusStrongProcessor);
  