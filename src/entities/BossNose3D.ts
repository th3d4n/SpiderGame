import * as THREE from 'three'
import { Enemy3D, type EnemyConfig3D } from './Enemy3D'

const CONFIG: EnemyConfig3D = {
  health:          80,
  speed:           0,
  damage:          0,
  bodyRadius:      0.40,
  knockbackResist: 1.0,
  staggerDuration: 0.1,
  weakPoints:      ['Head'],
  weakMultiplier:  1.5,
}

export class BossNose3D extends Enemy3D {
  constructor(threeScene: THREE.Scene, x: number, z: number, gradientMap: THREE.Texture) {
    super(threeScene, x, z, CONFIG, gradientMap)
    this.collisionBody.isStatic = true
    this.buildVisuals()
    this.group.position.y = 2.2   // float above the arena floor
  }

  buildVisuals(): void {
    const mat = new THREE.MeshToonMaterial({ color: 0xff9fad, gradientMap: this.gradientMap })
    const geo = new THREE.SphereGeometry(0.55, 12, 8)
    const mesh = new THREE.Mesh(geo, mat)
    mesh.scale.set(1.0, 0.65, 0.88)
    mesh.castShadow = true
    this.group.add(mesh)

    // Outline
    const outlineMat = new THREE.MeshBasicMaterial({ color: 0xcc5577, side: THREE.BackSide })
    const outline = new THREE.Mesh(geo, outlineMat)
    outline.scale.set(1.07, 0.72, 0.96)
    this.group.add(outline)

    // Nostrils
    const nMat = new THREE.MeshToonMaterial({ color: 0xaa2244, gradientMap: this.gradientMap })
    const nGeo = new THREE.SphereGeometry(0.09, 6, 5)
    const nL   = new THREE.Mesh(nGeo, nMat)
    nL.position.set(-0.17, -0.08, 0.36)
    const nR   = new THREE.Mesh(nGeo, nMat)
    nR.position.set( 0.17, -0.08, 0.36)
    this.group.add(nL, nR)
  }

  updateAI(_delta: number, _px: number, _pz: number): void { /* pinned to ceiling */ }

  // Nose is immune to knockback — it's anchored
  applyKnockback(_vx: number, _vz: number): void {}

  getHealthRatio(): number { return Math.max(0, this.hp / this.hpMax) }
}
