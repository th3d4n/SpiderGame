import * as THREE from 'three'
import { Enemy3D, type EnemyConfig3D } from './Enemy3D'
import { addRim, surface } from '../env/Materials'
import { WeaponType } from '../systems/WeaponSystem'

// ─── The Anteater ─────────────────────────────────────────────────────────────
// The colony's predator, far too big for the arena: only its snout fits
// through the hole in the back wall.  Phase 1 it snorts rocks and inhales;
// phase 2 it shoves its head through and fires its tongue along the floor.
//
//   Anteater3D      — the creature's visuals (head behind the wall, a bendy
//                     segmented snout, bristles) and pose helpers.  Not an
//                     Enemy3D: the scene owns its health and timing.
//   AnteaterTongue3D — the tongue's tip as an Enemy3D, so the web can snag it
//                     and weapons can hit it.  It only really hurts while
//                     pinned by the web.

const SEGMENTS   = 9
const SEG_LEN    = 0.45
const BASE_R     = 0.56
const TIP_R      = 0.15
const SKIN       = 0x6e5c4e
const SKIN_DARK  = 0x3a2e28
const FUR        = 0x2c221c

export class Anteater3D {
  readonly root = new THREE.Group()
  readonly head = new THREE.Group()
  private snoutBase = new THREE.Group()       // pivot at the wall hole
  private joints: THREE.Group[] = []          // one per segment, chained
  private tipAnchor = new THREE.Object3D()    // nose pad / mouth (tongue comes out here)
  private nostrils: THREE.Mesh[] = []
  private eyeMat: THREE.MeshStandardMaterial
  private skinMats: THREE.MeshToonMaterial[] = []
  private t = 0
  bend = { yaw: 0, pitch: 0 }                  // how the snout curls toward its target (spread over the joints)
  reach = 1                                    // 0..1 how far the snout is pushed out (phase change shoves it)
  flinch = 0                                   // decaying recoil from a hit

  constructor(scene: THREE.Scene, gm: THREE.Texture, at: THREE.Vector3, scale = 1) {
    this.root.position.copy(at)
    this.root.scale.setScalar(scale)
    scene.add(this.root)

    // Head (behind the wall): a long low skull, small eyes, rounded ears, bristly
    // Streaky coarse-fur texture (tri-planar wood grain reads as hair at this scale)
    const skin = () => { const m = surface({ color: SKIN, tex: 'wood', texScale: 2.4, gradientMap: gm }); this.skinMats.push(m); return m }
    const fur = new THREE.MeshToonMaterial({ color: FUR, gradientMap: gm })
    this.head.position.set(0, 0, -1.3)
    this.root.add(this.head)
    const skull = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), skin())
    skull.scale.set(1.15, 0.9, 1.5); this.head.add(skull)
    this.eyeMat = new THREE.MeshStandardMaterial({ color: 0x0a0604, emissive: 0x3a0a04, emissiveIntensity: 0.6, roughness: 0.1 })
    for (const s of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 8), this.eyeMat)
      eye.position.set(s * 0.72, 0.3, 0.7); this.head.add(eye)
      const ear = new THREE.Mesh(new THREE.SphereGeometry(0.28, 10, 8), skin())
      ear.scale.set(0.5, 1, 0.8); ear.position.set(s * 0.95, 0.75, -0.2); ear.rotation.z = -s * 0.5; this.head.add(ear)
    }
    // Coarse fur: a mane of bristles over the skull and down the neck
    const bristle = new THREE.ConeGeometry(0.05, 0.42, 4).translate(0, 0.21, 0)
    const mane = new THREE.InstancedMesh(bristle, fur, 160)
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0)
    for (let k = 0; k < 160; k++) {
      const a = Math.random() * Math.PI * 2, b = Math.random() * 0.9
      const n = new THREE.Vector3(Math.sin(b) * Math.cos(a) * 1.15, Math.cos(b) * 0.9, Math.sin(b) * Math.sin(a) * 1.5 - 0.3).normalize()
      const p = new THREE.Vector3(n.x * 1.1, n.y * 0.85, n.z * 1.45)
      q.setFromUnitVectors(up, n.clone().add(new THREE.Vector3(0, 0, -0.5)).normalize())
      m4.compose(p, q, new THREE.Vector3(1, 0.7 + Math.random() * 0.8, 1))
      mane.setMatrixAt(k, m4)
    }
    this.head.add(mane)

    // Snout: a chain of tapered segments from the head, out through the hole
    this.snoutBase.position.set(0, -0.15, 0.9)
    this.head.add(this.snoutBase)
    let parent: THREE.Object3D = this.snoutBase
    for (let i = 0; i < SEGMENTS; i++) {
      const r0 = BASE_R + (TIP_R - BASE_R) * (i / SEGMENTS)
      const r1 = BASE_R + (TIP_R - BASE_R) * ((i + 1) / SEGMENTS)
      const joint = new THREE.Group()
      parent.add(joint)
      const seg = new THREE.Mesh(new THREE.CylinderGeometry(r1, r0, SEG_LEN, 16).rotateX(Math.PI / 2).translate(0, 0, SEG_LEN / 2),
        i < SEGMENTS - 1 ? skin() : new THREE.MeshToonMaterial({ color: SKIN_DARK, gradientMap: gm }))
      seg.castShadow = true
      joint.add(seg)
      const knuckle = new THREE.Mesh(new THREE.SphereGeometry(r0 * 1.01, 14, 10), seg.material)
      joint.add(knuckle)
      // Wrinkle ring
      const ring = new THREE.Mesh(new THREE.TorusGeometry(r0 * 0.98, r0 * 0.06, 5, 16), new THREE.MeshToonMaterial({ color: SKIN_DARK, gradientMap: gm }))
      joint.add(ring)
      // Bristles: a full collar where the snout leaves the head, then a ridge
      // of coarse hair along the top, thinning toward the tip
      const count = i < 2 ? 30 : Math.max(4, 14 - i)
      const tuft = new THREE.InstancedMesh(bristle, fur, count)
      for (let k = 0; k < count; k++) {
        const a = i < 2 ? (k / count) * Math.PI * 2 : Math.PI / 2 + (Math.random() - 0.5) * 1.6
        const n = new THREE.Vector3(Math.cos(a), Math.sin(a), 0.6).normalize()
        q.setFromUnitVectors(up, n)
        const sc = (i < 2 ? 0.6 : 0.35) * (0.6 + Math.random() * 0.6)
        m4.compose(new THREE.Vector3(Math.cos(a) * r0 * 0.95, Math.sin(a) * r0 * 0.95, Math.random() * SEG_LEN), q, new THREE.Vector3(0.7, sc, 0.7))
        tuft.setMatrixAt(k, m4)
      }
      joint.add(tuft)
      const next = new THREE.Group(); next.position.z = SEG_LEN
      joint.add(next)
      this.joints.push(joint)
      parent = next
    }
    // Nose pad at the tip: wet, dark, two flaring nostrils, the tiny mouth below
    const pad = new THREE.Mesh(new THREE.SphereGeometry(TIP_R * 1.05, 14, 10), new THREE.MeshStandardMaterial({ color: 0x241a16, roughness: 0.15, metalness: 0.1 }))
    pad.scale.set(1.1, 0.9, 0.7); parent.add(pad)
    for (const s of [-1, 1]) {
      const n = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), new THREE.MeshBasicMaterial({ color: 0x050302 }))
      n.scale.set(1, 0.7, 0.4); n.position.set(s * 0.08, 0.05, TIP_R * 0.68); parent.add(n); this.nostrils.push(n)
    }
    this.tipAnchor.position.set(0, -0.08, TIP_R * 0.6)
    parent.add(this.tipAnchor)
    addRim(this.root, { color: 0xffb08a, strength: 0.25 })
  }

  // World position of the mouth (tongue origin / where rocks fly from)
  tip(out: THREE.Vector3): THREE.Vector3 {
    this.root.updateMatrixWorld(true)
    return this.tipAnchor.getWorldPosition(out)
  }

  // Aim the snout's curl toward a world point (applied gradually in update)
  aimAt(target: THREE.Vector3, strength = 1): void {
    const base = new THREE.Vector3(); this.snoutBase.getWorldPosition(base)
    const dx = target.x - base.x, dy = target.y - base.y, dz = target.z - base.z
    const yaw = Math.atan2(dx, dz)
    const pitch = -Math.atan2(dy, Math.hypot(dx, dz))
    this.bend.yaw += (THREE.MathUtils.clamp(yaw, -0.9, 0.9) - this.bend.yaw) * strength
    this.bend.pitch += (THREE.MathUtils.clamp(pitch, -0.1, 0.75) - this.bend.pitch) * strength
  }

  update(dt: number, opts: { sniff?: boolean; inhale?: number; flare?: number } = {}): void {
    this.t += dt
    this.flinch = Math.max(0, this.flinch - dt * 2.5)
    const sway = opts.sniff ? Math.sin(this.t * 2.1) * 0.12 : Math.sin(this.t * 0.9) * 0.04
    // Spread the bend over the chain so the snout curves instead of kinking
    this.snoutBase.rotation.set(this.bend.pitch * 0.35 - this.flinch * 0.4, this.bend.yaw * 0.4, 0)
    this.joints.forEach((j, i) => {
      if (i === 0) return
      const k = i / SEGMENTS
      j.rotation.set(this.bend.pitch * 0.12 + Math.sin(this.t * 3 + i) * 0.015 + this.flinch * 0.08 * Math.sin(this.t * 40),
        this.bend.yaw * 0.1 + sway * k, 0)
    })
    this.head.position.z = -1.3 + (this.reach - 1) * 1.2
    // Breathing: the nostrils flare, harder while it inhales
    const inhale = opts.inhale ?? 0
    const flare = 1 + 0.25 * Math.max(0, Math.sin(this.t * (opts.sniff ? 9 : 3))) + inhale * 0.9 + (opts.flare ?? 0)
    for (const n of this.nostrils) n.scale.set(flare, 0.7 * flare, 0.4)
    this.eyeMat.emissiveIntensity = 0.6 + inhale * 1.5
  }

  hitFlash(on: boolean): void {
    for (const m of this.skinMats) m.color.setHex(on ? 0xff7766 : SKIN)
  }

  dispose(): void {
    this.root.parent?.remove(this.root)
    this.root.traverse(o => {
      const m = o as THREE.Mesh
      if (m.isMesh) { m.geometry.dispose(); (Array.isArray(m.material) ? m.material : [m.material]).forEach(x => x.dispose()) }
    })
  }
}

// ── Tongue ────────────────────────────────────────────────────────────────────

const TONGUE_CONFIG: EnemyConfig3D = {
  health: 220, speed: 0, damage: 0, bodyRadius: 0.24,
  knockbackResist: 1, staggerDuration: 0,
}
const LINKS = 26

export class AnteaterTongue3D extends Enemy3D {
  pinned = false
  private links: THREE.Mesh[] = []
  private beads: THREE.InstancedMesh
  private tipMesh!: THREE.Mesh
  private tongueMat: THREE.MeshStandardMaterial
  private strand = new THREE.Group()
  private wob = 0

  constructor(scene: THREE.Scene, gm: THREE.Texture) {
    super(scene, 0, -100, TONGUE_CONFIG, gm)
    this.usesNav = false
    this.tongueMat = new THREE.MeshStandardMaterial({ color: 0xd8607e, emissive: 0x5a1020, emissiveIntensity: 0.4, roughness: 0.25 })
    const linkGeo = new THREE.CapsuleGeometry(0.075, 0.3, 4, 8).rotateX(Math.PI / 2)
    for (let i = 0; i < LINKS; i++) {
      const l = new THREE.Mesh(linkGeo, this.tongueMat); l.castShadow = true
      this.strand.add(l); this.links.push(l)
    }
    this.beads = new THREE.InstancedMesh(new THREE.SphereGeometry(0.03, 6, 4), new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.7, roughness: 0.05 }), LINKS)
    this.strand.add(this.beads)
    scene.add(this.strand)
    this.buildVisuals()
    this.collisionBody.enabled = false
  }

  buildVisuals(): void {
    // The sticky tip
    this.tipMesh = new THREE.Mesh(new THREE.SphereGeometry(0.17, 12, 10), new THREE.MeshStandardMaterial({ color: 0xb8405e, emissive: 0x7a1030, emissiveIntensity: 0.5, roughness: 0.15 }))
    this.tipMesh.scale.set(1, 0.7, 1.3)
    this.tipMesh.position.y = 0.1
    this.group.add(this.tipMesh)
  }

  // Lay the tongue from the mouth to (tx, tz).  len01 0 = in the mouth.
  layOut(from: THREE.Vector3, tx: number, tz: number, dt: number, thrash = 0): void {
    this.wob += dt * (6 + thrash * 20)
    const vis = Math.hypot(tx - from.x, tz - from.z) > 0.2
    this.strand.visible = vis
    this.group.visible = vis
    const m4 = new THREE.Matrix4()
    const dx = tx - from.x, dz = tz - from.z, len = Math.hypot(dx, dz) || 1
    const px = -dz / len, pz = dx / len
    let prev = from.clone()
    for (let i = 0; i < LINKS; i++) {
      const t = (i + 1) / LINKS
      // Droops from the mouth to the floor, wriggles side to side along its length
      const side = Math.sin(this.wob - t * 9) * 0.12 * Math.sin(t * Math.PI) * (1 + thrash * 1.5)
      const p = new THREE.Vector3(from.x + dx * t + px * side, Math.max(0.09, from.y * (1 - t) ** 2.2 + 0.09), from.z + dz * t + pz * side)
      const l = this.links[i]
      l.position.copy(prev).lerp(p, 0.5)
      l.lookAt(p)
      l.scale.set(1, 1, Math.max(0.2, prev.distanceTo(p) / 0.45 * 1.25))   // overlap: no gaps at the bends
      m4.makeTranslation(p.x + px * 0.06, p.y + 0.06, p.z + pz * 0.06)
      this.beads.setMatrixAt(i, m4)
      prev = p
    }
    this.beads.instanceMatrix.needsUpdate = true
    this.collisionBody.x = tx
    this.collisionBody.z = tz
    this.group.position.set(tx, 0, tz)
    this.group.rotation.y = Math.atan2(dx, dz)
  }

  // Unpinned the tongue whips about too fast to hurt much — the web is the key
  override takeDamage(amount: number, zone?: Parameters<Enemy3D['takeDamage']>[1], weapon?: Parameters<Enemy3D['takeDamage']>[2]): void {
    super.takeDamage(this.pinned ? amount : amount * 0.12, zone, weapon)
  }

  override dealsContactDamage(): boolean { return false }
  override applyKnockback(): void {}
  protected setFlashColor(on: boolean): void { this.tongueMat.emissiveIntensity = on ? 2.2 : this.pinned ? 0.9 : 0.4 }
  setPinnedGlow(t: number): void { if (this.pinned) this.tongueMat.emissiveIntensity = 0.6 + Math.sin(t * 10) * 0.35 }

  updateAI(): void { this.collisionBody.velocity.x = this.collisionBody.velocity.z = 0 }

  // No death animation of its own — the scene plays the anteater's fall
  override startDeath(): void {
    if (this.deathState) return
    this.collisionBody.enabled = false
    this.deathState = { weapon: WeaponType.Empty, elapsed: 0, duration: 0.01, phase: 'default' }
  }
  override updateDeath(delta: number): void { if (this.deathState) this.deathState.elapsed += delta }

  override cleanup(): void {
    super.cleanup()
    this.strand.parent?.remove(this.strand)
    this.strand.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh) { m.geometry.dispose(); (m.material as THREE.Material).dispose() } })
  }
}
