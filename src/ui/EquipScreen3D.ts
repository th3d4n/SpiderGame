import { WeaponType } from '../systems/WeaponSystem'
import { WEAPON_STATS } from '../config/WeaponData'
import { registry } from '../core/Registry'
import type { InputManager } from '../core/InputManager'
import type { Webbs3D } from '../entities/Webbs3D'
import { weaponIconPaths, weaponIconSvg } from './WeaponIcon3D'
import { audio } from '../systems/AudioManager'
import { h, richText } from './theme'
import { weaponColor, weaponName, weaponStatBars, weaponTypeLabel } from './weaponInfo'

// ─── Equipment screen ─────────────────────────────────────────────────────────
// Left: Webbs seen from above — eight legs, eight slots, in the same order and
// positions as the HUD ring.  Middle: the armoury (weapons owned).  Right: the
// focused weapon's card.  Keyboard: 1–8 slot · ↑↓ move · ←→ switch column ·
// Enter equip · X unequip · I/Esc close.  Mouse: click a leg, click a weapon.

const SLOT_COUNT = 8
const SVG_NS = 'http://www.w3.org/2000/svg'
const OUT_MS = 200

const STYLE = /* css */`
.nl-eq { position:absolute; left:50%; top:50%; width: 900px; height: 520px; transform: translate(-50%,-50%);
  display:grid; grid-template-columns: 300px 1fr 300px; grid-template-rows: auto 1fr auto; animation: nl-panel-in 300ms var(--nl-ease) both; }
.nl-eq.out { animation: nl-panel-out ${OUT_MS}ms ease-in both; }
.nl-eq header { grid-column: 1 / 4; display:flex; align-items:flex-end; justify-content:space-between; padding: 22px 28px 14px; border-bottom: 1px solid var(--nl-line); }
.nl-eq header .nl-title { font-size: 26px; }
.nl-eq footer { grid-column: 1 / 4; padding: 12px 20px 16px; border-top: 1px solid var(--nl-line); }
.nl-eq .col { padding: 16px 18px; min-height: 0; }
.nl-eq .col + .col { border-left: 1px solid var(--nl-line); }
.nl-eq .col > .nl-eyebrow { margin-bottom: 12px; }
.nl-eq .col.focus > .nl-eyebrow { color: var(--nl-silk); }
.nl-eq .legs svg { display:block; margin: 6px auto 0; overflow: visible; }
.nl-eq .leg { cursor:pointer; }
.nl-eq .leg .disc { fill: rgba(20,15,12,.9); stroke: rgba(232,214,186,.25); stroke-width: 1.4; transition: stroke 120ms, fill 120ms; }
.nl-eq .leg:hover .disc { stroke: rgba(232,214,186,.6); }
.nl-eq .leg.sel .disc { stroke: var(--nl-silk); stroke-width: 2.4; fill: rgba(168,216,255,.10); }
.nl-eq .leg.locked { opacity: .35; cursor: default; }
.nl-eq .leg .num { font-family: var(--nl-mono); font-size: 10px; font-weight: 700; fill: var(--nl-dim); }
.nl-eq .leg.sel .num { fill: var(--nl-silk); }
.nl-eq .leg .bone { stroke: rgba(232,214,186,.22); stroke-width: 3; stroke-linecap: round; }
.nl-eq .leg.sel .bone { stroke: rgba(168,216,255,.55); }
.nl-eq .pulse { fill:none; stroke: var(--nl-silk); stroke-width:2; transform-box: fill-box; transform-origin: center; animation: nl-ripple 600ms ease-out both; }
.nl-eq .slotname { text-align:center; margin-top: 10px; font-size: 13px; }
.nl-eq .armory { display:flex; flex-direction:column; gap:6px; overflow:auto; max-height: 330px; }
.nl-eq .armory .nl-row .ico { width:38px; height:38px; border-radius:9px; display:grid; place-items:center; background: rgba(255,240,220,.04); box-shadow: inset 0 0 0 1px rgba(255,255,255,.08); flex: none; }
.nl-eq .armory .nl-row .nm { font-size: 14px; color: var(--nl-text); }
.nl-eq .armory .nl-row .sub { font-size: 11px; color: var(--nl-dim); }
.nl-eq .armory .on-legs { margin-left:auto; display:flex; gap:4px; }
.nl-eq .armory .on-legs i { font-style:normal; font-family: var(--nl-mono); font-size: 10px; padding: 2px 6px; border-radius: 5px; background: rgba(168,216,255,.14); color: var(--nl-silk); }
.nl-eq .detail { display:flex; flex-direction:column; align-items:center; text-align:center; gap: 12px; }
.nl-eq .detail .big { width: 96px; height: 96px; border-radius: 50%; display:grid; place-items:center;
  background: radial-gradient(circle at 50% 40%, color-mix(in srgb, var(--c) 30%, transparent), rgba(10,8,6,.9) 72%);
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--c) 55%, transparent); animation: nl-pop 380ms var(--nl-ease-back) both; }
.nl-eq .detail .nl-title { font-size: 20px; line-height: 1.2; }
.nl-eq .detail .blurb { font-size: 12px; line-height: 1.6; color: var(--nl-dim); }
.nl-eq .empty { color: var(--nl-faint); font-size: 13px; padding: 30px 8px; text-align:center; line-height: 1.6; }
`

export class EquipScreen3D {
  private overlay:  HTMLElement
  private root:     HTMLDivElement
  private panel!:   HTMLDivElement
  private legsCol!: HTMLElement
  private invCol!:  HTMLElement
  private detail!:  HTMLElement
  private legSvg!:  SVGSVGElement
  private legEls:   SVGGElement[] = []
  private slotName!: HTMLElement
  private tierChip!: HTMLElement
  private selectedSlot   = 0
  private selectedInvIdx = 0
  private focusedPanel:  'slots' | 'inv' = 'slots'
  private uniqueWeapons: WeaponType[] = []
  private webbs!:        Webbs3D
  private closing = false

  isOpen  = false
  onClose?: () => void

  constructor(menuOverlay: HTMLElement) {
    this.overlay = menuOverlay
    if (!document.getElementById('nl-eq-style')) {
      const st = h('style'); st.id = 'nl-eq-style'; st.textContent = STYLE
      document.head.appendChild(st)
    }
    this.root = h('div') as HTMLDivElement
    this.root.style.cssText = 'display:none; position:absolute; inset:0;'
    this.buildPanel()
    menuOverlay.appendChild(this.root)
  }

  show(webbs: Webbs3D): void {
    this.webbs          = webbs
    this.selectedSlot   = 0
    this.selectedInvIdx = 0
    this.focusedPanel   = 'slots'
    this.closing        = false
    this.panel.classList.remove('out')
    this.root.style.display = 'block'
    this.overlay.style.display = 'block'
    this.isOpen = true
    this.refresh()
  }

  update(input: InputManager): void {
    if (!this.isOpen || this.closing) return
    if (input.justDown('Escape') || input.justDown('KeyI')) { this.close(); return }

    const SLOT_KEYS = ['Digit1','Digit2','Digit3','Digit4','Digit5','Digit6','Digit7','Digit8']
    for (let i = 0; i < SLOT_COUNT; i++) {
      if (input.justDown(SLOT_KEYS[i]) && this.webbs.weaponSystem.isSlotUnlocked(i)) {
        this.selectedSlot = i
        this.focusedPanel = 'slots'
        this.refresh()
        audio.play('ui_hover')
        return
      }
    }

    if (input.justDown('ArrowLeft'))  { this.focusedPanel = 'slots'; this.refresh(); audio.play('ui_hover'); return }
    if (input.justDown('ArrowRight')) { this.focusedPanel = 'inv';   this.refresh(); audio.play('ui_hover'); return }

    if (input.justDown('ArrowUp') || input.justDown('ArrowDown')) {
      const dir = input.justDown('ArrowUp') ? -1 : 1
      if (this.focusedPanel === 'slots') {
        let next = this.selectedSlot
        for (let tries = 0; tries < SLOT_COUNT; tries++) {
          next = (next + dir + SLOT_COUNT) % SLOT_COUNT
          if (this.webbs.weaponSystem.isSlotUnlocked(next)) break
        }
        this.selectedSlot = next
      } else if (this.uniqueWeapons.length > 0) {
        this.selectedInvIdx = (this.selectedInvIdx + dir + this.uniqueWeapons.length) % this.uniqueWeapons.length
      }
      this.refresh()
      audio.play('ui_hover')
      return
    }

    if (input.justDown('Enter') || input.justDown('NumpadEnter')) {
      if (this.uniqueWeapons.length > 0 && this.webbs.weaponSystem.isSlotUnlocked(this.selectedSlot)) {
        this.equipWeapon(this.uniqueWeapons[this.selectedInvIdx])
        audio.play('ui_click')
      }
      return
    }

    if (input.justDown('KeyX')) {
      if (this.webbs.weaponSystem.isSlotUnlocked(this.selectedSlot)) {
        this.unequipSlot(this.selectedSlot)
        audio.play('ui_click')
      }
    }
  }

  close(): void {
    if (!this.isOpen || this.closing) return
    this.closing = true
    this.panel.classList.add('out')
    audio.play('ui_back')
    window.setTimeout(() => {
      this.root.style.display = 'none'
      this.overlay.style.display = 'none'
      this.isOpen  = false
      this.closing = false
      this.onClose?.()
    }, OUT_MS)
  }

  // ── Construction ───────────────────────────────────────────────────────────

  private buildPanel(): void {
    this.root.appendChild(h('div', 'nl-scrim'))
    const panel = h('div', 'nl-panel nl-eq') as HTMLDivElement
    this.panel = panel

    const header = h('header')
    const ttl = h('div')
    ttl.appendChild(h('div', 'nl-eyebrow', 'Equipment'))
    ttl.appendChild(h('div', 'nl-title', 'Eight legs, eight tools'))
    header.appendChild(ttl)
    this.tierChip = h('span', 'nl-chip')
    header.appendChild(this.tierChip)
    panel.appendChild(header)

    // Legs column
    this.legsCol = h('div', 'col legs')
    this.legsCol.appendChild(h('div', 'nl-eyebrow', 'Legs'))
    this.legSvg = document.createElementNS(SVG_NS, 'svg')
    this.legSvg.setAttribute('width', '260'); this.legSvg.setAttribute('height', '260')
    this.legSvg.setAttribute('viewBox', '-130 -130 260 260')
    // body (cephalothorax + abdomen)
    this.legSvg.innerHTML = `
      <ellipse cx="0" cy="18" rx="30" ry="36" fill="#2a2030" stroke="rgba(232,214,186,.25)"/>
      <ellipse cx="0" cy="-22" rx="22" ry="20" fill="#352840" stroke="rgba(232,214,186,.25)"/>
      <circle cx="-7" cy="-30" r="3.4" fill="#66e0ff"/><circle cx="7" cy="-30" r="3.4" fill="#66e0ff"/>`
    for (let i = 0; i < SLOT_COUNT; i++) {
      const a  = (i / SLOT_COUNT) * Math.PI * 2 - Math.PI / 2
      const x  = Math.cos(a) * 96, y = Math.sin(a) * 96
      const g  = document.createElementNS(SVG_NS, 'g')
      g.setAttribute('class', 'leg')
      const kx = Math.cos(a) * 54 + Math.cos(a + 0.5) * 8, ky = Math.sin(a) * 54 + Math.sin(a + 0.5) * 8
      g.innerHTML = `
        <polyline class="bone" points="${(Math.cos(a) * 26).toFixed(1)},${(Math.sin(a) * 26).toFixed(1)} ${kx.toFixed(1)},${ky.toFixed(1)} ${(Math.cos(a) * 74).toFixed(1)},${(Math.sin(a) * 74).toFixed(1)}" fill="none"/>
        <circle class="disc" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="22"/>
        <g class="icon" transform="translate(${x.toFixed(1)},${y.toFixed(1)}) scale(1.25)"></g>
        <text class="num" x="${(Math.cos(a) * 124).toFixed(1)}" y="${(Math.sin(a) * 124 + 3.5).toFixed(1)}" text-anchor="middle">${i + 1}</text>`
      g.addEventListener('click', () => this.clickSlot(i))
      this.legSvg.appendChild(g)
      this.legEls.push(g)
    }
    this.legsCol.appendChild(this.legSvg)
    this.slotName = h('div', 'slotname')
    this.legsCol.appendChild(this.slotName)
    panel.appendChild(this.legsCol)

    // Armory column
    this.invCol = h('div', 'col')
    this.invCol.appendChild(h('div', 'nl-eyebrow', 'Armory'))
    panel.appendChild(this.invCol)

    // Detail column
    const right = h('div', 'col')
    right.appendChild(h('div', 'nl-eyebrow', 'Details'))
    this.detail = h('div', 'detail')
    right.appendChild(this.detail)
    panel.appendChild(right)

    const footer = h('footer', 'nl-hints')
    footer.innerHTML = [
      ['1–8', 'leg'], ['↑↓', 'move'], ['←→', 'column'], ['Enter', 'equip'], ['X', 'unequip'], ['I', 'close'],
    ].map(([k, t]) => `<span><span class="nl-key">${k}</span> ${t}</span>`).join('')
    panel.appendChild(footer)

    this.root.appendChild(panel)
  }

  // ── Rendering ────────────────────────────────────────────────────────────

  private refresh(): void {
    const legTier   = registry.get<number>('legTier') ?? 0
    const weaponInv = registry.get<WeaponType[]>('weaponInventory') ?? []
    this.tierChip.innerHTML = `Leg tier <b>${legTier}</b>`
    this.legsCol.classList.toggle('focus', this.focusedPanel === 'slots')
    this.invCol.classList.toggle('focus', this.focusedPanel === 'inv')

    // Legs
    for (let i = 0; i < SLOT_COUNT; i++) {
      const g        = this.legEls[i]
      const wt       = this.webbs.weaponSystem.getSlot(i)
      const unlocked = this.webbs.weaponSystem.isSlotUnlocked(i)
      g.classList.toggle('sel', i === this.selectedSlot)
      g.classList.toggle('locked', !unlocked)
      const icon = g.querySelector('.icon') as SVGGElement
      icon.innerHTML = wt === WeaponType.Empty
        ? (unlocked ? '' : '<path d="M-4,0 L-4,5 L4,5 L4,0 Z M-2.6,0 L-2.6,-2.6 A2.6,2.6 0 0,1 2.6,-2.6 L2.6,0" fill="none" stroke="#a89d8c" stroke-width="1.2"/>')
        : weaponIconPaths(wt, weaponColor(wt))
    }
    const selWt = this.webbs.weaponSystem.getSlot(this.selectedSlot)
    this.slotName.innerHTML = `<span class="nl-faint">Leg ${this.selectedSlot + 1}</span> &nbsp;·&nbsp; ${
      selWt === WeaponType.Empty ? '<span class="nl-faint">empty</span>' : weaponName(selWt)}`

    // Armory
    this.uniqueWeapons = [...new Set(weaponInv)]
    const list = h('div', 'armory')
    if (this.uniqueWeapons.length === 0) {
      list.innerHTML = `<div class="empty">No weapons yet.<br>Search the den — or build one at the ${'<b>workbench</b>'}.</div>`
    } else {
      this.selectedInvIdx = Math.min(this.selectedInvIdx, this.uniqueWeapons.length - 1)
      this.uniqueWeapons.forEach((wt, idx) => {
        const row = h('div', 'nl-row')
        if (idx === this.selectedInvIdx && this.focusedPanel === 'inv') row.classList.add('sel')
        const ico = h('div', 'ico'); ico.innerHTML = weaponIconSvg(wt, weaponColor(wt), 26)
        const txt = h('div')
        txt.appendChild(h('div', 'nm', weaponName(wt)))
        txt.appendChild(h('div', 'sub', `${weaponTypeLabel(wt)} · ${WEAPON_STATS[wt]?.range ?? '—'}`))
        row.appendChild(ico); row.appendChild(txt)
        const legs = this.webbs.weaponSystem.getAllSlots().map((s, i) => s === wt ? i + 1 : 0).filter(Boolean)
        if (legs.length) {
          const on = h('div', 'on-legs')
          on.innerHTML = legs.map(n => `<i>${n}</i>`).join('')
          row.appendChild(on)
        }
        row.addEventListener('click', () => { this.selectedInvIdx = idx; this.focusedPanel = 'inv'; this.equipWeapon(wt) })
        row.addEventListener('mouseenter', () => { if (this.focusedPanel === 'inv' && this.selectedInvIdx !== idx) { this.selectedInvIdx = idx; this.refresh() } })
        list.appendChild(row)
      })
    }
    this.invCol.querySelector('.armory')?.remove()
    this.invCol.appendChild(list)

    // Detail: the highlighted armory weapon when browsing it, else the selected leg's
    const focusWt = this.focusedPanel === 'inv' && this.uniqueWeapons.length
      ? this.uniqueWeapons[this.selectedInvIdx]
      : selWt
    this.renderDetail(focusWt)
  }

  private renderDetail(wt: WeaponType): void {
    this.detail.innerHTML = ''
    if (wt === WeaponType.Empty) {
      this.detail.innerHTML = `<div class="empty">This leg is free.<br>${richText('Pick a weapon with [→] and press [Enter].')}</div>`
      return
    }
    this.detail.style.setProperty('--c', weaponColor(wt))
    const big = h('div', 'big'); big.innerHTML = weaponIconSvg(wt, weaponColor(wt), 60)
    this.detail.appendChild(big)
    this.detail.appendChild(h('div', 'nl-title', weaponName(wt)))
    const chips = h('div'); chips.style.cssText = 'display:flex; gap:6px; justify-content:center;'
    chips.innerHTML = `<span class="nl-chip">${weaponTypeLabel(wt)}</span><span class="nl-chip">Range <b>${WEAPON_STATS[wt]?.range ?? '—'}</b></span>`
    this.detail.appendChild(chips)
    this.detail.appendChild(weaponStatBars(wt))
    this.detail.appendChild(h('div', 'blurb', WEAPON_STATS[wt]?.blurb ?? ''))
  }

  private pulseLeg(i: number): void {
    const disc = this.legEls[i].querySelector('.disc') as SVGCircleElement
    const p = document.createElementNS(SVG_NS, 'circle')
    p.setAttribute('cx', disc.getAttribute('cx')!); p.setAttribute('cy', disc.getAttribute('cy')!)
    p.setAttribute('r', '22'); p.setAttribute('class', 'pulse')
    this.legSvg.appendChild(p)
    window.setTimeout(() => p.remove(), 650)
  }

  private clickSlot(i: number): void {
    if (!this.webbs.weaponSystem.isSlotUnlocked(i)) return
    this.selectedSlot = i
    this.focusedPanel = 'slots'
    this.refresh()
    audio.play('ui_hover')
  }

  private equipWeapon(wt: WeaponType): void {
    this.webbs.weaponSystem.equip(this.selectedSlot, wt)
    registry.set('weaponSlots', this.webbs.weaponSystem.getAllSlots())
    this.refresh()
    this.pulseLeg(this.selectedSlot)
    if (wt === WeaponType.WebLauncher) audio.play('web_launcher_equipped')
  }

  private unequipSlot(slot: number): void {
    this.webbs.weaponSystem.unequip(slot)
    registry.set('weaponSlots', this.webbs.weaponSystem.getAllSlots())
    this.refresh()
  }
}
