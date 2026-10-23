import type { Webbs3D } from '../entities/Webbs3D'
import { WEAPON_COLORS } from '../config/WeaponData'
import { WeaponType } from '../systems/WeaponSystem'
import { registry } from '../core/Registry'
import { weaponIconPaths } from './WeaponIcon3D'
import { h, hex, richText } from './theme'

const SLOT_RING_R = 58
const SLOT_R      = 16
const SLOTS       = 8
const SVG_NS      = 'http://www.w3.org/2000/svg'

export type ToastKind = 'info' | 'warn' | 'danger' | 'good'
const TOAST_ICON: Record<ToastKind, string> = { info: 'i', warn: '!', danger: '!', good: '✓' }

export class HudSystem {
  private hpFill:      HTMLElement
  private hpGhost:     HTMLElement
  private hpNum:       HTMLElement
  private stamFill:    HTMLElement
  private stamNum:     HTMLElement
  private energyFill:  HTMLElement
  private energyNum:   HTMLElement
  private barsGroup:   HTMLElement
  private slotFills:   SVGCircleElement[] = []
  private slotRings:   SVGCircleElement[] = []
  private slotLabels:  SVGTextElement[]   = []
  private slotIcons:   SVGGElement[]      = []
  private slotCache:   string[]           = []
  private activeSlot   = 0
  private bossHpWrap:  HTMLElement
  private bossHpLabel: HTMLElement
  private bossHpFill:  HTMLElement
  private bossHpGhost: HTMLElement
  private bossMsgEl:   HTMLElement
  private interactHint: HTMLElement
  private interactText = ''
  get currentInteract(): string { return this.interactText }
  // Tap/click on a weapon-ring slot (touch: picks the slot the Attack button uses)
  onSlotTap?: (slot: number) => void
  private ammoPanel:   HTMLElement
  private vignetteEl:  HTMLElement
  private toastsEl:    HTMLElement
  private overlayEl:   HTMLElement
  private bossMsgTimer = 0
  private lastHpPct    = 100

  constructor() {
    this.hpFill       = document.getElementById('hp-fill')!
    this.hpGhost      = document.getElementById('hp-ghost')!
    this.hpNum        = document.getElementById('hp-num')!
    this.stamFill     = document.getElementById('stam-fill')!
    this.stamNum      = document.getElementById('stam-num')!
    this.energyFill   = document.getElementById('energy-fill')!
    this.energyNum    = document.getElementById('energy-num')!
    this.barsGroup    = document.getElementById('bars-group')!
    this.bossHpWrap   = document.getElementById('boss-hp-wrap')!
    this.bossHpLabel  = document.getElementById('boss-hp-label')!
    this.bossHpFill   = document.getElementById('boss-hp-fill')!
    this.bossHpGhost  = document.getElementById('boss-hp-ghost')!
    this.bossMsgEl    = document.getElementById('boss-msg')!
    this.interactHint = document.getElementById('interact-hint')!
    this.ammoPanel    = document.getElementById('ammo-panel')!
    this.vignetteEl   = document.getElementById('damage-vignette')!
    this.toastsEl     = document.getElementById('nl-toasts')!
    this.overlayEl    = document.getElementById('hud-overlay')!
    this.buildWeaponRing()
  }

  // Eight legs, eight slots — drawn as the ring of legs around Webbs' body.
  private buildWeaponRing(): void {
    const svg = document.getElementById('weapon-ring')!
    const core = document.createElementNS(SVG_NS, 'circle')
    core.setAttribute('r', '22'); core.setAttribute('class', 'ring-core')
    svg.appendChild(core)
    for (let i = 0; i < SLOTS; i++) {
      const angle = (i / SLOTS) * Math.PI * 2 - Math.PI / 2
      const x = Math.cos(angle) * SLOT_RING_R
      const y = Math.sin(angle) * SLOT_RING_R

      // leg spoke from body to slot
      const spoke = document.createElementNS(SVG_NS, 'line')
      spoke.setAttribute('x1', (Math.cos(angle) * 22).toFixed(1)); spoke.setAttribute('y1', (Math.sin(angle) * 22).toFixed(1))
      spoke.setAttribute('x2', (Math.cos(angle) * (SLOT_RING_R - SLOT_R)).toFixed(1)); spoke.setAttribute('y2', (Math.sin(angle) * (SLOT_RING_R - SLOT_R)).toFixed(1))
      spoke.setAttribute('stroke', 'rgba(232,214,186,.18)'); spoke.setAttribute('stroke-width', '1.5')
      svg.appendChild(spoke)

      const bg = document.createElementNS(SVG_NS, 'circle')
      bg.setAttribute('cx', x.toFixed(1)); bg.setAttribute('cy', y.toFixed(1))
      bg.setAttribute('r', String(SLOT_R)); bg.setAttribute('class', 'slot-bg')
      svg.appendChild(bg)

      const fill = document.createElementNS(SVG_NS, 'circle')
      fill.setAttribute('cx', x.toFixed(1)); fill.setAttribute('cy', y.toFixed(1))
      fill.setAttribute('r', String(SLOT_R - 3)); fill.setAttribute('fill', 'transparent')
      svg.appendChild(fill)
      this.slotFills.push(fill)

      const ring = document.createElementNS(SVG_NS, 'circle')
      ring.setAttribute('cx', x.toFixed(1)); ring.setAttribute('cy', y.toFixed(1))
      ring.setAttribute('r', String(SLOT_R + 3)); ring.setAttribute('class', 'slot-active')
      svg.appendChild(ring)
      this.slotRings.push(ring)

      const iconOuter = document.createElementNS(SVG_NS, 'g')
      iconOuter.setAttribute('transform', `translate(${x.toFixed(1)}, ${y.toFixed(1)})`)
      const iconInner = document.createElementNS(SVG_NS, 'g')
      iconInner.setAttribute('transform', 'scale(0.9)')
      iconOuter.appendChild(iconInner)
      svg.appendChild(iconOuter)
      this.slotIcons.push(iconInner)

      // slot number badge on the outer edge
      const lx = Math.cos(angle) * (SLOT_RING_R + SLOT_R + 2)
      const ly = Math.sin(angle) * (SLOT_RING_R + SLOT_R + 2)
      const label = document.createElementNS(SVG_NS, 'text')
      label.setAttribute('x', lx.toFixed(1)); label.setAttribute('y', (ly + 3).toFixed(1))
      label.setAttribute('text-anchor', 'middle'); label.setAttribute('class', 'slot-num')
      label.textContent = String(i + 1)
      svg.appendChild(label)
      this.slotLabels.push(label)
      this.slotCache.push('')

      // Invisible hit target over the whole slot (touch-sized)
      const hit = document.createElementNS(SVG_NS, 'circle')
      hit.setAttribute('cx', x.toFixed(1)); hit.setAttribute('cy', y.toFixed(1))
      hit.setAttribute('r', String(SLOT_R + 5)); hit.setAttribute('fill', 'transparent')
      hit.style.cursor = 'pointer'
      const slot = i
      hit.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); this.onSlotTap?.(slot) })
      svg.appendChild(hit)
    }
  }

  update(webbs: Webbs3D): void {
    const hpPct = Math.max(0, (webbs.hp / webbs.hpMax) * 100)
    this.hpFill.style.width = `${hpPct}%`
    // Ghost bar holds the pre-hit value, then drains (CSS delay) — damage reads.
    if (hpPct < this.lastHpPct - 0.01) this.hpGhost.style.width = `${hpPct}%`
    else if (hpPct > this.lastHpPct)   this.hpGhost.style.width = `${hpPct}%`
    this.lastHpPct = hpPct
    this.hpNum.textContent = `${Math.ceil(webbs.hp)}`
    this.stamFill.style.width   = `${(webbs.stamina / webbs.maxStamina) * 100}%`
    this.stamNum.textContent    = `${Math.round(webbs.stamina)}`
    this.energyFill.style.width = `${(webbs.energy / webbs.maxEnergy) * 100}%`
    this.energyNum.textContent  = `${Math.round(webbs.energy)}`
    this.barsGroup.classList.toggle('low-hp', hpPct > 0 && hpPct < 30)
    this.barsGroup.classList.toggle('winded', webbs.winded)

    let hasBow = false
    for (let i = 0; i < SLOTS; i++) {
      const wt = webbs.weaponSystem.getSlot(i)
      const isEmpty = wt === WeaponType.Empty
      const key = `${wt}|${i === this.activeSlot}`
      if (key !== this.slotCache[i]) {
        this.slotCache[i] = key
        const col = hex(WEAPON_COLORS[wt])
        this.slotFills[i].setAttribute('fill', isEmpty ? 'transparent' : `${col}33`)
        this.slotIcons[i].innerHTML = isEmpty ? '' : weaponIconPaths(wt, '#f6efe4')
        this.slotLabels[i].setAttribute('fill', isEmpty ? 'rgba(232,214,186,.28)' : '#efe6d8')
        this.slotRings[i].classList.toggle('on', i === this.activeSlot && !isEmpty)
      }
      if (wt === WeaponType.Bow) hasBow = true
    }

    // Ammo counter — only visible when Bow is equipped
    if (hasBow) {
      const thistles = (registry.get<Record<string, number>>('craftingInventory') ?? {})['Thistle'] ?? 0
      this.ammoPanel.style.display = 'block'
      this.ammoPanel.innerHTML = `THISTLE <b>${thistles}</b>`
      this.ammoPanel.classList.toggle('empty', thistles === 0)
    } else {
      this.ammoPanel.style.display = 'none'
    }
  }

  setActiveSlot(i: number): void { this.activeSlot = i }

  setZoneLabel(text: string): void {
    const el = document.getElementById('zone-label')
    if (el) el.textContent = text
  }

  // ── Boss ─────────────────────────────────────────────────────────────────

  showBossHp(label: string, hp: number, hpMax: number): void {
    this.bossHpWrap.style.display = 'flex'
    this.bossHpLabel.textContent  = label
    this.updateBossHp(hp, hpMax)
  }

  updateBossHp(hp: number, hpMax: number): void {
    const pct = hpMax > 0 ? Math.max(0, (hp / hpMax) * 100) : 0
    this.bossHpFill.style.width  = `${pct}%`
    this.bossHpGhost.style.width = `${pct}%`
  }

  hideBossHp(): void {
    this.bossHpWrap.style.display = 'none'
  }

  // Big boss/world callout (attack warnings, phase changes). '' hides it.
  flashBossMessage(msg: string): void {
    this.bossMsgEl.classList.remove('show')
    if (!msg) { this.bossMsgTimer = 0; return }
    this.bossMsgEl.textContent = msg
    void this.bossMsgEl.offsetWidth   // restart the callout animation
    this.bossMsgEl.classList.add('show')
    this.bossMsgTimer = 3.0
  }

  // Call once per frame to tick the callout auto-hide
  tickBossMsg(delta: number): void {
    if (this.bossMsgTimer <= 0) return
    this.bossMsgTimer -= delta
    if (this.bossMsgTimer <= 0) this.bossMsgEl.classList.remove('show')
  }

  // ── System messages ──────────────────────────────────────────────────────

  // Short status line (no potions, out of ammo, trap…).  Identical messages
  // re-trigger instead of stacking.
  toast(text: string, kind: ToastKind = 'info', ms = 2200): void {
    for (const el of Array.from(this.toastsEl.children) as HTMLElement[]) {
      if (el.dataset.text === text && !el.classList.contains('out')) el.remove()
    }
    const el = h('div', `nl-toast hud-card ${kind}`)
    el.dataset.text = text
    el.innerHTML = `<span class="ico">${TOAST_ICON[kind]}</span><span>${richText(text)}</span>`
    this.toastsEl.appendChild(el)
    while (this.toastsEl.children.length > 3) this.toastsEl.firstElementChild?.remove()
    window.setTimeout(() => {
      el.classList.add('out')
      window.setTimeout(() => el.remove(), 260)
    }, ms)
  }

  xpPop(amount: number): void {
    const el = h('div', 'xp-pop', `+${amount} XP`)
    this.overlayEl.appendChild(el)
    window.setTimeout(() => el.remove(), 1150)
  }

  setInteractHint(text: string): void {
    if (text === this.interactText) return
    this.interactText = text
    if (!text) { this.interactHint.style.display = 'none'; return }
    // "[E] open Gift" → keycap + label
    this.interactHint.innerHTML = richText(text)
    this.interactHint.style.display = 'flex'
    this.interactHint.style.animation = 'none'
    void this.interactHint.offsetWidth
    this.interactHint.style.animation = ''
  }

  flashDamageVignette(): void {
    this.vignetteEl.style.opacity = '1'
    window.setTimeout(() => { this.vignetteEl.style.opacity = '0' }, 90)
  }
}
