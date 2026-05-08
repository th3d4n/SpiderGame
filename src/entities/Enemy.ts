import Phaser from 'phaser'

// TS6 erasableSyntaxOnly: use const objects instead of enum
export const WeakPointZone = {
  Head:       'Head',
  Tail:       'Tail',
  Body:       'Body',
  Underbelly: 'Underbelly',
} as const

export type WeakPointZone = (typeof WeakPointZone)[keyof typeof WeakPointZone]

export interface EnemyConfig {
  health:          number
  speed:           number
  damage:          number
  weakPoints:      WeakPointZone[]
  weakMultiplier:  number   // damage multiplier when hitting a weak zone
  staggerDuration: number   // ms of stagger per hit
  bodyRadius:      number   // arcade physics circle radius
}

export default abstract class Enemy extends Phaser.GameObjects.Container {
  public    pb:              Phaser.Physics.Arcade.Body
  protected health:          number
  protected maxHealth:       number
  protected speed:           number
  readonly  damage:          number
  private   weakPoints:      WeakPointZone[]
  private   weakMultiplier:  number
  private   staggerDuration: number
  private   _staggered       = false
  private   _dead            = false
  private   staggerTimer     = 0

  constructor(
    scene:  Phaser.Scene,
    x:      number,
    y:      number,
    config: EnemyConfig,
  ) {
    super(scene, x, y)
    this.health          = config.health
    this.maxHealth       = config.health
    this.speed           = config.speed
    this.damage          = config.damage
    this.weakPoints      = config.weakPoints
    this.weakMultiplier  = config.weakMultiplier
    this.staggerDuration = config.staggerDuration

    scene.add.existing(this)
    scene.physics.add.existing(this)
    this.pb = this.body as Phaser.Physics.Arcade.Body

    // Center the circle body on the container's origin
    const r = config.bodyRadius
    this.pb.setCircle(r, -r, -r)
    // Linear drag so knockback velocity bleeds off naturally
    this.pb.setDrag(600, 600)
  }

  // ── Abstract contract ─────────────────────────────────────────────────────
  // Subclass must call buildVisuals() at the END of its own constructor,
  // after all subclass fields are initialized.
  protected abstract buildVisuals(): void
  abstract update(time: number, delta: number): void

  // ── Combat API ────────────────────────────────────────────────────────────

  takeDamage(amount: number, zone: WeakPointZone = WeakPointZone.Body): void {
    if (this._dead) return

    const mult  = this.weakPoints.includes(zone) ? this.weakMultiplier : 1
    this.health = Math.max(0, this.health - amount * mult)

    if (this.health <= 0) {
      this._dead = true
      this.onDeath()   // onDeath owns the visual from here; no flash tween conflict
      return
    }

    // Only flash and stagger when the enemy survives the hit
    this.flashDamage()
    this._staggered  = true
    this.staggerTimer = this.staggerDuration
  }

  applyKnockback(vx: number, vy: number): void {
    this.pb.setVelocity(vx, vy)
  }

  isStaggered():    boolean { return this._staggered }
  isDead():         boolean { return this._dead }
  getHealthRatio(): number  { return this.health / this.maxHealth }

  // ── Helpers for subclass update loops ────────────────────────────────────

  protected updateStagger(delta: number): void {
    if (!this._staggered) return
    this.staggerTimer -= delta
    if (this.staggerTimer <= 0) {
      this._staggered  = false
      this.staggerTimer = 0
    }
  }

  // ── Internal visual feedback ──────────────────────────────────────────────

  private flashDamage(): void {
    // Container doesn't support setTint, so blink via alpha
    this.scene.tweens.add({
      targets:    this,
      alpha:      0.2,
      duration:   55,
      yoyo:       true,
      repeat:     1,
      onComplete: () => { this.alpha = 1 },
    })
  }

  protected onDeath(): void {
    this.pb.setEnable(false)
    this.scene.tweens.add({
      targets:    this,
      alpha:      0,
      scaleX:     0.15,
      scaleY:     0.15,
      duration:   380,
      ease:       'Power2',
      onComplete: () => this.destroy(),
    })
  }
}
