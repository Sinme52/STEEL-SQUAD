// 各場面（4人出撃・ゲート・撃破と修理・ボス・リザルト）へ直接飛んで確認する。
//   node tools/scenario.cjs [url] [outDir]
const { chromium } = require('playwright');
const path = require('path');

const url = process.argv[2] || 'http://localhost:5173/?canvas';
const out = process.argv[3] || 'scenario-out';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  require('fs').mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.stack || e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  const shot = (name) => page.screenshot({ path: path.join(out, name + '.png') });
  const hold = async (keys, ms) => { for (const k of keys) await page.keyboard.down(k); await sleep(ms); for (const k of keys) await page.keyboard.up(k); };
  const tap = (k) => hold([k], 150).then(() => sleep(250));
  const G = (js) => page.evaluate(`(() => { const g = window.__game.scene.getScene('Game'); ${js} })()`);
  const log = async (label) => console.log(label, JSON.stringify(await G(`return {
    obj: g.objective, fps: Math.round(window.__game.loop.actualFps), t: Math.round(g.missionTime), reinf: g.reinforcements,
    enemies: g.enemies.map(e => e.constructor.name + ':' + Math.round(e.hp)).join(' '),
    players: g.players.map(p => p.role + '/' + p.state + '@' + Math.round(p.activeBody()?.x || 0) + ' hp' + Math.round(p.mech?.hp ?? -1) + ' k' + p.stats.kills),
  }`)));

  await page.goto(url);
  await page.waitForFunction(() => window.__game && window.__game.scene.isActive('Title'));
  await sleep(500);
  // 4人で出撃（3P・4P はゲームパッド扱いで入力なし）
  await page.evaluate(() => {
    const gm = window.__game;
    gm.scene.stop('Title');
    gm.scene.start('Game', { squad: [
      { device: 'kb1', role: 'assault' }, { device: 'kb2', role: 'support' },
      { device: 'pad0', role: 'striker' }, { device: 'pad1', role: 'scout' },
    ] });
  });
  await page.waitForFunction(() => window.__game.scene.isActive('Game'));
  await sleep(3500);
  await shot('A1_squad');
  // 盾を構えて射撃
  await hold(['KeyK', 'KeyJ', 'KeyW'], 1200);
  await shot('A2_shield_fire');
  await log('A');

  // ---- ゲート
    await G(`for (const p of g.players) { p.mech.body.x = 5200 + p.index * 70; p.mech.body.y = 900; } g.camCenter.x = 5300; [0,1,2,3,4].forEach(i => g.wavesDone.add(i));`);
  await G(`for (const e of [...g.enemies]) e.damage(1e6, null);`);
  await sleep(2500);
  await shot('B1_gate');
  await tap('KeyL'); // 1P 降機
  await sleep(600);
  await shot('B2_ejected');
  // 通気口をくぐってスイッチの前まで歩く
  await page.keyboard.down('KeyD');
  for (let i = 0; i < 60; i++) {
    const x = await G(`return g.players[0].pilot ? g.players[0].pilot.body.x : 0;`);
    if (x >= 5760) break;
    await sleep(100);
  }
  await page.keyboard.up('KeyD');
  await log('B-pilot');
  await shot('B3_vent');
  await tap('KeyL'); // スイッチ
  await sleep(1800);
  await shot('B4_gate_open');
  await log('B-open');
  await sleep(3000);
  await shot('B5_ambush');
  await log('B-ambush');
  // パイロットを機体に戻す
  await G(`for (const e of [...g.enemies]) e.damage(1e6, null); const p = g.players[0]; if (p.pilot) { p.pilot.body.x = p.mech.body.x; p.pilot.body.y = p.mech.body.y; }`);
  await sleep(300);
  await tap('KeyL');
  await log('B-board');

  // ---- 撃破と修理（2P はサポート）
  await G(`g.players[0].mech.damage(9999, null, 0, 0);`);
  await sleep(800);
  await shot('C1_wreck');
  await G(`const w = g.players[0].mech; const s = g.players[1].mech; s.body.x = w.body.x + 120; s.body.y = w.body.y - 10; s.facing = -1;`);
  await hold(['Numpad2'], 2500); // 修理ビーム
  await shot('C2_repair');
  await log('C-repair');

  // ---- ボス
  await G(`for (const e of [...g.enemies]) e.damage(1e6, null); [6,7].forEach(i => g.wavesDone.add(i)); g.gateOpen = true; for (const p of g.players) { const b = p.activeBody(); if (b) { b.x = 9300 + p.index * 80; b.y = 900; } } g.camCenter.x = 9500;`);
  await sleep(6000);
  await shot('D1_boss');
  await log('D-boss');
  await page.keyboard.down('KeyJ');
  await page.keyboard.down('Numpad1');
  await sleep(4000);
  await shot('D2_boss_fight');
  await G(`if (g.boss) g.boss.hp = g.boss.maxHp * 0.25;`);
  await sleep(5000);
  await shot('D3_boss_p3');
  await log('D-p3');
  await G(`if (g.boss) g.boss.hp = 5;`);
  await sleep(4000);
  await shot('D4_boss_dying');
  await page.keyboard.up('KeyJ');
  await page.keyboard.up('Numpad1');
  await page.waitForFunction(() => window.__game.scene.isActive('Results'), null, { timeout: 30000 }).catch(() => {});
  await sleep(2500);
  await shot('E1_results');
  console.log('errors:', errors.slice(0, 10));
  await browser.close();
})();
