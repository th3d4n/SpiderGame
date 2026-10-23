import { audio } from '../systems/AudioManager'
import type { InputManager } from '../core/InputManager'
import { h } from './theme'

// ─── Chapter-end card ─────────────────────────────────────────────────────────
// Shown once, after the ending story: the chapter title draws in, the run's
// numbers count up, and the player chooses to keep exploring the den/colony or
// go back to the title.  Keyboard-first (↑↓ / Enter / Space) and clickable.

export interface EndingStats { xp: number; weapons: number; clues: number; cluesTotal: number; brews: number; falls: number }

const STYLE = /* css */`
.nl-ending { position:absolute; inset:0; z-index: 245; display:flex; align-items:center; justify-content:center;
  background: radial-gradient(ellipse at 50% 45%, rgba(20,14,10,.55), rgba(4,3,2,.94) 75%); animation: nl-fade-in 1200ms ease both; }
.nl-ending.out { animation: nl-fade-out 420ms ease-in both; }
.nl-ending .wrap { width: 560px; display:flex; flex-direction:column; align-items:center; text-align:center; }
.nl-ending .eyebrow { font-size: 12px; font-weight: 700; letter-spacing: 6px; color: var(--nl-amber); text-transform: uppercase; animation: nl-up 700ms var(--nl-ease) 300ms both; }
.nl-ending .name { margin-top: 10px; font-family: var(--nl-display); font-weight: 600; font-size: 52px; color: #f6eee2; line-height: 1.02;
  text-shadow: 0 6px 30px rgba(0,0,0,.6); animation: nl-up 900ms var(--nl-ease) 500ms both; }
.nl-ending .name em { font-style: italic; font-weight: 500; color: var(--nl-amber); }
.nl-ending .rule { width: 0; height: 1px; margin: 22px 0 20px; background: linear-gradient(90deg, transparent, rgba(232,214,186,.55), transparent);
  animation: nl-end-rule 1100ms var(--nl-ease) 800ms both; }
@keyframes nl-end-rule { to { width: 420px } }
.nl-ending .stats { display:grid; grid-template-columns: repeat(5, 1fr); gap: 8px; width: 100%; animation: nl-up 800ms var(--nl-ease) 1100ms both; }
.nl-ending .stat { padding: 10px 6px; }
.nl-ending .stat b { display:block; font-family: var(--nl-mono); font-size: 22px; color: var(--nl-text); }
.nl-ending .stat span { font-size: 10px; letter-spacing: 1.4px; text-transform: uppercase; color: var(--nl-dim); }
.nl-ending .next { margin: 22px 0 26px; font-size: 13.5px; color: var(--nl-dim); font-style: italic; animation: nl-fade-in 900ms ease 1500ms both; }
.nl-ending .items { display:flex; gap: 10px; animation: nl-up 800ms var(--nl-ease) 1700ms both; }
.nl-ending .nl-btn { min-width: 0; padding: 10px 22px; }
`

export class EndingCard {
  private root: HTMLDivElement
  private btns: HTMLElement[] = []
  private sel = 0
  private shownAt = 0
  isOpen = false
  onKeepExploring?: () => void
  onTitle?: () => void

  constructor(container: HTMLElement) {
    if (!document.getElementById('nl-ending-style')) {
      const st = h('style'); st.id = 'nl-ending-style'; st.textContent = STYLE
      document.head.appendChild(st)
    }
    this.root = h('div', 'nl-ending') as HTMLDivElement
    this.root.style.display = 'none'
    container.appendChild(this.root)
  }

  show(s: EndingStats): void {
    this.root.className = 'nl-ending'
    this.root.innerHTML = ''
    const wrap = h('div', 'wrap')
    wrap.appendChild(h('div', 'eyebrow', 'Chapter One — Complete'))
    const name = h('div', 'name'); name.innerHTML = 'The Ant Tunnels<br><em>Home, for now</em>'
    wrap.appendChild(name)
    wrap.appendChild(h('div', 'rule'))
    const stats = h('div', 'stats')
    const cells: Array<[number, string, string?]> = [
      [s.xp, 'XP'], [s.weapons, 'Weapons'], [s.clues, 'Clues', `/${s.cluesTotal}`], [s.brews, 'Brews'], [s.falls, 'Falls'],
    ]
    const nums: Array<[HTMLElement, number, string]> = []
    for (const [v, label, suffix] of cells) {
      const c = h('div', 'stat hud-card')
      const b = h('b', undefined, '0')
      c.append(b, h('span', undefined, label))
      stats.appendChild(c)
      nums.push([b, v, suffix ?? ''])
    }
    wrap.appendChild(stats)
    wrap.appendChild(h('div', 'next', 'Chapter Two — The Hive — is still being woven.'))
    const items = h('div', 'items')
    this.btns = [
      this.button('Keep exploring', () => this.choose(() => this.onKeepExploring?.())),
      this.button('Return to title', () => this.choose(() => this.onTitle?.())),
    ]
    items.append(...this.btns)
    wrap.appendChild(items)
    this.root.appendChild(wrap)
    this.root.style.display = 'flex'
    this.isOpen = true
    this.sel = 0
    this.paint()
    this.shownAt = performance.now()

    // Count the numbers up once the stats row has drawn in
    const t0 = performance.now() + 1200
    const tick = () => {
      if (!this.isOpen) return
      const t = Math.min(1, Math.max(0, (performance.now() - t0) / 900))
      const e = 1 - (1 - t) ** 3
      for (const [el, v, suffix] of nums) el.textContent = `${Math.round(v * e)}${suffix}`
      if (t < 1) requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
    audio.play('celeb_swell')
  }

  update(input: InputManager): void {
    if (!this.isOpen || performance.now() - this.shownAt < 1800) return   // let it land first
    if (input.justDown('ArrowLeft') || input.justDown('ArrowUp'))    { this.sel = 0; this.paint(); audio.play('ui_hover') }
    if (input.justDown('ArrowRight') || input.justDown('ArrowDown')) { this.sel = 1; this.paint(); audio.play('ui_hover') }
    if (input.justDown('Enter') || input.justDown('Space')) this.btns[this.sel]?.click()
  }

  private button(label: string, fn: () => void): HTMLElement {
    const b = h('div', 'nl-btn', label)
    b.addEventListener('click', fn)
    b.addEventListener('mouseenter', () => { const i = this.btns.indexOf(b); if (i >= 0 && i !== this.sel) { this.sel = i; this.paint() } })
    return b
  }

  private paint(): void { this.btns.forEach((b, i) => b.classList.toggle('sel', i === this.sel)) }

  private choose(fn: () => void): void {
    if (!this.isOpen) return
    audio.play('ui_click')
    this.isOpen = false
    this.root.classList.add('out')
    window.setTimeout(() => { this.root.style.display = 'none'; fn() }, 420)
  }
}
