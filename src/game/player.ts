// プレイヤーの機体・パイロット・参加者。
import Phaser from 'phaser';
import {
  BRACE, MISSILES, PILOT, RECON, REPAIR, RESPAWN_TIME, ROLE_DEFS, SHIELD, WRECK_REPAIR_TIME,
  levelDamageMul, levelRateMul, weaponLevel, type RoleDef, type RoleId, type WeaponDef,
} from './data';
import { MechRig } from './rig';
import { stepBody, type Body } from './physics';
import type { Hittable, Source } from './types';
import type { PlayerInput, DeviceId } from './input';
import type { ShieldZone } from './shots';
import { audio } from './audio';
import { save } from './save';
import { unlock } from './steam';
import type { GameScene } from '../scenes/GameScene';

const SFX: Record<string, Parameters<typeof audio.play>[0]> = {
  mg: 'mg', shell: 'shell', rifle: 'rifle', smg: 'smg', pistol: 'pistol',
};

export interface PlayerStats {
  kills: number;
  damage: number;
  repairs: number;
  deaths: number;
}

export class Player {
  readonly def: RoleDef;
  mech: PlayerMech | null = null;
  pilot: Pilot | null = null;
  state: 'mech' | 'pilot' | 'kia' = 'mech';
  respawn = 0;
  stats: PlayerStats = { kills: 0, damage: 0, repairs: 0, deaths: 0 };
  readonly xpStart: number;
  lastLevel: number;

  constructor(readonly scene: GameScene, readonly index: number, readonly device: DeviceId, readonly role: RoleId) {
    this.def = ROLE_DEFS[role];
    this.xpStart = save.weaponXp[role];
    this.lastLevel = weaponLevel(this.xpStart);
  }

  get color() {
    return this.def.color;
  }

  get weaponLv() {
    return weaponLevel(save.weaponXp[this.role]);
  }

  /** カメラが追う位置 */
  focus(): { x: number; y: number } | null {
    if (this.state === 'mech' && this.mech) return { x: this.mech.body.x, y: this.mech.body.y - 90 };
    if (this.state === 'pilot' && this.pilot) return { x: this.pilot.body.x, y: this.pilot.body.y - 20 };
    return null;
  }

  activeBody(): Body | null {
    if (this.state === 'mech' && this.mech) return this.mech.body;
    if (this.state === 'pilot' && this.pilot) return this.pilot.body;
    return null;
  }

  spawnMech(x: number, y: number) {
    this.mech?.destroy();
    this.mech = new PlayerMech(this.scene, this, x, y);
    this.state = 'mech';
    this.pilot?.destroy();
    this.pilot = null;
  }

  eject() {
    if (!this.mech) return;
    this.pilot = new Pilot(this.scene, this, this.mech.body.x, this.mech.body.y - 120);
    this.pilot.body.vy = -720;
    this.pilot.body.vx = -this.mech.facing * 120;
    this.pilot.invuln = 0.8;
    this.state = 'pilot';
    audio.play('eject');
    this.scene.effects.smokePuff(this.mech.body.x, this.mech.body.y - 120, 4);
  }

  board() {
    if (!this.mech || !this.pilot) return;
    this.pilot.destroy();
    this.pilot = null;
    this.mech.state = 'piloted';
    this.state = 'mech';
    audio.play('uiOk');
  }

  kill() {
    this.state = 'kia';
    this.stats.deaths++;
    this.pilot?.destroy();
    this.pilot = null;
    this.respawn = this.scene.reinforcements > 0 ? RESPAWN_TIME : -1;
  }

  update(dt: number, inp: PlayerInput) {
    if (this.state === 'kia') {
      if (this.respawn > 0) {
        this.respawn -= dt;
        if (this.respawn <= 0) this.scene.redeploy(this);
      }
    }
    // 降機したフレームに、同じボタンでそのまま再搭乗しないよう入力を分ける
    const st = this.state;
    this.mech?.update(dt, st === 'mech' ? inp : null);
    if (this.pilot) this.pilot.update(dt, st === 'pilot' ? inp : idleInput(inp));
    const lv = this.weaponLv;
    if (lv > this.lastLevel) {
      this.lastLevel = lv;
      if (lv >= 5) unlock('WEAPON_MASTER');
      const f = this.focus();
      if (f) this.scene.popText(f.x, f.y - 140, 'lvUp', this.color);
      audio.play('lvup');
    }
  }

  destroy() {
    this.mech?.destroy();
    this.pilot?.destroy();
  }
}

// ------------------------------------------------------------------ 機体

export class PlayerMech implements Hittable {
  team = 'player' as const;
  body: Body;
  rig: MechRig;
  def: RoleDef;
  hp: number;
  maxHp: number;
  state: 'piloted' | 'empty' | 'wreck' = 'piloted';
  facing = 1;
  aim = 0;
  marked = 0;
  repair = 0; // 撃破後の修理進み具合 0..1
  private fireCd = 0;
  skillCd = 0;
  fuel: number;
  private airJumps = 0;
  private thrust = 0;
  private walkPhase = 0;
  private crouch = 0;
  private recoil = 0;
  private braceT = 0;
  braced = false;
  shieldHp = SHIELD.max;
  shieldUp = false;
  shieldBroken = 0;
  energy = REPAIR.energy;
  beamTarget: { x: number; y: number } | null = null;
  private missileQueue = 0;
  private missileT = 0;
  private wasGround = true;
  private label: Phaser.GameObjects.Text;
  private beam: Phaser.GameObjects.Graphics;
  private smokeT = 0;

  constructor(readonly scene: GameScene, readonly owner: Player, x: number, y: number) {
    this.def = owner.def;
    this.maxHp = Math.round(this.def.hp);
    this.hp = this.maxHp;
    this.rig = new MechRig(scene, owner.role);
    this.rig.setDepth(20 + owner.index);
    const h = this.rig.d.height * 0.88;
    this.body = { x, y, w: this.def.bodyW, h, vx: 0, vy: 0, onGround: false, hitWall: 0 };
    this.fuel = this.def.fuel;
    this.label = scene.add.text(0, 0, `${owner.index + 1}P`, {
      fontFamily: 'Rajdhani, sans-serif', fontSize: '22px', fontStyle: 'bold',
      color: '#' + this.def.color.toString(16).padStart(6, '0'), stroke: '#000', strokeThickness: 4,
    }).setOrigin(0.5, 1).setDepth(60);
    this.beam = scene.add.graphics().setDepth(47).setBlendMode(Phaser.BlendModes.ADD);
  }

  get alive() {
    return this.state !== 'wreck';
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

  hitTest(x: number, y: number, r: number) {
    const b = this.bounds();
    return x >= b.x - r && x <= b.x + b.w + r && y >= b.y - r && y <= b.y + b.h + r ? 1 : 0;
  }

  shieldZone(): ShieldZone | null {
    if (!this.shieldUp || this.state !== 'piloted') return null;
    const f = this.facing;
    const x0 = this.body.x + f * (this.body.w / 2 + 6);
    const w = 46;
    return {
      x: f > 0 ? x0 : x0 - w, y: this.body.y - this.body.h - 40, w, h: this.body.h + 40,
      absorb: (dmg: number) => {
        this.shieldHp -= dmg;
        if (this.shieldHp <= 0) {
          this.shieldHp = 0;
          this.shieldBroken = SHIELD.breakCooldown;
          this.shieldUp = false;
          audio.play('explode', 0.5);
        }
      },
    };
  }

  damage(amount: number, _src: Source | null, _x: number, _y: number) {
    if (this.state === 'wreck') return;
    this.hp -= amount;
    this.rig.hitFlash();
    if (this.hp <= 0) this.wreck();
  }

  heal(amount: number) {
    if (this.state === 'wreck') return;
    this.hp = Math.min(this.maxHp, this.hp + amount);
  }

  private wreck() {
    this.hp = 0;
    const wasPiloted = this.state === 'piloted';
    this.state = 'wreck';
    this.repair = 0;
    this.shieldUp = false;
    this.scene.effects.explosion(this.body.x, this.body.y - 90, 1.6);
    audio.play('bigExplode');
    this.scene.camShake(10);
    if (wasPiloted) this.owner.eject();
  }

  /** 修理を進める。完了したら true */
  addRepair(amount: number): boolean {
    if (this.state !== 'wreck') return false;
    this.repair += amount;
    if (Math.random() < 0.3) this.scene.effects.healFx(this.body.x + Phaser.Math.Between(-30, 30), this.body.y - 60);
    if (this.repair >= 1) {
      this.state = 'empty';
      this.hp = Math.round(this.maxHp * 0.5);
      this.scene.effects.healFx(this.body.x, this.body.y - 100);
      audio.play('pickup');
      return true;
    }
    return false;
  }

  update(dt: number, inp: PlayerInput | null) {
    const b = this.body;
    this.fireCd -= dt;
    this.skillCd = Math.max(0, this.skillCd - dt);
    this.marked = Math.max(0, this.marked - dt);
    this.recoil *= Math.pow(0.0005, dt);
    this.beamTarget = null;
    let moveX = 0;
    let thrusting = false;

    if (this.state === 'piloted' && inp) {
      moveX = inp.moveX;
      // 照準
      if (inp.aimAbs !== null) {
        const a = inp.aimAbs;
        this.facing = Math.cos(a) >= 0 ? 1 : -1;
        let local = this.facing > 0 ? a : Math.PI - a;
        local = Phaser.Math.Angle.Wrap(local);
        this.aim = Phaser.Math.Clamp(local, -1.45, 1.0);
      } else {
        if (inp.moveY) this.aim = Phaser.Math.Clamp(this.aim + inp.moveY * 2.4 * dt, -1.45, 1.0);
        if (moveX && !inp.fire && !this.shieldUp) this.facing = moveX > 0 ? 1 : -1;
      }

      // 盾（アサルト）
      if (this.owner.role === 'assault') {
        if (this.shieldBroken > 0) {
          this.shieldBroken -= dt;
          if (this.shieldBroken <= 0) this.shieldHp = SHIELD.max * 0.5;
        }
        this.shieldUp = inp.skill && this.shieldBroken <= 0 && this.shieldHp > 0;
        if (!this.shieldUp) this.shieldHp = Math.min(SHIELD.max, this.shieldHp + SHIELD.regen * dt);
      }

      // 踏ん張り（ストライカー）
      if (this.owner.role === 'striker') {
        if (b.onGround && !moveX && Math.abs(b.vx) < 30) this.braceT += dt;
        else this.braceT = 0;
        this.braced = this.braceT >= BRACE.delay;
      }

      // ジャンプとブースト
      if (inp.jumpPressed) {
        if (b.onGround && inp.down && this.scene.onOneWay(b)) {
          b.dropThrough = 0.25;
        } else if (b.onGround) {
          b.vy = -this.def.jump;
          audio.play('jump', 0.6);
          this.scene.effects.dustFx(b.x, b.y, 5);
        } else if (this.airJumps > 0) {
          this.airJumps--;
          b.vy = -this.def.jump * 0.85;
          audio.play('jump', 0.6);
        }
      }
      if (inp.jump && !b.onGround && b.vy > -260 && this.fuel > 0) {
        thrusting = true;
        this.fuel -= dt;
        b.vy = Math.max(b.vy - (1980 + this.def.thrust) * dt, -this.def.thrust * 0.35);
      }

      // 射撃
      if (inp.fire && this.fireCd <= 0 && !(this.shieldUp && this.owner.role !== 'assault')) {
        this.shoot();
      }

      // 固有スキル
      this.skills(dt, inp);

      // 降機・修理・搭乗
      const wreck = this.scene.nearestWreck(b.x, b.y, 140, this);
      if (wreck && inp.interact) {
        const time = this.owner.role === 'support' ? WRECK_REPAIR_TIME.support : WRECK_REPAIR_TIME.mech;
        if (wreck.addRepair(dt / time)) {
          this.owner.stats.repairs++;
          unlock('FIELD_REPAIR');
        }
        if (Math.random() < 0.2) audio.play('repair');
      } else if (!wreck && inp.interactPressed) {
        this.state = 'empty';
        this.owner.eject();
      }
    } else {
      this.shieldUp = false;
      this.braced = false;
    }

    // 移動
    const speed = this.def.speed * (this.shieldUp ? SHIELD.moveMul : 1) * (this.braced ? 0 : 1);
    const target = this.state === 'piloted' ? moveX * speed : 0;
    const acc = this.def.accel * (b.onGround ? 1 : 0.6);
    b.vx = approach(b.vx, target, acc * dt);
    const lead = this.scene.leash(b, this.owner);
    if (lead) b.vx = 0;
    stepBody(b, dt, this.scene.solids);
    if (b.onGround) {
      this.fuel = Math.min(this.def.fuel, this.fuel + dt * 2);
      this.airJumps = this.def.airJumps;
      if (!this.wasGround) {
        this.crouch = 1;
        audio.play('land', 0.5);
        this.scene.effects.dustFx(b.x, b.y, 8);
      }
    }
    this.wasGround = b.onGround;
    this.crouch = Math.max(0, this.crouch - dt * 5);
    this.thrust = approach(this.thrust, thrusting ? 1 : 0, dt * 8);
    if (thrusting && Math.random() < 0.3) this.scene.effects.dustFx(b.x - this.facing * 20, b.y - 60, 1);

    const sp = Math.abs(b.vx);
    if (b.onGround && sp > 10) this.walkPhase += (sp * dt) / (this.rig.d.height * 0.11) * this.facing * Math.sign(b.vx || 1);
    // 撃破状態の煙
    if (this.state === 'wreck') {
      this.smokeT -= dt;
      if (this.smokeT <= 0) {
        this.smokeT = 0.15;
        this.scene.effects.smokePuff(b.x + Phaser.Math.Between(-20, 20), b.y - 70, 1);
      }
    } else if (this.hp < this.maxHp * 0.3) {
      this.smokeT -= dt;
      if (this.smokeT <= 0) {
        this.smokeT = 0.25;
        this.scene.effects.smokePuff(b.x, b.y - 130, 1);
      }
    }

    // 見た目
    this.rig.setPosition(b.x, b.y);
    this.rig.facing = this.facing;
    this.rig.scaleX = this.facing;
    this.rig.update(dt, {
      aim: this.aim,
      walkPhase: this.walkPhase,
      speed01: b.onGround ? Phaser.Math.Clamp(sp / this.def.speed, 0, 1) : 0,
      airborne: !b.onGround,
      vy: b.vy,
      crouch: this.crouch,
      recoil: this.recoil,
      lean: Phaser.Math.Clamp(b.vx / 3000, -0.08, 0.08) * this.facing,
      wreck: this.state === 'wreck',
      shieldUp: this.shieldUp,
      braced: this.braced,
      thrust: this.thrust,
    });
    this.rig.setAlpha(this.state === 'empty' ? 0.85 : 1);
    this.label.setPosition(b.x, b.y - b.h - 18);
    this.label.setVisible(this.state === 'piloted');
    this.drawBeam();
  }

  private shoot() {
    const w: WeaponDef = this.def.weapon;
    const lv = this.owner.weaponLv;
    this.fireCd = w.interval / levelRateMul(lv);
    const m = this.rig.muzzle;
    const base = this.facing > 0 ? this.aim : Math.PI - this.aim;
    const ang = base + (Math.random() - 0.5) * w.spread;
    const dmg = w.damage * levelDamageMul(lv) * (this.braced ? BRACE.damageMul : 1);
    this.scene.shots.fire({
      x: m.x, y: m.y, angle: ang, speed: w.speed, kind: w.kind, team: 'player', damage: dmg,
      splash: w.splash, pierce: w.pierce, src: { player: this.owner.index, role: this.owner.role },
    });
    this.recoil = Math.min(this.recoil + (w.recoil ?? 4), 18);
    this.scene.effects.muzzle(m.x, m.y, ang, w.kind === 'shell' ? 2.4 : w.kind === 'rifle' ? 1.6 : 1);
    if (w.kind === 'shell') {
      this.body.vx -= Math.cos(ang) * 120;
      this.scene.effects.smokePuff(m.x, m.y, 2);
    }
    if (w.shake && w.shake > 2) this.scene.camShake(w.shake);
    audio.play(SFX[w.kind], 0.8);
  }

  private skills(dt: number, inp: PlayerInput) {
    const role = this.owner.role;
    if (role === 'striker') {
      if (inp.skillPressed && this.skillCd <= 0) {
        this.skillCd = this.def.skillCooldown;
        this.missileQueue = MISSILES.count;
        this.missileT = 0;
      }
      if (this.missileQueue > 0) {
        this.missileT -= dt;
        if (this.missileT <= 0) {
          this.missileT = 0.07;
          this.missileQueue--;
          const x = this.body.x - this.facing * 20, y = this.body.y - this.body.h - 10;
          const ang = -Math.PI / 2 + this.facing * (0.5 + Math.random() * 0.5);
          this.scene.shots.fire({
            x, y, angle: ang, speed: MISSILES.speed * 0.5, kind: 'missile', team: 'player',
            damage: MISSILES.damage * levelDamageMul(this.owner.weaponLv), splash: MISSILES.splash,
            src: { player: this.owner.index, role }, life: 3,
          });
          audio.play('missile', 0.6);
          this.scene.effects.smokePuff(x, y, 1);
        }
      }
    } else if (role === 'scout') {
      if (inp.skillPressed && this.skillCd <= 0) {
        this.skillCd = this.def.skillCooldown;
        this.scene.reconPulse(this.body.x, this.body.y - 80, RECON.radius, this.owner);
      }
    } else if (role === 'support') {
      if (inp.skill && this.energy > 1) {
        const t = this.scene.repairTarget(this);
        this.energy -= REPAIR.drain * dt;
        if (t) {
          this.beamTarget = { x: t.x, y: t.y };
          t.apply(dt);
        } else {
          this.heal(REPAIR.selfRate * dt);
          this.beamTarget = { x: this.body.x, y: this.body.y - 60 };
        }
        if (Math.random() < 0.25) audio.play('repair', 0.5);
      } else {
        this.energy = Math.min(REPAIR.energy, this.energy + REPAIR.regen * dt);
      }
    }
  }

  private drawBeam() {
    const g = this.beam;
    g.clear();
    if (!this.beamTarget) return;
    const sx = this.body.x - this.facing * 25, sy = this.body.y - this.body.h - 5;
    const t = this.beamTarget;
    const wob = Math.sin(this.scene.time.now / 40) * 2;
    g.lineStyle(6, 0x48ff9a, 0.35);
    g.lineBetween(sx, sy, t.x, t.y + wob);
    g.lineStyle(2, 0xc8ffe0, 0.9);
    g.lineBetween(sx, sy, t.x, t.y + wob);
    this.scene.effects.healFx(t.x, t.y);
  }

  destroy() {
    this.rig.destroy();
    this.label.destroy();
    this.beam.destroy();
  }
}

// ------------------------------------------------------------------ パイロット

export class Pilot implements Hittable {
  team = 'player' as const;
  body: Body;
  hp = PILOT.hp;
  facing = 1;
  aim = 0;
  marked = 0;
  invuln = 0;
  private fireCd = 0;
  private g: Phaser.GameObjects.Graphics;
  private label: Phaser.GameObjects.Text;
  private run = 0;
  alive = true;

  constructor(readonly scene: GameScene, readonly owner: Player, x: number, y: number) {
    this.body = { x, y, w: PILOT.w, h: PILOT.h, vx: 0, vy: 0, onGround: false, hitWall: 0 };
    this.g = scene.add.graphics().setDepth(30);
    this.label = scene.add.text(0, 0, `${owner.index + 1}P`, {
      fontFamily: 'Rajdhani, sans-serif', fontSize: '18px', fontStyle: 'bold',
      color: '#' + owner.color.toString(16).padStart(6, '0'), stroke: '#000', strokeThickness: 4,
    }).setOrigin(0.5, 1).setDepth(60);
  }

  get cx() {
    return this.body.x;
  }
  get cy() {
    return this.body.y - 15;
  }
  bounds() {
    return { x: this.body.x - 9, y: this.body.y - 30, w: 18, h: 30 };
  }
  hitTest(x: number, y: number, r: number) {
    const b = this.bounds();
    return x >= b.x - r && x <= b.x + b.w + r && y >= b.y - r && y <= b.y + b.h + r ? 1 : 0;
  }
  damage(amount: number) {
    if (this.invuln > 0 || !this.alive) return;
    this.hp -= amount;
    this.invuln = 0.15;
    if (this.hp <= 0) {
      this.alive = false;
      this.scene.effects.explosion(this.body.x, this.body.y - 15, 0.5);
      audio.play('explode');
      this.owner.kill();
    }
  }

  update(dt: number, inp: PlayerInput) {
    const b = this.body;
    this.invuln -= dt;
    this.fireCd -= dt;
    this.marked = 0;
    b.vx = approach(b.vx, inp.moveX * PILOT.speed, 2400 * dt);
    if (inp.moveX) this.facing = inp.moveX > 0 ? 1 : -1;
    if (inp.aimAbs !== null) {
      this.facing = Math.cos(inp.aimAbs) >= 0 ? 1 : -1;
      this.aim = Phaser.Math.Clamp(Phaser.Math.Angle.Wrap(this.facing > 0 ? inp.aimAbs : Math.PI - inp.aimAbs), -1.4, 1);
    } else if (inp.moveY) {
      this.aim = Phaser.Math.Clamp(this.aim + inp.moveY * 3 * dt, -1.4, 1);
    }
    if (inp.jumpPressed && b.onGround) b.vy = -PILOT.jump;
    if (inp.fire && this.fireCd <= 0) {
      this.fireCd = PILOT.weapon.interval;
      const ang = (this.facing > 0 ? this.aim : Math.PI - this.aim) + (Math.random() - 0.5) * PILOT.weapon.spread;
      const x = b.x + this.facing * 12, y = b.y - 18;
      this.scene.shots.fire({
        x, y, angle: ang, speed: PILOT.weapon.speed, kind: 'pistol', team: 'player', damage: PILOT.weapon.damage,
        src: { player: this.owner.index },
      });
      this.scene.effects.muzzle(x, y, ang, 0.5);
      audio.play('pistol', 0.6);
    }
    // 搭乗・修理・スイッチ
    const mech = this.owner.mech;
    const nearMech = mech && Math.abs(mech.body.x - b.x) < 70 && Math.abs(mech.body.y - b.y) < 160;
    const wreck = this.scene.nearestWreck(b.x, b.y, 110, null);
    if (inp.interact && wreck) {
      if (wreck.addRepair(dt / WRECK_REPAIR_TIME.pilot)) this.owner.stats.repairs++;
      if (Math.random() < 0.15) audio.play('repair', 0.5);
    } else if (inp.interactPressed) {
      if (this.scene.tryInteract(b.x, b.y)) {
        // スイッチを押した
      } else if (nearMech && mech!.state === 'empty') {
        this.owner.board();
        return;
      }
    }
    const lead = this.scene.leash(b, this.owner);
    if (lead) b.vx = 0;
    stepBody(b, dt, this.scene.solids);
    if (b.onGround && Math.abs(b.vx) > 10) this.run += dt * 14;
    this.draw();
  }

  private draw() {
    const g = this.g, b = this.body, f = this.facing;
    g.clear();
    if (this.invuln > 0 && Math.floor(this.invuln * 20) % 2) return;
    const x = b.x, y = b.y;
    const leg = Math.sin(this.run) * 6 * (b.onGround ? 1 : 0.3);
    // 脚
    g.lineStyle(4, 0x2b2f36, 1);
    g.lineBetween(x - 2, y - 13, x - 2 + leg, y);
    g.lineBetween(x + 2, y - 13, x + 2 - leg, y);
    // 胴
    g.fillStyle(this.owner.color, 1);
    g.fillRoundedRect(x - 6, y - 26, 12, 15, 3);
    g.fillStyle(0x1d2228, 1);
    g.fillRect(x - 6, y - 16, 12, 3);
    // 頭（ヘルメット）
    g.fillStyle(0xd8d4c8, 1);
    g.fillCircle(x + f * 1, y - 30, 5.5);
    g.fillStyle(0x3fd4e8, 0.9);
    g.fillRect(f > 0 ? x + 1 : x - 6, y - 32, 5, 3);
    // 銃
    const ang = f > 0 ? this.aim : Math.PI - this.aim;
    g.lineStyle(3, 0x15181c, 1);
    g.lineBetween(x + f * 3, y - 20, x + f * 3 + Math.cos(ang) * 12, y - 20 + Math.sin(ang) * 12);
    this.label.setPosition(x, y - 40);
  }

  destroy() {
    this.alive = false;
    this.g.destroy();
    this.label.destroy();
  }
}

function idleInput(inp: PlayerInput): PlayerInput {
  return {
    ...inp, moveX: 0, moveY: 0, aimAbs: null, jump: false, fire: false, skill: false, interact: false,
    jumpPressed: false, skillPressed: false, interactPressed: false, firePressed: false,
  };
}

export function approach(v: number, target: number, step: number) {
  if (v < target) return Math.min(v + step, target);
  return Math.max(v - step, target);
}
