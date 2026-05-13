import Phaser from 'phaser'
import { WeaponType, WeaponSystem } from '../systems/WeaponSystem'
import { WEAPON_COLORS, WEAPON_DATA, WEAPON_STATS, dpsFor } from '../config/WeaponData'
import { drawWeaponIcon } from './WeaponIcon'

const ACCENT      = 0x7777ff
const ACCENT_STR  = '#7777ff'
const PANEL_BG    = 0x0d0d1a
const SLOT_RING_R = 100  // radius of slot ring in equip screen
const SLOT_R      = 18

export default class EquipScreen extends Phaser.Scene {
  // Navigation state
  private panelFocus: 'left' | 'right' = 'left'
  private selectedSlot    = 0
  private selectedWeapon  = 0

  // Visual references for dirty-redraw
  private slotCircles:  Phaser.GameObjects.Arc[]      = []
  private slotIcons:    Phaser.GameObjects.Graphics[] = []
  private slotLabels:   Phaser.GameObjects.Text[]     = []
  private weaponRows:   Phaser.GameObjects.Container[] = []

  // Detail / tooltip panel
  private detailName!:  Phaser.GameObjects.Text
  private detailIcon!:  Phaser.GameObjects.Graphics
  private detailStats!: Phaser.GameObjects.Text
  private detailBlurb!: Phaser.GameObjects.Text

  // Data
  private weaponSys!: WeaponSystem
  private inventory:  WeaponType[] = []

  // Cursor keys
  private cursors!:  Phaser.Types.Input.Keyboard.CursorKeys
  private enterKey!: Phaser.Input.Keyboard.Key
  private xKey!:     Phaser.Input.Keyboard.Key
  private iKey!:     Phaser.Input.Keyboard.Key
  private escKey!:   Phaser.Input.Keyboard.Key
  private numKeys:   Phaser.Input.Keyboard.Key[] = []

  constructor() {
    super({ key: 'EquipScreen' })
  }

  create() {
    this.panelFocus    = 'left'
    this.selectedSlot  = 0
    this.selectedWeapon = 0
    this.slotCircles   = []
    this.slotIcons     = []
    this.slotLabels    = []
    this.weaponRows    = []

    // Read WeaponSystem and weapon inventory from registry
    this.weaponSys = this.registry.get('weaponSystemRef') as WeaponSystem
    this.inventory = (this.registry.get('weaponInventory') as WeaponType[] | undefined) ?? []

    // Pause the gameplay scene while the equip screen is open. Also sleep the
    // HUD so its bottom-left bars don't show through the controls hint.
    const callerScene = this.registry.get('equipCallerScene') as string ?? 'HomeBaseScene'
    this.scene.pause(callerScene)
    if (this.scene.isActive('HUDScene')) this.scene.sleep('HUDScene')

    const { width, height } = this.scale

    // Dark overlay
    this.add.rectangle(width / 2, height / 2, width, height, 0x000000, 0.78)

    // Title
    this.add.text(width / 2, 28, 'LOADOUT', {
      fontFamily: 'monospace',
      fontSize:   '22px',
      color:      ACCENT_STR,
    }).setOrigin(0.5)

    this.buildLeftPanel(width, height)
    this.buildRightPanel(width)
    this.buildDetailPanel(width, height)
    this.buildControls(width, height)
    this.setupInput()
    this.redrawSlots()
    this.redrawInventory()
    this.refreshDetailPanel()
  }

  // ── Left panel — 8 leg slot circles in ring ──────────────────────────────

  private buildLeftPanel(width: number, height: number): void {
    const cx = width  * 0.28
    const cy = height * 0.52

    this.add.text(cx, cy - SLOT_RING_R - 30, 'LEGS', {
      fontFamily: 'monospace',
      fontSize:   '12px',
      color:      '#666677',
    }).setOrigin(0.5)

    // Guide ring
    const guide = this.add.graphics()
    guide.lineStyle(1, 0x222233, 0.5)
    guide.strokeCircle(cx, cy, SLOT_RING_R)

    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * Math.PI * 2
      const sx    = cx + Math.cos(angle) * SLOT_RING_R
      const sy    = cy + Math.sin(angle) * SLOT_RING_R

      const circle = this.add.arc(sx, sy, SLOT_R, 0, 360, false, PANEL_BG)
      circle.setStrokeStyle(1.5, 0x333344)
      circle.setInteractive({ useHandCursor: true })
      circle.on('pointerdown', () => {
        this.selectedSlot = i
        this.panelFocus   = 'left'
        this.redrawSlots()
        this.redrawInventory()
        this.refreshDetailPanel()
      })
      this.slotCircles.push(circle)

      // Weapon icon (hidden when slot is empty)
      const icon = this.add.graphics().setPosition(sx, sy).setScale(0.85)
      this.slotIcons.push(icon)

      // Fallback label (slot number or × for locked / · for empty)
      const label = this.add.text(sx, sy, `${i + 1}`, {
        fontFamily: 'monospace',
        fontSize:   '9px',
        color:      '#555566',
      }).setOrigin(0.5)
      this.slotLabels.push(label)

      // Slot number hint above
      this.add.text(sx, sy - SLOT_R - 8, `${i + 1}`, {
        fontFamily: 'monospace',
        fontSize:   '8px',
        color:      '#333344',
      }).setOrigin(0.5)
    }
  }

  // ── Right panel — weapon inventory list ──────────────────────────────────

  private buildRightPanel(width: number): void {
    const px = width * 0.55
    const py = 80

    this.add.text(px, py, 'WEAPONS', {
      fontFamily: 'monospace',
      fontSize:   '12px',
      color:      '#666677',
    }).setOrigin(0, 0)

    this.add.text(px, py + 18, 'available to equip', {
      fontFamily: 'monospace',
      fontSize:   '9px',
      color:      '#333344',
    }).setOrigin(0, 0)
  }

  // ── Detail / tooltip panel — bottom strip showing the focused weapon ─────

  private buildDetailPanel(width: number, height: number): void {
    const panelW = width - 80, panelH = 92
    const px = 40, py = height - panelH - 92

    this.add.rectangle(px + panelW / 2, py + panelH / 2, panelW, panelH, PANEL_BG, 0.9)
      .setStrokeStyle(1, 0x222233)

    // Icon on the left
    this.detailIcon = this.add.graphics().setPosition(px + 36, py + panelH / 2).setScale(1.6)

    // Weapon name + range/type line
    this.detailName = this.add.text(px + 70, py + 16, '', {
      fontFamily: 'monospace',
      fontSize:   '14px',
      color:      '#ccccdd',
    })
    this.detailStats = this.add.text(px + 70, py + 36, '', {
      fontFamily: 'monospace',
      fontSize:   '11px',
      color:      '#888899',
    })
    this.detailBlurb = this.add.text(px + 70, py + 58, '', {
      fontFamily: 'monospace',
      fontSize:   '10px',
      color:      '#666677',
      wordWrap:   { width: panelW - 100 },
    })
  }

  private buildControls(width: number, height: number): void {
    const controls = [
      ['1-8',   'Equip weapon to that slot'],
      ['ENTER', 'Equip to selected slot'],
      ['X',     'Unequip selected slot'],
      ['←→',    'Switch panel'],
      ['↑↓',    'Navigate'],
      ['I/ESC', 'Close'],
    ]

    // Bottom-right corner so the controls don't overlap the detail panel
    const startY = height - 12 - controls.length * 16
    const startX = width - 290

    for (let i = 0; i < controls.length; i++) {
      const [key, desc] = controls[i]
      this.add.text(startX, startY + i * 16, key!, {
        fontFamily: 'monospace',
        fontSize:   '10px',
        color:      ACCENT_STR,
      })
      this.add.text(startX + 74, startY + i * 16, desc!, {
        fontFamily: 'monospace',
        fontSize:   '10px',
        color:      '#555566',
      })
    }
  }

  // ── Input ────────────────────────────────────────────────────────────────

  private setupInput(): void {
    this.cursors  = this.input.keyboard!.createCursorKeys()
    this.enterKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.ENTER)
    this.xKey     = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.X)
    this.iKey     = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.I)
    this.escKey   = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.ESC)

    const numCodes = [
      Phaser.Input.Keyboard.KeyCodes.ONE,
      Phaser.Input.Keyboard.KeyCodes.TWO,
      Phaser.Input.Keyboard.KeyCodes.THREE,
      Phaser.Input.Keyboard.KeyCodes.FOUR,
      Phaser.Input.Keyboard.KeyCodes.FIVE,
      Phaser.Input.Keyboard.KeyCodes.SIX,
      Phaser.Input.Keyboard.KeyCodes.SEVEN,
      Phaser.Input.Keyboard.KeyCodes.EIGHT,
    ]
    for (const code of numCodes) {
      this.numKeys.push(this.input.keyboard!.addKey(code))
    }
  }

  update() {
    const JD = Phaser.Input.Keyboard.JustDown

    // Close
    if (JD(this.iKey) || JD(this.escKey)) {
      const callerScene = this.registry.get('equipCallerScene') as string ?? 'HomeBaseScene'
      this.registry.set('weaponInventory', [...this.inventory])
      this.scene.resume(callerScene)
      if (this.scene.isSleeping('HUDScene')) this.scene.wake('HUDScene')
      this.scene.stop('EquipScreen')
      return
    }

    // Panel switch
    if (JD(this.cursors.left!)) {
      this.panelFocus = 'left'
      this.redrawSlots()
      this.redrawInventory()
      this.refreshDetailPanel()
    }
    if (JD(this.cursors.right!)) {
      this.panelFocus = 'right'
      this.redrawSlots()
      this.redrawInventory()
      this.refreshDetailPanel()
    }

    // Number keys → select slot, and equip the current weapon immediately if one is selected
    for (let i = 0; i < 8; i++) {
      if (JD(this.numKeys[i])) {
        this.selectedSlot = i
        this.panelFocus   = 'left'
        if (this.inventory.length > 0 && this.selectedWeapon < this.inventory.length) {
          const weapon   = this.inventory[this.selectedWeapon]
          const existing = this.weaponSys.getSlot(i)
          if (this.weaponSys.equip(i, weapon)) {
            this.inventory.splice(this.selectedWeapon, 1)
            // Displaced weapon returns to inventory rather than being destroyed
            if (existing !== WeaponType.Empty) this.inventory.push(existing)
            if (this.selectedWeapon >= this.inventory.length) {
              this.selectedWeapon = Math.max(0, this.inventory.length - 1)
            }
          }
        }
        this.redrawSlots()
        this.redrawInventory()
        this.refreshDetailPanel()
      }
    }

    if (this.panelFocus === 'left') {
      if (JD(this.cursors.up!))   { this.selectedSlot = (this.selectedSlot + 7) % 8; this.redrawSlots(); this.refreshDetailPanel() }
      if (JD(this.cursors.down!)) { this.selectedSlot = (this.selectedSlot + 1) % 8; this.redrawSlots(); this.refreshDetailPanel() }
    } else {
      if (this.inventory.length > 0) {
        if (JD(this.cursors.up!))   { this.selectedWeapon = (this.selectedWeapon + this.inventory.length - 1) % this.inventory.length; this.redrawInventory(); this.refreshDetailPanel() }
        if (JD(this.cursors.down!)) { this.selectedWeapon = (this.selectedWeapon + 1) % this.inventory.length; this.redrawInventory(); this.refreshDetailPanel() }
      }
    }

    // Equip
    if (JD(this.enterKey)) {
      if (this.inventory.length > 0 && this.selectedWeapon < this.inventory.length) {
        const weapon   = this.inventory[this.selectedWeapon]
        const existing = this.weaponSys.getSlot(this.selectedSlot)
        if (this.weaponSys.equip(this.selectedSlot, weapon)) {
          this.inventory.splice(this.selectedWeapon, 1)
          if (existing !== WeaponType.Empty) this.inventory.push(existing)
          if (this.selectedWeapon >= this.inventory.length) {
            this.selectedWeapon = Math.max(0, this.inventory.length - 1)
          }
        }
        this.redrawSlots()
        this.redrawInventory()
        this.refreshDetailPanel()
      }
    }

    // Unequip → returns weapon to inventory
    if (JD(this.xKey)) {
      const current = this.weaponSys.getSlot(this.selectedSlot)
      if (current !== WeaponType.Empty) {
        this.weaponSys.unequip(this.selectedSlot)
        this.inventory.push(current)
        this.redrawSlots()
        this.redrawInventory()
        this.refreshDetailPanel()
      }
    }
  }

  // ── Redraw helpers ───────────────────────────────────────────────────────

  private redrawSlots(): void {
    for (let i = 0; i < 8; i++) {
      const circle = this.slotCircles[i]
      const icon   = this.slotIcons[i]
      const label  = this.slotLabels[i]
      const locked = !this.weaponSys.isSlotUnlocked(i)
      const weapon = this.weaponSys.getSlot(i)
      const isSel  = this.panelFocus === 'left' && i === this.selectedSlot

      icon.clear()

      if (locked) {
        circle.setStrokeStyle(1, 0x1a1a22, 0.5)
        label.setText('×').setColor('#1a1a22').setVisible(true)
        continue
      }
      if (weapon === WeaponType.Empty) {
        circle.setStrokeStyle(isSel ? 2.5 : 1.5, isSel ? ACCENT : 0x333344)
        label.setText(isSel ? '?' : '·').setColor(isSel ? ACCENT_STR : '#333344').setVisible(true)
        continue
      }
      // Weapon equipped → draw the icon, hide the letter label
      const col = WEAPON_COLORS[weapon]
      circle.setStrokeStyle(isSel ? 2.5 : 1.5, isSel ? ACCENT : col)
      drawWeaponIcon(icon, weapon, col)
      label.setVisible(false)
    }
  }

  private redrawInventory(): void {
    // Destroy previous rows
    for (const row of this.weaponRows) row.destroy(true)
    this.weaponRows = []

    const { width, height } = this.scale
    const px = width * 0.55
    const py = 120

    if (this.inventory.length === 0) {
      const empty = this.add.container(0, 0)
      empty.add(this.add.text(px, py + 24, '(no weapons)', {
        fontFamily: 'monospace',
        fontSize:   '11px',
        color:      '#333344',
      }))
      this.weaponRows.push(empty)
      return
    }

    const maxVisible = Math.floor((height - py - 60) / 36)

    for (let i = 0; i < this.inventory.length && i < maxVisible; i++) {
      const weapon  = this.inventory[i]
      const isSel   = this.panelFocus === 'right' && i === this.selectedWeapon
      const rowY    = py + i * 36
      const col     = WEAPON_COLORS[weapon]
      const colStr  = '#' + col.toString(16).padStart(6, '0')
      const name    = WEAPON_DATA.get(weapon)?.name ?? weapon

      const row = this.add.container(0, 0)

      // Always add an invisible hit area sized to the row so clicks select it
      const hit = this.add.rectangle(px + 170, rowY + 12, 340, 28, 0x000000, 0)
      hit.setInteractive({ useHandCursor: true })
      hit.on('pointerdown', () => {
        this.panelFocus = 'right'
        this.selectedWeapon = i
        this.redrawSlots()
        this.redrawInventory()
        this.refreshDetailPanel()
      })
      row.add(hit)

      // Selection highlight (drawn on top of the hit area, still passes events through)
      if (isSel) {
        const highlight = this.add.rectangle(px + 170, rowY + 12, 340, 28, 0x1a1a3e, 0.8)
        highlight.setStrokeStyle(1, ACCENT, 0.5)
        row.add(highlight)
      }

      // Icon
      const icon = this.add.graphics().setPosition(px + 16, rowY + 12)
      drawWeaponIcon(icon, weapon, col)
      row.add(icon)

      // Display name
      const nameText = this.add.text(px + 38, rowY + 4, name, {
        fontFamily: 'monospace',
        fontSize:   '12px',
        color:      isSel ? colStr : '#aaaacc',
      })
      row.add(nameText)

      // Subtitle: damage / DPS summary
      const cfg = WEAPON_DATA.get(weapon)
      const sub = `${cfg?.type ?? '—'}  ·  ${cfg?.damage ?? 0} dmg  ·  ${dpsFor(weapon)}`
      const subText = this.add.text(px + 38, rowY + 20, sub, {
        fontFamily: 'monospace',
        fontSize:   '9px',
        color:      '#555566',
      })
      row.add(subText)

      this.weaponRows.push(row)
    }
  }

  // Show full description of the currently focused weapon (slot or inventory).
  private refreshDetailPanel(): void {
    const focusedWeapon = this.getFocusedWeapon()
    this.detailIcon.clear()

    if (focusedWeapon === WeaponType.Empty) {
      this.detailName.setText('— Empty Slot —').setColor('#555566')
      this.detailStats.setText('')
      this.detailBlurb.setText(this.panelFocus === 'left'
        ? 'Select a weapon from the right panel and press ENTER or the slot number to equip.'
        : 'No weapons in inventory yet. Craft at a workbench or find them in the world.')
      return
    }

    const cfg   = WEAPON_DATA.get(focusedWeapon)
    const stats = WEAPON_STATS[focusedWeapon]
    const col   = WEAPON_COLORS[focusedWeapon]
    const colStr = '#' + col.toString(16).padStart(6, '0')

    drawWeaponIcon(this.detailIcon, focusedWeapon, col)
    this.detailName.setText(cfg?.name ?? focusedWeapon).setColor(colStr)
    const statsLine =
      `${cfg?.type ?? '—'}   damage ${cfg?.damage ?? 0}   ` +
      `${dpsFor(focusedWeapon)}   stamina ${cfg?.staminaCost ?? 0}   ` +
      `range ${stats.range}   tier ${cfg?.requiredTier ?? 0}`
    this.detailStats.setText(statsLine)
    this.detailBlurb.setText(stats.blurb)
  }

  private getFocusedWeapon(): WeaponType {
    if (this.panelFocus === 'left') {
      return this.weaponSys.getSlot(this.selectedSlot)
    }
    if (this.inventory.length === 0) return WeaponType.Empty
    return this.inventory[Math.min(this.selectedWeapon, this.inventory.length - 1)] ?? WeaponType.Empty
  }
}
