import * as THREE from 'three'
import { Enemy3D, type EnemyConfig3D } from './Enemy3D'

const CONFIG: EnemyConfig3D = {
  health:          15,
  speed:           1.9,
  damage:          6,
  bodyRadius:      0.09,
  knockbackResist: 0.0,
  staggerDuration: 0.20,
}

const CHASE_RANGE   = 3.5   // wu
const WANDER_SPEED  = 0.45
const WANDER_CHANGE = 1.6   // seconds between direction changes
const CHASE_SPEED   = 1.9
const DART_FREQ     = 5.8   // rad/s — erratic swerve oscillator
const DART_AMP      = 0.38  // max angle swerve (radians)

type WorkerState = 'WANDER' | 'CHASE'

export class AntWorker3D extends Enemy3D {
  private state:       WorkerState = 'WANDER'
  private wanderTimer  = 0
  private wanderAngle  = Math.random() * Math.PI * 2
  private dartPhase    = Math.random() * Math.PI * 2
  private facingAngle  = 0
  private bodyMesh:    THREE.Mesh | null = null

  constructor(threeScene: THREE.Scene, x: number, z: number, gradientMap: THREE.Texture) {
    super(threeScene, x, z, CONFIG, gradientMap)
    this.buildVisuals()
  }

  buildVisuals(): void {
    const bodyMat = new THREE.MeshToonMaterial({ color: 0x1a0f06, gradientMap: this.gradientMap })

    // Gaster (rear segment — largest)
    this.bodyMesh = new THREE.Mesh(new THREE.SphereGeometry(1, 8, 6), bodyMat)
    this.bodyMesh.scale.set(0.090, 0.065, 0.11)
    this.bodyMesh.position.set(0, 0.075, -0.06)
    this.bodyMesh.castShadow = true
    this.group.add(this.bodyMesh)

    // Thorax (middle segment)
    const thorax = new THREE.Mesh(new THREE.SphereGeometry(1, 7, 5), bodyMat.clone())
    thorax.scale.set(0.06, 0.055, 0.07)
    thorax.position.set(0, 0.068, 0.055)
    this.group.add(thorax)

    // Head
    const head = new THREE.Mesh(new THREE.SphereGeometry(1, 6, 5), bodyMat.clone())
    head.scale.set(0.048, 0.042, 0.048)
    head.position.set(0, 0.072, 0.155)
    this.group.add(head)

    // Tiny compound eyes
    const eyeMat = new THREE.MeshStandardMaterial({ color: 0xcc2200, emissive: 0x880000, emissiveIntensity: 0.8 })
    const eyeGeo = new THREE.SphereGeometry(0.018, 5, 4)
    for (const ex of [-0.028, 0.028]) {
      const eye = new THREE.Mesh(eyeGeo, eyeMat)
      eye.position.set(ex, 0.08, 0.195)
      this.group.add(eye)
    }

    // Antennae
    const antMat = new THREE.MeshToonMaterial({ color: 0x0e0807, gradientMap: this.gradientMap })
    for (const sx of [-0.025, 0.025]) {
      const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.003, 0.10, 4), antMat)
      ant.position.set(sx, 0.105, 0.21)
      ant.rotation.x = -0.55
      ant.rotation.z = sx < 0 ? -0.35 : 0.35
      this.group.add(ant)
    }

    // 6 legs (3 per side)
    const legMat = new THREE.MeshToonMaterial({ color: 0x0e0807, gradientMap: this.gradientMap })
    for (let i = 0; i < 3; i++) {
      const lz = (i - 1) * 0.075 + 0.04
      for (const side of [-1, 1]) {
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 2, 4), legMat)
        leg.scale.set(0.007, 0.048, 0.007)
        leg.position.set(side * 0.10, 0.038, lz)
        leg.rotation.z = side * 0.85
        this.group.add(leg)
      }
    }
  }

  protected setFlashColor(on: boolean): void {
    if (this.bodyMesh) {
      ;(this.bodyMesh.material as THREE.MeshToonMaterial).color.setHex(on ? 0xff4422 : 0x1a0f06)
    }
  }

  updateAI(delta: number, playerX: number, playerZ: number): void {
    const dx   = playerX - this.collisionBody.x
    const dz   = playerZ - this.collisionBody.z
    const dist = Math.sqrt(dx * dx + dz * dz)

    if (dist < CHASE_RANGE)          this.state = 'CHASE'
    else if (dist > CHASE_RANGE * 1.5) this.state = 'WANDER'

    this.dartPhase += DART_FREQ * delta

    if (this.state === 'CHASE') {
      const targetAngle = Math.atan2(dx, dz)
      // Erratic dart swerve, reduced when very close
      const swerve = Math.sin(this.dartPhase) * DART_AMP * Math.min(1, dist / 0.8)
      this.facingAngle = targetAngle + swerve
      this.collisionBody.velocity.x = Math.sin(this.facingAngle) * CHASE_SPEED
      this.collisionBody.velocity.z = Math.cos(this.facingAngle) * CHASE_SPEED
    } else {
      this.wanderTimer += delta
      if (this.wanderTimer >= WANDER_CHANGE) {
        this.wanderAngle = Math.random() * Math.PI * 2
        this.wanderTimer = 0
      }
      this.facingAngle = this.wanderAngle
      this.collisionBody.velocity.x = Math.sin(this.facingAngle) * WANDER_SPEED
      this.collisionBody.velocity.z = Math.cos(this.facingAngle) * WANDER_SPEED
    }

    this.group.rotation.y = this.facingAngle
  }
}
