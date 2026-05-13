import Phaser from 'phaser'

// Energy module — a small green capsule that restores up to 25 HP on contact.
// Walk over (or web-reel) to collect.
//
// The eerie outer glow is a separate top-level game object at depth 60 so it
// renders ABOVE the fog of war (depth 51). The capsule body itself sits at the
// default depth inside the container, so it's only visible when the player is
// close enough to have cleared the fog at that spot. The result: in the shroud
// you see a faint glow hint; nearby you see the actual orb.
export const HP_MODULE_AMOUNT = 25

const GLOW_DEPTH = 60

export default class HpModule extends Phaser.GameObjects.Container {
  private collected = false
  private glow:     Phaser.GameObjects.Arc
  private glowCore: Phaser.GameObjects.Arc

  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y)

    const color = 0x66ff99

    // Outer eerie glow — above fog, ADD blend so it brightens whatever is behind it.
    this.glow = scene.add.arc(x, y, 34, 0, 360, false, color, 0.35)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setDepth(GLOW_DEPTH)
    this.glowCore = scene.add.arc(x, y, 14, 0, 360, false, color, 0.7)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setDepth(GLOW_DEPTH)

    // Inside-container layers — drawn below fog so they're hidden until you're close
    const innerHalo = scene.add.arc(0, 0, 18, 0, 360, false, color, 0.18)
    this.add(innerHalo)

    const capsule = scene.add.graphics()
    capsule.fillStyle(0x224422, 0.95)
    capsule.fillRect(-7, -4, 14, 8)
    capsule.fillStyle(color, 1)
    capsule.fillCircle(-7, 0, 4)
    capsule.fillCircle( 7, 0, 4)
    capsule.lineStyle(1, 0xccffdd, 0.7)
    capsule.strokeCircle(-7, 0, 4)
    capsule.strokeCircle( 7, 0, 4)
    capsule.lineStyle(1.5, 0xccffdd, 1)
    capsule.lineBetween(-3, 0, 3, 0)
    capsule.lineBetween(0, -3, 0, 3)
    this.add(capsule)

    const label = scene.add.text(0, 16, '+25 HP', {
      fontFamily: 'monospace',
      fontSize:   '8px',
      color:      '#99ffcc',
    }).setOrigin(0.5, 0)
    this.add(label)

    scene.add.existing(this)
    scene.physics.add.existing(this, true)
    const pb = this.body as Phaser.Physics.Arcade.StaticBody
    pb.setCircle(14, -14, -14)

    // Idle bob — animate the container AND the glow halo together
    scene.tweens.add({
      targets:  [this, this.glow, this.glowCore],
      y:        y - 4,
      duration: 1100,
      yoyo:     true,
      repeat:   -1,
      ease:     'Sine.easeInOut',
    })

    // Pulsing outer glow
    scene.tweens.add({
      targets:  this.glow,
      alpha:    { from: 0.22, to: 0.5 },
      scaleX:   { from: 0.85, to: 1.15 },
      scaleY:   { from: 0.85, to: 1.15 },
      duration: 1400,
      yoyo:     true,
      repeat:   -1,
      ease:     'Sine.easeInOut',
    })
    // Pulsing inner halo (counter-phase so the core stays bright when outer dims)
    scene.tweens.add({
      targets:  this.glowCore,
      alpha:    { from: 0.55, to: 0.9 },
      duration: 900,
      yoyo:     true,
      repeat:   -1,
      ease:     'Sine.easeInOut',
    })

    scene.tweens.add({
      targets:  innerHalo,
      alpha:    { from: 0.12, to: 0.42 },
      duration: 900,
      yoyo:     true,
      repeat:   -1,
      ease:     'Sine.easeInOut',
    })
  }

  collect(): boolean {
    if (this.collected) return false
    this.collected = true

    this.scene.events.emit('hpModulePicked', { amount: HP_MODULE_AMOUNT, x: this.x, y: this.y })

    this.scene.tweens.killTweensOf(this)
    this.scene.tweens.killTweensOf(this.glow)
    this.scene.tweens.killTweensOf(this.glowCore)
    this.scene.tweens.add({
      targets:    [this, this.glow, this.glowCore],
      scaleX:     2.2,
      scaleY:     2.2,
      alpha:      0,
      duration:   240,
      ease:       'Back.easeIn',
      onComplete: () => {
        this.glow.destroy()
        this.glowCore.destroy()
        this.destroy()
      },
    })
    return true
  }
}
