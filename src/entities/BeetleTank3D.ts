import * as THREE from 'three'
import { Enemy3D, type EnemyConfig3D, WeakPointZone } from './Enemy3D'

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

const CHARGE_SPEED   = 2.9    // 290 px/s × 0.01
const CHARGE_RANGE   = 2.6    // 260 px × 0.01
const CHARGE_DUR     = 0.68
const CHARGE_COOLDOWN = 3.6

type BeetleState = 'PATROL' | 'CHARGING'

export class BeetleTank3D extends Enemy3D {
  private state:        BeetleState = 'PATROL'
  private patrolDir     = 1          // +1 right, -1 left
  private chargeTimer   = 0
  private chargeCooldown = 0
  private chargeDir     = new THREE.Vector2(1, 0)
  private facingAngle   = 0

  private shellMesh: THREE.Mesh | null = null

  constructor(threeScene: THREE.Scene, x: number, z: number, gradientMap: THREE.Texture) {
    super(threeScene, x, z, CONFIG, gradientMap)
    this.buildVisuals()
  }

  buildVisuals(): void {
    // Shell — dark green flattened ellipsoid
    const shellGeo = new THREE.SphereGeometry(1, 14, 10)
    const shellMat = new THREE.MeshToonMaterial({ color: 0x2d4a1a, gradientMap: this.gradientMap })
    this.shellMesh = new THREE.Mesh(shellGeo, shellMat)
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

    const dx = playerX - this.collisionBody.x
    const dz = playerZ - this.collisionBody.z
    const dist = Math.sqrt(dx * dx + dz * dz)

    switch (this.state) {
      case 'PATROL': {
        // Check if we should start a charge
        if (dist < CHARGE_RANGE && this.chargeCooldown <= 0) {
          this.state = 'CHARGING'
          this.chargeTimer = 0
          this.chargeDir.set(dx, dz).normalize()
          break
        }

        // Patrol horizontally
        this.collisionBody.velocity.x = this.patrolDir * CONFIG.speed
        this.collisionBody.velocity.z = 0

        // Reverse at patrol limits or world edge
        const x = this.collisionBody.x
        if (x > 11.5 || x < -11.5) {
          this.patrolDir *= -1
        }

        this.facingAngle = this.patrolDir > 0 ? Math.PI / 2 : -Math.PI / 2
        this.group.rotation.y = this.facingAngle
        break
      }

      case 'CHARGING': {
        this.chargeTimer += delta
        this.collisionBody.velocity.x = this.chargeDir.x * CHARGE_SPEED
        this.collisionBody.velocity.z = this.chargeDir.y * CHARGE_SPEED

        // Face charge direction
        this.group.rotation.y = Math.atan2(this.chargeDir.x, this.chargeDir.y)

        if (this.chargeTimer >= CHARGE_DUR) {
          this.state = 'PATROL'
          this.chargeCooldown = CHARGE_COOLDOWN
          this.collisionBody.velocity.x = 0
          this.collisionBody.velocity.z = 0
        }
        break
      }
    }
  }
}
