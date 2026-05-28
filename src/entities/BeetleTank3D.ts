import * as THREE from 'three'
import { Enemy3D, type EnemyConfig3D, WeakPointZone } from './Enemy3D'
import { physicsWorld } from '../core/PhysicsWorld'
import { WeaponType } from '../systems/WeaponSystem'
import { audio } from '../systems/AudioManager'

// ── Stats ─────────────────────────────────────────────────────────────────────
const CONFIG: EnemyConfig3D = {
  health:          80,
  speed:           0.48,   // 48 px/s × 0.01
  damage:          20,
  bodyRadius:      0.26,   // 26 px × 0.01
  knockbackResist: 0.65,
  staggerDuration: 0.70,
  weakPoints:      [WeakPointZone.Underbelly],
  weakMultiplier:  1.8,
}

const CHARGE_SPEED    = 2.9    // 290 px/s × 0.01
const CHARGE_RANGE    = 2.6    // trigger charge within this distance
const CHARGE_DUR      = 0.68
const CHARGE_COOLDOWN = 3.6
const WINDUP_DUR      = 0.52   // wind-up before charge
const RECOVER_DUR     = 0.50   // post-charge recovery
const WALL_NEAR_DIST  = 0.75   // distance to physics boundary = "hit a wall"

type BeetleState = 'PATROL' | 'WINDUP' | 'CHARGING' | 'RECOVERING'

export class BeetleTank3D extends Enemy3D {
  private state:         BeetleState = 'PATROL'
  private prevBeetleState: BeetleState = 'PATROL'   // Round 10 — for transition SFX
  private patrolDir      = 1          // +1 right, -1 left
  private chargeTimer    = 0
  private chargeCooldown = 0
  private chargeDir      = new THREE.Vector2(1, 0)
  private facingAngle    = 0

  private shellMesh:   THREE.Mesh | null = null
  private shellMat:    THREE.MeshToonMaterial | null = null
  private slamRings:   Array<{ mesh: THREE.Mesh; elapsed: number }> = []
  private legMeshes:   THREE.Mesh[] = []   // Round 9b: tracked for flailing on stab/axe deaths
  private shellPieces: THREE.Mesh[] = []   // Round 9b: detached shell chunks (physics-ticked)
  private stumbleAngle = 0

  constructor(threeScene: THREE.Scene, x: number, z: number, gradientMap: THREE.Texture) {
    super(threeScene, x, z, CONFIG, gradientMap)
    this.buildVisuals()
  }

  buildVisuals(): void {
    // Shell — dark green flattened ellipsoid
    const shellGeo = new THREE.SphereGeometry(1, 14, 10)
    this.shellMat  = new THREE.MeshToonMaterial({
      color: 0x2d4a1a, gradientMap: this.gradientMap,
      emissive: new THREE.Color(0, 0, 0), emissiveIntensity: 0,
    })
    this.shellMesh = new THREE.Mesh(shellGeo, this.shellMat)
    this.shellMesh.scale.set(0.28, 0.16, 0.35)
    this.shellMesh.position.y = 0.18
    this.shellMesh.castShadow = true
    this.group.add(this.shellMesh)

    // Carapace highlight stripe
    const stripeMat = new THREE.MeshToonMaterial({ color: 0x3a6022, gradientMap: this.gradientMap })
    const stripe = new THREE.Mesh(new THREE.SphereGeometry(0.96, 12, 8), stripeMat)
    stripe.scale.set(0.1, 0.12, 0.32)
    stripe.position.set(0, 0.2, 0)
    this.group.add(stripe)

    // Armor spike on top
    const spikeMat = new THREE.MeshToonMaterial({ color: 0x1a2e0a, gradientMap: this.gradientMap })
    const spike = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.14, 5), spikeMat)
    spike.position.set(0, 0.34, -0.05)
    this.group.add(spike)

    // Red eyes (front pair)
    const eyeMat = new THREE.MeshStandardMaterial({ color: 0xff1111, emissive: 0xcc0000, emissiveIntensity: 1.2 })
    const eyeGeo = new THREE.SphereGeometry(0.03, 6, 4)
    for (const ex of [-0.1, 0.1]) {
      const eye = new THREE.Mesh(eyeGeo, eyeMat)
      eye.position.set(ex, 0.2, 0.3)
      this.group.add(eye)
    }

    // 6 stubby leg pairs
    const legMat = new THREE.MeshToonMaterial({ color: 0x1f3510, gradientMap: this.gradientMap })
    for (let i = 0; i < 3; i++) {
      const lz = (i - 1) * 0.18
      for (const side of [-1, 1]) {
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 2, 6), legMat)
        leg.scale.set(0.035, 0.1, 0.035)
        leg.position.set(side * 0.32, 0.08, lz)
        leg.rotation.z = side * 0.6
        this.group.add(leg)
        this.legMeshes.push(leg)
      }
    }
  }

  isCharging(): boolean { return this.state === 'CHARGING' }
  getChargeFacing(): { x: number; z: number } { return { x: this.chargeDir.x, z: this.chargeDir.y } }

  protected setFlashColor(on: boolean): void {
    if (this.shellMesh) {
      ;(this.shellMesh.material as THREE.MeshToonMaterial).color.setHex(on ? 0xff4422 : 0x2d4a1a)
    }
  }

  updateAI(delta: number, playerX: number, playerZ: number): void {
    this.chargeCooldown = Math.max(0, this.chargeCooldown - delta)
    this.tickSlamRings(delta)

    // Round 10 — beetle state-transition SFX
    if (this.state !== this.prevBeetleState) {
      const cx = this.collisionBody.x, cz = this.collisionBody.z
      if (this.state === 'WINDUP')        audio.play('beetle_charge_windup', cx, cz)
      else if (this.state === 'RECOVERING' && this.prevBeetleState === 'CHARGING') {
        audio.play('beetle_charge_crash', cx, cz)
      }
      else if (this.state === 'PATROL')   audio.playLoop('beetle_walk', cx, cz)
      else if (this.state === 'CHARGING') audio.playLoop('beetle_charging', cx, cz)
      if (this.prevBeetleState === 'PATROL')   audio.stopLoop('beetle_walk')
      if (this.prevBeetleState === 'CHARGING') audio.stopLoop('beetle_charging')
      this.prevBeetleState = this.state
    }

    const dx   = playerX - this.collisionBody.x
    const dz   = playerZ - this.collisionBody.z
    const dist = Math.sqrt(dx * dx + dz * dz)

    switch (this.state) {
      case 'PATROL': {
        if (dist < CHARGE_RANGE && this.chargeCooldown <= 0) {
          this.state      = 'WINDUP'
          this.chargeTimer = 0
          this.chargeDir.set(dx, dz).normalize()
          this.collisionBody.velocity.x = 0
          this.collisionBody.velocity.z = 0
          break
        }

        this.collisionBody.velocity.x = this.patrolDir * CONFIG.speed
        this.collisionBody.velocity.z = 0

        const x = this.collisionBody.x
        if (x > 11.5 || x < -11.5) this.patrolDir *= -1

        this.facingAngle    = this.patrolDir > 0 ? Math.PI / 2 : -Math.PI / 2
        this.group.rotation.y = this.facingAngle
        break
      }

      case 'WINDUP': {
        this.chargeTimer += delta
        this.collisionBody.velocity.x = 0
        this.collisionBody.velocity.z = 0

        // Re-lock charge direction toward player each frame during windup
        this.chargeDir.set(dx, dz).normalize()
        this.group.rotation.y = Math.atan2(this.chargeDir.x, this.chargeDir.y)

        // Pulsing orange glow on shell as wind-up tell
        if (this.shellMat) {
          const t    = this.chargeTimer / WINDUP_DUR
          const glow = Math.sin(t * Math.PI * 5) * 0.5 + 0.5
          this.shellMat.emissive.setRGB(glow * 0.9, glow * 0.38, 0)
          this.shellMat.emissiveIntensity = t * 0.9 + glow * 0.4
          // Slight vibrate
          const jitter = t * 0.012
          this.group.position.x = this.collisionBody.x + (Math.random() - 0.5) * jitter
          this.group.position.z = this.collisionBody.z + (Math.random() - 0.5) * jitter
        }

        if (this.chargeTimer >= WINDUP_DUR) {
          this.state       = 'CHARGING'
          this.chargeTimer = 0
          if (this.shellMat) {
            this.shellMat.emissive.setRGB(0, 0, 0)
            this.shellMat.emissiveIntensity = 0
          }
        }
        break
      }

      case 'CHARGING': {
        this.chargeTimer += delta
        this.collisionBody.velocity.x = this.chargeDir.x * CHARGE_SPEED
        this.collisionBody.velocity.z = this.chargeDir.y * CHARGE_SPEED
        this.group.rotation.y = Math.atan2(this.chargeDir.x, this.chargeDir.y)

        if (this.chargeTimer >= CHARGE_DUR) {
          this.state      = 'RECOVERING'
          this.chargeTimer = 0
          this.collisionBody.velocity.x = 0
          this.collisionBody.velocity.z = 0
          this.spawnSlamRing()
        }
        break
      }

      case 'RECOVERING': {
        this.collisionBody.velocity.x = 0
        this.collisionBody.velocity.z = 0
        if (this.chargeTimer >= RECOVER_DUR) {
          this.state           = 'PATROL'
          this.chargeTimer     = 0
          this.chargeCooldown  = CHARGE_COOLDOWN
        } else {
          this.chargeTimer += delta
        }
        break
      }
    }
  }

  private spawnSlamRing(): void {
    const b         = physicsWorld.bounds
    const nearWall  = b != null && (
      this.collisionBody.x < b.minX + WALL_NEAR_DIST ||
      this.collisionBody.x > b.maxX - WALL_NEAR_DIST ||
      this.collisionBody.z < b.minZ + WALL_NEAR_DIST ||
      this.collisionBody.z > b.maxZ - WALL_NEAR_DIST
    )
    const ringSize  = nearWall ? 0.48 : 0.30
    const opacity   = nearWall ? 0.85 : 0.55

    const geo  = new THREE.RingGeometry(0.06, ringSize, 20)
    geo.rotateX(-Math.PI / 2)
    const mat  = new THREE.MeshBasicMaterial({ color: 0xaa8840, transparent: true, opacity, side: THREE.DoubleSide })
    const mesh = new THREE.Mesh(geo, mat)
    mesh.position.set(this.collisionBody.x, 0.02, this.collisionBody.z)
    this.threeScene.add(mesh)
    this.slamRings.push({ mesh, elapsed: 0 })
  }

  private tickSlamRings(delta: number): void {
    for (let i = this.slamRings.length - 1; i >= 0; i--) {
      const r = this.slamRings[i]
      r.elapsed += delta
      const t = r.elapsed / 0.50
      r.mesh.scale.setScalar(1 + t * 2.2)
      ;(r.mesh.material as THREE.MeshBasicMaterial).opacity *= (1 - delta * 3.5)
      if (t >= 1) {
        this.threeScene.remove(r.mesh)
        r.mesh.geometry.dispose()
        ;(r.mesh.material as THREE.Material).dispose()
        this.slamRings.splice(i, 1)
      }
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Round 9b — beetle death animations.  The shell is the centrepiece — each
  // weapon either cracks it, shatters it, flips the beetle off it, or cooks it.
  // ───────────────────────────────────────────────────────────────────────────
  override startHitReaction(style: 'small' | 'medium' | 'large' | 'stab' | 'sword' | 'axe'): void {
    super.startHitReaction(style)
    audio.play('beetle_hit', this.collisionBody.x, this.collisionBody.z)
  }

  override startDeath(weapon: WeaponType): void {
    if (this.deathState) return
    const durations: Partial<Record<WeaponType, number>> = {
      [WeaponType.Sword]:         1.10,
      [WeaponType.Axe]:           1.40,
      [WeaponType.BoxingGloves]:  1.20,
      [WeaponType.Bow]:           1.30,
      [WeaponType.FlameBreather]: 1.60,
      [WeaponType.WebLauncher]:   0.90,
      [WeaponType.Empty]:         1.00,
    }
    this.collisionBody.enabled = false
    this.collisionBody.velocity.x = 0
    this.collisionBody.velocity.z = 0
    this.deathState = {
      weapon, elapsed: 0,
      duration: durations[weapon] ?? 1.0,
      phase: 'initial',
    }

    // Round 10 — per-weapon death SFX
    const cx = this.collisionBody.x, cz = this.collisionBody.z
    const deathKey = weapon === WeaponType.Sword         ? 'beetle_death_sword'
                   : weapon === WeaponType.Axe           ? 'beetle_death_axe'
                   : weapon === WeaponType.BoxingGloves  ? 'beetle_death_stab'
                   : weapon === WeaponType.FlameBreather ? 'beetle_death_flame'
                   :                                       'beetle_death_generic'
    audio.stopLoop('beetle_walk')
    audio.stopLoop('beetle_charging')
    audio.play(deathKey, cx, cz)

    switch (weapon) {
      case WeaponType.Sword:         this.setupSwordDeath(); break
      case WeaponType.Axe:           this.setupAxeDeath();   break
      case WeaponType.BoxingGloves:  this.setupStabDeath();  break
      case WeaponType.Bow:           this.setupBowDeath();   break
      case WeaponType.FlameBreather: this.setupBurnDeath();  break
      case WeaponType.WebLauncher:   this.setupWebDeath();   break
      default:                       break
    }
  }

  override updateDeath(delta: number): void {
    if (!this.deathState) return
    this.deathState.elapsed += delta

    // Tick shell-piece physics (chunks detached by sword/axe/flame).
    for (const piece of this.shellPieces) {
      const ud = piece.userData as { vx: number; vy: number; vz: number; rotVx: number; rotVz: number }
      if (ud.vx === undefined) continue
      piece.position.x += ud.vx * delta
      piece.position.y += ud.vy * delta
      piece.position.z += ud.vz * delta
      ud.vy -= 14 * delta
      piece.rotation.x += ud.rotVx * delta
      piece.rotation.z += ud.rotVz * delta
      if (piece.position.y < 0.05) {
        piece.position.y = 0.05
        ud.vy = -ud.vy * 0.25
        ud.vx *= 0.6
        ud.vz *= 0.6
      }
    }

    switch (this.deathState.weapon) {
      case WeaponType.Sword:         this.tickSwordDeath(); break
      case WeaponType.Axe:           this.tickAxeDeath(delta); break
      case WeaponType.BoxingGloves:  this.tickStabDeath(); break
      case WeaponType.Bow:           this.tickBowDeath(delta); break
      case WeaponType.FlameBreather: this.tickBurnDeath(); break
      case WeaponType.WebLauncher:   this.tickWebDeath();  break
      default:                       this.tickGenericDeath(); break
    }
  }

  // ─── SWORD — shell cracks; body slumps to side ──────────────────────────────
  private setupSwordDeath(): void {
    const mat = new THREE.MeshToonMaterial({ color: 0x335522, gradientMap: this.gradientMap })
    for (let i = 0; i < 3; i++) {
      const piece = new THREE.Mesh(
        new THREE.SphereGeometry(0.15, 6, 4, 0, Math.PI * 0.7, 0, Math.PI), mat,
      )
      piece.position.set(
        this.collisionBody.x + (Math.random() - 0.5) * 0.2,
        0.4,
        this.collisionBody.z + (Math.random() - 0.5) * 0.2,
      )
      this.threeScene.add(piece)
      piece.userData = {
        vx: -Math.sin(this.facingAngle) * 1.5 + (Math.random() - 0.5) * 1.0,
        vy: 2.0 + Math.random() * 1.0,
        vz: -Math.cos(this.facingAngle) * 1.5 + (Math.random() - 0.5) * 1.0,
        rotVx: (Math.random() - 0.5) * 5,
        rotVz: (Math.random() - 0.5) * 5,
      }
      this.shellPieces.push(piece)
    }
    this.spawnIchor(this.group.position, 15, 0x66aa33)
  }
  private tickSwordDeath(): void {
    const t = this.deathState!.elapsed / this.deathState!.duration
    this.group.rotation.z = t * 1.5
    this.group.position.y = Math.max(0, 0.2 - t * 0.18)
    this.group.scale.y = 1 - t * 0.2
  }

  // ─── AXE — SHATTER. Shell explodes into chunks, body flips ───────────────
  private setupAxeDeath(): void {
    const mat = new THREE.MeshToonMaterial({ color: 0x335522, gradientMap: this.gradientMap })
    for (let i = 0; i < 8; i++) {
      const piece = new THREE.Mesh(new THREE.DodecahedronGeometry(0.08 + Math.random() * 0.05, 0), mat)
      piece.position.set(
        this.collisionBody.x,
        0.4 + (Math.random() - 0.5) * 0.1,
        this.collisionBody.z,
      )
      this.threeScene.add(piece)
      const angle = Math.random() * Math.PI * 2
      piece.userData = {
        vx: Math.cos(angle) * (3 + Math.random() * 3),
        vy: 4 + Math.random() * 3,
        vz: Math.sin(angle) * (3 + Math.random() * 3),
        rotVx: (Math.random() - 0.5) * 12,
        rotVz: (Math.random() - 0.5) * 12,
      }
      this.shellPieces.push(piece)
    }
    if (this.shellMesh) this.shellMesh.visible = false
    this.spawnIchor(this.group.position, 40, 0x66aa33)
  }
  private tickAxeDeath(delta: number): void {
    const t = this.deathState!.elapsed / this.deathState!.duration
    this.group.rotation.x = Math.min(t * 6, Math.PI)
    this.group.position.x -= Math.sin(this.facingAngle) * delta * 1.5 * (1 - t)
    this.group.position.z -= Math.cos(this.facingAngle) * delta * 1.5 * (1 - t)
    this.group.position.y = Math.max(0.05, 0.3 - t * 0.25)
    for (const leg of this.legMeshes) {
      leg.rotation.x = Math.sin(t * 30 + leg.position.x * 10) * 0.5
    }
  }

  // ─── STAB — flip onto back, legs flailing ──────────────────────────────────
  private setupStabDeath(): void { this.spawnIchor(this.group.position, 5, 0x66aa33) }
  private tickStabDeath(): void {
    const t = this.deathState!.elapsed / this.deathState!.duration
    if (t < 0.4) {
      const back = t * 0.3
      this.group.position.x = this.collisionBody.x - Math.sin(this.facingAngle) * back
      this.group.position.z = this.collisionBody.z - Math.cos(this.facingAngle) * back
      this.group.rotation.x = -(t / 0.4) * 0.5
    } else if (t < 0.7) {
      const ft = (t - 0.4) / 0.3
      this.group.rotation.x = -0.5 - ft * (Math.PI - 0.5)
      this.group.position.y = 0.2 + Math.sin(ft * Math.PI) * 0.3
    } else {
      const flailT = (t - 0.7) / 0.3
      this.group.rotation.x = -Math.PI
      this.group.position.y = 0.15
      for (let i = 0; i < this.legMeshes.length; i++) {
        this.legMeshes[i].rotation.x = Math.sin((t * 25) + i) * 0.4 * (1 - flailT)
      }
    }
  }

  // ─── BOW — arrow embed, stumble in circles, collapse ───────────────────────
  private setupBowDeath(): void {
    const arrow = new THREE.Mesh(
      new THREE.ConeGeometry(0.04, 0.3, 4),
      new THREE.MeshToonMaterial({ color: 0x442288 }),
    )
    arrow.position.set(0, 0.4, 0)
    arrow.rotation.x = Math.PI / 4
    this.group.add(arrow)
    this.spawnIchor(this.group.position, 8, 0x66aa33)
  }
  private tickBowDeath(delta: number): void {
    const t = this.deathState!.elapsed / this.deathState!.duration
    if (t < 0.6) {
      this.stumbleAngle += delta * 6
      this.group.position.x += Math.cos(this.stumbleAngle) * delta * 0.4
      this.group.position.z += Math.sin(this.stumbleAngle) * delta * 0.4
      this.group.rotation.y += delta * 3
      this.group.rotation.z = Math.sin(this.stumbleAngle * 2) * 0.2
    } else {
      const ct = (t - 0.6) / 0.4
      this.group.rotation.z = 0.2 + ct * 1.4
      this.group.position.y = Math.max(0, 0.2 - ct * 0.18)
    }
  }

  // ─── FLAME — shell heats, glows red, then splits ───────────────────────────
  private setupBurnDeath(): void { this.deathState!.phase = 'heating' }
  private tickBurnDeath(): void {
    const t = this.deathState!.elapsed / this.deathState!.duration
    if (t < 0.5) {
      const ht = t / 0.5
      if (this.shellMat) {
        const r = 0x33 + ht * (0xff - 0x33)
        this.shellMat.color.setRGB(r / 255, (0x55 - ht * 0x55) / 255, (0x22 - ht * 0x22) / 255)
        if (this.shellMat.emissive) {
          this.shellMat.emissive.setHex(0xff3300)
          this.shellMat.emissiveIntensity = ht * 1.5
        }
      }
      if (Math.random() < 0.4) this.spawnSmoke(this.group.position, 1)
    } else if (t < 0.75) {
      if (this.deathState!.phase === 'heating') {
        this.deathState!.phase = 'cracked'
        const pieceMat = new THREE.MeshToonMaterial({
          color: 0x553311, emissive: new THREE.Color(0xff3300), emissiveIntensity: 0.8,
        })
        for (let i = 0; i < 4; i++) {
          const piece = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.06, 0.12), pieceMat)
          piece.position.set(this.collisionBody.x, 0.45, this.collisionBody.z)
          this.threeScene.add(piece)
          const angle = (i / 4) * Math.PI * 2
          piece.userData = {
            vx: Math.cos(angle) * 2, vy: 3, vz: Math.sin(angle) * 2,
            rotVx: (Math.random() - 0.5) * 8, rotVz: (Math.random() - 0.5) * 8,
          }
          this.shellPieces.push(piece)
        }
        if (this.shellMesh) this.shellMesh.visible = false
        this.spawnSmoke(this.group.position, 8)
      }
    } else {
      const ct = (t - 0.75) / 0.25
      this.group.position.y = Math.max(0, 0.2 - ct * 0.15)
      this.group.scale.set(1, 1 - ct * 0.5, 1)
      if (Math.random() < 0.3) this.spawnSmoke(this.group.position, 1)
    }
  }

  // ─── WEB — wrapped, slump ──────────────────────────────────────────────────
  private setupWebDeath(): void {
    const wrap = new THREE.Mesh(
      new THREE.SphereGeometry(0.35, 12, 8),
      new THREE.MeshToonMaterial({ color: 0xffffff, transparent: true, opacity: 0.7 }),
    )
    this.group.add(wrap)
  }
  private tickWebDeath(): void {
    const t = this.deathState!.elapsed / this.deathState!.duration
    this.group.rotation.z = t * 1.5
    this.group.position.y = Math.max(0, 0.2 - t * 0.18)
  }

  // ─── GENERIC ───────────────────────────────────────────────────────────────
  private tickGenericDeath(): void {
    const t = this.deathState!.elapsed / this.deathState!.duration
    this.group.rotation.z = t * Math.PI / 2
    this.group.position.y = Math.max(0, 0.2 - t * 0.2)
  }

  override cleanup(): void {
    for (const r of this.slamRings) {
      this.threeScene.remove(r.mesh)
      r.mesh.geometry.dispose()
      ;(r.mesh.material as THREE.Material).dispose()
    }
    this.slamRings = []
    for (const p of this.shellPieces) {
      this.threeScene.remove(p)
      p.geometry.dispose()
      ;(p.material as THREE.Material).dispose()
    }
    this.shellPieces = []
    super.cleanup()
  }
}
