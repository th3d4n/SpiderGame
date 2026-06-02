import * as THREE from 'three'
import type { DenMaterials } from '../scenes/DenBuilder'
import { DEN_RADIUS } from './denScale'

export interface AntEntranceResult {
  group:       THREE.Group
  triggerX:    number          // player crosses this X → fire transitionTo('antColony')
  bridgeStart: THREE.Vector3
  mouthCenter: THREE.Vector3
  draftLight:  THREE.PointLight
}

// Local catenary silk line — mirrors DenBuilder's silkStrand but scale-aware.
function silkLine(
  a: THREE.Vector3, b: THREE.Vector3,
  mat: THREE.Material, sag: number, S: number,
  segs = 10,
): THREE.Mesh {
  const pts: THREE.Vector3[] = []
  for (let i = 0; i <= segs; i++) {
    const t = i / segs
    const p = new THREE.Vector3().lerpVectors(a, b, t)
    p.y    -= Math.sin(t * Math.PI) * sag
    pts.push(p)
  }
  return new THREE.Mesh(
    new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), segs, 0.02 * S, 5, false),
    mat,
  )
}

/**
 * Builds the full ant colony entrance on the WEST rim (angle = π, -X).
 * Replaces buildExitPortal() in HomeBaseScene3D.
 *
 * Returns triggerX: feed to checkExitLeft (playerX < triggerX → transition).
 * The value matches EXIT_TRIGGER_X = -50.5 from the scale refactor.
 */
export function buildAntColonyEntrance(
  mat:        DenMaterials,
  add:        (obj: THREE.Object3D) => void,
  denRadius = DEN_RADIUS,
): AntEntranceResult {
  const group = new THREE.Group()
  const S     = denRadius / 10.5   // scale relative to baseline

  // West-facing (angle = π = -X direction).
  // Matches HOME BASE exit: buildWalls() leaves panels 3+4 open at 135°–225°.
  const angle  = Math.PI
  const rimR   = denRadius * 0.98
  const center = new THREE.Vector3(Math.cos(angle) * rimR, 0, Math.sin(angle) * rimR)
  // center ≈ (-50.96, 0, 0)

  const throatLen = 14 * S

  // ── Throat: sloped tube receding west into the earth ───────────────────────
  // BackSide so we see the inner wall.
  // CLONED material — must not mutate shared mat.earthDark (used by mounds, wicks, etc.)
  const throatMat   = mat.earthDark.clone()
  throatMat.side    = THREE.BackSide
  const throat      = new THREE.Mesh(
    new THREE.CylinderGeometry(3.2 * S, 5.5 * S, throatLen, 24, 1, true),
    throatMat,
  )
  throat.rotation.z = Math.PI / 2        // lay horizontal (X axis)
  // Push center INTO the earth (west = more negative X)
  throat.position.copy(center)
  throat.position.x -= throatLen * 0.35
  throat.position.y  = 2.2 * S
  throat.rotation.x  = 0.18             // dip slightly downward into ground
  group.add(throat)

  // ── Depth disc: cold near-black shows the tunnel "goes somewhere" ──────────
  const deepGlow = new THREE.Mesh(
    new THREE.CircleGeometry(3.0 * S, 24),
    new THREE.MeshBasicMaterial({ color: 0x0a1420 }),
  )
  deepGlow.position.copy(center)
  deepGlow.position.x -= throatLen * 0.85  // deep in tunnel
  deepGlow.position.y  = 2.2 * S
  // Face east (toward den) — visible from inside the chamber
  deepGlow.lookAt(0, deepGlow.position.y, 0)
  group.add(deepGlow)

  // ── Draft light: cool glow just inside the mouth ───────────────────────────
  // Warm(den) → cool(tunnel) light gradient → eye reads "exit is here."
  const draft = new THREE.PointLight(0x4a7aaa, 2.2, 14 * S, 2)
  draft.position.copy(center)
  draft.position.x += throatLen * 0.15  // den-side of entrance mouth
  draft.position.y  = 2.5 * S
  group.add(draft)

  // ── Earthen lip around the mouth ───────────────────────────────────────────
  const lip = new THREE.Mesh(
    new THREE.TorusGeometry(5.0 * S, 1.1 * S, 8, 28),
    mat.rootWall,
  )
  lip.position.copy(center)
  lip.position.y = 2.2 * S
  lip.rotation.y = Math.PI / 2          // ring in YZ plane — face east
  lip.scale.set(1, 1.15, 1)
  lip.castShadow = lip.receiveShadow = true
  group.add(lip)

  // ── Exposed roots framing the mouth ───────────────────────────────────────
  for (let i = 0; i < 5; i++) {
    const a    = (i / 5) * Math.PI - Math.PI / 2
    const root = new THREE.Mesh(
      new THREE.TorusGeometry((2.2 + Math.random()) * S, 0.22 * S, 6, 12, Math.PI * 0.9),
      mat.rootWall,
    )
    root.position.copy(center)
    root.position.y  = (2.2 + Math.sin(a) * 3) * S
    root.position.z += Math.cos(a) * 3.5 * S
    root.rotation.set(Math.random() * 0.5, Math.PI / 2, a)
    root.castShadow = true
    group.add(root)
  }

  // ── Torn web curtain ─────────────────────────────────────────────────────
  // Half-shredded — the colony's last web before the attack.
  for (let i = 0; i < 7; i++) {
    const w      = (0.6 + Math.random() * 0.5) * S
    const h      = (3   + Math.random() * 4)   * S
    const strand = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat.silkTorn)
    strand.position.copy(center)
    strand.position.y   = 2.2 * S         // hang from top of entrance
    strand.position.z  += (i - 3) * 1.3 * S
    strand.position.x  += 0.5 * S         // lean toward den (east of center)
    strand.rotation.y   = Math.PI / 2     // face east — visible from den floor
    strand.rotation.z   = (Math.random() - 0.5) * 0.3
    group.add(strand)
  }

  // ── Silk web-bridge: taut walkway from den floor to the throat ────────────
  // Runs along -X (west). Obvious and inviting-but-dangerous.
  const bridgeStart = new THREE.Vector3(-denRadius * 0.62, 0.4 * S, 0)
  // Bridge ends at the den-facing (east) side of the throat mouth
  const mouthX      = center.x + throatLen * 0.15
  const bridgeEnd   = new THREE.Vector3(mouthX, 2.0 * S, 0)
  const walkLen     = bridgeStart.distanceTo(bridgeEnd)

  const walk = new THREE.Mesh(
    new THREE.PlaneGeometry(2.4 * S, walkLen, 1, 8),
    mat.silk,
  )
  walk.position.copy(bridgeStart).lerp(bridgeEnd, 0.5)
  walk.lookAt(bridgeEnd.x, bridgeEnd.y + 5 * S, bridgeEnd.z)
  walk.rotateX(Math.PI / 2)
  group.add(walk)

  // Guide cables north and south of the walkway
  const co = 1.2 * S
  group.add(silkLine(
    bridgeStart.clone().add(new THREE.Vector3(0, 1.0 * S,  co)),
    bridgeEnd.clone().add(  new THREE.Vector3(0, 1.0 * S,  co)),
    mat.silk, 0.4 * S, S,
  ))
  group.add(silkLine(
    bridgeStart.clone().add(new THREE.Vector3(0, 1.0 * S, -co)),
    bridgeEnd.clone().add(  new THREE.Vector3(0, 1.0 * S, -co)),
    mat.silk, 0.4 * S, S,
  ))

  // Warm bridge-start light — warm(den)→cool(tunnel) is the visual sentence
  const bridgeGlow = new THREE.PointLight(0xffaa55, 2.5, 10 * S, 2)
  bridgeGlow.position.copy(bridgeStart)
  bridgeGlow.position.y += 1.5 * S
  group.add(bridgeGlow)

  // ── Transition trigger ────────────────────────────────────────────────────
  // triggerX ≈ -50.5, matching EXIT_TRIGGER_X from the scale refactor.
  // HomeBaseScene3D stores this in this.exitTriggerX and checkExitLeft uses it.
  const triggerX = -(denRadius * 0.97)

  add(group)

  return {
    group,
    triggerX,
    bridgeStart,
    mouthCenter: center,
    draftLight:  draft,
  }
}
