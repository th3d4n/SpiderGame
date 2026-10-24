import * as THREE from 'three'
import { disposeTree } from '../core/dispose'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { surface, PALETTE, patchMaterial, CUTAWAY } from '../env/Materials'
import { buildMaterialPickup, buildHealthBerry, buildChest, buildWorkbench as buildWorkbenchProp, type ChestParts } from '../env/Props'
import { physicsWorld, type CollisionBody } from '../core/PhysicsWorld'
import { Enemy3D } from '../entities/Enemy3D'
import { CentipedeAmbusher3D } from '../entities/CentipedeAmbusher3D'
import { BeetleTank3D } from '../entities/BeetleTank3D'
import { AntWorker3D } from '../entities/AntWorker3D'
import { JumpingSpider3D } from '../entities/JumpingSpider3D'
import { AntSoldier3D } from '../entities/AntSoldier3D'
import { PheromoneSac3D } from '../entities/PheromoneSac3D'
import type { InkOutlinePass } from '../core/InkOutlinePass'
import { registry } from '../core/Registry'
import { audio, type SoundKey } from '../systems/AudioManager'
import { ColonyMaze, TILE, TW, TH, MIN_X, MIN_Z, MAX_X, MAX_Z, type Room } from './colony/ColonyMaze'
import { ColonyVision } from './colony/ColonyVision'
import { ColonyTraps, type TrapEvent } from './colony/ColonyTraps'
import { ColonyDirector } from './colony/ColonyDirector'

// ─── Ant colony ───────────────────────────────────────────────────────────────
// A dark labyrinth of ant tunnels between Webbs' den (east) and the Queen's
// tunnel (west).  The way west is sealed with resin, held by three pheromone
// sacs in deep chambers — find and burst them, and every burst wakes the
// colony.  Soldier ants patrol, hear, see and hunt through the maze; traps
// wait in the corridors; loot sits in dead ends, guarded or trapped.
//
// Systems: ColonyMaze (layout, line of sight, pathfinding) · ColonyVision
// (line-of-sight darkness) · ColonyTraps · ColonyDirector (alarm, hunters,
// scares, HUD).  Tall walls cut away around Webbs (Materials CUTAWAY).

const WALL_H = 1.7
const SAC_KEY = 'colonySacs'

export type ColonyEvent =
  | TrapEvent
  | { kind: 'sac'; remaining: number }
  | { kind: 'sealOpen' }
  | { kind: 'kill'; x: number; z: number }       // any death — weapon, trap or pit
  | { kind: 'heal'; amount: number; x: number; z: number }

interface ChestRecord {
  x: number; z: number; isMimic: boolean; opened: boolean
  mesh: THREE.Group; parts: ChestParts; openT: number; wakeProgress: number; wakeActive: boolean
}
interface PickupRecord { x: number; z: number; collected: boolean; mesh: THREE.Object3D | null; mat?: string; qty?: number }

const CHEST_LOOT = [
  { mat: 'SilkThread',  qty: 3 }, { mat: 'ChitinShard', qty: 2 },
  { mat: 'WebFluid',    qty: 2 }, { mat: 'BoneFragment', qty: 2 },
  { mat: 'BugPartsAnt', qty: 3 }, { mat: 'DriedFungus', qty: 1 },
]
const CACHE_MATS = ['SilkThread', 'ChitinShard', 'BugPartsAnt', 'WebFluid', 'BoneFragment', 'DriedFungus']

// Kills: always XP; half the time the body leaves a drop of healing nectar
const DROP_CHANCE = 0.5
const DROP_HEAL   = 15
const DROP_LIFE   = 20      // s before it soaks into the dirt (blinks for the last 4)

// Webbs' noise, as the soldiers hear it
const NOISE = { hit: { range: 8, alarm: 3 }, web: { range: 6, alarm: 1 } }

export class AntColonyScene3D {
  static readonly LEFT  = MIN_X
  static readonly RIGHT = MAX_X
  static readonly BACK  = MIN_Z
  static readonly FRONT = MAX_Z
  static readonly EXIT_RIGHT_X      = MAX_X - 0.25
  static readonly EXIT_LEFT_X       = MIN_X + 0.25
  static readonly SPAWN_FROM_HOME_X = MAX_X - 1.8
  static readonly SPAWN_FROM_BOSS_X = MIN_X + 1.8
  static readonly WORKBENCH_X       = MAX_X - 4.6
  static readonly OBJ_Z             = -3.2

  enemies: Enemy3D[] = []
  readonly maze: ColonyMaze

  private threeScene:  THREE.Scene
  private gradientMap: THREE.Texture
  private tracked:     THREE.Object3D[] = []
  private wallBodies:  CollisionBody[] = []
  private vision:      ColonyVision
  private traps:       ColonyTraps
  private director:    ColonyDirector
  private freeEnemies: Enemy3D[] = []
  private soldiers:    AntSoldier3D[] = []
  private chests:      ChestRecord[] = []
  private hpModules:   PickupRecord[] = []
  private caches:      PickupRecord[] = []
  private thistles:    PickupRecord[] = []
  private sacs:        Array<{ idx: number; enemy: PheromoneSac3D | null }> = []
  private sealBody:    CollisionBody | null = null
  private sealMesh:    THREE.Mesh | null = null
  private sealOpenT    = -1
  private events:      ColonyEvent[] = []
  private currentAmbZone: 'entry' | 'mid' | 'deep' | '' = ''
  private fungusMat = new THREE.MeshStandardMaterial({ color: 0x8affd8, emissive: 0x3affb0, emissiveIntensity: 1.8 })
  private boneMat:   THREE.MeshToonMaterial
  // Static decor is baked into one merged mesh per material (eggs, fungus,
  // bones were ~150 separate draw calls)
  private decor = new Map<THREE.Material, THREE.BufferGeometry[]>()
  // Guards hold their post: they engage within `leash` (path distance) and go
  // back home when you get well away (hysteresis ×1.6)
  private posts = new Map<Enemy3D, { x: number; z: number; leash: number; engaged: boolean; field: Int32Array | null }>()
  private counted = new Set<Enemy3D>()
  private drops: Array<{ x: number; z: number; mesh: THREE.Group; t: number }> = []

  constructor(threeScene: THREE.Scene, gradientMap: THREE.Texture, ink: InkOutlinePass) {
    this.threeScene  = threeScene
    this.gradientMap = gradientMap
    this.boneMat = new THREE.MeshToonMaterial({ color: 0xb8a882, gradientMap })
    this.maze = new ColonyMaze()

    physicsWorld.bounds = { minX: MIN_X - 1, maxX: MAX_X + 1, minZ: MIN_Z + 0.2, maxZ: MAX_Z - 0.2 }

    this.buildFloor()
    this.buildWalls()
    this.vision = new ColonyVision(this.maze, ink)
    const savedFog = registry.get<string>('fogReveal_antColony')
    if (savedFog) this.vision.restore(savedFog)
    this.traps = new ColonyTraps(threeScene, this.maze, gradientMap)
    this.director = new ColonyDirector(threeScene, this.maze, this.vision, {
      spawnHunter: (x, z, tx, tz) => {
        const s = this.addSoldier(x, z, [{ x, z }])
        s.rouse(tx, tz)
      },
      spawnSwarm: (x, z, n) => { for (let k = 0; k < n; k++) this.freeEnemies.push(new AntWorker3D(threeScene, x + (k % 2) * 0.4, z + Math.floor(k / 2) * 0.4, gradientMap)) },
      soldiers: () => this.soldiers,
      dust: (x, z, color, count) => this.events.push({ kind: 'dust', x, z, color, count }),
      shake: (amount, time) => this.events.push({ kind: 'shake', amount, time }),
    })

    // Enemies navigate the maze; soldiers report to the director
    AntSoldier3D.ctx = { maze: this.maze, alert: (x, z, from) => this.director.spotted(x, z, from), safe: (x, z) => this.safeAt(x, z) }
    Enemy3D.steer = (e, px, pz) => this.steer(e, px, pz)

    this.buildRooms()
    this.populateCorridors()
    this.buildSeal()
    this.buildLighting()
    this.flushDecor()
    this.updateObjective(false)
  }

  // Facade the game loop already uses for the colony's explored map
  get fog(): { update: (x: number, z: number) => void; serialize: () => string | null } {
    return { update: () => {}, serialize: () => this.vision.serialize() }
  }
  getBossPortalZ(): number { return 0 }

  // ── Layout ──────────────────────────────────────────────────────────────────
  private buildFloor(): void {
    const mat = surface({ color: PALETTE.colonyFloor, tex: 'dirt', texScale: 0.5, gradientMap: this.gradientMap })
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(TW * TILE + 4, TH * TILE).rotateX(-Math.PI / 2), mat)
    floor.receiveShadow = true
    this.add(floor)
    // Damp dark patches
    const patch = new THREE.MeshBasicMaterial({ color: 0x1a120a, transparent: true, opacity: 0.35, depthWrite: false })
    const geos: THREE.BufferGeometry[] = []
    for (let k = 0; k < 70; k++) {
      const x = MIN_X + Math.random() * TW * TILE, z = MIN_Z + Math.random() * TH * TILE
      if (this.maze.isSolidAt(x, z)) continue
      geos.push(new THREE.CircleGeometry(0.3 + Math.random() * 0.7, 10).rotateX(-Math.PI / 2).translate(x, 0.004, z))
    }
    const m = mergeGeometries(geos); geos.forEach(g => g.dispose())
    if (m) this.add(new THREE.Mesh(m, patch))
  }

  // Walls: merged rectangles, warped by a world-space noise field so they read
  // as dug earth (coincident vertices warp identically, so no seams open).
  // Sides get the dirt texture, tops a dark rooty crust.  Both cut away.
  private buildWalls(): void {
    const side = surface({ color: PALETTE.colonyWall, tex: 'dirt', texScale: 0.7, gradientMap: this.gradientMap })
    const top  = surface({ color: 0x2e2218, tex: 'dirt', texScale: 0.9, gradientMap: this.gradientMap })
    patchMaterial(side, { cutaway: true }); patchMaterial(top, { cutaway: true })
    const warp = (x: number, z: number) => [
      Math.sin(x * 2.3 + z * 1.1) * 0.07 + Math.sin(z * 3.7 - x * 0.7) * 0.05,
      Math.cos(z * 2.1 - x * 1.3) * 0.07 + Math.sin(x * 3.1 + z * 0.9) * 0.05,
    ]
    const geos: THREE.BufferGeometry[] = []
    for (const r of this.maze.wallRects()) {
      const w = (r.i1 - r.i0 + 1) * TILE, d = (r.j1 - r.j0 + 1) * TILE
      const cx = MIN_X + (r.i0 * TILE) + w / 2, cz = MIN_Z + (r.j0 * TILE) + d / 2
      const g = new THREE.BoxGeometry(w, WALL_H, d, Math.max(1, Math.round(w / 0.4)), 4, Math.max(1, Math.round(d / 0.4)))
      g.translate(cx, WALL_H / 2, cz)
      const pos = g.attributes.position as THREE.BufferAttribute
      for (let k = 0; k < pos.count; k++) {
        const x = pos.getX(k), y = pos.getY(k), z = pos.getZ(k)
        const [ox, oz] = warp(x, z)
        const hk = y / WALL_H               // feet stay put-ish, tops wander more
        pos.setXYZ(k, x + ox * (0.5 + hk), y > WALL_H - 0.01 ? WALL_H + Math.sin(x * 1.7) * Math.cos(z * 1.9) * 0.12 : y, z + oz * (0.5 + hk))
      }
      g.computeVertexNormals()
      geos.push(g)
      this.wallBodies.push(physicsWorld.addStaticBox(cx, cz, w / 2, d / 2))
    }
    // Split each box by face group (BoxGeometry: 0 +x, 1 −x, 2 top, 3 bottom,
    // 4 +z, 5 −z) into a top mesh and a sides mesh
    const tops: THREE.BufferGeometry[] = [], sides: THREE.BufferGeometry[] = []
    for (const g of geos) {
      const idx = g.index!.array
      const pick = (want: (gi: number) => boolean) => {
        const out: number[] = []
        g.groups.forEach((gr, gi) => { if (want(gi)) for (let k = gr.start; k < gr.start + gr.count; k++) out.push(idx[k]) })
        const c = g.clone(); c.setIndex(out); c.clearGroups(); return c
      }
      tops.push(pick(gi => gi === 2)); sides.push(pick(gi => gi !== 2 && gi !== 3))
      g.dispose()
    }
    for (const [list, mat] of [[sides, side], [tops, top]] as Array<[THREE.BufferGeometry[], THREE.Material]>) {
      const merged = mergeGeometries(list)
      list.forEach(g => g.dispose())
      if (!merged) continue
      const mesh = new THREE.Mesh(merged, mat)
      mesh.castShadow = mesh.receiveShadow = true
      this.add(mesh)
    }
    // Rubble and roots at the wall feet
    const stone = surface({ color: PALETTE.colonyStone, tex: 'stone', texScale: 1.2, gradientMap: this.gradientMap })
    const rocks: THREE.BufferGeometry[] = []
    for (let k = 0; k < 160; k++) {
      const i = Math.floor(Math.random() * TW), j = Math.floor(Math.random() * TH)
      if (this.maze.isSolid(i, j)) continue
      const nbr = [[1, 0], [-1, 0], [0, 1], [0, -1]].find(([a, b]) => this.maze.isSolid(i + a, j + b))
      if (!nbr) continue
      const x = this.maze.tileX(i) + nbr[0] * 0.3, z = this.maze.tileZ(j) + nbr[1] * 0.3
      const s = 0.06 + Math.random() * 0.12
      rocks.push(new THREE.DodecahedronGeometry(s, 0).translate(x, s * 0.5, z))
    }
    const rm = mergeGeometries(rocks); rocks.forEach(g => g.dispose())
    if (rm) { const m = new THREE.Mesh(rm, stone); m.castShadow = true; this.add(m) }
  }

  // ── Rooms ───────────────────────────────────────────────────────────────────
  private buildRooms(): void {
    const destroyed = registry.get<number[]>(SAC_KEY) ?? []
    let sacIdx = 0
    for (const room of this.maze.rooms) {
      switch (room.role) {
        case 'entry':   this.buildEntry(room); break
        case 'boss':    this.buildBossRoom(room); break
        case 'nest':    this.buildNest(room); break
        case 'pit':     this.buildPit(room); break
        case 'crystal': this.buildCrystal(room); break
        case 'sac':     this.buildSacRoom(room, sacIdx, destroyed.includes(sacIdx)); sacIdx++; break
      }
    }
  }

  private buildEntry(room: Room): void {
    const { group } = buildWorkbenchProp(this.gradientMap, 1)
    group.position.set(AntColonyScene3D.WORKBENCH_X, 0, AntColonyScene3D.OBJ_Z)
    group.rotation.y = Math.PI / 4
    this.add(group)
    const b = physicsWorld.addFootprint(group, 1.0)
    if (b) this.wallBodies.push(b)
    // The last of the den's silk markers, and a soft warm light behind you
    const silk = new THREE.MeshBasicMaterial({ color: 0xece4d6, transparent: true, opacity: 0.5, depthWrite: false })
    for (let k = 0; k < 5; k++) {
      const strand = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 1.6, 3), silk)
      strand.position.set(room.x + 1 + k * 0.5, 0.8, (k - 2) * 0.6); strand.rotation.z = 0.3 - k * 0.15
      this.add(strand)
    }
    this.buildPortalArch(MAX_X - 0.2, 0, 0x88aaff)
  }

  private buildBossRoom(room: Room): void {
    // Bones of the ones who tried, a beetle on guard, the red glow of the gate
    this.scatterBones(room.x, room.z, room.w * 0.4, 10)
    this.spawn(new BeetleTank3D(this.threeScene, room.x + 1, room.z + 1.5, this.gradientMap))
    this.buildPortalArch(MIN_X + 0.2, 0, 0xff4422)
  }

  private buildNest(room: Room): void {
    // Egg clusters and larvae; workers tend them; a red queen-scent glow
    const egg = new THREE.MeshStandardMaterial({ color: 0xf2ead8, roughness: 0.3, emissive: 0x2a2010, emissiveIntensity: 0.4 })
    for (let c = 0; c < 6; c++) {
      const cx = room.x + (Math.random() - 0.5) * room.w * 0.75, cz = room.z + (Math.random() - 0.5) * room.d * 0.75
      for (let k = 0; k < 7; k++) {
        this.batch(new THREE.SphereGeometry(0.09, 8, 6), egg,
          [cx + (Math.random() - 0.5) * 0.5, 0.07, cz + (Math.random() - 0.5) * 0.5], [0, Math.random() * 3, 0], [1, 0.75, 1.5])
      }
    }
    for (let k = 0; k < 7; k++) {
      this.spawn(new AntWorker3D(this.threeScene, room.x + (Math.random() - 0.5) * room.w * 0.6, room.z + (Math.random() - 0.5) * room.d * 0.6, this.gradientMap))
    }
    const red = new THREE.PointLight(0xff3a1a, 1.4, 7, 2)
    red.position.set(room.x, 1.2, room.z); this.add(red)
  }

  private buildPit(room: Room): void {
    this.traps.addPit(room.x, room.z, Math.min(room.w, room.d) * 0.46)
    this.scatterBones(room.x, room.z, 1.2, 6)
    // The lure: a chest on the far side of the sand
    this.addChest(room.x - room.w * 0.36, room.z + room.d * 0.38, false)
  }

  private buildCrystal(room: Room): void {
    const mat = new THREE.MeshStandardMaterial({ color: 0x8fd8ff, emissive: 0x3a9adf, emissiveIntensity: 1.6, roughness: 0.15 })
    for (let k = 0; k < 9; k++) {
      const c = new THREE.Mesh(new THREE.OctahedronGeometry(0.14 + Math.random() * 0.2, 0), mat)
      c.scale.y = 1.8 + Math.random()
      c.position.set(room.x + (Math.random() - 0.5) * room.w * 0.7, 0.25, room.z - room.d * 0.3 + (Math.random() - 0.5) * 0.8)
      c.rotation.set(Math.random() * 0.4, Math.random() * 3, Math.random() * 0.4)
      this.add(c)
    }
    const blue = new THREE.PointLight(0x66ccff, 1.5, 6, 2)
    blue.position.set(room.x, 0.9, room.z - room.d * 0.2); this.add(blue)
    // A rare calm spot: a real chest and a berry
    this.addChest(room.x + 0.8, room.z + 0.6, false)
    this.addBerry(room.x - 0.8, room.z + 0.8)
  }

  private buildSacRoom(room: Room, idx: number, burst: boolean): void {
    this.scatterBones(room.x, room.z, room.w * 0.35, 5)
    if (burst) {
      // A dried, split husk where it was
      const husk = new THREE.Mesh(new THREE.SphereGeometry(0.5, 14, 10, 0, Math.PI * 2, 0.9, 2.2), new THREE.MeshToonMaterial({ color: 0x5a3a18, gradientMap: this.gradientMap, side: THREE.DoubleSide }))
      husk.position.set(room.x, 0.2, room.z); husk.scale.y = 0.5; this.add(husk)
      this.sacs.push({ idx, enemy: null })
    } else {
      const sac = new PheromoneSac3D(this.threeScene, room.x, room.z, this.gradientMap)
      sac.onBurst = () => this.onSacBurst(idx, room)
      this.spawn(sac)
      this.sacs.push({ idx, enemy: sac })
    }
    // Each chamber is held differently
    if (idx === 0) {
      this.spawn(new BeetleTank3D(this.threeScene, room.x + 1.4, room.z + 1.2, this.gradientMap))
      this.spawn(new CentipedeAmbusher3D(this.threeScene, room.x - 1.6, room.z + 1.4, this.gradientMap))
      this.spawn(new CentipedeAmbusher3D(this.threeScene, room.x + 1.6, room.z - 1.4, this.gradientMap))
    } else if (idx === 1) {
      const c = this.maze.cellOf(room.x, room.z)
      this.addSoldier(room.x + 1.2, room.z, [
        { x: room.x + 1.5, z: room.z - 1.2 }, { x: room.x - 1.5, z: room.z - 1.2 },
        { x: room.x - 1.5, z: room.z + 1.2 }, { x: this.maze.cellX(Math.max(0, c[0] - 2)), z: this.maze.cellZ(c[1]) },
      ])
      for (let k = 0; k < 3; k++) this.spawn(new AntWorker3D(this.threeScene, room.x - 1 + k * 0.6, room.z + 1.6, this.gradientMap))
    } else {
      this.spawn(new JumpingSpider3D(this.threeScene, room.x - 1.8, room.z - 1.2, this.gradientMap))
      this.spawn(new JumpingSpider3D(this.threeScene, room.x + 1.8, room.z + 1.2, this.gradientMap))
      for (let k = 0; k < 4; k++) {
        const a = (k / 4) * Math.PI * 2 + Math.PI / 4
        this.traps.addSpike(room.x + Math.cos(a) * 1.55, room.z + Math.sin(a) * 1.55)
      }
    }
  }

  private onSacBurst(idx: number, room: Room): void {
    const destroyed = registry.get<number[]>(SAC_KEY) ?? []
    if (!destroyed.includes(idx)) destroyed.push(idx)
    registry.set(SAC_KEY, destroyed)
    const rec = this.sacs.find(s => s.idx === idx); if (rec) rec.enemy = null
    // The whole colony hears it
    this.director.noise(room.x, room.z, 40, 45)
    const remaining = 3 - destroyed.length
    this.events.push({ kind: 'sac', remaining })
    if (remaining <= 0) this.openSeal()
    this.updateObjective(true)
  }

  private sealIsOpen(): boolean {
    return (registry.get<number[]>(SAC_KEY) ?? []).length >= 3
        || (registry.get<string[]>('bossesDefeated') ?? []).includes('roller')
  }

  // A membrane of amber resin across the Queen's tunnel
  private buildSeal(): void {
    if (this.sealIsOpen()) return
    const mat = new THREE.MeshStandardMaterial({ color: 0xd9861a, emissive: 0x8a3a00, emissiveIntensity: 1.1, transparent: true, opacity: 0.82, roughness: 0.15, side: THREE.DoubleSide })
    const g = new THREE.PlaneGeometry(2.6, WALL_H + 0.2, 10, 6)
    const pos = g.attributes.position as THREE.BufferAttribute
    for (let k = 0; k < pos.count; k++) pos.setZ(k, Math.sin(pos.getX(k) * 3) * Math.cos(pos.getY(k) * 2.5) * 0.08)
    g.computeVertexNormals()
    this.sealMesh = new THREE.Mesh(g, mat)
    this.sealMesh.position.set(MIN_X + 0.9, WALL_H / 2, 0)
    this.sealMesh.rotation.y = Math.PI / 2
    this.add(this.sealMesh)
    this.sealBody = physicsWorld.addStaticBox(MIN_X + 0.9, 0, 0.15, 1.4)
  }

  private openSeal(): void {
    if (this.sealBody) { physicsWorld.remove(this.sealBody); this.sealBody = null }
    this.sealOpenT = 0
    this.events.push({ kind: 'sealOpen' })
  }

  private updateObjective(pop: boolean): void {
    const n = (registry.get<number[]>(SAC_KEY) ?? []).length
    if (this.sealIsOpen()) this.director.setObjective('The resin seal is open. Go west, into the Queen\'s tunnel.', pop)
    else this.director.setObjective(`Burst the pheromone sacs sealing the Queen's tunnel  ${n}/3`, pop)
  }

  // ── Corridors: loot, traps, patrols ─────────────────────────────────────────
  private populateCorridors(): void {
    const rnd = this.maze.rand
    const entry = this.maze.rooms.find(r => r.role === 'entry')!
    const farFromEntry = (x: number, z: number) => Math.hypot(x - entry.x, z - entry.z) > 7

    // Dead ends: something worth having, and usually a price
    const deadEnds = this.maze.deadEnds()
    let chests = 0, mimics = 0, berries = 0
    deadEnds.forEach(([cx, cy], k) => {
      const x = this.maze.cellX(cx), z = this.maze.cellZ(cy)
      const open = this.maze.openSide(cx, cy) ?? [1, 0]
      const mouthX = x + open[0] * 1.0, mouthZ = z + open[1] * 1.0
      const backX = x - open[0] * 0.35, backZ = z - open[1] * 0.35
      const roll = k % 4
      if (roll === 0 && chests < 6) { this.addChest(backX, backZ, mimics < 2 && rnd() < 0.45); if (this.chests[this.chests.length - 1].isMimic) mimics++; chests++ }
      else if (roll === 1 && berries < 4) { this.addBerry(backX, backZ); berries++ }
      else if (roll === 2) this.addCache(backX, backZ)
      else this.addThistles(backX, backZ, 3)
      if (!farFromEntry(x, z)) return
      // The price
      const price = rnd()
      if (price < 0.3) this.traps.addSpike(mouthX, mouthZ)
      else if (price < 0.55) this.spawn(new CentipedeAmbusher3D(this.threeScene, x + open[0] * 0.2, z + open[1] * 0.2, this.gradientMap))
      else if (price < 0.75) this.traps.addSpitter(x - open[0] * 1.15, z - open[1] * 1.15, open[0], open[1])
    })

    // Straight runs: plates, cave-ins, resin
    const straights = this.maze.straights().filter(([cx, cy]) => farFromEntry(this.maze.cellX(cx), this.maze.cellZ(cy)))
    for (let k = straights.length - 1; k > 0; k--) { const j = Math.floor(rnd() * (k + 1)); [straights[k], straights[j]] = [straights[j], straights[k]] }
    straights.forEach(([cx, cy, axis], k) => {
      const x = this.maze.cellX(cx), z = this.maze.cellZ(cy)
      const off = (rnd() - 0.5) * 1.0
      const px = axis === 'ew' ? x + off : x, pz = axis === 'ns' ? z + off : z
      if (k < 9) this.traps.addSpike(px, pz)
      else if (k < 14) this.traps.addCaveIn(px, pz)
      else if (k < 19) this.traps.addResin(px, pz, 0.8 + rnd() * 0.35)
      else if (k < 24) this.addCache(px, pz)
    })

    // Four soldiers, each walking a loop of junctions in its quarter of the maze
    const junctions = this.maze.junctions()
    const quads: Array<Array<[number, number]>> = [[], [], [], []]
    for (const [cx, cy] of junctions) {
      if (!farFromEntry(this.maze.cellX(cx), this.maze.cellZ(cy)) || Math.hypot(this.maze.cellX(cx) - entry.x, this.maze.cellZ(cy) - entry.z) < 9) continue   // patrols keep off the refuge
      quads[(cx < 7 ? 0 : 1) + (cy < 4 ? 0 : 2)].push([cx, cy])
    }
    quads.forEach(q => {
      if (q.length < 2) return
      const pts = q.map(([cx, cy]) => ({ x: this.maze.cellX(cx), z: this.maze.cellZ(cy) }))
      const mx = pts.reduce((a, p) => a + p.x, 0) / pts.length, mz = pts.reduce((a, p) => a + p.z, 0) / pts.length
      pts.sort((a, b) => Math.atan2(a.z - mz, a.x - mx) - Math.atan2(b.z - mz, b.x - mx))
      const route = pts.length > 5 ? pts.filter((_, i) => i % Math.ceil(pts.length / 5) === 0) : pts
      const start = route[0]
      if (!farFromEntry(start.x, start.z)) route.push(route.shift()!)
      this.addSoldier(route[0].x, route[0].z, route)
      this.drawTrail(route)
    })
    // A soldier walking through the nest
    const nest = this.maze.rooms.find(r => r.role === 'nest')!
    this.addSoldier(nest.x - 2, nest.z, [{ x: nest.x - 3, z: nest.z - 2.5 }, { x: nest.x + 3, z: nest.z - 2.5 }, { x: nest.x + 3, z: nest.z + 2.5 }, { x: nest.x - 3, z: nest.z + 2.5 }])

    // Glow fungus: the only light in the deep tunnels
    for (let k = 0; k < 14; k++) {
      const [cx, cy] = [Math.floor(rnd() * 15), Math.floor(rnd() * 9)]
      if (this.maze.inRoom(cx, cy)) continue
      const x = this.maze.cellX(cx) + (rnd() - 0.5) * 1.6, z = this.maze.cellZ(cy) + (rnd() - 0.5) * 1.6
      if (this.maze.isSolidAt(x, z)) continue
      for (let m = 0; m < 3; m++) {
        this.batch(new THREE.SphereGeometry(0.05 + m * 0.02, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2), this.fungusMat,
          [x + m * 0.08, 0.04 + m * 0.03, z + (m % 2) * 0.07])
      }
    }
    // Dead things in the tunnels
    for (let k = 0; k < 24; k++) {
      const [cx, cy] = [Math.floor(rnd() * 15), Math.floor(rnd() * 9)]
      this.scatterBones(this.maze.cellX(cx), this.maze.cellZ(cy), 0.9, 1)
    }
  }

  // Faint pheromone trails along patrol routes — learn them, avoid them
  private drawTrail(route: Array<{ x: number; z: number }>): void {
    const dots: THREE.BufferGeometry[] = []
    for (let k = 0; k < route.length; k++) {
      const a = route[k], b = route[(k + 1) % route.length]
      const f = this.maze.fieldTo(b.x, b.z)
      let x = a.x, z = a.z
      for (let step = 0; step < 80; step++) {
        const s = this.maze.seek(x, z, 0, f)
        if (!s || s.dist < 0.3) break
        const dx = s.x - x, dz = s.z - z, l = Math.hypot(dx, dz) || 1
        const st = Math.min(0.45, l)
        x += dx / l * st; z += dz / l * st
        dots.push(new THREE.CircleGeometry(0.035, 5).rotateX(-Math.PI / 2).translate(x + (Math.random() - 0.5) * 0.25, 0.006, z + (Math.random() - 0.5) * 0.25))
      }
    }
    if (!dots.length) return
    const m = mergeGeometries(dots); dots.forEach(d => d.dispose())
    if (m) this.add(new THREE.Mesh(m, new THREE.MeshBasicMaterial({ color: 0x0a0604 })))
  }

  private scatterBones(x: number, z: number, r: number, n: number): void {
    for (let k = 0; k < n; k++) {
      const bx = x + (Math.random() - 0.5) * 2 * r, bz = z + (Math.random() - 0.5) * 2 * r
      if (this.maze.isSolidAt(bx, bz)) continue
      this.batch(k % 3 === 0 ? new THREE.SphereGeometry(0.08, 6, 5, 0, Math.PI) : new THREE.CapsuleGeometry(0.025, 0.16, 3, 5), this.boneMat,
        [bx, 0.03, bz], [Math.PI / 2, 0, Math.random() * 3])
    }
  }

  private batch(geo: THREE.BufferGeometry, mat: THREE.Material, p: [number, number, number], r: [number, number, number] = [0, 0, 0], sc: [number, number, number] = [1, 1, 1]): void {
    const m = new THREE.Matrix4().compose(new THREE.Vector3(...p), new THREE.Quaternion().setFromEuler(new THREE.Euler(...r)), new THREE.Vector3(...sc))
    const g = (geo.index ? geo.toNonIndexed() : geo).applyMatrix4(m)
    if (g !== geo) geo.dispose()
    g.deleteAttribute('uv')
    let list = this.decor.get(mat)
    if (!list) { list = []; this.decor.set(mat, list) }
    list.push(g)
  }

  private flushDecor(): void {
    for (const [mat, geos] of this.decor) {
      const merged = mergeGeometries(geos)
      geos.forEach(g => g.dispose())
      if (!merged) continue
      const mesh = new THREE.Mesh(merged, mat)
      mesh.castShadow = true
      this.add(mesh)
    }
    this.decor.clear()
  }

  private buildPortalArch(px: number, pz: number, color: number): void {
    const mat = new THREE.MeshToonMaterial({ color, gradientMap: this.gradientMap, emissive: new THREE.Color(color), emissiveIntensity: 0.5 })
    for (const s of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.2, WALL_H + 0.3, 0.2), mat)
      post.position.set(px, (WALL_H + 0.3) / 2, pz + s * 1.25); this.add(post)
    }
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 2.7), mat)
    lintel.position.set(px, WALL_H + 0.3, pz); this.add(lintel)
    const light = new THREE.PointLight(color, 1.2, 5, 2)
    light.position.set(px + (px > 0 ? -0.8 : 0.8), 1.0, pz); this.add(light)
  }

  private buildLighting(): void {
    // Everything else is Webbs' lantern (ZoneLighting) and what glows in the dark
    const entry = new THREE.PointLight(0xddcc88, 1.0, 6, 2)
    entry.position.set(MAX_X - 2.5, 2.2, 0); this.add(entry)
  }

  // ── Spawning ────────────────────────────────────────────────────────────────
  private spawn(e: Enemy3D, leash = 7): Enemy3D {
    this.freeEnemies.push(e)
    if (e.usesNav) this.posts.set(e, { x: e.collisionBody.x, z: e.collisionBody.z, leash, engaged: false, field: null })
    return e
  }
  private addSoldier(x: number, z: number, route: Array<{ x: number; z: number }>): AntSoldier3D {
    const s = new AntSoldier3D(this.threeScene, x, z, this.gradientMap, route)
    this.spawn(s); this.soldiers.push(s)
    return s
  }
  private addChest(x: number, z: number, isMimic: boolean): void {
    const parts = buildChest(this.gradientMap, isMimic)
    parts.group.position.set(x, 0, z)
    parts.group.rotation.y = Math.PI / 4 + (Math.random() - 0.5) * 0.5
    this.add(parts.group)
    this.chests.push({ x, z, isMimic, opened: false, mesh: parts.group, parts, openT: -1, wakeProgress: 0, wakeActive: false })
  }
  private addBerry(x: number, z: number): void {
    const g = buildHealthBerry(this.gradientMap, 1.15)
    g.position.set(x, 0, z); this.add(g)
    this.hpModules.push({ x, z, collected: false, mesh: g })
  }
  private addCache(x: number, z: number): void {
    const mat = CACHE_MATS[Math.floor(this.maze.rand() * CACHE_MATS.length)]
    const g = buildMaterialPickup(mat, this.gradientMap, 0.95)
    g.position.set(x, 0, z); this.add(g)
    this.caches.push({ x, z, collected: false, mesh: g, mat, qty: mat === 'DriedFungus' ? 1 : 2 })
  }
  private addThistles(x: number, z: number, n: number): void {
    for (let k = 0; k < n; k++) {
      const tx = x + (k - 1) * 0.3, tz = z + (k % 2) * 0.25
      const g = buildMaterialPickup('Thistle', this.gradientMap, 0.85)
      g.position.set(tx, 0, tz); this.add(g)
      this.thistles.push({ x: tx, z: tz, collected: false, mesh: g })
    }
  }

  // The entry chamber (workbench, the way home) is a refuge
  safeAt(x: number, z: number): boolean {
    const r = this.maze.roomAt(x, z)
    return !!r && r.role === 'entry'
  }

  // Maze steering for every non-soldier enemy (see Enemy3D.steer)
  private steer(e: Enemy3D, px: number, pz: number): { x: number; z: number } | { idle: true; vx: number; vz: number } | null {
    const ex = e.collisionBody.x, ez = e.collisionBody.z
    const post = this.posts.get(e)
    if (post) {
      const pd = this.safeAt(px, pz) ? Infinity : this.maze.goalDistance(ex, ez)
      if (pd < post.leash) post.engaged = true
      else if (pd > post.leash * 1.6) post.engaged = false
      if (!post.engaged) {
        // Walk home (slowly), then wait
        if (Math.hypot(post.x - ex, post.z - ez) < 0.5) return { idle: true, vx: 0, vz: 0 }
        post.field ??= this.maze.fieldTo(post.x, post.z)
        const s = this.maze.seek(ex, ez, e.config.bodyRadius * 0.8, post.field)
        if (!s) return { idle: true, vx: 0, vz: 0 }
        const dx = s.x - ex, dz = s.z - ez, l = Math.hypot(dx, dz) || 1
        return { idle: true, vx: dx / l * 0.9, vz: dz / l * 0.9 }
      }
    }
    const r = e.config.bodyRadius * 0.8
    if (this.maze.los(ex, ez, px, pz, r)) return null
    const s = this.maze.seek(ex, ez, r)
    if (!s) return null
    const dx = s.x - ex, dz = s.z - ez, l = Math.hypot(dx, dz) || 1
    const dist = Math.max(s.dist, l)
    return { x: ex + dx / l * dist, z: ez + dz / l * dist }
  }

  // ── Public API (game loop) ──────────────────────────────────────────────────
  checkExitRight(px: number): boolean { return px > AntColonyScene3D.EXIT_RIGHT_X }
  checkExitLeft(px: number): boolean  { return px < AntColonyScene3D.EXIT_LEFT_X && this.sealIsOpen() }

  nearWorkbench(px: number, pz: number): boolean {
    return (px - AntColonyScene3D.WORKBENCH_X) ** 2 + (pz - AntColonyScene3D.OBJ_Z) ** 2 < 1.1 * 1.1
  }
  nearChest(px: number, pz: number): number {
    for (let i = 0; i < this.chests.length; i++) {
      const c = this.chests[i]
      if (!c.opened && (px - c.x) ** 2 + (pz - c.z) ** 2 < 0.75 * 0.75) return i
    }
    return -1
  }
  openChest(idx: number): { kind: 'loot'; mat: string; qty: number } | { kind: 'mimic' } {
    const chest = this.chests[idx]
    if (!chest || chest.opened) return { kind: 'loot', mat: 'SilkThread', qty: 0 }
    chest.opened = true; chest.wakeActive = false; chest.openT = 0
    if (chest.isMimic) {
      this.spawn(new BeetleTank3D(this.threeScene, chest.x, chest.z + 0.5, this.gradientMap))
      this.director.noise(chest.x, chest.z, 10, 12)
      return { kind: 'mimic' }
    }
    return { kind: 'loot', ...CHEST_LOOT[Math.floor(Math.random() * CHEST_LOOT.length)] }
  }
  nearHpModule(px: number, pz: number): number {
    for (let i = 0; i < this.hpModules.length; i++) {
      const m = this.hpModules[i]
      if (!m.collected && (px - m.x) ** 2 + (pz - m.z) ** 2 < 0.6 * 0.6) return i
    }
    return -1
  }
  collectHpModule(idx: number): void {
    const m = this.hpModules[idx]
    if (!m || m.collected) return
    m.collected = true
    if (m.mesh) { this.threeScene.remove(m.mesh); m.mesh = null }
  }
  nearMaterialCache(px: number, pz: number): PickupRecord | null {
    for (const c of this.caches) if (!c.collected && (px - c.x) ** 2 + (pz - c.z) ** 2 < 0.5 * 0.5) return c
    return null
  }
  collectCache(record: PickupRecord): void {
    record.collected = true
    if (record.mesh) { this.threeScene.remove(record.mesh); record.mesh = null }
  }
  nearThistle(px: number, pz: number): number {
    for (let i = 0; i < this.thistles.length; i++) {
      const t = this.thistles[i]
      if (!t.collected && (px - t.x) ** 2 + (pz - t.z) ** 2 < 0.45 * 0.45) return i
    }
    return -1
  }
  collectThistle(idx: number): void {
    const t = this.thistles[idx]
    if (!t || t.collected) return
    t.collected = true
    if (t.mesh) { this.threeScene.remove(t.mesh); t.mesh = null }
  }

  // Webbs made a sound the colony can hear
  noise(kind: keyof typeof NOISE, x: number, z: number): void {
    const n = NOISE[kind]
    this.director.noise(x, z, n.range, n.alarm)
  }
  slowAt(x: number, z: number): number { return this.traps.slowAt(x, z) }
  get alarm(): number { return this.director.alarm }

  // Events since the last call (trap hits, sacs, the seal) for the game loop
  takeEvents(): ColonyEvent[] {
    const out = this.events
    this.events = []
    return out
  }

  // Cut the walls open between the camera and Webbs
  updateWallOcclusion(camera: THREE.Camera, playerPos: THREE.Vector3): void {
    CUTAWAY.center.value.set(playerPos.x, 0.35, playerPos.z)
    CUTAWAY.cam.value.copy(camera.position)
  }

  tickVisuals(delta: number, px: number, pz: number, pr = 0.28, pull?: (vx: number, vz: number) => void): void {
    this.vision.update(delta, px, pz)
    this.director.update(delta, px, pz)
    this.tickDrops(delta, px, pz, pr)
    const trapEvents: TrapEvent[] = []
    this.traps.update(delta, px, pz, pr, this.enemies, trapEvents, pull ?? (() => {}))
    for (const ev of trapEvents) {
      if (ev.kind === 'noise') this.director.noise(ev.x, ev.z, ev.range, 6)
      else this.events.push(ev)
    }

    const zone: 'entry' | 'mid' | 'deep' = px > 12 ? 'entry' : px < -10 ? 'deep' : 'mid'
    if (zone !== this.currentAmbZone) {
      if (this.currentAmbZone !== '') audio.stopLoop(`amb_colony_${this.currentAmbZone}` as SoundKey)
      audio.playLoop(`amb_colony_${zone}` as SoundKey)
      this.currentAmbZone = zone
    }

    const t = performance.now() / 1000
    this.fungusMat.emissiveIntensity = 1.5 + Math.sin(t * 1.3) * 0.3

    // The resin seal sags and melts away once all three sacs are gone
    if (this.sealMesh && this.sealOpenT >= 0) {
      this.sealOpenT += delta
      const k = Math.min(1, this.sealOpenT / 2.5)
      this.sealMesh.scale.y = 1 - k
      this.sealMesh.position.y = (WALL_H / 2) * (1 - k)
      ;(this.sealMesh.material as THREE.MeshStandardMaterial).opacity = 0.82 * (1 - k)
      if (k >= 1) { this.threeScene.remove(this.sealMesh); this.sealMesh = null }
    }

    // Chest lids, mimic wake
    for (const chest of this.chests) {
      if (chest.openT >= 0 && chest.openT < 1) {
        chest.openT = Math.min(1, chest.openT + delta / 0.45)
        const e = 1 - (1 - chest.openT) ** 3
        chest.parts.lid.rotation.x = -1.9 * e + Math.sin(chest.openT * Math.PI) * 0.15
        ;(chest.parts.inner.material as THREE.MeshBasicMaterial).opacity = 0.85 * e
      }
      if (chest.opened || !chest.isMimic) continue
      const near = (px - chest.x) ** 2 + (pz - chest.z) ** 2 < 1.4 * 1.4
      if (near && !chest.wakeActive) chest.wakeActive = true
      if (!near && chest.wakeActive) { chest.wakeActive = false; chest.wakeProgress = 0; this.setMimicWakeVisual(chest, 0) }
      if (chest.wakeActive) {
        chest.wakeProgress = Math.min(1, chest.wakeProgress + delta / 1.5)
        this.setMimicWakeVisual(chest, chest.wakeProgress)
        const j = chest.wakeProgress * 0.015
        chest.mesh.position.x = chest.x + (Math.random() - 0.5) * j
        chest.mesh.position.z = chest.z + (Math.random() - 0.5) * j
      }
    }
  }

  private setMimicWakeVisual(chest: ChestRecord, t: number): void {
    const mat = chest.parts.glow.material as THREE.MeshBasicMaterial
    mat.color.setRGB(1, 0.27 * (1 - t), 0.13 * (1 - t) * 0.5)
    mat.opacity = 0.25 + t * 0.4
    for (const o of chest.parts.eyes) ((o as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = Math.min(1, t * 1.6)
    chest.parts.lid.rotation.x = -t * (0.25 + Math.sin(performance.now() / 90) * 0.08)
  }

  updateEnemies(delta: number, px: number, pz: number): void {
    this.maze.setGoal(px, pz)   // the shared chase field — rebuilt only when Webbs changes tile
    for (const e of this.freeEnemies) {
      const far = Math.hypot(e.collisionBody.x - px, e.collisionBody.z - pz) > 13   // beyond the view and the dark anyway
      e.group.visible = !far
      e.update(delta, px, pz)
      e.syncPosition()
    }
    for (let i = this.freeEnemies.length - 1; i >= 0; i--) {
      const e = this.freeEnemies[i]
      if (!e.isExpired()) continue
      e.cleanup()
      this.freeEnemies.splice(i, 1)
      const si = this.soldiers.indexOf(e as AntSoldier3D)
      if (si >= 0) this.soldiers.splice(si, 1)
    }
    this.enemies.length = 0
    for (const e of this.freeEnemies) {
      if (!e.isDead()) { this.enemies.push(e); continue }
      // First frame dead: XP, maybe a drop (the sacs are the objective, not loot)
      if (this.counted.has(e) || e instanceof PheromoneSac3D) continue
      this.counted.add(e)
      const x = e.collisionBody.x, z = e.collisionBody.z
      this.events.push({ kind: 'kill', x, z })
      if (Math.random() < DROP_CHANCE) this.spawnDrop(x, z)
    }
  }

  private spawnDrop(x: number, z: number): void {
    const g = buildHealthBerry(this.gradientMap, 0.8)
    g.position.set(x, 0, z)
    this.add(g)
    this.drops.push({ x, z, mesh: g, t: 0 })
  }

  // Walk over a drop to drink it
  private tickDrops(delta: number, px: number, pz: number, pr: number): void {
    for (let i = this.drops.length - 1; i >= 0; i--) {
      const d = this.drops[i]
      d.t += delta
      d.mesh.position.y = Math.min(0, -0.4 + d.t * 2) + Math.sin(d.t * 3) * 0.03   // pops up out of the body, then bobs
      d.mesh.visible = d.t < DROP_LIFE - 4 || Math.floor(d.t * 6) % 2 === 0
      const got = (px - d.x) ** 2 + (pz - d.z) ** 2 < (pr + 0.3) ** 2 && d.t > 0.3
      if (got) this.events.push({ kind: 'heal', amount: DROP_HEAL, x: d.x, z: d.z })
      if (got || d.t > DROP_LIFE) {
        this.threeScene.remove(d.mesh)
        const k = this.tracked.indexOf(d.mesh); if (k >= 0) this.tracked.splice(k, 1)
        disposeTree(d.mesh)
        this.drops.splice(i, 1)
      }
    }
  }

  destroy(): void {
    audio.stopLoop('amb_colony_entry'); audio.stopLoop('amb_colony_mid'); audio.stopLoop('amb_colony_deep')
    registry.set('fogReveal_antColony', this.vision.serialize())
    this.vision.dispose()
    this.traps.dispose()
    this.director.dispose()
    CUTAWAY.center.value.set(0, -1000, 0)
    Enemy3D.steer = null
    AntSoldier3D.ctx = null
    for (const e of this.freeEnemies) e.cleanup()
    for (const b of this.wallBodies) physicsWorld.remove(b)
    if (this.sealBody) physicsWorld.remove(this.sealBody)
    this.enemies = []; this.freeEnemies = []; this.soldiers = []; this.wallBodies = []
    for (const obj of this.tracked) disposeTree(obj)
    this.tracked = []
    physicsWorld.bounds = null
  }

  private add(obj: THREE.Object3D): void {
    this.tracked.push(obj)
    this.threeScene.add(obj)
  }
}
