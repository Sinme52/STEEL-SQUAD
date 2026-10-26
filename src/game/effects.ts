// 爆発・火花・煙などの演出。テクスチャは起動時にキャンバスで作る。
import Phaser from 'phaser';
import { settings } from './save';

export function makeTextures(scene: Phaser.Scene) {
  const radial = (key: string, size: number, stops: [number, string][]) => {
    if (scene.textures.exists(key)) return;
    const tex = scene.textures.createCanvas(key, size, size)!;
    const ctx = tex.getContext();
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    for (const [o, c] of stops) g.addColorStop(o, c);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    tex.refresh();
  };
  radial('glow', 64, [[0, 'rgba(255,255,255,1)'], [0.25, 'rgba(255,255,255,0.8)'], [1, 'rgba(255,255,255,0)']]);
  radial('fire', 64, [[0, 'rgba(255,250,220,1)'], [0.3, 'rgba(255,190,80,0.9)'], [0.7, 'rgba(230,80,20,0.4)'], [1, 'rgba(120,20,0,0)']]);
  radial('smoke', 64, [[0, 'rgba(70,66,64,0.85)'], [0.6, 'rgba(50,48,48,0.45)'], [1, 'rgba(40,40,40,0)']]);
  radial('softdot', 16, [[0, 'rgba(255,255,255,1)'], [1, 'rgba(255,255,255,0)']]);

  const canvas = (key: string, w: number, h: number, draw: (c: CanvasRenderingContext2D) => void) => {
    if (scene.textures.exists(key)) return;
    const tex = scene.textures.createCanvas(key, w, h)!;
    draw(tex.getContext());
    tex.refresh();
  };
  canvas('tracer', 48, 6, (c) => {
    const g = c.createLinearGradient(0, 0, 48, 0);
    g.addColorStop(0, 'rgba(255,200,80,0)');
    g.addColorStop(0.7, 'rgba(255,220,120,0.9)');
    g.addColorStop(1, 'rgba(255,255,230,1)');
    c.fillStyle = g;
    c.fillRect(0, 1, 48, 4);
  });
  canvas('tracerBlue', 80, 6, (c) => {
    const g = c.createLinearGradient(0, 0, 80, 0);
    g.addColorStop(0, 'rgba(80,220,255,0)');
    g.addColorStop(0.7, 'rgba(140,240,255,0.9)');
    g.addColorStop(1, 'rgba(240,255,255,1)');
    c.fillStyle = g;
    c.fillRect(0, 1, 80, 4);
  });
  canvas('enemyShot', 28, 10, (c) => {
    const g = c.createLinearGradient(0, 0, 28, 0);
    g.addColorStop(0, 'rgba(255,40,60,0)');
    g.addColorStop(0.6, 'rgba(255,70,90,0.95)');
    g.addColorStop(1, 'rgba(255,220,220,1)');
    c.fillStyle = g;
    c.beginPath();
    c.ellipse(16, 5, 12, 4, 0, 0, Math.PI * 2);
    c.fill();
  });
  canvas('missile', 26, 8, (c) => {
    c.fillStyle = '#c8c2b0';
    c.fillRect(2, 2, 18, 4);
    c.fillStyle = '#e0483a';
    c.beginPath(); c.moveTo(20, 1); c.lineTo(26, 4); c.lineTo(20, 7); c.fill();
    c.fillStyle = '#5a5248';
    c.fillRect(0, 0, 4, 8);
  });
  canvas('flame', 32, 70, (c) => {
    const g = c.createLinearGradient(0, 0, 0, 70);
    g.addColorStop(0, 'rgba(255,255,230,1)');
    g.addColorStop(0.25, 'rgba(120,200,255,0.9)');
    g.addColorStop(0.6, 'rgba(255,140,40,0.6)');
    g.addColorStop(1, 'rgba(255,60,0,0)');
    c.fillStyle = g;
    c.beginPath();
    c.moveTo(6, 0); c.lineTo(26, 0); c.lineTo(16, 70); c.closePath();
    c.fill();
  });
  canvas('ring', 128, 128, (c) => {
    c.strokeStyle = 'rgba(255,230,180,1)';
    c.lineWidth = 6;
    c.beginPath(); c.arc(64, 64, 58, 0, Math.PI * 2); c.stroke();
  });
  canvas('debris', 10, 6, (c) => {
    c.fillStyle = '#55504a';
    c.fillRect(0, 0, 10, 6);
    c.fillStyle = '#8a8070';
    c.fillRect(0, 0, 10, 2);
  });
  canvas('pixel', 4, 4, (c) => {
    c.fillStyle = '#fff';
    c.fillRect(0, 0, 4, 4);
  });
}

export class Effects {
  private sparks: Phaser.GameObjects.Particles.ParticleEmitter;
  private fire: Phaser.GameObjects.Particles.ParticleEmitter;
  private smoke: Phaser.GameObjects.Particles.ParticleEmitter;
  private debris: Phaser.GameObjects.Particles.ParticleEmitter;
  private trail: Phaser.GameObjects.Particles.ParticleEmitter;
  private heal: Phaser.GameObjects.Particles.ParticleEmitter;
  private dust: Phaser.GameObjects.Particles.ParticleEmitter;

  constructor(private scene: Phaser.Scene) {
    const add = (tex: string, cfg: Phaser.Types.GameObjects.Particles.ParticleEmitterConfig, depth: number) => {
      const e = scene.add.particles(0, 0, tex, { ...cfg, emitting: false });
      e.setDepth(depth);
      return e;
    };
    this.smoke = add('smoke', {
      lifespan: { min: 700, max: 1600 }, speed: { min: 20, max: 90 }, scale: { start: 0.6, end: 2.2 },
      alpha: { start: 0.8, end: 0 }, gravityY: -60, rotate: { min: 0, max: 360 },
    }, 40);
    this.fire = add('fire', {
      lifespan: { min: 200, max: 520 }, speed: { min: 40, max: 260 }, scale: { start: 1.1, end: 0.1 },
      alpha: { start: 1, end: 0 }, blendMode: 'ADD',
    }, 42);
    this.sparks = add('softdot', {
      lifespan: { min: 120, max: 380 }, speed: { min: 150, max: 650 }, scale: { start: 0.5, end: 0 },
      tint: [0xffe9a0, 0xffb040, 0xffffff], blendMode: 'ADD', gravityY: 900,
    }, 43);
    this.debris = add('debris', {
      lifespan: { min: 500, max: 1100 }, speed: { min: 180, max: 520 }, angle: { min: 200, max: 340 },
      rotate: { start: 0, end: 720 }, gravityY: 1500, scale: { min: 0.6, max: 1.4 },
    }, 41);
    this.trail = add('smoke', {
      lifespan: 450, speed: 10, scale: { start: 0.25, end: 0.7 }, alpha: { start: 0.55, end: 0 },
    }, 30);
    this.heal = add('softdot', {
      lifespan: 500, speed: { min: 20, max: 60 }, scale: { start: 0.7, end: 0 }, tint: 0x7dffb0,
      blendMode: 'ADD', gravityY: -120,
    }, 44);
    this.dust = add('smoke', {
      lifespan: { min: 300, max: 600 }, speed: { min: 60, max: 180 }, angle: { min: 180, max: 360 },
      scale: { start: 0.35, end: 0.9 }, alpha: { start: 0.45, end: 0 }, tint: 0x9a8a78,
    }, 39);
  }

  muzzle(x: number, y: number, angle: number, size = 1, color = 0xffd27a) {
    const f = this.scene.add.image(x, y, 'glow').setBlendMode(Phaser.BlendModes.ADD).setDepth(45)
      .setTint(color).setScale(0.6 * size, 0.35 * size).setRotation(angle);
    this.scene.tweens.add({ targets: f, alpha: 0, scale: 0.1, duration: 70, onComplete: () => f.destroy() });
  }

  impact(x: number, y: number, size = 1) {
    this.sparks.explode(Math.round(5 * size), x, y);
    if (size > 1) this.smoke.explode(1, x, y);
  }

  explosion(x: number, y: number, size = 1) {
    this.fire.explode(Math.round(14 * size), x, y);
    this.smoke.explode(Math.round(8 * size), x, y);
    this.sparks.explode(Math.round(16 * size), x, y);
    this.debris.explode(Math.round(6 * size), x, y);
    const flash = this.scene.add.image(x, y, 'glow').setBlendMode(Phaser.BlendModes.ADD).setDepth(46)
      .setScale(2.5 * size).setTint(0xffd090);
    this.scene.tweens.add({ targets: flash, alpha: 0, scale: 4 * size, duration: 220, onComplete: () => flash.destroy() });
    const ring = this.scene.add.image(x, y, 'ring').setBlendMode(Phaser.BlendModes.ADD).setDepth(46).setScale(0.2 * size);
    this.scene.tweens.add({ targets: ring, alpha: 0, scale: 1.6 * size, duration: 350, onComplete: () => ring.destroy() });
  }

  smokePuff(x: number, y: number, n = 1) {
    this.smoke.explode(n, x, y);
  }

  missileTrail(x: number, y: number) {
    this.trail.explode(1, x, y);
  }

  healFx(x: number, y: number) {
    this.heal.explode(2, x, y);
  }

  dustFx(x: number, y: number, n = 6) {
    this.dust.explode(n, x, y);
  }
}

export function shake(cam: Phaser.Cameras.Scene2D.Camera, amount: number, duration = 120) {
  if (!settings.shake || amount <= 0) return;
  cam.shake(duration, Math.min(amount * 0.0012, 0.02), false);
}
