import * as THREE from 'three'
import { WeaponType } from './WeaponSystem'
import { WeakPointZone, type Enemy3D } from '../entities/Enemy3D'
import type { Webbs3D } from '../entities/Webbs3D'
import { registry } from '../core/Registry'
import { BeetleTank3D } from '../entities/BeetleTank3D'
import { RollerBoss3D } from '../entities/RollerBoss3D'

// ── Weapon constants (pixel values × 0.01 = world units) ────────────────────
const SWORD_RADIUS    = 0.70;  const SWORD_SWEEP  = 90;  const SWORD_DMG  = 18
const SWORD_STAMINA   = 10;    const SWORD_CD     = 280; const SWORD_KB   = 1.8
// Visual reach from body centre — how far the weapon tip extends at peak thrust.
// Larger than the hit radius so the weapon extends past the enemy when it connects.
const SWORD_REACH     = 1.00

const AXE_RADIUS      = 0.88;  const AXE_SWEEP    = 170; const AXE_DMG    = 44
const AXE_STAMINA     = 22;    const AXE_CD       = 760; const AXE_KB     = 5.2
const AXE_REACH       = 1.10

const GLOVES_RADIUS   = 0.90;  const GLOVES_CONE  = 28;  const GLOVES_DMG = 14
const GLOVES_STAMINA  = 15;    const GLOVES_CD    = 220; const GLOVES_KB  = 2.0
const GLOVES_REACH    = 1.30   // long thin stab — tip extends further than any other weapon

const BOW_SPEED_WU    = 3.20;  const BOW_DMG      = 22;  const BOW_STAMINA = 12
const BOW_CD          = 380;   const BOW_KB       = 2.2;  const BOW_PROJ_R = 0.06
const BOW_MAX_RANGE   = 4.8    // 480 px × 0.01

// ── FlameBreather constants ───────────────────────────────────────────────────
const FLAME_RANGE     = 1.2    // world units (120px × 0.01)
const FLAME_HALF_ANG  = Math.PI / 8  // 22.5° half-angle = 45° total cone
const FLAME_DPS       = 18
const FLAME_DRAIN     = 120    // energy/s at 60fps-equivalent (2/frame × 60)

// ── Animation durations (seconds) ────────────────────────────────────────────
const ANIM_SWORD  = 0.28
const ANIM_AXE    = 0.76
const ANIM_GLOVES = 0.22
const ANIM_BOW    = 0.22
const ANIM_FLAME  = 0.08  // repeating spray cycle

// ── Camera shake per weapon ───────────────────────────────────────────────────
const SHAKE_SWORD  = { i: 0.03, d: 0.08 }
const SHAKE_AXE    = { i: 0.08, d: 0.18 }
const SHAKE_GLOVES = { i: 0.04, d: 0.07 }

const DEG = Math.PI / 180

// ── Hit ring VFX ──────────────────────────────────────────────────────────────
interface HitEffect {
  mesh: THREE.Mesh
  elapsed: number
  duration: number
  maxRadius: number
  fadeOnly?: boolean   // if true: only fade opacity, don't scale
}

// ── Projectile ────────────────────────────────────────────────────────────────
interface Projectile3D {
  mesh: THREE.Mesh
  vx:   number
  vz:   number
  life: number     // seconds remaining
}

// ── Utility ───────────────────────────────────────────────────────────────────
function wrapAngle(a: number): number {
  while (a >  Math.PI) a -= Math.PI * 2
  while (a < -Math.PI) a += Math.PI * 2
  return a
}

export class WeaponUseSystem3D {
  private enemies:     Enemy3D[] = []
  private cooldowns:   number[]  = Array(8).fill(0)
  private projectiles: Projectile3D[] = []
  private hitEffects:  HitEffect[] = []
  private threeScene:  THREE.Scene

  staminaDrainMult    = 1
  lastHitFrame        = false
  lastShakeIntensity  = 0
  lastShakeDuration   = 0

  // Callback fired when bow has no ammo — wire to HUD in main.ts
  onOutOfAmmo: (() => void) | null = null

  // FlameBreather state
  private flameActive    = false
  private flameMesh:     THREE.Mesh | null = null
  private flameAnimTimer = 0
  private _facingDir     = new THREE.Vector3()

  constructor(threeScene: THREE.Scene) {
    this.threeScene = threeScene
  }

  setEnemies(enemies: Enemy3D[]): void { this.enemies = enemies }

  isFlameActive(): boolean { return this.flameActive }

  // Call every frame while the FlameBreather slot key is held
  tickFlame(slot: number, webbs: Webbs3D, delta: number): void {
    if (webbs.energy <= 0) { this.stopFlame(); return }

    webbs.energy = Math.max(0, webbs.energy - FLAME_DRAIN * delta)

    const fx   = webbs.facingX
    const fz   = webbs.facingZ
    const flen = Math.hypot(fx, fz) || 1

    // Build / update flame cone mesh
    if (!this.flameMesh) {
      const geo = new THREE.ConeGeometry(0.45, 1.2, 8, 1, true)
      const mat = new THREE.MeshBasicMaterial({ color: 0xff5500, transparent: true, opacity: 0.5, side: THREE.DoubleSide })
      this.flameMesh = new THREE.Mesh(geo, mat)
      this.threeScene.add(this.flameMesh)
    }

    this.flameMesh.position.set(
      webbs.collisionBody.x + (fx / flen) * 0.65,
      0.3,
      webbs.collisionBody.z + (fz / flen) * 0.65,
    )
    this._facingDir.set(fx / flen, 0, fz / flen)
    this.flameMesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), this._facingDir)
    ;(this.flameMesh.material as THREE.MeshBasicMaterial).opacity = 0.35 + Math.random() * 0.4

    this.flameActive = true

    // Per-frame DPS in 45° cone
    const facingAngle = Math.atan2(fx / flen, fz / flen)
    for (const enemy of this.enemies) {
      if (enemy.isDead()) continue
      const dx   = enemy.collisionBody.x - webbs.collisionBody.x
      const dz   = enemy.collisionBody.z - webbs.collisionBody.z
      const dist = Math.hypot(dx, dz)
      if (dist - enemy.config.bodyRadius > FLAME_RANGE) continue
      let diff = Math.atan2(dx, dz) - facingAngle
      while (diff >  Math.PI) diff -= Math.PI * 2
      while (diff < -Math.PI) diff += Math.PI * 2
      if (Math.abs(diff) <= FLAME_HALF_ANG) {
        enemy.takeDamage(FLAME_DPS * delta, WeakPointZone.Body)
        this.lastHitFrame = true
      }
    }

    // Repeating leg spray animation
    this.flameAnimTimer += delta
    if (this.flameAnimTimer >= ANIM_FLAME) {
      this.flameAnimTimer = 0
      webbs.legs.triggerAnim(slot, ANIM_FLAME, fx / flen, fz / flen)
    }
  }

  stopFlame(): void {
    if (this.flameMesh) {
      this.threeScene.remove(this.flameMesh)
      this.flameMesh.geometry.dispose()
      ;(this.flameMesh.material as THREE.Material).dispose()
      this.flameMesh = null
    }
    this.flameActive    = false
    this.flameAnimTimer = 0
  }

  // ── Per-frame update ───────────────────────────────────────────────────────

  update(delta: number): void {
    this.lastHitFrame = false
    for (let i = 0; i < 8; i++) {
      if (this.cooldowns[i] > 0) this.cooldowns[i] -= delta * 1000 // stored in ms
    }
    this.tickProjectiles(delta)
    this.tickHitEffects(delta)
  }

  // ── Weapon activation ─────────────────────────────────────────────────────
  // aim: normalized direction override (e.g. mouse-to-world direction)

  activateWeapon(
    slot:  number,
    webbs: Webbs3D,
    aim?:  { dx: number; dz: number },
  ): void {
    if (this.cooldowns[slot] > 0) return
    const weapon = webbs.weaponSystem.getSlot(slot)
    if (weapon === WeaponType.Empty) return

    const oldFx = webbs.facingX
    const oldFz = webbs.facingZ
    if (aim) {
      const len = Math.hypot(aim.dx, aim.dz) || 1
      webbs.facingX = aim.dx / len
      webbs.facingZ = aim.dz / len
    }

    try {
      switch (weapon) {
        case WeaponType.Sword:        this.fireSword(slot, webbs);       break
        case WeaponType.Axe:          this.fireAxe(slot, webbs);         break
        case WeaponType.BoxingGloves: this.fireGloves(slot, webbs);      break
        case WeaponType.Bow:          this.fireBow(slot, webbs);         break
        // FlameBreather is continuous — call tickFlame() from main.ts while key held
      }
    } finally {
      if (aim) { webbs.facingX = oldFx; webbs.facingZ = oldFz }
    }
  }

  // ── Sword ──────────────────────────────────────────────────────────────────

  private fireSword(slot: number, webbs: Webbs3D): void {
    if (webbs.stamina <= 0) return
    webbs.stamina = Math.max(0, webbs.stamina - SWORD_STAMINA * this.staminaDrainMult)
    this.cooldowns[slot] = SWORD_CD
    webbs.legs.triggerAnim(slot, ANIM_SWORD, webbs.facingX, webbs.facingZ, SWORD_REACH)

    this.spawnSwingFan(webbs, SWORD_RADIUS, SWORD_SWEEP, 0xaaaaff, ANIM_SWORD)
    const hit = this.hitsInArc(webbs, SWORD_RADIUS, SWORD_SWEEP, SWORD_DMG, SWORD_KB)
    if (hit) {
      this.spawnHitRing(webbs.group.position, 0.8, 0.55, 0xaaaaff)
      this.lastShakeIntensity = SHAKE_SWORD.i
      this.lastShakeDuration  = SHAKE_SWORD.d
    }
  }

  // ── Axe ────────────────────────────────────────────────────────────────────

  private fireAxe(slot: number, webbs: Webbs3D): void {
    if (webbs.stamina <= 0) return
    webbs.stamina = Math.max(0, webbs.stamina - AXE_STAMINA * this.staminaDrainMult)
    this.cooldowns[slot] = AXE_CD
    webbs.legs.triggerAnim(slot, ANIM_AXE, webbs.facingX, webbs.facingZ, AXE_REACH)

    this.spawnSwingFan(webbs, AXE_RADIUS, AXE_SWEEP, 0xaa6633, ANIM_AXE)
    const hit = this.hitsInArc(webbs, AXE_RADIUS, AXE_SWEEP, AXE_DMG, AXE_KB)
    if (hit) {
      this.spawnHitRing(webbs.group.position, 1.0, 0.45, 0xaa6633)
      this.lastShakeIntensity = SHAKE_AXE.i
      this.lastShakeDuration  = SHAKE_AXE.d
    }
  }

  // ── Toothpick (BoxingGloves) ───────────────────────────────────────────────

  private fireGloves(slot: number, webbs: Webbs3D): void {
    if (webbs.stamina <= 0) return
    webbs.stamina = Math.max(0, webbs.stamina - GLOVES_STAMINA * this.staminaDrainMult)
    this.cooldowns[slot] = GLOVES_CD
    webbs.legs.triggerAnim(slot, ANIM_GLOVES, webbs.facingX, webbs.facingZ, GLOVES_REACH)

    this.spawnSwingFan(webbs, GLOVES_RADIUS, GLOVES_CONE, 0xeeddaa, ANIM_GLOVES)

    const wx = webbs.collisionBody.x
    const wz = webbs.collisionBody.z
    const facingAngle = Math.atan2(webbs.facingX, webbs.facingZ)
    const halfCone = GLOVES_CONE / 2 * DEG
    let hit = false

    for (const enemy of this.enemies) {
      if (enemy.isDead()) continue
      const dx = enemy.collisionBody.x - wx
      const dz = enemy.collisionBody.z - wz
      const dist = Math.sqrt(dx * dx + dz * dz)
      if (dist - enemy.config.bodyRadius > GLOVES_RADIUS) continue
      const toEnemy = Math.atan2(dx, dz)
      if (Math.abs(wrapAngle(toEnemy - facingAngle)) <= halfCone) {
        enemy.takeDamage(GLOVES_DMG, this.resolveZone(enemy, wx, wz))
        enemy.applyKnockback(webbs.facingX * GLOVES_KB, webbs.facingZ * GLOVES_KB)
        this.lastHitFrame = true
        hit = true
      }
    }
    if (hit) {
      this.spawnHitRing(webbs.group.position, 0.9, 0.35, 0xeeddaa)
      this.lastShakeIntensity = SHAKE_GLOVES.i
      this.lastShakeDuration  = SHAKE_GLOVES.d
    }
  }

  // ── Bow ────────────────────────────────────────────────────────────────────

  private fireBow(slot: number, webbs: Webbs3D): void {
    if (webbs.stamina <= 0) return

    // Ammo check
    const inv     = registry.get<Record<string, number>>('craftingInventory') ?? {}
    const thistle = inv.Thistle ?? 0
    if (thistle <= 0) { this.onOutOfAmmo?.(); return }
    inv.Thistle = thistle - 1
    registry.set('craftingInventory', inv)

    webbs.stamina = Math.max(0, webbs.stamina - BOW_STAMINA * this.staminaDrainMult)
    this.cooldowns[slot] = BOW_CD
    webbs.legs.triggerAnim(slot, ANIM_BOW, webbs.facingX, webbs.facingZ)

    const geo = new THREE.SphereGeometry(BOW_PROJ_R, 8, 6)
    const mat = new THREE.MeshToonMaterial({ color: 0xcc99ff })
    const mesh = new THREE.Mesh(geo, mat)
    mesh.position.set(webbs.collisionBody.x, 0.5, webbs.collisionBody.z)
    this.threeScene.add(mesh)

    this.projectiles.push({
      mesh,
      vx:   webbs.facingX * BOW_SPEED_WU,
      vz:   webbs.facingZ * BOW_SPEED_WU,
      life: BOW_MAX_RANGE / BOW_SPEED_WU,
    })
  }

  // ── Swing fan VFX — pie-slice that matches exact hit geometry ─────────────

  private spawnSwingFan(
    webbs:    Webbs3D,
    radius:   number,
    sweepDeg: number,
    color:    number,
    duration: number,
  ): void {
    const facing   = Math.atan2(webbs.facingX, webbs.facingZ)
    const half     = (sweepDeg / 2) * DEG
    const segments = Math.max(8, Math.round(sweepDeg / 10))

    // Build pie-slice vertices in local XZ space (y=0), center at origin
    const verts: number[] = [0, 0, 0]
    for (let i = 0; i <= segments; i++) {
      const a = facing - half + (i / segments) * sweepDeg * DEG
      verts.push(Math.sin(a) * radius, 0, Math.cos(a) * radius)
    }
    const tris: number[] = []
    for (let i = 0; i < segments; i++) tris.push(0, i + 1, i + 2)

    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3))
    geo.setIndex(tris)
    const mat = new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0.38, side: THREE.DoubleSide, depthWrite: false,
    })
    const mesh = new THREE.Mesh(geo, mat)
    mesh.position.set(webbs.collisionBody.x, 0.04, webbs.collisionBody.z)
    this.threeScene.add(mesh)
    this.hitEffects.push({ mesh, elapsed: 0, duration, maxRadius: 1, fadeOnly: true })
  }

  // ── Arc hit detection (Sword + Axe) ───────────────────────────────────────

  private hitsInArc(
    webbs:     Webbs3D,
    radius:    number,
    sweepDeg:  number,
    damage:    number,
    knockback: number,
  ): boolean {
    const wx = webbs.collisionBody.x
    const wz = webbs.collisionBody.z
    const facingAngle = Math.atan2(webbs.facingX, webbs.facingZ)
    const halfRad = sweepDeg / 2 * DEG
    let anyHit = false

    for (const enemy of this.enemies) {
      if (enemy.isDead()) continue
      const dx = enemy.collisionBody.x - wx
      const dz = enemy.collisionBody.z - wz
      const dist = Math.sqrt(dx * dx + dz * dz)
      if (dist - enemy.config.bodyRadius > radius) continue
      const toEnemy = Math.atan2(dx, dz)
      if (Math.abs(wrapAngle(toEnemy - facingAngle)) <= halfRad) {
        enemy.takeDamage(damage, this.resolveZone(enemy, wx, wz))
        const kx = Math.sin(toEnemy) * knockback
        const kz = Math.cos(toEnemy) * knockback
        enemy.applyKnockback(kx, kz)
        this.lastHitFrame = true
        anyHit = true
      }
    }
    return anyHit
  }

  // ── Projectile tick ────────────────────────────────────────────────────────

  private tickProjectiles(delta: number): void {
    const keep: Projectile3D[] = []
    for (const proj of this.projectiles) {
      proj.life -= delta
      if (proj.life <= 0) { proj.mesh.removeFromParent(); continue }

      proj.mesh.position.x += proj.vx * delta
      proj.mesh.position.z += proj.vz * delta

      let hit = false
      for (const enemy of this.enemies) {
        if (enemy.isDead()) continue
        const dx = proj.mesh.position.x - enemy.collisionBody.x
        const dz = proj.mesh.position.z - enemy.collisionBody.z
        const dist = Math.sqrt(dx * dx + dz * dz)
        if (dist < enemy.config.bodyRadius + BOW_PROJ_R + 0.04) {
          enemy.addStuckThistle()
          enemy.takeDamage(BOW_DMG, WeakPointZone.Body)
          const len = Math.hypot(proj.vx, proj.vz) || 1
          enemy.applyKnockback((proj.vx / len) * BOW_KB, (proj.vz / len) * BOW_KB)
          this.spawnHitRing(proj.mesh.position, 0.5, 0.3, 0xcc99ff)
          proj.mesh.removeFromParent()
          this.lastHitFrame = true
          hit = true
          break
        }
      }
      if (!hit) keep.push(proj)
    }
    this.projectiles = keep
  }

  // ── Hit ring VFX ──────────────────────────────────────────────────────────
  // Expanding ring on the ground plane at impact position.

  private spawnHitRing(
    pos:      THREE.Vector3,
    maxR:     number,
    duration: number,
    color:    number,
  ): void {
    const geo = new THREE.RingGeometry(0.01, 0.06, 20).rotateX(-Math.PI / 2)
    const mat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.8,
      side: THREE.DoubleSide,
    })
    const mesh = new THREE.Mesh(geo, mat)
    mesh.position.set(pos.x, 0.02, pos.z)
    this.threeScene.add(mesh)
    this.hitEffects.push({ mesh, elapsed: 0, duration, maxRadius: maxR })
  }

  // ── Per-enemy weak-point zone resolver ───────────────────────────────────
  // Returns the appropriate WeakPointZone for a hit given the attacker position.

  private resolveZone(enemy: Enemy3D, wx: number, wz: number): WeakPointZone {
    // Beetle underbelly: hit from behind while beetle is charging
    if (enemy instanceof BeetleTank3D && enemy.isCharging()) {
      const cf = enemy.getChargeFacing()
      const bax = wx - enemy.collisionBody.x
      const baz = wz - enemy.collisionBody.z
      const len = Math.hypot(bax, baz) || 1
      // dot > 0.5 means attacker is roughly in the direction beetle came FROM
      if (cf.x * (bax / len) + cf.z * (baz / len) > 0.5) {
        return WeakPointZone.Underbelly
      }
    }
    // Roller snout: attacker within 0.35wu of snout world position
    if (enemy instanceof RollerBoss3D) {
      const fd = enemy.getFacingDir()
      const snoutX = enemy.collisionBody.x + 0.62 * fd
      const dsx = wx - snoutX, dsz = wz - enemy.collisionBody.z
      if (dsx * dsx + dsz * dsz < 0.35 * 0.35) return WeakPointZone.Head
    }
    return WeakPointZone.Body
  }

  private tickHitEffects(delta: number): void {
    const keep: HitEffect[] = []
    for (const fx of this.hitEffects) {
      fx.elapsed += delta
      const t = fx.elapsed / fx.duration
      if (t >= 1) { fx.mesh.removeFromParent(); fx.mesh.geometry.dispose(); continue }
      if (fx.fadeOnly) {
        ;(fx.mesh.material as THREE.MeshBasicMaterial).opacity = 0.38 * (1 - t)
      } else {
        fx.mesh.scale.setScalar(fx.maxRadius * t)
        ;(fx.mesh.material as THREE.MeshBasicMaterial).opacity = 0.8 * (1 - t)
      }
      keep.push(fx)
    }
    this.hitEffects = keep
  }
}
