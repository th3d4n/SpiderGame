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
import { ZoneTransitionSystem } from '../systems/ZoneTransitionSystem'

// Bigger than before — sprawling tunnel network with rooms and dead ends.
const WORLD_W = 6000
const WORLD_H = 3000

// Zone-exit triggers
// HOME BASE portal sits at the right edge (next to spawn) so the player starts here.
// BOSS tunnel sits at the far top-left — the furthest reachable corner.
const HOME_PORTAL_X  = WORLD_W - 110
const HOME_PORTAL_Y  = WORLD_H - 220
const BOSS_PORTAL_X  = 180
const BOSS_PORTAL_Y  = 220

// Contact damage cooldown
const CONTACT_COOLDOWN = 750
const CONTACT_RADIUS   = 28 + 16

// Fog of war reveal radius around the player
const FOG_REVEAL_R = 220

// A wall rectangle expressed in world coordinates (top-left + size)
interface Wall { x: number; y: number; w: number; h: number }

export default class AntColonyScene extends Phaser.Scene {
  private webbs!:            Webbs
  private workbench!:        Workbench
  private craftingSystem!:   CraftingSystem
  private pickupGroup!:      Phaser.Physics.Arcade.StaticGroup
  private weaponUseSystem!:  WeaponUseSystem
  private weaponKeys:        Phaser.Input.Keyboard.Key[] = []
  private eKey!:             Phaser.Input.Keyboard.Key
  private enemies:           (CentipedeAmbusher | BeetleTank)[] = []
  private walls!:            Phaser.Physics.Arcade.StaticGroup
  private fog!:              Phaser.GameObjects.RenderTexture
  private fogEraser!:        Phaser.GameObjects.Graphics
  private transitioning      = false

  // Player stats — synced to registry each frame
  private health         = PLAYER_MAX_HP
  private healthMax      = PLAYER_MAX_HP
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

    this.drawBackground()
    const wallDefs = this.buildMazeWalls()
    this.drawWalls(wallDefs)
    this.drawPortals()

    // Workbench in a side chamber near the start
    this.workbench = new Workbench(this, WORLD_W - 600, WORLD_H - 230)

    // Crafting system — share the player's inventory via registry across zones
    this.craftingSystem = new CraftingSystem()
    const savedInv = this.registry.get('craftingInventory') as Record<string, number> | null
    if (savedInv) {
      this.craftingSystem.restoreFromSnapshot(savedInv)
    }

    // Pickup group
    this.pickupGroup = this.physics.add.staticGroup()

    // Spawn Webbs next to the home-base portal on the right side
    // ZoneTransitionSystem normally chooses spawnX based on entry direction; since both
    // exits live on the same side now we hard-pin the spawn near the right portal.
    this.webbs = new Webbs(this, HOME_PORTAL_X - 90, HOME_PORTAL_Y)
    this.webbs.resetHp(this.health)

    // Walls collide with Webbs
    this.physics.add.collider(this.webbs, this.walls)

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
    }
    this.webbs.refreshLegColors()

    // Expose WeaponSystem and weapon inventory to overlay scenes
    this.registry.set('weaponSystemRef', this.webbs.weaponSystem)
    this.registry.set('weaponInventory', (this.registry.get('weaponInventory') as WeaponType[] | undefined) ?? [])

    // Refresh leg colors when EquipScreen closes and this scene resumes
    this.events.on('resume', () => { this.webbs.refreshLegColors() })

    // Overlap: collect pickups on contact, then sync inventory to registry
    this.physics.add.overlap(
      this.webbs,
      this.pickupGroup,
      (_webbs, pickup) => {
        (pickup as unknown as Pickup).collect()
        this.registry.set('craftingInventory', this.craftingSystem.getInventorySnapshot())
      },
    )

    // Drop loot when enemies die
    this.events.on('enemyDied', this.spawnLootAt, this)
    this.events.once('shutdown', () => this.events.off('enemyDied', this.spawnLootAt, this))

    // Weapon use system — keys 1-8 registered as tracked Key objects (checked
    // via JustDown in update) so they only fire when this scene is active.
    this.weaponUseSystem = new WeaponUseSystem()
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

    // Spawn enemies in different maze sectors — most far from spawn, on the way to the boss
    this.spawnEnemies()
    this.weaponUseSystem.setEnemies(this.enemies as unknown as Enemy[])
    this.weaponUseSystem.setWorldBounds(WORLD_W, WORLD_H)

    // Input
    this.eKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.E)

    // I key — open equip screen
    this.input.keyboard!.on('keydown-I', () => {
      if (!this.scene.isActive('EquipScreen')) {
        this.registry.set('equipCallerScene', 'AntColonyScene')
        this.scene.launch('EquipScreen')
      }
    })

    // Camera
    this.cameras.main.setBounds(0, 0, WORLD_W, WORLD_H)
    this.cameras.main.startFollow(this.webbs, true, 0.1, 0.1)
    this.cameras.main.setZoom(1.0)

    // Fog of war — covers entire world, erased around the player as they explore
    this.fog = this.add.renderTexture(0, 0, WORLD_W, WORLD_H)
      .setOrigin(0)
      .setDepth(50)
    this.fog.fill(0x000000, 0.92)

    // Eraser brush — radial gradient fades from solid to transparent so reveals blend
    this.fogEraser = this.make.graphics({}, false)
    for (let r = FOG_REVEAL_R; r > 0; r -= 8) {
      const alpha = 1 - (r / FOG_REVEAL_R)
      this.fogEraser.fillStyle(0xffffff, alpha)
      this.fogEraser.fillCircle(FOG_REVEAL_R, FOG_REVEAL_R, r)
    }
    this.fogEraser.generateTexture('fog-eraser', FOG_REVEAL_R * 2, FOG_REVEAL_R * 2)
    this.fogEraser.destroy()

    // HUD
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

    // Weapon keys 1-8 → slots 0-7
    for (let i = 0; i < this.weaponKeys.length; i++) {
      if (Phaser.Input.Keyboard.JustDown(this.weaponKeys[i])) {
        this.weaponUseSystem.activateWeapon(i, this.webbs, this)
      }
    }

    for (const enemy of this.enemies) {
      enemy.update(time, delta)
    }

    // Workbench interaction
    if (!this.scene.isActive('CraftingMenu') && this.workbench.update(this.webbs, this.eKey)) {
      this.registry.set('craftingInventory', this.craftingSystem.getInventorySnapshot())
      this.registry.set('legTier',           this.webbs.weaponSystem.getLegTier())
      this.registry.set('callerScene', 'AntColonyScene')
      this.scene.launch('CraftingMenu')
    }

    if (this.contactCooldown > 0) this.contactCooldown -= delta
    else                          this.checkEnemyContact()

    // Pull HP back from Webbs (regen happens inside Webbs.update)
    this.health = this.webbs.hp

    // Fog of war — erase a circle around the player every frame
    this.fog.erase(
      'fog-eraser',
      this.webbs.x - FOG_REVEAL_R,
      this.webbs.y - FOG_REVEAL_R,
    )

    // Zone transitions — proximity triggers, not edge triggers (the world is too big for edges)
    const distHome = Phaser.Math.Distance.Between(this.webbs.x, this.webbs.y, HOME_PORTAL_X, HOME_PORTAL_Y)
    const distBoss = Phaser.Math.Distance.Between(this.webbs.x, this.webbs.y, BOSS_PORTAL_X, BOSS_PORTAL_Y)
    if (distHome < 60) {
      this.transitioning = true
      ZoneTransitionSystem.transition(this, 'HomeBaseScene', 'right', this.health)
    } else if (distBoss < 60) {
      this.transitioning = true
      ZoneTransitionSystem.transition(this, 'BossRollerScene', 'left', this.health)
    }

    this.syncRegistry()
  }

  // ── Maze layout ───────────────────────────────────────────────────────────

  private buildMazeWalls(): Wall[] {
    // The maze is a rough grid of corridors carved between solid wall blocks.
    // Each wall is a rectangle in world coords. Walls are stored both for
    // physics (StaticGroup) and for drawing.
    const walls: Wall[] = []

    // Outer borders
    const T = 50  // wall thickness
    walls.push({ x: 0, y: 0, w: WORLD_W, h: T })                  // top
    walls.push({ x: 0, y: WORLD_H - T, w: WORLD_W, h: T })        // bottom
    walls.push({ x: 0, y: 0, w: T, h: WORLD_H })                  // left
    walls.push({ x: WORLD_W - T, y: 0, w: T, h: WORLD_H })        // right

    // Vertical dividers carving columns. Each has gaps at varying y so the player
    // has to weave between them to reach the boss tunnel.
    const verticalDividers = [
      { x: 900,  gapTop: 360, gapH: 220 },                 // col 1
      { x: 1700, gapTop: 1800, gapH: 260 },                // col 2
      { x: 2500, gapTop: 800,  gapH: 220 },                // col 3
      { x: 3300, gapTop: 2200, gapH: 260 },                // col 4
      { x: 4100, gapTop: 1100, gapH: 220 },                // col 5
      { x: 4900, gapTop: 2300, gapH: 240 },                // col 6
    ]
    for (const d of verticalDividers) {
      walls.push({ x: d.x, y: T, w: 60, h: d.gapTop - T })
      walls.push({ x: d.x, y: d.gapTop + d.gapH, w: 60, h: WORLD_H - T - d.gapTop - d.gapH })
    }

    // Horizontal cross-walls inside the wide columns, creating chambers
    const horizontalDividers = [
      { y: 900,  x1: 60,   x2: 880 },
      { y: 1500, x1: 960,  x2: 1700 },
      { y: 600,  x1: 1760, x2: 2440 },
      { y: 1900, x1: 2560, x2: 3240 },
      { y: 1200, x1: 3360, x2: 4040 },
      { y: 2200, x1: 4160, x2: 4840 },
      { y: 900,  x1: 4960, x2: 5940 },
      { y: 2100, x1: 4960, x2: 5500 },
    ]
    for (const h of horizontalDividers) {
      walls.push({ x: h.x1, y: h.y, w: h.x2 - h.x1, h: 50 })
    }

    return walls
  }

  private drawWalls(wallDefs: Wall[]): void {
    this.walls = this.physics.add.staticGroup()
    const g = this.add.graphics().setDepth(2)

    // Dark stone walls
    for (const w of wallDefs) {
      g.fillStyle(0x1a1006, 1)
      g.fillRect(w.x, w.y, w.w, w.h)
      g.lineStyle(2, 0x3a2418, 1)
      g.strokeRect(w.x, w.y, w.w, w.h)

      // Physics body
      const body = this.add.rectangle(w.x + w.w / 2, w.y + w.h / 2, w.w, w.h, 0x000000, 0)
      this.physics.add.existing(body, true)
      this.walls.add(body)
    }
  }

  private drawBackground(): void {
    const g = this.add.graphics().setDepth(0)

    // Dirt-brown base
    g.fillStyle(0x0e0a06, 1)
    g.fillRect(0, 0, WORLD_W, WORLD_H)

    // Texture patches — chunky pixel mottling to fake rock walls
    const rng = new Phaser.Math.RandomDataGenerator(['ant-colony-bg-v2'])
    g.fillStyle(0x1c1208, 0.5)
    for (let i = 0; i < 400; i++) {
      const rx = rng.integerInRange(0, WORLD_W)
      const ry = rng.integerInRange(0, WORLD_H)
      const rw = rng.integerInRange(40, 140)
      const rh = rng.integerInRange(20, 60)
      g.fillRect(rx, ry, rw, rh)
    }

    // Random glowing fungus clusters scattered across the maze
    for (let i = 0; i < 60; i++) {
      const fx = rng.integerInRange(120, WORLD_W - 120)
      const fy = rng.integerInRange(120, WORLD_H - 120)
      const r  = rng.integerInRange(4, 8)
      g.fillStyle(0x44ff88, 0.06); g.fillCircle(fx, fy, r * 3.5)
      g.fillStyle(0x66ffaa, 0.12); g.fillCircle(fx, fy, r * 1.8)
      g.fillStyle(0x99ffcc, 0.7);  g.fillCircle(fx, fy, r)
    }
  }

  private drawPortals(): void {
    // Home portal — top of right column, blue glow
    const home = this.add.graphics().setDepth(3)
    home.fillStyle(0x0d0d1a, 1)
    home.fillRect(HOME_PORTAL_X - 40, HOME_PORTAL_Y - 70, 80, 140)
    home.lineStyle(2, 0x334466, 0.8)
    home.strokeRect(HOME_PORTAL_X - 40, HOME_PORTAL_Y - 70, 80, 140)

    const homeGlow = this.add.graphics().setDepth(4)
    homeGlow.lineStyle(2, 0x99bbff, 0.8)
    homeGlow.strokeRect(HOME_PORTAL_X - 40, HOME_PORTAL_Y - 70, 80, 140)
    this.tweens.add({
      targets:  homeGlow,
      alpha:    { from: 0.4, to: 1 },
      duration: 1100,
      yoyo:     true,
      repeat:   -1,
      ease:     'Sine.easeInOut',
    })
    this.add.text(HOME_PORTAL_X, HOME_PORTAL_Y - 90, '← HOME', {
      fontFamily: 'monospace', fontSize: '12px', color: '#99bbff',
    }).setOrigin(0.5).setDepth(4)

    // Boss portal — far corner, red glow
    const boss = this.add.graphics().setDepth(3)
    boss.fillStyle(0x1a0a06, 1)
    boss.fillRect(BOSS_PORTAL_X - 40, BOSS_PORTAL_Y - 70, 80, 140)
    boss.lineStyle(2, 0x663333, 0.7)
    boss.strokeRect(BOSS_PORTAL_X - 40, BOSS_PORTAL_Y - 70, 80, 140)

    const bossGlow = this.add.graphics().setDepth(4)
    bossGlow.lineStyle(2, 0xff4422, 0.6)
    bossGlow.strokeRect(BOSS_PORTAL_X - 40, BOSS_PORTAL_Y - 70, 80, 140)
    this.tweens.add({
      targets:  bossGlow,
      alpha:    { from: 0.3, to: 1 },
      duration: 900,
      yoyo:     true,
      repeat:   -1,
      ease:     'Sine.easeInOut',
    })
    this.add.text(BOSS_PORTAL_X, BOSS_PORTAL_Y - 90, 'BOSS', {
      fontFamily: 'monospace', fontSize: '12px', color: '#cc3322',
    }).setOrigin(0.5).setDepth(4)
  }

  private spawnEnemies(): void {
    // Spread enemies across the maze — denser as the player approaches the boss
    const placements = [
      // Near spawn (right side) — light intro
      { kind: 'centipede', x: 5400, y: 1700 },
      { kind: 'centipede', x: 5100, y: 600  },
      // Middle band
      { kind: 'beetle',    x: 4400, y: 2400 },
      { kind: 'centipede', x: 4400, y: 1500 },
      { kind: 'centipede', x: 3700, y: 700  },
      { kind: 'beetle',    x: 3700, y: 2400 },
      { kind: 'centipede', x: 2900, y: 1400 },
      { kind: 'centipede', x: 2900, y: 2300 },
      // Outer band — closer to the boss
      { kind: 'beetle',    x: 2100, y: 1100 },
      { kind: 'centipede', x: 2100, y: 2100 },
      { kind: 'beetle',    x: 1300, y: 700  },
      { kind: 'centipede', x: 1300, y: 2200 },
      { kind: 'centipede', x: 600,  y: 1600 },
      { kind: 'beetle',    x: 600,  y: 2200 },
    ]
    for (const p of placements) {
      if (p.kind === 'centipede') {
        this.enemies.push(new CentipedeAmbusher(this, p.x, p.y, this.webbs))
      } else {
        this.enemies.push(new BeetleTank(this, p.x, p.y, this.webbs))
      }
    }
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
        this.webbs.damage(enemy.damage)
        this.health = this.webbs.hp
        this.contactCooldown = CONTACT_COOLDOWN

        const angle = Phaser.Math.Angle.Between(
          enemy.x, enemy.y,
          this.webbs.x, this.webbs.y,
        )
        // Player knockback scales with the damage taken
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

  private spawnLootAt(data: { x: number, y: number, loot: Array<{ material: MaterialType, quantity: number }> }): void {
    if (!data.loot || data.loot.length === 0) return
    data.loot.forEach((drop, i) => {
      const offX = (i - (data.loot.length - 1) / 2) * 22
      const p = new Pickup(this, data.x + offX, data.y, drop.material, drop.quantity, this.craftingSystem)
      this.pickupGroup.add(p, true)
    })
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
