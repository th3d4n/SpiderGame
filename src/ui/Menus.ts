import { audio } from '../systems/AudioManager'
import type { InputManager } from '../core/InputManager'
import { h } from './theme'

// ─── Title + pause menus ──────────────────────────────────────────────────────
// Both are keyboard-first (↑↓ choose, Enter/Space confirm) and mouse-friendly.
// The title menu sits over the live den, which the camera slowly drifts across.

interface MenuItem { label: string; enabled: boolean; action: () => void; detail?: () => string }

const STYLE = /* css */`
.nl-title-menu { position:absolute; inset:0; z-index: 250; display:flex; flex-direction:column; justify-content:center; padding-left: 120px;
  background:
    linear-gradient(90deg, rgba(6,5,4,.92) 0%, rgba(6,5,4,.72) 38%, rgba(6,5,4,.15) 70%, rgba(6,5,4,.35) 100%),
    radial-gradient(ellipse at 70% 60%, transparent 30%, rgba(0,0,0,.55) 100%);
  animation: nl-fade-in 900ms ease both; }
.nl-title-menu.out { animation: nl-tm-out 520ms ease-in both; }
@keyframes nl-tm-out { to { opacity: 0; transform: scale(1.02) } }
.nl-title-menu .mark { width: 96px; height: 96px; margin-bottom: 14px; animation: nl-up 700ms var(--nl-ease) 150ms both; }
.nl-title-menu .mark path { stroke: var(--nl-silk); stroke-width: 2.2; fill: none; stroke-linecap: round; stroke-linejoin: round;
  stroke-dasharray: 220; stroke-dashoffset: 220; animation: nl-draw 1400ms var(--nl-ease) both; }
@keyframes nl-draw { to { stroke-dashoffset: 0 } }
.nl-title-menu .logo { font-family: var(--nl-display); font-weight: 700; font-size: 58px; line-height: .98; color: #f6eee2; letter-spacing: .5px;
  text-shadow: 0 6px 30px rgba(0,0,0,.6); animation: nl-up 800ms var(--nl-ease) 250ms both; }
.nl-title-menu .logo em { font-style: italic; font-weight: 500; color: var(--nl-amber); }
.nl-title-menu .tag { margin: 16px 0 44px; font-size: 14px; color: var(--nl-dim); letter-spacing: .4px; animation: nl-up 800ms var(--nl-ease) 400ms both; }
.nl-title-menu .items { display:flex; flex-direction:column; align-items:flex-start; gap: 4px; animation: nl-up 800ms var(--nl-ease) 550ms both; }
.nl-title-menu .nl-btn { justify-content:flex-start; padding-left: 18px; min-width: 300px; }
.nl-title-menu .foot { position:absolute; left: 120px; bottom: 40px; animation: nl-fade-in 900ms ease 900ms both; }

.nl-pause { position:absolute; inset:0; z-index: 240; display:flex; align-items:center; justify-content:center; }
.nl-pause .card { width: 420px; padding: 30px 30px 22px; display:flex; flex-direction:column; align-items:stretch; animation: nl-up 260ms var(--nl-ease) both; }
.nl-pause.out { animation: nl-fade-out 180ms ease-in both; }
.nl-pause .card .nl-title { font-size: 30px; text-align:center; margin: 4px 0 18px; }
.nl-pause .nl-btn { min-width: 0; font-size: 17px; justify-content: space-between; }
.nl-pause .nl-btn::before { display:none; }
.nl-pause .nl-btn .v { font-family: var(--nl-ui); font-size: 12px; color: var(--nl-dim); letter-spacing: 1px; }
.nl-pause .controls { display:grid; grid-template-columns: auto 1fr; gap: 8px 16px; align-items:center; margin: 6px 6px 10px; font-size: 12.5px; color: var(--nl-dim); }
.nl-pause .controls .nl-key { justify-self: end; }
`

function ensureStyle(): void {
  if (document.getElementById('nl-menus-style')) return
  const st = h('style'); st.id = 'nl-menus-style'; st.textContent = STYLE
  document.head.appendChild(st)
}

// Shared keyboard/mouse list behaviour
class MenuList {
  readonly el: HTMLElement
  private items: MenuItem[]
  private btns: HTMLElement[] = []
  private sel = 0

  constructor(items: MenuItem[]) {
    this.items = items
    this.el = h('div', 'items')
    this.build()
    this.sel = Math.max(0, items.findIndex(i => i.enabled))
    this.paint()
  }

  private build(): void {
    this.el.innerHTML = ''
    this.btns = this.items.map((it, i) => {
      const b = h('div', `nl-btn${it.enabled ? '' : ' off'}`)
      b.innerHTML = `<span>${it.label}</span>${it.detail ? `<span class="v">${it.detail()}</span>` : ''}`
      b.addEventListener('mouseenter', () => { if (it.enabled && this.sel !== i) { this.sel = i; this.paint(); audio.play('ui_hover') } })
      b.addEventListener('click', () => { if (it.enabled) { this.sel = i; this.confirm() } })
      this.el.appendChild(b)
      return b
    })
  }

  refreshDetails(): void {
    this.items.forEach((it, i) => {
      const v = this.btns[i].querySelector('.v')
      if (v && it.detail) v.textContent = it.detail()
    })
  }

  private paint(): void { this.btns.forEach((b, i) => b.classList.toggle('sel', i === this.sel)) }

  move(dir: number): void {
    for (let k = 0; k < this.items.length; k++) {
      this.sel = (this.sel + dir + this.items.length) % this.items.length
      if (this.items[this.sel].enabled) break
    }
    this.paint()
    audio.play('ui_hover')
  }

  confirm(): void {
    const it = this.items[this.sel]
    if (!it?.enabled) return
    audio.play('ui_click')
    it.action()
  }

  key(e: KeyboardEvent): boolean {
    if (e.code === 'ArrowUp'   || e.code === 'KeyW') { this.move(-1); return true }
    if (e.code === 'ArrowDown' || e.code === 'KeyS') { this.move(1);  return true }
    if (e.code === 'Enter' || e.code === 'Space' || e.code === 'NumpadEnter') { this.confirm(); return true }
    return false
  }
}

// ── Title menu ──────────────────────────────────────────────────────────────────

export class TitleMenu {
  readonly el: HTMLElement
  private list: MenuList
  private onKey = (e: KeyboardEvent) => { if (this.list.key(e)) e.preventDefault() }
  private done = false

  constructor(container: HTMLElement, opts: { hasSave: boolean; onNew: () => void; onContinue: () => void }) {
    ensureStyle()
    this.el = h('div', 'nl-title-menu')
    // Spider mark: body + eight drawn legs
    this.el.innerHTML = `
      <svg class="mark" viewBox="-50 -50 100 100">
        <path d="M0,-14 C9,-14 12,-6 12,2 C12,14 6,22 0,22 C-6,22 -12,14 -12,2 C-12,-6 -9,-14 0,-14 Z"/>
        <path d="M-9,-6 L-26,-22 L-40,-14"/><path d="M9,-6 L26,-22 L40,-14"/>
        <path d="M-11,0 L-30,-6 L-44,4"/><path d="M11,0 L30,-6 L44,4"/>
        <path d="M-11,6 L-28,14 L-40,30"/><path d="M11,6 L28,14 L40,30"/>
        <path d="M-8,12 L-20,28 L-24,44"/><path d="M8,12 L20,28 L24,44"/>
      </svg>
      <div class="logo">No Leg Left<br><em>to Stand On</em></div>
      <div class="tag">One small spider. Eight borrowed legs. A family to bring home.</div>`
    const items: MenuItem[] = []
    if (opts.hasSave) items.push({ label: 'Continue', enabled: true, action: () => this.finish(opts.onContinue) })
    items.push({ label: 'New Game', enabled: true, action: () => this.finish(opts.onNew) })
    this.list = new MenuList(items)
    this.el.appendChild(this.list.el)
    const foot = h('div', 'nl-hints foot')
    foot.innerHTML = '<span><span class="nl-key">↑</span><span class="nl-key">↓</span> choose</span><span><span class="nl-key">Enter</span> start</span>'
    this.el.appendChild(foot)
    container.appendChild(this.el)
    container.classList.add('hud-hidden')
    window.addEventListener('keydown', this.onKey)
  }

  private finish(cb: () => void): void {
    if (this.done) return
    this.done = true
    window.removeEventListener('keydown', this.onKey)
    this.el.classList.add('out')
    window.setTimeout(() => { this.el.style.display = 'none' }, 520)
    cb()
    // HUD returns unless the opening story (letterbox) has taken over
    window.setTimeout(() => {
      if (!document.querySelector('.nl-txt-story')?.checkVisibility?.()) this.el.parentElement?.classList.remove('hud-hidden')
    }, 0)
  }
}

// ── Pause menu ──────────────────────────────────────────────────────────────────

export class PauseMenu {
  private overlay: HTMLElement
  private root: HTMLElement
  private card: HTMLElement
  private list!: MenuList
  private showingControls = false
  private opts: { isMuted: () => boolean; toggleSound: () => void; quitToTitle: () => void }
  isOpen = false
  onClose?: () => void

  constructor(menuOverlay: HTMLElement, opts: { isMuted: () => boolean; toggleSound: () => void; quitToTitle: () => void }) {
    ensureStyle()
    this.opts = opts
    this.overlay = menuOverlay
    this.root = h('div', 'nl-pause')
    this.root.style.display = 'none'
    this.root.appendChild(h('div', 'nl-scrim'))
    this.card = h('div', 'nl-panel card')
    this.root.appendChild(this.card)
    menuOverlay.appendChild(this.root)
  }

  show(): void {
    this.showingControls = false
    this.renderMain()
    this.root.classList.remove('out')
    this.root.style.display = 'flex'
    this.overlay.style.display = 'block'
    this.isOpen = true
    audio.play('ui_click')
  }

  private renderMain(): void {
    this.card.innerHTML = ''
    this.card.appendChild(h('div', 'nl-eyebrow', 'Paused')).style.textAlign = 'center'
    this.card.appendChild(h('div', 'nl-title', 'Catch your breath'))
    this.list = new MenuList([
      { label: 'Resume', enabled: true, action: () => this.close() },
      { label: 'Controls', enabled: true, action: () => this.renderControls() },
      { label: 'Sound', enabled: true, detail: () => (this.opts.isMuted() ? 'OFF' : 'ON'),
        action: () => { this.opts.toggleSound(); this.list.refreshDetails() } },
      { label: 'Quit to title', enabled: true, action: () => this.opts.quitToTitle() },
    ])
    this.list.el.style.alignItems = 'stretch'
    this.card.appendChild(this.list.el)
    const foot = h('div', 'nl-hints'); foot.style.marginTop = '14px'
    foot.innerHTML = '<span><span class="nl-key">Esc</span> resume</span>'
    this.card.appendChild(foot)
  }

  private renderControls(): void {
    this.showingControls = true
    this.card.innerHTML = ''
    this.card.appendChild(h('div', 'nl-eyebrow', 'Controls')).style.textAlign = 'center'
    this.card.appendChild(h('div', 'nl-title', 'How Webbs moves'))
    const grid = h('div', 'controls')
    const rows: Array<[string, string]> = [
      ['WASD', 'Move'], ['Click', 'Use the active leg'], ['1–8', 'Use / pick a leg'], ['Q', 'Web line (again to release)'],
      ['Space', 'Dodge back'], ['E', 'Interact'], ['I', 'Equipment'], ['C · V · X', 'HP potion · tonic · max potion'],
      ['Wheel', 'Zoom'], ['Esc', 'Pause'],
    ]
    grid.innerHTML = rows.map(([k, t]) => `<span>${k.split(' · ').map(x => `<span class="nl-key">${x}</span>`).join('')}</span><span>${t}</span>`).join('')
    this.card.appendChild(grid)
    const foot = h('div', 'nl-hints'); foot.style.marginTop = '8px'
    foot.innerHTML = '<span><span class="nl-key">Esc</span> back</span>'
    this.card.appendChild(foot)
  }

  // Driven from the game loop while open (same pattern as the other menus)
  update(input: InputManager): void {
    if (!this.isOpen) return
    if (input.justDown('Escape')) {
      if (this.showingControls) { this.showingControls = false; this.renderMain() } else this.close()
      return
    }
    if (this.showingControls) return
    if (input.justDown('ArrowUp') || input.justDown('KeyW'))   this.list.move(-1)
    if (input.justDown('ArrowDown') || input.justDown('KeyS')) this.list.move(1)
    if (input.justDown('Enter') || input.justDown('Space'))    this.list.confirm()
  }

  close(): void {
    if (!this.isOpen) return
    this.root.classList.add('out')
    audio.play('ui_back')
    window.setTimeout(() => {
      this.root.style.display = 'none'
      this.overlay.style.display = 'none'
      this.isOpen = false
      this.onClose?.()
    }, 180)
  }
}
