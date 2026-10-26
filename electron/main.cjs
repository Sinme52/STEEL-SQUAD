// Steam 配布用のデスクトップ版。dist/ のビルド結果をウィンドウで開く。
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

// Steamworks（任意）。steamworks.js を入れて steam_appid.txt を置くと実績が有効になる
let steam = null;
try {
  steam = require('steamworks.js').init();
} catch {
  steam = null;
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1600,
    height: 900,
    backgroundColor: '#07080a',
    autoHideMenuBar: true,
    fullscreen: !process.argv.includes('--windowed'),
    webPreferences: { preload: path.join(__dirname, 'preload.cjs') },
  });
  win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
}

ipcMain.on('quit', () => app.quit());
ipcMain.on('set-fullscreen', (e, on) => BrowserWindow.fromWebContents(e.sender)?.setFullScreen(!!on));
ipcMain.on('achievement', (_e, id) => {
  try {
    steam?.achievement.activate(String(id));
  } catch {
    // Steam が起動していない場合などは無視
  }
});

// 効果音・BGMを最初の操作の前から鳴らせるようにする
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
// ゲームパッドの入力をウィンドウ非アクティブ時も止めない
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
