import * as THREE from 'three'

// ─── Chamber constants — must match HomeBaseScene3D ───────────────────────────
const CHAMBER_R = 10.5   // floor CircleGeometry radius / circularBound ≈ 10.0
const WB_X      = -5.0   // HomeBaseScene3D.WORKBENCH_X
const WB_Z      = -7.5   // HomeBaseScene3D.WORKBENCH_Z
// West exit gap arc — panels 3+4 of the octagon (135°–225°).  Burrow mounds
// and blocked tunnels must not be placed inside this range.
const EXIT_GAP_START = Math.PI * 0.75   // 135°
const EXIT_GAP_END   = Math.PI * 1.25   // 225°

// ─── Material bag type ────────────────────────────────────────────────────────
export interface DenMaterials {
  grad:      THREE.Texture
  earth:     THREE.MeshToonMaterial
  earthDark: THREE.MeshToonMaterial
  rootWall:  THREE.MeshToonMaterial
  floor:     THREE.MeshToonMaterial
  silk:      THREE.MeshStandardMaterial
  silkTorn:  THREE.MeshStandardMaterial
  metalCap:  THREE.MeshStandardMaterial
  rustCap:   THREE.MeshStandardMaterial
  cardboard: THREE.MeshToonMaterial
  wood:      THREE.MeshToonMaterial
  acorn:     THREE.MeshToonMaterial
  acornCap:  THREE.MeshToonMaterial
  partyPink: THREE.MeshToonMaterial
  partyTeal: THREE.MeshToonMaterial
  partyGold: THREE.MeshToonMaterial
  candleWax: THREE.MeshStandardMaterial
  flame:     THREE.MeshStandardMaterial   // used by SurvivorsProgression._lightCake
}

// Handles returned to HomeBaseScene3D and passed to SurvivorsProgression.
// Each group maps to a specific den sub-system that heals can target.
export interface DenHandles {
  mat:    DenMaterials
  walls:  THREE.Group   // organic burrow mounds (visual)
  silk:   THREE.Group   // ceiling cables, hammocks (userData.tornHammocks)
  junk:   THREE.Group   // bottle caps, spools, etc. (userData.toppled stool)
  invent: THREE.Group   // workbench inventions
  bash:   THREE.Group   // birthday bash (cake userData.isCake, confetti)
  attack: THREE.Group   // drag marks, gouges
  exits:  THREE.Group   // blocked tunnels + web bridge
}

export type AddFn = (obj: THREE.Object3D) => void

// ─── Private helpers ──────────────────────────────────────────────────────────

// Polar-grid BufferGeometry — proper circular floor that supports Y displacement.
// PlaneGeometry would produce a visible square; this stays circular.
function buildCircularGrid(radius: number, rings: number, segs: number): THREE.BufferGeometry {
  const verts: number[] = []
  const idxs:  number[] = []
  verts.push(0, 0, 0) // center vertex
  for (let r = 1; r <= rings; r++) {
    const rad = (r / rings) * radius
    for (let s = 0; s < segs; s++) {
      const a = (s / segs) * Math.PI * 2
      verts.push(Math.cos(a) * rad, 0, Math.sin(a) * rad)
    }
  }
  // Center fan to first ring
  for (let s = 0; s < segs; s++) {
    idxs.push(0, 1 + s, 1 + ((s + 1) % segs))
  }
  // Ring-to-ring quads
  for (let r = 0; r < rings - 1; r++) {
    for (let s = 0; s < segs; s++) {
      const next = (s + 1) % segs
      const a = 1 + r * segs + s,          b = 1 + r * segs + next
      const c = 1 + (r + 1) * segs + s,    d = 1 + (r + 1) * segs + next
      idxs.push(a, b, d, a, d, c)
    }
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3))
  geo.setIndex(idxs)
  return geo
}

// Catenary silk strand between two world-space points
function silkStrand(
  a: THREE.Vector3, b: THREE.Vector3,
  mat: THREE.Material, sag = 0.6, segs = 12,
): THREE.Mesh {
  const pts: THREE.Vector3[] = []
  for (let i = 0; i <= segs; i++) {
    const t = i / segs
    const p = new THREE.Vector3().lerpVectors(a, b, t)
    p.y -= Math.sin(t * Math.PI) * sag
    pts.push(p)
  }
  return new THREE.Mesh(
    new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), segs, 0.015, 5, false),
    mat,
  )
}

// Sagging silk sheet hammock — optionally torn at one corner
function silkHammock(
  center: THREE.Vector3, w: number, d: number,
  mat: DenMaterials, torn = false,
): THREE.Mesh {
  const g = new THREE.PlaneGeometry(w, d, 8, 8)
  g.rotateX(-Math.PI / 2)
  const pos = g.attributes.position as THREE.BufferAttribute
  for (let i = 0; i < pos.count; i++) {
    const nx = pos.getX(i) / (w / 2)
    const nz = pos.getZ(i) / (d / 2)
    let y = -(1 - nx * nx) * (1 - nz * nz) * (torn ? 0.9 : 0.5)
    if (torn && nx > 0.4 && nz > 0.4) y -= 1.4  // ripped corner drops hard
    pos.setY(i, y)
  }
  g.computeVertexNormals()
  const m = new THREE.Mesh(g, torn ? mat.silkTorn : mat.silk)
  m.position.copy(center)
  return m
}

// ─── Exported builders ────────────────────────────────────────────────────────

// Build the material palette.  Accepts the shared gradientMap from main.ts so
// banding stays visually consistent with all other MeshToonMaterials in the scene.
export function buildDenMaterials(gradientMap: THREE.Texture): DenMaterials {
  const toon = (color: number) =>
    new THREE.MeshToonMaterial({ color, gradientMap })
  return {
    grad:      gradientMap,
    earth:     toon(0x4a3322),
    earthDark: toon(0x2c1d12),
    rootWall:  toon(0x5a3d24),
    floor:     toon(0x6b4a30),
    silk: new THREE.MeshStandardMaterial({
      color: 0xe8e0d0, roughness: 0.45, metalness: 0.0,
      transparent: true, opacity: 0.85, side: THREE.DoubleSide,
      emissive: 0x2a2620, emissiveIntensity: 0.15,
    }),
    silkTorn: new THREE.MeshStandardMaterial({
      color: 0xb8ad98, roughness: 0.6,
      transparent: true, opacity: 0.55, side: THREE.DoubleSide,
    }),
    metalCap:  new THREE.MeshStandardMaterial({ color: 0x9aa0a6, metalness: 0.8, roughness: 0.4 }),
    rustCap:   new THREE.MeshStandardMaterial({ color: 0x7a4a32, metalness: 0.5, roughness: 0.7 }),
    cardboard: toon(0xc09a64),
    wood:      toon(0x6e4a28),
    acorn:     toon(0x7d5a36),
    acornCap:  toon(0x4a3320),
    partyPink: toon(0xd86a8a),
    partyTeal: toon(0x4aa89a),
    partyGold: toon(0xd8a838),
    candleWax: new THREE.MeshStandardMaterial({ color: 0xf4e8c8, roughness: 0.5 }),
    flame:     new THREE.MeshStandardMaterial({
      color: 0xffd070, emissive: 0xffaa30, emissiveIntensity: 3.0,
    }),
  }
}

// Sculpted burrow floor using a polar circular grid with terrain displacement.
// Replaces buildGround()'s flat CircleGeometry.
// Shape: gentle rolling unevenness + central depression where family gathered
// + raised rim that reads as the bowl of a burrow.
export function buildDenFloor(mat: DenMaterials, add: AddFn): THREE.Mesh {
  const geo = buildCircularGrid(CHAMBER_R, 22, 56)
  const pos = geo.attributes.position as THREE.BufferAttribute
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i)
    const z = pos.getZ(i)
    const d = Math.sqrt(x * x + z * z)
    // Soft rolling unevenness — a den floor is not a table
    let y = Math.sin(x * 0.4) * Math.cos(z * 0.35) * 0.18
          + Math.sin(x * 1.3 + z) * 0.06
    // Raised lip near the rim → reads as the bowl of a burrow
    if (d > CHAMBER_R * 0.72) y += (d - CHAMBER_R * 0.72) * 0.4
    // Worn central depression where the family gathered
    y -= Math.max(0, 6 - d) * 0.04
    pos.setY(i, y)
  }
  pos.needsUpdate = true
  geo.computeVertexNormals()
  const floor = new THREE.Mesh(geo, mat.floor)
  floor.receiveShadow = true
  add(floor)
  return floor
}

// Organic burrow mounds around the rim — purely visual dressing on top of the
// physics octagon walls.  Placed at CHAMBER_R * 0.88–1.04 so they sit at the
// wall boundary.  Exit arc (135°–225°) is left clear.
export function buildBurrowWalls(mat: DenMaterials, add: AddFn): THREE.Group {
  const group = new THREE.Group()
  const count = 26
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2
    if (a > EXIT_GAP_START && a < EXIT_GAP_END) continue  // leave doorway clear

    const r = CHAMBER_R * (0.88 + Math.random() * 0.16)
    const mound = new THREE.Mesh(
      new THREE.IcosahedronGeometry(2.8 + Math.random() * 1.8, 1),
      Math.random() > 0.5 ? mat.earth : mat.earthDark,
    )
    mound.scale.set(1, 0.55 + Math.random() * 0.45, 1)
    mound.position.set(Math.cos(a) * r, 0.8 + Math.random() * 1.6, Math.sin(a) * r)
    mound.rotation.y = Math.random() * Math.PI
    mound.castShadow = true
    mound.receiveShadow = true
    group.add(mound)

    // Occasional exposed root arcing out of a mound
    if (Math.random() > 0.55) {
      const root = new THREE.Mesh(
        new THREE.TorusGeometry(1.2 + Math.random() * 0.6, 0.16, 6, 12, Math.PI * 0.8),
        mat.rootWall,
      )
      root.position.copy(mound.position)
      root.position.y -= 0.6
      root.rotation.set(Math.random() * 0.4, a + Math.PI / 2, Math.random() * 0.5)
      root.castShadow = true
      group.add(root)
    }
  }
  add(group)
  return group
}

// Overhead support cables, hammocks, and a funnel web.
// All anchor points kept inside CHAMBER_R * 0.80 ≈ 8.4 wu.
// Torn hammocks tell the story of the attack.
export function buildSilkArchitecture(mat: DenMaterials, add: AddFn): THREE.Group {
  const group = new THREE.Group()

  // Ceiling support cables — criss-cross the den for vertical structure
  const anchors = [
    new THREE.Vector3(-8, 6, -6), new THREE.Vector3( 7, 7, -5),
    new THREE.Vector3( 8, 6,  7), new THREE.Vector3(-7, 7,  8),
    new THREE.Vector3( 0, 8, -8), new THREE.Vector3( 2, 7,  8),
  ]
  for (let i = 0; i < anchors.length; i++) {
    for (let j = i + 1; j < anchors.length; j++) {
      if (Math.random() > 0.55) continue
      group.add(silkStrand(anchors[i], anchors[j], mat.silk, 1.0 + Math.random() * 0.8))
    }
  }

  // Funnel web — classic spider-home feature, northwest corner
  const funnelMat = new THREE.MeshStandardMaterial({
    color: 0xe8e0d0, roughness: 0.45, metalness: 0.0,
    transparent: true, opacity: 0.4, side: THREE.DoubleSide,
    emissive: 0x2a2620, emissiveIntensity: 0.15,
  })
  const funnel = new THREE.Mesh(new THREE.ConeGeometry(2.2, 3.5, 16, 4, true), funnelMat)
  funnel.position.set(-7, 2.5, -6)
  funnel.rotation.x = Math.PI  // mouth opens upward
  group.add(funnel)

  // Seven family hammocks — density = extended family lived here.
  // Torn ones mark where people were taken.  All positions verified inside CHAMBER_R.
  const beds: Array<{ c: THREE.Vector3; w: number; d: number; torn: boolean }> = [
    { c: new THREE.Vector3(-6, 2.2,  5.0), w: 2.5, d: 1.8, torn: false },
    { c: new THREE.Vector3(-3, 2.0,  7.0), w: 2.2, d: 1.6, torn: true  }, // ripped
    { c: new THREE.Vector3( 7, 2.4, -4.0), w: 2.8, d: 2.0, torn: false },
    { c: new THREE.Vector3( 8, 1.8,  3.0), w: 2.0, d: 1.5, torn: true  }, // ripped
    { c: new THREE.Vector3(-6, 2.6,  7.0), w: 2.3, d: 1.7, torn: false }, // d < 9.2 ✓
    { c: new THREE.Vector3( 4, 2.2,  8.0), w: 1.8, d: 1.4, torn: false }, // d ≈ 8.9 ✓
    { c: new THREE.Vector3(-8, 2.0, -4.0), w: 2.1, d: 1.6, torn: true  }, // ripped; d ≈ 8.9 ✓
  ]
  const tornHammocks: THREE.Mesh[] = []
  for (const b of beds) {
    const hammock = silkHammock(b.c, b.w, b.d, mat, b.torn)
    if (b.torn) {
      // Capture pristine vertex Y values so SurvivorsProgression can lerp back to them
      const pristine = silkHammock(b.c, b.w, b.d, mat, false)
      const pp = pristine.geometry.attributes.position as THREE.BufferAttribute
      hammock.userData.pristineY = Float32Array.from(
        { length: pp.count }, (_, i) => pp.getY(i))
      tornHammocks.push(hammock)
      pristine.geometry.dispose()
      ;(pristine.material as THREE.Material).dispose()
    }
    group.add(hammock)
    // Suspension lines up toward the ceiling
    const top = b.c.clone(); top.y += 3.5
    group.add(silkStrand(b.c.clone().add(new THREE.Vector3(-b.w / 2, 0, 0)), top, mat.silk, 0.1))
    group.add(silkStrand(b.c.clone().add(new THREE.Vector3( b.w / 2, 0, 0)), top, mat.silk, 0.1))
  }
  // Expose for SurvivorsProgression.repairHammock() — index order matches level transitions
  group.userData.tornHammocks = tornHammocks

  // Silk doesn't cast hard shadows — too thin
  group.traverse(c => { c.castShadow = false })
  add(group)
  return group
}

// Bottle-cap tables, thread-spool stools, matchbox cabinet, thimble pot.
// These are the "homey from junk" character — the colony built a life here.
export function buildJunkFurniture(mat: DenMaterials, add: AddFn): THREE.Group {
  const group = new THREE.Group()

  function bottleCap(x: number, z: number, s: number, rusty = false): THREE.Group {
    const g   = new THREE.Group()
    const m   = rusty ? mat.rustCap : mat.metalCap
    const top = new THREE.Mesh(new THREE.CylinderGeometry(s, s, 0.15 * s, 20), m)
    const rim = new THREE.Mesh(new THREE.TorusGeometry(s, 0.08 * s, 6, 24), m)
    rim.rotation.x = Math.PI / 2
    rim.position.y = 0.05 * s
    g.add(top, rim)
    g.position.set(x, 0.1 * s, z)
    g.traverse(o => { o.castShadow = true })
    return g
  }

  group.add(bottleCap(0,   0,   1.6))           // central gathering table (cake sits on top)
  group.add(bottleCap(8,  -5,   1.0, true))      // side table, rusted
  group.add(bottleCap(-9,  6,   0.8))            // near a hammock anchor

  // One cap knocked over — evidence of the attack
  const tipped = bottleCap(-3, -8, 1.1, true)
  tipped.rotation.z = Math.PI / 2.2
  tipped.position.y = 1.0
  group.add(tipped)

  // Matchbox cabinet — food store near the east wall
  const box = new THREE.Mesh(new THREE.BoxGeometry(3, 1.4, 1.8), mat.cardboard)
  box.position.set(9, 0.7, 5)
  box.castShadow = box.receiveShadow = true
  group.add(box)
  // Ransacked drawer — pulled out and spilled
  const drawer = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.5, 1.4), mat.wood)
  drawer.position.set(9, 0.3, 7.5)
  drawer.rotation.y = 0.3
  drawer.castShadow = true
  group.add(drawer)

  // Thread-spool stools around the central table — the family circle
  function spool(x: number, z: number): THREE.Group {
    const g    = new THREE.Group()
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.7, 16), mat.wood)
    const flange = new THREE.CylinderGeometry(0.55, 0.55, 0.12, 16)
    const top  = new THREE.Mesh(flange, mat.wood); top.position.y  =  0.4
    const bot  = new THREE.Mesh(flange, mat.wood); bot.position.y  = -0.4
    g.add(body, top, bot)
    g.position.set(x, 0.42, z)
    g.traverse(o => { o.castShadow = true })
    return g
  }
  for (let i = 0; i < 6; i++) {
    const a  = (i / 6) * Math.PI * 2
    const st = spool(Math.cos(a) * 3.2, Math.sin(a) * 3.2)
    if (i === 2) { st.rotation.z = Math.PI / 2; st.position.y = 0.35; st.userData.toppled = true }
    group.add(st)
  }

  // Thimble pot — food prep, near the central hearth
  const thimble = new THREE.Mesh(
    new THREE.CylinderGeometry(0.6, 0.45, 1.1, 18, 1, true), mat.metalCap)
  thimble.position.set(6, 0.55, 6)
  thimble.castShadow = true
  group.add(thimble)

  add(group)
  return group
}

// Half-built inventions near the workbench.  Webbs left mid-project —
// INTACT because he was taken, not because he finished.  The still-powered
// accent ring is the "owner is gone but the machine runs on" beat.
export function buildInventions(mat: DenMaterials, add: AddFn): THREE.Group {
  const group = new THREE.Group()

  // Spare robotic leg segment upright on a stand
  const stand = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.3, 0.6, 12), mat.metalCap)
  stand.position.set(WB_X + 1.0, 0.3, WB_Z + 0.5)
  group.add(stand)

  const legSeg = new THREE.Mesh(
    new THREE.CylinderGeometry(0.06, 0.05, 1.4, 8),
    new THREE.MeshStandardMaterial({ color: 0x3b3b42, metalness: 0.85, roughness: 0.35 }),
  )
  legSeg.position.set(WB_X + 1.0, 1.2, WB_Z + 0.5)
  legSeg.rotation.z = 0.2
  group.add(legSeg)

  // Still-powered — emissive ring above bloom threshold (1.4 used on Webbs' own legs)
  const spark = new THREE.Mesh(
    new THREE.TorusGeometry(0.08, 0.02, 6, 12),
    new THREE.MeshStandardMaterial({ color: 0x00d9ff, emissive: 0x00aaff, emissiveIntensity: 1.6 }),
  )
  spark.position.set(WB_X + 1.0, 1.8, WB_Z + 0.5)
  spark.rotation.x = Math.PI / 2
  group.add(spark)

  // Scattered gears around the workbench area
  for (let i = 0; i < 5; i++) {
    const gear = new THREE.Mesh(
      new THREE.CylinderGeometry(0.18, 0.18, 0.06, 8), mat.rustCap)
    gear.position.set(
      WB_X + (Math.random() * 2.4 - 1.2),
      0.06,
      WB_Z + (Math.random() * 1.8 - 0.9),
    )
    gear.rotation.x = Math.PI / 2
    gear.castShadow = true
    group.add(gear)
  }

  add(group)
  return group
}

// Birthday bash atmosphere — replaces buildPartyExtra().
// buildBirthdayArea() in HomeBaseScene3D still manages the card + gift pickup
// objects; this is purely atmospheric dressing.
// The unlit candles are the gut-punch: the party was set up, just never started.
export function buildBirthdayBash(mat: DenMaterials, add: AddFn): THREE.Group {
  const group = new THREE.Group()

  // Tiered cake on the central bottle-cap table
  const cake = new THREE.Group()
  cake.userData.isCake      = true
  cake.userData.candleTops  = [] as THREE.Vector3[]   // wick tips; SurvivorsProgression places flames here
  const tier1 = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.3, 0.8, 24), mat.partyPink)
  const tier2 = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.9, 0.6, 24), mat.candleWax)
  tier2.position.y = 0.7
  const band = new THREE.Mesh(new THREE.TorusGeometry(1.2, 0.1, 8, 24), mat.partyTeal)
  band.rotation.x = Math.PI / 2; band.position.y = 0.2
  cake.add(tier1, tier2, band)

  for (let i = 0; i < 5; i++) {
    const a      = (i / 5) * Math.PI * 2
    const candle = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.4, 8), mat.partyGold)
    candle.position.set(Math.cos(a) * 0.5, 1.2, Math.sin(a) * 0.5)
    cake.add(candle)
    // Dark wick — never lit. Intentionally no emissive material.
    const wick = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.08, 4), mat.earthDark)
    wick.position.set(Math.cos(a) * 0.5, 1.44, Math.sin(a) * 0.5)
    cake.add(wick)
    // Store local-space wick tip position for SurvivorsProgression._lightCake
    ;(cake.userData.candleTops as THREE.Vector3[]).push(
      new THREE.Vector3(Math.cos(a) * 0.5, 1.48, Math.sin(a) * 0.5))
  }
  cake.position.set(0, 0.6, 0)   // sits on top of the central bottle-cap table
  cake.traverse(o => { o.castShadow = true })
  group.add(cake)

  // Banner — one end torn free, drooping.  The attack interrupted the stringing.
  const bannerStart = new THREE.Vector3(-7, 5.5, -4)
  const bannerEnd   = new THREE.Vector3( 5, 1.8, -3)   // low end = torn from its mount
  const cols        = [mat.partyPink, mat.partyTeal, mat.partyGold]
  for (let i = 0; i <= 9; i++) {
    const t    = i / 9
    const p    = new THREE.Vector3().lerpVectors(bannerStart, bannerEnd, t)
    p.y       -= Math.sin(t * Math.PI) * 1.1 * (1 - t * 0.4)  // worse sag at torn end
    const flag = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.48, 4), cols[i % 3])
    flag.position.copy(p); flag.position.y -= 0.3
    flag.rotation.x = Math.PI; flag.rotation.y = Math.PI / 4
    group.add(flag)
  }
  group.add(silkStrand(bannerStart, bannerEnd, mat.silkTorn, 0.9))

  // Confetti — pre-flagged transparent so SurvivorsProgression._tidyConfetti can fade them.
  // Three shared materials (one per colour) are fine because _tidyConfetti clones per-piece.
  const confMats = cols.map(m => { const c = m.clone(); c.transparent = true; c.opacity = 1.0; return c })
  for (let i = 0; i < 40; i++) {
    const conf = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 0.12), confMats[i % 3])
    const a    = Math.random() * Math.PI * 2
    const r    = Math.random() * 5.5
    conf.position.set(Math.cos(a) * r, 0.02, Math.sin(a) * r)
    conf.rotation.x = -Math.PI / 2
    conf.rotation.z = Math.random() * Math.PI
    group.add(conf)
  }

  add(group)
  return group
}

// Attack evidence — replaces buildAttackDamage().
// Drag marks converging toward the west exit (negative X), claw gouges on
// a wall mound, dropped child's toy, food scattered from the ransacked cabinet.
// Implies violence without gore — the canon says intact but wrong.
export function buildAttackEvidence(mat: DenMaterials, add: AddFn): THREE.Group {
  const group = new THREE.Group()

  // Drag marks — three dark troughs running roughly east-to-west (toward exit)
  const dragMat = new THREE.MeshToonMaterial({
    color: 0x241509, gradientMap: mat.grad, transparent: true, opacity: 0.65,
  })
  // [startX, startZ, length, angleOffset]
  const markData: [number, number, number, number][] = [
    [ -3.0,  0.5, 5.0, -0.25 ],
    [ -1.5, -1.0, 4.5, -0.12 ],
    [ -4.5,  1.8, 5.5,  0.10 ],
  ]
  for (const [sx, sz, len, ao] of markData) {
    const mark = new THREE.Mesh(new THREE.PlaneGeometry(0.55, len), dragMat)
    mark.rotation.x = -Math.PI / 2
    mark.rotation.z = Math.PI / 2 + ao   // long axis along X (east-west) + slight angle
    mark.position.set(sx - len * 0.3, 0.02, sz)  // offset center toward -X exit
    group.add(mark)
  }

  // Claw gouges on an east-wall mound — three parallel scratches
  const gougeMat = new THREE.MeshToonMaterial({ color: 0x1a0f06, gradientMap: mat.grad })
  for (let i = 0; i < 3; i++) {
    const g = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.03, 1.4), gougeMat)
    g.position.set(9.5 + i * 0.22, 2.2, -5)
    g.rotation.set(0, 0.35, 0.18)
    group.add(g)
  }

  // Dropped child's toy — a spinning top, frozen mid-roll, never came to rest
  const toy = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.48, 12), mat.acornCap)
  toy.position.set(-4, 0.22, -3)
  toy.rotation.z = Math.PI; toy.rotation.x = 0.45
  toy.castShadow = true
  group.add(toy)

  // Food scattered from the ransacked matchbox cabinet
  for (let i = 0; i < 6; i++) {
    const half = new THREE.Mesh(
      new THREE.SphereGeometry(0.24, 12, 8, 0, Math.PI), mat.acorn)
    half.position.set(8 + Math.random() * 3, 0.1, 4 + Math.random() * 3)
    half.rotation.set(Math.random(), Math.random() * Math.PI, Math.random())
    half.castShadow = true
    group.add(half)
  }

  add(group)
  return group
}

// Four blocked tunnel mouths spread around the non-exit arc + a silk web-bridge
// approach leading toward the west exit portal.
//
// The portal FRAME is already built by buildWalls() + buildExitPortal() —
// this adds the bridge surface and guide cables, and replaces buildBlockedPortal()
// with three additional blocked tunnels for a richer "world beyond" feel.
//
// Blocked angles chosen to avoid the exit gap (135°–225°):
//   0.50 rad ≈  29° (east-northeast)
//   1.55 rad ≈  89° (north)
//   4.55 rad ≈ 261° (south-southwest)
//   5.55 rad ≈ 318° (northwest)
export function buildExits(mat: DenMaterials, add: AddFn): THREE.Group {
  const group = new THREE.Group()

  const blockedAngles = [0.50, 1.55, 4.55, 5.55]
  for (const a of blockedAngles) {
    const r   = CHAMBER_R * 0.87
    const x   = Math.cos(a) * r
    const z   = Math.sin(a) * r
    const inX = Math.cos(a)    // unit vector pointing inward (toward center)
    const inZ = Math.sin(a)

    // Dark tunnel mouth disk
    const mouth = new THREE.Mesh(new THREE.CircleGeometry(2.1, 20), mat.earthDark)
    mouth.position.set(x, 2.5, z)
    mouth.lookAt(0, 2.5, 0)
    group.add(mouth)

    // Collapse rubble
    for (let i = 0; i < 6; i++) {
      const rock = new THREE.Mesh(
        new THREE.DodecahedronGeometry(0.5 + Math.random() * 0.6, 0), mat.earth)
      rock.position.set(
        x - inX * 0.8 + (Math.random() - 0.5) * 2.5,
        0.5 + Math.random() * 2.0,
        z - inZ * 0.8 + (Math.random() - 0.5) * 2.5,
      )
      rock.castShadow = rock.receiveShadow = true
      group.add(rock)
    }

    // Web seal over the collapse — spun shut
    const seal = new THREE.Mesh(new THREE.CircleGeometry(1.9, 16), mat.silkTorn)
    seal.position.set(x * 0.94, 2.0, z * 0.94)
    seal.lookAt(0, 2.0, 0)
    group.add(seal)
  }

  // Silk web-bridge surface leading to the west exit (toward -X).
  // PlaneGeometry(6, 1.6) after rotation.x gives 6 wu along X, 1.6 wu along Z.
  const walkGeo = new THREE.PlaneGeometry(6.0, 1.6, 6, 2)
  const walk    = new THREE.Mesh(walkGeo, mat.silk)
  walk.rotation.x = -Math.PI / 2 + 0.12   // slight forward tilt toward exit
  walk.position.set(-7.8, 0.5, 0)
  group.add(walk)

  // Guide cables flanking the bridge
  const bStart = new THREE.Vector3(-6.0, 1.6, 0)
  const bEnd   = new THREE.Vector3(-9.8, 0.6, 0)
  const off    = 0.85
  group.add(silkStrand(
    bStart.clone().add(new THREE.Vector3(0, 0,  off)),
    bEnd.clone().add(  new THREE.Vector3(0, 0,  off)),
    mat.silk, 0.15,
  ))
  group.add(silkStrand(
    bStart.clone().add(new THREE.Vector3(0, 0, -off)),
    bEnd.clone().add(  new THREE.Vector3(0, 0, -off)),
    mat.silk, 0.15,
  ))

  add(group)
  return group
}
