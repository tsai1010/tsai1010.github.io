class HighpassProcessor extends AudioWorkletProcessor {
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
      this.previousX = [];
    }
  
    process(inputs, outputs, parameters) {
      const input = inputs[0];
      const output = outputs[0];
      const cutoff = parameters.cutoff;
      const sr = 44100; // Web Audio global
  
      for (let channel = 0; channel < input.length; channel++) {
        const inputChannel = input[channel];
        const outputChannel = output[channel];
  
        if (this.previousY[channel] === undefined) this.previousY[channel] = 0;
        if (this.previousX[channel] === undefined) this.previousX[channel] = 0;
  
        for (let i = 0; i < inputChannel.length; i++) {
          const x = inputChannel[i];
          const fc = cutoff.length > 1 ? cutoff[i] : cutoff[0];
  
          const alpha = 1 / (1 + sr / (2 * Math.PI * fc));
          const y =
            alpha * (this.previousY[channel] + x - this.previousX[channel]);
  
          outputChannel[i] = y;
  
          this.previousY[channel] = y;
          this.previousX[channel] = x;
        }
      }
  
      return true;
    }
  }
  
  registerProcessor('highpass-processor', HighpassProcessor);
  