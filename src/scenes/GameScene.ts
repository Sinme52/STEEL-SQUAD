import Phaser from 'phaser';
import { RECON, REPAIR, WRECK_REPAIR_TIME, type RoleId } from '../game/data';
import { Effects, shake } from '../game/effects';
import { Boss, Enemy, EnemyMech, Heli, Tank, Turret } from '../game/enemies';
import { input, type DeviceId, type PlayerInput } from '../game/input';
import { ARENA, GATE_X, GATE_W, GROUND, LEVEL_W, SWITCH_X, VENT_H, WAVES, buildSolids, type Spawn } from '../game/level';
import { pointInSolids, type Body, type Solid } from '../game/physics';
import { Player, PlayerMech, type Pilot } from '../game/player';
import { Shots, type ShieldZone } from '../game/shots';
import type { Hittable, Source, Team } from '../game/types';
import { audio } from '../game/audio';
import { persist, save } from '../game/save';
import { t } from '../game/i18n';
import { unlock } from '../game/steam';
import type { BgScene } from './BgScene';

export interface SquadMember {
  device: DeviceId;
  role: RoleId;
}

type Objective = 'advance' | 'gate' | 'hold' | 'boss' | 'clear' | 'failed';

const ZOOM_MIN = 0.6;
const ZOOM_MAX = 1.05;
const DT = 1 / 60;

interface Wave2 {
  x: number;
  dir: number;
  life: number;
  dmg: number;
  hit: Set<unknown>;
}

function held(i: PlayerInput): PlayerInput {
  return {
    ...i, jumpPressed: false, skillPressed: false, interactPressed: false, pausePressed: false, backPressed: false,
    leftPressed: false, rightPressed: false, upPressed: false, downPressed: false, firePressed: false,
  };
}

export class GameScene extends Phaser.Scene {
  solids: Solid[] = [];
  shots!: Shots;
  effects!: Effects;
  players: Player[] = [];
  enemies: Enemy[] = [];
  reinforcements = 0;
  enemyHpMul = 1;
  bossHpMul = 1;
  arenaBounds = { left: ARENA.left, right: ARENA.right };
  objective: Objective = 'advance';
  missionTime = 0;
  boss: Boss | null = null;
  squad: SquadMember[] = [];
  private acc = 0;
  private wavesDone = new Set<number>();
  private ambushIds = new Set<Enemy>();
  private gateOpen = false;
  private gateSolid!: Solid;
  private gateVis!: Phaser.GameObjects.Container;
  private switchLight!: Phaser.GameObjects.Arc;
  private arenaLocked = false;
  private arenaVis: Phaser.GameObjects.TileSprite[] = [];
  private camCenter = { x: 900, y: GROUND - 300 };
  private camZoom = 0.85;
  private waves2: Wave2[] = [];
  private waveGfx!: Phaser.GameObjects.Graphics;
  private endT = -1;
  private gateHintShown = false;
  frame = 0;

  constructor() {
    super('Game');
  }

  init(data: { squad: SquadMember[] }) {
    this.squad = data.squad;
    this.players = [];
    this.enemies = [];
    this.wavesDone.clear();
    this.ambushIds.clear();
    this.gateOpen = false;
    this.arenaLocked = false;
    this.arenaVis = [];
    this.objective = 'advance';
    this.missionTime = 0;
    this.boss = null;
    this.waves2 = [];
    this.endT = -1;
    this.acc = 0;
    this.gateHintShown = false;
    const n = this.squad.length;
    this.enemyHpMul = 0.75 + 0.25 * n;
    this.bossHpMul = 0.55 + 0.45 * n;
    this.reinforcements = 2 + n;
  }

  create() {
    this.scene.launch('Bg');
    this.scene.sendToBack('Bg');
    this.solids = buildSolids();
    this.effects = new Effects(this);
    this.shots = new Shots({
      scene: this,
      solids: this.solids,
      effects: this.effects,
      targets: (team: Team) => this.targets(team),
      shields: () => this.shieldZones(),
      credit: (src, amount) => this.credit(src, amount),
      camShake: (a) => this.camShake(a),
    });
    this.buildTerrain();
    this.waveGfx = this.add.graphics().setDepth(38);

    this.squad.forEach((m, i) => {
      const p = new Player(this, i, m.device, m.role);
      p.spawnMech(260 + i * 110, GROUND - 700 - i * 60);
      this.players.push(p);
    });
    const cam = this.cameras.main;
    cam.setBackgroundColor('rgba(0,0,0,0)');
    cam.setZoom(this.camZoom);
    cam.centerOn(this.camCenter.x, this.camCenter.y);

    this.scene.launch('Hud');
    this.scene.bringToTop('Hud');
    audio.playSong('battle');
    this.time.delayedCall(200, () => this.hud()?.banner(t().mission1, t().mission1Sub));
    this.events.once('shutdown', () => {
      this.shots.clear();
      this.scene.stop('Hud');
      this.scene.stop('Bg');
    });
  }

  private hud() {
    return this.scene.get('Hud') as unknown as { banner(a: string, b?: string): void; flashObjective(): void } | null;
  }

  // ---------------------------------------------------------------- 地形の見た目

  private buildTerrain() {
    // 地面付近のもや
    if (!this.textures.exists('fog')) {
      const tex = this.textures.createCanvas('fog', 4, 256)!;
      const c = tex.getContext();
      const g = c.createLinearGradient(0, 0, 0, 256);
      g.addColorStop(0, 'rgba(255,170,110,0)');
      g.addColorStop(0.7, 'rgba(255,150,90,0.35)');
      g.addColorStop(1, 'rgba(120,70,60,0.0)');
      c.fillStyle = g;
      c.fillRect(0, 0, 4, 256);
      tex.refresh();
    }
    for (const s of this.solids) {
      if (s.id === 'gate' || s.id?.startsWith('arena')) continue;
      if (s.oneWay) {
        const g = this.add.graphics().setDepth(6);
        g.fillStyle(0x2a2622, 1);
        g.fillRect(s.x, s.y, s.w, s.h);
        g.fillStyle(0x6a5a48, 1);
        g.fillRect(s.x, s.y, s.w, 5);
        g.lineStyle(3, 0x1a1714, 1);
        for (let x = s.x + 10; x < s.x + s.w - 10; x += 34) {
          g.lineBetween(x, s.y + 6, x + 17, s.y + s.h);
          g.lineBetween(x + 17, s.y + s.h, x + 34, s.y + 6);
        }
        // 支柱
        g.fillStyle(0x1e1b18, 1);
        g.fillRect(s.x + 12, s.y + s.h, 10, GROUND - s.y - s.h);
        g.fillRect(s.x + s.w - 22, s.y + s.h, 10, GROUND - s.y - s.h);
        continue;
      }
      const ts = this.add.tileSprite(s.x + s.w / 2, s.y + s.h / 2, s.w, s.h, 'ground').setDepth(5);
      ts.setTileScale(0.45);
      ts.tilePositionX = s.x / 0.45;
      ts.tilePositionY = s.y / 0.45;
      ts.setTint(0xb8aca0, 0xb8aca0, 0x40383a, 0x40383a);
      const g = this.add.graphics().setDepth(6);
      g.fillStyle(0x8c7c68, 1);
      g.fillRect(s.x, s.y, s.w, 4);
      g.fillStyle(0x000000, 0.35);
      g.fillRect(s.x, s.y + 4, s.w, 10);
    }
    this.add.tileSprite(LEVEL_W / 2, GROUND - 90, LEVEL_W + 2000, 260, 'fog').setDepth(36).setAlpha(0.55);

    // ゲート
    this.gateSolid = this.solids.find((s) => s.id === 'gate')!;
    const gs = this.gateSolid;
    const door = this.add.tileSprite(0, 0, GATE_W, gs.h, 'ground').setOrigin(0, 0).setTileScale(0.35).setTint(0x6a6058);
    const stripes = this.add.graphics();
    for (let i = 0; i < 6; i++) {
      stripes.fillStyle(i % 2 ? 0x222222 : 0xd8a020, 1);
      stripes.fillRect(i * (GATE_W / 6), gs.h - 30, GATE_W / 6, 26);
    }
    stripes.fillStyle(0x111111, 1);
    stripes.fillRect(0, gs.h - 4, GATE_W, 4);
    this.gateVis = this.add.container(gs.x, gs.y, [door, stripes]).setDepth(7);
    // 門柱（上から吊る）
    const frame = this.add.graphics().setDepth(8);
    frame.fillStyle(0x1b1916, 1);
    frame.fillRect(GATE_X - 30, -1800, 30, GROUND + 1800 - 260);
    frame.fillRect(GATE_X + GATE_W, -1800, 30, GROUND + 1800 - 260);
    frame.fillStyle(0x0c0b0a, 1);
    frame.fillRect(GATE_X - 4, GROUND - VENT_H, GATE_W + 8, VENT_H); // 通気口の奥の暗がり
    // 通気口の格子（パイロットは通れる見た目）
    frame.lineStyle(2, 0x3a3530, 1);
    for (let x = GATE_X - 30; x < GATE_X - 4; x += 6) frame.lineBetween(x, GROUND - VENT_H + 4, x, GROUND - 4);
    // スイッチ
    const sw = this.add.graphics().setDepth(8);
    sw.fillStyle(0x2a2724, 1);
    sw.fillRect(SWITCH_X - 18, GROUND - 70, 36, 70);
    sw.fillStyle(0x4a4540, 1);
    sw.fillRect(SWITCH_X - 14, GROUND - 64, 28, 30);
    this.switchLight = this.add.circle(SWITCH_X, GROUND - 49, 8, 0xff3030).setDepth(9);
    this.tweens.add({ targets: this.switchLight, alpha: 0.3, yoyo: true, repeat: -1, duration: 400 });

    // 闘技場のシャッター
    for (const id of ['arenaL', 'arenaR']) {
      const s = this.solids.find((x) => x.id === id)!;
      const v = this.add.tileSprite(s.x + s.w / 2, s.y + s.h / 2, s.w, s.h, 'ground').setTileScale(0.35).setTint(0x8a5a40).setDepth(7);
      this.arenaVis.push(v);
    }
  }

  // ---------------------------------------------------------------- ループ

  update(_time: number, delta: number) {
    this.frame++;
    input.poll(this.game.loop.frame);
    for (const p of this.players) {
      if (input.get(p.device).pausePressed) {
        this.scene.pause();
        this.scene.get('Hud').events.emit('pause');
        return;
      }
    }
    // Phaser の delta は平滑化で上限がかかるため、実時間（rawDelta）で進める
    void delta;
    this.acc += Math.min(this.game.loop.rawDelta / 1000, 0.1);
    let steps = 0;
    while (this.acc >= DT && steps < 6) {
      this.step(DT, steps === 0);
      this.acc -= DT;
      steps++;
    }
    if (steps === 6) this.acc = 0; // 処理落ちが続くときは追いつこうとしない
    this.updateCamera(delta / 1000);
  }

  private step(dt: number, first: boolean) {
    if (this.objective !== 'clear' && this.objective !== 'failed') this.missionTime += dt;
    // 1フレームに複数回進めるとき、「押した瞬間」は最初の1回だけ有効にする
    for (const p of this.players) p.update(dt, first ? input.get(p.device) : held(input.get(p.device)));
    for (const e of [...this.enemies]) e.tick(dt);
    this.shots.update(dt);
    this.updateShockwaves(dt);
    this.updateScript();
    if (this.endT > 0) {
      this.endT -= dt;
      if (this.endT <= 0) this.finish();
    }
  }

  // ---------------------------------------------------------------- カメラ（全員で1画面）

  private updateCamera(dt: number) {
    const cam = this.cameras.main;
    const pts = this.players.map((p) => p.focus()).filter((p): p is { x: number; y: number } => !!p);
    const W = this.scale.width, H = this.scale.height;
    if (pts.length) {
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const p of pts) {
        minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
        minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
      }
      // 進行方向（右）を少し多めに映す
      const cx = (minX + maxX) / 2 + 160;
      const cy = (minY + maxY) / 2;
      let zoom = Math.min(W / (maxX - minX + 1000), H / (maxY - minY + 650));
      if (this.objective === 'boss') zoom = Math.min(zoom, 0.7);
      zoom = Phaser.Math.Clamp(zoom, ZOOM_MIN, ZOOM_MAX);
      this.camZoom = Phaser.Math.Linear(this.camZoom, zoom, Math.min(1, dt * 2.5));
      this.camCenter.x = Phaser.Math.Linear(this.camCenter.x, cx, Math.min(1, dt * 5));
      this.camCenter.y = Phaser.Math.Linear(this.camCenter.y, cy, Math.min(1, dt * 4));
    }
    const vw = W / this.camZoom, vh = H / this.camZoom;
    // 地面が画面の下 18% あたりに来るように縦位置を制限
    const maxCy = GROUND - (0.5 - 0.2) * vh;
    const cy = Math.min(this.camCenter.y, maxCy);
    let left = 0, right = LEVEL_W;
    if (this.arenaLocked) {
      left = this.arenaBounds.left - 80;
      right = this.arenaBounds.right + 80;
    }
    let cx = this.camCenter.x;
    if (right - left < vw) cx = (left + right) / 2;
    else cx = Phaser.Math.Clamp(cx, left + vw / 2, right - vw / 2);
    cam.setZoom(this.camZoom);
    cam.centerOn(cx, cy);
    const bg = this.scene.get('Bg') as BgScene;
    bg.follow?.(cam.worldView.x, cam.worldView.y, this.camZoom);
  }

  /** 画面外へ出ようとしているなら true（共有画面の端で止める） */
  leash(b: Body, owner: Player): boolean {
    const alive = this.players.filter((p) => p !== owner && p.focus());
    if (!alive.length) return false;
    const half = this.scale.width / ZOOM_MIN / 2 - 90;
    const others = alive.map((p) => p.focus()!.x);
    const lo = Math.max(...others) - half * 2 + 100;
    const hi = Math.min(...others) + half * 2 - 100;
    const nx = b.x + b.vx * DT;
    return (b.vx > 0 && nx > hi) || (b.vx < 0 && nx < lo);
  }

  camShake(amount: number) {
    shake(this.cameras.main, amount);
  }

  // ---------------------------------------------------------------- 進行

  private updateScript() {
    const view = this.cameras.main.worldView;
    WAVES.forEach((w, i) => {
      if (this.wavesDone.has(i) || w.at === Infinity) return;
      if (view.right >= w.at) {
        this.wavesDone.add(i);
        for (const s of w.spawns) this.spawnEnemy(s);
      }
    });
    const front = Math.max(...this.players.map((p) => p.activeBody()?.x ?? -Infinity));
    if (!this.gateOpen && this.objective === 'advance' && front > GATE_X - 700) {
      this.objective = 'gate';
      if (!this.gateHintShown) {
        this.gateHintShown = true;
        this.hud()?.flashObjective();
      }
    }
    if (this.objective === 'hold' && this.ambushIds.size) {
      const left = [...this.ambushIds].filter((e) => e.alive).length;
      if (left === 0) {
        this.objective = 'advance';
        this.hud()?.flashObjective();
      }
    }
    if (!this.arenaLocked && this.gateOpen && front > ARENA.trigger) this.lockArena();
    // 全滅判定
    if (this.endT < 0 && this.objective !== 'clear' && this.players.every((p) => p.state === 'kia' && p.respawn <= 0)) {
      this.objective = 'failed';
      this.endT = 2.5;
      this.hud()?.banner(t().missionFailed);
    }
  }

  spawnEnemy(s: Spawn) {
    let e: Enemy;
    const y = s.y ?? GROUND;
    switch (s.kind) {
      case 'mech': e = new EnemyMech(this, s.x, y, s.drop); break;
      case 'tank': e = new Tank(this, s.x, y); break;
      case 'heli': e = new Heli(this, s.x, y); break;
      case 'turret': e = new Turret(this, s.x, y); break;
    }
    this.enemies.push(e);
    return e;
  }

  removeEnemy(e: Enemy) {
    const i = this.enemies.indexOf(e);
    if (i >= 0) this.enemies.splice(i, 1);
  }

  onEnemyKilled(e: Enemy, src: Source | null) {
    if (src?.player !== undefined) this.players[src.player].stats.kills++;
    if (!e.isBoss) this.popScore(e.cx, e.cy - 40, e.score);
  }

  tryInteract(x: number, y: number): boolean {
    if (!this.gateOpen && Math.abs(x - SWITCH_X) < 90 && Math.abs(y - GROUND) < 80) {
      this.openGate();
      return true;
    }
    return false;
  }

  private openGate() {
    this.gateOpen = true;
    this.switchLight.setFillStyle(0x40ff70);
    this.tweens.killTweensOf(this.switchLight);
    this.switchLight.setAlpha(1);
    audio.play('gate');
    this.camShake(6);
    this.tweens.add({
      targets: this.gateSolid, y: this.gateSolid.y - 1500, duration: 2600, ease: 'Sine.easeInOut',
      onUpdate: () => this.gateVis.setY(this.gateSolid.y),
    });
    this.hud()?.banner(t().gateOpen);
    unlock('GATE_OPENED');
    this.objective = 'hold';
    const amb = WAVES.find((w) => w.tag === 'ambush')!;
    // パイロットが機体へ戻る時間を残してから増援が来る
    this.time.delayedCall(3500, () => {
      for (const s of amb.spawns) this.ambushIds.add(this.spawnEnemy(s));
      audio.play('alarm', 0.5);
    });
    this.hud()?.flashObjective();
  }

  private lockArena() {
    this.arenaLocked = true;
    this.objective = 'boss';
    // 闘技場の外に取り残された機体を中へ寄せる
    for (const p of this.players) {
      for (const b of [p.mech?.body, p.pilot?.body]) {
        if (b && b.x < ARENA.left + 60) {
          b.x = ARENA.left + 120 + p.index * 60;
          b.y = GROUND - 400;
        }
      }
    }
    const l = this.solids.find((s) => s.id === 'arenaL')!;
    this.tweens.add({ targets: l, y: GROUND - 1800, duration: 900, ease: 'Cubic.easeOut', onUpdate: () => this.syncArena() });
    audio.play('gate');
    audio.playSong('boss');
    this.hud()?.banner(t().warning, t().bossName);
    audio.play('alarm', 0.7);
    this.time.delayedCall(1800, () => {
      this.boss = new Boss(this, ARENA.right + 420);
      this.enemies.push(this.boss);
    });
  }

  onBossReady() {
    const r = this.solids.find((s) => s.id === 'arenaR')!;
    this.tweens.add({ targets: r, y: GROUND - 1800, duration: 900, ease: 'Cubic.easeOut', onUpdate: () => this.syncArena() });
    this.hud()?.flashObjective();
  }

  private syncArena() {
    ['arenaL', 'arenaR'].forEach((id, i) => {
      const s = this.solids.find((x) => x.id === id)!;
      this.arenaVis[i].setY(s.y + s.h / 2);
    });
  }

  onBossDefeated() {
    this.objective = 'clear';
    this.boss = null;
    audio.playSong('clear');
    this.hud()?.banner(t().missionClear);
    // 残った敵も片付ける
    for (const e of [...this.enemies]) e.damage(99999, null);
    this.endT = 4;
  }

  private finish() {
    persist();
    const clear = this.objective === 'clear';
    if (clear) {
      unlock('FIRST_CLEAR');
      if (this.players.length >= 4) unlock('FULL_SQUAD');
      if (this.players.every((p) => p.stats.deaths === 0)) unlock('NO_CASUALTIES');
      save.clears++;
      if (save.bestTime === null || this.missionTime < save.bestTime) save.bestTime = this.missionTime;
      persist();
    }
    const result = {
      clear,
      time: this.missionTime,
      squad: this.squad,
      players: this.players.map((p) => ({
        index: p.index, role: p.role, stats: p.stats, xpStart: p.xpStart, xpEnd: save.weaponXp[p.role],
      })),
    };
    for (const p of this.players) p.destroy();
    this.scene.stop('Hud');
    this.scene.stop('Bg');
    this.scene.start('Results', result);
  }

  // ---------------------------------------------------------------- 戦闘の補助

  targets(team: Team): Hittable[] {
    if (team === 'enemy') return this.enemies;
    const out: Hittable[] = [];
    for (const p of this.players) {
      if (p.mech && p.mech.alive) out.push(p.mech);
      if (p.pilot && p.pilot.alive) out.push(p.pilot);
    }
    return out;
  }

  private shieldZones(): ShieldZone[] {
    const out: ShieldZone[] = [];
    for (const p of this.players) {
      const z = p.mech?.shieldZone();
      if (z) out.push(z);
    }
    return out;
  }

  credit(src: Source | null, amount: number) {
    if (src?.player === undefined) return;
    const p = this.players[src.player];
    p.stats.damage += amount;
    if (src.role) save.weaponXp[src.role] += amount;
  }

  pickTarget(x: number, y: number): Hittable | null {
    let best: Hittable | null = null, bd = 1900;
    for (const p of this.players) {
      const m = p.mech;
      if (m && m.alive) {
        let d = Math.hypot(m.cx - x, m.cy - y);
        if (m.shieldUp) d -= 450; // 盾を構えたアサルトに攻撃が集まる
        if (m.state === 'empty') d += 250;
        if (d < bd) { bd = d; best = m; }
      }
      const pl = p.pilot;
      if (pl && pl.alive) {
        const d = Math.hypot(pl.cx - x, pl.cy - y) + 150;
        if (d < bd) { bd = d; best = pl; }
      }
    }
    return best;
  }

  nearestWreck(x: number, y: number, range: number, exclude: PlayerMech | null): PlayerMech | null {
    let best: PlayerMech | null = null, bd = range;
    for (const p of this.players) {
      const m = p.mech;
      if (!m || m === exclude || m.state !== 'wreck') continue;
      const d = Math.hypot(m.body.x - x, (m.body.y - y) * 0.5);
      if (d < bd) { bd = d; best = m; }
    }
    return best;
  }

  repairTarget(sup: PlayerMech): { x: number; y: number; apply(dt: number): void } | null {
    const bx = sup.body.x, by = sup.body.y;
    let best: { x: number; y: number; apply(dt: number): void } | null = null;
    let bestScore = Infinity;
    for (const p of this.players) {
      const m = p.mech;
      if (m && m !== sup && Math.hypot(m.body.x - bx, m.body.y - by) < REPAIR.range) {
        if (m.state === 'wreck') {
          const score = -1;
          if (score < bestScore) {
            bestScore = score;
            best = {
              x: m.body.x, y: m.body.y - 70,
              apply: (dt) => {
                if (m.addRepair((dt * REPAIR.wreckMul) / WRECK_REPAIR_TIME.mech)) sup.owner.stats.repairs++;
              },
            };
          }
        } else if (m.hp < m.maxHp) {
          const score = m.hp / m.maxHp;
          if (score < bestScore) {
            bestScore = score;
            best = { x: m.body.x, y: m.body.y - m.body.h * 0.55, apply: (dt) => m.heal(REPAIR.rate * dt) };
          }
        }
      }
      const pl: Pilot | null = p.pilot;
      if (pl && pl.alive && pl.hp < 40 && Math.hypot(pl.body.x - bx, pl.body.y - by) < REPAIR.range) {
        const score = pl.hp / 40 - 0.5;
        if (score < bestScore) {
          bestScore = score;
          best = { x: pl.body.x, y: pl.body.y - 15, apply: (dt) => { pl.hp = Math.min(40, pl.hp + 20 * dt); } };
        }
      }
    }
    return best;
  }

  reconPulse(x: number, y: number, r: number, owner: Player) {
    audio.play('recon');
    let n = 0;
    for (const e of this.enemies) {
      if (e.alive && Math.hypot(e.cx - x, e.cy - y) < r) {
        e.marked = RECON.duration;
        n++;
      }
    }
    const ring = this.add.circle(x, y, 40).setStrokeStyle(6, owner.color, 0.9).setDepth(48);
    this.tweens.add({ targets: ring, radius: r, alpha: 0, duration: 700, onComplete: () => ring.destroy() });
    const ring2 = this.add.circle(x, y, 20).setStrokeStyle(3, 0xffffff, 0.8).setDepth(48);
    this.tweens.add({ targets: ring2, radius: r * 0.7, alpha: 0, duration: 500, delay: 100, onComplete: () => ring2.destroy() });
    return n;
  }

  shockwave(x: number, _y: number, dmg: number) {
    for (const dir of [-1, 1]) this.waves2.push({ x, dir, life: 0.9, dmg, hit: new Set() });
  }

  private updateShockwaves(dt: number) {
    const g = this.waveGfx;
    g.clear();
    for (let i = this.waves2.length - 1; i >= 0; i--) {
      const w = this.waves2[i];
      w.life -= dt;
      w.x += w.dir * 1000 * dt;
      if (w.life <= 0) {
        this.waves2.splice(i, 1);
        continue;
      }
      g.fillStyle(0xffc070, 0.5 * w.life);
      g.fillEllipse(w.x, GROUND - 8, 70, 26);
      g.lineStyle(4, 0xfff0c0, w.life);
      g.strokeEllipse(w.x, GROUND - 14, 60, 34);
      if (Math.random() < 0.6) this.effects.dustFx(w.x, GROUND, 2);
      for (const t of this.targets('player')) {
        if (w.hit.has(t)) continue;
        const b = t.bounds();
        const onGround = b.y + b.h > GROUND - 12;
        if (onGround && Math.abs(t.cx - w.x) < 40) {
          w.hit.add(t);
          t.damage(w.dmg, null, t.cx, GROUND - 20);
        }
      }
    }
  }

  onOneWay(b: Body) {
    return this.solids.some((s) => s.oneWay && Math.abs(b.y - s.y) < 2 && b.x > s.x && b.x < s.x + s.w);
  }

  pointSolid(x: number, y: number) {
    return !!pointInSolids(x, y, this.solids);
  }

  redeploy(p: Player) {
    if (this.reinforcements <= 0 || this.objective === 'clear') {
      p.respawn = -1;
      return;
    }
    this.reinforcements--;
    const cam = this.cameras.main;
    let x = cam.worldView.centerX + (p.index - 1.5) * 90;
    x = Phaser.Math.Clamp(x, this.arenaLocked ? this.arenaBounds.left + 100 : 100, this.arenaLocked ? this.arenaBounds.right - 100 : LEVEL_W - 100);
    // 着地点（真下の地面）
    let gy = GROUND;
    for (const s of this.solids) {
      if (!s.oneWay && x > s.x && x < s.x + s.w && s.y < gy && s.y > cam.worldView.top) gy = s.y;
    }
    const pod = this.add.container(x, cam.worldView.top - 150).setDepth(25);
    const g = this.add.graphics();
    g.fillStyle(0x3a3a40, 1);
    g.fillRoundedRect(-34, -110, 68, 110, 14);
    g.fillStyle(p.color, 1);
    g.fillRect(-34, -70, 68, 10);
    g.fillStyle(0x1a1a1e, 1);
    g.fillRect(-20, -100, 40, 22);
    const flame = this.add.image(0, -8, 'flame').setOrigin(0.5, 1).setScale(1.2, -1.5).setBlendMode(Phaser.BlendModes.ADD);
    pod.add([flame, g]);
    audio.play('missile', 0.6);
    this.tweens.add({
      targets: pod, y: gy, duration: 900, ease: 'Quad.easeIn',
      onComplete: () => {
        pod.destroy();
        this.effects.explosion(x, gy - 30, 1.2);
        audio.play('explode');
        this.camShake(8);
        p.spawnMech(x, gy - 2);
      },
    });
  }

  popText(x: number, y: number, key: 'lvUp', color: number) {
    const txt = this.add.text(x, y, t()[key], {
      fontFamily: 'Rajdhani, "Noto Sans JP", sans-serif', fontSize: '30px', fontStyle: 'bold',
      color: '#' + color.toString(16).padStart(6, '0'), stroke: '#000', strokeThickness: 5,
    }).setOrigin(0.5).setDepth(70);
    this.tweens.add({ targets: txt, y: y - 70, alpha: 0, duration: 1400, ease: 'Cubic.easeOut', onComplete: () => txt.destroy() });
  }

  private popScore(x: number, y: number, score: number) {
    const txt = this.add.text(x, y, `+${score}`, {
      fontFamily: 'Rajdhani, sans-serif', fontSize: '26px', fontStyle: 'bold', color: '#ffe08a', stroke: '#000', strokeThickness: 4,
    }).setOrigin(0.5).setDepth(70);
    this.tweens.add({ targets: txt, y: y - 50, alpha: 0, duration: 900, onComplete: () => txt.destroy() });
  }

  get gateIsOpen() {
    return this.gateOpen;
  }
}
