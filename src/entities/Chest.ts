import Phaser from 'phaser'
import { rollChestLoot } from '../config/ChestLootTable'
import type { ChestLoot } from '../config/ChestLootTable'

export type { ChestLoot }

type ChestPhase = 'idle' | 'vibrating' | 'open' | 'spent'

const INTERACT_RANGE   = 80
const MIMIC_WAKE_RANGE = 120

const CHEST_W = 30
const CHEST_H = 22

export default class Chest extends Phaser.GameObjects.Container {
  readonly isMimic:    boolean
  private chestState:  ChestPhase = 'idle'
  private lid!:        Phaser.GameObjects.Rectangle
  private vibrateTween?: Phaser.Tweens.Tween
  private eyeL?:       Phaser.GameObjects.Arc
  private eyeR?:       Phaser.GameObjects.Arc

  constructor(scene: Phaser.Scene, x: number, y: number, isMimic: boolean) {
    super(scene, x, y)
    this.isMimic = isMimic

    const bodyCol  = 0x5a3a10
    const lidCol   = 0x6a4818
    const rimCol   = 0x997733
    const latchCol = 0xffcc44

    const bodyRect = scene.add.rectangle(0, 5, CHEST_W, 14, bodyCol)
    bodyRect.setStrokeStyle(1.5, rimCol)
    this.add(bodyRect)

    this.lid = scene.add.rectangle(0, -5, CHEST_W, 10, lidCol)
    this.lid.setStrokeStyle(1.5, rimCol)
    this.add(this.lid)

    const latch = scene.add.rectangle(0, 3, 4, 5, latchCol)
    this.add(latch)

    if (isMimic) {
      this.eyeL = scene.add.arc(-8, -3, 3, 0, 360, false, 0xff2222).setAlpha(0)
      this.eyeR = scene.add.arc( 8, -3, 3, 0, 360, false, 0xff2222).setAlpha(0)
      this.add(this.eyeL)
      this.add(this.eyeR)
    }

    scene.add.existing(this)
    scene.physics.add.existing(this, true)
    const pb = this.body as Phaser.Physics.Arcade.StaticBody
    pb.setSize(CHEST_W + 4, CHEST_H + 4)
    pb.setOffset(-(CHEST_W + 4) / 2, -(CHEST_H + 4) / 2 + 2)
  }

  update(
    playerX: number,
    playerY: number,
    eJustDown: boolean,
  ): { opened?: ChestLoot[]; mimicAttack?: { damage: number; angle: number } } | null {
    if (this.chestState === 'open' || this.chestState === 'spent') return null

    const dist = Phaser.Math.Distance.Between(playerX, playerY, this.x, this.y)

    if (this.isMimic) {
      if (this.chestState === 'idle' && dist < MIMIC_WAKE_RANGE) {
        this.chestState = 'vibrating'
        this.startVibrate()
      }
      if (this.chestState === 'vibrating' && eJustDown && dist < INTERACT_RANGE) {
        this.chestState = 'spent'
        this.triggerAttackBurst()
        const angle = Phaser.Math.Angle.Between(this.x, this.y, playerX, playerY)
        return { mimicAttack: { damage: 30, angle } }
      }
    } else {
      if (this.chestState === 'idle' && eJustDown && dist < INTERACT_RANGE) {
        this.chestState = 'open'
        this.openLid()
        return { opened: rollChestLoot(3) }
      }
    }

    return null
  }

  private startVibrate(): void {
    if (this.eyeL && this.eyeR) {
      this.scene.tweens.add({
        targets: [this.eyeL, this.eyeR],
        alpha:   { from: 0.35, to: 1 },
        duration: 160,
        yoyo:    true,
        repeat:  -1,
        ease:    'Sine.easeInOut',
      })
    }

    const baseX = this.x
    this.vibrateTween = this.scene.tweens.add({
      targets:  this,
      x:        { from: baseX - 3, to: baseX + 3 },
      duration: 55,
      yoyo:     true,
      repeat:   -1,
      ease:     'Sine.easeInOut',
    })
  }

  private triggerAttackBurst(): void {
    if (this.vibrateTween) { this.vibrateTween.stop(); this.vibrateTween = undefined }

    const g = this.scene.add.graphics()
      .setDepth(this.depth + 2)
      .setPosition(this.x, this.y)
    g.fillStyle(0xff2222, 0.75)
    g.fillRect(-22, -22, 44, 44)
    this.scene.tweens.add({
      targets:    g,
      alpha:      0,
      scaleX:     3.5,
      scaleY:     3.5,
      duration:   320,
      ease:       'Quad.easeOut',
      onComplete: () => g.destroy(),
    })
    this.setVisible(false)
  }

  private openLid(): void {
    this.scene.tweens.add({
      targets:  this.lid,
      y:        this.lid.y - 18,
      angle:    -45,
      duration: 260,
      ease:     'Back.easeOut',
    })
  }
}
