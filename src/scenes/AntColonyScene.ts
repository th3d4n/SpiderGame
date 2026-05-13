import Phaser from 'phaser'
import Webbs, { PLAYER_MAX_HP } from '../entities/Webbs'
import Workbench from '../entities/Workbench'
import Pickup from '../entities/Pickup'
import CentipedeAmbusher from '../entities/CentipedeAmbusher'
import BeetleTank from '../entities/BeetleTank'
import type Enemy from '../entities/Enemy'
import { CraftingSystem, MaterialType } from '../systems/CraftingSystem'
import { WeaponType } from '../systems/WeaponSystem'
import { WeaponUseSystem } from '../systems/WeaponUseSystem'
import { WebLauncherSystem } from '../systems/WebLauncherSystem'
import { ZoneTransitionSystem } from '../systems/ZoneTransitionSystem'

// Bigger than before — sprawling tunnel network with rooms and dead ends.
const WORLD_W = 6000
const WORLD_H = 3000

// HOME BASE portal sits at the right edge (next to spawn).
// BOSS tunnel sits at the far top-left — the furthest reachable corner.
const HOME_PORTAL_X  = WORLD_W - 110
const HOME_PORTAL_Y  = 1500          // middle of the main corridor
const BOSS_PORTAL_X  = 180
const BOSS_PORTAL_Y  = 300

// Contact damage cooldown
const CONTACT_COOLDOWN = 750
const CONTACT_RADIUS   = 28 + 16

// Fog of war reveal radius
const FOG_REVEAL_R = 240

// Respawn timer for fallen enemies (ms)
const RESPAWN_MS = 18000

// Squeeze-through animation — kicks in inside narrow corridors
const SQUEEZE_TRIGGER_GAP = 110

// Pickup detection — generous radius so any leg or the body rolls over it
const PICKUP_REACH = 50
// Web Launcher pickup-attach radius
const WEB_PICKUP_HIT = 24

type EnemyKind = 'centipede' | 'beetle'
interface Wall { x: number; y: number; w: number; h: number }
interface SpawnPoint { kind: EnemyKind; x: number; y: number; respawnTimer: number; alive: boolean; ref?: CentipedeAmbusher | BeetleTank }

export default class AntColonyScene extends Phaser.Scene {
  private webbs!:            Webbs
  private workbench!:        Workbench
  private craftingSystem!:   CraftingSystem
  private pickupGroup!:      Phaser.Physics.Arcade.StaticGroup
  private weaponUseSystem!:  WeaponUseSystem
  private webLauncher!:      WebLauncherSystem
  private qKey!:             Phaser.Input.Keyboard.Key
  private weaponKeys:        Phaser.Input.Keyboard.Key[] = []
  private eKey!:             Phaser.Input.Keyboard.Key
  private spawnPoints:       SpawnPoint[] = []
  private wallRects:         Wall[] = []
  private wallGroup!:        Phaser.Physics.Arcade.StaticGroup
  private fog!:              Phaser.GameObjects.RenderTexture
  private transitioning      = false
  private squeezeTween?:     Phaser.Tweens.Tween

  // Player stats
  private health         = PLAYER_MAX_HP
  private healthMax      = PLAYER_MAX_HP
  private stamina        = 100
  private energy         = 100
  private contactCooldown = 0
  // Last weapon-key pressed — left-click reuses this slot with mouse-aim
  private activeSlot      = -1

  constructor() {
    super({ key: 'AntColonyScene' })
  }

  create() {
    this.transitioning  = false
    this.spawnPoints    = []
    this.contactCooldown = 0
    this.physics.world.setBounds(0, 0, WORLD_W, WORLD_H)

    const savedHp = this.registry.get('health') as number | undefined
    if (savedHp !== undefined) this.health = savedHp

    this.drawBackground()
    this.wallRects = this.buildMazeWalls()
    this.drawWalls()
    this.drawGapMarkers()
    this.drawPortals()

    // Workbench tucked just inside the entry chamber
    this.workbench = new Workbench(this, WORLD_W - 350, 1500)

    // Crafting system — share player's inventory via registry across zones
    this.craftingSystem = new CraftingSystem()
    const savedInv = this.registry.get('craftingInventory') as Record<string, number> | null
    if (savedInv) this.craftingSystem.restoreFromSnapshot(savedInv)

    // Pickup group
    this.pickupGroup = this.physics.add.staticGroup()

    // Scatter a few thistles around the maze as bow ammo to discover
    const thistleSeeds = [
      { x: 5400, y: 1480 }, { x: 4600, y: 1500 }, { x: 3700, y: 800  },
      { x: 3000, y: 2450 }, { x: 2200, y: 700  }, { x: 1400, y: 1500 },
      { x: 800,  y: 900  }, { x: 350,  y: 500  },
    ]
    for (const t of thistleSeeds) {
      const p = new Pickup(this, t.x, t.y, 'Thistle', 1, this.craftingSystem)
      this.pickupGroup.add(p, true)
    }

    // Spawn Webbs right next to the home portal
    this.webbs = new Webbs(this, HOME_PORTAL_X - 90, HOME_PORTAL_Y)
    this.webbs.resetHp(this.health)
    this.physics.add.collider(this.webbs, this.wallGroup)

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
    this.events.on('resume', () => { this.webbs.refreshLegColors() })

    // Pickup collection runs through a manual proximity sweep in update() so the
    // entire spider — body and legs — picks things up, not just the tiny body box.

    // Enemy loot drops + bow ammo recovery
    this.events.on('enemyDied',      this.spawnLootAt,       this)
    this.events.on('thistleDropped', this.spawnThistleAt,    this)
    this.events.once('shutdown', () => {
      this.events.off('enemyDied',      this.spawnLootAt,       this)
      this.events.off('thistleDropped', this.spawnThistleAt,    this)
    })

    // Weapon systems
    this.weaponUseSystem = new WeaponUseSystem()
    this.weaponUseSystem.setWorldBounds(WORLD_W, WORLD_H)
    this.webLauncher     = new WebLauncherSystem()
    this.webLauncher.setWorldBounds(WORLD_W, WORLD_H)
    this.webLauncher.setWallHitTest((x, y) => this.pointInWall(x, y))
    // Web can reel in any active pickup orb
    this.webLauncher.setPickupHitTest((wx, wy) => {
      for (const obj of this.pickupGroup.getChildren()) {
        const p = obj as unknown as Pickup
        if (!p.active) continue
        if (Phaser.Math.Distance.Between(wx, wy, p.x, p.y) < WEB_PICKUP_HIT) {
          return { x: p.x, y: p.y, active: p.active, collect: () => this.collectMaterialPickup(p) }
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
    this.input.keyboard!.on('keydown-I', () => {
      if (!this.scene.isActive('EquipScreen')) {
        this.registry.set('equipCallerScene', 'AntColonyScene')
        this.scene.launch('EquipScreen')
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
    this.cameras.main.setZoom(1.0)

    // Fog of war
    this.fog = this.add.renderTexture(0, 0, WORLD_W, WORLD_H).setOrigin(0).setDepth(50)
    this.fog.fill(0x000000, 0.9)
    const eraser = this.make.graphics({}, false)
    for (let r = FOG_REVEAL_R; r > 0; r -= 6) {
      eraser.fillStyle(0xffffff, 1 - (r / FOG_REVEAL_R))
      eraser.fillCircle(FOG_REVEAL_R, FOG_REVEAL_R, r)
    }
    eraser.generateTexture('fog-eraser', FOG_REVEAL_R * 2, FOG_REVEAL_R * 2)
    eraser.destroy()

    if (!this.scene.isActive('HUDScene')) this.scene.launch('HUDScene')
    if (!this.scene.isActive('PickupNotification')) this.scene.launch('PickupNotification')

    this.syncRegistry()
    ZoneTransitionSystem.announceZone(this, 'ZONE 1 — ANT COLONY')
  }

  update(time: number, delta: number) {
    if (this.transitioning) return

    const pendingEquip = this.registry.get('pendingEquip') as WeaponType | null ?? null
    if (pendingEquip !== null) {
      this.registry.set('pendingEquip', null)
      const updated = this.registry.get('craftingInventory') as Record<string, number> | null
      if (updated) {
        for (const [mat, amt] of Object.entries(updated)) {
          this.craftingSystem['inventory'].set(mat as MaterialType, amt)
        }
      }
      const inv = (this.registry.get('weaponInventory') as WeaponType[] | undefined) ?? []
      inv.push(pendingEquip)
      this.registry.set('weaponInventory', inv)
    }

    this.webbs.update(time, delta)
    this.weaponUseSystem.update(delta)
    this.webLauncher.update(this, this.webbs, delta)

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

    // Enemy ticking + respawn timers
    for (const sp of this.spawnPoints) {
      if (sp.alive && sp.ref) sp.ref.update(time, delta)
      else {
        sp.respawnTimer -= delta
        if (sp.respawnTimer <= 0) this.respawnSpawnPoint(sp)
      }
    }

    if (!this.scene.isActive('CraftingMenu') && this.workbench.update(this.webbs, this.eKey)) {
      this.registry.set('craftingInventory', this.craftingSystem.getInventorySnapshot())
      this.registry.set('legTier',           this.webbs.weaponSystem.getLegTier())
      this.registry.set('callerScene', 'AntColonyScene')
      this.scene.launch('CraftingMenu')
    }

    if (this.contactCooldown > 0) this.contactCooldown -= delta
    else                          this.checkEnemyContact()

    this.health = this.webbs.hp

    // Squeeze-through detection — visual flourish when the player is in a tight gap
    this.updateSqueezeEffect()

    // Fog of war
    this.fog.erase('fog-eraser', this.webbs.x - FOG_REVEAL_R, this.webbs.y - FOG_REVEAL_R)

    // Proximity portal triggers
    const distHome = Phaser.Math.Distance.Between(this.webbs.x, this.webbs.y, HOME_PORTAL_X, HOME_PORTAL_Y)
    const distBoss = Phaser.Math.Distance.Between(this.webbs.x, this.webbs.y, BOSS_PORTAL_X, BOSS_PORTAL_Y)
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

  private buildMazeWalls(): Wall[] {
    const walls: Wall[] = []
    const T = 50  // outer wall thickness

    // Outer perimeter
    walls.push({ x: 0, y: 0, w: WORLD_W, h: T })
    walls.push({ x: 0, y: WORLD_H - T, w: WORLD_W, h: T })
    walls.push({ x: 0, y: 0, w: T, h: WORLD_H })
    walls.push({ x: WORLD_W - T, y: 0, w: T, h: WORLD_H })

    // Main corridor at y=1300..1700 stretches across the whole map.
    // Side chambers are formed by horizontal ceiling/floor walls plus vertical dividers.

    // CEILING of corridor (separates corridor from upper chambers)
    // Has gaps at column centers so player can drop UP into upper chambers.
    // The x=300 gap is the only route into the upper-left boss antechamber.
    const ceilingGapsX = [300, 800, 2200, 3700, 4900]
    let prevX = T
    for (const gx of ceilingGapsX) {
      walls.push({ x: prevX, y: 1250, w: gx - 180 - prevX, h: 50 })
      prevX = gx + 180   // 360-wide gap each
    }
    walls.push({ x: prevX, y: 1250, w: WORLD_W - T - prevX, h: 50 })

    // FLOOR of corridor (separates corridor from lower chambers)
    const floorGapsX = [1400, 3000, 4400]
    prevX = T
    for (const gx of floorGapsX) {
      walls.push({ x: prevX, y: 1700, w: gx - 180 - prevX, h: 50 })
      prevX = gx + 180
    }
    walls.push({ x: prevX, y: 1700, w: WORLD_W - T - prevX, h: 50 })

    // Vertical dividers crossing the corridor — each leaves a wide passage at corridor height
    // (and shaped so the player can always squeeze through at y≈1500)
    const verticalDividers = [500, 1400, 2200, 3000, 3700, 4400, 5200]
    for (const dx of verticalDividers) {
      // Above corridor (slim wall above ceiling-gap line)
      walls.push({ x: dx, y: T,    w: 50, h: 1250 - T })
      // Below corridor
      walls.push({ x: dx, y: 1750, w: 50, h: WORLD_H - T - 1750 })
    }

    // Upper chamber subdivisions — secondary walls creating mini-rooms above the corridor
    walls.push({ x: 1100, y: 50,  w: 50, h: 600 })
    walls.push({ x: 1700, y: 400, w: 50, h: 500 })
    walls.push({ x: 2700, y: 50,  w: 50, h: 700 })
    walls.push({ x: 4000, y: 300, w: 50, h: 600 })
    walls.push({ x: 4700, y: 50,  w: 50, h: 500 })

    // Lower chamber subdivisions
    walls.push({ x: 900,  y: 2100, w: 50, h: 800 })
    walls.push({ x: 2400, y: 1900, w: 50, h: 700 })
    walls.push({ x: 3700, y: 2300, w: 50, h: 600 })
    walls.push({ x: 4700, y: 2100, w: 50, h: 700 })

    // Boss antechamber wall — protects the boss portal so player threads up a passage
    walls.push({ x: 250, y: 600, w: 700, h: 50 })  // ceiling of antechamber

    return walls
  }

  private drawWalls(): void {
    this.wallGroup = this.physics.add.staticGroup()
    const g = this.add.graphics().setDepth(2)
    for (const w of this.wallRects) {
      g.fillStyle(0x1a1006, 1)
      g.fillRect(w.x, w.y, w.w, w.h)
      g.lineStyle(2, 0x3a2418, 1)
      g.strokeRect(w.x, w.y, w.w, w.h)

      const body = this.add.rectangle(w.x + w.w / 2, w.y + w.h / 2, w.w, w.h, 0x000000, 0)
      this.physics.add.existing(body, true)
      this.wallGroup.add(body)
    }
  }

  private drawGapMarkers(): void {
    // Bright glow at each passage so the player can see openings through the fog
    const g = this.add.graphics().setDepth(3)
    const drawGap = (cx: number, cy: number) => {
      g.fillStyle(0x66ffaa, 0.18); g.fillCircle(cx, cy, 36)
      g.fillStyle(0x99ffcc, 0.35); g.fillCircle(cx, cy, 18)
      g.fillStyle(0xddffee, 0.7);  g.fillCircle(cx, cy, 6)
    }

    // Corridor ceiling gaps
    for (const gx of [300, 800, 2200, 3700, 4900]) drawGap(gx, 1275)
    // Corridor floor gaps
    for (const gx of [1400, 3000, 4400])      drawGap(gx, 1700)
    // Vertical divider gaps (corridor-height openings)
    for (const dx of [500, 1400, 2200, 3000, 3700, 4400, 5200]) drawGap(dx + 25, 1500)
    // Boss antechamber gap
    drawGap(950, 625)
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
    // Glowing fungus dots
    for (let i = 0; i < 80; i++) {
      const fx = rng.integerInRange(120, WORLD_W - 120)
      const fy = rng.integerInRange(120, WORLD_H - 120)
      const r  = rng.integerInRange(3, 7)
      g.fillStyle(0x44ff88, 0.05); g.fillCircle(fx, fy, r * 3.5)
      g.fillStyle(0x66ffaa, 0.12); g.fillCircle(fx, fy, r * 1.8)
      g.fillStyle(0x99ffcc, 0.7);  g.fillCircle(fx, fy, r)
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

    // BOSS — top-left corner, red
    const boss = this.add.graphics().setDepth(3)
    boss.fillStyle(0x1a0a06, 1); boss.fillRect(BOSS_PORTAL_X - 40, BOSS_PORTAL_Y - 70, 80, 140)
    boss.lineStyle(2, 0x663333, 0.7); boss.strokeRect(BOSS_PORTAL_X - 40, BOSS_PORTAL_Y - 70, 80, 140)
    const bossGlow = this.add.graphics().setDepth(4)
    bossGlow.lineStyle(2, 0xff4422, 0.6); bossGlow.strokeRect(BOSS_PORTAL_X - 40, BOSS_PORTAL_Y - 70, 80, 140)
    this.tweens.add({ targets: bossGlow, alpha: { from: 0.3, to: 1 }, duration: 900, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' })
    this.add.text(BOSS_PORTAL_X, BOSS_PORTAL_Y - 90, 'BOSS', {
      fontFamily: 'monospace', fontSize: '12px', color: '#cc3322',
    }).setOrigin(0.5).setDepth(4)
  }

  // ── Enemy spawning + respawn ───────────────────────────────────────────────

  private defineSpawnPoints(): void {
    const points: Array<{ kind: EnemyKind, x: number, y: number }> = [
      // Spawn-side corridor (intro)
      { kind: 'centipede', x: 5400, y: 1500 },
      { kind: 'centipede', x: 5000, y: 1500 },
      // Corridor mid
      { kind: 'beetle',    x: 4600, y: 1500 },
      { kind: 'centipede', x: 4100, y: 1500 },
      { kind: 'centipede', x: 3500, y: 1500 },
      { kind: 'beetle',    x: 2800, y: 1500 },
      { kind: 'centipede', x: 2400, y: 1500 },
      { kind: 'centipede', x: 1900, y: 1500 },
      { kind: 'centipede', x: 1100, y: 1500 },
      // Upper chambers (ambush spots near gaps)
      { kind: 'centipede', x: 800,  y: 900  },
      { kind: 'beetle',    x: 2200, y: 700  },
      { kind: 'centipede', x: 3700, y: 800  },
      { kind: 'centipede', x: 4900, y: 600  },
      // Lower chambers
      { kind: 'beetle',    x: 1400, y: 2400 },
      { kind: 'centipede', x: 3000, y: 2400 },
      { kind: 'beetle',    x: 4400, y: 2500 },
      // Boss approach
      { kind: 'beetle',    x: 700,  y: 1500 },
      { kind: 'centipede', x: 500,  y: 1000 },
      { kind: 'centipede', x: 350,  y: 500  },
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

  private pointInWall(x: number, y: number): boolean {
    for (const w of this.wallRects) {
      if (x >= w.x && x <= w.x + w.w && y >= w.y && y <= w.y + w.h) return true
    }
    return false
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
        const angle = Phaser.Math.Angle.Between(enemy.x, enemy.y, this.webbs.x, this.webbs.y)
        const force = 240 + enemy.damage * 8
        this.webbs.pb.setVelocity(Math.cos(angle) * force, Math.sin(angle) * force)
        if (this.health <= 0) this.playerDied()
        break
      }
    }
  }

  private playerDied(): void {
    if (this.transitioning) return
    this.transitioning = true
    this.health = this.healthMax
    this.registry.set('health', this.healthMax)
    this.cameras.main.fade(700, 0, 0, 0)
    this.time.delayedCall(700, () => this.scene.start('HomeBaseScene'))
  }

  private spawnLootAt(data: { x: number, y: number, loot: Array<{ material: MaterialType, quantity: number }>, stuckThistles?: number }): void {
    // Material loot
    if (data.loot && data.loot.length > 0) {
      data.loot.forEach((drop, i) => {
        const offX = (i - (data.loot.length - 1) / 2) * 22
        const p = new Pickup(this, data.x + offX, data.y, drop.material, drop.quantity, this.craftingSystem)
        this.pickupGroup.add(p, true)
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
  }

  // ── Squeeze-through animation ─────────────────────────────────────────────
  // When the player is inside a narrow corridor (walls within SQUEEZE_TRIGGER_GAP
  // on opposing sides), apply a subtle compression scale to sell the squeeze.

  private updateSqueezeEffect(): void {
    // Sample wall distances in the 4 cardinal directions
    const up    = this.distanceToWall(this.webbs.x, this.webbs.y,  0, -1)
    const down  = this.distanceToWall(this.webbs.x, this.webbs.y,  0,  1)
    const left  = this.distanceToWall(this.webbs.x, this.webbs.y, -1,  0)
    const right = this.distanceToWall(this.webbs.x, this.webbs.y,  1,  0)

    const verticalGap   = up + down       // distance from wall-above to wall-below
    const horizontalGap = left + right

    const inTightVerticalGap   = verticalGap   < SQUEEZE_TRIGGER_GAP
    const inTightHorizontalGap = horizontalGap < SQUEEZE_TRIGGER_GAP

    if (inTightVerticalGap && this.webbs.scaleY > 0.72) {
      this.tweenScale(this.webbs.scaleX, 0.65)
    } else if (inTightHorizontalGap && this.webbs.scaleX > 0.72) {
      this.tweenScale(0.65, this.webbs.scaleY)
    } else if (!inTightVerticalGap && !inTightHorizontalGap && (this.webbs.scaleX < 0.98 || this.webbs.scaleY < 0.98)) {
      this.tweenScale(1, 1)
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
  private distanceToWall(x: number, y: number, dx: number, dy: number): number {
    const STEP = 4
    const MAX  = 200
    for (let d = STEP; d <= MAX; d += STEP) {
      if (this.pointInWall(x + dx * d, y + dy * d)) return d
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
  }

  private collectMaterialPickup(p: Pickup): void {
    p.collect()
    this.registry.set('craftingInventory', this.craftingSystem.getInventorySnapshot())
  }

  private syncRegistry(): void {
    this.registry.set('zoneName',      'ANT COLONY')
    this.registry.set('health',        this.health)
    this.registry.set('healthMax',     this.healthMax)
    this.registry.set('stamina',       this.stamina)
    this.registry.set('staminaMax',    100)
    this.registry.set('energy',        this.energy)
    this.registry.set('energyMax',     100)
    this.registry.set('weaponSlots',   this.webbs.weaponSystem.getAllSlots())
    this.registry.set('unlockedSlots', this.webbs.weaponSystem.getUnlockedSlotCount())
    this.registry.set('legTier',       this.webbs.weaponSystem.getLegTier())
  }
}
