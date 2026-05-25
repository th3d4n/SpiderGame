const HOLD_MS   = 1800
const FADE_MS   = 300
const MAX_CARDS = 5

interface Card {
  el:      HTMLDivElement
  timer:   number   // ms remaining before fade starts
  fading:  boolean
}

export class PickupNotification3D {
  private container: HTMLElement
  private cards:     Card[] = []

  constructor() {
    this.container = document.getElementById('pickup-notifications')!
  }

  notify(title: string, subtitle: string, color = '#aaaacc'): void {
    if (this.cards.length >= MAX_CARDS) {
      const oldest = this.cards.shift()!
      oldest.el.remove()
    }

    const el = document.createElement('div')
    el.style.cssText = [
      `border-left:2px solid ${color};`,
      'background:rgba(13,13,26,0.88);',
      'padding:6px 14px; width:240px;',
      'font-family:monospace; font-size:11px;',
      'opacity:0; transition:opacity 150ms ease;',
    ].join('')

    const titleEl = document.createElement('div')
    titleEl.style.cssText = `color:${color}; letter-spacing:1px;`
    titleEl.textContent = title

    if (subtitle) {
      const subEl = document.createElement('div')
      subEl.style.cssText = 'color:#445566; font-size:10px; margin-top:2px;'
      subEl.textContent = subtitle
      el.appendChild(titleEl)
      el.appendChild(subEl)
    } else {
      el.appendChild(titleEl)
    }

    this.container.appendChild(el)
    // Force reflow so the transition fires
    void el.offsetWidth
    el.style.opacity = '1'

    const card: Card = { el, timer: HOLD_MS, fading: false }
    this.cards.push(card)
  }

  // Call once per frame with delta in seconds
  update(delta: number): void {
    const dtMs = delta * 1000
    for (let i = this.cards.length - 1; i >= 0; i--) {
      const card = this.cards[i]
      card.timer -= dtMs
      if (!card.fading && card.timer <= 0) {
        card.fading = true
        card.el.style.transition = `opacity ${FADE_MS}ms ease`
        card.el.style.opacity = '0'
        setTimeout(() => {
          card.el.remove()
          const idx = this.cards.indexOf(card)
          if (idx >= 0) this.cards.splice(idx, 1)
        }, FADE_MS)
      }
    }
  }
}
