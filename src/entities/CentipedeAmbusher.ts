import Phaser from 'phaser'
import Enemy, { WeakPointZone, type EnemyConfig } from './Enemy'

type AmbusherState = 'HIDING' | 'BURSTING' | 'CHASING'

const TRIGGER_RADIUS  = 190   // px — distance that wakes the ambusher
const BURST_DURATION  = 900   // ms — emergence animation length
const CONTACT_RADIUS  = 28    // px — melee range at which it registers a hit

const CONFIG: EnemyConfig = {
  health:          30,
  speed:           130,
  damage:          12,
  weakPoints:      [WeakPointZone.Head],
  weakMultiplier:  2.0,
  staggerDuration: 420,
  bodyRadius:      14,
}

export { CONTACT_RADIUS }

export default class CentipedeAmbusher extends Enemy {
  private ambusherState: AmbusherState = 'HIDING'
  private target:    { x: number; y: number }
  private burstTimer = 0

  constructor(
    scene:  Phaser.Scene,
    x:      number,
    y:      number,
    target: { x: number; y: number },
  ) {
    super(scene, x, y, CONFIG)
    this.target = target
    this.pb.setEnable(false)  // dormant until burst
    this.buildVisuals()
    this.setAlpha(0)
  }

  // ── Visuals ───────────────────────────────────────────────────────────────
  // Head at local (0, 0); body trails in local +Y (behind direction of movement).
  // Container rotation in moveTowardTarget() orients +Y away from the target.

  protected buildVisuals(): void {
    // Subtle ground crack to hint a buried enemy
    const ring = this.scene.add.arc(0, 0, 20, 0, 360, false, 0x000000, 0)
    ring.setStrokeStyle(1, 0x3a2010)
    this.add(ring)

    // Body segments (rendered first = drawn behind head)
    const segs = [
      { y: 38, r: 5 },
      { y: 27, r: 7 },
      { y: 16, r: 9 },
    ]
    for (const s of segs) {
      const seg = this.scene.add.arc(0, s.y, s.r, 0, 360, false, 0x6b3d1e)
      seg.setStrokeStyle(1, 0x2a1408)
      this.add(seg)
    }

    // Head
    const head = this.scene.add.arc(0, 0, 12, 0, 360, false, 0x4a2810)
    head.setStrokeStyle(1.5, 0x2a1408)
    this.add(head)

    // Mandibles
    const mL = this.scene.add.line(0, 0, -2, -2, -13, -12, 0x8b6914)
    mL.setLineWidth(2)
    this.add(mL)
    const mR = this.scene.add.line(0, 0, 2, -2, 13, -12, 0x8b6914)
    mR.setLineWidth(2)
    this.add(mR)

    // Weak point indicator — glowing amber dot above head
    const wp = this.scene.add.arc(0, -10, 4, 0, 360, false, 0xffaa00)
    wp.setStrokeStyle(1, 0xffff44)
    this.add(wp)

    // Eyes
    this.add(this.scene.add.arc(-5, -4, 2, 0, 360, false, 0xff2222))
    this.add(this.scene.add.arc( 5, -4, 2, 0, 360, false, 0xff2222))
  }

  // ── Particle burst ────────────────────────────────────────────────────────

  private ensureDirtTexture(): void {
    if (this.scene.textures.exists('dirt-particle')) return
    const g = this.scene.add.graphics()
    g.fillStyle(0x8b6914, 1)
    g.fillRect(0, 0, 6, 6)
    g.generateTexture('dirt-particle', 6, 6)
    g.destroy()
  }

  private playBurstEffect(): void {
    this.ensureDirtTexture()
    const emitter = this.scene.add.particles(this.x, this.y, 'dirt-particle', {
      speed:    { min: 55, max: 195 },
      angle:    { min: 235, max: 305 },  // upward fan (270° = straight up in Phaser)
      scale:    { start: 1.8, end: 0 },
      alpha:    { start: 1,   end: 0 },
      tint:     [0x8b6914, 0xc4972f, 0x6b4226],
      lifespan: { min: 380, max: 720 },
      gravityY: 280,
      emitting: false,
    })
    emitter.explode(24)
    // Clean up after the last particle fades
    this.scene.time.delayedCall(1400, () => emitter.destroy())
  }

  // ── State transitions ─────────────────────────────────────────────────────

  private enterBurst(): void {
    this.ambusherState     = 'BURSTING'
    this.burstTimer = BURST_DURATION
    this.playBurstEffect()
    this.setScale(0.05)
    this.scene.tweens.add({
      targets:  this,
      alpha:    1,
      scaleX:   1,
      scaleY:   1,
      duration: BURST_DURATION * 0.65,
      ease:     'Back.Out',
    })
  }

  private enterChase(): void {
    this.ambusherState= 'CHASING'
    this.pb.setEnable(true)
  }

  // ── Per-frame movement ────────────────────────────────────────────────────

  private moveTowardTarget(): void {
    const angle = Phaser.Math.Angle.Between(
      this.x, this.y,
      this.target.x, this.target.y,
    )
    this.pb.setVelocity(
      Math.cos(angle) * this.speed,
      Math.sin(angle) * this.speed,
    )
    // Rotate container so local -Y faces the target (head forward, body trailing)
    this.setRotation(angle + Math.PI / 2)
  }

  // ── Main update ───────────────────────────────────────────────────────────

  update(_time: number, delta: number): void {
    if (this.isDead()) return

    switch (this.ambusherState) {
      case 'HIDING': {
        const dist = Phaser.Math.Distance.Between(
          this.x, this.y, this.target.x, this.target.y,
        )
        if (dist < TRIGGER_RADIUS) this.enterBurst()
        break
      }

      case 'BURSTING': {
        this.burstTimer -= delta
        if (this.burstTimer <= 0) this.enterChase()
        break
      }

      case 'CHASING': {
        this.updateStagger(delta)
        if (!this.isStaggered()) this.moveTowardTarget()
        break
      }
    }
  }
}
