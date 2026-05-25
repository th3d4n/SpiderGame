import type { Webbs3D } from '../entities/Webbs3D'
import { WEAPON_COLORS } from '../config/WeaponData'
import { WeaponType } from '../systems/WeaponSystem'
import { registry } from '../core/Registry'
import { weaponIconPaths } from './WeaponIcon3D'

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
  private slotIcons:   SVGGElement[]      = []
  private bossHpWrap:    HTMLElement
  private bossHpLabel:   HTMLElement
  private bossHpFill:    HTMLElement
  private bossMsgEl:     HTMLElement
  private interactHint:  HTMLElement
  private ammoPanel:     HTMLElement
  private controlsLegend: HTMLElement
  private vignetteEl:    HTMLElement
  private legendVisible  = false
  private bossMsgTimer   = 0

  constructor() {
    this.hpFill        = document.getElementById('hp-fill')!
    this.stamFill      = document.getElementById('stam-fill')!
    this.energyFill    = document.getElementById('energy-fill')!
    this.bossHpWrap    = document.getElementById('boss-hp-wrap')!
    this.bossHpLabel   = document.getElementById('boss-hp-label')!
    this.bossHpFill    = document.getElementById('boss-hp-fill')!
    this.bossMsgEl     = document.getElementById('boss-msg')!
    this.interactHint  = document.getElementById('interact-hint')!
    this.ammoPanel     = document.getElementById('ammo-panel')!
    this.controlsLegend = document.getElementById('controls-legend')!
    this.vignetteEl    = document.getElementById('damage-vignette')!
    this.buildWeaponRing()
    this.setupControlsToggle()
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

      const iconOuter = document.createElementNS(SVG_NS, 'g')
      iconOuter.setAttribute('transform', `translate(${xs}, ${ys})`)
      const iconInner = document.createElementNS(SVG_NS, 'g')
      iconInner.setAttribute('transform', 'scale(0.75)')
      iconOuter.appendChild(iconInner)
      svg.appendChild(iconOuter)
      this.slotIcons.push(iconInner)

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

    let hasBow = false
    for (let i = 0; i < SLOTS; i++) {
      const wt = webbs.weaponSystem.getSlot(i)
      const isEmpty = wt === 'Empty'
      const color = WEAPON_COLORS[wt]
      this.slotFills[i].setAttribute('fill', isEmpty ? '#111122' : `#${color.toString(16).padStart(6, '0')}`)
      this.slotLabels[i].setAttribute('fill', isEmpty ? '#2a2a44' : '#aaaacc')
      this.slotIcons[i].innerHTML = isEmpty ? '' : weaponIconPaths(wt, '#ffffff')
      if (wt === WeaponType.Bow) hasBow = true
    }

    // Ammo counter — only visible when Bow is equipped
    if (hasBow) {
      const thistles = (registry.get<Record<string, number>>('craftingInventory') ?? {})['Thistle'] ?? 0
      this.ammoPanel.style.display = 'block'
      this.ammoPanel.textContent   = `THISTLE: ${thistles}`
      this.ammoPanel.classList.toggle('empty', thistles === 0)
    } else {
      this.ammoPanel.style.display = 'none'
    }
  }

  private setupControlsToggle(): void {
    window.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.code !== 'KeyH') return
      this.legendVisible = !this.legendVisible
      this.controlsLegend.style.display = this.legendVisible ? 'block' : 'none'
    })
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

  flashDamageVignette(): void {
    this.vignetteEl.style.opacity = '1'
    setTimeout(() => { this.vignetteEl.style.opacity = '0' }, 80)
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
