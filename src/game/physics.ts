// 足元基準の矩形と、静的な地形との当たり判定（軸ごとに解決する単純な方式）。
import { GRAVITY, MAX_FALL } from './data';

export interface Solid {
  x: number; y: number; w: number; h: number;
  oneWay?: boolean;
  id?: string;
}

export interface Body {
  x: number; // 中心
  y: number; // 足元
  w: number;
  h: number;
  vx: number;
  vy: number;
  onGround: boolean;
  hitWall: number; // -1 左の壁 / 1 右の壁 / 0
  dropThrough?: number; // 片側足場をすり抜ける残り時間
  gravityScale?: number;
}

const EPS = 0.01;

export function stepBody(b: Body, dt: number, solids: Solid[]) {
  b.vy = Math.min(b.vy + GRAVITY * (b.gravityScale ?? 1) * dt, MAX_FALL);
  if (b.dropThrough) b.dropThrough = Math.max(0, b.dropThrough - dt);

  // 横
  b.hitWall = 0;
  let nx = b.x + b.vx * dt;
  const top = b.y - b.h, bottom = b.y;
  for (const s of solids) {
    if (s.oneWay) continue;
    if (bottom <= s.y + EPS || top >= s.y + s.h - EPS) continue;
    const l = nx - b.w / 2, r = nx + b.w / 2;
    if (r <= s.x || l >= s.x + s.w) continue;
    if (b.vx > 0 && b.x + b.w / 2 <= s.x + EPS + 1) { nx = s.x - b.w / 2; b.hitWall = 1; }
    else if (b.vx < 0 && b.x - b.w / 2 >= s.x + s.w - EPS - 1) { nx = s.x + s.w + b.w / 2; b.hitWall = -1; }
    else {
      // めり込んでいる場合は近い方へ押し出す
      const pushL = r - s.x, pushR = s.x + s.w - l;
      if (pushL < pushR) nx -= pushL; else nx += pushR;
    }
  }
  if (b.hitWall) b.vx = 0;
  b.x = nx;

  // 縦
  const wasBottom = b.y;
  let ny = b.y + b.vy * dt;
  b.onGround = false;
  const l = b.x - b.w / 2 + 1, r = b.x + b.w / 2 - 1;
  for (const s of solids) {
    if (r <= s.x || l >= s.x + s.w) continue;
    if (b.vy >= 0) {
      if (wasBottom <= s.y + EPS + 2 && ny >= s.y) {
        if (s.oneWay && b.dropThrough) continue;
        ny = s.y;
        b.vy = 0;
        b.onGround = true;
      }
    } else if (!s.oneWay) {
      const wasTop = wasBottom - b.h;
      if (wasTop >= s.y + s.h - EPS - 2 && ny - b.h < s.y + s.h) {
        ny = s.y + s.h + b.h;
        b.vy = 0;
      }
    }
  }
  b.y = ny;
}

export function pointInSolids(x: number, y: number, solids: Solid[], includeOneWay = false): Solid | null {
  for (const s of solids) {
    if (s.oneWay && !includeOneWay) continue;
    if (x >= s.x && x <= s.x + s.w && y >= s.y && y <= s.y + s.h) return s;
  }
  return null;
}

/** 線分と地形の交差（視線の確認用）。簡易に一定間隔でサンプリングする */
export function lineBlocked(x0: number, y0: number, x1: number, y1: number, solids: Solid[]): boolean {
  const d = Math.hypot(x1 - x0, y1 - y0);
  const n = Math.ceil(d / 24);
  for (let i = 1; i < n; i++) {
    const t = i / n;
    if (pointInSolids(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, solids)) return true;
  }
  return false;
}

/** 足元の真下に地面があるか（崖っぷちの確認用） */
export function groundBelow(x: number, y: number, solids: Solid[], depth = 40): boolean {
  for (const s of solids) {
    if (x >= s.x && x <= s.x + s.w && s.y >= y - 2 && s.y <= y + depth) return true;
  }
  return false;
}
