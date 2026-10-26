// 敵: 量産型の機体、戦車、攻撃ヘリ、砲台、ボス（多脚戦車ゴライアス）。
import Phaser from 'phaser';
import { ENEMY_DEFS, GRAVITY } from './data';
import { MechRig } from './rig';
import { lineBlocked, stepBody, type Body } from './physics';
import type { Hittable, Source } from './types';
import { audio } from './audio';
import { approach } from './player';
import { GROUND } from './level';
import type { GameScene } from '../scenes/GameScene';

const STORE = 1.5;

export abstract class Enemy implements Hittable {
  team = 'enemy' as const;
  alive = true;
  hp: number;
  maxHp: number;
  marked = 0;
  protected flashT = 0;
  abstract cx: number;
  abstract cy: number;
  isBoss = false;

  constructor(readonly scene: GameScene, hp: number, readonly score: number) {
    this.maxHp = Math.round(hp * scene.enemyHpMul);
    this.hp = this.maxHp;
  }

  abstract bounds(): { x: number; y: number; w: number; h: number };
  abstract update(dt: number): void;
  abstract destroy(): void;
  protected abstract flash(on: boolean): void;

  hitTest(x: number, y: number, r: number): number {
    const b = this.bounds();
    return x >= b.x - r && x <= b.x + b.w + r && y >= b.y - r && y <= b.y + b.h + r ? 1 : 0;
  }

  damage(amount: number, src: Source | null) {
    if (!this.alive) return;
    this.hp -= amount;
    this.flashT = 0.06;
    if (this.hp <= 0) {
      this.alive = false;
      this.scene.onEnemyKilled(this, src);
      this.die();
    }
  }

  protected die() {
    const b = this.bounds();
    this.scene.effects.explosion(b.x + b.w / 2, b.y + b.h / 2, Math.max(1, b.w / 120));
    audio.play('explode');
    this.scene.camShake(6);
    this.destroy();
    this.scene.removeEnemy(this);
  }

  tick(dt: number) {
    this.marked = Math.max(0, this.marked - dt);
    if (this.flashT > 0) {
      this.flashT -= dt;
      this.flash(true);
    } else this.flash(false);
    this.update(dt);
  }

  /** 射撃方向（少しばらつかせる） */
  protected aimAt(x: number, y: number, t: Hittable, spread = 0.08, lead = 0) {
    return Math.atan2(t.cy - y, t.cx + lead - x) + (Math.random() - 0.5) * spread;
  }

  protected canSee(x: number, y: number, t: Hittable) {
    return !lineBlocked(x, y, t.cx, t.cy, this.scene.solids);
  }
}

// ------------------------------------------------------------------ 量産型の機体

export class EnemyMech extends Enemy {
  body: Body;
  rig: MechRig;
  facing = -1;
  aim = 0;
  private walk = 0;
  private fireT = 1 + Math.random() * 1.5;
  private burst = 0;
  private burstT = 0;
  private dropping: boolean;
  private strafe = 0;
  private strafeT = 0;
  private crouch = 0;
  private wasGround = false;
  private stepIdx = 0;

  constructor(scene: GameScene, x: number, y: number, drop = false) {
    super(scene, ENEMY_DEFS.mech.hp, ENEMY_DEFS.mech.score);
    this.rig = new MechRig(scene, 'enemy');
    this.rig.setDepth(15);
    this.body = { x, y, w: 60, h: this.rig.d.height * 0.88, vx: 0, vy: 0, onGround: false, hitWall: 0 };
    this.dropping = drop;
    if (drop) {
      this.body.y = scene.cameras.main.worldView.top - 60;
      this.body.vy = 300;
    }
  }
  get cx() {
    return this.body.x;
  }
  get cy() {
    return this.body.y - this.body.h * 0.55;
  }
  bounds() {
    return { x: this.body.x - this.body.w / 2, y: this.body.y - this.body.h, w: this.body.w, h: this.body.h };
  }
  protected flash(on: boolean) {
    if (on) this.rig.hitFlash();
  }

  update(dt: number) {
    const b = this.body;
    const t = this.scene.pickTarget(b.x, b.y - 90);
    let move = 0;
    if (this.dropping) {
      b.gravityScale = 0.35;
      if (b.onGround) {
        this.dropping = false;
        b.gravityScale = 1;
      }
    } else if (t) {
      const dx = t.cx - b.x;
      const dist = Math.abs(dx);
      this.facing = dx >= 0 ? 1 : -1;
      this.strafeT -= dt;
      if (this.strafeT <= 0) {
        this.strafeT = 0.8 + Math.random() * 1.6;
        this.strafe = Math.random() < 0.5 ? 0 : Math.random() < 0.5 ? -1 : 1;
      }
      if (dist > 620) move = this.facing;
      else if (dist < 280) move = -this.facing;
      else move = this.strafe;
      if (b.onGround && ((b.hitWall && move) || (t.cy < b.y - 260 && Math.random() < 0.02) || Math.random() < 0.002)) {
        b.vy = -720;
      }
      // 照準と射撃
      const ang = Math.atan2(t.cy - (b.y - 120), t.cx - b.x);
      const local = Phaser.Math.Angle.Wrap(this.facing > 0 ? ang : Math.PI - ang);
      this.aim = approach(this.aim, Phaser.Math.Clamp(local, -1.3, 0.9), 3 * dt);
      this.fireT -= dt;
      if (this.fireT <= 0 && dist < 1150 && this.canSee(b.x, b.y - 120, t)) {
        this.fireT = 1.7 + Math.random() * 1.2;
        this.burst = 3;
        this.burstT = 0;
      }
      if (this.burst > 0) {
        this.burstT -= dt;
        if (this.burstT <= 0) {
          this.burstT = 0.12;
          this.burst--;
          const m = this.rig.muzzle;
          const a = (this.facing > 0 ? this.aim : Math.PI - this.aim) + (Math.random() - 0.5) * 0.12;
          this.scene.shots.fire({ x: m.x, y: m.y, angle: a, speed: 820, kind: 'enemy', team: 'enemy', damage: 9 });
          this.scene.effects.muzzle(m.x, m.y, a, 0.9, 0xff8080);
          audio.play('enemy', 0.6);
        }
      }
    }
    b.vx = approach(b.vx, move * ENEMY_DEFS.mech.speed, 450 * dt);
    stepBody(b, dt, this.scene.solids);
    if (b.onGround && !this.wasGround) {
      this.crouch = 1;
      this.scene.effects.dustFx(b.x, b.y, 6);
    }
    this.wasGround = b.onGround;
    this.crouch = Math.max(0, this.crouch - dt * 5);
    if (b.onGround && Math.abs(b.vx) > 10) {
      this.walk += ((Math.PI * Math.abs(b.vx) * dt) / this.rig.stride) * Math.sign(b.vx * this.facing);
      const idx = Math.floor(this.walk / Math.PI);
      if (idx !== this.stepIdx) {
        this.stepIdx = idx;
        audio.play('step', 0.25);
        this.scene.effects.dustFx(b.x, b.y, 2);
      }
    }
    this.rig.setPosition(b.x, b.y);
    this.rig.scaleX = this.facing;
    this.rig.facing = this.facing;
    this.rig.update(dt, {
      aim: this.aim, walkPhase: this.walk, speed01: b.onGround ? Math.min(1, Math.abs(b.vx) / ENEMY_DEFS.mech.speed) : 0,
      airborne: !b.onGround, vy: b.vy, crouch: this.crouch, recoil: 0, lean: 0, wreck: false, shieldUp: false,
      braced: false, thrust: this.dropping ? 1 : 0, boost: 0,
    });
    this.rig.setBaseTint(this.marked > 0 ? 0xffb0b0 : 0xffffff);
  }

  destroy() {
    this.rig.destroy();
  }
}

// ------------------------------------------------------------------ 戦車

export class Tank extends Enemy {
  body: Body;
  img: Phaser.GameObjects.Image;
  facing = -1;
  private fireT = 2;
  private mgT = 3;
  private mgBurst = 0;
  private shake = 0;

  constructor(scene: GameScene, x: number, y: number) {
    super(scene, ENEMY_DEFS.tank.hp, ENEMY_DEFS.tank.score);
    this.img = scene.add.image(x, y, 'tank').setOrigin(0.5, 1).setScale(1 / STORE).setDepth(14);
    this.body = { x, y, w: 240, h: 110, vx: 0, vy: 0, onGround: false, hitWall: 0 };
  }
  get cx() {
    return this.body.x;
  }
  get cy() {
    return this.body.y - 60;
  }
  bounds() {
    return { x: this.body.x - 125, y: this.body.y - 120, w: 250, h: 120 };
  }
  protected flash(on: boolean) {
    if (on) this.img.setTintFill(0xffffff);
    else this.img.setTint(this.marked > 0 ? 0xffb0b0 : 0xffffff);
  }

  update(dt: number) {
    const b = this.body;
    const t = this.scene.pickTarget(b.x, b.y - 60);
    let move = 0;
    if (t) {
      const dx = t.cx - b.x;
      this.facing = dx >= 0 ? 1 : -1;
      if (Math.abs(dx) > 700) move = this.facing;
      else if (Math.abs(dx) < 380) move = -this.facing;
      this.fireT -= dt;
      const mx = b.x + this.facing * 128, my = b.y - 115;
      if (this.fireT <= 0 && Math.abs(dx) < 1400) {
        this.fireT = 3 + Math.random();
        const ang = ballistic(mx, my, t.cx, t.cy, 950, GRAVITY * 0.5, this.facing);
        this.scene.shots.fire({ x: mx, y: my, angle: ang, speed: 950, kind: 'enemyShell', team: 'enemy', damage: 34, splash: 85, gravity: 0.5, life: 4 });
        this.scene.effects.muzzle(mx, my, ang, 2.2, 0xffa060);
        this.scene.effects.smokePuff(mx, my, 3);
        audio.play('shell', 0.7);
        this.shake = 0.2;
        b.vx -= this.facing * 80;
      }
      this.mgT -= dt;
      if (this.mgT <= 0 && Math.abs(dx) < 900) {
        this.mgT = 2.5;
        this.mgBurst = 5;
      }
      if (this.mgBurst > 0 && Math.random() < dt * 10) {
        this.mgBurst--;
        const gx = b.x + this.facing * 20, gy = b.y - 128;
        const a = this.aimAt(gx, gy, t, 0.12);
        this.scene.shots.fire({ x: gx, y: gy, angle: a, speed: 800, kind: 'enemy', team: 'enemy', damage: 7 });
        audio.play('enemy', 0.4);
      }
    }
    b.vx = approach(b.vx, move * ENEMY_DEFS.tank.speed, 300 * dt);
    stepBody(b, dt, this.scene.solids);
    this.shake = Math.max(0, this.shake - dt);
    const jitter = Math.abs(b.vx) > 5 ? (Math.random() - 0.5) * 1.5 : 0;
    this.img.setPosition(b.x, b.y + jitter + (this.shake > 0 ? -2 : 0));
    this.img.setFlipX(this.facing < 0);
    if (Math.abs(b.vx) > 20 && Math.random() < 0.2) this.scene.effects.dustFx(b.x - this.facing * 100, b.y, 1);
  }

  destroy() {
    this.img.destroy();
  }
}

/** 放物線で届く角度（届かなければ 45 度） */
function ballistic(x0: number, y0: number, x1: number, y1: number, v: number, g: number, facing: number) {
  const dx = Math.abs(x1 - x0), dy = y0 - y1; // 上が正
  const v2 = v * v;
  const disc = v2 * v2 - g * (g * dx * dx + 2 * dy * v2);
  let a = Math.PI / 4;
  if (disc >= 0) a = Math.atan((v2 - Math.sqrt(disc)) / (g * dx));
  return facing > 0 ? -a : Math.PI + a;
}

// ------------------------------------------------------------------ 攻撃ヘリ

export class Heli extends Enemy {
  x: number;
  y: number;
  vx = 0;
  vy = 0;
  img: Phaser.GameObjects.Image;
  rotor: Phaser.GameObjects.Graphics;
  facing = -1;
  private baseY: number;
  private gunT = 1.5;
  private burst = 0;
  private rocketT = 4;
  private side = 1;
  private sideT = 0;
  private falling = false;
  private spin = 0;
  private time = Math.random() * 10;

  constructor(scene: GameScene, x: number, y: number) {
    super(scene, ENEMY_DEFS.heli.hp, ENEMY_DEFS.heli.score);
    this.x = x;
    this.y = y - 300;
    this.baseY = y;
    this.img = scene.add.image(x, y, 'heli').setScale(1 / STORE).setDepth(16);
    this.rotor = scene.add.graphics().setDepth(17);
    audio.play('alarm', 0.3);
  }
  get cx() {
    return this.x;
  }
  get cy() {
    return this.y;
  }
  bounds() {
    return { x: this.x - 130, y: this.y - 40, w: 260, h: 80 };
  }
  protected flash(on: boolean) {
    if (on) this.img.setTintFill(0xffffff);
    else this.img.setTint(this.marked > 0 ? 0xffb0b0 : 0xffffff);
  }

  protected die() {
    // 墜落してから爆発する
    this.falling = true;
    this.scene.effects.explosion(this.x, this.y, 1);
    audio.play('explode');
  }

  update(dt: number) {
    this.time += dt;
    if (this.falling) {
      this.vy += 900 * dt;
      this.x += this.vx * dt;
      this.y += this.vy * dt;
      this.spin += dt * 4;
      this.img.setRotation(this.spin * this.facing * 0.4);
      if (Math.random() < 0.6) this.scene.effects.smokePuff(this.x, this.y, 1);
      if (this.y > GROUND - 30 || this.scene.pointSolid(this.x, this.y + 30)) {
        this.scene.effects.explosion(this.x, this.y, 2.2);
        audio.play('bigExplode');
        this.scene.camShake(12);
        this.destroy();
        this.scene.removeEnemy(this);
        return;
      }
    } else {
      const t = this.scene.pickTarget(this.x, this.y);
      let tx = this.x, ty = this.baseY;
      if (t) {
        this.sideT -= dt;
        if (this.sideT <= 0) {
          this.sideT = 4 + Math.random() * 3;
          this.side = Math.random() < 0.5 ? -1 : 1;
        }
        tx = t.cx + this.side * 380;
        ty = this.baseY + Math.sin(this.time * 1.3) * 40;
        this.facing = t.cx >= this.x ? 1 : -1;
        this.gunT -= dt;
        if (this.gunT <= 0) {
          this.gunT = 2.2 + Math.random();
          this.burst = 6;
        }
        if (this.burst > 0 && Math.random() < dt * 12) {
          this.burst--;
          const gx = this.x + this.facing * 120, gy = this.y + 35;
          const a = this.aimAt(gx, gy, t, 0.15);
          this.scene.shots.fire({ x: gx, y: gy, angle: a, speed: 850, kind: 'enemy', team: 'enemy', damage: 8 });
          this.scene.effects.muzzle(gx, gy, a, 0.8, 0xff8080);
          audio.play('enemy', 0.5);
        }
        this.rocketT -= dt;
        if (this.rocketT <= 0) {
          this.rocketT = 5 + Math.random() * 2;
          for (let i = 0; i < 2; i++) {
            const a = this.aimAt(this.x, this.y + 20, t, 0.1);
            this.scene.shots.fire({
              x: this.x + this.facing * 40, y: this.y + 20 + i * 8, angle: a, speed: 620, kind: 'enemyShell', team: 'enemy',
              damage: 26, splash: 70, life: 3,
            });
          }
          audio.play('missile', 0.5);
        }
      }
      const ax = Phaser.Math.Clamp((tx - this.x) * 2 - this.vx * 1.6, -500, 500);
      const ay = Phaser.Math.Clamp((ty - this.y) * 2 - this.vy * 1.6, -500, 500);
      this.vx += ax * dt;
      this.vy += ay * dt;
      this.x += this.vx * dt;
      this.y += this.vy * dt;
      this.img.setRotation(Phaser.Math.Clamp(this.vx / 1500, -0.25, 0.25));
    }
    this.img.setPosition(this.x, this.y);
    this.img.setFlipX(this.facing < 0);
    // ローター（回転の残像）
    const g = this.rotor;
    g.clear();
    const hubX = this.x + this.facing * (0.13 * 300), hubY = this.y - 0.37 * 103;
    const w = 150 * Math.abs(Math.cos(this.time * 40));
    g.lineStyle(3, 0x1a1a1a, 0.8);
    g.lineBetween(hubX - w, hubY, hubX + w, hubY);
    g.fillStyle(0x222222, 0.18);
    g.fillEllipse(hubX, hubY, 300, 10);
    if (!this.falling && Math.random() < 0.1) audio.play('enemy', 0.05);
  }

  destroy() {
    this.img.destroy();
    this.rotor.destroy();
  }
}

// ------------------------------------------------------------------ 砲台

export class Turret extends Enemy {
  base: Phaser.GameObjects.Image;
  head: Phaser.GameObjects.Image;
  x: number;
  y: number;
  private ang = Math.PI;
  private fireT = 1.5;
  private shotsLeft = 0;

  constructor(scene: GameScene, x: number, y: number) {
    super(scene, ENEMY_DEFS.turret.hp, ENEMY_DEFS.turret.score);
    this.x = x;
    this.y = y;
    this.base = scene.add.image(x, y, 'turret_base').setOrigin(0.5, 1).setScale(1 / STORE).setDepth(13);
    this.head = scene.add.image(x, y - 66, 'turret_head').setOrigin(0.22, 0.42).setScale(1 / STORE).setDepth(14);
  }
  get cx() {
    return this.x;
  }
  get cy() {
    return this.y - 60;
  }
  bounds() {
    return { x: this.x - 75, y: this.y - 110, w: 150, h: 110 };
  }
  protected flash(on: boolean) {
    for (const i of [this.base, this.head]) {
      if (on) i.setTintFill(0xffffff);
      else i.setTint(this.marked > 0 ? 0xffb0b0 : 0xffffff);
    }
  }

  update(dt: number) {
    const t = this.scene.pickTarget(this.x, this.y - 66);
    const hx = this.x, hy = this.y - 66;
    if (t) {
      const want = Math.atan2(t.cy - hy, t.cx - hx);
      this.ang = Phaser.Math.Angle.RotateTo(this.ang, want, 1.6 * dt);
      this.fireT -= dt;
      if (this.fireT <= 0 && Math.hypot(t.cx - hx, t.cy - hy) < 1300 && this.canSee(hx, hy, t)) {
        this.fireT = 1.8;
        this.shotsLeft = 4;
      }
      if (this.shotsLeft > 0 && Math.random() < dt * 9) {
        this.shotsLeft--;
        for (const off of [-7, 7]) {
          const mx = hx + Math.cos(this.ang) * 78 - Math.sin(this.ang) * off;
          const my = hy + Math.sin(this.ang) * 78 + Math.cos(this.ang) * off;
          this.scene.shots.fire({ x: mx, y: my, angle: this.ang + (Math.random() - 0.5) * 0.06, speed: 900, kind: 'enemy', team: 'enemy', damage: 10 });
          this.scene.effects.muzzle(mx, my, this.ang, 1, 0xff8080);
        }
        audio.play('enemy', 0.7);
      }
    }
    // 左向きのときは画像を上下反転して砲身が上に来ないようにする
    const left = Math.cos(this.ang) < 0;
    this.head.setFlipY(left);
    this.head.setOrigin(0.22, left ? 0.58 : 0.42);
    this.head.setRotation(this.ang);
  }

  destroy() {
    this.base.destroy();
    this.head.destroy();
  }
}

// ------------------------------------------------------------------ ボス

interface Leg {
  hip: { x: number; y: number }; // 胴体の中心からの位置（右向き基準）
  foot: { x: number; y: number }; // ワールド座標
  from: { x: number; y: number };
  to: { x: number; y: number };
  t: number; // 踏み出し中の進み 0..1（1 なら接地）
  upper: Phaser.GameObjects.Image;
  lower: Phaser.GameObjects.Image;
  front: boolean;
  near: boolean;
}

export class Boss extends Enemy {
  x: number;
  y: number; // 胴体の中心
  facing = -1;
  hull: Phaser.GameObjects.Image;
  legs: Leg[] = [];
  private g: Phaser.GameObjects.Graphics;
  private state: 'enter' | 'fight' | 'dying' = 'enter';
  private patrolDir = -1;
  private cannonT = 3;
  private aimLine = 0;
  private aimTarget: { x: number; y: number } | null = null;
  private mgT = 2;
  private mgBurst = 0;
  private missileT = 9;
  private stompT = 0;
  private stompCd = 4;
  private dyingT = 0;
  private time = 0;
  private reinforced = false;
  private standY: number;
  private readonly upperLen = 159 * 0.73;
  private readonly lowerLen = 209 * 0.86;

  constructor(scene: GameScene, x: number) {
    super(scene, ENEMY_DEFS.boss.hp * scene.bossHpMul / scene.enemyHpMul, ENEMY_DEFS.boss.score);
    this.isBoss = true;
    this.x = x;
    this.standY = GROUND - 330;
    this.y = this.standY;
    const mk = (near: boolean, front: boolean, hipX: number) => {
      const upper = scene.add.image(0, 0, 'boss_leg_upper').setOrigin(0.51, 0.17).setScale(1 / STORE).setDepth(near ? 19 : 11);
      const lower = scene.add.image(0, 0, 'boss_leg_lower').setOrigin(0.45, 0.11).setScale(1 / STORE).setDepth(near ? 18 : 10);
      if (!near) {
        upper.setTint(0x777777);
        lower.setTint(0x777777);
      }
      const hip = { x: hipX + (near ? 0 : 18), y: 90 };
      const fx = x + hipX * this.facing;
      const leg: Leg = { hip, foot: { x: fx, y: GROUND }, from: { x: fx, y: GROUND }, to: { x: fx, y: GROUND }, t: 1, upper, lower, front, near };
      this.legs.push(leg);
    };
    mk(false, true, 150);
    mk(false, false, -170);
    this.hull = scene.add.image(x, this.y, 'boss_hull').setScale(1 / STORE).setDepth(12);
    mk(true, true, 120);
    mk(true, false, -200);
    this.g = scene.add.graphics().setDepth(48);
  }

  get cx() {
    return this.x;
  }
  get cy() {
    return this.y;
  }
  bounds() {
    return { x: this.x - 290, y: this.y - 110, w: 580, h: 210 };
  }
  private corePos() {
    // 画像内の正規化座標 (0.36, 0.67) にある炉心
    return { x: this.x + (0.36 - 0.5) * 620 * this.facing, y: this.y + (0.67 - 0.5) * 245 };
  }
  hitTest(x: number, y: number, r: number) {
    if (this.state === 'dying') return 0;
    const c = this.corePos();
    if (Math.hypot(x - c.x, y - c.y) < 48 + r) return 2;
    return super.hitTest(x, y, r);
  }
  protected flash(on: boolean) {
    if (on) this.hull.setTintFill(0xffffff);
    else this.hull.setTint(this.marked > 0 ? 0xffb0b0 : 0xffffff);
  }

  damage(amount: number, src: Source | null) {
    if (this.state === 'dying' || this.state === 'enter') return;
    if (!this.alive) return;
    this.hp -= amount;
    this.flashT = 0.05;
    if (this.hp <= 0) {
      this.hp = 0;
      this.state = 'dying';
      this.dyingT = 0;
      this.scene.onEnemyKilled(this, src);
    }
  }

  get phase() {
    const r = this.hp / this.maxHp;
    return r > 0.6 ? 1 : r > 0.3 ? 2 : 3;
  }

  update(dt: number) {
    this.time += dt;
    const arenaL = this.scene.arenaBounds.left + 380, arenaR = this.scene.arenaBounds.right - 360;
    let vx = 0;
    if (this.state === 'enter') {
      vx = -140;
      if (this.x <= arenaR) {
        this.state = 'fight';
        this.scene.onBossReady();
      }
    } else if (this.state === 'fight') {
      const t = this.scene.pickTarget(this.x, this.y);
      this.facing = t ? (t.cx < this.x ? -1 : 1) : this.facing;
      const speed = this.phase === 3 ? 110 : 75;
      if (this.stompT <= 0) {
        vx = this.patrolDir * speed;
        if (this.x < arenaL) this.patrolDir = 1;
        if (this.x > arenaR) this.patrolDir = -1;
      }
      if (t) this.attacks(dt, t);
      if (!this.reinforced && this.hp < this.maxHp * 0.5) {
        this.reinforced = true;
        this.scene.spawnEnemy({ kind: 'heli', x: this.scene.arenaBounds.right - 100, y: GROUND - 600 });
        this.scene.spawnEnemy({ kind: 'heli', x: this.scene.arenaBounds.left + 100, y: GROUND - 640 });
      }
    } else {
      this.dyingT += dt;
      if (Math.random() < dt * 14) {
        const b = this.bounds();
        this.scene.effects.explosion(b.x + Math.random() * b.w, b.y + Math.random() * b.h, 0.8 + Math.random());
        audio.play('explode');
        this.scene.camShake(5);
      }
      this.y += dt * 30;
      if (this.dyingT > 2.6) {
        this.scene.effects.explosion(this.x, this.y, 4.5);
        audio.play('bigExplode');
        this.scene.camShake(30);
        this.alive = false;
        this.destroy();
        this.scene.removeEnemy(this);
        this.scene.onBossDefeated();
        return;
      }
    }
    this.x += vx * dt;
    this.stepLegs(dt, vx);
    this.draw();
  }

  private attacks(dt: number, t: Hittable) {
    const ph = this.phase;
    // 主砲: 照準線を出してから撃つ
    this.cannonT -= dt;
    const mz = { x: this.x + 0.495 * 620 * this.facing, y: this.y + (0.35 - 0.5) * 245 };
    if (this.cannonT <= 0 && !this.aimTarget) {
      this.aimTarget = { x: t.cx, y: t.cy };
      this.aimLine = 0.9;
      audio.play('alarm', 0.25);
    }
    if (this.aimTarget) {
      this.aimLine -= dt;
      if (this.aimLine <= 0) {
        const a = Math.atan2(this.aimTarget.y - mz.y, this.aimTarget.x - mz.x);
        for (const off of [-10, 10]) {
          this.scene.shots.fire({ x: mz.x, y: mz.y + off, angle: a, speed: 1150, kind: 'bossShell', team: 'enemy', damage: 55, splash: 130, life: 3 });
        }
        this.scene.effects.muzzle(mz.x, mz.y, a, 4, 0xffa060);
        this.scene.effects.smokePuff(mz.x, mz.y, 6);
        audio.play('bigExplode', 0.6);
        this.scene.camShake(10);
        this.aimTarget = null;
        this.cannonT = ph === 1 ? 4.2 : 3.2;
      }
    }
    // 副砲の掃射
    this.mgT -= dt;
    if (this.mgT <= 0) {
      this.mgT = ph === 3 ? 2.2 : 3;
      this.mgBurst = 12;
    }
    if (this.mgBurst > 0 && Math.random() < dt * 14) {
      this.mgBurst--;
      const gx = this.x + this.facing * 120, gy = this.y - 120;
      const a = Math.atan2(t.cy - gy, t.cx - gx) + Math.sin(this.time * 6) * 0.25;
      this.scene.shots.fire({ x: gx, y: gy, angle: a, speed: 820, kind: 'enemy', team: 'enemy', damage: 8 });
      audio.play('enemy', 0.5);
    }
    // ミサイルの雨（第2段階から）
    if (ph >= 2) {
      this.missileT -= dt;
      if (this.missileT <= 0) {
        this.missileT = ph === 3 ? 6 : 8;
        for (let i = 0; i < 8; i++) {
          this.scene.time.delayedCall(i * 90, () => {
            if (!this.alive) return;
            const sx = this.x - this.facing * 60 + (i % 2) * 40, sy = this.y - 130;
            this.scene.shots.fire({
              x: sx, y: sy, angle: -Math.PI / 2 + (Math.random() - 0.5) * 0.6, speed: 450, kind: 'missile', team: 'enemy',
              damage: 22, splash: 70, life: 4,
            });
            audio.play('missile', 0.4);
          });
        }
      }
    }
    // 踏みつけ（第3段階、近くにいると）
    this.stompCd -= dt;
    if (ph === 3 && this.stompCd <= 0 && Math.abs(t.cx - this.x) < 340 && this.stompT <= 0) {
      this.stompT = 1.1;
      this.stompCd = 5;
    }
    if (this.stompT > 0) {
      const before = this.stompT;
      this.stompT -= dt;
      if (before > 0.35 && this.stompT <= 0.35) {
        this.scene.shockwave(this.x, GROUND, 45);
        audio.play('bigExplode', 0.8);
        this.scene.camShake(18);
      }
    }
  }

  private stepLegs(dt: number, vx: number) {
    // 体の高さ（踏みつけの溜めで持ち上げ、振り下ろす）
    let target = this.standY + Math.sin(this.time * 2) * 4;
    if (this.stompT > 0.35) target -= 70;
    else if (this.stompT > 0) target += 30;
    if (this.state === 'dying') target = this.y;
    this.y = this.state === 'dying' ? this.y : approach(this.y, target, (this.stompT > 0 ? 500 : 120) * dt);

    const moving = Math.abs(vx) > 1;
    const stride = 140;
    // 対角の脚が交互に踏み出す
    const steppingCount = this.legs.filter((l) => l.t < 1).length;
    for (const [i, l] of this.legs.entries()) {
      const home = this.x + l.hip.x * this.facing + Math.sign(vx) * 40;
      if (l.t < 1) {
        l.t = Math.min(1, l.t + dt * 2.6);
        l.foot.x = Phaser.Math.Linear(l.from.x, l.to.x, l.t);
        l.foot.y = GROUND - Math.sin(l.t * Math.PI) * 50;
        if (l.t >= 1) {
          this.scene.effects.dustFx(l.foot.x, GROUND, 5);
          this.scene.camShake(1.5);
          audio.play('land', 0.4);
        }
      } else if (moving && steppingCount < 2 && Math.abs(l.foot.x - home) > stride * 0.6) {
        const pairOk = this.legs.every((o, j) => j === i || (o.t >= 1 || (o.front !== l.front) === (o.near !== l.near)));
        if (pairOk) {
          l.from = { ...l.foot };
          l.to = { x: home + Math.sign(vx) * stride * 0.5, y: GROUND };
          l.t = 0;
        }
      } else if (!moving && this.stompT <= 0 && Math.abs(l.foot.x - home) > 80 && steppingCount === 0) {
        l.from = { ...l.foot };
        l.to = { x: home, y: GROUND };
        l.t = 0;
      }
      // IK（膝は上外側へ）
      const hx = this.x + l.hip.x * this.facing, hy = this.y + l.hip.y;
      const dx = l.foot.x - hx, dy = l.foot.y - hy;
      const d = Math.min(Math.hypot(dx, dy), this.upperLen + this.lowerLen - 1);
      const a = Math.atan2(dy, dx);
      const k = Math.acos(Phaser.Math.Clamp((this.upperLen ** 2 + d * d - this.lowerLen ** 2) / (2 * this.upperLen * d), -1, 1));
      const outward = (l.front ? 1 : -1) * this.facing;
      const ka = a - k * outward;
      const kx = hx + Math.cos(ka) * this.upperLen, ky = hy + Math.sin(ka) * this.upperLen;
      l.upper.setPosition(hx, hy).setRotation(Math.atan2(ky - hy, kx - hx) - Math.PI / 2 + 0.05);
      l.lower.setPosition(kx, ky).setRotation(Math.atan2(l.foot.y - ky, l.foot.x - kx) - Math.PI / 2);
      l.upper.setFlipX(this.facing < 0);
      l.lower.setFlipX(this.facing < 0);
    }
  }

  private draw() {
    this.hull.setPosition(this.x, this.y);
    this.hull.setFlipX(this.facing < 0);
    this.hull.setRotation(this.state === 'dying' ? Math.sin(this.time * 30) * 0.02 : 0);
    const g = this.g;
    g.clear();
    // 炉心の光
    const c = this.corePos();
    const pulse = 0.5 + 0.5 * Math.sin(this.time * 6);
    g.fillStyle(0xff8a2a, 0.15 + pulse * 0.2);
    g.fillCircle(c.x, c.y, 40 + pulse * 10);
    // 主砲の照準線
    if (this.aimTarget) {
      const mz = { x: this.x + 0.495 * 620 * this.facing, y: this.y + (0.35 - 0.5) * 245 };
      const blink = Math.floor(this.aimLine * 12) % 2 === 0;
      g.lineStyle(blink ? 3 : 1.5, 0xff3030, 0.85);
      const a = Math.atan2(this.aimTarget.y - mz.y, this.aimTarget.x - mz.x);
      g.lineBetween(mz.x, mz.y, mz.x + Math.cos(a) * 2400, mz.y + Math.sin(a) * 2400);
    }
  }

  destroy() {
    this.hull.destroy();
    this.g.destroy();
    for (const l of this.legs) {
      l.upper.destroy();
      l.lower.destroy();
    }
  }
}
