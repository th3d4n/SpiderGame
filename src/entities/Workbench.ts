import Phaser from 'phaser'

const INTERACT_RADIUS = 60
const ACCENT = 0x7777ff
const PANEL_BG = 0x0d0d1a

export default class Workbench extends Phaser.GameObjects.Container {
  private promptText!: Phaser.GameObjects.Text
  private glowRing!:   Phaser.GameObjects.Arc

  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y)
    scene.add.existing(this)
    this.buildVisuals()
    this.startGlowPulse()
  }

  private buildVisuals(): void {
    // Outer glow ring
    this.glowRing = this.scene.add.arc(0, 0, 22, 0, 360, false, 0x000000, 0)
    this.glowRing.setStrokeStyle(3, ACCENT)
    this.add(this.glowRing)

    // Table surface
    const base = this.scene.add.rectangle(0, 4, 34, 28, PANEL_BG)
    base.setStrokeStyle(1.5, ACCENT)
    this.add(base)

    // Legs
    const legL = this.scene.add.rectangle(-12, 18, 5, 14, 0x333344)
    const legR = this.scene.add.rectangle(12, 18, 5, 14, 0x333344)
    this.add([legL, legR])

    // Label
    const label = this.scene.add.text(0, 0, 'WB', {
      fontFamily: 'monospace',
      fontSize: '9px',
      color: '#7777ff',
    }).setOrigin(0.5)
    this.add(label)

    // Interaction prompt — hidden until in range
    this.promptText = this.scene.add.text(0, -34, 'E — CRAFT', {
      fontFamily: 'monospace',
      fontSize: '10px',
      color: '#aaaacc',
      backgroundColor: '#0d0d1a',
      padding: { x: 4, y: 2 },
    }).setOrigin(0.5).setVisible(false)
    this.add(this.promptText)
  }

  private startGlowPulse(): void {
    this.scene.tweens.add({
      targets:    this.glowRing,
      alpha:      { from: 0.4, to: 1 },
      duration:   900,
      yoyo:       true,
      repeat:     -1,
      ease:       'Sine.easeInOut',
    })
  }

  update(target: { x: number; y: number }, eKey: Phaser.Input.Keyboard.Key): boolean {
    const dist = Phaser.Math.Distance.Between(this.x, this.y, target.x, target.y)
    const inRange = dist <= INTERACT_RADIUS

    this.promptText.setVisible(inRange)

    if (inRange && Phaser.Input.Keyboard.JustDown(eKey)) {
      return true
    }
    return false
  }
}
