import * as THREE from 'three'
import { physicsWorld, type CollisionBody } from '../core/PhysicsWorld'
import { BossNose3D } from '../entities/BossNose3D'
import { RollerBoss3D } from '../entities/RollerBoss3D'
import type { Enemy3D } from '../entities/Enemy3D'
import type { Webbs3D } from '../entities/Webbs3D'
import type { WeaponUseSystem3D } from '../systems/WeaponUseSystem3D'
import type { HudSystem } from '../ui/HudSystem'

const W = 22   // X: -11 … +11
const D = 7.2  // Z: -3.6 … +3.6

const NOSE_XZ: [number, number] = [0, -2.0]   // XZ position in arena

const ROCK_SPEED_MIN  = 1.7
const ROCK_SPEED_MAX  = 3.0
const ROCK_RADIUS     = 0.12
const ROCK_INTERVAL   = 3.0    // seconds between volleys
const SUCTION_CYCLE   = 20.0
const SUCTION_WARN    = 2.0
const SUCTION_ACTIVE  = 4.0
const SUCTION_FORCE   = 5.2    // wu/s² pull toward nose XZ
const SUCTION_LETHAL_R = 0.65  // if unanchored player reaches this close → instant kill

export type BossResult = 'ongoing' | 'victory' | 'defeat'

interface RockBody {
  mesh:      THREE.Mesh
  body:      CollisionBody
  reflected: boolean
}

interface VfxRing {
  mesh:    THREE.Mesh
  elapsed: number
}

interface Shockwave {
  mesh:     THREE.Mesh
  elapsed:  number
  duration: number
  cx: number; cz: number
  maxR:     number
  hitPlayer: boolean
}

export class BossRollerScene3D {
  static readonly SPAWN_X = 0
  static readonly SPAWN_Z = 2.5
  static readonly LEFT  = -W / 2   // -11
  static readonly RIGHT =  W / 2   // +11
  static readonly BACK  = -D / 2   // -3.6
  static readonly FRONT =  D / 2   // +3.6

  enemies: Enemy3D[] = []

  private threeScene:  THREE.Scene
  private gradientMap: THREE.Texture
  private tracked:     THREE.Object3D[] = []

  private nose?:    BossNose3D
  private roller?:  RollerBoss3D

  private bossPhase        = 1
  private retreatTriggered = false
  private result: BossResult = 'ongoing'

  // Phase 1 rocks
  private rocks:          RockBody[] = []
  private rockTimer       = ROCK_INTERVAL

  // Phase 1 suction
  private suctionCycleTimer  = SUCTION_CYCLE
  private suctionWarnTimer   = 0
  private suctionActiveTimer = 0
  private suctionWarning     = false
  private suctionActive      = false

  // Phase 2
  private rollerContactCooldown = 0
  private shockwaves: Shockwave[] = []

  // Visual effects
  private vfxRings: VfxRing[] = []

  constructor(threeScene: THREE.Scene, gradientMap: THREE.Texture) {
    this.threeScene  = threeScene
    this.gradientMap = gradientMap

    physicsWorld.bounds = {
      minX: -10.8, maxX: 10.8,
      minZ: -3.4,  maxZ: 3.4,
    }

    this.buildArena()
    this.buildLighting()
    this.spawnNose()
  }

  // ── Arena construction ────────────────────────────────────────────────────

  private buildArena(): void {
    // Dark cavern floor
    const floorMat = new THREE.MeshToonMaterial({ color: 0x180c02, gradientMap: this.gradientMap })
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, D).rotateX(-Math.PI / 2), floorMat)
    floor.receiveShadow = true
    this.add(floor)

    // Dirt patches
    const patchMat = new THREE.MeshBasicMaterial({ color: 0x241402 })
    const patches: [number, number][] = [[-7, 0.8], [-2, -1.5], [4, 1.2], [8, -0.6], [-5, 2.0]]
    for (const [px, pz] of patches) {
      const r = 0.4 + Math.random() * 0.5
      this.add(new THREE.Mesh(new THREE.CircleGeometry(r, 8).rotateX(-Math.PI / 2), patchMat))
      const m = this.tracked[this.tracked.length - 1] as THREE.Mesh
      m.position.set(px, 0.006, pz)
    }

    const wallMat = new THREE.MeshToonMaterial({ color: 0x1a0e02, gradientMap: this.gradientMap })

    // Back wall — has hole where nose bursts through
    this.addBox(W + 0.6, 2.0, 0.4, 0, 1.0, -D / 2, wallMat)
    // Front wall (low sill)
    this.addBox(W + 0.6, 0.8, 0.3, 0, 0.4,  D / 2, wallMat)
    // Left and right walls
    this.addBox(0.4, 2.0, D + 0.6, -W / 2, 1.0, 0, wallMat)
    this.addBox(0.4, 2.0, D + 0.6,  W / 2, 1.0, 0, wallMat)

    // Stalactites along ceiling (top edge, near back)
    const stalMat = new THREE.MeshToonMaterial({ color: 0x2a1804, gradientMap: this.gradientMap })
    const stalX = [-9, -6, -3, 0, 3, 6, 9]
    for (const sx of stalX) {
      const h = 0.3 + Math.random() * 0.5
      const stal = new THREE.Mesh(new THREE.ConeGeometry(0.09, h, 6), stalMat)
      stal.position.set(sx, 2.0 - h / 2, -D / 2 + 0.1)
      this.add(stal)
    }

    // Stalagmites from floor (front area)
    const stagMat = new THREE.MeshToonMaterial({ color: 0x241404, gradientMap: this.gradientMap })
    for (let i = -4; i <= 4; i += 2) {
      const h = 0.15 + Math.random() * 0.25
      const stag = new THREE.Mesh(new THREE.ConeGeometry(0.06, h, 5), stagMat)
      stag.position.set(i * 1.8 + (Math.random() - 0.5), h / 2, D / 2 - 0.6)
      stag.rotation.x = Math.PI   // point up
      this.add(stag)
    }

    // Protective ridge under the nose (visual barrier suggesting inaccessibility)
    const ridgeMat = new THREE.MeshToonMaterial({ color: 0x4a2e08, gradientMap: this.gradientMap })
    const ridge = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.14, 0.18), ridgeMat)
    ridge.position.set(NOSE_XZ[0], 0.07, NOSE_XZ[1] + 0.9)
    this.add(ridge)
    for (let i = -2; i <= 2; i++) {
      const rock = new THREE.Mesh(new THREE.SphereGeometry(0.18 + Math.abs(i) * 0.02, 8, 6), ridgeMat)
      rock.position.set(NOSE_XZ[0] + i * 0.56, 0.18, NOSE_XZ[1] + 0.9)
      this.add(rock)
    }

    // Ceiling hole where nose descends (dark ellipse painted on back wall)
    const holeMat = new THREE.MeshBasicMaterial({ color: 0x060402 })
    const holeGeo = new THREE.CircleGeometry(0.7, 16)
    const hole = new THREE.Mesh(holeGeo, holeMat)
    hole.position.set(NOSE_XZ[0], 2.2, -D / 2 + 0.02)
    hole.rotation.y = 0   // faces +z
    this.add(hole)
  }

  private addBox(w: number, h: number, d: number, x: number, y: number, z: number, mat: THREE.Material): void {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat)
    mesh.position.set(x, y, z)
    mesh.castShadow = true; mesh.receiveShadow = true
    this.add(mesh)
  }

  private buildLighting(): void {
    const ambient = new THREE.AmbientLight(0x110804, 0.3)
    this.add(ambient)
    // Dramatic top-down spotlight
    const spot = new THREE.SpotLight(0xff7733, 2.0, 18, Math.PI / 5, 0.55, 1.5)
    spot.position.set(0, 7, 0)
    spot.target.position.set(0, 0, 0.5)
    spot.castShadow = false
    this.add(spot)
    this.add(spot.target)
    // Eerie red glow from the nose direction
    const noseGlow = new THREE.PointLight(0xff3311, 0.8, 7.0)
    noseGlow.position.set(NOSE_XZ[0], 2.2, NOSE_XZ[1])
    this.add(noseGlow)
    // Red accent lights on the walls
    const redL = new THREE.PointLight(0xcc2200, 0.5, 5.0)
    redL.position.set(-8, 1.0, 0)
    this.add(redL)
    const redR = new THREE.PointLight(0xcc2200, 0.5, 5.0)
    redR.position.set(8, 1.0, 0)
    this.add(redR)
  }

  // ── Boss spawning ─────────────────────────────────────────────────────────

  private spawnNose(): void {
    this.nose = new BossNose3D(this.threeScene, NOSE_XZ[0], NOSE_XZ[1], this.gradientMap)
    this.enemies = [this.nose]
  }

  // ── Main update (called from main.ts after physicsWorld.update) ───────────

  update(
    delta:            number,
    webbs:            Webbs3D,
    weaponUseSystem:  WeaponUseSystem3D,
    hud:              HudSystem,
    isAnchored        = false,
  ): BossResult {
    if (this.result !== 'ongoing') return this.result

    this.rollerContactCooldown = Math.max(0, this.rollerContactCooldown - delta)

    // Keep weapon system targeting current enemies
    weaponUseSystem.setEnemies(this.enemies)

    if (this.bossPhase === 1) {
      this.updatePhase1(delta, webbs, hud, isAnchored)
    } else {
      this.updatePhase2(delta, webbs, weaponUseSystem, hud)
    }

    this.updateShockwaves(delta, webbs)
    this.updateVFX(delta)

    return this.result
  }

  // ── Phase 1 ───────────────────────────────────────────────────────────────

  webWallHitTest(x: number, z: number): boolean {
    return x <= BossRollerScene3D.LEFT  + 0.5 ||
           x >= BossRollerScene3D.RIGHT - 0.5 ||
           z <= BossRollerScene3D.BACK  + 0.3 ||
           z >= BossRollerScene3D.FRONT - 0.3
  }

  private updatePhase1(delta: number, webbs: Webbs3D, hud: HudSystem, isAnchored = false): void {
    // Check nose death
    if (this.nose && this.nose.isDead() && !this.retreatTriggered) {
      this.retreatTriggered = true
      this.enemies = []
      hud.hideBossHp()
      // Animate nose shrinking, then start phase 2 after delay
      const retreatStart = performance.now()
      const retreatAnim = () => {
        const t = Math.min((performance.now() - retreatStart) / 700, 1)
        if (this.nose) this.nose.group.scale.setScalar(Math.max(0.01, 1 - t))
        if (t < 1) requestAnimationFrame(retreatAnim)
        else this.startPhase2(hud)
      }
      requestAnimationFrame(retreatAnim)
    }

    if (!this.retreatTriggered) {
      hud.showBossHp("ROLLER'S NOSE", this.nose?.hp ?? 0, this.nose?.hpMax ?? 80)

      // Rock volley timer
      this.rockTimer -= delta
      if (this.rockTimer <= 0) {
        this.rockTimer = ROCK_INTERVAL
        this.spawnRocks(webbs)
      }

      // Suction cycle
      this.updateSuction(delta, webbs, hud, isAnchored)
    }

    // Update nose (static — just handles damage flash)
    if (this.nose && !this.nose.isExpired()) {
      this.nose.update(delta, webbs.collisionBody.x, webbs.collisionBody.z)
    }

    // Update rocks
    this.updateRocks(delta, webbs)
  }

  private spawnRocks(webbs: Webbs3D): void {
    const count = 2 + Math.floor(Math.random() * 2)
    const [nx, nz] = NOSE_XZ

    for (let i = 0; i < count; i++) {
      const spread = (Math.random() - 0.5) * 2.5
      const tx = webbs.collisionBody.x + spread
      const tz = webbs.collisionBody.z
      const dx = tx - nx, dz = tz - nz
      const len = Math.hypot(dx, dz) || 1
      const speed = ROCK_SPEED_MIN + Math.random() * (ROCK_SPEED_MAX - ROCK_SPEED_MIN)

      const geo = new THREE.SphereGeometry(ROCK_RADIUS, 7, 6)
      const mat = new THREE.MeshToonMaterial({ color: 0x8b6914, gradientMap: this.gradientMap })
      const mesh = new THREE.Mesh(geo, mat)
      mesh.position.set(nx, ROCK_RADIUS, nz)
      mesh.castShadow = true
      this.threeScene.add(mesh)

      const body = physicsWorld.add({
        x: nx, z: nz,
        radius:   ROCK_RADIUS,
        velocity: { x: (dx / len) * speed, z: (dz / len) * speed },
        isStatic: false, enabled: true,
      })

      this.rocks.push({ mesh, body, reflected: false })
    }
  }

  private updateRocks(delta: number, webbs: Webbs3D): void {
    const ARENA_X = 10.5, ARENA_Z = 3.1

    for (let i = this.rocks.length - 1; i >= 0; i--) {
      const rock = this.rocks[i]

      // Sync visual (physicsWorld already moved the body)
      rock.mesh.position.set(rock.body.x, ROCK_RADIUS, rock.body.z)

      // Suction pull on rocks
      if (this.suctionActive) {
        const toDx = NOSE_XZ[0] - rock.body.x
        const toDz = NOSE_XZ[1] - rock.body.z
        const len  = Math.hypot(toDx, toDz) || 1
        rock.body.velocity.x += (toDx / len) * 5.0 * delta
        rock.body.velocity.z += (toDz / len) * 5.0 * delta
      }

      // Manual bounce at arena edges (physicsWorld clamps, we then reverse velocity)
      if (rock.body.x <= -ARENA_X) rock.body.velocity.x =  Math.abs(rock.body.velocity.x) * 0.55
      if (rock.body.x >=  ARENA_X) rock.body.velocity.x = -Math.abs(rock.body.velocity.x) * 0.55
      if (rock.body.z <= -ARENA_Z) rock.body.velocity.z =  Math.abs(rock.body.velocity.z) * 0.55
      if (rock.body.z >=  ARENA_Z) rock.body.velocity.z = -Math.abs(rock.body.velocity.z) * 0.55

      // Reflected rock hits nose?
      if (rock.reflected && this.nose && !this.nose.isDead()) {
        const dist = Math.hypot(rock.body.x - NOSE_XZ[0], rock.body.z - NOSE_XZ[1])
        if (dist < 0.55) {
          this.nose.takeDamage(20)
          this.spawnVfxRing(NOSE_XZ[0], NOSE_XZ[1], 0xff5577)
          this.removeRock(i)
          continue
        }
      }

      // Player rock contact (unreflected)
      if (!rock.reflected) {
        const dx = webbs.collisionBody.x - rock.body.x
        const dz = webbs.collisionBody.z - rock.body.z
        if (dx * dx + dz * dz < (webbs.collisionBody.radius + ROCK_RADIUS) ** 2) {
          webbs.damage(18)
          this.removeRock(i)
          continue
        }
      }

      // Cull rocks that escape the arena (shouldn't happen often due to bounce)
      if (
        rock.body.x < -13 || rock.body.x > 13 ||
        rock.body.z < -5  || rock.body.z > 5
      ) {
        this.removeRock(i)
      }
    }
  }

  private removeRock(i: number): void {
    const rock = this.rocks[i]
    this.threeScene.remove(rock.mesh)
    rock.mesh.geometry.dispose()
    physicsWorld.remove(rock.body)
    this.rocks.splice(i, 1)
  }

  // Try to reflect rocks near the player when a melee weapon fires.
  // Called by main.ts after activateWeapon() when weapon is melee.
  tryReflect(webbs: Webbs3D, aimDx: number, aimDz: number): void {
    if (this.bossPhase !== 1) return
    const REFLECT_REACH  = 1.0
    const len            = Math.hypot(aimDx, aimDz) || 1
    const facingAngle    = Math.atan2(aimDx / len, aimDz / len)
    const halfSweep      = 1.1  // ~63° either side

    for (const rock of this.rocks) {
      if (rock.reflected) continue
      const dx   = rock.body.x - webbs.collisionBody.x
      const dz   = rock.body.z - webbs.collisionBody.z
      const dist = Math.sqrt(dx * dx + dz * dz)
      if (dist > REFLECT_REACH) continue

      let diff = Math.atan2(dx, dz) - facingAngle
      while (diff >  Math.PI) diff -= Math.PI * 2
      while (diff < -Math.PI) diff += Math.PI * 2
      if (Math.abs(diff) > halfSweep) continue

      // Reflect toward nose
      const toDx = NOSE_XZ[0] - rock.body.x
      const toDz = NOSE_XZ[1] - rock.body.z
      const tLen = Math.hypot(toDx, toDz) || 1
      rock.body.velocity.x = (toDx / tLen) * 4.2
      rock.body.velocity.z = (toDz / tLen) * 4.2
      rock.reflected = true
      ;(rock.mesh.material as THREE.MeshToonMaterial).color.setHex(0xffcc44)
      this.spawnVfxRing(rock.body.x, rock.body.z, 0xffdd44)
    }
  }

  private updateSuction(delta: number, webbs: Webbs3D, hud: HudSystem, isAnchored = false): void {
    if (!this.suctionWarning && !this.suctionActive) {
      this.suctionCycleTimer -= delta
      if (this.suctionCycleTimer <= 0) {
        this.suctionCycleTimer = SUCTION_CYCLE
        this.suctionWarning    = true
        this.suctionWarnTimer  = SUCTION_WARN
        hud.flashBossMessage('⚠ SUCTION INCOMING ⚠')
      }
    }

    if (this.suctionWarning) {
      this.suctionWarnTimer -= delta
      if (this.suctionWarnTimer <= 0) {
        this.suctionWarning    = false
        this.suctionActive     = true
        this.suctionActiveTimer = SUCTION_ACTIVE
        hud.flashBossMessage('MOVE AWAY OR DIE')
      }
    }

    if (this.suctionActive) {
      this.suctionActiveTimer -= delta
      if (this.suctionActiveTimer <= 0) {
        this.suctionActive = false
        hud.flashBossMessage('')
      } else if (!isAnchored) {
        // Pull player toward nose XZ — web wall-anchor cancels this entirely
        const dx  = NOSE_XZ[0] - webbs.collisionBody.x
        const dz  = NOSE_XZ[1] - webbs.collisionBody.z
        const len = Math.hypot(dx, dz) || 1
        webbs.collisionBody.velocity.x += (dx / len) * SUCTION_FORCE * delta * 60
        webbs.collisionBody.velocity.z += (dz / len) * SUCTION_FORCE * delta * 60
        // Lethal absorb
        if (Math.hypot(dx, dz) < SUCTION_LETHAL_R) {
          webbs.damage(999)
          this.result = 'defeat'
        }
      }
    }
  }

  // ── Phase 1 → Phase 2 transition ──────────────────────────────────────────

  private startPhase2(hud: HudSystem): void {
    this.bossPhase = 2

    // Clear any remaining rocks
    for (let i = this.rocks.length - 1; i >= 0; i--) this.removeRock(i)

    // Spawn the Roller boss on the left side
    this.roller = new RollerBoss3D(this.threeScene, -8, 0, this.gradientMap)
    this.enemies = [this.roller]

    hud.showBossHp('ROLLER', this.roller.hp, this.roller.hpMax)
    hud.flashBossMessage('PHASE 2 — THE ROLLER')
  }

  // ── Phase 2 ───────────────────────────────────────────────────────────────

  private updatePhase2(delta: number, webbs: Webbs3D, _weaponUseSystem: WeaponUseSystem3D, hud: HudSystem): void {
    if (!this.roller) return

    this.roller.update(delta, webbs.collisionBody.x, webbs.collisionBody.z)
    this.roller.syncPosition()

    if (this.roller.isExpired()) {
      this.roller.cleanup()
      this.roller   = undefined
      this.enemies  = []
      // Drop loot into crafting inventory
      this.awardBossLoot()
      this.result = 'victory'
      hud.flashBossMessage('ANT TUNNELS CLEARED!')
      hud.hideBossHp()
      return
    }

    hud.updateBossHp(this.roller.hp, this.roller.hpMax)

    // Ground pound shockwave
    if (this.roller.justReleasedGroundPound) {
      this.spawnShockwave(this.roller.groundPoundReleaseX, this.roller.groundPoundReleaseZ)
    }

    // Tail swipe damage check (one-shot on start)
    if (this.roller.justStartedTailSwipe) {
      this.checkTailSwipe(
        this.roller.tailSwipeX, this.roller.tailSwipeZ,
        this.roller.getFacingDir(), webbs,
      )
    }

    // Body slam contact damage
    if (this.roller.isBodySlamming() && this.rollerContactCooldown <= 0) {
      const dx  = webbs.collisionBody.x - this.roller.collisionBody.x
      const dz  = webbs.collisionBody.z - this.roller.collisionBody.z
      const r2  = webbs.collisionBody.radius + this.roller.config.bodyRadius + 0.2
      if (dx * dx + dz * dz < r2 * r2) {
        webbs.damage(25)
        const len = Math.hypot(dx, dz) || 1
        webbs.collisionBody.velocity.x += (dx / len) * 3.4
        webbs.collisionBody.velocity.z += (dz / len) * 3.4
        this.rollerContactCooldown = 0.8
      }
    }

    // Regular contact damage (patrol)
    if (!this.roller.isBodySlamming() && this.rollerContactCooldown <= 0) {
      const dx = webbs.collisionBody.x - this.roller.collisionBody.x
      const dz = webbs.collisionBody.z - this.roller.collisionBody.z
      const r2 = webbs.collisionBody.radius + this.roller.config.bodyRadius + 0.05
      if (dx * dx + dz * dz < r2 * r2) {
        webbs.damage(this.roller.config.damage)
        this.rollerContactCooldown = 0.75
      }
    }
  }

  private checkTailSwipe(rx: number, rz: number, facingDir: number, webbs: Webbs3D): void {
    const TAIL_RANGE = 1.15
    const tailAngle  = facingDir === 1 ? Math.PI : 0   // tail is on opposite side from snout
    const halfSweep  = 0.65 * Math.PI

    const dx   = webbs.collisionBody.x - rx
    const dz   = webbs.collisionBody.z - rz
    const dist = Math.hypot(dx, dz)
    if (dist > TAIL_RANGE) return

    let diff = Math.atan2(dx, dz) - tailAngle
    while (diff >  Math.PI) diff -= Math.PI * 2
    while (diff < -Math.PI) diff += Math.PI * 2
    if (Math.abs(diff) > halfSweep) return

    webbs.damage(20)
    const len = Math.hypot(dx, dz) || 1
    webbs.collisionBody.velocity.x += (dx / len) * 2.8
    webbs.collisionBody.velocity.z += (dz / len) * 2.8
  }

  private spawnShockwave(cx: number, cz: number): void {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.25, 0.38, 24).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xffaa22, transparent: true, opacity: 0.8, side: THREE.DoubleSide }),
    )
    ring.position.set(cx, 0.04, cz)
    this.threeScene.add(ring)
    this.shockwaves.push({ mesh: ring, elapsed: 0, duration: 0.65, cx, cz, maxR: 2.1, hitPlayer: false })
  }

  private updateShockwaves(delta: number, webbs: Webbs3D): void {
    for (let i = this.shockwaves.length - 1; i >= 0; i--) {
      const sw = this.shockwaves[i]
      sw.elapsed += delta
      const t = Math.min(sw.elapsed / sw.duration, 1)
      const r = 0.25 + (sw.maxR - 0.25) * t
      sw.mesh.scale.setScalar(r / 0.25)
      ;(sw.mesh.material as THREE.MeshBasicMaterial).opacity = 0.8 * (1 - t)

      // Damage player when shockwave ring passes over them
      if (!sw.hitPlayer && sw.elapsed < sw.duration) {
        const dist = Math.hypot(webbs.collisionBody.x - sw.cx, webbs.collisionBody.z - sw.cz)
        if (Math.abs(dist - r) < 0.3) {
          webbs.damage(22)
          sw.hitPlayer = true
        }
      }

      if (sw.elapsed >= sw.duration) {
        this.threeScene.remove(sw.mesh)
        sw.mesh.geometry.dispose()
        this.shockwaves.splice(i, 1)
      }
    }
  }

  // ── VFX rings ─────────────────────────────────────────────────────────────

  private spawnVfxRing(x: number, z: number, color: number): void {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.1, 0.18, 16).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, side: THREE.DoubleSide }),
    )
    ring.position.set(x, 0.04, z)
    this.threeScene.add(ring)
    this.vfxRings.push({ mesh: ring, elapsed: 0 })
  }

  private updateVFX(delta: number): void {
    for (let i = this.vfxRings.length - 1; i >= 0; i--) {
      const r = this.vfxRings[i]
      r.elapsed += delta
      const t = Math.min(r.elapsed / 0.3, 1)
      r.mesh.scale.setScalar(1 + t * 2.5)
      ;(r.mesh.material as THREE.MeshBasicMaterial).opacity = 0.9 * (1 - t)
      if (t >= 1) {
        this.threeScene.remove(r.mesh)
        r.mesh.geometry.dispose()
        this.vfxRings.splice(i, 1)
      }
    }
  }

  // ── Boss loot ─────────────────────────────────────────────────────────────

  private awardBossLoot(): void {
    this.pendingLoot = {
      CrystalDust: 3, BoneFragment: 2, VenomGland: 2, ChitinShard: 3,
    }
  }

  pendingLoot: Record<string, number> | null = null

  // ── Public helper ─────────────────────────────────────────────────────────

  isPhase1(): boolean { return this.bossPhase === 1 }

  // Boss scene manages its own lifecycle inside update() — this stub
  // satisfies the generic call site in main.ts.
  updateEnemies(_delta: number, _px: number, _pz: number): void {}

  destroy(): void {
    for (let i = this.rocks.length - 1; i >= 0; i--) this.removeRock(i)

    // Shockwaves
    for (const sw of this.shockwaves) {
      this.threeScene.remove(sw.mesh); sw.mesh.geometry.dispose()
    }
    this.shockwaves = []

    // VFX rings
    for (const r of this.vfxRings) {
      this.threeScene.remove(r.mesh); r.mesh.geometry.dispose()
    }
    this.vfxRings = []

    // Boss entities
    this.nose?.cleanup()
    this.roller?.cleanup()

    for (const obj of this.tracked) {
      this.threeScene.remove(obj)
      if ((obj as THREE.Mesh).isMesh) (obj as THREE.Mesh).geometry.dispose()
    }
    this.tracked = []
    physicsWorld.bounds = null
  }

  private add(obj: THREE.Object3D): void {
    this.tracked.push(obj)
    this.threeScene.add(obj)
  }
}
