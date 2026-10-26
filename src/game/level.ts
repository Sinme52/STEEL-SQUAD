// ステージ1「OPERATION: IRON GATE」の地形と出現イベント。
import type { Solid } from './physics';

export const GROUND = 1000;
export const LEVEL_W = 11200;
export const GATE_X = 5600;
export const GATE_W = 90;
export const VENT_H = 46; // ゲート下のすき間（パイロットだけ通れる）
export const SWITCH_X = 5790;
export const ARENA = { left: 9000, right: 10900, trigger: 9250 };

export function buildSolids(): Solid[] {
  const s: Solid[] = [];
  const block = (x: number, y: number, w: number, h = GROUND + 600 - y, id?: string) => s.push({ x, y, w, h, id });
  const ledge = (x: number, y: number, w: number) => s.push({ x, y, w, h: 24, oneWay: true });

  block(-400, -2000, 400, 4000); // 左端
  block(LEVEL_W, -2000, 400, 4000); // 右端
  // 地面（途中に溝）
  block(0, GROUND, 2400);
  block(2400, GROUND + 120, 300);
  block(2700, GROUND, LEVEL_W - 2700);

  // 区画1
  block(900, GROUND - 110, 380);
  ledge(1520, GROUND - 230, 300);
  // 区画2: 高架
  block(3150, GROUND - 170, 520);
  ledge(3800, GROUND - 260, 260);
  block(4150, GROUND - 130, 380);
  // ゲート（動く。id で探す）
  s.push({ x: GATE_X, y: -1800, w: GATE_W, h: GROUND - VENT_H + 1800, id: 'gate' });
  // 区画3
  block(6400, GROUND - 100, 300);
  block(7000, GROUND - 190, 420);
  ledge(7500, GROUND - 300, 220);
  block(7850, GROUND - 110, 260);
  // 闘技場の壁（ボス戦開始で出現。最初は地下に隠す）
  s.push({ x: ARENA.left - 60, y: GROUND + 2000, w: 60, h: 1800, id: 'arenaL' });
  s.push({ x: ARENA.right, y: GROUND + 2000, w: 60, h: 1800, id: 'arenaR' });
  return s;
}

export type SpawnKind = 'mech' | 'tank' | 'heli' | 'turret';
export interface Spawn {
  kind: SpawnKind;
  x: number;
  y?: number; // 省略時は地面
  drop?: boolean; // 空から降下してくる
}

export interface Wave {
  at: number; // カメラ右端がこの x を超えたら
  spawns: Spawn[];
  tag?: string;
}

// 歩いて出てくる敵は画面の外（at より右）に置き、降下してくる敵は画面内でもよい
export const WAVES: Wave[] = [
  { at: 2150, spawns: [{ kind: 'mech', x: 2300 }, { kind: 'mech', x: 2050, drop: true }] },
  { at: 3000, spawns: [{ kind: 'turret', x: 3100 }, { kind: 'mech', x: 2900, drop: true }] },
  { at: 3700, spawns: [{ kind: 'heli', x: 4300, y: GROUND - 520 }, { kind: 'mech', x: 3500, y: GROUND - 170, drop: true }, { kind: 'mech', x: 3900 }] },
  { at: 4600, spawns: [{ kind: 'tank', x: 4800 }, { kind: 'mech', x: 4300, y: GROUND - 130, drop: true }] },
  { at: 5300, spawns: [{ kind: 'heli', x: 5500, y: GROUND - 560 }, { kind: 'mech', x: 5450 }] },
  // ゲートを開けたら発生する逆襲
  {
    at: Infinity, tag: 'ambush', spawns: [
      { kind: 'mech', x: 6300, drop: true }, { kind: 'mech', x: 6550, drop: true }, { kind: 'mech', x: 6800 },
      { kind: 'heli', x: 6700, y: GROUND - 560 },
    ],
  },
  { at: 7000, spawns: [{ kind: 'turret', x: 7250, y: GROUND - 190 }, { kind: 'tank', x: 7800 }, { kind: 'mech', x: 6550, y: GROUND - 100, drop: true }] },
  { at: 8000, spawns: [{ kind: 'heli', x: 8500, y: GROUND - 520 }, { kind: 'heli', x: 8800, y: GROUND - 640 }, { kind: 'mech', x: 8400 }, { kind: 'mech', x: 7950, drop: true }] },
];
