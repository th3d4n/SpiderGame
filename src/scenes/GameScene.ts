import Phaser from 'phaser'
import Webbs from '../entities/Webbs'

export default class GameScene extends Phaser.Scene {
  private webbs!: Webbs
  private debugText!: Phaser.GameObjects.Text

  constructor() {
    super({ key: 'GameScene' })
  }

  create() {
    const { width, height } = this.scale

    // Temporary grid background (replaces tilemap later)
    const gridGraphics = this.add.graphics()
    gridGraphics.lineStyle(0.5, 0x333355, 0.5)
    for (let x = 0; x < width; x += 64) {
      gridGraphics.lineBetween(x, 0, x, height)
    }
    for (let y = 0; y < height; y += 64) {
      gridGraphics.lineBetween(0, y, width, y)
    }

    // Zone label
    this.add.text(20, 20, 'ZONE 1 — ANT COLONY', {
      fontFamily: 'monospace',
      fontSize: '14px',
      color: '#555577',
    })

    // Spawn Webbs at center
    this.webbs = new Webbs(this, width / 2, height / 2)

    // Debug position display
    this.debugText = this.add.text(20, height - 30, '', {
      fontFamily: 'monospace',
      fontSize: '12px',
      color: '#555577',
    })

    // Camera follows Webbs
    this.cameras.main.startFollow(this.webbs, true, 0.1, 0.1)
    this.cameras.main.setZoom(1.2)

    // World bounds
    this.physics.world.setBounds(0, 0, width, height)
  }

  update(time: number, delta: number) {
    this.webbs.update(time, delta)
    this.debugText.setText(
      `x: ${Math.round(this.webbs.x)}  y: ${Math.round(this.webbs.y)}  |  WASD to move`
    )
  }
}
