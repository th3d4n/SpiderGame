import * as THREE from 'three'

interface Particle {
  mesh:    THREE.Mesh
  vx:      number
  vy:      number
  vz:      number
  life:    number
  maxLife: number
  isSmoke?: boolean   // smoke drifts up; no gravity
}

export class ParticleBurstSystem3D {
  private particles: Particle[] = []
  private scene:     THREE.Scene

  constructor(scene: THREE.Scene) {
    this.scene = scene
  }

  burst(
    pos:   THREE.Vector3,
    color: number,
    count  = 6,
    speed  = 2.5,
    size   = 0.04,
  ): void {
    for (let i = 0; i < count; i++) {
      const angle   = Math.random() * Math.PI * 2
      const spd     = speed * (0.5 + Math.random() * 0.5)
      const maxLife = 0.28 + Math.random() * 0.18
      const mat     = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1 })
      const mesh    = new THREE.Mesh(
        new THREE.IcosahedronGeometry(size * (0.5 + Math.random() * 0.8), 0),
        mat,
      )
      mesh.position.set(pos.x, pos.y + 0.3, pos.z)
      this.scene.add(mesh)
      this.particles.push({
        mesh,
        vx: Math.cos(angle) * spd,
        vy: spd * (0.4 + Math.random() * 0.4),
        vz: Math.sin(angle) * spd,
        life: maxLife,
        maxLife,
      })
    }
  }

  // Round 9b — slow upward-drifting smoke for burn / wound deaths.
  smokeBurst(pos: THREE.Vector3, color = 0x444444, count = 4): void {
    for (let i = 0; i < count; i++) {
      const angle   = Math.random() * Math.PI * 2
      const spd     = 0.4 + Math.random() * 0.3
      const maxLife = 1.2 + Math.random() * 0.6
      const mat     = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.6 })
      const mesh    = new THREE.Mesh(
        new THREE.IcosahedronGeometry(0.06 + Math.random() * 0.04, 0),
        mat,
      )
      mesh.position.set(pos.x, pos.y, pos.z)
      this.scene.add(mesh)
      this.particles.push({
        mesh,
        vx: Math.cos(angle) * spd * 0.3,
        vy: spd * 1.5,
        vz: Math.sin(angle) * spd * 0.3,
        life: maxLife,
        maxLife,
        isSmoke: true,
      })
    }
  }

  update(delta: number): void {
    const keep: Particle[] = []
    for (const p of this.particles) {
      p.life -= delta
      if (p.life <= 0) {
        p.mesh.removeFromParent()
        p.mesh.geometry.dispose()
        ;(p.mesh.material as THREE.Material).dispose()
        continue
      }
      p.mesh.position.x += p.vx * delta
      p.mesh.position.y += p.vy * delta
      p.mesh.position.z += p.vz * delta
      if (!p.isSmoke) p.vy -= 7 * delta
      ;(p.mesh.material as THREE.MeshBasicMaterial).opacity = p.life / p.maxLife
      keep.push(p)
    }
    this.particles = keep
  }
}
