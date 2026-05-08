import Phaser from 'phaser'
import { MaterialType } from '../systems/CraftingSystem'

const MAT_COLORS: Partial<Record<MaterialType, number>> = {
  [MaterialType.SilkThread]:  0xddddff,
  [MaterialType.ChitinShard]: 0x886633,
  [MaterialType.CrystalDust]: 0x888899,
  [MaterialType.VenomGland]:  0x44aa44,
}

const MAT_LABELS: Partial<Record<MaterialType, string>> = {
  [MaterialType.SilkThread]:  'Silk Thread',
  [MaterialType.ChitinShard]: 'Chitin',
  [MaterialType.CrystalDust]: 'Crystal',
  [MaterialType.VenomGland]:  'Venom',
}

interface PickupEvent {
  materialType: MaterialType
  quantity:     number
}

const CARD_W   = 220
const CARD_H   = 50
const STAY_MS  = 1800
const SLIDE_MS = 150
const FADE_MS  = 300

export default class PickupNotification extends Phaser.Scene {
  private queue:  PickupEvent[] = []
  private showing = false

  constructor() {
    super({ key: 'PickupNotification' })
  }

  create() {
    this.queue   = []
    this.showing = false

    this.scene.manager.scenes.forEach(s => {
      if (
        s.scene.key !== 'PickupNotification' &&
        s.scene.key !== 'EquipScreen' &&
        s.scene.key !== 'HUDScene'
      ) {
        s.events.on('itemPickedUp', this.onPickedUp, this)
      }
    })

    this.events.once('shutdown', () => {
      this.scene.manager.scenes.forEach(s => {
        s.events.off('itemPickedUp', this.onPickedUp, this)
      })
    })
  }

  private onPickedUp(data: PickupEvent): void {
    this.queue.push(data)
    if (!this.showing) this.showNext()
  }

  private showNext(): void {
    if (this.queue.length === 0) {
      this.showing = false
      return
    }
    this.showing = true
    const { materialType, quantity } = this.queue.shift()!
    this.showCard(materialType, quantity)
  }

  private showCard(materialType: MaterialType, quantity: number): void {
    const { width, height } = this.scale
    const cx     = width  / 2
    const startY = height + CARD_H
    const endY   = height - 18

    const container = this.add.container(cx, startY)

    // Dark panel
    const bg = this.add.graphics()
    bg.fillStyle(0x1a1a2e, 0.85)
    bg.fillRect(-CARD_W / 2, -CARD_H / 2, CARD_W, CARD_H)
    bg.lineStyle(1, 0x444466, 0.7)
    bg.strokeRect(-CARD_W / 2, -CARD_H / 2, CARD_W, CARD_H)
    container.add(bg)

    // Colored orb
    const color   = MAT_COLORS[materialType] ?? 0xffffff
    const orbGlow = this.add.arc(-80, 0, 11, 0, 360, false, color, 0.22)
    const orb     = this.add.arc(-80, 0,  7, 0, 360, false, color)
    container.add([orbGlow, orb])

    // Material name
    const nameText = this.add.text(-60, -8,
      MAT_LABELS[materialType] ?? materialType,
      { fontFamily: 'monospace', fontSize: '13px', color: '#ddddff' },
    ).setOrigin(0, 0)
    container.add(nameText)

    // +quantity
    const colStr = '#' + (color).toString(16).padStart(6, '0')
    const qtyText = this.add.text(-60, 8,
      `+${quantity}`,
      { fontFamily: 'monospace', fontSize: '11px', color: colStr },
    ).setOrigin(0, 0)
    container.add(qtyText)

    // Slide up
    this.tweens.add({
      targets:  container,
      y:        endY,
      duration: SLIDE_MS,
      ease:     'Sine.easeOut',
      onComplete: () => {
        this.time.delayedCall(STAY_MS, () => {
          this.tweens.add({
            targets:    container,
            alpha:      0,
            duration:   FADE_MS,
            onComplete: () => {
              container.destroy()
              this.showNext()
            },
          })
        })
      },
    })
  }
}
