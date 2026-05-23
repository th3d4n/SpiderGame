import Phaser from 'phaser'

// Energy module — a small green capsule that restores up to 25 HP on contact.
// Walk over (or web-reel) to collect.
//
// Rendering split:
//   - A small bright dot sits ABOVE the fog (depth 60) so the orb is visible
//     through the shroud as a point of light — no spreading illumination.
//   - A larger soft halo + capsule body sit INSIDE the container at default
//     depth, hidden by the fog. They only appear (lighting up the surrounding
//     dirt) once the player has cleared the fog at that spot.
export const HP_MODULE_AMOUNT = 25

const ABOVE_FOG_DEPTH = 60

export default class HpModule extends Phaser.GameObjects.Container {
  private collected = false
  private dot:     Phaser.GameObjects.Arc   // small above-fog visibility dot
  private dotCore: Phaser.GameObjects.Arc   // tight bright center

  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y)

    const color = 0x66ff99

    // Above-fog dot — small enough that no surrounding pixels are tinted. Just
    // a clear green point of light visible from inside the shroud.
    this.dot = scene.add.arc(x, y, 7, 0, 360, false, color, 0.85)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setDepth(ABOVE_FOG_DEPTH)
    this.dotCore = scene.add.arc(x, y, 3, 0, 360, false, 0xeeffee, 1)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setDepth(ABOVE_FOG_DEPTH)

    // Below-fog halo — broad soft glow visible once the area is uncovered.
    // Normal blend (no ADD) so all 9 HP modules batch in one WebGL draw call.
    const broadHalo = scene.add.arc(0, 0, 38, 0, 360, false, color, 0.32)
    this.add(broadHalo)
    const midHalo = scene.add.arc(0, 0, 22, 0, 360, false, color, 0.52)
    this.add(midHalo)

    // Capsule body — the orb itself, fully visible when the fog is cleared.
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

    // Idle bob — the container moves; the dots are top-level so they bob too
    scene.tweens.add({
      targets:  [this, this.dot, this.dotCore],
      y:        y - 4,
      duration: 1100,
      yoyo:     true,
      repeat:   -1,
      ease:     'Sine.easeInOut',
    })

    // Subtle pulse on the visible dot so it reads as "glowing"
    scene.tweens.add({
      targets:  this.dot,
      alpha:    { from: 0.7, to: 1 },
      duration: 1300,
      yoyo:     true,
      repeat:   -1,
      ease:     'Sine.easeInOut',
    })

    // Below-fog halo breathes as well (only visible once uncovered)
    scene.tweens.add({
      targets:  broadHalo,
      alpha:    { from: 0.15, to: 0.32 },
      duration: 1600,
      yoyo:     true,
      repeat:   -1,
      ease:     'Sine.easeInOut',
    })
    scene.tweens.add({
      targets:  midHalo,
      alpha:    { from: 0.28, to: 0.48 },
      duration: 1000,
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
    this.scene.tweens.killTweensOf(this.dot)
    this.scene.tweens.killTweensOf(this.dotCore)
    this.scene.tweens.add({
      targets:    [this, this.dot, this.dotCore],
      scaleX:     2.2,
      scaleY:     2.2,
      alpha:      0,
      duration:   240,
      ease:       'Back.easeIn',
      onComplete: () => {
        this.dot.destroy()
        this.dotCore.destroy()
        this.destroy()
      },
    })
    return true
  }
}
