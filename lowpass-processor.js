class LowpassProcessor extends AudioWorkletProcessor {
    static get parameterDescriptors() {
      return [
        {
          name: 'cutoff',
          defaultValue: 1000, // Hz
          minValue: 1,
          maxValue: 20000,
          automationRate: 'a-rate',
        },
      ];
    }
  
    constructor() {
      super();
      this.previousY = [];
    }
  
    process(inputs, outputs, parameters) {
      const input = inputs[0];
      const output = outputs[0];
      const cutoff = parameters.cutoff;
      const sampleRate = 44100; // built-in global in AudioWorkletProcessor
  
      for (let channel = 0; channel < input.length; channel++) {
        const inputChannel = input[channel];
        const outputChannel = output[channel];
        if (this.previousY[channel] === undefined) this.previousY[channel] = 0;
  
        for (let i = 0; i < inputChannel.length; i++) {
          const f_c = cutoff.length > 1 ? cutoff[i] : cutoff[0];
          const alpha = 1 / (1 + sampleRate / (2 * Math.PI * f_c));
          this.previousY[channel] =
            (1 - alpha) * inputChannel[i] + alpha * this.previousY[channel];
          outputChannel[i] = this.previousY[channel];
        }
      }
  
      return true;
    }
  }
  
  registerProcessor('lowpass-processor', LowpassProcessor);
  