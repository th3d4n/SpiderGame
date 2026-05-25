import type { Webbs3D } from '../entities/Webbs3D'
import { WEAPON_COLORS } from '../config/WeaponData'

const SLOT_RING_R = 55
const SLOT_R     = 14
const SLOTS      = 8
const SVG_NS     = 'http://www.w3.org/2000/svg'

export class HudSystem {
  private hpFill:      HTMLElement
  private stamFill:    HTMLElement
  private energyFill:  HTMLElement
  private slotFills:   SVGCircleElement[] = []
  private slotLabels:  SVGTextElement[]   = []
  private bossHpWrap:    HTMLElement
  private bossHpLabel:   HTMLElement
  private bossHpFill:    HTMLElement
  private bossMsgEl:     HTMLElement
  private interactHint:  HTMLElement
  private bossMsgTimer = 0

  constructor() {
    this.hpFill      = document.getElementById('hp-fill')!
    this.stamFill    = document.getElementById('stam-fill')!
    this.energyFill  = document.getElementById('energy-fill')!
    this.bossHpWrap   = document.getElementById('boss-hp-wrap')!
    this.bossHpLabel  = document.getElementById('boss-hp-label')!
    this.bossHpFill   = document.getElementById('boss-hp-fill')!
    this.bossMsgEl    = document.getElementById('boss-msg')!
    this.interactHint = document.getElementById('interact-hint')!
    this.buildWeaponRing()
  }

  private buildWeaponRing(): void {
    const svg = document.getElementById('weapon-ring')!
    for (let i = 0; i < SLOTS; i++) {
      const angle = (i / SLOTS) * Math.PI * 2 - Math.PI / 2
      const x = Math.cos(angle) * SLOT_RING_R
      const y = Math.sin(angle) * SLOT_RING_R
      const xs = x.toFixed(1)
      const ys = y.toFixed(1)

      const bg = document.createElementNS(SVG_NS, 'circle')
      bg.setAttribute('cx', xs); bg.setAttribute('cy', ys)
      bg.setAttribute('r', String(SLOT_R))
      bg.setAttribute('fill', '#111122')
      bg.setAttribute('stroke', '#2a2a44')
      bg.setAttribute('stroke-width', '1.5')
      svg.appendChild(bg)

      const fill = document.createElementNS(SVG_NS, 'circle')
      fill.setAttribute('cx', xs); fill.setAttribute('cy', ys)
      fill.setAttribute('r', String(SLOT_R - 3))
      fill.setAttribute('fill', '#111122')
      svg.appendChild(fill)
      this.slotFills.push(fill)

      const label = document.createElementNS(SVG_NS, 'text')
      label.setAttribute('x', xs)
      label.setAttribute('y', (y + 4).toFixed(1))
      label.setAttribute('text-anchor', 'middle')
      label.setAttribute('font-family', 'monospace')
      label.setAttribute('font-size', '10')
      label.setAttribute('fill', '#334455')
      label.setAttribute('pointer-events', 'none')
      label.textContent = String(i + 1)
      svg.appendChild(label)
      this.slotLabels.push(label)
    }
  }

  update(webbs: Webbs3D): void {
    this.hpFill.style.width     = `${(webbs.hp / webbs.hpMax) * 100}%`
    this.stamFill.style.width   = `${(webbs.stamina / webbs.maxStamina) * 100}%`
    this.energyFill.style.width = `${(webbs.energy / webbs.maxEnergy) * 100}%`

    for (let i = 0; i < SLOTS; i++) {
      const wt = webbs.weaponSystem.getSlot(i)
      const isEmpty = wt === 'Empty'
      const color = WEAPON_COLORS[wt]
      this.slotFills[i].setAttribute('fill', isEmpty ? '#111122' : `#${color.toString(16).padStart(6, '0')}`)
      this.slotLabels[i].setAttribute('fill', isEmpty ? '#2a2a44' : '#aaaacc')
    }
  }

  setZoneLabel(text: string): void {
    const el = document.getElementById('zone-label')
    if (el) el.textContent = text
  }

  // ── Boss HP bar ──────────────────────────────────────────────────────────

  showBossHp(label: string, hp: number, hpMax: number): void {
    this.bossHpWrap.style.display = 'flex'
    this.bossHpLabel.textContent  = label
    this.updateBossHp(hp, hpMax)
  }

  updateBossHp(hp: number, hpMax: number): void {
    const pct = hpMax > 0 ? Math.max(0, (hp / hpMax) * 100) : 0
    this.bossHpFill.style.width = `${pct}%`
    const col = pct > 50 ? '#ff5577' : pct > 25 ? '#ff8822' : '#ff2222'
    this.bossHpFill.style.background = col
  }

  hideBossHp(): void {
    this.bossHpWrap.style.display = 'none'
  }

  flashBossMessage(msg: string): void {
    this.bossMsgEl.textContent    = msg
    this.bossMsgEl.style.display  = msg ? 'block' : 'none'
    this.bossMsgTimer             = msg ? 3.0 : 0
  }

  setInteractHint(text: string): void {
    this.interactHint.textContent  = text
    this.interactHint.style.display = text ? 'block' : 'none'
  }

  // Call once per frame to tick the message auto-hide
  tickBossMsg(delta: number): void {
    if (this.bossMsgTimer <= 0) return
    this.bossMsgTimer -= delta
    if (this.bossMsgTimer <= 0) {
      this.bossMsgEl.style.display = 'none'
      this.bossMsgEl.textContent   = ''
    }
  }
}
