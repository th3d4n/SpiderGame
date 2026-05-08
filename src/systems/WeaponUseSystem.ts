import Phaser from 'phaser'
import { WeaponType } from './WeaponSystem'
import { WeakPointZone } from '../entities/Enemy'
import Enemy from '../entities/Enemy'
import Webbs from '../entities/Webbs'

const SWORD_RADIUS      = 70
const SWORD_SWEEP_DEG   = 90
const SWORD_DAMAGE      = 15
const SWORD_STAMINA     = 10
const SWORD_COOLDOWN    = 280

const AXE_RADIUS        = 60
const AXE_SWEEP_DEG     = 120
const AXE_DAMAGE        = 25
const AXE_STAMINA       = 18
const AXE_COOLDOWN      = 400
const AXE_KNOCKBACK     = 380

const BOW_SPEED         = 400
const BOW_DAMAGE        = 20
const BOW_STAMINA       = 12
const BOW_COOLDOWN      = 350
const BOW_PROJ_RADIUS   = 6

const GLOVES_RADIUS     = 50
const GLOVES_DAMAGE     = 30
const GLOVES_STAMINA    = 15
const GLOVES_COOLDOWN   = 220
const GLOVES_KNOCKBACK  = 500
const GLOVES_SHAKE_INT  = 0.01
const GLOVES_SHAKE_DUR  = 100

const FLAME_RANGE       = 120
const FLAME_CONE_DEG    = 45
const FLAME_ENERGY_RATE = 2     // per frame
const FLAME_DPS         = 15    // damage per second → checked each tick

interface Projectile {
  arc: Phaser.GameObjects.Arc
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

  activateWeapon(legSlot: number, webbs: Webbs, scene: Phaser.Scene): void {
    if (this.cooldowns[legSlot] > 0) return
    const weaponType = webbs.weaponSystem.getSlot(legSlot)

    switch (weaponType) {
      case WeaponType.Sword:        this.fireSword(legSlot, webbs, scene);  break
      case WeaponType.Axe:          this.fireAxe(legSlot, webbs, scene);    break
      case WeaponType.Bow:          this.fireBow(legSlot, webbs, scene);    break
      case WeaponType.BoxingGloves: this.fireGloves(legSlot, webbs, scene); break
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

  // ── Sword ────────────────────────────────────────────────────────────────

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

    this.hitsInArc(webbs, SWORD_RADIUS, SWORD_SWEEP_DEG, SWORD_DAMAGE, 0)
  }

  // ── Axe ──────────────────────────────────────────────────────────────────

  private fireAxe(slot: number, webbs: Webbs, scene: Phaser.Scene): void {
    if (webbs.stamina < AXE_STAMINA) return
    webbs.stamina -= AXE_STAMINA
    this.cooldowns[slot] = AXE_COOLDOWN

    const arc = scene.add.graphics().setDepth(10)
    this.drawMeleeArc(arc, webbs, AXE_RADIUS, AXE_SWEEP_DEG, 0xaa6633, 3)

    scene.tweens.add({
      targets:    arc,
      alpha:      0,
      duration:   300,
      onComplete: () => arc.destroy(),
    })

    this.hitsInArc(webbs, AXE_RADIUS, AXE_SWEEP_DEG, AXE_DAMAGE, AXE_KNOCKBACK)
  }

  // ── Bow ──────────────────────────────────────────────────────────────────

  private fireBow(slot: number, webbs: Webbs, scene: Phaser.Scene): void {
    if (webbs.stamina < BOW_STAMINA) return
    webbs.stamina -= BOW_STAMINA
    this.cooldowns[slot] = BOW_COOLDOWN

    const proj = scene.add.arc(webbs.x, webbs.y, BOW_PROJ_RADIUS, 0, 360, false, 0x44aa44)
    proj.setDepth(10)
    scene.physics.add.existing(proj)
    const projBody = proj.body as Phaser.Physics.Arcade.Body
    projBody.setCircle(BOW_PROJ_RADIUS)
    projBody.setVelocity(webbs.facingX * BOW_SPEED, webbs.facingY * BOW_SPEED)

    this.projectiles.push({ arc: proj })
  }

  // ── Boxing Gloves ─────────────────────────────────────────────────────────

  private fireGloves(slot: number, webbs: Webbs, scene: Phaser.Scene): void {
    if (webbs.stamina < GLOVES_STAMINA) return
    webbs.stamina -= GLOVES_STAMINA
    this.cooldowns[slot] = GLOVES_COOLDOWN

    // Punch graphic — short line in facing direction
    const gfx = scene.add.graphics().setDepth(10)
    gfx.lineStyle(4, 0xff4444)
    const ex = webbs.x + webbs.facingX * GLOVES_RADIUS
    const ey = webbs.y + webbs.facingY * GLOVES_RADIUS
    gfx.lineBetween(webbs.x, webbs.y, ex, ey)
    gfx.fillStyle(0xff4444)
    gfx.fillCircle(ex, ey, 8)

    scene.tweens.add({
      targets:    gfx,
      alpha:      0,
      duration:   180,
      onComplete: () => gfx.destroy(),
    })

    const facingAngle = Math.atan2(webbs.facingY, webbs.facingX)
    let hit = false
    for (const enemy of this.enemies) {
      if (enemy.isDead()) continue
      const dist = Phaser.Math.Distance.Between(webbs.x, webbs.y, enemy.x, enemy.y)
      if (dist > GLOVES_RADIUS + 20) continue
      const toEnemy = Math.atan2(enemy.y - webbs.y, enemy.x - webbs.x)
      const diff    = Math.abs(Phaser.Math.Angle.Wrap(toEnemy - facingAngle))
      if (diff <= Phaser.Math.DegToRad(60)) {
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
      if (dist > radius) continue
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

      // Out of world bounds
      if (
        arc.x < 0 || arc.x > this.worldW ||
        arc.y < 0 || arc.y > this.worldH
      ) {
        arc.destroy()
        toRemove.push(proj)
        continue
      }

      // Enemy hits
      let hit = false
      for (const enemy of this.enemies) {
        if (enemy.isDead()) continue
        const dist = Phaser.Math.Distance.Between(arc.x, arc.y, enemy.x, enemy.y)
        if (dist < BOW_PROJ_RADIUS + 20) {
          enemy.takeDamage(BOW_DAMAGE, WeakPointZone.Body)
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
