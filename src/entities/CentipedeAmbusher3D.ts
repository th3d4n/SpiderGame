import * as THREE from 'three'
import { Enemy3D, type EnemyConfig3D, WeakPointZone } from './Enemy3D'

// ── Stats (pixel values × 0.01 = world units) ────────────────────────────────
const CONFIG: EnemyConfig3D = {
  health:          30,
  speed:           1.3,    // 130 px/s × 0.01
  damage:          12,
  bodyRadius:      0.14,   // 14 px × 0.01
  knockbackResist: 0.1,
  staggerDuration: 0.42,   // 420 ms
  weakPoints:      [WeakPointZone.Head],
  weakMultiplier:  2.0,
}

// AI speeds
const TRACK_SPEED   = 0.7   // 70 px/s
const LUNGE_SPEED   = 3.2   // 320 px/s
const TURN_RATE     = 4.5   // rad/s

// AI timings (seconds)
const BURST_DUR     = 0.585
const WINDUP_DUR    = 0.32
const LUNGE_DUR     = 0.28
const RECOVER_DUR   = 0.62

// Trigger distances (world units)
const HIDE_TRIGGER  = 1.9   // 190 px × 0.01

// Burst-slither constants
const SLITHER_FREQ  = 4.0   // rad/s perpendicular oscillator
const SLITHER_AMP   = 0.42  // max angle weave (radians)
const SCURRY_ON     = 0.40  // seconds of high-speed burst
const SCURRY_OFF    = 0.14  // seconds of brief pause between bursts
const SCURRY_FAST   = 1.0   // speed multiplier during burst
const SCURRY_SLOW   = 0.28  // speed multiplier during pause

// Wall-hugging: Z boundaries of corridor dividers (AntColonyScene3D layout)
const WALL_Z_BOUNDS = [-11.5, -8.5, -6.5, -3.5, -1.5, 1.5, 3.5, 6.5, 8.5, 11.5]
const WALL_HUG_DIST = 0.48  // wu from wall to trigger hugging
const WALL_HUG_STR  = 0.78  // blend strength toward wall-run angle

type CentState = 'HIDING' | 'BURSTING' | 'TRACKING' | 'WINDUP' | 'LUNGING' | 'RECOVERING'

export class CentipedeAmbusher3D extends Enemy3D {
  private state:       CentState = 'HIDING'
  private stateTimer   = 0
  private lungeDir     = new THREE.Vector2(0, 1)
  private facingAngle  = 0
  private slitherPhase = Math.random() * Math.PI * 2
  private scurryTimer  = SCURRY_ON
  private scurryActive = true

  // Visual meshes for flash tint
  private bodyMeshes:     THREE.Mesh[] = []
  private eyeMeshes:      THREE.Mesh[] = []
  private mandibleMeshes: THREE.Mesh[] = []
  private mandibleSides:  number[]     = []

  constructor(threeScene: THREE.Scene, x: number, z: number, gradientMap: THREE.Texture) {
    super(threeScene, x, z, CONFIG, gradientMap)
    this.buildVisuals()
    // Start hidden and small
    this.group.scale.setScalar(0.05)
    this.collisionBody.enabled = false
  }

  buildVisuals(): void {
    const segColors = [0x2a4a1a, 0x336622, 0x2a4a1a]
    const segScales = [
      { x: 0.12, y: 0.08, z: 0.14 },  // head
      { x: 0.14, y: 0.09, z: 0.16 },  // mid
      { x: 0.13, y: 0.08, z: 0.14 },  // tail
    ]
    const segZ = [0.16, 0, -0.18]

    for (let i = 0; i < 3; i++) {
      const geo = new THREE.SphereGeometry(1, 10, 8)
      const mat = new THREE.MeshToonMaterial({
        color: segColors[i],
        gradientMap: this.gradientMap,
      })
      const seg = new THREE.Mesh(geo, mat)
      const s = segScales[i]
      seg.scale.set(s.x, s.y, s.z)
      seg.position.set(0, s.y, segZ[i])
      seg.castShadow = true
      this.group.add(seg)
      this.bodyMeshes.push(seg)
    }

    // Red eyes on head segment
    const eyeMat = new THREE.MeshStandardMaterial({
      color: 0xff2222,
      emissive: 0xcc0000,
      emissiveIntensity: 1.0,
    })
    const eyeGeo = new THREE.SphereGeometry(0.025, 6, 4)
    for (const ex of [-0.055, 0.055]) {
      const eye = new THREE.Mesh(eyeGeo, eyeMat)
      eye.position.set(ex, 0.085, 0.22)
      this.group.add(eye)
      this.eyeMeshes.push(eye)
    }

    // Mandibles — two small thin cones
    const mandMat = new THREE.MeshToonMaterial({ color: 0x1a3010, gradientMap: this.gradientMap })
    for (const mx of [-0.06, 0.06]) {
      const mand = new THREE.Mesh(new THREE.ConeGeometry(0.02, 0.08, 5), mandMat)
      mand.position.set(mx, 0.06, 0.28)
      mand.rotation.x = -Math.PI / 2
      this.group.add(mand)
      this.mandibleMeshes.push(mand)
      this.mandibleSides.push(mx < 0 ? -1 : 1)
    }
  }

  protected setFlashColor(on: boolean): void {
    for (const m of this.bodyMeshes) {
      ;(m.material as THREE.MeshToonMaterial).color.setHex(on ? 0xff4422 : (
        this.bodyMeshes.indexOf(m) === 0 ? 0x2a4a1a : 0x336622
      ))
    }
  }

  updateAI(delta: number, playerX: number, playerZ: number): void {
    const dx = playerX - this.collisionBody.x
    const dz = playerZ - this.collisionBody.z
    const dist = Math.sqrt(dx * dx + dz * dz)

    this.stateTimer += delta

    switch (this.state) {
      case 'HIDING': {
        this.collisionBody.velocity.x = 0
        this.collisionBody.velocity.z = 0
        if (dist < HIDE_TRIGGER) {
          this.state = 'BURSTING'
          this.stateTimer = 0
          this.collisionBody.enabled = true
        }
        break
      }

      case 'BURSTING': {
        this.collisionBody.velocity.x = 0
        this.collisionBody.velocity.z = 0
        const t = Math.min(1, this.stateTimer / BURST_DUR)
        this.group.scale.setScalar(t)
        if (this.stateTimer >= BURST_DUR) {
          this.state = 'TRACKING'
          this.stateTimer = 0
          this.group.scale.setScalar(1)
        }
        break
      }

      case 'TRACKING': {
        // Burst-scurry cycle: alternate full-speed bursts with brief pauses
        this.scurryTimer -= delta
        if (this.scurryTimer <= 0) {
          this.scurryActive = !this.scurryActive
          this.scurryTimer  = this.scurryActive ? SCURRY_ON : SCURRY_OFF
        }
        const speedMult = this.scurryActive ? SCURRY_FAST : SCURRY_SLOW

        // Slither oscillator: weave perpendicularly to heading
        this.slitherPhase += SLITHER_FREQ * delta
        const weaveOffset = this.scurryActive ? Math.sin(this.slitherPhase) * SLITHER_AMP : 0

        let desiredAngle = Math.atan2(dx, dz) + weaveOffset

        // Wall-hug: if near a corridor wall, blend toward running along X axis
        const nearWall = nearestWallZ(this.collisionBody.z)
        if (nearWall !== null) {
          const wallRunAngle = (playerX > this.collisionBody.x) ? Math.PI / 2 : -Math.PI / 2
          desiredAngle = lerpAngleMix(desiredAngle, wallRunAngle, WALL_HUG_STR)
        }

        const angleDiff = wrapAngle(desiredAngle - this.facingAngle)
        this.facingAngle += Math.sign(angleDiff) * Math.min(Math.abs(angleDiff), TURN_RATE * delta)
        this.group.rotation.y = this.facingAngle

        this.collisionBody.velocity.x = Math.sin(this.facingAngle) * TRACK_SPEED * speedMult
        this.collisionBody.velocity.z = Math.cos(this.facingAngle) * TRACK_SPEED * speedMult

        // Enter windup when close and roughly facing player (only during active scurry)
        if (this.scurryActive && dist < 1.0 && Math.abs(wrapAngle(Math.atan2(dx, dz) - this.facingAngle)) < 0.4) {
          this.state      = 'WINDUP'
          this.stateTimer = 0
          this.collisionBody.velocity.x = 0
          this.collisionBody.velocity.z = 0
        }
        break
      }

      case 'WINDUP': {
        this.collisionBody.velocity.x = 0
        this.collisionBody.velocity.z = 0
        // Lock lunge direction toward current player position
        this.lungeDir.set(dx, dz).normalize()
        if (this.stateTimer >= WINDUP_DUR) {
          this.state = 'LUNGING'
          this.stateTimer = 0
        }
        break
      }

      case 'LUNGING': {
        this.collisionBody.velocity.x = this.lungeDir.x * LUNGE_SPEED
        this.collisionBody.velocity.z = this.lungeDir.y * LUNGE_SPEED
        if (this.stateTimer >= LUNGE_DUR) {
          this.state = 'RECOVERING'
          this.stateTimer = 0
          this.collisionBody.velocity.x = 0
          this.collisionBody.velocity.z = 0
        }
        break
      }

      case 'RECOVERING': {
        this.collisionBody.velocity.x = 0
        this.collisionBody.velocity.z = 0
        if (this.stateTimer >= RECOVER_DUR) {
          this.state = 'TRACKING'
          this.stateTimer = 0
        }
        break
      }
    }

    const windupT = this.state === 'WINDUP' ? Math.min(1, this.stateTimer / WINDUP_DUR) : 0
    this.applyWindupTell(windupT)
  }

  private applyWindupTell(t: number): void {
    const eyeScale = 1 + t * 0.8        // up to ×1.8
    for (const eye of this.eyeMeshes) eye.scale.setScalar(eyeScale)
    for (let i = 0; i < this.mandibleMeshes.length; i++) {
      this.mandibleMeshes[i].rotation.y = this.mandibleSides[i] * t * 0.55
    }
  }
}

function wrapAngle(a: number): number {
  while (a >  Math.PI) a -= Math.PI * 2
  while (a < -Math.PI) a += Math.PI * 2
  return a
}

function nearestWallZ(z: number): number | null {
  for (const wz of WALL_Z_BOUNDS) {
    if (Math.abs(z - wz) < WALL_HUG_DIST) return wz
  }
  return null
}

function lerpAngleMix(a: number, b: number, t: number): number {
  let diff = b - a
  while (diff >  Math.PI) diff -= Math.PI * 2
  while (diff < -Math.PI) diff += Math.PI * 2
  return a + diff * t
}
