import * as THREE from 'three'

// ─── Camera rig ───────────────────────────────────────────────────────────────
// One place that owns the view.  Perspective "iso": a narrow-FOV camera looking
// down at the player from a fixed compass bearing, so the game keeps its top-down
// readability (and camera-relative WASD) but gains real depth — height, webs and
// walls read as 3D instead of flat orthographic cut-outs.
//
// Framing is defined per unit of creature scale, so Webbs fills the same share
// of the screen in every zone (den scale 2.4, colony/boss 1.0).

// Compass bearing the camera looks FROM (THREE yaw convention): π/4 = from +X +Z,
// the bearing the whole game (input mapping, celebration pose) was authored for.
export const CAMERA_YAW = Math.PI / 4

const FOV_DEG        = 30     // narrow — keeps perspective distortion gentle
const ELEVATION_DEG  = 32     // above the horizon (true iso is 35.3°)
// Visible half-height at the focus point, per unit creature scale, at zoom 1.
// Matches the old orthographic framing (frustum 15 × scale at zoom 2 → 7.5).
const VIEW_HALF_H    = 15
const LOOK_AHEAD     = 0.22   // share of the cursor offset the view leans toward
const LOOK_AHEAD_MAX = 3.0    // wu per unit scale
const FOLLOW_RATE    = 7      // 1/s — exponential follow
const ZOOM_RATE      = 5      // 1/s

// Horizontal unit vector pointing from the scene toward the camera
export const CAMERA_DIR_X = Math.sin(CAMERA_YAW)
export const CAMERA_DIR_Z = Math.cos(CAMERA_YAW)

export class CameraRig {
  readonly camera: THREE.PerspectiveCamera
  zoomTarget = 2.0          // wheel / celebration target (2.0 = default framing)
  private zoom = 2.0
  private scale = 1
  private focus = new THREE.Vector3()
  private look  = new THREE.Vector3()   // smoothed look point (focus + look-ahead)
  private shakeT = 0
  private shakeI = 0

  constructor(aspect: number, scale: number) {
    this.camera = new THREE.PerspectiveCamera(FOV_DEG, aspect, 0.5, 600)
    this.scale  = scale
    this.place()
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect
    this.camera.updateProjectionMatrix()
  }

  setScale(s: number): void { this.scale = s }

  // Jump straight to a point (zone entry / respawn) — no swoop across the map.
  snapTo(x: number, z: number): void {
    this.focus.set(x, 0, z)
    this.look.copy(this.focus)
    this.place()
  }

  shake(intensity: number, duration: number): void {
    this.shakeI = intensity
    this.shakeT = duration
  }

  // Zoom eases even while the game is paused (celebration close-up)
  tickZoom(delta: number): void {
    this.zoom += (this.zoomTarget - this.zoom) * (1 - Math.exp(-ZOOM_RATE * delta))
  }

  // Follow `target`, leaning toward the aim point so you see more of where you
  // are going/attacking.
  update(delta: number, target: THREE.Vector3, aim?: THREE.Vector3): void {
    this.focus.set(target.x, 0, target.z)
    let lx = 0, lz = 0
    if (aim) {
      lx = (aim.x - target.x) * LOOK_AHEAD
      lz = (aim.z - target.z) * LOOK_AHEAD
      const max = LOOK_AHEAD_MAX * this.scale
      const l = Math.hypot(lx, lz)
      if (l > max) { lx *= max / l; lz *= max / l }
    }
    const k = 1 - Math.exp(-FOLLOW_RATE * delta)
    this.look.x += (this.focus.x + lx - this.look.x) * k
    this.look.z += (this.focus.z + lz - this.look.z) * k
    this.tickZoom(delta)
    this.place()

    if (this.shakeT > 0) {
      this.shakeT -= delta
      // Shake scales with framing so it reads the same at every zoom/zone
      const s = this.shakeI * this.distance() * 0.6
      this.camera.position.x += (Math.random() - 0.5) * s
      this.camera.position.y += (Math.random() - 0.5) * s
      this.camera.position.z += (Math.random() - 0.5) * s
    }
  }

  // Camera-to-look-point distance for the current zoom and creature scale
  get viewDistance(): number { return this.distance() }
  private distance(): number {
    const halfH = (VIEW_HALF_H * this.scale) / this.zoom
    return halfH / Math.tan(THREE.MathUtils.degToRad(FOV_DEG / 2))
  }

  private place(): void {
    const d  = this.distance()
    const el = THREE.MathUtils.degToRad(ELEVATION_DEG)
    const h  = Math.cos(el) * d
    this.camera.position.set(
      this.look.x + CAMERA_DIR_X * h,
      Math.sin(el) * d,
      this.look.z + CAMERA_DIR_Z * h,
    )
    this.camera.lookAt(this.look)
  }
}
