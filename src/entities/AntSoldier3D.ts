import * as THREE from 'three'
import { Enemy3D, type EnemyConfig3D } from './Enemy3D'
import { audio } from '../systems/AudioManager'
import type { ColonyMaze } from '../scenes/colony/ColonyMaze'

// ─── Soldier ant ──────────────────────────────────────────────────────────────
// The colony's hunter, bigger than Webbs.  It walks a patrol loop through the
// tunnels, turns toward noises, and once it sees you it chases through the
// maze (real pathfinding, not a beeline into the wall), calls the others, and
// when it loses you it goes to where you were last seen and searches.
// Its eyes glow, so in the dark you see them before you see it.

const CONFIG: EnemyConfig3D = {
  health:          70,
  speed:           4.3,
  damage:          16,
  bodyRadius:      0.32,
  capsule:         { halfLength: 0.42, axis: 'z' },
  knockbackResist: 0.35,
  staggerDuration: 0.35,
}

const SIZE         = 1.25    // a head taller than Webbs
const PATROL_SPEED = 1.15
const HUNT_SPEED   = 2.6     // investigating / searching
const CHASE_SPEED  = 4.3     // Webbs runs 5.4 — corners and dead ends are where it catches you
const SIGHT_RANGE  = 7.0
const SIGHT_COS    = Math.cos(THREE.MathUtils.degToRad(80))
const FEEL_RANGE   = 2.0     // senses you this close even from behind
const KEEP_SIGHT   = 10.5    // keeps tracking you this far once chasing
const LOSE_AFTER   = 2.6     // s out of sight before it gives up the chase
const BITE_RANGE   = 1.15
const WINDUP       = 0.42
const LUNGE        = 0.18
const LUNGE_SPEED  = 7.5
const RECOVER      = 0.75
const ALERT_BEAT   = 0.4     // the "it saw me" freeze before it comes

export interface SoldierCtx {
  maze: ColonyMaze
  // A soldier spotted Webbs at (x, z): alarm the colony, rouse neighbours
  alert(x: number, z: number, from: AntSoldier3D): void
  // The entry chamber is Webbs' refuge — soldiers won't follow him in
  safe(x: number, z: number): boolean
}

type State = 'PATROL' | 'PAUSE' | 'INVESTIGATE' | 'ALERT' | 'CHASE' | 'SEARCH' | 'WINDUP' | 'LUNGE' | 'RECOVER'

export class AntSoldier3D extends Enemy3D {
  static ctx: SoldierCtx | null = null

  private state: State = 'PATROL'
  private stateT = 0
  private route: Array<{ x: number; z: number }>
  private routeIdx = 0
  private fields = new Map<string, Int32Array>()
  private goal: { x: number; z: number } | null = null
  private lastSeen = { x: 0, z: 0 }
  private unseenT = 0
  private senseT = 0
  private facing = 0
  private legPhase = 0
  private legs: Array<{ hip: THREE.Group; knee: THREE.Group; side: number; ph: number }> = []
  private mandibles: THREE.Group[] = []
  private head!: THREE.Group
  private bodyMats: THREE.MeshToonMaterial[] = []
  private eyeMat!: THREE.MeshStandardMaterial
  private lungeDir = { x: 0, z: 1 }

  constructor(scene: THREE.Scene, x: number, z: number, gm: THREE.Texture, route: Array<{ x: number; z: number }>) {
    super(scene, x, z, CONFIG, gm)
    this.usesNav = false               // it pathfinds for itself
    this.route = route.length ? route : [{ x, z }]
    this.facing = Math.random() * Math.PI * 2
    this.buildVisuals()
    this.group.scale.setScalar(SIZE)
  }

  get hunting(): boolean { return this.state === 'CHASE' || this.state === 'ALERT' || this.state === 'WINDUP' || this.state === 'LUNGE' || this.state === 'RECOVER' }

  buildVisuals(): void {
    const gm = this.gradientMap
    const chitin = () => { const m = new THREE.MeshToonMaterial({ color: 0x3b1a10, gradientMap: gm }); this.bodyMats.push(m); return m }
    const dark = new THREE.MeshToonMaterial({ color: 0x1c0d08, gradientMap: gm })
    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, parent: THREE.Object3D, p: [number, number, number], s?: [number, number, number]) => {
      const m = new THREE.Mesh(geo, mat); m.position.set(...p); if (s) m.scale.set(...s); m.castShadow = true; parent.add(m); return m
    }
    const sphere = new THREE.SphereGeometry(1, 14, 10)
    // Gaster with segment bands
    const gaster = add(sphere, chitin(), this.group, [0, 0.33, -0.46], [0.25, 0.2, 0.33])
    for (const z of [-0.36, -0.5]) add(new THREE.TorusGeometry(0.21, 0.012, 5, 18), dark, this.group, [0, 0.335, z], [1, 0.8, 1]).rotation.y = Math.PI / 2
    gaster.rotation.x = 0.12
    // Petiole nodes, thorax
    add(sphere, chitin(), this.group, [0, 0.3, -0.16], [0.06, 0.07, 0.06])
    add(sphere, chitin(), this.group, [0, 0.29, -0.08], [0.05, 0.05, 0.05])
    add(sphere, chitin(), this.group, [0, 0.31, 0.06], [0.13, 0.12, 0.2])
    add(sphere, chitin(), this.group, [0, 0.36, 0.0], [0.08, 0.06, 0.08])   // spine hump
    // Head: big, heart-shaped, with mandibles and glowing eyes
    this.head = new THREE.Group(); this.head.position.set(0, 0.34, 0.33); this.group.add(this.head)
    add(sphere, chitin(), this.head, [0, 0, 0.02], [0.2, 0.15, 0.18])
    add(sphere, chitin(), this.head, [-0.09, 0.04, -0.02], [0.1, 0.1, 0.1])
    add(sphere, chitin(), this.head, [0.09, 0.04, -0.02], [0.1, 0.1, 0.1])
    this.eyeMat = new THREE.MeshStandardMaterial({ color: 0xff6a2a, emissive: 0xff4a12, emissiveIntensity: 3.4, roughness: 0.2 })
    for (const s of [-1, 1]) add(new THREE.SphereGeometry(0.034, 10, 8), this.eyeMat, this.head, [s * 0.155, 0.05, 0.08])
    for (const s of [-1, 1]) {
      const pivot = new THREE.Group(); pivot.position.set(s * 0.08, -0.04, 0.17); this.head.add(pivot)
      const jaw = add(new THREE.TorusGeometry(0.11, 0.022, 6, 12, Math.PI * 0.8), dark, pivot, [s * -0.02, 0, 0.08])
      jaw.rotation.set(Math.PI / 2, 0, s > 0 ? Math.PI * 0.85 : Math.PI * 0.35)
      const tooth = add(new THREE.ConeGeometry(0.018, 0.06, 5), dark, pivot, [s * -0.1, 0, 0.13])
      tooth.rotation.set(Math.PI / 2, 0, 0)
      this.mandibles.push(pivot)
    }
    // Elbowed antennae
    for (const s of [-1, 1]) {
      const a = new THREE.Group(); a.position.set(s * 0.07, 0.1, 0.1); this.head.add(a)
      const seg1 = add(new THREE.CylinderGeometry(0.008, 0.01, 0.2, 5), dark, a, [0, 0.09, 0.02])
      seg1.rotation.x = -0.3; seg1.rotation.z = -s * 0.4
      const seg2 = add(new THREE.CylinderGeometry(0.006, 0.008, 0.2, 5), dark, a, [s * 0.06, 0.16, 0.12])
      seg2.rotation.x = 1.1; seg2.rotation.z = -s * 0.3
    }
    // Six legs, two segments each, from the thorax
    const femur = new THREE.CylinderGeometry(0.018, 0.022, 0.34, 6); femur.translate(0, -0.17, 0)
    const tibia = new THREE.CylinderGeometry(0.012, 0.018, 0.38, 6); tibia.translate(0, -0.19, 0)
    ;[0.15, 0.05, -0.06].forEach((z, k) => {
      for (const side of [-1, 1]) {
        const hip = new THREE.Group(); hip.position.set(side * 0.1, 0.3, z); this.group.add(hip)
        hip.rotation.set(0, side * (0.5 - k * 0.5), side * 1.05)
        add(femur, dark, hip, [0, 0, 0])
        const knee = new THREE.Group(); knee.position.set(0, -0.34, 0); hip.add(knee)
        knee.rotation.z = -side * 1.6
        add(tibia, dark, knee, [0, 0, 0])
        this.legs.push({ hip, knee, side, ph: (k % 2 === 0 ? 0 : Math.PI) + (side > 0 ? Math.PI : 0) })
      }
    })
  }

  protected setFlashColor(on: boolean): void {
    for (const m of this.bodyMats) m.color.setHex(on ? 0xff5533 : 0x3b1a10)
  }
  override dealsContactDamage(): boolean { return this.state === 'LUNGE' }
  protected override superArmor(): boolean { return this.state === 'LUNGE' }

  // A sound reached it (scene noise bus).  `range` is in path distance.
  hear(x: number, z: number, range: number): void {
    if (this.hunting || this.isDead()) return
    const maze = AntSoldier3D.ctx?.maze
    if (!maze) return
    const f = this.fieldFor(x, z)
    if (maze.fieldDistance(f, this.collisionBody.x, this.collisionBody.z) > range) return
    this.goal = { x, z }
    this.setState('INVESTIGATE')
  }

  // Roused by another soldier's alarm: come straight for the spot
  rouse(x: number, z: number): void {
    if (this.hunting || this.isDead()) return
    this.goal = { x, z }; this.lastSeen = { x, z }
    this.setState('SEARCH')
  }

  private setState(s: State): void { this.state = s; this.stateT = 0 }

  private fieldFor(x: number, z: number): Int32Array {
    const maze = AntSoldier3D.ctx!.maze
    const key = `${maze.tileI(x)},${maze.tileJ(z)}`
    let f = this.fields.get(key)
    if (!f) {
      f = maze.fieldTo(x, z)
      if (this.fields.size > 12) this.fields.delete(this.fields.keys().next().value!)
      this.fields.set(key, f)
    }
    return f
  }

  private moveAlong(field: Int32Array | null, speed: number, delta: number): number {
    const maze = AntSoldier3D.ctx!.maze
    const b = this.collisionBody
    const s = maze.seek(b.x, b.z, 0.28, field ?? undefined)
    if (!s) { b.velocity.x = b.velocity.z = 0; return Infinity }
    const dx = s.x - b.x, dz = s.z - b.z, l = Math.hypot(dx, dz)
    if (l > 0.05) this.turnTo(Math.atan2(dx, dz), delta, 9)
    // Move along its facing so turns are visible, not instant
    const go = speed * Math.max(0, Math.cos(this.angleDiff(Math.atan2(dx, dz))))
    b.velocity.x = Math.sin(this.facing) * go
    b.velocity.z = Math.cos(this.facing) * go
    this.legPhase += delta * go * 9
    return s.dist
  }

  private angleDiff(a: number): number {
    let d = a - this.facing
    while (d > Math.PI) d -= Math.PI * 2
    while (d < -Math.PI) d += Math.PI * 2
    return d
  }
  private turnTo(a: number, delta: number, rate: number): void {
    this.facing += this.angleDiff(a) * Math.min(1, rate * delta)
  }

  private canSee(px: number, pz: number): boolean {
    const maze = AntSoldier3D.ctx!.maze
    const b = this.collisionBody
    const dx = px - b.x, dz = pz - b.z, d = Math.hypot(dx, dz)
    if (d < FEEL_RANGE) return maze.los(b.x, b.z, px, pz)
    const range = this.state === 'CHASE' ? KEEP_SIGHT : SIGHT_RANGE
    if (d > range) return false
    if (this.state !== 'CHASE' && (dx * Math.sin(this.facing) + dz * Math.cos(this.facing)) / d < SIGHT_COS) return false
    return maze.los(b.x, b.z, px, pz)
  }

  updateAI(delta: number, px: number, pz: number): void {
    const ctx = AntSoldier3D.ctx
    if (!ctx) return
    const maze = ctx.maze
    const b = this.collisionBody
    this.stateT += delta
    const dist = Math.hypot(px - b.x, pz - b.z)

    // Senses, a few times a second
    this.senseT -= delta
    let sees = false
    if (this.senseT <= 0 || this.hunting) {
      this.senseT = 0.15
      sees = !ctx.safe(px, pz) && this.canSee(px, pz)
      if (sees) { this.lastSeen.x = px; this.lastSeen.z = pz }
    }

    switch (this.state) {
      case 'PATROL': case 'PAUSE': case 'INVESTIGATE': case 'SEARCH':
        if (sees) {
          this.setState('ALERT')
          b.velocity.x = b.velocity.z = 0
          audio.play('ant_bite', b.x, b.z, { rate: 0.55, volume: 1.2 })   // the hiss: it has you
          ctx.alert(px, pz, this)
          return this.pose(delta)
        }
    }

    switch (this.state) {
      case 'PATROL': {
        const wp = this.route[this.routeIdx]
        const left = this.moveAlong(this.fieldFor(wp.x, wp.z), PATROL_SPEED, delta)
        if (left < 0.7) { this.setState('PAUSE'); b.velocity.x = b.velocity.z = 0 }
        break
      }
      case 'PAUSE':
        b.velocity.x = b.velocity.z = 0
        this.facing += Math.sin(this.stateT * 2.2) * delta * 1.2   // turns its head, tasting the air
        if (this.stateT > 1.4) { this.routeIdx = (this.routeIdx + 1) % this.route.length; this.setState('PATROL') }
        break
      case 'INVESTIGATE': {
        const g = this.goal!
        const left = this.moveAlong(this.fieldFor(g.x, g.z), HUNT_SPEED, delta)
        if (left < 0.8 || this.stateT > 12) { this.goal = { ...g }; this.setState('SEARCH'); this.stateT = 2.5 }
        break
      }
      case 'ALERT':
        b.velocity.x = b.velocity.z = 0
        this.turnTo(Math.atan2(px - b.x, pz - b.z), delta, 12)
        if (this.stateT > ALERT_BEAT) { this.unseenT = 0; this.setState('CHASE') }
        break
      case 'CHASE': {
        if (sees) this.unseenT = 0
        else this.unseenT += ctx.safe(px, pz) ? LOSE_AFTER : delta
        if (this.unseenT > LOSE_AFTER) { this.goal = { ...this.lastSeen }; this.setState('SEARCH'); break }
        maze.setGoal(px, pz)
        this.moveAlong(null, CHASE_SPEED, delta)
        if (dist < BITE_RANGE && maze.los(b.x, b.z, px, pz)) {
          this.setState('WINDUP')
          this.lungeDir = { x: (px - b.x) / (dist || 1), z: (pz - b.z) / (dist || 1) }
          audio.play('ant_bite', b.x, b.z, { rate: 0.7 })
        }
        // Stay on the colony's alert while it has you
        if (sees && Math.random() < delta * 0.7) ctx.alert(px, pz, this)
        break
      }
      case 'SEARCH': {
        const g = this.goal ?? this.lastSeen
        if (this.stateT < 2.5) {
          const left = this.moveAlong(this.fieldFor(g.x, g.z), HUNT_SPEED, delta)
          if (left < 0.8) this.stateT = 2.5
        } else {
          // Sniff around the spot, then give up and go back on patrol
          b.velocity.x = b.velocity.z = 0
          this.facing += delta * 2.4 * Math.sin(this.stateT * 1.3)
          if (this.stateT > 7) this.setState('PATROL')
        }
        break
      }
      case 'WINDUP': {
        b.velocity.x = b.velocity.z = 0
        this.lungeDir = { x: (px - b.x) / (dist || 1), z: (pz - b.z) / (dist || 1) }
        this.turnTo(Math.atan2(this.lungeDir.x, this.lungeDir.z), delta, 14)
        if (this.stateT > WINDUP) this.setState('LUNGE')
        break
      }
      case 'LUNGE':
        b.velocity.x = this.lungeDir.x * LUNGE_SPEED
        b.velocity.z = this.lungeDir.z * LUNGE_SPEED
        if (this.stateT > LUNGE) this.setState('RECOVER')
        break
      case 'RECOVER':
        b.velocity.x *= 0.8; b.velocity.z *= 0.8
        if (this.stateT > RECOVER) this.setState(this.canSee(px, pz) ? 'CHASE' : 'SEARCH')
        break
    }
    this.pose(delta)
  }

  // Legs, mandibles, rear-up — all from state
  private pose(delta: number): void {
    this.group.rotation.y = this.facing
    const moving = Math.hypot(this.collisionBody.velocity.x, this.collisionBody.velocity.z) > 0.1
    if (!moving) this.legPhase += delta * 2
    for (const l of this.legs) {
      const s = Math.sin(this.legPhase + l.ph)
      l.hip.rotation.x = s * (moving ? 0.35 : 0.04)
      l.knee.rotation.x = Math.max(0, -Math.cos(this.legPhase + l.ph)) * (moving ? 0.4 : 0)
    }
    let open = 0.15, rear = 0
    if (this.state === 'ALERT') { open = 0.5; rear = 0.15 }
    if (this.state === 'WINDUP') { open = 0.75; rear = 0.35 * Math.min(1, this.stateT / WINDUP) }
    if (this.state === 'LUNGE') { open = -0.1; rear = -0.1 }
    if (this.state === 'CHASE') open = 0.3 + Math.sin(this.stateT * 18) * 0.1
    this.mandibles.forEach((m, k) => { m.rotation.y = (k === 0 ? -1 : 1) * open })
    this.group.rotation.x = -rear
    this.head.rotation.x = -rear * 0.6
    this.eyeMat.emissiveIntensity = this.hunting ? 4.2 : 3.0
  }
}
