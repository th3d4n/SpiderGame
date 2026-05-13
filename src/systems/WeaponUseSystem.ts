import Phaser from 'phaser'
import { WeaponType } from './WeaponSystem'
import { WeakPointZone } from '../entities/Enemy'
import Enemy from '../entities/Enemy'
import Webbs from '../entities/Webbs'

// ── Melee weapons — each weapon has its own range, sweep, speed, damage, knockback ──

// Sword — balanced quick arc, medium range
const SWORD_RADIUS      = 70
const SWORD_SWEEP_DEG   = 90
const SWORD_DAMAGE      = 18
const SWORD_STAMINA     = 10
const SWORD_COOLDOWN    = 280
const SWORD_KNOCKBACK   = 180

// Axe — slow heavy cleave, big damage + knockback
const AXE_RADIUS        = 62
const AXE_SWEEP_DEG     = 170
const AXE_DAMAGE        = 44
const AXE_STAMINA       = 22
const AXE_COOLDOWN      = 760
const AXE_KNOCKBACK     = 520

// Toothpick — long thin stab, narrow cone, modest damage but better reach
const GLOVES_RADIUS     = 90
const GLOVES_CONE_DEG   = 28
const GLOVES_DAMAGE     = 14
const GLOVES_STAMINA    = 5
const GLOVES_COOLDOWN   = 220
const GLOVES_KNOCKBACK  = 200
const GLOVES_SHAKE_INT  = 0.006
const GLOVES_SHAKE_DUR  = 70

// Web Bow — slowed projectile so it's dodgeable; consumes a Thistle from inventory per shot
const BOW_SPEED         = 320
const BOW_DAMAGE        = 22
const BOW_STAMINA       = 12
const BOW_COOLDOWN      = 380
const BOW_PROJ_RADIUS   = 6
const BOW_KNOCKBACK     = 220

// Flame breather
const FLAME_RANGE       = 120
const FLAME_CONE_DEG    = 45
const FLAME_ENERGY_RATE = 2     // per frame
const FLAME_DPS         = 18    // damage per second → checked each tick

interface Projectile {
  arc:       Phaser.GameObjects.Arc
  isThistle: boolean
}

export class WeaponUseSystem {
  private enemies:          Enemy[] = []
  private cooldowns:        number[] = Array(8).fill(0)
  private projectiles:      Projectile[] = []
  private flameEmitter:     Phaser.GameObjects.Particles.ParticleEmitter | null = null
  private flameSlot:        number = -1
  private flameDmgTimer:    number = 0
  private worldW            = 4000
  private worldH            = 4000

  setEnemies(enemies: Enemy[]): void {
    this.enemies = enemies
  }

  setWorldBounds(w: number, h: number): void {
    this.worldW = w
    this.worldH = h
  }

  // ── Update ────────────────────────────────────────────────────────────────

  update(delta: number): void {
    for (let i = 0; i < 8; i++) {
      if (this.cooldowns[i] > 0) this.cooldowns[i] -= delta
    }
    this.tickProjectiles()
  }

  // ── One-shot weapon activation ────────────────────────────────────────────
  // `aim` lets the caller override the firing direction (e.g. mouse cursor).
  // When provided, webbs.facingX/Y is temporarily overridden for the synchronous
  // fire* call and restored before returning — fire methods read facing once at
  // activation, so the projectile/melee gets the right direction.

  activateWeapon(legSlot: number, webbs: Webbs, scene: Phaser.Scene, aim?: { dx: number, dy: number }): void {
    if (this.cooldowns[legSlot] > 0) return
    const weaponType = webbs.weaponSystem.getSlot(legSlot)
    if (weaponType === WeaponType.Empty) return

    const oldFx = webbs.facingX
    const oldFy = webbs.facingY
    if (aim) {
      const len = Math.hypot(aim.dx, aim.dy) || 1
      webbs.facingX = aim.dx / len
      webbs.facingY = aim.dy / len
    }

    try {
      switch (weaponType) {
        case WeaponType.Sword:        this.fireSword(legSlot, webbs, scene);  break
        case WeaponType.Axe:          this.fireAxe(legSlot, webbs, scene);    break
        case WeaponType.Bow:          this.fireBow(legSlot, webbs, scene);    break
        case WeaponType.BoxingGloves: this.fireGloves(legSlot, webbs, scene); break
      }
    } finally {
      if (aim) {
        webbs.facingX = oldFx
        webbs.facingY = oldFy
      }
    }
  }

  // ── Continuous flame ──────────────────────────────────────────────────────

  tickFlame(legSlot: number, webbs: Webbs, scene: Phaser.Scene, delta: number): void {
    if (webbs.energy <= 0) { this.stopFlame(); return }
    webbs.energy = Math.max(0, webbs.energy - FLAME_ENERGY_RATE)

    if (!this.flameEmitter || this.flameSlot !== legSlot) {
      this.stopFlame()
      this.flameSlot = legSlot
      this.flameEmitter = this.createFlameEmitter(webbs, scene)
    }

    webbs.playWeaponAnim(legSlot, 'spray', 80)

    // Follow Webbs
    this.flameEmitter.setPosition(webbs.x, webbs.y)
    const angleDeg = Phaser.Math.RadToDeg(Math.atan2(webbs.facingY, webbs.facingX))
    this.flameEmitter.setAngle(angleDeg)

    // Deal DPS — check every ~66ms (15 checks/sec)
    this.flameDmgTimer += delta
    if (this.flameDmgTimer >= 66) {
      this.flameDmgTimer = 0
      const dmgPerCheck = FLAME_DPS / 15
      const facingAngle = Math.atan2(webbs.facingY, webbs.facingX)
      for (const enemy of this.enemies) {
        if (enemy.isDead()) continue
        const dist = Phaser.Math.Distance.Between(webbs.x, webbs.y, enemy.x, enemy.y)
        if (dist > FLAME_RANGE) continue
        const toEnemy = Math.atan2(enemy.y - webbs.y, enemy.x - webbs.x)
        const diff    = Math.abs(Phaser.Math.Angle.Wrap(toEnemy - facingAngle))
        if (diff <= Phaser.Math.DegToRad(FLAME_CONE_DEG / 2)) {
          enemy.takeDamage(dmgPerCheck, WeakPointZone.Body)
        }
      }
    }
  }

  stopFlame(): void {
    if (this.flameEmitter) {
      this.flameEmitter.stop()
      this.flameEmitter = null
    }
    this.flameSlot    = -1
    this.flameDmgTimer = 0
  }

  // ── Sword — quick forward arc ─────────────────────────────────────────────

  private fireSword(slot: number, webbs: Webbs, scene: Phaser.Scene): void {
    if (webbs.stamina < SWORD_STAMINA) return
    webbs.stamina -= SWORD_STAMINA
    this.cooldowns[slot] = SWORD_COOLDOWN

    const arc = scene.add.graphics().setDepth(10)
    this.drawMeleeArc(arc, webbs, SWORD_RADIUS, SWORD_SWEEP_DEG, 0xaaaaff, 2)

    scene.tweens.add({
      targets:    arc,
      alpha:      0,
      duration:   200,
      onComplete: () => arc.destroy(),
    })

    webbs.playWeaponAnim(slot, 'stab', 200)
    this.hitsInArc(webbs, SWORD_RADIUS, SWORD_SWEEP_DEG, SWORD_DAMAGE, SWORD_KNOCKBACK)
  }

  // ── Axe — slow wide cleave ────────────────────────────────────────────────

  private fireAxe(slot: number, webbs: Webbs, scene: Phaser.Scene): void {
    if (webbs.stamina < AXE_STAMINA) return
    webbs.stamina -= AXE_STAMINA
    this.cooldowns[slot] = AXE_COOLDOWN

    const arc = scene.add.graphics().setDepth(10)
    this.drawMeleeArc(arc, webbs, AXE_RADIUS, AXE_SWEEP_DEG, 0xaa6633, 3)

    scene.tweens.add({
      targets:    arc,
      alpha:      0,
      duration:   320,
      onComplete: () => arc.destroy(),
    })

    webbs.playWeaponAnim(slot, 'swing', 320)
    this.hitsInArc(webbs, AXE_RADIUS, AXE_SWEEP_DEG, AXE_DAMAGE, AXE_KNOCKBACK)
  }

  // ── Bow ──────────────────────────────────────────────────────────────────

  private fireBow(slot: number, webbs: Webbs, scene: Phaser.Scene): void {
    // Web Bow fires thistles drawn from the player's inventory in the registry
    const inv: Record<string, number> = scene.registry.get('craftingInventory') ?? {}
    const thistleCount = inv['Thistle'] ?? 0
    if (thistleCount <= 0) {
      // Out of ammo — emit a tick so the HUD can flash a warning
      scene.events.emit('bowOutOfAmmo')
      return
    }
    if (webbs.stamina < BOW_STAMINA) return
    webbs.stamina -= BOW_STAMINA
    this.cooldowns[slot] = BOW_COOLDOWN

    // Consume one thistle and persist back to the registry
    inv['Thistle'] = thistleCount - 1
    scene.registry.set('craftingInventory', inv)

    const proj = scene.add.arc(webbs.x, webbs.y, BOW_PROJ_RADIUS, 0, 360, false, 0xcc99ff)
    proj.setStrokeStyle(1, 0xffffff, 0.6)
    proj.setDepth(10)
    scene.physics.add.existing(proj)
    const projBody = proj.body as Phaser.Physics.Arcade.Body
    projBody.setCircle(BOW_PROJ_RADIUS)
    projBody.setVelocity(webbs.facingX * BOW_SPEED, webbs.facingY * BOW_SPEED)

    webbs.playWeaponAnim(slot, 'draw', 220)
    this.projectiles.push({ arc: proj, isThistle: true })
  }

  // ── Boxing Gloves — quick straight jab, no arc sweep ─────────────────────

  private fireGloves(slot: number, webbs: Webbs, scene: Phaser.Scene): void {
    if (webbs.stamina < GLOVES_STAMINA) return
    webbs.stamina -= GLOVES_STAMINA
    this.cooldowns[slot] = GLOVES_COOLDOWN

    // Stab graphic — long thin line tipped with a small triangle
    const gfx = scene.add.graphics().setDepth(10)
    gfx.lineStyle(2, 0xeeddbb)
    const ex = webbs.x + webbs.facingX * GLOVES_RADIUS
    const ey = webbs.y + webbs.facingY * GLOVES_RADIUS
    gfx.lineBetween(webbs.x, webbs.y, ex, ey)
    gfx.fillStyle(0xeeddbb)
    gfx.fillCircle(ex, ey, 4)

    scene.tweens.add({
      targets:    gfx,
      alpha:      0,
      duration:   160,
      onComplete: () => gfx.destroy(),
    })

    webbs.playWeaponAnim(slot, 'stab', 180)

    const facingAngle = Math.atan2(webbs.facingY, webbs.facingX)
    const halfCone    = Phaser.Math.DegToRad(GLOVES_CONE_DEG / 2)
    let hit = false
    for (const enemy of this.enemies) {
      if (enemy.isDead()) continue
      const dist = Phaser.Math.Distance.Between(webbs.x, webbs.y, enemy.x, enemy.y)
      if (dist - enemy.bodyRadius > GLOVES_RADIUS) continue
      const toEnemy = Math.atan2(enemy.y - webbs.y, enemy.x - webbs.x)
      const diff    = Math.abs(Phaser.Math.Angle.Wrap(toEnemy - facingAngle))
      if (diff <= halfCone) {
        enemy.takeDamage(GLOVES_DAMAGE, WeakPointZone.Body)
        enemy.applyKnockback(webbs.facingX * GLOVES_KNOCKBACK, webbs.facingY * GLOVES_KNOCKBACK)
        hit = true
      }
    }

    if (hit) {
      scene.cameras.main.shake(GLOVES_SHAKE_DUR, GLOVES_SHAKE_INT)
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private drawMeleeArc(
    gfx: Phaser.GameObjects.Graphics,
    webbs: Webbs,
    radius: number,
    sweepDeg: number,
    color: number,
    lineWidth: number,
  ): void {
    const facingAngle = Math.atan2(webbs.facingY, webbs.facingX)
    const halfSweep   = Phaser.Math.DegToRad(sweepDeg / 2)
    const startAngle  = Phaser.Math.RadToDeg(facingAngle - halfSweep)
    const endAngle    = Phaser.Math.RadToDeg(facingAngle + halfSweep)

    gfx.lineStyle(lineWidth, color, 0.85)
    gfx.beginPath()
    gfx.arc(webbs.x, webbs.y, radius, Phaser.Math.DegToRad(startAngle), Phaser.Math.DegToRad(endAngle))
    gfx.strokePath()

    // Edge lines
    gfx.lineStyle(lineWidth - 1, color, 0.5)
    gfx.lineBetween(
      webbs.x, webbs.y,
      webbs.x + Math.cos(facingAngle - halfSweep) * radius,
      webbs.y + Math.sin(facingAngle - halfSweep) * radius,
    )
    gfx.lineBetween(
      webbs.x, webbs.y,
      webbs.x + Math.cos(facingAngle + halfSweep) * radius,
      webbs.y + Math.sin(facingAngle + halfSweep) * radius,
    )
  }

  private hitsInArc(
    webbs: Webbs,
    radius: number,
    sweepDeg: number,
    damage: number,
    knockback: number,
  ): void {
    const facingAngle = Math.atan2(webbs.facingY, webbs.facingX)
    const halfRad     = Phaser.Math.DegToRad(sweepDeg / 2)

    for (const enemy of this.enemies) {
      if (enemy.isDead()) continue
      const dist = Phaser.Math.Distance.Between(webbs.x, webbs.y, enemy.x, enemy.y)
      // Edge-of-range counts: if any part of the enemy's body is inside the swing,
      // it gets hit. Subtracting enemy bodyRadius from center-to-center distance
      // lets the axe connect when the player just barely clips the side of a beetle.
      if (dist - enemy.bodyRadius > radius) continue
      const toEnemy = Math.atan2(enemy.y - webbs.y, enemy.x - webbs.x)
      const diff    = Math.abs(Phaser.Math.Angle.Wrap(toEnemy - facingAngle))
      if (diff <= halfRad) {
        enemy.takeDamage(damage, WeakPointZone.Body)
        if (knockback > 0) {
          const kx = Math.cos(toEnemy) * knockback
          const ky = Math.sin(toEnemy) * knockback
          enemy.applyKnockback(kx, ky)
        }
      }
    }
  }

  private createFlameEmitter(
    webbs: Webbs,
    scene: Phaser.Scene,
  ): Phaser.GameObjects.Particles.ParticleEmitter {
    if (!scene.textures.exists('fire-particle')) {
      const g = scene.add.graphics()
      g.fillStyle(0xff8800, 1)
      g.fillCircle(4, 4, 4)
      g.generateTexture('fire-particle', 8, 8)
      g.destroy()
    }

    const angleDeg = Phaser.Math.RadToDeg(Math.atan2(webbs.facingY, webbs.facingX))
    const emitter = scene.add.particles(webbs.x, webbs.y, 'fire-particle', {
      speed:     { min: 80, max: 200 },
      angle:     { min: angleDeg - FLAME_CONE_DEG / 2, max: angleDeg + FLAME_CONE_DEG / 2 },
      lifespan:  380,
      scale:     { start: 0.85, end: 0 },
      alpha:     { start: 0.9, end: 0 },
      frequency: 25,
      blendMode: Phaser.BlendModes.ADD,
    })
    emitter.setDepth(10)
    return emitter
  }

  private tickProjectiles(): void {
    const toRemove: Projectile[] = []

    for (const proj of this.projectiles) {
      const { arc } = proj
      if (!arc.active) { toRemove.push(proj); continue }

      // Out of world bounds — thistle drops at last visible position so it can be picked back up
      const outOfWorld =
        arc.x < 0 || arc.x > this.worldW ||
        arc.y < 0 || arc.y > this.worldH
      if (outOfWorld) {
        const lx = Phaser.Math.Clamp(arc.x, 8, this.worldW  - 8)
        const ly = Phaser.Math.Clamp(arc.y, 8, this.worldH - 8)
        if (proj.isThistle) arc.scene.events.emit('thistleDropped', { x: lx, y: ly })
        arc.destroy()
        toRemove.push(proj)
        continue
      }

      // Enemy hits — checked against body edges so an arrow grazing the side counts
      let hit = false
      for (const enemy of this.enemies) {
        if (enemy.isDead()) continue
        const dist = Phaser.Math.Distance.Between(arc.x, arc.y, enemy.x, enemy.y)
        if (dist - enemy.bodyRadius < BOW_PROJ_RADIUS + 4) {
          if (proj.isThistle) enemy.addStuckThistle()
          enemy.takeDamage(BOW_DAMAGE, WeakPointZone.Body)
          // Knockback in the projectile's direction of travel
          const body = arc.body as Phaser.Physics.Arcade.Body
          const vlen = Math.hypot(body.velocity.x, body.velocity.y) || 1
          enemy.applyKnockback(
            (body.velocity.x / vlen) * BOW_KNOCKBACK,
            (body.velocity.y / vlen) * BOW_KNOCKBACK,
          )
          arc.destroy()
          toRemove.push(proj)
          hit = true
          break
        }
      }
      if (hit) continue
    }

    this.projectiles = this.projectiles.filter(p => !toRemove.includes(p))
  }
}
