import Phaser from 'phaser'
import { CraftingSystem, MaterialType } from '../systems/CraftingSystem'

const MAT_COLORS: Partial<Record<MaterialType, number>> = {
  [MaterialType.SilkThread]:  0xddddff,
  [MaterialType.ChitinShard]: 0x886633,
  [MaterialType.CrystalDust]: 0x888899,
  [MaterialType.VenomGland]:  0x44aa44,
  [MaterialType.Thistle]:     0xcc99ff,
  [MaterialType.Stone]:       0x888888,
  [MaterialType.Wood]:        0x7a4f2a,
  [MaterialType.BugPartsAnt]: 0x6b8c3a,
  [MaterialType.DriedFungus]:  0xb87a30,
  [MaterialType.CrystalShard]: 0x88ccff,
}

const MAT_LABELS: Partial<Record<MaterialType, string>> = {
  [MaterialType.SilkThread]:  'Silk Thread',
  [MaterialType.ChitinShard]: 'Chitin',
  [MaterialType.CrystalDust]: 'Crystal',
  [MaterialType.VenomGland]:  'Venom',
  [MaterialType.Thistle]:     'Thistle',
  [MaterialType.Stone]:       'Stone',
  [MaterialType.Wood]:        'Wood',
  [MaterialType.BugPartsAnt]: 'Ant Parts',
  [MaterialType.DriedFungus]:  'Dry Fungus',
  [MaterialType.CrystalShard]: 'Crystal Shard',
}

export default class Pickup extends Phaser.GameObjects.Container {
  readonly materialType: MaterialType
  readonly quantity: number
  public  pickupId: number = -1
  private craftingSystem: CraftingSystem
  private collected = false

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    materialType: MaterialType,
    quantity: number,
    craftingSystem: CraftingSystem,
  ) {
    super(scene, x, y)
    this.materialType   = materialType
    this.quantity       = quantity
    this.craftingSystem = craftingSystem

    const color = MAT_COLORS[materialType] ?? 0xffffff

    // Outer glow ring — larger, low alpha
    const glow = scene.add.arc(0, 0, 13, 0, 360, false, color, 0.22)
    this.add(glow)

    // Core orb
    const orb = scene.add.arc(0, 0, 8, 0, 360, false, color)
    orb.setStrokeStyle(1, 0xffffff, 0.5)
    this.add(orb)

    // Label below
    const label = scene.add.text(0, 16, MAT_LABELS[materialType] ?? materialType, {
      fontFamily: 'monospace',
      fontSize:   '7px',
      color:      '#aaaacc',
    }).setOrigin(0.5, 0)
    this.add(label)

    scene.add.existing(this)
    scene.physics.add.existing(this, true)
    const staticPb = this.body as Phaser.Physics.Arcade.StaticBody
    staticPb.setCircle(14, -14, -14)

    // Idle bob
    scene.tweens.add({
      targets:  this,
      y:        y - 4,
      duration: 1200,
      yoyo:     true,
      repeat:   -1,
      ease:     'Sine.easeInOut',
    })
  }

  collect(): void {
    if (this.collected) return
    this.collected = true

    this.craftingSystem.addMaterial(this.materialType, this.quantity)
    this.scene.events.emit('itemPickedUp', {
      materialType: this.materialType,
      quantity:     this.quantity,
    })

    this.scene.tweens.killTweensOf(this)
    this.scene.tweens.add({
      targets:  this,
      scaleX:   2,
      scaleY:   2,
      alpha:    0,
      duration: 240,
      ease:     'Back.easeIn',
      onComplete: () => this.destroy(),
    })
  }
}
