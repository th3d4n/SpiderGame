import * as THREE from 'three'
import { Enemy3D, type EnemyConfig3D } from './Enemy3D'
import { WeaponType } from '../systems/WeaponSystem'
import { audio } from '../systems/AudioManager'

// ─── Pheromone sac ────────────────────────────────────────────────────────────
// The colony's seal on the Queen's tunnel is held by three of these: swollen,
// throbbing amber glands rooted into the walls of deep chambers.  They're
// Enemy3D so every weapon (and the web) hits them normally; they never move
// or bite.  Bursting one screams through the tunnels — the colony comes.

const CONFIG: EnemyConfig3D = {
  health: 90, speed: 0, damage: 0, bodyRadius: 0.55,
  knockbackResist: 1, staggerDuration: 0,
}

export class PheromoneSac3D extends Enemy3D {
  onBurst: (() => void) | null = null
  private sac!: THREE.Mesh
  private sacMat!: THREE.MeshStandardMaterial
  private veins: THREE.Mesh[] = []
  private t = Math.random() * 6

  constructor(scene: THREE.Scene, x: number, z: number, gm: THREE.Texture) {
    super(scene, x, z, CONFIG, gm)
    this.usesNav = false
    this.buildVisuals()
  }

  buildVisuals(): void {
    this.sacMat = new THREE.MeshStandardMaterial({
      color: 0xffa83a, emissive: 0xff8a1a, emissiveIntensity: 1.4, roughness: 0.25,
      transparent: true, opacity: 0.88,
    })
    this.sac = new THREE.Mesh(new THREE.SphereGeometry(0.55, 24, 18), this.sacMat)
    this.sac.position.y = 0.55
    this.sac.scale.set(1, 1.15, 1)
    this.group.add(this.sac)
    // A hot core you can see through the membrane
    const core = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 10), new THREE.MeshBasicMaterial({ color: 0xffe0a0 }))
    core.position.y = 0.55
    this.group.add(core)
    // Root veins into the floor
    const veinMat = new THREE.MeshToonMaterial({ color: 0x6a2a0c, gradientMap: this.gradientMap })
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2
      const pts = [new THREE.Vector3(0, 0.45, 0), new THREE.Vector3(Math.cos(a) * 0.5, 0.15, Math.sin(a) * 0.5), new THREE.Vector3(Math.cos(a) * 1.0, 0.01, Math.sin(a) * 1.0)]
      const v = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 10, 0.05, 5, false), veinMat)
      this.group.add(v); this.veins.push(v)
    }
    const light = new THREE.PointLight(0xff9a3a, 2.2, 5, 2)
    light.position.y = 0.9
    this.group.add(light)
  }

  override dealsContactDamage(): boolean { return false }
  protected setFlashColor(on: boolean): void { this.sacMat.emissiveIntensity = on ? 3.2 : 1.4 }

  updateAI(delta: number): void {
    this.collisionBody.velocity.x = this.collisionBody.velocity.z = 0
    // Throbs faster as it's hurt
    this.t += delta * (2 + 5 * (1 - this.hp / this.hpMax))
    const k = 1 + Math.sin(this.t * 3) * 0.06
    this.sac.scale.set(k, 1.15 * k, k)
  }

  override startDeath(weapon: WeaponType): void {
    super.startDeath(weapon)
    if (this.deathState) this.deathState.duration = 0.9
    audio.play('boss_hit', this.collisionBody.x, this.collisionBody.z, { rate: 0.7 })
    audio.impact('kill', this.collisionBody.x, this.collisionBody.z)
    this.spawnIchor(this.group.position, 40, 0xffa020)
    Enemy3D.onCameraShake?.(0.03, 0.35)
    this.onBurst?.()
  }

  override updateDeath(delta: number): void {
    if (!this.deathState) return
    this.deathState.elapsed += delta
    const t = Math.min(1, this.deathState.elapsed / this.deathState.duration)
    // Swells, then ruptures flat
    const s = t < 0.25 ? 1 + t * 1.2 : Math.max(0.05, 1.3 * (1 - (t - 0.25) / 0.75))
    this.sac.scale.set(s * 1.1, s * 0.6, s * 1.1)
    this.sacMat.opacity = 0.88 * (1 - t)
  }
}
