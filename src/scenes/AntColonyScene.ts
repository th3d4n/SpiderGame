import Phaser from 'phaser'
import Webbs, { PLAYER_MAX_HP, WEBBS_BODY_R_NORMAL, WEBBS_BODY_R_SQUEEZE } from '../entities/Webbs'
import Workbench from '../entities/Workbench'
import Pickup from '../entities/Pickup'
import HpModule from '../entities/HpModule'
import CentipedeAmbusher from '../entities/CentipedeAmbusher'
import BeetleTank from '../entities/BeetleTank'
import type Enemy from '../entities/Enemy'
import { CraftingSystem, MaterialType } from '../systems/CraftingSystem'
import { WeaponType } from '../systems/WeaponSystem'
import { WeaponUseSystem } from '../systems/WeaponUseSystem'
import { WebLauncherSystem } from '../systems/WebLauncherSystem'
import { ZoneTransitionSystem } from '../systems/ZoneTransitionSystem'
import Chest from '../entities/Chest'
import { ConsumableSystem } from '../systems/ConsumableSystem'
import type { CelebData } from './PickupCelebration'

// Five-level maze — significantly larger with vertical priority.
const WORLD_W = 7500
const WORLD_H = 5000

// HOME BASE portal sits at the right edge, in the center (C3) corridor.
// BOSS tunnel sits in the leftmost 30% — Y randomised each run.
const HOME_PORTAL_X  = WORLD_W - 110   // 7390
const HOME_PORTAL_Y  = 2040            // centre of C3 corridor
const BOSS_PORTAL_X  = 180

// Five corridor levels (open horizontal bands, each 280 px tall):
//   C1 y=300..580   C2 y=1050..1330   C3 y=1900..2180 (entry)
//   C4 y=2750..3030  C5 y=3700..3980
// Boss portal Y is one of these corridor centres — randomised per run.
const BOSS_Y_SLOTS = [440, 1190, 2040, 2890, 3840]

// Contact damage cooldown
const CONTACT_COOLDOWN = 750
const CONTACT_RADIUS   = 28 + 16

// Fog of war reveal radius
const FOG_REVEAL_R = 300
// Number of raycasts per visibility polygon — higher = smoother edges, more cost
const FOG_RAY_COUNT = 48
const FOG_RAY_STEP  = 14    // px per ray sample
// Fog texture is rendered at 1/FOG_SCALE resolution and setScale(FOG_SCALE)
// to cover the full world. Scale=10 drops 37.5MP → 375K pixels (100×).
// LINEAR filter below smooths the upscale so the blocky edges aren't sharp.
const FOG_SCALE = 10
// Movement threshold (world px²) below which we skip re-erasing the fog.
const FOG_MOVE_THRESHOLD_SQ = 4 * 4

// Off-screen culling — enemy AI and chest update calls skip when this far
// from the player (viewport is 1280x720, so ~900px covers screen + margin).
const ACTIVE_RADIUS_SQ = 900 * 900

// Respawn timer for fallen enemies (ms) — long enough that combats feel won
const RESPAWN_MS = 22000

// Squeeze-through animation — 280-px corridors need a wider threshold
const SQUEEZE_TRIGGER_GAP = 300

// Pickup detection — generous radius so any leg or the body rolls over it
const PICKUP_REACH = 50
// Web Launcher pickup-attach radius
const WEB_PICKUP_HIT = 24

type EnemyKind = 'centipede' | 'beetle'
interface Wall { x: number; y: number; w: number; h: number }
interface SpawnPoint { kind: EnemyKind; x: number; y: number; respawnTimer: number; alive: boolean; ref?: CentipedeAmbusher | BeetleTank }
interface DeadEndRoom {
  x: number; y: number; w: number; h: number
  type: 'spike' | 'ambush' | 'mimic'
  triggered: boolean
}

export default class AntColonyScene extends Phaser.Scene {
  private webbs!:            Webbs
  private workbench!:        Workbench
  private craftingSystem!:   CraftingSystem
  private pickupGroup!:      Phaser.Physics.Arcade.StaticGroup
  private hpModuleGroup!:    Phaser.Physics.Arcade.StaticGroup
  private weaponUseSystem!:  WeaponUseSystem
  private webLauncher!:      WebLauncherSystem
  private consumableSystem!: ConsumableSystem
  private qKey!:             Phaser.Input.Keyboard.Key
  private cKey!:             Phaser.Input.Keyboard.Key  // HP Potion
  private vKey!:             Phaser.Input.Keyboard.Key  // Stamina Tonic
  private xKey!:             Phaser.Input.Keyboard.Key  // Max Potion
  private weaponKeys:        Phaser.Input.Keyboard.Key[] = []
  private eKey!:             Phaser.Input.Keyboard.Key
  private spawnPoints:       SpawnPoint[] = []
  private wallRects:         Wall[] = []
  private wallGroup!:        Phaser.Physics.Arcade.StaticGroup
  private chestGroup!:       Phaser.Physics.Arcade.StaticGroup
  private fog!:              Phaser.GameObjects.RenderTexture
  private fogEraserGfx!:     Phaser.GameObjects.Graphics
  private lastFogX           = -99999
  private lastFogY           = -99999
  // Positions of all the green algae "lanterns" scattered around the colony.
  // Each beacon gets a bright above-fog dot so it stays visible through the
  // shroud; the larger uncovered glow lives below the fog.
  private lanternBeacons:    Array<{ x: number, y: number, size: number }> = []
  private deadEndRooms:      DeadEndRoom[] = []
  private chests:            Chest[] = []
  private bossPortalY        = 2040
  private transitioning      = false
  private celebLaunching     = false
  private squeezeTween?:     Phaser.Tweens.Tween

  // Player stats — stamina/energy are read directly off webbs each frame
  private health         = PLAYER_MAX_HP
  private healthMax      = PLAYER_MAX_HP
  private contactCooldown = 0
  // Last weapon-key pressed — left-click reuses this slot with mouse-aim
  private activeSlot      = -1

  constructor() {
    super({ key: 'AntColonyScene' })
  }

  create() {
    this.transitioning   = false
    this.celebLaunching  = false
    this.spawnPoints     = []
    this.contactCooldown = 0
    this.lanternBeacons = []
    this.deadEndRooms   = []
    this.chests         = []
    this.physics.world.setBounds(0, 0, WORLD_W, WORLD_H)

    // Randomise boss portal Y — never the same corridor level as last run.
    const lastSlot = this.registry.get('lastBossSlot') as number ?? -1
    const available = BOSS_Y_SLOTS.filter((_, i) => i !== lastSlot)
    const picked = available[Phaser.Math.Between(0, available.length - 1)]
    this.bossPortalY = picked
    this.registry.set('lastBossSlot', BOSS_Y_SLOTS.indexOf(picked))

    // Assign dead-end types: shuffle spike/ambush/reward across all rooms.
    const rawRooms = this.buildDeadEndRooms()
    const types: DeadEndRoom['type'][] = []
    for (let i = 0; i < rawRooms.length; i++) {
      if (i < 2 || i >= rawRooms.length - 2) types.push('mimic')
      else types.push(i % 2 === 0 ? 'spike' : 'ambush')
    }
    Phaser.Utils.Array.Shuffle(types)
    for (let i = 0; i < rawRooms.length; i++) {
      this.deadEndRooms.push({ ...rawRooms[i], type: types[i], triggered: false })
    }

    const savedHp = this.registry.get('health') as number | undefined
    if (savedHp !== undefined) this.health = savedHp

    this.drawBackground()
    this.wallRects = this.buildMazeWalls()
    this.drawWalls()
    this.drawGapMarkers()
    this.drawPortals()
    // Above-fog visibility dots for every algae lantern in the level — relies on
    // beacon positions collected by drawBackground() and drawGapMarkers() above.
    this.drawLanternBeacons()
    this.drawDeadEndRooms()

    // Workbench tucked just inside the entry chamber (C3 right side)
    this.workbench = new Workbench(this, WORLD_W - 350, HOME_PORTAL_Y)

    // Crafting system — share player's inventory via registry across zones
    this.craftingSystem = new CraftingSystem()
    const savedInv = this.registry.get('craftingInventory') as Record<string, number> | null
    if (savedInv) this.craftingSystem.restoreFromSnapshot(savedInv)

    // Consumable system
    this.consumableSystem = new ConsumableSystem()
    const savedCons = this.registry.get('consumableInventory') as Record<string, number> | null
    if (savedCons) this.consumableSystem.restoreFromSnapshot(savedCons)

    // Pickup / chest groups
    this.pickupGroup = this.physics.add.staticGroup()
    this.hpModuleGroup = this.physics.add.staticGroup()
    this.chestGroup = this.physics.add.staticGroup()
    this.spawnChests()

    // Scatter thistles across all five corridor levels
    const thistleSeeds = [
      { x: 6800, y: 2040 }, { x: 5600, y: 2040 }, // C3 (entry corridor)
      { x: 4800, y: 440  }, { x: 2800, y: 440  }, // C1
      { x: 3500, y: 1190 }, { x: 6200, y: 1190 }, // C2
      { x: 1800, y: 2890 }, { x: 4200, y: 2890 }, // C4
      { x: 2500, y: 3840 }, { x: 5200, y: 3840 }, // C5
    ]
    for (const t of thistleSeeds) {
      const p = new Pickup(this, t.x, t.y, 'Thistle', 1, this.craftingSystem)
      this.pickupGroup.add(p, true)
    }

    // Material caches scattered throughout the five-level maze
    const surpriseSeeds: Array<{ x: number, y: number, mat: MaterialType, qty: number }> = [
      { x: 700,  y: 440,  mat: 'CrystalDust',  qty: 2 },
      { x: 3800, y: 440,  mat: 'ChitinShard',  qty: 3 },
      { x: 6400, y: 440,  mat: 'VenomGland',   qty: 2 },
      { x: 1200, y: 1190, mat: 'SilkThread',   qty: 4 },
      { x: 4000, y: 1190, mat: 'WebFluid',     qty: 3 },
      { x: 6600, y: 1190, mat: 'BoneFragment', qty: 2 },
      { x: 3400, y: 2040, mat: 'ChitinShard',  qty: 2 },
      { x: 6000, y: 2040, mat: 'CrystalDust',  qty: 1 },
      { x: 700,  y: 2890, mat: 'VenomGland',   qty: 2 },
      { x: 4600, y: 2890, mat: 'SilkThread',   qty: 3 },
      { x: 1500, y: 3840, mat: 'WebFluid',     qty: 2 },
      { x: 4400, y: 3840, mat: 'CrystalDust',  qty: 1 },
    ]
    for (const s of surpriseSeeds) {
      const p = new Pickup(this, s.x, s.y, s.mat, s.qty, this.craftingSystem)
      this.pickupGroup.add(p, true)
    }

    // HP modules spread across all corridor levels
    const hpSeeds = [
      { x: 1500, y: 440  },   // C1
      { x: 5600, y: 440  },
      { x: 2700, y: 1190 },   // C2
      { x: 5900, y: 1190 },
      { x: 4700, y: 2040 },   // C3
      { x: 1000, y: 2890 },   // C4
      { x: 6200, y: 2890 },
      { x: 2200, y: 3840 },   // C5
      { x: 5800, y: 3840 },
    ]
    for (const h of hpSeeds) {
      const m = new HpModule(this, h.x, h.y)
      this.hpModuleGroup.add(m, true)
    }

    // Spawn Webbs right next to the home portal (C3 right side)
    this.webbs = new Webbs(this, HOME_PORTAL_X - 90, HOME_PORTAL_Y)
    this.webbs.resetHp(this.health)
    this.physics.add.collider(this.webbs, this.wallGroup)
    this.physics.add.collider(this.webbs, this.chestGroup)

    // Restore loadout
    const savedLegTier = this.registry.get('legTier') as number | undefined
    this.webbs.weaponSystem.setLegTier(savedLegTier !== undefined ? savedLegTier : 1)
    const savedSlots = this.registry.get('weaponSlots') as WeaponType[] | undefined
    if (savedSlots) {
      for (let i = 0; i < savedSlots.length; i++) {
        if (savedSlots[i] && savedSlots[i] !== WeaponType.Empty) {
          this.webbs.weaponSystem.equip(i, savedSlots[i])
        }
      }
    }
    this.webbs.refreshLegColors()

    this.registry.set('weaponSystemRef', this.webbs.weaponSystem)
    this.registry.set('weaponInventory', (this.registry.get('weaponInventory') as WeaponType[] | undefined) ?? [])
    this.events.on('resume', () => {
      this.celebLaunching = false
      this.webbs.refreshLegColors()
    })

    // Pickup collection runs through a manual proximity sweep in update() so the
    // entire spider — body and legs — picks things up, not just the tiny body box.

    // Enemy loot drops + bow ammo recovery
    this.events.on('enemyDied',      this.spawnLootAt,       this)
    this.events.on('thistleDropped', this.spawnThistleAt,    this)
    this.events.on('hpModulePicked', this.onHpModulePicked,  this)
    this.events.once('shutdown', () => {
      this.events.off('enemyDied',      this.spawnLootAt,       this)
      this.events.off('thistleDropped', this.spawnThistleAt,    this)
      this.events.off('hpModulePicked', this.onHpModulePicked,  this)
    })

    // Weapon systems
    this.weaponUseSystem = new WeaponUseSystem()
    this.weaponUseSystem.setWorldBounds(WORLD_W, WORLD_H)
    this.webLauncher     = new WebLauncherSystem()
    this.webLauncher.setWorldBounds(WORLD_W, WORLD_H)
    this.webLauncher.setWallHitTest((x, y) => this.pointInWall(x, y))
    // Web can reel in any active pickup orb (materials or HP modules)
    this.webLauncher.setPickupHitTest((wx, wy) => {
      for (const obj of this.pickupGroup.getChildren()) {
        const p = obj as unknown as Pickup
        if (!p.active) continue
        if (Phaser.Math.Distance.Between(wx, wy, p.x, p.y) < WEB_PICKUP_HIT) {
          return { x: p.x, y: p.y, active: p.active, collect: () => this.collectMaterialPickup(p) }
        }
      }
      for (const obj of this.hpModuleGroup.getChildren()) {
        const m = obj as unknown as HpModule
        if (!m.active) continue
        if (Phaser.Math.Distance.Between(wx, wy, m.x, m.y) < WEB_PICKUP_HIT) {
          return { x: m.x, y: m.y, active: m.active, collect: () => m.collect() }
        }
      }
      return null
    })
    this.weaponKeys = [
      Phaser.Input.Keyboard.KeyCodes.ONE,
      Phaser.Input.Keyboard.KeyCodes.TWO,
      Phaser.Input.Keyboard.KeyCodes.THREE,
      Phaser.Input.Keyboard.KeyCodes.FOUR,
      Phaser.Input.Keyboard.KeyCodes.FIVE,
      Phaser.Input.Keyboard.KeyCodes.SIX,
      Phaser.Input.Keyboard.KeyCodes.SEVEN,
      Phaser.Input.Keyboard.KeyCodes.EIGHT,
    ].map(code => this.input.keyboard!.addKey(code))
    this.qKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.Q)

    // Enemy spawn points — preserved for respawn after death
    this.defineSpawnPoints()
    this.spawnAllInitial()
    this.refreshEnemyTargets()

    // Input
    this.eKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.E)
    this.cKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.C)
    this.vKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.V)
    this.xKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.X)
    this.input.keyboard!.on('keydown-I', () => {
      if (!this.scene.isActive('EquipScreen')) {
        this.registry.set('equipCallerScene', 'AntColonyScene')
        this.scene.launch('EquipScreen')
        this.scene.pause()
      }
    })

    // Left-click → re-fire the last-used weapon toward the mouse cursor
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (pointer.button !== 0) return
      this.fireActiveWeaponAtPointer(pointer)
    })

    // Camera
    this.cameras.main.setBounds(0, 0, WORLD_W, WORLD_H)
    this.cameras.main.startFollow(this.webbs, true, 0.1, 0.1)
    this.cameras.main.setZoom(1.15)

    // Underground ambient dim — sits below the fog so even explored areas stay
    // slightly dark (it's a cavern; lighting comes from the green HP orbs).
    this.add.rectangle(0, 0, WORLD_W, WORLD_H, 0x000000, 0.45)
      .setOrigin(0)
      .setDepth(50)

    // Fog of war — fully opaque, carved by a per-frame visibility polygon so the
    // player cannot see through walls into unexplored areas. Carved areas persist
    // (cumulative reveal), so once you've seen a tile it stays visible.
    this.fog = this.add.renderTexture(0, 0, WORLD_W / FOG_SCALE, WORLD_H / FOG_SCALE)
      .setOrigin(0).setDepth(51).setScale(FOG_SCALE)
    // Linear filter so the 4× scale-up blurs rather than pixelates.
    this.fog.texture.source[0].setFilter(Phaser.Textures.FilterMode.LINEAR)
    this.fog.fill(0x000000, 1)
    this.fogEraserGfx = this.make.graphics({}, false)

    if (!this.scene.isActive('HUDScene')) this.scene.launch('HUDScene')
    if (!this.scene.isActive('PickupNotification')) this.scene.launch('PickupNotification')

    this.syncRegistry()
    ZoneTransitionSystem.announceZone(this, 'ZONE 1 — ANT COLONY')
  }

  update(time: number, delta: number) {
    if (this.transitioning) return

    // Sync the local CraftingSystem with the registry inventory after a craft
    // (CraftingMenu already pushed the new weapon into weaponInventory directly).
    const updatedCraftInv = this.registry.get('craftingInventory') as Record<string, number> | null
    if (updatedCraftInv) {
      for (const [mat, amt] of Object.entries(updatedCraftInv)) {
        this.craftingSystem['inventory'].set(mat as MaterialType, amt)
      }
    }

    this.webbs.update(time, delta)
    this.weaponUseSystem.update(delta)
    this.webLauncher.update(this, this.webbs, delta)

    // Consumable tick + effect application
    this.consumableSystem.tick(delta)
    this.webbs.maxProtectionActive = this.consumableSystem.isMaxProtActive()
    this.weaponUseSystem.staminaDrainMult = this.consumableSystem.getStaminaDrainMult()
    this.handleConsumableKeys()

    for (let i = 0; i < this.weaponKeys.length; i++) {
      if (Phaser.Input.Keyboard.JustDown(this.weaponKeys[i])) {
        const weapon = this.webbs.weaponSystem.getSlot(i)
        if (weapon === WeaponType.Empty) continue
        this.activeSlot = i
        const aim = this.aimToPointer()
        if (weapon === WeaponType.WebLauncher) {
          this.webLauncher.onQPressed(this, this.webbs, aim)
        } else {
          this.weaponUseSystem.activateWeapon(i, this.webbs, this, aim)
        }
      }
    }
    if (Phaser.Input.Keyboard.JustDown(this.qKey)) {
      this.webLauncher.onQPressed(this, this.webbs, this.aimToPointer())
    }

    // Pickup proximity sweep — body + legs roll over pickups
    this.collectPickupsInRange()

    // Enemy ticking + respawn timers — only tick enemies near the player.
    // Also disable the Arcade physics body for off-screen enemies so they
    // don't participate in the per-frame broadphase (23 bodies × 50 walls
    // is expensive even when AI is skipped).
    const px = this.webbs.x
    const py = this.webbs.y
    for (const sp of this.spawnPoints) {
      if (sp.alive && sp.ref) {
        const ex = sp.ref.x, ey = sp.ref.y
        const dxe = ex - px, dye = ey - py
        const inRange = dxe * dxe + dye * dye <= ACTIVE_RADIUS_SQ
        if (inRange) {
          if (!sp.ref.pb.enable) sp.ref.pb.setEnable(true)
          sp.ref.update(time, delta)
        } else {
          if (sp.ref.pb.enable) sp.ref.pb.setEnable(false)
        }
      } else {
        sp.respawnTimer -= delta
        if (sp.respawnTimer <= 0) this.respawnSpawnPoint(sp)
      }
    }

    const eJustDown = Phaser.Input.Keyboard.JustDown(this.eKey)

    if (!this.scene.isActive('CraftingMenu') && this.workbench.update(this.webbs, this.eKey, eJustDown)) {
      this.registry.set('craftingInventory', this.craftingSystem.getInventorySnapshot())
      this.registry.set('legTier',           this.webbs.weaponSystem.getLegTier())
      this.registry.set('callerScene', 'AntColonyScene')
      this.scene.launch('CraftingMenu')
      this.scene.pause()
      return
    }

    if (this.contactCooldown > 0) this.contactCooldown -= delta
    else                          this.checkEnemyContact()

    this.checkDeadEndTriggers()
    this.updateChests(eJustDown)

    this.health = this.webbs.hp

    // Squeeze-through detection — visual flourish when the player is in a tight gap
    this.updateSqueezeEffect()

    // Fog of war — raycast visibility polygon
    this.updateFog()

    // Proximity portal triggers
    const distHome = Phaser.Math.Distance.Between(this.webbs.x, this.webbs.y, HOME_PORTAL_X, HOME_PORTAL_Y)
    const distBoss = Phaser.Math.Distance.Between(this.webbs.x, this.webbs.y, BOSS_PORTAL_X, this.bossPortalY)
    if (distHome < 65) {
      this.transitioning = true
      ZoneTransitionSystem.transition(this, 'HomeBaseScene', 'right', this.health)
    } else if (distBoss < 65) {
      this.transitioning = true
      ZoneTransitionSystem.transition(this, 'BossRollerScene', 'left', this.health)
    }

    this.syncRegistry()
  }

  // ── Maze layout ───────────────────────────────────────────────────────────
  // Layout philosophy: a wide central corridor runs the entire length of the world.
  // Vertical dividers cross the corridor with a wide gap at corridor height so the
  // player can always walk straight LEFT to make progress. Smaller side chambers
  // branch off above and below for exploration. The boss portal is in the top-left
  // chamber, requiring an upward detour from the main path.

  // ── Maze geometry ─────────────────────────────────────────────────────────
  // Five horizontal corridor levels connected by vertical passages through
  // wall blocks. Dead-end stub rooms branch off each wall block; their type
  // (spike / ambush / reward) is randomised in create().
  //
  //  C1  y=300..580     C2  y=1050..1330   C3  y=1900..2180  (entry)
  //  C4  y=2750..3030   C5  y=3700..3980
  //
  // Wall blocks between levels have 3 main passages each + 2 dead-end stubs.

  private buildMazeWalls(): Wall[] {
    const walls: Wall[] = []
    const T = 50

    // Helper: fill a horizontal band from x=T to x=WORLD_W-T, leaving gaps open.
    const band = (y: number, h: number, gaps: { x: number; w: number }[]) => {
      const sorted = [...gaps].sort((a, b) => a.x - b.x)
      let cur = T
      for (const g of sorted) {
        if (g.x > cur) walls.push({ x: cur, y, w: g.x - cur, h })
        cur = g.x + g.w
      }
      if (cur < WORLD_W - T) walls.push({ x: cur, y, w: WORLD_W - T - cur, h })
    }

    // ── Outer perimeter ──────────────────────────────────────────────────────
    walls.push({ x: 0, y: 0,           w: WORLD_W, h: T })
    walls.push({ x: 0, y: WORLD_H - T, w: WORLD_W, h: T })
    walls.push({ x: 0, y: 0,           w: T, h: WORLD_H })
    walls.push({ x: WORLD_W - T, y: 0, w: T, h: WORLD_H })

    // ── B_TOP  y=50..300 (above C1) ─────────────────────────────────────────
    // Two dead-end reward pockets accessible from C1 ceiling going up.
    // DE_T1 x=3200..3480  DE_T2 x=6000..6280
    band(T, 250, [{ x: 3200, w: 280 }, { x: 6000, w: 280 }])
    walls.push({ x: 3200, y: T,    w: 280, h: 150 })   // cap: only bottom 100 px open
    walls.push({ x: 6000, y: T,    w: 280, h: 150 })

    // ── B12  y=580..1050 (between C1 and C2)  h=470 ─────────────────────────
    // Main passages: x=550, 3150, 6100 (each 280 wide)
    // Dead ends from C1 down: DE1 x=1600  DE2 x=4200
    // Dead ends from C2 up:   DE3 x=2400  DE4 x=5800
    band(580, 470, [
      { x: 550,  w: 280 }, { x: 3150, w: 280 }, { x: 6100, w: 280 },
      { x: 1600, w: 280 }, { x: 4200, w: 280 },   // DE1 DE2 — full-height gap, capped below
      { x: 2400, w: 280 }, { x: 5800, w: 280 },   // DE3 DE4 — full-height gap, capped above
    ])
    walls.push({ x: 1600, y: 860,  w: 280, h: 190 })  // DE1 bottom cap (y=860..1050)
    walls.push({ x: 4200, y: 860,  w: 280, h: 190 })  // DE2 bottom cap
    walls.push({ x: 2400, y: 580,  w: 280, h: 200 })  // DE3 top cap (y=580..780)
    walls.push({ x: 5800, y: 580,  w: 280, h: 200 })  // DE4 top cap

    // ── B23  y=1330..1900 (between C2 and C3)  h=570 ────────────────────────
    // Passages: x=1350, 4450, 6950   Dead ends: DE5 x=2800 (from C2)  DE6 x=5700 (from C3)
    band(1330, 570, [
      { x: 1350, w: 280 }, { x: 4450, w: 280 }, { x: 6950, w: 280 },
      { x: 2800, w: 280 }, { x: 5700, w: 280 },
    ])
    walls.push({ x: 2800, y: 1610, w: 280, h: 290 })  // DE5 bottom cap (y=1610..1900)
    walls.push({ x: 5700, y: 1330, w: 280, h: 290 })  // DE6 top cap (y=1330..1620)

    // ── B34  y=2180..2750 (between C3 and C4)  h=570 ────────────────────────
    // Passages: x=750, 3750, 6350   Dead ends: DE7 x=1700 (from C3)  DE8 x=5000 (from C4)
    band(2180, 570, [
      { x: 750,  w: 280 }, { x: 3750, w: 280 }, { x: 6350, w: 280 },
      { x: 1700, w: 280 }, { x: 5000, w: 280 },
    ])
    walls.push({ x: 1700, y: 2460, w: 280, h: 290 })  // DE7 bottom cap (y=2460..2750)
    walls.push({ x: 5000, y: 2180, w: 280, h: 290 })  // DE8 top cap (y=2180..2470)

    // ── B45  y=3030..3700 (between C4 and C5)  h=670 ────────────────────────
    // Passages: x=1950, 4950   Dead ends: DE9 x=2700 (from C4)  DE10 x=3700 (from C5)
    band(3030, 670, [
      { x: 1950, w: 280 }, { x: 4950, w: 280 },
      { x: 2700, w: 280 }, { x: 3700, w: 280 },
    ])
    walls.push({ x: 2700, y: 3310, w: 280, h: 390 })  // DE9 bottom cap (y=3310..3700)
    walls.push({ x: 3700, y: 3030, w: 280, h: 390 })  // DE10 top cap (y=3030..3420)

    // ── B_BOT  y=3980..4950 (below C5) ──────────────────────────────────────
    // Two reward pockets from C5 going down: DE_B1 x=800  DE_B2 x=5500
    band(3980, WORLD_H - T - 3980, [{ x: 800, w: 280 }, { x: 5500, w: 280 }])
    walls.push({ x: 800,  y: 4280, w: 280, h: WORLD_H - T - 4280 })  // DE_B1 cap
    walls.push({ x: 5500, y: 4280, w: 280, h: WORLD_H - T - 4280 })  // DE_B2 cap

    // ── Internal corridor barriers (force winding navigation) ────────────────
    // Each is a partial wall covering half the corridor height, alternating
    // top/bottom so the player must weave as they traverse each level.
    // C1 (y=300..580, centre=440)
    walls.push({ x: 2100, y: 440,  w: 50, h: 140 })   // bottom half blocked
    walls.push({ x: 5300, y: 300,  w: 50, h: 140 })   // top half blocked
    // C2 (y=1050..1330, centre=1190)
    walls.push({ x: 1900, y: 1190, w: 50, h: 140 })
    walls.push({ x: 5100, y: 1050, w: 50, h: 140 })
    // C3 (y=1900..2180, centre=2040)
    walls.push({ x: 2600, y: 2040, w: 50, h: 140 })
    walls.push({ x: 4100, y: 1900, w: 50, h: 140 })
    // C4 (y=2750..3030, centre=2890)
    walls.push({ x: 1300, y: 2750, w: 50, h: 140 })
    walls.push({ x: 5500, y: 2890, w: 50, h: 140 })
    // C5 (y=3700..3980, centre=3840)
    walls.push({ x: 3200, y: 3840, w: 50, h: 140 })

    return walls
  }

  // Dead-end room descriptors — populated once in create() so types can be
  // randomised per run. The rooms correspond to the stub pockets carved into
  // the wall blocks above.
  private buildDeadEndRooms(): Array<Omit<DeadEndRoom, 'type' | 'triggered'>> {
    return [
      // DE_T1 / DE_T2 — above C1 (reward pockets near top of world)
      { x: 3200, y: 150, w: 280, h: 150 },
      { x: 6000, y: 150, w: 280, h: 150 },
      // DE1 / DE2 — from C1 down into B12
      { x: 1600, y: 580, w: 280, h: 280 },
      { x: 4200, y: 580, w: 280, h: 280 },
      // DE3 / DE4 — from C2 up into B12
      { x: 2400, y: 780, w: 280, h: 270 },
      { x: 5800, y: 780, w: 280, h: 270 },
      // DE5 / DE6 — B23 stubs
      { x: 2800, y: 1330, w: 280, h: 280 },
      { x: 5700, y: 1620, w: 280, h: 280 },
      // DE7 / DE8 — B34 stubs
      { x: 1700, y: 2180, w: 280, h: 280 },
      { x: 5000, y: 2470, w: 280, h: 280 },
      // DE9 / DE10 — B45 stubs
      { x: 2700, y: 3030, w: 280, h: 280 },
      { x: 3700, y: 3420, w: 280, h: 280 },
      // DE_B1 / DE_B2 — below C5 (reward pockets, deepest in maze)
      { x: 800,  y: 3980, w: 280, h: 300 },
      { x: 5500, y: 3980, w: 280, h: 300 },
    ]
  }

  private drawWalls(): void {
    this.wallGroup = this.physics.add.staticGroup()
    const g = this.add.graphics().setDepth(2)
    for (const w of this.wallRects) {
      // Base AABB fill — solid dirt brown.
      g.fillStyle(0x1a1006, 1)
      g.fillRect(w.x, w.y, w.w, w.h)

      // Irregular cavern outline drawn INSIDE the AABB so collision still
      // matches the physics rectangle. Vertices walk the perimeter with small
      // inward jitter, producing a hand-dug feel.
      const rng = new Phaser.Math.RandomDataGenerator([`cave-${w.x}-${w.y}-${w.w}-${w.h}`])
      const points = this.buildCavernOutline(w, rng)
      g.fillStyle(0x2a1a0a, 1)
      g.fillPoints(points, true)
      g.lineStyle(2, 0x3a2418, 0.9)
      g.strokePoints(points, true, true)

      // Scatter "dirt clods" — irregular dark spots inside the wall for texture.
      // Capped at 6 per wall: Phaser re-tessellates Graphics every frame in WebGL,
      // and a 2000×470 wall would otherwise have ~200 fillCircles = 6,000 triangles
      // re-uploaded per frame. The cap keeps total scene triangles in check.
      const clodCount = Math.min(6, Math.max(3, Math.floor((w.w * w.h) / 4500)))
      for (let i = 0; i < clodCount; i++) {
        const cx = w.x + rng.between(4, Math.max(5, w.w - 4))
        const cy = w.y + rng.between(4, Math.max(5, w.h - 4))
        const cr = rng.between(2, 5)
        g.fillStyle(0x120a04, 0.85)
        g.fillCircle(cx, cy, cr)
      }
      // Light speckles to suggest packed sediment — also capped.
      const speckles = Math.min(8, Math.max(4, Math.floor((w.w * w.h) / 3000)))
      for (let i = 0; i < speckles; i++) {
        const sx = w.x + rng.between(2, Math.max(3, w.w - 2))
        const sy = w.y + rng.between(2, Math.max(3, w.h - 2))
        g.fillStyle(0x4a2e10, 0.5)
        g.fillRect(sx, sy, 2, 2)
      }

      const body = this.add.rectangle(w.x + w.w / 2, w.y + w.h / 2, w.w, w.h, 0x000000, 0)
      this.physics.add.existing(body, true)
      this.wallGroup.add(body)
    }
  }

  // Build a list of x,y pairs that walk the wall's perimeter with small random
  // insets, never crossing outside the AABB. Used as both the fill polygon and
  // the stroke path so the wall reads as a natural cavern surface.
  private buildCavernOutline(w: Wall, rng: Phaser.Math.RandomDataGenerator): number[] {
    const pts: number[] = []
    // Coarser steps (52 vs 26) keep large walls from dragging in huge polygons.
    const stepH = Math.max(2, Math.floor(w.w / 52))
    const stepV = Math.max(2, Math.floor(w.h / 52))
    const jitter = (max: number) => rng.between(0, max)

    // Top edge: left -> right
    for (let i = 0; i <= stepH; i++) {
      const x = w.x + Math.round((i / stepH) * w.w)
      const y = w.y + jitter(4)
      pts.push(x, y)
    }
    // Right edge: top -> bottom
    for (let i = 1; i <= stepV; i++) {
      const x = w.x + w.w - jitter(4)
      const y = w.y + Math.round((i / stepV) * w.h)
      pts.push(x, y)
    }
    // Bottom edge: right -> left
    for (let i = 1; i <= stepH; i++) {
      const x = w.x + w.w - Math.round((i / stepH) * w.w)
      const y = w.y + w.h - jitter(4)
      pts.push(x, y)
    }
    // Left edge: bottom -> top (skip final point — it's the start)
    for (let i = 1; i < stepV; i++) {
      const x = w.x + jitter(4)
      const y = w.y + w.h - Math.round((i / stepV) * w.h)
      pts.push(x, y)
    }
    return pts
  }

  private drawGapMarkers(): void {
    const g = this.add.graphics().setDepth(3)
    const drawGap = (cx: number, cy: number) => {
      g.fillStyle(0x66ffaa, 0.18); g.fillCircle(cx, cy, 36)
      g.fillStyle(0x99ffcc, 0.35); g.fillCircle(cx, cy, 18)
      g.fillStyle(0xddffee, 0.7);  g.fillCircle(cx, cy, 6)
      this.lanternBeacons.push({ x: cx, y: cy, size: 5 })
    }

    // B12 passages (centre of each 280-wide gap, mid-height of B12 y=580..1050 → y=815)
    for (const gx of [690, 3290, 6240]) drawGap(gx, 815)
    // B23 passages (y=1330..1900 → y=1615)
    for (const gx of [1490, 4590, 7090]) drawGap(gx, 1615)
    // B34 passages (y=2180..2750 → y=2465)
    for (const gx of [890, 3890, 6490]) drawGap(gx, 2465)
    // B45 passages (y=3030..3700 → y=3365)
    for (const gx of [2090, 5090]) drawGap(gx, 3365)
  }

  private drawBackground(): void {
    const g = this.add.graphics().setDepth(0)
    g.fillStyle(0x0e0a06, 1)
    g.fillRect(0, 0, WORLD_W, WORLD_H)

    const rng = new Phaser.Math.RandomDataGenerator(['ant-colony-bg-v3'])
    g.fillStyle(0x1c1208, 0.5)
    for (let i = 0; i < 500; i++) {
      const rx = rng.integerInRange(0, WORLD_W)
      const ry = rng.integerInRange(0, WORLD_H)
      g.fillRect(rx, ry, rng.integerInRange(40, 140), rng.integerInRange(20, 60))
    }
    // Luminescent algae lanterns — below-fog soft halos. The matching above-fog
    // visibility dot is drawn in drawLanternBeacons() so the algae glow is
    // visible even in the shroud.
    for (let i = 0; i < 80; i++) {
      const fx = rng.integerInRange(120, WORLD_W - 120)
      const fy = rng.integerInRange(120, WORLD_H - 120)
      const r  = rng.integerInRange(3, 7)
      g.fillStyle(0x44ff88, 0.05); g.fillCircle(fx, fy, r * 3.5)
      g.fillStyle(0x66ffaa, 0.12); g.fillCircle(fx, fy, r * 1.8)
      g.fillStyle(0x99ffcc, 0.7);  g.fillCircle(fx, fy, r)
      this.lanternBeacons.push({ x: fx, y: fy, size: Math.max(2, Math.round(r * 0.55)) })
    }
  }

  // Single above-fog Graphics rendering every lantern as a small ADD-blend dot.
  // Sits at depth 60 (over fog at 51) so the eerie green points of light are
  // visible from inside the shroud without illuminating the surrounding cavern.
  private drawLanternBeacons(): void {
    const g = this.add.graphics().setDepth(60).setBlendMode(Phaser.BlendModes.ADD)
    for (const b of this.lanternBeacons) {
      g.fillStyle(0x66ff99, 0.85)
      g.fillCircle(b.x, b.y, b.size)
      g.fillStyle(0xeeffee, 0.9)
      g.fillCircle(b.x, b.y, Math.max(1, b.size - 2))
    }
    // Gentle breath so the whole field of dots pulses subtly together
    this.tweens.add({
      targets:  g,
      alpha:    { from: 0.7, to: 1 },
      duration: 2200,
      yoyo:     true,
      repeat:   -1,
      ease:     'Sine.easeInOut',
    })
  }

  private drawDeadEndRooms(): void {
    const g = this.add.graphics().setDepth(2)
    for (const room of this.deadEndRooms) {
      if (room.type === 'spike') {
        // Red floor tint + spike silhouettes
        g.fillStyle(0x330808, 0.6)
        g.fillRect(room.x + 2, room.y + 2, room.w - 4, room.h - 4)
        g.fillStyle(0x882222, 1)
        const count = 5
        for (let i = 0; i < count; i++) {
          const sx = room.x + 20 + i * ((room.w - 40) / (count - 1))
          const sy = room.y + room.h - 4
          g.fillTriangle(sx - 8, sy, sx + 8, sy, sx, sy - 24)
        }
      } else if (room.type === 'ambush') {
        // Subtle dark tint — no obvious tell
        g.fillStyle(0x1a0a0a, 0.4)
        g.fillRect(room.x + 2, room.y + 2, room.w - 4, room.h - 4)
      } else if (room.type === 'mimic') {
        // No floor tint — chest room looks identical to a plain passage
      }
    }
  }

  private drawPortals(): void {
    // HOME — right side, blue
    const home = this.add.graphics().setDepth(3)
    home.fillStyle(0x0d0d1a, 1); home.fillRect(HOME_PORTAL_X - 40, HOME_PORTAL_Y - 70, 80, 140)
    home.lineStyle(2, 0x334466, 0.8); home.strokeRect(HOME_PORTAL_X - 40, HOME_PORTAL_Y - 70, 80, 140)
    const homeGlow = this.add.graphics().setDepth(4)
    homeGlow.lineStyle(2, 0x99bbff, 0.8); homeGlow.strokeRect(HOME_PORTAL_X - 40, HOME_PORTAL_Y - 70, 80, 140)
    this.tweens.add({ targets: homeGlow, alpha: { from: 0.4, to: 1 }, duration: 1100, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' })
    this.add.text(HOME_PORTAL_X, HOME_PORTAL_Y - 90, '→ HOME', {
      fontFamily: 'monospace', fontSize: '12px', color: '#99bbff',
    }).setOrigin(0.5).setDepth(4)

    // BOSS — leftmost 30%, Y randomised per run
    const boss = this.add.graphics().setDepth(3)
    boss.fillStyle(0x1a0a06, 1); boss.fillRect(BOSS_PORTAL_X - 40, this.bossPortalY - 70, 80, 140)
    boss.lineStyle(2, 0x663333, 0.7); boss.strokeRect(BOSS_PORTAL_X - 40, this.bossPortalY - 70, 80, 140)
    const bossGlow = this.add.graphics().setDepth(4)
    bossGlow.lineStyle(2, 0xff4422, 0.6); bossGlow.strokeRect(BOSS_PORTAL_X - 40, this.bossPortalY - 70, 80, 140)
    this.tweens.add({ targets: bossGlow, alpha: { from: 0.3, to: 1 }, duration: 900, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' })
    this.add.text(BOSS_PORTAL_X, this.bossPortalY - 90, 'BOSS', {
      fontFamily: 'monospace', fontSize: '12px', color: '#cc3322',
    }).setOrigin(0.5).setDepth(4)
  }

  // ── Enemy spawning + respawn ───────────────────────────────────────────────

  private defineSpawnPoints(): void {
    const points: Array<{ kind: EnemyKind, x: number, y: number }> = [
      // C3 — entry corridor (right to left)
      { kind: 'centipede', x: 6500, y: 2040 },
      { kind: 'beetle',    x: 5800, y: 2040 },
      { kind: 'centipede', x: 4900, y: 2040 },
      { kind: 'beetle',    x: 3800, y: 2040 },
      { kind: 'centipede', x: 2900, y: 2040 },
      { kind: 'centipede', x: 1800, y: 2040 },
      { kind: 'beetle',    x: 900,  y: 2040 },
      // C1 — upper level
      { kind: 'centipede', x: 1200, y: 440  },
      { kind: 'centipede', x: 3000, y: 440  },
      { kind: 'beetle',    x: 4700, y: 440  },
      { kind: 'centipede', x: 6300, y: 440  },
      // C2 — upper-mid
      { kind: 'centipede', x: 700,  y: 1190 },
      { kind: 'beetle',    x: 2700, y: 1190 },
      { kind: 'centipede', x: 5300, y: 1190 },
      { kind: 'centipede', x: 7100, y: 1190 },
      // C4 — lower-mid
      { kind: 'beetle',    x: 600,  y: 2890 },
      { kind: 'centipede', x: 2200, y: 2890 },
      { kind: 'centipede', x: 4100, y: 2890 },
      { kind: 'beetle',    x: 6100, y: 2890 },
      // C5 — deep level
      { kind: 'centipede', x: 700,  y: 3840 },
      { kind: 'centipede', x: 2800, y: 3840 },
      { kind: 'beetle',    x: 4500, y: 3840 },
      { kind: 'centipede', x: 6400, y: 3840 },
    ]
    for (const p of points) {
      this.spawnPoints.push({ kind: p.kind, x: p.x, y: p.y, respawnTimer: 0, alive: false })
    }
  }

  private spawnAllInitial(): void {
    for (const sp of this.spawnPoints) this.spawnEnemyForPoint(sp)
  }

  private spawnEnemyForPoint(sp: SpawnPoint): void {
    const ref = sp.kind === 'centipede'
      ? new CentipedeAmbusher(this, sp.x, sp.y, this.webbs)
      : new BeetleTank(this, sp.x, sp.y, this.webbs)
    ref.pb.setCollideWorldBounds(true)
    this.physics.add.collider(ref, this.wallGroup)
    sp.ref = ref
    sp.alive = true
    sp.respawnTimer = 0
  }

  private respawnSpawnPoint(sp: SpawnPoint): void {
    // Don't respawn an enemy practically on top of the player
    if (Phaser.Math.Distance.Between(sp.x, sp.y, this.webbs.x, this.webbs.y) < 280) {
      sp.respawnTimer = 2000  // try again shortly
      return
    }
    this.spawnEnemyForPoint(sp)
    this.refreshEnemyTargets()
  }

  private refreshEnemyTargets(): void {
    const live: Enemy[] = []
    for (const sp of this.spawnPoints) {
      if (sp.alive && sp.ref) live.push(sp.ref as unknown as Enemy)
    }
    this.weaponUseSystem.setEnemies(live)
    this.webLauncher.setEnemies(live)
  }

  // Called when an enemy dies — flag its spawn point for respawn
  private markEnemyDead(deadX: number, deadY: number): void {
    // Match by proximity to original spawn (enemies wander, so use a generous radius)
    let best: SpawnPoint | null = null
    let bestDist = Infinity
    for (const sp of this.spawnPoints) {
      if (!sp.alive || !sp.ref) continue
      // Match this dead pair to its spawn point by checking who's now destroyed
      if (sp.ref.isDead()) {
        const d = Phaser.Math.Distance.Between(sp.x, sp.y, deadX, deadY)
        if (d < bestDist) { bestDist = d; best = sp }
      }
    }
    if (best) {
      best.alive = false
      best.ref = undefined
      best.respawnTimer = RESPAWN_MS
      this.refreshEnemyTargets()
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  // Returns only walls that overlap a circle of the given radius around (cx, cy).
  // Used to pre-filter before per-sample checks so we only iterate nearby geometry.
  private nearbyWalls(cx: number, cy: number, radius: number): Wall[] {
    return this.wallRects.filter(w =>
      w.x - radius < cx && w.x + w.w + radius > cx &&
      w.y - radius < cy && w.y + w.h + radius > cy
    )
  }

  private pointInWall(x: number, y: number, walls?: Wall[]): boolean {
    for (const w of walls ?? this.wallRects) {
      if (x >= w.x && x <= w.x + w.w && y >= w.y && y <= w.y + w.h) return true
    }
    return false
  }

  // Cast a ray from (px, py) in direction (dx, dy) and return the first point
  // that hits a wall, or the max-range endpoint if no wall is in the way.
  private castVisibilityRay(
    px: number, py: number,
    dx: number, dy: number,
    maxDist: number,
    walls: Wall[],
  ): { x: number, y: number } {
    for (let d = FOG_RAY_STEP; d <= maxDist; d += FOG_RAY_STEP) {
      const x = px + dx * d
      const y = py + dy * d
      if (this.pointInWall(x, y, walls)) return { x, y }
    }
    return { x: px + dx * maxDist, y: py + dy * maxDist }
  }

  // Build a star-shaped visibility polygon around the player and erase it from
  // the fog texture. Walls cut the rays short so unseen areas stay black.
  // Raycasting runs in world space; the resulting polygon is converted to
  // fog-texture space (÷ FOG_SCALE) before being erased into the small texture.
  private updateFog(): void {
    const wx = this.webbs.x
    const wy = this.webbs.y
    // Skip if the player hasn't moved — cumulative reveal means nothing new to clear.
    const ddx = wx - this.lastFogX
    const ddy = wy - this.lastFogY
    if (ddx * ddx + ddy * ddy < FOG_MOVE_THRESHOLD_SQ) return
    this.lastFogX = wx
    this.lastFogY = wy

    const visWalls = this.nearbyWalls(wx, wy, FOG_REVEAL_R + FOG_RAY_STEP)

    this.fogEraserGfx.clear()
    this.fogEraserGfx.fillStyle(0xffffff, 1)
    this.fogEraserGfx.beginPath()

    for (let i = 0; i <= FOG_RAY_COUNT; i++) {
      const angle = (i / FOG_RAY_COUNT) * Math.PI * 2
      const dx = Math.cos(angle)
      const dy = Math.sin(angle)
      // Raycast in world space; convert hit to fog-texture space for the erase polygon.
      const hit = this.castVisibilityRay(wx, wy, dx, dy, FOG_REVEAL_R, visWalls)
      const tx = hit.x / FOG_SCALE
      const ty = hit.y / FOG_SCALE
      if (i === 0) this.fogEraserGfx.moveTo(tx, ty)
      else         this.fogEraserGfx.lineTo(tx, ty)
    }
    this.fogEraserGfx.closePath()
    this.fogEraserGfx.fillPath()

    this.fog.erase(this.fogEraserGfx)
  }

  private checkEnemyContact(): void {
    for (const sp of this.spawnPoints) {
      if (!sp.alive || !sp.ref || sp.ref.isDead()) continue
      const enemy = sp.ref
      const dist = Phaser.Math.Distance.Between(this.webbs.x, this.webbs.y, enemy.x, enemy.y)
      if (dist < CONTACT_RADIUS) {
        this.webbs.damage(enemy.damage)
        this.health = this.webbs.hp
        this.contactCooldown = CONTACT_COOLDOWN
        if (!this.webbs.maxProtectionActive) {
          const angle = Phaser.Math.Angle.Between(enemy.x, enemy.y, this.webbs.x, this.webbs.y)
          const force = 240 + enemy.damage * 8
          this.webbs.pb.setVelocity(Math.cos(angle) * force, Math.sin(angle) * force)
        }
        if (this.health <= 0) this.playerDied()
        break
      }
    }
  }

  private checkDeadEndTriggers(): void {
    const px = this.webbs.x
    const py = this.webbs.y
    for (const room of this.deadEndRooms) {
      if (room.triggered) continue
      if (px < room.x || px > room.x + room.w) continue
      if (py < room.y || py > room.y + room.h) continue
      room.triggered = true
      if (room.type === 'spike') this.triggerSpikeTrap(room)
      else if (room.type === 'ambush') this.triggerDeadEndAmbush(room)
      // 'mimic' rooms: chest entity handles its own interaction
    }
  }

  private triggerSpikeTrap(room: DeadEndRoom): void {
    // Flash the trap visuals red, deal damage, knock player out
    const g = this.add.graphics().setDepth(30)
    g.fillStyle(0xff2222, 0.45)
    g.fillRect(room.x, room.y, room.w, room.h)
    this.tweens.add({
      targets: g, alpha: 0, duration: 500,
      onComplete: () => g.destroy(),
    })
    const angle = Phaser.Math.Angle.Between(room.x + room.w / 2, room.y + room.h / 2, this.webbs.x, this.webbs.y)
    this.webbs.damage(20)
    this.webbs.pb.setVelocity(Math.cos(angle) * 400, Math.sin(angle) * 400)
    this.health = this.webbs.hp
    if (this.health <= 0) this.playerDied()
  }

  private triggerDeadEndAmbush(room: DeadEndRoom): void {
    // Spawn 2 centipedes inside the room
    const offsets = [{ x: room.w * 0.25, y: room.h * 0.5 }, { x: room.w * 0.75, y: room.h * 0.5 }]
    for (const off of offsets) {
      const sp: SpawnPoint = {
        kind: 'centipede',
        x: room.x + off.x,
        y: room.y + off.y,
        respawnTimer: 0,
        alive: false,
      }
      this.spawnPoints.push(sp)
      this.spawnEnemyForPoint(sp)
    }
    this.refreshEnemyTargets()
  }

  private handleConsumableKeys(): void {
    if (Phaser.Input.Keyboard.JustDown(this.cKey)) {
      const restored = this.consumableSystem.tryHpPotion()
      if (restored !== null) {
        this.webbs.hp = Math.min(this.webbs.hpMax, this.webbs.hp + restored)
        this.health = this.webbs.hp
        this.registry.set('consumableInventory', this.consumableSystem.getInventorySnapshot())
      }
    }

    if (Phaser.Input.Keyboard.JustDown(this.vKey)) {
      const dur = this.consumableSystem.tryTonic()
      if (dur !== null) {
        this.registry.set('consumableInventory', this.consumableSystem.getInventorySnapshot())
      }
    }

    if (Phaser.Input.Keyboard.JustDown(this.xKey)) {
      if (this.consumableSystem.tryMaxPotion()) {
        this.webbs.hp      = this.webbs.hpMax
        this.webbs.stamina = this.webbs.maxStamina
        this.health        = this.webbs.hp
        this.registry.set('consumableInventory', this.consumableSystem.getInventorySnapshot())
      }
    }
  }

  private spawnChests(): void {
    for (const room of this.deadEndRooms) {
      if (room.type !== 'mimic') continue
      const cx = room.x + room.w / 2
      const cy = room.y + room.h / 2
      const isMimic = Math.random() < 0.25
      const chest = new Chest(this, cx, cy, isMimic)
      this.chestGroup.add(chest, true)
      this.chests.push(chest)
    }
  }

  private updateChests(eJustDown: boolean): void {
    const px = this.webbs.x
    const py = this.webbs.y
    for (const chest of this.chests) {
      const dx = chest.x - px, dy = chest.y - py
      if (dx * dx + dy * dy > ACTIVE_RADIUS_SQ) continue
      const result = chest.update(px, py, eJustDown)
      if (!result) continue

      if (result.opened) {
        let craftingDirty = false
        let consumableDirty = false
        for (const loot of result.opened) {
          if (loot.material) {
            this.craftingSystem.addMaterial(loot.material, loot.qty)
            craftingDirty = true
            this.events.emit('itemPickedUp', { materialType: loot.material, quantity: loot.qty })
          }
          if (loot.consumable) {
            this.consumableSystem.addConsumable(loot.consumable, loot.qty)
            consumableDirty = true
            this.events.emit('chestLooted', { label: loot.consumable.replace(/([A-Z])/g, ' $1').trim(), qty: loot.qty })
            if (loot.consumable === 'MaxPotion') {
              this.triggerPickupCelebration({
                itemName:    'Max Potion',
                description: 'Fills all HP and Stamina instantly.\nFor 10 seconds, blocks all damage and knockback.',
                color:       0xff88ff,
                callerScene: 'AntColonyScene',
              })
            }
          }
        }
        if (craftingDirty)   this.registry.set('craftingInventory',   this.craftingSystem.getInventorySnapshot())
        if (consumableDirty) this.registry.set('consumableInventory', this.consumableSystem.getInventorySnapshot())
      }

      if (result.mimicAttack) {
        const { damage, angle } = result.mimicAttack
        this.webbs.damage(damage)
        if (!this.webbs.maxProtectionActive) {
          this.webbs.pb.setVelocity(Math.cos(angle) * 380, Math.sin(angle) * 380)
        }
        this.health = this.webbs.hp
        this.contactCooldown = 800
        if (this.health <= 0) this.playerDied()
      }
    }
  }

  private playerDied(): void {
    if (this.transitioning) return
    this.transitioning = true
    // Restore hp on the entity immediately — the remaining update() lines
    // this frame still read webbs.hp, so they must see full HP or the registry
    // ends up written with 0 and the player respawns dead.
    this.webbs.resetHp()
    this.health = this.healthMax
    this.registry.set('health', this.healthMax)
    this.cameras.main.fade(700, 0, 0, 0)
    this.time.delayedCall(700, () => this.scene.start('HomeBaseScene'))
  }

  // Schedule a fade-out and destroy for a loot pickup that hasn't been collected.
  // Prevents uncollected drops from accumulating infinite bob tweens + StaticBodies
  // across many enemy respawn cycles.
  private scheduleLootDespawn(p: Pickup): void {
    this.time.delayedCall(40000, () => {
      if (!p.active) return
      this.tweens.add({
        targets: p, alpha: 0, duration: 600,
        onComplete: () => { if (p.active) p.destroy() },
      })
    })
  }

  private spawnLootAt(data: { x: number, y: number, loot: Array<{ material: MaterialType, quantity: number }>, stuckThistles?: number }): void {
    // Material loot
    if (data.loot && data.loot.length > 0) {
      data.loot.forEach((drop, i) => {
        const offX = (i - (data.loot.length - 1) / 2) * 22
        const p = new Pickup(this, data.x + offX, data.y, drop.material, drop.quantity, this.craftingSystem)
        this.pickupGroup.add(p, true)
        this.scheduleLootDespawn(p)
      })
    }
    // Each thistle embedded in the corpse has a 70-90% chance to be recoverable.
    const stuck = data.stuckThistles ?? 0
    for (let i = 0; i < stuck; i++) {
      const chance = Phaser.Math.FloatBetween(0.7, 0.9)
      if (Math.random() < chance) {
        const offX = Phaser.Math.Between(-26, 26)
        const offY = Phaser.Math.Between(-14, 14)
        this.spawnThistleAt({ x: data.x + offX, y: data.y + offY })
      }
    }
    // Mark the spawn point for respawn
    this.markEnemyDead(data.x, data.y)
  }

  private spawnThistleAt(data: { x: number, y: number }): void {
    const p = new Pickup(this, data.x, data.y, 'Thistle', 1, this.craftingSystem)
    this.pickupGroup.add(p, true)
    this.scheduleLootDespawn(p)
  }

  // ── Squeeze-through animation ─────────────────────────────────────────────
  // When the player is inside a narrow corridor (walls within SQUEEZE_TRIGGER_GAP
  // on opposing sides), apply a subtle compression scale to sell the squeeze.

  private updateSqueezeEffect(): void {
    // Pre-filter walls to squeeze detection range to avoid full-list scans
    const sqWalls = this.nearbyWalls(this.webbs.x, this.webbs.y, 220)
    // Sample wall distances in the 4 cardinal directions
    const up    = this.distanceToWall(this.webbs.x, this.webbs.y,  0, -1, sqWalls)
    const down  = this.distanceToWall(this.webbs.x, this.webbs.y,  0,  1, sqWalls)
    const left  = this.distanceToWall(this.webbs.x, this.webbs.y, -1,  0, sqWalls)
    const right = this.distanceToWall(this.webbs.x, this.webbs.y,  1,  0, sqWalls)

    const verticalGap   = up + down       // distance from wall-above to wall-below
    const horizontalGap = left + right

    const inTightVerticalGap   = verticalGap   < SQUEEZE_TRIGGER_GAP
    const inTightHorizontalGap = horizontalGap < SQUEEZE_TRIGGER_GAP

    if (inTightVerticalGap && this.webbs.scaleY > 0.72) {
      this.tweenScale(this.webbs.scaleX, 0.65)
      this.webbs.setBodyRadius(WEBBS_BODY_R_SQUEEZE)
    } else if (inTightHorizontalGap && this.webbs.scaleX > 0.72) {
      this.tweenScale(0.65, this.webbs.scaleY)
      this.webbs.setBodyRadius(WEBBS_BODY_R_SQUEEZE)
    } else if (!inTightVerticalGap && !inTightHorizontalGap && (this.webbs.scaleX < 0.98 || this.webbs.scaleY < 0.98)) {
      this.tweenScale(1, 1)
      this.webbs.setBodyRadius(WEBBS_BODY_R_NORMAL)
    }
  }

  private tweenScale(sx: number, sy: number): void {
    if (this.squeezeTween) this.squeezeTween.stop()
    this.squeezeTween = this.tweens.add({
      targets: this.webbs, scaleX: sx, scaleY: sy,
      duration: 180, ease: 'Sine.easeOut',
    })
  }

  // Cast a ray in (dx,dy) from (x,y) and return distance to nearest wall edge,
  // capped at 200px so far-open spaces don't keep returning huge values.
  private distanceToWall(x: number, y: number, dx: number, dy: number, walls?: Wall[]): number {
    const STEP = 8
    const MAX  = 200
    for (let d = STEP; d <= MAX; d += STEP) {
      if (this.pointInWall(x + dx * d, y + dy * d, walls)) return d
    }
    return MAX
  }

  // ── Pickup / input helpers ────────────────────────────────────────────────

  private aimToPointer(): { dx: number, dy: number } {
    const p = this.input.activePointer
    return { dx: p.worldX - this.webbs.x, dy: p.worldY - this.webbs.y }
  }

  private fireActiveWeaponAtPointer(pointer: Phaser.Input.Pointer): void {
    if (this.activeSlot < 0) return
    const weapon = this.webbs.weaponSystem.getSlot(this.activeSlot)
    if (weapon === WeaponType.Empty) return
    const aim = { dx: pointer.worldX - this.webbs.x, dy: pointer.worldY - this.webbs.y }
    if (weapon === WeaponType.WebLauncher) {
      this.webLauncher.onQPressed(this, this.webbs, aim)
    } else {
      this.weaponUseSystem.activateWeapon(this.activeSlot, this.webbs, this, aim)
    }
  }

  private collectPickupsInRange(): void {
    for (const obj of this.pickupGroup.getChildren()) {
      const p = obj as unknown as Pickup
      if (!p.active) continue
      if (Phaser.Math.Distance.Between(this.webbs.x, this.webbs.y, p.x, p.y) < PICKUP_REACH) {
        this.collectMaterialPickup(p)
      }
    }
    for (const obj of this.hpModuleGroup.getChildren()) {
      const m = obj as unknown as HpModule
      if (!m.active) continue
      if (Phaser.Math.Distance.Between(this.webbs.x, this.webbs.y, m.x, m.y) < PICKUP_REACH) {
        m.collect()
      }
    }
  }

  private collectMaterialPickup(p: Pickup): void {
    p.collect()
    this.registry.set('craftingInventory', this.craftingSystem.getInventorySnapshot())
    if (p.materialType === MaterialType.CrystalShard) {
      this.triggerPickupCelebration({
        itemName:    'Crystal Shard',
        description: 'A rare crystalline formation from deep in the colony.\nRequired for crafting the most powerful consumables.',
        color:       0x88ccff,
        callerScene: 'AntColonyScene',
      })
    }
  }

  private triggerPickupCelebration(data: CelebData): void {
    if (this.celebLaunching) return
    this.celebLaunching = true
    this.registry.set('celebData', data)
    this.scene.launch('PickupCelebration')
  }

  private onHpModulePicked(data: { amount: number, x: number, y: number }): void {
    const before = this.webbs.hp
    this.webbs.hp = Math.min(this.webbs.hpMax, before + data.amount)
    this.health = this.webbs.hp
    // Small green flash centered on the pickup
    const ring = this.add.arc(data.x, data.y, 8, 0, 360, false, 0x66ff99, 0.6).setDepth(40)
    this.tweens.add({
      targets:    ring,
      alpha:      0,
      scaleX:     5,
      scaleY:     5,
      duration:   420,
      onComplete: () => ring.destroy(),
    })
  }

  private syncRegistry(): void {
    this.registry.set('zoneName',            'ANT COLONY')
    this.registry.set('health',              this.health)
    this.registry.set('healthMax',           this.healthMax)
    this.registry.set('stamina',             this.webbs.stamina)
    this.registry.set('staminaMax',          this.webbs.maxStamina)
    this.registry.set('energy',              this.webbs.energy)
    this.registry.set('energyMax',           this.webbs.maxEnergy)
    this.registry.set('weaponSlots',         this.webbs.weaponSystem.getAllSlots())
    this.registry.set('unlockedSlots',       this.webbs.weaponSystem.getUnlockedSlotCount())
    this.registry.set('legTier',             this.webbs.weaponSystem.getLegTier())
    this.registry.set('consumableInventory', this.consumableSystem.getInventorySnapshot())
  }
}
