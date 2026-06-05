import * as THREE from 'three'
import { WeaponType } from '../systems/WeaponSystem'
import type { WeaponSystem } from '../systems/WeaponSystem'
import { WEAPON_COLORS } from '../config/WeaponData'

// ─── IK constants (base values; scaled per-instance by SpiderLegs.sc) ────────
const UPPER_LEN      = 0.55
const LOWER_LEN      = 0.55

// ─── Gait constants (base values) ─────────────────────────────────────────────
const STEP_DURATION  = 0.12   // seconds per step swing (time-based, no scale)
const STEP_HEIGHT    = 0.18   // world units of arc lift
const STEP_THRESHOLD = 0.28   // distance before a foot triggers a step
const OVERSHOOT      = 0.18   // anticipatory plant ahead of anchor
const SNAP_THRESHOLD = 0.85   // hard snap when foot drifts this far

// ─── Leg anchor data (body-local, unscaled) ───────────────────────────────────
// 4L + 4R: legs anchor on the SIDES (±X dominant) with a small fore/aft Z fan.
// Feet splay ~70–110° off the forward (+Z) axis, matching classic spider stance.
// Group A: R1, L2, R3, L4  |  Group B: L1, R2, L3, R4
const ANCHOR_DATA = [
  { i: 0, side: 'left',  group: 'B', root: [-0.20, 0.15,  0.28], anchor: [-0.80, 0,  0.30] },
  { i: 1, side: 'right', group: 'A', root: [ 0.20, 0.15,  0.28], anchor: [ 0.80, 0,  0.30] },
  { i: 2, side: 'left',  group: 'A', root: [-0.20, 0.12,  0.09], anchor: [-0.85, 0,  0.10] },
  { i: 3, side: 'right', group: 'B', root: [ 0.20, 0.12,  0.09], anchor: [ 0.85, 0,  0.10] },
  { i: 4, side: 'left',  group: 'B', root: [-0.20, 0.12, -0.09], anchor: [-0.85, 0, -0.10] },
  { i: 5, side: 'right', group: 'A', root: [ 0.20, 0.12, -0.09], anchor: [ 0.85, 0, -0.10] },
  { i: 6, side: 'left',  group: 'A', root: [-0.20, 0.15, -0.28], anchor: [-0.80, 0, -0.30] },
  { i: 7, side: 'right', group: 'B', root: [ 0.20, 0.15, -0.28], anchor: [ 0.80, 0, -0.30] },
] as const

// ─── Leg tier materials ───────────────────────────────────────────────────────
const TIER_COLORS = [0x8B6914, 0x777777, 0x505050, 0xC0C0C0] // wood, stone, iron, metal

// Round 8 Issue 1 — fuzzy spider hair texture, shared with body for upper legs
export function createFuzzyBodyTexture(): THREE.DataTexture {
  const size = 64
  const data = new Uint8Array(size * size * 4)
  for (let i = 0; i < size * size; i++) {
    const noise = (Math.random() - 0.5) * 0.4
    data[i * 4 + 0] = Math.max(0, Math.min(255, 106 + noise * 80))   // 0x6a base
    data[i * 4 + 1] = Math.max(0, Math.min(255,  77 + noise * 50))   // 0x4d base
    data[i * 4 + 2] = Math.max(0, Math.min(255, 138 + noise * 60))   // 0x8a base
    data[i * 4 + 3] = 255
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat)
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.repeat.set(2, 2)
  tex.needsUpdate = true
  return tex
}

// ─── Module-level scratch vectors (avoid per-frame allocations) ───────────────
const _sv1 = new THREE.Vector3()
const _sv2 = new THREE.Vector3()
const _sv3 = new THREE.Vector3()
const _yUp      = new THREE.Vector3(0, 1, 0)
const _forwardZ = new THREE.Vector3(0, 0, 1)
const _quat = new THREE.Quaternion()

// ─── Cylinder helper ──────────────────────────────────────────────────────────
// Positions a CylinderGeometry(1,1,2) mesh to span from `start` to `end`.
// Scale X/Z = radius, Scale Y = half-length (cylinder default height is 2).
function positionCylinder(
  mesh: THREE.Mesh,
  start: THREE.Vector3,
  end: THREE.Vector3,
  radius: number
): void {
  _sv1.subVectors(end, start)
  const length = _sv1.length()
  if (length < 0.001) { mesh.visible = false; return }
  mesh.visible = true
  mesh.position.addVectors(start, end).multiplyScalar(0.5)
  _quat.setFromUnitVectors(_yUp, _sv1.normalize())
  mesh.quaternion.copy(_quat)
  mesh.scale.set(radius, length * 0.5, radius)
}

// ─── Two-bone IK solver ───────────────────────────────────────────────────────
// Returns knee position via `out`. Bends toward `pole` direction.
function solveTwoBoneIK(
  root: THREE.Vector3,
  target: THREE.Vector3,
  upperLen: number,
  lowerLen: number,
  pole: THREE.Vector3,
  out: THREE.Vector3
): void {
  _sv1.subVectors(target, root)
  const reach = Math.min(_sv1.length(), upperLen + lowerLen - 0.001)
  if (reach < 0.001) { out.copy(root); return }

  // Law of cosines: angle at root between upper leg and root→target line
  const cosA = (upperLen * upperLen + reach * reach - lowerLen * lowerLen) / (2 * upperLen * reach)
  const angle = Math.acos(Math.max(-1, Math.min(1, cosA)))

  _sv1.normalize() // unit dir: root → target

  // Rotation axis: perpendicular to dir and pole
  _sv2.crossVectors(_sv1, pole).normalize()
  if (_sv2.lengthSq() < 0.0001) _sv2.set(0, 1, 0) // fallback when dir ∥ pole

  // Rotate dir toward pole by IK angle → knee direction
  _sv3.copy(_sv1).applyAxisAngle(_sv2, angle)
  out.copy(root).addScaledVector(_sv3, upperLen)
}

// ─── Leg data ─────────────────────────────────────────────────────────────────
interface Leg {
  index: number
  side: 'left' | 'right'
  group: 'A' | 'B'
  rootOffset: THREE.Vector3    // body-local root attachment
  anchorOffset: THREE.Vector3  // body-local ideal foot rest position
  footPos: THREE.Vector3       // current foot world position
  anchorWorld: THREE.Vector3   // anchor mapped to world space each frame
  rootWorld: THREE.Vector3     // root mapped to world space each frame
  poleDir: THREE.Vector3       // knee bend direction (updated each frame)
  isStepping: boolean
  stepT: number                // 0 → 1 progress through current step
  stepStart: THREE.Vector3
  stepTarget: THREE.Vector3
  wantsStep: boolean
  upper: THREE.Mesh  // organic segment: body color
  knee:  THREE.Mesh  // hinge joint sphere
  lower: THREE.Mesh  // bionic segment: tier/weapon color
  tip:   THREE.Mesh  // foot sphere: weapon color
}

type GaitPhase = 'IDLE' | 'A' | 'B'

// ─── SpiderLegs ───────────────────────────────────────────────────────────────
export type SwingStyle = 'thrust' | 'sword' | 'axe' | 'stab' | 'spray'

interface LegAnim {
  elapsed:     number
  duration:    number
  facingX:     number
  facingZ:     number
  // Visual reach from body center — used to normalise per-leg thrust so every
  // leg's weapon tip lands at the same world point regardless of leg position.
  attackRange: number
  style:       SwingStyle
}

function wrapAngle(a: number): number {
  while (a >  Math.PI) a -= Math.PI * 2
  while (a < -Math.PI) a += Math.PI * 2
  return a
}

export class SpiderLegs {
  private legs:         Leg[]   = []
  private animStates:   Array<LegAnim | null> = Array(8).fill(null)
  private phase:        GaitPhase = 'IDLE'
  private kneePos       = new THREE.Vector3()
  private gradientMap:  THREE.Texture
  private currentTier   = 0
  private slotWeapons:  WeaponType[]              = Array(8).fill(WeaponType.Empty)
  private weaponMeshes: Array<THREE.Group | null> = Array(8).fill(null)
  private lastBodyRotation = 0
  threeScene: THREE.Scene

  // Per-instance scaled constants (multiplied by constructor `scale` param)
  private readonly sc:           number
  private readonly upperLen:     number
  private readonly lowerLen:     number
  private readonly stepH:        number
  private readonly stepThresh:   number
  private readonly overshootDist: number
  private readonly snapThresh:   number
  private readonly rootHOff:     number   // body-height offset for root world Y

  constructor(threeScene: THREE.Scene, gradientMap: THREE.Texture, scale = 1.0) {
    this.threeScene    = threeScene
    this.gradientMap   = gradientMap
    this.sc            = scale
    this.upperLen      = UPPER_LEN      * scale
    this.lowerLen      = LOWER_LEN      * scale
    this.stepH         = STEP_HEIGHT    * scale
    this.stepThresh    = STEP_THRESHOLD * scale
    this.overshootDist = OVERSHOOT      * scale
    this.snapThresh    = SNAP_THRESHOLD * scale
    this.rootHOff      = 0.32           * scale
    this.buildLegs()
  }

  private buildLegs(): void {
    const gm = this.gradientMap
    const sc = this.sc
    for (const d of ANCHOR_DATA) {
      // Three-part leg: fuzzy organic upper (body color) → hinge → bionic lower (tier/weapon)
      const upper = new THREE.Mesh(
        new THREE.CylinderGeometry(1, 1, 2, 8),
        new THREE.MeshStandardMaterial({
          color: 0x6a4d8a,
          roughness: 0.95,
          map: createFuzzyBodyTexture(),
        }),
      )
      const lower = new THREE.Mesh(
        new THREE.CylinderGeometry(1, 1, 2, 8),
        // Bionic lower segment — dark metal, per-leg so weapon color can be set independently
        new THREE.MeshStandardMaterial({ color: TIER_COLORS[0], metalness: 0.85, roughness: 0.35 }),
      )
      const knee = new THREE.Mesh(
        new THREE.SphereGeometry(0.08 * sc, 8, 6),
        // Servo joint — near-black metal
        new THREE.MeshStandardMaterial({ color: 0x1a1a1f, metalness: 0.9, roughness: 0.25 }),
      )
      // Emissive accent ring at the joint — the "this is a machine" tell; blooms with UnrealBloomPass
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(0.045 * sc, 0.008 * sc, 6, 14),
        new THREE.MeshStandardMaterial({ color: 0x00d9ff, emissive: 0x00aaff, emissiveIntensity: 1.4 }),
      )
      ring.rotation.x = Math.PI / 2
      knee.add(ring)
      const tip = new THREE.Mesh(
        new THREE.SphereGeometry(0.09 * sc, 8, 6),
        new THREE.MeshToonMaterial({ color: 0x444444, gradientMap: gm }),
      )
      upper.castShadow = false
      lower.castShadow = false
      knee.castShadow  = false

      this.threeScene.add(upper, lower, knee, tip)

      this.legs.push({
        index:        d.i,
        side:         d.side,
        group:        d.group,
        rootOffset:   new THREE.Vector3(d.root[0] * sc,   d.root[1] * sc,   d.root[2] * sc),
        anchorOffset: new THREE.Vector3(d.anchor[0] * sc, d.anchor[1] * sc, d.anchor[2] * sc),
        footPos:      new THREE.Vector3(),
        anchorWorld:  new THREE.Vector3(),
        rootWorld:    new THREE.Vector3(),
        poleDir:      new THREE.Vector3(),
        isStepping:   false,
        stepT:        0,
        stepStart:    new THREE.Vector3(),
        stepTarget:   new THREE.Vector3(),
        wantsStep:    false,
        upper, knee, lower, tip,
      })
    }
  }

  // Snap all feet to resting world positions — call once after placing the body.
  initFeetAt(bodyPos: THREE.Vector3, bodyRotY: number): void {
    this.updateWorldVecs(bodyPos, bodyRotY)
    for (const leg of this.legs) {
      leg.footPos.copy(leg.anchorWorld)
    }
  }

  // Trigger a one-shot punch/thrust animation on a specific leg.
  // legIndex matches weapon slot (0-7). attackRange is the visual reach from body
  // centre — the weapon tip will always land at bodyPos + facing * attackRange.
  triggerAnim(legIndex: number, durationSec: number, facingX: number, facingZ: number, attackRange = 1.0, style: SwingStyle = 'thrust'): void {
    if (legIndex < 0 || legIndex >= 8) return
    this.animStates[legIndex] = { elapsed: 0, duration: durationSec, facingX, facingZ, attackRange, style }
  }

  // Round 9 Issue 3 — convenience wrapper for weapon swings.  Per-style durations
  // match the visuals in the weapon-anim loop below.  attackRange = 1.1wu so the
  // weapon tip lands well in front of Webbs at the slam point.
  startWeaponSwing(legIndex: number, style: 'sword' | 'axe' | 'stab' | 'spray', facingX: number, facingZ: number): void {
    const dur = style === 'sword' ? 0.30
              : style === 'axe'   ? 0.40
              : style === 'stab'  ? 0.18
              :                     0.10
    this.triggerAnim(legIndex, dur, facingX, facingZ, 1.1, style)
  }

  // Main per-frame update — call after physicsWorld has settled body position.
  update(
    delta: number,
    bodyPos: THREE.Vector3,
    bodyRotY: number,
    moveDir: THREE.Vector2,
    weaponSystem: WeaponSystem
  ): void {
    this.updateWorldVecs(bodyPos, bodyRotY)

    // ─────────────────────────────────────────────────────────────────────────
    // Round 9 Issue 1 — proper rotation-tracking model.
    //
    // The Round 8 single-frame snap-on-45° threshold missed any rotation that
    // was spread across multiple frames (e.g. 30°/frame × 3 frames = 90° total,
    // each individual frame still under 45° so no snap fired). Result: legs lag
    // behind cumulatively and the "front legs become back legs" visual returns.
    //
    // Fix: continuously rotate every foot's world position around the body
    // centre by the same delta the BODY rotated this frame. This keeps each
    // foot's body-local position constant during rotation, so the IK never
    // bridges a stretched gap and the leg layout stays locked to the body.
    // Stepping/gait runs on top of this for natural translation motion.
    // ─────────────────────────────────────────────────────────────────────────
    const rotDelta = wrapAngle(bodyRotY - this.lastBodyRotation)
    if (Math.abs(rotDelta) > 0.0001) {
      const rc = Math.cos(rotDelta)
      const rs = Math.sin(rotDelta)
      for (const leg of this.legs) {
        const lx = leg.footPos.x - bodyPos.x
        const lz = leg.footPos.z - bodyPos.z
        leg.footPos.x = bodyPos.x + lx * rc - lz * rs
        leg.footPos.z = bodyPos.z + lx * rs + lz * rc
      }
    }

    // Hard catch-up — snap feet that drifted beyond 1.2× baseline (scaled) after a teleport.
    const hardSnap = (1.2 * this.sc) ** 2
    const bcos = Math.cos(-bodyRotY)
    const bsin = Math.sin(-bodyRotY)
    const wcos = Math.cos( bodyRotY)
    const wsin = Math.sin( bodyRotY)
    for (const leg of this.legs) {
      const lfx = leg.footPos.x - bodyPos.x
      const lfz = leg.footPos.z - bodyPos.z
      // Un-rotate by body rotation → body-local foot position
      const blx = lfx * bcos - lfz * bsin
      const blz = lfx * bsin + lfz * bcos
      const ax  = leg.anchorOffset.x
      const az  = leg.anchorOffset.z
      const dx  = blx - ax
      const dz  = blz - az
      if (dx * dx + dz * dz > hardSnap) {
        leg.footPos.x = bodyPos.x + ax * wcos - az * wsin
        leg.footPos.z = bodyPos.z + ax * wsin + az * wcos
        leg.isStepping = false
      }
    }
    this.lastBodyRotation = bodyRotY

    // Animated legs are fully excluded from the gait machine this frame
    const activeAnims = this.animStates.map((s, i) => s !== null ? i : -1).filter(i => i >= 0)
    const animSet     = new Set(activeAnims)

    // Mark legs that have drifted too far from their anchor (non-animated only)
    for (const leg of this.legs) {
      if (animSet.has(leg.index)) { leg.wantsStep = false; leg.isStepping = false; continue }
      leg.wantsStep = !leg.isStepping && leg.footPos.distanceTo(leg.anchorWorld) > this.stepThresh
    }

    // Gait state machine — exclude animated legs so they never block phase transitions
    const ga = this.legs.filter(l => l.group === 'A' && !animSet.has(l.index))
    const gb = this.legs.filter(l => l.group === 'B' && !animSet.has(l.index))

    if (this.phase === 'IDLE') {
      if (ga.some(l => l.wantsStep)) { this.startStep(ga, moveDir); this.phase = 'A' }
      else if (gb.some(l => l.wantsStep)) { this.startStep(gb, moveDir); this.phase = 'B' }
    }
    if (this.phase === 'A') { this.advanceStep(ga, delta); if (ga.every(l => !l.isStepping)) this.phase = 'IDLE' }
    if (this.phase === 'B') { this.advanceStep(gb, delta); if (gb.every(l => !l.isStepping)) this.phase = 'IDLE' }

    // Snap correction — after a sharp turn all anchors shift at once.
    for (const leg of this.legs) {
      if (animSet.has(leg.index) || leg.isStepping) continue
      if (leg.footPos.distanceTo(leg.anchorWorld) > this.snapThresh) {
        leg.footPos.copy(leg.anchorWorld)
      }
    }

    // Apply weapon animation — large forward thrust + weapon mesh visual
    for (let i = 0; i < this.legs.length; i++) {
      const anim = this.animStates[i]
      if (!anim) continue
      anim.elapsed += delta
      const t = Math.min(anim.elapsed / anim.duration, 1)
      const leg = this.legs[i]
      const wMesh = this.weaponMeshes[i]
      if (t >= 1) {
        this.animStates[i] = null
        leg.tip.visible = true
        leg.tip.scale.setScalar(1.0)
        if (wMesh) wMesh.visible = false
        continue
      }
      const flen = Math.hypot(anim.facingX, anim.facingZ) || 1
      const fx   = anim.facingX / flen
      const fz   = anim.facingZ / flen

      // ─── Style-specific foot path ──────────────────────────────────────────
      // All weapons converge on a single impact point in front of the body so
      // the weapon tip lands at the same world location regardless of which
      // leg-slot fired.  Lateral anchor offsets are cancelled out.
      if (anim.style === 'sword') {
        // Overhead slam: WINDUP up+back → SLAM down+forward → RETURN to anchor.
        const ix = bodyPos.x + fx * anim.attackRange
        const iz = bodyPos.z + fz * anim.attackRange
        if (t < 0.30) {
          const wt = t / 0.30
          leg.footPos.set(
            bodyPos.x - fx * 0.25 * wt,
            0.05 + 0.85 * wt,
            bodyPos.z - fz * 0.25 * wt,
          )
        } else if (t < 0.65) {
          const st  = (t - 0.30) / 0.35
          const ets = st * st                        // ease-in: slow rise then crash
          const sx  = bodyPos.x - fx * 0.25
          const sz  = bodyPos.z - fz * 0.25
          leg.footPos.set(
            sx + (ix - sx) * ets,
            0.85 + (0.05 - 0.85) * ets,
            sz + (iz - sz) * ets,
          )
        } else {
          const rt = (t - 0.65) / 0.35
          leg.footPos.set(
            ix + (leg.anchorWorld.x - ix) * rt,
            0.05 + (1 - rt) * 0.15,                  // small arc on return
            iz + (leg.anchorWorld.z - iz) * rt,
          )
        }
      } else if (anim.style === 'axe') {
        // Horizontal 180° sweep — foot arcs sideways at constant radius around body.
        const baseAng    = Math.atan2(fx, fz)
        const swingAng   = -Math.PI / 2 + Math.PI * t        // -90° → +90°
        const a          = baseAng + swingAng
        const SWEEP_DIST = anim.attackRange
        leg.footPos.set(
          bodyPos.x + Math.sin(a) * SWEEP_DIST,
          0.20 + Math.sin(t * Math.PI) * 0.30,               // gentle up-arc during sweep
          bodyPos.z + Math.cos(a) * SWEEP_DIST,
        )
      } else if (anim.style === 'stab') {
        // Quick lunge forward then back — peak extension at t=0.5.
        const stabT = t < 0.5 ? (t / 0.5) : (1 - (t - 0.5) / 0.5)
        const STAB_DIST = anim.attackRange * 0.95
        leg.footPos.set(
          bodyPos.x + fx * STAB_DIST * stabT,
          0.10,
          bodyPos.z + fz * STAB_DIST * stabT,
        )
      } else {
        // Default 'thrust' / 'spray' — Round 7-style fan-out from anchor.
        const thrust = Math.sin(t * Math.PI)
        const ax = bodyPos.x + fx * anim.attackRange
        const az = bodyPos.z + fz * anim.attackRange
        leg.footPos.set(
          leg.anchorWorld.x + thrust * (ax - leg.anchorWorld.x),
          thrust * 0.4,
          leg.anchorWorld.z + thrust * (az - leg.anchorWorld.z),
        )
      }
      leg.isStepping = false

      if (wMesh) {
        // Show weapon mesh at the tip, oriented toward the attack direction
        wMesh.visible = true
        wMesh.position.copy(leg.footPos)
        _sv1.set(fx, 0, fz)
        if (_sv1.lengthSq() > 0.0001) {
          _quat.setFromUnitVectors(_forwardZ, _sv1)
          wMesh.quaternion.copy(_quat)
        }
        // Hide the tip sphere — weapon mesh is the visual
        leg.tip.visible = false
      } else {
        // No weapon mesh: fall back to scaled tip sphere (use sin-pulse t).
        const pulse = Math.sin(t * Math.PI)
        leg.tip.visible = true
        leg.tip.scale.setScalar(1.0 + pulse * 3.0)
      }
    }

    // Solve IK + position meshes + update colors + sync weapon meshes
    for (const leg of this.legs) {
      solveTwoBoneIK(leg.rootWorld, leg.footPos, this.upperLen, this.lowerLen, leg.poleDir, this.kneePos)
      // Upper slightly thicker (organic), lower slimmer (bionic)
      positionCylinder(leg.upper, leg.rootWorld, this.kneePos, 0.048 * this.sc)
      positionCylinder(leg.lower, this.kneePos,  leg.footPos,  0.025 * this.sc)
      leg.knee.position.copy(this.kneePos)
      leg.tip.position.copy(leg.footPos)
      // During animation the tip can rise above 0 — let it (no floor clamp)
      if (!this.animStates[leg.index]) {
        leg.tip.position.y = Math.max(leg.footPos.y + 0.08, 0.08)
      }

      const weaponType  = weaponSystem.getSlot(leg.index)
      const weaponColor = WEAPON_COLORS[weaponType] ?? 0x444444
      // Tip = weapon color
      ;(leg.tip.material as THREE.MeshToonMaterial).color.setHex(weaponColor)
      // Lower = weapon color when equipped, tier color when empty
      const lowerColor = weaponType !== WeaponType.Empty
        ? weaponColor
        : TIER_COLORS[this.currentTier]
      ;(leg.lower.material as THREE.MeshStandardMaterial).color.setHex(lowerColor)

      // Round 8 Issue 4: weapon mesh stays visible at the foot at rest, not just
      // during attack animation.  Orient the weapon to point outward from body.
      this.syncWeaponMesh(leg.index, weaponType)
      const wm = this.weaponMeshes[leg.index]
      if (wm && !this.animStates[leg.index]) {
        if (weaponType !== WeaponType.Empty) {
          wm.visible = true
          wm.position.copy(leg.footPos)
          wm.position.y = Math.max(leg.footPos.y + 0.04, 0.04)
          const dxw = leg.footPos.x - bodyPos.x
          const dzw = leg.footPos.z - bodyPos.z
          const lw  = Math.hypot(dxw, dzw)
          if (lw > 0.001) {
            _sv1.set(dxw / lw, 0, dzw / lw)
            _quat.setFromUnitVectors(_forwardZ, _sv1)
            wm.quaternion.copy(_quat)
          }
          // Tip sphere hidden when weapon is shown
          leg.tip.visible = false
        } else {
          wm.visible = false
          leg.tip.visible = true
        }
      }
    }
  }

  // Round 7 Issue 1 — three-phase celebration pose:
  //   T=0.0–0.3s : body rotates toward camera (handled by Webbs3D)
  //   T=0.3–0.7s : front two legs lift from ground to peak height
  //   T=0.7s+    : legs hold raised position with gentle bob
  // Camera is at world (+X, +Y, +Z), so "toward camera" in XZ is +X +Z.  Once
  // Webbs has rotated to face the camera, the front anatomical legs (i=6,7) sit
  // on the camera-facing side and lift to display the item.
  updateCelebrationPose(bodyPos: THREE.Vector3, elapsedMs: number): void {
    // Anchor positions for the 6 planted legs must follow the rotating body.
    // We re-derive the current rotation from the group via the legs' anchors —
    // but since Webbs3D writes this.group.rotation.y each frame, we pass the
    // same camera-facing rotation here.
    const CAM_X = 18, CAM_Z = 18
    const camLen  = Math.hypot(CAM_X, CAM_Z)
    const camDirX = CAM_X / camLen
    const camDirZ = CAM_Z / camLen
    const targetRot = Math.atan2(-camDirX, -camDirZ)
    const rotT      = Math.min(elapsedMs / 300, 1)
    // For planted legs we only need the rotated anchors; lerp from 0 → targetRot to match Webbs3D.
    const bodyRotY = targetRot * rotT
    this.updateWorldVecs(bodyPos, bodyRotY)

    // Leg lift gate: starts after the rotation completes (300ms), peaks at 700ms.
    const liftT  = Math.max(0, Math.min((elapsedMs - 300) / 400, 1))
    const liftY  = 0.05 + liftT * 0.55 + Math.sin(elapsedMs / 1000 * 2) * 0.04
    const reachX = bodyPos.x + liftT * 0.45 * camDirX
    const reachZ = bodyPos.z + liftT * 0.45 * camDirZ
    const spread = 0.3

    for (const leg of this.legs) {
      if (leg.index === 6) {
        // Front-left (body local -X, -Z) — in world after rotation, sits more in +Z direction
        leg.footPos.set(reachX - spread * camDirZ, liftY, reachZ + spread * camDirX)
      } else if (leg.index === 7) {
        // Front-right (body local +X, -Z) — sits more in +X direction
        leg.footPos.set(reachX + spread * camDirZ, liftY, reachZ - spread * camDirX)
      } else {
        // All other legs planted at their rotated anchor positions
        leg.footPos.copy(leg.anchorWorld)
        leg.footPos.y = 0
      }
      leg.isStepping = false
    }

    // Solve IK + update meshes for every leg
    for (const leg of this.legs) {
      solveTwoBoneIK(leg.rootWorld, leg.footPos, this.upperLen, this.lowerLen, leg.poleDir, this.kneePos)
      positionCylinder(leg.upper, leg.rootWorld, this.kneePos, 0.048 * this.sc)
      positionCylinder(leg.lower, this.kneePos,  leg.footPos,  0.025 * this.sc)
      leg.knee.position.copy(this.kneePos)
      leg.tip.position.copy(leg.footPos)
      leg.tip.position.y = Math.max(leg.footPos.y, 0.08)
    }
  }

  // Update leg tier → bionic lower segment color reflects tier on next update().
  setLegTier(tier: number): void {
    this.currentTier = Math.max(0, Math.min(3, tier))
  }

  // ── Private helpers ──────────────────────────────────────────────────────────

  // Compute world-space anchor, root, and pole for all legs given body transform.
  private updateWorldVecs(bodyPos: THREE.Vector3, rotY: number): void {
    const cos = Math.cos(rotY)
    const sin = Math.sin(rotY)
    for (const leg of this.legs) {
      const a = leg.anchorOffset
      const r = leg.rootOffset

      // Anchor: body-local XZ rotated into world, Y=0 (ground)
      leg.anchorWorld.set(
        bodyPos.x + a.x * cos - a.z * sin,
        0,
        bodyPos.z + a.x * sin + a.z * cos
      )

      // Root: body-local, elevated by body mesh height (scaled by sc)
      leg.rootWorld.set(
        bodyPos.x + r.x * cos - r.z * sin,
        bodyPos.y + r.y + this.rootHOff,
        bodyPos.z + r.x * sin + r.z * cos
      )

      // Pole: outward from body center toward foot, biased upward so knee lifts
      leg.poleDir.set(
        leg.footPos.x - bodyPos.x,
        0.6,
        leg.footPos.z - bodyPos.z
      ).normalize()
    }
  }

  private startStep(group: Leg[], moveDir: THREE.Vector2): void {
    for (const leg of group) {
      leg.isStepping = true
      leg.stepT      = 0
      leg.stepStart.copy(leg.footPos)
      // Plant target = anchor world + a little ahead in movement direction
      leg.stepTarget.copy(leg.anchorWorld)
      leg.stepTarget.x += moveDir.x * this.overshootDist
      leg.stepTarget.z += moveDir.y * this.overshootDist
      leg.stepTarget.y  = 0
    }
  }

  private advanceStep(group: Leg[], delta: number): void {
    for (const leg of group) {
      if (!leg.isStepping) continue
      leg.stepT = Math.min(1, leg.stepT + delta / STEP_DURATION)
      // Lerp XZ, sine arc in Y
      leg.footPos.lerpVectors(leg.stepStart, leg.stepTarget, leg.stepT)
      leg.footPos.y = leg.stepT < 1
        ? Math.sin(leg.stepT * Math.PI) * this.stepH
        : 0
      if (leg.stepT >= 1) leg.isStepping = false
    }
  }

  // ── Weapon mesh helpers ──────────────────────────────────────────────────────

  // Lazily rebuild the weapon mesh for slot `index` when the equipped type changes.
  private syncWeaponMesh(index: number, type: WeaponType): void {
    if (this.slotWeapons[index] === type) return
    const old = this.weaponMeshes[index]
    if (old) {
      this.threeScene.remove(old)
      old.traverse(obj => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry.dispose()
          ;(obj.material as THREE.Material).dispose()
        }
      })
      this.weaponMeshes[index] = null
    }
    this.slotWeapons[index] = type
    const mesh = this.buildWeaponMesh(type)
    if (mesh) {
      mesh.visible = false
      this.threeScene.add(mesh)
      this.weaponMeshes[index] = mesh
    }
  }

  // Build a THREE.Group whose local +Z axis is the "weapon forward" direction.
  // Position the group at the leg tip and orient +Z toward the facing direction.
  private buildWeaponMesh(type: WeaponType): THREE.Group | null {
    const gm = this.gradientMap
    switch (type) {
      case WeaponType.Sword: {
        const g = new THREE.Group()
        // Blade: thin box extending along +Z
        const blade = new THREE.Mesh(
          new THREE.BoxGeometry(0.045, 0.045, 0.42),
          new THREE.MeshToonMaterial({ color: 0xd8d8d8, gradientMap: gm }),
        )
        blade.position.z = 0.23
        // Crossguard perpendicular to blade
        const guard = new THREE.Mesh(
          new THREE.BoxGeometry(0.22, 0.05, 0.05),
          new THREE.MeshToonMaterial({ color: 0x999999, gradientMap: gm }),
        )
        guard.position.z = 0.05
        g.add(blade, guard)
        return g
      }
      case WeaponType.Axe: {
        const g = new THREE.Group()
        // Handle: cylinder along Z
        const handle = new THREE.Mesh(
          new THREE.CylinderGeometry(0.025, 0.025, 0.30, 6),
          new THREE.MeshToonMaterial({ color: 0x5c3d1a, gradientMap: gm }),
        )
        handle.rotation.x = Math.PI / 2
        handle.position.z = 0.15
        // Axe head: flat box offset to one side of the tip
        const head = new THREE.Mesh(
          new THREE.BoxGeometry(0.10, 0.28, 0.08),
          new THREE.MeshToonMaterial({ color: 0x888888, gradientMap: gm }),
        )
        head.position.z = 0.31
        g.add(handle, head)
        return g
      }
      case WeaponType.BoxingGloves: {
        // Toothpick Stabber: long thin tapered spike
        const g = new THREE.Group()
        const shaft = new THREE.Mesh(
          new THREE.CylinderGeometry(0.020, 0.013, 0.50, 6),
          new THREE.MeshToonMaterial({ color: 0xc8a96e, gradientMap: gm }),
        )
        shaft.rotation.x = Math.PI / 2
        shaft.position.z = 0.25
        const point = new THREE.Mesh(
          new THREE.ConeGeometry(0.020, 0.10, 6),
          new THREE.MeshToonMaterial({ color: 0xe0c080, gradientMap: gm }),
        )
        point.rotation.x = Math.PI / 2  // tip points in +Z
        point.position.z = 0.55
        g.add(shaft, point)
        return g
      }
      case WeaponType.Bow: {
        // Arrow: shaft + arrowhead
        const g = new THREE.Group()
        const shaft = new THREE.Mesh(
          new THREE.CylinderGeometry(0.012, 0.012, 0.42, 6),
          new THREE.MeshToonMaterial({ color: 0x8b6914, gradientMap: gm }),
        )
        shaft.rotation.x = Math.PI / 2
        shaft.position.z = 0.21
        const head = new THREE.Mesh(
          new THREE.ConeGeometry(0.028, 0.10, 6),
          new THREE.MeshToonMaterial({ color: 0xcc99ff, gradientMap: gm }),
        )
        head.rotation.x = Math.PI / 2  // tip points in +Z
        head.position.z = 0.47
        g.add(shaft, head)
        return g
      }
      case WeaponType.FlameBreather: {
        // Nozzle: dark cylinder + glowing tip
        const g = new THREE.Group()
        const barrel = new THREE.Mesh(
          new THREE.CylinderGeometry(0.04, 0.04, 0.20, 8),
          new THREE.MeshToonMaterial({ color: 0x333333, gradientMap: gm }),
        )
        barrel.rotation.x = Math.PI / 2
        barrel.position.z = 0.10
        const tipMesh = new THREE.Mesh(
          new THREE.ConeGeometry(0.05, 0.08, 6),
          new THREE.MeshStandardMaterial({ color: 0xff6600, emissive: 0xff6600, emissiveIntensity: 0.6 }),
        )
        tipMesh.rotation.x = Math.PI / 2
        tipMesh.position.z = 0.24
        g.add(barrel, tipMesh)
        return g
      }
      case WeaponType.Glider: {
        // Folded wing flap
        const g = new THREE.Group()
        const wing = new THREE.Mesh(
          new THREE.PlaneGeometry(0.18, 0.10),
          new THREE.MeshToonMaterial({ color: 0x87ceeb, gradientMap: gm, transparent: true, opacity: 0.75, side: THREE.DoubleSide }),
        )
        wing.rotation.x = Math.PI / 6
        wing.position.z = 0.08
        g.add(wing)
        return g
      }
      case WeaponType.WebLauncher: {
        // Compact silk dispenser
        const g = new THREE.Group()
        const housing = new THREE.Mesh(
          new THREE.CylinderGeometry(0.05, 0.05, 0.10, 8),
          new THREE.MeshToonMaterial({ color: 0x777777, gradientMap: gm }),
        )
        housing.rotation.x = Math.PI / 2
        housing.position.z = 0.06
        const bead = new THREE.Mesh(
          new THREE.SphereGeometry(0.04, 8, 6),
          new THREE.MeshStandardMaterial({ color: 0xddeeff, emissive: 0x99bbff, emissiveIntensity: 0.5 }),
        )
        bead.position.z = 0.14
        g.add(housing, bead)
        return g
      }
      default:
        return null
    }
  }

  destroy(): void {
    for (const leg of this.legs) {
      this.threeScene.remove(leg.upper, leg.knee, leg.lower, leg.tip)
      leg.upper.geometry.dispose()
      leg.knee.geometry.dispose()
      leg.lower.geometry.dispose()
      leg.tip.geometry.dispose()
      ;(leg.upper.material as THREE.MeshToonMaterial).dispose()
      ;(leg.knee.material  as THREE.MeshStandardMaterial).dispose()
      ;(leg.lower.material as THREE.MeshStandardMaterial).dispose()
      ;(leg.tip.material   as THREE.MeshToonMaterial).dispose()
      // Dispose accent ring children parented to the knee
      for (const child of leg.knee.children) {
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose()
          ;(child.material as THREE.Material).dispose()
        }
      }
    }
    this.legs = []
    for (let i = 0; i < 8; i++) {
      const wm = this.weaponMeshes[i]
      if (!wm) continue
      this.threeScene.remove(wm)
      wm.traverse(obj => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry.dispose()
          ;(obj.material as THREE.Material).dispose()
        }
      })
    }
    this.weaponMeshes = Array(8).fill(null)
  }
}
