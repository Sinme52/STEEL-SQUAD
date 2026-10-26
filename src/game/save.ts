import type { RoleId } from './data';

// 設定と武器の熟練度を localStorage に保存する（Electron 版でもそのまま動く）
const KEY = 'steel-squad-save-v1';

export interface Settings {
  lang: 'ja' | 'en';
  master: number;
  music: number;
  sfx: number;
  shake: boolean;
  fullscreen: boolean;
}

interface SaveData {
  settings: Settings;
  weaponXp: Record<RoleId, number>;
  clears: number;
  bestTime: number | null;
}

const defaults: SaveData = {
  settings: { lang: 'ja', master: 0.8, music: 0.6, sfx: 0.8, shake: true, fullscreen: true },
  weaponXp: { assault: 0, striker: 0, scout: 0, support: 0 },
  clears: 0,
  bestTime: null,
};

function load(): SaveData {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const d = JSON.parse(raw);
      return {
        ...defaults, ...d,
        settings: { ...defaults.settings, ...d.settings },
        weaponXp: { ...defaults.weaponXp, ...d.weaponXp },
      };
    }
  } catch {
    // 保存領域が使えない環境でも遊べるようにする
  }
  return structuredClone(defaults);
}

export const save: SaveData = load();
export const settings = save.settings;

export function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(save));
  } catch {
    // 無視
  }
}
