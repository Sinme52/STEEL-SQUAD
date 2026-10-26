import Phaser from 'phaser';
import '@fontsource/rajdhani/600.css';
import '@fontsource/rajdhani/700.css';
import '@fontsource/noto-sans-jp/400.css';
import '@fontsource/noto-sans-jp/700.css';
import { BootScene } from './scenes/BootScene';
import { TitleScene } from './scenes/TitleScene';
import { LobbyScene } from './scenes/LobbyScene';
import { GameScene } from './scenes/GameScene';
import { BgScene } from './scenes/BgScene';
import { HudScene } from './scenes/HudScene';
import { ResultsScene } from './scenes/ResultsScene';
import { OptionsScene } from './scenes/OptionsScene';
import { input } from './game/input';

const game = new Phaser.Game({
  // ?canvas でキャンバス描画（GPU の無い自動テスト環境向け）
  type: location.search.includes('canvas') ? Phaser.CANVAS : Phaser.AUTO,
  parent: 'game',
  width: 1920,
  height: 1080,
  backgroundColor: '#07080a',
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  render: { antialias: true, powerPreference: 'high-performance' },
  fps: { target: 60 },
  input: { gamepad: false },
  scene: [BootScene, TitleScene, LobbyScene, BgScene, GameScene, HudScene, ResultsScene, OptionsScene],
});

// 自動テスト・デバッグ用
Object.assign(window, { __game: game, __input: input });
