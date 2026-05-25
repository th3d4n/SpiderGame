import * as THREE from 'three'
import { physicsWorld } from '../core/PhysicsWorld'
import type { Enemy3D } from '../entities/Enemy3D'
import { CentipedeAmbusher3D } from '../entities/CentipedeAmbusher3D'
import { BeetleTank3D } from '../entities/BeetleTank3D'
import { FogOfWarSystem3D } from '../systems/FogOfWarSystem3D'

const W       = 40    // world width  (X: -20 … +20)
const D       = 7.2   // world depth  (Z: -3.6 … +3.6)
const WALL_H  = 2.0
const WALL_T  = 0.30  // maze wall thickness
const RESPAWN = 22    // seconds between respawns
const CULL_R  = 13    // skip update beyond this X distance from player

// ─── Maze walls — 5 cross-barriers dividing the corridor into 6 sections ──────
// Each entry lists wall SEGMENTS that BLOCK the passage (player walks through gaps).
const MAZE_WALLS: Array<{ x: number; segs: Array<{ z1: number; z2: number }> }> = [
  { x: -14, segs: [{ z1: -0.3,  z2:  3.6 }] },             // passage: back half
  { x:  -7, segs: [{ z1: -3.6,  z2:  0.4 }] },             // passage: front half
  { x:   0, segs: [{ z1: -3.6, z2: -0.9 }, { z1: 0.9, z2: 3.6 }] }, // center gap
  { x:   7, segs: [{ z1: -0.3,  z2:  3.6 }] },             // passage: back half
  { x:  14, segs: [{ z1: -3.6,  z2:  0.4 }] },             // passage: front half
]

// ─── 23 enemy spawns ──────────────────────────────────────────────────────────
const SPAWN_DATA: Array<{ kind: 'centipede' | 'beetle'; x: number; z: number }> = [
  // Section 1  (X: -20…-14)
  { kind: 'centipede', x: -18,  z: -1.0 },
  { kind: 'centipede', x: -17,  z:  2.5 },
  { kind: 'beetle',    x: -16,  z: -2.8 },
  { kind: 'centipede', x: -15,  z:  1.0 },
  // Section 2  (X: -14…-7)
  { kind: 'centipede', x: -12,  z:  2.2 },
  { kind: 'beetle',    x: -11,  z: -2.0 },
  { kind: 'centipede', x: -10,  z:  3.0 },
  { kind: 'beetle',    x:  -9,  z: -1.0 },
  { kind: 'centipede', x:  -8,  z:  1.5 },
  // Section 3  (X: -7…0)
  { kind: 'centipede', x:  -6,  z: -2.5 },
  { kind: 'beetle',    x:  -5,  z:  2.0 },
  { kind: 'centipede', x:  -3,  z: -1.0 },
  { kind: 'centipede', x:  -2,  z:  3.0 },
  // Section 4  (X: 0…7)
  { kind: 'centipede', x:   1,  z: -3.0 },
  { kind: 'beetle',    x:   2,  z:  2.5 },
  { kind: 'centipede', x:   3,  z: -1.5 },
  { kind: 'beetle',    x:   5,  z:  1.0 },
  { kind: 'centipede', x:   6,  z: -2.0 },
  // Section 5  (X: 7…14)
  { kind: 'centipede', x:   8,  z:  2.0 },
  { kind: 'beetle',    x:   9,  z: -3.0 },
  { kind: 'centipede', x:  11,  z:  1.5 },
  { kind: 'centipede', x:  12,  z: -1.5 },
  { kind: 'beetle',    x:  13,  z:  3.0 },
]

// ─── 14 chests (4 mimics ≈ 29%) ───────────────────────────────────────────────
const CHEST_DATA: Array<{ x: number; z: number; isMimic: boolean }> = [
  { x: -18, z:  1.8, isMimic: false },
  { x: -18, z: -2.5, isMimic: false },
  { x: -12, z:  2.8, isMimic: false },
  { x: -11, z: -2.5, isMimic: true  },
  { x:  -5, z:  3.0, isMimic: false },
  { x:  -4, z: -3.0, isMimic: false },
  { x:  -1, z:  2.5, isMimic: true  },
  { x:   2, z: -3.0, isMimic: false },
  { x:   4, z:  3.0, isMimic: false },
  { x:   7, z: -3.0, isMimic: true  },
  { x:  10, z:  2.5, isMimic: false },
  { x:  11, z: -2.0, isMimic: true  },
  { x:  17, z:  1.5, isMimic: false },
  { x:  17, z: -2.5, isMimic: false },
]

// Chest loot pool — one entry picked at random
const CHEST_LOOT = [
  { mat: 'SilkThread',  qty: 3 },
  { mat: 'ChitinShard', qty: 2 },
  { mat: 'WebFluid',    qty: 2 },
  { mat: 'BoneFragment',qty: 2 },
  { mat: 'BugPartsAnt', qty: 3 },
  { mat: 'DriedFungus', qty: 1 },
]

// ─── 9 HP modules ─────────────────────────────────────────────────────────────
const HP_MODULE_DATA: Array<{ x: number; z: number }> = [
  { x: -19, z:  0.5 }, { x: -16, z: -0.5 },
  { x: -12, z:  0.0 }, { x:  -5, z:  0.8 },
  { x:   0, z: -0.5 }, { x:   4, z:  0.3 },
  { x:   8, z: -0.5 }, { x:  15, z:  0.0 },
  { x:  18, z:  1.0 },
]

// ─── 12 material caches + 10 thistle seeds ────────────────────────────────────
const CACHE_DATA: Array<{ x: number; z: number; mat: string; qty: number }> = [
  { x: -18, z:  3.0, mat: 'SilkThread',  qty: 2 },
  { x: -17, z: -1.0, mat: 'ChitinShard', qty: 2 },
  { x: -13, z:  0.8, mat: 'BugPartsAnt', qty: 2 },
  { x: -10, z:  1.5, mat: 'WebFluid',    qty: 2 },
  { x:  -8, z: -3.0, mat: 'SilkThread',  qty: 2 },
  { x:  -3, z:  2.0, mat: 'BoneFragment',qty: 1 },
  { x:   1, z: -2.0, mat: 'ChitinShard', qty: 2 },
  { x:   5, z:  3.0, mat: 'BugPartsAnt', qty: 2 },
  { x:   9, z: -0.8, mat: 'DriedFungus', qty: 1 },
  { x:  11, z:  3.0, mat: 'WebFluid',    qty: 2 },
  { x:  15, z: -2.5, mat: 'SilkThread',  qty: 2 },
  { x:  18, z:  3.0, mat: 'BoneFragment',qty: 1 },
]

const THISTLE_DATA: Array<{ x: number; z: number }> = [
  { x: -19, z:  2.5 }, { x: -15, z: -2.0 },
  { x: -11, z:  3.2 }, { x:  -6, z: -1.5 },
  { x:  -2, z:  1.8 }, { x:   3, z: -2.8 },
  { x:   6, z:  1.2 }, { x:  10, z: -2.5 },
  { x:  14, z:  2.5 }, { x:  18, z: -1.5 },
]

// ─── Types ────────────────────────────────────────────────────────────────────

interface SpawnRecord {
  kind:          'centipede' | 'beetle'
  x:             number
  z:             number
  enemy:         Enemy3D | null
  respawnTimer:  number   // seconds; 0 on init → spawn immediately
}

interface ChestRecord {
  x:       number
  z:       number
  isMimic: boolean
  opened:  boolean
  mesh:    THREE.Group
}

interface PickupRecord {
  x:         number
  z:         number
  collected: boolean
  mesh:      THREE.Mesh | null
  // for caches only:
  mat?:      string
  qty?:      number
}

export class AntColonyScene3D {
  static readonly LEFT  = -W / 2          // -20
  static readonly RIGHT =  W / 2          //  +20
  static readonly BACK  = -D / 2          // -3.6
  static readonly FRONT =  D / 2          // +3.6

  static readonly EXIT_RIGHT_X      =  19.0
  static readonly EXIT_LEFT_X       = -19.0
  static readonly SPAWN_FROM_HOME_X =  18.5
  static readonly SPAWN_FROM_BOSS_X = -18.5
  static readonly WORKBENCH_X       =  15.0
  static readonly OBJ_Z             =  2.0

  enemies: Enemy3D[] = []  // mutated in-place — weaponUseSystem holds this ref
  fog:     FogOfWarSystem3D

  private threeScene:    THREE.Scene
  private gradientMap:   THREE.Texture
  private tracked:       THREE.Object3D[] = []
  private spawnRecords:  SpawnRecord[]    = []
  private freeEnemies:   Enemy3D[]        = []  // mimics and one-off spawns
  private chests:        ChestRecord[]    = []
  private hpModules:     PickupRecord[]   = []
  private caches:        PickupRecord[]   = []
  private thistles:      PickupRecord[]   = []

  constructor(threeScene: THREE.Scene, gradientMap: THREE.Texture) {
    this.threeScene  = threeScene
    this.gradientMap = gradientMap

    physicsWorld.bounds = {
      minX: AntColonyScene3D.LEFT  - 1,
      maxX: AntColonyScene3D.RIGHT + 1,
      minZ: AntColonyScene3D.BACK  + 0.3,
      maxZ: AntColonyScene3D.FRONT - 0.3,
    }

    this.buildGround()
    this.buildOuterWalls()
    this.buildMazeWalls()
    this.buildPortals()
    this.buildWorkbench()
    this.buildChests()
    this.buildHpModules()
    this.buildCaches()
    this.buildThistles()
    this.buildDecoration()
    this.buildLighting()
    this.initSpawns()

    this.fog = new FogOfWarSystem3D(
      threeScene,
      AntColonyScene3D.LEFT,  AntColonyScene3D.RIGHT,
      AntColonyScene3D.BACK,  AntColonyScene3D.FRONT,
      3.5,
    )
  }

  // ── Ground ───────────────────────────────────────────────────────────────────

  private buildGround(): void {
    const mat = new THREE.MeshToonMaterial({ color: 0x0e0a06, gradientMap: this.gradientMap })
    this.add(new THREE.Mesh(new THREE.PlaneGeometry(W, D).rotateX(-Math.PI / 2), mat))

    const patchMat = new THREE.MeshBasicMaterial({ color: 0x1c1208 })
    for (const [px, pz] of [[-15,-1],[-8,1.5],[-2,-2],[3,0.8],[9,-1.8],[14,2.2],[-12,2.5],[6,-2.5],[0,1]] as [number,number][]) {
      const r = 0.35 + Math.random() * 0.45
      const p = new THREE.Mesh(new THREE.CircleGeometry(r, 10).rotateX(-Math.PI / 2), patchMat)
      p.position.set(px, 0.006, pz)
      this.add(p)
    }
  }

  // ── Outer walls ───────────────────────────────────────────────────────────────

  private buildOuterWalls(): void {
    const wm = new THREE.MeshToonMaterial({ color: 0x1a1008, gradientMap: this.gradientMap })
    const cm = new THREE.MeshToonMaterial({ color: 0x2a1a0e, gradientMap: this.gradientMap })

    this.addBox(W + 0.6, WALL_H, 0.4, 0, WALL_H / 2, AntColonyScene3D.BACK,  wm)
    this.addBox(0.4, WALL_H, D + 0.6, AntColonyScene3D.RIGHT, WALL_H / 2, 0, wm)
    this.addBox(0.4, WALL_H, D + 0.6, AntColonyScene3D.LEFT,  WALL_H / 2, 0, wm)
    this.addBox(W + 0.6, WALL_H * 0.4, 0.3, 0, WALL_H * 0.2, AntColonyScene3D.FRONT, wm)
    this.addBox(W + 0.6, 0.12, 0.6, 0, WALL_H + 0.06, AntColonyScene3D.BACK,  cm)
    this.addBox(0.6, 0.12, D + 0.6, AntColonyScene3D.RIGHT, WALL_H + 0.06, 0, cm)
    this.addBox(0.6, 0.12, D + 0.6, AntColonyScene3D.LEFT,  WALL_H + 0.06, 0, cm)

    const stoneMat = new THREE.MeshToonMaterial({ color: 0x1e1006, gradientMap: this.gradientMap })
    for (const sx of [-17, -13, -8, -3, 2, 7, 12, 17]) {
      const h = 0.18 + Math.random() * 0.3
      const s = new THREE.Mesh(new THREE.BoxGeometry(0.8, h, 0.12), stoneMat)
      s.position.set(sx, h / 2 + 0.04, AntColonyScene3D.BACK + 0.12)
      s.castShadow = true; this.add(s)
    }

    const stalMat = new THREE.MeshToonMaterial({ color: 0x1a0e04, gradientMap: this.gradientMap })
    for (const [sx, sz] of [[-16,-2.5],[-10,-2.8],[-4,-2.6],[2,-2.9],[8,-2.4],[14,-2.7]] as [number,number][]) {
      const h = 0.25 + Math.random() * 0.4
      const s = new THREE.Mesh(new THREE.ConeGeometry(0.07, h, 6), stalMat)
      s.position.set(sx, WALL_H - h / 2, sz)
      s.castShadow = true; this.add(s)
    }
  }

  // ── Maze cross-walls ──────────────────────────────────────────────────────────

  private buildMazeWalls(): void {
    const wallMat = new THREE.MeshToonMaterial({ color: 0x251a0e, gradientMap: this.gradientMap })
    const capMat  = new THREE.MeshToonMaterial({ color: 0x332211, gradientMap: this.gradientMap })

    for (const wall of MAZE_WALLS) {
      for (const seg of wall.segs) {
        const depth = seg.z2 - seg.z1
        const cz    = (seg.z1 + seg.z2) / 2
        this.addBox(WALL_T, WALL_H,        depth, wall.x, WALL_H / 2,      cz, wallMat)
        this.addBox(WALL_T + 0.08, 0.10, depth + 0.1, wall.x, WALL_H + 0.05, cz, capMat)
      }
    }
  }

  // ── Portals ───────────────────────────────────────────────────────────────────

  private buildPortals(): void {
    this.buildPortalArch(AntColonyScene3D.RIGHT - 0.25, 0, 0x44ddff, 0x006688)
    this.buildPortalArch(AntColonyScene3D.LEFT  + 0.25, 0, 0xff4422, 0x881100)
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

  // ── Workbench ─────────────────────────────────────────────────────────────────

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
    this.add(new THREE.PointLight(0x66ffaa, 0.5, 2.5) as unknown as THREE.Object3D)
    const wbl = new THREE.PointLight(0x66ffaa, 0.5, 2.5)
    wbl.position.set(bx, 0.9, bz); this.add(wbl)
  }

  // ── Chests ────────────────────────────────────────────────────────────────────

  private buildChests(): void {
    const bodyMat = new THREE.MeshToonMaterial({ color: 0x5c3d1e, gradientMap: this.gradientMap })
    const lidMat  = new THREE.MeshToonMaterial({ color: 0x7a5025, gradientMap: this.gradientMap })
    const bandMat = new THREE.MeshToonMaterial({ color: 0x888844, gradientMap: this.gradientMap })

    for (const d of CHEST_DATA) {
      const g = new THREE.Group()
      g.position.set(d.x, 0, d.z)

      const body = new THREE.Mesh(new THREE.BoxGeometry(0.50, 0.30, 0.36), bodyMat.clone())
      body.position.y = 0.15; body.castShadow = true; g.add(body)

      const lid = new THREE.Mesh(new THREE.BoxGeometry(0.50, 0.14, 0.36), lidMat.clone())
      lid.position.y = 0.37; lid.castShadow = true; g.add(lid)

      const band = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.06, 0.06), bandMat.clone())
      band.position.set(0, 0.18, 0.19); g.add(band)

      const glow = new THREE.Mesh(
        new THREE.RingGeometry(0.22, 0.30, 16).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ color: d.isMimic ? 0xff4422 : 0xffcc44, transparent: true, opacity: 0.25, side: THREE.DoubleSide }),
      )
      glow.position.y = 0.01; g.add(glow)

      this.threeScene.add(g)
      this.tracked.push(g)
      this.chests.push({ x: d.x, z: d.z, isMimic: d.isMimic, opened: false, mesh: g })
    }
  }

  // ── HP modules ────────────────────────────────────────────────────────────────

  private buildHpModules(): void {
    for (const d of HP_MODULE_DATA) {
      const mat = new THREE.MeshStandardMaterial({ color: 0xff3344, emissive: 0xcc1122, emissiveIntensity: 0.7 })
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 6), mat)
      mesh.position.set(d.x, 0.22, d.z)
      const glow = new THREE.Mesh(
        new THREE.RingGeometry(0.16, 0.22, 16).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ color: 0xff4455, transparent: true, opacity: 0.40, side: THREE.DoubleSide }),
      )
      glow.position.set(d.x, 0.01, d.z)
      this.threeScene.add(mesh, glow)
      this.tracked.push(mesh, glow)
      this.hpModules.push({ x: d.x, z: d.z, collected: false, mesh })
    }
  }

  // ── Material caches ───────────────────────────────────────────────────────────

  private buildCaches(): void {
    const colors: Record<string, number> = {
      SilkThread: 0xddeeff, ChitinShard: 0x88aa44, WebFluid:    0x44aaff,
      BoneFragment: 0xccbbaa, BugPartsAnt: 0xaa8855, DriedFungus: 0x88cc44,
    }
    for (const d of CACHE_DATA) {
      const color = colors[d.mat] ?? 0xaaaaaa
      const mat   = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.4 })
      const mesh  = new THREE.Mesh(new THREE.SphereGeometry(0.10, 7, 5), mat)
      mesh.position.set(d.x, 0.18, d.z)
      this.threeScene.add(mesh); this.tracked.push(mesh)
      this.caches.push({ x: d.x, z: d.z, collected: false, mesh, mat: d.mat, qty: d.qty })
    }
  }

  // ── Thistle seeds ─────────────────────────────────────────────────────────────

  private buildThistles(): void {
    const mat = new THREE.MeshToonMaterial({ color: 0xcc99ff, gradientMap: this.gradientMap })
    for (const d of THISTLE_DATA) {
      const mesh = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.18, 5), mat.clone())
      mesh.position.set(d.x, 0.09, d.z)
      mesh.rotation.z = 0.3
      this.threeScene.add(mesh); this.tracked.push(mesh)
      this.thistles.push({ x: d.x, z: d.z, collected: false, mesh })
    }
  }

  // ── Environmental decoration ──────────────────────────────────────────────────

  private buildDecoration(): void {
    const boneMat  = new THREE.MeshToonMaterial({ color: 0xb8a882, gradientMap: this.gradientMap })
    for (const [bx, bz, r] of [[-14,-1.5,0.3],[-6,1.8,0.25],[1,-2.2,0.28],[5,2.5,0.22],[11,-1,0.3]] as [number,number,number][]) {
      const bone = new THREE.Mesh(new THREE.CapsuleGeometry(r*0.3, r*1.2, 4, 6), boneMat)
      bone.position.set(bx, r*0.2, bz); bone.rotation.y = Math.random() * Math.PI; this.add(bone)
    }
    for (const [lx, lz] of [[-17,0],[-11,-2.5],[-5,2],[-1,-1.5],[6,2.8],[12,-0.8],[18,1.5],[0,0]] as [number,number][]) {
      const orb = new THREE.Mesh(new THREE.SphereGeometry(0.06, 6, 5), new THREE.MeshBasicMaterial({ color: 0x66ffaa }))
      orb.position.set(lx, 0.12, lz); this.add(orb)
      const gl = new THREE.PointLight(0x44ff88, 0.35, 2.0)
      gl.position.set(lx, 0.2, lz); this.add(gl)
    }
    const trailMat = new THREE.MeshBasicMaterial({ color: 0x060402 })
    for (let i = -18; i < 18; i += 1.2) {
      const dot = new THREE.Mesh(new THREE.CircleGeometry(0.04, 5).rotateX(-Math.PI / 2), trailMat)
      dot.position.set(i + Math.sin(i * 1.5) * 0.4, 0.007, Math.cos(i * 1.3) * 0.3)
      this.add(dot)
    }
  }

  // ── Lighting ──────────────────────────────────────────────────────────────────

  private buildLighting(): void {
    this.add(new THREE.AmbientLight(0x0a1206, 0.25))
    const fill = new THREE.DirectionalLight(0x1a2810, 0.18)
    fill.position.set(-10, 8, -5); this.add(fill)
  }

  // ── Enemy spawns ──────────────────────────────────────────────────────────────

  private initSpawns(): void {
    for (const d of SPAWN_DATA) {
      const enemy = d.kind === 'centipede'
        ? new CentipedeAmbusher3D(this.threeScene, d.x, d.z, this.gradientMap)
        : new BeetleTank3D(this.threeScene, d.x, d.z, this.gradientMap)
      this.spawnRecords.push({ kind: d.kind, x: d.x, z: d.z, enemy, respawnTimer: 0 })
      this.enemies.push(enemy)
    }
  }

  // ── Public API ────────────────────────────────────────────────────────────────

  checkExitRight(playerX: number): boolean { return playerX > AntColonyScene3D.EXIT_RIGHT_X }
  checkExitLeft(playerX:  number): boolean { return playerX < AntColonyScene3D.EXIT_LEFT_X  }

  webWallHitTest(x: number, z: number): boolean {
    if (x <= AntColonyScene3D.LEFT  + 0.5 ||
        x >= AntColonyScene3D.RIGHT - 0.5 ||
        z <= AntColonyScene3D.BACK  + 0.3 ||
        z >= AntColonyScene3D.FRONT - 0.3) return true
    // Interior maze walls
    for (const wall of MAZE_WALLS) {
      if (Math.abs(x - wall.x) > 0.4) continue
      for (const seg of wall.segs) {
        if (z >= seg.z1 - 0.2 && z <= seg.z2 + 0.2) return true
      }
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
    // Tilt lid open
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

  // Returns the first nearby cache that hasn't been collected, or null.
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

  // ── Enemy update (respawn + off-screen culling) ───────────────────────────────

  updateEnemies(delta: number, px: number, pz: number): void {
    // Tick spawn records
    for (const s of this.spawnRecords) {
      if (s.enemy !== null) {
        const offscreen = Math.abs(s.x - px) > CULL_R
        s.enemy.group.visible = !offscreen
        if (!offscreen) { s.enemy.update(delta, px, pz); s.enemy.syncPosition() }
        if (s.enemy.isExpired()) {
          s.enemy.cleanup()
          s.enemy         = null
          s.respawnTimer  = RESPAWN
        }
      } else {
        s.respawnTimer = Math.max(0, s.respawnTimer - delta)
        if (s.respawnTimer <= 0) {
          s.enemy = s.kind === 'centipede'
            ? new CentipedeAmbusher3D(this.threeScene, s.x, s.z, this.gradientMap)
            : new BeetleTank3D(this.threeScene, s.x, s.z, this.gradientMap)
        }
      }
    }

    // Tick free enemies (mimics)
    for (const e of this.freeEnemies) { e.update(delta, px, pz); e.syncPosition() }
    for (let i = this.freeEnemies.length - 1; i >= 0; i--) {
      if (this.freeEnemies[i].isExpired()) {
        this.freeEnemies[i].cleanup()
        this.freeEnemies.splice(i, 1)
      }
    }

    // Rebuild enemies array in-place so weaponUseSystem reference stays valid
    this.enemies.length = 0
    for (const s of this.spawnRecords) {
      if (s.enemy !== null && !s.enemy.isDead()) this.enemies.push(s.enemy)
    }
    for (const e of this.freeEnemies) {
      if (!e.isDead()) this.enemies.push(e)
    }
  }

  // ── Destroy ───────────────────────────────────────────────────────────────────

  destroy(): void {
    this.fog.destroy(this.threeScene)
    for (const s of this.spawnRecords) { if (s.enemy) s.enemy.cleanup() }
    for (const e of this.freeEnemies) e.cleanup()
    this.enemies      = []
    this.spawnRecords = []
    this.freeEnemies  = []
    for (const obj of this.tracked) {
      this.threeScene.remove(obj)
      if ((obj as THREE.Mesh).isMesh) (obj as THREE.Mesh).geometry.dispose()
    }
    this.tracked = []
    physicsWorld.bounds = null
  }

  // ── Helpers ───────────────────────────────────────────────────────────────────

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
