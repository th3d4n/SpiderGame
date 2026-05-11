import Phaser from 'phaser'
import Enemy, { type EnemyConfig, WeakPointZone } from './Enemy'

const PATROL_SPEED = 48
const CHARGE_SPEED = 290
const CHARGE_RANGE = 260

export default class BeetleTank extends Enemy {
  private targetRef:   { x: number; y: number }
  private isCharging   = false
  private chargeTimer  = 0
  private chargeCD     = 0
  private patrolDir    = 1

  constructor(scene: Phaser.Scene, x: number, y: number, target: { x: number; y: number }) {
    const cfg: EnemyConfig = {
      health:          80,
      speed:           PATROL_SPEED,
      damage:          20,
      weakPoints:      [WeakPointZone.Underbelly],
      weakMultiplier:  1.8,
      staggerDuration: 700,
      bodyRadius:      26,
    }
    super(scene, x, y, cfg)
    this.targetRef = target
    this.buildVisuals()
  }

  // ── Visuals ──────────────────────────────────────────────────────────────

  protected buildVisuals(): void {
    const g = this.scene.add.graphics()

    // Heavy carapace shell
    g.fillStyle(0x2a3a18, 1)
    g.fillEllipse(0, 0, 58, 44)
    g.lineStyle(3, 0x18260e, 1)
    g.strokeEllipse(0, 0, 58, 44)

    // Shell plate divisions
    g.lineStyle(1.5, 0x3d5228, 0.65)
    g.lineBetween(0, -20, 0, 20)
    g.lineBetween(-16, -16, -16, 16)
    g.lineBetween(16, -16, 16, 16)
    g.lineStyle(1, 0x3d5228, 0.4)
    g.lineBetween(-28, 0, 28, 0)

    // Highlight sheen on shell top
    g.fillStyle(0x4e6a30, 0.45)
    g.fillEllipse(-6, -9, 22, 16)

    this.add(g)

    // Red eyes
    const eyeL = this.scene.add.arc(-11, -14, 5, 0, 360, false, 0xff2222)
    const eyeR = this.scene.add.arc( 11, -14, 5, 0, 360, false, 0xff2222)
    eyeL.setStrokeStyle(1, 0x880000)
    eyeR.setStrokeStyle(1, 0x880000)
    this.add([eyeL, eyeR])

    // Heavy mandibles
    const mL = this.scene.add.line(0, 0, -10, 6, -26, 16, 0x18260e)
    const mR = this.scene.add.line(0, 0,  10, 6,  26, 16, 0x18260e)
    mL.setLineWidth(3.5)
    mR.setLineWidth(3.5)
    this.add([mL, mR])

    // Six stubby legs (3 per side)
    for (let side = -1; side <= 1; side += 2) {
      for (let i = 0; i < 3; i++) {
        const startX = side * 26
        const startY = -8 + i * 9
        const endX   = side * 38
        const endY   = startY + 6
        const leg = this.scene.add.line(0, 0, startX, startY, endX, endY, 0x18260e)
        leg.setLineWidth(2.5)
        this.add(leg)
      }
    }

    // Armour spike on top
    const spike = this.scene.add.triangle(0, 0, -5, -22, 5, -22, 0, -34, 0x3d5228)
    spike.setStrokeStyle(1, 0x18260e)
    this.add(spike)
  }

  // ── AI update ─────────────────────────────────────────────────────────────

  update(_time: number, delta: number): void {
    if (this.isDead()) return
    this.updateStagger(delta)

    if (this.isStaggered()) {
      this.pb.setVelocity(0, 0)
      return
    }

    if (this.chargeCD > 0) this.chargeCD -= delta

    if (this.isCharging) {
      this.chargeTimer -= delta
      if (this.chargeTimer <= 0) {
        this.isCharging = false
        this.pb.setVelocity(0, 0)
      }
      return
    }

    const dist = Phaser.Math.Distance.Between(
      this.x, this.y,
      this.targetRef.x, this.targetRef.y,
    )

    if (dist < CHARGE_RANGE && this.chargeCD <= 0) {
      // Charge at target
      const angle = Phaser.Math.Angle.Between(
        this.x, this.y,
        this.targetRef.x, this.targetRef.y,
      )
      this.pb.setVelocity(
        Math.cos(angle) * CHARGE_SPEED,
        Math.sin(angle) * CHARGE_SPEED,
      )
      this.isCharging  = true
      this.chargeTimer = 680
      this.chargeCD    = 3600
      return
    }

    // Slow patrol
    if (this.x > 2400) this.patrolDir = -1
    if (this.x < 200)  this.patrolDir =  1
    if (this.pb.blocked.right) this.patrolDir = -1
    if (this.pb.blocked.left)  this.patrolDir =  1
    this.pb.setVelocity(PATROL_SPEED * this.patrolDir, 0)
  }
}
