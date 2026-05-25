import { WeaponType } from '../systems/WeaponSystem'
import { WEAPON_COLORS, WEAPON_DATA } from '../config/WeaponData'
import { registry } from '../core/Registry'
import type { InputManager } from '../core/InputManager'
import type { Webbs3D } from '../entities/Webbs3D'

const SLOT_COUNT = 8

export class EquipScreen3D {
  private overlay:      HTMLElement
  private panel:        HTMLDivElement
  private slotEls:      HTMLDivElement[]  = []
  private invContainer!: HTMLDivElement
  private selectedSlot  = 0
  private webbs!:       Webbs3D

  isOpen  = false
  onClose?: () => void

  constructor(menuOverlay: HTMLElement) {
    this.overlay = menuOverlay
    this.panel   = this.buildPanel()
    menuOverlay.appendChild(this.panel)
  }

  show(webbs: Webbs3D): void {
    this.webbs        = webbs
    this.selectedSlot = 0
    this.panel.style.display = 'flex'
    this.overlay.style.display = 'block'
    this.isOpen = true
    this.refresh()
  }

  update(input: InputManager): void {
    if (!this.isOpen) return
    if (input.justDown('Escape') || input.justDown('KeyI')) this.close()
  }

  close(): void {
    this.panel.style.display = 'none'
    this.overlay.style.display = 'none'
    this.isOpen = false
    this.onClose?.()
  }

  // ── Panel construction ───────────────────────────────────────────────────────

  private buildPanel(): HTMLDivElement {
    const panel = document.createElement('div')
    panel.style.cssText = [
      'display:none; position:absolute; top:50%; left:50%;',
      'transform:translate(-50%,-50%);',
      'width:560px; background:#0d0d1a; border:1.5px solid #7777ff;',
      'font-family:monospace; color:#ccccdd; user-select:none;',
    ].join('')

    const title = document.createElement('div')
    title.style.cssText = 'padding:12px 20px; color:#7777ff; font-size:13px; letter-spacing:3px; border-bottom:1px solid rgba(119,119,255,0.3);'
    title.textContent = 'EQUIP'
    panel.appendChild(title)

    const body = document.createElement('div')
    body.style.cssText = 'display:flex;'

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
    hint.textContent = 'Click slot · Click weapon to equip · [×] unequip · I / Esc close'
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
      row.style.background = i === this.selectedSlot ? 'rgba(119,119,255,0.15)' : 'transparent'
      row.style.opacity    = unlocked ? '1' : '0.3'

      const num = document.createElement('span')
      num.style.cssText = 'color:#445566; font-size:10px; width:14px; flex-shrink:0;'
      num.textContent = String(i + 1)

      const dot = document.createElement('span')
      dot.style.cssText = 'width:10px; height:10px; border-radius:50%; display:inline-block; flex-shrink:0;'
      dot.style.background = wt !== WeaponType.Empty
        ? `#${WEAPON_COLORS[wt].toString(16).padStart(6, '0')}`
        : '#222233'

      const name = document.createElement('span')
      name.style.cssText = `font-size:11px; flex:1; color:${wt === WeaponType.Empty ? '#334455' : '#aaaacc'};`
      if (wt === WeaponType.Empty) {
        name.textContent = unlocked ? '— empty —' : '— locked —'
      } else {
        name.textContent = WEAPON_DATA.get(wt)?.name ?? wt
      }

      row.appendChild(num)
      row.appendChild(dot)
      row.appendChild(name)

      if (unlocked && i === this.selectedSlot && wt !== WeaponType.Empty) {
        const unequip = document.createElement('span')
        unequip.style.cssText = 'font-size:10px; color:#554455; cursor:pointer; flex-shrink:0;'
        unequip.textContent = '[×]'
        unequip.addEventListener('click', (e) => { e.stopPropagation(); this.unequipSlot(i) })
        row.appendChild(unequip)
      }
    }

    // Weapon pool (deduplicated by type)
    this.invContainer.innerHTML = ''

    const tierNote = document.createElement('div')
    tierNote.style.cssText = 'font-size:10px; color:#445566; margin-bottom:6px;'
    tierNote.textContent = `Leg tier: ${legTier}`
    this.invContainer.appendChild(tierNote)

    const unique = [...new Set(weaponInv)]
    if (unique.length === 0) {
      const empty = document.createElement('div')
      empty.style.cssText = 'font-size:11px; color:#334455; padding:4px 8px;'
      empty.textContent = 'No weapons found yet'
      this.invContainer.appendChild(empty)
      return
    }

    for (const wt of unique) {
      const el = document.createElement('div')
      el.style.cssText = 'display:flex; align-items:center; gap:8px; padding:5px 8px; border-radius:2px; cursor:pointer; margin-bottom:2px;'
      el.addEventListener('mouseenter', () => { el.style.background = 'rgba(119,119,255,0.1)' })
      el.addEventListener('mouseleave', () => { el.style.background = 'transparent' })
      el.addEventListener('click', () => this.equipWeapon(wt))

      const dot = document.createElement('span')
      dot.style.cssText = `width:10px; height:10px; border-radius:50%; flex-shrink:0; background:#${WEAPON_COLORS[wt].toString(16).padStart(6,'0')};`

      const nameEl = document.createElement('span')
      nameEl.style.cssText = 'font-size:11px; color:#aaaacc;'
      nameEl.textContent = WEAPON_DATA.get(wt)?.name ?? wt

      el.appendChild(dot)
      el.appendChild(nameEl)
      this.invContainer.appendChild(el)
    }
  }

  private clickSlot(i: number): void {
    if (!this.webbs.weaponSystem.isSlotUnlocked(i)) return
    this.selectedSlot = i
    this.refresh()
  }

  private equipWeapon(wt: WeaponType): void {
    this.webbs.weaponSystem.equip(this.selectedSlot, wt)
    registry.set('equippedSlots', this.webbs.weaponSystem.getAllSlots())
    this.refresh()
  }

  private unequipSlot(slot: number): void {
    this.webbs.weaponSystem.unequip(slot)
    registry.set('equippedSlots', this.webbs.weaponSystem.getAllSlots())
    this.refresh()
  }
}
