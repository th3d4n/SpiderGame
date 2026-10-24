import * as THREE from 'three'
import { WeaponType } from '../systems/WeaponSystem'

// ─── Weapon models ────────────────────────────────────────────────────────────
// One set of models for everywhere a weapon is seen: on Webbs' leg tips, the
// discovery close-up, the discovery card and the UI thumbnails.  Built from the
// den's junk and bug parts, matching the item descriptions: chitin shards
// lashed with silk, a party toothpick, a recurve bow of webbing, a venom gland,
// silk wings, and the Web Thrower — a brass silk-spinner.
//
// Convention: a Group whose local +Z is "weapon forward", authored at Webbs
// scale 1 (lengths ≈ 0.45–0.6), origin at the grip.  Callers scale and add rim.

type GM = THREE.Texture | null

let _gm: THREE.Texture | null = null
// A 3-band toon ramp for callers outside the game scene (the card preview)
export function defaultToonGradient(): THREE.Texture {
  if (_gm) return _gm
  const t = new THREE.DataTexture(new Uint8Array([90, 90, 90, 255, 170, 170, 170, 255, 255, 255, 255, 255]), 3, 1)
  t.minFilter = t.magFilter = THREE.NearestFilter
  t.needsUpdate = true
  return (_gm = t)
}

const toon = (color: number, gm: GM, extra: THREE.MeshToonMaterialParameters = {}) =>
  new THREE.MeshToonMaterial({ color, gradientMap: gm ?? defaultToonGradient(), ...extra })
const glowMat = (color: number, intensity = 1.2) =>
  new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: intensity, roughness: 0.4 })
const metal = (color: number, rough = 0.35) =>
  new THREE.MeshStandardMaterial({ color, metalness: 0.75, roughness: rough })

const PAL = {
  chitin:     0x2c5a54,
  chitinEdge: 0x9fe3cf,
  bone:       0xe6d9bc,
  silk:       0xf2ebde,
  twig:       0x6e4a26,
  pick:       0xe3c890,
  brass:      0xc9a04a,
  darkMetal:  0x3a3c44,
  leather:    0x3b2618,
}

function mesh(geo: THREE.BufferGeometry, mat: THREE.Material, parent: THREE.Object3D): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat)
  m.castShadow = true
  parent.add(m)
  return m
}

// Flat shape → beveled slab lying face-up, shape-Y running along +Z
function slab(shape: THREE.Shape, depth: number, bevel: number): THREE.ExtrudeGeometry {
  const g = new THREE.ExtrudeGeometry(shape, {
    depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 10,
  })
  g.translate(0, 0, -depth / 2)
  g.rotateX(Math.PI / 2)        // shape y → +Z, thickness → Y
  return g
}

// Silk binding: a helix of thread around the Z axis
function wrap(r: number, z0: number, z1: number, turns: number, thread = 0.006): THREE.TubeGeometry {
  const pts: THREE.Vector3[] = []
  const n = Math.max(12, Math.round(turns * 14))
  for (let i = 0; i <= n; i++) {
    const t = i / n, a = t * turns * Math.PI * 2
    pts.push(new THREE.Vector3(Math.cos(a) * r, Math.sin(a) * r, z0 + (z1 - z0) * t))
  }
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), n * 2, thread, 4, false)
}

const alongZ = (g: THREE.BufferGeometry) => { g.rotateX(Math.PI / 2); return g }

// ── Shard Sword ───────────────────────────────────────────────────────────────
function sword(gm: GM, accent: number): THREE.Group {
  const g = new THREE.Group()
  // Blade: a long chitin shard with a slight hook toward the tip
  const s = new THREE.Shape()
  s.moveTo(-0.034, 0.06)
  s.bezierCurveTo(-0.05, 0.2, -0.045, 0.36, -0.012, 0.56)
  s.lineTo(0.004, 0.58)
  s.bezierCurveTo(0.04, 0.4, 0.06, 0.22, 0.034, 0.06)
  s.closePath()
  mesh(slab(s, 0.012, 0.007), toon(PAL.chitin, gm), g)
  // Pale ridge down the spine — reads as a polished edge from above
  const ridge = new THREE.Shape()
  ridge.moveTo(-0.006, 0.07); ridge.lineTo(-0.002, 0.5); ridge.lineTo(0.006, 0.5); ridge.lineTo(0.008, 0.07); ridge.closePath()
  const r = mesh(slab(ridge, 0.004, 0.002), toon(PAL.chitinEdge, gm, { emissive: PAL.chitinEdge, emissiveIntensity: 0.25 }), g)
  r.position.y = 0.012
  // Guard: two bone barbs swept forward
  for (const side of [-1, 1]) {
    const barb = mesh(new THREE.ConeGeometry(0.016, 0.11, 6), toon(PAL.bone, gm), g)
    barb.position.set(side * 0.06, 0, 0.065)
    barb.rotation.set(0, 0, -side * (Math.PI / 2 - 0.45))
  }
  const collar = mesh(alongZ(new THREE.CylinderGeometry(0.03, 0.026, 0.03, 10)), toon(PAL.bone, gm), g)
  collar.position.z = 0.05
  // Grip, silk-bound, and a pommel bead in the weapon's colour
  const grip = mesh(alongZ(new THREE.CylinderGeometry(0.017, 0.019, 0.11, 8)), toon(PAL.leather, gm), g)
  grip.position.z = -0.015
  mesh(wrap(0.02, -0.065, 0.035, 5), toon(PAL.silk, gm), g)
  const pommel = mesh(new THREE.SphereGeometry(0.026, 12, 8), metal(accent, 0.25), g)
  pommel.position.z = -0.08
  return g
}

// ── Chitin Axe ────────────────────────────────────────────────────────────────
function axe(gm: GM): THREE.Group {
  const g = new THREE.Group()
  const handle = mesh(alongZ(new THREE.CylinderGeometry(0.017, 0.023, 0.46, 7)), toon(PAL.twig, gm), g)
  handle.position.z = 0.17
  const knot = mesh(new THREE.SphereGeometry(0.018, 6, 5), toon(0x5a3a1c, gm), g)
  knot.position.set(-0.017, 0.004, 0.07)
  // Crescent head on the +X side, a short spike behind
  const c = new THREE.Shape()
  c.moveTo(0.015, 0.27)
  c.quadraticCurveTo(0.09, 0.27, 0.13, 0.2)
  c.quadraticCurveTo(0.2, 0.33, 0.13, 0.47)
  c.quadraticCurveTo(0.09, 0.4, 0.015, 0.41)
  c.closePath()
  mesh(slab(c, 0.018, 0.008), toon(PAL.chitin, gm), g)
  const edge = new THREE.Shape()
  edge.moveTo(0.13, 0.2); edge.quadraticCurveTo(0.2, 0.33, 0.13, 0.47); edge.quadraticCurveTo(0.175, 0.33, 0.13, 0.2)
  const e = mesh(slab(edge, 0.02, 0.004), toon(PAL.chitinEdge, gm, { emissive: PAL.chitinEdge, emissiveIntensity: 0.3 }), g)
  e.position.y = 0.002
  const spike = new THREE.Shape()
  spike.moveTo(-0.015, 0.31); spike.lineTo(-0.1, 0.345); spike.lineTo(-0.015, 0.37); spike.closePath()
  mesh(slab(spike, 0.014, 0.005), toon(PAL.bone, gm), g)
  // Silk lashing where head meets haft
  for (const z of [0.29, 0.34, 0.39]) {
    const ring = mesh(new THREE.TorusGeometry(0.025, 0.006, 5, 12), toon(PAL.silk, gm), g)
    ring.position.z = z
  }
  return g
}

// ── Toothpick Stabber (a party toothpick, frill and all) ──────────────────────
function toothpick(gm: GM): THREE.Group {
  const g = new THREE.Group()
  const shaft = mesh(alongZ(new THREE.CylinderGeometry(0.016, 0.016, 0.44, 8)), toon(PAL.pick, gm), g)
  shaft.position.z = 0.22
  const tip = mesh(alongZ(new THREE.ConeGeometry(0.016, 0.1, 8)), toon(0xf0dcae, gm), g)
  tip.position.z = 0.49
  const tail = mesh(alongZ(new THREE.ConeGeometry(0.016, 0.06, 8)), toon(PAL.pick, gm), g)
  tail.rotation.x = -Math.PI / 2; tail.position.z = -0.03
  mesh(wrap(0.019, 0.04, 0.13, 4), toon(PAL.silk, gm), g)
  // Cellophane frill at the back — it came off the party platter
  const frillCols = [0xff5d8f, 0x4fd1c5, 0xffd166, 0x9b7bff]
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2
    const strip = mesh(new THREE.BoxGeometry(0.016, 0.004, 0.11), new THREE.MeshStandardMaterial({
      color: frillCols[i % 4], emissive: frillCols[i % 4], emissiveIntensity: 0.35, roughness: 0.2, metalness: 0.3,
    }), g)
    // Fanned out backwards like a little starburst
    const out = new THREE.Vector3(Math.cos(a), Math.sin(a), -0.9).normalize()
    strip.position.set(0, 0, -0.03).addScaledVector(out, 0.055)
    strip.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), out)
  }
  return g
}

// ── Web Bow (recurve of silk-wound twig, a thistle arrow nocked) ──────────────
function bow(gm: GM, accent: number): THREE.Group {
  const g = new THREE.Group()
  const limb = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-0.27, 0, 0.02), new THREE.Vector3(-0.24, 0, 0.07), new THREE.Vector3(-0.15, 0, 0.11),
    new THREE.Vector3(0, 0, 0.13),
    new THREE.Vector3(0.15, 0, 0.11), new THREE.Vector3(0.24, 0, 0.07), new THREE.Vector3(0.27, 0, 0.02),
  ])
  mesh(new THREE.TubeGeometry(limb, 40, 0.015, 6, false), toon(accent, gm), g)
  // Recurve hooks at the tips
  for (const side of [-1, 1]) {
    const hook = mesh(new THREE.TorusGeometry(0.03, 0.011, 5, 10, Math.PI * 0.9), toon(accent, gm), g)
    hook.rotation.x = Math.PI / 2
    hook.rotation.z = side > 0 ? Math.PI * 1.05 : -Math.PI * 0.05
    hook.position.set(side * 0.255, 0, 0.0)
  }
  // Silk grip at the centre
  const grip = mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.07, 8), toon(PAL.silk, gm), g)
  grip.rotation.z = Math.PI / 2; grip.position.z = 0.13
  // String
  const str = mesh(new THREE.CylinderGeometry(0.003, 0.003, 0.54, 4), toon(0xffffff, gm, { emissive: 0xffffff, emissiveIntensity: 0.3 }), g)
  str.rotation.z = Math.PI / 2; str.position.z = -0.015
  // Arrow: shaft, silk fletching, spiky thistle head
  const shaft = mesh(alongZ(new THREE.CylinderGeometry(0.007, 0.007, 0.5, 5)), toon(0xb08850, gm), g)
  shaft.position.z = 0.22
  for (let i = 0; i < 3; i++) {
    const f = mesh(new THREE.PlaneGeometry(0.03, 0.06), toon(PAL.silk, gm, { side: THREE.DoubleSide }), g)
    f.position.z = 0.0
    f.rotation.set(0, 0, (i / 3) * Math.PI * 2)
    f.translateY(0.016)
    f.rotateX(Math.PI / 2)
  }
  const head = new THREE.Group(); head.position.z = 0.49; g.add(head)
  mesh(new THREE.IcosahedronGeometry(0.03, 0), toon(0x9b6bd6, gm), head)
  for (let i = 0; i < 10; i++) {
    const sp = mesh(new THREE.ConeGeometry(0.006, 0.05, 4), toon(0xd9b8ff, gm), head)
    const d = new THREE.Vector3().randomDirection(); if (d.z < -0.2) d.z = -d.z
    sp.position.copy(d).multiplyScalar(0.03)
    sp.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d)
  }
  return g
}

// ── Flame Breather (a venom gland with a fang nozzle) ─────────────────────────
function flame(gm: GM, accent: number): THREE.Group {
  const g = new THREE.Group()
  const sac = mesh(new THREE.SphereGeometry(0.085, 18, 14), new THREE.MeshStandardMaterial({
    color: 0xffa040, emissive: accent, emissiveIntensity: 0.35, transparent: true, opacity: 0.78, roughness: 0.25,
  }), g)
  sac.scale.set(1, 0.85, 1.15)
  const core = mesh(new THREE.SphereGeometry(0.045, 12, 10), glowMat(0xffd27a, 2.2), g)
  core.userData.pulse = 1.1
  for (const z of [-0.05, 0, 0.05]) {
    const rib = mesh(new THREE.TorusGeometry(0.086 * Math.cos(z * 7), 0.007, 5, 18), toon(PAL.chitin, gm), g)
    rib.position.z = z
  }
  const collar = mesh(alongZ(new THREE.CylinderGeometry(0.035, 0.05, 0.05, 10)), toon(PAL.chitin, gm), g)
  collar.position.z = 0.1
  // Curved fang nozzle (lathe) with a hot tip
  const prof = [new THREE.Vector2(0.032, 0), new THREE.Vector2(0.028, 0.06), new THREE.Vector2(0.02, 0.12), new THREE.Vector2(0.01, 0.17), new THREE.Vector2(0.002, 0.2)]
  const fang = mesh(new THREE.LatheGeometry(prof, 10), toon(PAL.bone, gm), g)
  fang.rotation.x = Math.PI / 2 + 0.25; fang.position.set(0, 0.0, 0.12)
  const hot = mesh(new THREE.SphereGeometry(0.014, 8, 6), glowMat(accent, 1.3), g)
  hot.position.set(0, -0.05, 0.31)
  return g
}

// ── Web Glider (silk wings on a twig spine) ───────────────────────────────────
function glider(gm: GM, accent: number): THREE.Group {
  const g = new THREE.Group()
  const spine = mesh(alongZ(new THREE.CylinderGeometry(0.01, 0.013, 0.3, 6)), toon(PAL.twig, gm), g)
  spine.position.z = 0.1
  const membrane = new THREE.MeshStandardMaterial({
    color: accent, emissive: accent, emissiveIntensity: 0.25, transparent: true, opacity: 0.62, side: THREE.DoubleSide, roughness: 0.3,
  })
  const veinMat = toon(PAL.silk, gm)
  // Two pairs of narrow dragonfly wings — fore pair swept forward, hind pair back
  const wings: Array<[rootZ: number, len: number, width: number, sweep: number]> = [
    [0.19, 0.32, 0.075, 0.28], [0.07, 0.27, 0.07, -0.3],
  ]
  for (const side of [-1, 1]) {
    for (const [rootZ, len, wd, sweep] of wings) {
      const w = new THREE.Shape()
      w.moveTo(0, 0)
      w.bezierCurveTo(len * 0.2, wd, len * 0.85, wd * 0.9, len, wd * 0.15)
      w.bezierCurveTo(len * 0.9, -wd * 0.6, len * 0.3, -wd * 0.7, 0, 0)
      const geo = new THREE.ShapeGeometry(w, 14)
      geo.rotateX(-Math.PI / 2)                    // shape XY → XZ (width toward −Z), face up
      const pivot = new THREE.Group()
      pivot.position.set(side * 0.012, 0.005, rootZ)
      // Point the wing out along (side·cos φ, 0, sin φ): φ > 0 sweeps it forward
      pivot.rotation.y = Math.atan2(-Math.sin(sweep), side * Math.cos(sweep))
      pivot.rotation.z = side * 0.1                // a slight dihedral
      g.add(pivot)
      mesh(geo, membrane, pivot)
      // Leading-edge vein and a centre vein
      for (const [ey, k] of [[wd * 0.75, 1], [0.0, 0.85]] as Array<[number, number]>) {
        const v = new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0.003, 0), new THREE.Vector3(len * 0.5 * k, 0.003, -ey), new THREE.Vector3(len * k, 0.003, -ey * 0.3)])
        mesh(new THREE.TubeGeometry(v, 10, 0.0045, 3, false), veinMat, pivot)
      }
    }
  }
  return g
}

// ── Web Launcher ("The Web Thrower"): a brass silk-spinner ────────────────────
// Muzzle (local) — where the silk line leaves the spinneret tip
export const WEB_LAUNCHER_MUZZLE = new THREE.Vector3(0, 0, 0.25)

function launcher(gm: GM): THREE.Group {
  const g = new THREE.Group()
  const brass = metal(PAL.brass, 0.3)
  // Canister body
  const prof = [
    new THREE.Vector2(0.0, -0.13), new THREE.Vector2(0.04, -0.125), new THREE.Vector2(0.058, -0.08),
    new THREE.Vector2(0.062, 0.0), new THREE.Vector2(0.05, 0.07), new THREE.Vector2(0.03, 0.1), new THREE.Vector2(0.0, 0.105),
  ]
  const body = mesh(new THREE.LatheGeometry(prof, 16), brass, g)
  body.rotation.x = Math.PI / 2
  for (const z of [-0.07, 0.03]) {
    const band = mesh(new THREE.TorusGeometry(0.06, 0.008, 6, 18), metal(PAL.darkMetal, 0.4), g)
    band.position.z = z
  }
  // Silk spool on top, thread wound round it, crank on the side
  const spool = new THREE.Group(); spool.position.set(0, 0.075, -0.04); g.add(spool)
  const drum = mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.07, 14), toon(PAL.silk, gm, { emissive: 0xd8d0ff, emissiveIntensity: 0.12 }), spool)
  drum.rotation.z = Math.PI / 2
  for (const x of [-0.04, 0.04]) {
    const fl = mesh(new THREE.CylinderGeometry(0.048, 0.048, 0.01, 16), brass, spool)
    fl.rotation.z = Math.PI / 2; fl.position.x = x
  }
  const windings = mesh(wrap(0.037, -0.03, 0.03, 7, 0.004), toon(0xffffff, gm), spool)
  windings.rotation.y = Math.PI / 2
  const crankArm = mesh(new THREE.BoxGeometry(0.008, 0.05, 0.012), metal(PAL.darkMetal), spool)
  crankArm.position.set(0.05, 0.02, 0)
  const knob = mesh(new THREE.SphereGeometry(0.012, 8, 6), toon(0x9c3b2a, gm), spool)
  knob.position.set(0.058, 0.045, 0)
  // Glowing silk reservoir vial on the flank
  const vial = mesh(alongZ(new THREE.CapsuleGeometry(0.022, 0.07, 4, 10)), new THREE.MeshStandardMaterial({
    color: 0xcfe0ff, transparent: true, opacity: 0.45, roughness: 0.05, metalness: 0.1,
  }), g)
  vial.position.set(0.072, 0.0, -0.01)
  const silkGlow = mesh(alongZ(new THREE.CapsuleGeometry(0.013, 0.06, 4, 8)), glowMat(0xa9c4ff, 1.8), g)
  silkGlow.position.copy(vial.position)
  silkGlow.userData.pulse = 0.55
  // Barrel and the spinneret: three spigots round a glowing silk bead
  const barrel = mesh(alongZ(new THREE.CylinderGeometry(0.016, 0.02, 0.12, 10)), metal(PAL.darkMetal, 0.35), g)
  barrel.position.z = 0.16
  const flare = mesh(alongZ(new THREE.CylinderGeometry(0.03, 0.017, 0.03, 12)), brass, g)
  flare.position.z = 0.225
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + Math.PI / 2
    const sp = mesh(alongZ(new THREE.ConeGeometry(0.009, 0.03, 6)), toon(PAL.bone, gm), g)
    sp.position.set(Math.cos(a) * 0.017, Math.sin(a) * 0.017, 0.25)
  }
  const bead = mesh(new THREE.SphereGeometry(0.012, 10, 8), glowMat(0xdfe8ff, 2.0), g)
  bead.position.copy(WEB_LAUNCHER_MUZZLE)
  bead.userData.pulse = 0.8
  return g
}

export function buildWeaponModel(type: WeaponType, gm: GM = null, accent?: number): THREE.Group | null {
  switch (type) {
    case WeaponType.Sword:         return sword(gm, accent ?? 0xc0c0c0)
    case WeaponType.Axe:           return axe(gm)
    case WeaponType.BoxingGloves:  return toothpick(gm)
    case WeaponType.Bow:           return bow(gm, accent ?? 0x8b6914)
    case WeaponType.FlameBreather: return flame(gm, accent ?? 0xff6600)
    case WeaponType.Glider:        return glider(gm, accent ?? 0x87ceeb)
    case WeaponType.WebLauncher:   return launcher(gm)
    default:                       return null
  }
}

// Gentle life for glowing parts (silk vial, gland core, spinneret bead)
export function pulseWeaponModel(root: THREE.Object3D, t: number): void {
  root.traverse(o => {
    const base = o.userData.pulse as number | undefined
    if (!base) return
    const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial
    m.emissiveIntensity = base * (0.75 + 0.25 * Math.sin(t * 4 + o.id))
  })
}

export function disposeModel(root: THREE.Object3D): void {
  root.traverse(o => {
    const m = o as THREE.Mesh
    if (!m.isMesh) return
    m.geometry.dispose()
    ;(Array.isArray(m.material) ? m.material : [m.material]).forEach(x => x.dispose())
  })
}
