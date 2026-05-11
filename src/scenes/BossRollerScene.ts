import Phaser from 'phaser'
import Webbs from '../entities/Webbs'
import RollerBoss from '../entities/RollerBoss'
import BossNose from '../entities/BossNose'
import type Enemy from '../entities/Enemy'
import { WeakPointZone } from '../entities/Enemy'
import { WeaponType } from '../systems/WeaponSystem'
import { WeaponUseSystem } from '../systems/WeaponUseSystem'
import { WebLauncherSystem } from '../systems/WebLauncherSystem'

// ── Constants ──────────────────────────────────────────────────────────────

const W = 1280
const H = 720

// Phase 1 nose position
const NOSE_X          = W / 2
const NOSE_Y          = 72
const NOSE_OVAL_W     = 120
const NOSE_HIT_RADIUS = 65

const ROCK_INTERVAL     = 3000   // ms between volleys
const SUCTION_INTERVAL  = 20000  // ms between suction events
const SUCTION_WARN_DUR  = 2000
const SUCTION_ACTIVE_DUR = 4000
const SUCTION_FORCE     = 150
const SUCTION_ANCHORED  = 20
const PUNCH_RADIUS      = 80

// Phase 2 roller spawn
const ROLLER_SPAWN_X = 300
const ROLLER_SPAWN_Y = H / 2

// Player config
const PLAYER_SPAWN_X = W / 2
const PLAYER_SPAWN_Y = H * 0.68
const PLAYER_MAX_HP  = 100
const DAMAGE_COOLDOWN_MS = 800

interface RockData {
  arc:       Phaser.GameObjects.Arc
  body:      Phaser.Physics.Arcade.Body
  reflected: boolean
}

// ── Scene ──────────────────────────────────────────────────────────────────

export default class BossRollerScene extends Phaser.Scene {

  // Shared
  private webbs!:       Webbs
  private bossPhase     = 1
  private retreatTriggered = false
  private playerHp      = PLAYER_MAX_HP
  private damageCooldown = 0

  // Phase 1 state
  private nose!:             BossNose
  private rockList:          RockData[] = []
  private rockTimer          = 0
  private suctionCycleTimer  = SUCTION_INTERVAL
  private suctionWarnTimer   = 0
  private suctionActiveTimer = 0
  private suctionWarning     = false
  private suctionActive      = false
  private webAnchored        = false
  private anchorLine!:       Phaser.GameObjects.Graphics
  private anchorPoint        = new Phaser.Math.Vector2(0, 0)
  private spaceKey!:         Phaser.Input.Keyboard.Key
  private qKey!:             Phaser.Input.Keyboard.Key
  private punchCooldown      = 0
  private dustTexture        = false

  // Phase 2 state
  private roller!:            RollerBoss
  private tailSwipeGraphic!:  Phaser.GameObjects.Graphics

  // Shared combat
  private weaponUseSystem!:   WeaponUseSystem
  private webLauncher!:       WebLauncherSystem
  private weaponKeys:         Phaser.Input.Keyboard.Key[] = []

  // UI
  private noseHpBar!:      Phaser.GameObjects.Graphics
  private rollerHpBar!:    Phaser.GameObjects.Graphics
  private playerHpBar!:    Phaser.GameObjects.Graphics
  private bossLabel!:      Phaser.GameObjects.Text
  private phaseText!:      Phaser.GameObjects.Text
  private warningText!:    Phaser.GameObjects.Text

  constructor() {
    super({ key: 'BossRollerScene' })
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  init(data: { health?: number }) {
    this.playerHp = data?.health ?? PLAYER_MAX_HP
    this.bossPhase       = 1
    this.rockList        = []
    this.rockTimer       = ROCK_INTERVAL
    this.suctionCycleTimer = SUCTION_INTERVAL
    this.suctionWarnTimer  = 0
    this.suctionActiveTimer = 0
    this.suctionWarning  = false
    this.suctionActive   = false
    this.webAnchored     = false
    this.damageCooldown  = 0
    this.punchCooldown   = 0
    this.dustTexture     = false
    this.retreatTriggered = false
  }

  create() {
    this.physics.world.setBounds(0, 80, W, H - 120)

    this.drawTunnel()

    // Phase 1 boss — nose is a real Enemy so it takes weapon damage
    this.nose = new BossNose(this, NOSE_X, NOSE_Y)
    this.nose.setDepth(5)

    // Player — Webbs instance handles WASD movement internally
    this.webbs = new Webbs(this, PLAYER_SPAWN_X, PLAYER_SPAWN_Y)
    this.webbs.setDepth(10)
    this.webbs.resetHp(this.playerHp)

    // Restore loadout from registry so weapons don't disappear in the boss fight
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

    // Camera follows Webbs
    this.cameras.main.startFollow(this.webbs, true, 0.12, 0.12)
    this.cameras.main.setZoom(1.0)

    // Input
    this.spaceKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE)
    this.qKey     = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.Q)
    // Suppress browser context menu so the right mouse button is free for later use
    this.input.mouse?.disableContextMenu()

    // Weapon use — keys 1-8 fire equipped weapons against the nose / roller
    this.weaponUseSystem = new WeaponUseSystem()
    this.weaponUseSystem.setEnemies([this.nose as unknown as Enemy])
    this.weaponUseSystem.setWorldBounds(W, H)

    // Web launcher — Q attaches to nose/roller (small targets pull to player; nose pulls player to wall)
    this.webLauncher = new WebLauncherSystem()
    this.webLauncher.setEnemies([this.nose as unknown as Enemy])
    this.webLauncher.setWorldBounds(W, H)
    // Tunnel walls are the screen edges; anchor wherever the projectile lands
    this.webLauncher.setWallHitTest((x, y) => x < 60 || x > W - 60 || y < 90 || y > H - 60)

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

    // Anchor line graphic (drawn each frame when anchored)
    this.anchorLine = this.add.graphics()

    // Tail swipe overlay
    this.tailSwipeGraphic = this.add.graphics()
    this.tailSwipeGraphic.setDepth(8)

    // UI
    this.buildUI()

    // Sync registry so HUDScene keeps reading correctly
    this.syncRegistry()

    // Entrance flash
    this.cameras.main.flash(300, 0, 0, 0)

    // Boss loot — funnel directly into the shared crafting inventory
    this.events.on('enemyDied', this.onEnemyDied, this)
    this.events.once('shutdown', () => this.events.off('enemyDied', this.onEnemyDied, this))
  }

  private onEnemyDied(data: { loot: Array<{ material: string, quantity: number }> }): void {
    if (!data.loot || data.loot.length === 0) return
    const inv = (this.registry.get('craftingInventory') as Record<string, number> | null) ?? {}
    for (const drop of data.loot) {
      inv[drop.material] = (inv[drop.material] ?? 0) + drop.quantity
    }
    this.registry.set('craftingInventory', inv)
  }

  // ── Tunnel environment ────────────────────────────────────────────────────

  private drawTunnel(): void {
    const bg = this.add.graphics()
    bg.setDepth(0)

    // Dark dirt background
    bg.fillStyle(0x180c02, 1)
    bg.fillRect(0, 0, W, H)

    // Dirt patches for texture
    for (let i = 0; i < 90; i++) {
      const px = Phaser.Math.Between(0, W)
      const py = Phaser.Math.Between(0, H)
      const alpha = Phaser.Math.FloatBetween(0.04, 0.14)
      bg.fillStyle(0x7a5c18, alpha)
      bg.fillEllipse(px, py, Phaser.Math.Between(28, 90), Phaser.Math.Between(18, 55))
    }

    // Ceiling strip
    bg.fillStyle(0x4a2e08, 1)
    bg.fillRect(0, 0, W, 45)

    // Floor strip
    bg.fillStyle(0x3a2206, 1)
    bg.fillRect(0, H - 45, W, 45)

    // Stalactites from ceiling
    bg.fillStyle(0x5c3a0e, 1)
    const stalX = [70, 200, 360, 520, 640, 760, 900, 1050, 1200]
    for (const sx of stalX) {
      const sh = Phaser.Math.Between(35, 90)
      const sw = Phaser.Math.Between(14, 28)
      bg.fillTriangle(sx - sw / 2, 0, sx + sw / 2, 0, sx, sh)
    }

    // Stalagmites from floor
    bg.fillStyle(0x4a2e08, 1)
    const stagX = [130, 280, 430, 590, 740, 880, 1030, 1170]
    for (const sx of stagX) {
      const sh = Phaser.Math.Between(22, 55)
      const sw = Phaser.Math.Between(12, 22)
      bg.fillTriangle(sx - sw / 2, H, sx + sw / 2, H, sx, H - sh)
    }

    // Ceiling hole where the nose bursts through (Phase 1)
    const hole = this.add.graphics()
    hole.setDepth(1)
    hole.fillStyle(0x0a0600, 1)
    hole.fillEllipse(NOSE_X, 30, NOSE_OVAL_W + 20, 65)

    // Ragged hole edges
    hole.fillStyle(0x3d2208, 1)
    for (let i = 0; i < 10; i++) {
      const angle = (i / 10) * Math.PI * 2
      const rx = NOSE_X + Math.cos(angle) * (NOSE_OVAL_W / 2 + 5)
      const ry = 30 + Math.sin(angle) * 28
      hole.fillTriangle(rx - 9, ry - 6, rx + 9, ry - 6, rx, ry + 14)
    }
  }

  // ── UI ────────────────────────────────────────────────────────────────────

  private buildUI(): void {
    // Boss HP bar container (top center)
    this.noseHpBar  = this.add.graphics().setDepth(20).setScrollFactor(0)
    this.rollerHpBar = this.add.graphics().setDepth(20).setScrollFactor(0)

    // Boss label
    this.bossLabel = this.add.text(W / 2, 14, "ROLLER'S NOSE", {
      fontFamily: 'monospace',
      fontSize: '14px',
      color: '#ffaacc',
    }).setOrigin(0.5, 0).setDepth(21).setScrollFactor(0)

    // Player HP bar
    this.playerHpBar = this.add.graphics().setDepth(21).setScrollFactor(0)

    // Phase / warning text (center of screen)
    this.phaseText = this.add.text(W / 2, H / 2, '', {
      fontFamily: 'monospace',
      fontSize: '32px',
      color: '#ffffff',
      stroke: '#000000',
      strokeThickness: 4,
    }).setOrigin(0.5).setDepth(30).setScrollFactor(0).setAlpha(0)

    this.warningText = this.add.text(W / 2, 180, '', {
      fontFamily: 'monospace',
      fontSize: '22px',
      color: '#ff4444',
      stroke: '#000000',
      strokeThickness: 3,
    }).setOrigin(0.5).setDepth(30).setScrollFactor(0).setAlpha(0)

    this.updateNoseHpBar()
  }

  private updateNoseHpBar(): void {
    this.noseHpBar.clear()
    if (!this.nose || this.nose.isDead()) return
    const bw = 360, bh = 16, bx = W / 2 - bw / 2, by = 34
    this.noseHpBar.fillStyle(0x220011, 1)
    this.noseHpBar.fillRect(bx, by, bw, bh)
    const ratio = this.nose.getHealthRatio()
    this.noseHpBar.fillStyle(0xff5577, 1)
    this.noseHpBar.fillRect(bx, by, bw * ratio, bh)
    this.noseHpBar.lineStyle(1, 0x884455, 1)
    this.noseHpBar.strokeRect(bx, by, bw, bh)
  }

  private updateRollerHpBar(): void {
    if (!this.roller) return
    this.rollerHpBar.clear()
    const bw = 400, bh = 18, bx = W / 2 - bw / 2, by = 34
    this.rollerHpBar.fillStyle(0x111100, 1)
    this.rollerHpBar.fillRect(bx, by, bw, bh)
    const ratio = this.roller.getHealthRatio()
    const col = ratio > 0.5 ? 0xffcc44 : ratio > 0.25 ? 0xff8822 : 0xff2222
    this.rollerHpBar.fillStyle(col, 1)
    this.rollerHpBar.fillRect(bx, by, bw * ratio, bh)
    this.rollerHpBar.lineStyle(1, 0x665500, 1)
    this.rollerHpBar.strokeRect(bx, by, bw, bh)
  }

  private updatePlayerHpPips(): void {
    const bw = 140, bh = 14, bx = 12, by = 8
    this.playerHpBar.clear()
    this.playerHpBar.fillStyle(0x331122, 1)
    this.playerHpBar.fillRect(bx, by, bw, bh)
    const ratio = Phaser.Math.Clamp(this.playerHp / PLAYER_MAX_HP, 0, 1)
    this.playerHpBar.fillStyle(0xff4455, 1)
    this.playerHpBar.fillRect(bx, by, bw * ratio, bh)
    this.playerHpBar.lineStyle(1, 0x441122, 1)
    this.playerHpBar.strokeRect(bx, by, bw, bh)
  }

  private syncRegistry(): void {
    this.registry.set('health',    this.playerHp)
    this.registry.set('healthMax', PLAYER_MAX_HP)
    this.registry.set('zoneName',  'ANT COLONY — BOSS')
  }

  // ── Player damage ─────────────────────────────────────────────────────────

  private takeDamage(amount: number): void {
    if (this.damageCooldown > 0) return
    this.webbs.damage(amount)
    this.playerHp = this.webbs.hp
    this.damageCooldown = DAMAGE_COOLDOWN_MS
    this.updatePlayerHpPips()
    this.syncRegistry()
    this.cameras.main.shake(120, 0.006)

    if (this.playerHp <= 0) {
      this.playerDied()
    }
  }

  private playerDied(): void {
    this.cameras.main.fade(800, 50, 0, 0)
    this.time.delayedCall(800, () => {
      this.clearRocks()
      this.scene.start('GameScene')
    })
  }

  // ── Phase 1 ───────────────────────────────────────────────────────────────

  private spawnRocks(): void {
    const count = Phaser.Math.Between(2, 3)
    for (let i = 0; i < count; i++) {
      const spread = Phaser.Math.FloatBetween(-0.45, 0.45)
      const tx = this.webbs.x + spread * 120
      const ty = this.webbs.y
      const speed = Phaser.Math.FloatBetween(170, 310)
      const angle = Phaser.Math.Angle.Between(NOSE_X, NOSE_Y, tx, ty)

      const arc = this.add.arc(NOSE_X, NOSE_Y + 40, 12, 0, 360, false, 0x8b6914)
      arc.setStrokeStyle(2, 0x5c3d0d)
      arc.setDepth(6)
      this.physics.add.existing(arc)

      const body = arc.body as Phaser.Physics.Arcade.Body
      body.setVelocity(Math.cos(angle) * speed, Math.sin(angle) * speed)
      body.setCollideWorldBounds(true)
      body.setBounce(0.45)

      this.rockList.push({ arc, body, reflected: false })
    }
  }

  private updateRocks(_delta: number): void {
    for (let i = this.rockList.length - 1; i >= 0; i--) {
      const rock = this.rockList[i]

      // Suction pull on rocks
      if (this.suctionActive) {
        const angle = Phaser.Math.Angle.Between(rock.arc.x, rock.arc.y, NOSE_X, NOSE_Y)
        rock.body.setAcceleration(
          Math.cos(angle) * SUCTION_FORCE * 2.5,
          Math.sin(angle) * SUCTION_FORCE * 2.5,
        )
      } else {
        rock.body.setAcceleration(0, 0)
      }

      // Reflected rock hits nose?
      if (rock.reflected) {
        const dist = Phaser.Math.Distance.Between(rock.arc.x, rock.arc.y, NOSE_X, NOSE_Y)
        if (dist < NOSE_HIT_RADIUS) {
          this.rockHitNose(rock.arc.x, rock.arc.y)
          rock.arc.destroy()
          this.rockList.splice(i, 1)
          continue
        }
      }

      // Cull rocks that leave the play area
      if (
        rock.arc.x < -60 || rock.arc.x > W + 60 ||
        rock.arc.y < -60 || rock.arc.y > H + 60
      ) {
        rock.arc.destroy()
        this.rockList.splice(i, 1)
      }
    }
  }

  private tryPunch(): void {
    if (this.punchCooldown > 0) return
    this.punchCooldown = 350

    let hit = false
    for (const rock of this.rockList) {
      if (rock.reflected) continue
      const dist = Phaser.Math.Distance.Between(
        this.webbs.x, this.webbs.y,
        rock.arc.x,   rock.arc.y,
      )
      if (dist <= PUNCH_RADIUS) {
        // Redirect toward nose
        const angle = Phaser.Math.Angle.Between(rock.arc.x, rock.arc.y, NOSE_X, NOSE_Y)
        const speed = Phaser.Math.FloatBetween(360, 480)
        rock.body.setVelocity(Math.cos(angle) * speed, Math.sin(angle) * speed)
        rock.body.setAcceleration(0, 0)
        rock.reflected = true
        rock.arc.setFillStyle(0xffaa44)  // tint to show reflected
        hit = true
      }
    }

    // Punch visual flash
    if (hit) {
      this.cameras.main.shake(60, 0.003)
    }
    // Show glove flash even on miss
    this.showPunchFlash()
  }

  private showPunchFlash(): void {
    const g = this.add.graphics().setDepth(12)
    g.fillStyle(0xffdd44, 0.7)
    g.fillCircle(this.webbs.x, this.webbs.y, 40)
    this.tweens.add({
      targets:    g,
      alpha:      0,
      scaleX:     2,
      scaleY:     2,
      duration:   220,
      onComplete: () => g.destroy(),
    })
  }

  private rockHitNose(rx: number, ry: number): void {
    // Reflected rocks now do a meaty chunk of damage; standard weapons chip away
    this.nose.takeDamage(20, WeakPointZone.Head)
    this.cameras.main.shake(200, 0.012)
    this.updateNoseHpBar()

    // Particle burst at impact
    this.ensureDirtTexture()
    const emitter = this.add.particles(rx, ry, 'dirt-particle', {
      speed:    { min: 60, max: 220 },
      scale:    { start: 1.6, end: 0 },
      alpha:    { start: 1,   end: 0 },
      tint:     [0xff9fad, 0xff5577, 0xffffff],
      lifespan: { min: 300, max: 600 },
      emitting: false,
    })
    emitter.explode(20)
    this.time.delayedCall(800, () => emitter.destroy())
  }

  private retreatNose(): void {
    // Nose slides back up
    this.tweens.add({
      targets:  this.nose,
      y:        NOSE_Y - 120,
      alpha:    0,
      duration: 700,
      ease:     'Power2.In',
      onComplete: () => {
        this.clearRocks()
        this.startPhase2()
      },
    })
  }

  private ensureDirtTexture(): void {
    if (this.dustTexture) return
    this.dustTexture = true
    const g = this.add.graphics()
    g.fillStyle(0x8b6914, 1)
    g.fillRect(0, 0, 6, 6)
    g.generateTexture('dirt-particle', 6, 6)
    g.destroy()
  }

  private shootWebAnchor(): void {
    if (this.bossPhase !== 1) return
    // Anchor on the wall opposite the suction pull (i.e. on the side Webbs is on)
    const wx = this.webbs.x < W / 2 ? 40 : W - 40
    const wy = Phaser.Math.Clamp(this.webbs.y, 100, H - 100)
    this.anchorPoint.set(wx, wy)
    this.webAnchored = true

    // Auto-release after 5 seconds
    this.time.delayedCall(5000, () => { this.webAnchored = false })
  }

  private drawAnchorLine(): void {
    this.anchorLine.clear()
    if (!this.webAnchored) return
    this.anchorLine.lineStyle(2, 0xddddff, 0.6)
    this.anchorLine.lineBetween(
      this.webbs.x, this.webbs.y,
      this.anchorPoint.x, this.anchorPoint.y,
    )
    this.anchorLine.fillStyle(0xaaaaff, 1)
    this.anchorLine.fillCircle(this.anchorPoint.x, this.anchorPoint.y, 5)
  }

  private applySuctionToPlayer(): void {
    const force = this.webAnchored ? SUCTION_ANCHORED : SUCTION_FORCE
    const angle = Phaser.Math.Angle.Between(
      this.webbs.x, this.webbs.y, NOSE_X, NOSE_Y,
    )
    // Add suction on top of WASD velocity already applied by webbs.update()
    this.webbs.pb.setVelocity(
      this.webbs.pb.velocity.x + Math.cos(angle) * force,
      this.webbs.pb.velocity.y + Math.sin(angle) * force,
    )
  }

  private clearRocks(): void {
    for (const rock of this.rockList) rock.arc.destroy()
    this.rockList = []
  }

  // ── Phase transition ──────────────────────────────────────────────────────

  private startPhase2(): void {
    this.bossPhase = 2

    // Black flash then phase announcement
    this.cameras.main.flash(400, 0, 0, 0)

    this.time.delayedCall(400, () => {
      this.bossLabel.setText('ROLLER')
      this.noseHpBar.clear()

      this.showPhaseText('PHASE 2\nTHE CHASE', 2500)

      // Spawn Roller boss
      this.roller = new RollerBoss(this, ROLLER_SPAWN_X, ROLLER_SPAWN_Y)
      this.roller.setDepth(9)
      this.roller.setTarget(this.webbs.x, this.webbs.y)

      // Wire up Roller events
      this.roller.on('bodySlam',         () => this.onBodySlamStart())
      this.roller.on('groundPoundWindup', (x: number, y: number) => this.onGroundPoundWindup(x, y))
      this.roller.on('groundPoundRelease', (x: number, y: number) => this.spawnShockwave(x, y))
      this.roller.on('tailSwipe',        (x: number, y: number, dir: number) => this.onTailSwipe(x, y, dir))

      // Weapons now target the roller too
      this.weaponUseSystem.setEnemies([this.roller as unknown as Enemy])
    })
  }

  private showPhaseText(msg: string, duration: number): void {
    this.phaseText.setText(msg).setAlpha(1)
    this.tweens.add({
      targets:  this.phaseText,
      alpha:    0,
      duration: 500,
      delay:    duration - 500,
    })
  }

  private showWarning(msg: string): void {
    this.warningText.setText(msg).setAlpha(1)
    this.tweens.killTweensOf(this.warningText)
    this.tweens.add({
      targets:  this.warningText,
      alpha:    { from: 1, to: 0.3 },
      duration: 250,
      yoyo:     true,
      repeat:   -1,
    })
  }

  private hideWarning(): void {
    this.tweens.killTweensOf(this.warningText)
    this.warningText.setAlpha(0)
  }

  // ── Phase 2 attacks ───────────────────────────────────────────────────────

  private onBodySlamStart(): void {
    this.cameras.main.shake(80, 0.005)
  }

  private onGroundPoundWindup(x: number, _y: number): void {
    // Roller rears up — show warning indicator on ground
    const g = this.add.graphics().setDepth(7)
    g.lineStyle(3, 0xffcc44, 0.7)
    g.strokeCircle(x, H / 2, 30)
    this.tweens.add({
      targets:  g,
      alpha:    0,
      scaleX:   2.5,
      scaleY:   2.5,
      duration: 700,
      onComplete: () => g.destroy(),
    })
  }

  private spawnShockwave(cx: number, cy: number): void {
    this.cameras.main.shake(250, 0.015)

    const r0 = 25
    const rMax = 210
    const duration = 650
    let playerHit = false

    const sw = this.add.arc(cx, cy, r0, 0, 360, false, 0xffaa22, 0)
    sw.setStrokeStyle(5, 0xffdd44)
    sw.setDepth(8)

    const targetScale = rMax / r0
    const startTime   = this.time.now

    this.tweens.add({
      targets:  sw,
      scaleX:   targetScale,
      scaleY:   targetScale,
      alpha:    0,
      duration,
      ease:     'Linear',
      onUpdate: () => {
        if (playerHit) return
        const elapsed    = this.time.now - startTime
        const progress   = Phaser.Math.Clamp(elapsed / duration, 0, 1)
        const currentR   = r0 + (rMax - r0) * progress
        const dist       = Phaser.Math.Distance.Between(this.webbs.x, this.webbs.y, cx, cy)
        if (Math.abs(dist - currentR) < 28) {
          playerHit = true
          this.takeDamage(22)
        }
      },
      onComplete: () => sw.destroy(),
    })
  }

  private onTailSwipe(rx: number, ry: number, facingDir: number): void {
    // Tail is on the opposite side from facing
    const tailAngle = facingDir === 1 ? Math.PI : 0
    const sweepAngle = Math.PI * 0.65  // ~117° sweep

    this.tailSwipeGraphic.clear()
    this.tailSwipeGraphic.fillStyle(0xff8800, 0.35)
    this.tailSwipeGraphic.slice(
      rx, ry, 115,
      tailAngle - sweepAngle / 2,
      tailAngle + sweepAngle / 2,
      false,
    )
    this.tailSwipeGraphic.fillPath()
    this.tailSwipeGraphic.setAlpha(1)

    // Fade out the swipe visual
    this.tweens.add({
      targets:  this.tailSwipeGraphic,
      alpha:    0,
      duration: 400,
    })

    // Check if Webbs is in the arc
    const dist       = Phaser.Math.Distance.Between(this.webbs.x, this.webbs.y, rx, ry)
    if (dist < 115) {
      const angleToPlayer = Phaser.Math.Angle.Between(rx, ry, this.webbs.x, this.webbs.y)
      const diff          = Math.abs(Phaser.Math.Angle.Wrap(angleToPlayer - tailAngle))
      if (diff < sweepAngle / 2) {
        this.takeDamage(20)
        // Knock Webbs in tail direction
        const pushAngle = tailAngle + (Math.random() - 0.5) * 0.8
        this.webbs.pb.setVelocity(Math.cos(pushAngle) * 280, Math.sin(pushAngle) * 280)
      }
    }

    this.cameras.main.shake(100, 0.006)
  }

  // ── Body slam contact damage ──────────────────────────────────────────────

  private checkBodySlamContact(): void {
    if (!this.roller || !this.roller.isBodySlamming()) return
    const dist = Phaser.Math.Distance.Between(
      this.webbs.x, this.webbs.y,
      this.roller.x, this.roller.y,
    )
    if (dist < 70) {
      this.takeDamage(25)
      const angle = Phaser.Math.Angle.Between(
        this.roller.x, this.roller.y,
        this.webbs.x,  this.webbs.y,
      )
      this.webbs.pb.setVelocity(Math.cos(angle) * 340, Math.sin(angle) * 340)
    }
  }

  // ── Victory ───────────────────────────────────────────────────────────────

  private rollerDefeated(): void {
    this.cameras.main.shake(400, 0.02)
    this.time.delayedCall(400, () => {
      this.showPhaseText('ANT TUNNELS\nCLEARED!', 3000)
    })
    this.time.delayedCall(3600, () => {
      this.cameras.main.fade(600, 0, 0, 0)
    })
    this.time.delayedCall(4200, () => {
      this.registry.set('antTunnelsClear', true)
      this.scene.start('GameScene')
    })
  }

  // ── Main update ───────────────────────────────────────────────────────────

  update(time: number, delta: number): void {
    if (this.damageCooldown > 0) this.damageCooldown -= delta
    if (this.punchCooldown  > 0) this.punchCooldown  -= delta

    // Player movement
    this.webbs.update(time, delta)
    this.weaponUseSystem.update(delta)
    this.webLauncher.update(this, this.webbs, delta)

    // Weapon keys 1-8 → slots 0-7
    for (let i = 0; i < this.weaponKeys.length; i++) {
      if (Phaser.Input.Keyboard.JustDown(this.weaponKeys[i])) {
        this.weaponUseSystem.activateWeapon(i, this.webbs, this)
      }
    }

    // Q → web launcher. If a launcher is equipped its strand also anchors the player
    // against suction; otherwise fall back to the legacy fixed-wall anchor.
    if (Phaser.Input.Keyboard.JustDown(this.qKey)) {
      if (this.webLauncher.isEquipped(this.webbs)) this.webLauncher.onQPressed(this, this.webbs)
      else                                          this.shootWebAnchor()
    }
    // The launcher's attached state doubles as the suction anchor for Phase 1
    this.webAnchored = this.webAnchored || this.webLauncher.isAttachedToWall()

    // Pull HP back from Webbs (regen happens inside Webbs.update)
    this.playerHp = this.webbs.hp
    this.syncRegistry()

    // Suction override
    if (this.suctionActive) this.applySuctionToPlayer()

    if (this.bossPhase === 1) {
      this.updatePhase1(delta)
    } else {
      this.updatePhase2(time, delta)
    }

    this.drawAnchorLine()
    this.updatePlayerHpPips()
    this.updateNoseHpBar()
  }

  private updatePhase1(delta: number): void {
    // Once the nose is dead (rocks OR weapons), trigger retreat + Phase 2
    if (this.nose.isDead() && !this.retreatTriggered) {
      this.retreatTriggered = true
      this.time.delayedCall(300, () => this.retreatNose())
      return
    }

    // Rock volley timer
    this.rockTimer -= delta
    if (this.rockTimer <= 0) {
      this.rockTimer = ROCK_INTERVAL
      this.spawnRocks()
    }

    // Suction cycle
    if (!this.suctionWarning && !this.suctionActive) {
      this.suctionCycleTimer -= delta
      if (this.suctionCycleTimer <= 0) {
        this.suctionCycleTimer = SUCTION_INTERVAL
        this.suctionWarning    = true
        this.suctionWarnTimer  = SUCTION_WARN_DUR
        this.showWarning('⚠  SUCTION INCOMING  ⚠')
      }
    }

    if (this.suctionWarning) {
      this.suctionWarnTimer -= delta
      if (this.suctionWarnTimer <= 0) {
        this.suctionWarning    = false
        this.suctionActive     = true
        this.suctionActiveTimer = SUCTION_ACTIVE_DUR
        this.hideWarning()
        this.showWarning('ANCHOR A WALL  [Q]')
      }
    }

    if (this.suctionActive) {
      this.suctionActiveTimer -= delta
      if (this.suctionActiveTimer <= 0) {
        this.suctionActive  = false
        this.webAnchored    = false
        this.hideWarning()
      }
    }

    this.updateRocks(delta)

    // Punch input
    if (Phaser.Input.Keyboard.JustDown(this.spaceKey)) {
      this.tryPunch()
    }

    // Player rock contact damage
    for (const rock of this.rockList) {
      if (rock.reflected) continue
      const dist = Phaser.Math.Distance.Between(
        this.webbs.x, this.webbs.y,
        rock.arc.x,   rock.arc.y,
      )
      if (dist < 20) {
        this.takeDamage(18)
        break
      }
    }
  }

  private updatePhase2(_time: number, _delta: number): void {
    if (!this.roller) return

    this.roller.setTarget(this.webbs.x, this.webbs.y)
    this.roller.update(0, _delta)

    this.updateRollerHpBar()
    this.checkBodySlamContact()

    if (this.roller.isDead() && !this.roller.active) {
      // Already cleaned up — do nothing
      return
    }

    if (this.roller.isDead()) {
      this.rollerDefeated()
    }
  }
}
