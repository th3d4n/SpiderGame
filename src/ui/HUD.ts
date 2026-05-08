import Phaser from 'phaser'
import { WeaponType } from '../systems/WeaponSystem'
import { WEAPON_COLORS } from '../config/WeaponData'

const ACCENT     = 0x7777ff
const ACCENT_STR = '#7777ff'
const PANEL_BG   = 0x0d0d1a
const LOCKED_COL = 0x222233
const DIM_STR    = '#333344'

const SLOT_RING_R = 55  // radius of the slot arrangement ring
const SLOT_R      = 13  // radius of each individual slot circle
const SLOT_COUNT  = 8

const WEAPON_LABELS: Record<WeaponType, string> = {
  [WeaponType.Empty]:         '·',
  [WeaponType.Sword]:         'SW',
  [WeaponType.Bow]:           'BW',
  [WeaponType.Axe]:           'AX',
  [WeaponType.BoxingGloves]:  'BX',
  [WeaponType.Glider]:        'GL',
  [WeaponType.FlameBreather]: 'FB',
}

interface SlotVisual {
  bg:    Phaser.GameObjects.Arc
  label: Phaser.GameObjects.Text
}

interface BarVisual {
  fill: Phaser.GameObjects.Rectangle
  maxW: number
  barH: number
}

function numToHex(n: number): string {
  return '#' + n.toString(16).padStart(6, '0')
}

export default class HUDScene extends Phaser.Scene {
  private slotVisuals:  SlotVisual[] = []
  private staminaBar!:  BarVisual
  private energyBar!:   BarVisual
  private healthPips:   Phaser.GameObjects.Arc[] = []
  private zoneText!:    Phaser.GameObjects.Text

  constructor() {
    super({ key: 'HUDScene' })
  }

  create() {
    const { width, height } = this.scale
    this.buildZonePanel()
    this.buildHealthPanel(width)
    this.buildBarsPanel(width, height)
    this.buildWeaponRing(width, height)
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

  // ── Health pips — top right ──────────────────────────────────────────────

  private buildHealthPanel(width: number) {
    const w = 122, h = 34, x = width - w - 10, y = 10
    this.add.rectangle(x + w / 2, y + h / 2, w, h, PANEL_BG, 0.9)
      .setStrokeStyle(1, ACCENT)
    this.add.text(x + 12, y + h / 2, 'HP', {
      fontFamily: 'monospace',
      fontSize: '11px',
      color: '#888899',
    }).setOrigin(0, 0.5)
    for (let i = 0; i < 5; i++) {
      const pip = this.add.arc(x + 44 + i * 16, y + h / 2, 5, 0, 360, false, 0xff4455)
      pip.setStrokeStyle(1, 0x441122)
      this.healthPips.push(pip)
    }
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

      const label = this.add.text(sx, sy, '×', {
        fontFamily: 'monospace',
        fontSize: '9px',
        color: DIM_STR,
      }).setOrigin(0.5)

      this.slotVisuals.push({ bg, label })
    }
  }

  // ── Per-frame update ─────────────────────────────────────────────────────

  update() {
    const stamina:       number       = this.registry.get('stamina')       ?? 100
    const staminaMax:    number       = this.registry.get('staminaMax')    ?? 100
    const energy:        number       = this.registry.get('energy')        ?? 100
    const energyMax:     number       = this.registry.get('energyMax')     ?? 100
    const health:        number       = this.registry.get('health')        ?? 5
    const zoneName:      string       = this.registry.get('zoneName')      ?? 'ANT COLONY'
    const weaponSlots:   WeaponType[] = this.registry.get('weaponSlots')   ?? Array(SLOT_COUNT).fill(WeaponType.Empty)
    const unlockedCount: number       = this.registry.get('unlockedSlots') ?? 2

    this.zoneText.setText(zoneName)
    this.setBarWidth(this.staminaBar, stamina  / (staminaMax  || 1))
    this.setBarWidth(this.energyBar,  energy   / (energyMax   || 1))
    this.updateHealthPips(health)
    this.updateWeaponSlots(weaponSlots, unlockedCount)
  }

  private setBarWidth(bar: BarVisual, ratio: number): void {
    bar.fill.setSize(Math.max(0, Math.min(1, ratio)) * bar.maxW, bar.barH)
  }

  private updateHealthPips(health: number): void {
    for (let i = 0; i < this.healthPips.length; i++) {
      this.healthPips[i].setFillStyle(health > i ? 0xff4455 : 0x331122)
    }
  }

  private updateWeaponSlots(slots: WeaponType[], unlockedCount: number): void {
    for (let i = 0; i < SLOT_COUNT; i++) {
      const { bg, label } = this.slotVisuals[i]
      const weapon  = slots[i]
      const unlocked = i < unlockedCount

      if (!unlocked) {
        bg.setFillStyle(0x080810)
        bg.setStrokeStyle(1.5, LOCKED_COL)
        label.setText('×').setColor(DIM_STR)
        continue
      }

      if (weapon === WeaponType.Empty) {
        bg.setFillStyle(PANEL_BG)
        bg.setStrokeStyle(1.5, ACCENT)
        label.setText('·').setColor('#555566')
      } else {
        const col = WEAPON_COLORS[weapon]
        bg.setFillStyle(PANEL_BG)
        bg.setStrokeStyle(1.5, col)
        label.setText(WEAPON_LABELS[weapon]).setColor(numToHex(col))
      }
    }
  }
}
