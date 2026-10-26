// ヘッドレスブラウザで起動して、スクリーンショットを撮る簡易テスト。
//   node tools/playtest.cjs [url] [outDir]
const { chromium } = require('playwright');
const path = require('path');

const url = process.argv[2] || 'http://localhost:5173/?canvas';
const out = process.argv[3] || 'playtest-out';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  require('fs').mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  const shot = (name) => page.screenshot({ path: path.join(out, name + '.png') });
  const key = async (k, ms = 120) => { await page.keyboard.down(k); await sleep(ms); await page.keyboard.up(k); await sleep(350); };
  const scene = (js) => page.evaluate(`(() => { const g = window.__game.scene.getScene('Game'); ${js} })()`);

  const waitScene = (k) => page.waitForFunction((k) => window.__game && window.__game.scene.isActive(k), k, { timeout: 20000 });
  await page.goto(url);
  await waitScene('Title');
  await sleep(1500);
  await shot('01_title');
  await key('Space');
  await sleep(500);
  await shot('02_menu');
  await key('Space'); // 出撃
  await waitScene('Lobby');
  await sleep(300);
  await key('Space'); // 1P 参加（キーボード1）
  await key('KeyD'); // 役割変更
  await key('ShiftRight'); // 2P 参加（キーボード2）
  await sleep(300);
  await shot('03_lobby');
  await key('Space'); // 1P 準備完了
  await key('ShiftRight'); // 2P 準備完了
  await key('Space'); // 出撃
  await waitScene('Game');
  await sleep(2500);
  await shot('04_game_start');
  // 前進しながら射撃
  await page.keyboard.down('KeyD');
  await page.keyboard.down('KeyJ');
  await page.keyboard.down('ArrowRight');
  await page.keyboard.down('Numpad1');
  for (let i = 0; i < 6; i++) {
    await sleep(1500);
    if (i === 2) await key('Space', 400);
    await shot(`05_advance_${i}`);
  }
  for (const k of ['KeyD', 'KeyJ', 'ArrowRight', 'Numpad1']) await page.keyboard.up(k);
  const state = await scene(`return { objective: g.objective, enemies: g.enemies.length, players: g.players.map(p => ({ st: p.state, x: Math.round(p.activeBody()?.x || 0), hp: p.mech && Math.round(p.mech.hp) })) }`);
  console.log(JSON.stringify(state));
  console.log('errors:', errors.slice(0, 10));
  await browser.close();
})();
