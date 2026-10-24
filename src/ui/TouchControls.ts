import type { InputManager } from '../core/InputManager'
import { h } from './theme'
import { weaponIconSvg } from './WeaponIcon3D'
import { weaponColor } from './weaponInfo'
import { WeaponType } from '../systems/WeaponSystem'

// ─── Touch controls ───────────────────────────────────────────────────────────
// Everything feeds the existing InputManager, so gameplay reads the same keys:
//   • floating stick (left half) → input.setStick() — analog, camera-relative
//     in Webbs3D exactly like WASD
//   • Attack → 'TouchAttack' (main auto-aims it), Web → KeyQ, Dodge → Space,
//     Interact → KeyE (shown only when something is in reach)
//   • top bar: Pause → Escape, Equip → KeyI; the weapon ring and brew strip
//     become tappable (main wires those)
//   • menus: a Back button presses Escape; story text and reward cards take a
//     tap anywhere (→ Enter = next) and a Skip chip (→ M)
// Touch mode turns on with the first touch and off again on any key press or
// real mouse movement (hybrid laptops).  `?touch=1` forces it for testing.
// Coordinates are converted into the 1280×720 logical layout, because the
// game container is CSS-scaled to fit the window.

export type TouchMenuMode = 'play' | 'panel' | 'text' | 'card' | 'hidden'

export interface TouchFrame {
  mode:     TouchMenuMode
  weapon:   WeaponType     // drawn on the Attack button
  interact: string         // '' hides the Interact button
  web:      boolean        // web launcher owned
}

const STICK_R    = 62    // logical px of knob travel

// Keep receiving a finger's moves even if it slides off the element (can throw
// for pointers the browser no longer tracks — harmless, so swallowed)
function capture(el: HTMLElement, id: number): void {
  try { el.setPointerCapture(id) } catch { /* pointer already gone */ }
}
const DEADZONE   = 0.14

const STYLE = /* css */`
#nl-touch { position:absolute; inset:0; z-index: 180; pointer-events:none; display:none; }
#game-container.nl-touch #nl-touch { display:block; }
#nl-touch .zone { position:absolute; left:0; bottom:0; width: 46%; height: 72%; pointer-events:auto; touch-action:none; }
#nl-touch .stick { position:absolute; width: 148px; height: 148px; margin: -74px 0 0 -74px; border-radius:50%; display:none;
  background: radial-gradient(circle, rgba(255,240,220,.06), rgba(255,240,220,.02) 70%); box-shadow: inset 0 0 0 2px rgba(232,214,186,.22); }
#nl-touch .stick.on { display:block; }
#nl-touch .knob { position:absolute; left:50%; top:50%; width: 58px; height: 58px; margin: -29px 0 0 -29px; border-radius:50%;
  background: rgba(232,214,186,.22); box-shadow: inset 0 0 0 2px rgba(232,214,186,.5), 0 6px 18px rgba(0,0,0,.4); }
#nl-touch .tb { position:absolute; pointer-events:auto; touch-action:none; border-radius:50%; display:grid; place-items:center;
  background: rgba(20,15,12,.62); box-shadow: inset 0 0 0 2px rgba(232,214,186,.28), 0 8px 22px rgba(0,0,0,.45);
  color: var(--nl-text); font-family: var(--nl-ui); font-weight:700; font-size: 12px; letter-spacing: 1px; text-transform: uppercase;
  -webkit-tap-highlight-color: transparent; user-select:none; transition: transform 80ms, background 120ms; }
#nl-touch .tb.down { transform: scale(.92); background: rgba(240,162,74,.35); }
#nl-touch .tb .lbl { position:absolute; bottom: -18px; font-size: 10px; color: var(--nl-dim); text-shadow: 0 1px 4px #000; }
/* sizes are logical px — a 844×390 phone shows the game at ~0.54×, so 88 → ~48 CSS px (≥ 44 pt targets) */
#nl-touch .attack { right: 34px; bottom: 34px; width: 132px; height: 132px; box-shadow: inset 0 0 0 3px rgba(255,207,138,.55), 0 10px 26px rgba(0,0,0,.5); }
#nl-touch .dodge  { right: 188px; bottom: 24px; width: 88px; height: 88px; }
#nl-touch .web    { right: 56px;  bottom: 194px; width: 88px; height: 88px; }
#nl-touch .use    { right: 192px; bottom: 140px; width: 84px; height: 84px; display:none; box-shadow: inset 0 0 0 2px rgba(168,216,255,.6), 0 8px 22px rgba(0,0,0,.45); color: var(--nl-silk); }
#nl-touch .use.on { display:grid; animation: nl-pop 260ms var(--nl-ease-back) both; }
#nl-touch .web.off { opacity:.35; }
#nl-touch .top { position:absolute; top: 6px; width: 76px; height: 76px; border-radius: 16px; font-size: 24px; }
#nl-touch .pause { right: 150px; }
#nl-touch .equip { right: 234px; }
#nl-touch .back { position:absolute; top: 14px; left: 16px; width:auto; height: 46px; padding: 0 18px; border-radius: 12px; display:none; pointer-events:auto; z-index: 300; }
#nl-touch .catch { position:absolute; inset:0; display:none; pointer-events:auto; touch-action:none; z-index: 290; }
#nl-touch .skip { position:absolute; top: 14px; right: 16px; width:auto; height: 40px; padding: 0 16px; border-radius: 12px; display:none; z-index: 300; }
#nl-touch.m-play .play-only { display:grid; }
#nl-touch:not(.m-play) .play-only, #nl-touch:not(.m-play) .zone { display:none !important; }
#nl-touch.m-panel .back, #nl-touch.m-text .back { display:grid; }
#nl-touch.m-text .catch, #nl-touch.m-card .catch { display:block; }
#nl-touch.m-text .skip { display:grid; }
/* outside the scaled container, so it covers the real screen */
#nl-rotate { position:fixed; inset:0; z-index: 1000; display:none; place-items:center; text-align:center; padding: 30px;
  background: #0b0908; color: #f6eee2; font-family: var(--nl-display), Georgia, serif; font-size: 22px; }
#nl-rotate small { display:block; margin-top: 10px; font-family: var(--nl-ui); font-size: 13px; color: var(--nl-dim); }

/* HUD re-layout so thumbs never cover it */
#game-container.nl-touch #controls-hint { display:none; }
#game-container.nl-touch #bars-group { top: 12px; bottom: auto; left: 14px; min-width: 210px; padding: 9px 12px 8px; }
#game-container.nl-touch #nl-quick { top: 104px; bottom: auto; left: 14px; pointer-events:auto; }
#game-container.nl-touch #nl-quick .q { padding: 8px 12px 8px 8px; }
#game-container.nl-touch #pickup-notifications { top: 152px; bottom: auto; flex-direction: column; }
#game-container.nl-touch #weapon-ring-wrap { top: 58px; right: 0; bottom: auto; transform: scale(.78); transform-origin: top right; }
#game-container.nl-touch #weapon-ring { pointer-events:auto; }
#game-container.nl-touch #xp-counter { top: 22px; right: 322px; }
#game-container.nl-touch #ammo-panel { bottom: auto; top: 200px; right: 18px; }
#game-container.nl-touch, #game-container.nl-touch * { -webkit-touch-callout: none; -webkit-user-select: none; user-select: none; }
`

export class TouchControls {
  private input: InputManager
  private container: HTMLElement
  private root: HTMLElement
  private stickEl: HTMLElement
  private knob: HTMLElement
  private zone: HTMLElement
  private attackBtn: HTMLElement
  private webBtn: HTMLElement
  private useBtn: HTMLElement
  private rotateEl: HTMLElement
  private stickId: number | null = null
  private stickOX = 0
  private stickOY = 0
  private lastWeapon: WeaponType | null = null
  private mode: TouchMenuMode = 'hidden'
  private triedFullscreen = false
  private pinch = new Map<number, { x: number; y: number }>()   // fingers not on a control
  private pinchDist = 0
  active = false
  onPinch?: (ratio: number) => void   // > 1 = fingers spreading (zoom in)

  constructor(container: HTMLElement, input: InputManager) {
    this.input = input
    this.container = container
    if (!document.getElementById('nl-touch-style')) {
      const st = h('style'); st.id = 'nl-touch-style'; st.textContent = STYLE
      document.head.appendChild(st)
    }
    this.root = h('div'); this.root.id = 'nl-touch'
    this.zone = h('div', 'zone')
    this.stickEl = h('div', 'stick'); this.knob = h('div', 'knob'); this.stickEl.appendChild(this.knob)
    this.zone.appendChild(this.stickEl)
    this.root.appendChild(this.zone)

    this.attackBtn = this.button('tb attack play-only', '', 'TouchAttack')
    const dodge = this.button('tb dodge play-only', 'Dodge', 'Space')
    this.webBtn = this.button('tb web play-only', 'Web', 'KeyQ')
    this.useBtn = this.button('tb use', 'Use', 'KeyE')
    const pause = this.button('tb top pause play-only', '❚❚', 'Escape')
    const equip = this.button('tb top equip play-only', '◈', 'KeyI')
    pause.title = 'Menu'; equip.title = 'Equip'
    const back  = this.button('tb back', '‹ Back', 'Escape')
    const skip  = this.button('tb skip', 'Skip', 'KeyM')   // matches the text box: Space = next, M = skip
    const catcher = h('div', 'catch')
    catcher.addEventListener('pointerdown', (e) => { e.preventDefault(); this.input.press('Enter') })
    catcher.addEventListener('pointerup',   () => this.input.release('Enter'))
    this.root.append(catcher, this.attackBtn, dodge, this.webBtn, this.useBtn, pause, equip, back, skip)

    this.rotateEl = h('div'); this.rotateEl.id = 'nl-rotate'
    this.rotateEl.innerHTML = '<div>Turn your device sideways<small>No Leg Left to Stand On plays in landscape.</small></div>'
    document.body.appendChild(this.rotateEl)
    container.appendChild(this.root)

    this.bindStick()
    this.bindPinch()
    this.bindModeSwitching()
    const orient = () => this.updateRotatePrompt()
    window.addEventListener('resize', orient)
    window.addEventListener('orientationchange', orient)
    if (new URLSearchParams(location.search).get('touch') === '1') this.setActive(true)
  }

  // Per frame from the game loop.
  update(f: TouchFrame): void {
    if (!this.active) return
    if (f.mode !== this.mode) {
      this.mode = f.mode
      this.root.className = `m-${f.mode}`
      if (f.mode !== 'play') this.releaseStick()
    }
    if (f.weapon !== this.lastWeapon) {
      this.lastWeapon = f.weapon
      const empty = f.weapon === WeaponType.Empty
      this.attackBtn.innerHTML = empty ? '<span>Attack</span>' : weaponIconSvg(f.weapon, weaponColor(f.weapon), 54)
    }
    this.webBtn.classList.toggle('off', !f.web)
    const showUse = f.mode === 'play' && !!f.interact
    this.useBtn.classList.toggle('on', showUse)
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  // Logical (1280×720) coordinates of a pointer, through the CSS scale
  private logical(e: PointerEvent): { x: number; y: number } {
    const r = this.container.getBoundingClientRect()
    return { x: (e.clientX - r.left) * (1280 / r.width), y: (e.clientY - r.top) * (720 / r.height) }
  }

  private button(cls: string, label: string, code: string): HTMLElement {
    const b = h('div', cls, label)
    let pid: number | null = null
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault(); e.stopPropagation()
      pid = e.pointerId
      capture(b, e.pointerId)
      b.classList.add('down')
      this.input.press(code)
    })
    const up = (e: PointerEvent) => {
      if (pid !== e.pointerId) return
      pid = null
      b.classList.remove('down')
      this.input.release(code)
    }
    b.addEventListener('pointerup', up)
    b.addEventListener('pointercancel', up)
    return b
  }

  private bindStick(): void {
    this.zone.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' || this.stickId !== null) return
      e.preventDefault()
      this.stickId = e.pointerId
      capture(this.zone, e.pointerId)
      const p = this.logical(e)
      const zr = this.zone.getBoundingClientRect(), cr = this.container.getBoundingClientRect()
      // stick centre in zone-local logical px (the zone sits at the container's bottom-left)
      this.stickOX = p.x - (zr.left - cr.left) * (1280 / cr.width)
      this.stickOY = p.y - (zr.top - cr.top) * (720 / cr.height)
      this.stickEl.style.left = `${this.stickOX}px`
      this.stickEl.style.top  = `${this.stickOY}px`
      this.stickEl.classList.add('on')
      this.knob.style.transform = ''
      this.input.setStick(0, 0)
    })
    this.zone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.stickId) return
      const p = this.logical(e)
      const zr = this.zone.getBoundingClientRect(), cr = this.container.getBoundingClientRect()
      let dx = p.x - (zr.left - cr.left) * (1280 / cr.width) - this.stickOX
      let dy = p.y - (zr.top - cr.top) * (720 / cr.height) - this.stickOY
      const len = Math.hypot(dx, dy)
      if (len > STICK_R) { dx *= STICK_R / len; dy *= STICK_R / len }
      this.knob.style.transform = `translate(${dx}px, ${dy}px)`
      let mx = dx / STICK_R, my = dy / STICK_R
      const m = Math.hypot(mx, my)
      if (m < DEADZONE) { mx = my = 0 }
      else { const k = (m - DEADZONE) / (1 - DEADZONE) / m; mx *= k; my *= k }   // rescale past the deadzone
      this.input.setStick(mx, my)
    })
    const end = (e: PointerEvent) => { if (e.pointerId === this.stickId) this.releaseStick() }
    this.zone.addEventListener('pointerup', end)
    this.zone.addEventListener('pointercancel', end)
  }

  // Two fingers that both landed off the controls (stick zone, buttons) zoom the
  // view; any other combination (stick + Attack…) is left alone.
  private bindPinch(): void {
    const onControl = (t: EventTarget | null) =>
      t instanceof Element && !!t.closest('#nl-touch .tb, #nl-touch .zone, #nl-touch .catch, #weapon-ring, #nl-quick')
    window.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'touch' || !this.active || this.mode !== 'play' || onControl(e.target)) return
      e.preventDefault()   // no emulated mouse click → no stray attack from a pinch finger
      this.pinch.set(e.pointerId, { x: e.clientX, y: e.clientY })
      if (this.pinch.size === 2) this.pinchDist = this.spread()
    })
    window.addEventListener('pointermove', (e) => {
      const p = this.pinch.get(e.pointerId)
      if (!p) return
      p.x = e.clientX; p.y = e.clientY
      if (this.pinch.size !== 2 || this.pinchDist <= 0) return
      const d = this.spread()
      if (d > 0) { this.onPinch?.(d / this.pinchDist); this.pinchDist = d }
    })
    const end = (e: PointerEvent) => { if (this.pinch.delete(e.pointerId)) this.pinchDist = 0 }
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', end)
  }

  private spread(): number {
    const [a, b] = [...this.pinch.values()]
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0
  }

  private releaseStick(): void {
    this.stickId = null
    this.stickEl.classList.remove('on')
    this.input.clearStick()
  }

  private bindModeSwitching(): void {
    window.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'touch') return
      if (!this.active) this.setActive(true)
      // First touch is a user gesture: go fullscreen + landscape where allowed
      if (!this.triedFullscreen) {
        this.triedFullscreen = true
        const de = document.documentElement as HTMLElement & { requestFullscreen?: (o?: object) => Promise<void> }
        de.requestFullscreen?.({ navigationUI: 'hide' }).then(() => {
          const o = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }
          return o?.lock?.('landscape')
        }).catch(() => { /* not supported (e.g. iPhone Safari) — the rotate prompt covers it */ })
      }
    }, { capture: true })
    window.addEventListener('keydown', () => { if (this.active) this.setActive(false) })
    let mx = -1, my = -1
    window.addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'mouse' || !this.active) return
      if (mx >= 0 && Math.hypot(e.clientX - mx, e.clientY - my) > 12) this.setActive(false)
      mx = e.clientX; my = e.clientY
    })
  }

  private setActive(on: boolean): void {
    this.active = on
    this.input.touchActive = on
    this.container.classList.toggle('nl-touch', on)
    // No pinch-zoom, pull-to-refresh or rubber-band scrolling under the thumbs
    document.documentElement.style.touchAction = on ? 'none' : ''
    document.documentElement.style.overscrollBehavior = on ? 'none' : ''
    document.body.style.touchAction = on ? 'none' : ''
    if (!on) this.releaseStick()
    this.mode = 'hidden'   // re-apply on next update()
    this.updateRotatePrompt()
  }

  private updateRotatePrompt(): void {
    const portrait = window.innerHeight > window.innerWidth
    this.rotateEl.style.display = this.active && portrait ? 'grid' : 'none'
  }
}
