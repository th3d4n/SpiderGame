import Phaser from 'phaser'
import type Enemy from '../entities/Enemy'
import Webbs from '../entities/Webbs'
import { WeaponType } from './WeaponSystem'

// The Web Launcher fires a silk strand in the player's facing direction. It
// attaches to whatever it hits first (enemy, pickup, or wall). A second Q press
// within the double-tap window triggers a pull:
//   - Small/movable target → target is yanked to the player
//   - Heavy or immovable target (wall, boss) → player is yanked to the target
// A single Q with no follow-up releases after IDLE_RELEASE_MS.

const PROJECTILE_SPEED      = 700
const MAX_RANGE             = 480
const DOUBLE_TAP_WINDOW_MS  = 380
const PULL_DURATION_MS      = 350
const PULL_VELOCITY         = 900
const IDLE_RELEASE_MS       = 4500
const COOLDOWN_MS           = 220
const STAMINA_COST          = 8

// Anything with this much "mass" or more gets treated as immovable for pull purposes
const PLAYER_PULL_MASS_THRESHOLD = 0.5

type Target =
  | { kind: 'enemy',   ref: Enemy }
  | { kind: 'wall',    x: number, y: number }       // static world point
  | { kind: 'object',  ref: Phaser.GameObjects.GameObject & { x: number, y: number, body?: Phaser.Physics.Arcade.Body } }

interface WebState {
  projectile?: { arc: Phaser.GameObjects.Arc, vx: number, vy: number, traveled: number }
  attached?:   Target
  line?:       Phaser.GameObjects.Graphics
  age:         number
  pulling:     boolean
  pullElapsed: number
}

export class WebLauncherSystem {
  private state:        WebState | null = null
  private lastFireTime  = -Infinity
  private cooldown      = 0
  private enemies:      Enemy[] = []
  private worldW        = 6000
  private worldH        = 3000
  private wallHitTest:  (x: number, y: number) => boolean = () => false

  setEnemies(enemies: Enemy[]): void   { this.enemies = enemies }
  setWorldBounds(w: number, h: number): void { this.worldW = w; this.worldH = h }
  // Scene supplies a function that returns true when a point is inside a wall
  setWallHitTest(fn: (x: number, y: number) => boolean): void { this.wallHitTest = fn }

  // Returns the slot index of any equipped Web Launcher, or -1
  private equippedSlot(webbs: Webbs): number {
    for (let i = 0; i < 8; i++) {
      if (webbs.weaponSystem.getSlot(i) === WeaponType.WebLauncher) return i
    }
    return -1
  }

  isEquipped(webbs: Webbs): boolean {
    return this.equippedSlot(webbs) >= 0
  }

  isAttachedToWall(): boolean {
    return this.state?.attached?.kind === 'wall'
  }

  isAttached(): boolean {
    return !!this.state?.attached
  }

  // Called whenever Q is pressed (JustDown)
  onQPressed(scene: Phaser.Scene, webbs: Webbs): void {
    const slot = this.equippedSlot(webbs)
    if (slot < 0) return
    const now = scene.time.now

    // If we already have an attached web and we're inside the double-tap window, pull.
    if (this.state?.attached && (now - this.lastFireTime) < DOUBLE_TAP_WINDOW_MS) {
      this.startPull(webbs)
      this.lastFireTime = now
      return
    }

    if (this.cooldown > 0) return
    if (webbs.stamina < STAMINA_COST) return
    webbs.stamina -= STAMINA_COST

    // Cancel any prior shot and start a new one
    this.release(scene)
    this.fire(scene, webbs, slot)
    this.cooldown = COOLDOWN_MS
    this.lastFireTime = now
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

      // Hit-tests
      let landed = false

      // Enemy
      for (const e of this.enemies) {
        if (e.isDead()) continue
        if (Phaser.Math.Distance.Between(p.arc.x, p.arc.y, e.x, e.y) < 28) {
          this.state.attached = { kind: 'enemy', ref: e }
          landed = true
          break
        }
      }

      // Wall
      if (!landed && this.wallHitTest(p.arc.x, p.arc.y)) {
        this.state.attached = { kind: 'wall', x: p.arc.x, y: p.arc.y }
        landed = true
      }

      // Reached max range or world edge — stick where it landed as a temporary anchor.
      // (Web is always "sticky" — it stops mid-air at max range rather than vanishing.)
      const outOfWorld = p.arc.x < 0 || p.arc.x > this.worldW || p.arc.y < 0 || p.arc.y > this.worldH
      if (!landed && (p.traveled > MAX_RANGE || outOfWorld)) {
        const lx = Phaser.Math.Clamp(p.arc.x, 4, this.worldW - 4)
        const ly = Phaser.Math.Clamp(p.arc.y, 4, this.worldH - 4)
        this.state.attached = { kind: 'wall', x: lx, y: ly }
        landed = true
      }

      if (landed) {
        p.arc.destroy()
        this.state.projectile = undefined
        // Brief impact flash at landing point
        const flashX = this.state.attached!.kind === 'enemy'
          ? (this.state.attached as Extract<Target, { kind: 'enemy' }>).ref.x
          : (this.state.attached as Extract<Target, { kind: 'wall' }>).x
        const flashY = this.state.attached!.kind === 'enemy'
          ? (this.state.attached as Extract<Target, { kind: 'enemy' }>).ref.y
          : (this.state.attached as Extract<Target, { kind: 'wall' }>).y
        const flash = scene.add.arc(flashX, flashY, 10, 0, 360, false, 0xffffff, 0.6).setDepth(11)
        scene.tweens.add({ targets: flash, alpha: 0, scaleX: 2, scaleY: 2, duration: 220, onComplete: () => flash.destroy() })
      }
    }

    // Active pull
    if (this.state.attached && this.state.pulling) {
      this.state.pullElapsed += delta
      this.applyPullVelocity(webbs)
      if (this.state.pullElapsed >= PULL_DURATION_MS) {
        this.release(scene)
        return
      }
    }

    // Auto-release attached webs after the idle window
    if (this.state.attached && !this.state.pulling && this.state.age > IDLE_RELEASE_MS) {
      this.release(scene)
      return
    }

    // Draw the strand from player to current endpoint
    this.drawLine(scene, webbs)
  }

  private fire(scene: Phaser.Scene, webbs: Webbs, slot: number): void {
    const vx = webbs.facingX * PROJECTILE_SPEED
    const vy = webbs.facingY * PROJECTILE_SPEED
    const arc = scene.add.arc(webbs.x, webbs.y, 5, 0, 360, false, 0xeeeeff).setDepth(10)
    arc.setStrokeStyle(1, 0xaaaacc)

    this.state = {
      projectile:  { arc, vx, vy, traveled: 0 },
      age:         0,
      pulling:     false,
      pullElapsed: 0,
    }
    webbs.playWeaponAnim(slot, 'draw', 240)
  }

  private startPull(webbs: Webbs): void {
    if (!this.state?.attached) return
    this.state.pulling = true
    this.state.pullElapsed = 0
    // Immediate kick — applyPullVelocity will keep refreshing it
    this.applyPullVelocity(webbs)
  }

  // Decide whether the target moves or the player moves, then set velocity.
  private applyPullVelocity(webbs: Webbs): void {
    if (!this.state?.attached) return
    const target = this.state.attached

    if (target.kind === 'enemy') {
      const e = target.ref
      const heavy = e.knockbackResist >= PLAYER_PULL_MASS_THRESHOLD
      if (heavy) {
        // Pull player to enemy
        const angle = Phaser.Math.Angle.Between(webbs.x, webbs.y, e.x, e.y)
        webbs.pb.setVelocity(Math.cos(angle) * PULL_VELOCITY, Math.sin(angle) * PULL_VELOCITY)
      } else {
        // Yank enemy to player
        const angle = Phaser.Math.Angle.Between(e.x, e.y, webbs.x, webbs.y)
        e.pb.setVelocity(Math.cos(angle) * PULL_VELOCITY, Math.sin(angle) * PULL_VELOCITY)
      }
    } else if (target.kind === 'wall') {
      // Walls always pull the player
      const angle = Phaser.Math.Angle.Between(webbs.x, webbs.y, target.x, target.y)
      webbs.pb.setVelocity(Math.cos(angle) * PULL_VELOCITY, Math.sin(angle) * PULL_VELOCITY)
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
      if (a.kind === 'enemy')      { ex = a.ref.x; ey = a.ref.y }
      else if (a.kind === 'wall')  { ex = a.x;     ey = a.y     }
      else                         { ex = a.ref.x; ey = a.ref.y }
    }
    g.lineBetween(webbs.x, webbs.y, ex, ey)
    // Anchor dot
    g.fillStyle(0xeeeeff, 1)
    g.fillCircle(ex, ey, 3)
  }

  release(scene: Phaser.Scene): void {
    if (!this.state) return
    if (this.state.projectile) this.state.projectile.arc.destroy()
    if (this.state.line)       this.state.line.destroy()
    this.state = null
    // scene param kept for future cleanup hooks (sound, particles)
    void scene
  }

  // Convenience for scenes that want to forcibly end the web (e.g. on shutdown)
  forceRelease(scene: Phaser.Scene): void { this.release(scene) }
}
