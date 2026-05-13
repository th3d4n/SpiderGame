import Phaser from 'phaser'
import Enemy, { WeakPointZone, type EnemyConfig } from './Enemy'

type AmbusherState = 'HIDING' | 'BURSTING' | 'CHASING'
type ChaseMode    = 'TRACKING' | 'WINDUP' | 'LUNGING' | 'RECOVERING'

const TRIGGER_RADIUS  = 190   // px — distance that wakes the ambusher
const BURST_DURATION  = 900   // ms — emergence animation length
const CONTACT_RADIUS  = 28    // px — melee range at which it registers a hit

// Chase tuning — slow stalk that occasionally lunges instead of orbiting
const TRACK_SPEED    = 70
const LUNGE_RANGE    = 150
const LUNGE_SPEED    = 320
const WINDUP_MS      = 320
const LUNGE_MS       = 280
const RECOVER_MS     = 620
// While tracking we re-aim slowly so the centipede doesn't spin in place when
// the player circles it.
const TRACK_TURN_RATE = 4.5  // rad/sec

const CONFIG: EnemyConfig = {
  health:          30,
  speed:           130,
  damage:          12,
  weakPoints:      [WeakPointZone.Head],
  weakMultiplier:  2.0,
  staggerDuration: 420,
  bodyRadius:      14,
  knockbackResist: 0.1,   // light, easy to push around
  loot: [
    { material: 'ChitinShard', quantity: 1, chance: 0.9 },
    { material: 'VenomGland',  quantity: 1, chance: 0.25 },
    { material: 'SilkThread',  quantity: 1, chance: 0.3  },
  ],
}

export { CONTACT_RADIUS }

export default class CentipedeAmbusher extends Enemy {
  private ambusherState: AmbusherState = 'HIDING'
  private chaseMode:     ChaseMode = 'TRACKING'
  private target:    { x: number; y: number }
  private burstTimer = 0
  private modeTimer  = 0
  private lungeVX    = 0
  private lungeVY    = 0
  private mandibleL!: Phaser.GameObjects.Line
  private mandibleR!: Phaser.GameObjects.Line
  private eyeL!: Phaser.GameObjects.Arc
  private eyeR!: Phaser.GameObjects.Arc

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
  // Container rotation orients local -Y toward the target while tracking.

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

    // Mandibles — keep references so we can animate them during the lunge tell
    this.mandibleL = this.scene.add.line(0, 0, -2, -2, -13, -12, 0x8b6914)
    this.mandibleL.setLineWidth(2)
    this.add(this.mandibleL)
    this.mandibleR = this.scene.add.line(0, 0, 2, -2, 13, -12, 0x8b6914)
    this.mandibleR.setLineWidth(2)
    this.add(this.mandibleR)

    // Weak point indicator — glowing amber dot above head
    const wp = this.scene.add.arc(0, -10, 4, 0, 360, false, 0xffaa00)
    wp.setStrokeStyle(1, 0xffff44)
    this.add(wp)

    // Eyes — kept as refs so they can flare red during the windup tell
    this.eyeL = this.scene.add.arc(-5, -4, 2, 0, 360, false, 0xff2222)
    this.eyeR = this.scene.add.arc( 5, -4, 2, 0, 360, false, 0xff2222)
    this.add([this.eyeL, this.eyeR])
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
    this.scene.time.delayedCall(1400, () => emitter.destroy())
  }

  // ── State transitions ─────────────────────────────────────────────────────

  private enterBurst(): void {
    this.ambusherState = 'BURSTING'
    this.burstTimer    = BURST_DURATION
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
    this.ambusherState = 'CHASING'
    this.chaseMode     = 'TRACKING'
    this.modeTimer     = 0
    this.pb.setEnable(true)
  }

  // ── Smooth turn helper — eases container rotation toward a target angle ──

  private turnToward(targetAngle: number, delta: number, rate: number): void {
    const cur = this.rotation
    const diff = Phaser.Math.Angle.Wrap(targetAngle - cur)
    const maxStep = rate * (delta / 1000)
    const step = Phaser.Math.Clamp(diff, -maxStep, maxStep)
    this.setRotation(cur + step)
  }

  // ── Lunge tell — flare eyes brighter, flare mandibles outward ─────────────

  private playWindupTell(): void {
    this.eyeL.setFillStyle(0xffaa44)
    this.eyeR.setFillStyle(0xffaa44)
    this.eyeL.setScale(1.4)
    this.eyeR.setScale(1.4)
    // Flare the mandibles wider
    this.mandibleL.setTo(-2, -2, -16, -14)
    this.mandibleR.setTo( 2, -2,  16, -14)
  }

  private resetWindupTell(): void {
    this.eyeL.setFillStyle(0xff2222)
    this.eyeR.setFillStyle(0xff2222)
    this.eyeL.setScale(1)
    this.eyeR.setScale(1)
    this.mandibleL.setTo(-2, -2, -13, -12)
    this.mandibleR.setTo( 2, -2,  13, -12)
  }

  // ── Chase / attack cycle ──────────────────────────────────────────────────

  private updateChase(delta: number): void {
    if (this.isStaggered()) {
      this.pb.setVelocity(0, 0)
      return
    }
    this.modeTimer -= delta

    switch (this.chaseMode) {
      case 'TRACKING': {
        const dx = this.target.x - this.x
        const dy = this.target.y - this.y
        const dist = Math.hypot(dx, dy) || 1
        const angle = Math.atan2(dy, dx)
        // Slow stalk + gentle re-aim — body no longer spins to mirror the player
        this.pb.setVelocity((dx / dist) * TRACK_SPEED, (dy / dist) * TRACK_SPEED)
        this.turnToward(angle + Math.PI / 2, delta, TRACK_TURN_RATE)

        if (dist < LUNGE_RANGE) {
          this.chaseMode = 'WINDUP'
          this.modeTimer = WINDUP_MS
          this.pb.setVelocity(0, 0)
          this.playWindupTell()
        }
        break
      }

      case 'WINDUP': {
        // Freeze in place during the tell. Camera-shake feel for the player.
        this.pb.setVelocity(0, 0)
        if (this.modeTimer <= 0) {
          // Lock orientation in toward the player at lunge start
          const angle = Phaser.Math.Angle.Between(this.x, this.y, this.target.x, this.target.y)
          this.setRotation(angle + Math.PI / 2)
          this.lungeVX = Math.cos(angle) * LUNGE_SPEED
          this.lungeVY = Math.sin(angle) * LUNGE_SPEED
          this.chaseMode = 'LUNGING'
          this.modeTimer = LUNGE_MS
        }
        break
      }

      case 'LUNGING': {
        this.pb.setVelocity(this.lungeVX, this.lungeVY)
        if (this.modeTimer <= 0) {
          this.chaseMode = 'RECOVERING'
          this.modeTimer = RECOVER_MS
          this.pb.setVelocity(0, 0)
          this.resetWindupTell()
        }
        break
      }

      case 'RECOVERING': {
        this.pb.setVelocity(0, 0)
        if (this.modeTimer <= 0) this.chaseMode = 'TRACKING'
        break
      }
    }
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
        this.updateChase(delta)
        break
      }
    }
  }
}
