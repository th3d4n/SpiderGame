import Phaser from 'phaser'
import { saveSystem } from '../systems/SaveSystem'

const OPTION_LABELS = ['CONTINUE', 'NEW GAME']

export default class MainMenuScene extends Phaser.Scene {
  private selectedIndex  = 0
  private menuItems:       Phaser.GameObjects.Text[] = []
  private hasSave          = false

  constructor() {
    super({ key: 'MainMenuScene' })
  }

  create() {
    const { width, height } = this.scale
    this.hasSave        = this.registry.get('hasSave') as boolean ?? false
    this.selectedIndex  = 0
    this.menuItems      = []

    this.add.text(width / 2, height / 2 - 120, 'NO LEG LEFT TO STAND ON', {
      fontFamily: 'monospace',
      fontSize:   '32px',
      color:      '#ffffff',
    }).setOrigin(0.5)

    this.add.text(width / 2, height / 2 - 70, 'NoLegs', {
      fontFamily: 'monospace',
      fontSize:   '16px',
      color:      '#7777ff',
    }).setOrigin(0.5)

    if (this.hasSave) {
      this.buildSaveMenu(width, height)
    } else {
      this.buildNewGamePrompt(width, height)
    }
  }

  private buildNewGamePrompt(width: number, height: number): void {
    const startText = this.add.text(width / 2, height / 2 + 60, '[ PRESS SPACE TO START ]', {
      fontFamily: 'monospace',
      fontSize:   '18px',
      color:      '#aaaacc',
    }).setOrigin(0.5)

    this.tweens.add({
      targets:  startText,
      alpha:    0,
      duration: 600,
      yoyo:     true,
      repeat:   -1,
    })

    this.input.keyboard!.once('keydown-SPACE', () => {
      this.scene.start('HomeBaseScene')
    })
  }

  private buildSaveMenu(width: number, height: number): void {
    OPTION_LABELS.forEach((label, i) => {
      const txt = this.add.text(width / 2, height / 2 + 30 + i * 52, label, {
        fontFamily: 'monospace',
        fontSize:   '22px',
        color:      '#aaaacc',
      }).setOrigin(0.5)
      this.menuItems.push(txt)
    })

    this.updateCursor()

    const cursors  = this.input.keyboard!.createCursorKeys()
    const spaceKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE)

    cursors.up.on('down', () => {
      this.selectedIndex = (this.selectedIndex - 1 + this.menuItems.length) % this.menuItems.length
      this.updateCursor()
    })
    cursors.down.on('down', () => {
      this.selectedIndex = (this.selectedIndex + 1) % this.menuItems.length
      this.updateCursor()
    })
    spaceKey.once('down', () => this.confirmSelection())
  }

  private updateCursor(): void {
    this.menuItems.forEach((item, i) => {
      const active = i === this.selectedIndex
      item.setColor(active ? '#ffffff' : '#aaaacc')
      item.setText(active ? `> ${OPTION_LABELS[i]}` : `  ${OPTION_LABELS[i]}`)
    })
  }

  private confirmSelection(): void {
    if (this.selectedIndex === 0) {
      // CONTINUE — launch last saved zone
      const lastZone = this.registry.get('lastZone') as string ?? 'HomeBaseScene'
      this.scene.start(lastZone)
    } else {
      // NEW GAME — wipe save and start fresh
      saveSystem.deleteSave()
      this.registry.set('hasSave',         false)
      this.registry.set('bossesDefeated',  [])
      this.registry.set('legTier',         1)
      this.registry.set('inventory',       {})
      this.registry.set('unlockedWeapons', [])
      this.registry.set('colonyCount',     0)
      this.registry.set('lastZone',        'HomeBaseScene')
      this.scene.start('HomeBaseScene')
    }
  }
}
