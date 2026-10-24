import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { surface, addRim } from './Materials'

// ─── Props ────────────────────────────────────────────────────────────────────
// Hand-modelled (procedural) versions of the things the player interacts with:
// material pickups, the birthday card, the gift, the toothpick, the workbench
// and the colony's chests.  Everything is built around the origin in the same
// footprint as the old placeholder boxes, so colliders, interaction radii and
// the den's glint system keep working; scenes just position the group.
//
// Idle motion (bob/spin/pulse) is registered per object and driven by
// tickProps() from the game loop; objects removed from the scene drop out.

type Anim = (t: number) => void
const animated = new Map<THREE.Object3D, Anim>()
function animate(obj: THREE.Object3D, fn: Anim): void { animated.set(obj, fn) }

export function tickProps(t: number): void {
  for (const [obj, fn] of animated) {
    if (!obj.parent) { animated.delete(obj); continue }   // removed/disposed
    fn(t)
  }
}

const toon = (color: number, gm: THREE.Texture, extra: THREE.MeshToonMaterialParameters = {}) =>
  new THREE.MeshToonMaterial({ color, gradientMap: gm, ...extra })

const glowing = (color: number, gm: THREE.Texture, intensity = 0.6) =>
  toon(color, gm, { emissive: new THREE.Color(color), emissiveIntensity: intensity })

function mesh(geo: THREE.BufferGeometry, mat: THREE.Material | THREE.Material[], shadow = true): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat)
  m.castShadow = shadow
  return m
}

// Soft round glow sprite (shared texture)
let _glowTex: THREE.CanvasTexture | null = null
function glowTexture(): THREE.CanvasTexture {
  if (_glowTex) return _glowTex
  const c = document.createElement('canvas'); c.width = c.height = 64
  const g = c.getContext('2d')!
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32)
  grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.35, 'rgba(255,255,255,.45)'); grd.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = grd; g.fillRect(0, 0, 64, 64)
  _glowTex = new THREE.CanvasTexture(c)
  _glowTex.userData.shared = true
  return _glowTex
}
function glowSprite(color: number, size: number, opacity = 0.6): THREE.Sprite {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTexture(), color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending,
  }))
  s.scale.setScalar(size)
  return s
}

// Vertical alpha ramp for light shafts: bright at the base, gone at the top
let _beamTex: THREE.CanvasTexture | null = null
function beamFade(): THREE.CanvasTexture {
  if (_beamTex) return _beamTex
  const c = document.createElement('canvas'); c.width = 4; c.height = 64
  const g = c.getContext('2d')!
  const grd = g.createLinearGradient(0, 64, 0, 0)   // cylinder UV v: 0 bottom → 1 top
  grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.5, 'rgba(255,255,255,.35)'); grd.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = grd; g.fillRect(0, 0, 4, 64)
  _beamTex = new THREE.CanvasTexture(c)
  _beamTex.userData.shared = true
  return _beamTex
}

function groundRing(color: number, r0: number, r1: number, opacity: number): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.RingGeometry(r0, r1, 32).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity, side: THREE.DoubleSide, depthWrite: false }))
  m.position.y = 0.012
  m.userData.noCollide = true
  return m
}

// ══ Material pickups ══════════════════════════════════════════════════════════
// One recognisable little object per material instead of a coloured orb, so
// the player learns what they're collecting.  `size` = 1 → ~0.2 wu tall.

export const MATERIAL_COLOR: Record<string, number> = {
  SilkThread: 0xe8f0ff, ChitinShard: 0x7fb24a, WebFluid: 0x5ab8ff, BoneFragment: 0xe6d9c3,
  BugPartsAnt: 0xd4744a, DriedFungus: 0x9ad65a, CrystalDust: 0xc9f0ff, VenomGland: 0xb77fe0,
  Thistle: 0xc79cff, Stone: 0xb3aca2, Wood: 0xa0723e, CrystalShard: 0x9fe8ff,
}

function silkSpool(gm: THREE.Texture): THREE.Group {
  const g = new THREE.Group()
  const wood = toon(0x9a6a3a, gm)
  const silk = glowing(0xeef4ff, gm, 0.35)
  const core = mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.12, 14), silk); g.add(core)
  for (const y of [-0.068, 0.068]) {
    const end = mesh(new THREE.CylinderGeometry(0.095, 0.095, 0.018, 16), wood); end.position.y = y; g.add(end)
  }
  // a few wraps that catch the light + one loose strand
  for (let i = 0; i < 3; i++) {
    const wrap = mesh(new THREE.TorusGeometry(0.072, 0.006, 4, 18), silk, false)
    wrap.rotation.x = Math.PI / 2; wrap.position.y = -0.04 + i * 0.04; g.add(wrap)
  }
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0.07, 0.02, 0), new THREE.Vector3(0.13, -0.03, 0.03), new THREE.Vector3(0.12, -0.1, 0.08), new THREE.Vector3(0.17, -0.13, 0.12),
  ])
  g.add(mesh(new THREE.TubeGeometry(curve, 16, 0.005, 4), silk, false))
  g.rotation.z = 0.35
  return g
}

function chitinShards(gm: THREE.Texture): THREE.Group {
  const g = new THREE.Group()
  const mat = toon(0x7fb24a, gm, { emissive: new THREE.Color(0x2f6b3a), emissiveIntensity: 0.5 })
  const edge = toon(0xc6e48a, gm)
  const shards: Array<[number, number, number, number, number]> = [
    [0, 0.02, 0, 0.0, 1.0], [0.07, -0.02, 0.03, 0.5, 0.75], [-0.06, -0.03, -0.02, -0.45, 0.65],
  ]
  for (const [x, y, z, tilt, s] of shards) {
    const geo = new THREE.OctahedronGeometry(0.08 * s, 0)
    geo.scale(0.55, 1.6, 0.35)
    const m = mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(0.2, tilt * 2, tilt); g.add(m)
    const rim = mesh(new THREE.OctahedronGeometry(0.03 * s, 0).scale(0.6, 1.4, 0.4), edge, false)
    rim.position.set(x, y + 0.09 * s, z); rim.rotation.copy(m.rotation); g.add(rim)
  }
  return g
}

function fluidDrop(gm: THREE.Texture): THREE.Group {
  const g = new THREE.Group()
  // teardrop lathe
  const pts: THREE.Vector2[] = []
  for (let i = 0; i <= 16; i++) {
    const t = i / 16
    const r = Math.sin(Math.PI * Math.min(1, t * 1.15)) * (1 - t) ** 0.6 * 0.085 + 0.002
    pts.push(new THREE.Vector2(Math.max(0.002, r), -0.09 + t * 0.21))
  }
  const shell = new THREE.Mesh(new THREE.LatheGeometry(pts, 18), new THREE.MeshToonMaterial({
    color: 0x5ab8ff, gradientMap: gm, transparent: true, opacity: 0.72, emissive: new THREE.Color(0x1d5fa8), emissiveIntensity: 0.6,
  }))
  shell.castShadow = true
  g.add(shell)
  const core = new THREE.Mesh(new THREE.SphereGeometry(0.035, 10, 8), new THREE.MeshBasicMaterial({ color: 0xbfe6ff }))
  core.position.y = -0.03; g.add(core)
  const hi = new THREE.Mesh(new THREE.SphereGeometry(0.012, 6, 5), new THREE.MeshBasicMaterial({ color: 0xffffff }))
  hi.position.set(-0.03, 0.0, 0.05); g.add(hi)
  return g
}

function boneBit(gm: THREE.Texture): THREE.Group {
  const g = new THREE.Group()
  const mat = toon(0xe6d9c3, gm, { emissive: new THREE.Color(0x3a3020), emissiveIntensity: 0.4 })
  const shaft = mesh(new THREE.CylinderGeometry(0.026, 0.03, 0.22, 10), mat); shaft.rotation.z = Math.PI / 2; g.add(shaft)
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const knob = mesh(new THREE.SphereGeometry(0.036, 10, 8), mat); knob.position.set(sx * 0.11, 0, sz * 0.024); g.add(knob)
  }
  g.rotation.y = 0.5
  return g
}

function antLeg(gm: THREE.Texture): THREE.Group {
  const g = new THREE.Group()
  const mat = toon(0xe0824e, gm, { emissive: new THREE.Color(0x7a2e12), emissiveIntensity: 0.6 })
  const joint = toon(0x9a4626, gm)
  const pts = [new THREE.Vector3(-0.11, -0.05, 0), new THREE.Vector3(-0.03, 0.06, 0.01), new THREE.Vector3(0.06, 0.02, -0.01), new THREE.Vector3(0.12, -0.06, 0)]
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1]
    const len = a.distanceTo(b)
    const seg = mesh(new THREE.CylinderGeometry(0.02 - i * 0.004, 0.025 - i * 0.004, len, 7), mat)
    seg.position.copy(a).add(b).multiplyScalar(0.5)
    seg.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize())
    g.add(seg)
    if (i > 0) { const j = mesh(new THREE.SphereGeometry(0.02, 8, 6), joint); j.position.copy(a); g.add(j) }
  }
  // a little mandible hook alongside
  const hook = mesh(new THREE.TorusGeometry(0.04, 0.012, 5, 10, Math.PI * 1.1), joint)
  hook.position.set(-0.02, -0.04, 0.06); hook.rotation.set(Math.PI / 2, 0, 0.4); g.add(hook)
  return g
}

function fungusTuft(gm: THREE.Texture): THREE.Group {
  const g = new THREE.Group()
  const stem = toon(0xe8dcc0, gm)
  const cap = toon(0x9ad65a, gm, { emissive: new THREE.Color(0x4a9a2a), emissiveIntensity: 0.7 })
  for (const [x, z, s] of [[0, 0, 1], [0.06, 0.04, 0.7], [-0.055, 0.03, 0.6]] as Array<[number, number, number]>) {
    const st = mesh(new THREE.CylinderGeometry(0.014 * s, 0.02 * s, 0.12 * s, 7), stem); st.position.set(x, -0.04 + 0.06 * s, z); g.add(st)
    const cp = mesh(new THREE.SphereGeometry(0.05 * s, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), cap)
    cp.scale.y = 0.6; cp.position.set(x, -0.04 + 0.12 * s, z); g.add(cp)
    for (let k = 0; k < 3; k++) {   // glow speckles on the cap
      const dot = new THREE.Mesh(new THREE.SphereGeometry(0.008 * s, 5, 4), new THREE.MeshBasicMaterial({ color: 0xe7ffb0 }))
      const a = k * 2.1 + x * 10
      dot.position.set(x + Math.cos(a) * 0.025 * s, -0.04 + 0.145 * s, z + Math.sin(a) * 0.025 * s); g.add(dot)
    }
  }
  return g
}

function crystalCluster(gm: THREE.Texture, color: number): THREE.Group {
  const g = new THREE.Group()
  const mat = toon(color, gm, { emissive: new THREE.Color(color), emissiveIntensity: 0.55, transparent: true, opacity: 0.92 })
  for (const [x, z, h, tilt] of [[0, 0, 0.2, 0], [0.05, 0.03, 0.13, 0.5], [-0.05, 0.02, 0.11, -0.45], [0.01, -0.05, 0.09, 0.3]] as Array<[number, number, number, number]>) {
    const c = mesh(new THREE.ConeGeometry(0.03, h, 6), mat)
    c.position.set(x, -0.08 + h / 2, z); c.rotation.z = tilt; c.rotation.x = tilt * 0.5; g.add(c)
  }
  return g
}

function venomGland(gm: THREE.Texture): THREE.Group {
  const g = new THREE.Group()
  const sac = new THREE.Mesh(new THREE.SphereGeometry(0.075, 14, 10), toon(0xb77fe0, gm, {
    emissive: new THREE.Color(0x6a2a9a), emissiveIntensity: 0.6, transparent: true, opacity: 0.85 }))
  sac.scale.set(1, 1.25, 1); g.add(sac)
  const duct = mesh(new THREE.CylinderGeometry(0.012, 0.02, 0.07, 7), toon(0x5a3070, gm)); duct.position.y = 0.11; g.add(duct)
  return g
}

function thistleHead(gm: THREE.Texture): THREE.Group {
  const g = new THREE.Group()
  const bract = toon(0x5d8a3a, gm)
  const tuft = toon(0xc79cff, gm, { emissive: new THREE.Color(0x6a3aa8), emissiveIntensity: 0.55 })
  const base = mesh(new THREE.SphereGeometry(0.05, 10, 8), bract); base.scale.y = 0.9; g.add(base)
  for (let i = 0; i < 10; i++) {   // spiky bracts
    const a = (i / 10) * Math.PI * 2
    const sp = mesh(new THREE.ConeGeometry(0.008, 0.05, 4), bract, false)
    sp.position.set(Math.cos(a) * 0.045, -0.01, Math.sin(a) * 0.045)
    sp.rotation.z = -Math.cos(a) * 1.2; sp.rotation.x = Math.sin(a) * 1.2; g.add(sp)
  }
  const top = mesh(new THREE.CylinderGeometry(0.045, 0.03, 0.06, 12), tuft); top.position.y = 0.05; g.add(top)
  return g
}

// `beam`: a faint vertical light column (den pickups — readable across the room)
export function buildMaterialPickup(mat: string, gm: THREE.Texture, size = 1, opts: { beam?: boolean } = {}): THREE.Group {
  const color = MATERIAL_COLOR[mat] ?? 0xcccccc
  const root = new THREE.Group()
  const float = new THREE.Group()
  const model =
    mat === 'SilkThread'  ? silkSpool(gm) :
    mat === 'ChitinShard' ? chitinShards(gm) :
    mat === 'WebFluid'    ? fluidDrop(gm) :
    mat === 'BoneFragment'? boneBit(gm) :
    mat === 'BugPartsAnt' ? antLeg(gm) :
    mat === 'DriedFungus' ? fungusTuft(gm) :
    mat === 'VenomGland'  ? venomGland(gm) :
    mat === 'Thistle'     ? thistleHead(gm) :
    crystalCluster(gm, color)
  float.add(model)
  float.add(glowSprite(color, 0.42, 0.5))
  root.add(float)
  root.add(groundRing(color, 0.14, 0.2, 0.45))
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.11, 18).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.3, depthWrite: false }))
  shadow.position.y = 0.008; shadow.userData.noCollide = true
  root.add(shadow)
  if (opts.beam) {
    // A faint shaft that fades out upward (a solid column read as a pillar)
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.03, 1.6, 10, 1, true),
      new THREE.MeshBasicMaterial({ color, map: beamFade(), transparent: true, opacity: 0.32, side: THREE.DoubleSide,
        depthWrite: false, blending: THREE.AdditiveBlending }))
    beam.position.y = 0.95; beam.userData.noCollide = true
    root.add(beam)
  }
  addRim(root)
  root.scale.setScalar(size)
  const phase = Math.random() * Math.PI * 2
  animate(root, (t) => {
    float.position.y = 0.17 + Math.sin(t * 2.1 + phase) * 0.025
    model.rotation.y = t * 0.9 + phase
    shadow.scale.setScalar(1 - Math.sin(t * 2.1 + phase) * 0.12)
  })
  return root
}

// HP module (colony): a glowing nectar berry with a leaf
export function buildHealthBerry(gm: THREE.Texture, size = 1): THREE.Group {
  const root = new THREE.Group(), float = new THREE.Group()
  const berry = mesh(new THREE.SphereGeometry(0.075, 16, 12), toon(0xff4a5a, gm, { emissive: new THREE.Color(0xb0102a), emissiveIntensity: 0.7 }))
  berry.scale.y = 0.92; float.add(berry)
  const hi = new THREE.Mesh(new THREE.SphereGeometry(0.016, 6, 5), new THREE.MeshBasicMaterial({ color: 0xffd0d6 }))
  hi.position.set(-0.03, 0.035, 0.045); float.add(hi)
  const leaf = mesh(new THREE.SphereGeometry(0.05, 8, 5), toon(0x5d9a3a, gm)); leaf.scale.set(1, 0.18, 0.55)
  leaf.position.set(0.035, 0.07, 0); leaf.rotation.z = -0.5; float.add(leaf)
  const stem = mesh(new THREE.CylinderGeometry(0.006, 0.008, 0.04, 5), toon(0x4a6a2a, gm)); stem.position.y = 0.085; float.add(stem)
  float.add(glowSprite(0xff5566, 0.36, 0.55))
  root.add(float, groundRing(0xff4455, 0.11, 0.16, 0.4))
  addRim(root)
  root.scale.setScalar(size)
  const phase = Math.random() * 6
  animate(root, (t) => {
    float.position.y = 0.16 + Math.sin(t * 2.4 + phase) * 0.02
    const beat = 1 + Math.max(0, Math.sin(t * 5 + phase)) * 0.06   // gentle heartbeat
    berry.scale.set(beat, 0.92 * beat, beat)
  })
  return root
}

// ══ Birthday card ═════════════════════════════════════════════════════════════
// A folded card standing half-open on a flat stone: a doodled spider in a party
// hat and "17" on the front, a pressed purple flower tucked inside (the card's
// text mentions it).  Returns the paper material for the den's glint.

function cardFrontTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas'); c.width = 256; c.height = 352
  const g = c.getContext('2d')!
  g.fillStyle = '#f3e6c8'; g.fillRect(0, 0, 256, 352)
  // aged edges
  const v = g.createRadialGradient(128, 176, 80, 128, 176, 230)
  v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(120,80,30,.28)')
  g.fillStyle = v; g.fillRect(0, 0, 256, 352)
  g.strokeStyle = '#b8443c'; g.lineWidth = 6; g.setLineDash([14, 9]); g.strokeRect(14, 14, 228, 324); g.setLineDash([])
  // "17"
  g.fillStyle = '#8a2f2b'; g.font = 'bold 92px Georgia, serif'; g.textAlign = 'center'; g.fillText('17', 128, 300)
  // spider doodle with a party hat
  g.strokeStyle = '#3a2a40'; g.lineWidth = 5; g.lineCap = 'round'
  const cx = 128, cy = 150
  for (let i = 0; i < 4; i++) for (const s of [-1, 1]) {
    const a = (-0.6 + i * 0.4) * s
    g.beginPath(); g.moveTo(cx, cy)
    g.quadraticCurveTo(cx + s * 46, cy - 30 + i * 18, cx + s * (62 + (i % 2) * 6), cy + 18 + i * 14 + a * 4)
    g.stroke()
  }
  g.fillStyle = '#6a4d8a'; g.beginPath(); g.ellipse(cx, cy + 6, 34, 28, 0, 0, Math.PI * 2); g.fill()
  g.beginPath(); g.ellipse(cx, cy - 26, 22, 18, 0, 0, Math.PI * 2); g.fill()
  g.fillStyle = '#9fe8ff'; for (const x of [-8, 8]) { g.beginPath(); g.arc(cx + x, cy - 28, 6, 0, Math.PI * 2); g.fill() }
  g.fillStyle = '#ffffff'; for (const x of [-6, 10]) { g.beginPath(); g.arc(cx + x, cy - 30, 2.2, 0, Math.PI * 2); g.fill() }
  // hat
  g.fillStyle = '#ffcf5a'; g.beginPath(); g.moveTo(cx - 14, cy - 40); g.lineTo(cx + 14, cy - 40); g.lineTo(cx + 2, cy - 82); g.closePath(); g.fill()
  g.fillStyle = '#e8506a'; g.beginPath(); g.arc(cx + 2, cy - 84, 6, 0, Math.PI * 2); g.fill()
  // hearts
  g.fillStyle = '#d4505a'
  for (const [x, y, s] of [[40, 70, 1], [214, 92, 0.8], [52, 226, 0.7], [206, 220, 0.9]] as Array<[number, number, number]>) {
    g.beginPath(); g.moveTo(x, y + 8 * s); g.bezierCurveTo(x - 14 * s, y - 4 * s, x - 6 * s, y - 14 * s, x, y - 5 * s)
    g.bezierCurveTo(x + 6 * s, y - 14 * s, x + 14 * s, y - 4 * s, x, y + 8 * s); g.fill()
  }
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4
  return tex
}

export function buildBirthdayCard(gm: THREE.Texture, P: number): { group: THREE.Group; glintMat: THREE.MeshToonMaterial } {
  const g = new THREE.Group()
  const paperFront = toon(0xffffff, gm, { map: cardFrontTexture() })
  const paper = toon(0xf0e2c2, gm)
  const W = 0.34 * P, H = 0.48 * P, T = 0.012 * P
  // flat stand stone
  const stone = mesh(new THREE.CylinderGeometry(0.34 * P, 0.38 * P, 0.06 * P, 18), surface({ color: 0x8a7a68, tex: 'stone', texScale: 0.8, gradientMap: gm }))
  stone.position.y = 0.03 * P; stone.receiveShadow = true; g.add(stone)
  const base = 0.06 * P
  // Front cover stands facing local +Z (the scene turns +Z toward the camera);
  // the back panel is propped open behind it from the spine on the left edge.
  const mk = (front: boolean) => {
    const pivot = new THREE.Group()
    const mats = front ? [paper, paper, paper, paper, paperFront, paper] : paper
    const panel = mesh(new THREE.BoxGeometry(W, H, T), mats)
    panel.position.set(W / 2, H / 2, 0); pivot.add(panel)
    pivot.position.set(-W / 2, base, 0)
    return pivot
  }
  const front = mk(true), back = mk(false)
  front.rotation.x = -0.08          // leaning back a touch
  back.rotation.y = 1.15            // opened ~65° behind
  g.add(front, back)
  // the pressed flower has slipped out onto the stone in front
  const petal = toon(0xa070d0, gm, { side: THREE.DoubleSide })
  const flower = new THREE.Group()
  for (let i = 0; i < 6; i++) {
    const p = mesh(new THREE.CircleGeometry(0.045 * P, 10), petal, false)
    p.scale.set(0.55, 1, 1); const a = (i / 6) * Math.PI * 2
    p.position.set(Math.cos(a) * 0.04 * P, Math.sin(a) * 0.04 * P, 0); p.rotation.z = a - Math.PI / 2
    flower.add(p)
  }
  const centre = mesh(new THREE.CircleGeometry(0.025 * P, 10), toon(0xf2c94c, gm), false); centre.position.z = 0.001; flower.add(centre)
  const stem = mesh(new THREE.PlaneGeometry(0.012 * P, 0.16 * P), toon(0x6a8a4a, gm, { side: THREE.DoubleSide }), false)
  stem.position.set(0.01 * P, -0.1 * P, -0.001); stem.rotation.z = 0.2; flower.add(stem)
  flower.position.set(0.1 * P, base + 0.004, 0.2 * P)
  flower.rotation.set(-Math.PI / 2, 0, -0.6)
  g.add(flower)
  g.add(groundRing(0xffb070, 0.34 * P, 0.44 * P, 0.32))
  addRim(g)
  return { group: g, glintMat: paperFront }
}

// ══ Gift ══════════════════════════════════════════════════════════════════════
// Polka-dot wrapped box with a lid, silk ribbon, a big bow and a name tag.

function dotPaperTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas'); c.width = c.height = 128
  const g = c.getContext('2d')!
  g.fillStyle = '#c8506e'; g.fillRect(0, 0, 128, 128)
  g.fillStyle = '#f2b6c4'
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
    g.beginPath(); g.arc(16 + x * 32 + (y % 2) * 16, 16 + y * 32, 6, 0, Math.PI * 2); g.fill()
  }
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.repeat.set(2, 2)
  return tex
}

export function buildGift(gm: THREE.Texture, P: number): { group: THREE.Group; glintMat: THREE.MeshToonMaterial } {
  const g = new THREE.Group()
  const wrap = toon(0xffffff, gm, { map: dotPaperTexture() })
  const ribbon = toon(0xe8eef8, gm, { emissive: new THREE.Color(0x8890a0), emissiveIntensity: 0.25 })
  const S = 0.55 * P
  const box = mesh(new RoundedBoxGeometry(S, S * 0.82, S, 3, S * 0.05), wrap); box.position.y = S * 0.41; g.add(box)
  const lid = mesh(new RoundedBoxGeometry(S * 1.06, S * 0.2, S * 1.06, 3, S * 0.05), wrap); lid.position.y = S * 0.86; g.add(lid)
  // ribbons
  for (const rotY of [0, Math.PI / 2]) {
    const band = mesh(new THREE.BoxGeometry(S * 1.08, S * 1.0, S * 0.14), ribbon, false)
    band.position.y = S * 0.48; band.rotation.y = rotY; g.add(band)
  }
  // bow: two loops + knot + tails
  const bow = new THREE.Group(); bow.position.y = S * 0.98
  for (const s of [-1, 1]) {
    const loop = mesh(new THREE.TorusGeometry(S * 0.17, S * 0.045, 8, 18), ribbon)
    loop.scale.set(1, 0.65, 0.5); loop.position.x = s * S * 0.16; loop.rotation.z = s * 0.35; loop.rotation.y = Math.PI / 2 * 0.2
    bow.add(loop)
    const tail = mesh(new THREE.BoxGeometry(S * 0.09, S * 0.3, S * 0.02), ribbon, false)
    tail.position.set(s * S * 0.09, -S * 0.08, S * 0.12); tail.rotation.set(0.5, 0, s * 0.45); tail.userData.noCollide = true
    bow.add(tail)
  }
  const knot = mesh(new THREE.SphereGeometry(S * 0.07, 10, 8), ribbon); bow.add(knot)
  g.add(bow)
  // tag on a thread
  const tc = document.createElement('canvas'); tc.width = 128; tc.height = 72
  const tg = tc.getContext('2d')!
  tg.fillStyle = '#f3e6c8'; tg.fillRect(0, 0, 128, 72)
  tg.fillStyle = '#5a3a2a'; tg.font = 'italic 30px Georgia, serif'; tg.textAlign = 'center'; tg.fillText('for W.', 64, 46)
  const ttex = new THREE.CanvasTexture(tc); ttex.colorSpace = THREE.SRGBColorSpace
  const tag = mesh(new THREE.PlaneGeometry(S * 0.34, S * 0.19), toon(0xffffff, gm, { map: ttex, side: THREE.DoubleSide }), false)
  tag.position.set(S * 0.22, S * 0.6, S * 0.565); tag.rotation.set(-0.1, 0.15, 0.1); tag.userData.noCollide = true   // clear of the box face
  g.add(tag)
  g.add(groundRing(0xffd0e0, 0.42 * P, 0.54 * P, 0.3))
  addRim(g)
  return { group: g, glintMat: wrap }
}

// ══ Toothpick (weapon find) ═══════════════════════════════════════════════════
// Stuck at an angle in a little mound of dirt and moss, with a soft aura.

export function buildToothpickFind(gm: THREE.Texture): { group: THREE.Group; glintMat: THREE.MeshToonMaterial } {
  const g = new THREE.Group()
  const woodMat = surface({ color: 0xd8b878, tex: 'wood', texScale: 6, gradientMap: gm })
  const pts: THREE.Vector2[] = []
  for (let i = 0; i <= 12; i++) {           // double-tapered toothpick profile
    const t = i / 12
    pts.push(new THREE.Vector2(0.004 + Math.sin(Math.PI * t) ** 0.55 * 0.018, -0.28 + t * 0.56))
  }
  const stick = mesh(new THREE.LatheGeometry(pts, 8), woodMat)
  stick.position.set(0, 0.3, 0); stick.rotation.z = 0.32; stick.rotation.x = -0.1
  g.add(stick)
  const mound = mesh(new THREE.SphereGeometry(0.12, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), surface({ color: 0x6e5640, tex: 'dirt', texScale: 4, gradientMap: gm }))
  mound.scale.set(1.2, 0.45, 1); mound.receiveShadow = true; g.add(mound)
  const moss = toon(0x6a9a3e, gm)
  for (const [x, z, s] of [[0.08, 0.03, 0.03], [-0.07, 0.05, 0.025], [0.02, -0.08, 0.022]] as Array<[number, number, number]>) {
    const m = mesh(new THREE.SphereGeometry(s, 7, 5), moss, false); m.scale.y = 0.5; m.position.set(x, 0.035, z); g.add(m)
  }
  for (const [x, z] of [[0.15, -0.04], [-0.13, -0.06]]) {
    const p = mesh(new THREE.DodecahedronGeometry(0.025, 0), surface({ color: 0x8a7e70, tex: 'stone', texScale: 6, gradientMap: gm }))
    p.position.set(x, 0.015, z); g.add(p)
  }
  const aura = glowSprite(0xffdf9a, 0.5, 0.22); aura.position.y = 0.2; g.add(aura)
  g.add(groundRing(0xddcc88, 0.2, 0.27, 0.4))
  addRim(g)
  animate(g, (t) => { aura.material.opacity = 0.16 + Math.sin(t * 2.6) * 0.08 })
  return { group: g, glintMat: woodMat }
}

// ══ Workbench ═════════════════════════════════════════════════════════════════
// A bark-slab table on thread-spool legs, a little loom at the back with a
// half-woven panel, needle, thimble and a glowing silk ball.  P = prop scale.

export function buildWorkbench(gm: THREE.Texture, P: number): { group: THREE.Group; glintMat: THREE.MeshToonMaterial } {
  const g = new THREE.Group()
  const bark = surface({ color: 0x7a5232, tex: 'wood', texScale: 1.2 / P, gradientMap: gm })
  const barkDark = surface({ color: 0x553820, tex: 'wood', texScale: 1.2 / P, gradientMap: gm })
  const spoolWood = toon(0x9a6a3a, gm)
  const silk = toon(0xeef2fa, gm, { emissive: new THREE.Color(0x8a96aa), emissiveIntensity: 0.25 })
  const metal = toon(0xb8b8c4, gm)

  // top slab with a lip
  const top = mesh(new RoundedBoxGeometry(1.4 * P, 0.12 * P, 0.9 * P, 3, 0.04 * P), bark)
  top.position.y = 0.52 * P; top.receiveShadow = true; g.add(top)
  const lip = mesh(new RoundedBoxGeometry(1.44 * P, 0.05 * P, 0.94 * P, 2, 0.02 * P), barkDark)
  lip.position.y = 0.45 * P; g.add(lip)
  // spool legs
  for (const [ox, oz] of [[-0.56, -0.32], [0.56, -0.32], [-0.56, 0.32], [0.56, 0.32]]) {
    const leg = new THREE.Group(); leg.position.set(ox * P, 0, oz * P)
    const core = mesh(new THREE.CylinderGeometry(0.07 * P, 0.07 * P, 0.4 * P, 12), silk); core.position.y = 0.22 * P; leg.add(core)
    for (const y of [0.03, 0.41]) {
      const end = mesh(new THREE.CylinderGeometry(0.12 * P, 0.12 * P, 0.05 * P, 14), spoolWood); end.position.y = y * P; leg.add(end)
    }
    g.add(leg)
  }
  // loom frame at the back edge
  const loom = new THREE.Group(); loom.position.set(0, 0.58 * P, -0.36 * P)
  for (const x of [-0.42, 0.42]) {
    const post = mesh(new THREE.CylinderGeometry(0.025 * P, 0.03 * P, 0.5 * P, 8), barkDark); post.position.set(x * P, 0.25 * P, 0); loom.add(post)
  }
  const bar = mesh(new THREE.CylinderGeometry(0.022 * P, 0.022 * P, 0.9 * P, 8), barkDark); bar.rotation.z = Math.PI / 2; bar.position.y = 0.5 * P; loom.add(bar)
  for (let i = 0; i < 7; i++) {   // warp threads
    const th = mesh(new THREE.CylinderGeometry(0.004 * P, 0.004 * P, 0.46 * P, 4), silk, false)
    th.position.set((-0.3 + i * 0.1) * P, 0.27 * P, 0); loom.add(th)
  }
  const cloth = mesh(new THREE.PlaneGeometry(0.62 * P, 0.16 * P), toon(0xc9d0dc, gm, { side: THREE.DoubleSide }), false)
  cloth.position.set(0, 0.1 * P, 0.002); loom.add(cloth)
  g.add(loom)
  // tools
  const needle = mesh(new THREE.CylinderGeometry(0.008 * P, 0.002 * P, 0.42 * P, 6), metal)
  needle.rotation.z = Math.PI / 2; needle.rotation.y = 0.5; needle.position.set(-0.3 * P, 0.6 * P, 0.15 * P); g.add(needle)
  const eye = mesh(new THREE.TorusGeometry(0.014 * P, 0.004 * P, 4, 10), metal, false)
  eye.position.set(-0.48 * P, 0.6 * P, 0.25 * P); eye.rotation.y = 0.5; g.add(eye)
  const thimble = mesh(new THREE.CylinderGeometry(0.05 * P, 0.06 * P, 0.09 * P, 12, 1, false), metal)
  thimble.position.set(0.36 * P, 0.63 * P, 0.2 * P); g.add(thimble)
  const ball = mesh(new THREE.SphereGeometry(0.09 * P, 14, 10), toon(0xdfe8f4, gm, { emissive: new THREE.Color(0x8fc4e8), emissiveIntensity: 0.3 }))
  ball.position.set(0.12 * P, 0.67 * P, 0.05 * P); g.add(ball)
  const ballGlow = glowSprite(0xbfe4ff, 0.42 * P, 0.22); ballGlow.position.copy(ball.position); g.add(ballGlow)
  for (const [x, z, r] of [[0.5, -0.1, 0.4], [-0.1, 0.28, -0.3]] as Array<[number, number, number]>) {   // stray chitin plates
    const plate = mesh(new THREE.OctahedronGeometry(0.05 * P, 0).scale(1, 0.3, 0.7), toon(0x7fb24a, gm), false)
    plate.position.set(x * P, 0.6 * P, z * P); plate.rotation.y = r; g.add(plate)
  }
  g.add(groundRing(0x88ffcc, 0.6 * P, 0.75 * P, 0.22))
  addRim(g)
  animate(g, (t) => { ballGlow.material.opacity = 0.16 + Math.sin(t * 1.8) * 0.08 })
  return { group: g, glintMat: bark }
}

// ══ Chests (colony): acorn caches ═════════════════════════════════════════════
// A hollowed acorn with a hinged cap, bound with silk and a brass clasp.
// Mimics look the same until they wake: eyes open under the cap rim and a row
// of teeth shows.  `lid` hinges at the back; `glow` is the ground ring.

export interface ChestParts { group: THREE.Group; lid: THREE.Group; glow: THREE.Mesh; eyes: THREE.Object3D[]; inner: THREE.Mesh }

export function buildChest(gm: THREE.Texture, isMimic: boolean): ChestParts {
  const g = new THREE.Group()
  const shell = surface({ color: 0x9a6a3a, tex: 'wood', texScale: 7, gradientMap: gm })
  const capMat = surface({ color: 0x6a4a2a, tex: 'chitin', texScale: 9, gradientMap: gm })
  capMat.side = THREE.DoubleSide   // an opened cap shows its underside (was culled into a hoop)
  const brass = toon(0xd8b060, gm, { emissive: new THREE.Color(0x5a4010), emissiveIntensity: 0.3 })
  const silk = toon(0xe8eef8, gm)
  // nut body (lathe): round bottom, straight-ish walls, open top at y = 0.26
  const prof: THREE.Vector2[] = []
  for (let i = 0; i <= 14; i++) {
    const t = i / 14
    prof.push(new THREE.Vector2(0.03 + Math.sin(Math.min(1, t * 1.25) * Math.PI / 2) * 0.22 * (1 - 0.12 * t), t * 0.26))
  }
  shell.side = THREE.DoubleSide   // open-topped: the inside shows when the cap lifts
  const body = mesh(new THREE.LatheGeometry(prof, 20), shell)
  g.add(body)
  const inner = new THREE.Mesh(new THREE.CircleGeometry(0.19, 20).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: isMimic ? 0x2a0808 : 0xffb84a, transparent: true, opacity: 0.0 }))
  inner.position.y = 0.2; g.add(inner)   // lit when opened
  const band = mesh(new THREE.TorusGeometry(0.205, 0.012, 6, 28), silk, false); band.rotation.x = Math.PI / 2; band.position.y = 0.14; g.add(band)
  // cap on a hinge at the back (−Z)
  const lid = new THREE.Group(); lid.position.set(0, 0.26, -0.2)
  const cap = mesh(new THREE.SphereGeometry(0.235, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), capMat)
  cap.scale.y = 0.55; cap.position.z = 0.2; lid.add(cap)
  const capRim = mesh(new THREE.TorusGeometry(0.228, 0.022, 6, 28), capMat); capRim.rotation.x = Math.PI / 2; capRim.position.set(0, 0.005, 0.2); lid.add(capRim)
  const stem = mesh(new THREE.CylinderGeometry(0.014, 0.022, 0.07, 6), toon(0x4a3218, gm)); stem.position.set(0.01, 0.15, 0.2); stem.rotation.z = 0.3; lid.add(stem)
  g.add(lid)
  const clasp = mesh(new THREE.BoxGeometry(0.05, 0.06, 0.02), brass, false); clasp.position.set(0, 0.25, 0.215); g.add(clasp)
  const eyes: THREE.Object3D[] = []
  if (isMimic) {
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xff3a2a, transparent: true, opacity: 0 })
    for (const x of [-0.07, 0.07]) {
      const e = new THREE.Mesh(new THREE.SphereGeometry(0.022, 8, 6), eyeMat); e.position.set(x, 0.245, 0.2); g.add(e); eyes.push(e)
    }
    const toothMat = new THREE.MeshBasicMaterial({ color: 0xf2ead8, transparent: true, opacity: 0 })
    for (let i = 0; i < 7; i++) {
      const a = -0.9 + i * 0.3
      const t = new THREE.Mesh(new THREE.ConeGeometry(0.012, 0.035, 4), toothMat)
      t.position.set(Math.sin(a) * 0.205, 0.24, Math.cos(a) * 0.205); t.rotation.x = Math.PI; g.add(t); eyes.push(t)
    }
  }
  const glow = groundRing(isMimic ? 0xff4422 : 0xffcc44, 0.24, 0.32, 0.25)
  g.add(glow)
  addRim(g)
  return { group: g, lid, glow, eyes, inner }
}
