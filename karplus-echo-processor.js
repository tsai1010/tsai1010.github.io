class KarplusEchoProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      {
        name: 'decay',
        defaultValue: 0.99,
        minValue: 0.0,
        maxValue: 1.0,
        automationRate: 'a-rate',
      }
    ];
  }

  constructor() {
    super();
    this.sampleRate = 44100;
    this.bufferSize = 44100; // 最長支援 1 秒延遲
    this.buffer = new Array(this.bufferSize).fill(0);
    this.pointer = 0;
    this.delaySamples = Math.floor(sampleRate / 440); // 預設 freq = 440Hz

    this.port.onmessage = (event) => {
      if (event.data.freq) {
        const freq = event.data.freq;
        this.delaySamples = Math.max(1, Math.floor(this.sampleRate / freq));
      }
    };
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];

    if (input.length === 0) return true;

    for (let channel = 0; channel < input.length; channel++) {
      const inputChannel = input[channel];
      const outputChannel = output[channel];

      for (let i = 0; i < inputChannel.length; i++) {
        const inSample = inputChannel[i];
        const decay = parameters.decay.length > 1 ? parameters.decay[i] : parameters.decay[0];

        const readIndex = (this.pointer - this.delaySamples + this.bufferSize) % this.bufferSize;
        const delayedSample = this.buffer[readIndex];

        const outputSample = inSample + delayedSample * decay;

        outputChannel[i] = outputSample;

        this.buffer[this.pointer] = outputSample;
        this.pointer = (this.pointer + 1) % this.bufferSize;
      }
    }

    return true;
  }
}

registerProcessor('karplus-echo-processor', KarplusEchoProcessor);
