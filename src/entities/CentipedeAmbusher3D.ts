import * as THREE from 'three'
import { Enemy3D, type EnemyConfig3D, WeakPointZone } from './Enemy3D'
import { WeaponType } from '../systems/WeaponSystem'
import { audio } from '../systems/AudioManager'

// ── Stats (pixel values × 0.01 = world units) ────────────────────────────────
const CONFIG: EnemyConfig3D = {
  health:          30,
  speed:           1.3,    // 130 px/s × 0.01
  damage:          12,
  bodyRadius:      0.14,   // 14 px × 0.01
  knockbackResist: 0.1,
  staggerDuration: 0.42,   // 420 ms
  weakPoints:      [WeakPointZone.Head],
  weakMultiplier:  2.0,
}

// AI speeds
const TRACK_SPEED   = 0.7   // 70 px/s
const LUNGE_SPEED   = 3.2   // 320 px/s
const TURN_RATE     = 4.5   // rad/s

// AI timings (seconds)
const BURST_DUR     = 0.585
const WINDUP_DUR    = 0.32
const LUNGE_DUR     = 0.28
const RECOVER_DUR   = 0.62

// Trigger distances (world units)
const HIDE_TRIGGER  = 1.9   // 190 px × 0.01

// Burst-slither constants
const SLITHER_FREQ  = 4.0   // rad/s perpendicular oscillator
const SLITHER_AMP   = 0.42  // max angle weave (radians)
const SCURRY_ON     = 0.40  // seconds of high-speed burst
const SCURRY_OFF    = 0.14  // seconds of brief pause between bursts
const SCURRY_FAST   = 1.0   // speed multiplier during burst
const SCURRY_SLOW   = 0.28  // speed multiplier during pause

// Wall-hugging: Z boundaries of corridor dividers (AntColonyScene3D layout)
const WALL_Z_BOUNDS = [-11.5, -8.5, -6.5, -3.5, -1.5, 1.5, 3.5, 6.5, 8.5, 11.5]
const WALL_HUG_DIST = 0.48  // wu from wall to trigger hugging
const WALL_HUG_STR  = 0.78  // blend strength toward wall-run angle

type CentState = 'HIDING' | 'BURSTING' | 'TRACKING' | 'WINDUP' | 'LUNGING' | 'RECOVERING'

export class CentipedeAmbusher3D extends Enemy3D {
  private state:       CentState = 'HIDING'
  private prevState:   CentState = 'HIDING'   // Round 10 — transition detection for one-shot SFX
  private stateTimer   = 0
  private lungeDir     = new THREE.Vector2(0, 1)
  private facingAngle  = 0
  private slitherPhase = Math.random() * Math.PI * 2
  private scurryTimer  = SCURRY_ON
  private scurryActive = true

  // Visual meshes for flash tint
  private bodyMeshes:     THREE.Mesh[] = []
  private eyeMeshes:      THREE.Mesh[] = []
  private mandibleMeshes: THREE.Mesh[] = []
  private mandibleSides:  number[]     = []

  constructor(threeScene: THREE.Scene, x: number, z: number, gradientMap: THREE.Texture) {
    super(threeScene, x, z, CONFIG, gradientMap)
    this.buildVisuals()
    // Start hidden and small
    this.group.scale.setScalar(0.05)
    this.collisionBody.enabled = false
  }

  buildVisuals(): void {
    const segColors = [0x2a4a1a, 0x336622, 0x2a4a1a]
    const segScales = [
      { x: 0.12, y: 0.08, z: 0.14 },  // head
      { x: 0.14, y: 0.09, z: 0.16 },  // mid
      { x: 0.13, y: 0.08, z: 0.14 },  // tail
    ]
    const segZ = [0.16, 0, -0.18]

    for (let i = 0; i < 3; i++) {
      const geo = new THREE.SphereGeometry(1, 10, 8)
      const mat = new THREE.MeshToonMaterial({
        color: segColors[i],
        gradientMap: this.gradientMap,
      })
      const seg = new THREE.Mesh(geo, mat)
      const s = segScales[i]
      seg.scale.set(s.x, s.y, s.z)
      seg.position.set(0, s.y, segZ[i])
      seg.castShadow = true
      this.group.add(seg)
      this.bodyMeshes.push(seg)
    }

    // Red eyes on head segment
    const eyeMat = new THREE.MeshStandardMaterial({
      color: 0xff2222,
      emissive: 0xcc0000,
      emissiveIntensity: 1.0,
    })
    const eyeGeo = new THREE.SphereGeometry(0.025, 6, 4)
    for (const ex of [-0.055, 0.055]) {
      const eye = new THREE.Mesh(eyeGeo, eyeMat)
      eye.position.set(ex, 0.085, 0.22)
      this.group.add(eye)
      this.eyeMeshes.push(eye)
    }

    // Mandibles — two small thin cones
    const mandMat = new THREE.MeshToonMaterial({ color: 0x1a3010, gradientMap: this.gradientMap })
    for (const mx of [-0.06, 0.06]) {
      const mand = new THREE.Mesh(new THREE.ConeGeometry(0.02, 0.08, 5), mandMat)
      mand.position.set(mx, 0.06, 0.28)
      mand.rotation.x = -Math.PI / 2
      this.group.add(mand)
      this.mandibleMeshes.push(mand)
      this.mandibleSides.push(mx < 0 ? -1 : 1)
    }
  }

  protected setFlashColor(on: boolean): void {
    for (const m of this.bodyMeshes) {
      ;(m.material as THREE.MeshToonMaterial).color.setHex(on ? 0xff4422 : (
        this.bodyMeshes.indexOf(m) === 0 ? 0x2a4a1a : 0x336622
      ))
    }
  }

  updateAI(delta: number, playerX: number, playerZ: number): void {
    const dx = playerX - this.collisionBody.x
    const dz = playerZ - this.collisionBody.z
    const dist = Math.sqrt(dx * dx + dz * dz)

    this.stateTimer += delta
    // Round 10 — emit transition SFX (compare with prevState captured at end of frame).
    if (this.state !== this.prevState) {
      const cx = this.collisionBody.x, cz = this.collisionBody.z
      if (this.state === 'BURSTING')        audio.play('centipede_burst', cx, cz)
      else if (this.state === 'LUNGING')    audio.play('centipede_attack', cx, cz)
      else if (this.state === 'TRACKING')   audio.playLoop('centipede_skitter', cx, cz)
      if (this.prevState === 'TRACKING')    audio.stopLoop('centipede_skitter')
      this.prevState = this.state
    }

    switch (this.state) {
      case 'HIDING': {
        this.collisionBody.velocity.x = 0
        this.collisionBody.velocity.z = 0
        if (dist < HIDE_TRIGGER) {
          this.state = 'BURSTING'
          this.stateTimer = 0
          this.collisionBody.enabled = true
        }
        break
      }

      case 'BURSTING': {
        this.collisionBody.velocity.x = 0
        this.collisionBody.velocity.z = 0
        const t = Math.min(1, this.stateTimer / BURST_DUR)
        this.group.scale.setScalar(t)
        if (this.stateTimer >= BURST_DUR) {
          this.state = 'TRACKING'
          this.stateTimer = 0
          this.group.scale.setScalar(1)
        }
        break
      }

      case 'TRACKING': {
        // Burst-scurry cycle: alternate full-speed bursts with brief pauses
        this.scurryTimer -= delta
        if (this.scurryTimer <= 0) {
          this.scurryActive = !this.scurryActive
          this.scurryTimer  = this.scurryActive ? SCURRY_ON : SCURRY_OFF
        }
        const speedMult = this.scurryActive ? SCURRY_FAST : SCURRY_SLOW

        // Slither oscillator: weave perpendicularly to heading
        this.slitherPhase += SLITHER_FREQ * delta
        const weaveOffset = this.scurryActive ? Math.sin(this.slitherPhase) * SLITHER_AMP : 0

        let desiredAngle = Math.atan2(dx, dz) + weaveOffset

        // Wall-hug: if near a corridor wall, blend toward running along X axis
        const nearWall = nearestWallZ(this.collisionBody.z)
        if (nearWall !== null) {
          const wallRunAngle = (playerX > this.collisionBody.x) ? Math.PI / 2 : -Math.PI / 2
          desiredAngle = lerpAngleMix(desiredAngle, wallRunAngle, WALL_HUG_STR)
        }

        const angleDiff = wrapAngle(desiredAngle - this.facingAngle)
        this.facingAngle += Math.sign(angleDiff) * Math.min(Math.abs(angleDiff), TURN_RATE * delta)
        this.group.rotation.y = this.facingAngle

        this.collisionBody.velocity.x = Math.sin(this.facingAngle) * TRACK_SPEED * speedMult
        this.collisionBody.velocity.z = Math.cos(this.facingAngle) * TRACK_SPEED * speedMult

        // Enter windup when close and roughly facing player (only during active scurry)
        if (this.scurryActive && dist < 1.0 && Math.abs(wrapAngle(Math.atan2(dx, dz) - this.facingAngle)) < 0.4) {
          this.state      = 'WINDUP'
          this.stateTimer = 0
          this.collisionBody.velocity.x = 0
          this.collisionBody.velocity.z = 0
        }
        break
      }

      case 'WINDUP': {
        this.collisionBody.velocity.x = 0
        this.collisionBody.velocity.z = 0
        // Lock lunge direction toward current player position
        this.lungeDir.set(dx, dz).normalize()
        if (this.stateTimer >= WINDUP_DUR) {
          this.state = 'LUNGING'
          this.stateTimer = 0
        }
        break
      }

      case 'LUNGING': {
        this.collisionBody.velocity.x = this.lungeDir.x * LUNGE_SPEED
        this.collisionBody.velocity.z = this.lungeDir.y * LUNGE_SPEED
        if (this.stateTimer >= LUNGE_DUR) {
          this.state = 'RECOVERING'
          this.stateTimer = 0
          this.collisionBody.velocity.x = 0
          this.collisionBody.velocity.z = 0
        }
        break
      }

      case 'RECOVERING': {
        this.collisionBody.velocity.x = 0
        this.collisionBody.velocity.z = 0
        if (this.stateTimer >= RECOVER_DUR) {
          this.state = 'TRACKING'
          this.stateTimer = 0
        }
        break
      }
    }

    const windupT = this.state === 'WINDUP' ? Math.min(1, this.stateTimer / WINDUP_DUR) : 0
    this.applyWindupTell(windupT)
  }

  private applyWindupTell(t: number): void {
    const eyeScale = 1 + t * 0.8        // up to ×1.8
    for (const eye of this.eyeMeshes) eye.scale.setScalar(eyeScale)
    for (let i = 0; i < this.mandibleMeshes.length; i++) {
      this.mandibleMeshes[i].rotation.y = this.mandibleSides[i] * t * 0.55
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Round 9b — weapon-specific death animations.
  // The centipede has 3 segmented body meshes (head/mid/tail).  Each death
  // exploits that articulated structure differently.
  // ───────────────────────────────────────────────────────────────────────────
  private deathParts: Array<{
    mesh: THREE.Mesh; vx: number; vy: number; vz: number; rotVx: number; rotVz: number
  }> = []
  private frontFlipAngle = 0

  override startHitReaction(style: 'small' | 'medium' | 'large' | 'stab' | 'sword' | 'axe'): void {
    super.startHitReaction(style)
    audio.play('centipede_hit', this.collisionBody.x, this.collisionBody.z)
  }

  override startDeath(weapon: WeaponType): void {
    if (this.deathState) return
    const durations: Partial<Record<WeaponType, number>> = {
      [WeaponType.Sword]:         0.95,
      [WeaponType.Axe]:           1.25,
      [WeaponType.BoxingGloves]:  0.80,
      [WeaponType.Bow]:           0.90,
      [WeaponType.FlameBreather]: 1.40,
      [WeaponType.WebLauncher]:   0.70,
      [WeaponType.Empty]:         0.80,
    }
    this.collisionBody.enabled = false
    this.collisionBody.velocity.x = 0
    this.collisionBody.velocity.z = 0
    this.deathState = {
      weapon,
      elapsed:  0,
      duration: durations[weapon] ?? 0.80,
      phase:    'initial',
    }

    // Round 10 — per-weapon death SFX (3D positional)
    const cx = this.collisionBody.x, cz = this.collisionBody.z
    const deathKey = weapon === WeaponType.Sword         ? 'centipede_death_sword'
                   : weapon === WeaponType.Axe           ? 'centipede_death_axe'
                   : weapon === WeaponType.BoxingGloves  ? 'centipede_death_stab'
                   : weapon === WeaponType.Bow           ? 'centipede_death_bow'
                   : weapon === WeaponType.FlameBreather ? 'centipede_death_flame'
                   :                                       'centipede_death_generic'
    audio.stopLoop('centipede_skitter')
    audio.play(deathKey, cx, cz)

    switch (weapon) {
      case WeaponType.Sword:         this.setupSwordDeath(); break
      case WeaponType.Axe:           this.setupAxeDeath();   break
      case WeaponType.BoxingGloves:  this.setupStabDeath();  break
      case WeaponType.Bow:           this.setupBowDeath();   break
      case WeaponType.FlameBreather: this.setupBurnDeath();  break
      case WeaponType.WebLauncher:   this.setupWebDeath();   break
      default:                       this.setupGenericDeath(); break
    }
  }

  override updateDeath(delta: number): void {
    if (!this.deathState) return
    this.deathState.elapsed += delta

    // Free-flying parts (segments detached by sword/axe) integrate physics.
    for (const part of this.deathParts) {
      part.mesh.position.x += part.vx * delta
      part.mesh.position.y += part.vy * delta
      part.mesh.position.z += part.vz * delta
      part.vy -= 12 * delta
      part.mesh.rotation.x += part.rotVx * delta
      part.mesh.rotation.z += part.rotVz * delta
      if (part.mesh.position.y < 0.05) {
        part.mesh.position.y = 0.05
        part.vy = -part.vy * 0.3
        part.vx *= 0.7
        part.vz *= 0.7
      }
    }

    switch (this.deathState.weapon) {
      case WeaponType.Sword:         this.tickSwordDeath(); break
      case WeaponType.Axe:           /* parts physics handles everything */ break
      case WeaponType.BoxingGloves:  this.tickStabDeath();  break
      case WeaponType.Bow:           this.tickBowDeath();   break
      case WeaponType.FlameBreather: this.tickBurnDeath(); break
      case WeaponType.WebLauncher:   this.tickWebDeath();   break
      default:                       this.tickGenericDeath(); break
    }
  }

  // ─── SWORD KILL — Body splits, rear segment flies back, front flips forward ─
  private setupSwordDeath(): void {
    if (this.bodyMeshes.length >= 2) {
      // Detach the tail segment as a free part flying back+up
      const tail = this.bodyMeshes[this.bodyMeshes.length - 1]
      const worldPos = new THREE.Vector3()
      tail.getWorldPosition(worldPos)
      this.group.remove(tail)
      this.threeScene.add(tail)
      tail.position.copy(worldPos)
      this.deathParts.push({
        mesh: tail,
        vx: -Math.sin(this.facingAngle) * 1.6 + (Math.random() - 0.5) * 0.6,
        vy: 2.0 + Math.random() * 0.6,
        vz: -Math.cos(this.facingAngle) * 1.6 + (Math.random() - 0.5) * 0.6,
        rotVx: (Math.random() - 0.5) * 6,
        rotVz: (Math.random() - 0.5) * 6,
      })
    }
    this.deathState!.phase = 'flipping'
    this.spawnIchor(this.group.position, 20)
  }
  private tickSwordDeath(): void {
    this.frontFlipAngle += 0.075   // ~4.5 rad/s at 60fps
    this.group.rotation.x = Math.min(this.frontFlipAngle, Math.PI / 2)
    const t = this.deathState!.elapsed / this.deathState!.duration
    this.group.position.y = Math.max(0, 0.2 - this.frontFlipAngle * 0.1)
    if (t > 0.7) this.fadeGroup(1 - (t - 0.7) / 0.3)
  }

  // ─── AXE KILL — All segments explode outward ────────────────────────────────
  private setupAxeDeath(): void {
    for (const seg of this.bodyMeshes) {
      const worldPos = new THREE.Vector3()
      seg.getWorldPosition(worldPos)
      this.group.remove(seg)
      this.threeScene.add(seg)
      seg.position.copy(worldPos)
      seg.position.x += (Math.random() - 0.5) * 0.2
      seg.position.z += (Math.random() - 0.5) * 0.2
      seg.position.y = 0.2 + Math.random() * 0.1
      const angle = Math.random() * Math.PI * 2
      const force = 3 + Math.random() * 2
      this.deathParts.push({
        mesh: seg,
        vx: Math.cos(angle) * force,
        vy: 3 + Math.random() * 2,
        vz: Math.sin(angle) * force,
        rotVx: (Math.random() - 0.5) * 10,
        rotVz: (Math.random() - 0.5) * 10,
      })
    }
    this.group.visible = false
    this.spawnIchor(this.group.position, 50)
  }

  // ─── STAB KILL — Convulse + sideways collapse ──────────────────────────────
  private setupStabDeath(): void { this.spawnIchor(this.group.position, 6) }
  private tickStabDeath(): void {
    const t = this.deathState!.elapsed / this.deathState!.duration
    if (t < 0.4) {
      const intensity = 1 - t / 0.4
      this.group.position.x = this.collisionBody.x + (Math.random() - 0.5) * 0.08 * intensity
      this.group.position.z = this.collisionBody.z + (Math.random() - 0.5) * 0.08 * intensity
      this.group.rotation.z = Math.sin(t * 80) * 0.15 * intensity
    } else {
      const ct = (t - 0.4) / 0.6
      this.group.rotation.z = 0.15 + ct * 1.3
      this.group.position.y = Math.max(0, 0.2 * (1 - ct))
      this.group.scale.z = 1 - ct * 0.3
    }
  }

  // ─── BOW KILL — Skewered, slow tip-over ────────────────────────────────────
  private setupBowDeath(): void {
    const arrow = new THREE.Mesh(
      new THREE.ConeGeometry(0.03, 0.25, 4),
      new THREE.MeshToonMaterial({ color: 0x442288 }),
    )
    arrow.position.set(0, 0.15, 0)
    arrow.rotation.x = Math.PI / 2
    this.group.add(arrow)
    this.spawnIchor(this.group.position, 8)
  }
  private tickBowDeath(): void {
    const t = this.deathState!.elapsed / this.deathState!.duration
    this.group.rotation.z = t * 1.4
    this.group.position.y = Math.max(0, 0.2 - t * 0.18)
    this.group.position.x = this.collisionBody.x + (Math.random() - 0.5) * 0.02 * (1 - t)
    if (t > 0.8) this.fadeGroup(1 - (t - 0.8) / 0.2)
  }

  // ─── FLAME KILL — Char, smoke, shrink, ash ─────────────────────────────────
  private setupBurnDeath(): void {
    this.group.traverse(obj => {
      if ((obj as THREE.Mesh).isMesh) {
        const m = (obj as THREE.Mesh).material as THREE.MeshToonMaterial & { emissive?: THREE.Color; emissiveIntensity?: number }
        if (m.color) m.color.setHex(0x331100)
        if (m.emissive) { m.emissive.setHex(0xff3300); m.emissiveIntensity = 0.8 }
      }
    })
  }
  private tickBurnDeath(): void {
    const t = this.deathState!.elapsed / this.deathState!.duration
    if (Math.random() < 0.6) this.spawnSmoke(this.group.position, 1)
    this.group.scale.set(1 - t * 0.5, 1 - t * 0.7, 1 - t * 0.5)
    this.group.position.y = Math.max(0, 0.2 - t * 0.15)
    this.group.rotation.z = Math.sin(t * 6) * 0.2 * (1 - t)
    this.group.traverse(obj => {
      if ((obj as THREE.Mesh).isMesh) {
        const m = (obj as THREE.Mesh).material as { emissiveIntensity?: number }
        if (m.emissiveIntensity !== undefined) m.emissiveIntensity = 0.8 * (1 - t)
      }
    })
    if (t > 0.85) this.fadeGroup(1 - (t - 0.85) / 0.15)
  }

  // ─── WEB KILL — Wrap, slump ────────────────────────────────────────────────
  private setupWebDeath(): void {
    const wrap = new THREE.Mesh(
      new THREE.SphereGeometry(0.25, 12, 8),
      new THREE.MeshToonMaterial({ color: 0xffffff, transparent: true, opacity: 0.7 }),
    )
    this.group.add(wrap)
  }
  private tickWebDeath(): void {
    const t = this.deathState!.elapsed / this.deathState!.duration
    this.group.rotation.z = t * 1.6
    this.group.position.y = Math.max(0, 0.2 - t * 0.2)
  }

  // ─── GENERIC FALLBACK ──────────────────────────────────────────────────────
  private setupGenericDeath(): void { /* nothing special */ }
  private tickGenericDeath(): void {
    const t = this.deathState!.elapsed / this.deathState!.duration
    this.group.rotation.z = t * Math.PI / 2
    this.group.position.y = Math.max(0, 0.2 - t * 0.2)
    if (t > 0.7) this.fadeGroup(1 - (t - 0.7) / 0.3)
  }

  private fadeGroup(opacity: number): void {
    this.group.traverse(obj => {
      if ((obj as THREE.Mesh).isMesh) {
        const m = (obj as THREE.Mesh).material as THREE.Material & { opacity?: number; transparent?: boolean }
        m.transparent = true
        m.opacity = opacity
      }
    })
  }

  // Free death-parts that were detached from group on cleanup.
  override cleanup(): void {
    for (const part of this.deathParts) {
      this.threeScene.remove(part.mesh)
      part.mesh.geometry.dispose()
      ;(part.mesh.material as THREE.Material).dispose()
    }
    this.deathParts = []
    super.cleanup()
  }
}

function wrapAngle(a: number): number {
  while (a >  Math.PI) a -= Math.PI * 2
  while (a < -Math.PI) a += Math.PI * 2
  return a
}

function nearestWallZ(z: number): number | null {
  for (const wz of WALL_Z_BOUNDS) {
    if (Math.abs(z - wz) < WALL_HUG_DIST) return wz
  }
  return null
}

function lerpAngleMix(a: number, b: number, t: number): number {
  let diff = b - a
  while (diff >  Math.PI) diff -= Math.PI * 2
  while (diff < -Math.PI) diff += Math.PI * 2
  return a + diff * t
}
