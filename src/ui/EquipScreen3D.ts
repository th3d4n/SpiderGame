import { WeaponType } from '../systems/WeaponSystem'
import { WEAPON_COLORS, WEAPON_DATA, WEAPON_STATS, dpsFor } from '../config/WeaponData'
import { registry } from '../core/Registry'
import type { InputManager } from '../core/InputManager'
import type { Webbs3D } from '../entities/Webbs3D'
import { weaponIconSvg } from './WeaponIcon3D'
import { audio } from '../systems/AudioManager'

const SLOT_COUNT = 8

export class EquipScreen3D {
  private overlay:       HTMLElement
  private panel:         HTMLDivElement
  private slotEls:       HTMLDivElement[]  = []
  private invContainer!: HTMLDivElement
  private detailEl!:     HTMLDivElement
  private selectedSlot   = 0
  private selectedInvIdx = 0
  private focusedPanel:  'slots' | 'inv' = 'slots'
  private uniqueWeapons: WeaponType[] = []
  private webbs!:        Webbs3D

  isOpen  = false
  onClose?: () => void

  constructor(menuOverlay: HTMLElement) {
    this.overlay = menuOverlay
    this.panel   = this.buildPanel()
    menuOverlay.appendChild(this.panel)
  }

  show(webbs: Webbs3D): void {
    this.webbs          = webbs
    this.selectedSlot   = 0
    this.selectedInvIdx = 0
    this.focusedPanel   = 'slots'
    this.panel.style.display = 'flex'
    this.overlay.style.display = 'block'
    this.isOpen = true
    this.refresh()
  }

  update(input: InputManager): void {
    if (!this.isOpen) return
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
    this.panel.style.display = 'none'
    this.overlay.style.display = 'none'
    this.isOpen = false
    audio.play('ui_back')
    this.onClose?.()
  }

  // ── Panel construction ───────────────────────────────────────────────────────

  private buildPanel(): HTMLDivElement {
    const panel = document.createElement('div')
    panel.style.cssText = [
      'display:none; flex-direction:column; position:absolute; top:50%; left:50%;',
      'transform:translate(-50%,-50%);',
      'width:560px; background:#0d0d1a; border:1.5px solid #7777ff;',
      'font-family:monospace; color:#ccccdd; user-select:none;',
    ].join('')

    const title = document.createElement('div')
    title.style.cssText = 'padding:12px 20px; color:#7777ff; font-size:13px; letter-spacing:3px; border-bottom:1px solid rgba(119,119,255,0.3); flex-shrink:0;'
    title.textContent = 'EQUIP'
    panel.appendChild(title)

    const body = document.createElement('div')
    body.style.cssText = 'display:flex; flex:1;'

    // Left: slot list
    const left = document.createElement('div')
    left.style.cssText = 'flex:1; padding:14px 16px;'

    const slotsTitle = document.createElement('div')
    slotsTitle.style.cssText = 'color:#445566; font-size:10px; letter-spacing:1px; margin-bottom:10px;'
    slotsTitle.textContent = 'EQUIPPED SLOTS'
    left.appendChild(slotsTitle)

    this.slotEls = []
    for (let i = 0; i < SLOT_COUNT; i++) {
      const row = document.createElement('div')
      row.style.cssText = 'display:flex; align-items:center; gap:10px; padding:6px 8px; margin-bottom:3px; border-radius:2px; cursor:pointer;'
      row.addEventListener('click', () => this.clickSlot(i))
      left.appendChild(row)
      this.slotEls.push(row)
    }

    const hint = document.createElement('div')
    hint.style.cssText = 'font-size:10px; color:#445566; padding:10px 8px 4px;'
    hint.textContent = '1–8 slot  ↑↓ nav  ←→ panel  Enter equip  X unequip  I/Esc close'
    left.appendChild(hint)

    // Right: weapon pool
    const right = document.createElement('div')
    right.style.cssText = 'width:200px; padding:14px 12px; border-left:1px solid #1e1e2e;'

    const invTitle = document.createElement('div')
    invTitle.style.cssText = 'color:#445566; font-size:10px; letter-spacing:1px; margin-bottom:10px;'
    invTitle.textContent = 'AVAILABLE'
    right.appendChild(invTitle)

    this.invContainer = document.createElement('div')
    right.appendChild(this.invContainer)

    body.appendChild(left)
    body.appendChild(right)
    panel.appendChild(body)

    // Detail strip — stats for the currently selected slot's weapon
    this.detailEl = document.createElement('div')
    this.detailEl.style.cssText = [
      'display:flex; align-items:flex-start; gap:14px; flex-shrink:0;',
      'padding:12px 16px; border-top:1px solid #1e1e2e; min-height:72px;',
    ].join('')
    panel.appendChild(this.detailEl)

    return panel
  }

  // ── Rendering ────────────────────────────────────────────────────────────────

  private refresh(): void {
    const legTier   = registry.get<number>('legTier') ?? 0
    const weaponInv = registry.get<WeaponType[]>('weaponInventory') ?? []

    // Slot rows
    for (let i = 0; i < SLOT_COUNT; i++) {
      const row      = this.slotEls[i]
      const wt       = this.webbs.weaponSystem.getSlot(i)
      const unlocked = this.webbs.weaponSystem.isSlotUnlocked(i)
      row.innerHTML  = ''

      const isSelected  = i === this.selectedSlot
      const slotsFocused = this.focusedPanel === 'slots'
      row.style.background = isSelected
        ? (slotsFocused ? 'rgba(119,119,255,0.2)' : 'rgba(119,119,255,0.08)')
        : 'transparent'
      row.style.opacity = unlocked ? '1' : '0.3'

      const num = document.createElement('span')
      num.style.cssText = 'color:#445566; font-size:10px; width:14px; flex-shrink:0;'
      num.textContent = String(i + 1)

      const iconEl = document.createElement('span')
      iconEl.style.cssText = 'width:18px; height:18px; display:inline-flex; align-items:center; justify-content:center; flex-shrink:0;'
      if (wt !== WeaponType.Empty) {
        const c = `#${WEAPON_COLORS[wt].toString(16).padStart(6, '0')}`
        iconEl.innerHTML = weaponIconSvg(wt, c, 18)
      }

      const name = document.createElement('span')
      name.style.cssText = `font-size:11px; flex:1; color:${wt === WeaponType.Empty ? '#334455' : '#aaaacc'};`
      name.textContent = wt === WeaponType.Empty
        ? (unlocked ? '— empty —' : '— locked —')
        : (WEAPON_DATA.get(wt)?.name ?? wt)

      row.appendChild(num)
      row.appendChild(iconEl)
      row.appendChild(name)

      if (unlocked && isSelected && wt !== WeaponType.Empty) {
        const unequip = document.createElement('span')
        unequip.style.cssText = 'font-size:10px; color:#554455; cursor:pointer; flex-shrink:0;'
        unequip.textContent = '[×]'
        unequip.addEventListener('click', (e) => { e.stopPropagation(); this.unequipSlot(i) })
        row.appendChild(unequip)
      }
    }

    // Weapon pool (deduplicated)
    this.invContainer.innerHTML = ''
    this.uniqueWeapons = [...new Set(weaponInv)]

    const tierNote = document.createElement('div')
    tierNote.style.cssText = 'font-size:10px; color:#445566; margin-bottom:6px;'
    tierNote.textContent = `Leg tier: ${legTier}`
    this.invContainer.appendChild(tierNote)

    if (this.uniqueWeapons.length === 0) {
      const empty = document.createElement('div')
      empty.style.cssText = 'font-size:11px; color:#334455; padding:4px 8px;'
      empty.textContent = 'No weapons found yet'
      this.invContainer.appendChild(empty)
    } else {
      this.selectedInvIdx = Math.min(this.selectedInvIdx, this.uniqueWeapons.length - 1)
      const invFocused = this.focusedPanel === 'inv'

      for (let idx = 0; idx < this.uniqueWeapons.length; idx++) {
        const wt = this.uniqueWeapons[idx]
        const el = document.createElement('div')
        const isSelInv = idx === this.selectedInvIdx
        el.style.cssText = 'display:flex; align-items:center; gap:8px; padding:5px 8px; border-radius:2px; cursor:pointer; margin-bottom:2px;'
        el.style.background = isSelInv
          ? (invFocused ? 'rgba(119,119,255,0.2)' : 'rgba(119,119,255,0.08)')
          : 'transparent'

        el.addEventListener('click', () => { this.selectedInvIdx = idx; this.equipWeapon(wt) })
        el.addEventListener('mouseenter', () => {
          if (idx !== this.selectedInvIdx) el.style.background = 'rgba(119,119,255,0.08)'
        })
        el.addEventListener('mouseleave', () => {
          el.style.background = idx === this.selectedInvIdx
            ? (this.focusedPanel === 'inv' ? 'rgba(119,119,255,0.2)' : 'rgba(119,119,255,0.08)')
            : 'transparent'
        })

        const iconEl = document.createElement('span')
        iconEl.style.cssText = 'width:18px; height:18px; display:inline-flex; align-items:center; justify-content:center; flex-shrink:0;'
        const c = `#${WEAPON_COLORS[wt].toString(16).padStart(6,'0')}`
        iconEl.innerHTML = weaponIconSvg(wt, c, 18)

        const nameEl = document.createElement('span')
        nameEl.style.cssText = 'font-size:11px; color:#aaaacc;'
        nameEl.textContent = WEAPON_DATA.get(wt)?.name ?? wt

        el.appendChild(iconEl)
        el.appendChild(nameEl)
        this.invContainer.appendChild(el)
      }
    }

    this.refreshDetail()
  }

  private refreshDetail(): void {
    this.detailEl.innerHTML = ''
    const wt = this.webbs.weaponSystem.getSlot(this.selectedSlot)
    if (wt === WeaponType.Empty) {
      const empty = document.createElement('span')
      empty.style.cssText = 'color:#334455; font-size:11px; align-self:center;'
      empty.textContent = '— no weapon in this slot —'
      this.detailEl.appendChild(empty)
      return
    }

    const c     = `#${WEAPON_COLORS[wt].toString(16).padStart(6, '0')}`
    const cfg   = WEAPON_DATA.get(wt)
    const stats = WEAPON_STATS[wt]

    const iconWrap = document.createElement('div')
    iconWrap.style.cssText = 'flex-shrink:0; width:40px; height:40px; display:flex; align-items:center; justify-content:center; background:rgba(255,255,255,0.03); border:1px solid #1e1e2e; border-radius:3px;'
    iconWrap.innerHTML = weaponIconSvg(wt, c, 30)

    const info = document.createElement('div')
    info.style.cssText = 'flex:1; min-width:0;'

    const nameLine = document.createElement('div')
    nameLine.style.cssText = `color:${c}; font-size:12px; margin-bottom:3px;`
    nameLine.textContent = cfg?.name ?? wt

    const statsLine = document.createElement('div')
    statsLine.style.cssText = 'color:#445566; font-size:10px; margin-bottom:5px;'
    statsLine.textContent = [
      `Type: ${cfg?.type ?? '—'}`,
      `DMG: ${cfg?.damage ?? '—'}`,
      `DPS: ${dpsFor(wt)}`,
      `Stam: ${cfg?.staminaCost ?? '—'}`,
      `Range: ${stats?.range ?? '—'}`,
      `Tier: ${cfg?.requiredTier ?? 0}`,
    ].join('  ·  ')

    const blurb = document.createElement('div')
    blurb.style.cssText = 'color:#778899; font-size:10px; line-height:1.6;'
    blurb.textContent = stats?.blurb ?? ''

    info.appendChild(nameLine)
    info.appendChild(statsLine)
    info.appendChild(blurb)
    this.detailEl.appendChild(iconWrap)
    this.detailEl.appendChild(info)
  }

  private clickSlot(i: number): void {
    if (!this.webbs.weaponSystem.isSlotUnlocked(i)) return
    this.selectedSlot = i
    this.focusedPanel = 'slots'
    this.refresh()
  }

  private equipWeapon(wt: WeaponType): void {
    this.webbs.weaponSystem.equip(this.selectedSlot, wt)
    registry.set('equippedSlots', this.webbs.weaponSystem.getAllSlots())
    this.refresh()
    if (wt === WeaponType.WebLauncher) audio.play('web_launcher_equipped')
  }

  private unequipSlot(slot: number): void {
    this.webbs.weaponSystem.unequip(slot)
    registry.set('equippedSlots', this.webbs.weaponSystem.getAllSlots())
    this.refresh()
  }
}
