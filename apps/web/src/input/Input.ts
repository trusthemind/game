import { emptyIntent, type ActorIntent } from '@ashfall/engine';

export type Action =
  | 'interact'
  | 'reload'
  | 'inventory'
  | 'flashlight'
  | 'crouch'
  | 'heal'
  | 'eat'
  | 'slot1'
  | 'slot2'
  | 'slot3'
  | 'menu'
  | 'perf'
  | 'map';

const KEYMAP: Record<string, Action> = {
  KeyE: 'interact',
  KeyR: 'reload',
  Tab: 'inventory',
  KeyI: 'inventory',
  KeyF: 'flashlight',
  KeyC: 'crouch',
  KeyQ: 'heal',
  KeyV: 'eat',
  Digit1: 'slot1',
  Digit2: 'slot2',
  Digit3: 'slot3',
  Escape: 'menu',
  F3: 'perf',
  Backquote: 'perf',
  KeyM: 'map',
};

/**
 * Keyboard + mouse → ActorIntent. Edge-triggered actions are queued and drained once per frame.
 * Works with a MacBook trackpad: left click fires, two-finger scroll zooms.
 */
export class Input {
  readonly intent: ActorIntent = emptyIntent();
  mouseNdc = { x: 0, y: 0 };
  wheel = 0;
  enabled = true;
  private keys = new Set<string>();
  private queue: Action[] = [];
  private mouseDown = false;
  private aimDown = false;
  private crouch = false;
  private disposers: (() => void)[] = [];

  constructor(private el: HTMLElement) {
    const on = <K extends keyof WindowEventMap>(t: K, fn: (e: WindowEventMap[K]) => void, opts?: AddEventListenerOptions) => {
      window.addEventListener(t, fn, opts);
      this.disposers.push(() => window.removeEventListener(t, fn));
    };
    on('keydown', (e) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      const a = KEYMAP[e.code];
      if (a) {
        e.preventDefault();
        if (!e.repeat) this.queue.push(a);
      }
      this.keys.add(e.code);
    });
    on('keyup', (e) => this.keys.delete(e.code));
    on('blur', () => {
      this.keys.clear();
      this.mouseDown = false;
      this.aimDown = false;
    });
    on('mousemove', (e) => {
      const r = this.el.getBoundingClientRect();
      this.mouseNdc.x = ((e.clientX - r.left) / r.width) * 2 - 1;
      this.mouseNdc.y = -((e.clientY - r.top) / r.height) * 2 + 1;
    });
    const down = (e: MouseEvent) => {
      if (!this.enabled) return;
      if (e.button === 2) this.aimDown = true;
      if (e.button !== 0) return;
      this.mouseDown = true;
      this.intent.firePressed = true;
    };
    el.addEventListener('mousedown', down);
    this.disposers.push(() => el.removeEventListener('mousedown', down));
    on('mouseup', (e) => {
      if (e.button === 0) this.mouseDown = false;
      if (e.button === 2) this.aimDown = false;
    });
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      this.wheel += e.deltaY;
    };
    el.addEventListener('wheel', wheel, { passive: false });
    this.disposers.push(() => el.removeEventListener('wheel', wheel));
    const ctx = (e: Event) => e.preventDefault();
    el.addEventListener('contextmenu', ctx);
    this.disposers.push(() => el.removeEventListener('contextmenu', ctx));
  }

  /** Refresh continuous inputs into `intent`. */
  poll(): ActorIntent {
    const k = this.keys;
    const it = this.intent;
    if (!this.enabled) {
      it.moveX = it.moveY = 0;
      it.fire = false;
      it.sprint = false;
      return it;
    }
    it.moveX = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    it.moveY = (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0) - (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0);
    it.sprint = k.has('ShiftLeft') || k.has('ShiftRight');
    it.crouch = this.crouch;
    it.fire = this.mouseDown;
    // Hold right mouse (or ctrl+click on a trackpad) to aim.
    it.aim = this.aimDown || k.has('ControlLeft') || k.has('AltLeft');
    return it;
  }

  toggleCrouch(): void {
    this.crouch = !this.crouch;
  }

  drain(): Action[] {
    const q = this.queue;
    this.queue = [];
    return q;
  }

  releaseAll(): void {
    this.keys.clear();
    this.mouseDown = false;
    this.aimDown = false;
  }

  dispose(): void {
    for (const d of this.disposers) d();
  }
}
