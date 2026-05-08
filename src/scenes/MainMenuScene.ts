import Phaser from 'phaser'

export default class MainMenuScene extends Phaser.Scene {
  constructor() {
    super({ key: 'MainMenuScene' })
  }

  create() {
    const { width, height } = this.scale

    this.add.text(width / 2, height / 2 - 80, 'NO LEG LEFT TO STAND ON', {
      fontFamily: 'monospace',
      fontSize: '32px',
      color: '#ffffff',
    }).setOrigin(0.5)

    this.add.text(width / 2, height / 2, 'NoLegs', {
      fontFamily: 'monospace',
      fontSize: '16px',
      color: '#7777ff',
    }).setOrigin(0.5)

    const startText = this.add.text(width / 2, height / 2 + 80, '[ PRESS SPACE TO START ]', {
      fontFamily: 'monospace',
      fontSize: '18px',
      color: '#aaaacc',
    }).setOrigin(0.5)

    // Blink the start prompt
    this.tweens.add({
      targets: startText,
      alpha: 0,
      duration: 600,
      yoyo: true,
      repeat: -1,
    })

    // Space to proceed (will start GameScene once we build it)
    this.input.keyboard!.once('keydown-SPACE', () => {
      this.add.text(width / 2, height / 2 + 140, 'Game scene coming soon...', {
        fontFamily: 'monospace',
        fontSize: '14px',
        color: '#555577',
      }).setOrigin(0.5)
    })
  }
}
