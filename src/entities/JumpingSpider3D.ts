import * as THREE from 'three'
import { Enemy3D, type EnemyConfig3D, WeakPointZone } from './Enemy3D'

const CONFIG: EnemyConfig3D = {
  health:          45,
  speed:           1.0,
  damage:          15,
  bodyRadius:      0.15,
  knockbackResist: 0.2,
  staggerDuration: 0.50,
  weakPoints:      [WeakPointZone.Body],
  weakMultiplier:  1.5,
}

const STALK_SPEED  = 0.9
const LEAP_SPEED   = 4.2   // horizontal speed during jump
const JUMP_HEIGHT  = 0.55  // peak arc (Y wu)
const COIL_DUR     = 0.36  // wind-up crouch
const LEAP_DUR     = 0.44  // air time
const LAND_DUR     = 0.18  // landing squash
const RECOVER_DUR  = 0.55
const LEAP_RANGE   = 2.5   // trigger leap at this distance
const TURN_RATE    = 7.0   // rad/s while stalking

type SpiderState = 'STALK' | 'COIL' | 'LEAP' | 'LAND' | 'RECOVER'

export class JumpingSpider3D extends Enemy3D {
  private state:      SpiderState = 'STALK'
  private stateTimer  = 0
  private leapDir     = new THREE.Vector2(0, 1)
  private facingAngle = 0
  private bodyMesh:   THREE.Mesh | null = null
  private dustRings:  Array<{ mesh: THREE.Mesh; elapsed: number }> = []

  constructor(threeScene: THREE.Scene, x: number, z: number, gradientMap: THREE.Texture) {
    super(threeScene, x, z, CONFIG, gradientMap)
    this.buildVisuals()
  }

  buildVisuals(): void {
    const bodyMat = new THREE.MeshToonMaterial({ color: 0x2a1a0e, gradientMap: this.gradientMap })

    // Main body — large round sphere
    this.bodyMesh = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8), bodyMat)
    this.bodyMesh.scale.set(0.18, 0.15, 0.20)
    this.bodyMesh.position.y = 0.18
    this.bodyMesh.castShadow = true
    this.group.add(this.bodyMesh)

    // Cephalothorax (front-top bump)
    const ceph = new THREE.Mesh(new THREE.SphereGeometry(1, 8, 6), bodyMat.clone())
    ceph.scale.set(0.12, 0.10, 0.14)
    ceph.position.set(0, 0.23, 0.10)
    this.group.add(ceph)

    // 2 large forward-facing eyes (iridescent white)
    const bigEyeMat = new THREE.MeshStandardMaterial({ color: 0xeeffff, emissive: 0x88ccff, emissiveIntensity: 1.1 })
    const bigEyeGeo = new THREE.SphereGeometry(0.046, 7, 5)
    for (const ex of [-0.072, 0.072]) {
      const eye = new THREE.Mesh(bigEyeGeo, bigEyeMat)
      eye.position.set(ex, 0.26, 0.205)
      this.group.add(eye)
    }

    // 2 smaller side eyes
    const smEyeMat = new THREE.MeshStandardMaterial({ color: 0xddeeff, emissive: 0x6699bb, emissiveIntensity: 0.7 })
    const smEyeGeo = new THREE.SphereGeometry(0.028, 5, 4)
    for (const ex of [-0.115, 0.115]) {
      const eye = new THREE.Mesh(smEyeGeo, smEyeMat)
      eye.position.set(ex, 0.245, 0.18)
      this.group.add(eye)
    }

    // Pedipalps
    const palMat = new THREE.MeshToonMaterial({ color: 0x1e1008, gradientMap: this.gradientMap })
    for (const sx of [-0.065, 0.065]) {
      const pal = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.009, 0.11, 5), palMat)
      pal.position.set(sx, 0.18, 0.235)
      pal.rotation.x = -0.45
      this.group.add(pal)
    }

    // 8 legs (4 per side, longer than ant worker)
    const legMat = new THREE.MeshToonMaterial({ color: 0x1e1008, gradientMap: this.gradientMap })
    for (let i = 0; i < 4; i++) {
      const lz = (i - 1.5) * 0.09
      for (const side of [-1, 1]) {
        const upper = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 2, 5), legMat)
        upper.scale.set(0.014, 0.13, 0.014)
        upper.position.set(side * 0.21, 0.12, lz)
        upper.rotation.z = side * 0.9
        upper.rotation.x = -0.15
        this.group.add(upper)
      }
    }
  }

  protected setFlashColor(on: boolean): void {
    if (this.bodyMesh) {
      ;(this.bodyMesh.material as THREE.MeshToonMaterial).color.setHex(on ? 0xff4422 : 0x2a1a0e)
    }
  }

  updateAI(delta: number, playerX: number, playerZ: number): void {
    const dx   = playerX - this.collisionBody.x
    const dz   = playerZ - this.collisionBody.z
    const dist = Math.sqrt(dx * dx + dz * dz)

    this.stateTimer += delta
    this.tickDustRings(delta)

    switch (this.state) {
      case 'STALK': {
        const targetAngle = Math.atan2(dx, dz)
        this.facingAngle  = lerpAngle(this.facingAngle, targetAngle, TURN_RATE * delta)
        this.collisionBody.velocity.x = Math.sin(this.facingAngle) * STALK_SPEED
        this.collisionBody.velocity.z = Math.cos(this.facingAngle) * STALK_SPEED
        this.group.rotation.y = this.facingAngle

        if (dist < LEAP_RANGE && dist > 0.4) {
          this.leapDir.set(dx, dz).normalize()
          this.state      = 'COIL'
          this.stateTimer = 0
          this.collisionBody.velocity.x = 0
          this.collisionBody.velocity.z = 0
        }
        break
      }

      case 'COIL': {
        this.collisionBody.velocity.x = 0
        this.collisionBody.velocity.z = 0
        const t = Math.min(1, this.stateTimer / COIL_DUR)
        // Crouch and spread: flatten Y, widen XZ
        this.group.scale.set(1 + t * 0.22, 1 - t * 0.38, 1 + t * 0.22)
        this.group.rotation.y = Math.atan2(this.leapDir.x, this.leapDir.y)

        if (this.stateTimer >= COIL_DUR) {
          this.state      = 'LEAP'
          this.stateTimer = 0
          this.group.scale.setScalar(1)
        }
        break
      }

      case 'LEAP': {
        const t = this.stateTimer / LEAP_DUR
        this.collisionBody.velocity.x = this.leapDir.x * LEAP_SPEED
        this.collisionBody.velocity.z = this.leapDir.y * LEAP_SPEED
        // Parabolic arc
        this.group.position.y = Math.sin(t * Math.PI) * JUMP_HEIGHT
        // Stretch forward
        this.group.scale.set(0.85, 0.82, 1.35)

        if (this.stateTimer >= LEAP_DUR) {
          this.state      = 'LAND'
          this.stateTimer = 0
          this.collisionBody.velocity.x = 0
          this.collisionBody.velocity.z = 0
          this.group.position.y = 0
          this.group.scale.setScalar(1)
          this.spawnDustRing()
        }
        break
      }

      case 'LAND': {
        this.collisionBody.velocity.x = 0
        this.collisionBody.velocity.z = 0
        const t = this.stateTimer / LAND_DUR
        const squash = 1 - Math.sin(t * Math.PI) * 0.38
        this.group.scale.set(1 / squash, squash, 1 / squash)

        if (this.stateTimer >= LAND_DUR) {
          this.state      = 'RECOVER'
          this.stateTimer = 0
          this.group.scale.setScalar(1)
        }
        break
      }

      case 'RECOVER': {
        this.collisionBody.velocity.x = 0
        this.collisionBody.velocity.z = 0
        if (this.stateTimer >= RECOVER_DUR) {
          this.state      = 'STALK'
          this.stateTimer = 0
        }
        break
      }
    }
  }

  private spawnDustRing(): void {
    const geo = new THREE.RingGeometry(0.05, 0.22, 16)
    geo.rotateX(-Math.PI / 2)
    const mat  = new THREE.MeshBasicMaterial({ color: 0x8b6a44, transparent: true, opacity: 0.60, side: THREE.DoubleSide })
    const mesh = new THREE.Mesh(geo, mat)
    mesh.position.set(this.collisionBody.x, 0.02, this.collisionBody.z)
    this.threeScene.add(mesh)
    this.dustRings.push({ mesh, elapsed: 0 })
  }

  private tickDustRings(delta: number): void {
    for (let i = this.dustRings.length - 1; i >= 0; i--) {
      const d = this.dustRings[i]
      d.elapsed += delta
      const t = d.elapsed / 0.42
      d.mesh.scale.setScalar(1 + t * 2.8)
      ;(d.mesh.material as THREE.MeshBasicMaterial).opacity = 0.60 * (1 - t)
      if (t >= 1) {
        this.threeScene.remove(d.mesh)
        d.mesh.geometry.dispose()
        ;(d.mesh.material as THREE.Material).dispose()
        this.dustRings.splice(i, 1)
      }
    }
  }

  override cleanup(): void {
    for (const d of this.dustRings) {
      this.threeScene.remove(d.mesh)
      d.mesh.geometry.dispose()
      ;(d.mesh.material as THREE.Material).dispose()
    }
    this.dustRings = []
    super.cleanup()
  }
}

function lerpAngle(a: number, b: number, t: number): number {
  let diff = b - a
  while (diff >  Math.PI) diff -= Math.PI * 2
  while (diff < -Math.PI) diff += Math.PI * 2
  return a + diff * Math.min(1, t)
}
