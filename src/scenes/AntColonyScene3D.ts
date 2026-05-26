import * as THREE from 'three'
import { physicsWorld, type CollisionBody } from '../core/PhysicsWorld'
import type { Enemy3D } from '../entities/Enemy3D'
import { CentipedeAmbusher3D } from '../entities/CentipedeAmbusher3D'
import { BeetleTank3D } from '../entities/BeetleTank3D'
import { AntWorker3D } from '../entities/AntWorker3D'
import { JumpingSpider3D } from '../entities/JumpingSpider3D'
import { FogOfWarSystem3D } from '../systems/FogOfWarSystem3D'
import { registry } from '../core/Registry'

// ── World dimensions ───────────────────────────────────────────────────────────
const W      = 40    // X: -20 … +20
const D      = 26    // Z: -13 … +13
const WALL_H = 1.0   // Round 7 Issue 4: shorter walls for better visibility

// ── 5 parallel corridors ───────────────────────────────────────────────────────
// Each corridor: 3wu wide, running the full X extent.
// CZ[i] is the center Z of corridor i (0=bottom, 4=top).
const CZ      = [-10, -5, 0, 5, 10] as const   // 5 corridor center Z values
const CORR_HW = 2.0                              // Round 7 Issue 4: wider corridors (was 1.5)

// Dividing wall Z ranges  (between adjacent corridors)
const DIV_WALLS = [
  { lo: CZ[0] + CORR_HW, hi: CZ[1] - CORR_HW },   // between C0 and C1
  { lo: CZ[1] + CORR_HW, hi: CZ[2] - CORR_HW },   // between C1 and C2
  { lo: CZ[2] + CORR_HW, hi: CZ[3] - CORR_HW },   // between C2 and C3
  { lo: CZ[3] + CORR_HW, hi: CZ[4] - CORR_HW },   // between C3 and C4
] as const

// Passage x-positions per dividing wall (1.5wu half-width gaps)
const GAP_HALF = 1.0
const DIV_GAPS: ReadonlyArray<ReadonlyArray<number>> = [
  [-14, 0, 14],          // C0–C1: far ends + center
  [-14, -7, 7, 14],      // C1–C2: all 4
  [-14, -7, 7, 14],      // C2–C3: all 4
  [-14, 0, 14],          // C3–C4: far ends + center
]

const CULL_R = 14

// Round 7 Issue 3: zone-based delay tables are gone — each entry in SPAWN_PLAN
// now carries its own absolute delay (seconds since colony load).

// ── Dead-end rooms ─────────────────────────────────────────────────────────────
// Alcoves that branch off the outer corridors (C0 / C4) in the Z direction,
// and off lateral corridors (C1 / C3) mid-X.
type RoomType = 'spike' | 'ambush' | 'loot'

const DEAD_END_DATA: Array<{
  x:     number
  cz:    number   // center Z of source corridor
  dz:    number   // alcove extends in this Z direction (±1.5wu beyond corridor edge)
  type:  RoomType
}> = [
  // Off C0 (bottom corridor, extends further south)
  { x: -16, cz: -10, dz: -1, type: 'spike'  },
  { x:  -8, cz: -10, dz: -1, type: 'loot'   },
  { x:   2, cz: -10, dz: -1, type: 'ambush' },
  { x:  11, cz: -10, dz: -1, type: 'spike'  },
  // Off C4 (top corridor, extends further north)
  { x: -15, cz:  10, dz:  1, type: 'loot'   },
  { x:  -4, cz:  10, dz:  1, type: 'ambush' },
  { x:   5, cz:  10, dz:  1, type: 'spike'  },
  { x:  15, cz:  10, dz:  1, type: 'loot'   },
  // Off C1 (lateral, Z±)
  { x: -10, cz:  -5, dz: -1, type: 'ambush' },
  { x:   4, cz:  -5, dz: -1, type: 'loot'   },
  // Off C3 (lateral, Z±)
  { x: -10, cz:   5, dz:  1, type: 'loot'   },
  { x:   4, cz:   5, dz:  1, type: 'ambush' },
  // Off connecting passage (dead-end pocket at x=0 junction)
  { x:   0, cz:  -5, dz: -1, type: 'spike'  },
  { x:   0, cz:   5, dz:  1, type: 'spike'  },
]

// ── Enemy spawns (Round 7 Issue 3) ────────────────────────────────────────────
// 6 enemies total, delay-paced so the entry corridor stays safe long enough for
// the player to orient.  Pacing rules:
//   - NO spawn with x > 13 (entry portal at x=18.5 must stay safe)
//   - Deep zone (x < -8): immediate
//   - Mid zone (-8 to 8): 8-12s delay
//   - Entry zone (8 to 13): 18-25s delay
type SpawnKind = 'centipede' | 'beetle' | 'ant_worker' | 'jumping_spider'
// Round 9 Issue 5: respawn at maze chokepoints — corridor gaps & antechambers.
const SPAWN_PLAN: Array<{ kind: SpawnKind; x: number; z: number; delay: number }> = [
  // Deep zone — guarding boss antechamber approach + back-left chest area
  { kind: 'beetle',    x: -17, z:  9,   delay: 0  },   // northern-corridor west end (near crystals)
  { kind: 'centipede', x: -14, z:  0,   delay: 0  },   // central chokepoint near danger marker
  // Mid zone — guarding the central stub-wall pathing decisions
  { kind: 'centipede', x:  -2, z:  6,   delay: 8  },   // northern gap at X=-2
  { kind: 'beetle',    x:   2, z: -6,   delay: 12 },   // southern gap at X=+2
  // Entry zone — player gets ~18s safe exploration first
  { kind: 'centipede', x:  11, z:  0,   delay: 18 },   // entry-side chokepoint
  { kind: 'beetle',    x:  16, z: -10,  delay: 25 },   // gold-beacon ambush (south reward route)
]

// ── 20 chests, 6 mimics ────────────────────────────────────────────────────────
const CHEST_DATA: Array<{ x: number; cz: number; isMimic: boolean }> = [
  // C0
  { x: -17, cz: -10, isMimic: false }, { x:  -6, cz: -10, isMimic: true  },
  { x:   5, cz: -10, isMimic: false }, { x:  14, cz: -10, isMimic: false },
  // C1
  { x: -14, cz:  -5, isMimic: false }, { x:  -3, cz:  -5, isMimic: true  },
  { x:   8, cz:  -5, isMimic: false }, { x:  17, cz:  -5, isMimic: false },
  // C2 (entry)
  { x: -18, cz:   0, isMimic: false }, { x:  -9, cz:   0, isMimic: false },
  { x:   3, cz:   0, isMimic: true  }, { x:  11, cz:   0, isMimic: false },
  // C3
  { x: -15, cz:   5, isMimic: false }, { x:  -5, cz:   5, isMimic: false },
  { x:   4, cz:   5, isMimic: true  }, { x:  16, cz:   5, isMimic: false },
  // C4
  { x: -16, cz:  10, isMimic: false }, { x:  -4, cz:  10, isMimic: true  },
  { x:   6, cz:  10, isMimic: false }, { x:  15, cz:  10, isMimic: true  },
]

const CHEST_LOOT = [
  { mat: 'SilkThread',  qty: 3 }, { mat: 'ChitinShard', qty: 2 },
  { mat: 'WebFluid',    qty: 2 }, { mat: 'BoneFragment', qty: 2 },
  { mat: 'BugPartsAnt', qty: 3 }, { mat: 'DriedFungus', qty: 1 },
]

// ── HP modules (15) ────────────────────────────────────────────────────────────
const HP_MODULE_DATA: Array<{ x: number; cz: number }> = [
  { x: -19, cz: -10 }, { x: -10, cz: -10 }, { x:   6, cz: -10 },
  { x: -16, cz:  -5 }, { x:   0, cz:  -5 }, { x:  12, cz:  -5 },
  { x: -13, cz:   0 }, { x:   0, cz:   0 }, { x:  13, cz:   0 },
  { x: -18, cz:   5 }, { x:  -4, cz:   5 }, { x:  10, cz:   5 },
  { x: -12, cz:  10 }, { x:   4, cz:  10 }, { x:  17, cz:  10 },
]

// ── Material caches (25) ───────────────────────────────────────────────────────
const CACHE_DATA: Array<{ x: number; cz: number; mat: string; qty: number }> = [
  { x: -17, cz: -10, mat: 'SilkThread',   qty: 2 }, { x:  -8, cz: -10, mat: 'ChitinShard', qty: 2 },
  { x:   2, cz: -10, mat: 'BugPartsAnt',  qty: 2 }, { x:  11, cz: -10, mat: 'WebFluid',     qty: 2 },
  { x:  16, cz: -10, mat: 'DriedFungus',  qty: 1 },
  { x: -15, cz:  -5, mat: 'BoneFragment', qty: 2 }, { x:  -6, cz:  -5, mat: 'SilkThread',   qty: 2 },
  { x:   4, cz:  -5, mat: 'ChitinShard',  qty: 2 }, { x:  14, cz:  -5, mat: 'WebFluid',     qty: 2 },
  { x:  18, cz:  -5, mat: 'BugPartsAnt',  qty: 1 },
  { x: -16, cz:   0, mat: 'SilkThread',   qty: 2 }, { x:  -7, cz:   0, mat: 'BoneFragment', qty: 2 },
  { x:   5, cz:   0, mat: 'ChitinShard',  qty: 2 }, { x:  15, cz:   0, mat: 'DriedFungus',  qty: 1 },
  { x: -14, cz:   5, mat: 'WebFluid',     qty: 2 }, { x:  -3, cz:   5, mat: 'SilkThread',   qty: 2 },
  { x:   6, cz:   5, mat: 'BugPartsAnt',  qty: 2 }, { x:  13, cz:   5, mat: 'BoneFragment', qty: 2 },
  { x:  18, cz:   5, mat: 'ChitinShard',  qty: 1 },
  { x: -18, cz:  10, mat: 'SilkThread',   qty: 2 }, { x:  -9, cz:  10, mat: 'WebFluid',     qty: 2 },
  { x:   1, cz:  10, mat: 'ChitinShard',  qty: 2 }, { x:   9, cz:  10, mat: 'DriedFungus',  qty: 1 },
  { x:  14, cz:  10, mat: 'BugPartsAnt',  qty: 2 }, { x:  19, cz:  10, mat: 'BoneFragment', qty: 1 },
]

// ── Thistle seeds (20) ─────────────────────────────────────────────────────────
const THISTLE_DATA: Array<{ x: number; cz: number }> = [
  { x: -18, cz: -10 }, { x:  -4, cz: -10 }, { x:   9, cz: -10 }, { x:  17, cz: -10 },
  { x: -11, cz:  -5 }, { x:   6, cz:  -5 }, { x:  16, cz:  -5 }, { x:  19, cz:  -5 },
  { x: -14, cz:   0 }, { x:  -2, cz:   0 }, { x:   8, cz:   0 }, { x:  18, cz:   0 },
  { x: -13, cz:   5 }, { x:   0, cz:   5 }, { x:   9, cz:   5 }, { x:  17, cz:   5 },
  { x: -16, cz:  10 }, { x:  -5, cz:  10 }, { x:   7, cz:  10 }, { x:  15, cz:  10 },
]

// ── 32 fungus lanterns spread across all corridors ─────────────────────────────
const LANTERN_DATA: Array<{ x: number; cz: number }> = [
  // C0
  { x: -18, cz: -10 }, { x: -13, cz: -10 }, { x:  -7, cz: -10 },
  { x:  -1, cz: -10 }, { x:   5, cz: -10 }, { x:  12, cz: -10 }, { x:  17, cz: -10 },
  // C1
  { x: -16, cz:  -5 }, { x: -10, cz:  -5 }, { x:  -3, cz:  -5 },
  { x:   3, cz:  -5 }, { x:   9, cz:  -5 }, { x:  15, cz:  -5 },
  // C2 (entry corridor)
  { x: -15, cz:   0 }, { x:  -8, cz:   0 }, { x:  -1, cz:   0 },
  { x:   6, cz:   0 }, { x:  13, cz:   0 },
  // C3
  { x: -17, cz:   5 }, { x: -11, cz:   5 }, { x:  -4, cz:   5 },
  { x:   2, cz:   5 }, { x:   8, cz:   5 }, { x:  16, cz:   5 },
  // C4
  { x: -19, cz:  10 }, { x: -14, cz:  10 }, { x:  -8, cz:  10 },
  { x:  -2, cz:  10 }, { x:   4, cz:  10 }, { x:  10, cz:  10 }, { x:  18, cz:  10 },
  // Passage junction markers
  { x: -14, cz:  -2 }, { x:  14, cz:   2 },
]

// ── Types ──────────────────────────────────────────────────────────────────────

interface PendingSpawn {
  kind:  SpawnKind
  x:     number
  z:     number
  delay: number   // seconds since colony load
}

interface ChestRecord {
  x:            number
  z:            number
  isMimic:      boolean
  opened:       boolean
  mesh:         THREE.Group
  wakeProgress: number   // 0→1 for mimic pre-burst animation
  wakeActive:   boolean
}

interface PickupRecord {
  x:         number
  z:         number
  collected: boolean
  mesh:      THREE.Mesh | null
  mat?:      string
  qty?:      number
}

interface DeadEndRecord {
  x:          number
  z:          number   // alcove center (outside corridor edge)
  type:       RoomType
  triggered:  boolean
  mesh:       THREE.Group | null
  spikeMeshes?: THREE.Mesh[]
}

export type DeadEndResult = { type: 'spike'; damage: number } | { type: 'ambush' } | { type: 'loot'; mat: string; qty: number } | null

// ── Helper ─────────────────────────────────────────────────────────────────────

function jitterZ(cz: number, range = 0.8): number {
  return cz + (Math.random() - 0.5) * range
}


export class AntColonyScene3D {
  static readonly LEFT  = -W / 2          // -20
  static readonly RIGHT =  W / 2          // +20
  static readonly BACK  = -D / 2          // -13
  static readonly FRONT =  D / 2          // +13

  static readonly EXIT_RIGHT_X      =  19.0
  static readonly EXIT_LEFT_X       = -19.0
  static readonly SPAWN_FROM_HOME_X =  18.5
  static readonly SPAWN_FROM_BOSS_X = -18.5
  static readonly WORKBENCH_X       =  15.0
  static readonly OBJ_Z             =  0.8   // inside entry corridor (C2, center z=0)

  enemies: Enemy3D[] = []
  fog:     FogOfWarSystem3D

  private threeScene:    THREE.Scene
  private gradientMap:   THREE.Texture
  private tracked:       THREE.Object3D[] = []
  private wallBodies:    CollisionBody[]  = []
  private dividerWalls:  Array<{ mesh: THREE.Mesh; mat: THREE.MeshToonMaterial; capMat: THREE.MeshToonMaterial; x0: number; x1: number; zLo: number; zHi: number }> = []
  // Round 9 Issue 5: AABBs for the new maze walls — used by webWallHitTest.
  private mazeWallAabbs: Array<{ cx: number; cz: number; hw: number; hh: number }> = []
  // Round 7 Issue 3: time-delayed spawn queue
  private pendingSpawns:    PendingSpawn[] = []
  private elapsedSinceLoad  = 0
  private readonly _occRaycaster = new THREE.Raycaster()
  private freeEnemies:  Enemy3D[]        = []
  private chests:       ChestRecord[]    = []
  private hpModules:    PickupRecord[]   = []
  private caches:       PickupRecord[]   = []
  private thistles:     PickupRecord[]   = []
  private deadEnds:     DeadEndRecord[]  = []
  private bossPortalZ:  number           = 0   // randomized on construction
  private orbMeshes:    THREE.Mesh[]     = []  // for bob animation

  constructor(threeScene: THREE.Scene, gradientMap: THREE.Texture) {
    this.threeScene  = threeScene
    this.gradientMap = gradientMap

    // Randomize boss portal Z among corridor centers (persists for one colony visit)
    const savedZ = registry.get<number | undefined>('bossPortalZ')
    if (typeof savedZ === 'number') {
      this.bossPortalZ = savedZ
    } else {
      this.bossPortalZ = CZ[Math.floor(Math.random() * CZ.length)]
      registry.set('bossPortalZ', this.bossPortalZ)
    }

    physicsWorld.bounds = {
      minX: AntColonyScene3D.LEFT  - 1,
      maxX: AntColonyScene3D.RIGHT + 1,
      minZ: AntColonyScene3D.BACK  + 0.3,
      maxZ: AntColonyScene3D.FRONT - 0.3,
    }
    physicsWorld.circularBound = null   // ant colony uses box bounds, not circular

    this.buildGround()
    this.buildOuterWalls()
    // Round 9 Issue 5: replaced 4-divider corridor grid with a proper maze.
    this.buildMazeWalls()
    this.buildLandmarks()
    this.buildPortals()
    this.buildWorkbench()
    this.buildChests()
    this.buildHpModules()
    this.buildCaches()
    this.buildThistles()
    this.buildDeadEnds()
    this.buildDecoration()
    this.buildLighting()
    this.initSpawns()

    this.fog = new FogOfWarSystem3D(
      threeScene,
      AntColonyScene3D.LEFT,  AntColonyScene3D.RIGHT,
      AntColonyScene3D.BACK,  AntColonyScene3D.FRONT,
      3.5,
    )
    // Round 6 Issue 7: rehydrate previously explored areas so leaving and returning
    // to the colony preserves the player's exploration trail.
    const savedFog = registry.get<string>('fogReveal_antColony')
    if (savedFog) this.fog.restore(savedFog)

    for (const l of LANTERN_DATA) {
      this.fog.addBeacon(l.x, l.cz)
    }
  }

  getBossPortalZ(): number { return this.bossPortalZ }

  // ── Ground (5 corridor bands + connecting passages) ───────────────────────────

  private buildGround(): void {
    const mat     = new THREE.MeshToonMaterial({ color: 0x0e0a06, gradientMap: this.gradientMap })
    const patchMat = new THREE.MeshBasicMaterial({ color: 0x1c1208 })

    // Floor per corridor
    for (const cz of CZ) {
      const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, CORR_HW * 2).rotateX(-Math.PI / 2), mat)
      floor.position.set(0, 0, cz)
      floor.receiveShadow = true
      this.add(floor)
    }

    // Passage floors (connecting adjacent corridors)
    for (let wi = 0; wi < DIV_WALLS.length; wi++) {
      const dw   = DIV_WALLS[wi]
      const passH = dw.hi - dw.lo
      for (const gx of DIV_GAPS[wi]) {
        const pass = new THREE.Mesh(
          new THREE.PlaneGeometry(GAP_HALF * 2, passH).rotateX(-Math.PI / 2),
          mat,
        )
        pass.position.set(gx, 0, (dw.lo + dw.hi) / 2)
        this.add(pass)
      }
    }

    // Dirt patches
    for (let ci = 0; ci < CZ.length; ci++) {
      const cz = CZ[ci]
      for (let i = 0; i < 5; i++) {
        const px = (Math.random() - 0.5) * W * 0.9
        const r  = 0.3 + Math.random() * 0.45
        const p  = new THREE.Mesh(new THREE.CircleGeometry(r, 10).rotateX(-Math.PI / 2), patchMat)
        p.position.set(px, 0.006, jitterZ(cz, 1.4))
        this.add(p)
      }
    }
  }

  // ── Outer walls (N + S perimeter) ─────────────────────────────────────────────

  private buildOuterWalls(): void {
    const wm = new THREE.MeshToonMaterial({ color: 0x1a1008, gradientMap: this.gradientMap })
    const cm = new THREE.MeshToonMaterial({ color: 0x2a1a0e, gradientMap: this.gradientMap })

    // Round 8 Issue 9: crooked back + front walls
    this.addCrookedWallSegment(
      AntColonyScene3D.LEFT, AntColonyScene3D.BACK,
      AntColonyScene3D.RIGHT, AntColonyScene3D.BACK,
      0.5, WALL_H, wm,
    )
    this.addBox(W + 0.6, 0.12, 0.6, 0, WALL_H + 0.06, AntColonyScene3D.BACK, cm)
    this.addCrookedWallSegment(
      AntColonyScene3D.LEFT, AntColonyScene3D.FRONT,
      AntColonyScene3D.RIGHT, AntColonyScene3D.FRONT,
      0.35, WALL_H * 0.4, wm,
    )
    // Side walls (E/W)
    this.addBox(0.4, WALL_H, D + 0.6, AntColonyScene3D.RIGHT, WALL_H / 2, 0, wm)
    this.addBox(0.4, WALL_H, D + 0.6, AntColonyScene3D.LEFT,  WALL_H / 2, 0, wm)
    this.addBox(0.6, 0.12, D + 0.6, AntColonyScene3D.RIGHT, WALL_H + 0.06, 0, cm)
    this.addBox(0.6, 0.12, D + 0.6, AntColonyScene3D.LEFT,  WALL_H + 0.06, 0, cm)

    // Stalactites along south back wall
    const stalMat = new THREE.MeshToonMaterial({ color: 0x1a0e04, gradientMap: this.gradientMap })
    for (let sx = -18; sx <= 18; sx += 4) {
      const h = 0.25 + Math.random() * 0.4
      const s = new THREE.Mesh(new THREE.ConeGeometry(0.07, h, 6), stalMat)
      s.position.set(sx, WALL_H - h / 2, AntColonyScene3D.BACK + 0.18)
      s.castShadow = true; this.add(s)
    }

    // Stone bumps at wall base (both sides)
    const stoneMat = new THREE.MeshToonMaterial({ color: 0x1e1006, gradientMap: this.gradientMap })
    for (const sx of [-17, -13, -8, -3, 2, 7, 12, 17]) {
      const h = 0.18 + Math.random() * 0.28
      const s = new THREE.Mesh(new THREE.BoxGeometry(0.8, h, 0.12), stoneMat)
      s.position.set(sx, h / 2 + 0.04, AntColonyScene3D.BACK + 0.12)
      s.castShadow = true; this.add(s)
    }
  }

  // ── Legacy corridor dividers (replaced by buildMazeWalls in Round 9) ──────
  // Kept for reference; no longer called.
  // @ts-ignore — intentionally unused
  private _legacyBuildCorridorDividers(): void {
    for (let wi = 0; wi < DIV_WALLS.length; wi++) {
      const dw  = DIV_WALLS[wi]
      const hz  = (dw.lo + dw.hi) / 2
      const ht  = dw.hi - dw.lo
      const gxs = DIV_GAPS[wi]

      const breakpoints = [AntColonyScene3D.LEFT, ...gxs.flatMap(gx => [gx - GAP_HALF, gx + GAP_HALF]), AntColonyScene3D.RIGHT]
      for (let bi = 0; bi < breakpoints.length - 1; bi += 2) {
        const x0 = breakpoints[bi], x1 = breakpoints[bi + 1]
        const cx = (x0 + x1) / 2, segW = x1 - x0

        // Each divider segment gets its own material instance so opacity is independent.
        // depthWrite:false prevents Z-fighting when walls fade transparent.
        const segMat = new THREE.MeshToonMaterial({
          color: 0x251a0e, gradientMap: this.gradientMap,
          transparent: true, opacity: 1.0, depthWrite: false,
        })
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(segW, WALL_H, ht), segMat)
        mesh.position.set(cx, WALL_H / 2, hz)
        mesh.castShadow = true; mesh.receiveShadow = true
        this.tracked.push(mesh); this.threeScene.add(mesh)

        // Round 6 Issue 6: pair each cap with its panel and a private material so
        // the occlusion system can fade them together (caps were staying opaque).
        const capMat = new THREE.MeshToonMaterial({
          color: 0x332211, gradientMap: this.gradientMap,
          transparent: true, opacity: 1.0, depthWrite: false,
        })
        const cap = new THREE.Mesh(new THREE.BoxGeometry(segW + 0.08, 0.10, ht + 0.1), capMat)
        cap.position.set(cx, WALL_H + 0.05, hz)
        this.tracked.push(cap); this.threeScene.add(cap)

        this.dividerWalls.push({ mesh, mat: segMat, capMat, x0, x1, zLo: dw.lo, zHi: dw.hi })

        const body = physicsWorld.add({
          x: x0, z: dw.lo, radius: 0,
          velocity: { x: 0, z: 0 }, isStatic: true, enabled: true,
          aabb: { x: x0, z: dw.lo, w: segW, h: ht },
        })
        this.wallBodies.push(body)
      }
    }
  }

  // ── Round 9 Issue 5: real maze design ───────────────────────────────────────
  // Replaces the 4-row corridor-divider grid with a chambered maze.  The
  // topology gives the player 3 viable routes from entry (right, Z=0) to boss
  // (left, Z=bossPortalZ):
  //   • Northern  — drop up through Z=+6 gap, traverse west along Z≈+9
  //   • Middle    — straight shot through the open mid arena
  //   • Southern  — drop down through Z=-6 gap, traverse west along Z≈-9
  // Plus dead-end reward alcoves (existing dead-end system) and stub walls in
  // the middle that block sight-lines without fully sealing routes.
  private buildMazeWalls(): void {
    const mat = new THREE.MeshToonMaterial({ color: 0x2a1808, gradientMap: this.gradientMap })

    // ── Northern divider (Z=+6) — gaps at X=-12, X=-2, X=+10 ────────────────
    this.addMazeWall(-20,  6,  -14,  6, 0.4, mat)
    this.addMazeWall(-10,  6,   -4,  6, 0.4, mat)
    this.addMazeWall(  0,  6,    8,  6, 0.4, mat)
    this.addMazeWall( 12,  6,   20,  6, 0.4, mat)

    // ── Southern divider (Z=-6) — gaps at X=-10, X=+2, X=+12 ────────────────
    this.addMazeWall(-20, -6,  -12, -6, 0.4, mat)
    this.addMazeWall( -8, -6,    0, -6, 0.4, mat)
    this.addMazeWall(  4, -6,   10, -6, 0.4, mat)
    this.addMazeWall( 14, -6,   20, -6, 0.4, mat)

    // ── Middle arena stub walls — break sight-lines, force pathing decisions ──
    this.addMazeWall(-13, -2,  -13,  2, 0.4, mat)   // vertical chokepoint near back-left
    this.addMazeWall( -5, -3,   -3,  0, 0.4, mat)   // diagonal stub mid-left
    this.addMazeWall(  3,  0,    5,  3, 0.4, mat)   // diagonal stub mid-right
    this.addMazeWall( 11, -2,   11,  2, 0.4, mat)   // vertical chokepoint near entry

    // ── Stub walls inside corridors for maze complexity ─────────────────────
    this.addMazeWall(-16,  8,  -16, 11, 0.35, mat)  // partial blocker N corridor far west
    this.addMazeWall(  6,  9,    8, 11, 0.35, mat)  // diagonal stub N corridor mid-east
    this.addMazeWall(-15, -8,  -15, -11, 0.35, mat) // partial blocker S corridor far west
    this.addMazeWall(  6, -9,    8, -11, 0.35, mat) // diagonal stub S corridor mid-east

    // ── Decorative stalactites at junctions ─────────────────────────────────
    const stoneMat = new THREE.MeshToonMaterial({ color: 0x1a1006, gradientMap: this.gradientMap })
    const stalacPositions: [number, number][] = [
      [-18,  9], [-12,  6.3], [ -2,  6.3], [10,  6.3], [18,  9],
      [-18, -9], [-10, -6.3], [  2, -6.3], [12, -6.3], [18, -9],
      [-13,  0], [ -5,  3   ], [ 11,  0  ], [  0,  -1.5],
    ]
    for (const [sx, sz] of stalacPositions) {
      const h = 0.2 + Math.random() * 0.35
      const stal = new THREE.Mesh(new THREE.ConeGeometry(0.10, h, 6), stoneMat)
      stal.position.set(sx, WALL_H - h / 2, sz)
      this.add(stal)
    }
  }

  // Add a wall: crooked visual segments + a single physics AABB collider.
  private addMazeWall(
    x0: number, z0: number, x1: number, z1: number,
    thickness: number, mat: THREE.Material,
  ): void {
    this.addCrookedWallSegment(x0, z0, x1, z1, thickness, WALL_H, mat)

    // Physics AABB covering the swept rectangle plus thickness margin.
    const minX = Math.min(x0, x1) - thickness * 0.5
    const minZ = Math.min(z0, z1) - thickness * 0.5
    const wX   = Math.abs(x1 - x0) + thickness
    const wZ   = Math.abs(z1 - z0) + thickness
    const body = physicsWorld.add({
      x: minX, z: minZ, radius: 0,
      velocity: { x: 0, z: 0 }, isStatic: true, enabled: true,
      aabb: { x: minX, z: minZ, w: wX, h: wZ },
    })
    this.wallBodies.push(body)
    this.mazeWallAabbs.push({ cx: minX + wX / 2, cz: minZ + wZ / 2, hw: wX / 2, hh: wZ / 2 })
  }

  // ── Round 9 Issue 5: navigational landmarks ─────────────────────────────────
  // Distinct glowing markers at key junctions so the player can orient through
  // the fog of war.  Each gets a point light for visibility at range.
  private buildLandmarks(): void {
    // Cool blue crystal cluster at northern-corridor west end (safe route landmark)
    const crystalMat = new THREE.MeshStandardMaterial({
      color: 0x66ccff, emissive: 0x3388dd, emissiveIntensity: 1.2,
    })
    for (const [cx, cy, cz] of [
      [-17, 0.30,  10],
      [-17, 0.22,  10.5],
      [-16.5, 0.28, 10.2],
    ] as [number, number, number][]) {
      const c = new THREE.Mesh(new THREE.OctahedronGeometry(0.16, 0), crystalMat)
      c.position.set(cx, cy, cz)
      this.add(c)
    }
    const blueL = new THREE.PointLight(0x66ccff, 1.2, 4.5)
    blueL.position.set(-17, 0.5, 10)
    this.add(blueL)

    // Red danger marker at boss antechamber approach
    const dangerMat = new THREE.MeshStandardMaterial({
      color: 0xff3322, emissive: 0xaa0000, emissiveIntensity: 1.0,
    })
    const dangerMarker = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.45, 4), dangerMat)
    dangerMarker.position.set(-15, 0.30, 0)
    this.add(dangerMarker)
    const redL = new THREE.PointLight(0xff3322, 1.0, 4.0)
    redL.position.set(-15, 0.6, 0)
    this.add(redL)

    // Gold beacon at southern reward route entry
    const goldMat = new THREE.MeshStandardMaterial({
      color: 0xffcc33, emissive: 0xcc8800, emissiveIntensity: 1.0,
    })
    const goldMarker = new THREE.Mesh(new THREE.SphereGeometry(0.14, 10, 8), goldMat)
    goldMarker.position.set(16, 0.40, -10)
    this.add(goldMarker)
    const goldL = new THREE.PointLight(0xffcc33, 1.0, 4.0)
    goldL.position.set(16, 0.6, -10)
    this.add(goldL)
  }

  // Camera-to-player THREE.Raycaster: lerp occluding walls to 0.15 opacity.
  // Casts 3 rays at different heights for reliable detection of lower 1.2wu walls.
  updateWallOcclusion(camera: THREE.Camera, playerPos: THREE.Vector3): void {
    const meshes = this.dividerWalls.map(dw => dw.mesh)
    const occluding = new Set<THREE.Object3D>()
    const RAY_HEIGHTS = [0.1, 0.45, 1.0]   // floor sweep, mid, near-top of 1.2wu wall

    for (const yOff of RAY_HEIGHTS) {
      const targetPos = playerPos.clone()
      targetPos.y     = yOff
      const dir  = new THREE.Vector3().subVectors(targetPos, camera.position).normalize()
      const dist = camera.position.distanceTo(targetPos)
      this._occRaycaster.set(camera.position, dir)
      this._occRaycaster.far = dist
      for (const hit of this._occRaycaster.intersectObjects(meshes, false)) {
        occluding.add(hit.object)
      }
    }

    for (const dw of this.dividerWalls) {
      const target = occluding.has(dw.mesh) ? 0.15 : 1.0
      dw.mat.opacity    = THREE.MathUtils.lerp(dw.mat.opacity,    target, 0.18)
      dw.capMat.opacity = THREE.MathUtils.lerp(dw.capMat.opacity, target, 0.18)
    }
  }

  // ── Portals ────────────────────────────────────────────────────────────────────

  private buildPortals(): void {
    // Entry from home: right side, z=0 (C2)
    this.buildPortalArch(AntColonyScene3D.RIGHT - 0.25, 0, 0x44ddff, 0x006688)
    // Boss portal: left side, boss portal Z (randomized)
    this.buildPortalArch(AntColonyScene3D.LEFT + 0.25, this.bossPortalZ, 0xff4422, 0x881100)
  }

  private buildPortalArch(px: number, pz: number, color: number, emissive: number): void {
    const mat = new THREE.MeshToonMaterial({
      color, gradientMap: this.gradientMap,
      emissive: new THREE.Color(emissive), emissiveIntensity: 0.8,
    })
    const bH = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.6, 0.12), mat)
    bH.position.set(px, 0.8, pz - 0.95); this.add(bH)
    const bH2 = bH.clone(); bH2.position.set(px, 0.8, pz + 0.95); this.add(bH2)
    const bV = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.12, 2.0), mat)
    bV.position.set(px, 1.56, pz); this.add(bV)
    const bV2 = bV.clone(); bV2.position.set(px, 0.06, pz); this.add(bV2)
    const fill = new THREE.Mesh(
      new THREE.PlaneGeometry(0.08, 1.5),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.18, side: THREE.DoubleSide }),
    )
    fill.position.set(px, 0.8, pz); fill.rotation.y = Math.PI / 2; this.add(fill)
    const light = new THREE.PointLight(color, 1.0, 3.5)
    light.position.set(px + (px > 0 ? -0.3 : 0.3), 0.8, pz)
    this.add(light)
  }

  // ── Workbench ──────────────────────────────────────────────────────────────────

  private buildWorkbench(): void {
    const woodMat = new THREE.MeshToonMaterial({ color: 0x5c3d1e, gradientMap: this.gradientMap })
    const darkMat = new THREE.MeshToonMaterial({ color: 0x3b2510, gradientMap: this.gradientMap })
    const bx = AntColonyScene3D.WORKBENCH_X
    const bz = AntColonyScene3D.OBJ_Z
    const top = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.12, 0.9), woodMat)
    top.position.set(bx, 0.52, bz); top.castShadow = true; this.add(top)
    const legGeo = new THREE.BoxGeometry(0.1, 0.5, 0.1)
    for (const [ox, oz] of [[-0.6,-0.35],[0.6,-0.35],[-0.6,0.35],[0.6,0.35]] as [number,number][]) {
      const leg = new THREE.Mesh(legGeo, darkMat)
      leg.position.set(bx + ox, 0.25, bz + oz); this.add(leg)
    }
    const glow = new THREE.Mesh(
      new THREE.RingGeometry(0.6, 0.75, 24).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0x66ffaa, transparent: true, opacity: 0.2, side: THREE.DoubleSide }),
    )
    glow.position.set(bx, 0.01, bz); this.add(glow)
    const wbl = new THREE.PointLight(0x66ffaa, 0.5, 2.5)
    wbl.position.set(bx, 0.9, bz); this.add(wbl)
  }

  // ── Chests ─────────────────────────────────────────────────────────────────────

  private buildChests(): void {
    const bodyMat = new THREE.MeshToonMaterial({ color: 0x5c3d1e, gradientMap: this.gradientMap })
    const lidMat  = new THREE.MeshToonMaterial({ color: 0x7a5025, gradientMap: this.gradientMap })
    const bandMat = new THREE.MeshToonMaterial({ color: 0x888844, gradientMap: this.gradientMap })

    for (const d of CHEST_DATA) {
      const z = jitterZ(d.cz, 1.2)
      const g = new THREE.Group()
      g.position.set(d.x, 0, z)

      const body = new THREE.Mesh(new THREE.BoxGeometry(0.50, 0.30, 0.36), bodyMat.clone())
      body.position.y = 0.15; body.castShadow = true; g.add(body)
      const lid = new THREE.Mesh(new THREE.BoxGeometry(0.50, 0.14, 0.36), lidMat.clone())
      lid.position.y = 0.37; lid.castShadow = true; g.add(lid)
      const band = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.06, 0.06), bandMat.clone())
      band.position.set(0, 0.18, 0.19); g.add(band)

      const glowColor = d.isMimic ? 0xff4422 : 0xffcc44
      const glow = new THREE.Mesh(
        new THREE.RingGeometry(0.22, 0.30, 16).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ color: glowColor, transparent: true, opacity: 0.25, side: THREE.DoubleSide }),
      )
      glow.position.y = 0.01; g.add(glow)

      this.threeScene.add(g)
      this.tracked.push(g)
      this.chests.push({ x: d.x, z, isMimic: d.isMimic, opened: false, mesh: g, wakeProgress: 0, wakeActive: false })
    }
  }

  // ── HP modules ─────────────────────────────────────────────────────────────────

  private buildHpModules(): void {
    for (const d of HP_MODULE_DATA) {
      const z   = jitterZ(d.cz, 1.0)
      const mat = new THREE.MeshStandardMaterial({ color: 0xff3344, emissive: 0xcc1122, emissiveIntensity: 0.7 })
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 6), mat)
      mesh.position.set(d.x, 0.22, z)
      const glow = new THREE.Mesh(
        new THREE.RingGeometry(0.16, 0.22, 16).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ color: 0xff4455, transparent: true, opacity: 0.40, side: THREE.DoubleSide }),
      )
      glow.position.set(d.x, 0.01, z)
      this.threeScene.add(mesh, glow)
      this.tracked.push(mesh, glow)
      this.hpModules.push({ x: d.x, z, collected: false, mesh })
    }
  }

  // ── Material caches ────────────────────────────────────────────────────────────

  private buildCaches(): void {
    const colors: Record<string, number> = {
      SilkThread: 0xddeeff, ChitinShard: 0x88aa44, WebFluid: 0x44aaff,
      BoneFragment: 0xccbbaa, BugPartsAnt: 0xaa8855, DriedFungus: 0x88cc44,
    }
    for (const d of CACHE_DATA) {
      const z     = jitterZ(d.cz, 1.0)
      const color = colors[d.mat] ?? 0xaaaaaa
      const mat   = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.4 })
      const mesh  = new THREE.Mesh(new THREE.SphereGeometry(0.10, 7, 5), mat)
      mesh.position.set(d.x, 0.18, z)
      this.threeScene.add(mesh); this.tracked.push(mesh)
      this.caches.push({ x: d.x, z, collected: false, mesh, mat: d.mat, qty: d.qty })
    }
  }

  // ── Thistle seeds ──────────────────────────────────────────────────────────────

  private buildThistles(): void {
    const mat = new THREE.MeshToonMaterial({ color: 0xcc99ff, gradientMap: this.gradientMap })
    for (const d of THISTLE_DATA) {
      const z    = jitterZ(d.cz, 1.2)
      const mesh = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.18, 5), mat.clone())
      mesh.position.set(d.x, 0.09, z)
      mesh.rotation.z = 0.3
      this.threeScene.add(mesh); this.tracked.push(mesh)
      this.thistles.push({ x: d.x, z, collected: false, mesh })
    }
  }

  // ── Dead-end rooms ─────────────────────────────────────────────────────────────

  private buildDeadEnds(): void {
    const floorMat = new THREE.MeshToonMaterial({ color: 0x0a0805, gradientMap: this.gradientMap })
    const wallMat  = new THREE.MeshToonMaterial({ color: 0x1a1208, gradientMap: this.gradientMap })
    const spikeMat = new THREE.MeshToonMaterial({ color: 0x3a1a08, gradientMap: this.gradientMap })
    const lootMat  = new THREE.MeshBasicMaterial({ color: 0x44ffaa, transparent: true, opacity: 0.3 })

    for (const d of DEAD_END_DATA) {
      const roomDepth = 3.0
      const roomW     = 3.0
      // Alcove center: extend dz * roomDepth from corridor edge
      const corrEdge  = d.cz + d.dz * CORR_HW
      const roomCZ    = corrEdge + d.dz * (roomDepth / 2)

      const g = new THREE.Group()
      g.position.set(d.x, 0, roomCZ)

      // Floor
      const floor = new THREE.Mesh(new THREE.PlaneGeometry(roomW, roomDepth).rotateX(-Math.PI / 2), floorMat)
      g.add(floor)

      // Back wall
      const back = new THREE.Mesh(new THREE.BoxGeometry(roomW, WALL_H, 0.25), wallMat)
      back.position.set(0, WALL_H / 2, d.dz * roomDepth / 2)
      back.castShadow = true; g.add(back)

      // Side walls
      for (const side of [-1, 1]) {
        const sw = new THREE.Mesh(new THREE.BoxGeometry(0.25, WALL_H, roomDepth), wallMat)
        sw.position.set(side * roomW / 2, WALL_H / 2, 0)
        sw.castShadow = true; g.add(sw)
      }

      // Type-specific decorations
      const spikes: THREE.Mesh[] = []
      if (d.type === 'spike') {
        for (let i = -1; i <= 1; i++) {
          const spike = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.35, 5), spikeMat)
          spike.position.set(i * 0.7, 0.175, 0)
          g.add(spike); spikes.push(spike)
        }
      } else if (d.type === 'loot') {
        const glow = new THREE.Mesh(new THREE.SphereGeometry(0.15, 7, 5), lootMat)
        glow.position.set(0, 0.25, 0); g.add(glow)
        const light = new THREE.PointLight(0x44ffaa, 0.4, 1.5)
        light.position.set(0, 0.4, 0); g.add(light)
      }

      this.threeScene.add(g); this.tracked.push(g)
      this.deadEnds.push({
        x: d.x, z: roomCZ, type: d.type, triggered: false, mesh: g,
        spikeMeshes: spikes.length > 0 ? spikes : undefined,
      })
    }
  }

  // ── Environmental decoration ────────────────────────────────────────────────────

  private buildDecoration(): void {
    const boneMat = new THREE.MeshToonMaterial({ color: 0xb8a882, gradientMap: this.gradientMap })

    // Bone piles scattered through corridors
    for (const [bx, cz, r] of [
      [-16,-10,0.28],[-7,-10,0.22],[3,-10,0.30],[12,-10,0.25],
      [-14,-5,0.26],[-3,-5,0.20],[8,-5,0.28],
      [-11,0,0.22],[4,0,0.26],[14,0,0.24],
      [-13,5,0.28],[-2,5,0.22],[9,5,0.26],
      [-16,10,0.25],[1,10,0.30],[13,10,0.22],
    ] as [number,number,number][]) {
      const bone = new THREE.Mesh(new THREE.CapsuleGeometry(r*0.3, r*1.2, 4, 6), boneMat)
      bone.position.set(bx, r*0.2, jitterZ(cz, 0.8)); bone.rotation.y = Math.random() * Math.PI; this.add(bone)
    }

    // Fungus lanterns (32 orbs — positions from LANTERN_DATA)
    for (const l of LANTERN_DATA) {
      const orb = new THREE.Mesh(
        new THREE.SphereGeometry(0.06, 6, 5),
        new THREE.MeshBasicMaterial({ color: 0x66ffaa }),
      )
      const jz = jitterZ(l.cz, 0.5)
      orb.position.set(l.x, 0.12, jz); this.add(orb)
      this.orbMeshes.push(orb)
      const gl = new THREE.PointLight(0x44ff88, 0.35, 2.0)
      gl.position.set(l.x, 0.2, jz); this.add(gl)
    }

    // Ant trail dots across all corridors
    const trailMat = new THREE.MeshBasicMaterial({ color: 0x060402 })
    for (const cz of CZ) {
      for (let i = -18; i < 18; i += 1.2) {
        const dot = new THREE.Mesh(new THREE.CircleGeometry(0.04, 5).rotateX(-Math.PI / 2), trailMat)
        dot.position.set(i + Math.sin(i * 1.5) * 0.35, 0.007, cz + Math.cos(i * 1.3) * 0.3)
        this.add(dot)
      }
    }
  }

  // ── Lighting ────────────────────────────────────────────────────────────────────

  private buildLighting(): void {
    // Round 8 Issue 9: brighter ambient + extra warm entry light
    this.add(new THREE.AmbientLight(0x223315, 0.55))
    const fill = new THREE.DirectionalLight(0x445533, 0.35)
    fill.position.set(-10, 12, -5); this.add(fill)
    const entryLight = new THREE.DirectionalLight(0xddcc88, 0.20)
    entryLight.position.set(18, 8, 0); this.add(entryLight)
  }

  // Round 8 Issue 9: build a single wall as a chain of jittered, slightly
  // rotated short boxes so it reads as natural dirt rather than a flat block.
  private addCrookedWallSegment(
    startX: number, startZ: number, endX: number, endZ: number,
    thickness: number, height: number, mat: THREE.Material,
  ): void {
    const dx = endX - startX
    const dz = endZ - startZ
    const length = Math.sqrt(dx * dx + dz * dz)
    if (length < 0.01) return
    const segments = Math.max(4, Math.floor(length * 1.5))
    const stepDx = dx / segments
    const stepDz = dz / segments
    const baseAngle = Math.atan2(dz, dx)

    for (let i = 0; i < segments; i++) {
      const cx = startX + stepDx * (i + 0.5)
      const cz = startZ + stepDz * (i + 0.5)
      const perpX = -Math.sin(baseAngle)
      const perpZ =  Math.cos(baseAngle)
      const jitter      = (Math.random() - 0.5) * 0.3
      const angleJitter = (Math.random() - 0.5) * 0.25
      const segLength   = Math.hypot(stepDx, stepDz) * 1.1
      const box = new THREE.Mesh(
        new THREE.BoxGeometry(segLength, height + (Math.random() - 0.5) * 0.2, thickness),
        mat,
      )
      box.position.set(cx + perpX * jitter, height / 2, cz + perpZ * jitter)
      box.rotation.y = baseAngle + angleJitter
      box.castShadow = true
      box.receiveShadow = true
      this.add(box)
    }
  }

  // ── Enemy spawns (Round 7 Issue 3) ──────────────────────────────────────────

  private initSpawns(): void {
    this.pendingSpawns   = SPAWN_PLAN.map(s => ({ ...s }))   // clone
    this.elapsedSinceLoad = 0
  }

  private processPendingSpawns(delta: number): void {
    this.elapsedSinceLoad += delta
    for (let i = this.pendingSpawns.length - 1; i >= 0; i--) {
      const s = this.pendingSpawns[i]
      if (this.elapsedSinceLoad >= s.delay) {
        const e = this.spawnEnemy(s.kind, s.x, s.z)
        this.freeEnemies.push(e)
        this.pendingSpawns.splice(i, 1)
      }
    }
  }

  private spawnEnemy(kind: SpawnKind, x: number, z: number): Enemy3D {
    switch (kind) {
      case 'centipede':      return new CentipedeAmbusher3D(this.threeScene, x, z, this.gradientMap)
      case 'beetle':         return new BeetleTank3D(this.threeScene, x, z, this.gradientMap)
      case 'ant_worker':     return new AntWorker3D(this.threeScene, x, z, this.gradientMap)
      case 'jumping_spider': return new JumpingSpider3D(this.threeScene, x, z, this.gradientMap)
    }
  }

  // ── Public API ──────────────────────────────────────────────────────────────────

  checkExitRight(playerX: number): boolean { return playerX > AntColonyScene3D.EXIT_RIGHT_X }
  checkExitLeft(playerX:  number): boolean { return playerX < AntColonyScene3D.EXIT_LEFT_X  }

  webWallHitTest(x: number, z: number): boolean {
    if (x <= AntColonyScene3D.LEFT  + 0.5 ||
        x >= AntColonyScene3D.RIGHT - 0.5 ||
        z <= AntColonyScene3D.BACK  + 0.3 ||
        z >= AntColonyScene3D.FRONT - 0.3) return true
    // Round 9 Issue 5: check maze wall AABBs instead of corridor dividers
    for (const w of this.mazeWallAabbs) {
      if (Math.abs(x - w.cx) < w.hw + 0.1 && Math.abs(z - w.cz) < w.hh + 0.1) return true
    }
    return false
  }

  nearWorkbench(playerX: number, playerZ: number): boolean {
    const dx = playerX - AntColonyScene3D.WORKBENCH_X
    const dz = playerZ - AntColonyScene3D.OBJ_Z
    return dx * dx + dz * dz < 0.36
  }

  nearChest(px: number, pz: number): number {
    for (let i = 0; i < this.chests.length; i++) {
      if (this.chests[i].opened) continue
      const dx = px - this.chests[i].x, dz = pz - this.chests[i].z
      if (dx * dx + dz * dz < 0.6 * 0.6) return i
    }
    return -1
  }

  openChest(idx: number): { kind: 'loot'; mat: string; qty: number } | { kind: 'mimic' } {
    const chest = this.chests[idx]
    if (!chest || chest.opened) return { kind: 'loot', mat: 'SilkThread', qty: 0 }
    chest.opened = true
    chest.wakeActive = false
    const lid = chest.mesh.children[1] as THREE.Mesh
    if (lid) lid.rotation.x = -Math.PI / 2.2

    if (chest.isMimic) {
      const e = new BeetleTank3D(this.threeScene, chest.x, chest.z + 0.5, this.gradientMap)
      this.freeEnemies.push(e)
      return { kind: 'mimic' }
    }
    const loot = CHEST_LOOT[Math.floor(Math.random() * CHEST_LOOT.length)]
    return { kind: 'loot', ...loot }
  }

  nearHpModule(px: number, pz: number): number {
    for (let i = 0; i < this.hpModules.length; i++) {
      if (this.hpModules[i].collected) continue
      const dx = px - this.hpModules[i].x, dz = pz - this.hpModules[i].z
      if (dx * dx + dz * dz < 0.45 * 0.45) return i
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
    for (const c of this.caches) {
      if (c.collected) continue
      const dx = px - c.x, dz = pz - c.z
      if (dx * dx + dz * dz < 0.42 * 0.42) return c
    }
    return null
  }

  collectCache(record: PickupRecord): void {
    record.collected = true
    if (record.mesh) { this.threeScene.remove(record.mesh); record.mesh = null }
  }

  nearThistle(px: number, pz: number): number {
    for (let i = 0; i < this.thistles.length; i++) {
      if (this.thistles[i].collected) continue
      const dx = px - this.thistles[i].x, dz = pz - this.thistles[i].z
      if (dx * dx + dz * dz < 0.42 * 0.42) return i
    }
    return -1
  }

  collectThistle(idx: number): void {
    const t = this.thistles[idx]
    if (!t || t.collected) return
    t.collected = true
    if (t.mesh) { this.threeScene.remove(t.mesh); t.mesh = null }
  }

  // Dead-end room trigger. Returns result info for main.ts to handle (HUD, damage).
  checkDeadEndTriggers(px: number, pz: number): DeadEndResult {
    for (const room of this.deadEnds) {
      if (room.triggered) continue
      const dx = px - room.x, dz = pz - room.z
      if (dx * dx + dz * dz > 1.2 * 1.2) continue
      room.triggered = true
      switch (room.type) {
        case 'spike':
          return { type: 'spike', damage: 15 }
        case 'ambush': {
          for (let i = 0; i < 2; i++) {
            const e = new CentipedeAmbusher3D(
              this.threeScene,
              room.x + (i * 0.6 - 0.3),
              room.z + (Math.random() - 0.5) * 0.5,
              this.gradientMap,
            )
            this.freeEnemies.push(e)
          }
          return { type: 'ambush' }
        }
        case 'loot': {
          const loot = CHEST_LOOT[Math.floor(Math.random() * CHEST_LOOT.length)]
          return { type: 'loot', ...loot }
        }
      }
    }
    return null
  }

  // Per-frame visual updates: mimic wake animation + orb bob
  tickVisuals(delta: number, px: number, pz: number): void {
    const t = Date.now() * 0.001

    // Orb bob
    for (let i = 0; i < this.orbMeshes.length; i++) {
      this.orbMeshes[i].position.y = 0.10 + Math.sin(t * 1.8 + i * 0.7) * 0.04
    }

    // Mimic wake
    for (const chest of this.chests) {
      if (chest.opened || !chest.isMimic) continue
      const dx = px - chest.x, dz = pz - chest.z
      const near = dx * dx + dz * dz < 1.2 * 1.2

      if (near && !chest.wakeActive) {
        chest.wakeActive = true
      }
      if (!near && chest.wakeActive) {
        chest.wakeActive   = false
        chest.wakeProgress = 0
        this.setMimicWakeVisual(chest, 0)
      }

      if (chest.wakeActive) {
        chest.wakeProgress = Math.min(1, chest.wakeProgress + delta / 1.5)
        this.setMimicWakeVisual(chest, chest.wakeProgress)
        // Chest jitter
        const jitter = chest.wakeProgress * 0.015
        chest.mesh.position.x = chest.x + (Math.random() - 0.5) * jitter
        chest.mesh.position.z = chest.z + (Math.random() - 0.5) * jitter
      }
    }
  }

  private setMimicWakeVisual(chest: ChestRecord, t: number): void {
    // Glow ring (child[3]) pulses from orange to red
    const glow = chest.mesh.children[3] as THREE.Mesh | undefined
    if (glow) {
      const mat = glow.material as THREE.MeshBasicMaterial
      mat.color.setRGB(1, 0.27 * (1 - t), 0.13 * (1 - t) * 0.5)  // orange→red
      mat.opacity = 0.25 + t * 0.4
    }
  }

  // ── Enemy update ────────────────────────────────────────────────────────────────

  updateEnemies(delta: number, px: number, pz: number): void {
    // Round 7 Issue 3: drain the pending queue first so newly-spawned enemies
    // tick immediately on the same frame they appear.
    this.processPendingSpawns(delta)

    for (const e of this.freeEnemies) {
      const offscreen = Math.abs(e.collisionBody.x - px) > CULL_R &&
                        Math.abs(e.collisionBody.z - pz) > CULL_R * 0.3
      e.group.visible = !offscreen
      if (!offscreen) { e.update(delta, px, pz); e.syncPosition() }
    }
    for (let i = this.freeEnemies.length - 1; i >= 0; i--) {
      if (this.freeEnemies[i].isExpired()) {
        this.freeEnemies[i].cleanup()
        this.freeEnemies.splice(i, 1)
      }
    }

    this.enemies.length = 0
    for (const e of this.freeEnemies) {
      if (!e.isDead()) this.enemies.push(e)
    }
  }

  // ── Destroy ─────────────────────────────────────────────────────────────────────

  destroy(): void {
    // Round 6 Issue 7: snapshot the reveal canvas before destroying so the next
    // visit can restore it.
    const fogSnapshot = this.fog.serialize()
    if (fogSnapshot) registry.set('fogReveal_antColony', fogSnapshot)
    this.fog.destroy(this.threeScene)
    for (const e of this.freeEnemies) e.cleanup()
    for (const b of this.wallBodies) physicsWorld.remove(b)
    this.enemies        = []
    this.pendingSpawns  = []
    this.freeEnemies    = []
    this.wallBodies     = []
    for (const obj of this.tracked) {
      this.threeScene.remove(obj)
      if ((obj as THREE.Mesh).isMesh) (obj as THREE.Mesh).geometry.dispose()
    }
    this.tracked = []
    physicsWorld.bounds = null
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────────

  private addBox(w: number, h: number, d: number, x: number, y: number, z: number, mat: THREE.Material): void {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat)
    mesh.position.set(x, y, z); mesh.castShadow = true; mesh.receiveShadow = true
    this.add(mesh)
  }

  private add(obj: THREE.Object3D): void {
    this.tracked.push(obj)
    this.threeScene.add(obj)
  }
}
