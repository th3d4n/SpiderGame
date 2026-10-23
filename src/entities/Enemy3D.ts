import * as THREE from 'three'
import { disposeTree } from '../core/dispose'
import { type CollisionBody, physicsWorld } from '../core/PhysicsWorld'
import { WeaponType } from '../systems/WeaponSystem'
import { addRim } from '../env/Materials'
import { audio } from '../systems/AudioManager'

// Warm silhouette rim for hostiles — reads apart from Webbs' cool rim at a glance
const ENEMY_RIM = { color: 0xffc8a0, strength: 0.32 }

// Mirror of WeakPointZone from the old Enemy.ts — kept here so WeaponUseSystem3D
// can import from one place without touching the Phaser file.
// After a stun ends the enemy can't be stunned again for this long
const STAGGER_IMMUNITY = 0.6   // s

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
  // Elongated body: capsule core half-length along local Z (forward) or X.
  // Omit for round bodies.  Matches the mesh so contacts land where it looks solid.
  capsule?:        { halfLength: number; axis: 'x' | 'z' }
}

export abstract class Enemy3D {
  group: THREE.Group
  collisionBody: CollisionBody
  hp: number
  hpMax: number
  readonly config: EnemyConfig3D
  staggerTimer    = 0
  staggerImmuneT  = 0   // after a stun ends, briefly can't be re-stunned
  contactCooldown = 0
  stuckThistles   = 0
  knockbackTimer  = 0   // seconds since a hit shoved it (AI paused, no contact damage)

  // Directional flinch (visual): the body is shoved and tilted along the blow,
  // then springs back.  Collision body is unaffected.
  private hitReactionTimer    = 0
  private hitReactionBaseDur  = 0
  private hitReactionAmp      = 0
  private hitDirX = 0
  private hitDirZ = 1

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
    this.group.rotation.order = 'YXZ'   // heading, then flinch tilt in body space
    this.group.position.set(x, 0, z)
    this.group.renderOrder = 10   // renders above transparent walls
    threeScene.add(this.group)

    this.collisionBody = physicsWorld.add({
      x, z,
      radius:   config.bodyRadius,
      velocity: { x: 0, z: 0 },
      isStatic: false,
      enabled:  true,
      drag:     6,   // external-impulse decay (1/s)
      // Heavier enemies (knockback-resistant) shove the player and resist being shoved.
      mass:     Math.PI * config.bodyRadius * config.bodyRadius * 20 * (1 + 4 * config.knockbackResist),
      capsule:  config.capsule,
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
    this._flashTimer  = 0.12   // stun is separate — see stagger()
    if (this.hp <= 0) this.startDeath(killingWeapon ?? WeaponType.Empty)
  }

  // Stun from a hit: scaled down by the enemy's resistance, capped by its own
  // staggerDuration, and followed by STAGGER_IMMUNITY — so a fast weapon can
  // interrupt an enemy but never hold it stunned forever.
  stagger(seconds: number): void {
    if (this.staggerImmuneT > 0 || this.superArmor()) return
    const s = Math.min(this.config.staggerDuration, seconds * (1 - 0.7 * this.config.knockbackResist))
    if (s < 0.04) return
    this.staggerTimer = Math.max(this.staggerTimer, s)
  }

  // Override: true while an attack is committed (can't be stunned or shoved out of it)
  protected superArmor(): boolean { return false }

  // Physical shove: an impulse on the body (decays with drag, blocked by walls,
  // pushes into other enemies) instead of a forced velocity.  Resistance and
  // mass both soften it.  Also sets the flinch direction.
  applyKnockback(vx: number, vz: number): void {
    if (this._dying || this.superArmor()) return
    const len = Math.hypot(vx, vz)
    if (len > 1e-4) { this.hitDirX = vx / len; this.hitDirZ = vz / len }
    const s = 1 - this.config.knockbackResist
    this.collisionBody.push(vx * s, vz * s)
    // The AI pause scales with resistance and respects stun immunity
    if (this.staggerImmuneT <= 0) this.knockbackTimer = Math.max(this.knockbackTimer, 0.25 * s)
  }

  // Override for enemies whose body only hurts during an attack (lunge, charge…).
  dealsContactDamage(): boolean { return true }

  // Directional flinch — heavier weapons shove and tilt the body further and
  // ring longer.  Direction comes from the last applyKnockback().
  startHitReaction(style: 'small' | 'medium' | 'large' | 'stab' | 'sword' | 'axe'): void {
    let dur = 0.15, amp = 0.05
    switch (style) {
      case 'stab':   dur = 0.22; amp = 0.07; break
      case 'small':  dur = 0.25; amp = 0.08; break
      case 'sword':  dur = 0.32; amp = 0.13; break
      case 'medium': dur = 0.32; amp = 0.12; break
      case 'axe':    dur = 0.45; amp = 0.22; break
      case 'large':  dur = 0.42; amp = 0.18; break
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
    this.staggerImmuneT  = Math.max(0, this.staggerImmuneT - delta)
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

    // ── Knockback window: the impulse carries the body, AI waits ────────────
    if (this.knockbackTimer > 0) {
      this.knockbackTimer = Math.max(0, this.knockbackTimer - delta)
      this.collisionBody.velocity.x = 0
      this.collisionBody.velocity.z = 0
      this.tickStagger(delta)
      return
    }

    this.tickStagger(delta)
    if (this.staggerTimer <= 0) {
      this.updateAI(delta, playerX, playerZ)
    } else {
      // Stunned: drop locomotion intent.  Previously the last AI velocity stayed
      // live, so a beetle hit mid-charge kept charging through its stagger.
      this.collisionBody.velocity.x = 0
      this.collisionBody.velocity.z = 0
    }
  }

  private tickStagger(delta: number): void {
    if (this.staggerTimer <= 0) return
    this.staggerTimer = Math.max(0, this.staggerTimer - delta)
    if (this.staggerTimer <= 0) this.staggerImmuneT = STAGGER_IMMUNITY
  }

  // Sync 3D group from physics body — call after physicsWorld.update().
  // Round 9 Issue 4: hit-reaction wobble layered on top (visual only).
  // Round 9b: skip while death animation drives the group transform itself.
  private rimApplied = false

  syncPosition(): void {
    // Subclasses build their meshes after super(); patch them on the first sync
    if (!this.rimApplied) { addRim(this.group, ENEMY_RIM); this.rimApplied = true }
    audio.moveOwner(this, this.collisionBody.x, this.collisionBody.z)   // its loops follow it
    if (this._dying || this.deathState) return
    let ox = 0, oz = 0
    if (this.hitReactionTimer > 0 && this.hitReactionBaseDur > 0) {
      // Damped spring: snaps along the blow, overshoots back once, settles
      const e   = this.hitReactionBaseDur - this.hitReactionTimer
      const k   = Math.exp(-e * 9) * Math.cos(e * 22)
      const amp = this.hitReactionAmp * k
      ox = this.hitDirX * amp
      oz = this.hitDirZ * amp
      // Tilt with the push: top of the body leans along the hit direction.
      // Body-local hit dir (inverse yaw); +x-rotation leans the top toward +Z.
      const y  = this.group.rotation.y
      const lx = this.hitDirX * Math.cos(y) - this.hitDirZ * Math.sin(y)
      const lz = this.hitDirX * Math.sin(y) + this.hitDirZ * Math.cos(y)
      const tilt = Math.min(0.5, this.hitReactionAmp * 2.4) * k
      this.group.rotation.x =  lz * tilt
      this.group.rotation.z = -lx * tilt
      if (this.hitReactionTimer <= 0.0001) { this.group.rotation.x = 0; this.group.rotation.z = 0 }
    }
    this.group.position.x = this.collisionBody.renderX + ox
    this.group.position.z = this.collisionBody.renderZ + oz
    this.collisionBody.heading = this.group.rotation.y   // capsules turn with the body
  }

  // Remove from scene and physics — call when isExpired().
  cleanup(): void {
    audio.stopOwner(this)
    disposeTree(this.group)
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
    audio.stopOwner(this)
    audio.play('small_death', this.collisionBody.x, this.collisionBody.z)   // ants, jumping spiders
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
