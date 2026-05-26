import * as THREE from 'three'
import { WeaponType } from './WeaponSystem'
import { WeakPointZone, type Enemy3D } from '../entities/Enemy3D'
import type { Webbs3D } from '../entities/Webbs3D'
import { registry } from '../core/Registry'
import { BeetleTank3D } from '../entities/BeetleTank3D'
import { RollerBoss3D } from '../entities/RollerBoss3D'

// ── Weapon constants (pixel values × 0.01 = world units) ────────────────────
// Round 9 Issue 3+4: wider hit radii so the impact-point check lands cleanly,
// per-weapon knockback + stagger durations for distinct hit feel.
const SWORD_RADIUS    = 1.00;  const SWORD_SWEEP  = 360; const SWORD_DMG  = 18
const SWORD_STAMINA   = 10;    const SWORD_CD     = 280; const SWORD_KB   = 6.0
const SWORD_STAGGER   = 0.30

const AXE_RADIUS      = 1.20;  const AXE_SWEEP    = 360; const AXE_DMG    = 44
const AXE_STAMINA     = 22;    const AXE_CD       = 760; const AXE_KB     = 14.0
const AXE_STAGGER     = 0.80

const GLOVES_RADIUS   = 1.00;  const GLOVES_CONE  = 360; const GLOVES_DMG = 14
const GLOVES_STAMINA  = 15;    const GLOVES_CD    = 220; const GLOVES_KB  = 4.0
const GLOVES_STAGGER  = 0.18

const BOW_SPEED_WU    = 3.20;  const BOW_DMG      = 22;  const BOW_STAMINA = 12
const BOW_CD          = 380;   const BOW_KB       = 5.0;  const BOW_PROJ_R = 0.06
const BOW_STAGGER     = 0.20
const BOW_MAX_RANGE   = 4.8    // 480 px × 0.01

// ── FlameBreather constants ───────────────────────────────────────────────────
const FLAME_RANGE     = 1.2    // world units (120px × 0.01)
const FLAME_HALF_ANG  = Math.PI / 8  // 22.5° half-angle = 45° total cone
const FLAME_DPS       = 18
const FLAME_DRAIN     = 120    // energy/s at 60fps-equivalent (2/frame × 60)

// ── Animation durations (seconds) ────────────────────────────────────────────
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

// ── Active melee swing — hit detection runs every frame for swing duration ───
interface ActiveSwing {
  webbs:      Webbs3D     // for impact-point recalc each frame (player can move)
  px:         number      // player position snapshot at swing start (fallback)
  pz:         number
  facingX:    number
  facingZ:    number
  radius:     number
  sweepDeg:   number      // 360 = circle around impact point
  damage:     number
  knockback:  number
  remaining:  number      // seconds left in swing window
  hitEnemies: Set<Enemy3D>  // each enemy hit at most once per swing
  // Round 9 Issue 3/4 — hit-feel fields
  impactDist:     number    // forward offset from player to impact-point centre
  staggerDur:     number
  reactionStyle:  'small' | 'medium' | 'large' | 'stab' | 'sword' | 'axe'
  particleColor:  number
  particleCount:  number
  // VFX deferred until first hit
  ringMaxR:   number
  ringDur:    number
  ringColor:  number
  shakeI:     number
  shakeD:     number
  ringFired:  boolean
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
  private enemies:      Enemy3D[] = []
  private cooldowns:    number[]  = Array(8).fill(0)
  private projectiles:  Projectile3D[] = []
  private hitEffects:   HitEffect[] = []
  private activeSwings: ActiveSwing[] = []
  private threeScene:   THREE.Scene

  staminaDrainMult    = 1
  lastHitFrame        = false
  lastShakeIntensity  = 0
  lastShakeDuration   = 0

  // Callback fired when bow has no ammo — wire to HUD in main.ts
  onOutOfAmmo: (() => void) | null = null

  // Round 9 Issue 4 — splatter particles on successful hit.  Wired in main.ts
  // to the ParticleBurstSystem.
  onSpawnHitParticles: ((x: number, y: number, z: number, color: number, count: number) => void) | null = null

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
        enemy.takeDamage(FLAME_DPS * delta, WeakPointZone.Body, WeaponType.FlameBreather)
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
    this.checkSwingHits(delta)
    this.tickProjectiles(delta)
    this.tickHitEffects(delta)
  }

  // ── Round 8 Issue 5: vertical sword slash + horizontal axe sweep ─────────

  // ── Sword overhead arc slam ───────────────────────────────────────────────
  // The blade pivots around the body centre, swinging from behind+above all the
  // way over the top and slamming into the ground in front of Webbs.
  // A pre-baked world-space fan shows the full swept arc as a translucent trail.

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
    // Round 9 Issue 3: the LEG carrying the sword now performs the overhead slam.
    webbs.legs.startWeaponSwing(slot, 'sword', webbs.facingX, webbs.facingZ)
    this.activeSwings.push({
      webbs,
      px: webbs.collisionBody.x, pz: webbs.collisionBody.z,
      facingX: webbs.facingX,    facingZ: webbs.facingZ,
      radius: SWORD_RADIUS, sweepDeg: SWORD_SWEEP,
      damage: SWORD_DMG,    knockback: SWORD_KB,
      remaining: 0.30,                 // matches sword swing duration
      hitEnemies: new Set(),
      impactDist: 1.1, staggerDur: SWORD_STAGGER, reactionStyle: 'sword',
      particleColor: 0xff4422, particleCount: 12,
      ringMaxR: 0.8, ringDur: 0.55, ringColor: 0xaaaaff,
      shakeI: SHAKE_SWORD.i, shakeD: SHAKE_SWORD.d,
      ringFired: false,
    })
  }

  // ── Axe ────────────────────────────────────────────────────────────────────

  private fireAxe(slot: number, webbs: Webbs3D): void {
    if (webbs.stamina <= 0) return
    webbs.stamina = Math.max(0, webbs.stamina - AXE_STAMINA * this.staminaDrainMult)
    this.cooldowns[slot] = AXE_CD
    // Round 9 Issue 3: leg performs the 180° horizontal sweep itself.
    webbs.legs.startWeaponSwing(slot, 'axe', webbs.facingX, webbs.facingZ)
    this.activeSwings.push({
      webbs,
      px: webbs.collisionBody.x, pz: webbs.collisionBody.z,
      facingX: webbs.facingX,    facingZ: webbs.facingZ,
      radius: AXE_RADIUS, sweepDeg: AXE_SWEEP,
      damage: AXE_DMG,    knockback: AXE_KB,
      remaining: 0.40,
      hitEnemies: new Set(),
      impactDist: 1.1, staggerDur: AXE_STAGGER, reactionStyle: 'axe',
      particleColor: 0xff4422, particleCount: 18,
      ringMaxR: 1.0, ringDur: 0.45, ringColor: 0xaa6633,
      shakeI: SHAKE_AXE.i, shakeD: SHAKE_AXE.d,
      ringFired: false,
    })
  }

  // ── Toothpick (BoxingGloves) ───────────────────────────────────────────────

  private fireGloves(slot: number, webbs: Webbs3D): void {
    if (webbs.stamina <= 0) return
    webbs.stamina = Math.max(0, webbs.stamina - GLOVES_STAMINA * this.staminaDrainMult)
    this.cooldowns[slot] = GLOVES_CD
    // Round 9 Issue 3: toothpick stab — quick lunge forward + back.
    webbs.legs.startWeaponSwing(slot, 'stab', webbs.facingX, webbs.facingZ)
    this.activeSwings.push({
      webbs,
      px: webbs.collisionBody.x, pz: webbs.collisionBody.z,
      facingX: webbs.facingX,    facingZ: webbs.facingZ,
      radius: GLOVES_RADIUS, sweepDeg: GLOVES_CONE,
      damage: GLOVES_DMG,    knockback: GLOVES_KB,
      remaining: 0.18,
      hitEnemies: new Set(),
      impactDist: 1.1, staggerDur: GLOVES_STAGGER, reactionStyle: 'stab',
      particleColor: 0xaaccff, particleCount: 6,
      ringMaxR: 0.9, ringDur: 0.35, ringColor: 0xeeddaa,
      shakeI: SHAKE_GLOVES.i, shakeD: SHAKE_GLOVES.d,
      ringFired: false,
    })
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


  // ── Per-frame swing hit detection ─────────────────────────────────────────
  // Runs every frame for the full animation window so partial-range hits land.

  // Round 9b — map ActiveSwing.reactionStyle back to WeaponType for death-anim dispatch.
  private weaponForStyle(style: string): WeaponType {
    switch (style) {
      case 'sword': return WeaponType.Sword
      case 'axe':   return WeaponType.Axe
      case 'stab':  return WeaponType.BoxingGloves
      default:      return WeaponType.Empty
    }
  }

  // Round 9 Issue 3 — hit detection now centres on the leg's IMPACT POINT
  // (player position + facing × impactDist) instead of the player body, so the
  // sword/axe/stab reach the same distance the weapon visibly extends.
  // Also applies stagger, hit-reaction wobble, and splatter particles.
  private checkSwingHits(delta: number): void {
    const keep: ActiveSwing[] = []
    for (const sw of this.activeSwings) {
      sw.remaining -= delta

      // Impact point in front of the (current) player position
      const ix = sw.webbs.collisionBody.x + sw.facingX * sw.impactDist
      const iz = sw.webbs.collisionBody.z + sw.facingZ * sw.impactDist
      const facingAngle = Math.atan2(sw.facingX, sw.facingZ)
      const halfRad     = (sw.sweepDeg / 2) * DEG
      const fullCircle  = sw.sweepDeg >= 359.9

      for (const enemy of this.enemies) {
        if (enemy.isDead() || sw.hitEnemies.has(enemy)) continue
        const dx = enemy.collisionBody.x - ix
        const dz = enemy.collisionBody.z - iz
        const dist = Math.sqrt(dx * dx + dz * dz)
        if (dist - enemy.config.bodyRadius > sw.radius) continue
        if (!fullCircle) {
          const toEnemy = Math.atan2(dx, dz)
          if (Math.abs(wrapAngle(toEnemy - facingAngle)) > halfRad) continue
        }

        sw.hitEnemies.add(enemy)
        enemy.takeDamage(sw.damage, this.resolveZone(enemy, sw.px, sw.pz), this.weaponForStyle(sw.reactionStyle))

        // Knockback away from PLAYER (so enemy flies away from Webbs, not from
        // the impact point — the latter would slam them straight up into Webbs).
        const pdx = enemy.collisionBody.x - sw.webbs.collisionBody.x
        const pdz = enemy.collisionBody.z - sw.webbs.collisionBody.z
        const plen = Math.hypot(pdx, pdz) || 1
        enemy.applyKnockback((pdx / plen) * sw.knockback, (pdz / plen) * sw.knockback)

        // Stagger + visual hit reaction
        enemy.staggerTimer = Math.max(enemy.staggerTimer, sw.staggerDur)
        enemy.startHitReaction(sw.reactionStyle)

        // Splatter particles
        if (this.onSpawnHitParticles) {
          this.onSpawnHitParticles(
            enemy.collisionBody.x,
            enemy.config.bodyRadius * 0.5,
            enemy.collisionBody.z,
            sw.particleColor, sw.particleCount,
          )
        }

        this.lastHitFrame = true

        if (!sw.ringFired) {
          sw.ringFired = true
          this.spawnHitRing(new THREE.Vector3(ix, 0, iz), sw.ringMaxR, sw.ringDur, sw.ringColor)
          this.lastShakeIntensity = sw.shakeI
          this.lastShakeDuration  = sw.shakeD
        }
      }

      if (sw.remaining > 0) keep.push(sw)
    }
    this.activeSwings = keep
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
          enemy.takeDamage(BOW_DMG, WeakPointZone.Body, WeaponType.Bow)
          const len = Math.hypot(proj.vx, proj.vz) || 1
          enemy.applyKnockback((proj.vx / len) * BOW_KB, (proj.vz / len) * BOW_KB)
          // Round 9 Issue 4 — stagger + visual reaction + splatter on bow hits.
          enemy.staggerTimer = Math.max(enemy.staggerTimer, BOW_STAGGER)
          enemy.startHitReaction('small')
          if (this.onSpawnHitParticles) {
            this.onSpawnHitParticles(enemy.collisionBody.x, 0.3, enemy.collisionBody.z, 0xcc99ff, 6)
          }
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
