import RAPIER from '@dimforge/rapier3d-compat'
import type { Collider, ColliderDesc, RigidBody, World } from '@dimforge/rapier3d-compat'
import * as THREE from 'three'

// ─── Physics world (Rapier) ───────────────────────────────────────────────────
// Gameplay is top-down: every actor collides on the XZ plane with Y translation
// locked, so collision behaves like a robust 2D sim (no tunnelling, proper
// sliding, mass-weighted shoving) while the renderer stays fully 3D.  Terrain is
// a separate, non-colliding layer that only answers ground-height ray queries —
// actors and legs sample it to sit on the real floor.
//
// Velocity model (fixes impulses being erased by the next frame's input):
//   body.velocity        — locomotion INTENT, written by input/AI every frame
//   body.push(vx, vz)    — external impulse; decays at `drag` per second
//   body.forceVelocity() — overrides intent for a duration (web pull, lunges)
//   body.addDrift(vx, vz)— steady environmental flow (suction, wind) for the next update
// Per fixed step the solver receives forced ?? (intent + external + drift), then
// rope constraints (silk lines) correct it before Rapier resolves contacts.

const FIXED_DT  = 1 / 60
const MAX_STEPS = 5

// Collision groups — membership in the high 16 bits, filter in the low 16.
const G_ACTOR   = 0x0001
const G_WALL    = 0x0002
const G_TERRAIN = 0x0004
const groups = (member: number, filter: number) => (member << 16) | filter
const ACTOR_GROUPS   = groups(G_ACTOR, G_ACTOR | G_WALL)
const WALL_GROUPS    = groups(G_WALL, G_ACTOR)
const TERRAIN_GROUPS = groups(G_TERRAIN, G_TERRAIN)   // ray queries only, never contacts
const QUERY_GROUPS   = groups(G_ACTOR, G_ACTOR | G_WALL)   // gameplay sweeps: walls + actors

const WALL_HALF_H = 3    // static colliders span y ∈ [-3, 3]; actors live at y = 0
const ROPE_BAUMGARTE = 12   // 1/s — how fast a stretched rope pulls back to length

export interface BodyInit {
  x: number
  z: number
  radius: number
  velocity: { x: number; z: number }
  isStatic: boolean
  enabled: boolean
  drag?: number        // external-impulse decay rate (1/s); default 7
  mass?: number        // default: area-based (π r² × 20)
  ballistic?: boolean  // physics owns velocity (projectiles/rocks) — bounces off walls
  restitution?: number
  // AABB rect (walls) — min corner + size.  If set, a box is used instead of a circle.
  aabb?: { x: number; z: number; w: number; h: number }
  // Elongated actor: capsule of `radius` with a straight core of ±halfLength along
  // the body's local Z (forward) or X axis.  Turned with `body.heading`.
  capsule?: { halfLength: number; axis: 'x' | 'z' }
}

export class CollisionBody {
  velocity: { x: number; z: number }
  drag: number
  private _mass: number
  // Velocity the body actually moved at during the last physics step (after
  // ropes and contacts) — lets gameplay carry rope momentum into a release.
  actualVx = 0
  actualVz = 0
  readonly ballistic: boolean
  readonly aabb?: { x: number; z: number; w: number; h: number }
  readonly capsule?: { halfLength: number; axis: 'x' | 'z' }
  // Interpolated render position (smooth between fixed steps). Gameplay uses x/z.
  renderX: number
  renderZ: number

  /** @internal */ _x: number
  /** @internal */ _z: number
  /** @internal */ prevX: number
  /** @internal */ prevZ: number
  /** @internal */ extX = 0
  /** @internal */ extZ = 0
  /** @internal */ forceX = 0
  /** @internal */ forceZ = 0
  /** @internal */ forceT = 0
  /** @internal */ driftX = 0
  /** @internal */ driftZ = 0
  /** @internal */ solveVx = 0   // velocity handed to the solver this step
  /** @internal */ solveVz = 0
  // Set by PhysicsWorld.remove(): the Rapier handles are freed, so every setter
  // below becomes a no-op — touching a freed body panics the WASM module.
  /** @internal */ removed = false
  /** @internal */ rb: RigidBody
  /** @internal */ col: Collider
  private _radius: number
  private _enabled: boolean
  private _isStatic: boolean

  /** @internal */
  constructor(init: BodyInit, rb: RigidBody, col: Collider) {
    this._x = this.prevX = this.renderX = init.x
    this._z = this.prevZ = this.renderZ = init.z
    this.velocity  = init.velocity
    this.drag      = init.drag ?? 7
    this._mass     = init.isStatic ? Infinity : (init.mass ?? defaultMass(init.radius))
    this.ballistic = init.ballistic ?? false
    this.aabb      = init.aabb
    this.capsule   = init.capsule
    this._radius   = init.radius
    this._enabled  = init.enabled
    this._isStatic = init.isStatic
    this.rb  = rb
    this.col = col
  }

  get x(): number { return this._x }
  get z(): number { return this._z }
  // Writing a position is a teleport: no interpolation smear, velocity untouched.
  set x(v: number) { this._x = this.prevX = this.renderX = v; this.syncTranslation() }
  set z(v: number) { this._z = this.prevZ = this.renderZ = v; this.syncTranslation() }

  get radius(): number { return this._radius }
  set radius(r: number) {
    if (r === this._radius || this.aabb || r <= 0) return
    // Mass follows area, so a creature resized per zone keeps its density
    if (isFinite(this._mass) && this._radius > 0) this._mass *= (r / this._radius) ** 2
    this._radius = r
    if (this.removed) return
    this.col.setRadius(r)
    if (isFinite(this._mass)) this.col.setMass(this._mass)   // after the shape change
  }

  get mass(): number { return this._mass }

  // XZ distance from a point to this body's SURFACE (negative inside).  Exact
  // for balls and heading-aligned capsules — used by blade and projectile hits.
  surfaceDistance(px: number, pz: number): number {
    let cx = this._x, cz = this._z
    if (this.capsule) {
      const yaw = isNaN(this._heading) ? 0 : this._heading
      // capsule core axis in world XZ (local +Z → (sin, cos), local +X → (cos, −sin))
      const ax = this.capsule.axis === 'z' ? Math.sin(yaw) :  Math.cos(yaw)
      const az = this.capsule.axis === 'z' ? Math.cos(yaw) : -Math.sin(yaw)
      const t  = Math.max(-this.capsule.halfLength, Math.min(this.capsule.halfLength,
        (px - this._x) * ax + (pz - this._z) * az))
      cx = this._x + ax * t
      cz = this._z + az * t
    }
    return Math.hypot(px - cx, pz - cz) - this._radius
  }

  // Yaw (THREE rotation.y convention) of an elongated collider; no-op for circles.
  private _heading = NaN
  set heading(yaw: number) {
    if (!this.capsule || Math.abs(yaw - this._heading) < 1e-4) return
    this._heading = yaw
    if (this.removed) return
    const q = capsuleRotation(this.capsule.axis, yaw)
    this.col.setRotationWrtParent({ x: q.x, y: q.y, z: q.z, w: q.w })
  }

  get enabled(): boolean { return this._enabled }
  set enabled(on: boolean) {
    if (on === this._enabled) return
    this._enabled = on
    if (this.removed) return
    this.col.setEnabled(on)
    this.rb.setEnabled(on)
    if (on) this.syncTranslation()
  }

  get isStatic(): boolean { return this._isStatic }
  set isStatic(s: boolean) {
    if (s === this._isStatic) return
    this._isStatic = s
    if (this.removed) return
    this.rb.setBodyType(s ? RAPIER.RigidBodyType.Fixed : RAPIER.RigidBodyType.Dynamic, true)
  }

  // External impulse (knockback, suction, contact shove). Stacks, then decays.
  push(vx: number, vz: number): void {
    if (this.ballistic) { this.velocity.x += vx; this.velocity.z += vz; return }
    this.extX += vx
    this.extZ += vz
  }

  // Override intent with a fixed velocity for `seconds` (web pull, lunges).
  forceVelocity(vx: number, vz: number, seconds: number): void {
    this.forceX = vx
    this.forceZ = vz
    this.forceT = seconds
  }

  // Environmental flow applied during the next physicsWorld.update(), then cleared.
  // Call every frame the effect is active.
  addDrift(vx: number, vz: number): void {
    this.driftX += vx
    this.driftZ += vz
  }

  clearForces(): void {
    this.extX = this.extZ = 0
    this.forceT = 0
  }

  private syncTranslation(): void {
    if (this.removed) return
    this.rb.setTranslation({ x: this._x, y: 0, z: this._z }, true)
  }
}

// ─── Rope (silk line) ─────────────────────────────────────────────────────────
// Inextensible, slack-capable line between body `a` and either body `b` or a
// fixed world point.  Solved at the velocity level each fixed step: when taut,
// the separating component of relative velocity is removed (mass-weighted, so a
// heavy end drags a light one) and any overshoot is corrected.  `reelSpeed`
// shortens the line over time — that IS the pull, so the motion stays physical:
// sideways input swings around the anchor instead of being overridden.
export class Rope {
  length:    number
  reelSpeed = 0        // wu/s the line shortens while > minLength
  minLength = 0
  tension   = 0        // last step's constraint impulse rate (≈ force / mass units)
  broken    = false    // set when an attached body is removed/disabled
  readonly a:  CollisionBody
  readonly b:  CollisionBody | null   // null → fixed world anchor (ax, az)
  readonly ax: number
  readonly az: number

  /** @internal */
  constructor(a: CollisionBody, b: CollisionBody | null, ax: number, az: number, length: number) {
    this.a = a; this.b = b; this.ax = ax; this.az = az
    this.length = length
  }

  get anchorX(): number { return this.b ? this.b.x : this.ax }
  get anchorZ(): number { return this.b ? this.b.z : this.az }
  get taut(): boolean {
    return Math.hypot(this.anchorX - this.a.x, this.anchorZ - this.a.z) >= this.length - 0.01
  }
}

export interface CastHit {
  x: number; z: number         // contact point on the hit collider
  nx: number; nz: number       // surface normal at the contact (pointing at the caster)
  dist: number                 // travel before contact
  body: CollisionBody | null   // null for terrain/untracked colliders
}

const defaultMass = (r: number) => Math.PI * r * r * 20

// Rapier capsules run along local Y; lay them along body Z or X, then apply yaw.
const _qa = new THREE.Quaternion(), _qy = new THREE.Quaternion()
const _ax = new THREE.Vector3(1, 0, 0), _az = new THREE.Vector3(0, 0, 1), _ayUp = new THREE.Vector3(0, 1, 0)
function capsuleRotation(axis: 'x' | 'z', yaw: number): THREE.Quaternion {
  if (axis === 'z') _qa.setFromAxisAngle(_ax, Math.PI / 2)   // Y → Z
  else              _qa.setFromAxisAngle(_az, Math.PI / 2)   // Y → X
  return _qy.setFromAxisAngle(_ayUp, yaw).multiply(_qa)
}
const quatToRapier = (q: THREE.Quaternion) => ({ x: q.x, y: q.y, z: q.z, w: q.w })

export class PhysicsWorld {
  private world: World | null = null
  private ropes: Rope[] = []
  private byCollider = new Map<number, CollisionBody>()
  private dynamics: CollisionBody[] = []
  private all = new Set<CollisionBody>()
  private boundWalls: CollisionBody[] = []
  private terrain: Collider | null = null
  private terrainBody: RigidBody | null = null
  private accumulator = 0
  private _bounds: { minX: number; minZ: number; maxX: number; maxZ: number } | null = null
  private ray: RAPIER.Ray | null = null

  // Must be awaited once before any scene is built (loads the WASM module).
  async init(): Promise<void> {
    if (this.world) return
    await RAPIER.init()
    this.world = new RAPIER.World({ x: 0, y: 0, z: 0 })
    this.world.timestep = FIXED_DT
    this.ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 })
  }

  private get w(): World {
    if (!this.world) throw new Error('physicsWorld.init() must be awaited before use')
    return this.world
  }

  // ── Bodies ───────────────────────────────────────────────────────────────────

  // Circle (dynamic actor or static post) or legacy AABB wall.
  add(init: BodyInit): CollisionBody {
    if (init.aabb) {
      const a = init.aabb
      return this.addStatic(a.x + a.w / 2, a.z + a.h / 2,
        RAPIER.ColliderDesc.cuboid(a.w / 2, WALL_HALF_H, a.h / 2), init)
    }
    if (init.isStatic) {
      return this.addStatic(init.x, init.z,
        RAPIER.ColliderDesc.cylinder(WALL_HALF_H, Math.max(init.radius, 0.001)), init)
    }

    const w  = this.w
    const rb = w.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .lockRotations()
        .enabledTranslations(true, false, true)
        .setTranslation(init.x, 0, init.z),
    )
    rb.enableCcd(true)
    const r     = Math.max(init.radius, 0.001)
    const shape = init.capsule
      ? RAPIER.ColliderDesc.capsule(init.capsule.halfLength, r)
          .setRotation(quatToRapier(capsuleRotation(init.capsule.axis, 0)))
      : RAPIER.ColliderDesc.ball(r)
    const col = w.createCollider(
      shape
        .setFriction(0)
        .setRestitution(init.restitution ?? 0)
        .setCollisionGroups(ACTOR_GROUPS)
        .setMass(init.mass ?? defaultMass(init.radius)),
      rb,
    )
    const body = new CollisionBody(init, rb, col)
    if (!init.enabled) { col.setEnabled(false); rb.setEnabled(false) }
    this.all.add(body)
    this.dynamics.push(body)
    this.byCollider.set(col.handle, body)
    return body
  }

  remove(body: CollisionBody): void {
    if (!this.all.delete(body)) return
    const i = this.dynamics.indexOf(body)
    if (i !== -1) this.dynamics.splice(i, 1)
    this.byCollider.delete(body.col.handle)
    for (const r of this.ropes) if (r.a === body || r.b === body) r.broken = true
    this.w.removeRigidBody(body.rb)   // also removes its collider
    body.removed = true
  }

  private addStatic(cx: number, cz: number, desc: ColliderDesc, init?: BodyInit): CollisionBody {
    const w  = this.w
    const rb = w.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(cx, 0, cz))
    const col = w.createCollider(desc.setFriction(0).setCollisionGroups(WALL_GROUPS), rb)
    const body = new CollisionBody({
      x: cx, z: cz, radius: init?.radius ?? 0, velocity: { x: 0, z: 0 },
      isStatic: true, enabled: init?.enabled ?? true, aabb: init?.aabb,
    }, rb, col)
    if (init && !init.enabled) { col.setEnabled(false); rb.setEnabled(false) }
    this.all.add(body)
    this.byCollider.set(col.handle, body)
    return body
  }

  // Oriented static box: centre (cx, cz), half-extents (hx, hz), yaw rotY (radians,
  // same convention as THREE Object3D.rotation.y).
  addStaticBox(cx: number, cz: number, hx: number, hz: number, rotY = 0): CollisionBody {
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotY)
    return this.addStatic(cx, cz,
      RAPIER.ColliderDesc.cuboid(hx, WALL_HALF_H, hz).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }))
  }

  // Thin wall from (x0,z0) to (x1,z1) — exact for diagonal segments.
  addStaticSegment(x0: number, z0: number, x1: number, z1: number, thickness: number): CollisionBody {
    const dx = x1 - x0, dz = z1 - z0
    const len = Math.hypot(dx, dz)
    // Local +X runs along the segment; THREE yaw maps local +X to (cos θ, 0, -sin θ).
    return this.addStaticBox((x0 + x1) / 2, (z0 + z1) / 2, len / 2 + thickness / 2, thickness / 2, Math.atan2(-dz, dx))
  }

  // Static convex prism from an XZ polygon (any winding; hull is taken).
  addStaticPolygon(points: Array<[number, number]>): CollisionBody | null {
    if (points.length < 3) return null
    let cx = 0, cz = 0
    for (const [x, z] of points) { cx += x; cz += z }
    cx /= points.length; cz /= points.length
    const verts = new Float32Array(points.length * 6)
    points.forEach(([x, z], i) => {
      verts.set([x - cx, -WALL_HALF_H, z - cz, x - cx, WALL_HALF_H, z - cz], i * 6)
    })
    const desc = RAPIER.ColliderDesc.convexHull(verts)
    return desc ? this.addStatic(cx, cz, desc) : null
  }

  // Collider matching what a mesh/group LOOKS like at actor height: the XZ convex
  // hull of every world-space vertex below `maxY`, shrunk slightly so edges can be
  // brushed.  Pass a whole group (merged hull) or call per-mesh for concave sets.
  addFootprint(obj: THREE.Object3D, maxY = 1.0, shrink = 0.95): CollisionBody | null {
    obj.updateWorldMatrix(true, true)
    const pts: Array<[number, number]> = []
    const v = new THREE.Vector3()
    obj.traverse(o => {
      const m = o as THREE.Mesh
      if (!m.isMesh || m.userData.noCollide) return
      const pos = m.geometry.attributes.position as THREE.BufferAttribute
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld)
        if (v.y < maxY) pts.push([v.x, v.z])
      }
    })
    const hull = convexHull2D(pts)
    if (hull.length < 3 || polygonArea(hull) < 0.02) return null
    let cx = 0, cz = 0
    for (const [x, z] of hull) { cx += x; cz += z }
    cx /= hull.length; cz /= hull.length
    return this.addStaticPolygon(hull.map(([x, z]) => [cx + (x - cx) * shrink, cz + (z - cz) * shrink]))
  }

  // ── World bounds (four solid walls just outside the rectangle) ───────────────

  get bounds() { return this._bounds }
  set bounds(b: { minX: number; minZ: number; maxX: number; maxZ: number } | null) {
    for (const wall of this.boundWalls) this.remove(wall)
    this.boundWalls = []
    this._bounds = b
    if (!b) return
    const T = 5   // wall thickness — far thicker than any per-step displacement
    const w = b.maxX - b.minX, d = b.maxZ - b.minZ
    const mx = (b.minX + b.maxX) / 2, mz = (b.minZ + b.maxZ) / 2
    this.boundWalls.push(
      this.addStaticBox(b.minX - T / 2, mz, T / 2, d / 2 + T, 0),
      this.addStaticBox(b.maxX + T / 2, mz, T / 2, d / 2 + T, 0),
      this.addStaticBox(mx, b.minZ - T / 2, w / 2 + T, T / 2, 0),
      this.addStaticBox(mx, b.maxZ + T / 2, w / 2 + T, T / 2, 0),
    )
  }

  // ── Terrain (ground-height queries only) ─────────────────────────────────────

  setTerrain(mesh: THREE.Mesh | null): void {
    if (this.terrainBody) { this.w.removeRigidBody(this.terrainBody); this.terrainBody = null; this.terrain = null }
    if (!mesh) return
    mesh.updateWorldMatrix(true, false)
    const geo = mesh.geometry
    const pos = geo.attributes.position as THREE.BufferAttribute
    const verts = new Float32Array(pos.count * 3)
    const v = new THREE.Vector3()
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld)
      verts.set([v.x, v.y, v.z], i * 3)
    }
    const indices = geo.index
      ? new Uint32Array(geo.index.array)
      : Uint32Array.from({ length: pos.count }, (_, i) => i)
    this.terrainBody = this.w.createRigidBody(RAPIER.RigidBodyDesc.fixed())
    this.terrain = this.w.createCollider(
      RAPIER.ColliderDesc.trimesh(verts, indices).setCollisionGroups(TERRAIN_GROUPS),
      this.terrainBody,
    )
  }

  // Floor height at (x, z).  Flat zones (no terrain) return 0.
  groundHeight(x: number, z: number): number {
    if (!this.terrain || !this.ray) return 0
    this.ray.origin = { x, y: 200, z }
    const hit = this.w.castRay(this.ray, 400, true, undefined, TERRAIN_GROUPS)
    return hit ? 200 - hit.timeOfImpact : 0
  }

  // ── Ropes ────────────────────────────────────────────────────────────────────

  // Line from body `a` to a body or a fixed point. Length defaults to the current
  // separation (attached exactly taut).
  addRope(a: CollisionBody, to: CollisionBody | { x: number; z: number }, length?: number): Rope {
    const b  = to instanceof CollisionBody ? to : null
    const ax = b ? 0 : to.x, az = b ? 0 : to.z
    const tx = b ? b.x : ax, tz = b ? b.z : az
    const rope = new Rope(a, b, ax, az, length ?? Math.hypot(tx - a.x, tz - a.z))
    this.ropes.push(rope)
    return rope
  }

  removeRope(rope: Rope): void {
    const i = this.ropes.indexOf(rope)
    if (i !== -1) this.ropes.splice(i, 1)
  }

  // ── Queries ──────────────────────────────────────────────────────────────────

  // Exact shape-to-shape test (capsules, balls, boxes): true when the two
  // colliders are within `margin` of each other.  Replaces centre-distance checks.
  touching(a: CollisionBody, b: CollisionBody, margin = 0): boolean {
    if (!a.enabled || !b.enabled || a.removed || b.removed) return false
    const c = a.col.contactCollider(b.col, margin)
    return c !== null && c.distance <= margin
  }

  // Sweep a ball of `radius` from (x, z) along (dx, dz) for `dist` against walls
  // and actors (never terrain).  `exclude` skips the caster's own body.
  castBall(x: number, z: number, dx: number, dz: number, dist: number, radius: number,
           exclude?: CollisionBody): CastHit | null {
    const len = Math.hypot(dx, dz)
    if (len < 1e-6 || dist <= 0) return null
    const w   = this.w
    const hit = w.castShape(
      { x, y: 0, z }, { x: 0, y: 0, z: 0, w: 1 },
      { x: dx / len, y: 0, z: dz / len },
      new RAPIER.Ball(radius), 0, dist, true,
      undefined, QUERY_GROUPS, undefined, exclude?.rb,
    )
    if (!hit) return null
    return {
      x: hit.witness1.x, z: hit.witness1.z,
      nx: hit.normal1.x, nz: hit.normal1.z,
      dist: hit.time_of_impact,
      body: this.byCollider.get(hit.collider.handle) ?? null,
    }
  }

  // ── Stepping ─────────────────────────────────────────────────────────────────

  update(delta: number): void {
    const w = this.w
    this.accumulator = Math.min(this.accumulator + delta, FIXED_DT * MAX_STEPS)
    while (this.accumulator >= FIXED_DT) {
      this.accumulator -= FIXED_DT
      for (const b of this.dynamics) {
        b.prevX = b._x
        b.prevZ = b._z
        if (!b.enabled || b.isStatic) { b.solveVx = b.solveVz = 0; continue }
        if (b.forceT > 0) {
          b.solveVx = b.forceX; b.solveVz = b.forceZ
          b.forceT -= FIXED_DT
        } else {
          b.solveVx = b.velocity.x + b.extX + b.driftX
          b.solveVz = b.velocity.z + b.extZ + b.driftZ
        }
      }
      this.solveRopes()
      for (const b of this.dynamics) {
        if (!b.enabled || b.isStatic) continue
        b.rb.setLinvel({ x: b.solveVx, y: 0, z: b.solveVz }, true)
      }
      w.step()
      for (const b of this.dynamics) {
        if (!b.enabled || b.isStatic) continue
        const t = b.rb.translation()
        b.actualVx = (t.x - b._x) / FIXED_DT
        b.actualVz = (t.z - b._z) / FIXED_DT
        b._x = t.x
        b._z = t.z
        if (b.ballistic) {
          const lv = b.rb.linvel()
          b.velocity.x = lv.x
          b.velocity.z = lv.z
        }
        const k = Math.exp(-b.drag * FIXED_DT)
        b.extX *= k
        b.extZ *= k
        if (Math.abs(b.extX) < 0.01) b.extX = 0
        if (Math.abs(b.extZ) < 0.01) b.extZ = 0
      }
    }
    // Interpolate render positions between the last two fixed states
    const alpha = this.accumulator / FIXED_DT
    for (const b of this.dynamics) {
      // Drift is a velocity for THIS frame — clear it even on frames that ran no
      // step, or high-refresh displays stack it (2.4× suction at 144 Hz).
      b.driftX = b.driftZ = 0
      b.renderX = b.prevX + (b._x - b.prevX) * alpha
      b.renderZ = b.prevZ + (b._z - b.prevZ) * alpha
    }
  }

  // Wireframe of every collider (actors + walls + terrain) for the dev overlay.
  debugLines(): { vertices: Float32Array; colors: Float32Array } {
    return this.w.debugRender()
  }

  private solveRopes(): void {
    for (const r of this.ropes) {
      const a = r.a, b = r.b
      if (r.broken || !a.enabled || (b && !b.enabled)) { r.broken = true; r.tension = 0; continue }
      if (r.reelSpeed > 0) r.length = Math.max(r.minLength, r.length - r.reelSpeed * FIXED_DT)
      const px = r.anchorX - a._x, pz = r.anchorZ - a._z
      const d  = Math.hypot(px, pz)
      if (d < 1e-5 || d < r.length) { r.tension = 0; continue }   // slack
      const nx = px / d, nz = pz / d                              // a → anchor
      const wa = a.isStatic ? 0 : 1 / a.mass
      const wb = b && !b.isStatic ? 1 / b.mass : 0
      if (wa + wb === 0) continue
      // Separation rate (+ = ends moving apart) and the rate that removes any overshoot
      const bvx = b ? b.solveVx : 0, bvz = b ? b.solveVz : 0
      const sep    = (bvx - a.solveVx) * nx + (bvz - a.solveVz) * nz
      const target = -(d - r.length) * ROPE_BAUMGARTE
      if (sep <= target) { r.tension = 0; continue }
      const j = (target - sep) / (wa + wb)       // ≤ 0: pulls the ends together
      a.solveVx -= nx * j * wa; a.solveVz -= nz * j * wa
      if (b) { b.solveVx += nx * j * wb; b.solveVz += nz * j * wb }
      r.tension = -j
    }
  }

  // Distance check utility (used by combat/pickup systems)
  static distSq(ax: number, az: number, bx: number, bz: number): number {
    return (ax - bx) ** 2 + (az - bz) ** 2
  }
}

// ── 2D geometry helpers ─────────────────────────────────────────────────────────

// Andrew's monotone chain — returns hull in counter-clockwise order.
function convexHull2D(pts: Array<[number, number]>): Array<[number, number]> {
  if (pts.length < 3) return pts
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const cross = (o: [number, number], a: [number, number], b: [number, number]) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  const lower: Array<[number, number]> = []
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop()
    lower.push(q)
  }
  const upper: Array<[number, number]> = []
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i]
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop()
    upper.push(q)
  }
  upper.pop(); lower.pop()
  return lower.concat(upper)
}

function polygonArea(poly: Array<[number, number]>): number {
  let a = 0
  for (let i = 0; i < poly.length; i++) {
    const [x0, z0] = poly[i]
    const [x1, z1] = poly[(i + 1) % poly.length]
    a += x0 * z1 - x1 * z0
  }
  return Math.abs(a) / 2
}

export const physicsWorld = new PhysicsWorld()
