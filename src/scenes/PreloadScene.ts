import Phaser from 'phaser'

export default class PreloadScene extends Phaser.Scene {
  constructor() {
    super({ key: 'PreloadScene' })
  }

  preload() {
    const { width, height } = this.scale

    // --- Loading bar UI ---
    const barBg = this.add.rectangle(width / 2, height / 2, 400, 20, 0x333355)
    const bar = this.add.rectangle(width / 2 - 200, height / 2, 0, 20, 0x7777ff)
    bar.setOrigin(0, 0.5)

    const title = this.add.text(width / 2, height / 2 - 60, 'NO LEGS TO STAND ON', {
      fontFamily: 'monospace',
      fontSize: '28px',
      color: '#ffffff',
    }).setOrigin(0.5)

    const loadingText = this.add.text(width / 2, height / 2 + 40, 'Loading...', {
      fontFamily: 'monospace',
      fontSize: '14px',
      color: '#aaaacc',
    }).setOrigin(0.5)

    // --- Progress events ---
    this.load.on('progress', (value: number) => {
      bar.width = 400 * value
    })

    this.load.on('filechomplete', (_key: string, _type: string, _data: unknown) => {
      loadingText.setText('Loading...')
    })

    this.load.on('complete', () => {
      loadingText.setText('Ready!')
    })

    // --- Load all game assets here as we build them ---
    // this.load.image('webbs', 'assets/sprites/webbs.png')
    // this.load.tilemapTiledJSON('zone1', 'assets/tilemaps/zone1.json')
    // this.load.audio('theme', 'assets/audio/theme.mp3')
  }

  create() {
    this.scene.start('MainMenuScene')
  }
}
