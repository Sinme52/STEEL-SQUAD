// キーボード2系統とゲームパッド4台を、同じ形の入力にまとめる。

export type DeviceId = 'kb1' | 'kb2' | 'pad0' | 'pad1' | 'pad2' | 'pad3';
export const DEVICES: DeviceId[] = ['kb1', 'kb2', 'pad0', 'pad1', 'pad2', 'pad3'];

export interface PadState {
  moveX: number;
  moveY: number;
  aimAbs: number | null; // 右スティックの向き（ラジアン、画面座標）
  jump: boolean;
  boost: boolean;
  fire: boolean;
  skill: boolean;
  interact: boolean;
  pause: boolean;
  back: boolean;
  left: boolean;
  right: boolean;
  up: boolean;
  down: boolean;
}

export interface PlayerInput extends PadState {
  jumpPressed: boolean;
  boostPressed: boolean;
  skillPressed: boolean;
  interactPressed: boolean;
  pausePressed: boolean;
  backPressed: boolean;
  leftPressed: boolean;
  rightPressed: boolean;
  upPressed: boolean;
  downPressed: boolean;
  firePressed: boolean;
}

const KB: Record<'kb1' | 'kb2', Record<string, string[]>> = {
  kb1: {
    left: ['KeyA'], right: ['KeyD'], up: ['KeyW'], down: ['KeyS'],
    jump: ['Space'], boost: ['ShiftLeft'], fire: ['KeyJ'], skill: ['KeyK'], interact: ['KeyL'],
    pause: ['Escape'], back: ['Escape', 'Backspace'],
  },
  kb2: {
    left: ['ArrowLeft'], right: ['ArrowRight'], up: ['ArrowUp'], down: ['ArrowDown'],
    jump: ['Numpad0', 'ShiftRight'], boost: ['Quote', 'Numpad4'], fire: ['Numpad1', 'Comma'], skill: ['Numpad2', 'Period'],
    interact: ['Numpad3', 'Slash'], pause: ['Enter', 'NumpadEnter'], back: ['Delete', 'NumpadDecimal'],
  },
};

const empty = (): PadState => ({
  moveX: 0, moveY: 0, aimAbs: null, jump: false, boost: false, fire: false, skill: false, interact: false,
  pause: false, back: false, left: false, right: false, up: false, down: false,
});

class InputManager {
  private keys = new Set<string>();
  private tapped = new Set<string>(); // 前回の poll 以降に押されたキー（1フレームより短い押下も拾う）
  private prev = new Map<DeviceId, PadState>();
  private cur = new Map<DeviceId, PadState>();
  private startPressed = false;
  private enterDown = false;
  private prevEnter = false;
  lastFrame = -1;

  constructor() {
    window.addEventListener('keydown', (e) => {
      this.keys.add(e.code);
      this.tapped.add(e.code);
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  /** 毎フレーム1回呼ぶ（同じフレームで何度呼んでも1回だけ更新する） */
  poll(frame: number) {
    if (frame === this.lastFrame) return;
    this.lastFrame = frame;
    for (const d of DEVICES) {
      this.prev.set(d, this.cur.get(d) ?? empty());
      this.cur.set(d, this.read(d));
    }
    this.prevEnter = this.enterDown;
    this.enterDown = this.down('Enter') || this.down('NumpadEnter');
    this.startPressed = this.enterDown && !this.prevEnter;
    this.tapped.clear();
  }

  private down(code: string) {
    return this.keys.has(code) || this.tapped.has(code);
  }

  private read(d: DeviceId): PadState {
    const s = empty();
    if (d === 'kb1' || d === 'kb2') {
      const map = KB[d];
      const k = (n: string) => map[n].some((c) => this.down(c));
      s.left = k('left'); s.right = k('right'); s.up = k('up'); s.down = k('down');
      s.moveX = (s.right ? 1 : 0) - (s.left ? 1 : 0);
      s.moveY = (s.down ? 1 : 0) - (s.up ? 1 : 0);
      s.jump = k('jump'); s.boost = k('boost'); s.fire = k('fire'); s.skill = k('skill'); s.interact = k('interact');
      s.pause = k('pause'); s.back = k('back');
      return s;
    }
    const idx = Number(d.slice(3));
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const p = pads[idx];
    if (!p || !p.connected) return s;
    const b = (i: number) => !!p.buttons[i] && (p.buttons[i].pressed || p.buttons[i].value > 0.4);
    const ax = (i: number) => {
      const v = p.axes[i] ?? 0;
      return Math.abs(v) < 0.25 ? 0 : v;
    };
    s.moveX = ax(0) || ((b(15) ? 1 : 0) - (b(14) ? 1 : 0));
    s.moveY = ax(1) || ((b(13) ? 1 : 0) - (b(12) ? 1 : 0));
    s.left = s.moveX < -0.5; s.right = s.moveX > 0.5; s.up = s.moveY < -0.5; s.down = s.moveY > 0.5;
    const rx = p.axes[2] ?? 0, ry = p.axes[3] ?? 0;
    if (Math.hypot(rx, ry) > 0.45) s.aimAbs = Math.atan2(ry, rx);
    s.jump = b(0); s.boost = b(4) || b(10); s.interact = b(1); s.fire = b(2) || b(7); s.skill = b(3) || b(5) || b(6);
    s.pause = b(9); s.back = b(1) || b(8);
    return s;
  }

  get(d: DeviceId): PlayerInput {
    const c = this.cur.get(d) ?? empty();
    const p = this.prev.get(d) ?? empty();
    return {
      ...c,
      jumpPressed: c.jump && !p.jump,
      boostPressed: c.boost && !p.boost,
      skillPressed: c.skill && !p.skill,
      interactPressed: c.interact && !p.interact,
      pausePressed: c.pause && !p.pause,
      backPressed: c.back && !p.back,
      leftPressed: c.left && !p.left,
      rightPressed: c.right && !p.right,
      upPressed: c.up && !p.up,
      downPressed: c.down && !p.down,
      firePressed: c.fire && !p.fire,
    };
  }

  /** メニュー用: どの機器でもよい決定・戻る・上下左右 */
  menu() {
    const r = { confirm: null as DeviceId | null, back: false, up: false, down: false, left: false, right: false, start: this.startPressed };
    for (const d of DEVICES) {
      const s = this.get(d);
      if ((s.jumpPressed || s.firePressed) && !r.confirm) r.confirm = d;
      if (s.backPressed) r.back = true;
      if (s.upPressed) r.up = true;
      if (s.downPressed) r.down = true;
      if (s.leftPressed) r.left = true;
      if (s.rightPressed) r.right = true;
      if (s.pausePressed && d.startsWith('pad')) r.start = true;
    }
    if (this.startPressed && !r.confirm) r.confirm = 'kb2';
    return r;
  }

  padConnected(i: number) {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    return !!pads[i]?.connected;
  }
}

export const input = new InputManager();
