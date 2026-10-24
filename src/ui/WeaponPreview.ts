import * as THREE from 'three'
import { WeaponType } from '../systems/WeaponSystem'
import { WEAPON_COLORS } from '../config/WeaponData'
import { buildWeaponModel, pulseWeaponModel, disposeModel } from '../entities/WeaponModels'
import { addRim } from '../env/Materials'

// ─── Weapon preview ───────────────────────────────────────────────────────────
// The real 3D weapon models, for the UI: a live turning model inside the
// discovery card's medal, and cached thumbnail images for the workbench, equip
// screen and touch attack button.  One small renderer (its own canvas, created
// on first use) serves both.  If WebGL isn't available every call returns null
// and callers keep their SVG icons.

let renderer: THREE.WebGLRenderer | null = null
let failed = false
const scene  = new THREE.Scene()
const camera = new THREE.PerspectiveCamera(30, 1, 0.01, 20)
const thumbs = new Map<string, string>()

function ensure(): THREE.WebGLRenderer | null {
  if (renderer || failed) return renderer
  try {
    renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true })
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.5
    renderer.setClearColor(0x000000, 0)
    scene.add(new THREE.HemisphereLight(0xfff1dc, 0x4a3a50, 2.0))
    const key = new THREE.DirectionalLight(0xffffff, 3.4); key.position.set(1.2, 2.2, 1.6); scene.add(key)
    const rim = new THREE.DirectionalLight(0x9fc4ff, 1.8); rim.position.set(-1.5, 0.8, -2.0); scene.add(rim)
  } catch {
    failed = true
    renderer = null
  }
  return renderer
}

// Pose a model as a classic item icon: diagonal, top face toward the viewer,
// framed to fill the view.
function stage(type: WeaponType): THREE.Group | null {
  const model = buildWeaponModel(type, null, WEAPON_COLORS[type])
  if (!model) return null
  addRim(model)
  const pivot = new THREE.Group()
  model.rotation.set(0.95, -Math.PI * 0.75, 0)
  pivot.add(model)
  const box = new THREE.Box3().setFromObject(pivot)
  model.position.sub(box.getCenter(new THREE.Vector3()))
  const r = box.getSize(new THREE.Vector3()).length() / 2
  // r is half the box diagonal, which over-frames long thin weapons — pull in
  const dist = r / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2)) * 0.82
  camera.position.set(0, 0.25 * dist, dist)
  camera.lookAt(0, 0, 0)
  scene.add(pivot)
  return pivot
}

function unstage(pivot: THREE.Group): void {
  scene.remove(pivot)
  disposeModel(pivot)
}

// Data-URL thumbnail of a weapon (cached), or null without WebGL.  One size
// for every icon — the <img>/<image> scales it.
const THUMB = 128
export function weaponThumb(type: WeaponType): string | null {
  const key = type
  const hit = thumbs.get(key)
  if (hit) return hit
  const r = ensure()
  if (!r || live) return null      // don't resize the canvas under the live card
  const pivot = stage(type)
  if (!pivot) return null
  r.setPixelRatio(1)
  r.setSize(THUMB, THUMB, false)
  r.render(scene, camera)
  const url = r.domElement.toDataURL('image/png')
  unstage(pivot)
  thumbs.set(key, url)
  return url
}

// Render every weapon's thumbnail ahead of time (call once when idle)
export function warmWeaponThumbs(): void {
  for (const t of Object.values(WeaponType)) if (t !== WeaponType.Empty) weaponThumb(t as WeaponType)
}

// Live turning model in `host`; returns a stop function (or null without WebGL)
let live: { stop: () => void } | null = null
export function mountWeaponPreview(host: HTMLElement, type: WeaponType, cssSize: number): (() => void) | null {
  live?.stop()
  const r = ensure()
  if (!r) return null
  const pivot = stage(type)
  if (!pivot) return null
  r.setPixelRatio(Math.min(2, window.devicePixelRatio || 1))
  r.setSize(cssSize, cssSize, true)
  const cv = r.domElement
  cv.style.width = cv.style.height = `${cssSize}px`
  host.appendChild(cv)
  const t0 = performance.now()
  let raf = 0
  const tick = () => {
    const t = (performance.now() - t0) / 1000
    // Spin in fast, settle into a slow turn with a little float
    pivot.rotation.y = t * 0.9 + 5 * (1 - Math.exp(-t * 2.5))
    pivot.position.y = Math.sin(t * 1.8) * 0.02
    pulseWeaponModel(pivot, t)
    r.render(scene, camera)
    raf = requestAnimationFrame(tick)
  }
  tick()
  const handle = {
    stop: () => {
      cancelAnimationFrame(raf)
      cv.remove()
      unstage(pivot)
      if (live === handle) live = null
    },
  }
  live = handle
  return handle.stop
}
