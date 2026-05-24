import Phaser from 'phaser'
import { WeaponSystem, WeaponType } from '../systems/WeaponSystem'
import { WEAPON_DATA, WEAPON_COLORS } from '../config/WeaponData'

const LEG_COUNT = 8
const LEG_LENGTH = 40
const SPEED = 220
const LEG_COLORS = [0xff4444, 0xff8844, 0xffff44, 0x44ff44, 0x44ffff, 0x4444ff, 0xff44ff, 0xffffff]

// Body collision radii — normal vs squeeze-mode (used by AntColonyScene when
// passing through narrow gaps). The smaller squeeze radius lets the spider
// thread through tight 30-45 px passages.
export const WEBBS_BODY_R_NORMAL  = 22
export const WEBBS_BODY_R_SQUEEZE = 14

// HP and regen
export const PLAYER_MAX_HP = 100
const REGEN_DELAY_MS = 6000
const REGEN_RATE     = 2         // HP per second — slow trickle, not a panacea

// Stamina recovery + winded behaviour
const STAMINA_REGEN  = 40        // per second — fast refill so combat flow stays brisk
const STAMINA_RECOVER_AT = 0.2   // fraction of max stamina required to clear the winded state
const WINDED_SPEED_MULT  = 0.65  // movement multiplier while winded

export default class Webbs extends Phaser.GameObjects.Container {
  private sprite!: Phaser.GameObjects.Arc
  private legs: Phaser.GameObjects.Line[] = []
  private legTips: Phaser.GameObjects.Arc[] = []
  private legWeapons: Phaser.GameObjects.Container[] = []
  private weaponAnimTimers: number[] = Array(LEG_COUNT).fill(0)
  private weaponAnimDur:   number[] = Array(LEG_COUNT).fill(0)
  private weaponAnimStyle: string[] = Array(LEG_COUNT).fill('')
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
  public hp: number = PLAYER_MAX_HP
  public hpMax: number = PLAYER_MAX_HP
  public facingX: number = 1
  public facingY: number = 0
  public weaponSystem: WeaponSystem
  // Winded once stamina hits 0 from weapon use — clears when regen climbs back
  // above STAMINA_RECOVER_AT. While winded the spider moves at WINDED_SPEED_MULT.
  public winded: boolean = false
  // Set true while Max Potion protection is active — blocks HP loss and knockback.
  public maxProtectionActive: boolean = false
  // Stamina regen multiplier — set each frame by the active scene (1 = full, 0.5 = out-of-combat colony, 0.25 = in-combat colony)
  public staminaRegenMult: number = 1
  private timeSinceDamage = 99999

  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y)
    this.weaponSystem = new WeaponSystem(WEAPON_DATA)
    scene.add.existing(this)
    scene.physics.add.existing(this)
    this.pb = this.body as Phaser.Physics.Arcade.Body
    // Default container body is 64x64; shrink to a 22-radius circle so the
    // spider's collision matches its central shell rather than its leg span.
    // Tight passages are now passable; legs visually clip walls but the body
    // doesn't catch on corners.
    this.setBodyRadius(WEBBS_BODY_R_NORMAL)
    this.pb.setCollideWorldBounds(true)
    this.buildVisuals()
    this.setupInput()
  }

  /** Resize the arcade body to a circle of the given radius (offset so it's centered on the container). */
  setBodyRadius(r: number): void {
    this.pb.setCircle(r, -r, -r)
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

      // Weapon visual container, rotated so its local +X points outward along the leg
      const weaponContainer = this.scene.add.container(endX, endY)
      weaponContainer.rotation = angle
      this.add(weaponContainer)
      this.legWeapons.push(weaponContainer)
    }
  }

  // Build the per-weapon graphic that sits at the leg tip. Local +X points outward.
  private buildWeaponGraphic(container: Phaser.GameObjects.Container, weapon: WeaponType, baseColor: number) {
    container.removeAll(true)
    if (weapon === WeaponType.Empty) return

    const g = this.scene.add.graphics()
    const c = WEAPON_COLORS[weapon] ?? baseColor

    switch (weapon) {
      case WeaponType.Sword: {
        // Blade pointing outward, small crossguard
        g.fillStyle(c, 1)
        g.fillTriangle(0, -2, 0, 2, 14, 0)
        g.lineStyle(1, 0x222222, 1)
        g.strokeTriangle(0, -2, 0, 2, 14, 0)
        // Crossguard
        g.fillStyle(0x665533, 1)
        g.fillRect(-1, -4, 2, 8)
        break
      }
      case WeaponType.Bow: {
        // Recurve bow arc + string
        g.lineStyle(2, c, 1)
        g.beginPath()
        g.arc(0, 0, 8, Phaser.Math.DegToRad(-80), Phaser.Math.DegToRad(80))
        g.strokePath()
        g.lineStyle(1, 0xeeeeee, 0.9)
        g.lineBetween(0, -8, 0, 8)
        break
      }
      case WeaponType.Axe: {
        // Handle + axe head wedge
        g.lineStyle(2, 0x553322, 1)
        g.lineBetween(0, 0, 10, 0)
        g.fillStyle(c, 1)
        g.fillTriangle(7, -8, 7, 8, 16, 0)
        g.lineStyle(1, 0x222222, 1)
        g.strokeTriangle(7, -8, 7, 8, 16, 0)
        break
      }
      case WeaponType.BoxingGloves: {
        // Toothpick — long thin shaft, sharpened tip
        g.lineStyle(2, c, 1)
        g.lineBetween(0, 0, 18, 0)
        g.fillStyle(c, 1)
        g.fillTriangle(16, -2, 16, 2, 22, 0)
        g.lineStyle(1, 0x665533, 1)
        g.strokeTriangle(16, -2, 16, 2, 22, 0)
        break
      }
      case WeaponType.Glider: {
        // Pair of small wings spread outward
        g.fillStyle(c, 0.85)
        g.fillTriangle(0, -1, 12, -7, 12, -1)
        g.fillTriangle(0,  1, 12,  7, 12,  1)
        g.lineStyle(1, 0x4477aa, 1)
        g.strokeTriangle(0, -1, 12, -7, 12, -1)
        g.strokeTriangle(0,  1, 12,  7, 12,  1)
        break
      }
      case WeaponType.FlameBreather: {
        // Nozzle barrel + tiny pilot light flicker
        g.fillStyle(0x333333, 1)
        g.fillRect(0, -3, 10, 6)
        g.lineStyle(1, 0x111111, 1)
        g.strokeRect(0, -3, 10, 6)
        g.fillStyle(c, 1)
        g.fillTriangle(10, -2, 10, 2, 16, 0)
        break
      }
      case WeaponType.WebLauncher: {
        // Spool of silk in a small housing — circle inside an open frame
        g.lineStyle(1.5, 0x333344, 1)
        g.strokeRect(0, -5, 12, 10)
        g.fillStyle(c, 0.9)
        g.fillCircle(6, 0, 3.5)
        g.lineStyle(1, 0x888899, 1)
        g.strokeCircle(6, 0, 3.5)
        // Short strand peeking out
        g.lineStyle(1, c, 1)
        g.lineBetween(12, 0, 18, 0)
        break
      }
    }
    container.add(g)
  }

  // Call after equipping or unequipping any weapon to sync tip colors + weapon graphics.
  refreshLegColors(): void {
    for (let i = 0; i < LEG_COUNT; i++) {
      const weapon = this.weaponSystem.getSlot(i)
      const color = weapon === WeaponType.Empty ? LEG_COLORS[i] : WEAPON_COLORS[weapon]
      this.legs[i].setStrokeStyle(2, color)
      this.legTips[i].setFillStyle(color)
      this.buildWeaponGraphic(this.legWeapons[i], weapon, color)
    }
  }

  // Trigger a one-shot animation on the weapon visual at the given leg slot.
  // 'stab' — quick forward thrust, 'swing' — back-and-forward arc, 'punch' — fast pulse,
  // 'draw' — pull-back like a bow string, 'flap' — wing flutter, 'spray' — recoil.
  playWeaponAnim(legSlot: number, style: string, durationMs: number): void {
    if (legSlot < 0 || legSlot >= LEG_COUNT) return
    this.weaponAnimStyle[legSlot] = style
    this.weaponAnimDur[legSlot] = durationMs
    this.weaponAnimTimers[legSlot] = durationMs
  }

  damage(amount: number): void {
    if (amount <= 0 || this.maxProtectionActive) return
    this.hp = Math.max(0, this.hp - amount)
    this.timeSinceDamage = 0
    this.playDamageFlash()
  }

  // Visible "hit" feedback — body flashes red briefly and a quick red ring
  // expands outward so the player can tell they took a hit without looking at
  // the HP bar. Lives outside the container so the squeeze tween doesn't fight
  // a scale tween here.
  private playDamageFlash(): void {
    this.sprite.setFillStyle(0xff3344)
    this.scene.time.delayedCall(140, () => {
      if (!this.sprite.active) return
      this.sprite.setFillStyle(0x222222)
    })

    const ring = this.scene.add.arc(this.x, this.y, 18, 0, 360, false, 0xff4444, 0.55)
    ring.setStrokeStyle(2, 0xff8866, 0.85)
    ring.setDepth(20)
    this.scene.tweens.add({
      targets:    ring,
      scaleX:     2.4,
      scaleY:     2.4,
      alpha:      0,
      duration:   320,
      ease:       'Quad.easeOut',
      onComplete: () => ring.destroy(),
    })
  }

  isDead(): boolean { return this.hp <= 0 }

  resetHp(amount?: number): void {
    this.hp = amount ?? this.hpMax
    this.timeSinceDamage = 99999
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

  private updateLegs(moving: boolean, delta: number, vx: number) {
    if (moving) {
      // East → clockwise (positive angle), West → counterclockwise.
      // Pure vertical movement keeps prior direction (no spin reversal).
      const dir = vx > 0 ? 1 : vx < 0 ? -1 : (this.facingX >= 0 ? 1 : -1)
      this.legAngleOffset += dir * delta * 0.003
    }

    for (let i = 0; i < LEG_COUNT; i++) {
      const baseAngle = (i / LEG_COUNT) * Math.PI * 2
      const angle = baseAngle + this.legAngleOffset
      const stretch = moving ? 1 + Math.sin(angle * 2 + this.legAngleOffset * 3) * 0.15 : 1

      // Per-weapon animation offsets — kept tiny so they read as a flick, not a reach
      let radialBoost = 0
      let extraSpin   = 0
      if (this.weaponAnimTimers[i] > 0) {
        this.weaponAnimTimers[i] -= delta
        const t01 = 1 - Math.max(0, this.weaponAnimTimers[i] / this.weaponAnimDur[i])
        const pulse = Math.sin(t01 * Math.PI)            // 0→1→0 over the animation
        switch (this.weaponAnimStyle[i]) {
          case 'stab':   radialBoost = pulse * 14; break
          case 'swing':  extraSpin   = Math.sin(t01 * Math.PI * 2) * 0.9; radialBoost = pulse * 6; break
          case 'punch':  radialBoost = pulse * 18; break
          case 'draw':   radialBoost = -pulse * 8; break
          case 'flap':   extraSpin   = Math.sin(t01 * Math.PI * 4) * 0.6; break
          case 'spray':  radialBoost = -pulse * 4; break
        }
      }

      const effectiveLength = LEG_LENGTH * stretch + radialBoost
      const endX = Math.cos(angle) * effectiveLength
      const endY = Math.sin(angle) * effectiveLength

      this.legs[i].setTo(0, 0, endX, endY)
      this.legTips[i].setPosition(endX, endY)
      this.legWeapons[i].setPosition(endX, endY)
      this.legWeapons[i].rotation = angle + extraSpin
    }
  }

  update(_time: number, delta: number) {
    const speed = this.winded ? SPEED * WINDED_SPEED_MULT : SPEED
    let vx = 0
    let vy = 0

    if (this.wasd.left.isDown || this.cursors.left.isDown) vx = -speed
    if (this.wasd.right.isDown || this.cursors.right.isDown) vx = speed
    if (this.wasd.up.isDown || this.cursors.up.isDown) vy = -speed
    if (this.wasd.down.isDown || this.cursors.down.isDown) vy = speed

    if (vx !== 0 && vy !== 0) {
      vx *= 0.707
      vy *= 0.707
    }

    this.pb.setVelocity(vx, vy)
    if (vx !== 0 || vy !== 0) { this.facingX = vx > 0 ? 1 : vx < 0 ? -1 : 0; this.facingY = vy > 0 ? 1 : vy < 0 ? -1 : 0 }
    const dt = delta / 1000
    if (this.stamina < this.maxStamina) this.stamina = Math.min(this.maxStamina, this.stamina + STAMINA_REGEN * this.staminaRegenMult * dt)
    if (this.energy < this.maxEnergy) this.energy = Math.min(this.maxEnergy, this.energy + 5 * dt)

    // Winded — engages when stamina hits 0 from a weapon, clears once we regen
    // back over STAMINA_RECOVER_AT of max. Movement is slowed while winded.
    if (this.stamina <= 0) this.winded = true
    else if (this.winded && this.stamina >= this.maxStamina * STAMINA_RECOVER_AT) this.winded = false

    // HP regen after a damage-free grace period
    this.timeSinceDamage += delta
    if (this.timeSinceDamage > REGEN_DELAY_MS && this.hp < this.hpMax && this.hp > 0) {
      this.hp = Math.min(this.hpMax, this.hp + REGEN_RATE * dt)
    }

    const moving = vx !== 0 || vy !== 0
    this.updateLegs(moving, delta, vx)
  }
}
