import * as THREE from 'three'
import { addRim } from '../env/Materials'

// Cool silhouette rim for Webbs — matches his icy eye glow
export const WEBBS_RIM = { color: 0xa8d8ff, strength: 0.45 }
import { WeaponType } from '../systems/WeaponSystem'
import type { WeaponSystem } from '../systems/WeaponSystem'
import { WEAPON_COLORS } from '../config/WeaponData'

// ─── IK constants (base values; scaled per-instance by SpiderLegs.sc) ────────
const UPPER_LEN      = 0.55
const LOWER_LEN      = 0.55

// ─── Gait constants (distances are base values, × SpiderLegs.sc) ─────────────
// Fore/aft excursion budget: a mid leg reaches only ~0.55 (× sc) ahead/behind
// its anchor before the IK over-stretches.  Webbs covers ~5 body lengths/s, so at
// speed the gait must be RHYTHMIC — one group lifts as the other lands — keeping
// each foot within ±v·T/2 of its anchor.  At a walk it waits for real drift.
const STEP_TIME_SLOW = 0.17    // swing duration at a crawl (s)
const STEP_TIME_FAST = 0.10    // swing duration at full speed (s)
const SETTLE_TIME    = 0.20    // unhurried re-plant once standing still
const RUN_SPEED      = 5.4     // wu/s per unit scale — Webbs' top speed
const STEP_HEIGHT    = 0.16    // arc lift for a full-length step
const STEP_THRESHOLD = 0.20    // drift before a foot wants to step at a walk …
const STEP_THRESH_RUN = 0.05   // … shrinking to this at full speed (rhythmic alternation)
const SETTLE_THRESH  = 0.07    // drift worth tidying once stopped
const RESCUE_DIST    = 0.85    // drift that forces an emergency step (was a teleport)
const TELEPORT_DIST  = 1.40    // body jumped this far in a frame → re-seat all feet
const TURN_CARRY     = 0.55    // share of body yaw that pivots planted feet (spin-in-place slip)
const MAX_TILT       = 0.30    // rad — body pitch/roll clamp
const LEAN_PER_ACCEL = 0.0022  // rad per wu/s² (scale-normalised) of lean into acceleration
const ATTACK_LEAN    = 0.10    // rad lean toward an active strike

// ─── Leg anchor data (body-local, unscaled) ───────────────────────────────────
// 4L + 4R, anchored on the SIDES (±X) but with a WIDE fore-aft (±Z) fan so the
// four legs of each bank splay across a real arc: front legs reach forward, rear
// legs reach back. Without enough Z spread the bank collapses to a near-lateral
// line that foreshortens into a "stacked" clump at axis headings under the iso
// camera; the wide fan keeps all four legs visually distinct at every heading.
// Group A: R1, L2, R3, L4  |  Group B: L1, R2, L3, R4
const ANCHOR_DATA = [
  { i: 0, side: 'left',  group: 'B', root: [-0.18, 0.15,  0.34], anchor: [-0.62, 0,  0.72] },
  { i: 1, side: 'right', group: 'A', root: [ 0.18, 0.15,  0.34], anchor: [ 0.62, 0,  0.72] },
  { i: 2, side: 'left',  group: 'A', root: [-0.20, 0.12,  0.12], anchor: [-0.82, 0,  0.26] },
  { i: 3, side: 'right', group: 'B', root: [ 0.20, 0.12,  0.12], anchor: [ 0.82, 0,  0.26] },
  { i: 4, side: 'left',  group: 'B', root: [-0.20, 0.12, -0.12], anchor: [-0.82, 0, -0.26] },
  { i: 5, side: 'right', group: 'A', root: [ 0.20, 0.12, -0.12], anchor: [ 0.82, 0, -0.26] },
  { i: 6, side: 'left',  group: 'A', root: [-0.18, 0.15, -0.34], anchor: [-0.62, 0, -0.72] },
  { i: 7, side: 'right', group: 'B', root: [ 0.18, 0.15, -0.34], anchor: [ 0.62, 0, -0.72] },
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

// One fuzz texture for every leg of every rig.  Was one per leg, rebuilt on each
// zone change (the rig is rebuilt when creature scale changes) and never
// disposed: +8 GPU textures per trip.
let _legFuzz: THREE.DataTexture | null = null
function legFuzzTexture(): THREE.DataTexture {
  if (!_legFuzz) { _legFuzz = createFuzzyBodyTexture(); _legFuzz.userData.shared = true }
  return _legFuzz
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
  plant: THREE.Vector3         // gait-owned foot: planted, or mid-swing
  foot: THREE.Vector3          // final IK target (plant blended with any attack pose)
  anchorWorld: THREE.Vector3   // anchor on the floor, world space, this frame
  rootWorld: THREE.Vector3     // root on the (tilted) body, world space, this frame
  poleDir: THREE.Vector3       // knee bend direction (updated each frame)
  swinging: boolean
  swingT: number               // 0 → 1 progress through the current swing
  swingDur: number             // seconds for this swing (speed-dependent)
  swingH: number               // arc height for this swing (step-length dependent)
  stepStart: THREE.Vector3
  stepTarget: THREE.Vector3
  upper: THREE.Mesh  // organic segment: body color
  knee:  THREE.Mesh  // hinge joint sphere
  lower: THREE.Mesh  // bionic segment: tier/weapon color
  tip:   THREE.Mesh  // foot sphere: weapon color
}

type GroupId = 'A' | 'B'

// Body pose produced by the legs each frame — Webbs3D applies it to its group.
export interface BodyPose {
  y:     number   // world Y of the body group (floor under the feet + gait motion)
  pitch: number   // local X rotation (nose down = +)
  roll:  number   // local Z rotation (+X side up = +)
}

// ─── SpiderLegs ───────────────────────────────────────────────────────────────
export type SwingStyle = 'thrust' | 'sword' | 'axe' | 'stab' | 'spray'

// Live state of a weapon strike, for hit detection that follows the visible
// weapon: where the tip is now, where it was last frame, and how far through
// the swing it is (WeaponUseSystem3D decides which part of t is "active").
export interface Strike {
  style: SwingStyle
  t:     number
  x: number; y: number; z: number          // tip now (world)
  px: number; py: number; pz: number       // tip last frame
  dirX: number; dirZ: number               // swing facing (unit)
}

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

const clamp01    = (v: number) => Math.max(0, Math.min(1, v))
const smoothstep = (t: number) => t * t * (3 - 2 * t)

// Attack poses fade in from the walking stance and back out into it: 12% / 20%
// of the swing, but never quicker than 70 / 80 ms so short stabs don't pop.
function attackWeight(t: number, dur: number): number {
  const tin  = Math.min(0.40, Math.max(0.12, 0.07 / dur))
  const tout = Math.min(0.45, Math.max(0.20, 0.08 / dur))
  if (t < tin)      return smoothstep(t / tin)
  if (t > 1 - tout) return smoothstep((1 - t) / tout)
  return 1
}

export class SpiderLegs {
  private legs:         Leg[]   = []
  private animStates:   Array<LegAnim | null> = Array(8).fill(null)
  private kneePos       = new THREE.Vector3()
  private prevFoot:     THREE.Vector3[] = Array.from({ length: 8 }, () => new THREE.Vector3())
  private gradientMap:  THREE.Texture
  private currentTier   = 0
  private slotWeapons:  WeaponType[]              = Array(8).fill(WeaponType.Empty)
  private weaponMeshes: Array<THREE.Group | null> = Array(8).fill(null)

  // Body kinematics, estimated from the transform handed in each frame
  private lastBodyPos      = new THREE.Vector3()
  private lastBodyRotation = 0
  private velX = 0; private velZ = 0     // smoothed world velocity (wu/s)
  private accX = 0; private accZ = 0     // smoothed world acceleration (wu/s²)
  private yawRate   = 0                  // smoothed rad/s
  private stillTime = 0
  private lastGroup: GroupId | null = null
  private settled = new Set<GroupId>()   // groups already re-planted since stopping

  readonly pose: BodyPose = { y: 0, pitch: 0, roll: 0 }
  // 0..1 death curl: body sinks and rolls onto its side, feet draw in under it
  // (knees fold high — how a spider actually curls up).
  collapse = 0
  private bodyQuat  = new THREE.Quaternion()
  private bodyEuler = new THREE.Euler(0, 0, 0, 'YXZ')

  threeScene: THREE.Scene
  // Floor-height sampler — feet plant on the real terrain, not y=0.
  ground: (x: number, z: number) => number = () => 0
  // Fired when a tetrapod group lands while moving (footstep audio, dust).
  onStep: ((x: number, z: number) => void) | null = null

  // Per-instance scaled constants (multiplied by constructor `scale` param)
  private readonly sc:           number
  private readonly upperLen:     number
  private readonly lowerLen:     number
  private readonly rootHOff:     number   // body-height offset for root world Y
  private readonly maxLead:      number   // cap on anticipatory plant distance

  constructor(threeScene: THREE.Scene, gradientMap: THREE.Texture, scale = 1.0) {
    this.threeScene    = threeScene
    this.gradientMap   = gradientMap
    this.sc            = scale
    this.upperLen      = UPPER_LEN      * scale
    this.lowerLen      = LOWER_LEN      * scale
    this.rootHOff      = 0.32           * scale
    // Never plant further ahead than 0.40 — keeps the foot inside the leg's
    // working envelope even at top speed (see excursion budget above).
    this.maxLead       = 0.40 * scale
    this.buildLegs()
    for (const l of this.legs) for (const m of [l.upper, l.knee, l.lower, l.tip]) addRim(m, WEBBS_RIM)
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
          map: legFuzzTexture(),
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
        plant:        new THREE.Vector3(),
        foot:         new THREE.Vector3(),
        anchorWorld:  new THREE.Vector3(),
        rootWorld:    new THREE.Vector3(),
        poleDir:      new THREE.Vector3(),
        swinging:     false,
        swingT:       0,
        swingDur:     STEP_TIME_SLOW,
        swingH:       0,
        stepStart:    new THREE.Vector3(),
        stepTarget:   new THREE.Vector3(),
        upper, knee, lower, tip,
      })
    }
  }

  // Snap all feet to resting world positions — call once after placing the body.
  initFeetAt(bodyPos: THREE.Vector3, bodyRotY: number): void {
    this.updateAnchors(bodyPos.x, bodyPos.z, bodyRotY)
    for (const leg of this.legs) {
      leg.plant.copy(leg.anchorWorld)
      leg.foot.copy(leg.anchorWorld)
      leg.swinging = false
    }
    this.lastBodyPos.set(bodyPos.x, bodyPos.y, bodyPos.z)
    this.lastBodyRotation = bodyRotY
    this.velX = this.velZ = this.accX = this.accZ = this.yawRate = 0
    this.pose.y = this.ground(bodyPos.x, bodyPos.z)
    this.pose.pitch = this.pose.roll = 0
  }

  // Trigger a one-shot punch/thrust animation on a specific leg.
  // legIndex matches weapon slot (0-7). attackRange is the visual reach from body
  // centre — the weapon tip will always land at bodyPos + facing * attackRange.
  triggerAnim(legIndex: number, durationSec: number, facingX: number, facingZ: number, attackRange = 1.0, style: SwingStyle = 'thrust'): void {
    if (legIndex < 0 || legIndex >= 8) return
    this.animStates[legIndex] = { elapsed: 0, duration: durationSec, facingX, facingZ, attackRange, style }
  }

  strike(slot: number): Strike | null {
    const a = this.animStates[slot]
    if (!a) return null
    const f  = this.legs[slot].foot
    const p  = this.prevFoot[slot]
    const fl = Math.hypot(a.facingX, a.facingZ) || 1
    return {
      style: a.style, t: Math.min(1, a.elapsed / a.duration),
      x: f.x, y: f.y, z: f.z, px: p.x, py: p.y, pz: p.z,
      dirX: a.facingX / fl, dirZ: a.facingZ / fl,
    }
  }

  // Round 9 Issue 3 — convenience wrapper for weapon swings.  Per-style durations
  // match the visuals in attackPath().  attackRange = 1.1wu so the weapon tip
  // lands well in front of Webbs at the slam point.
  startWeaponSwing(legIndex: number, style: 'sword' | 'axe' | 'stab' | 'spray', facingX: number, facingZ: number): void {
    const dur = style === 'sword' ? 0.30
              : style === 'axe'   ? 0.40
              : style === 'stab'  ? 0.18
              :                     0.10
    this.triggerAnim(legIndex, dur, facingX, facingZ, 1.1, style)
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Main per-frame update — call after the body's XZ has been synced from physics.
  // Pipeline: kinematics → gait (plant feet) → body pose from feet → roots on the
  // posed body → attack blending → IK.  Webbs3D then applies `pose` to its group.
  // ─────────────────────────────────────────────────────────────────────────────
  update(delta: number, bodyPos: THREE.Vector3, bodyRotY: number, weaponSystem: WeaponSystem): void {
    const dt = Math.max(delta, 1e-4)
    const sc = this.sc

    // ── 1. Kinematics ───────────────────────────────────────────────────────────
    const jump = Math.hypot(bodyPos.x - this.lastBodyPos.x, bodyPos.z - this.lastBodyPos.z)
    if (jump > TELEPORT_DIST * sc) this.initFeetAt(bodyPos, bodyRotY)   // zone entry / respawn

    const instVx = (bodyPos.x - this.lastBodyPos.x) / dt
    const instVz = (bodyPos.z - this.lastBodyPos.z) / dt
    const kv  = Math.min(1, dt * 20)
    const pvx = this.velX, pvz = this.velZ
    this.velX += (instVx - this.velX) * kv
    this.velZ += (instVz - this.velZ) * kv
    const ka = Math.min(1, dt * 8)
    this.accX += ((this.velX - pvx) / dt - this.accX) * ka
    this.accZ += ((this.velZ - pvz) / dt - this.accZ) * ka
    const yawDelta = wrapAngle(bodyRotY - this.lastBodyRotation)
    this.yawRate += (yawDelta / dt - this.yawRate) * Math.min(1, dt * 15)
    this.lastBodyPos.set(bodyPos.x, bodyPos.y, bodyPos.z)
    this.lastBodyRotation = bodyRotY

    const speed  = Math.hypot(this.velX, this.velZ)
    const run    = clamp01(speed / (RUN_SPEED * sc))
    const moving = speed > 0.15 * sc || Math.abs(this.yawRate) > 0.8
    this.stillTime = moving ? 0 : this.stillTime + dt

    // ── 2. Pivot slip — planted feet drag a little with fast body turns ─────────
    // (The rest of a turn is taken up by stepping, so feet stay planted instead
    // of the whole leg set spinning rigidly with the body.)
    if (Math.abs(yawDelta) > 1e-4) {
      const a  = yawDelta * TURN_CARRY
      const rc = Math.cos(a), rs = Math.sin(a)
      for (const leg of this.legs) {
        if (leg.swinging) continue
        const lx = leg.plant.x - bodyPos.x
        const lz = leg.plant.z - bodyPos.z
        leg.plant.x = bodyPos.x + lx * rc + lz * rs
        leg.plant.z = bodyPos.z - lx * rs + lz * rc
      }
    }

    this.updateAnchors(bodyPos.x, bodyPos.z, bodyRotY)

    // ── 3. Gait — alternating tetrapod, speed-scaled ────────────────────────────
    const animSet = new Set<number>()
    for (let i = 0; i < 8; i++) if (this.animStates[i]) animSet.add(i)
    // Hard turns sweep the outer feet faster than the body travels, so turning
    // quickens and shortens the steps (a spider pivots with rapid little steps).
    const turn     = clamp01(Math.abs(this.yawRate) / 6)
    const stepTime = (STEP_TIME_SLOW + (STEP_TIME_FAST - STEP_TIME_SLOW) * run) * (1 - 0.3 * turn)
    const thresh   = moving
      ? (STEP_THRESHOLD + (STEP_THRESH_RUN - STEP_THRESHOLD) * Math.max(run, turn)) * sc
      : SETTLE_THRESH * sc
    if (moving) this.settled.clear()

    // Emergency re-plant (replaces the old visible teleport-snap)
    for (const leg of this.legs) {
      if (leg.swinging || animSet.has(leg.index)) continue
      if (this.drift(leg) > RESCUE_DIST * sc) this.startStep([leg], stepTime * 0.7, bodyRotY, moving)
    }

    const groupA  = this.legs.filter(l => l.group === 'A' && !animSet.has(l.index))
    const groupB  = this.legs.filter(l => l.group === 'B' && !animSet.has(l.index))
    const overlap = 0.10 * run   // a running group may lift just before the other plants
    const wants = (g: Leg[]): boolean => {
      if (!moving && this.stillTime < 0.08) return false   // let the body settle first
      let u = 0
      for (const l of g) if (!l.swinging) u = Math.max(u, this.drift(l) / thresh)
      return u >= 1
    }
    const progress = (g: Leg[]): number => {
      let p = 1
      for (const l of g) if (l.swinging) p = Math.min(p, l.swingT)
      return p
    }
    const tryStart = (g: Leg[], other: Leg[], id: GroupId): boolean => {
      if (g.some(l => l.swinging) || !wants(g) || progress(other) < 1 - overlap) return false
      // Strict alternation while walking; a group may repeat only when the other
      // group has nothing to fix (settle steps, one-sided drift).
      if (this.lastGroup === id && moving && wants(other)) return false
      // Standing still: each group tidies its stance once, then holds — no fidgeting.
      if (!moving && this.settled.has(id)) return false
      this.startStep(g, moving ? stepTime : SETTLE_TIME, bodyRotY, moving)
      this.lastGroup = id
      if (!moving) this.settled.add(id)
      return true
    }
    if (this.lastGroup === 'A') { if (!tryStart(groupB, groupA, 'B')) tryStart(groupA, groupB, 'A') }
    else                        { if (!tryStart(groupA, groupB, 'A')) tryStart(groupB, groupA, 'B') }

    let swingFrac = 0
    let landed = 0, landX = 0, landZ = 0
    for (const leg of this.legs) {
      if (!leg.swinging) continue
      this.advanceStep(leg, dt)
      swingFrac += Math.sin(leg.swingT * Math.PI) / 4   // ≈1 when a full group is mid-air
      if (!leg.swinging) { landed++; landX += leg.plant.x; landZ += leg.plant.z }
    }
    if (landed >= 2 && moving) this.onStep?.(landX / landed, landZ / landed)

    // ── 4. Body pose from the planted feet ──────────────────────────────────────
    // Terrain read from where the feet stand (a lifted foot contributes its
    // landing point, so a swing never raises or tips the body).
    const fy = (idx: number[]) => idx.reduce((s, i) => {
      const l = this.legs[i]
      return s + (l.swinging ? l.stepTarget.y : l.plant.y)
    }, 0) / idx.length
    const front = fy([0, 1]), back = fy([6, 7])
    const left  = fy([0, 2, 4, 6]), right = fy([1, 3, 5, 7])
    const feetY = fy([0, 1, 2, 3, 4, 5, 6, 7])
    const floorY = this.ground(bodyPos.x, bodyPos.z)
    const pitchTerrain = -Math.atan2(front - back, 1.44 * sc)
    const rollTerrain  =  Math.atan2(right - left, 1.5 * sc)

    // Lean into acceleration: nose dips accelerating forward, body leans toward a
    // sideways push.  Body-local axes: forward = (sin y, cos y), +X = (cos y, -sin y).
    const fwdX = Math.sin(bodyRotY), fwdZ = Math.cos(bodyRotY)
    const rgtX = Math.cos(bodyRotY), rgtZ = -Math.sin(bodyRotY)
    const aF = (this.accX * fwdX + this.accZ * fwdZ) / sc
    const aR = (this.accX * rgtX + this.accZ * rgtZ) / sc
    let pitch = pitchTerrain + aF * LEAN_PER_ACCEL
    let roll  = rollTerrain  - aR * LEAN_PER_ACCEL
    // Lean toward any active strike
    for (const anim of this.animStates) {
      if (!anim) continue
      const w  = attackWeight(Math.min(anim.elapsed / anim.duration, 1), anim.duration) * ATTACK_LEAN
      const fl = Math.hypot(anim.facingX, anim.facingZ) || 1
      pitch += w * (anim.facingX * fwdX + anim.facingZ * fwdZ) / fl
      roll  -= w * (anim.facingX * rgtX + anim.facingZ * rgtZ) / fl
    }
    pitch = Math.max(-MAX_TILT, Math.min(MAX_TILT, pitch))
    roll  = Math.max(-MAX_TILT, Math.min(MAX_TILT, roll))

    // Height: between the floor under the body and the feet, crouching a touch
    // when running and dipping while a group is airborne (less support).
    let targetY = floorY + (feetY - floorY) * 0.6
                  - 0.03 * sc * run
                  - 0.025 * sc * swingFrac * (0.4 + 0.6 * run)
    if (this.collapse > 0) {
      const c = this.collapse
      targetY += (floorY + 0.1 * sc - targetY) * c
      roll  += 0.5 * c
      pitch += 0.12 * c
    }
    const kp = Math.min(1, dt * 14)
    const kr = Math.min(1, dt * 10)
    this.pose.y     += (targetY - this.pose.y) * kp
    this.pose.pitch += (pitch - this.pose.pitch) * kr
    this.pose.roll  += (roll  - this.pose.roll)  * kr

    // ── 5. Roots on the posed body ──────────────────────────────────────────────
    this.bodyEuler.set(this.pose.pitch, bodyRotY, this.pose.roll, 'YXZ')
    this.bodyQuat.setFromEuler(this.bodyEuler)
    for (const leg of this.legs) {
      _sv1.set(leg.rootOffset.x, leg.rootOffset.y + this.rootHOff, leg.rootOffset.z).applyQuaternion(this.bodyQuat)
      leg.rootWorld.set(bodyPos.x + _sv1.x, this.pose.y + _sv1.y, bodyPos.z + _sv1.z)
    }

    // ── 6. Attack poses, blended over the gait foot ─────────────────────────────
    const maxR = (this.upperLen + this.lowerLen) * 0.95
    for (const leg of this.legs) this.prevFoot[leg.index].copy(leg.foot)
    for (const leg of this.legs) {
      const anim = this.animStates[leg.index]
      if (!anim) {
        // Reach safety: never let the gait foot stretch the leg past its length
        const dRF = leg.plant.distanceTo(leg.rootWorld)
        if (dRF > maxR) leg.plant.lerpVectors(leg.rootWorld, leg.plant, maxR / dRF)
        leg.foot.copy(leg.plant)
        continue
      }
      anim.elapsed += dt
      const t = Math.min(anim.elapsed / anim.duration, 1)
      const wMesh = this.weaponMeshes[leg.index]
      if (t >= 1) {
        this.animStates[leg.index] = null
        leg.tip.visible = true
        leg.tip.scale.setScalar(1.0)
        if (wMesh) wMesh.visible = false
        leg.foot.copy(leg.plant)
        continue
      }
      this.attackPath(leg, anim, t, bodyPos, floorY, _sv2)
      leg.foot.lerpVectors(leg.plant, _sv2, attackWeight(t, anim.duration))

      const flen = Math.hypot(anim.facingX, anim.facingZ) || 1
      if (wMesh) {
        // Show weapon mesh at the tip, oriented toward the attack direction
        wMesh.visible = true
        wMesh.position.copy(leg.foot)
        _sv1.set(anim.facingX / flen, 0, anim.facingZ / flen)
        _quat.setFromUnitVectors(_forwardZ, _sv1)
        wMesh.quaternion.copy(_quat)
        leg.tip.visible = false
      } else {
        // No weapon mesh: fall back to scaled tip sphere (sin-pulse t).
        leg.tip.visible = true
        leg.tip.scale.setScalar(1.0 + Math.sin(t * Math.PI) * 3.0)
      }
    }

    // Death curl: feet pulled in under the body and up to it
    if (this.collapse > 0) {
      for (const leg of this.legs) {
        _sv2.set(bodyPos.x + (leg.rootWorld.x - bodyPos.x) * 0.45,
                 this.pose.y + 0.04 * sc,
                 bodyPos.z + (leg.rootWorld.z - bodyPos.z) * 0.45)
        leg.foot.lerp(_sv2, this.collapse)
      }
    }

    // ── 7. IK + meshes + colors + weapons ───────────────────────────────────────
    for (const leg of this.legs) {
      // Knee bends outward and up; the lift grows with horizontal reach so wide
      // stances get the high arched knees of a real spider.
      const ox = leg.foot.x - bodyPos.x, oz = leg.foot.z - bodyPos.z
      leg.poleDir.set(ox, 0.6 * Math.hypot(ox, oz) + 0.3 * sc, oz).normalize()
      solveTwoBoneIK(leg.rootWorld, leg.foot, this.upperLen, this.lowerLen, leg.poleDir, this.kneePos)
      // Upper slightly thicker (organic), lower slimmer (bionic)
      positionCylinder(leg.upper, leg.rootWorld, this.kneePos, 0.048 * sc)
      positionCylinder(leg.lower, this.kneePos,  leg.foot,     0.025 * sc)
      leg.knee.position.copy(this.kneePos)
      leg.tip.position.copy(leg.foot)
      if (!this.animStates[leg.index]) leg.tip.position.y = leg.foot.y + 0.08 * sc

      const weaponType  = weaponSystem.getSlot(leg.index)
      const weaponColor = WEAPON_COLORS[weaponType] ?? 0x444444
      ;(leg.tip.material as THREE.MeshToonMaterial).color.setHex(weaponColor)
      // Lower = weapon color when equipped, tier color when empty
      const lowerColor = weaponType !== WeaponType.Empty
        ? weaponColor
        : TIER_COLORS[this.currentTier]
      ;(leg.lower.material as THREE.MeshStandardMaterial).color.setHex(lowerColor)

      // Weapon mesh stays visible at the foot at rest, pointing outward from the body.
      this.syncWeaponMesh(leg.index, weaponType)
      const wm = this.weaponMeshes[leg.index]
      if (wm && !this.animStates[leg.index]) {
        if (weaponType !== WeaponType.Empty) {
          wm.visible = true
          wm.position.copy(leg.foot)
          wm.position.y = leg.foot.y + 0.04 * sc
          const lw = Math.hypot(ox, oz)
          if (lw > 0.001) {
            _sv1.set(ox / lw, 0, oz / lw)
            _quat.setFromUnitVectors(_forwardZ, _sv1)
            wm.quaternion.copy(_quat)
          }
          leg.tip.visible = false
        } else {
          wm.visible = false
          leg.tip.visible = true
        }
      }
    }
  }

  // Style-specific weapon-tip path (world space) at progress t.  Every weapon
  // converges on one impact point in front of the body so the tip lands at the
  // same world location regardless of which leg-slot fired.
  private attackPath(leg: Leg, anim: LegAnim, t: number, bodyPos: THREE.Vector3, gy: number, out: THREE.Vector3): void {
    const hs   = this.sc
    const flen = Math.hypot(anim.facingX, anim.facingZ) || 1
    const fx   = anim.facingX / flen
    const fz   = anim.facingZ / flen
    if (anim.style === 'sword') {
      // Overhead slam: WINDUP up+back → SLAM down+forward → RETURN toward the stance foot.
      const ix = bodyPos.x + fx * anim.attackRange
      const iz = bodyPos.z + fz * anim.attackRange
      if (t < 0.30) {
        const wt = smoothstep(t / 0.30)
        out.set(bodyPos.x - fx * 0.25 * wt, gy + (0.05 + 0.85 * wt) * hs, bodyPos.z - fz * 0.25 * wt)
      } else if (t < 0.65) {
        const st  = (t - 0.30) / 0.35
        const ets = st * st                        // ease-in: slow rise then crash
        const sx  = bodyPos.x - fx * 0.25
        const sz  = bodyPos.z - fz * 0.25
        out.set(sx + (ix - sx) * ets, gy + (0.85 + (0.05 - 0.85) * ets) * hs, sz + (iz - sz) * ets)
      } else {
        const rt = smoothstep((t - 0.65) / 0.35)
        out.set(ix + (leg.plant.x - ix) * rt, gy + (0.05 + (1 - rt) * 0.15) * hs, iz + (leg.plant.z - iz) * rt)
      }
    } else if (anim.style === 'axe') {
      // Horizontal 180° sweep — foot arcs sideways at constant radius around body.
      const a = Math.atan2(fx, fz) - Math.PI / 2 + Math.PI * smoothstep(t)
      out.set(
        bodyPos.x + Math.sin(a) * anim.attackRange,
        gy + (0.20 + Math.sin(t * Math.PI) * 0.30) * hs,
        bodyPos.z + Math.cos(a) * anim.attackRange,
      )
    } else if (anim.style === 'stab') {
      // Quick lunge forward then back — fast out, slower recovery.
      const stabT = t < 0.4 ? smoothstep(t / 0.4) : 1 - smoothstep((t - 0.4) / 0.6)
      const d = anim.attackRange * 0.95 * stabT
      out.set(bodyPos.x + fx * d, gy + 0.10 * hs, bodyPos.z + fz * d)
    } else {
      // Default 'thrust' / 'spray' — fan out from the stance foot to the aim point.
      const thrust = Math.sin(t * Math.PI)
      const ax = bodyPos.x + fx * anim.attackRange
      const az = bodyPos.z + fz * anim.attackRange
      out.set(
        leg.plant.x + thrust * (ax - leg.plant.x),
        gy + thrust * 0.4 * hs,
        leg.plant.z + thrust * (az - leg.plant.z),
      )
    }
  }

  // Round 7 Issue 1 — three-phase celebration pose:
  //   T=0.0–0.3s : body rotates toward camera (Webbs3D drives bodyRotY)
  //   T=0.3–0.7s : the two front legs lift from the ground to peak height
  //   T=0.7s+    : legs hold the item up with a gentle bob
  updateCelebrationPose(bodyPos: THREE.Vector3, bodyRotY: number, camDirX: number, camDirZ: number, elapsedMs: number): void {
    const sc = this.sc
    this.updateAnchors(bodyPos.x, bodyPos.z, bodyRotY)

    const gy = this.ground(bodyPos.x, bodyPos.z)
    this.pose.y = gy
    this.pose.pitch = this.pose.roll = 0
    this.bodyEuler.set(0, bodyRotY, 0, 'YXZ')
    this.bodyQuat.setFromEuler(this.bodyEuler)
    for (const leg of this.legs) {
      _sv1.set(leg.rootOffset.x, leg.rootOffset.y + this.rootHOff, leg.rootOffset.z).applyQuaternion(this.bodyQuat)
      leg.rootWorld.set(bodyPos.x + _sv1.x, gy + _sv1.y, bodyPos.z + _sv1.z)
    }

    const liftT  = Math.max(0, Math.min((elapsedMs - 300) / 400, 1))
    const liftY  = gy + (0.05 + liftT * 0.55 + Math.sin(elapsedMs / 1000 * 2) * 0.04) * sc
    const reachX = bodyPos.x + liftT * 0.45 * sc * camDirX
    const reachZ = bodyPos.z + liftT * 0.45 * sc * camDirZ
    const rgtX = Math.cos(bodyRotY), rgtZ = -Math.sin(bodyRotY)   // body-local +X in world
    const spread = 0.3 * sc

    for (const leg of this.legs) {
      leg.plant.copy(leg.anchorWorld)    // every leg re-plants from its anchor afterwards
      leg.swinging = false
      if (leg.index <= 1) {
        // Front pair (L1 / R1) raise the item toward the camera
        const side = Math.sign(leg.anchorOffset.x)
        _sv2.set(reachX + rgtX * side * spread, liftY, reachZ + rgtZ * side * spread)
        leg.foot.lerpVectors(leg.anchorWorld, _sv2, smoothstep(liftT))
      } else {
        leg.foot.copy(leg.anchorWorld)   // anchorWorld.y is already the floor
      }
    }

    for (const leg of this.legs) {
      leg.poleDir.set(leg.foot.x - bodyPos.x, 0.6, leg.foot.z - bodyPos.z).normalize()
      solveTwoBoneIK(leg.rootWorld, leg.foot, this.upperLen, this.lowerLen, leg.poleDir, this.kneePos)
      positionCylinder(leg.upper, leg.rootWorld, this.kneePos, 0.048 * sc)
      positionCylinder(leg.lower, this.kneePos,  leg.foot,     0.025 * sc)
      leg.knee.position.copy(this.kneePos)
      leg.tip.position.copy(leg.foot)
      leg.tip.position.y = leg.foot.y + 0.08 * sc
    }
  }

  // Update leg tier → bionic lower segment color reflects tier on next update().
  setLegTier(tier: number): void {
    this.currentTier = Math.max(0, Math.min(3, tier))
  }

  get legTier(): number { return this.currentTier }

  // ── Private helpers ──────────────────────────────────────────────────────────

  // Horizontal distance from a foot's plant to where it would ideally stand.
  private drift(leg: Leg): number {
    return Math.hypot(leg.plant.x - leg.anchorWorld.x, leg.plant.z - leg.anchorWorld.z)
  }

  // World-space floor anchors for every leg, given the body XZ and yaw
  // (THREE yaw convention: local (x, z) → (x cos + z sin, −x sin + z cos)).
  private updateAnchors(bx: number, bz: number, rotY: number): void {
    const cos = Math.cos(rotY)
    const sin = Math.sin(rotY)
    for (const leg of this.legs) {
      const a   = leg.anchorOffset
      const awx = bx + a.x * cos + a.z * sin
      const awz = bz - a.x * sin + a.z * cos
      leg.anchorWorld.set(awx, this.ground(awx, awz), awz)
    }
  }

  // Lift `group` and swing each foot to where its anchor WILL be: the body's
  // travel during the swing, plus half a stance ahead (so the foot passes under
  // its anchor mid-stance), rotated by the predicted yaw.  Only the ahead-of-anchor
  // part is capped — capping the travel too made feet land already behind.
  private startStep(group: Leg[], dur: number, bodyRotY: number, moving: boolean): void {
    let lx = 0, lz = 0
    if (moving) {   // settle steps plant exactly on the anchor (no residual-velocity lead)
      let ax = this.velX * dur * 0.5, az = this.velZ * dur * 0.5
      const al = Math.hypot(ax, az)
      if (al > this.maxLead) { ax *= this.maxLead / al; az *= this.maxLead / al }
      lx = this.velX * dur + ax
      lz = this.velZ * dur + az
    }
    const yaw = bodyRotY + (moving ? this.yawRate * dur * 0.8 : 0)
    const cos = Math.cos(yaw), sin = Math.sin(yaw)
    for (const leg of group) {
      if (leg.swinging) continue
      const a  = leg.anchorOffset
      const tx = this.lastBodyPos.x + a.x * cos + a.z * sin + lx
      const tz = this.lastBodyPos.z - a.x * sin + a.z * cos + lz
      leg.stepStart.copy(leg.plant)
      leg.stepTarget.set(tx, this.ground(tx, tz), tz)
      const len = Math.hypot(tx - leg.plant.x, tz - leg.plant.z)
      leg.swingH   = STEP_HEIGHT * this.sc * Math.max(0.35, Math.min(1.2, len / (0.4 * this.sc)))
      leg.swingDur = dur
      leg.swingT   = 0
      leg.swinging = true
    }
  }

  // Ease the foot across (accelerate off the ground, decelerate into the plant)
  // with a lift that peaks early: snappy pick-up, soft set-down.
  private advanceStep(leg: Leg, dt: number): void {
    leg.swingT = Math.min(1, leg.swingT + dt / leg.swingDur)
    const t = leg.swingT
    leg.plant.lerpVectors(leg.stepStart, leg.stepTarget, smoothstep(t))
    if (t < 1) leg.plant.y += Math.sin(Math.PI * Math.pow(t, 0.75)) * leg.swingH
    else       leg.swinging = false
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
      addRim(mesh, WEBBS_RIM)
      mesh.scale.setScalar(this.sc)
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
