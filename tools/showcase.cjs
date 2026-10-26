// WebGL で 1920x1080 のスクリーンショットを撮る（Steam のスクリーンショット用）。
//   node tools/showcase.cjs [url] [outDir]
const { chromium } = require('playwright');
const path = require('path');

const url = process.argv[2] || 'http://localhost:5173/';
const out = process.argv[3] || 'steam/screenshots';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  require('fs').mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  const shot = (name) => page.screenshot({ path: path.join(out, name + '.png') });
  const G = (js) => page.evaluate(`(() => { const g = window.__game.scene.getScene('Game'); ${js} })()`);
  await page.goto(url);
  await page.waitForFunction(() => window.__game && window.__game.scene.isActive('Title'), null, { timeout: 60000 });
  await sleep(4000);
  await page.keyboard.press('Space');
  await sleep(3000);
  await shot('01_title');
  await page.evaluate(() => {
    const gm = window.__game;
    gm.scene.stop('Title');
    gm.scene.start('Game', { squad: [
      { device: 'kb1', role: 'assault' }, { device: 'kb2', role: 'striker' },
      { device: 'pad0', role: 'scout' }, { device: 'pad1', role: 'support' },
    ] });
  });
  await page.waitForFunction(() => window.__game.scene.isActive('Game'), null, { timeout: 60000 });
  // 戦闘場面: 敵を前に並べて全員で撃つ
  const pose = (x, extra = '') => G(`
    for (const p of g.players) { const b = p.mech.body; b.x = ${x} + p.index * 95; b.y = 900; b.vx = 0; }
    g.camCenter.x = ${x} + 400; ${extra}`);
  await pose(3000, `[0,1].forEach(i => g.wavesDone.add(i));`);
  await sleep(12000);
  await page.keyboard.down('KeyJ'); await page.keyboard.down('Numpad1');
  await page.keyboard.down('KeyK');
  await sleep(6000);
  await shot('02_battle');
  await page.keyboard.up('KeyK');
  await page.keyboard.press('Numpad2');
  await sleep(5000);
  await shot('03_missiles');
  await page.keyboard.up('KeyJ'); await page.keyboard.up('Numpad1');
  // ゲート
  await G(`for (const e of [...g.enemies]) e.damage(1e6, null); [2,3,4].forEach(i => g.wavesDone.add(i));`);
  await pose(5150);
  await sleep(8000);
  await page.keyboard.press('KeyL');
  await sleep(2500);
  await G(`const p = g.players[0]; if (p.pilot) { p.pilot.body.x = 5560; p.pilot.body.y = 1000; }`);
  await sleep(3000);
  await shot('04_gate');
  // ボス
  await G(`for (const e of [...g.enemies]) e.damage(1e6, null); [6,7].forEach(i => g.wavesDone.add(i)); g.gateOpen = true;
    const p0 = g.players[0]; if (p0.pilot) p0.board();`);
  await pose(9300);
  await sleep(25000);
  await page.keyboard.down('KeyJ'); await page.keyboard.down('Numpad1');
  await sleep(8000);
  await shot('05_boss');
  await G(`if (g.boss) g.boss.hp = g.boss.maxHp * 0.25;`);
  await sleep(10000);
  await shot('06_boss_p3');
  await browser.close();
})();
