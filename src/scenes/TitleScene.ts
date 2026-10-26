import Phaser from 'phaser';
import { input } from '../game/input';
import { audio } from '../game/audio';
import { t } from '../game/i18n';
import { save } from '../game/save';

const JP = '"Noto Sans JP", Rajdhani, sans-serif';

declare global {
  interface Window {
    desktop?: { quit(): void; setFullscreen(on: boolean): void };
  }
}

export class TitleScene extends Phaser.Scene {
  private stage: 'press' | 'menu' = 'press';
  private sel = 0;
  private items: Phaser.GameObjects.Text[] = [];
  private press!: Phaser.GameObjects.Text;
  private menu!: Phaser.GameObjects.Container;
  private anyPressed = false;

  constructor() {
    super('Title');
  }

  create() {
    const W = this.scale.width, H = this.scale.height;
    const s = t();
    const key = this.add.image(W / 2, H / 2, 'keyart').setDisplaySize(W * 1.06, H * 1.06);
    this.tweens.add({ targets: key, scale: key.scale * 1.05, duration: 20000, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    this.add.image(W / 2, H / 2, 'vignette').setDisplaySize(W, H);
    const shade = this.add.graphics();
    shade.fillGradientStyle(0x000000, 0x000000, 0x000000, 0x000000, 0.55, 0, 0.55, 0);
    shade.fillRect(0, 0, W * 0.6, H);
    const logo = this.add.image(90, 120, 'logo').setOrigin(0, 0);
    logo.setScale(Math.min(1, 900 / logo.width));
    this.add.particles(0, 0, 'softdot', {
      x: { min: 0, max: W }, y: H + 10, lifespan: 7000, speedY: { min: -80, max: -30 }, speedX: { min: -10, max: 50 },
      scale: { start: 0.4, end: 0 }, tint: [0xffa040, 0xff6a20], blendMode: 'ADD', frequency: 90,
    });

    this.press = this.add.text(W / 2, H - 170, s.pressStart, { fontFamily: JP, fontSize: '36px', fontStyle: 'bold', color: '#ffffff', stroke: '#000', strokeThickness: 6 }).setOrigin(0.5);
    this.tweens.add({ targets: this.press, alpha: 0.25, yoyo: true, repeat: -1, duration: 700 });

    const labels = [s.start, s.options, ...(window.desktop ? [s.quit] : [])];
    this.items = labels.map((l, i) => this.add.text(140, 470 + i * 78, l, { fontFamily: JP, fontSize: '44px', fontStyle: 'bold', color: '#ddd', stroke: '#000', strokeThickness: 6 }));
    const foot = this.add.text(W - 30, H - 24, `${s.credits}   v0.1.0${save.clears ? `   CLEAR ×${save.clears}` : ''}`, { fontFamily: JP, fontSize: '18px', color: '#bbb' }).setOrigin(1, 1);
    this.menu = this.add.container(0, 0, [...this.items, foot]).setVisible(false);
    this.stage = 'press';
    this.sel = 0;
    this.anyPressed = false;
    this.input.once('pointerdown', () => { audio.unlock(); this.anyPressed = true; });
    this.input.keyboard?.once('keydown', () => { this.anyPressed = true; });
    audio.playSong('title');
  }

  update() {
    input.poll(this.game.loop.frame);
    const m = input.menu();
    if (this.stage === 'press') {
      if (m.confirm || m.start || m.back || this.anyKey()) {
        audio.unlock();
        audio.playSong('title');
        audio.play('uiOk');
        this.stage = 'menu';
        this.press.setVisible(false);
        this.menu.setVisible(true);
        this.refresh();
      }
      return;
    }
    const n = this.items.length;
    if (m.up) { this.sel = (this.sel + n - 1) % n; audio.play('ui'); this.refresh(); }
    if (m.down) { this.sel = (this.sel + 1) % n; audio.play('ui'); this.refresh(); }
    if (m.confirm || m.start) {
      audio.play('uiOk');
      if (this.sel === 0) this.scene.start('Lobby');
      else if (this.sel === 1) this.scene.start('Options', { from: 'Title' });
      else window.desktop?.quit();
    }
  }

  private anyKey() {
    const v = this.anyPressed;
    this.anyPressed = false;
    return v;
  }

  private refresh() {
    this.items.forEach((it, i) => {
      const on = i === this.sel;
      it.setColor(on ? '#f5a040' : '#d8d8d8');
      it.setX(on ? 160 : 140);
    });
  }
}
