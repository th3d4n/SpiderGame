import Phaser from 'phaser'
import type Enemy from '../entities/Enemy'
import Webbs from '../entities/Webbs'
import { WeaponType } from './WeaponSystem'

// Web Launcher — fires a silk strand toward an aim direction (mouse or facing).
// Auto-anchors / auto-pulls based on what it hits:
//   - Pickup  → strand reels the pickup toward the player; on contact it auto-collects.
//   - Enemy   → light enemies are yanked to the player; heavy enemies pull the player.
//   - Wall    → briefly yanks the player toward the wall, then stays attached as an
//               anchor (used by the boss fight to resist suction).
//   - Nothing → after max range the strand recalls back to the player and releases.

const PROJECTILE_SPEED      = 700
const MAX_RANGE             = 480
const PULL_DURATION_MS      = 350
const PULL_VELOCITY         = 900
const IDLE_RELEASE_MS       = 4500
const COOLDOWN_MS           = 220
const STAMINA_COST          = 8

// Anything with this much "mass" or more pulls the player instead of being pulled.
const PLAYER_PULL_MASS_THRESHOLD = 0.5

// How close a pulled pickup needs to be before it auto-collects.
const PICKUP_REACH = 36

// Recall-phase release radius (when the recalled projectile gets back to player).
const RECALL_RELEASE = 18

export interface PullablePickup {
  x: number
  y: number
  active: boolean
  collect: () => unknown
}

type Target =
  | { kind: 'enemy',  ref: Enemy }
  | { kind: 'wall',   x: number, y: number }
  | { kind: 'pickup', ref: PullablePickup }

interface WebState {
  projectile?: { arc: Phaser.GameObjects.Arc, vx: number, vy: number, traveled: number, recalling: boolean }
  attached?:   Target
  line?:       Phaser.GameObjects.Graphics
  age:         number
  pulling:     boolean
  pullElapsed: number
}

export class WebLauncherSystem {
  private state:           WebState | null = null
  private cooldown         = 0
  private enemies:         Enemy[] = []
  private worldW           = 6000
  private worldH           = 3000
  private wallHitTest:     (x: number, y: number) => boolean = () => false
  private pickupHitTest:   (x: number, y: number) => PullablePickup | null = () => null

  setEnemies(enemies: Enemy[]): void   { this.enemies = enemies }
  setWorldBounds(w: number, h: number): void { this.worldW = w; this.worldH = h }
  setWallHitTest(fn: (x: number, y: number) => boolean): void { this.wallHitTest = fn }
  setPickupHitTest(fn: (x: number, y: number) => PullablePickup | null): void { this.pickupHitTest = fn }

  private equippedSlot(webbs: Webbs): number {
    for (let i = 0; i < 8; i++) {
      if (webbs.weaponSystem.getSlot(i) === WeaponType.WebLauncher) return i
    }
    return -1
  }

  isEquipped(webbs: Webbs): boolean { return this.equippedSlot(webbs) >= 0 }
  isAttachedToWall(): boolean       { return this.state?.attached?.kind === 'wall' }
  isAttached(): boolean             { return !!this.state?.attached }

  // Called whenever Q is pressed. If a web is in flight or attached, cancel it. Otherwise fire.
  onQPressed(scene: Phaser.Scene, webbs: Webbs, aim?: { dx: number, dy: number }): void {
    const slot = this.equippedSlot(webbs)
    if (slot < 0) return

    if (this.state) {
      this.release(scene)
      return
    }

    if (this.cooldown > 0) return
    if (webbs.stamina <= 0) return
    webbs.stamina = Math.max(0, webbs.stamina - STAMINA_COST)

    this.fire(scene, webbs, slot, aim)
    this.cooldown = COOLDOWN_MS
  }

  update(scene: Phaser.Scene, webbs: Webbs, delta: number): void {
    if (this.cooldown > 0) this.cooldown -= delta
    if (!this.state) return

    this.state.age += delta

    // Travel phase
    if (this.state.projectile) {
      const p = this.state.projectile
      p.arc.x += p.vx * (delta / 1000)
      p.arc.y += p.vy * (delta / 1000)
      p.traveled += Math.hypot(p.vx, p.vy) * (delta / 1000)

      if (p.recalling) {
        // Aim the projectile back at the player every frame so it tracks
        const angle = Phaser.Math.Angle.Between(p.arc.x, p.arc.y, webbs.x, webbs.y)
        p.vx = Math.cos(angle) * PROJECTILE_SPEED
        p.vy = Math.sin(angle) * PROJECTILE_SPEED

        if (Phaser.Math.Distance.Between(p.arc.x, p.arc.y, webbs.x, webbs.y) < RECALL_RELEASE) {
          this.release(scene)
          return
        }
        this.drawLine(scene, webbs)
        return
      }

      // Pickup
      const pickupHit = this.pickupHitTest(p.arc.x, p.arc.y)
      if (pickupHit) {
        this.state.attached = { kind: 'pickup', ref: pickupHit }
        this.landProjectile(scene, pickupHit.x, pickupHit.y)
        this.startPull(webbs)
        this.drawLine(scene, webbs)
        return
      }

      // Enemy
      for (const e of this.enemies) {
        if (e.isDead()) continue
        if (Phaser.Math.Distance.Between(p.arc.x, p.arc.y, e.x, e.y) < 28) {
          this.state.attached = { kind: 'enemy', ref: e }
          this.landProjectile(scene, e.x, e.y)
          this.startPull(webbs)
          this.drawLine(scene, webbs)
          return
        }
      }

      // Wall
      if (this.wallHitTest(p.arc.x, p.arc.y)) {
        this.state.attached = { kind: 'wall', x: p.arc.x, y: p.arc.y }
        this.landProjectile(scene, p.arc.x, p.arc.y)
        this.startPull(webbs)
        this.drawLine(scene, webbs)
        return
      }

      // Max range or out of world → switch to recall (no attachment)
      const outOfWorld = p.arc.x < 0 || p.arc.x > this.worldW || p.arc.y < 0 || p.arc.y > this.worldH
      if (p.traveled > MAX_RANGE || outOfWorld) {
        p.recalling = true
        p.traveled = 0
      }

      this.drawLine(scene, webbs)
      return
    }

    // Active pull
    if (this.state.attached && this.state.pulling) {
      this.state.pullElapsed += delta
      this.applyPullVelocity(webbs, delta)

      // Pickups auto-collect when close enough — release the web on collect
      if (this.state.attached.kind === 'pickup') {
        const pk = this.state.attached.ref
        if (!pk.active || Phaser.Math.Distance.Between(pk.x, pk.y, webbs.x, webbs.y) < PICKUP_REACH) {
          if (pk.active) pk.collect()
          this.release(scene)
          return
        }
      }

      if (this.state.pullElapsed >= PULL_DURATION_MS) {
        // Walls stay attached after the yank so the player can hold the anchor.
        // Enemies/pickups release after the yank completes.
        this.state.pulling = false
        if (this.state.attached.kind !== 'wall') {
          this.release(scene)
          return
        }
      }
    }

    // Auto-release after idle window
    if (this.state.attached && !this.state.pulling && this.state.age > IDLE_RELEASE_MS) {
      this.release(scene)
      return
    }

    this.drawLine(scene, webbs)
  }

  private fire(scene: Phaser.Scene, webbs: Webbs, slot: number, aim?: { dx: number, dy: number }): void {
    let dx = webbs.facingX
    let dy = webbs.facingY
    if (aim) {
      const len = Math.hypot(aim.dx, aim.dy) || 1
      dx = aim.dx / len
      dy = aim.dy / len
    }
    const arc = scene.add.arc(webbs.x, webbs.y, 5, 0, 360, false, 0xeeeeff).setDepth(10)
    arc.setStrokeStyle(1, 0xaaaacc)

    this.state = {
      projectile:  { arc, vx: dx * PROJECTILE_SPEED, vy: dy * PROJECTILE_SPEED, traveled: 0, recalling: false },
      age:         0,
      pulling:     false,
      pullElapsed: 0,
    }
    webbs.playWeaponAnim(slot, 'draw', 240)
  }

  private landProjectile(scene: Phaser.Scene, x: number, y: number): void {
    if (!this.state?.projectile) return
    this.state.projectile.arc.destroy()
    this.state.projectile = undefined
    const flash = scene.add.arc(x, y, 10, 0, 360, false, 0xffffff, 0.6).setDepth(11)
    scene.tweens.add({ targets: flash, alpha: 0, scaleX: 2, scaleY: 2, duration: 220, onComplete: () => flash.destroy() })
  }

  private startPull(webbs: Webbs): void {
    if (!this.state?.attached) return
    this.state.pulling = true
    this.state.pullElapsed = 0
    this.applyPullVelocity(webbs, 0)
  }

  private applyPullVelocity(webbs: Webbs, delta: number): void {
    if (!this.state?.attached) return
    const target = this.state.attached

    if (target.kind === 'enemy') {
      const e = target.ref
      const heavy = e.knockbackResist >= PLAYER_PULL_MASS_THRESHOLD
      if (heavy) {
        const angle = Phaser.Math.Angle.Between(webbs.x, webbs.y, e.x, e.y)
        webbs.pb.setVelocity(Math.cos(angle) * PULL_VELOCITY, Math.sin(angle) * PULL_VELOCITY)
      } else {
        const angle = Phaser.Math.Angle.Between(e.x, e.y, webbs.x, webbs.y)
        e.pb.setVelocity(Math.cos(angle) * PULL_VELOCITY, Math.sin(angle) * PULL_VELOCITY)
      }
    } else if (target.kind === 'wall') {
      const angle = Phaser.Math.Angle.Between(webbs.x, webbs.y, target.x, target.y)
      webbs.pb.setVelocity(Math.cos(angle) * PULL_VELOCITY, Math.sin(angle) * PULL_VELOCITY)
    } else if (target.kind === 'pickup') {
      // Pickup has no body — translate its container position directly toward the player
      const pk = target.ref
      const angle = Phaser.Math.Angle.Between(pk.x, pk.y, webbs.x, webbs.y)
      const step  = PULL_VELOCITY * (delta / 1000)
      pk.x += Math.cos(angle) * step
      pk.y += Math.sin(angle) * step
    }
  }

  private drawLine(scene: Phaser.Scene, webbs: Webbs): void {
    if (!this.state) return
    if (!this.state.line) {
      this.state.line = scene.add.graphics().setDepth(9)
    }
    const g = this.state.line
    g.clear()
    g.lineStyle(1.5, 0xeeeeff, 0.85)

    let ex = webbs.x, ey = webbs.y
    if (this.state.projectile) {
      ex = this.state.projectile.arc.x
      ey = this.state.projectile.arc.y
    } else if (this.state.attached) {
      const a = this.state.attached
      if      (a.kind === 'enemy')  { ex = a.ref.x; ey = a.ref.y }
      else if (a.kind === 'wall')   { ex = a.x;     ey = a.y     }
      else                          { ex = a.ref.x; ey = a.ref.y }
    }
    g.lineBetween(webbs.x, webbs.y, ex, ey)
    g.fillStyle(0xeeeeff, 1)
    g.fillCircle(ex, ey, 3)
  }

  release(scene: Phaser.Scene): void {
    if (!this.state) return
    if (this.state.projectile) this.state.projectile.arc.destroy()
    if (this.state.line)       this.state.line.destroy()
    this.state = null
    void scene
  }

  forceRelease(scene: Phaser.Scene): void { this.release(scene) }
}
