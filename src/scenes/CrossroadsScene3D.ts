import * as THREE from 'three'
import { disposeTree } from '../core/dispose'
import { physicsWorld, type CollisionBody } from '../core/PhysicsWorld'
import { registry } from '../core/Registry'
import type { Enemy3D } from '../entities/Enemy3D'
import { audio } from '../systems/AudioManager'
import { surface, PALETTE } from '../env/Materials'
import type { CrossroadsPoints } from '../systems/DenGuide'

// ─── The Crossroads ───────────────────────────────────────────────────────────
// The cave junction past the den's west door.  Six tunnels open off its far
// wall, and every one is shut — each by something different, each a promise
// of a later chapter:
//
//   drowned  black water to the roof          (later)
//   roots    knotted roots                    (later — fire)
//   ants     a twig gate + padlock            the toothpick picks it (den done)
//   hive     poured wax + a chain and lock    the Chitin Axe chops it
//   glow     a wall of glowing fungus         (later)
//   fall     an old rockfall                  (later)
//
// The den door is on the near (camera-side) wall.  Authored at creature scale
// 1.0, like the colony and the boss arena.  The room is an ellipse; walls
// facing the camera are low so the room reads from the iso view.

const RX = 9.5, RZ = 6.5        // floor ellipse radii
const WALL_H   = 3.4            // far wall
const FRONT_H  = 0.55           // near (camera-side) wall
const MOUTH_W  = 2.1
const MOUTH_H  = 2.35
const DEPTH    = 3.2            // tunnel stub behind each mouth
const WALL_T   = 0.9            // wall thickness (visual)
const ENTER_DEPTH = 1.7         // walk this far into an open tunnel to go through
const INTERACT_R  = 1.7
const DOOR_PHI = THREE.MathUtils.degToRad(45)

export type TunnelId = 'drowned' | 'roots' | 'ants' | 'hive' | 'glow' | 'fall'
export type CrossroadsEvent =
  | { kind: 'click' | 'unlock' | 'chop' | 'crumble'; x: number; z: number }
  | { kind: 'opened'; id: TunnelId }

interface TunnelDef { id: TunnelId; name: string; deg: number }
export const TUNNELS: TunnelDef[] = [
  { id: 'drowned', name: 'The Drowned Way', deg: 150 },
  { id: 'roots',   name: 'The Rootway',     deg: 180 },
  { id: 'ants',    name: 'The Ant Tunnel',  deg: 210 },
  { id: 'hive',    name: 'The Hive Tunnel', deg: 240 },
  { id: 'glow',    name: 'The Glowmire',    deg: 270 },
  { id: 'fall',    name: 'The Old Fall',    deg: 300 },
]
const LOCK_FLAG: Partial<Record<TunnelId, string>> = { ants: 'antLockOpen', hive: 'hiveLockOpen' }

interface Tunnel {
  def: TunnelDef
  m: THREE.Vector2            // mouth centre on the wall line
  n: THREE.Vector2            // outward normal (into the tunnel)
  t: THREE.Vector2            // tangent along the wall
  open: boolean
  blocker: CollisionBody | null
  group: THREE.Group          // local frame: +Z into the tunnel
  anim: { t: number; parts: AnimParts } | null
  parts: AnimParts
}
interface AnimParts {
  lock?: THREE.Group; shackle?: THREE.Object3D; gate?: THREE.Group; chain?: THREE.Object3D[]
  cells?: Array<{ mesh: THREE.Mesh; v: THREE.Vector3 }>
}

const ell = (phi: number) => new THREE.Vector2(RX * Math.cos(phi), RZ * Math.sin(phi))
const normalAt = (phi: number) => new THREE.Vector2(Math.cos(phi) / RX, Math.sin(phi) / RZ).normalize()
// Far side (toward −X −Z, away from the camera) is tall; the near side low
function wallHeight(phi: number): number {
  const c = Math.cos(phi - THREE.MathUtils.degToRad(225))
  const k = THREE.MathUtils.smoothstep(c, -0.6, 0.0)
  return FRONT_H + (WALL_H - FRONT_H) * k
}

export class CrossroadsScene3D {
  enemies: Enemy3D[] = []
  readonly tunnels: Tunnel[] = []

  private threeScene:  THREE.Scene
  private gradientMap: THREE.Texture
  private tracked:     THREE.Object3D[] = []
  private bodies:      CollisionBody[] = []
  private events:      CrossroadsEvent[] = []
  private door: { m: THREE.Vector2; n: THREE.Vector2; t: THREE.Vector2 }
  private glints: Array<{ mat: THREE.MeshToonMaterial; x: number; z: number; id: TunnelId }> = []
  private flicker: THREE.PointLight[] = []
  private clock = 0

  constructor(threeScene: THREE.Scene, gradientMap: THREE.Texture) {
    this.threeScene  = threeScene
    this.gradientMap = gradientMap
    audio.playLoop('amb_colony_entry')
    physicsWorld.setTerrain(null)
    physicsWorld.bounds = { minX: -14, maxX: 11.5, minZ: -11, maxZ: 9.5 }

    const dm = ell(DOOR_PHI), dn = normalAt(DOOR_PHI)
    this.door = { m: dm, n: dn, t: new THREE.Vector2(-dn.y, dn.x) }
    for (const def of TUNNELS) {
      const phi = THREE.MathUtils.degToRad(def.deg)
      const n = normalAt(phi)
      const flag = LOCK_FLAG[def.id]
      this.tunnels.push({
        def, m: ell(phi), n, t: new THREE.Vector2(-n.y, n.x),
        open: !!flag && !!registry.get<boolean>(flag),
        blocker: null, group: new THREE.Group(), anim: null, parts: {},
      })
    }

    this.buildFloor()
    this.buildWall()
    for (const tn of this.tunnels) this.buildTunnel(tn)
    this.buildDoor()
    this.buildTracks()
    this.buildLighting()
  }

  // ── Building ──────────────────────────────────────────────────────────────
  private buildFloor(): void {
    const mat = surface({ color: PALETTE.colonyFloor, tex: 'dirt', texScale: 0.5, gradientMap: this.gradientMap })
    const floor = new THREE.Mesh(new THREE.CircleGeometry(1, 64).rotateX(-Math.PI / 2).scale(RX + WALL_T + 0.4, 1, RZ + WALL_T + 0.4), mat)
    floor.receiveShadow = true
    this.add(floor)
    // A worn flat stone in the middle — the spot every story starts from
    const stone = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.25, 0.18, 9),
      surface({ color: PALETTE.colonyStone, tex: 'stone', texScale: 1, gradientMap: this.gradientMap }))
    stone.position.set(-0.8, 0.09, -0.4); stone.receiveShadow = true
    this.add(stone)
    // Pebbles and a few bones
    const peb = surface({ color: 0x6a5a48, tex: 'stone', texScale: 1.4, gradientMap: this.gradientMap })
    for (let i = 0; i < 26; i++) {
      const a = Math.random() * Math.PI * 2, r = 0.25 + Math.random() * 0.68
      const p = new THREE.Mesh(new THREE.DodecahedronGeometry(0.06 + Math.random() * 0.1, 0), peb)
      p.position.set(Math.cos(a) * RX * r, 0.04, Math.sin(a) * RZ * r)
      p.rotation.set(Math.random() * 3, Math.random() * 3, 0)
      this.add(p)
    }
  }

  // One continuous ribbon of rock around the ellipse: inner face, top, outer
  // face.  Over each mouth the wall starts at MOUTH_H (a lintel) instead of
  // the floor; colliders follow the same line, skipping the openings.
  private buildWall(): void {
    const N = 240
    const openings = [
      ...this.tunnels.map(tn => ({ m: tn.m, half: MOUTH_W / 2 + 0.15 })),
      { m: this.door.m, half: 1.25 },
    ]
    const wobble = (phi: number) => 1 + Math.sin(phi * 7) * 0.012 + Math.sin(phi * 17 + 1) * 0.008
    const pos: number[] = [], idx: number[] = []
    const inOpening = (p: THREE.Vector2) => openings.some(o => p.distanceTo(o.m) < o.half)
    const ring: Array<{ p: THREE.Vector2; n: THREE.Vector2; h: number; open: boolean }> = []
    for (let i = 0; i <= N; i++) {
      const phi = (i / N) * Math.PI * 2
      const p = ell(phi).multiplyScalar(wobble(phi))
      ring.push({ p, n: normalAt(phi), h: wallHeight(phi), open: inOpening(p) })
    }
    // Vertices per sample: inner-bottom, inner-top, outer-top, outer-bottom
    for (const s of ring) {
      // Over a mouth the wall becomes a lintel; a low wall just stops (the door)
      const bottom = !s.open ? 0 : s.h > MOUTH_H + 0.1 ? MOUTH_H : s.h
      const ox = s.p.x + s.n.x * WALL_T, oz = s.p.y + s.n.y * WALL_T
      pos.push(s.p.x, bottom, s.p.y,  s.p.x, s.h, s.p.y,  ox, s.h + 0.15, oz,  ox, bottom, oz)
    }
    for (let i = 0; i < N; i++) {
      const a = i * 4, b = (i + 1) * 4
      for (let f = 0; f < 3; f++) idx.push(a + f, b + f, a + f + 1,  b + f, b + f + 1, a + f + 1)
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    geo.setIndex(idx)
    geo.computeVertexNormals()
    const mat = surface({ color: PALETTE.colonyWall, tex: 'stone', texScale: 0.8, gradientMap: this.gradientMap })
    mat.side = THREE.DoubleSide
    const wall = new THREE.Mesh(geo, mat)
    wall.castShadow = wall.receiveShadow = true
    this.add(wall)

    // Colliders: a segment every few samples along the closed stretches
    const STEP = 4
    for (let i = 0; i < N; i += STEP) {
      const a = ring[i], b = ring[Math.min(N, i + STEP)]
      if (a.open || b.open) continue
      this.bodies.push(physicsWorld.addStaticSegment(a.p.x + a.n.x * 0.2, a.p.y + a.n.y * 0.2, b.p.x + b.n.x * 0.2, b.p.y + b.n.y * 0.2, 0.5))
    }
    // Close the little gaps the skipped segments leave beside each opening
    for (const o of openings) {
      const t = this.tunnels.find(tn => tn.m === o.m)?.t ?? this.door.t
      for (const sgn of [-1, 1]) {
        const x0 = o.m.x + t.x * sgn * (o.half + 0.05), z0 = o.m.y + t.y * sgn * (o.half + 0.05)
        this.bodies.push(physicsWorld.addStaticSegment(x0, z0, x0 + t.x * sgn * 0.9, z0 + t.y * sgn * 0.9, 0.5))
      }
    }

    // Rock lumps along the foot of the wall break up the clean line
    const lump = surface({ color: PALETTE.colonyStal, tex: 'stone', texScale: 1.1, gradientMap: this.gradientMap })
    for (let i = 0; i < 70; i++) {
      const phi = Math.random() * Math.PI * 2
      const p = ell(phi)
      if (inOpening(p)) continue
      const n = normalAt(phi)
      const s = 0.18 + Math.random() * 0.32
      const r = new THREE.Mesh(new THREE.DodecahedronGeometry(s, 0), lump)
      r.position.set(p.x - n.x * s * 0.4, s * 0.5, p.y - n.y * s * 0.4)
      r.rotation.set(Math.random() * 3, Math.random() * 3, 0)
      r.castShadow = true
      this.add(r)
    }
  }

  // Tunnel stub + its blocker, built in a local frame (+Z = into the tunnel)
  private buildTunnel(tn: Tunnel): void {
    const g = tn.group
    g.position.set(tn.m.x, 0, tn.m.y)
    g.rotation.y = Math.atan2(tn.n.x, tn.n.y)
    this.add(g)
    const dark = surface({ color: 0x3a2c20, tex: 'dirt', texScale: 0.8, gradientMap: this.gradientMap })
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(MOUTH_W + 0.4, DEPTH).rotateX(-Math.PI / 2).translate(0, 0.005, DEPTH / 2), dark)
    floor.receiveShadow = true
    g.add(floor)
    for (const sx of [-1, 1]) {
      const side = new THREE.Mesh(new THREE.BoxGeometry(0.5, MOUTH_H + 0.6, DEPTH), dark)
      side.position.set(sx * (MOUTH_W / 2 + 0.25), (MOUTH_H + 0.6) / 2, DEPTH / 2)
      g.add(side)
    }
    const roof = new THREE.Mesh(new THREE.BoxGeometry(MOUTH_W + 1, 0.4, DEPTH), dark)
    roof.position.set(0, MOUTH_H + 0.2, DEPTH / 2)
    g.add(roof)
    const back = new THREE.Mesh(new THREE.PlaneGeometry(MOUTH_W + 0.6, MOUTH_H + 0.4), new THREE.MeshBasicMaterial({ color: 0x030202 }))
    back.position.set(0, MOUTH_H / 2, DEPTH - 0.02); back.rotation.y = Math.PI
    g.add(back)
    // Jamb stones framing the mouth
    const jamb = surface({ color: PALETTE.colonyStone, tex: 'stone', texScale: 1.2, gradientMap: this.gradientMap })
    for (let k = 0; k < 9; k++) {
      const a = (k / 8) * Math.PI
      const s = 0.22 + Math.random() * 0.12
      const st = new THREE.Mesh(new THREE.DodecahedronGeometry(s, 0), jamb)
      st.position.set(Math.cos(a) * (MOUTH_W / 2 + 0.2), Math.min(MOUTH_H + 0.1, Math.sin(a) * (MOUTH_H + 0.15) + (a < 0.3 || a > 2.84 ? 0.3 : 0)), -0.15)
      st.rotation.set(Math.random() * 3, Math.random() * 3, 0)
      g.add(st)
    }

    // Recess colliders (sides + back), in world space
    const w = (lx: number, lz: number) => new THREE.Vector2(tn.m.x + tn.t.x * lx + tn.n.x * lz, tn.m.y + tn.t.y * lx + tn.n.y * lz)
    for (const sx of [-1, 1]) {
      const a = w(sx * (MOUTH_W / 2 + 0.15), -0.2), b = w(sx * (MOUTH_W / 2 + 0.15), DEPTH)
      this.bodies.push(physicsWorld.addStaticSegment(a.x, a.y, b.x, b.y, 0.3))
    }
    const b0 = w(-MOUTH_W / 2 - 0.2, DEPTH - 0.2), b1 = w(MOUTH_W / 2 + 0.2, DEPTH - 0.2)
    this.bodies.push(physicsWorld.addStaticSegment(b0.x, b0.y, b1.x, b1.y, 0.3))

    this.buildBlocker(tn)
    if (!tn.open) {
      const p0 = w(-MOUTH_W / 2 - 0.1, 0.35), p1 = w(MOUTH_W / 2 + 0.1, 0.35)
      tn.blocker = physicsWorld.addStaticSegment(p0.x, p0.y, p1.x, p1.y, 0.4)
      this.bodies.push(tn.blocker)
    }
  }

  private toon(color: number, emissive = 0, ei = 0): THREE.MeshToonMaterial {
    const m = new THREE.MeshToonMaterial({ color, gradientMap: this.gradientMap })
    if (emissive) { m.emissive = new THREE.Color(emissive); m.emissiveIntensity = ei }
    return m
  }

  private buildBlocker(tn: Tunnel): void {
    const g = tn.group
    const id = tn.def.id
    const glintAt = (mat: THREE.MeshToonMaterial) => {
      const p = this.lockPoint(tn)
      this.glints.push({ mat, x: p.x, z: p.y, id })
    }

    if (id === 'drowned') {
      const water = new THREE.Mesh(new THREE.PlaneGeometry(MOUTH_W + 0.2, DEPTH + 0.3).rotateX(-Math.PI / 2),
        new THREE.MeshStandardMaterial({ color: 0x0a1820, roughness: 0.08, metalness: 0.3, emissive: 0x06202c, emissiveIntensity: 0.6 }))
      water.position.set(0, 0.12, DEPTH / 2 - 0.1); g.add(water)
      // Water right up to the roof: a dark, glossy wall just inside the mouth
      const sheet = new THREE.Mesh(new THREE.PlaneGeometry(MOUTH_W, MOUTH_H),
        new THREE.MeshStandardMaterial({ color: 0x0b1d26, roughness: 0.05, metalness: 0.4, emissive: 0x041822, emissiveIntensity: 0.8, transparent: true, opacity: 0.88 }))
      sheet.position.set(0, MOUTH_H / 2, 0.55); g.add(sheet)
      const mud = this.toon(0x3b2a1a)
      for (let k = 0; k < 6; k++) {
        const b = new THREE.Mesh(new THREE.SphereGeometry(0.32 + Math.random() * 0.2, 8, 6), mud)
        b.position.set(-0.9 + k * 0.36, 0.08, 0.2 + Math.random() * 0.2); b.scale.y = 0.4
        g.add(b)
      }
      return
    }
    if (id === 'roots') {
      const root = this.toon(0x5b3a22)
      for (let k = 0; k < 11; k++) {
        const y0 = Math.random() * MOUTH_H, y1 = Math.random() * MOUTH_H
        const pts = [new THREE.Vector3(-MOUTH_W / 2 - 0.2, y0, 0.3 + Math.random() * 0.4),
                     new THREE.Vector3((Math.random() - 0.5) * 0.8, (y0 + y1) / 2 + (Math.random() - 0.5), Math.random() * 0.5),
                     new THREE.Vector3(MOUTH_W / 2 + 0.2, y1, 0.3 + Math.random() * 0.4)]
        const tube = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 10, 0.09 + Math.random() * 0.1, 6), root)
        tube.castShadow = true
        g.add(tube)
      }
      return
    }
    if (id === 'glow') {
      const stem = this.toon(0xbfc8a8)
      const cap  = this.toon(0x5fe0b0, 0x2fc890, 0.9)
      for (let k = 0; k < 16; k++) {
        const x = (Math.random() - 0.5) * MOUTH_W, y = Math.random() * (MOUTH_H - 0.3), s = 0.15 + Math.random() * 0.22
        const st = new THREE.Mesh(new THREE.CylinderGeometry(s * 0.25, s * 0.3, s * 1.2, 6), stem)
        st.position.set(x, y + s * 0.6, 0.3); g.add(st)
        const c = new THREE.Mesh(new THREE.SphereGeometry(s, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), cap)
        c.position.set(x, y + s * 1.2, 0.3); c.rotation.x = -0.4; g.add(c)
      }
      const haze = new THREE.Mesh(new THREE.PlaneGeometry(MOUTH_W, MOUTH_H),
        new THREE.MeshBasicMaterial({ color: 0x2c6a50, transparent: true, opacity: 0.35, depthWrite: false }))
      haze.position.set(0, MOUTH_H / 2, 0.5); g.add(haze)
      return
    }
    if (id === 'fall') {
      const rock = surface({ color: 0x6b6156, tex: 'stone', texScale: 1.2, gradientMap: this.gradientMap })
      for (let k = 0; k < 9; k++) {
        const s = 0.35 + Math.random() * 0.35
        const r = new THREE.Mesh(new THREE.DodecahedronGeometry(s, 0), rock)
        r.position.set((Math.random() - 0.5) * MOUTH_W, s * 0.7 + (k > 5 ? 0.9 : 0), 0.3 + Math.random() * 0.6)
        r.rotation.set(Math.random() * 3, Math.random() * 3, 0); r.castShadow = true
        g.add(r)
      }
      return
    }
    if (id === 'ants') {
      // Twig gate (hinged on the left jamb) + a crude padlock on a chain
      const gate = new THREE.Group()
      gate.position.set(-MOUTH_W / 2, 0, 0.3)
      const twig = this.toon(0x7a5532)
      for (let k = 0; k < 7; k++) {
        const v = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, MOUTH_H - 0.1, 5), twig)
        v.position.set(0.15 + k * 0.3, (MOUTH_H - 0.1) / 2, 0); v.rotation.z = (Math.random() - 0.5) * 0.06
        gate.add(v)
      }
      for (const y of [0.4, 1.2, 2.0]) {
        const hbar = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, MOUTH_W, 5).rotateZ(Math.PI / 2), twig)
        hbar.position.set(MOUTH_W / 2, y, -0.06); gate.add(hbar)
      }
      g.add(gate)
      const chainMat = this.toon(0x6e6a64)
      const chain: THREE.Object3D[] = []
      for (let k = 0; k < 7; k++) {
        const link = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.022, 5, 10), chainMat)
        link.position.set(0.55 + k * 0.11, 1.15, -0.02); link.rotation.y = k % 2 ? Math.PI / 2 : 0
        gate.add(link); chain.push(link)
      }
      const lockMat = this.toon(0xc9a24a, 0xffd28a, 0)
      const lock = new THREE.Group()
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.32, 0.12), lockMat)
      const shackle = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.03, 6, 12, Math.PI), chainMat)
      shackle.position.y = 0.16
      const hole = new THREE.Mesh(new THREE.CircleGeometry(0.035, 8), new THREE.MeshBasicMaterial({ color: 0x1a1208 }))
      hole.position.set(0, -0.04, -0.061); hole.rotation.y = Math.PI
      lock.add(body, shackle, hole)
      lock.position.set(0, 0.95, -0.12)
      g.add(lock)
      tn.parts = { gate, lock, shackle, chain }
      glintAt(lockMat)
      if (tn.open) { gate.rotation.y = -1.75; lock.visible = false; for (const c of chain) c.visible = false }
      return
    }
    // hive: poured wax comb + a heavy chain and lock
    const waxMat = this.toon(0xd9a43a, 0x8a5a10, 0.22)
    const cells: Array<{ mesh: THREE.Mesh; v: THREE.Vector3 }> = []
    const R = 0.2
    for (let row = 0; row * R * 1.5 < MOUTH_H + 0.2; row++) {
      for (let col = 0; col * R * 1.73 < MOUTH_W + 0.4; col++) {
        const cell = new THREE.Mesh(new THREE.CylinderGeometry(R, R, 0.3, 6).rotateX(Math.PI / 2), waxMat)
        cell.position.set(-MOUTH_W / 2 - 0.1 + col * R * 1.73 + (row % 2) * R * 0.87, R + row * R * 1.5, 0.35 + Math.random() * 0.06)
        cell.rotation.z = Math.PI / 6
        g.add(cell)
        cells.push({ mesh: cell, v: new THREE.Vector3() })
      }
    }
    const iron = this.toon(0x4a4a4e)
    const chain: THREE.Object3D[] = []
    for (const dir of [1, -1]) {
      for (let k = 0; k < 14; k++) {
        const t = k / 13
        const link = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.03, 5, 10), iron)
        link.position.set(dir * (-MOUTH_W / 2 + t * MOUTH_W), 0.3 + t * (MOUTH_H - 0.6), 0.12)
        link.rotation.set(k % 2 ? Math.PI / 2 : 0, 0, Math.atan2(MOUTH_H - 0.6, MOUTH_W) * dir)
        g.add(link); chain.push(link)
      }
    }
    const lockMat = this.toon(0x5a5a60, 0xffd28a, 0)
    const lock = new THREE.Group()
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.48, 0.18), lockMat)
    const shackle = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.045, 6, 12, Math.PI), iron)
    shackle.position.y = 0.24
    lock.add(body, shackle)
    lock.position.set(0, 1.05, 0.02)
    g.add(lock)
    tn.parts = { lock, shackle, chain, cells }
    glintAt(lockMat)
    if (tn.open) { lock.visible = false; for (const c of chain) c.visible = false; for (const c of cells) c.mesh.visible = false }

    // Mum's thread: after the Anteater, a single strand runs out from under the wax
    if ((registry.get<string[]>('bossesDefeated') ?? []).length > 0) {
      const pts = [new THREE.Vector3(0.3, 0.02, 0.6), new THREE.Vector3(0.5, 0.03, -0.8), new THREE.Vector3(1.4, 0.02, -2.2), new THREE.Vector3(1.2, 0.02, -3.4)]
      const thread = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, 0.018, 4),
        new THREE.MeshBasicMaterial({ color: 0xf4f0ff }))
      g.add(thread)
    }
  }

  // The door back to the den: a warm opening in the low near wall
  private buildDoor(): void {
    const g = new THREE.Group()
    g.position.set(this.door.m.x, 0, this.door.m.y)
    g.rotation.y = Math.atan2(this.door.n.x, this.door.n.y)
    this.add(g)
    const wood = this.toon(0x6a4a2a)
    for (const sx of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.13, 1.1, 6), wood)
      post.position.set(sx * 1.2, 0.55, 0); g.add(post)
    }
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 2.2).rotateX(-Math.PI / 2).translate(0, 0.006, 1.1),
      surface({ color: 0x5c4430, tex: 'dirt', texScale: 0.8, gradientMap: this.gradientMap }))
    g.add(floor)
    // Den light spilling through
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(2.3, 1.6).rotateX(-Math.PI / 2).translate(0, 0.01, 1.2),
      new THREE.MeshBasicMaterial({ color: 0xffb066, transparent: true, opacity: 0.22, depthWrite: false, blending: THREE.AdditiveBlending }))
    g.add(glow)
    const light = new THREE.PointLight(0xffaa55, 1.6, 7, 2)
    light.position.set(0, 1.2, 1.4); g.add(light)
    this.flicker.push(light)
    // Short walls either side of the passage
    const rock = surface({ color: PALETTE.colonyWall, tex: 'stone', texScale: 0.8, gradientMap: this.gradientMap })
    for (const sx of [-1, 1]) {
      const side = new THREE.Mesh(new THREE.BoxGeometry(0.5, FRONT_H + 0.2, 2.4), rock)
      side.position.set(sx * 1.45, (FRONT_H + 0.2) / 2, 1.2); g.add(side)
      const a = this.local(this.door, sx * 1.4, 0), b = this.local(this.door, sx * 1.4, 2.4)
      this.bodies.push(physicsWorld.addStaticSegment(a.x, a.y, b.x, b.y, 0.4))
    }
    const e0 = this.local(this.door, -1.6, 2.5), e1 = this.local(this.door, 1.6, 2.5)
    this.bodies.push(physicsWorld.addStaticSegment(e0.x, e0.y, e1.x, e1.y, 0.3))
  }

  private local(f: { m: THREE.Vector2; n: THREE.Vector2; t: THREE.Vector2 }, lx: number, lz: number): THREE.Vector2 {
    return new THREE.Vector2(f.m.x + f.t.x * lx + f.n.x * lz, f.m.y + f.t.y * lx + f.n.y * lz)
  }

  // Ant tracks from the den door to the ant tunnel: rows of tiny prints
  private buildTracks(): void {
    const ants = this.tunnel('ants')
    const a = this.local(this.door, 0, -0.5)
    const b = this.local(ants, 0, -0.4)
    const mid = new THREE.Vector2(-1.2, 1.6)
    const n = 150
    const dot = new THREE.InstancedMesh(new THREE.CircleGeometry(0.03, 5).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0x1a120a, transparent: true, opacity: 0.75 }), n * 3)
    const m = new THREE.Matrix4(), q = new THREE.Vector2(), d = new THREE.Vector2()
    let k = 0
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1), u = 1 - t
      q.set(u * u * a.x + 2 * u * t * mid.x + t * t * b.x, u * u * a.y + 2 * u * t * mid.y + t * t * b.y)
      d.set(2 * u * (mid.x - a.x) + 2 * t * (b.x - mid.x), 2 * u * (mid.y - a.y) + 2 * t * (b.y - mid.y)).normalize()
      for (let j = 0; j < 3; j++) {
        const side = (j - 1) * 0.09 + (Math.random() - 0.5) * 0.04
        const lane = (Math.random() - 0.5) * 0.7   // many ants, a wide trail
        m.makeTranslation(q.x - d.y * (side + lane), 0.012, q.y + d.x * (side + lane))
        dot.setMatrixAt(k++, m)
      }
    }
    this.add(dot)
  }

  private buildLighting(): void {
    const shaft = new THREE.SpotLight(0xcfe0ff, 1.6, 22, Math.PI / 5, 0.6, 1.5)
    shaft.position.set(-1, 9, 0.5); shaft.target.position.set(-1.5, 0, -1.5)
    this.add(shaft); this.add(shaft.target)
    const glowColor: Partial<Record<TunnelId, number>> = { drowned: 0x3a8ab0, hive: 0xffb040, glow: 0x50e0a0, ants: 0xffd8a0 }
    for (const tn of this.tunnels) {
      const c = glowColor[tn.def.id]
      if (!c) continue
      const l = new THREE.PointLight(c, tn.def.id === 'hive' ? 0.6 : 0.8, 5, 2)
      const p = this.local(tn, 0, tn.def.id === 'ants' ? -0.9 : tn.def.id === 'hive' ? 1.8 : 0.9)
      l.position.set(p.x, 1.5, p.y)
      this.add(l)
      if (tn.def.id === 'hive' || tn.def.id === 'glow') this.flicker.push(l)
    }
  }

  // ── Queries ───────────────────────────────────────────────────────────────
  private tunnel(id: TunnelId): Tunnel { return this.tunnels.find(t => t.def.id === id)! }
  isOpen(id: TunnelId): boolean { return this.tunnel(id).open }
  tunnelName(id: TunnelId): string { return this.tunnel(id).def.name }

  // Where to stand to interact: just in front of the mouth
  private lockPoint(tn: Tunnel): THREE.Vector2 { return this.local(tn, 0, -0.5) }

  nearTunnel(px: number, pz: number): TunnelId | null {
    for (const tn of this.tunnels) {
      if (tn.open || tn.anim) continue
      const p = this.lockPoint(tn)
      if ((px - p.x) ** 2 + (pz - p.y) ** 2 < INTERACT_R * INTERACT_R) return tn.def.id
    }
    return null
  }

  // Walked deep enough into an open tunnel
  enteredTunnel(px: number, pz: number): TunnelId | null {
    for (const tn of this.tunnels) {
      if (!tn.open) continue
      const dx = px - tn.m.x, dz = pz - tn.m.y
      const depth = dx * tn.n.x + dz * tn.n.y, side = dx * tn.t.x + dz * tn.t.y
      if (depth > ENTER_DEPTH && Math.abs(side) < MOUTH_W / 2) return tn.def.id
    }
    return null
  }

  atDenDoor(px: number, pz: number): boolean {
    const dx = px - this.door.m.x, dz = pz - this.door.m.y
    return dx * this.door.n.x + dz * this.door.n.y > 1.0
  }

  spawnFromDen(): THREE.Vector2 { return this.local(this.door, 0, -1.3) }
  spawnFromTunnel(id: TunnelId): THREE.Vector2 { return this.local(this.tunnel(id), 0, 0.6) }
  // Push Webbs back out of a tunnel that leads nowhere yet
  tunnelMouth(id: TunnelId): THREE.Vector2 { return this.local(this.tunnel(id), 0, -0.9) }

  guidePoints(): CrossroadsPoints {
    const ants = this.tunnel('ants'), hive = this.tunnel('hive')
    const p = (v: THREE.Vector2) => ({ x: v.x, z: v.y })
    return { antLock: p(this.lockPoint(ants)), hiveLock: p(this.lockPoint(hive)), antTunnel: p(this.local(ants, 0, 1.2)), door: p(this.door.m) }
  }

  // ── Opening a lock ────────────────────────────────────────────────────────
  // ants: the toothpick works the padlock, the shackle pops, the gate swings.
  // hive: the axe bites the chain, the lock drops, the wax caves in.
  openLock(id: 'ants' | 'hive'): void {
    const tn = this.tunnel(id)
    if (tn.open || tn.anim) return
    tn.anim = { t: 0, parts: tn.parts }
    if (id === 'hive') for (const c of tn.parts.cells ?? []) {
      c.v.set((Math.random() - 0.5) * 1.6, 0.5 + Math.random() * 1.5, -0.6 - Math.random() * 1.6)
    }
  }

  takeEvents(): CrossroadsEvent[] { const e = this.events; this.events = []; return e }

  update(dt: number, px: number, pz: number): void {
    this.clock += dt
    for (let i = 0; i < this.flicker.length; i++) {
      const l = this.flicker[i]
      const base = l.userData.baseIntensity ?? (l.userData.baseIntensity = l.intensity)
      l.intensity = base * (0.88 + Math.sin(this.clock * 7 + i * 2) * 0.06 + Math.sin(this.clock * 19 + i) * 0.04)
    }
    for (const gl of this.glints) {
      const tn = this.tunnel(gl.id)
      const d = Math.hypot(px - gl.x, pz - gl.z)
      gl.mat.emissiveIntensity = tn.open || tn.anim ? 0 : Math.max(0, 1 - d / (INTERACT_R * 2.5)) * 0.7
    }
    for (const tn of this.tunnels) if (tn.anim) this.animate(tn, dt)
  }

  private animate(tn: Tunnel, dt: number): void {
    const a = tn.anim!
    const t0 = a.t
    a.t += dt
    const t = a.t, P = a.parts
    const at = (s: number) => t0 < s && t >= s
    const world = (o: THREE.Object3D) => { const v = o.getWorldPosition(new THREE.Vector3()); return { x: v.x, z: v.z } }
    if (tn.def.id === 'ants') {
      // 0–0.9 picking: the lock jiggles, clicks
      if (t < 0.9 && P.lock) { P.lock.rotation.z = Math.sin(t * 40) * 0.08; P.lock.rotation.x = Math.sin(t * 27) * 0.05 }
      for (const s of [0.15, 0.4, 0.62]) if (at(s) && P.lock) this.events.push({ kind: 'click', ...world(P.lock) })
      if (at(0.9) && P.lock) { this.events.push({ kind: 'unlock', ...world(P.lock) }); P.lock.rotation.set(0, 0, 0) }
      if (t >= 0.9 && P.shackle) P.shackle.position.y = 0.16 + Math.min(0.12, (t - 0.9) * 0.6)
      if (t >= 1.05 && P.lock) {   // the lock drops
        const k = t - 1.05
        P.lock.position.y = Math.max(0.16, 0.95 - k * k * 9)
        P.lock.rotation.z = Math.min(1.4, k * 4)
      }
      if (t >= 1.1 && P.chain) for (const c of P.chain) c.position.y = Math.max(0.05, 1.15 - (t - 1.1) ** 2 * 8)
      if (t >= 1.3 && P.gate) P.gate.rotation.y = -1.75 * THREE.MathUtils.smoothstep(t, 1.3, 2.1)
      if (t >= 2.1) this.finishOpen(tn)
      return
    }
    // hive
    if (at(0.05) && P.lock) this.events.push({ kind: 'chop', ...world(P.lock) })
    if (t >= 0.05 && P.chain) {
      const k = t - 0.05
      P.chain.forEach((c, i) => {
        const dir = i < P.chain!.length / 2 ? -1 : 1
        c.position.x += dir * dt * (1.5 + (i % 5) * 0.2)
        c.position.y = Math.max(0.05, c.position.y - k * dt * 9)
        c.rotation.x += dt * 6
      })
    }
    if (t >= 0.1 && P.lock) { const k = t - 0.1; P.lock.position.y = Math.max(0.24, 1.05 - k * k * 9); P.lock.rotation.z = Math.min(1.5, k * 5) }
    if (at(0.45) && P.lock) this.events.push({ kind: 'crumble', ...world(P.lock) })
    if (t >= 0.45 && P.cells) {
      for (const c of P.cells) {
        c.v.y -= 9 * dt
        c.mesh.position.addScaledVector(c.v, dt)
        if (c.mesh.position.y < 0.15) { c.mesh.position.y = 0.15; c.v.multiplyScalar(0.4) }
        const s = Math.max(0, 1 - (t - 1.2) * 1.4)
        c.mesh.scale.setScalar(s)
        c.mesh.visible = s > 0.01
      }
    }
    if (t >= 2.0) this.finishOpen(tn)
  }

  private finishOpen(tn: Tunnel): void {
    tn.anim = null
    tn.open = true
    if (tn.blocker) {
      physicsWorld.remove(tn.blocker)
      this.bodies.splice(this.bodies.indexOf(tn.blocker), 1)
      tn.blocker = null
    }
    this.events.push({ kind: 'opened', id: tn.def.id })
  }

  updateEnemies(_delta: number, _px: number, _pz: number): void {}

  destroy(): void {
    audio.stopLoop('amb_colony_entry')
    for (const b of this.bodies) physicsWorld.remove(b)
    this.bodies = []
    for (const obj of this.tracked) disposeTree(obj)
    this.tracked = []
    physicsWorld.bounds = null
  }

  private add(obj: THREE.Object3D): void {
    this.tracked.push(obj)
    this.threeScene.add(obj)
  }
}
