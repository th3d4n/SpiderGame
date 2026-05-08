import Phaser from 'phaser'

const LEG_COUNT = 8
const LEG_LENGTH = 40
const SPEED = 220
const LEG_COLORS = [0xff4444, 0xff8844, 0xffff44, 0x44ff44, 0x44ffff, 0x4444ff, 0xff44ff, 0xffffff]

export default class Webbs extends Phaser.GameObjects.Container {
  private body!: Phaser.GameObjects.Arc
  private legs: Phaser.GameObjects.Line[] = []
  private legTips: Phaser.GameObjects.Arc[] = []
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys
  private wasd!: { up: Phaser.Input.Keyboard.Key, down: Phaser.Input.Keyboard.Key, left: Phaser.Input.Keyboard.Key, right: Phaser.Input.Keyboard.Key }
  private legAngleOffset: number = 0
  private physicsBody!: Phaser.Physics.Arcade.Body

  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y)
    scene.add.existing(this)
    scene.physics.add.existing(this)

    this.physicsBody = this.body as unknown as Phaser.Physics.Arcade.Body
    this.physicsBody.setCollideWorldBounds(true)

    this.buildVisuals()
    this.setupInput()
  }

  private buildVisuals() {
    // Shadow
    const shadow = this.scene.add.ellipse(0, 8, 36, 14, 0x000000, 0.3)
    this.add(shadow)

    // Body
    this.body = this.scene.add.arc(0, 0, 16, 0, 360, false, 0x222222)
    this.body.setStrokeStyle(2, 0x7777ff)
    this.add(this.body)

    // Eyes
    const eyeL = this.scene.add.arc(-6, -5, 4, 0, 360, false, 0xffffff)
    const eyeR = this.scene.add.arc(6, -5, 4, 0, 360, false, 0xffffff)
    const pupilL = this.scene.add.arc(-6, -5, 2, 0, 360, false, 0x7777ff)
    const pupilR = this.scene.add.arc(6, -5, 2, 0, 360, false, 0x7777ff)
    this.add([eyeL, eyeR, pupilL, pupilR])

    // 8 robotic legs
    for (let i = 0; i < LEG_COUNT; i++) {
      const angle = (i / LEG_COUNT) * Math.PI * 2
      const endX = Math.cos(angle) * LEG_LENGTH
      const endY = Math.sin(angle) * LEG_LENGTH

      // Leg line
      const leg = this.scene.add.line(0, 0, 0, 0, endX, endY, LEG_COLORS[i], 1)
      leg.setLineWidth(2)
      this.add(leg)
      this.legs.push(leg)

      // Weapon tip circle at end of each leg
      const tip = this.scene.add.arc(endX, endY, 5, 0, 360, false, LEG_COLORS[i])
      tip.setStrokeStyle(1, 0xffffff)
      this.add(tip)
      this.legTips.push(tip)
    }
  }

  private setupInput() {
    this.cursors = this.scene.input.keyboard!.createCursorKeys()
    this.wasd = {
      up: this.scene.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.W),
      down: this.scene.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.S),
      left: this.scene.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.A),
      right: this.scene.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.D),
    }
  }

  private updateLegs(moving: boolean, delta: number) {
    // Legs slowly rotate when moving, idle when still
    if (moving) {
      this.legAngleOffset += delta * 0.003
    }

    for (let i = 0; i < LEG_COUNT; i++) {
      const baseAngle = (i / LEG_COUNT) * Math.PI * 2
      const angle = baseAngle + this.legAngleOffset

      // Mechanical leg "walking" effect
      const stretch = moving ? 1 + Math.sin(angle * 2 + this.legAngleOffset * 3) * 0.15 : 1
      const endX = Math.cos(angle) * LEG_LENGTH * stretch
      const endY = Math.sin(angle) * LEG_LENGTH * stretch

      this.legs[i].setTo(0, 0, endX, endY)
      this.legTips[i].setPosition(endX, endY)
    }
  }

  update(_time: number, delta: number) {
    const pb = this.physicsBody
    let vx = 0
    let vy = 0

    if (this.wasd.left.isDown || this.cursors.left.isDown) vx = -SPEED
    if (this.wasd.right.isDown || this.cursors.right.isDown) vx = SPEED
    if (this.wasd.up.isDown || this.cursors.up.isDown) vy = -SPEED
    if (this.wasd.down.isDown || this.cursors.down.isDown) vy = SPEED

    // Normalize diagonal movement
    if (vx !== 0 && vy !== 0) {
      vx *= 0.707
      vy *= 0.707
    }

    pb.setVelocity(vx, vy)

    const moving = vx !== 0 || vy !== 0
    this.updateLegs(moving, delta)
  }
}
