import Phaser from 'phaser'
import { WeaponType, WeaponSystem } from '../systems/WeaponSystem'
import { WEAPON_COLORS } from '../config/WeaponData'

const ACCENT      = 0x7777ff
const ACCENT_STR  = '#7777ff'
const PANEL_BG    = 0x0d0d1a
const SLOT_RING_R = 100  // radius of slot ring in equip screen
const SLOT_R      = 18

const WEAPON_INITIALS: Record<WeaponType, string> = {
  [WeaponType.Empty]:         '--',
  [WeaponType.Sword]:         'S',
  [WeaponType.Bow]:           'B',
  [WeaponType.Axe]:           'A',
  [WeaponType.BoxingGloves]:  'G',
  [WeaponType.Glider]:        'GL',
  [WeaponType.FlameBreather]: 'F',
}

export default class EquipScreen extends Phaser.Scene {
  // Navigation state
  private panelFocus: 'left' | 'right' = 'left'
  private selectedSlot    = 0
  private selectedWeapon  = 0

  // Visual references for dirty-redraw
  private slotCircles:  Phaser.GameObjects.Arc[]  = []
  private slotLabels:   Phaser.GameObjects.Text[] = []
  private weaponRows:   Phaser.GameObjects.Container[] = []

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
    this.slotLabels    = []
    this.weaponRows    = []

    // Read WeaponSystem and weapon inventory from registry
    this.weaponSys = this.registry.get('weaponSystemRef') as WeaponSystem
    this.inventory = (this.registry.get('weaponInventory') as WeaponType[] | undefined) ?? []

    // Pause the gameplay scene while the equip screen is open
    const callerScene = this.registry.get('equipCallerScene') as string ?? 'HomeBaseScene'
    this.scene.pause(callerScene)

    const { width, height } = this.scale

    // Dark overlay
    this.add.rectangle(width / 2, height / 2, width, height, 0x000000, 0.72)

    // Title
    this.add.text(width / 2, 28, 'LOADOUT', {
      fontFamily: 'monospace',
      fontSize:   '22px',
      color:      ACCENT_STR,
    }).setOrigin(0.5)

    this.buildLeftPanel(width, height)
    this.buildRightPanel(width)
    this.buildControls(height)
    this.setupInput()
    this.redrawSlots()
    this.redrawInventory()
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
      this.slotCircles.push(circle)

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

  private buildControls(height: number): void {
    const controls = [
      ['ENTER', 'Equip to selected slot'],
      ['X',     'Unequip selected slot'],
      ['←→',    'Switch panel'],
      ['↑↓',    'Navigate'],
      ['1-8',   'Select slot'],
      ['I/ESC', 'Close'],
    ]

    const startX = 20
    const startY = height - 12 - controls.length * 16

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
      this.scene.stop('EquipScreen')
      return
    }

    // Panel switch
    if (JD(this.cursors.left!)) {
      this.panelFocus = 'left'
      this.redrawSlots()
      this.redrawInventory()
    }
    if (JD(this.cursors.right!)) {
      this.panelFocus = 'right'
      this.redrawSlots()
      this.redrawInventory()
    }

    // Number keys → select slot
    for (let i = 0; i < 8; i++) {
      if (JD(this.numKeys[i])) {
        this.selectedSlot = i
        this.panelFocus   = 'left'
        this.redrawSlots()
        this.redrawInventory()
      }
    }

    if (this.panelFocus === 'left') {
      if (JD(this.cursors.up!))   { this.selectedSlot = (this.selectedSlot + 7) % 8; this.redrawSlots() }
      if (JD(this.cursors.down!)) { this.selectedSlot = (this.selectedSlot + 1) % 8; this.redrawSlots() }
    } else {
      if (this.inventory.length > 0) {
        if (JD(this.cursors.up!))   { this.selectedWeapon = (this.selectedWeapon + this.inventory.length - 1) % this.inventory.length; this.redrawInventory() }
        if (JD(this.cursors.down!)) { this.selectedWeapon = (this.selectedWeapon + 1) % this.inventory.length; this.redrawInventory() }
      }
    }

    // Equip
    if (JD(this.enterKey)) {
      if (this.inventory.length > 0 && this.selectedWeapon < this.inventory.length) {
        const weapon = this.inventory[this.selectedWeapon]
        this.weaponSys.equip(this.selectedSlot, weapon)
        this.inventory.splice(this.selectedWeapon, 1)
        if (this.selectedWeapon >= this.inventory.length) {
          this.selectedWeapon = Math.max(0, this.inventory.length - 1)
        }
        this.redrawSlots()
        this.redrawInventory()
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
      }
    }
  }

  // ── Redraw helpers ───────────────────────────────────────────────────────

  private redrawSlots(): void {
    for (let i = 0; i < 8; i++) {
      const circle = this.slotCircles[i]
      const label  = this.slotLabels[i]
      const weapon = this.weaponSys.getSlot(i)
      const isSel  = this.panelFocus === 'left' && i === this.selectedSlot

      if (isSel) {
        circle.setStrokeStyle(2.5, ACCENT)
      } else if (weapon !== WeaponType.Empty) {
        const col = WEAPON_COLORS[weapon]
        circle.setStrokeStyle(1.5, col)
      } else {
        circle.setStrokeStyle(1.5, 0x333344)
      }

      if (weapon !== WeaponType.Empty) {
        const col = WEAPON_COLORS[weapon]
        label.setText(WEAPON_INITIALS[weapon]).setColor('#' + col.toString(16).padStart(6, '0'))
      } else {
        label.setText(isSel ? '?' : '·').setColor(isSel ? ACCENT_STR : '#333344')
      }
    }
  }

  private redrawInventory(): void {
    // Destroy previous rows
    for (const row of this.weaponRows) row.destroy()
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

      const row = this.add.container(0, 0)

      // Selection highlight
      if (isSel) {
        const hi = this.add.rectangle(px + 170, rowY + 12, 340, 28, 0x1a1a3e, 0.8)
        hi.setStrokeStyle(1, ACCENT, 0.5)
        row.add(hi)
      }

      // Color orb
      const orb = this.add.arc(px + 12, rowY + 12, 8, 0, 360, false, col)
      row.add(orb)

      // Weapon name
      const nameText = this.add.text(px + 28, rowY + 4, weapon, {
        fontFamily: 'monospace',
        fontSize:   '13px',
        color:      isSel ? colStr : '#aaaacc',
      })
      row.add(nameText)

      // Tier indicator
      const initial = this.add.text(px + 28, rowY + 20, `[${WEAPON_INITIALS[weapon]}]`, {
        fontFamily: 'monospace',
        fontSize:   '9px',
        color:      '#444455',
      })
      row.add(initial)

      this.weaponRows.push(row)
    }
  }
}
