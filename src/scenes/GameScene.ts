import Phaser from 'phaser'
import Webbs from '../entities/Webbs'
import CentipedeAmbusher, { CONTACT_RADIUS } from '../entities/CentipedeAmbusher'

// Starting positions well away from Webbs' spawn at (640, 360)
const AMBUSHER_SPAWNS = [
  { x: 200,  y: 140 },
  { x: 1020, y: 190 },
  { x: 590,  y: 600 },
] as const

export default class GameScene extends Phaser.Scene {
  private webbs!:     Webbs
  private debugText!: Phaser.GameObjects.Text
  private enemies:    CentipedeAmbusher[] = []

  // Player stats — written here, read by HUDScene via registry
  public stamina    = 100
  public staminaMax = 100
  public energy     = 100
  public energyMax  = 100
  public health     = 5
  public healthMax  = 5
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

    // Spawn Webbs at center
    this.webbs = new Webbs(this, width / 2, height / 2)

    // Spawn 3 dormant ambushers — they wake when Webbs approaches
    for (const sp of AMBUSHER_SPAWNS) {
      this.enemies.push(new CentipedeAmbusher(this, sp.x, sp.y, this.webbs))
    }

    // Debug position display
    this.debugText = this.add.text(20, height - 30, '', {
      fontFamily: 'monospace',
      fontSize: '12px',
      color: '#555577',
    })

    // Camera
    this.cameras.main.startFollow(this.webbs, true, 0.1, 0.1)
    this.cameras.main.setZoom(1.2)

    // World bounds
    this.physics.world.setBounds(0, 0, width, height)

    // Push initial stats to registry for HUD
    this.registry.set('zoneName',      this.zoneName)
    this.registry.set('stamina',       this.stamina)
    this.registry.set('staminaMax',    this.staminaMax)
    this.registry.set('energy',        this.energy)
    this.registry.set('energyMax',     this.energyMax)
    this.registry.set('health',        this.health)
    this.registry.set('healthMax',     this.healthMax)
    this.registry.set('weaponSlots',   this.webbs.weaponSystem.getAllSlots())
    this.registry.set('unlockedSlots', this.webbs.weaponSystem.getUnlockedSlotCount())

    this.scene.launch('HUDScene')
  }

  update(time: number, delta: number) {
    this.webbs.update(time, delta)

    // Update all enemies
    for (const enemy of this.enemies) {
      enemy.update(time, delta)
    }

    // Contact damage — manual distance check avoids arcade overlap type friction
    if (this.contactCooldown > 0) {
      this.contactCooldown -= delta
    } else {
      this.checkEnemyContact()
    }

    // Sync HUD
    this.registry.set('weaponSlots',   this.webbs.weaponSystem.getAllSlots())
    this.registry.set('unlockedSlots', this.webbs.weaponSystem.getUnlockedSlotCount())

    this.debugText.setText(
      `x: ${Math.round(this.webbs.x)}  y: ${Math.round(this.webbs.y)}  |  WASD to move`
    )
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
