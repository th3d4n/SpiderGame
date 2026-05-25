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
          // Already-explored areas show at 55% opacity; current view is fully clear
          float reveal = max(live, perm * 0.55);
          gl_FragColor = vec4(0.03, 0.02, 0.0, (1.0 - reveal) * 0.93);
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

  destroy(threeScene: THREE.Scene): void {
    threeScene.remove(this.fogMesh)
    this.fogMesh.geometry.dispose()
    this.fogMat.dispose()
    this.revealTex.dispose()
  }
}
