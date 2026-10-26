import Phaser from 'phaser';
import { DEVICES, input, type DeviceId } from '../game/input';
import { ROLES, ROLE_DEFS, weaponLevel, type RoleId } from '../game/data';
import { audio } from '../game/audio';
import { t } from '../game/i18n';
import { save } from '../game/save';
import type { SquadMember } from './GameScene';

const JP = '"Noto Sans JP", Rajdhani, sans-serif';
const FONT = 'Rajdhani, "Noto Sans JP", sans-serif';
const hex = (c: number) => '#' + c.toString(16).padStart(6, '0');

interface Slot {
  device: DeviceId | null;
  role: RoleId;
  ready: boolean;
  ui: Phaser.GameObjects.Container;
}

function deviceName(d: DeviceId) {
  if (d === 'kb1') return 'KEYBOARD 1 (WASD)';
  if (d === 'kb2') return 'KEYBOARD 2 (ARROWS)';
  return `GAMEPAD ${Number(d.slice(3)) + 1}`;
}

export class LobbyScene extends Phaser.Scene {
  private slots: Slot[] = [];
  private startText!: Phaser.GameObjects.Text;

  constructor() {
    super('Lobby');
  }

  create() {
    const W = this.scale.width, H = this.scale.height;
    const s = t();
    this.add.image(W / 2, H / 2, 'keyart').setDisplaySize(W, H).setTint(0x404048);
    this.add.rectangle(0, 0, W, H, 0x000000, 0.45).setOrigin(0);
    this.add.text(70, 50, s.lobbyTitle, { fontFamily: JP, fontSize: '52px', fontStyle: 'bold', color: '#fff' });
    this.add.text(72, 120, s.lobbyHint, { fontFamily: JP, fontSize: '20px', color: '#c8c0b0' });
    this.add.text(72, 150, s.noPads, { fontFamily: JP, fontSize: '16px', color: '#888' });
    this.startText = this.add.text(W / 2, H - 60, s.lobbyStart, { fontFamily: JP, fontSize: '30px', fontStyle: 'bold', color: '#f5a040', stroke: '#000', strokeThickness: 5 }).setOrigin(0.5).setVisible(false);
    this.tweens.add({ targets: this.startText, alpha: 0.4, yoyo: true, repeat: -1, duration: 600 });
    this.slots = [];
    for (let i = 0; i < 4; i++) {
      const ui = this.add.container(70 + i * 450, 200);
      this.slots.push({ device: null, role: ROLES[i], ready: false, ui });
      this.drawSlot(i);
    }
    audio.playSong('title');
  }

  private taken(role: RoleId, except: number) {
    return this.slots.some((s, i) => i !== except && s.device && s.role === role);
  }

  private drawSlot(i: number) {
    const sl = this.slots[i];
    const s = t();
    const ui = sl.ui;
    ui.removeAll(true);
    const w = 420, h = 760;
    const bg = this.add.graphics();
    const def = ROLE_DEFS[sl.role];
    bg.fillStyle(0x0b0d10, 0.82);
    bg.fillRoundedRect(0, 0, w, h, 8);
    bg.lineStyle(3, sl.device ? def.color : 0x444444, sl.device ? 1 : 0.6);
    bg.strokeRoundedRect(0, 0, w, h, 8);
    ui.add(bg);
    ui.add(this.add.text(20, 16, `${i + 1}P`, { fontFamily: FONT, fontSize: '40px', fontStyle: 'bold', color: sl.device ? hex(def.color) : '#666' }));
    if (!sl.device) {
      ui.add(this.add.text(w / 2, h / 2, s.joinSlot, { fontFamily: JP, fontSize: '30px', color: '#777' }).setOrigin(0.5));
      ui.add(this.add.text(w / 2, h / 2 + 50, 'Space / RShift / Ⓐ', { fontFamily: FONT, fontSize: '24px', color: '#666' }).setOrigin(0.5));
      return;
    }
    ui.add(this.add.text(w - 20, 28, deviceName(sl.device), { fontFamily: FONT, fontSize: '18px', color: '#999' }).setOrigin(1, 0));
    const full = this.add.image(w / 2, 330, `${sl.role}_full`);
    full.setScale(Math.min(330 / full.height, 360 / full.width));
    ui.add(full);
    const portrait = this.add.image(w - 70, 120, `portrait_${sl.role}`).setDisplaySize(100, 100);
    ui.add(portrait);
    ui.add(this.add.text(24, 76, `◀ ${s.roleName[sl.role]} ▶`, { fontFamily: JP, fontSize: '34px', fontStyle: 'bold', color: '#fff' }));
    ui.add(this.add.text(26, 124, s.roleTag[sl.role], { fontFamily: JP, fontSize: '20px', color: hex(def.color) }));
    ui.add(this.add.text(26, 152, `${s.mech[sl.role]} / ${s.pilot[sl.role]}`, { fontFamily: JP, fontSize: '18px', color: '#aaa' }));
    ui.add(this.add.text(24, 520, s.roleDesc[sl.role], { fontFamily: JP, fontSize: '20px', color: '#ddd', wordWrap: { width: w - 48, useAdvancedWrap: true }, lineSpacing: 6 }));
    // 能力の目安
    const stat = this.add.graphics();
    const rows: [string, number][] = [['ARMOR', def.hp / 460], ['SPEED', def.speed / 340], ['BOOST', def.fuel / 1.6]];
    rows.forEach(([, v], k) => {
      stat.fillStyle(0x222222, 1);
      stat.fillRect(130, 642 + k * 26, 260, 12);
      stat.fillStyle(def.color, 1);
      stat.fillRect(130, 642 + k * 26, 260 * v, 12);
    });
    ui.add(stat);
    rows.forEach(([n], k) => ui.add(this.add.text(26, 636 + k * 26, n, { fontFamily: FONT, fontSize: '20px', fontStyle: 'bold', color: '#aaa' })));
    ui.add(this.add.text(w - 20, 600, `${s.weaponLv} ${weaponLevel(save.weaponXp[sl.role])}`, { fontFamily: FONT, fontSize: '22px', fontStyle: 'bold', color: '#9ad0ff' }).setOrigin(1, 0));
    if (sl.ready) {
      const band = this.add.rectangle(w / 2, 330, w, 70, 0x000000, 0.7);
      const txt = this.add.text(w / 2, 330, s.ready, { fontFamily: JP, fontSize: '40px', fontStyle: 'bold', color: hex(def.color) }).setOrigin(0.5);
      ui.add([band, txt]);
    } else {
      ui.add(this.add.text(w / 2, 728, s.choose, { fontFamily: JP, fontSize: '20px', color: '#888' }).setOrigin(0.5));
    }
  }

  update() {
    input.poll(this.game.loop.frame);
    const menu = input.menu();
    let wantStart = menu.start;
    for (const d of DEVICES) {
      const st = input.get(d);
      const idx = this.slots.findIndex((s) => s.device === d);
      if (idx < 0) {
        if (st.jumpPressed) {
          const free = this.slots.findIndex((s) => !s.device);
          if (free >= 0) {
            const sl = this.slots[free];
            sl.device = d;
            sl.ready = false;
            // 空いている役割を自動で選ぶ
            let r = ROLES.indexOf(sl.role);
            for (let k = 0; k < 4 && this.taken(ROLES[r], free); k++) r = (r + 1) % 4;
            sl.role = ROLES[r];
            audio.unlock();
            audio.play('uiOk');
            this.drawSlot(free);
          }
        }
        continue;
      }
      const sl = this.slots[idx];
      if (!sl.ready) {
        const dir = st.leftPressed ? -1 : st.rightPressed ? 1 : 0;
        if (dir) {
          let r = ROLES.indexOf(sl.role);
          for (let k = 0; k < 4; k++) {
            r = (r + dir + 4) % 4;
            if (!this.taken(ROLES[r], idx)) break;
          }
          sl.role = ROLES[r];
          audio.play('ui');
          this.drawSlot(idx);
        }
        if (st.jumpPressed || st.firePressed) {
          sl.ready = true;
          audio.play('uiOk');
          this.drawSlot(idx);
        }
        if (st.backPressed) {
          sl.device = null;
          audio.play('ui');
          this.drawSlot(idx);
        }
      } else if (st.jumpPressed) {
        wantStart = true;
      } else if (st.backPressed) {
        sl.ready = false;
        audio.play('ui');
        this.drawSlot(idx);
      }
    }
    const joined = this.slots.filter((s) => s.device);
    const allReady = joined.length > 0 && joined.every((s) => s.ready);
    this.startText.setVisible(allReady);
    if (allReady && wantStart) {
      audio.play('uiOk');
      const squad: SquadMember[] = joined.map((s) => ({ device: s.device!, role: s.role }));
      this.cameras.main.fadeOut(400, 0, 0, 0);
      this.cameras.main.once('camerafadeoutcomplete', () => this.scene.start('Game', { squad }));
    }
    // 誰も参加していない状態で戻る
    if (!joined.length && menu.back) this.scene.start('Title');
  }
}
