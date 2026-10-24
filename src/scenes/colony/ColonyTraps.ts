import * as THREE from 'three'
import { surface, PALETTE } from '../../env/Materials'
import { audio } from '../../systems/AudioManager'
import type { Enemy3D } from '../../entities/Enemy3D'
import type { ColonyMaze } from './ColonyMaze'

// ─── Colony traps ─────────────────────────────────────────────────────────────
// Every trap telegraphs — a click, a trickle of dirt, a glow, a hiss — and then
// punishes.  They hurt ants too, so a chase can be led over a plate.
//   spike plate — a cracked flagstone; step on it, CLICK, 0.35 s, spikes
//   cave-in     — dirt trickles and a shadow grows… then the ceiling drops
//   resin       — amber sap that glues your feet (40 % speed)
//   spitter     — an acid-ant nest in the wall that spits down its tunnel
//   antlion pit — a sand funnel that drags you to the jaws at its centre

export type TrapEvent =
  | { kind: 'hurt'; amount: number; fromX: number; fromZ: number; label: string }
  | { kind: 'noise'; x: number; z: number; range: number }
  | { kind: 'shake'; amount: number; time: number }
  | { kind: 'dust'; x: number; z: number; color: number; count: number }

interface Spike { x: number; z: number; plate: THREE.Mesh; spikes: THREE.InstancedMesh; state: 'idle' | 'armed' | 'up' | 'cool'; t: number }
interface CaveIn { x: number; z: number; shadow: THREE.Mesh; rock: THREE.Mesh; state: 'idle' | 'rumble' | 'fall' | 'rubble'; t: number }
interface Resin { x: number; z: number; r: number }
interface Spitter { x: number; z: number; dx: number; dz: number; eye: THREE.MeshStandardMaterial; cool: number; charge: number }
interface Glob { mesh: THREE.Mesh; x: number; z: number; vx: number; vz: number; life: number }
interface Puddle { mesh: THREE.Mesh; x: number; z: number; life: number }
interface Pit { x: number; z: number; r: number; jaws: THREE.Group; jawL: THREE.Object3D; jawR: THREE.Object3D; swirl: THREE.Mesh; snapT: number; state: 'wait' | 'tell' | 'snap' }

const SPIKE_R = 0.55
const SPIKE_DMG = 18
const CAVE_DMG = 26
const GLOB_DMG = 12
const PIT_DMG = 30

export class ColonyTraps {
  private scene: THREE.Scene
  private maze: ColonyMaze
  private gm: THREE.Texture
  private root = new THREE.Group()
  private spikes: Spike[] = []
  private caves: CaveIn[] = []
  private resins: Resin[] = []
  private spitters: Spitter[] = []
  private globs: Glob[] = []
  private puddles: Puddle[] = []
  private pits: Pit[] = []
  private stoneMat: THREE.Material
  private spikeMat: THREE.Material
  private globGeo = new THREE.SphereGeometry(0.13, 10, 8)
  private globMat = new THREE.MeshStandardMaterial({ color: 0x9cff3a, emissive: 0x6cff1a, emissiveIntensity: 2.2 })
  private puddleMat = new THREE.MeshBasicMaterial({ color: 0x7adf2a, transparent: true, opacity: 0.55, depthWrite: false })

  constructor(scene: THREE.Scene, maze: ColonyMaze, gm: THREE.Texture) {
    this.scene = scene
    this.maze = maze
    this.gm = gm
    this.stoneMat = surface({ color: 0x6a5a48, tex: 'stone', texScale: 1.4, gradientMap: gm })
    this.spikeMat = surface({ color: PALETTE.spike, tex: 'stone', texScale: 1.5, gradientMap: gm })
    scene.add(this.root)
  }

  // ── Builders ────────────────────────────────────────────────────────────────
  addSpike(x: number, z: number): void {
    // A slightly raised, cracked flagstone with holes — readable if you look
    const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.54, 0.05, 7), this.stoneMat)
    plate.position.set(x, 0.025, z); plate.rotation.y = Math.random() * Math.PI
    plate.receiveShadow = true
    this.root.add(plate)
    const holes = new THREE.Mesh(new THREE.CircleGeometry(0.42, 7).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x120c08, transparent: true, opacity: 0.35 }))
    holes.position.set(x, 0.052, z); this.root.add(holes)
    const spikes = new THREE.InstancedMesh(new THREE.ConeGeometry(0.06, 0.55, 5).translate(0, 0.275, 0), this.spikeMat, 9)
    const m = new THREE.Matrix4()
    for (let k = 0; k < 9; k++) {
      const a = (k / 9) * Math.PI * 2, r = k === 0 ? 0 : 0.28
      m.makeTranslation(x + Math.cos(a) * r, 0, z + Math.sin(a) * r)
      spikes.setMatrixAt(k, m)
    }
    spikes.scale.y = 0.001
    spikes.castShadow = true
    this.root.add(spikes)
    this.spikes.push({ x, z, plate, spikes, state: 'idle', t: 0 })
  }

  addCaveIn(x: number, z: number): void {
    const shadow = new THREE.Mesh(new THREE.CircleGeometry(1, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0, depthWrite: false }))
    shadow.position.set(x, 0.02, z); this.root.add(shadow)
    const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.6, 0), this.stoneMat)
    rock.visible = false; rock.castShadow = true
    this.root.add(rock)
    // Hairline cracks in the floor mark the spot for the observant
    const crack = new THREE.Mesh(new THREE.RingGeometry(0.75, 0.82, 9, 1, 0, Math.PI * 1.3).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x1a120a, transparent: true, opacity: 0.5 }))
    crack.position.set(x, 0.01, z); this.root.add(crack)
    this.caves.push({ x, z, shadow, rock, state: 'idle', t: 0 })
  }

  addResin(x: number, z: number, r: number): void {
    const mat = new THREE.MeshStandardMaterial({ color: 0xc8700a, emissive: 0x5a2a00, emissiveIntensity: 0.6, roughness: 0.1, metalness: 0.2, transparent: true, opacity: 0.85 })
    const g = new THREE.CircleGeometry(r, 20)
    const pos = g.attributes.position as THREE.BufferAttribute
    for (let k = 1; k < pos.count; k++) { const s = 0.75 + Math.random() * 0.4; pos.setXY(k, pos.getX(k) * s, pos.getY(k) * s) }
    const pool = new THREE.Mesh(g.rotateX(-Math.PI / 2), mat)
    pool.position.set(x, 0.015, z); this.root.add(pool)
    // A few stuck victims in it
    for (let k = 0; k < 2; k++) {
      const husk = new THREE.Mesh(new THREE.CapsuleGeometry(0.05, 0.14, 3, 6), new THREE.MeshToonMaterial({ color: 0x2a1a0c, gradientMap: this.gm }))
      husk.position.set(x + (Math.random() - 0.5) * r, 0.04, z + (Math.random() - 0.5) * r); husk.rotation.set(Math.PI / 2, 0, Math.random() * 3)
      this.root.add(husk)
    }
    this.resins.push({ x, z, r })
  }

  // A nest hole in a wall face at (x, z) spitting along (dx, dz)
  addSpitter(x: number, z: number, dx: number, dz: number): void {
    const g = new THREE.Group(); g.position.set(x, 0.55, z); g.rotation.y = Math.atan2(dx, dz)
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.07, 6, 14), this.stoneMat); g.add(rim)
    const hole = new THREE.Mesh(new THREE.CircleGeometry(0.2, 14), new THREE.MeshBasicMaterial({ color: 0x050302 }))
    hole.position.z = -0.02; g.add(hole)
    const eye = new THREE.MeshStandardMaterial({ color: 0x9cff3a, emissive: 0x6cff1a, emissiveIntensity: 1.0 })
    for (const s of [-1, 1]) {
      const e = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), eye); e.position.set(s * 0.07, 0.03, 0.0); g.add(e)
    }
    // Acid stains down the wall below it
    const stain = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.55), new THREE.MeshBasicMaterial({ color: 0x4a7a1a, transparent: true, opacity: 0.45, depthWrite: false }))
    stain.position.set(0, -0.32, 0.01); g.add(stain)
    this.root.add(g)
    this.spitters.push({ x: x + dx * 0.3, z: z + dz * 0.3, dx, dz, eye, cool: 1 + Math.random() * 2, charge: 0 })
  }

  addPit(x: number, z: number, r: number): void {
    // Sand funnel: a shallow cone of sand with a spiral swirl decal
    const sand = surface({ color: 0xb8925a, tex: 'dirt', texScale: 1.2, gradientMap: this.gm })
    const prof: THREE.Vector2[] = []
    for (let k = 0; k <= 12; k++) { const t = k / 12; prof.push(new THREE.Vector2(t * r, -0.5 * Math.pow(1 - t, 1.6) + 0.02)) }
    const funnel = new THREE.Mesh(new THREE.LatheGeometry(prof, 40), sand)
    funnel.position.set(x, 0, z); funnel.receiveShadow = true
    ;(funnel.material as THREE.Material).side = THREE.DoubleSide
    this.root.add(funnel)
    const c = document.createElement('canvas'); c.width = c.height = 256
    const g2 = c.getContext('2d')!
    g2.translate(128, 128); g2.strokeStyle = 'rgba(60,40,20,0.55)'; g2.lineWidth = 3
    for (let arm = 0; arm < 5; arm++) {
      g2.beginPath()
      for (let t = 0; t < 1; t += 0.02) { const a = arm * 1.2566 + t * 5, rr = t * 124; g2.lineTo(Math.cos(a) * rr, Math.sin(a) * rr) }
      g2.stroke()
    }
    const tex = new THREE.CanvasTexture(c)
    const swirl = new THREE.Mesh(new THREE.CircleGeometry(r, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }))
    swirl.position.set(x, 0.03, z); this.root.add(swirl)
    // Jaws waiting just under the sand at the centre
    const jaws = new THREE.Group(); jaws.position.set(x, -0.35, z); this.root.add(jaws)
    const jawMat = new THREE.MeshToonMaterial({ color: 0x2a160a, gradientMap: this.gm })
    const mk = (s: number) => {
      const p = new THREE.Group(); p.position.x = s * 0.18; jaws.add(p)
      const j = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.06, 6, 14, Math.PI * 0.75), jawMat)
      j.rotation.set(Math.PI / 2, 0, s > 0 ? Math.PI * 0.6 : Math.PI * 0.65 - Math.PI * 0.25)
      p.add(j)
      for (let k = 0; k < 3; k++) {
        const tooth = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.14, 4), jawMat)
        tooth.position.set(-s * (0.25 + k * 0.08), 0, 0.3 - k * 0.12); tooth.rotation.z = s * Math.PI / 2
        p.add(tooth)
      }
      return p
    }
    const jawL = mk(-1), jawR = mk(1)
    this.pits.push({ x, z, r, jaws, jawL, jawR, swirl, snapT: 0, state: 'wait' })
  }

  // ── Per-frame ───────────────────────────────────────────────────────────────
  // Speed multiplier for Webbs at (x, z)
  slowAt(x: number, z: number): number {
    for (const r of this.resins) if ((x - r.x) ** 2 + (z - r.z) ** 2 < r.r * r.r * 0.8) return 0.4
    return 1
  }

  update(dt: number, px: number, pz: number, pr: number, enemies: Enemy3D[], out: TrapEvent[], applyPull: (vx: number, vz: number) => void): void {
    // Spike plates
    for (const s of this.spikes) {
      s.t += dt
      const onP = (px - s.x) ** 2 + (pz - s.z) ** 2 < (SPIKE_R + pr * 0.5) ** 2
      const enemyOn = enemies.some(e => !e.isDead() && e.config.speed > 0 && (e.collisionBody.x - s.x) ** 2 + (e.collisionBody.z - s.z) ** 2 < SPIKE_R * SPIKE_R)
      if (s.state === 'idle' && (onP || enemyOn)) {
        s.state = 'armed'; s.t = 0
        audio.play('trap_click', s.x, s.z, { volume: 1.3 })   // the click
        s.plate.position.y = 0.0
      } else if (s.state === 'armed' && s.t > 0.35) {
        s.state = 'up'; s.t = 0
        audio.play('trap_spike', s.x, s.z)
        audio.impact('medium', s.x, s.z)
        out.push({ kind: 'noise', x: s.x, z: s.z, range: 9 })
        if ((px - s.x) ** 2 + (pz - s.z) ** 2 < (SPIKE_R + pr) ** 2) out.push({ kind: 'hurt', amount: SPIKE_DMG, fromX: s.x, fromZ: s.z, label: 'Spike trap!' })
        for (const e of enemies) {
          if (e.isDead() || e.config.speed <= 0) continue
          if ((e.collisionBody.x - s.x) ** 2 + (e.collisionBody.z - s.z) ** 2 < (SPIKE_R + e.config.bodyRadius) ** 2) { e.takeDamage(30); e.stagger(0.6) }
        }
      } else if (s.state === 'up' && s.t > 0.7) { s.state = 'cool'; s.t = 0 }
      else if (s.state === 'cool' && s.t > 2.2 && !onP) { s.state = 'idle'; s.t = 0; s.plate.position.y = 0.025 }
      const target = s.state === 'up' ? 1 : s.state === 'cool' ? Math.max(0, 1 - s.t * 2) : 0.001
      s.spikes.scale.y += (target - s.spikes.scale.y) * Math.min(1, dt * (s.state === 'up' ? 40 : 8))
      s.spikes.scale.y = Math.max(0.001, s.spikes.scale.y)
    }

    // Cave-ins
    for (const c of this.caves) {
      c.t += dt
      const d2 = (px - c.x) ** 2 + (pz - c.z) ** 2
      const sm = c.shadow.material as THREE.MeshBasicMaterial
      if (c.state === 'idle' && d2 < 1.3 * 1.3) {
        c.state = 'rumble'; c.t = 0
        audio.impact('heavy', c.x, c.z)
        audio.play('rubble_fall', c.x, c.z, { rate: 0.55, volume: 0.6 })   // grit trickling from the roof
        out.push({ kind: 'shake', amount: 0.006, time: 0.9 })
      }
      if (c.state === 'rumble') {
        sm.opacity = Math.min(0.75, c.t * 0.9)
        c.shadow.scale.setScalar(0.4 + c.t * 0.7)
        if (Math.random() < dt * 14) out.push({ kind: 'dust', x: c.x + (Math.random() - 0.5) * 1.2, z: c.z + (Math.random() - 0.5) * 1.2, color: 0x6a5238, count: 3 })
        if (c.t > 0.95) { c.state = 'fall'; c.t = 0; c.rock.visible = true; c.rock.position.set(c.x, 4, c.z); c.rock.rotation.set(Math.random(), Math.random(), 0) }
      } else if (c.state === 'fall') {
        c.rock.position.y = Math.max(0.42, 4 - c.t * c.t * 40)
        if (c.rock.position.y <= 0.42) {
          c.state = 'rubble'; c.t = 0
          audio.impact('heavy', c.x, c.z); audio.play('rubble_fall', c.x, c.z, { volume: 1.3 }); audio.play('rubble_fall', c.x, c.z, { rate: 0.7 })
          out.push({ kind: 'shake', amount: 0.03, time: 0.35 }, { kind: 'dust', x: c.x, z: c.z, color: 0x6a5238, count: 24 }, { kind: 'noise', x: c.x, z: c.z, range: 12 })
          if (d2 < (0.95 + pr) ** 2) out.push({ kind: 'hurt', amount: CAVE_DMG, fromX: c.x, fromZ: c.z, label: 'Cave-in!' })
          for (const e of enemies) if (!e.isDead() && e.config.speed > 0 && (e.collisionBody.x - c.x) ** 2 + (e.collisionBody.z - c.z) ** 2 < 1.1) { e.takeDamage(45); e.stagger(1) }
          sm.opacity = 0
        }
      } else if (c.state === 'rubble') {
        if (c.t > 6) { c.rock.scale.setScalar(Math.max(0.01, 1 - (c.t - 6))); if (c.t > 7) { c.rock.visible = false; c.rock.scale.setScalar(1) } }
        if (c.t > 35) { c.state = 'idle'; c.t = 0 }
      }
    }

    // Acid spitters: charge (eyes brighten, hiss), then spit down the tunnel
    for (const s of this.spitters) {
      s.cool -= dt
      const vx = px - s.x, vz = pz - s.z, d = Math.hypot(vx, vz)
      const inLine = d < 8 && (vx * s.dx + vz * s.dz) / (d || 1) > 0.93 && this.maze.los(s.x, s.z, px, pz)
      if (s.charge > 0) {
        s.charge += dt
        s.eye.emissiveIntensity = 1 + s.charge * 8
        if (s.charge > 0.45) {
          s.charge = 0; s.cool = 1.6; s.eye.emissiveIntensity = 1
          const l = d || 1
          const mesh = new THREE.Mesh(this.globGeo, this.globMat)
          mesh.position.set(s.x, 0.5, s.z); this.root.add(mesh)
          this.globs.push({ mesh, x: s.x, z: s.z, vx: vx / l * 6.2, vz: vz / l * 6.2, life: 2 })
          audio.play('web_attach_wall', s.x, s.z, { rate: 0.75, volume: 1.1 })   // a wet spit
        }
      } else if (inLine && s.cool <= 0) {
        s.charge = 0.001
        audio.play('ant_hiss', s.x, s.z, { rate: 1.3, volume: 0.8 })   // drawing breath
      }
    }
    for (let k = this.globs.length - 1; k >= 0; k--) {
      const g = this.globs[k]
      g.life -= dt
      g.x += g.vx * dt; g.z += g.vz * dt
      g.mesh.position.set(g.x, 0.45 + Math.sin(g.life * 9) * 0.03, g.z)
      const hitP = (px - g.x) ** 2 + (pz - g.z) ** 2 < (pr + 0.13) ** 2
      if (hitP || g.life <= 0 || this.maze.isSolidAt(g.x, g.z)) {
        if (hitP) out.push({ kind: 'hurt', amount: GLOB_DMG, fromX: g.x - g.vx * 0.05, fromZ: g.z - g.vz * 0.05, label: 'Acid!' })
        out.push({ kind: 'dust', x: g.x, z: g.z, color: 0x8aff3a, count: 10 })
        const back = this.maze.isSolidAt(g.x, g.z) ? 0.12 : 0
        const pud = new THREE.Mesh(new THREE.CircleGeometry(0.4, 12).rotateX(-Math.PI / 2), this.puddleMat)
        pud.position.set(g.x - g.vx * back, 0.02, g.z - g.vz * back); this.root.add(pud)
        this.puddles.push({ mesh: pud, x: pud.position.x, z: pud.position.z, life: 3 })
        this.root.remove(g.mesh)
        this.globs.splice(k, 1)
      }
    }
    for (let k = this.puddles.length - 1; k >= 0; k--) {
      const p = this.puddles[k]
      p.life -= dt
      p.mesh.scale.setScalar(Math.max(0.01, Math.min(1, p.life)))
      if ((px - p.x) ** 2 + (pz - p.z) ** 2 < 0.16 && Math.random() < dt * 2) out.push({ kind: 'hurt', amount: 4, fromX: p.x, fromZ: p.z, label: '' })
      if (p.life <= 0) { this.root.remove(p.mesh); p.mesh.geometry.dispose(); this.puddles.splice(k, 1) }
    }

    // Antlion pits: pull toward the centre, jaws snap at whoever is there
    for (const p of this.pits) {
      const vx = p.x - px, vz = p.z - pz, d = Math.hypot(vx, vz)
      ;(p.swirl.rotation as THREE.Euler).y += dt * 0.5
      if (d < p.r) {
        const pull = 1.0 + 2.6 * (1 - d / p.r)   // Webbs runs 5.4: he can always claw out, slowly
        applyPull(vx / (d || 1) * pull, vz / (d || 1) * pull)
        if (Math.random() < dt * 8) out.push({ kind: 'dust', x: px, z: pz, color: 0xc8a060, count: 2 })
      }
      p.snapT += dt
      if (p.state === 'wait' && d < 1.0 && p.snapT > 0.6) {
        p.state = 'tell'; p.snapT = 0
        audio.play('centipede_burst', p.x, p.z, { rate: 0.7 })
        out.push({ kind: 'dust', x: p.x, z: p.z, color: 0xc8a060, count: 20 })
      } else if (p.state === 'tell') {
        p.jaws.position.y = -0.35 + Math.min(1, p.snapT / 0.4) * 0.4
        p.jawL.rotation.y = -0.6; p.jawR.rotation.y = 0.6
        if (p.snapT > 0.45) {
          p.state = 'snap'; p.snapT = 0
          audio.play('chitin_crack', p.x, p.z, { rate: 0.6, volume: 2.2 }); audio.play('beetle_charge_crash', p.x, p.z, { rate: 1.4, volume: 0.6 }); audio.impact('heavy', p.x, p.z)
          out.push({ kind: 'noise', x: p.x, z: p.z, range: 10 }, { kind: 'shake', amount: 0.02, time: 0.25 })
          if (d < 1.05) out.push({ kind: 'hurt', amount: PIT_DMG, fromX: p.x, fromZ: p.z, label: 'Antlion!' })
          for (const e of enemies) if (!e.isDead() && e.config.speed > 0 && Math.hypot(e.collisionBody.x - p.x, e.collisionBody.z - p.z) < 1.05) { e.takeDamage(60); e.stagger(0.8) }
        }
      } else if (p.state === 'snap') {
        p.jawL.rotation.y = 0.15; p.jawR.rotation.y = -0.15
        if (p.snapT > 0.7) { p.jaws.position.y -= dt * 2; if (p.snapT > 1.1) { p.state = 'wait'; p.snapT = 0; p.jaws.position.y = -0.35 } }
      }
    }
  }

  dispose(): void {
    this.scene.remove(this.root)
    this.root.traverse(o => {
      const m = o as THREE.Mesh
      if (m.isMesh) { m.geometry.dispose(); (Array.isArray(m.material) ? m.material : [m.material]).forEach(x => x.dispose()) }
    })
    this.globGeo.dispose(); this.globMat.dispose(); this.puddleMat.dispose()
  }
}
