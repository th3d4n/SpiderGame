import * as THREE from 'three'
import { Enemy3D, type EnemyConfig3D } from './Enemy3D'

const PATROL_SPEED = 1.15   // wu/s  (115 px/s × 0.01)
const CHARGE_SPEED = 3.90   // wu/s  (390 px/s × 0.01)
const LEFT_WALL    = -9.0
const RIGHT_WALL   = 9.0

const CONFIG: EnemyConfig3D = {
  health:          100,
  speed:           PATROL_SPEED,
  damage:          15,
  bodyRadius:      0.42,
  knockbackResist: 0.9,
  staggerDuration: 0.4,
  weakPoints:      ['Head'],
  weakMultiplier:  2.0,
}

type AttackState = 'idle' | 'charging' | 'groundPound' | 'tailSwipe'

export class RollerBoss3D extends Enemy3D {
  private facingDir    = 1          // +1 = right (+x), -1 = left (-x)
  private attackState: AttackState = 'idle'
  private attackTimer  = 0
  private attackCooldown = 0

  // One-shot event flags — scene reads these each frame and resets after
  justStartedBodySlam     = false
  justReleasedGroundPound = false
  justStartedTailSwipe    = false
  groundPoundReleaseX     = 0
  groundPoundReleaseZ     = 0
  tailSwipeX              = 0
  tailSwipeZ              = 0

  constructor(threeScene: THREE.Scene, x: number, z: number, gradientMap: THREE.Texture) {
    super(threeScene, x, z, CONFIG, gradientMap)
    this.buildVisuals()
  }

  buildVisuals(): void {
    // Main body — rounded barrel shape
    const bodyGeo = new THREE.CapsuleGeometry(0.36, 0.52, 4, 8)
    bodyGeo.rotateZ(Math.PI / 2)
    const bodyMesh = new THREE.Mesh(bodyGeo,
      new THREE.MeshToonMaterial({ color: 0x7a5c18, gradientMap: this.gradientMap }))
    bodyMesh.castShadow = true
    this.group.add(bodyMesh)

    // Fur stripes
    const stripeMat = new THREE.LineBasicMaterial({ color: 0x5c4510 })
    for (let i = -2; i <= 2; i++) {
      const g = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(i * 0.13, -0.26, 0.22),
        new THREE.Vector3(i * 0.13, -0.26, -0.22),
      ])
      this.group.add(new THREE.LineSegments(g, stripeMat))
    }

    // Eyes — amber with dark pupils
    const eyeMat   = new THREE.MeshToonMaterial({ color: 0xf0c830, gradientMap: this.gradientMap })
    const pupilMat = new THREE.MeshToonMaterial({ color: 0x111111, gradientMap: this.gradientMap })
    const eyeGeo   = new THREE.SphereGeometry(0.10, 8, 6)
    const pupilGeo = new THREE.SphereGeometry(0.05, 6, 5)
    ;[-0.20, 0.20].forEach(ex => {
      const eye   = new THREE.Mesh(eyeGeo, eyeMat);   eye.position.set(ex, 0.14, -0.26)
      const pupil = new THREE.Mesh(pupilGeo, pupilMat); pupil.position.set(ex, 0.14, -0.33)
      this.group.add(eye, pupil)
    })

    // Pink snout — on the +x side (flips with group.scale.x)
    const snoutMat = new THREE.MeshToonMaterial({ color: 0xff9fad, gradientMap: this.gradientMap })
    const snout = new THREE.Mesh(new THREE.SphereGeometry(0.19, 8, 6), snoutMat)
    snout.scale.set(1, 0.75, 0.9)
    snout.position.set(0.62, 0.04, 0)
    this.group.add(snout)

    // Tail stub — on the -x side
    const tailMat = new THREE.MeshToonMaterial({ color: 0x6b4f15, gradientMap: this.gradientMap })
    const tail = new THREE.Mesh(new THREE.SphereGeometry(0.11, 7, 5), tailMat)
    tail.position.set(-0.64, 0, 0)
    this.group.add(tail)

    // Tiny legs
    const legMat = new THREE.MeshToonMaterial({ color: 0x5c4510, gradientMap: this.gradientMap })
    ;[-0.14, 0.14].forEach(lx => {
      ;[-1, 1].forEach(side => {
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.03, 0.22, 5), legMat)
        leg.position.set(lx, -0.26, side * 0.28)
        leg.rotation.x = side * 0.4
        this.group.add(leg)
      })
    })
  }

  updateAI(delta: number, playerX: number, playerZ: number): void {
    // Clear one-shot flags
    this.justStartedBodySlam     = false
    this.justReleasedGroundPound = false
    this.justStartedTailSwipe    = false

    if (this.attackCooldown > 0) this.attackCooldown -= delta

    switch (this.attackState) {
      case 'charging':
        this.attackTimer -= delta
        if (this.attackTimer <= 0) {
          this.attackState = 'idle'
          this.collisionBody.velocity.x = 0
          this.collisionBody.velocity.z = 0
        }
        return

      case 'groundPound':
        this.attackTimer -= delta
        if (this.attackTimer <= 0) {
          this.attackState = 'idle'
          this.justReleasedGroundPound = true
          this.groundPoundReleaseX = this.collisionBody.x
          this.groundPoundReleaseZ = this.collisionBody.z
        }
        return

      case 'tailSwipe':
        this.attackTimer -= delta
        if (this.attackTimer <= 0) this.attackState = 'idle'
        return

      default: break
    }

    // Patrol — reverse at walls
    if (this.collisionBody.x > RIGHT_WALL) this.facingDir = -1
    if (this.collisionBody.x < LEFT_WALL)  this.facingDir =  1
    this.group.scale.x = this.facingDir

    this.collisionBody.velocity.x = PATROL_SPEED * this.facingDir
    this.collisionBody.velocity.z = 0

    // Attack decisions (only when cooldown is clear)
    if (this.attackCooldown <= 0) {
      const dx = playerX - this.collisionBody.x
      if (Math.abs(dx) < 3.0) {
        this.doBodySlam(playerX, playerZ)
      } else if (Math.random() < 0.004 * (delta / 0.016)) {
        this.doGroundPound()
      } else if (Math.random() < 0.003 * (delta / 0.016)) {
        this.doTailSwipe()
      }
    }
  }

  private doBodySlam(targetX: number, targetZ: number): void {
    const dx = targetX - this.collisionBody.x
    const dz = targetZ - this.collisionBody.z
    const len = Math.hypot(dx, dz) || 1
    this.collisionBody.velocity.x = (dx / len) * CHARGE_SPEED
    this.collisionBody.velocity.z = (dz / len) * CHARGE_SPEED
    this.attackState    = 'charging'
    this.attackTimer    = 0.58
    this.attackCooldown = 2.6
    this.justStartedBodySlam = true
  }

  private doGroundPound(): void {
    this.collisionBody.velocity.x = 0
    this.collisionBody.velocity.z = 0
    this.attackState    = 'groundPound'
    this.attackTimer    = 0.7
    this.attackCooldown = 3.8
  }

  private doTailSwipe(): void {
    this.collisionBody.velocity.x = 0
    this.collisionBody.velocity.z = 0
    this.attackState    = 'tailSwipe'
    this.attackTimer    = 0.5
    this.attackCooldown = 3.2
    this.justStartedTailSwipe = true
    this.tailSwipeX = this.collisionBody.x
    this.tailSwipeZ = this.collisionBody.z
  }

  isBodySlamming():   boolean { return this.attackState === 'charging'    }
  isGroundPounding(): boolean { return this.attackState === 'groundPound' }
  isTailSwiping():    boolean { return this.attackState === 'tailSwipe'   }
  getFacingDir():     number  { return this.facingDir }
  getHealthRatio():   number  { return Math.max(0, this.hp / this.hpMax) }
}
