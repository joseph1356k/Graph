/**
 * AudioWorklet que acumula muestras del micrófono y las emite en bloques.
 * El AudioContext ya corre a 16 kHz, así que aquí no hay que remuestrear:
 * solo agrupar para no saturar el hilo principal con un mensaje por quantum.
 */
const CHUNK = 2048; // ~128 ms a 16 kHz

class PCMProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buf = new Float32Array(CHUNK);
    this.used = 0;
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (!channel) return true;

    let offset = 0;
    while (offset < channel.length) {
      const room = CHUNK - this.used;
      const take = Math.min(room, channel.length - offset);
      this.buf.set(channel.subarray(offset, offset + take), this.used);
      this.used += take;
      offset += take;

      if (this.used === CHUNK) {
        // Copia: el buffer se reutiliza en el siguiente quantum.
        this.port.postMessage(this.buf.slice(0));
        this.used = 0;
      }
    }
    return true;
  }
}

registerProcessor("pcm-processor", PCMProcessor);
