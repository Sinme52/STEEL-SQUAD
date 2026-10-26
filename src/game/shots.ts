// 弾・砲弾・ミサイル。見た目は使い回しの Image で描く。
import Phaser from 'phaser';
import { GRAVITY, RECON, type ShotKind } from './data';
import type { Effects } from './effects';
import { pointInSolids, type Solid } from './physics';
import type { Hittable, Source, Team } from './types';
import { audio } from './audio';

export interface ShieldZone {
  x: number; y: number; w: number; h: number;
  absorb(dmg: number, x: number, y: number): void;
}

export interface ShotWorld {
  scene: Phaser.Scene;
  solids: Solid[];
  effects: Effects;
  targets(team: Team): Hittable[];
  shields(): ShieldZone[];
  credit(src: Source | null, amount: number): void;
  camShake(amount: number): void;
}

export interface ShotOpts {
  x: number; y: number; angle: number; speed: number;
  kind: ShotKind; team: Team; damage: number;
  splash?: number; pierce?: number; src?: Source | null;
  target?: Hittable | null; gravity?: number; life?: number;
}

interface Shot {
  img: Phaser.GameObjects.Image;
  x: number; y: number; vx: number; vy: number;
  kind: ShotKind; team: Team; damage: number;
  splash: number; pierce: number; hits: Set<Hittable>;
  src: Source | null; target: Hittable | null; gravity: number; life: number; age: number;
  radius: number;
}

const LOOK: Record<ShotKind, { tex: string; sx: number; sy: number; tint?: number; radius: number }> = {
  mg: { tex: 'tracer', sx: 0.9, sy: 1, radius: 4 },
  smg: { tex: 'tracer', sx: 0.6, sy: 0.8, radius: 4 },
  pistol: { tex: 'tracer', sx: 0.4, sy: 0.7, radius: 3 },
  rifle: { tex: 'tracerBlue', sx: 1.4, sy: 1, radius: 5 },
  shell: { tex: 'glow', sx: 0.42, sy: 0.3, tint: 0xffb050, radius: 9 },
  missile: { tex: 'missile', sx: 1, sy: 1, radius: 7 },
  enemy: { tex: 'enemyShot', sx: 1, sy: 1, radius: 5 },
  enemyShell: { tex: 'glow', sx: 0.45, sy: 0.45, tint: 0xff4a3a, radius: 10 },
  bossShell: { tex: 'glow', sx: 0.9, sy: 0.9, tint: 0xff5a2a, radius: 18 },
};

export class Shots {
  private list: Shot[] = [];
  private pool: Phaser.GameObjects.Image[] = [];

  constructor(private w: ShotWorld) {}

  get count() {
    return this.list.length;
  }

  fire(o: ShotOpts) {
    const look = LOOK[o.kind];
    let img = this.pool.pop();
    if (!img) img = this.w.scene.add.image(0, 0, look.tex);
    img.setTexture(look.tex).setVisible(true).setActive(true).setDepth(35).setAlpha(1)
      .setScale(look.sx, look.sy).setBlendMode(o.kind === 'missile' ? Phaser.BlendModes.NORMAL : Phaser.BlendModes.ADD);
    if (look.tint) img.setTint(look.tint); else img.clearTint();
    const s: Shot = {
      img, x: o.x, y: o.y, vx: Math.cos(o.angle) * o.speed, vy: Math.sin(o.angle) * o.speed,
      kind: o.kind, team: o.team, damage: o.damage, splash: o.splash ?? 0, pierce: o.pierce ?? 1,
      hits: new Set(), src: o.src ?? null, target: o.target ?? null, gravity: o.gravity ?? 0,
      life: o.life ?? 2.2, age: 0, radius: look.radius,
    };
    this.list.push(s);
    this.place(s);
  }

  private place(s: Shot) {
    s.img.setPosition(s.x, s.y);
    s.img.setRotation(Math.atan2(s.vy, s.vx));
  }

  private kill(i: number) {
    const s = this.list[i];
    s.img.setVisible(false).setActive(false);
    this.pool.push(s.img);
    this.list.splice(i, 1);
  }

  clear() {
    for (let i = this.list.length - 1; i >= 0; i--) this.kill(i);
  }

  update(dt: number) {
    const enemyTargets = this.w.targets('enemy');
    const playerTargets = this.w.targets('player');
    const shields = this.w.shields();
    for (let i = this.list.length - 1; i >= 0; i--) {
      const s = this.list[i];
      s.age += dt;
      if (s.age > s.life) {
        if (s.splash) this.explode(s, s.x, s.y);
        this.kill(i);
        continue;
      }
      if (s.kind === 'missile') {
        if (!s.target || !s.target.alive) s.target = nearest(s.team === 'player' ? enemyTargets : playerTargets, s.x, s.y, 1400);
        const sp = Math.hypot(s.vx, s.vy);
        let ang = Math.atan2(s.vy, s.vx);
        if (s.target && s.age > 0.18) {
          const want = Math.atan2(s.target.cy - s.y, s.target.cx - s.x);
          ang = Phaser.Math.Angle.RotateTo(ang, want, (s.team === 'player' ? 6.5 : 2.2) * dt);
        }
        const nsp = Math.min(sp + 900 * dt, s.team === 'player' ? 1100 : 560);
        s.vx = Math.cos(ang) * nsp;
        s.vy = Math.sin(ang) * nsp;
        if (Math.random() < 0.7) this.w.effects.missileTrail(s.x - s.vx * 0.02, s.y - s.vy * 0.02);
      } else if (s.kind === 'shell' && Math.random() < 0.5) {
        this.w.effects.missileTrail(s.x, s.y);
      }
      s.vy += s.gravity * GRAVITY * dt;
      // 速い弾はすり抜けないよう分割して進める
      const steps = Math.max(1, Math.ceil((Math.hypot(s.vx, s.vy) * dt) / 18));
      let dead = false;
      for (let k = 0; k < steps && !dead; k++) {
        s.x += (s.vx * dt) / steps;
        s.y += (s.vy * dt) / steps;
        if (pointInSolids(s.x, s.y, this.w.solids)) {
          if (s.splash) this.explode(s, s.x, s.y);
          else this.w.effects.impact(s.x, s.y, 0.8);
          dead = true;
          break;
        }
        if (s.team === 'enemy') {
          for (const z of shields) {
            if (s.x >= z.x && s.x <= z.x + z.w && s.y >= z.y && s.y <= z.y + z.h) {
              z.absorb(s.damage, s.x, s.y);
              this.w.effects.impact(s.x, s.y, 1);
              audio.play('shield', 0.6);
              dead = true;
              break;
            }
          }
          if (dead) break;
        }
        const targets = s.team === 'player' ? enemyTargets : playerTargets;
        for (const t of targets) {
          if (!t.alive || s.hits.has(t)) continue;
          const mul = t.hitTest(s.x, s.y, s.radius);
          if (mul <= 0) continue;
          s.hits.add(t);
          if (s.splash) {
            this.explode(s, s.x, s.y);
            dead = true;
            break;
          }
          let dmg = s.damage * mul;
          if (s.team === 'player' && t.marked > 0) dmg *= RECON.damageMul;
          t.damage(dmg, s.src, s.x, s.y);
          this.w.credit(s.src, dmg);
          this.w.effects.impact(s.x, s.y, mul > 1 ? 1.6 : 1);
          if (s.team === 'player') audio.play('hit', 0.5);
          s.pierce--;
          if (s.pierce <= 0) {
            dead = true;
            break;
          }
        }
      }
      if (dead) {
        this.kill(i);
        continue;
      }
      this.place(s);
    }
  }

  private explode(s: Shot, x: number, y: number) {
    const size = s.splash / 80;
    this.w.effects.explosion(x, y, size);
    audio.play(s.splash > 100 ? 'bigExplode' : 'explode', 0.7);
    this.w.camShake(s.splash / 18);
    const targets = this.w.targets(s.team === 'player' ? 'enemy' : 'player');
    for (const t of targets) {
      if (!t.alive) continue;
      const b = t.bounds();
      const nx = Phaser.Math.Clamp(x, b.x, b.x + b.w), ny = Phaser.Math.Clamp(y, b.y, b.y + b.h);
      const d = Math.hypot(nx - x, ny - y);
      if (d > s.splash) continue;
      let dmg = s.damage * (1 - 0.5 * (d / s.splash));
      if (s.team === 'player' && t.marked > 0) dmg *= RECON.damageMul;
      t.damage(dmg, s.src, nx, ny);
      this.w.credit(s.src, dmg);
    }
  }
}

export function nearest(list: Hittable[], x: number, y: number, maxD = Infinity): Hittable | null {
  let best: Hittable | null = null, bd = maxD;
  for (const t of list) {
    if (!t.alive) continue;
    const d = Math.hypot(t.cx - x, t.cy - y) - (t.marked > 0 ? 300 : 0);
    if (d < bd) { bd = d; best = t; }
  }
  return best;
}
