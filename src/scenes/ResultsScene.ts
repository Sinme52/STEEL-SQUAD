import Phaser from 'phaser';
import { input } from '../game/input';
import { ROLE_DEFS, weaponLevel, type RoleId } from '../game/data';
import { audio } from '../game/audio';
import { t } from '../game/i18n';
import type { PlayerStats } from '../game/player';

const JP = '"Noto Sans JP", Rajdhani, sans-serif';
const FONT = 'Rajdhani, "Noto Sans JP", sans-serif';
const hex = (c: number) => '#' + c.toString(16).padStart(6, '0');

interface ResultData {
  clear: boolean;
  time: number;
  players: { index: number; role: RoleId; stats: PlayerStats; xpStart: number; xpEnd: number }[];
}

export function rankFor(r: ResultData) {
  if (!r.clear) return 'D';
  const deaths = r.players.reduce((a, p) => a + p.stats.deaths, 0);
  let score = 100 - deaths * 12 - Math.max(0, r.time - 420) / 6;
  score += r.players.reduce((a, p) => a + p.stats.repairs * 3, 0);
  return score >= 90 ? 'S' : score >= 70 ? 'A' : score >= 50 ? 'B' : 'C';
}

export class ResultsScene extends Phaser.Scene {
  private ready = 0;

  constructor() {
    super('Results');
  }

  create(data: ResultData) {
    const W = this.scale.width, H = this.scale.height;
    const s = t();
    this.add.image(W / 2, H / 2, 'keyart').setDisplaySize(W, H).setTint(0x303038);
    this.add.rectangle(0, 0, W, H, 0x000000, 0.5).setOrigin(0);
    this.add.text(W / 2, 90, data.clear ? s.missionClear : s.missionFailed, {
      fontFamily: FONT, fontSize: '84px', fontStyle: 'bold', color: data.clear ? '#f5c060' : '#e05040', stroke: '#000', strokeThickness: 8,
    }).setOrigin(0.5);
    const m = Math.floor(data.time / 60), sec = Math.floor(data.time % 60);
    this.add.text(W / 2, 170, `${s.time}  ${m}:${sec.toString().padStart(2, '0')}`, { fontFamily: JP, fontSize: '30px', color: '#ddd' }).setOrigin(0.5);
    const rank = rankFor(data);
    const rk = this.add.text(W - 220, 120, rank, { fontFamily: FONT, fontSize: '180px', fontStyle: 'bold', color: '#ffd060', stroke: '#000', strokeThickness: 10 }).setOrigin(0.5).setScale(3).setAlpha(0);
    this.add.text(W - 220, 230, s.rank, { fontFamily: JP, fontSize: '24px', color: '#ccc' }).setOrigin(0.5);
    this.tweens.add({ targets: rk, scale: 1, alpha: 1, duration: 500, delay: 900, ease: 'Back.easeOut', onComplete: () => audio.play('bigExplode', 0.5) });

    const n = data.players.length;
    const pw = 400, gap = 30;
    const x0 = W / 2 - (n * pw + (n - 1) * gap) / 2;
    data.players.forEach((p, i) => {
      const x = x0 + i * (pw + gap), y = 290;
      const def = ROLE_DEFS[p.role];
      const g = this.add.graphics();
      g.fillStyle(0x0b0d10, 0.85);
      g.fillRoundedRect(x, y, pw, 600, 8);
      g.lineStyle(3, def.color, 1);
      g.strokeRoundedRect(x, y, pw, 600, 8);
      this.add.image(x + pw / 2, y + 110, `portrait_${p.role}`).setDisplaySize(180, 180);
      this.add.text(x + pw / 2, y + 220, `${p.index + 1}P  ${s.mech[p.role]}`, { fontFamily: FONT, fontSize: '32px', fontStyle: 'bold', color: hex(def.color) }).setOrigin(0.5);
      this.add.text(x + pw / 2, y + 256, s.pilot[p.role], { fontFamily: JP, fontSize: '20px', color: '#aaa' }).setOrigin(0.5);
      const rows: [string, string][] = [
        [s.kills, String(p.stats.kills)],
        [s.damage, String(Math.round(p.stats.damage))],
        [s.revives, String(p.stats.repairs)],
        [s.weaponLv, `${weaponLevel(p.xpStart)} → ${weaponLevel(p.xpEnd)}`],
      ];
      rows.forEach(([k, v], r) => {
        const ty = y + 310 + r * 64;
        const a = this.add.text(x + 30, ty, k, { fontFamily: JP, fontSize: '24px', color: '#bbb' }).setAlpha(0);
        const b = this.add.text(x + pw - 30, ty, v, { fontFamily: FONT, fontSize: '34px', fontStyle: 'bold', color: '#fff' }).setOrigin(1, 0).setAlpha(0);
        this.tweens.add({ targets: [a, b], alpha: 1, delay: 300 + r * 120 + i * 60, duration: 250 });
      });
      if (weaponLevel(p.xpEnd) > weaponLevel(p.xpStart)) {
        this.add.text(x + pw / 2, y + 570, t().lvUp, { fontFamily: JP, fontSize: '22px', fontStyle: 'bold', color: '#9ad0ff' }).setOrigin(0.5);
      }
    });
    const cont = this.add.text(W / 2, H - 70, s.continue, { fontFamily: JP, fontSize: '26px', color: '#fff' }).setOrigin(0.5);
    this.tweens.add({ targets: cont, alpha: 0.3, yoyo: true, repeat: -1, duration: 700 });
    this.ready = 1.2;
  }

  update(_t: number, delta: number) {
    input.poll(this.game.loop.frame);
    this.ready -= delta / 1000;
    const m = input.menu();
    if (this.ready <= 0 && (m.confirm || m.start)) {
      audio.play('uiOk');
      this.scene.start('Title');
    }
  }
}
