import * as THREE from 'three'
import { type CollisionBody, physicsWorld } from '../core/PhysicsWorld'
import { WeaponType } from '../systems/WeaponSystem'

// Mirror of WeakPointZone from the old Enemy.ts — kept here so WeaponUseSystem3D
// can import from one place without touching the Phaser file.
export const WeakPointZone = {
  Head:       'Head',
  Tail:       'Tail',
  Body:       'Body',
  Underbelly: 'Underbelly',
} as const
export type WeakPointZone = (typeof WeakPointZone)[keyof typeof WeakPointZone]

export interface EnemyConfig3D {
  health:          number
  speed:           number   // world units/s
  damage:          number
  bodyRadius:      number   // world units
  knockbackResist: number   // 0 = none, 1 = immune
  staggerDuration: number   // seconds
  weakPoints?:     WeakPointZone[]
  weakMultiplier?: number
}

export abstract class Enemy3D {
  group: THREE.Group
  collisionBody: CollisionBody
  hp: number
  hpMax: number
  readonly config: EnemyConfig3D
  staggerTimer    = 0
  contactCooldown = 0
  stuckThistles   = 0
  knockbackTimer  = 0   // seconds remaining in forced-velocity knockback window
  knockbackVx     = 0   // initial knockback velocity stored for decay
  knockbackVz     = 0

  // Round 9 Issue 4 — physical hit reaction (visual-only wobble of group).
  private hitReactionTimer    = 0
  private hitReactionBaseDur  = 0
  private hitReactionAmp      = 0

  // Round 9b — death animation state.  Subclasses override startDeath/updateDeath
  // to provide per-weapon visuals.  isExpired() returns true once duration elapses.
  deathState: {
    weapon:   WeaponType
    elapsed:  number
    duration: number
    phase:    string
  } | null = null

  // Round 9b — global hooks wired once in main.ts.
  static onDeathParticles: ((x: number, y: number, z: number, color: number, count: number, kind: 'ichor' | 'smoke') => void) | null = null
  static onCameraShake:    ((intensity: number, duration: number) => void) | null = null

  protected threeScene:   THREE.Scene
  protected gradientMap:  THREE.Texture

  private _dying      = false
  private _deathTimer = 0
  private _flashTimer = 0

  constructor(
    threeScene:  THREE.Scene,
    x: number,
    z: number,
    config:      EnemyConfig3D,
    gradientMap: THREE.Texture,
  ) {
    this.threeScene  = threeScene
    this.config      = config
    this.gradientMap = gradientMap
    this.hp          = config.health
    this.hpMax       = config.health

    this.group = new THREE.Group()
    this.group.position.set(x, 0, z)
    this.group.renderOrder = 10   // renders above transparent walls
    threeScene.add(this.group)

    this.collisionBody = physicsWorld.add({
      x, z,
      radius:   config.bodyRadius,
      velocity: { x: 0, z: 0 },
      isStatic: false,
      enabled:  true,
      drag:     6,   // wu/s² ≈ Phaser drag(600,600) at SCALE=0.01
    })

  }

  // ── Subclass hooks ─────────────────────────────────────────────────────────
  abstract buildVisuals(): void
  abstract updateAI(delta: number, playerX: number, playerZ: number): void
  // Called when damage flash toggles — subclass tints its main mesh.
  protected setFlashColor(_on: boolean): void {}

  // ── Combat API ─────────────────────────────────────────────────────────────

  takeDamage(amount: number, zone?: WeakPointZone, killingWeapon?: WeaponType): void {
    if (this.deathState || this._dying || this.hp <= 0) return
    let dmg = amount
    if (
      zone &&
      this.config.weakPoints?.includes(zone) &&
      this.config.weakMultiplier
    ) {
      dmg *= this.config.weakMultiplier
    }
    this.hp = Math.max(0, this.hp - dmg)
    this.staggerTimer = this.config.staggerDuration
    this._flashTimer  = 0.12
    if (this.hp <= 0) this.startDeath(killingWeapon ?? WeaponType.Empty)
  }

  applyKnockback(vx: number, vz: number): void {
    if (this._dying) return
    const s = 1 - this.config.knockbackResist
    this.knockbackVx    = vx * s
    this.knockbackVz    = vz * s
    this.knockbackTimer = 0.25
    this.collisionBody.velocity.x = this.knockbackVx
    this.collisionBody.velocity.z = this.knockbackVz
  }

  // Round 9 Issue 4 — start a physical hit-reaction wobble.  Different styles
  // get different durations and amplitudes so axe slams hit visibly harder
  // than a stab.  The wobble is a per-frame random XZ offset applied to the
  // group in syncPosition() — collision body is unaffected.
  startHitReaction(style: 'small' | 'medium' | 'large' | 'stab' | 'sword' | 'axe'): void {
    let dur = 0.15, amp = 0.05
    switch (style) {
      case 'stab':   dur = 0.12; amp = 0.04; break
      case 'small':  dur = 0.15; amp = 0.05; break
      case 'sword':  dur = 0.20; amp = 0.10; break
      case 'medium': dur = 0.22; amp = 0.10; break
      case 'axe':    dur = 0.35; amp = 0.20; break
      case 'large':  dur = 0.30; amp = 0.15; break
    }
    this.hitReactionTimer   = dur
    this.hitReactionBaseDur = dur
    this.hitReactionAmp     = amp
  }

  addStuckThistle(): void { this.stuckThistles++ }
  isDead():          boolean { return this.hp <= 0 || this.deathState !== null }
  isExpired():       boolean {
    if (this.deathState) return this.deathState.elapsed >= this.deathState.duration
    return this._dying && this._deathTimer > 0.5
  }

  // ── Per-frame update ───────────────────────────────────────────────────────

  update(delta: number, playerX: number, playerZ: number): void {
    // Round 9b — once a death animation is active, the subclass drives motion.
    if (this.deathState) { this.updateDeath(delta); return }

    this.contactCooldown = Math.max(0, this.contactCooldown - delta)
    if (this.hitReactionTimer > 0) this.hitReactionTimer = Math.max(0, this.hitReactionTimer - delta)

    if (this._dying) {
      this._deathTimer += delta
      const t = Math.min(1, this._deathTimer / 0.38)
      this.group.scale.setScalar(Math.max(0.02, 1 - t))
      return
    }

    if (this._flashTimer > 0) {
      this._flashTimer -= delta
      this.setFlashColor(this._flashTimer > 0)
    }

    // ── Knockback window: force decaying velocity, skip AI ─────────────────
    if (this.knockbackTimer > 0) {
      this.knockbackTimer = Math.max(0, this.knockbackTimer - delta)
      const frac = this.knockbackTimer / 0.25   // 1 → 0
      this.collisionBody.velocity.x = this.knockbackVx * frac
      this.collisionBody.velocity.z = this.knockbackVz * frac
      this.staggerTimer = Math.max(0, this.staggerTimer - delta)
      return
    }

    this.staggerTimer = Math.max(0, this.staggerTimer - delta)
    if (this.staggerTimer <= 0) {
      this.updateAI(delta, playerX, playerZ)
    }
  }

  // Sync 3D group from physics body — call after physicsWorld.update().
  // Round 9 Issue 4: hit-reaction wobble layered on top (visual only).
  // Round 9b: skip while death animation drives the group transform itself.
  syncPosition(): void {
    if (this._dying || this.deathState) return
    let ox = 0, oz = 0
    if (this.hitReactionTimer > 0 && this.hitReactionBaseDur > 0) {
      const k = this.hitReactionTimer / this.hitReactionBaseDur
      ox = (Math.random() - 0.5) * this.hitReactionAmp * k
      oz = (Math.random() - 0.5) * this.hitReactionAmp * k
    }
    this.group.position.x = this.collisionBody.x + ox
    this.group.position.z = this.collisionBody.z + oz
  }

  // Remove from scene and physics — call when isExpired().
  cleanup(): void {
    this.group.removeFromParent()
    physicsWorld.remove(this.collisionBody)
  }

  // ── Round 9b — death-animation virtuals (overridden by subclasses) ─────────
  // Default implementation: a generic 1.0s fall-and-fade.  Subclasses replace
  // this with weapon-specific cinematic motion via setupXxxDeath / tickXxxDeath.
  startDeath(weapon: WeaponType): void {
    if (this.deathState) return
    this._dying = false   // claim death exclusively through deathState
    this.collisionBody.enabled = false
    this.collisionBody.velocity.x = 0
    this.collisionBody.velocity.z = 0
    this.deathState = { weapon, elapsed: 0, duration: 1.0, phase: 'default' }
  }

  // Per-frame death animation tick.  Subclasses override for unique behavior.
  // Default: rotate-and-fade fall.
  updateDeath(delta: number): void {
    if (!this.deathState) return
    this.deathState.elapsed += delta
    const t = Math.min(1, this.deathState.elapsed / this.deathState.duration)
    this.group.rotation.z = t * Math.PI / 2
    this.group.position.y = Math.max(0, 0.2 - t * 0.2)
    if (t > 0.7) {
      const fade = 1 - (t - 0.7) / 0.3
      this.group.traverse(obj => {
        if ((obj as THREE.Mesh).isMesh) {
          const m = (obj as THREE.Mesh).material as THREE.Material & { opacity?: number; transparent?: boolean }
          m.transparent = true
          m.opacity = fade
        }
      })
    }
  }

  // Convenience for subclass death animations.
  protected spawnIchor(pos: THREE.Vector3, count: number, color = 0x88aa44): void {
    Enemy3D.onDeathParticles?.(pos.x, 0.3, pos.z, color, count, 'ichor')
  }
  protected spawnSmoke(pos: THREE.Vector3, count: number): void {
    Enemy3D.onDeathParticles?.(pos.x, 0.4 + Math.random() * 0.3, pos.z, 0x444444, count, 'smoke')
  }
}
