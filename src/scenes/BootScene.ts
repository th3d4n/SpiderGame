import Phaser from 'phaser'

export default class BootScene extends Phaser.Scene {
  constructor() {
    super({ key: 'BootScene' })
  }

  preload() {
    // Load only what's needed for the loading bar itself
    this.load.setBaseURL('/')
  }

  create() {
    this.scene.start('PreloadScene')
  }
}
