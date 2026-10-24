import * as THREE from 'three'

// ─── Zone lighting presets ────────────────────────────────────────────────────
// One table owns each zone's look: key light (the shadow caster, follows the
// player), sky/ground ambient, the lantern Webbs carries, fog and exposure.
// Scenes keep only their story accents (hearth, lanterns, boss glows).
//
// Intensities are physical (three.js r155+): point lights fall off with 1/d², so
// accent lights need values in the tens-to-hundreds at these room sizes.

export type ZoneId = 'homeBase' | 'antColony' | 'bossRoller'

interface LightPreset {
  shadows?:   boolean   // key-light shadow pass (default on)
  key:        { color: number; intensity: number; azimuthDeg: number; elevationDeg: number }
  hemi:       { sky: number; ground: number; intensity: number }
  lantern:    { color: number; intensity: number; range: number; height: number }  // range/height × scale
  fog:        { color: number; depth: number }   // linear fog: clear to the player, fades over `depth` × scale behind
  background: number
  exposure:   number
  warmth:     number   // grade pass warmth (den value is overridden by SurvivorsProgression)
}

export const ZONE_LIGHTS: Record<ZoneId, LightPreset> = {
  // Warm, lived-in burrow: light leaking through a ceiling crack, amber bounce
  homeBase: {
    key:        { color: 0xffd9a8, intensity: 1.6, azimuthDeg: 35, elevationDeg: 62 },
    hemi:       { sky: 0x9a8aa8, ground: 0x4a2e18, intensity: 1.2 },
    lantern:    { color: 0xffd7a0, intensity: 6, range: 6, height: 1.2 },
    fog:        { color: 0x1a110c, depth: 55 },
    background: 0x0d0907,
    exposure:   1.0,
    warmth:     0.12,
  },
  // Cold, damp tunnels: a weak grey-green key, the lantern does the work
  antColony: {
    // Dark: Webbs' lantern is the light; line-of-sight darkness does the rest.
    // No key shadows: under the darkness they barely read, and the pass doubled
    // the maze's draw calls.
    shadows:    false,
    key:        { color: 0x9aa8a0, intensity: 0.32, azimuthDeg: -20, elevationDeg: 70 },
    hemi:       { sky: 0x3a4438, ground: 0x120e08, intensity: 0.85 },
    lantern:    { color: 0xffd9a8, intensity: 12, range: 7.5, height: 1.3 },
    fog:        { color: 0x020302, depth: 26 },
    background: 0x010101,
    exposure:   1.2,
    warmth:     0.0,
  },
  // Boss pit: dim, red-hot rim of the arena; enough fill to read the fight
  bossRoller: {
    key:        { color: 0xffb08a, intensity: 0.9, azimuthDeg: 10, elevationDeg: 75 },
    hemi:       { sky: 0x5a3a3a, ground: 0x140806, intensity: 1.4 },
    lantern:    { color: 0xffd0a0, intensity: 6, range: 6, height: 1.2 },
    fog:        { color: 0x060303, depth: 30 },
    background: 0x030202,
    exposure:   1.35,
    warmth:     0.04,
  },
}

// Scene accent lights (hearth, lanterns, glows) are authored with small legacy
// intensities; this per-zone gain converts them to physical units at the zone's
// typical light-to-surface distance (den ≈ 6–8 wu, colony ≈ 2–3, boss ≈ 4).
export const ACCENT_GAIN: Record<ZoneId, number> = {
  homeBase:   8,
  antColony:  6,
  bossRoller: 15,
}

// Forward rendering loops every visible light in every lit material, every frame.
// The colony alone builds 46 accent point lights; keep only the strongest few
// near the player switched on.  The visible COUNT stays constant, so swapping
// which lights are on never forces a shader recompile.
const MAX_ACCENT_POINTS = 8
const _lp = new THREE.Vector3()
const BUDGET_INTERVAL   = 0.25   // s between re-evaluations

// scratch for shadow texel snapping
const _fwd = new THREE.Vector3(), _right = new THREE.Vector3(), _upL = new THREE.Vector3(), _p = new THREE.Vector3()
const _up  = new THREE.Vector3(0, 1, 0)

export class ZoneLighting {
  private accents: THREE.PointLight[] = []
  private budgetT = 0
  readonly key:     THREE.DirectionalLight
  readonly hemi:    THREE.HemisphereLight
  readonly lantern: THREE.PointLight
  private preset:   LightPreset = ZONE_LIGHTS.homeBase
  private keyDir    = new THREE.Vector3()
  private scene:    THREE.Scene
  private renderer: THREE.WebGLRenderer

  constructor(scene: THREE.Scene, renderer: THREE.WebGLRenderer, shadowMapSize = 2048) {
    this.scene    = scene
    this.renderer = renderer
    this.key = new THREE.DirectionalLight(0xffffff, 1)
    this.key.castShadow = true
    this.key.shadow.mapSize.set(shadowMapSize, shadowMapSize)
    this.key.shadow.bias = -0.0004
    this.key.shadow.normalBias = 0.02
    this.hemi    = new THREE.HemisphereLight(0xffffff, 0x000000, 1)
    this.lantern = new THREE.PointLight(0xffffff, 1, 6, 2)
    scene.add(this.key, this.key.target, this.hemi, this.lantern)
    scene.fog = new THREE.Fog(0x000000, 10, 100)
  }

  apply(zone: ZoneId, scale: number, warmthOverride?: number): ZoneLighting {
    const p = this.preset = ZONE_LIGHTS[zone]
    this.key.castShadow = p.shadows !== false
    this.key.color.setHex(p.key.color)
    this.key.intensity = p.key.intensity
    const az = THREE.MathUtils.degToRad(p.key.azimuthDeg)
    const el = THREE.MathUtils.degToRad(p.key.elevationDeg)
    this.keyDir.set(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el))
    this.hemi.color.setHex(p.hemi.sky)
    this.hemi.groundColor.setHex(p.hemi.ground)
    this.hemi.intensity = p.hemi.intensity
    this.lantern.color.setHex(p.lantern.color)
    this.lantern.intensity = p.lantern.intensity * scale * scale   // 1/d² — keep lux constant across scales
    this.lantern.distance  = p.lantern.range * scale * 2.5
    ;(this.scene.fog as THREE.Fog).color.setHex(p.fog.color)
    this.scene.background = new THREE.Color(p.background)
    this.renderer.toneMappingExposure = p.exposure
    const grade = this.scene.userData.gradePass as { uniforms: Record<string, { value: number }> } | undefined
    if (grade) grade.uniforms['warmth'].value = warmthOverride ?? p.warmth

    // Shadow box sized to the visible area at default zoom
    const half = 13 * scale
    const cam  = this.key.shadow.camera
    cam.left = cam.bottom = -half
    cam.right = cam.top   =  half
    cam.near = 0.5
    cam.far  = 70 * scale
    cam.updateProjectionMatrix()
    return this
  }

  // Scale every not-yet-calibrated point/spot light in the scene by the zone gain.
  // Call once after a scene is built (its lights are added straight to the scene).
  calibrateAccents(zone: ZoneId): void {
    const gain = ACCENT_GAIN[zone]
    this.accents = []
    this.scene.traverse(o => {
      if (!(o instanceof THREE.PointLight || o instanceof THREE.SpotLight)) return
      if (o === this.lantern) return
      if (!o.userData.calibrated) { o.intensity *= gain; o.userData.calibrated = true }
      if (o instanceof THREE.PointLight) this.accents.push(o)
    })
    this.budgetT = 0   // re-evaluate on the next update
  }

  // Keep the MAX_ACCENT_POINTS lights that contribute most at the player on.
  private applyBudget(x: number, z: number): void {
    const list = this.accents.filter(l => l.parent)   // drop lights removed with an old scene
    this.accents = list
    if (list.length <= MAX_ACCENT_POINTS) { for (const l of list) l.visible = true; return }
    const score = (l: THREE.PointLight) => {
      l.getWorldPosition(_lp)   // lights parented inside props/creatures sit in local space
      const d2 = (_lp.x - x) ** 2 + (_lp.z - z) ** 2
      const reach = l.distance > 0 ? l.distance : Infinity
      return d2 > reach * reach ? 0 : (l.userData.baseIntensity ?? l.intensity) / Math.max(1, d2)
    }
    const ranked = [...list].sort((a, b) => score(b) - score(a))
    ranked.forEach((l, i) => { l.visible = i < MAX_ACCENT_POINTS })
  }

  // Per frame: key light + shadow box and the lantern follow the player; fog is
  // clear up to the player and fades over the preset depth behind them.
  update(x: number, y: number, z: number, scale: number, cameraDistance: number, delta: number): void {
    this.budgetT -= delta
    if (this.budgetT <= 0) { this.applyBudget(x, z); this.budgetT = BUDGET_INTERVAL }
    const d = 35 * scale
    // Snap the shadow box to whole shadow-map texels (in the light's own plane):
    // a box that slides continuously re-samples every edge each frame and the
    // shadows crawl as you walk.
    const texel = (2 * 13 * scale) / this.key.shadow.mapSize.x
    _fwd.copy(this.keyDir).negate().normalize()
    _right.crossVectors(_up, _fwd).normalize()
    _upL.crossVectors(_fwd, _right)
    _p.set(x, 0, z)
    const r = _p.dot(_right), u = _p.dot(_upL)
    _p.addScaledVector(_right, Math.round(r / texel) * texel - r)
     .addScaledVector(_upL,   Math.round(u / texel) * texel - u)
    this.key.target.position.copy(_p)
    this.key.position.set(_p.x + this.keyDir.x * d, _p.y + this.keyDir.y * d, _p.z + this.keyDir.z * d)
    const l = this.preset.lantern
    this.lantern.position.set(x, y + l.height * scale, z)
    const fog = this.scene.fog as THREE.Fog
    fog.near = cameraDistance * 0.9
    fog.far  = cameraDistance + this.preset.fog.depth * scale
  }
}
