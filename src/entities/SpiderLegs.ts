import * as THREE from 'three'
import { WeaponType } from '../systems/WeaponSystem'
import type { WeaponSystem } from '../systems/WeaponSystem'
import { WEAPON_COLORS } from '../config/WeaponData'

// ─── IK constants ─────────────────────────────────────────────────────────────
const UPPER_LEN = 0.55
const LOWER_LEN = 0.55

// ─── Gait constants ───────────────────────────────────────────────────────────
const STEP_DURATION  = 0.12   // seconds per step swing
const STEP_HEIGHT    = 0.18   // world units of arc lift
const STEP_THRESHOLD = 0.28   // distance before a foot triggers a step
const OVERSHOOT      = 0.18   // anticipatory plant ahead of anchor
// If a foot drifts this far from its anchor (e.g. after a sharp turn), snap it
// back immediately rather than waiting for the gait machine.
const SNAP_THRESHOLD = 0.85

// ─── Leg anchor data (body-local space) ──────────────────────────────────────
// Group A: R1, L2, R3, L4 (diagonal cross)
// Group B: L1, R2, L3, R4 (other diagonal)
const ANCHOR_DATA = [
  { i: 0, side: 'left',  group: 'B', root: [-0.25, 0.2,  0.3], anchor: [-0.9, 0,  0.7] },
  { i: 1, side: 'right', group: 'A', root: [ 0.25, 0.2,  0.3], anchor: [ 0.9, 0,  0.7] },
  { i: 2, side: 'left',  group: 'A', root: [-0.28, 0.15, 0.1], anchor: [-1.0, 0,  0.2] },
  { i: 3, side: 'right', group: 'B', root: [ 0.28, 0.15, 0.1], anchor: [ 1.0, 0,  0.2] },
  { i: 4, side: 'left',  group: 'B', root: [-0.28, 0.15,-0.1], anchor: [-1.0, 0, -0.2] },
  { i: 5, side: 'right', group: 'A', root: [ 0.28, 0.15,-0.1], anchor: [ 1.0, 0, -0.2] },
  { i: 6, side: 'left',  group: 'A', root: [-0.25, 0.2, -0.3], anchor: [-0.9, 0, -0.7] },
  { i: 7, side: 'right', group: 'B', root: [ 0.25, 0.2, -0.3], anchor: [ 0.9, 0, -0.7] },
] as const

// ─── Leg tier materials ───────────────────────────────────────────────────────
const TIER_COLORS = [0x8B6914, 0x777777, 0x505050, 0xC0C0C0] // wood, stone, iron, metal

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
interface LegAnim {
  elapsed:     number
  duration:    number
  facingX:     number
  facingZ:     number
  // Visual reach from body center — used to normalise per-leg thrust so every
  // leg's weapon tip lands at the same world point regardless of leg position.
  attackRange: number
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
  threeScene: THREE.Scene

  constructor(threeScene: THREE.Scene, gradientMap: THREE.Texture) {
    this.threeScene = threeScene
    this.gradientMap = gradientMap
    this.buildLegs()
  }

  private buildLegs(): void {
    const gm = this.gradientMap
    for (const d of ANCHOR_DATA) {
      // Three-part leg: organic upper (body color) → hinge sphere → bionic lower (tier/weapon)
      const upper = new THREE.Mesh(
        new THREE.CylinderGeometry(1, 1, 2, 8),
        new THREE.MeshToonMaterial({ color: 0x554488, gradientMap: gm }),  // body purple
      )
      const lower = new THREE.Mesh(
        new THREE.CylinderGeometry(1, 1, 2, 8),
        new THREE.MeshToonMaterial({ color: TIER_COLORS[0], gradientMap: gm }),
      )
      const knee = new THREE.Mesh(
        new THREE.SphereGeometry(0.08, 8, 6),
        new THREE.MeshToonMaterial({ color: 0x444444, gradientMap: gm }),  // metallic hinge
      )
      const tip = new THREE.Mesh(
        new THREE.SphereGeometry(0.09, 8, 6),
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
        rootOffset:   new THREE.Vector3(...d.root),
        anchorOffset: new THREE.Vector3(...d.anchor),
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
  triggerAnim(legIndex: number, durationSec: number, facingX: number, facingZ: number, attackRange = 1.0): void {
    if (legIndex < 0 || legIndex >= 8) return
    this.animStates[legIndex] = { elapsed: 0, duration: durationSec, facingX, facingZ, attackRange }
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

    // Animated legs are fully excluded from the gait machine this frame
    const activeAnims = this.animStates.map((s, i) => s !== null ? i : -1).filter(i => i >= 0)
    const animSet     = new Set(activeAnims)

    // Mark legs that have drifted too far from their anchor (non-animated only)
    for (const leg of this.legs) {
      if (animSet.has(leg.index)) { leg.wantsStep = false; leg.isStepping = false; continue }
      leg.wantsStep = !leg.isStepping && leg.footPos.distanceTo(leg.anchorWorld) > STEP_THRESHOLD
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

    // Snap correction — after a sharp turn all anchors shift at once.  Any planted
    // foot that ended up far from its new anchor (> SNAP_THRESHOLD) is moved
    // immediately so front legs stay at the front of the spider.
    for (const leg of this.legs) {
      if (animSet.has(leg.index) || leg.isStepping) continue
      if (leg.footPos.distanceTo(leg.anchorWorld) > SNAP_THRESHOLD) {
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
      const thrust = Math.sin(t * Math.PI)          // 0 → peak → 0
      const flen   = Math.hypot(anim.facingX, anim.facingZ) || 1
      const fx     = anim.facingX / flen
      const fz     = anim.facingZ / flen

      // All legs converge to the same central attack point: bodyPos + facing * attackRange.
      // This places the weapon tip directly ahead of the spider's eyes regardless of
      // which leg slot is used — lateral anchor offset is cancelled out so no weapon
      // ever appears shifted left/right off the attack axis.
      const ax = bodyPos.x + fx * anim.attackRange
      const az = bodyPos.z + fz * anim.attackRange
      leg.footPos.set(
        leg.anchorWorld.x + thrust * (ax - leg.anchorWorld.x),
        thrust * 0.4,
        leg.anchorWorld.z + thrust * (az - leg.anchorWorld.z),
      )

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
        // No weapon mesh: fall back to scaled tip sphere
        leg.tip.visible = true
        leg.tip.scale.setScalar(1.0 + thrust * 3.0)
      }
    }

    // Solve IK + position meshes + update colors + sync weapon meshes
    for (const leg of this.legs) {
      solveTwoBoneIK(leg.rootWorld, leg.footPos, UPPER_LEN, LOWER_LEN, leg.poleDir, this.kneePos)
      // Upper slightly thicker (organic), lower slimmer (bionic)
      positionCylinder(leg.upper, leg.rootWorld, this.kneePos, 0.048)
      positionCylinder(leg.lower, this.kneePos,  leg.footPos,  0.025)
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
      ;(leg.lower.material as THREE.MeshToonMaterial).color.setHex(lowerColor)

      // Sync weapon mesh when slot contents change; hide if not currently animating
      this.syncWeaponMesh(leg.index, weaponType)
      const wm = this.weaponMeshes[leg.index]
      if (wm && !this.animStates[leg.index]) wm.visible = false
    }
  }

  // Celebration pose — front two legs lift and reach forward while the rest stay planted.
  // Call in place of update() when Webbs3D.celebratingPose is true.
  //
  // Round 6 Issue 1 spec: 2-arg signature, body rotation is assumed snapped to face
  // the camera (Webbs3D.startCelebrationPose snaps rotation.y).
  updateCelebrationPose(bodyPos: THREE.Vector3, elapsedMs: number): void {
    // Compute root/anchor world positions using the body's current rotation.
    // We read the rotation indirectly via the legs' own root meshes; safer to
    // require the caller has updated the group rotation before this call.
    this.updateWorldVecs(bodyPos, 0)   // assume bodyRotY=0 (camera-facing snap)

    const tSec  = elapsedMs / 1000
    const bobY  = Math.sin(tSec * Math.PI * 2) * 0.08
    const liftY = 0.55 + bobY              // raised foot height
    const reachZ = bodyPos.z - 0.5         // forward in world -Z (toward camera view)
    const spread = 0.35

    for (const leg of this.legs) {
      if (leg.index === 6 || leg.index === 7) {
        // Anatomical front legs lifted and extended forward
        const side = (leg.index === 6) ? -1 : 1
        leg.footPos.set(bodyPos.x + side * spread, liftY, reachZ)
      } else {
        // Other six legs planted at their world-space rest position
        leg.footPos.copy(leg.anchorWorld)
        leg.footPos.y = 0
      }
      leg.isStepping = false
    }

    // Solve IK + update meshes for every leg
    for (const leg of this.legs) {
      solveTwoBoneIK(leg.rootWorld, leg.footPos, UPPER_LEN, LOWER_LEN, leg.poleDir, this.kneePos)
      positionCylinder(leg.upper, leg.rootWorld, this.kneePos, 0.048)
      positionCylinder(leg.lower, this.kneePos,  leg.footPos,  0.025)
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

      // Root: body-local, elevated by body mesh height (0.4) above group Y
      leg.rootWorld.set(
        bodyPos.x + r.x * cos - r.z * sin,
        bodyPos.y + r.y + 0.4,
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
      leg.stepTarget.x += moveDir.x * OVERSHOOT
      leg.stepTarget.z += moveDir.y * OVERSHOOT
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
        ? Math.sin(leg.stepT * Math.PI) * STEP_HEIGHT
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
      ;(leg.knee.material  as THREE.MeshToonMaterial).dispose()
      ;(leg.lower.material as THREE.MeshToonMaterial).dispose()
      ;(leg.tip.material   as THREE.MeshToonMaterial).dispose()
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
