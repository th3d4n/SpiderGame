import Phaser from 'phaser'
import { saveSystem } from '../systems/SaveSystem'

export default class BootScene extends Phaser.Scene {
  constructor() {
    super({ key: 'BootScene' })
  }

  preload() {
    // Load only what's needed for the loading bar itself
    this.load.setBaseURL('/')
  }

  create() {
    // Restore saved game state into the shared registry before any scene reads it.
    saveSystem.loadIntoRegistry(this.registry)
    this.scene.start('PreloadScene')
  }
}
