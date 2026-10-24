import { audio } from '../systems/AudioManager'
import { h, richText } from './theme'

// ─── Thoughts ─────────────────────────────────────────────────────────────────
// Webbs' inner voice: short lines that type out along the bottom of the screen
// while you keep playing (nothing pauses).  Story beats, reactions to what he
// finds and in-character "not yet" messages all come through here, so the
// story is told in the moment instead of only in the big text cards.
// Lines queue; each holds long enough to read, then fades.  While a menu or
// story card owns the screen the current line waits (setVisible).

const CPS        = 38      // typing speed, characters per second
const HOLD_BASE  = 1.6     // s a line stays after it's typed …
const HOLD_PER   = 0.045   // … plus this per character
const FADE_S     = 0.45
const GAP_S      = 0.35    // between queued lines

const STYLE = /* css */`
#nl-thought { position:absolute; left:50%; bottom: 58px; transform: translateX(-50%); max-width: 640px; z-index: 58;
  display:flex; align-items:flex-start; gap: 10px; padding: 9px 18px 10px 12px; pointer-events:none; opacity:0;
  transition: opacity ${FADE_S}s ease; }
#nl-thought.on { opacity:1; }
#nl-thought .who { flex: none; margin-top: 3px; font-size: 9.5px; font-weight: 700; letter-spacing: 2px; text-transform: uppercase; color: var(--nl-silk); }
#nl-thought .say { font-family: var(--nl-display); font-style: italic; font-size: 17px; line-height: 1.45; color: #f3ead9;
  text-shadow: 0 2px 10px rgba(0,0,0,.7); white-space: pre-line; }
#nl-thought .say .rest { opacity: 0; }
`

interface Line { text: string; hold: number }

export class Thoughts {
  private el:   HTMLElement
  private say:  HTMLElement
  private queue: Line[] = []
  private cur: Line | null = null
  private t = 0          // time on the current line
  private gap = 0
  private shown = 0      // characters revealed
  private visible = true

  constructor() {
    if (!document.getElementById('nl-thought-style')) {
      const st = h('style'); st.id = 'nl-thought-style'; st.textContent = STYLE
      document.head.appendChild(st)
    }
    this.el = h('div', 'hud-card'); this.el.id = 'nl-thought'
    this.el.appendChild(h('span', 'who', 'Webbs'))
    this.say = h('span', 'say'); this.el.appendChild(this.say)
    document.getElementById('hud-overlay')!.appendChild(this.el)
  }

  // Queue one or more lines (each string is one line).  `now` drops whatever
  // was waiting so a reaction isn't stuck behind old chatter.
  think(lines: string | string[], opts: { now?: boolean; hold?: number } = {}): void {
    const list = Array.isArray(lines) ? lines : [lines]
    if (opts.now) { this.queue = []; if (this.cur) { this.cur = null; this.el.classList.remove('on') } }
    for (const text of list) this.queue.push({ text, hold: opts.hold ?? HOLD_BASE + text.length * HOLD_PER })
  }

  get busy(): boolean { return !!this.cur || this.queue.length > 0 }

  clear(): void { this.queue = []; this.cur = null; this.el.classList.remove('on') }

  setVisible(on: boolean): void {
    if (on === this.visible) return
    this.visible = on
    this.el.style.visibility = on ? '' : 'hidden'
  }

  update(dt: number): void {
    if (!this.visible) return
    if (!this.cur) {
      if (this.gap > 0) { this.gap -= dt; return }
      const next = this.queue.shift()
      if (!next) return
      this.cur = next; this.t = 0; this.shown = 0
      this.el.classList.add('on')
      audio.play('ui_text_advance', undefined, undefined, { volume: 0.5 })
    }
    const line = this.cur
    this.t += dt
    const n = Math.min(line.text.length, Math.floor(this.t * CPS))
    if (n !== this.shown) {
      this.shown = n
      // Untyped text stays in the layout (invisible) so the box doesn't grow as it types
      this.say.innerHTML = richText(line.text.slice(0, n)) + `<span class="rest">${richText(line.text.slice(n))}</span>`
    }
    const typed = line.text.length / CPS
    if (this.t > typed + line.hold) this.el.classList.remove('on')
    if (this.t > typed + line.hold + FADE_S) { this.cur = null; this.gap = GAP_S }
  }
}
