import * as THREE from 'three'
import type { DenHandles } from '../scenes/DenBuilder'

// ─── Lightweight tween helper ─────────────────────────────────────────────────
// No external dependency. Supports numeric property tweens and custom callbacks.

interface TweenEntry {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  obj?:    any
  key?:    string
  from?:   number
  target?: number
  dur:     number
  t:       number
  custom?: (e: number) => void
  onDone?: () => void
}

class Tweener {
  private active: TweenEntry[] = []

  // Tween a numeric property on any object.  Works on THREE vectors, materials,
  // lights — anything with a writable numeric field.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  to(obj: any, key: string, target: number, dur: number, onDone?: () => void): void {
    const from = obj[key] as number
    this.active.push({ obj, key, from, target, dur: Math.max(dur, 0.001), t: 0, onDone })
  }

  // Generic per-frame callback — e is eased 0→1 progress.
  custom(dur: number, apply: (e: number) => void, onDone?: () => void): void {
    this.active.push({ custom: apply, dur: Math.max(dur, 0.001), t: 0, onDone })
  }

  update(dt: number): void {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const a = this.active[i]
      a.t = Math.min(1, a.t + dt / a.dur)
      // easeInOutQuad
      const e = a.t < 0.5
        ? 2 * a.t * a.t
        : 1 - Math.pow(-2 * a.t + 2, 2) / 2
      if (a.custom) {
        a.custom(e)
      } else if (a.obj !== undefined && a.key !== undefined) {
        a.obj[a.key] = (a.from ?? 0) + ((a.target ?? 0) - (a.from ?? 0)) * e
      }
      if (a.t >= 1) {
        a.onDone?.()
        this.active.splice(i, 1)
      }
    }
  }
}

// ─── SurvivorsProgression ────────────────────────────────────────────────────
//
// Phase 1 warmth levels:
//   0  desolate    (start — before any boss)
//   1  partial     (after Roller) — first family group home
//   2  recovering  (after Hive)   — den is warm again
//
// Design principle: each step heals a SPECIFIC wound the player witnessed on
// the way in.  Torn hammock re-spun.  Toppled stool righted.  Dark cake lit.
// Healing the exact damage they saw is what makes it land.

export class SurvivorsProgression {
  private den:       DenHandles
  private scene:     THREE.Scene
  private warmPools: THREE.PointLight[]
  private tween:     Tweener
  private level      = 0
  private npcs:      THREE.Group[] = []

  constructor(den: DenHandles, scene: THREE.Scene, warmPools: THREE.PointLight[]) {
    this.den       = den
    this.scene     = scene
    this.warmPools = warmPools
    this.tween     = new Tweener()
  }

  // ── Public API ───────────────────────────────────────────────────────────────

  // Call every frame from the game loop while currentZone === 'homeBase'.
  update(dt: number, t: number): void {
    this.tween.update(dt)
    for (let i = 0; i < this.npcs.length; i++) {
      const n = this.npcs[i]
      n.position.y = (n.userData.baseY as number) + Math.sin(t * 2 + i) * 0.02
    }
  }

  // Apply warmth state (call on scene load with registry value).
  // Runs all levels up to and including `level` cumulatively.
  applyState(level: number, instant = true): void {
    this.level = Math.max(0, Math.min(level, 2))
    if (this.level >= 1) this.transitionTo(1, instant)
    if (this.level >= 2) this.transitionTo(2, instant)
  }

  // Remove all spawned NPCs.  Call before HomeBaseScene3D.destroy().
  dispose(): void {
    for (const n of this.npcs) {
      this.scene.remove(n)
      n.traverse(o => {
        const m = o as THREE.Mesh
        if (m.isMesh) {
          m.geometry.dispose()
          if (Array.isArray(m.material)) m.material.forEach(mat => mat.dispose())
          else (m.material as THREE.Material).dispose()
        }
      })
    }
    this.npcs.length = 0
  }

  // ── Transition steps ─────────────────────────────────────────────────────────

  private transitionTo(level: number, instant: boolean): void {
    const dur = instant ? 0.0001 : 2.2

    if (level === 1) {
      // After Roller: first family group returns.
      // Each line heals a specific wound the player saw on entry.
      this.rightToppledStool(dur)           // the stool they knocked over during the attack
      this.repairHammock(0, dur)            // the most visible torn hammock
      this.brightenPool(0, 1.4, dur)        // central hearth responds to life returning
      this.spawnReturnGroup(3, new THREE.Vector3(0, 0, 2.5), dur)
      this.warmAtmosphere(0.14, dur)
    }

    if (level === 2) {
      // After Hive: den recovering.
      // The birthday cake gets its candles — the party finally gets its flames.
      this.lightCake(dur)
      this.repairHammock(1, dur)
      this.repairHammock(2, dur)
      this.brightenPool(1, 1.3, dur)
      this.brightenPool(2, 1.3, dur)
      this.spawnReturnGroup(5, new THREE.Vector3(-4, 0,  5), dur)
      this.spawnReturnGroup(4, new THREE.Vector3( 6, 0, -3), dur)
      this.tidyConfetti(dur)
      this.warmAtmosphere(0.18, dur)
    }
  }

  // ── Individual heals ─────────────────────────────────────────────────────────

  private rightToppledStool(dur: number): void {
    // Find via userData.toppled tag set in buildJunkFurniture
    this.den.junk.traverse(o => {
      if (o.userData.toppled === true) {
        this.tween.to(o.rotation, 'z', 0,    dur)
        this.tween.to(o.position, 'y', 0.42, dur)
      }
    })
  }

  private repairHammock(tornIndex: number, dur: number): void {
    const torn: THREE.Mesh[] = this.den.silk.userData.tornHammocks ?? []
    const h = torn[tornIndex]
    if (!h) return

    // Clone so we don't dirty the shared silk material instance
    const repairMat = this.den.mat.silk.clone()
    repairMat.opacity = 0.2   // start barely visible, bloom into pristine
    h.material = repairMat
    this.tween.to(repairMat, 'opacity', 0.85, dur)

    // Lerp vertices back to the un-torn shape captured at build time
    const pos     = h.geometry.attributes.position as THREE.BufferAttribute
    const targets = h.userData.pristineY as Float32Array | undefined
    if (targets) {
      const start = Float32Array.from({ length: pos.count }, (_, i) => pos.getY(i))
      this.tween.custom(dur, (e) => {
        for (let i = 0; i < pos.count; i++) {
          pos.setY(i, start[i] + (targets[i] - start[i]) * e)
        }
        pos.needsUpdate = true
      }, () => { h.geometry.computeVertexNormals() })
    }
  }

  private brightenPool(idx: number, mult: number, dur: number): void {
    const p = this.warmPools[idx]
    if (!p) return
    const base = (p.userData.baseIntensity as number | undefined) ?? p.intensity
    this.tween.to(p, 'intensity', base * mult, dur, () => {
      p.userData.baseIntensity = base * mult   // flicker loop reads the new base
    })
  }

  private lightCake(dur: number): void {
    const cake = this.findCake()
    if (!cake) return

    const flameMat   = this.den.mat.flame
    const candleTops = (cake.userData.candleTops ?? []) as THREE.Vector3[]
    let cakeLightAdded = false

    candleTops.forEach((top, i) => {
      const flame = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.12, 8), flameMat)
      flame.position.copy(top).add(new THREE.Vector3(0, 0.08, 0))
      flame.scale.setScalar(0.001)   // grow from nothing
      cake.add(flame)
      this.tween.to(flame.scale, 'x', 1, dur)
      this.tween.to(flame.scale, 'y', 1, dur)
      this.tween.to(flame.scale, 'z', 1, dur)

      // One warm point light shared by all five candles — add once
      if (!cakeLightAdded) {
        cakeLightAdded = true
        const cl = new THREE.PointLight(0xffaa44, 0, 2.5, 2)
        cl.position.set(0, 1.5, 0)   // cake-local space (table at y=0.6 world)
        cake.add(cl)
        this.tween.to(cl, 'intensity', 1.5, dur)
      }
      void i   // suppress unused-variable warning
    })
  }

  private tidyConfetti(dur: number): void {
    // Fade out every other floor confetti piece — "someone swept a bit"
    // Confetti materials are pre-flagged transparent:true in buildBirthdayBash.
    let n = 0
    this.den.bash.traverse(o => {
      const mesh = o as THREE.Mesh
      if (!mesh.isMesh) return
      if (mesh.geometry.type !== 'PlaneGeometry') return
      if (mesh.position.y > 0.05) return      // skip non-floor items
      if (n++ % 2 !== 0) return               // only half
      // Clone per-piece so tween is independent
      const m      = (mesh.material as THREE.MeshToonMaterial).clone()
      m.transparent = true
      m.opacity     = 1.0
      mesh.material = m
      this.tween.to(m, 'opacity', 0, dur, () => { mesh.visible = false })
    })
  }

  private warmAtmosphere(warmth: number, dur: number): void {
    const grade = this.scene.userData.gradePass as
      { uniforms: { warmth: { value: number } } } | undefined
    if (!grade?.uniforms?.warmth) return
    // Update stored base so transitionTo() reads it on homeBase re-entry
    this.scene.userData.homeBaseWarmth = warmth
    const from = grade.uniforms.warmth.value
    this.tween.custom(dur, (e) => {
      grade.uniforms.warmth.value = from + (warmth - from) * e
    })
  }

  // ── Returning survivors ──────────────────────────────────────────────────────

  private spawnReturnGroup(count: number, center: THREE.Vector3, dur: number): void {
    for (let i = 0; i < count; i++) {
      const spider = this.makeSimpleSpider()
      const a  = (i / count) * Math.PI * 2
      const r  = 0.8 + Math.random() * 1.4
      const tx = center.x + Math.cos(a) * r
      const tz = center.z + Math.sin(a) * r
      // Walk in from the west exit — start just beyond the portal at x ≈ -DEN_RADIUS
      spider.position.set(-59.4, 0, tz * 0.4)   // -12 * 4.95
      spider.userData.baseY = 0.12
      this.scene.add(spider)
      this.npcs.push(spider)
      this.tween.to(spider.position, 'x', tx, dur * (1.0 + Math.random() * 0.5))
      this.tween.to(spider.position, 'z', tz, dur * (1.0 + Math.random() * 0.5))
    }
  }

  // Colony spider visually distinct from Webbs — organic legs, no metal, no glow.
  // Warm-toned so they read as "family" not enemies.
  private makeSimpleSpider(): THREE.Group {
    const g       = new THREE.Group()
    const bodyMat = new THREE.MeshToonMaterial({
      color: 0x5a3a4a, gradientMap: this.den.mat.grad,
    })
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 10), bodyMat)
    body.scale.set(1, 0.8, 1.1)
    body.castShadow = true
    g.add(body)

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8), bodyMat)
    head.position.set(0, 0.02, 0.22)
    g.add(head)

    const legMat = new THREE.MeshToonMaterial({
      color: 0x2a1a22, gradientMap: this.den.mat.grad,
    })
    for (let i = 0; i < 8; i++) {
      const side = i < 4 ? -1 : 1
      const k    = i % 4
      const leg  = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.3, 5), legMat)
      leg.position.set(side * 0.18, -0.02, -0.12 + k * 0.09)
      leg.rotation.z = side * 0.9
      g.add(leg)
    }
    return g
  }

  // ── Lookups ──────────────────────────────────────────────────────────────────

  private findCake(): THREE.Group | null {
    let found: THREE.Group | null = null
    this.den.bash.traverse(o => {
      if (o.userData.isCake === true) found = o as THREE.Group
    })
    return found
  }
}
