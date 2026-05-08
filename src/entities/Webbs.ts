import Phaser from 'phaser'
import { WeaponSystem, WeaponType } from '../systems/WeaponSystem'
import { WEAPON_DATA, WEAPON_COLORS } from '../config/WeaponData'

const LEG_COUNT = 8
const LEG_LENGTH = 40
const SPEED = 220
const LEG_COLORS = [0xff4444, 0xff8844, 0xffff44, 0x44ff44, 0x44ffff, 0x4444ff, 0xff44ff, 0xffffff]

export default class Webbs extends Phaser.GameObjects.Container {
  private sprite!: Phaser.GameObjects.Arc
  private legs: Phaser.GameObjects.Line[] = []
  private legTips: Phaser.GameObjects.Arc[] = []
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys
  private wasd!: {
    up: Phaser.Input.Keyboard.Key
    down: Phaser.Input.Keyboard.Key
    left: Phaser.Input.Keyboard.Key
    right: Phaser.Input.Keyboard.Key
  }
  private legAngleOffset: number = 0
  public pb!: Phaser.Physics.Arcade.Body
  public stamina: number = 100
  public maxStamina: number = 100
  public energy: number = 100
  public maxEnergy: number = 100
  public facingX: number = 1
  public facingY: number = 0
  public weaponSystem: WeaponSystem

  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y)
    this.weaponSystem = new WeaponSystem(WEAPON_DATA)
    scene.add.existing(this)
    scene.physics.add.existing(this)
    this.pb = this.body as Phaser.Physics.Arcade.Body
    this.pb.setCollideWorldBounds(true)
    this.buildVisuals()
    this.setupInput()
  }

  private buildVisuals() {
    // Shadow
    const shadow = this.scene.add.ellipse(0, 8, 36, 14, 0x000000, 0.3)
    this.add(shadow)

    // Body
    this.sprite = this.scene.add.arc(0, 0, 16, 0, 360, false, 0x222222)
    this.sprite.setStrokeStyle(2, 0x7777ff)
    this.add(this.sprite)

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

      const leg = this.scene.add.line(0, 0, 0, 0, endX, endY, LEG_COLORS[i], 1)
      leg.setLineWidth(2)
      this.add(leg)
      this.legs.push(leg)

      const tip = this.scene.add.arc(endX, endY, 5, 0, 360, false, LEG_COLORS[i])
      tip.setStrokeStyle(1, 0xffffff)
      this.add(tip)
      this.legTips.push(tip)
    }
  }

  // Call after equipping or unequipping any weapon to sync tip colors.
  refreshLegColors(): void {
    for (let i = 0; i < LEG_COUNT; i++) {
      const weapon = this.weaponSystem.getSlot(i)
      const color = weapon === WeaponType.Empty ? LEG_COLORS[i] : WEAPON_COLORS[weapon]
      this.legs[i].setStrokeStyle(2, color)
      this.legTips[i].setFillStyle(color)
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
    if (moving) this.legAngleOffset += delta * 0.003

    for (let i = 0; i < LEG_COUNT; i++) {
      const baseAngle = (i / LEG_COUNT) * Math.PI * 2
      const angle = baseAngle + this.legAngleOffset
      const stretch = moving ? 1 + Math.sin(angle * 2 + this.legAngleOffset * 3) * 0.15 : 1
      const endX = Math.cos(angle) * LEG_LENGTH * stretch
      const endY = Math.sin(angle) * LEG_LENGTH * stretch

      this.legs[i].setTo(0, 0, endX, endY)
      this.legTips[i].setPosition(endX, endY)
    }
  }

  update(_time: number, delta: number) {
    let vx = 0
    let vy = 0

    if (this.wasd.left.isDown || this.cursors.left.isDown) vx = -SPEED
    if (this.wasd.right.isDown || this.cursors.right.isDown) vx = SPEED
    if (this.wasd.up.isDown || this.cursors.up.isDown) vy = -SPEED
    if (this.wasd.down.isDown || this.cursors.down.isDown) vy = SPEED

    if (vx !== 0 && vy !== 0) {
      vx *= 0.707
      vy *= 0.707
    }

    this.pb.setVelocity(vx, vy)
    if (vx !== 0 || vy !== 0) { this.facingX = vx > 0 ? 1 : vx < 0 ? -1 : 0; this.facingY = vy > 0 ? 1 : vy < 0 ? -1 : 0 }
    const dt = delta / 1000
    if (this.stamina < this.maxStamina) this.stamina = Math.min(this.maxStamina, this.stamina + 8 * dt)
    if (this.energy < this.maxEnergy) this.energy = Math.min(this.maxEnergy, this.energy + 5 * dt)

    const moving = vx !== 0 || vy !== 0
    this.updateLegs(moving, delta)
  }
}
