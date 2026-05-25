export interface CollisionBody {
  x: number
  z: number
  radius: number
  velocity: { x: number; z: number }
  isStatic: boolean
  enabled: boolean
  drag?: number   // deceleration in wu/s² — mimics Phaser arcade drag
  // AABB rect (walls) — if set, used instead of circle
  aabb?: { x: number; z: number; w: number; h: number }
}

export class PhysicsWorld {
  bodies: CollisionBody[] = []
  // World bounds (set per scene)
  bounds: { minX: number; minZ: number; maxX: number; maxZ: number } | null = null
  // Circular bound radius (HomeBase chamber) — clamps bodies inside a circle at origin
  circularBound: number | null = null

  add(body: CollisionBody): CollisionBody {
    this.bodies.push(body)
    return body
  }

  remove(body: CollisionBody): void {
    const idx = this.bodies.indexOf(body)
    if (idx !== -1) this.bodies.splice(idx, 1)
  }

  update(delta: number): void {
    // Move dynamic bodies
    for (const b of this.bodies) {
      if (b.isStatic || !b.enabled) continue
      b.x += b.velocity.x * delta
      b.z += b.velocity.z * delta
    }

    // Resolve circle vs circle collisions
    for (let i = 0; i < this.bodies.length; i++) {
      for (let j = i + 1; j < this.bodies.length; j++) {
        const a = this.bodies[i]
        const b = this.bodies[j]
        if (!a.enabled || !b.enabled) continue
        if (a.isStatic && b.isStatic) continue
        if (a.aabb || b.aabb) continue // handled below
        this.resolveCircleCircle(a, b)
      }
    }

    // Resolve circle vs AABB (walls)
    for (const body of this.bodies) {
      if (!body.enabled || body.isStatic || body.aabb) continue
      for (const wall of this.bodies) {
        if (!wall.aabb || !wall.enabled) continue
        this.resolveCircleAABB(body, wall)
      }
    }

    // World bounds clamp
    if (this.bounds) {
      for (const b of this.bodies) {
        if (b.isStatic || !b.enabled || b.aabb) continue
        b.x = Math.max(this.bounds.minX + b.radius, Math.min(this.bounds.maxX - b.radius, b.x))
        b.z = Math.max(this.bounds.minZ + b.radius, Math.min(this.bounds.maxZ - b.radius, b.z))
      }
    }

    // Circular bound clamp (HomeBase chamber — keeps bodies inside a circle at origin)
    if (this.circularBound !== null) {
      for (const b of this.bodies) {
        if (b.isStatic || !b.enabled || b.aabb) continue
        const dist = Math.sqrt(b.x * b.x + b.z * b.z)
        const max  = this.circularBound - b.radius
        if (dist > max && dist > 0) {
          const scale = max / dist
          b.x = b.x * scale
          b.z = b.z * scale
        }
      }
    }
  }

  private resolveCircleCircle(a: CollisionBody, b: CollisionBody): void {
    const dx = b.x - a.x
    const dz = b.z - a.z
    const distSq = dx * dx + dz * dz
    const minDist = a.radius + b.radius
    if (distSq >= minDist * minDist || distSq === 0) return

    const dist = Math.sqrt(distSq)
    const overlap = (minDist - dist) / dist
    const pushX = dx * overlap * 0.5
    const pushZ = dz * overlap * 0.5

    if (!a.isStatic) { a.x -= pushX; a.z -= pushZ }
    if (!b.isStatic) { b.x += pushX; b.z += pushZ }
  }

  private resolveCircleAABB(circle: CollisionBody, wall: CollisionBody): void {
    const aabb = wall.aabb!
    // Closest point on AABB to circle center
    const closestX = Math.max(aabb.x, Math.min(circle.x, aabb.x + aabb.w))
    const closestZ = Math.max(aabb.z, Math.min(circle.z, aabb.z + aabb.h))
    const dx = circle.x - closestX
    const dz = circle.z - closestZ
    const distSq = dx * dx + dz * dz
    if (distSq >= circle.radius * circle.radius || distSq === 0) return

    const dist = Math.sqrt(distSq)
    const overlap = circle.radius - dist
    circle.x += (dx / dist) * overlap
    circle.z += (dz / dist) * overlap
  }

  // Distance check utility (used by combat/pickup systems)
  static distSq(ax: number, az: number, bx: number, bz: number): number {
    return (ax - bx) ** 2 + (az - bz) ** 2
  }

  clear(): void {
    this.bodies        = []
    this.circularBound = null
  }
}

export const physicsWorld = new PhysicsWorld()
