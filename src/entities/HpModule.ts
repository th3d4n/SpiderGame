import Phaser from 'phaser'

// Energy module — a small green capsule that restores up to 25 HP on contact.
// Walk over (or web-reel) to collect.
export const HP_MODULE_AMOUNT = 25

export default class HpModule extends Phaser.GameObjects.Container {
  private collected = false

  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y)

    const color = 0x66ff99

    // Outer pulse halo
    const halo = scene.add.arc(0, 0, 18, 0, 360, false, color, 0.18)
    this.add(halo)

    // Capsule body — rounded rectangle approximation using two arcs + a rect
    const capsule = scene.add.graphics()
    capsule.fillStyle(0x224422, 0.95)
    capsule.fillRect(-7, -4, 14, 8)
    capsule.fillStyle(color, 1)
    capsule.fillCircle(-7, 0, 4)
    capsule.fillCircle( 7, 0, 4)
    capsule.lineStyle(1, 0xccffdd, 0.7)
    capsule.strokeCircle(-7, 0, 4)
    capsule.strokeCircle( 7, 0, 4)
    // Tiny "+" emblem on the capsule
    capsule.lineStyle(1.5, 0xccffdd, 1)
    capsule.lineBetween(-3, 0, 3, 0)
    capsule.lineBetween(0, -3, 0, 3)
    this.add(capsule)

    // Floating label
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

    // Idle bob
    scene.tweens.add({
      targets:  this,
      y:        y - 4,
      duration: 1100,
      yoyo:     true,
      repeat:   -1,
      ease:     'Sine.easeInOut',
    })

    // Pulsing halo
    scene.tweens.add({
      targets:  halo,
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

    // Notify the scene so it can heal Webbs and play a HUD effect
    this.scene.events.emit('hpModulePicked', { amount: HP_MODULE_AMOUNT, x: this.x, y: this.y })

    this.scene.tweens.killTweensOf(this)
    this.scene.tweens.add({
      targets:    this,
      scaleX:     2.2,
      scaleY:     2.2,
      alpha:      0,
      duration:   240,
      ease:       'Back.easeIn',
      onComplete: () => this.destroy(),
    })
    return true
  }
}
