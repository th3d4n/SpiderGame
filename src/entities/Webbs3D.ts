import * as THREE from 'three'
import { WeaponSystem } from '../systems/WeaponSystem'
import { WEAPON_DATA } from '../config/WeaponData'
import { type CollisionBody, physicsWorld } from '../core/PhysicsWorld'
import { InputManager } from '../core/InputManager'
import { SpiderLegs } from './SpiderLegs'

// ─── Scale factor ─────────────────────────────────────────────────────────────
// 100 Phaser pixels = 1 Three.js world unit
export const SCALE = 0.01

// ─── Gameplay constants (same values as Webbs.ts) ─────────────────────────────
const SPEED_WU            = 300 * SCALE   // 3.0 world units/s
export const BODY_R_NORMAL  = 22 * SCALE  // 0.22 — collision radius
export const BODY_R_SQUEEZE = 14 * SCALE  // 0.14 — narrow-gap mode
export const PLAYER_MAX_HP  = 100

const STAMINA_REGEN      = 40             // per second
const STAMINA_RECOVER_AT = 0.2            // fraction of max to clear winded
const WINDED_SPEED_MULT  = 0.65
const REGEN_DELAY_S      = 6             // seconds before HP regen starts
const REGEN_RATE         = 2             // HP per second

// ─── Leg colors (used by Phase C IK legs) ────────────────────────────────────
export const LEG_COLORS = [
  0xff4444, 0xff8844, 0xffff44, 0x44ff44,
  0x44ffff, 0x4444ff, 0xff44ff, 0xffffff,
]

export class Webbs3D {
  group: THREE.Group
  bodyMesh: THREE.Mesh
  collisionBody: CollisionBody

  // ── Gameplay fields (all carried over from Webbs.ts) ──────────────────────
  hp             = PLAYER_MAX_HP
  hpMax          = PLAYER_MAX_HP
  stamina        = 100
  maxStamina     = 100
  energy         = 100
  maxEnergy      = 100
  facingX        = 1    // last movement direction X
  facingZ        = 0    // last movement direction Z (was facingY in 2D)
  winded         = false
  maxProtectionActive = false
  staminaRegenMult    = 1.0
  hasWebLauncher      = false
  weaponSystem: WeaponSystem

  legs: SpiderLegs
  moveDir = new THREE.Vector2(0, 0)   // last normalized movement direction for gait

  // Celebration pose — set true while pickup celebration is showing
  celebratingPose      = false
  private celebPoseStartMs = 0

  private bodyMat:          THREE.MeshToonMaterial
  private gradientMap:      THREE.Texture
  private webLauncherMount: THREE.Group | null = null
  private timeSinceDamage   = 9999

  constructor(threeScene: THREE.Scene, x: number, z: number, gradientMap: THREE.Texture) {
    this.gradientMap = gradientMap
    this.group = new THREE.Group()
    this.group.position.set(x, 0, z)
    this.weaponSystem = new WeaponSystem(WEAPON_DATA)

    // Body — flattened sphere
    const bodyGeo = new THREE.SphereGeometry(0.3, 16, 12)
    bodyGeo.scale(1, 0.6, 1)
    this.bodyMat = new THREE.MeshToonMaterial({ color: 0x554488, gradientMap })
    this.bodyMesh = new THREE.Mesh(bodyGeo, this.bodyMat)
    this.bodyMesh.castShadow = true
    this.bodyMesh.position.y = 0.4
    this.group.add(this.bodyMesh)

    // Eyes — emissive so they read through shadow
    const eyeGeo = new THREE.SphereGeometry(0.06, 8, 6)
    const eyeMat = new THREE.MeshStandardMaterial({
      color: 0xaaaaff,
      emissive: 0x4444ff,
      emissiveIntensity: 0.8,
    })
    const eyeL = new THREE.Mesh(eyeGeo, eyeMat)
    const eyeR = new THREE.Mesh(eyeGeo, eyeMat)
    eyeL.position.set(-0.1, 0.5, -0.22)
    eyeR.position.set( 0.1, 0.5, -0.22)
    this.group.add(eyeL, eyeR)

    // Ground shadow disc
    const shadowGeo = new THREE.CircleGeometry(0.28, 16)
    shadowGeo.rotateX(-Math.PI / 2)
    const shadowMat = new THREE.MeshBasicMaterial({
      color: 0x000000,
      transparent: true,
      opacity: 0.4,
    })
    const shadowDisc = new THREE.Mesh(shadowGeo, shadowMat)
    shadowDisc.position.y = 0.01
    this.group.add(shadowDisc)

    threeScene.add(this.group)

    // IK legs — added directly to the scene (world-space positioning)
    this.legs = new SpiderLegs(threeScene, gradientMap)
    this.legs.initFeetAt(new THREE.Vector3(x, 0, z), 0)

    // Physics body on the XZ ground plane
    this.collisionBody = physicsWorld.add({
      x,
      z,
      radius: BODY_R_NORMAL,
      velocity: { x: 0, z: 0 },
      isStatic: false,
      enabled: true,
    })
  }

  // ── Called each frame with the current input state ────────────────────────
  update(delta: number, input: InputManager): void {
    // Lazily attach web-launcher mount once the item is collected
    if (this.hasWebLauncher && !this.webLauncherMount) {
      this.webLauncherMount = this.buildWebLauncherMount()
      this.group.add(this.webLauncherMount)
    }

    const speed = this.winded ? SPEED_WU * WINDED_SPEED_MULT : SPEED_WU
    let dx = 0, dz = 0

    if (input.isDown('KeyW') || input.isDown('ArrowUp'))    dz = -1
    if (input.isDown('KeyS') || input.isDown('ArrowDown'))  dz =  1
    if (input.isDown('KeyA') || input.isDown('ArrowLeft'))  dx = -1
    if (input.isDown('KeyD') || input.isDown('ArrowRight')) dx =  1

    if (dx !== 0 && dz !== 0) { dx *= 0.707; dz *= 0.707 }

    this.collisionBody.velocity.x = dx * speed
    this.collisionBody.velocity.z = dz * speed
    this.moveDir.set(dx, dz) // normalized (0.707 diagonal already applied above)

    if (dx !== 0 || dz !== 0) {
      this.facingX = dx
      this.facingZ = dz
      this.group.rotation.y = Math.atan2(-dx, -dz)
    }

    // Stamina + energy regen
    if (this.stamina < this.maxStamina)
      this.stamina = Math.min(this.maxStamina, this.stamina + STAMINA_REGEN * this.staminaRegenMult * delta)
    if (this.energy < this.maxEnergy)
      this.energy = Math.min(this.maxEnergy, this.energy + 5 * delta)

    // Winded: engages at 0 stamina, clears above 20% max
    if (this.stamina <= 0) this.winded = true
    else if (this.winded && this.stamina >= this.maxStamina * STAMINA_RECOVER_AT) this.winded = false

    // HP regen after grace period
    this.timeSinceDamage += delta
    if (this.timeSinceDamage > REGEN_DELAY_S && this.hp < this.hpMax && this.hp > 0)
      this.hp = Math.min(this.hpMax, this.hp + REGEN_RATE * delta)
  }

  // ── Call after physicsWorld.update() to sync 3D group from physics body ──
  syncPosition(): void {
    this.group.position.x = this.collisionBody.x
    this.group.position.z = this.collisionBody.z
  }

  // ── Call after syncPosition() — advances gait and solves IK ──────────────
  updateLegs(delta: number): void {
    if (this.celebratingPose) {
      this.legs.updateCelebrationPose(
        this.group.position,
        this.group.rotation.y,
        performance.now() - this.celebPoseStartMs,
      )
    } else {
      this.legs.update(
        delta,
        this.group.position,
        this.group.rotation.y,
        this.moveDir,
        this.weaponSystem,
      )
    }
  }

  startCelebrationPose(): void {
    this.celebratingPose   = true
    this.celebPoseStartMs  = performance.now()
  }

  endCelebrationPose(): void {
    this.celebratingPose = false
  }

  // ── Hit feedback — body flashes red, resets after 140 ms ─────────────────
  damage(amount: number): void {
    if (amount <= 0 || this.maxProtectionActive) return
    this.hp = Math.max(0, this.hp - amount)
    this.timeSinceDamage = 0
    this.bodyMat.color.setHex(0xff3344)
    setTimeout(() => { this.bodyMat.color.setHex(0x554488) }, 140)
  }

  // Build a web-launcher mount parented to this.group (body-local space).
  // Ventral mount — slung underneath the body between the legs.
  // Body sits at y=0.4 with radius 0.3 so underside is around y=0.10–0.20.
  private buildWebLauncherMount(): THREE.Group {
    const gm = this.gradientMap
    const g  = new THREE.Group()

    // Launcher housing — compact drum slung under the body
    const housing = new THREE.Mesh(
      new THREE.CylinderGeometry(0.09, 0.09, 0.13, 10),
      new THREE.MeshToonMaterial({ color: 0x777777, gradientMap: gm }),
    )
    housing.rotation.x = Math.PI / 2   // lay horizontal
    housing.position.set(0, 0.18, 0.08)   // ventral, slightly forward

    // Nozzle — short barrel pointing forward (+Z in body space)
    const nozzle = new THREE.Mesh(
      new THREE.CylinderGeometry(0.025, 0.035, 0.18, 6),
      new THREE.MeshToonMaterial({ color: 0x555555, gradientMap: gm }),
    )
    nozzle.rotation.x = Math.PI / 2   // horizontal, pointing along Z
    nozzle.position.set(0, 0.16, 0.22)   // in front of housing

    // Silk reservoir — small glowing sphere on the side of the housing
    const reservoir = new THREE.Mesh(
      new THREE.SphereGeometry(0.045, 8, 6),
      new THREE.MeshStandardMaterial({
        color: 0xddeeff, emissive: 0x99bbff, emissiveIntensity: 0.8,
      }),
    )
    reservoir.position.set(0.08, 0.18, 0.05)

    // Strap — thin band visually attaching the housing to Webbs' underside
    const strap = new THREE.Mesh(
      new THREE.BoxGeometry(0.18, 0.02, 0.04),
      new THREE.MeshToonMaterial({ color: 0x332211, gradientMap: gm }),
    )
    strap.position.set(0, 0.28, 0.08)

    g.add(housing, nozzle, reservoir, strap)
    return g
  }

  isDead(): boolean    { return this.hp <= 0 }
  isInCombat(): boolean { return this.timeSinceDamage < 5.0 }

  resetHp(amount?: number): void {
    this.hp = amount ?? this.hpMax
    this.timeSinceDamage = 9999
  }

  setBodyRadius(r: number): void {
    this.collisionBody.radius = r
  }
}
