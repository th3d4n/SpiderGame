import Phaser from 'phaser'
import Webbs from '../entities/Webbs'
import Workbench from '../entities/Workbench'
import Pickup from '../entities/Pickup'
import CentipedeAmbusher from '../entities/CentipedeAmbusher'
import BeetleTank from '../entities/BeetleTank'
import { CraftingSystem } from '../systems/CraftingSystem'
import { WeaponType } from '../systems/WeaponSystem'
import { WeaponUseSystem } from '../systems/WeaponUseSystem'
import { ZoneTransitionSystem } from '../systems/ZoneTransitionSystem'

const WORLD_W = 2560
const WORLD_H = 720
const FLOOR_Y = WORLD_H - 65

// Zone-exit triggers
const LEFT_TRIGGER  = 100
const RIGHT_TRIGGER = 2420

// Contact damage cooldown
const CONTACT_COOLDOWN = 750
// Contact range — enemy body radius + Webbs radius
const CONTACT_RADIUS = 28 + 16

export default class AntColonyScene extends Phaser.Scene {
  private webbs!:            Webbs
  private workbench!:        Workbench
  private craftingSystem!:   CraftingSystem
  private pickupGroup!:      Phaser.Physics.Arcade.StaticGroup
  private weaponUseSystem!:  WeaponUseSystem
  private eKey!:             Phaser.Input.Keyboard.Key
  private enemies:           (CentipedeAmbusher | BeetleTank)[] = []
  private transitioning      = false

  // Player stats — synced to registry each frame
  private health         = 5
  private healthMax      = 5
  private stamina        = 100
  private energy         = 100
  private contactCooldown = 0

  constructor() {
    super({ key: 'AntColonyScene' })
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  create() {
    this.transitioning  = false
    this.enemies        = []
    this.contactCooldown = 0
    this.physics.world.setBounds(0, 0, WORLD_W, WORLD_H)

    const savedHp = this.registry.get('health') as number | undefined
    if (savedHp !== undefined) this.health = savedHp

    this.drawTunnel()
    this.drawFungus()
    this.drawExitMarkers()

    // Workbench
    this.workbench = new Workbench(this, 400, FLOOR_Y - 40)

    // Crafting system
    this.craftingSystem = new CraftingSystem()
    this.craftingSystem.addMaterial('SilkThread',   4)
    this.craftingSystem.addMaterial('ChitinShard',  6)
    this.craftingSystem.addMaterial('BoneFragment', 3)
    this.craftingSystem.addMaterial('VenomGland',   1)

    // Pickup group
    this.pickupGroup = this.physics.add.staticGroup()

    // Webbs spawns at the correct edge based on entry direction
    const spawnX = ZoneTransitionSystem.spawnX(this, WORLD_W, WORLD_W - 200)
    this.webbs = new Webbs(this, spawnX, FLOOR_Y - 60)
    this.webbs.weaponSystem.setLegTier(1)

    // Overlap: collect pickups on contact
    this.physics.add.overlap(
      this.webbs,
      this.pickupGroup,
      (_webbs, pickup) => { (pickup as unknown as Pickup).collect() },
    )

    // Weapon use system
    this.weaponUseSystem = new WeaponUseSystem()
    ;[1, 2, 3, 4, 5, 6, 7, 8].forEach(n => {
      this.input.keyboard!.on(`keydown-${n}`, () => {
        this.weaponUseSystem.activateWeapon(n, this.webbs, this)
      })
    })

    // Enemies
    this.enemies.push(new CentipedeAmbusher(this, 650,  FLOOR_Y - 30, this.webbs))
    this.enemies.push(new CentipedeAmbusher(this, 1350, FLOOR_Y - 30, this.webbs))
    this.enemies.push(new BeetleTank(this, 1850, FLOOR_Y - 30, this.webbs))

    // Input
    this.eKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.E)

    // I key — open equip screen
    this.input.keyboard!.on('keydown-I', () => {
      this.scene.launch('EquipScreen')
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
    ZoneTransitionSystem.announceZone(this, 'ZONE 1 — ANT COLONY')
  }

  update(time: number, delta: number) {
    if (this.transitioning) return

    const pendingEquip = this.registry.get('pendingEquip') as WeaponType | null ?? null
    if (pendingEquip !== null) {
      this.registry.set('pendingEquip', null)
      this.equipFirstFreeSlot(pendingEquip)
    }

    this.webbs.update(time, delta)

    for (const enemy of this.enemies) {
      enemy.update(time, delta)
    }

    if (this.workbench.update(this.webbs, this.eKey)) {
      this.registry.set('craftingInventory', this.craftingSystem.getInventorySnapshot())
      this.registry.set('legTier',           this.webbs.weaponSystem.getLegTier())
      this.scene.launch('CraftingMenu')
    }

    if (this.contactCooldown > 0) {
      this.contactCooldown -= delta
    } else {
      this.checkEnemyContact()
    }

    // Zone transitions
    if (this.webbs.x < LEFT_TRIGGER) {
      this.transitioning = true
      ZoneTransitionSystem.transition(this, 'HomeBaseScene', 'left', this.health)
    } else if (this.webbs.x > RIGHT_TRIGGER) {
      this.transitioning = true
      ZoneTransitionSystem.transition(this, 'BossRollerScene', 'right', this.health)
    }

    this.syncRegistry()
  }

  // ── Tunnel environment ────────────────────────────────────────────────────

  private drawTunnel(): void {
    const g = this.add.graphics().setDepth(0)

    // Deep black-brown background
    g.fillStyle(0x0e0a06, 1)
    g.fillRect(0, 0, WORLD_W, WORLD_H)

    // Ceiling — rough irregular edge
    g.fillStyle(0x1e140a, 1)
    g.fillRect(0, 0, WORLD_W, 55)

    // Floor slab
    g.fillStyle(0x1a1006, 1)
    g.fillRect(0, FLOOR_Y, WORLD_W, WORLD_H - FLOOR_Y)
    g.fillStyle(0x281808, 1)
    g.fillRect(0, FLOOR_Y, WORLD_W, 10)

    // Rough tunnel wall shapes — left and right side pillars
    g.fillStyle(0x160e06, 1)
    const pillars = [0, 380, 760, 1140, 1520, 1900, 2280]
    for (const px of pillars) {
      const pw = Phaser.Math.Between(40, 70)
      // Top pillar (from ceiling)
      const ph = Phaser.Math.Between(80, 160)
      g.fillRect(px, 0, pw, ph)
      // Matching floor nub
      const fh = Phaser.Math.Between(30, 65)
      g.fillRect(px, FLOOR_Y - fh, pw, fh)
    }

    // Wall texture — irregular rock face patches
    const rng = new Phaser.Math.RandomDataGenerator(['ant-bg'])
    g.fillStyle(0x1a1008, 0.6)
    for (let i = 0; i < 60; i++) {
      const rx = rng.integerInRange(0, WORLD_W)
      const ry = rng.integerInRange(60, FLOOR_Y - 20)
      const rw = rng.integerInRange(20, 80)
      const rh = rng.integerInRange(10, 30)
      g.fillRect(rx, ry, rw, rh)
    }

    // Stalactites
    g.fillStyle(0x241810, 1)
    const stals = [80, 230, 420, 600, 790, 980, 1170, 1360, 1550, 1740, 1930, 2120, 2310, 2480]
    for (const sx of stals) {
      const sh = Phaser.Math.Between(40, 120)
      const sw = Phaser.Math.Between(12, 28)
      g.fillTriangle(sx - sw / 2, 0, sx + sw / 2, 0, sx, sh)
    }

    // Stalagmites on floor
    g.fillStyle(0x1e1008, 1)
    const stags = [160, 340, 530, 720, 910, 1100, 1290, 1480, 1670, 1860, 2050, 2240, 2430]
    for (const sx of stags) {
      const sh = Phaser.Math.Between(25, 70)
      const sw = Phaser.Math.Between(10, 22)
      g.fillTriangle(sx - sw / 2, FLOOR_Y, sx + sw / 2, FLOOR_Y, sx, FLOOR_Y - sh)
    }
  }

  private drawFungus(): void {
    const g = this.add.graphics().setDepth(2)

    // Fungus clusters — small glowing green-white circles with glow rings
    const clusters: Array<{ x: number; y: number; count: number }> = [
      { x: 280,  y: FLOOR_Y - 20, count: 4 },
      { x: 820,  y: FLOOR_Y - 20, count: 5 },
      { x: 1200, y: FLOOR_Y - 22, count: 3 },
      { x: 1640, y: FLOOR_Y - 18, count: 6 },
      { x: 2080, y: FLOOR_Y - 20, count: 4 },
      { x: 2380, y: FLOOR_Y - 22, count: 3 },
      // Ceiling-hanging fungus
      { x: 500,  y: 80,  count: 3 },
      { x: 1020, y: 90,  count: 4 },
      { x: 1700, y: 85,  count: 3 },
      { x: 2200, y: 78,  count: 2 },
    ]

    for (const { x, y, count } of clusters) {
      for (let i = 0; i < count; i++) {
        const offX = (i - count / 2) * 14 + Phaser.Math.Between(-4, 4)
        const offY = Phaser.Math.Between(-6, 6)
        const r    = Phaser.Math.Between(5, 10)
        const fx   = x + offX
        const fy   = y + offY

        // Outer glow (large, dim)
        g.fillStyle(0x44ff88, 0.06)
        g.fillCircle(fx, fy, r * 3.5)

        // Mid glow
        g.fillStyle(0x66ffaa, 0.15)
        g.fillCircle(fx, fy, r * 1.8)

        // Core
        g.fillStyle(0x99ffcc, 0.8)
        g.fillCircle(fx, fy, r)

        // Bright centre spot
        g.fillStyle(0xeeffee, 0.9)
        g.fillCircle(fx - r * 0.2, fy - r * 0.3, r * 0.35)
      }
    }
  }

  private drawExitMarkers(): void {
    const g = this.add.graphics().setDepth(3)
    const midY = WORLD_H / 2

    // LEFT EXIT — back to Home Base
    g.fillStyle(0x0e0a06, 1)
    g.fillRect(0, midY - 60, 80, 120)
    g.lineStyle(1.5, 0x444466, 0.6)
    g.strokeRect(0, midY - 60, 80, 120)
    this.add.text(45, midY - 78, '← HOME', {
      fontFamily: 'monospace', fontSize: '10px', color: '#556677',
    }).setOrigin(0.5).setDepth(3)

    // RIGHT EXIT — leads to Roller Boss
    g.fillStyle(0x1a0a06, 1)
    g.fillRect(WORLD_W - 80, midY - 60, 80, 120)
    g.lineStyle(1.5, 0x663333, 0.7)
    g.strokeRect(WORLD_W - 80, midY - 60, 80, 120)

    // Danger glow on boss portal
    const bossPortal = this.add.graphics().setDepth(4)
    bossPortal.lineStyle(2, 0xff4422, 0.6)
    bossPortal.strokeRect(WORLD_W - 80, midY - 60, 80, 120)

    this.tweens.add({
      targets:  bossPortal,
      alpha:    { from: 0.3, to: 1 },
      duration: 900,
      yoyo:     true,
      repeat:   -1,
      ease:     'Sine.easeInOut',
    })

    this.add.text(WORLD_W - 40, midY - 78, 'BOSS →', {
      fontFamily: 'monospace', fontSize: '10px', color: '#cc3322',
    }).setOrigin(0.5).setDepth(4)
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private checkEnemyContact(): void {
    for (const enemy of this.enemies) {
      if (enemy.isDead()) continue
      const dist = Phaser.Math.Distance.Between(
        this.webbs.x, this.webbs.y,
        enemy.x,      enemy.y,
      )
      if (dist < CONTACT_RADIUS) {
        this.health = Math.max(0, this.health - enemy.damage)
        this.contactCooldown = CONTACT_COOLDOWN

        const angle = Phaser.Math.Angle.Between(
          enemy.x, enemy.y,
          this.webbs.x, this.webbs.y,
        )
        this.webbs.pb.setVelocity(Math.cos(angle) * 300, Math.sin(angle) * 300)
        break
      }
    }
  }

  private equipFirstFreeSlot(weaponType: WeaponType): void {
    const sys   = this.webbs.weaponSystem
    const count = sys.getUnlockedSlotCount()
    for (let i = 0; i < count; i++) {
      if (sys.getSlot(i) === WeaponType.Empty) {
        sys.equip(i, weaponType)
        this.webbs.refreshLegColors()
        return
      }
    }
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
  }
}
