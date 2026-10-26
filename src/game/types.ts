import type { RoleId } from './data';

export type Team = 'player' | 'enemy';

export interface Source {
  player?: number; // 撃ったプレイヤーの番号（経験値と成績用）
  role?: RoleId;
}

/** 弾が当たるもの */
export interface Hittable {
  team: Team;
  alive: boolean;
  cx: number; // 誘導・照準の目標点
  cy: number;
  marked: number; // スカウトのマーク残り時間
  /** 当たっていれば倍率（弱点なら >1）、外れなら 0 */
  hitTest(x: number, y: number, r: number): number;
  damage(amount: number, src: Source | null, x: number, y: number): void;
  /** スタンダードな当たり枠（爆風判定用） */
  bounds(): { x: number; y: number; w: number; h: number };
}
