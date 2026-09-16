type SoundKind = 'start' | 'collect' | 'hit' | 'gameover' | 'boost' | 'click';
type Tone = [frequency: number, delay: number, duration: number, volume: number];

/** Optional procedural audio: silent until the player explicitly enables it. */
export class GameAudio {
  public enabled = false;
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private engine: OscillatorNode | null = null;
  private engineGain: GainNode | null = null;
  private engineFilter: BiquadFilterNode | null = null;
  private voices = new Set<OscillatorNode>();
  private engineSpeed = -1;
  private engineBoost = false;
  private engineRunning = false;
  private disposed = false;

  /** Call from a pointer/key gesture. Unsupported or blocked audio stays silent. */
  async unlock(): Promise<void> {
    if (!this.enabled || this.disposed || typeof window === 'undefined') return;
    try {
      if (!this.context) {
        const Context = window.AudioContext ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Context) {
          this.enabled = false;
          return;
        }
        const context = new Context();
        this.context = context;
        this.master = context.createGain();
        this.master.gain.value = 0.55;
        this.master.connect(context.destination);
        this.engineGain = context.createGain();
        this.engineGain.gain.value = 0;
        this.engineFilter = context.createBiquadFilter();
        this.engineFilter.type = 'lowpass';
        this.engineFilter.frequency.value = 190;
        this.engineFilter.Q.value = 0.4;
        this.engine = context.createOscillator();
        this.engine.type = 'triangle';
        this.engine.frequency.value = 48;
        this.engine.connect(this.engineFilter);
        this.engineFilter.connect(this.engineGain);
        this.engineGain.connect(this.master);
        this.engine.start();
      }
      if (this.context.state === 'suspended') await this.context.resume();
      if (!this.disposed && this.master && this.context.state !== 'closed') {
        this.master.gain.setTargetAtTime(this.enabled ? 0.55 : 0, this.context.currentTime, 0.025);
      }
    } catch {
      // Audio support and browser gesture policies must never interrupt a run.
    }
  }

  toggle(): boolean {
    if (this.disposed) return false;
    this.enabled = !this.enabled;
    if (this.enabled) {
      void this.unlock();
      this.engineSpeed = -1;
    } else if (this.context && this.master && this.context.state !== 'closed') {
      this.master.gain.setTargetAtTime(0, this.context.currentTime, 0.02);
    }
    return this.enabled;
  }

  play(kind: SoundKind): void {
    const context = this.context;
    if (!this.enabled || !context || !this.master || context.state !== 'running' || this.disposed) return;
    // Short envelopes and restrained levels keep cues clear without covering
    // the quiet engine. Each cue has two pitches and no external audio asset.
    const sounds: Record<SoundKind, Tone[]> = {
      start: [[261.63, 0, 0.16, 0.09], [523.25, 0.11, 0.26, 0.085]],
      collect: [[659.25, 0, 0.09, 0.075], [987.77, 0.055, 0.15, 0.065]],
      hit: [[110, 0, 0.13, 0.11], [65.41, 0.07, 0.19, 0.075]],
      gameover: [[196, 0, 0.28, 0.08], [98, 0.2, 0.4, 0.075]],
      boost: [[146.83, 0, 0.15, 0.065], [293.66, 0.08, 0.22, 0.055]],
      click: [[440, 0, 0.045, 0.04], [660, 0.035, 0.065, 0.025]],
    };
    for (const [frequency, delay, duration, volume] of sounds[kind]) {
      const start = context.currentTime + delay;
      const oscillator = context.createOscillator();
      const envelope = context.createGain();
      oscillator.type = kind === 'hit' ? 'triangle' : 'sine';
      oscillator.frequency.setValueAtTime(frequency, start);
      oscillator.frequency.exponentialRampToValueAtTime(frequency * (kind === 'boost' ? 1.5 : kind === 'hit' ? 0.6 : 1), start + duration);
      envelope.gain.setValueAtTime(0, start);
      envelope.gain.linearRampToValueAtTime(volume, start + 0.008);
      envelope.gain.exponentialRampToValueAtTime(0.0001, start + duration);
      oscillator.connect(envelope);
      envelope.connect(this.master);
      this.voices.add(oscillator);
      oscillator.onended = () => {
        oscillator.disconnect();
        envelope.disconnect();
        this.voices.delete(oscillator);
      };
      oscillator.start(start);
      oscillator.stop(start + duration + 0.015);
    }
  }

  setEngine(speed: number, boost: boolean, running: boolean): void {
    const context = this.context;
    if (!context || !this.engine || !this.engineGain || !this.engineFilter || this.disposed || context.state === 'closed') return;
    const safeSpeed = Number.isFinite(speed) ? Math.max(0, Math.min(120, speed)) : 0;
    const audible = running && this.enabled && context.state === 'running';
    if (Math.abs(safeSpeed - this.engineSpeed) < 0.5 && boost === this.engineBoost && audible === this.engineRunning) return;
    this.engineSpeed = safeSpeed;
    this.engineBoost = boost;
    this.engineRunning = audible;
    const now = context.currentTime;
    this.engine.frequency.setTargetAtTime(34 + safeSpeed * 0.65, now, 0.15);
    this.engineFilter.frequency.setTargetAtTime(boost ? 250 : 165, now, 0.15);
    this.engineGain.gain.setTargetAtTime(audible ? (boost ? 0.032 : 0.019) : 0, now, 0.12);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.enabled = false;
    for (const voice of this.voices) {
      try { voice.stop(); } catch { /* A scheduled voice may already have ended. */ }
      voice.disconnect();
    }
    this.voices.clear();
    this.engine?.stop();
    this.engine?.disconnect();
    this.engineFilter?.disconnect();
    this.engineGain?.disconnect();
    this.master?.disconnect();
    if (this.context && this.context.state !== 'closed') void this.context.close().catch(() => {});
    this.context = null;
  }
}
