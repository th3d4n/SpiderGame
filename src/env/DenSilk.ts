import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { patchMaterial } from './Materials'

// ─── Den silk: the "a spider lives here" layer ────────────────────────────────
// Procedural web textures (canvas, drawn once) and the dressing built from them:
// orb webs on the far walls, sheet webs where floor meets wall, a woven silk mat
// under the family table, hanging draglines with dew, a pantry of wrapped food
// and a nursery of hatched egg sacs.
//
// Everything here is see-through silk: transparent with depthWrite off, so the
// ink-outline pass (depth-based) doesn't draw it as black wire, and it can never
// hide an item from the camera.  Same-material pieces are merged into one mesh.

export interface SilkMaterials {
  thread:    THREE.MeshBasicMaterial      // strands, cables, tethers
  drag:      THREE.MeshBasicMaterial      // fainter: the long hanging draglines
  webOrb:    THREE.MeshStandardMaterial   // vertical orb webs, tunnel seals
  webFloor:  THREE.MeshStandardMaterial   // orb pattern laid flat (the family mat)
  webSheet:  THREE.MeshStandardMaterial   // tangled sheet webs, bridges
  gauze:     THREE.MeshStandardMaterial   // woven silk: hammocks, wraps, sacs
  gauzeTorn: THREE.MeshStandardMaterial
  net:       THREE.MeshStandardMaterial   // the family hammocks
  netTorn:   THREE.MeshStandardMaterial
}

// Floor height at (x, z) — the den floor's displacement, so flat silk can hug it
export type FloorY = (x: number, z: number) => number

type Rand = () => number
function rng(seed: number): Rand {
  let s = seed >>> 0
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 }
}

// ── Textures ──────────────────────────────────────────────────────────────────

function canvasTex(size: number, draw: (g: CanvasRenderingContext2D, s: number) => void, tile = false): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = c.height = size
  draw(c.getContext('2d')!, size)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 4
  if (tile) t.wrapS = t.wrapT = THREE.RepeatWrapping
  return t
}

// Orb web: spokes, a polygonal capture spiral that sags between spokes, a dense
// hub, a few broken threads, frame lines to the edges and baked-in dew.
function drawOrb(g: CanvasRenderingContext2D, s: number, r: Rand): void {
  const cx = s * (0.5 + (r() - 0.5) * 0.05), cy = s * (0.48 + (r() - 0.5) * 0.05)
  const n = 26 + Math.floor(r() * 6)
  const ang: number[] = [], len: number[] = []
  for (let i = 0; i < n; i++) {
    ang.push(((i + (r() - 0.5) * 0.5) / n) * Math.PI * 2)
    len.push(s * (0.43 + r() * 0.05))
  }
  const at = (i: number, d: number): [number, number] =>
    [cx + Math.cos(ang[i]) * Math.min(d, len[i]), cy + Math.sin(ang[i]) * Math.min(d, len[i])]
  g.lineCap = 'round'
  g.strokeStyle = 'rgba(255,255,255,0.95)'

  // Frame threads from a few spoke tips out to the edge
  g.lineWidth = s / 420
  for (let k = 0; k < 6; k++) {
    const i = Math.floor(r() * n)
    const [x, y] = at(i, len[i])
    g.beginPath(); g.moveTo(x, y)
    g.lineTo(cx + Math.cos(ang[i]) * s * 0.75, cy + Math.sin(ang[i]) * s * 0.75); g.stroke()
  }
  // Spokes
  g.lineWidth = s / 520
  for (let i = 0; i < n; i++) {
    const [x, y] = at(i, len[i])
    g.beginPath(); g.moveTo(cx, cy); g.lineTo(x, y); g.stroke()
  }
  // Capture spiral (with a free zone between it and the hub)
  g.lineWidth = s / 700
  const turns = 30, r0 = s * 0.085, r1 = s * 0.42, steps = turns * n
  for (let k = 0; k < steps; k++) {
    if (r() < 0.035) continue                       // broken thread
    const i = k % n, j = (k + 1) % n
    const d0 = r0 + (r1 - r0) * (k / steps), d1 = r0 + (r1 - r0) * ((k + 1) / steps)
    if (d0 > len[i] || d1 > len[j]) continue
    const [x0, y0] = at(i, d0), [x1, y1] = at(j, d1)
    const mx = (x0 + x1) / 2, my = (y0 + y1) / 2
    const sag = 0.06                                 // threads bow toward the hub
    g.beginPath(); g.moveTo(x0, y0)
    g.quadraticCurveTo(mx + (cx - mx) * sag, my + (cy - my) * sag, x1, y1); g.stroke()
  }
  // Hub
  g.lineWidth = s / 600
  for (let k = 0; k < 6 * n; k++) {
    const i = k % n, j = (k + 1) % n
    const [x0, y0] = at(i, s * (0.008 + 0.042 * k / (6 * n)))
    const [x1, y1] = at(j, s * (0.008 + 0.042 * (k + 1) / (6 * n)))
    g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke()
  }
  // Dew beads strung along the spiral
  g.fillStyle = 'rgba(255,255,255,1)'
  for (let k = 0; k < 110; k++) {
    const i = Math.floor(r() * n), d = r0 + r() * (r1 - r0)
    const [x, y] = at(i, d)
    g.beginPath(); g.arc(x, y, s * (0.0018 + r() * 0.0022), 0, Math.PI * 2); g.fill()
  }
}

// Sheet web: an irregular tangle, densest in the middle and fading at the rim
function drawSheet(g: CanvasRenderingContext2D, s: number, r: Rand): void {
  const c = s / 2, R = s * 0.47
  const haze = g.createRadialGradient(c, c, 0, c, c, R)
  haze.addColorStop(0, 'rgba(255,255,255,0.16)')
  haze.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = haze; g.fillRect(0, 0, s, s)
  g.lineCap = 'round'
  for (let k = 0; k < 1600; k++) {
    const a = r() * Math.PI * 2, d = Math.sqrt(r()) * R
    const x = c + Math.cos(a) * d, y = c + Math.sin(a) * d
    const b = r() * Math.PI * 2, l = s * (0.02 + r() * 0.07)
    const f = 1 - d / R
    g.strokeStyle = `rgba(255,255,255,${(0.15 + 0.6 * f).toFixed(3)})`
    g.lineWidth = (s / 1400) * (1 + r() * 0.6)
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(b) * l * f, y + Math.sin(b) * l * f); g.stroke()
  }
  // A few long guy-lines out to the rim
  g.lineWidth = s / 650
  g.strokeStyle = 'rgba(255,255,255,0.55)'
  for (let k = 0; k < 14; k++) {
    const a = r() * Math.PI * 2
    g.beginPath(); g.moveTo(c + Math.cos(a) * R * 0.15, c + Math.sin(a) * R * 0.15)
    g.lineTo(c + Math.cos(a) * R * 0.98, c + Math.sin(a) * R * 0.98); g.stroke()
  }
}

// Woven silk: a soft base film crossed by fibres; tiles seamlessly
function drawGauze(g: CanvasRenderingContext2D, s: number, r: Rand): void {
  g.fillStyle = 'rgba(255,255,255,0.2)'; g.fillRect(0, 0, s, s)
  g.lineCap = 'round'
  for (let k = 0; k < 520; k++) {
    const x = r() * s, y = r() * s
    const a = (r() < 0.5 ? 0.6 : -0.6) + (r() - 0.5) * 0.9
    const l = s * (0.08 + r() * 0.3)
    g.strokeStyle = `rgba(255,255,255,${(0.35 + r() * 0.55).toFixed(3)})`
    g.lineWidth = (s / 420) * (0.6 + r())
    for (const ox of [-s, 0, s]) for (const oy of [-s, 0, s]) {
      g.beginPath(); g.moveTo(x + ox, y + oy)
      g.lineTo(x + ox + Math.cos(a) * l, y + oy + Math.sin(a) * l); g.stroke()
    }
  }
}

// Hammock net: a faint film under a diamond lattice of threads, with a heavier
// rope edge.  Not tiled — the whole texture spans one hammock.
function drawNet(g: CanvasRenderingContext2D, s: number, r: Rand): void {
  g.fillStyle = 'rgba(255,255,255,0.1)'; g.fillRect(0, 0, s, s)
  g.lineCap = 'round'
  const cells = 14, step = s / cells
  for (const dir of [1, -1]) {
    for (let k = -cells; k <= cells * 2; k++) {
      g.strokeStyle = `rgba(255,255,255,${(0.6 + r() * 0.35).toFixed(3)})`
      g.lineWidth = s / 260
      g.beginPath()
      for (let t = 0; t <= 1.0001; t += 0.1) {
        const x = k * step + t * s * dir, y = t * s + Math.sin(t * 9 + k) * step * 0.06
        if (t === 0) g.moveTo(x, y); else g.lineTo(x, y)
      }
      g.stroke()
    }
  }
  g.strokeStyle = 'rgba(255,255,255,0.95)'
  g.lineWidth = s / 55
  g.strokeRect(s / 110, s / 110, s - s / 55, s - s / 55)
}

function webMat(map: THREE.Texture, opacity: number, glow: number): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({
    color: 0xf4efe6, map, emissive: 0xe8dfcf, emissiveMap: map, emissiveIntensity: glow,
    transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide,
    roughness: 0.55, metalness: 0,
  })
  m.userData.noRim = true
  patchMaterial(m, { nearFade: NEAR_FADE })
  return m
}

// The close play camera sits ~20 wu from Webbs at roughly the height of the
// ceiling cables, so silk fades out inside ~16 wu instead of crossing the lens.
const NEAR_FADE: [number, number] = [8, 16]

export function createSilkMaterials(lowQuality: boolean): SilkMaterials {
  const big = lowQuality ? 512 : 1024
  const orbTex   = canvasTex(big, (g, s) => drawOrb(g, s, rng(7)))
  const floorTex = canvasTex(big, (g, s) => drawOrb(g, s, rng(31)))
  const sheetTex = canvasTex(big, (g, s) => drawSheet(g, s, rng(13)))
  const gauzeTex = canvasTex(512, (g, s) => drawGauze(g, s, rng(5)), true)
  const netTex   = canvasTex(512, (g, s) => drawNet(g, s, rng(9)))
  gauzeTex.repeat.set(2, 2)
  const thread = new THREE.MeshBasicMaterial({
    color: 0xeae2d2, transparent: true, opacity: 0.45, depthWrite: false,
  })
  thread.userData.noRim = true
  const drag = thread.clone()
  drag.opacity = 0.3
  patchMaterial(thread, { nearFade: NEAR_FADE })
  patchMaterial(drag, { nearFade: NEAR_FADE })
  return {
    thread, drag,
    webOrb:    webMat(orbTex, 0.9, 0.4),
    webFloor:  webMat(floorTex, 0.55, 0.22),
    webSheet:  webMat(sheetTex, 0.65, 0.3),
    gauze:     webMat(gauzeTex, 0.88, 0.3),
    gauzeTorn: webMat(gauzeTex, 0.6, 0.18),
    net:       webMat(netTex, 0.95, 0.32),
    netTorn:   webMat(netTex, 0.6, 0.2),
  }
}

// ── Geometry helpers ──────────────────────────────────────────────────────────

// Catenary thread between two points, as a 3-sided tube (cheap, merges well)
export function threadGeo(a: THREE.Vector3, b: THREE.Vector3, sag: number, radius = 0.05, segs = 10): THREE.BufferGeometry {
  const pts: THREE.Vector3[] = []
  for (let i = 0; i <= segs; i++) {
    const t = i / segs
    const p = new THREE.Vector3().lerpVectors(a, b, t)
    p.y -= Math.sin(t * Math.PI) * sag
    pts.push(p)
  }
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), segs, radius, 3, false)
}

// A flat square of web draped over the floor (world-space, ready to merge)
function floorPatch(x: number, z: number, size: number, rot: number, lift: number, floorY: FloorY): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(size, size, 12, 12)
  g.rotateX(-Math.PI / 2)
  g.rotateY(rot)
  g.translate(x, 0, z)
  const pos = g.attributes.position as THREE.BufferAttribute
  for (let i = 0; i < pos.count; i++) pos.setY(i, floorY(pos.getX(i), pos.getZ(i)) + lift)
  g.computeVertexNormals()
  return g
}

function merged(geos: THREE.BufferGeometry[], mat: THREE.Material): THREE.Mesh {
  const m = new THREE.Mesh(mergeGeometries(geos), mat)
  for (const g of geos) g.dispose()
  m.userData.noOcclude = true   // see-through already; never a camera occluder
  m.castShadow = false
  return m
}

const polar = (deg: number, r: number): [number, number] =>
  [Math.cos(deg * Math.PI / 180) * r, Math.sin(deg * Math.PI / 180) * r]

// ── The dressing ──────────────────────────────────────────────────────────────
// Placement notes: the iso camera looks from +X+Z, so walls at ~200°–340° face
// it and show their webs; the west exit (153°–207°) and the blocked tunnels
// (29°, 89°, 261°, 318°, which get web seals in DenBuilder) are left clear.
export function buildDenSilk(m: SilkMaterials, floorY: FloorY, add: (o: THREE.Object3D) => void): THREE.Group {
  const group = new THREE.Group()
  const r = rng(101)
  const threads: THREE.BufferGeometry[] = []
  const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z)

  // Orb webs strung between the wall mounds
  const orbs: Array<[deg: number, size: number, y: number]> = [
    [125, 13, 6.5], [222, 14, 7.0], [238, 10, 4.8], [290, 13, 6.8], [340, 12, 6.2], [60, 11, 6.0],
  ]
  const orbGeos: THREE.BufferGeometry[] = []
  for (const [deg, size, y] of orbs) {
    const [x, z] = polar(deg, 44)
    const g = new THREE.PlaneGeometry(size, size)
    const o = new THREE.Object3D()
    o.position.set(x, y, z)
    o.lookAt(0, y * 0.6, 0)                         // face the room, tipped back a touch
    o.rotateZ((r() - 0.5) * 0.6)
    o.updateMatrix()
    g.applyMatrix4(o.matrix)
    orbGeos.push(g)
    // Anchor lines from the web's lower corners down to the floor
    for (const side of [-1, 1]) {
      const p = v(-size * 0.42 * side, -size * 0.38, 0).applyMatrix4(o.matrix)
      const [fx, fz] = [p.x * 0.93, p.z * 0.93]
      threads.push(threadGeo(p, v(fx, floorY(fx, fz), fz), 0.2))
    }
  }
  group.add(merged(orbGeos, m.webOrb))

  // Sheet webs where the floor meets the wall, plus a few patches mid-room
  const sheets: THREE.BufferGeometry[] = []
  for (const [deg, rad, size] of [
    [100, 41, 16], [135, 40, 15], [215, 41, 17], [250, 40, 14], [300, 41, 16], [330, 39, 14],
    [20, 40, 15], [65, 40, 13], [235, 27, 9], [-10, 26, 8], [110, 24, 8],
  ] as Array<[number, number, number]>) {
    const [x, z] = polar(deg, rad)
    sheets.push(floorPatch(x, z, size, r() * Math.PI, 0.12, floorY))
  }
  group.add(merged(sheets, m.webSheet))

  // The family's silk mat — an orb pattern woven flat under the table and stools
  const mat = merged([floorPatch(0, 0, 25, 0.4, 0.06, floorY)], m.webFloor)
  mat.renderOrder = -1                               // under the drag marks and confetti
  group.add(mat)

  // Draglines from above — some anchored to the floor, some ending in a dewdrop
  const dew: THREE.Vector3[] = []
  const drags: THREE.BufferGeometry[] = []
  for (let k = 0; k < 20; k++) {
    const a = r() * Math.PI * 2, d = 10 + r() * 34
    const x = Math.cos(a) * d, z = Math.sin(a) * d
    const top = v(x + (r() - 0.5) * 2, 26, z + (r() - 0.5) * 2)
    const anchored = r() < 0.4
    const endY = anchored ? floorY(x, z) : 2.5 + r() * 7
    drags.push(threadGeo(top, v(x, endY, z), 0, 0.028, 4))
    if (!anchored) dew.push(v(x, endY - 0.08, z))
  }

  // Pantry: food wrapped in silk, hung from a line in front of the north tunnel
  const wraps: THREE.BufferGeometry[] = []
  const pa = v(-2, 10, -30), pb = v(11, 9.5, -27)
  threads.push(threadGeo(pa, pb, 1.6, 0.06))
  threads.push(threadGeo(pa, v(-2.5, floorY(-2.5, -32), -32), 0.1, 0.05))
  threads.push(threadGeo(pb, v(11.5, floorY(11.5, -29), -29), 0.1, 0.05))
  for (const [t, len, rad] of [[0.18, 2.6, 0.75], [0.4, 3.2, 0.95], [0.62, 2.2, 0.65], [0.82, 2.8, 0.8]]) {
    const hook = new THREE.Vector3().lerpVectors(pa, pb, t)
    hook.y -= Math.sin(t * Math.PI) * 1.6
    const cy = hook.y - 1.4 - len / 2
    threads.push(threadGeo(hook, v(hook.x, cy + len / 2 + rad * 0.8, hook.z), 0, 0.04, 3))
    const tilt = (r() - 0.5) * 0.25
    const g = new THREE.CapsuleGeometry(rad, len, 4, 10)
    g.rotateZ(tilt)
    g.translate(hook.x, cy, hook.z)
    wraps.push(g)
    // The wrapping thread, spiralled round the bundle
    const helix: THREE.Vector3[] = []
    for (let i = 0; i <= 60; i++) {
      const t = i / 60, a = t * Math.PI * 2 * 5
      const pinch = Math.sin(Math.min(1, Math.min(t, 1 - t) * 6) * Math.PI / 2)   // closes in at the ends
      helix.push(v(Math.cos(a) * rad * 1.03 * (0.55 + 0.45 * pinch), (t - 0.5) * (len + rad * 1.4), Math.sin(a) * rad * 1.03 * (0.55 + 0.45 * pinch)))
    }
    const wrap = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(helix), 120, 0.045, 3, false)
    wrap.rotateZ(tilt)
    wrap.translate(hook.x, cy, hook.z)
    threads.push(wrap)
  }

  // Nursery: a cluster of hatched egg sacs tucked against the north-west wall
  for (const [dx, dz, rad] of [[0, 0, 1.4], [2.2, 0.9, 1.1], [0.9, 2.1, 1.0], [-1.6, 1.4, 0.85]]) {
    const [bx, bz] = polar(232, 37)
    const x = bx + dx, z = bz + dz
    // Opened at the top (thetaStart) — the little ones are out
    const open = 0.55 + r() * 0.3
    const g = new THREE.SphereGeometry(rad, 14, 10, 0, Math.PI * 2, open, Math.PI - open)
    g.scale(1, 1.15, 1)
    g.translate(x, floorY(x, z) + rad * 1.0, z)
    wraps.push(g)
    // Each is tethered to the wall behind it
    const [wx, wz] = polar(232, 44)
    threads.push(threadGeo(v(x, floorY(x, z) + rad * 1.6, z), v(wx + dx * 0.5, floorY(wx, wz) + 1.5 + r() * 1.5, wz + dz * 0.5), 0.5, 0.04))
  }
  group.add(merged(wraps, m.gauze))

  group.add(merged(threads, m.thread))
  group.add(merged(drags, m.drag))

  // Dewdrops: tiny bright beads at the ends of the hanging lines
  if (dew.length) {
    const beads = new THREE.InstancedMesh(
      new THREE.SphereGeometry(1, 6, 4),
      new THREE.MeshBasicMaterial({ color: 0xfff4dc, transparent: true, opacity: 0.9, depthWrite: false }),
      dew.length,
    )
    const mtx = new THREE.Matrix4()
    dew.forEach((p, i) => { const s = 0.09 + r() * 0.06; beads.setMatrixAt(i, mtx.makeScale(s, s * 1.2, s).setPosition(p)) })
    beads.userData.noOcclude = true
    group.add(beads)
  }

  add(group)
  return group
}
