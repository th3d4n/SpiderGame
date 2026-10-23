// ─── Render quality ───────────────────────────────────────────────────────────
// Two tiers.  'low' is phones/tablets (coarse pointer) and low-memory or
// low-core machines: a lower pixel-ratio cap, a smaller shadow map, no bloom
// (11 extra render targets for a subtle effect), and dynamic resolution that
// steps the render scale down when frames run long.  `?quality=low|high`
// overrides detection for testing.

export type QualityTier = 'high' | 'low'

export interface QualitySettings {
  maxPixelRatio: number   // cap on devicePixelRatio × CSS scale
  minScale:      number   // dynamic-resolution floor (fraction of the cap)
  shadowMap:     number   // key-light shadow map size
  bloom:         boolean
  dynamicRes:    boolean
}

export const QUALITY: Record<QualityTier, QualitySettings> = {
  high: { maxPixelRatio: 2,    minScale: 1,    shadowMap: 2048, bloom: true,  dynamicRes: false },
  low:  { maxPixelRatio: 1.25, minScale: 0.6,  shadowMap: 1024, bloom: false, dynamicRes: true  },
}

export function detectQualityTier(): QualityTier {
  const forced = new URLSearchParams(location.search).get('quality')
  if (forced === 'low' || forced === 'high') return forced
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches
  const mem    = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8
  const cores  = navigator.hardwareConcurrency ?? 8
  return coarse || mem <= 4 || cores <= 4 ? 'low' : 'high'
}

// Watches frame time and nudges the render scale: down 10 % when frames
// average slower than ~48 fps, back up 5 % when they're comfortably under
// ~57 fps.  Decisions are at most every 2 s (each change reallocates the
// composer's render targets), and hidden tabs / hitches are ignored.
const SLOW = 1 / 48
const FAST = 1 / 57

export class DynamicResolution {
  scale = 1
  private min: number
  private onChange: () => void
  private avg = 1 / 60
  private t   = 0

  constructor(minScale: number, onChange: () => void) {
    this.min = minScale
    this.onChange = onChange
  }

  sample(dt: number): void {
    if (document.hidden || dt <= 0 || dt >= 0.1) return
    this.avg += (dt - this.avg) * 0.05
    this.t += dt
    if (this.t < 2) return
    this.t = 0
    let next = this.scale
    if (this.avg > SLOW && this.scale > this.min) next = Math.max(this.min, this.scale - 0.1)
    else if (this.avg < FAST && this.scale < 1)   next = Math.min(1, this.scale + 0.05)
    if (next !== this.scale) { this.scale = next; this.onChange() }
  }
}
