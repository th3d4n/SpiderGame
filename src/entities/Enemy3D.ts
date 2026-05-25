import * as THREE from 'three'
import { type CollisionBody, physicsWorld } from '../core/PhysicsWorld'

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
  staggerTimer   = 0
  contactCooldown = 0
  stuckThistles  = 0

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

  takeDamage(amount: number, zone?: WeakPointZone): void {
    if (this._dying || this.hp <= 0) return
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
    if (this.hp <= 0) this.startDeath()
  }

  applyKnockback(vx: number, vz: number): void {
    if (this._dying) return
    const s = 1 - this.config.knockbackResist
    this.collisionBody.velocity.x += vx * s
    this.collisionBody.velocity.z += vz * s
  }

  addStuckThistle(): void { this.stuckThistles++ }
  isDead():          boolean { return this.hp <= 0 }
  isExpired():       boolean { return this._dying && this._deathTimer > 0.5 }

  // ── Per-frame update ───────────────────────────────────────────────────────

  update(delta: number, playerX: number, playerZ: number): void {
    this.contactCooldown = Math.max(0, this.contactCooldown - delta)

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

    this.staggerTimer = Math.max(0, this.staggerTimer - delta)
    if (this.staggerTimer <= 0) {
      this.updateAI(delta, playerX, playerZ)
    }
  }

  // Sync 3D group from physics body — call after physicsWorld.update().
  syncPosition(): void {
    if (this._dying) return
    this.group.position.x = this.collisionBody.x
    this.group.position.z = this.collisionBody.z
  }

  // Remove from scene and physics — call when isExpired().
  cleanup(): void {
    this.group.removeFromParent()
    physicsWorld.remove(this.collisionBody)
  }

  // ── Internal ───────────────────────────────────────────────────────────────

  private startDeath(): void {
    this._dying = true
    this.collisionBody.enabled = false
    this.collisionBody.velocity.x = 0
    this.collisionBody.velocity.z = 0
  }
}
