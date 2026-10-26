// Steam の実績。デスクトップ版（Electron）では preload 経由で Steamworks に渡す。
// ブラウザ版では何もしない。
export type AchievementId = 'FIRST_CLEAR' | 'GATE_OPENED' | 'FIELD_REPAIR' | 'NO_CASUALTIES' | 'FULL_SQUAD' | 'WEAPON_MASTER';

const done = new Set<AchievementId>();

export function unlock(id: AchievementId) {
  if (done.has(id)) return;
  done.add(id);
  (window as unknown as { desktop?: { achievement?(id: string): void } }).desktop?.achievement?.(id);
}
