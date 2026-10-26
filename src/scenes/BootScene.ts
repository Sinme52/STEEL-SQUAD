import Phaser from 'phaser';
import { makeTextures } from '../game/effects';
import { ROLES } from '../game/data';
import { allText } from '../game/i18n';

const MECH_PARTS = ['torso', 'arm', 'thigh', 'shin', 'foot'];

export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  preload() {
    const W = this.scale.width, H = this.scale.height;
    const bar = this.add.graphics();
    const label = this.add.text(W / 2, H / 2 - 40, 'LOADING', { fontFamily: 'sans-serif', fontSize: '28px', color: '#888' }).setOrigin(0.5);
    this.load.on('progress', (v: number) => {
      bar.clear();
      bar.fillStyle(0x333333, 1);
      bar.fillRect(W / 2 - 300, H / 2, 600, 8);
      bar.fillStyle(0xf08a24, 1);
      bar.fillRect(W / 2 - 300, H / 2, 600 * v, 8);
    });
    this.load.once('complete', () => label.destroy());

    this.load.setPath('assets/');
    for (const k of [...ROLES, 'enemy']) {
      for (const p of MECH_PARTS) this.load.image(`${k}_${p}`, `mechs/${k}_${p}.webp`);
      this.load.image(`${k}_full`, `mechs/${k}_full.webp`);
    }
    this.load.image('assault_shield', 'mechs/assault_shield.webp');
    for (const k of ['tank', 'heli', 'turret_base', 'turret_head', 'boss_hull', 'boss_leg_upper', 'boss_leg_lower']) {
      this.load.image(k, `enemies/${k}.webp`);
    }
    this.load.image('bg_far', 'bg/far.webp');
    this.load.image('bg_mid', 'bg/mid.webp');
    this.load.image('bg_near', 'bg/near.webp');
    this.load.image('ground', 'bg/ground.webp');
    for (const r of ROLES) this.load.image(`portrait_${r}`, `ui/portrait_${r}.webp`);
    this.load.image('keyart', 'ui/keyart.webp');
    this.load.image('logo', 'ui/logo.webp');
  }

  async create() {
    makeTextures(this);
    if (!this.textures.exists('vignette')) {
      const tex = this.textures.createCanvas('vignette', 480, 270)!;
      const c = tex.getContext();
      const g = c.createRadialGradient(240, 135, 80, 240, 135, 290);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, 'rgba(0,0,0,0.75)');
      c.fillStyle = g;
      c.fillRect(0, 0, 480, 270);
      tex.refresh();
    }
    // 文字が別のフォントで描かれないよう、使うフォントを読み込んでから始める
    try {
      await Promise.all([
        document.fonts.load('700 32px Rajdhani'),
        document.fonts.load('700 32px "Noto Sans JP"', allText()),
        document.fonts.load('400 32px "Noto Sans JP"', allText()),
      ]);
    } catch {
      // 読めなくても続ける
    }
    this.scene.start('Title');
  }
}
