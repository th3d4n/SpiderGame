import Phaser from 'phaser'
import { WeaponType } from '../systems/WeaponSystem'
import { createWeaponIconGraphics } from '../ui/WeaponIcon'
import { TEXT_ADVANCE_KEY, TEXT_SKIP_KEY } from '../config/Controls'
import type { TextDisplayData } from './TextDisplayScene'

export interface CelebData {
  itemName:       string
  description:    string
  color:          number
  weaponType?:    WeaponType
  callerScene:    string
  tutorialPages?: string[]
  tutorialTitle?: string
}

const WEAPON_DESCRIPTIONS: Partial<Record<WeaponType, string>> = {
  [WeaponType.Sword]:        'A blade of woven silk.\nQuick arcing swing, low stamina cost.\nReliable in close quarters.',
  [WeaponType.Bow]:          'A recurve bow of webbing.\nFires Thistles — gather them in the colony.\nLong range, medium stamina cost.',
  [WeaponType.Axe]:          'A heavy chitin cleave.\nWide 170° arc, high damage, slow swing.\nCosts stamina — use it to end a fight fast.',
  [WeaponType.BoxingGloves]: 'A sharpened toothpick.\nFast narrow stab with long reach.\nLowest stamina cost of any weapon.',
  [WeaponType.Glider]:       'Silk-web wings.\nHold fire to ride air currents across gaps.',
  [WeaponType.FlameBreather]: 'A repurposed venom gland.\nHold fire to spray a cone of flame.\nDrains energy — not stamina.',
  [WeaponType.WebLauncher]:  'The Web Thrower.\nFires sticky silk — pull yourself or items\ntoward the anchor point.',
}

const PANEL_BG   = 0x0d0d1a

export default class PickupCelebration extends Phaser.Scene {
  private mKey!:     Phaser.Input.Keyboard.Key
  private spaceKey!: Phaser.Input.Keyboard.Key
  private celeb!:    CelebData

  constructor() {
    super({ key: 'PickupCelebration' })
  }

  create() {
    this.celeb = this.registry.get('celebData') as CelebData ?? {} as CelebData

    const { width, height } = this.scale
    const cx = width  / 2
    const cy = height / 2

    if (this.celeb?.callerScene) this.scene.pause(this.celeb.callerScene)

    const color    = this.celeb?.color ?? 0xaaaaff
    const hexColor = `#${(color & 0xffffff).toString(16).padStart(6, '0')}`

    // Full-screen dim
    this.add.rectangle(cx, cy, width, height, 0x000000, 0.84)

    // Panel
    const panelW = 360, panelH = 300
    const panelBg = this.add.rectangle(cx, cy, panelW, panelH, PANEL_BG, 0.97)
    panelBg.setStrokeStyle(1.5, color)

    // "NEW DISCOVERY" header
    this.add.text(cx, cy - 128, '— NEW DISCOVERY —', {
      fontFamily: 'monospace',
      fontSize:   '10px',
      color:      '#445566',
    }).setOrigin(0.5)

    // Glow rings for item
    this.add.arc(cx, cy - 68, 46, 0, 360, false, color, 0.06)
    this.add.arc(cx, cy - 68, 28, 0, 360, false, color, 0.14)

    // Item visual — weapon icon or gem shape — inside a container for bob tween
    const itemHolder = this.add.container(cx, cy - 68)

    if (this.celeb?.weaponType) {
      const icon = createWeaponIconGraphics(this, this.celeb.weaponType, color, 3.2)
      icon.setPosition(0, 0)
      itemHolder.add(icon)
    } else {
      // Gem / crystal diamond shape
      const g = this.add.graphics()
      g.fillStyle(color, 0.9)
      g.fillTriangle(-10, 0, 10, 0, 0, -18)
      g.fillTriangle(-10, 0, 10, 0,  0,  18)
      g.lineStyle(1.5, 0xffffff, 0.4)
      g.strokeTriangle(-10, 0, 10, 0, 0, -18)
      g.strokeTriangle(-10, 0, 10, 0,  0,  18)
      g.fillStyle(0xffffff, 0.25)
      g.fillTriangle(-4, 0, 0, 0, -2, -8)
      itemHolder.add(g)
    }

    // Entrance pop
    itemHolder.setScale(0)
    this.tweens.add({
      targets:  itemHolder,
      scaleX:   1,
      scaleY:   1,
      duration: 320,
      ease:     'Back.easeOut',
    })

    // Idle bob
    this.tweens.add({
      targets:  itemHolder,
      y:        itemHolder.y - 7,
      duration: 1100,
      yoyo:     true,
      repeat:   -1,
      delay:    340,
      ease:     'Sine.easeInOut',
    })

    // Item name
    this.add.text(cx, cy - 12, this.celeb?.itemName ?? '???', {
      fontFamily: 'monospace',
      fontSize:   '20px',
      color:      hexColor,
    }).setOrigin(0.5)

    // Description — look up from weaponType if not provided
    const desc = (this.celeb?.description && this.celeb.description.length > 0)
      ? this.celeb.description
      : (this.celeb?.weaponType ? WEAPON_DESCRIPTIONS[this.celeb.weaponType] ?? '' : '')

    this.add.text(cx, cy + 22, desc, {
      fontFamily: 'monospace',
      fontSize:   '11px',
      color:      '#778899',
      wordWrap:   { width: panelW - 48 },
      align:      'center',
    }).setOrigin(0.5, 0)

    // Dismiss prompt
    const prompt = this.add.text(cx, cy + panelH / 2 - 18, '[ M ] Continue   [ Space ] Skip', {
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
  }

  update() {
    if (Phaser.Input.Keyboard.JustDown(this.mKey) || Phaser.Input.Keyboard.JustDown(this.spaceKey)) {
      this.dismiss()
    }
  }

  private dismiss(): void {
    if (this.celeb?.tutorialPages?.length) {
      // Hand off to TextDisplayScene — it resumes the caller when finished
      const textData: TextDisplayData = {
        pages:       this.celeb.tutorialPages,
        title:       this.celeb.tutorialTitle,
        color:       this.celeb.color,
        callerScene: this.celeb.callerScene,
      }
      this.registry.set('textDisplayData', textData)
      this.scene.launch('TextDisplayScene')
      this.scene.stop()
    } else {
      if (this.celeb?.callerScene) this.scene.resume(this.celeb.callerScene)
      this.scene.stop()
    }
  }
}
