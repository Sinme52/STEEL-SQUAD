import Phaser from 'phaser';
import { GROUND } from '../game/level';

// 多重スクロールの背景。ゲーム画面のカメラ位置を受け取って動かす
export class BgScene extends Phaser.Scene {
  private far!: Phaser.GameObjects.TileSprite;
  private mid!: Phaser.GameObjects.TileSprite;
  private near!: Phaser.GameObjects.TileSprite;

  constructor() {
    super('Bg');
  }

  create() {
    const W = this.scale.width, H = this.scale.height;
    this.add.rectangle(0, 0, W, H, 0x24161e).setOrigin(0);
    const farScale = (H * 1.15) / 1024;
    this.far = this.add.tileSprite(0, 0, W, 1024 * farScale, 'bg_far').setOrigin(0, 0).setTileScale(farScale);
    const midScale = 0.78;
    this.mid = this.add.tileSprite(0, 0, W, 1024 * midScale, 'bg_mid').setOrigin(0, 1).setTileScale(midScale).setTint(0xb0a8c0);
    const nearScale = 0.9;
    this.near = this.add.tileSprite(0, 0, W, 1024 * nearScale, 'bg_near').setOrigin(0, 1).setTileScale(nearScale).setTint(0x8a8088);
    this.add.particles(0, 0, 'softdot', {
      x: { min: 0, max: W }, y: H + 20, lifespan: 6000, speedY: { min: -90, max: -30 }, speedX: { min: -20, max: 40 },
      scale: { start: 0.35, end: 0 }, tint: [0xffa040, 0xff6a20, 0xffd080], blendMode: 'ADD', frequency: 120, alpha: { start: 0.9, end: 0 },
    });
    this.follow(0, GROUND - 700, 0.85);
  }

  follow(viewX: number, viewY: number, zoom: number) {
    if (!this.far) return;
    const H = this.scale.height;
    void H;
    const groundY = (GROUND - viewY) * zoom; // 画面上での地面の高さ
    this.far.tilePositionX = (viewX * 0.04) / this.far.tileScaleX;
    this.far.y = Math.min(0, (groundY - H) * 0.08 - 60);
    this.mid.tilePositionX = (viewX * 0.15) / this.mid.tileScaleX;
    this.mid.y = groundY - 20;
    this.near.tilePositionX = (viewX * 0.4) / this.near.tileScaleX;
    this.near.y = groundY + 90;
  }
}
