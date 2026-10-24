import * as THREE from 'three'
import { WeaponSystem, WeaponType } from '../systems/WeaponSystem'
import { WEAPON_DATA, WEAPON_COLORS } from '../config/WeaponData'
import { type CollisionBody, physicsWorld } from '../core/PhysicsWorld'
import { InputManager } from '../core/InputManager'
import { SpiderLegs, WEBBS_RIM } from './SpiderLegs'
import { buildWebbsBody } from './WebbsBody'
import { addRim } from '../env/Materials'
import { audio } from '../systems/AudioManager'
import { CAMERA_YAW, CAMERA_DIR_X, CAMERA_DIR_Z } from '../core/CameraRig'

// ─── Scale factor ─────────────────────────────────────────────────────────────
// 100 Phaser pixels = 1 Three.js world unit
export const SCALE = 0.01

// ─── Gameplay constants (same values as Webbs.ts) ─────────────────────────────
const SPEED_WU            = 540 * SCALE   // 5.4 wu/s — 1.8× bump for 5× den (≈9.5s centre→rim)
// Round 7 Issue 2: bumped from 0.22 → 0.28 so enemies are pushed out of Webbs'
// silhouette and stay in striking range instead of standing inside him.
export const BODY_R_NORMAL  = 28 * SCALE  // 0.28 — collision radius
export const BODY_R_SQUEEZE = 14 * SCALE  // 0.14 — narrow-gap mode
export const PLAYER_MAX_HP  = 100

const STAMINA_REGEN      = 40             // per second
const STAMINA_RECOVER_AT = 0.2            // fraction of max to clear winded
// Regen pauses briefly after each spend — otherwise 40/s regen out-paces every
// weapon (~30/s at full rate) and stamina never runs out.
const STAMINA_REGEN_DELAY = 0.6           // s
const ENERGY_RECOVER_AT  = 0.25           // fraction of max to clear an energy lockout
const WINDED_SPEED_MULT  = 0.65
const REGEN_DELAY_S      = 6             // seconds before HP regen starts
const REGEN_RATE         = 2             // HP per second
// Body yaw turn rate (per second factor for the lerp).  ~12 → a 90° turn takes
// ~0.15s: fast enough to feel responsive, slow enough that legs visibly sweep.
const TURN_RATE          = 12
// Locomotion response (1/s, exponential).  Bursts to speed in ~0.13s and skids
// to a stop in ~0.2s instead of starting/stopping on a single frame.
const MOVE_ACCEL         = 18
const MOVE_DECEL         = 12
// Cap on body yaw speed — a 180° reversal takes ~0.35s, so the legs can visibly
// step around instead of the body snapping and dragging its planted feet.
const MAX_TURN_SPEED     = 9    // rad/s
// After a hit Webbs can't be hit again for a beat (blinks) — stops packs from
// chain-stunning him.  Lethal/unblockable damage ignores it.
const INVULN_AFTER_HIT   = 0.6  // s
const HIT_SHOVE          = 4.0  // wu/s impulse away from the attacker
const DODGE_DECAY        = 4.35 // 1/s
const DEATH_CURL_TIME    = 0.35 // s (world time — slowed ×0.3 during the death beat) to fold in

// ─── Leg colors (used by Phase C IK legs) ────────────────────────────────────
export const LEG_COLORS = [
  0xff4444, 0xff8844, 0xffff44, 0x44ff44,
  0x44ffff, 0x4444ff, 0xff44ff, 0xffffff,
]

export class Webbs3D {
  group: THREE.Group
  bodyMesh: THREE.Mesh
  abdMesh!: THREE.Mesh                       // Round 8 Issue 1: abdomen mesh for shudder
  collisionBody: CollisionBody

  // Round 8 Issue 3: combat-feel state
  recoilVx            = 0
  recoilVz            = 0
  recoilTimer         = 0
  shudderTimer        = 0
  halfHpLeapTriggered = false
  private dodgeTimer  = 0
  private dyingT      = -1   // ≥ 0 while the death beat plays (input ignored)
  private invulnT     = 0
  private attackSlowT = 0
  private attackSlowMult = 1
  private dodgeVx     = 0
  private dodgeVz     = 0

  // Round 8 Issue 6: presented item visual during celebration
  private presentedItemMesh: THREE.Object3D | null = null

  private deathSoundFired = false
  private windedSoundFired = false
  private regenDelayT      = 0
  energyLocked             = false   // emptied: no energy spends until ENERGY_RECOVER_AT
  floorType: 'dirt' | 'stone' = 'dirt'

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
  private moveVx = 0   // smoothed locomotion intent (wu/s)
  private moveVz = 0

  // Celebration pose — set true while pickup celebration is showing (Round 7 Issue 1)
  celebratingPose          = false
  private celebPoseStartMs = 0
  private preCelebRotation = 0   // saved rotation to restore after celebration


  private flashMats:        THREE.MeshToonMaterial[] = []
  private gradientMap:      THREE.Texture
  private webLauncherMount: THREE.Group | null = null
  private timeSinceDamage   = 9999
  private idleTime          = 0
  private bobY              = 0
  private bodyScale         = 1.0   // applied to speed + collider + legs; per-zone via setScale()
  private threeScene:       THREE.Scene

  constructor(threeScene: THREE.Scene, x: number, z: number, gradientMap: THREE.Texture, scale = 1.0) {
    this.bodyScale   = scale
    this.gradientMap = gradientMap
    this.threeScene  = threeScene
    this.group = new THREE.Group()
    this.group.rotation.order = 'YXZ'   // yaw = heading, then local pitch/roll from the legs
    this.group.position.set(x, 0, z)
    this.weaponSystem = new WeaponSystem(WEAPON_DATA)

    // ─── Body — patterned, harnessed, glossy-eyed (see entities/WebbsBody) ──
    const body = buildWebbsBody(this.group, this.gradientMap)
    this.bodyMesh  = body.ceph
    this.abdMesh   = body.abd
    this.flashMats = body.flashMats

    // ─── Ground shadow disc ────────────────────────────────────────────────
    const shadowGeo = new THREE.CircleGeometry(0.30, 16).rotateX(-Math.PI / 2)
    const shadowMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.4 })
    const shadowDisc = new THREE.Mesh(shadowGeo, shadowMat)
    shadowDisc.position.y = 0.01
    this.group.add(shadowDisc)

    threeScene.add(this.group)
    addRim(this.group, WEBBS_RIM)

    // IK legs — added directly to the scene (world-space positioning)
    this.legs = this.buildLegs(scale)
    this.legs.initFeetAt(new THREE.Vector3(x, 0, z), 0)
    this.group.scale.setScalar(scale)

    // Physics body on the XZ ground plane
    this.collisionBody = physicsWorld.add({
      x,
      z,
      radius: BODY_R_NORMAL * scale,
      velocity: { x: 0, z: 0 },
      isStatic: false,
      enabled: true,
    })
  }

  // ── Called each frame with the current input state ────────────────────────
  update(delta: number, input: InputManager): void {
    // Dying: no control, legs curl over DEATH_CURL_TIME, the body slides to a stop
    if (this.dyingT >= 0) {
      this.dyingT += delta
      const t = Math.min(1, this.dyingT / DEATH_CURL_TIME)
      this.legs.collapse = 1 - (1 - t) * (1 - t)
      this.collisionBody.velocity.x = this.collisionBody.velocity.z = 0
      this.moveVx = this.moveVz = 0
      this.group.visible = true
      return
    }
    // Lazily attach web-launcher mount once the item is collected
    if (this.hasWebLauncher && !this.webLauncherMount) {
      this.webLauncherMount = this.buildWebLauncherMount()
      this.group.add(this.webLauncherMount)
    }

    // Committed swings slow him down (weight); see commitAttack()
    if (this.attackSlowT > 0) this.attackSlowT -= delta
    const commit = this.attackSlowT > 0 ? this.attackSlowMult : 1
    const speed = (this.winded ? SPEED_WU * WINDED_SPEED_MULT : SPEED_WU) * this.bodyScale * commit

    // Post-hit invulnerability blink
    if (this.invulnT > 0) {
      this.invulnT -= delta
      this.group.visible = this.invulnT <= 0 || Math.floor(this.invulnT * 18) % 2 === 0
    } else if (!this.group.visible) {
      this.group.visible = true
    }

    // Round 9 Issue 2 — camera-aligned WASD.
    // The camera sits at world offset (18, 18, 18) — rotated 45° around Y from
    // the world axes — so a press of W along world -Z appears as down-left on
    // screen. Rotate the raw input vector by the camera Y-angle so screen-up
    // (away from camera) maps to W, screen-down to S, etc.
    let inputX = 0, inputZ = 0
    if (input.isDown('KeyW') || input.isDown('ArrowUp'))    inputZ = -1
    if (input.isDown('KeyS') || input.isDown('ArrowDown'))  inputZ =  1
    if (input.isDown('KeyA') || input.isDown('ArrowLeft'))  inputX = -1
    if (input.isDown('KeyD') || input.isDown('ArrowRight')) inputX =  1
    if (inputX !== 0 && inputZ !== 0) { inputX *= 0.707; inputZ *= 0.707 }
    const stick = input.getStick()   // touch: analog, same screen-space axes as WASD
    if (stick && (stick.x !== 0 || stick.y !== 0)) { inputX = stick.x; inputZ = stick.y }

    // Rotate input by the camera's compass bearing (single source: CameraRig)
    const camCos   = Math.cos(CAMERA_YAW)
    const camSin   = Math.sin(CAMERA_YAW)
    const dx =  inputX * camCos + inputZ * camSin
    const dz = -inputX * camSin + inputZ * camCos

    // Locomotion intent eases toward the input target (see MOVE_ACCEL/DECEL)
    const ka = 1 - Math.exp(-((dx !== 0 || dz !== 0) ? MOVE_ACCEL : MOVE_DECEL) * delta)
    this.moveVx += (dx * speed - this.moveVx) * ka
    this.moveVz += (dz * speed - this.moveVz) * ka

    // Round 8 Issue 3: dodge / recoil override intent briefly
    if (this.dodgeTimer > 0) {
      this.dodgeTimer -= delta
      this.collisionBody.velocity.x = this.moveVx = this.dodgeVx
      this.collisionBody.velocity.z = this.moveVz = this.dodgeVz
      // Frame-rate independent decay (≡ ×0.93 per frame at 60 Hz)
      const k = Math.exp(-DODGE_DECAY * delta)
      this.dodgeVx *= k
      this.dodgeVz *= k
    } else if (this.recoilTimer > 0) {
      this.recoilTimer -= delta
      const k = Math.max(0, this.recoilTimer / 0.18)
      this.collisionBody.velocity.x = this.moveVx * (1 - k) + this.recoilVx * k
      this.collisionBody.velocity.z = this.moveVz * (1 - k) + this.recoilVz * k
    } else {
      this.collisionBody.velocity.x = this.moveVx
      this.collisionBody.velocity.z = this.moveVz
    }

    // Round 8 Issue 3: shudder — small random offset on body meshes (NOT physics)
    if (this.shudderTimer > 0) {
      this.shudderTimer -= delta
      const i = Math.max(0, this.shudderTimer / 0.20)
      this.bodyMesh.position.x = (Math.random() - 0.5) * 0.04 * i
      this.bodyMesh.position.z = 0.16 + (Math.random() - 0.5) * 0.04 * i
      this.abdMesh.position.x  = (Math.random() - 0.5) * 0.04 * i
      this.abdMesh.position.z  = -0.18 + (Math.random() - 0.5) * 0.04 * i
    } else {
      this.bodyMesh.position.x = 0
      this.bodyMesh.position.z = 0.16
      this.abdMesh.position.x  = 0
      this.abdMesh.position.z  = -0.18
    }

    if (dx !== 0 || dz !== 0) {
      this.facingX = dx
      this.facingZ = dz
      // Smoothly turn the whole creature toward the heading instead of snapping.
      // The legs read this.group.rotation.y each frame, so body + legs rotate as
      // one unit and each leg keeps its identity through the turn (the weapon on
      // leg N visibly sweeps to its new position rather than teleporting).
      const target = Math.atan2(dx, dz)
      let d = target - this.group.rotation.y
      while (d >  Math.PI) d -= Math.PI * 2
      while (d < -Math.PI) d += Math.PI * 2
      const maxStep = MAX_TURN_SPEED * delta
      this.group.rotation.y += Math.max(-maxStep, Math.min(maxStep, d * Math.min(1, TURN_RATE * delta)))
    }

    // Trigger one-shot death sound on the frame HP hits zero.
    if (!this.deathSoundFired && this.hp <= 0) {
      this.deathSoundFired = true
      audio.play('webbs_death', this.collisionBody.x, this.collisionBody.z)
    }

    // Stamina + energy regen (stamina waits out the post-spend delay)
    if (this.regenDelayT > 0) this.regenDelayT -= delta
    else if (this.stamina < this.maxStamina)
      this.stamina = Math.min(this.maxStamina, this.stamina + STAMINA_REGEN * this.staminaRegenMult * delta)
    if (this.energy < this.maxEnergy)
      this.energy = Math.min(this.maxEnergy, this.energy + 5 * delta)
    if (this.energyLocked && this.energy >= this.maxEnergy * ENERGY_RECOVER_AT) this.energyLocked = false

    // Winded: engages at 0 stamina, clears above 20% max
    if (this.stamina <= 0) {
      this.enterWinded()
    } else if (this.winded && this.stamina >= this.maxStamina * STAMINA_RECOVER_AT) {
      this.winded = false
      this.windedSoundFired = false
    }

    // HP regen after grace period
    this.timeSinceDamage += delta
    if (this.timeSinceDamage > REGEN_DELAY_S && this.hp < this.hpMax && this.hp > 0)
      this.hp = Math.min(this.hpMax, this.hp + REGEN_RATE * delta)

    // Idle breathing — gentle sine layered on the leg-driven body height.
    this.idleTime += delta
    this.bobY = Math.sin(this.idleTime * 2) * 0.012 * this.bodyScale
  }

  // ── Call after physicsWorld.update() to sync 3D group from physics body ──
  // XZ only, from the interpolated render position (smooth between fixed
  // physics steps).  Height and tilt come from the legs in updateLegs().
  syncPosition(): void {
    this.group.position.x = this.collisionBody.renderX
    this.group.position.z = this.collisionBody.renderZ
  }

  // Teleport (zone entry / respawn): body, render position and feet all jump together.
  placeAt(x: number, z: number): void {
    this.collisionBody.x = x
    this.collisionBody.z = z
    this.collisionBody.velocity.x = 0
    this.collisionBody.velocity.z = 0
    this.collisionBody.clearForces()
    this.moveVx = this.moveVz = 0
    this.group.position.set(x, physicsWorld.groundHeight(x, z), z)
    this.legs.initFeetAt(this.group.position, this.group.rotation.y)
  }

  get scale(): number { return this.bodyScale }

  // Per-zone creature scale. Zones are authored at different world scales (the den
  // is 5× the colony), so Webbs is resized on entry instead of being one size
  // everywhere — keeps him proportionate to each zone's corridors and enemies.
  setScale(s: number): void {
    if (s === this.bodyScale) return
    const tier = this.legs.legTier
    this.bodyScale = s
    this.group.scale.setScalar(s)
    this.legs.destroy()
    this.legs = this.buildLegs(s)
    this.legs.setLegTier(tier)
    this.legs.initFeetAt(this.group.position, this.group.rotation.y)
    this.collisionBody.radius = BODY_R_NORMAL * s
  }

  private buildLegs(s: number): SpiderLegs {
    const legs = new SpiderLegs(this.threeScene, this.gradientMap, s)
    legs.ground = (x, z) => physicsWorld.groundHeight(x, z)
    // Footsteps follow real foot plants (one per tetrapod landing) instead of a timer
    legs.onStep = (x, z) => {
      if (this.dodgeTimer > 0) return
      audio.play(this.floorType === 'stone' ? 'footstep_stone' : 'footstep_dirt', x, z)
    }
    return legs
  }

  // ── Call after syncPosition() — advances gait and solves IK ──────────────
  updateLegs(delta: number): void {
    if (this.celebratingPose) {
      // Round 7 Issue 1: animate rotation toward camera over 300ms, then call leg pose.
      const elapsedMs = performance.now() - this.celebPoseStartMs

      const camDirX = CAMERA_DIR_X
      const camDirZ = CAMERA_DIR_Z
      const targetRotation = Math.atan2(camDirX, camDirZ)   // makes body forward point to camera

      const rotT = Math.min(elapsedMs / 300, 1)
      let deltaA = targetRotation - this.preCelebRotation
      while (deltaA >  Math.PI) deltaA -= Math.PI * 2
      while (deltaA < -Math.PI) deltaA += Math.PI * 2
      this.group.rotation.y = this.preCelebRotation + deltaA * rotT

      this.legs.updateCelebrationPose(this.group.position, this.group.rotation.y, camDirX, camDirZ, elapsedMs)
      this.updatePresentedItem(elapsedMs)
    } else {
      this.legs.update(delta, this.group.position, this.group.rotation.y, this.weaponSystem)
    }
    // Body rides the legs: height from the planted feet, pitch/roll from terrain,
    // acceleration and strikes.
    const pose = this.legs.pose
    this.group.position.y = pose.y + this.bobY
    this.group.rotation.x = pose.pitch
    this.group.rotation.z = pose.roll
  }

  startCelebrationPose(weapon?: WeaponType): void {
    this.celebratingPose   = true
    this.celebPoseStartMs  = performance.now()
    this.preCelebRotation  = this.group.rotation.y
    // Stop any residual movement so the spider stays put for the pose
    this.collisionBody.velocity.x = 0
    this.collisionBody.velocity.z = 0
    this.moveVx = this.moveVz = 0
    if (weapon !== undefined) this.showPresentedItem(weapon)
  }

  endCelebrationPose(): void {
    this.celebratingPose  = false
    this.group.rotation.y = this.preCelebRotation
    this.hidePresentedItem()
  }

  // Pay for an action.  Allowed while any stamina is left (the last swing can
  // overdraw to 0), then winded until STAMINA_RECOVER_AT.  Returns false if
  // the action can't be paid for.
  spendStamina(cost: number): boolean {
    if (this.winded || this.stamina <= 0) return false
    this.stamina = Math.max(0, this.stamina - cost)
    this.regenDelayT = STAMINA_REGEN_DELAY
    if (this.stamina <= 0) this.enterWinded()
    return true
  }

  // Continuous energy use (flame).  Emptying the tank locks it out until it
  // refills to ENERGY_RECOVER_AT.
  spendEnergy(amount: number): boolean {
    if (this.energyLocked) return false
    this.energy = Math.max(0, this.energy - amount)
    if (this.energy <= 0) this.energyLocked = true
    return true
  }

  private enterWinded(): void {
    if (!this.winded && !this.windedSoundFired) {
      this.windedSoundFired = true
      audio.play('stamina_winded', this.collisionBody.x, this.collisionBody.z)
    }
    this.winded = true
  }

  // Movement multiplier for `seconds` while an attack is committed.
  commitAttack(mult: number, seconds: number): void {
    this.attackSlowMult = this.attackSlowT > 0 ? Math.min(this.attackSlowMult, mult) : mult
    this.attackSlowT    = Math.max(this.attackSlowT, seconds)
  }

  isInvulnerable(): boolean { return this.invulnT > 0 }

  // ── Hit feedback — body flash + shove + shudder + half-HP leap ──────────
  // `from` (attacker position) shoves Webbs directly away from the blow;
  // without it he recoils against his facing.  Returns false if the hit was
  // ignored (invulnerable / max protection).
  damage(amount: number, opts: { fromX?: number; fromZ?: number; unblockable?: boolean } = {}): boolean {
    if (amount <= 0 || this.hp <= 0 || this.dyingT >= 0) return false   // already down
    // Dodging through an attack (i-frames) or recently hit → no damage
    if (!opts.unblockable && (this.maxProtectionActive || this.invulnT > 0 || this.dodgeTimer > 0)) return false
    this.hp = Math.max(0, this.hp - amount)
    this.timeSinceDamage = 0
    this.invulnT = INVULN_AFTER_HIT

    // Round 10 — pain vocalisation
    audio.play('webbs_damage', this.collisionBody.x, this.collisionBody.z)

    // Red flash on body (new color base = 0x6a4d8a)
    for (const m of this.flashMats) m.color.setHex(0xff5566)
    setTimeout(() => { for (const m of this.flashMats) m.color.setHex(m.userData.baseColor as number) }, 140)

    // Shove away from the attacker (physical impulse) + brief control loss
    if (opts.fromX !== undefined && opts.fromZ !== undefined) {
      const dx = this.collisionBody.x - opts.fromX, dz = this.collisionBody.z - opts.fromZ
      const l  = Math.hypot(dx, dz) || 1
      this.collisionBody.push((dx / l) * HIT_SHOVE * this.bodyScale, (dz / l) * HIT_SHOVE * this.bodyScale)
      this.recoilVx = 0; this.recoilVz = 0
    } else {
      this.recoilVx = -this.facingX * 1.6 * this.bodyScale
      this.recoilVz = -this.facingZ * 1.6 * this.bodyScale
    }
    this.recoilTimer = 0.18
    this.shudderTimer = 0.20

    // One-time 50% HP leap back
    const hpFrac = this.hp / this.hpMax
    if (!this.halfHpLeapTriggered && hpFrac <= 0.5 && hpFrac > 0) {
      this.halfHpLeapTriggered = true
      audio.play('half_hp_pain', this.collisionBody.x, this.collisionBody.z)
      this.startDodgeLeap()
    }
    return true
  }

  // Round 8 Issue 3: backward dodge leap (spacebar + half-HP trigger)
  startDodgeLeap(): void {
    const leapSpeed = 11.0 * this.bodyScale
    this.dodgeVx    = -this.facingX * leapSpeed
    this.dodgeVz    = -this.facingZ * leapSpeed
    this.dodgeTimer = 0.25
    audio.play('webbs_dodge', this.collisionBody.x, this.collisionBody.z)
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

  get isDying(): boolean { return this.dyingT >= 0 }

  // Killing blow landed: start the death beat (main.ts runs the slow-mo/fade)
  startDying(): void {
    if (this.dyingT >= 0) return
    this.dyingT = 0
    this.deathSoundFired = true
    audio.play('webbs_death', this.collisionBody.x, this.collisionBody.z)
    this.invulnT = 0
    this.dodgeTimer = this.recoilTimer = this.shudderTimer = 0
    this.attackSlowT = 0
  }

  // Back on his feet after a death — no penalty, everything refilled/cleared
  resetAfterDeath(): void {
    this.dyingT = -1
    this.legs.collapse = 0
    this.resetHp()
    this.stamina = this.maxStamina
    this.energy  = this.maxEnergy
    this.energyLocked = false
    this.winded = false
    this.windedSoundFired = false
    this.regenDelayT = 0
    this.invulnT = 0
    this.dodgeTimer = this.recoilTimer = this.shudderTimer = 0
    this.attackSlowT = 0
    this.collisionBody.clearForces()
    this.group.visible = true
  }

  resetHp(amount?: number): void {
    this.hp = amount ?? this.hpMax
    this.timeSinceDamage = 9999
    this.halfHpLeapTriggered = false   // Round 8 Issue 3: allow re-triggering
    this.deathSoundFired = false       // Round 10: allow re-triggering after respawn
  }

  // ─── Round 8 Issue 6: presented item during celebration pose ──────────────
  showPresentedItem(weapon: WeaponType): void {
    this.hidePresentedItem()
    // Build a scaled-up version of the equipped-weapon visual
    const gm  = this.gradientMap
    const tip = this.buildPresentedTip(weapon, gm)
    tip.scale.set(3.5, 3.5, 3.5)

    const color = WEAPON_COLORS[weapon] ?? 0xffffff
    const glow = new THREE.Mesh(
      new THREE.SphereGeometry(0.25, 16, 12),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending }),
    )

    const wrap = new THREE.Group()
    wrap.add(glow)
    wrap.add(tip)
    wrap.position.set(0.3, 1.1, 0.3)
    this.group.add(wrap)
    this.presentedItemMesh = wrap
  }

  hidePresentedItem(): void {
    if (!this.presentedItemMesh) return
    this.group.remove(this.presentedItemMesh)
    this.presentedItemMesh.traverse(obj => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry.dispose()
        ;(obj.material as THREE.Material).dispose()
      }
    })
    this.presentedItemMesh = null
  }

  updatePresentedItem(elapsedMs: number): void {
    if (!this.presentedItemMesh) return
    const bobY = Math.sin(elapsedMs / 1000 * 3) * 0.05
    this.presentedItemMesh.position.y = 1.1 + bobY
    this.presentedItemMesh.rotation.y = elapsedMs / 1000 * 1.5
    const glow = this.presentedItemMesh.children[0] as THREE.Mesh
    const glowMat = glow.material as THREE.MeshBasicMaterial
    glowMat.opacity = 0.4 + Math.sin(elapsedMs / 1000 * 4) * 0.2
  }

  // Simple weapon tip for the celebration — separate from SpiderLegs' mesh
  // factory so we don't need to reach into private state there.
  private buildPresentedTip(weapon: WeaponType, gm: THREE.Texture): THREE.Group {
    const g = new THREE.Group()
    const color = WEAPON_COLORS[weapon] ?? 0xcccccc
    switch (weapon) {
      case WeaponType.BoxingGloves: {
        const shaft = new THREE.Mesh(
          new THREE.ConeGeometry(0.025, 0.22, 6),
          new THREE.MeshToonMaterial({ color: 0xddccaa, gradientMap: gm }),
        )
        shaft.rotation.x = Math.PI / 2
        shaft.position.z = 0.11
        g.add(shaft)
        break
      }
      case WeaponType.Sword: {
        const blade = new THREE.Mesh(
          new THREE.BoxGeometry(0.045, 0.045, 0.42),
          new THREE.MeshToonMaterial({ color: 0xd8d8d8, gradientMap: gm }),
        )
        blade.position.z = 0.23
        const guard = new THREE.Mesh(
          new THREE.BoxGeometry(0.22, 0.05, 0.05),
          new THREE.MeshToonMaterial({ color: 0x999999, gradientMap: gm }),
        )
        guard.position.z = 0.05
        g.add(blade, guard)
        break
      }
      case WeaponType.Axe: {
        const head = new THREE.Mesh(
          new THREE.BoxGeometry(0.12, 0.10, 0.04),
          new THREE.MeshToonMaterial({ color: 0x888888, gradientMap: gm }),
        )
        g.add(head)
        break
      }
      case WeaponType.WebLauncher: {
        const bead = new THREE.Mesh(
          new THREE.SphereGeometry(0.10, 12, 8),
          new THREE.MeshStandardMaterial({ color: 0xddeeff, emissive: 0x99bbff, emissiveIntensity: 0.6 }),
        )
        g.add(bead)
        break
      }
      default: {
        const sphere = new THREE.Mesh(
          new THREE.SphereGeometry(0.08, 8, 6),
          new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.4 }),
        )
        g.add(sphere)
        break
      }
    }
    return g
  }

  setBodyRadius(r: number): void {
    this.collisionBody.radius = r * this.bodyScale
  }
}
