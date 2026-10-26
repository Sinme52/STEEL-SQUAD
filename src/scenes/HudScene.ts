import Phaser from 'phaser';
import { MAX_WEAPON_LV, REPAIR, SHIELD, weaponLevel, weaponLevelProgress } from '../game/data';
import { input } from '../game/input';
import { GATE_X, GROUND, SWITCH_X } from '../game/level';
import { persist, save } from '../game/save';
import { t } from '../game/i18n';
import { audio } from '../game/audio';
import type { GameScene } from './GameScene';
import type { Player } from '../game/player';

const FONT = 'Rajdhani, "Noto Sans JP", sans-serif';
const JP = '"Noto Sans JP", Rajdhani, sans-serif';
const hex = (c: number) => '#' + c.toString(16).padStart(6, '0');

interface Panel {
  root: Phaser.GameObjects.Container;
  status: Phaser.GameObjects.Text;
  lv: Phaser.GameObjects.Text;
  bars: Phaser.GameObjects.Graphics;
}

export class HudScene extends Phaser.Scene {
  private game2!: GameScene;
  private panels: Panel[] = [];
  private objText!: Phaser.GameObjects.Text;
  private infoText!: Phaser.GameObjects.Text;
  private bossBar!: Phaser.GameObjects.Graphics;
  private bossText!: Phaser.GameObjects.Text;
  private world!: Phaser.GameObjects.Graphics;
  private prompts: Phaser.GameObjects.Text[] = [];
  private pauseUi: Phaser.GameObjects.Container | null = null;
  private pauseSel = 0;
  private pauseItems: Phaser.GameObjects.Text[] = [];
  private ventLabel!: Phaser.GameObjects.Text;

  constructor() {
    super('Hud');
  }

  create() {
    this.game2 = this.scene.get('Game') as GameScene;
    this.panels = [];
    this.prompts = [];
    this.pauseUi = null;
    const W = this.scale.width;
    this.add.image(W / 2, this.scale.height / 2, 'vignette').setDisplaySize(W, this.scale.height).setAlpha(0.9);
    this.world = this.add.graphics();
    // 目標
    const objBg = this.add.graphics();
    objBg.fillStyle(0x000000, 0.45);
    objBg.fillRect(24, 22, 900, 52);
    objBg.fillStyle(0xf08a24, 1);
    objBg.fillRect(24, 22, 6, 52);
    this.objText = this.add.text(44, 48, '', { fontFamily: JP, fontSize: '26px', color: '#ffffff', fontStyle: 'bold' }).setOrigin(0, 0.5);
    this.infoText = this.add.text(W - 28, 30, '', { fontFamily: FONT, fontSize: '28px', color: '#e8e0d0', fontStyle: 'bold', align: 'right' }).setOrigin(1, 0);
    this.bossBar = this.add.graphics();
    this.bossText = this.add.text(W / 2, 98, '', { fontFamily: JP, fontSize: '24px', color: '#ffb0a0', fontStyle: 'bold' }).setOrigin(0.5, 1);

    const g0 = this.game2;
    const n = g0.players.length;
    const pw = 430, gap = 18;
    const x0 = W / 2 - (n * pw + (n - 1) * gap) / 2;
    this.game2.players.forEach((p, i) => this.panels.push(this.makePanel(p, x0 + i * (pw + gap), this.scale.height - 128, pw)));
    this.ventLabel = this.add.text(0, 0, t().vent, { fontFamily: JP, fontSize: '18px', color: '#40ff70', fontStyle: 'bold', stroke: '#000', strokeThickness: 4 }).setOrigin(1, 1).setVisible(false);
    for (let i = 0; i < 4; i++) {
      this.prompts.push(this.add.text(0, 0, '', {
        fontFamily: JP, fontSize: '22px', color: '#ffffff', backgroundColor: '#000000aa', padding: { x: 10, y: 5 },
      }).setOrigin(0.5, 1).setVisible(false));
    }
    // 出撃直後は各自の操作方法を表示する
    g0.players.forEach((p, i) => {
      const pn = this.panels[i];
      const key = p.device === 'kb1' ? 'ctrlKb1' : p.device === 'kb2' ? 'ctrlKb2' : 'ctrlPad';
      const hint = this.add.text(pn.root.x + 215, pn.root.y - 12, t()[key], {
        fontFamily: JP, fontSize: '17px', color: '#ffffff', align: 'center', backgroundColor: '#000000b0', padding: { x: 10, y: 6 }, lineSpacing: 4,
      }).setOrigin(0.5, 1);
      this.tweens.add({ targets: hint, alpha: 0, delay: 14000, duration: 800, onComplete: () => hint.destroy() });
    });
    this.events.on('open-pause-menu', () => this.openPause());
    this.events.once('shutdown', () => this.events.off('open-pause-menu'));
  }

  private makePanel(p: Player, x: number, y: number, w: number): Panel {
    const root = this.add.container(x, y);
    const bg = this.add.graphics();
    bg.fillStyle(0x0b0d10, 0.72);
    bg.fillRoundedRect(0, 0, w, 108, 6);
    bg.lineStyle(2, p.color, 0.9);
    bg.strokeRoundedRect(0, 0, w, 108, 6);
    const portrait = this.add.image(54, 54, `portrait_${p.role}`).setDisplaySize(92, 92);
    const mask = this.make.graphics({}, false).fillRect(x + 8, y + 8, 92, 92);
    portrait.setMask(mask.createGeometryMask());
    const tag = this.add.text(112, 8, `${p.index + 1}P  ${t().mech[p.role]}`, { fontFamily: FONT, fontSize: '24px', fontStyle: 'bold', color: hex(p.color) });
    const role = this.add.text(w - 10, 10, t().roleName[p.role], { fontFamily: JP, fontSize: '16px', color: '#a8a8a8' }).setOrigin(1, 0);
    const bars = this.add.graphics();
    const status = this.add.text(112, 86, '', { fontFamily: JP, fontSize: '16px', color: '#ffd080', fontStyle: 'bold' });
    const lv = this.add.text(w - 10, 84, '', { fontFamily: FONT, fontSize: '18px', color: '#e0e0e0', fontStyle: 'bold' }).setOrigin(1, 0);
    root.add([bg, portrait, tag, role, bars, status, lv]);
    return { root, status, lv, bars };
  }

  update() {
    const g = this.game2;
    if (!g || !g.players) return;
    if (this.pauseUi) {
      this.updatePause();
      return;
    }
    const s = t();
    const obj = { advance: s.objAdvance, gate: s.objGate, hold: s.objHold, boss: s.objBoss, clear: s.missionClear, failed: s.missionFailed }[g.objective];
    this.objText.setText(obj);
    const m = Math.floor(g.missionTime / 60), sec = Math.floor(g.missionTime % 60);
    this.infoText.setText(`${s.reinforce} ×${g.reinforcements}\n${m}:${sec.toString().padStart(2, '0')}`);

    g.players.forEach((p, i) => this.updatePanel(p, this.panels[i]));
    this.updateBoss();
    this.updateWorldUi();
  }

  private updatePanel(p: Player, pn: Panel) {
    const s = t();
    const b = pn.bars;
    b.clear();
    const bx = 112, bw = 300;
    const bar = (y: number, h: number, ratio: number, color: number) => {
      b.fillStyle(0x000000, 0.6);
      b.fillRect(bx, y, bw, h);
      b.fillStyle(color, 1);
      b.fillRect(bx, y, bw * Phaser.Math.Clamp(ratio, 0, 1), h);
    };
    const m = p.mech;
    // 耐久
    if (p.state === 'pilot' && p.pilot) bar(36, 13, p.pilot.hp / 40, 0xffd080);
    else if (m) {
      const r = m.hp / m.maxHp;
      bar(36, 13, r, r > 0.5 ? 0x7cd96a : r > 0.25 ? 0xf2c94c : 0xe0483a);
    } else bar(36, 13, 0, 0);
    // ブーストゲージ（オーバーヒート中は赤く点滅）
    if (m) {
      const blink = m.overheat && Math.floor(this.time.now / 150) % 2 === 0;
      bar(53, 6, m.gauge / p.def.boostGauge, m.overheat ? (blink ? 0xff3020 : 0x802018) : m.boosting ? 0xffffff : 0xb8dcff);
    } else bar(53, 6, 0, 0);
    // スキル
    let skill = 1, skillColor = p.color;
    if (m) {
      if (p.role === 'assault') {
        skill = m.shieldHp / SHIELD.max;
        if (m.shieldBroken > 0) skillColor = 0x666666;
      } else if (p.role === 'support') skill = m.energy / REPAIR.energy;
      else skill = 1 - m.skillCd / p.def.skillCooldown;
      if (skill < 1 && p.role !== 'assault' && p.role !== 'support') skillColor = 0x777777;
    }
    bar(63, 6, skill, skillColor);
    // 武器の熟練度
    const xp = save.weaponXp[p.role];
    const lv = weaponLevel(xp);
    bar(74, 4, lv >= MAX_WEAPON_LV ? 1 : weaponLevelProgress(xp), 0x9ad0ff);
    pn.lv.setText(`${s.weaponLv} ${lv}`);
    // 状態
    let st = '';
    if (p.state === 'pilot') st = m?.state === 'wreck' ? `${s.downed} ${Math.floor((m.repair || 0) * 100)}%` : s.ejected;
    else if (p.state === 'kia') st = p.respawn > 0 ? `${s.kia} ${Math.ceil(p.respawn)}` : 'KIA';
    else if (m?.overheat) st = 'OVERHEAT';
    else if (m?.boosting) st = 'BOOST';
    else if (m?.braced) st = 'BRACE';
    else if (m && m.marked > 0) st = '';
    pn.status.setText(st);
    pn.status.setColor(p.state === 'kia' || m?.overheat ? '#ff6050' : '#ffd080');
  }

  private updateBoss() {
    const g = this.game2;
    const b = this.bossBar;
    b.clear();
    const boss = g.boss;
    if (!boss || !boss.alive) {
      this.bossText.setText('');
      return;
    }
    const W = this.scale.width, w = 900, x = W / 2 - w / 2;
    b.fillStyle(0x000000, 0.65);
    b.fillRect(x - 4, 102, w + 8, 22);
    b.fillStyle(0xd83a2a, 1);
    b.fillRect(x, 106, w * Math.max(0, boss.hp / boss.maxHp), 14);
    b.lineStyle(2, 0xffffff, 0.4);
    for (const r of [0.6, 0.3]) b.lineBetween(x + w * r, 104, x + w * r, 122);
    this.bossText.setText(t().bossName);
  }

  /** ゲーム画面の座標を HUD の画面座標へ */
  private toScreen(x: number, y: number) {
    const cam = this.game2.cameras.main;
    return { x: (x - cam.worldView.x) * cam.zoom, y: (y - cam.worldView.y) * cam.zoom };
  }

  private updateWorldUi() {
    const g = this.game2;
    const w = this.world;
    w.clear();
    const W = this.scale.width, H = this.scale.height;
    const s = t();
    // 画面外のマーク済みの敵を矢印で示す
    for (const e of g.enemies) {
      if (!e.alive || e.marked <= 0) continue;
      const p = this.toScreen(e.cx, e.cy);
      if (p.x > 0 && p.x < W && p.y > 0 && p.y < H - 140) {
        w.lineStyle(3, 0xff4040, 0.9);
        w.strokeCircle(p.x, p.y, 34 + Math.sin(this.time.now / 100) * 3);
        continue;
      }
      this.edgeArrow(p.x, p.y, 0xff4040);
    }
    // ゲートの目標（スイッチと通気口）
    if (g.objective === 'gate') {
      const p = this.toScreen(SWITCH_X, GROUND - 49);
      w.lineStyle(3, 0x40ff70, 0.9);
      w.strokeCircle(p.x, p.y, 26 + Math.sin(this.time.now / 120) * 4);
      const v = this.toScreen(GATE_X - 40, GROUND - 24);
      const bob = Math.sin(this.time.now / 150) * 8;
      w.fillStyle(0x40ff70, 0.95);
      w.fillTriangle(v.x - 34 + bob, v.y - 14, v.x - 34 + bob, v.y + 14, v.x - 8 + bob, v.y);
      this.ventLabel.setPosition(v.x - 40, v.y - 26).setVisible(true);
    } else this.ventLabel.setVisible(false);
    // 操作の案内（修理・搭乗・スイッチ）
    let pi = 0;
    for (const p of g.players) {
      const pr = this.prompts[pi++];
      pr.setVisible(false);
      const body = p.activeBody();
      if (!body) continue;
      let text = '';
      const wreck = g.nearestWreck(body.x, body.y, p.state === 'mech' ? 140 : 110, p.mech && p.state === 'mech' ? p.mech : null);
      if (wreck) text = s.hold;
      else if (p.state === 'pilot' && p.mech && p.mech.state === 'empty' && Math.abs(p.mech.body.x - body.x) < 70) text = s.board;
      else if (p.state === 'pilot' && g.objective === 'gate' && Math.abs(body.x - SWITCH_X) < 90) text = s.switchOn;
      if (!text) continue;
      const key = p.device === 'kb1' ? 'L' : p.device === 'kb2' ? 'Num3' : 'B';
      const sp = this.toScreen(body.x, body.y - body.h - 50);
      pr.setText(`[${key}] ${text}`).setPosition(sp.x, sp.y).setVisible(true);
    }
  }

  private edgeArrow(x: number, y: number, color: number) {
    const W = this.scale.width, H = this.scale.height - 140;
    const cx = W / 2, cy = H / 2;
    const a = Math.atan2(y - cy, x - cx);
    const ex = Phaser.Math.Clamp(x, 40, W - 40), ey = Phaser.Math.Clamp(y, 140, H - 20);
    const w = this.world;
    w.fillStyle(color, 0.9);
    w.fillTriangle(
      ex + Math.cos(a) * 20, ey + Math.sin(a) * 20,
      ex + Math.cos(a + 2.5) * 16, ey + Math.sin(a + 2.5) * 16,
      ex + Math.cos(a - 2.5) * 16, ey + Math.sin(a - 2.5) * 16,
    );
  }

  banner(title: string, sub?: string) {
    const W = this.scale.width;
    const c = this.add.container(W / 2, 330).setAlpha(0);
    const band = this.add.graphics();
    band.fillStyle(0x000000, 0.55);
    band.fillRect(-W / 2, -70, W, sub ? 150 : 110);
    band.fillStyle(0xf08a24, 1);
    band.fillRect(-W / 2, -70, W, 3);
    band.fillRect(-W / 2, (sub ? 80 : 40) - 3, W, 3);
    const tt = this.add.text(0, -18, title, { fontFamily: FONT, fontSize: '64px', fontStyle: 'bold', color: '#ffffff', stroke: '#000', strokeThickness: 6 }).setOrigin(0.5);
    c.add([band, tt]);
    if (sub) c.add(this.add.text(0, 42, sub, { fontFamily: JP, fontSize: '26px', color: '#ffd8a8' }).setOrigin(0.5));
    this.tweens.add({ targets: c, alpha: 1, duration: 250 });
    tt.setScale(1.3);
    this.tweens.add({ targets: tt, scale: 1, duration: 300, ease: 'Back.easeOut' });
    this.tweens.add({ targets: c, alpha: 0, delay: 2800, duration: 500, onComplete: () => c.destroy() });
  }

  flashObjective() {
    this.tweens.add({ targets: this.objText, alpha: 0.2, yoyo: true, repeat: 4, duration: 160 });
    audio.play('ui');
  }

  // ---------------------------------------------------------------- ポーズ

  private openPause() {
    const W = this.scale.width, H = this.scale.height;
    const s = t();
    this.pauseSel = 0;
    const bg = this.add.rectangle(0, 0, W, H, 0x000000, 0.65).setOrigin(0);
    const title = this.add.text(W / 2, H / 2 - 160, s.paused, { fontFamily: FONT, fontSize: '72px', fontStyle: 'bold', color: '#fff' }).setOrigin(0.5);
    this.pauseItems = [s.resume, s.retry, s.toTitle].map((label, i) =>
      this.add.text(W / 2, H / 2 - 30 + i * 70, label, { fontFamily: JP, fontSize: '38px', color: '#ccc', fontStyle: 'bold' }).setOrigin(0.5));
    const help = this.add.text(W / 2, H - 120, s.controls, { fontFamily: JP, fontSize: '18px', color: '#9a9a9a', align: 'center', wordWrap: { width: W - 200 } }).setOrigin(0.5);
    this.pauseUi = this.add.container(0, 0, [bg, title, ...this.pauseItems, help]);
    this.refreshPause();
  }

  private refreshPause() {
    this.pauseItems.forEach((it, i) => it.setColor(i === this.pauseSel ? '#f08a24' : '#cccccc').setText((i === this.pauseSel ? '▶ ' : '') + it.text.replace('▶ ', '')));
  }

  private updatePause() {
    input.poll(this.game.loop.frame);
    const m = input.menu();
    if (m.up) { this.pauseSel = (this.pauseSel + 2) % 3; audio.play('ui'); this.refreshPause(); }
    if (m.down) { this.pauseSel = (this.pauseSel + 1) % 3; audio.play('ui'); this.refreshPause(); }
    const resume = m.back || (m.start && !m.confirm);
    if (resume || m.confirm) {
      const sel = resume ? 0 : this.pauseSel;
      audio.play('uiOk');
      this.pauseUi?.destroy();
      this.pauseUi = null;
      if (sel === 0) this.scene.resume('Game');
      else if (sel === 1) {
        // Game を作り直すと、Game 側が HUD と背景も起動し直す
        this.game2.scene.restart({ squad: this.game2.squad });
      } else {
        persist();
        this.scene.stop('Game');
        this.scene.stop('Bg');
        this.scene.start('Title');
      }
    }
  }
}
