import Phaser from 'phaser'
import { WeaponType } from '../systems/WeaponSystem'
import { WEAPON_COLORS } from '../config/WeaponData'
import { drawWeaponIcon } from './WeaponIcon'
import { HUD_LEGEND_KEY } from '../config/Controls'

const ACCENT     = 0x7777ff
const ACCENT_STR = '#7777ff'
const PANEL_BG   = 0x0d0d1a
const LOCKED_COL = 0x222233
const DIM_STR    = '#333344'

const SLOT_RING_R = 55  // radius of the slot arrangement ring
const SLOT_R      = 13  // radius of each individual slot circle
const SLOT_COUNT  = 8

interface SlotVisual {
  bg:    Phaser.GameObjects.Arc
  label: Phaser.GameObjects.Text
  icon:  Phaser.GameObjects.Graphics
}

interface BarVisual {
  fill: Phaser.GameObjects.Rectangle
  maxW: number
  barH: number
}

export default class HUDScene extends Phaser.Scene {
  private slotVisuals:   SlotVisual[] = []
  private staminaBar!:   BarVisual
  private energyBar!:    BarVisual
  private healthBar!:    BarVisual
  private healthText!:   Phaser.GameObjects.Text
  private zoneText!:     Phaser.GameObjects.Text
  private ammoText!:     Phaser.GameObjects.Text
  private ammoPanel!:    Phaser.GameObjects.Rectangle
  private legendPanel!:  Phaser.GameObjects.Container
  private hKey!:         Phaser.Input.Keyboard.Key

  constructor() {
    super({ key: 'HUDScene' })
  }

  create() {
    const { width, height } = this.scale
    this.buildZonePanel()
    this.buildHealthPanel(width)
    this.buildAmmoPanel(width)
    this.buildBarsPanel(width, height)
    this.buildWeaponRing(width, height)
    this.buildControlsLegend(width, height)
    this.hKey = this.input.keyboard!.addKey(HUD_LEGEND_KEY)
  }

  // ── Thistle ammo counter — only visible while a bow is equipped ──────────

  private buildAmmoPanel(width: number) {
    const w = 130, h = 26
    const x = width - w - 10, y = 50
    this.ammoPanel = this.add.rectangle(x + w / 2, y + h / 2, w, h, PANEL_BG, 0.9)
      .setStrokeStyle(1, 0xaa88cc)
    this.ammoText = this.add.text(x + 10, y + h / 2, '✱ THISTLES: 0', {
      fontFamily: 'monospace',
      fontSize: '11px',
      color: '#cc99ff',
    }).setOrigin(0, 0.5)
    this.ammoPanel.setVisible(false)
    this.ammoText.setVisible(false)
  }

  // ── Zone label — top left ────────────────────────────────────────────────

  private buildZonePanel() {
    const w = 220, h = 34, x = 10, y = 10
    this.add.rectangle(x + w / 2, y + h / 2, w, h, PANEL_BG, 0.9)
      .setStrokeStyle(1, ACCENT)
    this.zoneText = this.add.text(x + 12, y + h / 2, 'ANT COLONY', {
      fontFamily: 'monospace',
      fontSize: '13px',
      color: ACCENT_STR,
    }).setOrigin(0, 0.5)
  }

  // ── Health bar — top right ───────────────────────────────────────────────

  private buildHealthPanel(width: number) {
    const w = 200, h = 34, x = width - w - 10, y = 10
    this.add.rectangle(x + w / 2, y + h / 2, w, h, PANEL_BG, 0.9)
      .setStrokeStyle(1, ACCENT)
    this.add.text(x + 12, y + h / 2, 'HP', {
      fontFamily: 'monospace',
      fontSize: '11px',
      color: '#888899',
    }).setOrigin(0, 0.5)

    const barW = 120, barH = 12
    const bx = x + 38, by = y + (h - barH) / 2
    this.add.rectangle(bx + barW / 2, by + barH / 2, barW, barH, 0x220a14)
      .setStrokeStyle(1, 0x441122)
    const fill = this.add.rectangle(bx, by + barH / 2, barW, barH, 0xff4455)
      .setOrigin(0, 0.5)
    this.healthBar = { fill, maxW: barW, barH }

    this.healthText = this.add.text(x + w - 12, y + h / 2, '100/100', {
      fontFamily: 'monospace',
      fontSize: '10px',
      color: '#ccccdd',
    }).setOrigin(1, 0.5)
  }

  // ── Stamina + Energy bars — bottom left ─────────────────────────────────

  private buildBar(
    x: number, y: number,
    w: number, h: number,
    label: string, color: number
  ): BarVisual {
    const labelW = 48
    this.add.text(x, y + h / 2, label, {
      fontFamily: 'monospace',
      fontSize: '10px',
      color: '#666677',
    }).setOrigin(0, 0.5)
    this.add.rectangle(x + labelW + w / 2, y + h / 2, w, h, 0x0a0a18)
      .setStrokeStyle(1, 0x222233)
    const fill = this.add.rectangle(x + labelW, y + h / 2, w, h, color)
      .setOrigin(0, 0.5)
    return { fill, maxW: w, barH: h }
  }

  private buildBarsPanel(width: number, height: number) {
    const panelW = 268, panelH = 52
    const x = 10, y = height - panelH - 10
    // anchor bar panel left of the weapon ring
    const ringLeft = width / 2 - SLOT_RING_R - SLOT_R - 14
    const px = Math.min(x, ringLeft - panelW - 6)
    this.add.rectangle(px + panelW / 2, y + panelH / 2, panelW, panelH, PANEL_BG, 0.9)
      .setStrokeStyle(1, 0x222233)
    this.staminaBar = this.buildBar(px + 10, y + 10,  200, 10, 'STAM', 0xffcc44)
    this.energyBar  = this.buildBar(px + 10, y + 32,  200, 10, 'ENRG', ACCENT)
  }

  // ── 8 weapon slots — bottom center, mirroring Webbs' legs ───────────────

  private buildWeaponRing(width: number, height: number) {
    const cx = width / 2
    const cy = height - 78

    // outer guide ring
    this.add.arc(cx, cy, SLOT_RING_R + SLOT_R + 6, 0, 360, false, 0x000000, 0)
      .setStrokeStyle(1, 0x1a1a2e)

    // inner guide ring
    this.add.arc(cx, cy, SLOT_RING_R - SLOT_R - 4, 0, 360, false, 0x000000, 0)
      .setStrokeStyle(1, 0x1a1a2e)

    // center body marker
    this.add.arc(cx, cy, 10, 0, 360, false, 0x111122)
      .setStrokeStyle(1.5, ACCENT)
    this.add.text(cx, cy, 'W', {
      fontFamily: 'monospace',
      fontSize: '9px',
      color: ACCENT_STR,
    }).setOrigin(0.5)

    // one slot per leg, same angle formula as Webbs.ts
    for (let i = 0; i < SLOT_COUNT; i++) {
      const angle = (i / SLOT_COUNT) * Math.PI * 2
      const sx = cx + Math.cos(angle) * SLOT_RING_R
      const sy = cy + Math.sin(angle) * SLOT_RING_R

      const bg = this.add.arc(sx, sy, SLOT_R, 0, 360, false, PANEL_BG)
      bg.setStrokeStyle(1.5, LOCKED_COL)

      const icon = this.add.graphics().setPosition(sx, sy).setScale(0.55)

      const label = this.add.text(sx, sy, '×', {
        fontFamily: 'monospace',
        fontSize: '9px',
        color: DIM_STR,
      }).setOrigin(0.5)

      this.slotVisuals.push({ bg, label, icon })
    }
  }

  // ── Controls legend — bottom-right, toggled with H ──────────────────────

  private buildControlsLegend(width: number, height: number) {
    const rows = [
      ['WASD / ↑↓←→', 'Move'],
      ['1 – 8',        'Select weapon'],
      ['Click',        'Fire weapon'],
      ['Q',            'Web Thrower'],
      ['E',            'Interact'],
      ['C',            'HP Potion'],
      ['V',            'Stamina Tonic'],
      ['X',            'Max Potion'],
      ['I',            'Equipment'],
      ['M',            'Advance text'],
      ['Space',        'Skip cutscene'],
      ['H',            'Hide this panel'],
    ]
    const panelW = 230, rowH = 16, padX = 10, padY = 8
    const panelH = rows.length * rowH + padY * 2 + 18  // +18 for title row
    const px = width - panelW - 10
    const py = height - panelH - 10

    const c = this.add.container(px, py)

    const bg = this.add.rectangle(panelW / 2, panelH / 2, panelW, panelH, 0x0d0d1a, 0.92)
    bg.setStrokeStyle(1, 0x334466)
    c.add(bg)

    c.add(this.add.text(padX, padY, 'CONTROLS', {
      fontFamily: 'monospace', fontSize: '10px', color: '#7777ff',
    }))

    rows.forEach(([key, action], i) => {
      const y = padY + 16 + i * rowH
      c.add(this.add.text(padX, y, key, {
        fontFamily: 'monospace', fontSize: '10px', color: '#aaaacc',
      }))
      c.add(this.add.text(panelW - padX, y, action, {
        fontFamily: 'monospace', fontSize: '10px', color: '#556677',
      }).setOrigin(1, 0))
    })

    this.legendPanel = c
  }

  // ── Per-frame update ─────────────────────────────────────────────────────

  update() {
    const stamina:       number       = this.registry.get('stamina')       ?? 100
    const staminaMax:    number       = this.registry.get('staminaMax')    ?? 100
    const energy:        number       = this.registry.get('energy')        ?? 100
    const energyMax:     number       = this.registry.get('energyMax')     ?? 100
    const health:        number       = this.registry.get('health')        ?? 100
    const healthMax:     number       = this.registry.get('healthMax')     ?? 100
    const zoneName:      string       = this.registry.get('zoneName')      ?? 'ANT COLONY'
    const weaponSlots:   WeaponType[] = this.registry.get('weaponSlots')   ?? Array(SLOT_COUNT).fill(WeaponType.Empty)
    const unlockedCount: number       = this.registry.get('unlockedSlots') ?? 2

    if (Phaser.Input.Keyboard.JustDown(this.hKey)) {
      this.legendPanel.setVisible(!this.legendPanel.visible)
    }

    this.zoneText.setText(zoneName)
    this.setBarWidth(this.staminaBar, stamina  / (staminaMax  || 1))
    this.setBarWidth(this.energyBar,  energy   / (energyMax   || 1))
    this.updateHealthBar(health, healthMax)
    this.updateWeaponSlots(weaponSlots, unlockedCount)
    this.updateAmmo(weaponSlots)
  }

  private updateAmmo(slots: WeaponType[]): void {
    const bowEquipped = slots.some(s => s === WeaponType.Bow)
    this.ammoPanel.setVisible(bowEquipped)
    this.ammoText.setVisible(bowEquipped)
    if (!bowEquipped) return
    const inv = (this.registry.get('craftingInventory') as Record<string, number> | null) ?? {}
    const count = inv['Thistle'] ?? 0
    this.ammoText.setText(`✱ THISTLES: ${count}`)
    this.ammoText.setColor(count > 0 ? '#cc99ff' : '#cc4455')
  }

  private setBarWidth(bar: BarVisual, ratio: number): void {
    bar.fill.setSize(Math.max(0, Math.min(1, ratio)) * bar.maxW, bar.barH)
  }

  private updateHealthBar(health: number, healthMax: number): void {
    const ratio = healthMax > 0 ? health / healthMax : 0
    this.setBarWidth(this.healthBar, ratio)
    // Color shift as HP drops
    const col = ratio > 0.5 ? 0xff4455 : ratio > 0.25 ? 0xff8833 : 0xff2222
    this.healthBar.fill.setFillStyle(col)
    this.healthText.setText(`${Math.ceil(health)}/${Math.ceil(healthMax)}`)
  }

  private updateWeaponSlots(slots: WeaponType[], unlockedCount: number): void {
    for (let i = 0; i < SLOT_COUNT; i++) {
      const { bg, label, icon } = this.slotVisuals[i]
      const weapon  = slots[i]
      const unlocked = i < unlockedCount

      icon.clear()

      if (!unlocked) {
        bg.setFillStyle(0x080810)
        bg.setStrokeStyle(1.5, LOCKED_COL)
        label.setText('×').setColor(DIM_STR).setVisible(true)
        continue
      }

      if (weapon === WeaponType.Empty) {
        bg.setFillStyle(PANEL_BG)
        bg.setStrokeStyle(1.5, ACCENT)
        label.setText('·').setColor('#555566').setVisible(true)
      } else {
        const col = WEAPON_COLORS[weapon]
        bg.setFillStyle(PANEL_BG)
        bg.setStrokeStyle(1.5, col)
        drawWeaponIcon(icon, weapon, col)
        label.setVisible(false)
      }
    }
  }
}
