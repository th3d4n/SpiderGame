import * as THREE from 'three'

interface OccluderEntry {
  mesh:  THREE.Object3D
  mats:  THREE.Material[]
  faded: number
}

/**
 * Raycast from camera → Webbs each frame. Any registered mesh
 * in the way fades to translucent; when clear, fades back.
 *
 * Usage:
 *   const occ = new CameraOccluder(camera)
 *   occ.registerGroup(denHandles.walls)   // burrow mounds
 *   // each homeBase frame:
 *   occ.update(webbs.group.position, delta)
 */
export class CameraOccluder {
  private camera:    THREE.Camera
  private ray        = new THREE.Raycaster()
  private occluders: OccluderEntry[] = []
  private fadeTarget: number
  private fadeSpeed:  number
  private _dir       = new THREE.Vector3()

  constructor(camera: THREE.Camera, opts: { opacity?: number; fadeSpeed?: number } = {}) {
    this.camera     = camera
    this.fadeTarget = opts.opacity  ?? 0.25
    this.fadeSpeed  = opts.fadeSpeed ?? 6
  }

  /**
   * Register a single mesh (or group) as an occluder.
   * Each material is CLONED so fading one mound never affects
   * other meshes sharing the same source material.
   */
  register(mesh: THREE.Object3D): void {
    const mats: THREE.Material[] = []
    mesh.traverse((o) => {
      const m = o as THREE.Mesh
      if (!m.isMesh || !m.material) return
      const list: THREE.Material[] = Array.isArray(m.material) ? m.material : [m.material]
      const cloned = list.map(src => {
        const c = src.clone()
        // Store originals so we can restore when unoccluded
        c.userData._occOrigOpacity     = (c as THREE.MeshStandardMaterial).opacity ?? 1
        c.userData._occOrigTransparent = (c as THREE.MeshStandardMaterial).transparent ?? false
        mats.push(c)
        return c
      })
      m.material = Array.isArray(m.material) ? cloned : cloned[0]
    })
    this.occluders.push({ mesh, mats, faded: 0 })
  }

  /**
   * Register each direct child of a group as its own independent occluder,
   * so only the mound actually in the ray's path fades — not the whole ring.
   */
  registerGroup(group: THREE.Object3D): void {
    group.children.forEach(c => this.register(c))
  }

  /** Call every frame when in homeBase. */
  update(targetPos: THREE.Vector3, dt: number): void {
    this._dir.copy(targetPos).sub(this.camera.position)
    const dist = this._dir.length()
    this._dir.normalize()
    this.ray.set(this.camera.position, this._dir)
    this.ray.far = dist - 0.5   // stop just short of Webbs

    const meshes = this.occluders.map(o => o.mesh)
    const hits   = this.ray.intersectObjects(meshes, true)

    // Walk each hit object up to find its registered root
    const hitRoots = new Set<THREE.Object3D | null>(
      hits.map(h => {
        let n: THREE.Object3D | null = h.object
        while (n && !this.occluders.find(o => o.mesh === n)) n = n.parent
        return n
      }),
    )

    for (const occ of this.occluders) {
      const want = hitRoots.has(occ.mesh) ? 1 : 0
      occ.faded += (want - occ.faded) * Math.min(1, this.fadeSpeed * dt)
      if (Math.abs(occ.faded - want) < 0.01) occ.faded = want
      const t = occ.faded
      for (const m of occ.mats as THREE.MeshStandardMaterial[]) {
        const origOp = (m.userData._occOrigOpacity as number)    ?? 1
        const origTr = (m.userData._occOrigTransparent as boolean) ?? false
        m.opacity    = origOp * (1 - t) + this.fadeTarget * t
        m.transparent = t > 0.001 ? true : origTr
        m.depthWrite  = t > 0.5   ? false : true
      }
    }
  }
}
