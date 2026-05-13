import Phaser from 'phaser'
import Webbs, { PLAYER_MAX_HP } from '../entities/Webbs'
import Workbench from '../entities/Workbench'
import Pickup from '../entities/Pickup'
import WeaponPickup from '../entities/WeaponPickup'
import { MaterialType } from '../systems/CraftingSystem'
import { CraftingSystem } from '../systems/CraftingSystem'
import { WeaponType } from '../systems/WeaponSystem'
import { WeaponUseSystem } from '../systems/WeaponUseSystem'
import { WebLauncherSystem } from '../systems/WebLauncherSystem'
import { ZoneTransitionSystem } from '../systems/ZoneTransitionSystem'

const WORLD_W   = 2560
const WORLD_H   = 720
const FLOOR_Y   = WORLD_H - 60   // visual floor top edge

// Left-exit trigger
const LEFT_TRIGGER = 100

// Pickup detection — generous radius so any leg or the body rolls over it
const PICKUP_REACH = 50
// Web Launcher pickup-attach radius
const WEB_PICKUP_HIT = 24

export default class HomeBaseScene extends Phaser.Scene {
  private webbs!:            Webbs
  private workbench!:        Workbench
  private craftingSystem!:   CraftingSystem
  private pickupGroup!:      Phaser.Physics.Arcade.StaticGroup
  private weaponPickupGroup!:Phaser.Physics.Arcade.StaticGroup
  private weaponUseSystem!:  WeaponUseSystem
  private webLauncher!:      WebLauncherSystem
  private qKey!:             Phaser.Input.Keyboard.Key
  private weaponKeys:        Phaser.Input.Keyboard.Key[] = []
  private eKey!:             Phaser.Input.Keyboard.Key
  private transitioning      = false

  // Player stats — synced to registry each frame for HUD
  private health    = PLAYER_MAX_HP
  private healthMax = PLAYER_MAX_HP
  private stamina   = 100
  private energy    = 100
  private contactCooldown = 0
  // Last weapon-key pressed — left-click reuses this slot with mouse-aim
  private activeSlot      = -1

  constructor() {
    super({ key: 'HomeBaseScene' })
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  create() {
    this.transitioning = false
    this.physics.world.setBounds(0, 0, WORLD_W, WORLD_H)

    // Restore health from registry if returning from another zone
    const savedHp = this.registry.get('health') as number | undefined
    if (savedHp !== undefined) this.health = savedHp

    this.drawBackground()
    this.drawFloor()
    this.drawTornWebs()
    this.drawSilkHammocks()
    this.drawHalfBuiltInventions()
    this.drawFoodStores()
    this.drawPersonalItems()
    this.drawExits()
    this.spawnDustParticles()

    // Workbench at center-right of scene
    this.workbench = new Workbench(this, 1820, FLOOR_Y - 40)

    // Crafting system — restore from registry, or seed initial supplies on first load
    this.craftingSystem = new CraftingSystem()
    const savedInv = this.registry.get('craftingInventory') as Record<string, number> | null
    if (savedInv) {
      this.craftingSystem.restoreFromSnapshot(savedInv)
    } else {
      this.craftingSystem.addMaterial('SilkThread',   6)
      this.craftingSystem.addMaterial('ChitinShard',  4)
      this.craftingSystem.addMaterial('VenomGland',   2)
      this.craftingSystem.addMaterial('WebFluid',     4)
      this.craftingSystem.addMaterial('CrystalDust',  1)
      this.craftingSystem.addMaterial('BoneFragment', 2)
      this.registry.set('craftingInventory', this.craftingSystem.getInventorySnapshot())
    }

    // Pickup group
    this.pickupGroup = this.physics.add.staticGroup()
    this.weaponPickupGroup = this.physics.add.staticGroup()

    // Spawn pickups around home base — skip those previously collected this run
    const pickupDefs = [
      { x: 400,  y: 580, mat: 'SilkThread',  qty: 2 },
      { x: 650,  y: 560, mat: 'ChitinShard', qty: 3 },
      { x: 900,  y: 590, mat: 'CrystalDust', qty: 2 },
      { x: 500,  y: 540, mat: 'ChitinShard', qty: 2 },
      { x: 1100, y: 570, mat: 'VenomGland',  qty: 1 },
      { x: 1400, y: 580, mat: 'SilkThread',  qty: 1 },
      { x: 1600, y: 560, mat: 'CrystalDust', qty: 1 },
      { x: 1800, y: 575, mat: 'ChitinShard', qty: 2 },
      { x: 1500, y: 540, mat: 'Thistle',     qty: 1 },
      { x: 2000, y: 550, mat: 'Thistle',     qty: 1 },
      { x: 700,  y: 540, mat: 'Thistle',     qty: 1 },
    ]
    const collected = (this.registry.get('pickupsCollected_HomeBaseScene') as number[] | undefined) ?? []
    pickupDefs.forEach(({ x, y, mat, qty }, i) => {
      if (collected.includes(i)) return
      const p = new Pickup(this, x, y, mat as MaterialType, qty, this.craftingSystem)
      p.pickupId = i
      this.pickupGroup.add(p, true)
    })

    // Toothpick weapon pickup — only the FIRST melee weapon Webbs can find. Skip if already grabbed.
    const grabbedWeapons = (this.registry.get('weaponPickupsCollected') as string[] | undefined) ?? []
    if (!grabbedWeapons.includes('hb-toothpick')) {
      const tp = new WeaponPickup(this, 1200, FLOOR_Y - 30, WeaponType.BoxingGloves, 'hb-toothpick')
      this.weaponPickupGroup.add(tp, true)
    }

    // Spawn Webbs — position depends on which direction we entered from
    const spawnX = ZoneTransitionSystem.spawnX(this, WORLD_W, WORLD_W / 2 - 200)
    this.webbs = new Webbs(this, spawnX, FLOOR_Y - 60)
    this.webbs.resetHp(this.health)

    // Restore leg tier and equipped weapons from registry — both persist across zones
    const savedLegTier = this.registry.get('legTier') as number | undefined
    this.webbs.weaponSystem.setLegTier(savedLegTier !== undefined ? savedLegTier : 1)
    const savedSlots = this.registry.get('weaponSlots') as WeaponType[] | undefined
    if (savedSlots) {
      for (let i = 0; i < savedSlots.length; i++) {
        if (savedSlots[i] && savedSlots[i] !== WeaponType.Empty) {
          this.webbs.weaponSystem.equip(i, savedSlots[i])
        }
      }
    } else {
      // First-load loadout — Webbs only has his web launcher to start.
      // Everything else must be found in the world or crafted.
      this.webbs.weaponSystem.equip(0, WeaponType.WebLauncher)
    }
    this.webbs.refreshLegColors()

    // Expose WeaponSystem and weapon inventory to overlay scenes
    this.registry.set('weaponSystemRef', this.webbs.weaponSystem)
    this.registry.set('weaponInventory', (this.registry.get('weaponInventory') as WeaponType[] | undefined) ?? [])

    // Refresh leg colors when EquipScreen closes and this scene resumes
    this.events.on('resume', () => { this.webbs.refreshLegColors() })

    // Pickup collection is handled by a manual proximity sweep in update() so
    // that the entire spider — body and legs — registers contact, not just the
    // tiny default container body.

    // Weapon use system — keys 1-8 registered as tracked Key objects (checked
    // via JustDown in update) so they only fire when this scene is active.
    this.weaponUseSystem = new WeaponUseSystem()
    this.weaponUseSystem.setWorldBounds(WORLD_W, WORLD_H)
    this.webLauncher     = new WebLauncherSystem()
    this.webLauncher.setWorldBounds(WORLD_W, WORLD_H)
    // Treat world edges + floor + ceiling strip as wall surfaces so the web
    // can anchor on them. Missed shots fall through to the recall path.
    this.webLauncher.setWallHitTest((x, y) =>
      x <= 4 || x >= WORLD_W - 4 || y <= 30 || y >= FLOOR_Y
    )
    // Web can reel in pickups (material orbs or weapon pickups). collect() also
    // runs the scene's persistence logic so reeled-in pickups stay collected.
    this.webLauncher.setPickupHitTest((wx, wy) => {
      for (const obj of this.pickupGroup.getChildren()) {
        const p = obj as unknown as Pickup
        if (!p.active) continue
        if (Phaser.Math.Distance.Between(wx, wy, p.x, p.y) < WEB_PICKUP_HIT) {
          return { x: p.x, y: p.y, active: p.active, collect: () => this.collectMaterialPickup(p) }
        }
      }
      for (const obj of this.weaponPickupGroup.getChildren()) {
        const wp = obj as unknown as WeaponPickup
        if (!wp.active) continue
        if (Phaser.Math.Distance.Between(wx, wy, wp.x, wp.y) < WEB_PICKUP_HIT) {
          return { x: wp.x, y: wp.y, active: wp.active, collect: () => this.collectWeaponPickup(wp) }
        }
      }
      return null
    })
    this.qKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.Q)
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

    // Input
    this.eKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.E)

    // I key — open equip screen
    this.input.keyboard!.on('keydown-I', () => {
      if (!this.scene.isActive('EquipScreen')) {
        this.registry.set('equipCallerScene', 'HomeBaseScene')
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
    this.cameras.main.setZoom(1.15)

    // HUD
    if (!this.scene.isActive('HUDScene')) this.scene.launch('HUDScene')

    // Pickup notifications overlay
    if (!this.scene.isActive('PickupNotification')) this.scene.launch('PickupNotification')

    this.syncRegistry()
    ZoneTransitionSystem.announceZone(this, 'HOME BASE — SPIDER COLONY')
  }

  update(time: number, delta: number) {
    if (this.transitioning) return

    // Relay crafting result from CraftingMenu overlay
    const pendingEquip = this.registry.get('pendingEquip') as WeaponType | null ?? null
    if (pendingEquip !== null) {
      this.registry.set('pendingEquip', null)
      const updated = this.registry.get('craftingInventory') as Record<string, number> | null
      if (updated) {
        for (const [mat, amt] of Object.entries(updated)) {
          this.craftingSystem['inventory'].set(mat as MaterialType, amt)
        }
      }
      // Add crafted weapon to inventory — player assigns it to a slot via EquipScreen (I key)
      const inv = (this.registry.get('weaponInventory') as WeaponType[] | undefined) ?? []
      inv.push(pendingEquip)
      this.registry.set('weaponInventory', inv)
    }

    this.webbs.update(time, delta)
    this.weaponUseSystem.update(delta)
    this.webLauncher.update(this, this.webbs, delta)

    // Weapon keys 1-8 → fire that slot AND set it as the active slot for left-click
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

    // Q → web launcher (works in every scene that has one)
    if (Phaser.Input.Keyboard.JustDown(this.qKey)) {
      this.webLauncher.onQPressed(this, this.webbs, this.aimToPointer())
    }

    // Run proximity-based pickup collection every frame
    this.collectPickupsInRange()

    // Workbench interaction — guard prevents re-launch on the frame CraftingMenu resumes
    if (!this.scene.isActive('CraftingMenu') && this.workbench.update(this.webbs, this.eKey)) {
      this.registry.set('craftingInventory', this.craftingSystem.getInventorySnapshot())
      this.registry.set('legTier',           this.webbs.weaponSystem.getLegTier())
      this.registry.set('callerScene', 'HomeBaseScene')
      this.scene.launch('CraftingMenu')
    }

    if (this.contactCooldown > 0) this.contactCooldown -= delta

    // Pull HP back from Webbs (regen happens inside Webbs.update)
    this.health = this.webbs.hp

    // Left-exit → Ant Colony
    if (this.webbs.x < LEFT_TRIGGER) {
      this.transitioning = true
      ZoneTransitionSystem.transition(this, 'AntColonyScene', 'left', this.health)
    }

    this.syncRegistry()
  }

  // ── Drawing — background & atmosphere ─────────────────────────────────────

  private drawBackground(): void {
    const g = this.add.graphics().setDepth(0)

    // Deep blue-black base
    g.fillStyle(0x1a1a2e, 1)
    g.fillRect(0, 0, WORLD_W, WORLD_H)

    // Subtle vignette layers — darker at edges
    g.fillStyle(0x0d0d1a, 0.55)
    g.fillRect(0, 0, 350, WORLD_H)
    g.fillRect(WORLD_W - 350, 0, 350, WORLD_H)
    g.fillStyle(0x0d0d1a, 0.35)
    g.fillRect(0, 0, WORLD_W, 80)
    g.fillRect(0, WORLD_H - 80, WORLD_W, 80)

    // Faint starfield/debris dots on ceiling
    g.fillStyle(0x333355, 0.5)
    const rng = new Phaser.Math.RandomDataGenerator(['homebase-bg'])
    for (let i = 0; i < 120; i++) {
      const dx = rng.integerInRange(0, WORLD_W)
      const dy = rng.integerInRange(0, 160)
      g.fillCircle(dx, dy, rng.realInRange(0.5, 2))
    }
  }

  private drawFloor(): void {
    const g = this.add.graphics().setDepth(1)

    // Main floor slab — dark brown layered
    g.fillStyle(0x2a1a0a, 1)
    g.fillRect(0, FLOOR_Y, WORLD_W, WORLD_H - FLOOR_Y)

    // Floor highlight lip
    g.fillStyle(0x3d2810, 1)
    g.fillRect(0, FLOOR_Y, WORLD_W, 12)

    // Texture cracks
    g.lineStyle(1, 0x1a0e05, 0.7)
    const cracks = [180, 500, 830, 1140, 1450, 1760, 2080, 2350]
    for (const cx of cracks) {
      g.lineBetween(cx, FLOOR_Y, cx + 35, FLOOR_Y + 45)
      g.lineBetween(cx + 35, FLOOR_Y + 45, cx + 20, FLOOR_Y + 80)
    }

    // Mid-level ledge platforms (visual only — for depth)
    g.fillStyle(0x251508, 0.7)
    g.fillRect(300, 450, 180, 18)
    g.fillRect(700, 480, 220, 18)
    g.fillRect(1550, 430, 160, 18)
    g.fillRect(2100, 460, 200, 18)

    // Ceiling strip
    g.fillStyle(0x14100a, 1)
    g.fillRect(0, 0, WORLD_W, 30)
  }

  // ── Environmental details ─────────────────────────────────────────────────

  private drawTornWebs(): void {
    const g = this.add.graphics().setDepth(3)
    g.lineStyle(1, 0xffffff, 0.28)

    // Top-left corner cluster
    this.drawWebCluster(g, 0, 0, 180, 180)
    // Top-right corner cluster
    this.drawWebCluster(g, WORLD_W, 0, -180, 180)
    // Bottom-left corner cluster
    this.drawWebCluster(g, 0, FLOOR_Y, 150, -100)
    // Mid-scene hanging webs
    this.drawWebCluster(g, 960,  0, 100, 120)
    this.drawWebCluster(g, 1600, 0, -80, 110)
    this.drawWebCluster(g, 2200, 0, 90,  130)
  }

  private drawWebCluster(
    g: Phaser.GameObjects.Graphics,
    cx: number, cy: number,
    dx: number, dy: number,
  ): void {
    // 5-8 radiating strands from corner
    const strands = [
      [0,    0,    dx,       dy      ],
      [0,    0,    dx * 0.4, dy * 1.3],
      [0,    0,    dx * 1.2, dy * 0.4],
      [0,    0,    dx * 0.8, dy * 0.7],
      [0,    0,    dx * 0.2, dy * 0.9],
    ]
    for (const [x1, y1, x2, y2] of strands) {
      g.lineBetween(cx + x1, cy + y1, cx + x2, cy + y2)
    }
    // Cross threads
    g.lineBetween(cx + dx * 0.15, cy + dy * 0.1,  cx + dx * 0.85, cy + dy * 0.9)
    g.lineBetween(cx + dx * 0.05, cy + dy * 0.55, cx + dx * 0.95, cy + dy * 0.3)
    g.lineBetween(cx + dx * 0.3,  cy + dy * 0.05, cx + dx * 0.7,  cy + dy * 0.75)
  }

  private drawSilkHammocks(): void {
    const g = this.add.graphics().setDepth(2)
    g.lineStyle(1.5, 0xddddff, 0.22)

    // Each hammock: approximate quadratic curve with 12 line segments
    const hammocks: Array<[number, number, number, number, number]> = [
      [600,  180, 900,  180, 60],   // x1, y1, x2, y2, sag
      [1100, 160, 1380, 160, 50],
      [1800, 200, 2050, 200, 45],
      [2200, 170, 2450, 170, 55],
      [350,  250, 580,  250, 40],
    ]
    for (const [x1, y1, x2, y2, sag] of hammocks) {
      this.drawHammock(g, x1, y1, x2, y2, sag)
    }
  }

  private drawHammock(
    g: Phaser.GameObjects.Graphics,
    x1: number, y1: number,
    x2: number, y2: number,
    sag: number,
    steps = 12,
  ): void {
    const mx = (x1 + x2) / 2
    const my = Math.max(y1, y2) + sag  // control point below midpoint

    let px = x1, py = y1
    for (let i = 1; i <= steps; i++) {
      const t  = i / steps
      const t1 = 1 - t
      // Quadratic Bezier: B(t) = t1²·P0 + 2·t1·t·P1 + t²·P2
      const nx = t1 * t1 * x1 + 2 * t1 * t * mx + t * t * x2
      const ny = t1 * t1 * y1 + 2 * t1 * t * my + t * t * y2
      g.lineBetween(px, py, nx, ny)
      px = nx
      py = ny
    }

    // Anchor circles at both ends
    g.fillStyle(0xddddff, 0.35)
    g.fillCircle(x1, y1, 4)
    g.fillCircle(x2, y2, 4)
  }

  private drawHalfBuiltInventions(): void {
    const g = this.add.graphics().setDepth(3)

    // Cluster around Webbs' default spawn (~x=1000)
    // ── Gear 1
    this.drawGear(g, 1020, FLOOR_Y - 20, 14)
    // ── Gear 2 (smaller, interlocking)
    this.drawGear(g, 1048, FLOOR_Y - 8, 8)
    // ── Scattered springs (zigzag lines)
    g.lineStyle(2, 0x445566, 0.8)
    for (let i = 0; i < 5; i++) {
      g.lineBetween(940 + i * 6, FLOOR_Y - 18, 943 + i * 6, FLOOR_Y - 8)
    }
    // ── Circuit-like rectangle contraption
    g.lineStyle(1.5, 0x446644, 0.7)
    g.strokeRect(1080, FLOOR_Y - 38, 42, 28)
    g.lineBetween(1080, FLOOR_Y - 24, 1122, FLOOR_Y - 24)
    g.fillStyle(0x224422, 0.6)
    g.fillRect(1085, FLOOR_Y - 33, 8, 8)
    g.fillRect(1105, FLOOR_Y - 33, 8, 8)
    // ── Loose wire
    g.lineStyle(1, 0x334433, 0.6)
    g.lineBetween(1122, FLOOR_Y - 30, 1145, FLOOR_Y - 18)
    g.lineBetween(1145, FLOOR_Y - 18, 1138, FLOOR_Y - 10)

    // Second cluster near x=1500
    this.drawGear(g, 1490, FLOOR_Y - 18, 11)
    g.lineStyle(1.5, 0x445566, 0.7)
    g.strokeRect(1510, FLOOR_Y - 32, 30, 20)
    g.lineBetween(1510, FLOOR_Y - 22, 1540, FLOOR_Y - 22)
  }

  private drawGear(
    g: Phaser.GameObjects.Graphics,
    x: number, y: number, r: number,
  ): void {
    g.fillStyle(0x3d4455, 0.9)
    g.fillCircle(x, y, r)
    g.lineStyle(1.5, 0x5566aa, 0.8)
    g.strokeCircle(x, y, r)
    // Teeth
    const teeth = 8
    g.lineStyle(2, 0x5566aa, 0.8)
    for (let i = 0; i < teeth; i++) {
      const angle = (i / teeth) * Math.PI * 2
      g.lineBetween(
        x + Math.cos(angle) * r,
        y + Math.sin(angle) * r,
        x + Math.cos(angle) * (r + 5),
        y + Math.sin(angle) * (r + 5),
      )
    }
    // Hub
    g.fillStyle(0x5566aa, 0.6)
    g.fillCircle(x, y, r * 0.35)
  }

  private drawFoodStores(): void {
    const g = this.add.graphics().setDepth(3)

    // Two clusters of wrapped food items
    const clusters = [
      { cx: 1300, cy: FLOOR_Y - 18, count: 7 },
      { cx: 2050, cy: FLOOR_Y - 14, count: 5 },
    ]
    for (const { cx, cy, count } of clusters) {
      for (let i = 0; i < count; i++) {
        const angle = (i / count) * Math.PI * 2
        const rx = cx + Math.cos(angle) * 14
        const ry = cy + Math.sin(angle) * 8
        g.fillStyle(0x4a3020, 0.85)
        g.fillCircle(rx, ry, 7)
        g.lineStyle(1, 0x6b4830, 0.7)
        g.strokeCircle(rx, ry, 7)
        // Silk wrap marks
        g.lineStyle(1, 0x8899aa, 0.35)
        g.lineBetween(rx - 4, ry - 3, rx + 4, ry + 3)
      }
      // Center item
      g.fillStyle(0x5a3828, 0.9)
      g.fillCircle(cx, cy, 9)
      g.lineStyle(1, 0x7b5840, 0.7)
      g.strokeCircle(cx, cy, 9)
    }
  }

  private drawPersonalItems(): void {
    const g = this.add.graphics().setDepth(3)

    // Knocked-over jar/vessel
    g.fillStyle(0x223344, 0.7)
    g.fillEllipse(760, FLOOR_Y - 12, 24, 30)
    g.lineStyle(1.5, 0x335566, 0.8)
    g.strokeEllipse(760, FLOOR_Y - 12, 24, 30)
    // Spilled liquid
    g.fillStyle(0x113322, 0.4)
    g.fillEllipse(768, FLOOR_Y + 2, 40, 10)

    // Book / journal — flat on floor
    g.fillStyle(0x3a2515, 0.85)
    g.fillRect(880, FLOOR_Y - 6, 28, 18)
    g.lineStyle(1, 0x5a3a25, 0.7)
    g.strokeRect(880, FLOOR_Y - 6, 28, 18)
    g.lineStyle(0.5, 0x7a5a45, 0.5)
    g.lineBetween(884, FLOOR_Y - 2, 904, FLOOR_Y - 2)
    g.lineBetween(884, FLOOR_Y + 3, 904, FLOOR_Y + 3)
    g.lineBetween(884, FLOOR_Y + 8, 900, FLOOR_Y + 8)

    // Small stool / chair tipped over
    g.fillStyle(0x2e1e10, 0.8)
    g.fillRect(2280, FLOOR_Y - 22, 30, 6)
    g.lineStyle(2, 0x4a2e18, 0.8)
    g.lineBetween(2283, FLOOR_Y - 16, 2275, FLOOR_Y)
    g.lineBetween(2305, FLOOR_Y - 16, 2313, FLOOR_Y)

    // Scattered silk spool
    g.fillStyle(0x445566, 0.7)
    g.fillCircle(2350, FLOOR_Y - 8, 8)
    g.lineStyle(1, 0x6677aa, 0.6)
    g.strokeCircle(2350, FLOOR_Y - 8, 8)
    g.lineBetween(2354, FLOOR_Y - 4, 2378, FLOOR_Y - 14)  // trailing silk
    g.lineBetween(2378, FLOOR_Y - 14, 2395, FLOOR_Y - 8)
  }

  private drawExits(): void {
    // ── LEFT EXIT — open, leads to Ant Colony ────────────────────────────
    this.drawOpenExit()

    // ── Four blocked exits ────────────────────────────────────────────────
    const blockedExits = [
      { x: WORLD_W - 30,       y: WORLD_H / 2,       label: '???' },  // right wall
      { x: 200,                y: 60,                 label: '???' },  // top-left ceiling
      { x: WORLD_W / 2 + 300,  y: 40,                 label: '???' },  // top-center-right
      { x: WORLD_W - 200,      y: 60,                 label: '???' },  // top-right ceiling
    ]
    for (const exit of blockedExits) {
      this.drawBlockedExit(exit.x, exit.y, exit.label)
    }
  }

  private drawOpenExit(): void {
    const g = this.add.graphics().setDepth(5)
    const midY = WORLD_H / 2

    // Portal frame — dark archway
    g.fillStyle(0x0d0d1a, 1)
    g.fillRect(0, midY - 70, 90, 140)
    g.lineStyle(2, 0x334466, 0.8)
    g.strokeRect(0, midY - 70, 90, 140)

    // Glowing web-bridge strands
    const webG = this.add.graphics().setDepth(6)
    webG.lineStyle(1.5, 0x99bbff, 0.85)
    for (let i = -3; i <= 3; i++) {
      webG.lineBetween(0, midY + i * 16, 120, midY + i * 16)
    }
    // Vertical cross strands
    webG.lineStyle(1, 0x99bbff, 0.5)
    for (let x = 20; x < 120; x += 20) {
      webG.lineBetween(x, midY - 50, x, midY + 50)
    }

    // Additive glow blend for portal feel
    webG.setBlendMode(Phaser.BlendModes.ADD)
    this.tweens.add({
      targets:  webG,
      alpha:    { from: 0.45, to: 1 },
      duration: 1200,
      yoyo:     true,
      repeat:   -1,
      ease:     'Sine.easeInOut',
    })

    // "ANT COLONY →" label above the portal
    this.add.text(55, midY - 90, 'ANT COLONY →', {
      fontFamily: 'monospace',
      fontSize:   '11px',
      color:      '#99bbff',
    }).setOrigin(0.5).setDepth(6)
  }

  private drawBlockedExit(cx: number, cy: number, label: string): void {
    const g = this.add.graphics().setDepth(4)

    // Debris pile — stacked irregular rectangles
    const pile = [
      { w: 60, h: 18, dy:  0  },
      { w: 48, h: 16, dy: -17 },
      { w: 36, h: 14, dy: -30 },
      { w: 28, h: 12, dy: -42 },
    ]
    for (const { w, h, dy } of pile) {
      g.fillStyle(0x2a1a0e, 0.95)
      g.fillRect(cx - w / 2, cy + dy, w, h)
      g.lineStyle(1.5, 0x3d2810, 0.8)
      g.strokeRect(cx - w / 2, cy + dy, w, h)
    }

    // Faded ??? label
    this.add.text(cx, cy - 60, label, {
      fontFamily: 'monospace',
      fontSize:   '14px',
      color:      '#334455',
    }).setOrigin(0.5).setDepth(4)
  }

  private spawnDustParticles(): void {
    // Create a tiny dust dot texture
    if (!this.textures.exists('home-dust')) {
      const g = this.add.graphics()
      g.fillStyle(0xaaaacc, 1)
      g.fillCircle(2, 2, 2)
      g.generateTexture('home-dust', 4, 4)
      g.destroy()
    }

    // Particle emitter spanning the full world width
    this.add.particles(WORLD_W / 2, WORLD_H / 2, 'home-dust', {
      x:        { min: -WORLD_W / 2, max: WORLD_W / 2 },
      y:        { min: -WORLD_H / 2, max: WORLD_H / 2 - 60 },
      speedY:   { min: 8, max: 28 },
      speedX:   { min: -6, max: 6 },
      scale:    { start: 1.0, end: 0 },
      alpha:    { start: 0.45, end: 0 },
      lifespan: { min: 4000, max: 8000 },
      frequency: 160,
      quantity:  1,
    }).setDepth(2)
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
    for (const obj of this.weaponPickupGroup.getChildren()) {
      const wp = obj as unknown as WeaponPickup
      if (!wp.active) continue
      if (Phaser.Math.Distance.Between(this.webbs.x, this.webbs.y, wp.x, wp.y) < PICKUP_REACH) {
        this.collectWeaponPickup(wp)
      }
    }
  }

  private collectMaterialPickup(p: Pickup): void {
    if (p.pickupId >= 0) {
      const arr = (this.registry.get('pickupsCollected_HomeBaseScene') as number[] | undefined) ?? []
      if (!arr.includes(p.pickupId)) arr.push(p.pickupId)
      this.registry.set('pickupsCollected_HomeBaseScene', arr)
    }
    p.collect()
    this.registry.set('craftingInventory', this.craftingSystem.getInventorySnapshot())
  }

  private collectWeaponPickup(wp: WeaponPickup): void {
    if (wp.collect()) {
      const arr = (this.registry.get('weaponPickupsCollected') as string[] | undefined) ?? []
      if (!arr.includes(wp.pickupId)) arr.push(wp.pickupId)
      this.registry.set('weaponPickupsCollected', arr)
    }
  }

  private syncRegistry(): void {
    this.registry.set('zoneName',      'HOME BASE')
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
