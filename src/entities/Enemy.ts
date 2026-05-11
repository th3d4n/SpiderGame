import Phaser from 'phaser'
import type { MaterialType } from '../systems/CraftingSystem'

// TS6 erasableSyntaxOnly: use const objects instead of enum
export const WeakPointZone = {
  Head:       'Head',
  Tail:       'Tail',
  Body:       'Body',
  Underbelly: 'Underbelly',
} as const

export type WeakPointZone = (typeof WeakPointZone)[keyof typeof WeakPointZone]

export interface LootDrop {
  material: MaterialType
  quantity: number
  chance:   number  // 0..1 — probability the drop appears
}

export interface EnemyConfig {
  health:          number
  speed:           number
  damage:          number
  weakPoints:      WeakPointZone[]
  weakMultiplier:  number   // damage multiplier when hitting a weak zone
  staggerDuration: number   // ms of stagger per hit
  bodyRadius:      number   // arcade physics circle radius
  knockbackResist?: number  // 0 = full knockback, 1 = immune; defaults to 0
  loot?:           LootDrop[]
}

export default abstract class Enemy extends Phaser.GameObjects.Container {
  public    pb:              Phaser.Physics.Arcade.Body
  protected health:          number
  protected maxHealth:       number
  protected speed:           number
  readonly  damage:          number
  readonly  knockbackResist: number
  readonly  loot:            LootDrop[]
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
    this.knockbackResist = config.knockbackResist ?? 0
    this.loot            = config.loot ?? []

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

    const mult     = this.weakPoints.includes(zone) ? this.weakMultiplier : 1
    const applied  = amount * mult
    this.health    = Math.max(0, this.health - applied)
    this.spawnDamagePopup(applied)

    if (this.health <= 0) {
      this._dead = true
      // Roll loot and announce death so the scene can spawn pickups at this position
      const dropped: LootDrop[] = this.loot.filter(d => Math.random() < d.chance)
      this.scene.events.emit('enemyDied', { x: this.x, y: this.y, loot: dropped })
      this.onDeath()   // onDeath owns the visual from here; no flash tween conflict
      return
    }

    // Only flash and stagger when the enemy survives the hit
    this.flashDamage()
    this._staggered  = true
    this.staggerTimer = this.staggerDuration
  }

  private spawnDamagePopup(amount: number): void {
    if (amount <= 0) return
    // Round so DPS ticks (fractional) still read cleanly
    const shown = Math.max(1, Math.round(amount))
    const jitter = Phaser.Math.Between(-8, 8)
    const txt = this.scene.add.text(this.x + jitter, this.y - 28, `-${shown}`, {
      fontFamily: 'monospace',
      fontSize:   '14px',
      color:      '#ffdd55',
      stroke:     '#000000',
      strokeThickness: 3,
    }).setOrigin(0.5).setDepth(60)
    this.scene.tweens.add({
      targets:    txt,
      y:          txt.y - 28,
      alpha:      0,
      duration:   650,
      ease:       'Cubic.easeOut',
      onComplete: () => txt.destroy(),
    })
  }

  applyKnockback(vx: number, vy: number): void {
    const scale = 1 - this.knockbackResist
    this.pb.setVelocity(this.pb.velocity.x + vx * scale, this.pb.velocity.y + vy * scale)
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
