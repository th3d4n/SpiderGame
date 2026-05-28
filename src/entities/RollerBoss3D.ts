import * as THREE from 'three'
import { Enemy3D, type EnemyConfig3D } from './Enemy3D'
import { WeaponType } from '../systems/WeaponSystem'
import { audio } from '../systems/AudioManager'

const PATROL_SPEED = 1.15   // wu/s  (115 px/s × 0.01)
const CHARGE_SPEED = 3.90   // wu/s  (390 px/s × 0.01)
const LEFT_WALL    = -9.0
const RIGHT_WALL   = 9.0

const CONFIG: EnemyConfig3D = {
  health:          100,
  speed:           PATROL_SPEED,
  damage:          15,
  bodyRadius:      0.42,
  knockbackResist: 0.9,
  staggerDuration: 0.4,
  weakPoints:      ['Head'],
  weakMultiplier:  2.0,
}

type AttackState = 'idle' | 'charging' | 'groundPound' | 'tailSwipe'

export class RollerBoss3D extends Enemy3D {
  private facingDir    = 1          // +1 = right (+x), -1 = left (-x)
  private attackState: AttackState = 'idle'
  private attackTimer  = 0
  private attackCooldown = 0
  private phaseChangeFired = false

  // One-shot event flags — scene reads these each frame and resets after
  justStartedBodySlam     = false
  justReleasedGroundPound = false
  justStartedTailSwipe    = false
  groundPoundReleaseX     = 0
  groundPoundReleaseZ     = 0
  tailSwipeX              = 0
  tailSwipeZ              = 0

  constructor(threeScene: THREE.Scene, x: number, z: number, gradientMap: THREE.Texture) {
    super(threeScene, x, z, CONFIG, gradientMap)
    this.buildVisuals()
    audio.playLoop('boss_idle', x, z)
  }

  buildVisuals(): void {
    // Main body — rounded barrel shape
    const bodyGeo = new THREE.CapsuleGeometry(0.36, 0.52, 4, 8)
    bodyGeo.rotateZ(Math.PI / 2)
    const bodyMesh = new THREE.Mesh(bodyGeo,
      new THREE.MeshToonMaterial({ color: 0x7a5c18, gradientMap: this.gradientMap }))
    bodyMesh.castShadow = true
    this.group.add(bodyMesh)

    // Fur stripes
    const stripeMat = new THREE.LineBasicMaterial({ color: 0x5c4510 })
    for (let i = -2; i <= 2; i++) {
      const g = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(i * 0.13, -0.26, 0.22),
        new THREE.Vector3(i * 0.13, -0.26, -0.22),
      ])
      this.group.add(new THREE.LineSegments(g, stripeMat))
    }

    // Eyes — amber with dark pupils
    const eyeMat   = new THREE.MeshToonMaterial({ color: 0xf0c830, gradientMap: this.gradientMap })
    const pupilMat = new THREE.MeshToonMaterial({ color: 0x111111, gradientMap: this.gradientMap })
    const eyeGeo   = new THREE.SphereGeometry(0.10, 8, 6)
    const pupilGeo = new THREE.SphereGeometry(0.05, 6, 5)
    ;[-0.20, 0.20].forEach(ex => {
      const eye   = new THREE.Mesh(eyeGeo, eyeMat);   eye.position.set(ex, 0.14, -0.26)
      const pupil = new THREE.Mesh(pupilGeo, pupilMat); pupil.position.set(ex, 0.14, -0.33)
      this.group.add(eye, pupil)
    })

    // Pink snout — on the +x side (flips with group.scale.x)
    const snoutMat = new THREE.MeshToonMaterial({ color: 0xff9fad, gradientMap: this.gradientMap })
    const snout = new THREE.Mesh(new THREE.SphereGeometry(0.19, 8, 6), snoutMat)
    snout.scale.set(1, 0.75, 0.9)
    snout.position.set(0.62, 0.04, 0)
    this.group.add(snout)

    // Tail stub — on the -x side
    const tailMat = new THREE.MeshToonMaterial({ color: 0x6b4f15, gradientMap: this.gradientMap })
    const tail = new THREE.Mesh(new THREE.SphereGeometry(0.11, 7, 5), tailMat)
    tail.position.set(-0.64, 0, 0)
    this.group.add(tail)

    // Tiny legs
    const legMat = new THREE.MeshToonMaterial({ color: 0x5c4510, gradientMap: this.gradientMap })
    ;[-0.14, 0.14].forEach(lx => {
      ;[-1, 1].forEach(side => {
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.03, 0.22, 5), legMat)
        leg.position.set(lx, -0.26, side * 0.28)
        leg.rotation.x = side * 0.4
        this.group.add(leg)
      })
    })
  }

  updateAI(delta: number, playerX: number, playerZ: number): void {
    // Clear one-shot flags
    this.justStartedBodySlam     = false
    this.justReleasedGroundPound = false
    this.justStartedTailSwipe    = false

    if (this.attackCooldown > 0) this.attackCooldown -= delta

    switch (this.attackState) {
      case 'charging':
        this.attackTimer -= delta
        if (this.attackTimer <= 0) {
          this.attackState = 'idle'
          this.collisionBody.velocity.x = 0
          this.collisionBody.velocity.z = 0
        }
        return

      case 'groundPound':
        this.attackTimer -= delta
        if (this.attackTimer <= 0) {
          this.attackState = 'idle'
          this.justReleasedGroundPound = true
          this.groundPoundReleaseX = this.collisionBody.x
          this.groundPoundReleaseZ = this.collisionBody.z
        }
        return

      case 'tailSwipe':
        this.attackTimer -= delta
        if (this.attackTimer <= 0) this.attackState = 'idle'
        return

      default: break
    }

    // Patrol — reverse at walls
    if (this.collisionBody.x > RIGHT_WALL) this.facingDir = -1
    if (this.collisionBody.x < LEFT_WALL)  this.facingDir =  1
    this.group.scale.x = this.facingDir

    this.collisionBody.velocity.x = PATROL_SPEED * this.facingDir
    this.collisionBody.velocity.z = 0

    // Attack decisions (only when cooldown is clear)
    if (this.attackCooldown <= 0) {
      const dx = playerX - this.collisionBody.x
      if (Math.abs(dx) < 3.0) {
        this.doBodySlam(playerX, playerZ)
      } else if (Math.random() < 0.004 * (delta / 0.016)) {
        this.doGroundPound()
      } else if (Math.random() < 0.003 * (delta / 0.016)) {
        this.doTailSwipe()
      }
    }
  }

  private doBodySlam(targetX: number, targetZ: number): void {
    const dx = targetX - this.collisionBody.x
    const dz = targetZ - this.collisionBody.z
    const len = Math.hypot(dx, dz) || 1
    this.collisionBody.velocity.x = (dx / len) * CHARGE_SPEED
    this.collisionBody.velocity.z = (dz / len) * CHARGE_SPEED
    this.attackState    = 'charging'
    this.attackTimer    = 0.58
    this.attackCooldown = 2.6
    this.justStartedBodySlam = true
    audio.play('boss_charge', this.collisionBody.x, this.collisionBody.z)
  }

  private doGroundPound(): void {
    this.collisionBody.velocity.x = 0
    this.collisionBody.velocity.z = 0
    this.attackState    = 'groundPound'
    this.attackTimer    = 0.7
    this.attackCooldown = 3.8
    audio.play('boss_suction', this.collisionBody.x, this.collisionBody.z)
  }

  private doTailSwipe(): void {
    this.collisionBody.velocity.x = 0
    this.collisionBody.velocity.z = 0
    this.attackState    = 'tailSwipe'
    this.attackTimer    = 0.5
    this.attackCooldown = 3.2
    this.justStartedTailSwipe = true
    this.tailSwipeX = this.collisionBody.x
    this.tailSwipeZ = this.collisionBody.z
  }

  isBodySlamming():   boolean { return this.attackState === 'charging'    }
  isGroundPounding(): boolean { return this.attackState === 'groundPound' }
  isTailSwiping():    boolean { return this.attackState === 'tailSwipe'   }
  getFacingDir():     number  { return this.facingDir }
  getHealthRatio():   number  { return Math.max(0, this.hp / this.hpMax) }

  override startHitReaction(style: 'small' | 'medium' | 'large' | 'stab' | 'sword' | 'axe'): void {
    super.startHitReaction(style)
    audio.play('boss_hit', this.collisionBody.x, this.collisionBody.z)
    if (!this.phaseChangeFired && this.hp <= this.hpMax * 0.5) {
      this.phaseChangeFired = true
      audio.play('boss_phase_change', this.collisionBody.x, this.collisionBody.z)
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Round 9b — boss death sequences (2-3s cinematic with camera shake).
  // ───────────────────────────────────────────────────────────────────────────
  private deathArrows: THREE.Mesh[] = []
  private secondShakeFired = false

  override startDeath(weapon: WeaponType): void {
    if (this.deathState) return
    const durations: Partial<Record<WeaponType, number>> = {
      [WeaponType.Sword]:         2.20,
      [WeaponType.Axe]:           2.80,
      [WeaponType.BoxingGloves]:  2.50,
      [WeaponType.Bow]:           2.30,
      [WeaponType.FlameBreather]: 3.00,
      [WeaponType.WebLauncher]:   1.80,
      [WeaponType.Empty]:         2.00,
    }
    this.collisionBody.enabled = false
    this.collisionBody.velocity.x = 0
    this.collisionBody.velocity.z = 0
    this.deathState = {
      weapon, elapsed: 0,
      duration: durations[weapon] ?? 2.5,
      phase: 'initial',
    }
    // Initial impact shake
    Enemy3D.onCameraShake?.(weapon === WeaponType.Axe ? 0.05 : 0.025, 0.4)
    audio.stopLoop('boss_idle')
    audio.play('boss_death', this.collisionBody.x, this.collisionBody.z)

    // Per-weapon setup (most just set phase / spawn arrows / discolor)
    switch (weapon) {
      case WeaponType.Bow: {
        // Embed 4 arrows in the body for the bow death
        const arrowMat = new THREE.MeshToonMaterial({ color: 0x442288 })
        for (let i = 0; i < 4; i++) {
          const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.45, 4), arrowMat)
          arrow.position.set(
            (Math.random() - 0.5) * 0.5, 0.2 + Math.random() * 0.3, (Math.random() - 0.5) * 0.4,
          )
          arrow.rotation.x = Math.PI / 4
          arrow.rotation.z = (Math.random() - 0.5) * 0.6
          this.group.add(arrow)
          this.deathArrows.push(arrow)
        }
        break
      }
      case WeaponType.FlameBreather: {
        this.group.traverse(obj => {
          if ((obj as THREE.Mesh).isMesh) {
            const m = (obj as THREE.Mesh).material as THREE.MeshToonMaterial & { emissive?: THREE.Color; emissiveIntensity?: number }
            if (m.emissive) { m.emissive.setHex(0xff5500); m.emissiveIntensity = 0.9 }
          }
        })
        break
      }
      case WeaponType.WebLauncher: {
        const wrap = new THREE.Mesh(
          new THREE.SphereGeometry(0.55, 14, 10),
          new THREE.MeshToonMaterial({ color: 0xffffff, transparent: true, opacity: 0.65 }),
        )
        this.group.add(wrap)
        break
      }
    }
    this.spawnIchor(this.group.position, 30, 0xcc6633)
  }

  override updateDeath(delta: number): void {
    if (!this.deathState) return
    this.deathState.elapsed += delta
    const t = Math.min(1, this.deathState.elapsed / this.deathState.duration)

    switch (this.deathState.weapon) {
      case WeaponType.Sword:        this.tickBossSword(t);            break
      case WeaponType.Axe:          this.tickBossAxe(t);              break
      case WeaponType.BoxingGloves: this.tickBossStab(t);             break
      case WeaponType.Bow:          this.tickBossBow(t);              break
      case WeaponType.FlameBreather:this.tickBossBurn(t, delta);      break
      case WeaponType.WebLauncher:  this.tickBossWeb(t);              break
      default:                      this.tickBossGeneric(t);          break
    }

    if (t > 0.9) {
      const fade = 1 - (t - 0.9) / 0.1
      this.group.traverse(obj => {
        if ((obj as THREE.Mesh).isMesh) {
          const m = (obj as THREE.Mesh).material as THREE.Material & { opacity?: number; transparent?: boolean }
          m.transparent = true
          m.opacity = fade
        }
      })
    }
  }

  // ─── SWORD — staggered stumble, knee-buckle collapse on side ───────────────
  private tickBossSword(t: number): void {
    if (t < 0.3) {
      // Step back, lean
      this.group.position.x = this.collisionBody.x - this.facingDir * t * 0.6
      this.group.rotation.x = -t * 0.3
    } else if (t < 0.5) {
      const ft = (t - 0.3) / 0.2
      this.group.rotation.x = -0.3 + ft * 0.6   // forward falter
      this.group.position.y = 0.3 * (1 - ft)
    } else {
      const ct = (t - 0.5) / 0.5
      this.group.rotation.z = ct * (Math.PI / 2)
      this.group.position.y = Math.max(0, 0.1 - ct * 0.1)
      if (ct > 0.05 && ct < 0.20) this.spawnSmoke(this.group.position, 1)   // dust puff
    }
  }

  // ─── AXE — big tumbling fall, second camera shake at ground hit ────────────
  private tickBossAxe(t: number): void {
    if (t < 0.25) {
      // Spin from impact direction
      this.group.rotation.y += 0.18
    } else if (t < 0.5) {
      // Airborne tumble: parabola
      const at = (t - 0.25) / 0.25
      this.group.position.y = 0.3 + Math.sin(at * Math.PI) * 0.9
      this.group.rotation.x = at * Math.PI * 1.5
      this.group.rotation.y += 0.15
    } else {
      if (!this.secondShakeFired) {
        this.secondShakeFired = true
        Enemy3D.onCameraShake?.(0.08, 0.5)
        this.spawnSmoke(this.group.position, 14)
      }
      const ct = (t - 0.5) / 0.5
      this.group.rotation.x = Math.PI * 1.5 + ct * 0.3
      this.group.position.y = Math.max(0, 0.1 - ct * 0.1)
    }
  }

  // ─── STAB — multiple wounds, sway, face-first collapse ─────────────────────
  private tickBossStab(t: number): void {
    if (t < 0.4) {
      if (Math.random() < 0.08) this.spawnIchor(this.group.position, 2, 0xaa3322)
    } else if (t < 0.7) {
      const st = (t - 0.4) / 0.3
      this.group.rotation.z = Math.sin(st * Math.PI * 4) * 0.25 * (1 - st * 0.5)
    } else {
      const ct = (t - 0.7) / 0.3
      this.group.rotation.x = ct * (Math.PI / 2)
      this.group.position.y = Math.max(0, 0.2 - ct * 0.2)
    }
  }

  // ─── BOW — embedded arrows, roar swing, slow topple ────────────────────────
  private tickBossBow(t: number): void {
    if (t < 0.3) {
      // Arrows already embedded in setup; head shake
      this.group.rotation.y = Math.sin(t * 35) * 0.15
    } else if (t < 0.6) {
      const rt = (t - 0.3) / 0.3
      this.group.rotation.y = Math.sin(rt * Math.PI * 3) * 0.30 * (1 - rt)
    } else {
      const tt = (t - 0.6) / 0.4
      this.group.rotation.z = tt * (Math.PI / 2)
      this.group.position.y = Math.max(0, 0.3 - tt * 0.25)
    }
  }

  // ─── FLAME — panic burn, wobble circles, collapse smoldering ───────────────
  private tickBossBurn(t: number, delta: number): void {
    if (t < 0.4) {
      if (Math.random() < 0.7) this.spawnSmoke(this.group.position, 1)
      this.group.rotation.z = Math.sin(t * 20) * 0.1
    } else if (t < 0.7) {
      // Panic-run small circle
      const pt = (t - 0.4) / 0.3
      this.group.position.x = this.collisionBody.x + Math.cos(t * 12) * 0.4
      this.group.position.z = this.collisionBody.z + Math.sin(t * 12) * 0.4
      this.group.rotation.y += delta * 8
      if (Math.random() < 0.5) this.spawnSmoke(this.group.position, 1)
      // Fade emissive
      this.group.traverse(obj => {
        if ((obj as THREE.Mesh).isMesh) {
          const m = (obj as THREE.Mesh).material as { emissiveIntensity?: number }
          if (m.emissiveIntensity !== undefined) m.emissiveIntensity = 0.9 * (1 - pt)
        }
      })
    } else {
      const ct = (t - 0.7) / 0.3
      this.group.rotation.z = ct * (Math.PI / 2)
      this.group.position.y = Math.max(0, 0.2 - ct * 0.2)
      if (Math.random() < 0.3) this.spawnSmoke(this.group.position, 1)
    }
  }

  // ─── WEB — wrapped, quiet slump ────────────────────────────────────────────
  private tickBossWeb(t: number): void {
    this.group.rotation.z = t * (Math.PI / 2)
    this.group.position.y = Math.max(0, 0.2 - t * 0.2)
  }

  private tickBossGeneric(t: number): void {
    this.group.rotation.z = t * (Math.PI / 2)
    this.group.position.y = Math.max(0, 0.2 - t * 0.2)
  }
}
