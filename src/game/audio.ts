// 効果音とBGMを Web Audio で合成する（音声ファイル不要）。
import { settings } from './save';

type Sfx =
  | 'mg' | 'shell' | 'rifle' | 'smg' | 'pistol' | 'enemy' | 'missile' | 'explode' | 'bigExplode' | 'hit'
  | 'shield' | 'jump' | 'eject' | 'repair' | 'ui' | 'uiOk' | 'alarm' | 'lvup' | 'gate' | 'recon' | 'land' | 'pickup';

class Audio {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private musicBus!: GainNode;
  private sfxBus!: GainNode;
  private noise!: AudioBuffer;
  private last = new Map<Sfx, number>();
  private song: Song | null = null;
  private nextNoteTime = 0;
  private step = 0;

  /** ブラウザの自動再生制限のため、最初の入力のあとに呼ぶ */
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master.connect(comp).connect(this.ctx.destination);
    this.musicBus = this.ctx.createGain();
    this.sfxBus = this.ctx.createGain();
    this.musicBus.connect(this.master);
    this.sfxBus.connect(this.master);
    const len = this.ctx.sampleRate;
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    this.applyVolume();
    window.setInterval(() => this.schedule(), 25);
  }

  applyVolume() {
    if (!this.ctx) return;
    this.master.gain.value = settings.master;
    this.musicBus.gain.value = settings.music * 0.5;
    this.sfxBus.gain.value = settings.sfx * 0.7;
  }

  private env(g: GainNode, t: number, a: number, peak: number, d: number) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }

  private noiseHit(t: number, dur: number, freq: number, q: number, vol: number, type: BiquadFilterType = 'lowpass', bus?: AudioNode, sweepTo?: number) {
    const c = this.ctx!;
    const src = c.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.7 + Math.random() * 0.6;
    const f = c.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    f.Q.value = q;
    const g = c.createGain();
    this.env(g, t, 0.003, vol, dur);
    src.connect(f).connect(g).connect(bus ?? this.sfxBus);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.05);
  }

  private tone(t: number, type: OscillatorType, f0: number, f1: number, dur: number, vol: number, bus?: AudioNode) {
    const c = this.ctx!;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(f1, 1), t + dur);
    const g = c.createGain();
    this.env(g, t, 0.004, vol, dur);
    o.connect(g).connect(bus ?? this.sfxBus);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  play(name: Sfx, vol = 1) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const now = this.ctx.currentTime;
    // 同じ音が同時に鳴りすぎないように間引く
    const minGap: Partial<Record<Sfx, number>> = { mg: 0.05, smg: 0.06, enemy: 0.05, hit: 0.03, explode: 0.05, shield: 0.06, repair: 0.12 };
    const lastT = this.last.get(name) ?? -1;
    if (now - lastT < (minGap[name] ?? 0.02)) return;
    this.last.set(name, now);
    const v = vol;
    switch (name) {
      case 'mg':
        this.noiseHit(now, 0.08, 2200, 1, 0.35 * v, 'lowpass', undefined, 400);
        this.tone(now, 'square', 160, 60, 0.05, 0.12 * v);
        break;
      case 'smg':
        this.noiseHit(now, 0.05, 3200, 1, 0.22 * v, 'lowpass', undefined, 800);
        break;
      case 'pistol':
        this.noiseHit(now, 0.06, 3000, 1, 0.2 * v);
        this.tone(now, 'square', 900, 200, 0.04, 0.05 * v);
        break;
      case 'rifle':
        this.noiseHit(now, 0.22, 5000, 0.7, 0.4 * v, 'lowpass', undefined, 300);
        this.tone(now, 'sawtooth', 1400, 90, 0.18, 0.12 * v);
        break;
      case 'shell':
        this.noiseHit(now, 0.45, 900, 0.8, 0.7 * v, 'lowpass', undefined, 80);
        this.tone(now, 'sine', 120, 35, 0.4, 0.6 * v);
        break;
      case 'enemy':
        this.noiseHit(now, 0.06, 1800, 2, 0.16 * v, 'bandpass');
        break;
      case 'missile':
        this.noiseHit(now, 0.5, 600, 1, 0.25 * v, 'bandpass', undefined, 2500);
        break;
      case 'explode':
        this.noiseHit(now, 0.5, 1200, 0.7, 0.5 * v, 'lowpass', undefined, 60);
        this.tone(now, 'sine', 90, 30, 0.35, 0.35 * v);
        break;
      case 'bigExplode':
        this.noiseHit(now, 1.4, 900, 0.7, 0.9 * v, 'lowpass', undefined, 40);
        this.tone(now, 'sine', 70, 20, 1.2, 0.7 * v);
        break;
      case 'hit':
        this.noiseHit(now, 0.05, 4000, 3, 0.15 * v, 'highpass');
        this.tone(now, 'square', 1800, 1200, 0.03, 0.05 * v);
        break;
      case 'shield':
        this.tone(now, 'triangle', 2200, 1600, 0.06, 0.12 * v);
        this.noiseHit(now, 0.05, 6000, 4, 0.1 * v, 'bandpass');
        break;
      case 'jump':
        this.noiseHit(now, 0.25, 300, 1, 0.25 * v, 'lowpass', undefined, 1200);
        break;
      case 'land':
        this.tone(now, 'sine', 80, 40, 0.15, 0.4 * v);
        this.noiseHit(now, 0.12, 500, 1, 0.2 * v);
        break;
      case 'eject':
        this.noiseHit(now, 0.4, 400, 1, 0.4 * v, 'bandpass', undefined, 3000);
        this.tone(now, 'square', 600, 1200, 0.15, 0.08 * v);
        break;
      case 'repair':
        this.tone(now, 'sine', 880, 1320, 0.08, 0.08 * v);
        break;
      case 'ui':
        this.tone(now, 'square', 660, 660, 0.05, 0.08 * v);
        break;
      case 'uiOk':
        this.tone(now, 'square', 660, 660, 0.06, 0.08 * v);
        this.tone(now + 0.06, 'square', 990, 990, 0.1, 0.08 * v);
        break;
      case 'alarm':
        for (let i = 0; i < 3; i++) {
          this.tone(now + i * 0.5, 'sawtooth', 520, 520, 0.22, 0.12 * v);
          this.tone(now + i * 0.5 + 0.25, 'sawtooth', 390, 390, 0.22, 0.12 * v);
        }
        break;
      case 'lvup':
        [523, 659, 784, 1047].forEach((f, i) => this.tone(now + i * 0.07, 'square', f, f, 0.12, 0.08 * v));
        break;
      case 'gate':
        this.noiseHit(now, 1.6, 200, 2, 0.5 * v, 'lowpass', undefined, 120);
        this.tone(now, 'sawtooth', 55, 50, 1.5, 0.15 * v);
        break;
      case 'recon':
        this.tone(now, 'sine', 1200, 300, 0.6, 0.18 * v);
        this.tone(now + 0.15, 'sine', 1200, 300, 0.6, 0.1 * v);
        break;
      case 'pickup':
        this.tone(now, 'triangle', 700, 1400, 0.15, 0.1 * v);
        break;
    }
  }

  // ---------------------------------------------------------------- BGM

  playSong(name: SongName | null) {
    if (this.song?.name === name) return;
    this.song = name ? SONGS[name] : null;
    this.step = 0;
    if (this.ctx) this.nextNoteTime = this.ctx.currentTime + 0.1;
  }

  private schedule() {
    if (!this.ctx || !this.song || this.ctx.state !== 'running') return;
    const song = this.song;
    const stepDur = 60 / song.bpm / 4;
    if (this.nextNoteTime < this.ctx.currentTime - 0.5) this.nextNoteTime = this.ctx.currentTime + 0.05;
    while (this.nextNoteTime < this.ctx.currentTime + 0.12) {
      this.playStep(song, this.step, this.nextNoteTime, stepDur);
      this.step++;
      this.nextNoteTime += stepDur;
    }
  }

  private playStep(song: Song, step: number, t: number, sd: number) {
    const bar = Math.floor(step / 16) % song.chords.length;
    const s = step % 16;
    const root = song.chords[bar];
    const m = this.musicBus;
    // ドラム
    if (song.kick[s] === 'x') this.tone(t, 'sine', 150, 40, 0.18, 0.55, m);
    if (song.snare[s] === 'x') this.noiseHit(t, 0.16, 1800, 0.8, 0.28, 'bandpass', m);
    if (song.hat[s] === 'x') this.noiseHit(t, 0.03, 8000, 1, 0.08, 'highpass', m);
    // ベース
    const bn = song.bass[s];
    if (bn !== '.') {
      const f = midi(root + Number(bn === 'o' ? 12 : 0) - 24);
      this.synth(t, f, sd * 1.6, 'sawtooth', 0.16, 600);
    }
    // メロディ
    if (song.lead) {
      const line = song.lead[bar % song.lead.length];
      const n = line[s];
      if (n !== null && n !== undefined) this.synth(t, midi(root + n), sd * 2.2, 'square', 0.055, 2400);
    }
    // パッド（小節頭）
    if (s === 0 && song.pad) {
      for (const iv of song.minor ? [0, 3, 7] : [0, 4, 7]) this.synth(t, midi(root + iv), sd * 15, 'triangle', 0.035, 1800);
    }
  }

  private synth(t: number, f: number, dur: number, type: OscillatorType, vol: number, cutoff: number) {
    const c = this.ctx!;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.value = f;
    const fl = c.createBiquadFilter();
    fl.type = 'lowpass';
    fl.frequency.setValueAtTime(cutoff, t);
    fl.frequency.exponentialRampToValueAtTime(cutoff * 0.4, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.setValueAtTime(vol, t + dur * 0.6);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(fl).connect(g).connect(this.musicBus);
    o.start(t);
    o.stop(t + dur + 0.05);
  }
}

const midi = (n: number) => 440 * Math.pow(2, (n - 69) / 12);

type SongName = 'title' | 'battle' | 'boss' | 'clear';
interface Song {
  name: SongName;
  bpm: number;
  minor: boolean;
  chords: number[]; // 各小節のルート音（MIDI）
  kick: string; snare: string; hat: string; bass: string;
  lead?: (number | null)[][];
  pad?: boolean;
}

const _ = null;
const SONGS: Record<SongName, Song> = {
  title: {
    name: 'title', bpm: 92, minor: true, chords: [57, 53, 55, 52], pad: true,
    kick: 'x.......x.......', snare: '....x.......x...', hat: '..x...x...x...x.',
    bass: 'x...x...x...x.o.',
    lead: [[12, _, _, _, 15, _, _, _, 19, _, _, 17, 15, _, _, _], [12, _, _, _, 10, _, 12, _, 15, _, _, _, _, _, _, _]],
  },
  battle: {
    name: 'battle', bpm: 150, minor: true, chords: [57, 57, 53, 55, 57, 57, 60, 55],
    kick: 'x...x...x...x.x.', snare: '....x.......x...', hat: 'x.x.x.x.x.x.x.xx',
    bass: 'x.xox.xox.xox.xo',
    lead: [
      [12, _, 12, 15, _, 12, 19, _, 17, _, 15, _, 12, _, 10, _],
      [12, _, _, _, _, _, 7, _, 10, _, 12, _, _, _, _, _],
      [12, _, 12, 15, _, 12, 19, _, 22, _, 19, _, 17, _, 15, _],
      [17, _, _, 15, _, _, 12, _, 14, _, _, _, _, _, _, _],
    ],
  },
  boss: {
    name: 'boss', bpm: 168, minor: true, chords: [52, 52, 53, 53, 50, 50, 51, 59],
    kick: 'x.x.x.x.x.x.x.x.', snare: '....x.......x.x.', hat: 'xxxxxxxxxxxxxxxx',
    bass: 'xoxoxoxoxoxoxoxo', pad: true,
    lead: [
      [12, _, 13, _, 12, _, 10, _, 12, _, _, _, 7, _, 8, _],
      [12, _, 13, _, 15, _, 17, _, 18, _, 17, _, 15, _, 13, _],
    ],
  },
  clear: {
    name: 'clear', bpm: 120, minor: false, chords: [60, 65, 67, 60], pad: true,
    kick: 'x.......x.......', snare: '....x.......x...', hat: 'x.x.x.x.x.x.x.x.',
    bass: 'x...x...x...x...',
    lead: [[12, _, 16, _, 19, _, 24, _, _, _, 19, _, 24, _, _, _]],
  },
};

export const audio = new Audio();
