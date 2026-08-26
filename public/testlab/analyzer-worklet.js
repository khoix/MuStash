class GuardAnalyzer extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.targetFrequency = options.processorOptions?.targetFrequency || 18500;
    this.blockCounter = 0;
    this.port.onmessage = (event) => {
      if (event.data?.type === 'frequency') this.targetFrequency = Number(event.data.value) || this.targetFrequency;
    };
  }

  process(inputs) {
    const channel = inputs[0]?.[0];
    if (!channel?.length) return true;

    let sumSquares = 0;
    let real = 0;
    let imag = 0;
    const angular = 2 * Math.PI * this.targetFrequency / sampleRate;

    for (let i = 0; i < channel.length; i++) {
      const sample = channel[i];
      sumSquares += sample * sample;
      const phase = angular * i;
      real += sample * Math.cos(phase);
      imag -= sample * Math.sin(phase);
    }

    const rms = Math.sqrt(sumSquares / channel.length);
    const carrier = (2 / channel.length) * Math.hypot(real, imag);

    // Keep main-thread traffic low while still sampling much faster than display refresh.
    if ((this.blockCounter++ & 1) === 0) {
      this.port.postMessage({ rms, carrier, at: currentTime });
    }
    return true;
  }
}

registerProcessor('guard-analyzer', GuardAnalyzer);
