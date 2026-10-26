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
  speed: number;
  accel: number;
  jump: number;
  thrust: number; // 押し続けたときの上昇加速
  fuel: number; // 秒
  airJumps: number;
  bodyW: number;
  weapon: WeaponDef;
  skillCooldown: number;
}

export const ROLE_DEFS: Record<RoleId, RoleDef> = {
  assault: {
    id: 'assault', color: 0xf08a24, hp: 460, speed: 230, accel: 1500, jump: 640, thrust: 900, fuel: 0.55,
    airJumps: 0, bodyW: 74,
    weapon: { interval: 0.075, damage: 9, speed: 1500, spread: 0.07, kind: 'mg', recoil: 6, shake: 0.6 },
    skillCooldown: 0,
  },
  striker: {
    id: 'striker', color: 0xe0483a, hp: 320, speed: 250, accel: 1500, jump: 680, thrust: 950, fuel: 0.6,
    airJumps: 0, bodyW: 64,
    weapon: { interval: 0.6, damage: 70, speed: 1300, spread: 0.01, kind: 'shell', splash: 95, recoil: 40, shake: 5 },
    skillCooldown: 7,
  },
  scout: {
    id: 'scout', color: 0x3fd4e8, hp: 240, speed: 340, accel: 2600, jump: 760, thrust: 1300, fuel: 1.6,
    airJumps: 1, bodyW: 50,
    weapon: { interval: 0.32, damage: 34, speed: 2600, spread: 0.0, kind: 'rifle', pierce: 3, recoil: 10, shake: 1.5 },
    skillCooldown: 12,
  },
  support: {
    id: 'support', color: 0xf2c94c, hp: 330, speed: 270, accel: 1800, jump: 700, thrust: 1000, fuel: 0.8,
    airJumps: 0, bodyW: 62,
    weapon: { interval: 0.1, damage: 7, speed: 1400, spread: 0.1, kind: 'smg', recoil: 3, shake: 0.3 },
    skillCooldown: 0,
  },
};

export const PILOT = {
  hp: 40, speed: 280, jump: 620, w: 18, h: 30,
  weapon: { interval: 0.25, damage: 6, speed: 1300, spread: 0.03, kind: 'pistol' } as WeaponDef,
};

// 武器の熟練度（ガンハザードの武器レベルへのオマージュ）。与えたダメージで上がる
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

export const WRECK_REPAIR_TIME = { pilot: 4, mech: 2.5, support: 1 };
export const RESPAWN_TIME = 6;

export const ENEMY_DEFS = {
  mech: { hp: 170, speed: 170, score: 100 },
  tank: { hp: 520, speed: 70, score: 250 },
  heli: { hp: 260, speed: 220, score: 200 },
  turret: { hp: 360, score: 150 },
  boss: { hp: 5200, score: 3000 },
};

export const GRAVITY = 2000;
export const MAX_FALL = 1400;
