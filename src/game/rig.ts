// 生成したパーツ画像を組み合わせて、機体を手続き的に動かす（歩行・照準・着地・撃破）。
import Phaser from 'phaser';
import rigsJson from './rigs.json';

export type RigKey = 'assault' | 'striker' | 'scout' | 'support' | 'enemy';

interface RigData {
  parts: Record<string, { w: number; h: number }>;
  store: number;
  rig: Record<string, [number, number]>;
  thigh: number;
  shin: number;
  footH: number;
  height: number;
}
export const RIGS = rigsJson as unknown as Record<RigKey, RigData>;

type P = { x: number; y: number };

export interface Pose {
  aim: number; // 局所座標の照準角（0 = 正面、負 = 上）
  walkPhase: number;
  speed01: number; // 0..1 歩きの強さ
  airborne: boolean;
  vy: number;
  crouch: number; // 0..1 着地などの沈み込み
  recoil: number; // px
  lean: number; // ラジアン
  wreck: boolean;
  shieldUp: boolean;
  braced: boolean;
  thrust: number; // 0..1
}

export class MechRig extends Phaser.GameObjects.Container {
  readonly key: RigKey;
  readonly d: RigData;
  private parts: Record<string, Phaser.GameObjects.Image> = {};
  private flame: Phaser.GameObjects.Image;
  private flash = 0;
  private baseTint = 0xffffff;
  muzzle: P = { x: 0, y: 0 }; // ワールド座標
  shoulderWorld: P = { x: 0, y: 0 };
  facing = 1;
  private shieldImg?: Phaser.GameObjects.Image;
  private stab?: Phaser.GameObjects.Graphics;

  constructor(scene: Phaser.Scene, key: RigKey) {
    super(scene, 0, 0);
    this.key = key;
    this.d = RIGS[key];
    const mk = (name: string, part: string, pivot: string | null, far = false) => {
      const img = scene.add.image(0, 0, `${key}_${part}`);
      img.setScale(1 / this.d.store);
      const pd = this.d.parts[part];
      if (pivot) {
        const pv = this.d.rig[pivot];
        img.setOrigin(pv[0] * this.d.store / pd.w, pv[1] * this.d.store / pd.h);
      }
      if (far) img.setTint(0x8a8a8a);
      this.parts[name] = img;
      this.add(img);
      return img;
    };
    if (this.d.parts.shield) {
      this.shieldImg = mk('shieldBack', 'shield', null, true);
      this.shieldImg.setOrigin(0.5, 0.5);
    }
    mk('farThigh', 'thigh', 'thigh_top', true);
    mk('farShin', 'shin', 'shin_top', true);
    mk('farFoot', 'foot', 'foot_ankle', true);
    this.flame = scene.add.image(0, 0, 'flame').setOrigin(0.5, 0).setBlendMode(Phaser.BlendModes.ADD).setVisible(false);
    this.add(this.flame);
    mk('torso', 'torso', 'torso_hip');
    mk('thigh', 'thigh', 'thigh_top');
    mk('shin', 'shin', 'shin_top');
    mk('foot', 'foot', 'foot_ankle');
    if (key === 'striker') {
      this.stab = scene.add.graphics();
      this.add(this.stab);
    }
    mk('arm', 'arm', 'arm_shoulder');
    if (this.d.parts.shield) {
      const front = mk('shield', 'shield', null);
      front.setOrigin(0.5, 0.55);
      front.setVisible(false);
    }
    scene.add.existing(this);
  }

  hitFlash() {
    this.flash = 0.05;
  }

  setBaseTint(c: number) {
    this.baseTint = c;
  }

  private vecAngle(a: string, b: string) {
    const r = this.d.rig;
    return Math.atan2(r[b][1] - r[a][1], r[b][0] - r[a][0]);
  }

  /** 二関節IK。膝は前（+x）に出す */
  private ik(hip: P, foot: P, l1: number, l2: number): P {
    const dx = foot.x - hip.x, dy = foot.y - hip.y;
    let d = Math.hypot(dx, dy);
    d = Math.min(d, l1 + l2 - 0.5);
    const a = Math.atan2(dy, dx);
    const cosK = (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d);
    const k = Math.acos(Phaser.Math.Clamp(cosK, -1, 1));
    const ang = a - k; // 膝が前へ
    return { x: hip.x + Math.cos(ang) * l1, y: hip.y + Math.sin(ang) * l1 };
  }

  private placeLeg(prefix: '' | 'far', hip: P, foot: P, footRot: number) {
    const d = this.d;
    const knee = this.ik(hip, foot, d.thigh, d.shin);
    const thigh = this.parts[prefix ? 'farThigh' : 'thigh'];
    const shin = this.parts[prefix ? 'farShin' : 'shin'];
    const ft = this.parts[prefix ? 'farFoot' : 'foot'];
    thigh.setPosition(hip.x, hip.y);
    thigh.setRotation(Math.atan2(knee.y - hip.y, knee.x - hip.x) - this.vecAngle('thigh_top', 'thigh_bot'));
    shin.setPosition(knee.x, knee.y);
    const ank = { x: foot.x, y: foot.y - 0 };
    shin.setRotation(Math.atan2(ank.y - knee.y, ank.x - knee.x) - this.vecAngle('shin_top', 'shin_bot'));
    // 実際の足首位置はすねの長さで決まる
    const sa = Math.atan2(ank.y - knee.y, ank.x - knee.x);
    ft.setPosition(knee.x + Math.cos(sa) * d.shin, knee.y + Math.sin(sa) * d.shin);
    ft.setRotation(footRot);
  }

  update(dt: number, p: Pose) {
    const d = this.d;
    const legLen = d.thigh + d.shin;
    const stride = d.height * 0.22;
    // 腰の高さ（足首から）
    let hipH = legLen * (p.wreck ? 0.45 : 0.93 - p.crouch * 0.18 - (p.braced ? 0.08 : 0));
    const bob = p.airborne ? 0 : Math.abs(Math.sin(p.walkPhase)) * 4 * p.speed01;
    hipH -= bob;
    const ground = -d.footH;
    const hip = { x: 0, y: ground - hipH };

    let nearFoot: P, farFoot: P, nearRot = 0, farRot = 0;
    if (p.wreck) {
      nearFoot = { x: 34, y: ground };
      farFoot = { x: -20, y: ground };
    } else if (p.airborne) {
      const tuck = Phaser.Math.Clamp(-p.vy / 900, -0.4, 1);
      nearFoot = { x: 16, y: ground - 18 - tuck * 18 };
      farFoot = { x: -14, y: ground - 8 - tuck * 10 };
      nearRot = 0.15;
      farRot = -0.1;
    } else {
      const s = p.speed01;
      const ph = p.walkPhase;
      const leg = (phase: number) => {
        const x = Math.cos(phase) * stride * 0.5 * s;
        const lift = Math.max(0, Math.sin(phase)) * 22 * s;
        return { x, y: ground - lift };
      };
      nearFoot = leg(ph);
      farFoot = leg(ph + Math.PI);
      nearFoot.x += 10 * (1 - s) + (p.braced ? 18 : 0);
      farFoot.x -= 12 * (1 - s) + (p.braced ? 14 : 0);
      nearRot = Math.max(0, Math.sin(ph)) * -0.25 * s;
      farRot = Math.max(0, Math.sin(ph + Math.PI)) * -0.25 * s;
    }
    this.placeLeg('far', { x: hip.x - 4, y: hip.y }, farFoot, farRot);
    this.placeLeg('', hip, nearFoot, nearRot);

    const torso = this.parts.torso;
    const lean = p.wreck ? 0.35 : p.lean + p.aim * 0.08;
    torso.setPosition(hip.x, hip.y);
    torso.setRotation(lean);

    // 肩の位置は胴体の回転に追従
    const r = d.rig;
    const sx = r.torso_shoulder[0] - r.torso_hip[0], sy = r.torso_shoulder[1] - r.torso_hip[1];
    const cs = Math.cos(lean), sn = Math.sin(lean);
    const sh = { x: hip.x + sx * cs - sy * sn, y: hip.y + sx * sn + sy * cs };
    const aim = p.wreck ? 0.9 : p.aim;
    const arm = this.parts.arm;
    arm.setPosition(sh.x - Math.cos(aim) * p.recoil, sh.y - Math.sin(aim) * p.recoil);
    arm.setRotation(aim);

    // 銃口（ワールド座標）
    const mx = r.arm_muzzle[0] - r.arm_shoulder[0], my = r.arm_muzzle[1] - r.arm_shoulder[1];
    const ca = Math.cos(aim), sa = Math.sin(aim);
    const lmx = arm.x + mx * ca - my * sa, lmy = arm.y + mx * sa + my * ca;
    this.muzzle = { x: this.x + lmx * this.facing, y: this.y + lmy };
    this.shoulderWorld = { x: this.x + sh.x * this.facing, y: this.y + sh.y };

    // 盾
    if (this.shieldImg) {
      const front = this.parts.shield;
      front.setVisible(p.shieldUp && !p.wreck);
      this.shieldImg.setVisible(!p.shieldUp || p.wreck);
      this.shieldImg.setPosition(hip.x - 18, hip.y - d.height * 0.3);
      this.shieldImg.setRotation(-0.12 + lean);
      front.setPosition(hip.x + d.height * 0.3, hip.y - d.height * 0.18);
      front.setRotation(0.04);
    }

    // 脚の支柱（ストライカーが踏ん張ったとき）
    if (this.stab) {
      this.stab.clear();
      if (p.braced && !p.wreck) {
        this.stab.lineStyle(6, 0x3a332a, 1);
        this.stab.lineBetween(hip.x - 6, hip.y + 20, hip.x - 46, ground + 4);
        this.stab.lineStyle(3, 0x8f7f63, 1);
        this.stab.lineBetween(hip.x - 6, hip.y + 20, hip.x - 46, ground + 4);
      }
    }

    // 推進炎（背中側）
    const tw = d.parts.torso.w / d.store, th = d.parts.torso.h / d.store;
    const tx = -(r.torso_hip[0]) + tw * 0.12, ty = -(r.torso_hip[1]) + th * 0.62;
    this.flame.setVisible(p.thrust > 0.05 && !p.wreck);
    if (this.flame.visible) {
      this.flame.setPosition(hip.x + tx * cs - ty * sn, hip.y + tx * sn + ty * cs);
      this.flame.setRotation(lean + 0.35);
      this.flame.setScale(0.5 + Math.random() * 0.25, (0.6 + Math.random() * 0.5) * p.thrust);
    }

    // 被弾の白フラッシュ
    if (this.flash > 0) {
      this.flash -= dt;
      for (const img of Object.values(this.parts)) img.setTintFill(0xffffff);
    } else {
      for (const [name, img] of Object.entries(this.parts)) {
        const far = name.startsWith('far') || name === 'shieldBack';
        const tint = p.wreck ? 0x3a3a3a : far ? mul(this.baseTint, 0x8a8a8a) : this.baseTint;
        img.setTint(tint);
      }
    }
  }
}

function mul(a: number, b: number) {
  const r = ((a >> 16) & 255) * ((b >> 16) & 255) / 255;
  const g = ((a >> 8) & 255) * ((b >> 8) & 255) / 255;
  const bl = (a & 255) * (b & 255) / 255;
  return (r << 16) | (g << 8) | bl;
}
