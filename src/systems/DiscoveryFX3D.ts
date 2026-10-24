import * as THREE from 'three'
import { WeaponType } from './WeaponSystem'
import { WEAPON_COLORS } from '../config/WeaponData'
import { CAMERA_DIR_X, CAMERA_DIR_Z } from '../core/CameraRig'
import { buildWeaponModel, pulseWeaponModel, disposeModel } from '../entities/WeaponModels'
import { addRim } from '../env/Materials'

// ─── Discovery close-up ───────────────────────────────────────────────────────
// The 3D half of "Webbs found something cool" (PresentationPhase drives it; the
// HTML discovery card follows).  Everything lives in one group at Webbs' feet,
// turned to face the camera and scaled with him.  Timeline (s):
//   0.00  vignette closes in, a light shaft opens over Webbs
//   0.15  the item rises out of the light, spinning fast and slowing
//   0.70  HIT — flash, two shockwave rings, god rays bloom, sparkles orbit
//   2.55  the item winds up and zips away into the card (flash)
//   3.00  done (PresentationPhase ends the pose)
export const DISCOVERY_FX_SECONDS = 3.0
const HIT = 0.7
const OUT = 2.55
const ITEM_Y = 1.75   // hover height (× Webbs scale) — clear above his body from the iso camera
const ITEM_Z = 0.55   // toward the camera

// Lazily-drawn shared textures
let texCache: { beam: THREE.Texture; rays: THREE.Texture; glow: THREE.Texture; star: THREE.Texture } | null = null
function textures() {
  if (texCache) return texCache
  const make = (w: number, h: number, draw: (g: CanvasRenderingContext2D) => void) => {
    const c = document.createElement('canvas'); c.width = w; c.height = h
    draw(c.getContext('2d')!)
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace
    return t
  }
  const beam = make(4, 128, g => {
    const gr = g.createLinearGradient(0, 128, 0, 0)          // bottom bright → top clear
    gr.addColorStop(0, 'rgba(255,255,255,0.0)'); gr.addColorStop(0.08, 'rgba(255,255,255,0.9)')
    gr.addColorStop(0.5, 'rgba(255,255,255,0.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)')
    g.fillStyle = gr; g.fillRect(0, 0, 4, 128)
  })
  const rays = make(256, 256, g => {
    g.translate(128, 128)
    for (let i = 0; i < 18; i++) {
      g.rotate((Math.PI * 2) / 18)
      const gr = g.createLinearGradient(0, 0, 0, -128)
      gr.addColorStop(0, 'rgba(255,255,255,0.9)'); gr.addColorStop(1, 'rgba(255,255,255,0)')
      g.fillStyle = gr
      const w = i % 2 ? 7 : 13
      g.beginPath(); g.moveTo(-w, 0); g.lineTo(0, -128); g.lineTo(w, 0); g.fill()
    }
  })
  const glow = make(128, 128, g => {
    const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64)
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,255,255,0.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)')
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128)
  })
  const star = make(64, 64, g => {
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32)
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.2, 'rgba(255,255,255,0.5)'); gr.addColorStop(1, 'rgba(255,255,255,0)')
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64)
    g.fillStyle = 'rgba(255,255,255,0.95)'
    g.beginPath(); g.moveTo(32, 2); g.lineTo(35, 29); g.lineTo(62, 32); g.lineTo(35, 35); g.lineTo(32, 62); g.lineTo(29, 35); g.lineTo(2, 32); g.lineTo(29, 29); g.fill()
  })
  return (texCache = { beam, rays, glow, star })
}

const add = (color: number, map: THREE.Texture, opacity = 1) => new THREE.MeshBasicMaterial({
  color, map, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
})
const easeOutBack = (t: number) => { const c = 1.9; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2) }
const clamp01 = (t: number) => Math.max(0, Math.min(1, t))

export class DiscoveryFX3D {
  private root   = new THREE.Group()
  private holder = new THREE.Group()
  private model:  THREE.Group | null
  private beam:   THREE.Mesh
  private rays:   THREE.Mesh
  private flash:  THREE.Mesh
  private halo:   THREE.Sprite
  private rings:  THREE.Mesh[] = []
  private stars:  Array<{ s: THREE.Sprite; a: number; r: number; tilt: number; speed: number; ph: number }> = []
  private vignette: HTMLDivElement
  private t = 0
  private spin = 0
  done = false

  constructor(scene: THREE.Scene, weapon: WeaponType, at: THREE.Vector3, scale: number, gm: THREE.Texture | null) {
    const color = WEAPON_COLORS[weapon] ?? 0xffffff
    // Glow colour: the weapon's, warmed toward gold so pale weapons don't bloom to white
    const accent = new THREE.Color(color).lerp(new THREE.Color(0xffc861), 0.45).getHex()
    const tx = textures()

    this.root.position.copy(at)
    this.root.rotation.y = Math.atan2(CAMERA_DIR_X, CAMERA_DIR_Z)   // local +Z faces the camera
    this.root.scale.setScalar(scale)
    scene.add(this.root)

    // Light shaft over Webbs
    const beamGeo = new THREE.CylinderGeometry(0.42, 0.62, 6, 24, 1, true)
    // Warm gold shaft, tinted toward the weapon's colour
    const beamCol = new THREE.Color(0xffc861).lerp(new THREE.Color(color), 0.3).getHex()
    this.beam = new THREE.Mesh(beamGeo, add(beamCol, tx.beam, 0))
    this.beam.position.set(0, 3, 0.2)
    this.root.add(this.beam)

    // Item holder (rises, spins) + the model
    this.holder.position.set(0, 0.2, ITEM_Z)
    this.root.add(this.holder)
    this.model = buildWeaponModel(weapon, gm, color)
    if (this.model) {
      addRim(this.model)
      this.model.scale.setScalar(2.6)
      this.model.rotation.x = 0.35                      // tip the top face toward the camera
      // centre the model on the holder
      const box = new THREE.Box3().setFromObject(this.model)
      const c = box.getCenter(new THREE.Vector3())
      this.model.position.sub(c)
      this.holder.add(this.model)
    }
    this.halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: tx.glow, color: accent, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }))
    this.halo.scale.setScalar(1.25)
    this.holder.add(this.halo)

    // God rays behind the item (local XY plane faces the camera)
    this.rays = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 3.4), add(accent, tx.rays, 0))
    this.rays.position.set(0, 0, -0.25)
    this.rays.scale.setScalar(0.01)
    this.holder.add(this.rays)

    // Hit flash
    this.flash = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), add(0xffffff, tx.glow, 0))
    this.flash.position.set(0, 0, 0.3)
    this.holder.add(this.flash)

    // Shockwave rings on the ground
    for (let i = 0; i < 2; i++) {
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.86, 1.0, 64).rotateX(-Math.PI / 2), add(accent, tx.glow, 0))
      ;(ring.material as THREE.MeshBasicMaterial).map = null   // flat colour; the ring shape does the work
      ring.position.set(0, 0.06, 0.2)
      this.root.add(ring)
      this.rings.push(ring)
    }

    // Sparkles orbiting the item
    for (let i = 0; i < 16; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tx.star, color: i % 3 ? accent : 0xffffff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }))
      this.holder.add(s)
      this.stars.push({ s, a: (i / 16) * Math.PI * 2, r: 0.55 + Math.random() * 0.35, tilt: (Math.random() - 0.5) * 1.2, speed: 0.8 + Math.random() * 0.9, ph: Math.random() * 6 })
    }

    // Screen vignette (HTML, above the canvas, below the UI)
    this.vignette = document.createElement('div')
    this.vignette.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:40;opacity:0;transition:opacity 380ms ease;' +
      'background:radial-gradient(ellipse at 50% 46%, rgba(0,0,0,0) 32%, rgba(4,2,8,0.72) 100%)'
    document.body.appendChild(this.vignette)
    requestAnimationFrame(() => { this.vignette.style.opacity = '1' })
  }

  // Real-time dt (the game is paused while this plays)
  update(dt: number): void {
    if (this.done) return
    this.t += dt
    const t = this.t

    // Beam: opens fast, holds, fades with the exit
    const beamIn = clamp01(t / 0.45), beamOut = clamp01((t - OUT) / 0.4)
    ;(this.beam.material as THREE.MeshBasicMaterial).opacity = 0.2 * beamIn * (1 - beamOut) * (t > HIT ? 1 : 0.7)
    this.beam.scale.set(1 + 0.15 * Math.sin(t * 5), 1, 1 + 0.15 * Math.sin(t * 5))

    // Item: rise with overshoot, fast spin settling to a slow turn, gentle bob
    const rise = easeOutBack(clamp01((t - 0.15) / 0.8))
    let y = 0.2 + rise * (ITEM_Y - 0.2) + (t > 1 ? Math.sin((t - 1) * 2.6) * 0.04 : 0)
    let s = clamp01((t - 0.1) / 0.35)
    this.spin += (1.3 + 14 * Math.exp(-t * 2.4)) * dt
    // Exit: wind up (squash), then zip up toward the camera and vanish
    const out = clamp01((t - OUT) / (DISCOVERY_FX_SECONDS - OUT))
    let z = ITEM_Z
    if (out > 0) {
      s *= out < 0.35 ? 1 + 0.25 * Math.sin(out / 0.35 * Math.PI / 2) : Math.max(0, 1.25 * (1 - (out - 0.35) / 0.65))
      y += out * out * 0.8
      z += out * out * 1.6
      this.spin += 18 * out * dt
    }
    this.holder.position.set(0, y, z)
    this.holder.scale.setScalar(Math.max(0.0001, s))
    if (this.model) { this.model.rotation.y = this.spin; pulseWeaponModel(this.model, t) }

    // Halo + rays: bloom at the hit
    const hitT = clamp01((t - HIT) / 0.5)
    ;(this.halo.material as THREE.SpriteMaterial).opacity = (t < HIT ? 0.2 * clamp01(t / 0.5) : 0.26 + 0.08 * Math.sin(t * 4)) * (1 - beamOut)
    const rm = this.rays.material as THREE.MeshBasicMaterial
    rm.opacity = 0.2 * hitT * (1 - beamOut)
    this.rays.scale.setScalar(Math.max(0.01, easeOutBack(hitT)))
    this.rays.rotation.z += dt * 0.35

    // Flash at the hit, and again as the item zips out
    const f1 = clamp01((t - HIT) / 0.35), f2 = clamp01((t - (DISCOVERY_FX_SECONDS - 0.2)) / 0.2)
    const fm = this.flash.material as THREE.MeshBasicMaterial
    if (t >= HIT && f1 < 1) { fm.opacity = 1 - f1; this.flash.scale.setScalar(0.4 + f1 * 3.2) }
    else if (f2 > 0) { fm.opacity = Math.sin(f2 * Math.PI) * 0.9; this.flash.scale.setScalar(1 + f2 * 2) }
    else fm.opacity = 0

    // Shockwave rings
    this.rings.forEach((ring, i) => {
      const k = clamp01((t - HIT - i * 0.14) / 0.75)
      ring.visible = k > 0 && k < 1
      ring.scale.setScalar(0.3 + k * 3.4)
      ;(ring.material as THREE.MeshBasicMaterial).opacity = 0.85 * (1 - k) * (1 - k)
    })

    // Sparkles: orbit on tilted circles, twinkle
    for (const st of this.stars) {
      st.a += st.speed * dt
      const r = st.r * (0.6 + 0.4 * hitT)
      st.s.position.set(Math.cos(st.a) * r, Math.sin(st.a) * r * Math.sin(st.tilt) * 0.6 + Math.sin(st.a * 2) * 0.08, Math.sin(st.a) * r * Math.cos(st.tilt) * 0.5)
      const tw = 0.5 + 0.5 * Math.sin(t * 7 + st.ph)
      st.s.scale.setScalar(0.06 + tw * 0.12)
      ;(st.s.material as THREE.SpriteMaterial).opacity = hitT * (0.4 + 0.6 * tw) * (1 - beamOut)
    }

    if (t >= DISCOVERY_FX_SECONDS) this.vignette.style.opacity = '0'
  }

  dispose(): void {
    this.done = true
    this.root.parent?.remove(this.root)
    if (this.model) disposeModel(this.model)
    this.root.traverse(o => {
      const m = o as THREE.Mesh
      if (m.isMesh || (o as THREE.Sprite).isSprite) {
        if (m.geometry && !(o as THREE.Sprite).isSprite) m.geometry.dispose()
        ;(m.material as THREE.Material).dispose()
      }
    })
    const v = this.vignette
    v.style.opacity = '0'
    window.setTimeout(() => v.remove(), 420)
  }
}
