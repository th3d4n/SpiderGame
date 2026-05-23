import Phaser from 'phaser'
import { MaterialType } from '../systems/CraftingSystem'

const MAT_COLORS: Partial<Record<MaterialType, number>> = {
  [MaterialType.SilkThread]:  0xddddff,
  [MaterialType.ChitinShard]: 0x886633,
  [MaterialType.CrystalDust]: 0x888899,
  [MaterialType.VenomGland]:  0x44aa44,
  [MaterialType.Thistle]:     0xcc99ff,
  [MaterialType.WebFluid]:    0x66aadd,
  [MaterialType.BoneFragment]:0xccbbaa,
  [MaterialType.Stone]:       0x888888,
  [MaterialType.Wood]:        0x7a4f2a,
  [MaterialType.BugPartsAnt]: 0x6b8c3a,
  [MaterialType.DriedFungus]: 0xb87a30,
  [MaterialType.CrystalShard]:0x88ccff,
}

const MAT_LABELS: Partial<Record<MaterialType, string>> = {
  [MaterialType.SilkThread]:  'Silk Thread',
  [MaterialType.ChitinShard]: 'Chitin',
  [MaterialType.CrystalDust]: 'Crystal Dust',
  [MaterialType.VenomGland]:  'Venom Gland',
  [MaterialType.Thistle]:     'Thistle',
  [MaterialType.WebFluid]:    'Web Fluid',
  [MaterialType.BoneFragment]:'Bone Fragment',
  [MaterialType.Stone]:       'Stone',
  [MaterialType.Wood]:        'Wood',
  [MaterialType.BugPartsAnt]: 'Ant Parts',
  [MaterialType.DriedFungus]: 'Dried Fungus',
  [MaterialType.CrystalShard]:'Crystal Shard',
}

interface PickupEvent {
  materialType: MaterialType
  quantity:     number
}

interface CraftedEvent {
  displayName: string
  color:       number
}

interface ChestLootedEvent {
  label: string
  qty:   number
}

type CardEvent =
  | { kind: 'pickup', materialType: MaterialType, quantity: number }
  | { kind: 'craft',  displayName: string, color: number }
  | { kind: 'chest',  label: string, qty: number }

const CARD_W   = 240
const CARD_H   = 50
const STAY_MS  = 1800
const SLIDE_MS = 150
const FADE_MS  = 300

export default class PickupNotification extends Phaser.Scene {
  private queue:  CardEvent[] = []
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
        s.events.on('itemPickedUp', this.onPickedUp,   this)
        s.events.on('itemCrafted',  this.onCrafted,    this)
        s.events.on('chestLooted',  this.onChestLooted, this)
      }
    })

    this.events.once('shutdown', () => {
      this.scene.manager.scenes.forEach(s => {
        s.events.off('itemPickedUp', this.onPickedUp,   this)
        s.events.off('itemCrafted',  this.onCrafted,    this)
        s.events.off('chestLooted',  this.onChestLooted, this)
      })
    })
  }

  private onPickedUp(data: PickupEvent): void {
    this.queue.push({ kind: 'pickup', materialType: data.materialType, quantity: data.quantity })
    if (!this.showing) this.showNext()
  }

  private onCrafted(data: CraftedEvent): void {
    this.queue.push({ kind: 'craft', displayName: data.displayName, color: data.color })
    if (!this.showing) this.showNext()
  }

  private onChestLooted(data: ChestLootedEvent): void {
    this.queue.push({ kind: 'chest', label: data.label, qty: data.qty })
    if (!this.showing) this.showNext()
  }

  private showNext(): void {
    if (this.queue.length === 0) {
      this.showing = false
      return
    }
    this.showing = true
    const ev = this.queue.shift()!
    if (ev.kind === 'pickup') {
      this.showCard(
        MAT_LABELS[ev.materialType] ?? ev.materialType,
        `+${ev.quantity}`,
        MAT_COLORS[ev.materialType] ?? 0xffffff,
      )
    } else if (ev.kind === 'craft') {
      this.showCard(`Crafted: ${ev.displayName}`, 'Added to inventory', ev.color)
    } else {
      this.showCard(`Found: ${ev.label}`, `+${ev.qty}`, 0xffcc44)
    }
  }

  private showCard(title: string, subtitle: string, color: number): void {
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
    const orbGlow = this.add.arc(-CARD_W / 2 + 30, 0, 11, 0, 360, false, color, 0.22)
    const orb     = this.add.arc(-CARD_W / 2 + 30, 0,  7, 0, 360, false, color)
    container.add([orbGlow, orb])

    // Title
    const titleText = this.add.text(-CARD_W / 2 + 50, -8, title, {
      fontFamily: 'monospace', fontSize: '13px', color: '#ddddff',
    }).setOrigin(0, 0)
    container.add(titleText)

    // Subtitle
    const colStr = '#' + (color).toString(16).padStart(6, '0')
    const subtitleText = this.add.text(-CARD_W / 2 + 50, 8, subtitle, {
      fontFamily: 'monospace', fontSize: '11px', color: colStr,
    }).setOrigin(0, 0)
    container.add(subtitleText)

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
