/**
 * Plays one recorded loop (`oga.ts`) into the score's bus. It is fetched and decoded the first time it is wanted (never at
 * boot: the stakes track is 108 s and the bar track 171 s), decoded at 24 kHz (the master chain low-passes at 11 kHz, so half
 * the memory costs nothing audible: about 21 MB and 33 MB) and looped as a buffer, which is sample-exact (an `<audio>`
 * element would gap). Both files were cut as whole loops. A load that fails leaves `ready` false forever and the procedural
 * score plays alone.
 */
import { log } from '../../log';
import type { OgaDef } from './oga';

const BASE = `${import.meta.env.BASE_URL}assets/vendor/music-oga/`;
const DECODE_HZ = 24000;

export class OgaLayer {
  private buf: AudioBuffer | null = null;
  private loading = false;
  private src: AudioBufferSourceNode | null = null;
  private readonly out: GainNode;
  private on = false;
  private quietAt = Infinity;
  /** Context time at which the loop's position was 0 on a clock that never stops, for the tunes that keep their place. */
  private t0 = NaN;

  constructor(private readonly ctx: BaseAudioContext, dest: AudioNode, readonly def: OgaDef) {
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    this.out.connect(dest);
  }

  /** Decoded and playable. */
  get ready(): boolean { return this.buf !== null; }

  /** Fetches and decodes (once, on the first call). */
  load(): void {
    if (this.loading) return;
    this.loading = true;
    const url = BASE + this.def.file;
    fetch(url)
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.arrayBuffer(); })
      .then((ab) => new OfflineAudioContext(2, 1, DECODE_HZ).decodeAudioData(ab))
      .then((b) => { this.buf = b; })
      .catch((e) => log.warnOnce(`music:oga:${this.def.id}`, 'music', `recorded track unavailable (${url}); the procedural score plays alone`, e));
  }

  /** Fade in or out over `ramp` seconds (95 % of the way). Starts the loop on the way in; `tick` frees it after the way out. */
  set(on: boolean, ramp: number): void {
    if (!this.buf || on === this.on) return;
    this.on = on;
    const now = this.ctx.currentTime;
    if (on && !this.src) this.start(this.buf, now);
    this.out.gain.cancelScheduledValues(now);
    this.out.gain.setTargetAtTime(on ? this.def.gain : 0, now, ramp / 3);
    this.quietAt = on ? Infinity : now + ramp * 2.4;            // 2.4 ramps = 7 time constants: below -60 dB
  }

  /** Housekeeping: free the source once a fade-out has gone quiet. */
  tick(now: number): void {
    if (!this.src || now < this.quietAt) return;
    try { this.src.stop(); } catch { /* already stopped */ }
    this.src.disconnect();
    this.src = null;
  }

  private start(buf: AudioBuffer, now: number): void {
    let at = this.def.from;
    if (this.def.resume) {
      if (Number.isNaN(this.t0)) this.t0 = now - at;
      at = (((now - this.t0) % buf.duration) + buf.duration) % buf.duration;
    }
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.connect(this.out);
    src.start(now, at);
    this.src = src;
  }
}
