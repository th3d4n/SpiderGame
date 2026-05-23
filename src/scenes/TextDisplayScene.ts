import Phaser from 'phaser'
import { TEXT_ADVANCE_KEY, TEXT_SKIP_KEY } from '../config/Controls'

export interface TextDisplayData {
  pages:       string[]
  title?:      string
  color?:      number
  callerScene: string
}

const PANEL_BG = 0x0d0d1a

export default class TextDisplayScene extends Phaser.Scene {
  private displayData!: TextDisplayData
  private pageIndex     = 0
  private pageText!:    Phaser.GameObjects.Text
  private pageCounter!: Phaser.GameObjects.Text
  private mKey!:        Phaser.Input.Keyboard.Key
  private spaceKey!:    Phaser.Input.Keyboard.Key

  constructor() {
    super({ key: 'TextDisplayScene' })
  }

  create() {
    this.displayData = this.registry.get('textDisplayData') as TextDisplayData
    if (!this.displayData?.pages?.length) {
      this.displayData = { pages: ['...'], callerScene: '' }
    }
    this.pageIndex = 0

    const { width, height } = this.scale
    const cx = width  / 2
    const cy = height / 2

    if (this.displayData.callerScene) this.scene.pause(this.displayData.callerScene)

    const color    = this.displayData.color ?? 0xaaaaff
    const hexColor = `#${(color & 0xffffff).toString(16).padStart(6, '0')}`

    // Full-screen dim
    this.add.rectangle(cx, cy, width, height, 0x000000, 0.88)

    // Panel
    const panelW = 460, panelH = 280
    this.add.rectangle(cx, cy, panelW, panelH, PANEL_BG, 0.97)
      .setStrokeStyle(1.5, color)

    // Title
    if (this.displayData.title) {
      this.add.text(cx, cy - panelH / 2 + 18, this.displayData.title, {
        fontFamily: 'monospace',
        fontSize:   '10px',
        color:      hexColor,
      }).setOrigin(0.5)
    }

    // Page text — vertically centred in panel body
    this.pageText = this.add.text(cx, cy - 10, '', {
      fontFamily:  'monospace',
      fontSize:    '13px',
      color:       '#ccccdd',
      wordWrap:    { width: panelW - 64 },
      align:       'center',
      lineSpacing: 6,
    }).setOrigin(0.5)

    // Page counter
    this.pageCounter = this.add.text(cx, cy + panelH / 2 - 46, '', {
      fontFamily: 'monospace',
      fontSize:   '10px',
      color:      '#445566',
    }).setOrigin(0.5)

    // Advance/skip prompt
    const prompt = this.add.text(cx, cy + panelH / 2 - 22, '[ M ] Continue   [ Space ] Skip', {
      fontFamily: 'monospace',
      fontSize:   '10px',
      color:      '#444466',
    }).setOrigin(0.5)

    this.tweens.add({
      targets:  prompt,
      alpha:    { from: 0.45, to: 1 },
      duration: 700,
      yoyo:     true,
      repeat:   -1,
    })

    this.mKey     = this.input.keyboard!.addKey(TEXT_ADVANCE_KEY)
    this.spaceKey = this.input.keyboard!.addKey(TEXT_SKIP_KEY)

    this.showPage(0)
  }

  private showPage(index: number): void {
    this.pageIndex = Math.max(0, Math.min(index, this.displayData.pages.length - 1))
    this.pageText.setText(this.displayData.pages[this.pageIndex])
    this.pageCounter.setText(`${this.pageIndex + 1} / ${this.displayData.pages.length}`)
  }

  update() {
    if (Phaser.Input.Keyboard.JustDown(this.mKey)) {
      if (this.pageIndex < this.displayData.pages.length - 1) {
        this.showPage(this.pageIndex + 1)
      } else {
        this.dismiss()
      }
    }
    if (Phaser.Input.Keyboard.JustDown(this.spaceKey)) {
      this.dismiss()
    }
  }

  private dismiss(): void {
    if (this.displayData.callerScene) this.scene.resume(this.displayData.callerScene)
    this.scene.stop()
  }
}
