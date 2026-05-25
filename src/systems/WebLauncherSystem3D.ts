import * as THREE from 'three'
import type { Enemy3D } from '../entities/Enemy3D'
import type { Webbs3D } from '../entities/Webbs3D'

// Converted from WebLauncherSystem.ts (Phaser px → Three.js world units × 0.01)
const PROJECTILE_SPEED      = 7.0   // wu/s   (700px/s)
const MAX_RANGE             = 4.8   // wu     (480px)
const PULL_DURATION         = 0.35  // s      (350ms)
const PULL_VELOCITY         = 9.0   // wu/s   (900px/s)
const IDLE_RELEASE          = 4.5   // s      (4500ms)
const COOLDOWN              = 0.22  // s      (220ms)
const STAMINA_COST          = 8
const PLAYER_PULL_THRESHOLD = 0.5   // knockbackResist ≥ this → player gets pulled instead
const PICKUP_REACH          = 0.36  // wu     (36px) — auto-collect distance
const RECALL_RELEASE        = 0.18  // wu     (18px) — recalled projectile reaches player

export interface PullablePickup3D {
  x: number
  z: number
  active: boolean
  collect: () => void
}

type Target3D =
  | { kind: 'enemy';  ref: Enemy3D }
  | { kind: 'wall';   x: number; z: number }
  | { kind: 'pickup'; ref: PullablePickup3D }

interface WebState3D {
  projectile?: {
    mesh:      THREE.Mesh
    vx:        number
    vz:        number
    traveled:  number
    recalling: boolean
  }
  attached?:   Target3D
  line:        THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>
  age:         number
  pulling:     boolean
  pullElapsed: number
}

export class WebLauncherSystem3D {
  private state:         WebState3D | null = null
  private cooldown       = 0
  private enemies:       Enemy3D[] = []
  private wallHitTest:   (x: number, z: number) => boolean = () => false
  private pickupHitTest: (x: number, z: number) => PullablePickup3D | null = () => null
  private threeScene:    THREE.Scene

  constructor(threeScene: THREE.Scene) {
    this.threeScene = threeScene
  }

  setEnemies(enemies: Enemy3D[]):  void { this.enemies = enemies }
  setWallHitTest(fn: (x: number, z: number) => boolean): void { this.wallHitTest = fn }
  setPickupHitTest(fn: (x: number, z: number) => PullablePickup3D | null): void { this.pickupHitTest = fn }

  isAttachedToWall(): boolean { return this.state?.attached?.kind === 'wall' }
  isActive():         boolean { return this.state !== null }

  // Q pressed: cancel active web or fire a new one
  onQPressed(webbs: Webbs3D, aim?: { dx: number; dz: number }): void {
    if (!webbs.hasWebLauncher) return

    if (this.state) {
      this.release()
      return
    }

    if (this.cooldown > 0 || webbs.stamina <= 0) return
    webbs.stamina = Math.max(0, webbs.stamina - STAMINA_COST)
    this.fire(webbs, aim)
    this.cooldown = COOLDOWN
  }

  update(webbs: Webbs3D, delta: number): void {
    if (this.cooldown > 0) this.cooldown -= delta
    if (!this.state) return

    this.state.age += delta

    if (this.state.projectile) {
      this.tickProjectile(webbs, delta)
      return
    }

    // Active pull phase
    if (this.state.attached && this.state.pulling) {
      this.state.pullElapsed += delta
      this.applyPullVelocity(webbs, delta)

      if (this.state.attached.kind === 'pickup') {
        const pk = this.state.attached.ref
        const dx = pk.x - webbs.collisionBody.x
        const dz = pk.z - webbs.collisionBody.z
        if (!pk.active || Math.hypot(dx, dz) < PICKUP_REACH) {
          if (pk.active) pk.collect()
          this.release()
          return
        }
      }

      if (this.state.pullElapsed >= PULL_DURATION) {
        this.state.pulling = false
        if (this.state.attached.kind !== 'wall') {
          this.release()
          return
        }
      }
    }

    // Auto-release idle wall anchor after timeout
    if (this.state.attached && !this.state.pulling && this.state.age > IDLE_RELEASE) {
      this.release()
      return
    }

    this.updateLine(webbs)
  }

  private tickProjectile(webbs: Webbs3D, delta: number): void {
    if (!this.state?.projectile) return
    const p = this.state.projectile

    p.mesh.position.x += p.vx * delta
    p.mesh.position.z += p.vz * delta
    p.traveled += Math.hypot(p.vx * delta, p.vz * delta)

    if (p.recalling) {
      const dx = webbs.collisionBody.x - p.mesh.position.x
      const dz = webbs.collisionBody.z - p.mesh.position.z
      const angle = Math.atan2(dz, dx)
      p.vx = Math.cos(angle) * PROJECTILE_SPEED
      p.vz = Math.sin(angle) * PROJECTILE_SPEED
      if (Math.hypot(dx, dz) < RECALL_RELEASE) {
        this.release()
        return
      }
      this.updateLine(webbs)
      return
    }

    const px = p.mesh.position.x
    const pz = p.mesh.position.z

    // Pickup hit
    const pickupHit = this.pickupHitTest(px, pz)
    if (pickupHit) {
      this.state.attached = { kind: 'pickup', ref: pickupHit }
      this.landProjectile()
      this.startPull(webbs)
      this.updateLine(webbs)
      return
    }

    // Enemy hit
    for (const e of this.enemies) {
      if (e.isDead()) continue
      const dx = px - e.collisionBody.x
      const dz = pz - e.collisionBody.z
      if (Math.hypot(dx, dz) < 0.28) {
        this.state.attached = { kind: 'enemy', ref: e }
        this.landProjectile()
        this.startPull(webbs)
        this.updateLine(webbs)
        return
      }
    }

    // Wall hit
    if (this.wallHitTest(px, pz)) {
      this.state.attached = { kind: 'wall', x: px, z: pz }
      this.landProjectile()
      this.startPull(webbs)
      this.updateLine(webbs)
      return
    }

    // Max range → recall
    if (p.traveled > MAX_RANGE) {
      p.recalling = true
      p.traveled  = 0
    }

    this.updateLine(webbs)
  }

  private fire(webbs: Webbs3D, aim?: { dx: number; dz: number }): void {
    let dx = webbs.facingX
    let dz = webbs.facingZ
    if (aim) {
      const len = Math.hypot(aim.dx, aim.dz) || 1
      dx = aim.dx / len
      dz = aim.dz / len
    }

    const geo = new THREE.SphereGeometry(0.05, 6, 4)
    const mat = new THREE.MeshBasicMaterial({ color: 0xeeeeff })
    const mesh = new THREE.Mesh(geo, mat)
    mesh.position.set(webbs.collisionBody.x, 0.4, webbs.collisionBody.z)
    this.threeScene.add(mesh)

    // Silk strand line — 2-point BufferGeometry updated every frame
    const lineGeo = new THREE.BufferGeometry()
    const positions = new Float32Array(6)
    lineGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    const lineMat = new THREE.LineBasicMaterial({ color: 0xddeeff, transparent: true, opacity: 0.85 })
    const line = new THREE.Line(lineGeo, lineMat)
    line.frustumCulled = false
    this.threeScene.add(line)

    this.state = {
      projectile:  { mesh, vx: dx * PROJECTILE_SPEED, vz: dz * PROJECTILE_SPEED, traveled: 0, recalling: false },
      line,
      age:         0,
      pulling:     false,
      pullElapsed: 0,
    }
  }

  private landProjectile(): void {
    if (!this.state?.projectile) return
    this.threeScene.remove(this.state.projectile.mesh)
    this.state.projectile.mesh.geometry.dispose()
    ;(this.state.projectile.mesh.material as THREE.Material).dispose()
    this.state.projectile = undefined
  }

  private startPull(webbs: Webbs3D): void {
    if (!this.state?.attached) return
    this.state.pulling     = true
    this.state.pullElapsed = 0
    this.applyPullVelocity(webbs, 0)
  }

  private applyPullVelocity(webbs: Webbs3D, delta: number): void {
    if (!this.state?.attached) return
    const target = this.state.attached

    if (target.kind === 'enemy') {
      const e     = target.ref
      const heavy = e.config.knockbackResist >= PLAYER_PULL_THRESHOLD
      if (heavy) {
        const dx  = e.collisionBody.x - webbs.collisionBody.x
        const dz  = e.collisionBody.z - webbs.collisionBody.z
        const len = Math.hypot(dx, dz) || 1
        webbs.collisionBody.velocity.x = (dx / len) * PULL_VELOCITY
        webbs.collisionBody.velocity.z = (dz / len) * PULL_VELOCITY
      } else {
        const dx  = webbs.collisionBody.x - e.collisionBody.x
        const dz  = webbs.collisionBody.z - e.collisionBody.z
        const len = Math.hypot(dx, dz) || 1
        e.collisionBody.velocity.x = (dx / len) * PULL_VELOCITY
        e.collisionBody.velocity.z = (dz / len) * PULL_VELOCITY
      }
    } else if (target.kind === 'wall') {
      const dx  = target.x - webbs.collisionBody.x
      const dz  = target.z - webbs.collisionBody.z
      const len = Math.hypot(dx, dz) || 1
      webbs.collisionBody.velocity.x = (dx / len) * PULL_VELOCITY
      webbs.collisionBody.velocity.z = (dz / len) * PULL_VELOCITY
    } else if (target.kind === 'pickup' && delta > 0) {
      const pk  = target.ref
      const dx  = webbs.collisionBody.x - pk.x
      const dz  = webbs.collisionBody.z - pk.z
      const len = Math.hypot(dx, dz) || 1
      const step = PULL_VELOCITY * delta
      pk.x += (dx / len) * step
      pk.z += (dz / len) * step
    }
  }

  private updateLine(webbs: Webbs3D): void {
    if (!this.state) return
    const pos = this.state.line.geometry.attributes.position as THREE.BufferAttribute

    pos.setXYZ(0, webbs.collisionBody.x, 0.4, webbs.collisionBody.z)

    if (this.state.projectile) {
      pos.setXYZ(1, this.state.projectile.mesh.position.x, 0.4, this.state.projectile.mesh.position.z)
    } else if (this.state.attached) {
      const a = this.state.attached
      if (a.kind === 'enemy') {
        pos.setXYZ(1, a.ref.collisionBody.x, 0.4, a.ref.collisionBody.z)
      } else if (a.kind === 'wall') {
        pos.setXYZ(1, a.x, 0.4, a.z)
      } else {
        pos.setXYZ(1, a.ref.x, 0.4, a.ref.z)
      }
    }

    pos.needsUpdate = true
    this.state.line.geometry.computeBoundingSphere()
  }

  release(): void {
    if (!this.state) return
    if (this.state.projectile) {
      this.threeScene.remove(this.state.projectile.mesh)
      this.state.projectile.mesh.geometry.dispose()
      ;(this.state.projectile.mesh.material as THREE.Material).dispose()
    }
    this.threeScene.remove(this.state.line)
    this.state.line.geometry.dispose()
    this.state.line.material.dispose()
    this.state = null
  }
}
