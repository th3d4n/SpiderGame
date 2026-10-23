import { h } from './theme'
import {
  ConsumableType, CONSUMABLE_INFO, CONSUMABLE_NAMES, MAX_POT_DURATION,
  type ConsumableSystem,
} from '../systems/ConsumableSystem'

// ─── Brews: icon + HUD quick-use strip ───────────────────────────────────────
// A stoppered silk-wrapped vial, tinted per brew.  The strip sits above the
// health bars: one card per quick-use key (C heal, V tonic, X max) with the
// count, dimmed when empty, and a draining timer while a tonic / max potion runs.

export function consumableSvg(type: ConsumableType, size = 24): string {
  const c = CONSUMABLE_INFO[type].color
  return `<svg width="${size}" height="${size}" viewBox="-12 -12 24 24" aria-hidden="true">
    <path d="M-3,-9 L3,-9 L3,-4 C7,-2 8,2 8,4 C8,8 5,10 0,10 C-5,10 -8,8 -8,4 C-8,2 -7,-2 -3,-4 Z"
      fill="${c}" fill-opacity=".85" stroke="#1a120c" stroke-width="1.2" stroke-linejoin="round"/>
    <path d="M-6,3 C-3,5 3,5 6,3" fill="none" stroke="rgba(255,255,255,.45)" stroke-width="1.2" stroke-linecap="round"/>
    <rect x="-3.8" y="-11.5" width="7.6" height="3.2" rx="1" fill="#c9a77c" stroke="#1a120c" stroke-width="1"/>
    <path d="M-3,-6 L3,-5 M-3,-4.6 L3,-3.6" stroke="rgba(240,230,210,.7)" stroke-width=".8"/>
  </svg>`
}

const STYLE = /* css */`
#nl-quick { position:absolute; left: 18px; bottom: 128px; display:flex; gap:6px; pointer-events:none; }
#nl-quick .q { position:relative; display:flex; align-items:center; gap:5px; padding: 4px 9px 4px 5px; font-size: 11px; transition: opacity 200ms, transform 200ms var(--nl-ease-back); }
#nl-quick .q.empty { opacity: .38; }
#nl-quick .q b { font-family: var(--nl-mono); color: var(--nl-text); min-width: 1ch; }
#nl-quick .q.bump { animation: nl-pop 380ms var(--nl-ease-back); }
#nl-quick .q .t { position:absolute; left: 6px; right: 6px; bottom: 2px; height: 2px; border-radius: 2px; background: currentColor; transform-origin: left; transform: scaleX(0); opacity:.85; }
`

interface Slot { el: HTMLElement; count: HTMLElement; timer: HTMLElement; icon: HTMLElement; last: number; lastIcon: string }

export class QuickItems {
  private slots: Record<'C' | 'V' | 'X', Slot>
  onUse?: (key: 'C' | 'V' | 'X') => void   // tap on a card (touch)

  constructor() {
    if (!document.getElementById('nl-quick-style')) {
      const st = h('style'); st.id = 'nl-quick-style'; st.textContent = STYLE
      document.head.appendChild(st)
    }
    const root = h('div'); root.id = 'nl-quick'
    const make = (key: 'C' | 'V' | 'X', type: ConsumableType): Slot => {
      const el = h('div', 'q hud-card empty')
      el.title = CONSUMABLE_NAMES[type]
      el.style.color = CONSUMABLE_INFO[type].color
      const icon = h('span'); icon.innerHTML = consumableSvg(type, 20)
      const count = h('b', undefined, '0')
      el.append(h('span', 'nl-key', key), icon, count)
      const timer = h('span', 't'); el.appendChild(timer)
      el.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); this.onUse?.(key) })
      root.appendChild(el)
      return { el, count, timer, icon, last: -1, lastIcon: type }
    }
    this.slots = {
      C: make('C', ConsumableType.HpPotion),
      V: make('V', ConsumableType.StaminaTonicI),
      X: make('X', ConsumableType.MaxPotion),
    }
    document.getElementById('hud-overlay')!.appendChild(root)
  }

  // Cheap per-frame sync: DOM only changes when a value does.
  update(c: ConsumableSystem): void {
    this.sync(this.slots.C, c.getAmount(ConsumableType.HpPotion), ConsumableType.HpPotion)
    // The V card shows the tonic V would drink next (III > II > I)
    const bestTonic = c.getAmount(ConsumableType.StaminaTonicIII) > 0 ? ConsumableType.StaminaTonicIII
                    : c.getAmount(ConsumableType.StaminaTonicII)  > 0 ? ConsumableType.StaminaTonicII
                    : ConsumableType.StaminaTonicI
    this.sync(this.slots.V, c.tonicCount(), bestTonic)
    this.sync(this.slots.X, c.getAmount(ConsumableType.MaxPotion), ConsumableType.MaxPotion)
    this.slots.V.timer.style.transform = `scaleX(${Math.min(1, c.tonicRemainingMs() / 60_000)})`
    this.slots.X.timer.style.transform = `scaleX(${c.maxRemainingMs() / MAX_POT_DURATION})`
  }

  private sync(s: Slot, n: number, type: ConsumableType): void {
    if (s.lastIcon !== type) {
      s.lastIcon = type
      s.icon.innerHTML = consumableSvg(type, 20)
      s.el.style.color = CONSUMABLE_INFO[type].color
      s.el.title = CONSUMABLE_NAMES[type]
    }
    if (n === s.last) return
    if (n > s.last && s.last >= 0) { s.el.classList.remove('bump'); void s.el.offsetWidth; s.el.classList.add('bump') }
    s.last = n
    s.count.textContent = String(n)
    s.el.classList.toggle('empty', n === 0)
  }
}
