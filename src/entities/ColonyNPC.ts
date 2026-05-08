import Phaser from 'phaser'

const DIALOGUES = [
  'Thank you for finding us...',
  'I never should have doubted you.',
  'Those legs... they saved us all.',
  'We owe you everything, Webbs.',
  'My family is safe because of you.',
]

export default class ColonyNPC extends Phaser.GameObjects.Container {
  private spokenRecently = false
  private homeX: number
  private homeY: number

  constructor(scene: Phaser.Scene, x: number, y: number, name: string, state: number) {
    super(scene, x, y)
    this.homeX = x
    this.homeY = y
    scene.add.existing(this)
    this.setDepth(4)

    const gfx = scene.add.graphics()

    // Body
    const bodyColor = state >= 3 ? 0x7a6a5a : 0x4a4040
    gfx.fillStyle(bodyColor, 1)
    gfx.fillCircle(0, 0, 8)
    gfx.lineStyle(1, 0x888888, 0.7)
    gfx.strokeCircle(0, 0, 8)

    // Head
    gfx.fillStyle(bodyColor, 1)
    gfx.fillCircle(0, -12, 5)

    // 8 legs — 4 per side
    gfx.lineStyle(1, 0x666666, 0.8)
    for (let i = 0; i < 4; i++) {
      const t = i / 3
      const baseY = -6 + t * 10
      gfx.lineBetween(-8, baseY, -18, baseY - 8 + t * 6)
      gfx.lineBetween(8, baseY, 18, baseY - 8 + t * 6)
    }

    this.add(gfx)

    const label = scene.add.text(0, -26, name, {
      fontFamily: 'monospace',
      fontSize: '8px',
      color: '#aaaaaa',
    }).setOrigin(0.5)
    this.add(label)

    this.startIdleDrift()
  }

  private startIdleDrift(): void {
    const drift = (): void => {
      const tx = this.homeX + Phaser.Math.Between(-20, 20)
      const ty = this.homeY + Phaser.Math.Between(-8, 8)
      this.scene.tweens.add({
        targets: this,
        x: tx,
        y: ty,
        duration: Phaser.Math.Between(2000, 4000),
        ease: 'Sine.easeInOut',
        onComplete: drift,
      })
    }
    drift()
  }

  checkProximity(playerX: number, playerY: number): void {
    if (this.spokenRecently) return
    if (Phaser.Math.Distance.Between(this.x, this.y, playerX, playerY) < 80) {
      this.speak()
    }
  }

  private speak(): void {
    this.spokenRecently = true
    const line = DIALOGUES[Phaser.Math.Between(0, DIALOGUES.length - 1)]
    const bubble = this.scene.add.text(0, -44, line, {
      fontFamily: 'monospace',
      fontSize: '9px',
      color: '#ffffff',
      backgroundColor: '#00000099',
      padding: { x: 4, y: 2 },
    }).setOrigin(0.5).setDepth(10)
    this.add(bubble)

    this.scene.tweens.add({
      targets: bubble,
      alpha: 0,
      delay: 3000,
      duration: 500,
      onComplete: () => {
        this.remove(bubble, true)
        this.scene.time.delayedCall(5000, () => { this.spokenRecently = false })
      },
    })
  }
}
