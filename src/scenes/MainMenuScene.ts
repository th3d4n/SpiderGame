import Phaser from 'phaser'
import { saveSystem } from '../systems/SaveSystem'
import type { TextDisplayData } from './TextDisplayScene'

const OPENING_PAGES: string[] = [
  'The Den has been a spider colony\nfor as long as anyone can remember.\n\nSilk roads. Packed chambers.\nEight thousand legs, moving at once.',
  'Three seasons ago, the ants came.\n\nThey tunneled in from the west —\nslow at first, then fast. Six chambers fell.\nThe western passages went dark.',
  'Most of the colony scattered.\nYour family didn\'t.\n\nYou didn\'t either.',
  'You are Webbs.\n\nToday is your birthday.\n\nHead east — your family left something\nfor you at the end of the Den.',
]

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

    this.tweens.add({
      targets: startText,
      alpha: 0,
      duration: 600,
      yoyo: true,
      repeat: -1,
    })

    // After the opening cutscene (or if already seen) resume fires → go to HomeBase
    this.events.once('resume', () => {
      this.scene.start('HomeBaseScene')
    })

    this.input.keyboard!.once('keydown-SPACE', () => {
      const seen = this.registry.get('openingCutsceneSeen') as boolean | undefined
      if (seen) {
        this.scene.start('HomeBaseScene')
        return
      }
      this.registry.set('openingCutsceneSeen', true)
      saveSystem.saveFromRegistry(this.registry)

      const data: TextDisplayData = {
        pages:       OPENING_PAGES,
        title:       '— NO LEG LEFT TO STAND ON —',
        color:       0xaaaaff,
        callerScene: 'MainMenuScene',
      }
      this.registry.set('textDisplayData', data)
      this.scene.launch('TextDisplayScene')
    })
  }
}
