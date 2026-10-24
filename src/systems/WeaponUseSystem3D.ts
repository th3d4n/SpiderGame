import * as THREE from 'three'
import { WeaponType } from './WeaponSystem'
import { WeakPointZone, type Enemy3D } from '../entities/Enemy3D'
import type { Webbs3D } from '../entities/Webbs3D'
import { registry } from '../core/Registry'
import { physicsWorld } from '../core/PhysicsWorld'
import { BeetleTank3D } from '../entities/BeetleTank3D'
import { audio } from './AudioManager'

// ─── Weapon use ───────────────────────────────────────────────────────────────
// Melee hits follow the VISIBLE weapon: each frame of a swing's active window,
// the blade is swept from where the leg tip was last frame to where it is now,
// against every enemy's real collider shape (balls + capsules).  Nothing hits
// during wind-up or recovery.  Every hit gets: damage, a physical shove,
// stagger, a directional flinch, sparks, hit-stop and camera shake (via onHit).
// The swing itself has weight: Webbs lunges into it and moves slower while
// committed.  Distances are authored for scale 1 and × Webbs' zone scale.

type MeleeStyle = 'sword' | 'axe' | 'stab'

interface MeleeProfile {
  style:      MeleeStyle
  damage:     number
  stamina:    number
  cooldownMs: number
  active:     [number, number]   // part of the swing (0–1) where the blade can hit
  reach:      number             // blade length forward of the leg tip
  radius:     number             // blade half-width + a little forgiveness
  maxHeight:  number             // tip above this (e.g. raised for the slam) can't hit
  knockback:  number             // shove impulse (wu/s before resistance)
  stagger:    number             // seconds of stun
  reaction:   'stab' | 'sword' | 'axe'
  hitStop:    number             // seconds of freeze on a hit
  shake:      { i: number; d: number }
  lunge:      number             // forward impulse on Webbs when the strike lands its active window
  slow:       number             // Webbs' movement multiplier while swinging
  sparks:     { color: number; count: number }
  hitSound:   'sword_hit_enemy' | 'axe_hit_enemy' | 'toothpick_hit'
  missSound:  'sword_hit_ground' | 'axe_hit_ground' | null
  swingSound: 'sword_swing' | 'axe_swing' | 'toothpick_stab'
}

const MELEE: Partial<Record<WeaponType, MeleeProfile>> = {
  [WeaponType.Sword]: {
    style: 'sword', damage: 24, stamina: 10, cooldownMs: 340,
    active: [0.42, 0.74], reach: 0.45, radius: 0.26, maxHeight: 0.62,
    knockback: 6.5, stagger: 0.32, reaction: 'sword',
    hitStop: 0.06, shake: { i: 0.006, d: 0.12 }, lunge: 2.2, slow: 0.45,
    sparks: { color: 0xffd2a0, count: 12 },
    hitSound: 'sword_hit_enemy', missSound: 'sword_hit_ground', swingSound: 'sword_swing',
  },
  [WeaponType.Axe]: {
    style: 'axe', damage: 52, stamina: 22, cooldownMs: 780,
    active: [0.18, 0.84], reach: 0.34, radius: 0.32, maxHeight: 0.75,
    knockback: 13, stagger: 0.8, reaction: 'axe',
    hitStop: 0.10, shake: { i: 0.012, d: 0.2 }, lunge: 1.6, slow: 0.35,
    sparks: { color: 0xffb070, count: 18 },
    hitSound: 'axe_hit_enemy', missSound: 'axe_hit_ground', swingSound: 'axe_swing',
  },
  [WeaponType.BoxingGloves]: {
    style: 'stab', damage: 10, stamina: 5, cooldownMs: 240,
    active: [0.12, 0.52], reach: 0.55, radius: 0.16, maxHeight: 0.6,
    knockback: 3.5, stagger: 0.2, reaction: 'stab',
    hitStop: 0.035, shake: { i: 0.004, d: 0.08 }, lunge: 3.2, slow: 0.7,
    sparks: { color: 0xe8dcc0, count: 7 },
    hitSound: 'toothpick_hit', missSound: null, swingSound: 'toothpick_stab',
  },
}

// ── Bow ─────────────────────────────────────────────────────────────────────────
const BOW_SPEED    = 11.0   // wu/s — a thrown thistle, not a floating bubble
const BOW_DMG      = 22
const BOW_STAMINA  = 12
const BOW_CD       = 380
const BOW_KB       = 5.0
const BOW_PROJ_R   = 0.06
const BOW_STAGGER  = 0.22
const BOW_RANGE    = 6.0
const BOW_HITSTOP  = 0.04
const STUCK_TIME   = 2.0    // arrows stay in walls this long, then fade
const ANIM_BOW     = 0.22

// ── FlameBreather ───────────────────────────────────────────────────────────────
const FLAME_RANGE    = 1.2
const FLAME_HALF_ANG = Math.PI / 8   // 45° cone
const FLAME_DPS      = 18
const FLAME_DRAIN    = 120
const FLAME_PUSH     = 4.0           // gentle shove per second — targets back away from the jet
const ANIM_FLAME     = 0.08

const BLADE_SAMPLES = 4     // interpolations between last and current tip

export interface HitEvent {
  x: number; y: number; z: number   // contact point (world)
  damage: number
  weak:   boolean
  kill:   boolean
  weapon: WeaponType
  hitStop: number
  shake:  { i: number; d: number }
}

interface ActiveSwing {
  slot:       number
  webbs:      Webbs3D
  profile:    MeleeProfile
  weapon:     WeaponType
  hitEnemies: Set<Enemy3D>
  lunged:     boolean
  sawStrike:  boolean
  age:        number
  lastT?:     number   // strike progress last frame
}

interface Projectile3D {
  owner:  import('../core/PhysicsWorld').CollisionBody
  mesh:   THREE.Group
  vx:     number
  vz:     number
  travel: number
  range:  number
  radius: number
  stuck:  number    // > 0 → embedded in a wall, seconds left
}

interface HitEffect {
  mesh: THREE.Mesh
  elapsed: number
  duration: number
  maxRadius: number
}

export class WeaponUseSystem3D {
  private enemies:      Enemy3D[] = []
  private cooldowns:    number[]  = Array(8).fill(0)
  shotsFired = 0   // increments on every attack that actually fires (main gates boss rock reflects on it)
  private projectiles:  Projectile3D[] = []
  private hitEffects:   HitEffect[] = []
  private activeSwings: ActiveSwing[] = []
  private threeScene:   THREE.Scene

  staminaDrainMult    = 1
  lastHitFrame        = false
  lastShakeIntensity  = 0
  lastShakeDuration   = 0

  onOutOfAmmo: (() => void) | null = null
  onSpawnHitParticles: ((x: number, y: number, z: number, color: number, count: number) => void) | null = null
  // Every landed hit (hit-stop, damage numbers, feedback) — wired in main.ts
  onHit: ((e: HitEvent) => void) | null = null

  private flameActive    = false
  private flameMesh:     THREE.Mesh | null = null
  private flameAnimTimer = 0
  private _facingDir     = new THREE.Vector3()

  constructor(threeScene: THREE.Scene) {
    this.threeScene = threeScene
  }

  setEnemies(enemies: Enemy3D[]): void { this.enemies = enemies }
  isFlameActive(): boolean { return this.flameActive }

  // ── Flame (continuous) ─────────────────────────────────────────────────────

  tickFlame(slot: number, webbs: Webbs3D, delta: number): void {
    if (!webbs.spendEnergy(FLAME_DRAIN * delta)) { this.stopFlame(); return }

    const s    = webbs.scale
    const fx   = webbs.facingX
    const fz   = webbs.facingZ
    const flen = Math.hypot(fx, fz) || 1

    if (!this.flameMesh) {
      const geo = new THREE.ConeGeometry(0.45, 1.2, 8, 1, true)
      const mat = new THREE.MeshBasicMaterial({ color: 0xff7a1a, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false })
      this.flameMesh = new THREE.Mesh(geo, mat)
      this.threeScene.add(this.flameMesh)
    }
    this.flameMesh.scale.setScalar(s)
    this.flameMesh.position.set(
      webbs.collisionBody.x + (fx / flen) * 0.65 * s,
      0.3 * s,
      webbs.collisionBody.z + (fz / flen) * 0.65 * s,
    )
    this._facingDir.set(fx / flen, 0, fz / flen)
    this.flameMesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), this._facingDir)
    ;(this.flameMesh.material as THREE.MeshBasicMaterial).opacity = 0.35 + Math.random() * 0.4

    this.flameActive = true
    audio.playLoop('flame_loop', webbs.collisionBody.x, webbs.collisionBody.z)
    audio.updateLoopPosition('flame_loop', webbs.collisionBody.x, webbs.collisionBody.z)

    const facingAngle = Math.atan2(fx / flen, fz / flen)
    for (const enemy of this.enemies) {
      if (enemy.isDead() || !enemy.collisionBody.enabled) continue   // e.g. a buried centipede
      const dx   = enemy.collisionBody.x - webbs.collisionBody.x
      const dz   = enemy.collisionBody.z - webbs.collisionBody.z
      if (enemy.collisionBody.surfaceDistance(webbs.collisionBody.x, webbs.collisionBody.z) > FLAME_RANGE * s) continue
      let diff = Math.atan2(dx, dz) - facingAngle
      while (diff >  Math.PI) diff -= Math.PI * 2
      while (diff < -Math.PI) diff += Math.PI * 2
      if (Math.abs(diff) <= FLAME_HALF_ANG) {
        enemy.takeDamage(FLAME_DPS * delta, WeakPointZone.Body, WeaponType.FlameBreather)
        audio.play('flame_hit', enemy.collisionBody.x, enemy.collisionBody.z)   // throttled by minGap
        const l = Math.hypot(dx, dz) || 1
        enemy.collisionBody.push((dx / l) * FLAME_PUSH * delta, (dz / l) * FLAME_PUSH * delta)
        this.lastHitFrame = true
      }
    }

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
    audio.stopLoop('flame_loop')
  }

  // ── Per-frame update ───────────────────────────────────────────────────────

  update(delta: number): void {
    this.lastHitFrame = false
    for (let i = 0; i < 8; i++) {
      if (this.cooldowns[i] > 0) this.cooldowns[i] -= delta * 1000   // ms
    }
    this.tickSwings(delta)
    this.tickProjectiles(delta)
    this.tickHitEffects(delta)
  }

  // ── Activation ─────────────────────────────────────────────────────────────

  activateWeapon(slot: number, webbs: Webbs3D, aim?: { dx: number; dz: number }): void {
    if (this.cooldowns[slot] > 0 || webbs.isDying) return
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
      const melee = MELEE[weapon]
      if (melee) this.fireMelee(slot, webbs, weapon, melee)
      else if (weapon === WeaponType.Bow) this.fireBow(slot, webbs)
      // FlameBreather is continuous — tickFlame() while the key is held
    } finally {
      if (aim) { webbs.facingX = oldFx; webbs.facingZ = oldFz }
    }
  }

  private fireMelee(slot: number, webbs: Webbs3D, weapon: WeaponType, p: MeleeProfile): void {
    if (!webbs.spendStamina(p.stamina * this.staminaDrainMult)) return
    this.cooldowns[slot] = p.cooldownMs
    this.shotsFired++
    webbs.legs.startWeaponSwing(slot, p.style, webbs.facingX, webbs.facingZ)
    audio.play(p.swingSound, webbs.collisionBody.x, webbs.collisionBody.z)
    webbs.commitAttack(p.slow, p.cooldownMs / 1000)
    this.activeSwings.push({
      slot, webbs, profile: p, weapon,
      hitEnemies: new Set(), lunged: false, sawStrike: false, age: 0,
    })
  }

  // ── Melee: sweep the blade through the active window ──────────────────────

  private tickSwings(delta: number): void {
    const keep: ActiveSwing[] = []
    for (const sw of this.activeSwings) {
      sw.age += delta
      const p  = sw.profile
      const st = sw.webbs.legs.strike(sw.slot)
      if (!st) {
        // Swing over (or never started) — whiff thud if nothing was hit
        if ((sw.sawStrike || sw.age > 1) && sw.hitEnemies.size === 0 && p.missSound) {
          audio.play(p.missSound, sw.webbs.collisionBody.x, sw.webbs.collisionBody.z)
        }
        if (sw.sawStrike || sw.age > 1) continue
        keep.push(sw)
        continue
      }
      sw.sawStrike = true
      keep.push(sw)
      // Live if the window overlaps this frame's [last t, t] — at very low frame
      // rates one step can jump clean over a short window (the Toothpick's is ~0.1 s)
      const t0 = sw.lastT ?? 0   // first frame seen: the swing ran from t = 0 to here
      sw.lastT = st.t
      if (st.t < p.active[0] || t0 > p.active[1]) continue

      const s = sw.webbs.scale
      if (!sw.lunged) {
        sw.lunged = true
        sw.webbs.collisionBody.push(st.dirX * p.lunge * s, st.dirZ * p.lunge * s)
      }

      const reach  = p.reach * s
      const radius = p.radius * s
      const maxH   = p.maxHeight * s + sw.webbs.group.position.y
      for (const enemy of this.enemies) {
        if (enemy.isDead() || sw.hitEnemies.has(enemy) || !enemy.collisionBody.enabled) continue
        // Closest approach of the swept blade to the enemy's collider surface
        let best = Infinity, bx = 0, bz = 0
        for (let k = 0; k <= BLADE_SAMPLES; k++) {
          const u  = k / BLADE_SAMPLES
          const ty = st.py + (st.y - st.py) * u
          if (ty > maxH) continue
          const tx = st.px + (st.x - st.px) * u
          const tz = st.pz + (st.z - st.pz) * u
          for (const along of [0, 0.5, 1]) {
            const x = tx + st.dirX * reach * along
            const z = tz + st.dirZ * reach * along
            const d = enemy.collisionBody.surfaceDistance(x, z)
            if (d < best) { best = d; bx = x; bz = z }
          }
        }
        if (best > radius) continue
        sw.hitEnemies.add(enemy)
        this.landHit(sw, enemy, bx, bz)
      }
    }
    this.activeSwings = keep
  }

  private landHit(sw: ActiveSwing, enemy: Enemy3D, cx: number, cz: number): void {
    const p    = sw.profile
    const zone = this.resolveZone(enemy, sw.webbs.collisionBody.x, sw.webbs.collisionBody.z)
    const weak = zone !== WeakPointZone.Body && !!enemy.config.weakPoints?.includes(zone)
    const hp0  = enemy.hp
    enemy.takeDamage(p.damage, zone, sw.weapon)
    const dealt = Math.max(0, hp0 - enemy.hp)
    audio.play(p.hitSound, enemy.collisionBody.x, enemy.collisionBody.z)

    // Shove away from Webbs; the axe also carries its sweep sideways
    let kx = enemy.collisionBody.x - sw.webbs.collisionBody.x
    let kz = enemy.collisionBody.z - sw.webbs.collisionBody.z
    const kl = Math.hypot(kx, kz) || 1
    kx /= kl; kz /= kl
    const st = sw.webbs.legs.strike(sw.slot)
    if (p.style === 'axe' && st) {
      const sx = st.x - st.px, sz = st.z - st.pz
      const sl = Math.hypot(sx, sz)
      if (sl > 1e-4) { kx = kx * 0.6 + (sx / sl) * 0.4; kz = kz * 0.6 + (sz / sl) * 0.4 }
    }
    const nl = Math.hypot(kx, kz) || 1
    enemy.applyKnockback((kx / nl) * p.knockback * (weak ? 1.25 : 1), (kz / nl) * p.knockback * (weak ? 1.25 : 1))
    enemy.stagger(p.stagger)
    enemy.startHitReaction(p.reaction)

    const hy = 0.25 * sw.webbs.scale
    this.onSpawnHitParticles?.(cx, hy, cz, weak ? 0xffe27a : p.sparks.color, p.sparks.count + (weak ? 8 : 0))
    this.spawnHitRing(cx, cz, (p.style === 'axe' ? 1.0 : 0.7) * sw.webbs.scale, 0.35, weak ? 0xffe27a : 0xfff1dc)
    this.lastHitFrame       = true
    this.lastShakeIntensity = Math.max(this.lastShakeIntensity, p.shake.i * (weak ? 1.5 : 1))
    this.lastShakeDuration  = Math.max(this.lastShakeDuration, p.shake.d)
    this.onHit?.({
      x: cx, y: hy, z: cz, damage: dealt, weak, kill: enemy.isDead(), weapon: sw.weapon,
      hitStop: p.hitStop * (weak ? 1.5 : 1) + (enemy.isDead() ? 0.04 : 0), shake: p.shake,
    })
  }

  // ── Bow ────────────────────────────────────────────────────────────────────

  private fireBow(slot: number, webbs: Webbs3D): void {
    if (webbs.winded || webbs.stamina <= 0) return
    const inv     = registry.get<Record<string, number>>('craftingInventory') ?? {}
    const thistle = inv.Thistle ?? 0
    if (thistle <= 0) { this.onOutOfAmmo?.(); return }
    inv.Thistle = thistle - 1
    registry.set('craftingInventory', inv)

    webbs.spendStamina(BOW_STAMINA * this.staminaDrainMult)
    this.cooldowns[slot] = BOW_CD
    this.shotsFired++
    webbs.legs.triggerAnim(slot, ANIM_BOW, webbs.facingX, webbs.facingZ)
    webbs.commitAttack(0.8, 0.2)
    audio.play('bow_draw', webbs.collisionBody.x, webbs.collisionBody.z)
    audio.play('bow_release', webbs.collisionBody.x, webbs.collisionBody.z)

    const s = webbs.scale
    // Thistle dart: shaft + barbed head, pointing along +Z (oriented below)
    const g = new THREE.Group()
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.42, 5), new THREE.MeshBasicMaterial({ color: 0x9a7a4a }))
    shaft.rotation.x = Math.PI / 2
    const head = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.12, 6), new THREE.MeshBasicMaterial({ color: 0xd79bff }))
    head.rotation.x = Math.PI / 2; head.position.z = 0.25
    g.add(shaft, head)
    g.scale.setScalar(s)
    g.position.set(webbs.collisionBody.x + webbs.facingX * 0.3 * s, 0.45 * s + webbs.group.position.y, webbs.collisionBody.z + webbs.facingZ * 0.3 * s)
    g.lookAt(g.position.x + webbs.facingX, g.position.y, g.position.z + webbs.facingZ)
    this.threeScene.add(g)

    this.projectiles.push({
      owner: webbs.collisionBody,
      mesh: g, vx: webbs.facingX * BOW_SPEED * s, vz: webbs.facingZ * BOW_SPEED * s,
      travel: 0, range: BOW_RANGE * s, radius: BOW_PROJ_R * s, stuck: 0,
    })
  }

  private tickProjectiles(delta: number): void {
    const keep: Projectile3D[] = []
    for (const proj of this.projectiles) {
      if (proj.stuck > 0) {
        proj.stuck -= delta
        if (proj.stuck <= 0) { proj.mesh.removeFromParent(); continue }
        if (proj.stuck < 0.4) proj.mesh.scale.multiplyScalar(0.92)
        keep.push(proj)
        continue
      }
      const step = Math.hypot(proj.vx, proj.vz) * delta
      const hit  = physicsWorld.castBall(proj.mesh.position.x, proj.mesh.position.z, proj.vx, proj.vz, step, proj.radius, proj.owner)
      if (hit) {
        const enemy = hit.body ? this.enemies.find(e => e.collisionBody === hit.body && !e.isDead()) : undefined
        if (enemy) {
          const hp0 = enemy.hp
          enemy.addStuckThistle()
          enemy.takeDamage(BOW_DMG, WeakPointZone.Body, WeaponType.Bow)
          audio.play('bow_hit_enemy', enemy.collisionBody.x, enemy.collisionBody.z)
          const len = Math.hypot(proj.vx, proj.vz) || 1
          enemy.applyKnockback((proj.vx / len) * BOW_KB, (proj.vz / len) * BOW_KB)
          enemy.stagger(BOW_STAGGER)
          enemy.startHitReaction('small')
          this.onSpawnHitParticles?.(hit.x, 0.3, hit.z, 0xd79bff, 8)
          this.spawnHitRing(hit.x, hit.z, 0.5, 0.3, 0xd79bff)
          this.lastHitFrame = true
          this.onHit?.({ x: hit.x, y: 0.3, z: hit.z, damage: Math.max(0, hp0 - enemy.hp), weak: false, kill: enemy.isDead(),
            weapon: WeaponType.Bow, hitStop: BOW_HITSTOP, shake: { i: 0.004, d: 0.08 } })
          proj.mesh.removeFromParent()
        } else {
          // Thunk into the wall and stay there a moment
          audio.play('bow_hit_wall', hit.x, hit.z)
          const len = Math.hypot(proj.vx, proj.vz) || 1
          proj.mesh.position.x = hit.x - (proj.vx / len) * 0.08
          proj.mesh.position.z = hit.z - (proj.vz / len) * 0.08
          proj.stuck = STUCK_TIME
          keep.push(proj)
        }
        continue
      }
      proj.mesh.position.x += proj.vx * delta
      proj.mesh.position.z += proj.vz * delta
      proj.travel += step
      if (proj.travel >= proj.range) {
        // Spent: drop and skid out
        proj.stuck = 0.5
        keep.push(proj)
        continue
      }
      keep.push(proj)
    }
    this.projectiles = keep
  }

  // ── VFX ────────────────────────────────────────────────────────────────────

  private spawnHitRing(x: number, z: number, maxR: number, duration: number, color: number): void {
    const geo = new THREE.RingGeometry(0.01, 0.06, 20).rotateX(-Math.PI / 2)
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false })
    const mesh = new THREE.Mesh(geo, mat)
    mesh.position.set(x, 0.03, z)
    this.threeScene.add(mesh)
    this.hitEffects.push({ mesh, elapsed: 0, duration, maxRadius: maxR })
  }

  private tickHitEffects(delta: number): void {
    const keep: HitEffect[] = []
    for (const fx of this.hitEffects) {
      fx.elapsed += delta
      const t = fx.elapsed / fx.duration
      if (t >= 1) { fx.mesh.removeFromParent(); fx.mesh.geometry.dispose(); continue }
      const e = 1 - (1 - t) * (1 - t)   // ease-out
      fx.mesh.scale.setScalar(fx.maxRadius * 14 * e)
      ;(fx.mesh.material as THREE.MeshBasicMaterial).opacity = 0.85 * (1 - t)
      keep.push(fx)
    }
    this.hitEffects = keep
  }

  // ── Weak points ────────────────────────────────────────────────────────────

  private resolveZone(enemy: Enemy3D, wx: number, wz: number): WeakPointZone {
    // Beetle underbelly: hit from behind while it's charging
    if (enemy instanceof BeetleTank3D && enemy.isCharging()) {
      const cf  = enemy.getChargeFacing()
      const bax = wx - enemy.collisionBody.x
      const baz = wz - enemy.collisionBody.z
      const len = Math.hypot(bax, baz) || 1
      if (cf.x * (bax / len) + cf.z * (baz / len) < -0.5) return WeakPointZone.Underbelly
    }
    // Front-facing hits on head-weak enemies (centipede) land on the head
    if (enemy.config.weakPoints?.includes(WeakPointZone.Head)) {
      const y  = enemy.group.rotation.y
      const fx = Math.sin(y), fz = Math.cos(y)
      const ax = wx - enemy.collisionBody.x, az = wz - enemy.collisionBody.z
      const al = Math.hypot(ax, az) || 1
      if ((fx * ax + fz * az) / al > 0.7) return WeakPointZone.Head
    }
    return WeakPointZone.Body
  }
}
