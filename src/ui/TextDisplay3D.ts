import type { InputManager } from '../core/InputManager'
import { audio } from '../systems/AudioManager'
import { h, richText } from './theme'

// ─── Text display ─────────────────────────────────────────────────────────────
// Story pages, notes, clues and tutorials.
//  • 'panel' (default): a note card with an accent ribbon.
//  • 'story': cinematic — letterbox bars, large serif text over the dimmed world.
// Text types on (Space / Enter finishes the line, then goes to the next page); M skips.
// "[Q]"-style tokens render as keycaps.

export interface TextDisplayData {
  pages:        string[]
  title?:       string
  accentColor?: string  // CSS color string
  style?:       'panel' | 'story'
}

const CPS    = 55     // characters per second
const OUT_MS = 220

const STYLE = /* css */`
.nl-txt { position:absolute; inset:0; display:flex; align-items:center; justify-content:center; z-index:155; }
.nl-txt.out { animation: nl-fade-out ${OUT_MS}ms ease-in both; }
.nl-txt-card { width: 520px; padding: 30px 38px 22px; animation: nl-up 320ms var(--nl-ease) both; }
.nl-txt-card .ribbon { display:flex; align-items:center; gap:12px; margin-bottom:18px; }
.nl-txt-card .ribbon::before, .nl-txt-card .ribbon::after { content:''; flex:1; height:1px; background: linear-gradient(90deg, transparent, var(--a)); }
.nl-txt-card .ribbon::after { background: linear-gradient(90deg, var(--a), transparent); }
.nl-txt-card .ribbon span { color: var(--a); white-space: nowrap; }
.nl-txt-card .page { font-size: 15px; line-height: 1.75; min-height: 104px; text-align: center; color: var(--nl-text); }
.nl-txt-story .page { font-family: var(--nl-display); font-size: 27px; line-height: 1.55; max-width: 760px; text-align: center; color: #f6eee2;
  text-shadow: 0 2px 18px rgba(0,0,0,.8); min-height: 170px; }
.nl-txt-story .eyebrow { position:absolute; top: 96px; left: 0; right: 0; text-align: center; color: var(--a); }
.nl-txt-story .bar { position:absolute; left:0; right:0; height: 84px; background: #050403; }
.nl-txt-story .bar.top { top:0; animation: nl-bar-top 500ms var(--nl-ease) both; }
.nl-txt-story .bar.bot { bottom:0; animation: nl-bar-bot 500ms var(--nl-ease) both; }
@keyframes nl-bar-top { from { transform: translateY(-100%) } to { transform: none } }
@keyframes nl-bar-bot { from { transform: translateY(100%) } to { transform: none } }
.nl-txt-story .foot { position:absolute; bottom: 104px; left:0; right:0; display:flex; flex-direction:column; align-items:center; gap:12px; }
.nl-txt .dots { display:flex; gap:7px; justify-content:center; margin: 16px 0 12px; }
.nl-txt .dots i { width:7px; height:7px; border-radius:50%; background: rgba(232,214,186,.2); transition: background 200ms, transform 200ms; }
.nl-txt .dots i.on { background: var(--a); transform: scale(1.25); }
.nl-txt .caret { display:inline-block; width: .5em; color: var(--a); animation: nl-blink 1s steps(1) infinite; }
.nl-txt .page.swap { animation: nl-up 260ms var(--nl-ease) both; }
`

export class TextDisplay3D {
  private overlay: HTMLElement
  private root:    HTMLDivElement
  private pageEl!: HTMLElement
  private dotsEl!: HTMLElement
  private pages: string[] = []
  private pageIndex = 0
  private pageStartMs = 0
  private shown = 0        // characters currently revealed
  private closing = false
  private closeTimer = 0

  isOpen  = false
  private shownAt = 0
  onClose?: () => void

  constructor(menuOverlay: HTMLElement) {
    this.overlay = menuOverlay
    this.root = h('div', 'nl-txt') as HTMLDivElement
    this.root.style.display = 'none'
    if (!document.getElementById('nl-txt-style')) {
      const st = h('style'); st.id = 'nl-txt-style'; st.textContent = STYLE
      document.head.appendChild(st)
    }
    menuOverlay.appendChild(this.root)
  }

  show(data: TextDisplayData): void {
    window.clearTimeout(this.closeTimer)   // a new text can open during the previous fade-out
    this.shownAt = performance.now()
    this.root.classList.remove('out')
    this.pages   = data.pages
    this.closing = false
    const accent = data.accentColor ?? '#a8d8ff'
    const story  = data.style === 'story'
    this.root.className = `nl-txt ${story ? 'nl-txt-story' : ''}`
    this.root.style.setProperty('--a', accent)
    this.root.innerHTML = ''

    const hints = '<span><span class="nl-key">Space</span> next</span><span><span class="nl-key">M</span> skip</span>'
    if (story) {
      const scrim = h('div', 'nl-scrim')
      scrim.style.background = 'rgba(5,4,3,.72)'
      this.root.appendChild(scrim)
      this.root.appendChild(h('div', 'bar top'))
      this.root.appendChild(h('div', 'bar bot'))
      if (data.title) this.root.appendChild(h('div', 'nl-eyebrow eyebrow', data.title.replace(/^[—\s-]+|[—\s-]+$/g, '')))
      this.pageEl = h('div', 'page')
      this.root.appendChild(this.pageEl)
      const foot = h('div', 'foot')
      this.dotsEl = h('div', 'dots')
      foot.appendChild(this.dotsEl)
      const hintEl = h('div', 'nl-hints'); hintEl.innerHTML = hints
      foot.appendChild(hintEl)
      this.root.appendChild(foot)
    } else {
      this.root.appendChild(h('div', 'nl-scrim'))
      const card = h('div', 'nl-panel nl-txt-card')
      if (data.title) {
        const rib = h('div', 'ribbon')
        rib.appendChild(h('span', 'nl-eyebrow', data.title.replace(/^[—\s-]+|[—\s-]+$/g, '')))
        card.appendChild(rib)
      }
      this.pageEl = h('div', 'page')
      card.appendChild(this.pageEl)
      this.dotsEl = h('div', 'dots')
      card.appendChild(this.dotsEl)
      const hintEl = h('div', 'nl-hints'); hintEl.innerHTML = hints
      card.appendChild(hintEl)
      this.root.appendChild(card)
    }

    this.root.style.display = 'flex'
    this.overlay.style.display = 'block'
    this.isOpen = true
    // Cinematic pages own the whole frame — tuck the HUD away
    document.getElementById('game-container')?.classList.toggle('hud-hidden', story)
    this.showPage(0)
  }

  update(input: InputManager): void {
    if (!this.isOpen || this.closing) return
    this.tickTyping()
    // The key that opened this (Space/Enter on the title, E on a card) is still
    // "just down" this frame — ignore input briefly so it can't skip the text.
    if (performance.now() - this.shownAt < 250) return
    if (input.justDown('Space') || input.justDown('Enter')) {
      const full = this.pages[this.pageIndex]
      if (this.shown < full.length) { this.shown = full.length; this.render() }       // finish the line
      else if (this.pageIndex < this.pages.length - 1) { this.showPage(this.pageIndex + 1); audio.play('ui_text_advance') }
      else this.close()
    }
    if (input.justDown('KeyM')) this.close()
  }

  close(): void {
    if (!this.isOpen || this.closing) return
    this.closing = true
    this.root.classList.add('out')
    this.closeTimer = window.setTimeout(() => {
      this.root.style.display = 'none'
      this.root.classList.remove('out')
      this.overlay.style.display = 'none'
      document.getElementById('game-container')?.classList.remove('hud-hidden')
      this.isOpen  = false
      this.closing = false
      this.onClose?.()
    }, OUT_MS)
  }

  private showPage(i: number): void {
    this.pageIndex   = i
    this.pageStartMs = performance.now()
    this.shown       = 0
    this.dotsEl.innerHTML = this.pages.length > 1 ? this.pages.map((_, k) => `<i class="${k === i ? 'on' : ''}"></i>`).join('') : ''
    this.pageEl.classList.remove('swap'); void this.pageEl.offsetWidth; this.pageEl.classList.add('swap')
    this.render()
  }

  private tickTyping(): void {
    const full = this.pages[this.pageIndex]
    if (this.shown >= full.length) return
    const n = Math.floor(((performance.now() - this.pageStartMs) / 1000) * CPS)
    if (n !== this.shown) { this.shown = Math.min(full.length, n); this.render() }
  }

  private render(): void {
    const full = this.pages[this.pageIndex]
    let cut = this.shown
    // never split a [key] token mid-way
    const open = full.lastIndexOf('[', cut - 1)
    if (open !== -1 && full.indexOf(']', open) >= cut) cut = full.indexOf(']', open) + 1
    const done = cut >= full.length
    this.pageEl.innerHTML = richText(full.slice(0, cut)) + (done ? '' : '<span class="caret">▍</span>')
  }
}
