import Phaser from 'phaser';
import { input } from '../game/input';
import { audio } from '../game/audio';
import { t } from '../game/i18n';
import { persist, settings } from '../game/save';

const JP = '"Noto Sans JP", Rajdhani, sans-serif';

type Row = { label: () => string; value: () => string; change: (dir: number) => void };

export function applyFullscreen(scene: Phaser.Scene) {
  if (window.desktop) window.desktop.setFullscreen(settings.fullscreen);
  else if (settings.fullscreen && !scene.scale.isFullscreen) scene.scale.startFullscreen();
  else if (!settings.fullscreen && scene.scale.isFullscreen) scene.scale.stopFullscreen();
}

export class OptionsScene extends Phaser.Scene {
  private sel = 0;
  private rows: Row[] = [];
  private texts: Phaser.GameObjects.Text[] = [];
  private title!: Phaser.GameObjects.Text;
  private help!: Phaser.GameObjects.Text;

  constructor() {
    super('Options');
  }

  create() {
    const W = this.scale.width, H = this.scale.height;
    this.add.image(W / 2, H / 2, 'keyart').setDisplaySize(W, H).setTint(0x303038);
    this.add.rectangle(0, 0, W, H, 0x000000, 0.55).setOrigin(0);
    const vol = (key: 'master' | 'music' | 'sfx') => (dir: number) => {
      settings[key] = Phaser.Math.Clamp(Math.round((settings[key] + dir * 0.1) * 10) / 10, 0, 1);
      audio.applyVolume();
    };
    const pct = (v: number) => `${'■'.repeat(Math.round(v * 10))}${'□'.repeat(10 - Math.round(v * 10))}  ${Math.round(v * 100)}%`;
    this.rows = [
      { label: () => t().language, value: () => (settings.lang === 'ja' ? '日本語' : 'English'), change: () => { settings.lang = settings.lang === 'ja' ? 'en' : 'ja'; } },
      { label: () => t().master, value: () => pct(settings.master), change: vol('master') },
      { label: () => t().music, value: () => pct(settings.music), change: vol('music') },
      { label: () => t().sfx, value: () => pct(settings.sfx), change: vol('sfx') },
      { label: () => t().shake, value: () => (settings.shake ? t().on : t().off), change: () => { settings.shake = !settings.shake; } },
      { label: () => t().fullscreen, value: () => (settings.fullscreen ? t().on : t().off), change: () => { settings.fullscreen = !settings.fullscreen; applyFullscreen(this); } },
      { label: () => t().back, value: () => '', change: () => {} },
    ];
    this.title = this.add.text(140, 90, '', { fontFamily: JP, fontSize: '56px', fontStyle: 'bold', color: '#fff' });
    this.texts = this.rows.map((_, i) => this.add.text(160, 220 + i * 76, '', { fontFamily: JP, fontSize: '34px', color: '#ddd' }));
    this.help = this.add.text(140, H - 140, '', { fontFamily: JP, fontSize: '20px', color: '#999', wordWrap: { width: W - 280 } });
    this.sel = 0;
    this.refresh();
  }

  private refresh() {
    this.title.setText(t().options);
    this.help.setText(t().controls);
    this.rows.forEach((r, i) => {
      const on = i === this.sel;
      const v = r.value();
      this.texts[i].setText(`${on ? '▶ ' : '   '}${r.label()}${v ? '   :   ' + v : ''}`).setColor(on ? '#f5a040' : '#dddddd');
    });
  }

  update() {
    input.poll(this.game.loop.frame);
    const m = input.menu();
    const n = this.rows.length;
    if (m.up) { this.sel = (this.sel + n - 1) % n; audio.play('ui'); }
    if (m.down) { this.sel = (this.sel + 1) % n; audio.play('ui'); }
    if (m.left || m.right) { this.rows[this.sel].change(m.left ? -1 : 1); audio.play('ui'); }
    if (m.confirm) {
      if (this.sel === n - 1) return this.leave();
      this.rows[this.sel].change(1);
      audio.play('uiOk');
    }
    if (m.back) return this.leave();
    if (m.up || m.down || m.left || m.right || m.confirm) this.refresh();
  }

  private leave() {
    persist();
    audio.play('uiOk');
    this.scene.start('Title');
  }
}
