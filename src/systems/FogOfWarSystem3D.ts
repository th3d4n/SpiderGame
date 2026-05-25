import * as THREE from 'three'

export class FogOfWarSystem3D {
  private fogMesh:      THREE.Mesh
  private fogMat:       THREE.ShaderMaterial
  private ctx:          CanvasRenderingContext2D
  private revealTex:    THREE.CanvasTexture
  private readonly RW = 512
  private readonly RH = 64
  private arenaMinX:   number
  private arenaMinZ:   number
  private arenaW:      number
  private arenaH:      number
  readonly revealRadius: number
  private threeScene:  THREE.Scene
  private beacons:     THREE.Mesh[] = []

  constructor(
    threeScene:   THREE.Scene,
    arenaMinX:    number,
    arenaMaxX:    number,
    arenaMinZ:    number,
    arenaMaxZ:    number,
    revealRadius  = 3.5,
  ) {
    this.arenaMinX    = arenaMinX
    this.arenaMinZ    = arenaMinZ
    this.arenaW       = arenaMaxX - arenaMinX
    this.arenaH       = arenaMaxZ - arenaMinZ
    this.revealRadius = revealRadius
    this.threeScene   = threeScene

    // Off-screen canvas — circles painted here accumulate permanently
    const canvas  = document.createElement('canvas')
    canvas.width  = this.RW
    canvas.height = this.RH
    this.ctx      = canvas.getContext('2d')!
    this.revealTex = new THREE.CanvasTexture(canvas)

    this.fogMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite:  false,
      uniforms: {
        playerPos:    { value: new THREE.Vector2(0, 0) },
        revealRadius: { value: revealRadius },
        revealTex:    { value: this.revealTex },
        arenaMin:     { value: new THREE.Vector2(arenaMinX, arenaMinZ) },
        arenaSize:    { value: new THREE.Vector2(this.arenaW, this.arenaH) },
      },
      vertexShader: /* glsl */`
        varying vec2 vWorldXZ;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorldXZ = wp.xz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: /* glsl */`
        uniform vec2      playerPos;
        uniform float     revealRadius;
        uniform sampler2D revealTex;
        uniform vec2      arenaMin;
        uniform vec2      arenaSize;
        varying vec2      vWorldXZ;
        void main() {
          float dist  = length(vWorldXZ - playerPos);
          float live  = 1.0 - smoothstep(revealRadius * 0.65, revealRadius, dist);
          vec2  uv    = clamp((vWorldXZ - arenaMin) / arenaSize, 0.0, 1.0);
          float perm  = texture2D(revealTex, uv).r;
          // Explored: 10% residual fog. Unexplored: nearly opaque cavern darkness.
          float exploredVisibility = perm * 0.90;
          float reveal = max(live, exploredVisibility);
          gl_FragColor = vec4(0.03, 0.02, 0.0, (1.0 - reveal) * 0.98);
        }
      `,
    })

    const cx  = (arenaMinX + arenaMaxX) / 2
    const cz  = (arenaMinZ + arenaMaxZ) / 2
    const geo = new THREE.PlaneGeometry(this.arenaW + 8, this.arenaH + 8).rotateX(-Math.PI / 2)
    this.fogMesh = new THREE.Mesh(geo, this.fogMat)
    this.fogMesh.position.set(cx, 1.95, cz)
    this.fogMesh.renderOrder = 10
    threeScene.add(this.fogMesh)
  }

  update(playerX: number, playerZ: number): void {
    this.fogMat.uniforms.playerPos.value.set(playerX, playerZ)

    // Stamp a reveal ellipse at the current player position
    const u  = (playerX - this.arenaMinX) / this.arenaW
    const v  = (playerZ - this.arenaMinZ) / this.arenaH
    const px = u * this.RW
    const pz = v * this.RH
    const rx = (this.revealRadius / this.arenaW) * this.RW * 1.15
    const ry = (this.revealRadius / this.arenaH) * this.RH * 1.15

    this.ctx.fillStyle = 'white'
    this.ctx.beginPath()
    this.ctx.ellipse(px, pz, rx, ry, 0, 0, Math.PI * 2)
    this.ctx.fill()
    this.revealTex.needsUpdate = true
  }

  // Spawn a small mesh above the fog plane so it remains visible regardless of
  // explored state — used for fungus orb / lantern navigation beacons.
  addBeacon(x: number, z: number, color = 0x99ffcc): void {
    const geo  = new THREE.SphereGeometry(0.08, 6, 4)
    const mat  = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthTest: false })
    const mesh = new THREE.Mesh(geo, mat)
    mesh.position.set(x, 2.0, z)
    mesh.renderOrder = 20
    this.threeScene.add(mesh)
    this.beacons.push(mesh)
  }

  destroy(threeScene: THREE.Scene): void {
    threeScene.remove(this.fogMesh)
    this.fogMesh.geometry.dispose()
    this.fogMat.dispose()
    this.revealTex.dispose()
    for (const b of this.beacons) {
      threeScene.remove(b)
      b.geometry.dispose()
      ;(b.material as THREE.Material).dispose()
    }
    this.beacons = []
  }
}
