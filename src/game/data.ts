// 役割・武器・敵のパラメータ。調整はここでまとめて行う。

export type RoleId = 'assault' | 'striker' | 'scout' | 'support';
export const ROLES: RoleId[] = ['assault', 'striker', 'scout', 'support'];

export type ShotKind = 'mg' | 'shell' | 'rifle' | 'smg' | 'pistol' | 'enemy' | 'enemyShell' | 'missile' | 'bossShell';

export interface WeaponDef {
  interval: number; // 秒
  damage: number;
  speed: number;
  spread: number; // ラジアン
  kind: ShotKind;
  splash?: number;
  pierce?: number;
  recoil?: number;
  shake?: number;
}

export interface RoleDef {
  id: RoleId;
  color: number;
  hp: number;
  speed: number; // 歩行の最高速度
  accel: number; // 歩き出しの加速（小さいほど重い）
  brake: number; // 止まるときの減速（小さいほど滑る）
  turnTime: number; // 振り向きにかかる秒数
  jump: number;
  windup: number; // ジャンプ前に沈み込む秒数
  thrust: number; // 押し続けたときの上昇加速
  boostSpeed: number; // ブースト移動の速度
  boostGauge: number; // ブーストゲージ（秒。ホバーとダッシュで共用）
  stepShake: number; // 足音の画面の揺れ
  airJumps: number;
  bodyW: number;
  weapon: WeaponDef;
  skillCooldown: number;
}

export const ROLE_DEFS: Record<RoleId, RoleDef> = {
  assault: {
    id: 'assault', color: 0xf08a24, hp: 460, speed: 135, accel: 380, brake: 620, turnTime: 0.32, jump: 560, windup: 0.16, thrust: 900,
    boostSpeed: 560, boostGauge: 1.4, stepShake: 1.4,
    airJumps: 0, bodyW: 74,
    weapon: { interval: 0.075, damage: 9, speed: 1500, spread: 0.07, kind: 'mg', recoil: 6, shake: 0.6 },
    skillCooldown: 0,
  },
  striker: {
    id: 'striker', color: 0xe0483a, hp: 320, speed: 150, accel: 430, brake: 700, turnTime: 0.28, jump: 600, windup: 0.14, thrust: 950,
    boostSpeed: 580, boostGauge: 1.5, stepShake: 1.1,
    airJumps: 0, bodyW: 64,
    weapon: { interval: 0.6, damage: 70, speed: 1300, spread: 0.01, kind: 'shell', splash: 95, recoil: 40, shake: 5 },
    skillCooldown: 7,
  },
  scout: {
    id: 'scout', color: 0x3fd4e8, hp: 240, speed: 200, accel: 760, brake: 1000, turnTime: 0.16, jump: 700, windup: 0.08, thrust: 1300,
    boostSpeed: 760, boostGauge: 2.6, stepShake: 0.5,
    airJumps: 1, bodyW: 50,
    weapon: { interval: 0.32, damage: 34, speed: 2600, spread: 0.0, kind: 'rifle', pierce: 3, recoil: 10, shake: 1.5 },
    skillCooldown: 12,
  },
  support: {
    id: 'support', color: 0xf2c94c, hp: 330, speed: 160, accel: 480, brake: 760, turnTime: 0.24, jump: 620, windup: 0.12, thrust: 1000,
    boostSpeed: 600, boostGauge: 1.7, stepShake: 0.9,
    airJumps: 0, bodyW: 62,
    weapon: { interval: 0.1, damage: 7, speed: 1400, spread: 0.1, kind: 'smg', recoil: 3, shake: 0.3 },
    skillCooldown: 0,
  },
};

export const PILOT = {
  hp: 40, speed: 280, jump: 620, w: 18, h: 30,
  weapon: { interval: 0.25, damage: 6, speed: 1300, spread: 0.03, kind: 'pistol' } as WeaponDef,
};

// 武器の熟練度（使い込むほど育つ、昔ながらの武器レベル）。与えたダメージで上がる
export const WEAPON_XP = [0, 600, 1800, 4000, 8000];
export const MAX_WEAPON_LV = WEAPON_XP.length;
export function weaponLevel(xp: number): number {
  let lv = 1;
  for (let i = 0; i < WEAPON_XP.length; i++) if (xp >= WEAPON_XP[i]) lv = i + 1;
  return lv;
}
export function weaponLevelProgress(xp: number): number {
  const lv = weaponLevel(xp);
  if (lv >= MAX_WEAPON_LV) return 1;
  const a = WEAPON_XP[lv - 1], b = WEAPON_XP[lv];
  return (xp - a) / (b - a);
}
export const levelDamageMul = (lv: number) => 1 + 0.12 * (lv - 1);
export const levelRateMul = (lv: number) => 1 + 0.06 * (lv - 1);

// 役割ごとの固有能力
export const SHIELD = { max: 340, regen: 45, breakCooldown: 3.5, moveMul: 0.45 };
export const MISSILES = { count: 6, damage: 38, splash: 70, speed: 700, turn: 6.5 };
export const RECON = { radius: 1600, duration: 10, damageMul: 1.4 };
export const REPAIR = { range: 360, rate: 70, wreckMul: 3, selfRate: 22, energy: 100, drain: 22, regen: 14 };
export const BRACE = { delay: 0.35, damageMul: 1.35 };

// ブースト: ゲージが空になるとオーバーヒートし、半分まで回復するまで使えない
export const BOOST = {
  accel: 3200, // 噴射の立ち上がり
  skid: 900, // 噴射をやめたあと滑りながら止まる減速
  airDrain: 1.3, // 空中ダッシュの消費（地上は 1.0/秒）
  regen: 0.75, // 回復（秒/秒）
  regenDelay: 0.45, // 噴射をやめてから回復し始めるまで
  overheatResume: 0.5, // オーバーヒートからの復帰ライン（割合）
  landRecover: 0.22, // 高所からの着地で動けない時間
  heavyFall: 750, // これより速い落下は重い着地
};
export const MECH_GRAVITY = 1.15; // 機体は重めに落ちる

export const WRECK_REPAIR_TIME = { pilot: 4, mech: 2.5, support: 1 };
export const RESPAWN_TIME = 6;

export const ENEMY_DEFS = {
  mech: { hp: 170, speed: 120, score: 100 },
  tank: { hp: 520, speed: 70, score: 250 },
  heli: { hp: 260, speed: 220, score: 200 },
  turret: { hp: 360, score: 150 },
  boss: { hp: 5200, score: 3000 },
};

export const GRAVITY = 2000;
export const MAX_FALL = 1400;
