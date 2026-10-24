import * as THREE from 'three'
import { disposeTree } from '../core/dispose'
import { surface, PALETTE } from '../env/Materials'
import { physicsWorld, type CollisionBody } from '../core/PhysicsWorld'
import { Anteater3D, AnteaterTongue3D } from '../entities/Anteater3D'
import type { Enemy3D } from '../entities/Enemy3D'
import type { Webbs3D } from '../entities/Webbs3D'
import type { WeaponUseSystem3D } from '../systems/WeaponUseSystem3D'
import type { HudSystem } from '../ui/HudSystem'
import { audio } from '../systems/AudioManager'

// ─── Boss: the Anteater ───────────────────────────────────────────────────────
// (The save/zone id is still 'bossRoller' / 'roller'.)
//
// Phase 1 — THE SNOUT.  Only its snout fits through the hole in the back wall.
//   It snorts rocks at Webbs; a melee swing bats a rock back, and a rock
//   returned into the snout hurts it.  Every so often it INHALES: everything
//   slides toward the nostrils, and only a web anchored to a wall or pillar
//   holds Webbs.  Reaching the snout during an inhale is death.
// Phase 2 — THE TONGUE.  It smashes the wall open, shoves its head through and
//   lashes its tongue along the floor (a red line warns where).  After a lash
//   the tongue lies on the floor for a moment — web it and it's PINNED: beat
//   on it until it tears free.  Some lashes sweep sideways across the arena.
//   Pillars stop the tongue.  It still inhales now and then.

const W = 18                     // x −9 … +9
const D = 11                     // z −5.5 … +5.5
const BACK_Z  = -D / 2
const HOLE_Y  = 1.9
const HOLE_R  = 1.35
const BEAST_SCALE = 1.45   // it should not fit
const PILLARS: Array<[number, number]> = [[-4.6, -0.6], [4.6, -0.6], [-2.2, 2.6], [2.2, 2.6]]
const PILLAR_R = 0.5

const SNOUT_HP     = 100
const ROCK_HIT     = 20
const ROCK_R       = 0.17
const SNORT_EVERY  = 2.6
const INHALE_EVERY = 17
const INHALE_WARN  = 2.0
const INHALE_TIME  = 4.0
const INHALE_PULL  = 3.8
const INHALE_KILL  = 0.9

const TONGUE_REACH = 10
const AIM_TIME     = 0.85
const LASH_TIME    = 0.2
const STUCK_TIME   = 1.6
const PIN_TIME     = 4.5
const RETRACT_TIME = 0.45
const SWEEP_TIME   = 1.15
const LASH_DMG     = 18
const SWEEP_DMG    = 16

export type BossResult = 'ongoing' | 'victory' | 'defeat'

interface RockBody { mesh: THREE.Mesh; body: CollisionBody; reflected: boolean; life: number }
interface Ring { mesh: THREE.Mesh; t: number; dur: number; grow: number }
type TongueState = 'idle' | 'aim' | 'lash' | 'stuck' | 'pinned' | 'retract' | 'sweep'

const _v = new THREE.Vector3()

export class BossRollerScene3D {
  static readonly SPAWN_X = 0
  static readonly SPAWN_Z = 3.9
  static readonly LEFT  = -W / 2
  static readonly RIGHT =  W / 2
  static readonly BACK  = BACK_Z
  static readonly FRONT =  D / 2

  enemies: Enemy3D[] = []
  pendingLoot: Record<string, number> | null = null
  // main.ts wires this to webLauncher.release() — a pinned tongue tears free
  releaseWeb: (() => void) | null = null

  private threeScene:  THREE.Scene
  private gradientMap: THREE.Texture
  private tracked:     THREE.Object3D[] = []
  private bodies:      CollisionBody[] = []
  private anteater:    Anteater3D
  private tongue:      AnteaterTongue3D | null = null
  private result:      BossResult = 'ongoing'
  private phase:       1 | 2 = 1
  private snoutHp      = SNOUT_HP
  private flashT       = 0
  private t            = 0

  // Phase 1
  private rocks: RockBody[] = []
  private snortT = SNORT_EVERY
  private snortCharge = 0
  // Inhale (both phases)
  private inhaleT = INHALE_EVERY
  private inhaleState: 'none' | 'warn' | 'pull' = 'none'
  private inhaleTimer = 0
  private stream: THREE.Points
  // Phase change
  private breakT = -1
  private wallMesh!: THREE.Mesh
  private holeRim!: THREE.Mesh
  private rubble: THREE.Group = new THREE.Group()
  // Phase 2 tongue
  private tState: TongueState = 'idle'
  private tTimer = 1.5
  private aimDir = new THREE.Vector2(0, 1)
  private reachNow = 0
  private reachMax = 0
  private sweepFrom = 0
  private sweepTo = 0
  private lashCount = 0
  private lashHit = false
  private warnLine: THREE.Mesh
  private dieT = -1
  private toldPin = false
  private rings: Ring[] = []

  constructor(threeScene: THREE.Scene, gradientMap: THREE.Texture) {
    this.threeScene  = threeScene
    this.gradientMap = gradientMap
    audio.playLoop('amb_boss')
    physicsWorld.bounds = { minX: -W / 2 + 0.2, maxX: W / 2 - 0.2, minZ: BACK_Z + 0.25, maxZ: D / 2 - 0.2 }

    this.buildArena()
    this.buildLighting()
    this.anteater = new Anteater3D(threeScene, gradientMap, new THREE.Vector3(0, HOLE_Y, BACK_Z - 1.3), BEAST_SCALE)

    // Telegraph strip for the tongue
    this.warnLine = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 1).rotateX(-Math.PI / 2).translate(0, 0, 0.5),
      new THREE.MeshBasicMaterial({ color: 0xff3a2a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }))
    this.warnLine.position.y = 0.03
    this.add(this.warnLine)

    // Dust stream that pours into the nostrils during an inhale
    const n = 160, pos = new Float32Array(n * 3)
    for (let k = 0; k < n; k++) this.resetMote(pos, k, true)
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    this.stream = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xd8c4a0, size: 0.07, transparent: true, opacity: 0, depthWrite: false }))
    this.add(this.stream)
  }

  // ── Arena ─────────────────────────────────────────────────────────────────
  private buildArena(): void {
    const floorMat = surface({ color: PALETTE.bossFloor, tex: 'dirt', texScale: 0.45, gradientMap: this.gradientMap })
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, D).rotateX(-Math.PI / 2), floorMat)
    floor.receiveShadow = true
    this.add(floor)
    const wallMat = surface({ color: PALETTE.bossWall, tex: 'stone', texScale: 0.7, gradientMap: this.gradientMap })
    // Back wall with the hole the snout comes through (drawn as a dark disc + rim)
    this.wallMesh = this.addBox(W + 0.6, 3.2, 0.5, 0, 1.6, BACK_Z - 0.25, wallMat)
    const hole = new THREE.Mesh(new THREE.CircleGeometry(HOLE_R, 28), new THREE.MeshBasicMaterial({ color: 0x050302 }))
    hole.position.set(0, HOLE_Y, BACK_Z + 0.01); this.add(hole)
    this.holeRim = new THREE.Mesh(new THREE.TorusGeometry(HOLE_R + 0.06, 0.2, 8, 28), surface({ color: 0x4a3828, tex: 'stone', texScale: 1, gradientMap: this.gradientMap }))
    this.holeRim.position.set(0, HOLE_Y, BACK_Z + 0.05); this.add(this.holeRim)
    // Cracks radiating from the hole
    const crackMat = new THREE.MeshBasicMaterial({ color: 0x120c08 })
    for (let k = 0; k < 9; k++) {
      const a = (k / 9) * Math.PI * 2 + Math.random() * 0.3, l = 0.6 + Math.random() * 1.2
      const c = new THREE.Mesh(new THREE.PlaneGeometry(0.05, l), crackMat)
      c.position.set(Math.sin(a) * (HOLE_R + 0.15 + l / 2), HOLE_Y + Math.cos(a) * (HOLE_R + 0.15 + l / 2), BACK_Z + 0.02); c.rotation.z = -a
      this.add(c)
    }
    this.addBox(W + 0.6, 1.0, 0.4, 0, 0.5, D / 2 + 0.2, wallMat)
    this.addBox(0.4, 3.2, D + 0.6, -W / 2 - 0.2, 1.6, 0, wallMat)
    this.addBox(0.4, 3.2, D + 0.6,  W / 2 + 0.2, 1.6, 0, wallMat)

    // Pillars: cover from the tongue, anchors for the web
    const pillarMat = surface({ color: PALETTE.bossStag, tex: 'stone', texScale: 1.1, gradientMap: this.gradientMap })
    for (const [x, z] of PILLARS) {
      const col = new THREE.Mesh(new THREE.CylinderGeometry(PILLAR_R * 0.75, PILLAR_R, 2.6, 10), pillarMat)
      col.position.set(x, 1.3, z); col.castShadow = col.receiveShadow = true; this.add(col)
      const cap = new THREE.Mesh(new THREE.ConeGeometry(PILLAR_R * 0.8, 0.8, 10), pillarMat)
      cap.position.set(x, 3.0, z); this.add(cap)
      this.bodies.push(physicsWorld.add({ x, z, radius: PILLAR_R, velocity: { x: 0, z: 0 }, isStatic: true, enabled: true }))
    }
    // Bones of earlier meals
    const boneMat = new THREE.MeshToonMaterial({ color: 0xb8a882, gradientMap: this.gradientMap })
    for (let k = 0; k < 18; k++) {
      const b = new THREE.Mesh(new THREE.CapsuleGeometry(0.03, 0.2, 3, 5), boneMat)
      b.position.set((Math.random() - 0.5) * (W - 2), 0.03, (Math.random() - 0.5) * (D - 2)); b.rotation.set(Math.PI / 2, 0, Math.random() * 3)
      this.add(b)
    }
    this.add(this.rubble)
  }

  private addBox(w: number, h: number, d: number, x: number, y: number, z: number, mat: THREE.Material): THREE.Mesh {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat)
    mesh.position.set(x, y, z); mesh.castShadow = true; mesh.receiveShadow = true
    this.add(mesh)
    return mesh
  }

  private buildLighting(): void {
    // A shaft of light from above onto the arena; warm torches on the side walls;
    // a dim ember glow deep inside the hole (behind the snout, not on it)
    const spot = new THREE.SpotLight(0xffd2a0, 2.6, 24, Math.PI / 4, 0.55, 1.5)
    spot.position.set(0, 10, 1.5); spot.target.position.set(0, 0, -0.5)
    this.add(spot); this.add(spot.target)
    const holeGlow = new THREE.PointLight(0xff6a2a, 0.9, 5)
    holeGlow.position.set(0, HOLE_Y + 0.4, BACK_Z - 0.6); this.add(holeGlow)
    for (const x of [-7.5, 7.5]) { const l = new THREE.PointLight(0xff8a3a, 0.5, 7); l.position.set(x, 1.6, 1); this.add(l) }
  }

  // ── Frame ─────────────────────────────────────────────────────────────────
  update(delta: number, webbs: Webbs3D, weaponUseSystem: WeaponUseSystem3D, hud: HudSystem, isAnchored = false): BossResult {
    if (this.result !== 'ongoing') return this.result
    this.t += delta
    weaponUseSystem.setEnemies(this.enemies)
    const wb = webbs.collisionBody
    const target = _v.set(wb.x, 0.3, wb.z)

    if (this.dieT >= 0) return this.updateDeath(delta, hud)

    if (this.phase === 1) {
      if (this.breakT < 0) {
        hud.showBossHp('THE ANTEATER', this.snoutHp, SNOUT_HP)
        this.anteater.aimAt(target, Math.min(1, delta * 1.5))
        this.updateSnort(delta, webbs, hud)
        this.updateInhale(delta, webbs, hud, isAnchored)
      } else {
        this.updateBreak(delta, hud)
      }
      this.updateRocks(delta, webbs)
    } else {
      this.updateTongue(delta, webbs, hud)
      if (this.tState === 'idle' || this.tState === 'retract') this.updateInhale(delta, webbs, hud, isAnchored)
      if (this.tongue) hud.updateBossHp(this.tongue.hp, this.tongue.hpMax)
    }

    this.flashT = Math.max(0, this.flashT - delta)
    this.anteater.hitFlash(this.flashT > 0)
    this.anteater.update(delta, {
      sniff: this.phase === 1 && this.inhaleState === 'none',
      inhale: this.inhaleState === 'pull' ? 1 : this.inhaleState === 'warn' ? 0.4 : 0,
      flare: this.snortCharge,
    })
    this.updateStream(delta)
    this.updateRings(delta)
    return this.result
  }

  // ── Phase 1: snorted rocks ──────────────────────────────────────────────────
  private updateSnort(delta: number, webbs: Webbs3D, hud: HudSystem): void {
    if (this.inhaleState !== 'none') return
    this.snortT -= delta
    // Nostrils swell for half a second before each volley
    this.snortCharge = this.snortT < 0.5 ? (0.5 - Math.max(0, this.snortT)) * 1.6 : 0
    if (this.snortT > 0) return
    this.snortT = SNORT_EVERY * (0.85 + Math.random() * 0.3)
    this.snortCharge = 0
    const tip = this.anteater.tip(new THREE.Vector3())
    const n = 2 + Math.floor(Math.random() * 2)
    audio.play('boss_charge', tip.x, tip.z, { rate: 1.3, volume: 0.9 })
    for (let k = 0; k < n; k++) {
      const tx = webbs.collisionBody.x + (Math.random() - 0.5) * 3, tz = webbs.collisionBody.z + (Math.random() - 0.5) * 1.5
      const dx = tx - tip.x, dz = tz - tip.z, l = Math.hypot(dx, dz) || 1
      const sp = 2.6 + Math.random() * 1.6
      const mesh = new THREE.Mesh(new THREE.DodecahedronGeometry(ROCK_R, 0), new THREE.MeshToonMaterial({ color: 0x8b7a5a, gradientMap: this.gradientMap }))
      mesh.castShadow = true
      this.threeScene.add(mesh)
      const sx = tip.x + dx / l * 0.5, sz = Math.max(BACK_Z + 0.5, tip.z + dz / l * 0.5)
      const body = physicsWorld.add({ x: sx, z: sz, radius: ROCK_R, velocity: { x: dx / l * sp, z: dz / l * sp }, isStatic: false, enabled: true, ballistic: true, restitution: 0.6 })
      this.rocks.push({ mesh, body, reflected: false, life: 9 })
    }
    this.ring(tip.x, Math.max(BACK_Z + 0.4, tip.z), 0xd8c4a0, 0.5, 2.5)
    if (this.snoutHp === SNOUT_HP && this.rocks.length <= n) hud.flashBossMessage('SWING AT THE ROCKS — KNOCK THEM BACK UP ITS NOSE')
  }

  private updateRocks(delta: number, webbs: Webbs3D): void {
    const tip = this.anteater.tip(new THREE.Vector3())
    for (let i = this.rocks.length - 1; i >= 0; i--) {
      const r = this.rocks[i]
      r.life -= delta
      r.mesh.position.set(r.body.renderX, ROCK_R + (r.reflected ? 0.35 : 0), r.body.renderZ)
      r.mesh.rotation.x += delta * 8; r.mesh.rotation.z += delta * 5
      if (this.inhaleState === 'pull') {
        const dx = tip.x - r.body.x, dz = tip.z - r.body.z, l = Math.hypot(dx, dz) || 1
        r.body.velocity.x += dx / l * 6 * delta; r.body.velocity.z += dz / l * 6 * delta
      }
      if (r.reflected && this.phase === 1 && this.breakT < 0) {
        // Homing a touch so a decent swing finds the snout as it sways
        const dx = tip.x - r.body.x, dz = tip.z - r.body.z, l = Math.hypot(dx, dz) || 1
        r.body.velocity.x += dx / l * 9 * delta; r.body.velocity.z += dz / l * 9 * delta
        if (l < 0.85) {
          this.hurtSnout(ROCK_HIT)
          this.ring(tip.x, Math.max(BACK_Z + 0.3, tip.z), 0xffcc44, 0.4, 3)
          this.removeRock(i)
          continue
        }
      }
      if (!r.reflected && physicsWorld.touching(webbs.collisionBody, r.body, 0.03)) {
        webbs.damage(14, { fromX: r.body.x, fromZ: r.body.z })
        this.removeRock(i)
        continue
      }
      if (r.life <= 0) this.removeRock(i)
    }
  }

  private removeRock(i: number): void {
    const r = this.rocks[i]
    disposeTree(r.mesh)
    physicsWorld.remove(r.body)
    this.rocks.splice(i, 1)
  }

  // Melee swing (main.ts calls this when a melee weapon fires)
  tryReflect(webbs: Webbs3D, aimDx: number, aimDz: number): void {
    if (this.phase !== 1) return
    const reach = 1.25, half = 1.15
    const face = Math.atan2(aimDx, aimDz)
    const tip = this.anteater.tip(new THREE.Vector3())
    for (const r of this.rocks) {
      if (r.reflected) continue
      const dx = r.body.x - webbs.collisionBody.x, dz = r.body.z - webbs.collisionBody.z
      const d = Math.hypot(dx, dz)
      if (d > reach) continue
      let diff = Math.atan2(dx, dz) - face
      while (diff > Math.PI) diff -= Math.PI * 2
      while (diff < -Math.PI) diff += Math.PI * 2
      if (Math.abs(diff) > half) continue
      const tx = tip.x - r.body.x, tz = tip.z - r.body.z, tl = Math.hypot(tx, tz) || 1
      r.body.velocity.x = tx / tl * 7; r.body.velocity.z = tz / tl * 7
      r.reflected = true; r.life = 3
      ;(r.mesh.material as THREE.MeshToonMaterial).color.setHex(0xffcc44)
      ;(r.mesh.material as THREE.MeshToonMaterial).emissive = new THREE.Color(0xaa6600)
      this.ring(r.body.x, r.body.z, 0xffdd44, 0.25, 2.5)
      audio.play('sword_hit_ground', r.body.x, r.body.z, { rate: 1.4 })
    }
  }

  private hurtSnout(n: number): void {
    this.snoutHp = Math.max(0, this.snoutHp - n)
    this.flashT = 0.15
    this.anteater.flinch = 1
    audio.play('boss_hit', 0, BACK_Z)
    audio.impact('heavy', 0, BACK_Z)
    if (this.snoutHp <= 0) this.startBreak()
  }

  // ── Inhale (suction) ──────────────────────────────────────────────────────
  private updateInhale(delta: number, webbs: Webbs3D, hud: HudSystem, isAnchored: boolean): void {
    const wb = webbs.collisionBody
    if (this.inhaleState === 'none') {
      this.inhaleT -= delta
      if (this.inhaleT <= 0) {
        this.inhaleState = 'warn'; this.inhaleTimer = INHALE_WARN
        hud.flashBossMessage('⚠ IT\'S INHALING — WEB A WALL OR PILLAR [Q] ⚠')
        audio.play('boss_windup', 0, BACK_Z)
      }
    } else if (this.inhaleState === 'warn') {
      this.inhaleTimer -= delta
      if (this.inhaleTimer <= 0) { this.inhaleState = 'pull'; this.inhaleTimer = INHALE_TIME; audio.playLoop('boss_suction', 0, BACK_Z, this) }
    } else {
      this.inhaleTimer -= delta
      const tip = this.anteater.tip(new THREE.Vector3())
      const dx = tip.x - wb.x, dz = tip.z - wb.z, d = Math.hypot(dx, dz) || 1
      if (!isAnchored) {
        wb.addDrift(dx / d * INHALE_PULL, dz / d * INHALE_PULL)
        if (d < INHALE_KILL + 0.4 && Math.abs(tip.y) < 2.5 && !webbs.godMode) {
          webbs.damage(999, { unblockable: true })
          this.result = 'defeat'
        }
      }
      if (this.inhaleTimer <= 0) {
        this.inhaleState = 'none'
        this.inhaleT = INHALE_EVERY * (this.phase === 2 ? 0.9 : 1)
        audio.stopLoop('boss_suction', this)
        hud.flashBossMessage('')
      }
    }
  }

  private resetMote(pos: Float32Array, k: number, scatter: boolean): void {
    const a = Math.random() * Math.PI * 2, r = scatter ? Math.random() * 7 : 4 + Math.random() * 4
    pos[k * 3] = Math.cos(a) * r
    pos[k * 3 + 1] = 0.1 + Math.random() * 1.2
    pos[k * 3 + 2] = Math.max(BACK_Z + 0.3, BACK_Z + 2 + Math.abs(Math.sin(a)) * r)
  }

  private updateStream(delta: number): void {
    const mat = this.stream.material as THREE.PointsMaterial
    const on = this.inhaleState === 'pull' ? 1 : 0
    mat.opacity += (on * 0.75 - mat.opacity) * Math.min(1, delta * 4)
    if (mat.opacity < 0.02) return
    const tip = this.anteater.tip(new THREE.Vector3())
    const pos = this.stream.geometry.attributes.position as THREE.BufferAttribute
    const arr = pos.array as Float32Array
    for (let k = 0; k < pos.count; k++) {
      const x = arr[k * 3], y = arr[k * 3 + 1], z = arr[k * 3 + 2]
      const dx = tip.x - x, dy = tip.y - y, dz = tip.z - z, d = Math.hypot(dx, dy, dz)
      if (d < 0.3) { this.resetMote(arr, k, false); continue }
      const sp = (3 + 9 / (d + 0.5)) * delta
      // Spiral in
      arr[k * 3] = x + dx / d * sp + dz / d * sp * 0.3
      arr[k * 3 + 1] = y + dy / d * sp
      arr[k * 3 + 2] = z + dz / d * sp - dx / d * sp * 0.3
    }
    pos.needsUpdate = true
  }

  // ── Phase change: the wall gives ───────────────────────────────────────────
  private startBreak(): void {
    this.breakT = 0
    this.inhaleState = 'none'
    audio.stopLoop('boss_suction', this)
    audio.play('boss_phase_change', 0, BACK_Z)
    for (let i = this.rocks.length - 1; i >= 0; i--) this.removeRock(i)
  }

  private updateBreak(delta: number, hud: HudSystem): void {
    this.breakT += delta
    const t = this.breakT
    hud.flashBossMessage(t < 1.2 ? 'IT\'S BREAKING THROUGH!' : '')
    // Shudders, shoves, the hole tears wide
    this.anteater.flinch = 0.6
    this.anteater.reach = 1 + Math.min(1, t / 1.6) * 0.6
    this.holeRim.scale.setScalar(1 + Math.min(1, t / 1.2) * 0.9)
    this.holeRim.position.y = HOLE_Y - Math.min(1, t / 1.2) * 0.5
    if (Math.random() < delta * 14) {
      const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.12 + Math.random() * 0.22, 0), (this.wallMesh.material as THREE.Material))
      rock.position.set((Math.random() - 0.5) * 3, 0.15, BACK_Z + 0.4 + Math.random() * 1.2)
      rock.rotation.set(Math.random() * 3, Math.random() * 3, 0)
      this.rubble.add(rock)
      audio.impact('medium', rock.position.x, rock.position.z)
    }
    if (t > 2.0) this.startPhase2(hud)
  }

  private startPhase2(hud: HudSystem): void {
    this.phase = 2
    this.breakT = -1
    this.tongue = new AnteaterTongue3D(this.threeScene, this.gradientMap)
    this.enemies = [this.tongue]
    this.tState = 'idle'; this.tTimer = 1.6
    this.inhaleT = INHALE_EVERY * 0.8
    hud.showBossHp('THE ANTEATER — ENRAGED', this.tongue.hp, this.tongue.hpMax)
    hud.flashBossMessage('WATCH THE TONGUE — WEB IT WHEN IT LANDS [Q]')
  }

  // ── Phase 2: the tongue ─────────────────────────────────────────────────────
  // How far the tongue can go from the mouth along (dx, dz) before a pillar/wall
  private clearReach(from: THREE.Vector3, dx: number, dz: number, webbs: Webbs3D): number {
    const hit = physicsWorld.castBall(from.x, from.z, dx, dz, TONGUE_REACH, 0.12, webbs.collisionBody)
    return hit ? Math.max(0.5, Math.hypot(hit.x - from.x, hit.z - from.z) - 0.1) : TONGUE_REACH
  }

  private updateTongue(delta: number, webbs: Webbs3D, hud: HudSystem): void {
    const tg = this.tongue!
    const wb = webbs.collisionBody
    const mouth = this.anteater.tip(new THREE.Vector3())
    const fast = tg.hp < tg.hpMax * 0.5 ? 0.75 : 1
    this.tTimer -= delta
    const wl = this.warnLine.material as THREE.MeshBasicMaterial

    if (tg.isDead()) { this.startDying(hud); return }

    // A web on the tongue pins it
    if ((this.tState === 'stuck' || this.tState === 'lash') && this.webOnTongue) {
      this.tState = 'pinned'; this.tTimer = PIN_TIME; tg.pinned = true
      audio.play('boss_hit', mouth.x, mouth.z, { rate: 0.8 })
      hud.flashBossMessage(this.toldPin ? 'PINNED!' : 'PINNED! HIT THE TONGUE!')
      this.toldPin = true
    }

    switch (this.tState) {
      case 'idle': {
        this.anteater.aimAt(_v.set(wb.x, 0.2, wb.z), Math.min(1, delta * 2))
        this.reachNow = 0
        if (this.tTimer <= 0 && this.inhaleState === 'none') {
          this.lashCount++
          const dx = wb.x - mouth.x, dz = wb.z - mouth.z, l = Math.hypot(dx, dz) || 1
          this.aimDir.set(dx / l, dz / l)
          if (this.lashCount % 3 === 0) {
            // Sweep: start well off to one side, swing across
            const base = Math.atan2(dx, dz), side = Math.random() < 0.5 ? -1 : 1
            this.sweepFrom = base - side * 0.95; this.sweepTo = base + side * 0.95
            this.aimDir.set(Math.sin(this.sweepFrom), Math.cos(this.sweepFrom))
          }
          this.tState = 'aim'; this.tTimer = AIM_TIME * fast
          audio.play('boss_windup', mouth.x, mouth.z, { rate: 1.3 })
        }
        break
      }
      case 'aim': {
        // Track Webbs for most of the wind-up, then commit
        if (this.lashCount % 3 !== 0 && this.tTimer > 0.25) {
          const dx = wb.x - mouth.x, dz = wb.z - mouth.z, l = Math.hypot(dx, dz) || 1
          this.aimDir.lerp(new THREE.Vector2(dx / l, dz / l), Math.min(1, delta * 6)).normalize()
        }
        this.anteater.aimAt(_v.set(mouth.x + this.aimDir.x * 4, 0.1, mouth.z + this.aimDir.y * 4), Math.min(1, delta * 6))
        this.reachMax = this.clearReach(mouth, this.aimDir.x, this.aimDir.y, webbs)
        this.placeWarn(mouth, this.reachMax, 0.25 + 0.35 * Math.abs(Math.sin(this.t * 16)))
        if (this.tTimer <= 0) {
          this.tState = this.lashCount % 3 === 0 ? 'sweep' : 'lash'
          this.tTimer = this.tState === 'sweep' ? SWEEP_TIME * fast : LASH_TIME
          this.lashHit = false
          tg.collisionBody.enabled = this.tState === 'lash'
          audio.play('boss_charge', mouth.x, mouth.z, { rate: 1.8 })
        }
        break
      }
      case 'lash': {
        wl.opacity = 0
        const k = 1 - Math.max(0, this.tTimer) / LASH_TIME
        this.reachNow = this.reachMax * k
        this.tongueHits(mouth, webbs, LASH_DMG)
        if (this.tTimer <= 0) {
          this.tState = 'stuck'; this.tTimer = STUCK_TIME * fast
          this.ring(mouth.x + this.aimDir.x * this.reachMax, mouth.z + this.aimDir.y * this.reachMax, 0xd8607e, 0.3, 2)
          audio.impact('medium', mouth.x + this.aimDir.x * this.reachMax, mouth.z + this.aimDir.y * this.reachMax)
        }
        break
      }
      case 'stuck': {
        // Groping along the floor — the window to web it
        if (this.tTimer <= 0) { this.tState = 'retract'; this.tTimer = RETRACT_TIME }
        break
      }
      case 'pinned': {
        tg.setPinnedGlow(this.t)
        this.anteater.flinch = 0.3
        if (this.tTimer <= 0) {
          // Tears free, shrieking
          tg.pinned = false
          this.releaseWeb?.()
          audio.play('boss_phase_change', mouth.x, mouth.z, { rate: 1.3, volume: 0.7 })
          this.tState = 'retract'; this.tTimer = RETRACT_TIME * 0.6
        }
        break
      }
      case 'retract': {
        tg.collisionBody.enabled = false
        this.reachNow = Math.max(0, this.reachNow - delta * (this.reachMax / RETRACT_TIME))
        if (this.reachNow <= 0.05) { this.tState = 'idle'; this.tTimer = (1.2 + Math.random() * 0.8) * fast }
        break
      }
      case 'sweep': {
        wl.opacity = 0
        const k = 1 - Math.max(0, this.tTimer) / (SWEEP_TIME * fast)
        // Shoots out over the first fifth, then swings across
        const ang = this.sweepFrom + (this.sweepTo - this.sweepFrom) * Math.max(0, (k - 0.2) / 0.8)
        this.aimDir.set(Math.sin(ang), Math.cos(ang))
        this.anteater.aimAt(_v.set(mouth.x + this.aimDir.x * 4, 0.1, mouth.z + this.aimDir.y * 4), Math.min(1, delta * 10))
        this.reachMax = this.clearReach(mouth, this.aimDir.x, this.aimDir.y, webbs)
        this.reachNow = this.reachMax * Math.min(1, k / 0.2)
        this.tongueHits(mouth, webbs, SWEEP_DMG)
        if (this.tTimer <= 0) { this.tState = 'retract'; this.tTimer = RETRACT_TIME }
        break
      }
    }
    if (this.tState !== 'aim') wl.opacity = Math.max(0, wl.opacity - delta * 4)

    const tx = mouth.x + this.aimDir.x * this.reachNow, tz = mouth.z + this.aimDir.y * this.reachNow
    tg.layOut(mouth, tx, tz, delta, this.tState === 'pinned' ? 1 : this.tState === 'stuck' ? 0.4 : 0)
    tg.update(delta, wb.x, wb.z)
    tg.syncPosition()
    if (tg.hp < tg.hpMax && tg.isDead()) this.startDying(hud)
  }

  webOnTongue = false   // main.ts sets this each frame (web attached to the tongue)

  // The tongue's length passing over Webbs
  private tongueHits(mouth: THREE.Vector3, webbs: Webbs3D, dmg: number): void {
    if (this.lashHit) return
    const wb = webbs.collisionBody
    const ax = mouth.x, az = mouth.z
    const bx = ax + this.aimDir.x * this.reachNow, bz = az + this.aimDir.y * this.reachNow
    const vx = bx - ax, vz = bz - az, l2 = vx * vx + vz * vz || 1
    const t = Math.max(0, Math.min(1, ((wb.x - ax) * vx + (wb.z - az) * vz) / l2))
    const d = Math.hypot(wb.x - (ax + vx * t), wb.z - (az + vz * t))
    if (d < wb.radius + 0.12) {
      this.lashHit = true
      if (webbs.damage(dmg, { fromX: ax + vx * t - this.aimDir.y * 0.3, fromZ: az + vz * t + this.aimDir.x * 0.3 })) {
        audio.impact('heavy', wb.x, wb.z)
      }
    }
  }

  private placeWarn(mouth: THREE.Vector3, len: number, opacity: number): void {
    const w = this.warnLine
    w.position.set(mouth.x, 0.03, mouth.z)
    w.rotation.y = Math.atan2(this.aimDir.x, this.aimDir.y)
    w.scale.set(1, 1, len)
    ;(w.material as THREE.MeshBasicMaterial).opacity = opacity
  }

  // ── Defeat ────────────────────────────────────────────────────────────────
  private startDying(hud: HudSystem): void {
    if (this.dieT >= 0) return
    this.dieT = 0
    this.releaseWeb?.()
    if (this.tongue) { this.tongue.pinned = false; this.tongue.collisionBody.enabled = false }
    this.enemies = []
    hud.hideBossHp()
    hud.flashBossMessage('THE ANTEATER RETREATS!')
    audio.play('boss_death', 0, BACK_Z)
    audio.stopLoop('boss_suction', this)
  }

  private updateDeath(delta: number, hud: HudSystem): BossResult {
    this.dieT += delta
    const t = this.dieT
    // Tongue whips back in, the snout recoils through the wall, dust settles
    this.reachNow = Math.max(0, this.reachNow - delta * 18)
    if (this.tongue) {
      const mouth = this.anteater.tip(new THREE.Vector3())
      this.tongue.layOut(mouth, mouth.x + this.aimDir.x * this.reachNow, mouth.z + this.aimDir.y * this.reachNow, delta, 1)
    }
    this.anteater.flinch = Math.max(0, 1 - t)
    this.anteater.reach = Math.max(-1.6, this.anteater.reach - delta * 1.4)
    this.anteater.bend.pitch = Math.max(-0.2, this.anteater.bend.pitch - delta)
    this.anteater.update(delta)
    if (t > 2.2 && this.result === 'ongoing') {
      // Exactly an axe's worth of chitin and bone, plus extras
      this.pendingLoot = { ChitinShard: 4, BoneFragment: 2, CrystalDust: 2, VenomGland: 2 }
      hud.flashBossMessage('THE ANTEATER IS BEATEN!')
      this.result = 'victory'
    }
    this.updateRings(delta)
    return this.result
  }

  // ── VFX ───────────────────────────────────────────────────────────────────
  private ring(x: number, z: number, color: number, r: number, grow: number): void {
    const mesh = new THREE.Mesh(new THREE.RingGeometry(r * 0.8, r, 24).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false }))
    mesh.position.set(x, 0.04, z)
    this.threeScene.add(mesh)
    this.rings.push({ mesh, t: 0, dur: 0.4, grow })
  }
  private updateRings(delta: number): void {
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i]
      r.t += delta
      const k = Math.min(1, r.t / r.dur)
      r.mesh.scale.setScalar(1 + k * r.grow)
      ;(r.mesh.material as THREE.MeshBasicMaterial).opacity = 0.9 * (1 - k)
      if (k >= 1) { disposeTree(r.mesh); this.rings.splice(i, 1) }
    }
  }

  // ── The drop ──────────────────────────────────────────────────────────────
  // After the fight the Anteater leaves its armor behind: chitin plates and
  // splintered bone, tumbling out of the hole.  Walk over it to take it (the
  // materials and the Chitin Axe recipe — main.ts hands those out).
  private drop: { group: THREE.Group; beam: THREE.Mesh; t: number; x: number; z: number; landed: boolean } | null = null

  spawnDrop(): void {
    const g = new THREE.Group()
    const plate = new THREE.MeshToonMaterial({ color: 0x5a4636, gradientMap: this.gradientMap, emissive: new THREE.Color(0xffd08a), emissiveIntensity: 0.15 })
    const bone  = new THREE.MeshToonMaterial({ color: 0xd8ccb0, gradientMap: this.gradientMap })
    for (let k = 0; k < 5; k++) {
      const p = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2.4), plate)
      p.scale.set(1.3, 0.45, 1)
      p.position.set((Math.random() - 0.5) * 0.5, 0.05 + k * 0.03, (Math.random() - 0.5) * 0.4)
      p.rotation.set((Math.random() - 0.5) * 0.6, Math.random() * 3, (Math.random() - 0.5) * 0.6)
      g.add(p)
    }
    for (let k = 0; k < 4; k++) {
      const b = new THREE.Mesh(new THREE.CapsuleGeometry(0.035, 0.32, 3, 6), bone)
      b.position.set((Math.random() - 0.5) * 0.6, 0.06, (Math.random() - 0.5) * 0.5)
      b.rotation.set(Math.PI / 2, 0, Math.random() * 3)
      g.add(b)
    }
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.45, 4, 16, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xffd08a, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }))
    beam.position.y = 2
    g.add(beam)
    const light = new THREE.PointLight(0xffc070, 0, 4, 2)
    light.position.y = 0.8
    g.add(light)
    g.position.set(0, HOLE_Y, BACK_Z + 0.3)
    this.add(g)
    this.drop = { group: g, beam, t: 0, x: 0, z: BACK_Z + 2.4, landed: false }
    audio.play('boss_hit', 0, BACK_Z, { rate: 1.4, volume: 0.6 })
  }

  // Per frame after victory; true the moment Webbs walks over the drop
  tickDrop(delta: number, px: number, pz: number, pr: number): boolean {
    const d = this.drop
    if (!d) return false
    d.t += delta
    const k = Math.min(1, d.t / 0.7)   // tumbles out of the hole in an arc
    const g = d.group
    g.position.set(0, k < 1 ? HOLE_Y * (1 - k) + Math.sin(k * Math.PI) * 0.8 : 0, BACK_Z + 0.3 + (d.z - BACK_Z - 0.3) * k)
    if (k >= 1 && !d.landed) { d.landed = true; this.ring(d.x, d.z, 0xffd08a, 0.4, 3); audio.play('sword_hit_ground', d.x, d.z, { rate: 0.7 }) }
    this.updateRings(delta)
    const glow = Math.min(1, Math.max(0, d.t - 0.7) * 2)
    ;(d.beam.material as THREE.MeshBasicMaterial).opacity = glow * (0.1 + Math.sin(d.t * 3) * 0.03)
    const light = g.children.find(c => c instanceof THREE.PointLight) as THREE.PointLight
    light.intensity = glow * 1.2 * 15
    if (k < 1) return false
    if ((px - d.x) ** 2 + (pz - d.z) ** 2 > (pr + 0.55) ** 2) return false
    this.threeScene.remove(g)
    this.tracked.splice(this.tracked.indexOf(g), 1)
    disposeTree(g)
    this.drop = null
    return true
  }

  isPhase1(): boolean { return this.phase === 1 }

  // Camera target: pulled from Webbs toward the snout so the beast stays in frame
  focus(webbsPos: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
    const tip = this.anteater.tip(new THREE.Vector3())
    return out.set(webbsPos.x + (tip.x - webbsPos.x) * 0.38, webbsPos.y, webbsPos.z + (tip.z - webbsPos.z) * 0.38)
  }
  get tongueEnemy(): Enemy3D | null { return this.tongue }
  updateEnemies(_delta: number, _px: number, _pz: number): void {}

  destroy(): void {
    audio.stopLoop('amb_boss')
    audio.stopLoop('boss_suction', this)
    for (let i = this.rocks.length - 1; i >= 0; i--) this.removeRock(i)
    for (const r of this.rings) disposeTree(r.mesh)
    this.rings = []
    this.tongue?.cleanup()
    this.anteater.dispose()
    for (const b of this.bodies) physicsWorld.remove(b)
    for (const obj of this.tracked) disposeTree(obj)
    this.tracked = []
    physicsWorld.bounds = null
  }

  private add(obj: THREE.Object3D): void {
    this.tracked.push(obj)
    this.threeScene.add(obj)
  }
}
