import * as THREE from 'three'
import type { Enemy3D } from '../entities/Enemy3D'
import type { Webbs3D } from '../entities/Webbs3D'
import { WeaponType } from './WeaponSystem'
import { audio } from './AudioManager'
import { physicsWorld, type CollisionBody, type Rope } from '../core/PhysicsWorld'

// ─── Silk line tuning (authored for Webbs at scale 1; × his zone scale `s`) ────
// The web is a real rope (physicsWorld.addRope): reeling shortens it and the
// constraint does the pulling, so sideways input swings around the anchor,
// mass decides who gets dragged (light enemies come to you, heavy ones drag you),
// and walls/contacts still block the motion.
const PROJECTILE_SPEED = 10.0  // wu/s
const PROJECTILE_R     = 0.15  // swept-ball radius for hit tests
const MAX_RANGE        = 4.8   // wu — beyond this the strand recalls
const REEL_SPEED       = 9.0   // wu/s — top reel-in rate
const REEL_RAMP        = 0.12  // s — reel eases up to speed (no instant yank)
const PULL_DURATION    = 0.35  // s of reeling per attach
const IDLE_RELEASE     = 4.5   // s — a held wall line lets go on its own
const RELEASE_CARRY    = 0.8   // share of rope-driven velocity kept as momentum on release
const COOLDOWN         = 0.22  // s
const STAMINA_COST     = 8
const PICKUP_REACH     = 0.36  // wu — auto-collect distance
const RECALL_RELEASE   = 0.18  // wu — recalled glob reaches the spinneret
const STUN_DURATION    = 1.2   // s of stagger forced on any enemy hit (Round 6 Issue 3)
const LINE_POINTS      = 20

export interface PullablePickup3D {
  x: number
  z: number
  active: boolean
  collect: () => void
}

type Target3D =
  | { kind: 'enemy';  ref: Enemy3D }
  | { kind: 'body';   ref: CollisionBody }            // any other dynamic body (rocks…)
  | { kind: 'wall';   x: number; z: number; body: CollisionBody | null }
  | { kind: 'pickup'; ref: PullablePickup3D }

interface WebState3D {
  projectile?: {
    mesh:          THREE.Mesh
    vx:            number
    vz:            number
    traveled:      number
    recalling:     boolean
    homingTarget?: Enemy3D | null   // nearest enemy in 60° cone at fire time
  }
  attached?:   Target3D
  rope?:       Rope
  line:        THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>
  age:         number
  pulling:     boolean
  pullElapsed: number
  twang:       number   // decaying vibration amplitude after the line snaps taut
}

interface SilkWrap {
  mesh:  THREE.Mesh
  timer: number
}

const _spin = new THREE.Vector3()
const _tip  = new THREE.Vector3()

const HOMING_RATE = 17.3   // 1/s — steering toward a locked target (≈ 25 %/frame at 60 Hz)

export class WebLauncherSystem3D {
  private state:         WebState3D | null = null
  private cooldown       = 0
  private enemies:       Enemy3D[] = []
  private pickupHitTest: (x: number, z: number) => PullablePickup3D | null = () => null
  private threeScene:    THREE.Scene
  private silkWraps:     Map<Enemy3D, SilkWrap> = new Map()
  private s              = 1   // Webbs' scale when the current web was fired

  constructor(threeScene: THREE.Scene) {
    this.threeScene = threeScene
  }

  setEnemies(enemies: Enemy3D[]):  void { this.enemies = enemies }
  setPickupHitTest(fn: (x: number, z: number) => PullablePickup3D | null): void { this.pickupHitTest = fn }

  isAttachedToWall(): boolean { return this.state?.attached?.kind === 'wall' && !!this.state.rope }
  isActive():         boolean { return this.state !== null }

  // Q pressed: cancel active web or fire a new one
  onQPressed(webbs: Webbs3D, aim?: { dx: number; dz: number }): void {
    if (!webbs.hasWebLauncher) return

    if (this.state) {
      this.release()
      return
    }

    if (this.cooldown > 0 || webbs.stamina <= 0) return
    webbs.stamina = Math.max(0, webbs.stamina - STAMINA_COST)
    this.fire(webbs, aim)
    this.cooldown = COOLDOWN
  }

  update(webbs: Webbs3D, delta: number): void {
    if (this.cooldown > 0) this.cooldown -= delta
    this.tickSilkWraps(delta)
    if (!this.state) return
    const st = this.state

    st.age   += delta
    st.twang *= Math.exp(-delta * 9)

    if (st.projectile) {
      this.tickProjectile(webbs, delta)
      if (this.state) this.updateLine(webbs)
      return
    }

    if (st.rope?.broken) { this.release(); return }   // target died / was removed
    if (st.attached && this.lineBlocked(webbs, st.attached)) { this.release(); return }

    // Reel phase: the rope shortens (eased up to speed) and the constraint pulls
    if (st.attached && st.pulling) {
      st.pullElapsed += delta
      const ramp = Math.min(1, st.pullElapsed / REEL_RAMP)
      if (st.rope) st.rope.reelSpeed = REEL_SPEED * this.s * ramp * ramp

      if (st.attached.kind === 'pickup') {
        const pk = st.attached.ref
        const dx = webbs.collisionBody.x - pk.x
        const dz = webbs.collisionBody.z - pk.z
        const d  = Math.hypot(dx, dz)
        if (!pk.active || d < PICKUP_REACH * this.s) {
          if (pk.active) pk.collect()
          this.release()
          return
        }
        const step = Math.min(d, REEL_SPEED * this.s * ramp * delta)
        pk.x += (dx / d) * step
        pk.z += (dz / d) * step
      }

      const reachedEnd = st.rope ? st.rope.length <= st.rope.minLength + 1e-3 : false
      if (st.pullElapsed >= PULL_DURATION || reachedEnd) {
        // Bodies yanked by the line let go mid-motion and keep sliding (release
        // while still pulling → momentum carry); wall lines stay up as a leash.
        if (st.attached.kind !== 'wall') { this.release(); return }
        st.pulling = false
        if (st.rope) st.rope.reelSpeed = 0
        audio.stopLoop('web_pull_loop')
      }
    }

    // A held wall line lets go after a while
    if (st.attached && !st.pulling && st.age > IDLE_RELEASE) {
      this.release()
      return
    }

    this.updateLine(webbs)
  }

  private tickProjectile(webbs: Webbs3D, delta: number): void {
    if (!this.state?.projectile) return
    const p = this.state.projectile

    if (p.recalling) {
      const dx = webbs.collisionBody.x - p.mesh.position.x
      const dz = webbs.collisionBody.z - p.mesh.position.z
      const d  = Math.hypot(dx, dz)
      if (d < RECALL_RELEASE * this.s + PROJECTILE_SPEED * this.s * delta) { this.release(); return }
      p.vx = (dx / d) * PROJECTILE_SPEED * this.s
      p.vz = (dz / d) * PROJECTILE_SPEED * this.s
      p.mesh.position.x += p.vx * delta
      p.mesh.position.z += p.vz * delta
      return
    }

    // Homing: steer toward locked-on target.  Blend weight is per-second
    // (≡ the old 25 % per frame at 60 Hz), so 144 Hz screens don't curve harder.
    if (p.homingTarget && !p.homingTarget.isDead()) {
      const hdx = p.homingTarget.collisionBody.x - p.mesh.position.x
      const hdz = p.homingTarget.collisionBody.z - p.mesh.position.z
      const hlen = Math.hypot(hdx, hdz) || 1
      const curX = p.vx / (PROJECTILE_SPEED * this.s)
      const curZ = p.vz / (PROJECTILE_SPEED * this.s)
      const k = 1 - Math.exp(-HOMING_RATE * delta)
      const blendX = curX * (1 - k) + (hdx / hlen) * k
      const blendZ = curZ * (1 - k) + (hdz / hlen) * k
      const blen   = Math.hypot(blendX, blendZ) || 1
      p.vx = (blendX / blen) * PROJECTILE_SPEED * this.s
      p.vz = (blendZ / blen) * PROJECTILE_SPEED * this.s
    }

    const px = p.mesh.position.x
    const pz = p.mesh.position.z
    const stepLen = Math.hypot(p.vx, p.vz) * delta

    // Pickup hit (pickups have no colliders)
    const pickupHit = this.pickupHitTest(px, pz)
    if (pickupHit) {
      this.state.attached = { kind: 'pickup', ref: pickupHit }
      this.landProjectile()
      this.startPull(webbs)
      return
    }

    // Sweep the glob against real colliders — walls, mounds, props, actors
    const hit = physicsWorld.castBall(px, pz, p.vx, p.vz, stepLen, PROJECTILE_R * this.s, webbs.collisionBody)
    if (hit) {
      const enemy = hit.body ? this.enemies.find(e => e.collisionBody === hit.body && !e.isDead()) : undefined
      if (enemy) {
        enemy.staggerTimer = Math.max(enemy.staggerTimer, STUN_DURATION)
        enemy.startHitReaction('medium')   // Round 9 Issue 4 — visible recoil on web hit
        // Round 9b — minor damage so a web at low HP can trigger a web-death animation.
        enemy.takeDamage(5, undefined, WeaponType.WebLauncher)
        this.addSilkWrap(enemy)
        this.state.attached = { kind: 'enemy', ref: enemy }
        audio.play('web_attach_enemy', enemy.collisionBody.x, enemy.collisionBody.z)
      } else if (hit.body && !hit.body.isStatic) {
        this.state.attached = { kind: 'body', ref: hit.body }
        audio.play('web_attach_enemy', hit.x, hit.z)
      } else {
        // Stick to the surface, a hair proud of it so the anchor isn't inside the wall
        const ax = hit.x + hit.nx * 0.02, az = hit.z + hit.nz * 0.02
        this.state.attached = { kind: 'wall', x: ax, z: az, body: hit.body }
        audio.play('web_attach_wall', ax, az)
      }
      this.landProjectile()
      this.startPull(webbs)
      return
    }

    p.mesh.position.x += p.vx * delta
    p.mesh.position.z += p.vz * delta
    p.traveled += stepLen
    p.mesh.position.y = this.spinneretY(webbs) + Math.sin(Math.PI * Math.min(1, p.traveled / (MAX_RANGE * this.s))) * 0.18 * this.s

    // Max range → recall
    if (p.traveled > MAX_RANGE * this.s) {
      p.recalling = true
      p.traveled  = 0
    }
  }

  private fire(webbs: Webbs3D, aim?: { dx: number; dz: number }): void {
    audio.play('web_fire', webbs.collisionBody.x, webbs.collisionBody.z)
    let dx = webbs.facingX
    let dz = webbs.facingZ
    if (aim) {
      const len = Math.hypot(aim.dx, aim.dz) || 1
      dx = aim.dx / len
      dz = aim.dz / len
    }

    // Find closest enemy in 60° forward cone within 4.0wu for soft homing
    const fireAngle    = Math.atan2(dx, dz)
    const HOMING_RANGE = 4.0
    const HOMING_HALF  = Math.PI / 6   // 30° — 60° total cone
    let   homingTarget: Enemy3D | null = null
    let   minDist      = HOMING_RANGE + 1

    for (const e of this.enemies) {
      if (e.isDead()) continue
      const edx  = e.collisionBody.x - webbs.collisionBody.x
      const edz  = e.collisionBody.z - webbs.collisionBody.z
      const dist = Math.hypot(edx, edz)
      if (dist > HOMING_RANGE) continue
      let diff = Math.atan2(edx, edz) - fireAngle
      while (diff >  Math.PI) diff -= Math.PI * 2
      while (diff < -Math.PI) diff += Math.PI * 2
      if (Math.abs(diff) <= HOMING_HALF && dist < minDist) {
        minDist      = dist
        homingTarget = e
      }
    }

    this.s = webbs.scale
    const geo  = new THREE.SphereGeometry(0.05 * this.s, 6, 4)
    const mat  = new THREE.MeshBasicMaterial({ color: 0xeeeeff })
    const mesh = new THREE.Mesh(geo, mat)
    this.spinneret(webbs, _spin)
    mesh.position.copy(_spin)
    this.threeScene.add(mesh)

    // Silk strand — a polyline so it can hang, pay out and vibrate
    const lineGeo = new THREE.BufferGeometry()
    lineGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(LINE_POINTS * 3), 3))
    const lineMat = new THREE.LineBasicMaterial({ color: 0xddeeff, transparent: true, opacity: 0.85 })
    const line = new THREE.Line(lineGeo, lineMat)
    line.frustumCulled = false
    this.threeScene.add(line)

    this.state = {
      projectile:  { mesh, vx: dx * PROJECTILE_SPEED * this.s, vz: dz * PROJECTILE_SPEED * this.s, traveled: 0, recalling: false, homingTarget },
      line,
      age:         0,
      pulling:     false,
      pullElapsed: 0,
      twang:       0,
    }
  }

  private landProjectile(): void {
    if (!this.state?.projectile) return
    this.threeScene.remove(this.state.projectile.mesh)
    this.state.projectile.mesh.geometry.dispose()
    ;(this.state.projectile.mesh.material as THREE.Material).dispose()
    this.state.projectile = undefined
  }

  // The line is straight: if a wall now stands between Webbs and the anchor
  // (he walked around a pillar), it snags and snaps instead of leashing him
  // through solid dirt.  A wall anchor whose wall was removed lets go too.
  private lineBlocked(webbs: Webbs3D, a: Target3D): boolean {
    let tx: number, tz: number, end: number
    if (a.kind === 'wall') {
      if (a.body?.removed) return true
      tx = a.x; tz = a.z; end = 0.12 * this.s
    } else if (a.kind === 'enemy' || a.kind === 'body') {
      const b = a.kind === 'enemy' ? a.ref.collisionBody : a.ref
      tx = b.x; tz = b.z; end = b.radius + 0.08 * this.s
    } else return false
    const wb = webbs.collisionBody
    const dx = tx - wb.x, dz = tz - wb.z
    const d = Math.hypot(dx, dz) - end          // stop short of the anchor itself
    if (d <= wb.radius) return false
    const hit = physicsWorld.castBall(wb.x, wb.z, dx, dz, d, 0.03 * this.s, wb)   // own body excluded
    return !!hit && !!hit.body?.isStatic && hit.body !== (a.kind === 'wall' ? a.body : null)
  }

  private startPull(webbs: Webbs3D): void {
    const st = this.state
    if (!st?.attached) return
    st.pulling     = true
    st.pullElapsed = 0
    st.age         = 0
    st.twang       = 0.12 * this.s   // the line snaps taut and hums
    audio.play('web_swing', webbs.collisionBody.x, webbs.collisionBody.z)
    audio.playLoop('web_pull_loop', webbs.collisionBody.x, webbs.collisionBody.z)

    const wb = webbs.collisionBody
    const a  = st.attached
    if (a.kind === 'wall') {
      st.rope = physicsWorld.addRope(wb, { x: a.x, z: a.z })
      st.rope.minLength = wb.radius + 0.25 * this.s
    } else if (a.kind === 'enemy' || a.kind === 'body') {
      const body = a.kind === 'enemy' ? a.ref.collisionBody : a.ref
      st.rope = physicsWorld.addRope(wb, body)
      st.rope.minLength = wb.radius + body.radius + 0.15 * this.s
      if (a.kind === 'enemy') {
        // Round 6 Issue 3: stun across the whole pull plus a beat, so the pulled
        // enemy can't immediately bonk the player on arrival.
        a.ref.staggerTimer = Math.max(a.ref.staggerTimer, PULL_DURATION + 0.6)
      }
    }
  }

  // ── Line rendering ─────────────────────────────────────────────────────────────

  // Nozzle tip of the ventral launcher (body-local, scaled with Webbs)
  private spinneret(webbs: Webbs3D, out: THREE.Vector3): THREE.Vector3 {
    return webbs.group.localToWorld(out.set(0, 0.16, 0.31))
  }
  private spinneretY(webbs: Webbs3D): number { return this.spinneret(webbs, _spin).y }

  private updateLine(webbs: Webbs3D): void {
    const st = this.state
    if (!st) return
    this.spinneret(webbs, _spin)

    let length: number   // silk paid out — longer than the gap means the line hangs
    if (st.projectile) {
      _tip.copy(st.projectile.mesh.position)
      length = _spin.distanceTo(_tip) * 1.06
    } else if (st.attached) {
      const a = st.attached
      if (a.kind === 'enemy') {
        _tip.set(a.ref.group.position.x, a.ref.group.position.y + 0.25 * this.s, a.ref.group.position.z)
      } else if (a.kind === 'body') {
        _tip.set(a.ref.renderX, 0.15 * this.s, a.ref.renderZ)
      } else if (a.kind === 'wall') {
        _tip.set(a.x, 0.4 * this.s, a.z)
      } else {
        _tip.set(a.ref.x, 0.2 * this.s, a.ref.z)
      }
      const flat = Math.hypot(_tip.x - _spin.x, _tip.z - _spin.z)
      length = st.rope ? Math.max(flat, st.rope.length) : flat
    } else {
      return
    }

    // Catenary-ish sag from the slack, plus a little even when taut (silk has weight)
    const gap   = _spin.distanceTo(_tip)
    const slack = Math.max(0, length - gap)
    const sag   = Math.sqrt(slack * gap) * 0.6 + gap * 0.02
    const pos   = st.line.geometry.attributes.position as THREE.BufferAttribute
    for (let i = 0; i < LINE_POINTS; i++) {
      const u = i / (LINE_POINTS - 1)
      const bell = 4 * u * (1 - u)
      const hum  = Math.sin(st.age * 55) * st.twang * Math.sin(Math.PI * u)
      pos.setXYZ(i,
        _spin.x + (_tip.x - _spin.x) * u,
        _spin.y + (_tip.y - _spin.y) * u - sag * bell + hum,
        _spin.z + (_tip.z - _spin.z) * u,
      )
    }
    pos.needsUpdate = true
  }

  // ── Silk wraps on stunned enemies ──────────────────────────────────────────────

  private addSilkWrap(enemy: Enemy3D): void {
    const existing = this.silkWraps.get(enemy)
    if (existing) {
      existing.timer = STUN_DURATION
      return
    }
    const r   = enemy.config.bodyRadius + 0.10
    const geo = new THREE.TorusGeometry(r, 0.025, 6, 18)
    geo.rotateX(Math.PI / 2)
    const mat = new THREE.MeshBasicMaterial({ color: 0xddeeff, transparent: true, opacity: 0.8 })
    const mesh = new THREE.Mesh(geo, mat)
    mesh.position.set(enemy.collisionBody.x, 0.38, enemy.collisionBody.z)
    this.threeScene.add(mesh)
    this.silkWraps.set(enemy, { mesh, timer: STUN_DURATION })
  }

  private tickSilkWraps(delta: number): void {
    for (const [enemy, wrap] of Array.from(this.silkWraps.entries())) {
      wrap.timer -= delta
      if (wrap.timer <= 0 || enemy.isDead()) {
        this.threeScene.remove(wrap.mesh)
        wrap.mesh.geometry.dispose()
        ;(wrap.mesh.material as THREE.Material).dispose()
        this.silkWraps.delete(enemy)
      } else {
        wrap.mesh.position.set(enemy.group.position.x, 0.38, enemy.group.position.z)
        ;(wrap.mesh.material as THREE.MeshBasicMaterial).opacity = 0.8 * (wrap.timer / STUN_DURATION)
      }
    }
  }

  clearWraps(): void {
    for (const [, wrap] of Array.from(this.silkWraps.entries())) {
      this.threeScene.remove(wrap.mesh)
      wrap.mesh.geometry.dispose()
      ;(wrap.mesh.material as THREE.Material).dispose()
    }
    this.silkWraps.clear()
  }

  // Let go.  Whatever the line was driving keeps a share of that motion, so a
  // zip or a yank flings instead of stopping dead.
  release(): void {
    const st = this.state
    if (!st) return
    audio.stopLoop('web_pull_loop')
    if (st.rope) {
      const r = st.rope
      if (!r.broken && st.pulling) {
        for (const b of [r.a, r.b]) {
          if (!b || b.isStatic || !b.enabled) continue
          b.push((b.actualVx - b.velocity.x) * RELEASE_CARRY, (b.actualVz - b.velocity.z) * RELEASE_CARRY)
        }
      }
      physicsWorld.removeRope(r)
    }
    if (st.projectile) {
      this.threeScene.remove(st.projectile.mesh)
      st.projectile.mesh.geometry.dispose()
      ;(st.projectile.mesh.material as THREE.Material).dispose()
    }
    this.threeScene.remove(st.line)
    st.line.geometry.dispose()
    st.line.material.dispose()
    this.state = null
  }
}
