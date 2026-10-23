import { h, MATERIAL_INFO, materialSvg } from './theme'

// ─── Loot feed ────────────────────────────────────────────────────────────────
// Bottom-left stack of what you just picked up.  Material keys ("SilkThread")
// render with their proper name and glyph; repeats of the same item within the
// hold window MERGE into one card with a running count instead of stacking.

const HOLD_MS   = 2600
const FADE_MS   = 300
const MAX_CARDS = 5

interface Card {
  el:     HTMLDivElement
  key:    string
  count:  number | null   // numeric "×N" amounts merge; other subtitles don't
  countEl: HTMLElement | null
  timer:  number          // ms remaining before fade starts
  fading: boolean
}

export class PickupNotification3D {
  private container: HTMLElement
  private cards:     Card[] = []

  constructor() {
    this.container = document.getElementById('pickup-notifications')!
  }

  notify(title: string, subtitle: string, color = '#aaaacc'): void {
    const qty = /^×\s*(\d+)$/.exec(subtitle.trim())
    const amount = qty ? Number(qty[1]) : null

    // Merge with a live card for the same item
    const live = this.cards.find(c => c.key === title && !c.fading && c.count !== null && amount !== null)
    if (live && amount !== null && live.countEl) {
      live.count = (live.count ?? 0) + amount
      live.countEl.textContent = `×${live.count}`
      live.timer = HOLD_MS
      live.el.classList.remove('bump'); void live.el.offsetWidth; live.el.classList.add('bump')
      return
    }

    if (this.cards.length >= MAX_CARDS) {
      const oldest = this.cards.shift()!
      oldest.el.remove()
    }

    const mat  = MATERIAL_INFO[title]
    const tint = mat?.color ?? color
    const el = h('div', 'nl-loot hud-card') as HTMLDivElement
    el.style.borderLeft = `3px solid ${tint}`

    const sw = h('div', 'swatch')
    sw.style.background = `${tint}22`
    sw.innerHTML = mat ? materialSvg(title, 18) : `<svg width="14" height="14" viewBox="-7 -7 14 14"><path d="M0,-6 L6,0 L0,6 L-6,0 Z" fill="${tint}"/></svg>`
    el.appendChild(sw)

    const text = h('div')
    text.appendChild(h('div', 't', mat?.name ?? title))
    if (subtitle && amount === null) text.appendChild(h('div', 's', subtitle))
    else text.appendChild(h('div', 's', mat ? 'material' : 'picked up'))
    el.appendChild(text)

    let countEl: HTMLElement | null = null
    if (amount !== null) {
      countEl = h('div', 'n', `×${amount}`)
      countEl.style.color = tint
      el.appendChild(countEl)
    }

    this.container.appendChild(el)
    this.cards.push({ el, key: title, count: amount, countEl, timer: HOLD_MS, fading: false })
  }

  // Call once per frame with delta in seconds
  update(delta: number): void {
    const dtMs = delta * 1000
    for (let i = this.cards.length - 1; i >= 0; i--) {
      const card = this.cards[i]
      card.timer -= dtMs
      if (!card.fading && card.timer <= 0) {
        card.fading = true
        card.el.classList.add('out')
        window.setTimeout(() => {
          card.el.remove()
          const idx = this.cards.indexOf(card)
          if (idx >= 0) this.cards.splice(idx, 1)
        }, FADE_MS)
      }
    }
  }
}
