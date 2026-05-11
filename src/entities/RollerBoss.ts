import Phaser from 'phaser'
import Enemy, { type EnemyConfig, WeakPointZone } from './Enemy'

const BODY_W        = 110
const BODY_H        = 64
const BODY_R        = 14
const SNOUT_R       = 20
const SNOUT_OFFSET  = 62   // local x from center to snout tip
const PATROL_SPEED  = 115
const CHARGE_SPEED  = 390
const LEFT_WALL     = 100
const RIGHT_WALL    = 1180

type AttackState = 'idle' | 'charging' | 'groundPound' | 'tailSwipe'

export default class RollerBoss extends Enemy {
  // Facing: 1 = right, -1 = left
  private facingDir    = 1
  private attackState: AttackState = 'idle'
  private attackTimer  = 0
  private attackCooldown = 0

  // Expose so scene can query
  readonly snoutOffsetX = SNOUT_OFFSET

  constructor(scene: Phaser.Scene, x: number, y: number) {
    const cfg: EnemyConfig = {
      health:          100,
      speed:           PATROL_SPEED,
      damage:          15,
      weakPoints:      [WeakPointZone.Head],
      weakMultiplier:  2,
      staggerDuration: 400,
      bodyRadius:      42,
      knockbackResist: 0.9,   // boss barely flinches
      loot: [
        { material: 'CrystalDust',  quantity: 3, chance: 1.0 },
        { material: 'BoneFragment', quantity: 2, chance: 1.0 },
        { material: 'VenomGland',   quantity: 2, chance: 1.0 },
        { material: 'ChitinShard',  quantity: 3, chance: 1.0 },
      ],
    }
    super(scene, x, y, cfg)
    this.buildVisuals()
  }

  // ── Visuals ──────────────────────────────────────────────────────────────

  protected buildVisuals(): void {
    const g = this.scene.add.graphics()

    // Main body — dark brown rounded rectangle
    g.fillStyle(0x7a5c18, 1)
    g.fillRoundedRect(-BODY_W / 2, -BODY_H / 2, BODY_W, BODY_H, BODY_R)
    g.lineStyle(3, 0x3e2d07, 1)
    g.strokeRoundedRect(-BODY_W / 2, -BODY_H / 2, BODY_W, BODY_H, BODY_R)

    // Fur texture stripes
    g.lineStyle(1.5, 0x5c4510, 0.45)
    for (let i = -3; i <= 3; i++) {
      g.lineBetween(i * 14, -BODY_H / 2 + 6, i * 14, BODY_H / 2 - 6)
    }

    this.add(g)

    // Eyes — amber with black pupils
    const eyeL = this.scene.add.arc(-24, -14, 10, 0, 360, false, 0xf0c830)
    const eyeR = this.scene.add.arc( 24, -14, 10, 0, 360, false, 0xf0c830)
    eyeL.setStrokeStyle(1.5, 0x8b7000)
    eyeR.setStrokeStyle(1.5, 0x8b7000)
    const pupilL = this.scene.add.arc(-24, -14, 5, 0, 360, false, 0x111111)
    const pupilR = this.scene.add.arc( 24, -14, 5, 0, 360, false, 0x111111)
    this.add([eyeL, eyeR, pupilL, pupilR])

    // Pink snout on the right side (flipped when facing left via scaleX = -1)
    const snout = this.scene.add.arc(SNOUT_OFFSET, 5, SNOUT_R, 0, 360, false, 0xff9fad)
    snout.setStrokeStyle(2.5, 0xff5577)
    this.add(snout)

    // Nostrils
    const nostrilL = this.scene.add.arc(SNOUT_OFFSET - 7, 3, 3, 0, 360, false, 0xcc3355)
    const nostrilR = this.scene.add.arc(SNOUT_OFFSET + 7, 3, 3, 0, 360, false, 0xcc3355)
    this.add([nostrilL, nostrilR])

    // Tail stub on the left
    const tail = this.scene.add.arc(-BODY_W / 2 - 10, 2, 12, 0, 360, false, 0x6b4f15)
    tail.setStrokeStyle(2, 0x3e2d07)
    this.add(tail)

    // Tiny legs
    for (let side = -1; side <= 1; side += 2) {
      for (let i = 0; i < 2; i++) {
        const lx = side * (BODY_W / 4 + i * 18)
        const leg = this.scene.add.graphics()
        leg.lineStyle(4, 0x5c4510, 1)
        leg.lineBetween(lx, BODY_H / 2, lx + side * 6, BODY_H / 2 + 14)
        this.add(leg)
      }
    }
  }

  // ── Weak point API ────────────────────────────────────────────────────────

  isSnoutHit(wx: number, wy: number): boolean {
    // scaleX mirrors the container, so snout world-x flips with facingDir
    const sx = this.x + SNOUT_OFFSET * this.facingDir
    const sy = this.y + 5
    return Phaser.Math.Distance.Between(wx, wy, sx, sy) <= SNOUT_R + 12
  }

  isBodyHit(wx: number, wy: number): boolean {
    return (
      Math.abs(wx - this.x) < BODY_W / 2 + 10 &&
      Math.abs(wy - this.y) < BODY_H / 2 + 10
    )
  }

  getFacingDir(): number { return this.facingDir }

  // ── AI update — scene must call setTarget() then update() each frame ─────

  private targetX = 640
  private targetY = 400

  setTarget(x: number, y: number): void {
    this.targetX = x
    this.targetY = y
  }

  update(_time: number, delta: number): void {
    if (this.isDead()) return
    this.updateStagger(delta)
    if (this.isStaggered()) {
      this.pb.setVelocity(0, 0)
      return
    }

    if (this.attackCooldown > 0) this.attackCooldown -= delta

    switch (this.attackState) {
      case 'charging':
        this.attackTimer -= delta
        if (this.attackTimer <= 0) {
          this.attackState = 'idle'
          this.pb.setVelocity(0, 0)
        }
        return

      case 'groundPound':
        this.attackTimer -= delta
        if (this.attackTimer <= 0) {
          this.attackState = 'idle'
          this.emit('groundPoundRelease', this.x, this.y)
        }
        return

      case 'tailSwipe':
        this.attackTimer -= delta
        if (this.attackTimer <= 0) {
          this.attackState = 'idle'
        }
        return

      default:
        break
    }

    // Patrol — reverse at walls
    if (this.x > RIGHT_WALL) this.facingDir = -1
    if (this.x < LEFT_WALL)  this.facingDir =  1
    this.scaleX = this.facingDir

    this.pb.setVelocity(PATROL_SPEED * this.facingDir, 0)

    // Attempt attacks
    if (this.attackCooldown <= 0) {
      const dist = Phaser.Math.Distance.Between(this.x, this.y, this.targetX, this.targetY)
      if (dist < 300) {
        this.doBodySlam()
      } else if (Math.random() < 0.004 * (delta / 16)) {
        this.doGroundPound()
      } else if (Math.random() < 0.003 * (delta / 16)) {
        this.doTailSwipe()
      }
    }
  }

  private doBodySlam(): void {
    const angle = Phaser.Math.Angle.Between(this.x, this.y, this.targetX, this.targetY)
    this.pb.setVelocity(Math.cos(angle) * CHARGE_SPEED, Math.sin(angle) * CHARGE_SPEED)
    this.attackState   = 'charging'
    this.attackTimer   = 580
    this.attackCooldown = 2600
    this.emit('bodySlam')
  }

  private doGroundPound(): void {
    this.pb.setVelocity(0, 0)
    this.attackState   = 'groundPound'
    this.attackTimer   = 700    // wind-up time before release
    this.attackCooldown = 3800
    this.emit('groundPoundWindup', this.x, this.y)
  }

  private doTailSwipe(): void {
    this.pb.setVelocity(0, 0)
    this.attackState   = 'tailSwipe'
    this.attackTimer   = 500
    this.attackCooldown = 3200
    // facingDir: tail is on the opposite side
    this.emit('tailSwipe', this.x, this.y, this.facingDir)
  }

  isBodySlamming(): boolean  { return this.attackState === 'charging' }
  isGroundPounding(): boolean { return this.attackState === 'groundPound' }

  // ── Death override ────────────────────────────────────────────────────────

  protected override onDeath(): void {
    this.pb.setEnable(false)
    // Topple and fade
    this.scene.tweens.add({
      targets:  this,
      angle:    90,
      y:        this.y + 45,
      duration: 650,
      ease:     'Power2.Out',
    })
    this.scene.tweens.add({
      targets:  this,
      alpha:    0,
      duration: 800,
      delay:    500,
      onComplete: () => this.destroy(),
    })
  }
}
