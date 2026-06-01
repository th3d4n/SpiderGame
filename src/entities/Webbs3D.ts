import * as THREE from 'three'
import { WeaponSystem, WeaponType } from '../systems/WeaponSystem'
import { WEAPON_DATA, WEAPON_COLORS } from '../config/WeaponData'
import { type CollisionBody, physicsWorld } from '../core/PhysicsWorld'
import { InputManager } from '../core/InputManager'
import { SpiderLegs, createFuzzyBodyTexture } from './SpiderLegs'
import { audio } from '../systems/AudioManager'

// ─── Scale factor ─────────────────────────────────────────────────────────────
// 100 Phaser pixels = 1 Three.js world unit
export const SCALE = 0.01

// ─── Gameplay constants (same values as Webbs.ts) ─────────────────────────────
const SPEED_WU            = 300 * SCALE   // 3.0 world units/s
// Round 7 Issue 2: bumped from 0.22 → 0.28 so enemies are pushed out of Webbs'
// silhouette and stay in striking range instead of standing inside him.
export const BODY_R_NORMAL  = 28 * SCALE  // 0.28 — collision radius
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
  abdMesh!: THREE.Mesh                       // Round 8 Issue 1: abdomen mesh for shudder
  collisionBody: CollisionBody

  // Round 8 Issue 3: combat-feel state
  recoilVx            = 0
  recoilVz            = 0
  recoilTimer         = 0
  shudderTimer        = 0
  halfHpLeapTriggered = false
  private dodgeTimer  = 0
  private dodgeVx     = 0
  private dodgeVz     = 0

  // Round 8 Issue 6: presented item visual during celebration
  private presentedItemMesh: THREE.Object3D | null = null

  // Round 10 — footstep cadence (Webbs has 8 legs but we trigger one sound per step cycle)
  private stepTimer = 0
  private deathSoundFired = false
  private windedSoundFired = false
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
  moveDir = new THREE.Vector2(0, 0)   // last normalized movement direction for gait

  // Celebration pose — set true while pickup celebration is showing (Round 7 Issue 1)
  celebratingPose          = false
  private celebPoseStartMs = 0
  private preCelebRotation = 0   // saved rotation to restore after celebration

  // Camera offset constants must match main.ts CAM_OFFSET so we can rotate Webbs to face the camera
  private readonly CAM_OFFSET_X = 18
  private readonly CAM_OFFSET_Z = 18

  private bodyMat:          THREE.MeshStandardMaterial | THREE.MeshToonMaterial
  private gradientMap:      THREE.Texture
  private webLauncherMount: THREE.Group | null = null
  private timeSinceDamage   = 9999
  private idleTime          = 0

  constructor(threeScene: THREE.Scene, x: number, z: number, gradientMap: THREE.Texture) {
    this.gradientMap = gradientMap
    this.group = new THREE.Group()
    this.group.position.set(x, 0, z)
    this.weaponSystem = new WeaponSystem(WEAPON_DATA)

    // ─── Body — taller, fuzzier, layered (Round 8 Issue 1) ─────────────────
    // Cephalothorax (front part with eyes) + abdomen (rear bulb)
    const fuzzyTex = createFuzzyBodyTexture()
    // Hybrid: toon banding (cel look) + fuzzy map/bumpMap kept for surface hair detail
    this.bodyMat = new THREE.MeshToonMaterial({
      color: 0x6a4d8a,
      gradientMap: this.gradientMap,
      map: fuzzyTex,
      bumpMap: fuzzyTex,
      bumpScale: 0.04,
    })

    const cephGeo = new THREE.SphereGeometry(0.20, 16, 12)
    cephGeo.scale(1, 0.7, 1)
    const cephMesh = new THREE.Mesh(cephGeo, this.bodyMat)
    cephMesh.castShadow = true
    cephMesh.position.set(0, 0.42, 0.16)        // RAISED so legs visible underneath
    this.group.add(cephMesh)
    // Inverted-hull outline — BackSide dark mesh scaled out slightly
    const cephOutline = new THREE.Mesh(cephGeo, new THREE.MeshBasicMaterial({ color: 0x0a0612, side: THREE.BackSide }))
    cephOutline.scale.multiplyScalar(1.04)
    cephMesh.add(cephOutline)
    this.bodyMesh = cephMesh

    const abdGeo = new THREE.SphereGeometry(0.26, 16, 14)
    abdGeo.scale(1, 0.75, 1.15)
    const abdMesh = new THREE.Mesh(abdGeo, this.bodyMat)
    abdMesh.castShadow = true
    abdMesh.position.set(0, 0.40, -0.18)
    this.group.add(abdMesh)
    const abdOutline = new THREE.Mesh(abdGeo, new THREE.MeshBasicMaterial({ color: 0x0a0612, side: THREE.BackSide }))
    abdOutline.scale.multiplyScalar(1.04)
    abdMesh.add(abdOutline)
    this.abdMesh = abdMesh

    // ─── Eyes — 8 total in classic spider pattern ──────────────────────────
    const primaryEyeMat = new THREE.MeshStandardMaterial({
      color: 0x111122, emissive: 0x66e0ff, emissiveIntensity: 2.2,
    })
    const pupilMat = new THREE.MeshBasicMaterial({ color: 0xffffff })
    const secondaryEyeMat = new THREE.MeshStandardMaterial({
      color: 0x000000, emissive: 0x44aadd, emissiveIntensity: 1.0,
    })
    // Two large primary eyes with white pupils — face direction = +Z (forward)
    const primaryR = 0.04
    const eyeY     = 0.52
    const eyeZ     = 0.32
    for (const x of [-0.07, 0.07]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(primaryR, 10, 8), primaryEyeMat)
      eye.position.set(x, eyeY, eyeZ)
      this.group.add(eye)
      const pupil = new THREE.Mesh(new THREE.SphereGeometry(primaryR * 0.5, 8, 6), pupilMat)
      pupil.position.set(x, eyeY + 0.005, eyeZ + 0.03)
      this.group.add(pupil)
    }
    // Six secondary eyes
    const secondaryR = 0.022
    for (const [x, y, z] of [
      [-0.13, 0.55, 0.27], [-0.05, 0.57, 0.30], [ 0.05, 0.57, 0.30], [ 0.13, 0.55, 0.27],
      [-0.10, 0.49, 0.34], [ 0.10, 0.49, 0.34],
    ] as [number, number, number][]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(secondaryR, 8, 6), secondaryEyeMat)
      eye.position.set(x, y, z)
      this.group.add(eye)
    }

    // ─── Mandibles ─────────────────────────────────────────────────────────
    const mandMat = new THREE.MeshStandardMaterial({ color: 0x2a1830, roughness: 0.8 })
    for (const x of [-0.06, 0.06]) {
      const mand = new THREE.Mesh(new THREE.ConeGeometry(0.025, 0.08, 6), mandMat)
      mand.position.set(x, 0.34, 0.33)
      mand.rotation.x = Math.PI / 4
      this.group.add(mand)
    }

    // ─── Ground shadow disc ────────────────────────────────────────────────
    const shadowGeo = new THREE.CircleGeometry(0.30, 16).rotateX(-Math.PI / 2)
    const shadowMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.4 })
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

    // Camera offset must match main.ts CAM_OFFSET. atan2(18,18) = π/4.
    const camAngle = Math.atan2(this.CAM_OFFSET_X, this.CAM_OFFSET_Z)
    const camCos   = Math.cos(camAngle)
    const camSin   = Math.sin(camAngle)
    const dx =  inputX * camCos + inputZ * camSin
    const dz = -inputX * camSin + inputZ * camCos

    // Round 8 Issue 3: recoil overrides input velocity briefly when hit
    if (this.dodgeTimer > 0) {
      this.dodgeTimer -= delta
      this.collisionBody.velocity.x = this.dodgeVx
      this.collisionBody.velocity.z = this.dodgeVz
      this.dodgeVx *= 0.93
      this.dodgeVz *= 0.93
    } else if (this.recoilTimer > 0) {
      this.recoilTimer -= delta
      const k = Math.max(0, this.recoilTimer / 0.18)
      this.collisionBody.velocity.x = dx * speed * (1 - k) + this.recoilVx * k
      this.collisionBody.velocity.z = dz * speed * (1 - k) + this.recoilVz * k
    } else {
      this.collisionBody.velocity.x = dx * speed
      this.collisionBody.velocity.z = dz * speed
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

    this.moveDir.set(dx, dz) // normalized (0.707 diagonal already applied above)

    if (dx !== 0 || dz !== 0) {
      this.facingX = dx
      this.facingZ = dz
      this.group.rotation.y = Math.atan2(dx, dz)
    }

    // Round 10 — footstep cadence.  ~3.5 steps/s while moving on the ground.
    const moving = (Math.abs(dx) > 0.01 || Math.abs(dz) > 0.01) && this.dodgeTimer <= 0
    if (moving) {
      this.stepTimer += delta
      if (this.stepTimer >= 0.28) {
        this.stepTimer = 0
        audio.play(this.floorType === 'stone' ? 'footstep_stone' : 'footstep_dirt',
          this.collisionBody.x, this.collisionBody.z)
      }
    } else {
      this.stepTimer = 0
    }

    // Trigger one-shot death sound on the frame HP hits zero.
    if (!this.deathSoundFired && this.hp <= 0) {
      this.deathSoundFired = true
      audio.play('webbs_death', this.collisionBody.x, this.collisionBody.z)
    }

    // Stamina + energy regen
    if (this.stamina < this.maxStamina)
      this.stamina = Math.min(this.maxStamina, this.stamina + STAMINA_REGEN * this.staminaRegenMult * delta)
    if (this.energy < this.maxEnergy)
      this.energy = Math.min(this.maxEnergy, this.energy + 5 * delta)

    // Winded: engages at 0 stamina, clears above 20% max
    if (this.stamina <= 0) {
      if (!this.winded && !this.windedSoundFired) {
        this.windedSoundFired = true
        audio.play('stamina_winded', this.collisionBody.x, this.collisionBody.z)
      }
      this.winded = true
    } else if (this.winded && this.stamina >= this.maxStamina * STAMINA_RECOVER_AT) {
      this.winded = false
      this.windedSoundFired = false
    }

    // HP regen after grace period
    this.timeSinceDamage += delta
    if (this.timeSinceDamage > REGEN_DELAY_S && this.hp < this.hpMax && this.hp > 0)
      this.hp = Math.min(this.hpMax, this.hp + REGEN_RATE * delta)

    // Idle body bob — gentle sine on group Y. syncPosition() only writes X/Z so this persists.
    this.idleTime += delta
    this.group.position.y = Math.sin(this.idleTime * 2) * 0.012
  }

  // ── Call after physicsWorld.update() to sync 3D group from physics body ──
  syncPosition(): void {
    this.group.position.x = this.collisionBody.x
    this.group.position.z = this.collisionBody.z
  }

  // ── Call after syncPosition() — advances gait and solves IK ──────────────
  updateLegs(delta: number): void {
    if (this.celebratingPose) {
      // Round 7 Issue 1: animate rotation toward camera over 300ms, then call leg pose.
      const elapsedMs = performance.now() - this.celebPoseStartMs

      const camLen  = Math.hypot(this.CAM_OFFSET_X, this.CAM_OFFSET_Z)
      const camDirX = this.CAM_OFFSET_X / camLen
      const camDirZ = this.CAM_OFFSET_Z / camLen
      const targetRotation = Math.atan2(camDirX, camDirZ)   // makes body forward point to camera

      const rotT = Math.min(elapsedMs / 300, 1)
      let deltaA = targetRotation - this.preCelebRotation
      while (deltaA >  Math.PI) deltaA -= Math.PI * 2
      while (deltaA < -Math.PI) deltaA += Math.PI * 2
      this.group.rotation.y = this.preCelebRotation + deltaA * rotT

      this.legs.updateCelebrationPose(this.group.position, elapsedMs)
      this.updatePresentedItem(elapsedMs)
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

  startCelebrationPose(weapon?: WeaponType): void {
    this.celebratingPose   = true
    this.celebPoseStartMs  = performance.now()
    this.preCelebRotation  = this.group.rotation.y
    // Stop any residual movement so the spider stays put for the pose
    this.collisionBody.velocity.x = 0
    this.collisionBody.velocity.z = 0
    this.moveDir.set(0, 0)
    if (weapon !== undefined) this.showPresentedItem(weapon)
  }

  endCelebrationPose(): void {
    this.celebratingPose  = false
    this.group.rotation.y = this.preCelebRotation
    this.hidePresentedItem()
  }

  // ── Hit feedback — body flash + recoil + shudder + half-HP leap ─────────
  damage(amount: number): void {
    if (amount <= 0 || this.maxProtectionActive) return
    this.hp = Math.max(0, this.hp - amount)
    this.timeSinceDamage = 0

    // Round 10 — pain vocalisation
    audio.play('webbs_damage', this.collisionBody.x, this.collisionBody.z)

    // Red flash on body (new color base = 0x6a4d8a)
    this.bodyMat.color.setHex(0xff3344)
    setTimeout(() => { this.bodyMat.color.setHex(0x6a4d8a) }, 140)

    // Round 8 Issue 3: recoil + shudder
    this.recoilVx    = -this.facingX * 1.6
    this.recoilVz    = -this.facingZ * 1.6
    this.recoilTimer = 0.18
    this.shudderTimer = 0.20

    // One-time 50% HP leap back
    const hpFrac = this.hp / this.hpMax
    if (!this.halfHpLeapTriggered && hpFrac <= 0.5 && hpFrac > 0) {
      this.halfHpLeapTriggered = true
      audio.play('half_hp_pain', this.collisionBody.x, this.collisionBody.z)
      this.startDodgeLeap()
    }
  }

  // Round 8 Issue 3: backward dodge leap (spacebar + half-HP trigger)
  startDodgeLeap(): void {
    const leapSpeed = 11.0
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
    this.collisionBody.radius = r
  }
}
