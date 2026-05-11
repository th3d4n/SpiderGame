import Phaser from 'phaser'
import Webbs, { PLAYER_MAX_HP } from '../entities/Webbs'
import CentipedeAmbusher, { CONTACT_RADIUS } from '../entities/CentipedeAmbusher'
import Workbench from '../entities/Workbench'
import { CraftingSystem } from '../systems/CraftingSystem'
import { WeaponType } from '../systems/WeaponSystem'

// Starting positions well away from Webbs' spawn at (640, 360)
const AMBUSHER_SPAWNS = [
  { x: 200,  y: 140 },
  { x: 1020, y: 190 },
  { x: 590,  y: 600 },
] as const

// x threshold — world is 1280 wide; trigger sits near the right edge
const BOSS_TRIGGER_X = 1140

export default class GameScene extends Phaser.Scene {
  private webbs!:          Webbs
  private debugText!:      Phaser.GameObjects.Text
  private enemies:         CentipedeAmbusher[] = []
  private workbench!:      Workbench
  private craftingSystem!: CraftingSystem
  private eKey!:           Phaser.Input.Keyboard.Key
  private bossTriggered    = false

  // Player stats — written here, read by HUDScene via registry
  public stamina    = 100
  public staminaMax = 100
  public energy     = 100
  public energyMax  = 100
  public health     = PLAYER_MAX_HP
  public healthMax  = PLAYER_MAX_HP
  public zoneName   = 'ANT COLONY'

  // Cooldown so a single contact burst doesn't drain health instantly
  private contactCooldown = 0

  constructor() {
    super({ key: 'GameScene' })
  }

  create() {
    const { width, height } = this.scale

    // Temporary grid background (replaces tilemap later)
    const gridGraphics = this.add.graphics()
    gridGraphics.lineStyle(0.5, 0x333355, 0.5)
    for (let x = 0; x < width; x += 64) {
      gridGraphics.lineBetween(x, 0, x, height)
    }
    for (let y = 0; y < height; y += 64) {
      gridGraphics.lineBetween(0, y, width, y)
    }

    // Crafting system — Phase 1 test: start with some materials
    this.craftingSystem = new CraftingSystem()
    this.craftingSystem.addMaterial('SilkThread',   6)
    this.craftingSystem.addMaterial('ChitinShard',  4)
    this.craftingSystem.addMaterial('VenomGland',   2)
    this.craftingSystem.addMaterial('WebFluid',     4)
    this.craftingSystem.addMaterial('CrystalDust',  1)
    this.craftingSystem.addMaterial('BoneFragment', 2)

    // Spawn Webbs at center, start with tier 1 so first 4 slots are open
    this.webbs = new Webbs(this, width / 2, height / 2)
    this.webbs.weaponSystem.setLegTier(1)

    // Spawn 3 dormant ambushers — they wake when Webbs approaches
    for (const sp of AMBUSHER_SPAWNS) {
      this.enemies.push(new CentipedeAmbusher(this, sp.x, sp.y, this.webbs))
    }

    // Workbench in top-left quadrant
    this.workbench = new Workbench(this, 200, 200)

    // Input
    this.eKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.E)

    // Debug position display
    this.debugText = this.add.text(20, height - 30, '', {
      fontFamily: 'monospace',
      fontSize: '12px',
      color: '#555577',
    })

    // Boss door — right edge of the zone
    this.drawBossDoor(width, height)

    // Camera
    this.cameras.main.startFollow(this.webbs, true, 0.1, 0.1)
    this.cameras.main.setZoom(1.2)

    // World bounds
    this.physics.world.setBounds(0, 0, width, height)

    // Push initial stats to registry for HUD and CraftingMenu
    this.syncRegistry()
    this.scene.launch('HUDScene')
  }

  update(time: number, delta: number) {
    // Process any weapon crafted while menu was open
    const pendingEquip: WeaponType | null = this.registry.get('pendingEquip') ?? null
    if (pendingEquip !== null) {
      this.registry.set('pendingEquip', null)
      this.equipFirstFreeSlot(pendingEquip)
    }

    // Sync crafting inventory in case it changed while menu was open
    const updatedInventory = this.registry.get('craftingInventory')
    if (updatedInventory) {
      this.registry.set('craftingInventory', null)
      // Inventory is managed entirely in registry — CraftingMenu already updated it
    }

    this.webbs.update(time, delta)

    // Update all enemies
    for (const enemy of this.enemies) {
      enemy.update(time, delta)
    }

    // Workbench interaction
    if (this.workbench.update(this.webbs, this.eKey)) {
      this.registry.set('craftingInventory', this.craftingSystem.getInventorySnapshot())
      this.registry.set('legTier', this.webbs.weaponSystem.getLegTier())
      this.scene.launch('CraftingMenu')
    }

    // Contact damage — manual distance check avoids arcade overlap type friction
    if (this.contactCooldown > 0) {
      this.contactCooldown -= delta
    } else {
      this.checkEnemyContact()
    }

    // Sync HUD
    this.syncRegistry()

    this.debugText.setText(
      `x: ${Math.round(this.webbs.x)}  y: ${Math.round(this.webbs.y)}  |  WASD/E move, E at bench to craft`
    )

    // Boss trigger — Webbs walks into the far-right door
    if (!this.bossTriggered && this.webbs.x > BOSS_TRIGGER_X) {
      this.bossTriggered = true
      this.cameras.main.shake(200, 0.008)

      // Door slams shut — animate a dark panel sliding in from the right
      const door = this.add.rectangle(
        this.scale.width + 40, this.scale.height / 2,
        80, this.scale.height,
        0x220a00,
      ).setDepth(50)
      this.tweens.add({
        targets:  door,
        x:        this.scale.width - 20,
        duration: 250,
        ease:     'Power3.In',
      })

      this.time.delayedCall(600, () => {
        this.cameras.main.fade(400, 0, 0, 0)
      })
      this.time.delayedCall(1050, () => {
        this.scene.start('BossRollerScene', { health: this.health })
      })
    }
  }

  private drawBossDoor(width: number, height: number): void {
    const g = this.add.graphics()

    // Stone door frame at right edge
    g.fillStyle(0x3a2010, 1)
    g.fillRect(width - 60, 0, 60, height)

    // Door planks
    g.fillStyle(0x5c3510, 1)
    for (let y = 20; y < height; y += 38) {
      g.fillRect(width - 56, y, 52, 30)
    }

    // Iron studs
    g.fillStyle(0x888888, 1)
    for (let y = 30; y < height; y += 76) {
      g.fillCircle(width - 46, y, 4)
      g.fillCircle(width - 20, y, 4)
    }

    // Warning text above the door
    this.add.text(width - 80, height / 2 - 60, 'ANT COLONY\n   BOSS →', {
      fontFamily: 'monospace',
      fontSize:   '11px',
      color:      '#cc4422',
      align:      'center',
    }).setOrigin(0.5)

    // Glowing red border strip at the trigger line
    const glow = this.add.graphics()
    glow.lineStyle(2, 0xff2200, 0.7)
    glow.lineBetween(BOSS_TRIGGER_X, 0, BOSS_TRIGGER_X, height)
    this.tweens.add({
      targets:  glow,
      alpha:    { from: 0.3, to: 1 },
      duration: 800,
      yoyo:     true,
      repeat:   -1,
    })
  }

  private equipFirstFreeSlot(weaponType: WeaponType): void {
    const system = this.webbs.weaponSystem
    const unlockedCount = system.getUnlockedSlotCount()
    for (let i = 0; i < unlockedCount; i++) {
      if (system.getSlot(i) === WeaponType.Empty) {
        system.equip(i, weaponType)
        this.webbs.refreshLegColors()
        return
      }
    }
  }

  private syncRegistry(): void {
    this.registry.set('zoneName',      this.zoneName)
    this.registry.set('stamina',       this.stamina)
    this.registry.set('staminaMax',    this.staminaMax)
    this.registry.set('energy',        this.energy)
    this.registry.set('energyMax',     this.energyMax)
    this.registry.set('health',        this.health)
    this.registry.set('healthMax',     this.healthMax)
    this.registry.set('weaponSlots',   this.webbs.weaponSystem.getAllSlots())
    this.registry.set('unlockedSlots', this.webbs.weaponSystem.getUnlockedSlotCount())
  }

  private checkEnemyContact(): void {
    for (const enemy of this.enemies) {
      if (enemy.isDead()) continue

      const dist = Phaser.Math.Distance.Between(
        this.webbs.x, this.webbs.y,
        enemy.x,      enemy.y,
      )

      if (dist < CONTACT_RADIUS + 16) {  // 16 = Webbs body radius
        this.health = Math.max(0, this.health - enemy.damage)
        this.registry.set('health', this.health)
        this.contactCooldown = 750  // ms before next contact hit

        // Knock Webbs directly away from the enemy
        const angle = Phaser.Math.Angle.Between(
          enemy.x,      enemy.y,
          this.webbs.x, this.webbs.y,
        )
        this.webbs.pb.setVelocity(
          Math.cos(angle) * 320,
          Math.sin(angle) * 320,
        )

        // Only process one hit per frame to avoid stacking
        break
      }
    }
  }
}
