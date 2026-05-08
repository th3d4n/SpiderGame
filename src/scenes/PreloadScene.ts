import Phaser from 'phaser'
import { saveSystem } from '../systems/SaveSystem'

export default class PreloadScene extends Phaser.Scene {
  constructor() {
    super({ key: 'PreloadScene' })
  }

  preload() {
    const { width, height } = this.scale

    // Loading bar UI
    this.add.rectangle(width / 2, height / 2, 400, 20, 0x333355)
    const bar = this.add.rectangle(width / 2 - 200, height / 2, 0, 20, 0x7777ff)
    bar.setOrigin(0, 0.5)

    this.add.text(width / 2, height / 2 - 60, 'NO LEG LEFT TO STAND ON', {
      fontFamily: 'monospace',
      fontSize: '28px',
      color: '#ffffff',
    }).setOrigin(0.5)

    const loadingText = this.add.text(width / 2, height / 2 + 40, 'Loading...', {
      fontFamily: 'monospace',
      fontSize: '14px',
      color: '#aaaacc',
    }).setOrigin(0.5)

    // Progress events
    this.load.on('progress', (value: number) => {
      bar.width = 400 * value
    })

    this.load.on('complete', () => {
      loadingText.setText('Ready!')
    })
  }

  create() {
    // Restore save state into registry before MainMenuScene checks it
    const save = saveSystem.load()
    if (save !== null) {
      this.registry.set('hasSave',         true)
      this.registry.set('bossesDefeated',  save.bossesDefeated)
      this.registry.set('legTier',         save.legTier)
      this.registry.set('inventory',       save.inventory)
      this.registry.set('unlockedWeapons', save.unlockedWeapons)
      this.registry.set('colonyCount',     save.colonyCount)
      this.registry.set('lastZone',        save.lastZone)
    } else {
      this.registry.set('hasSave',        false)
      this.registry.set('bossesDefeated', [])
      this.registry.set('legTier',        1)
      this.registry.set('inventory',      {})
      this.registry.set('unlockedWeapons', [])
      this.registry.set('colonyCount',    0)
      this.registry.set('lastZone',       'HomeBaseScene')
    }

    this.scene.start('MainMenuScene')
  }
}
