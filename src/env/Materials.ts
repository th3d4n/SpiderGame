import * as THREE from 'three'

// ─── Shared materials ─────────────────────────────────────────────────────────
// One place for how surfaces look.  Rules:
//  • Albedo is mid-value.  Mood comes from lighting (env/ZoneLighting), never from
//    near-black paint — a 0x0e0a06 floor reflects 0.4% of light and can't be lit.
//  • Environment surfaces are toon-shaded with a procedural texture applied
//    tri-planar in WORLD space (no UV stretching on mounds, walls or terrain, and
//    texel density is the same across every mesh).
//  • Characters and props get a crisp toon rim (Fresnel band) so silhouettes
//    read against dark backgrounds.

// ── Palette (sRGB hex) ──────────────────────────────────────────────────────────
export const PALETTE = {
  // Ant colony — packed earth, damp root-dark walls
  colonyFloor:   0x6e5640,
  colonyPatch:   0x7d6448,
  colonyWall:    0x5c4634,
  colonyCap:     0x705640,
  colonyStone:   0x6a6056,
  colonyStal:    0x5a4a3c,
  deadEndFloor:  0x5e4a38,
  deadEndWall:   0x52402e,
  spike:         0x7a5a40,
  // Boss pit — baked, reddish clay
  bossFloor:     0x6e4a34,
  bossPatch:     0x7c563c,
  bossWall:      0x5a3828,
  bossStal:      0x6a4a32,
  bossStag:      0x664430,
} as const

export type TexKind = 'dirt' | 'stone' | 'chitin' | 'wood' | 'silk'

// ── Procedural tileable textures ────────────────────────────────────────────────
// Value noise on a wrapping lattice → seamless fbm; each kind maps it differently.
// Values stay in ~0.55–1.0 so the map MODULATES the albedo instead of darkening it.

const TEX_SIZE = 256
const texCache = new Map<TexKind, THREE.DataTexture>()

function makeNoise(seed: number) {
  // Deterministic hash → lattice values; wrap period P keeps the result tileable
  const hash = (x: number, y: number) => {
    let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0
    h = (h ^ (h >>> 13)) * 1274126177
    return ((h ^ (h >>> 16)) >>> 0) / 4294967295
  }
  const value = (x: number, y: number, P: number) => {
    const xi = Math.floor(x), yi = Math.floor(y)
    const xf = x - xi, yf = y - yi
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf)
    const w = (i: number) => ((i % P) + P) % P
    const a = hash(w(xi), w(yi)), b = hash(w(xi + 1), w(yi))
    const c = hash(w(xi), w(yi + 1)), d = hash(w(xi + 1), w(yi + 1))
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v
  }
  // fbm over [0,1)² with `oct` octaves starting at period `base`
  return (x: number, y: number, base: number, oct: number) => {
    let sum = 0, amp = 0.5, norm = 0, P = base
    for (let o = 0; o < oct; o++) {
      sum += value(x * P, y * P, P) * amp
      norm += amp; amp *= 0.5; P *= 2
    }
    return sum / norm
  }
}

function buildTexture(kind: TexKind): THREE.DataTexture {
  const N = TEX_SIZE
  const data = new Uint8Array(N * N * 4)
  const n1 = makeNoise(1), n2 = makeNoise(7), n3 = makeNoise(13)
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const x = i / N, y = j / N
      let r: number, g: number, b: number
      if (kind === 'dirt') {
        // Soft clumps + fine grit + sparse pebbles (lighter specks)
        const clump = n1(x, y, 4, 4)
        const grit  = n2(x, y, 32, 2)
        const peb   = n3(x, y, 16, 1) > 0.78 ? 0.12 : 0
        const v = 0.70 + clump * 0.20 + (grit - 0.5) * 0.10 + peb * 0.8
        r = v * 1.02; g = v; b = v * 0.94
      } else if (kind === 'stone') {
        // Ridged noise → crack lines, plus mottling
        const ridge = 1 - Math.abs(n1(x, y, 6, 4) * 2 - 1)
        const crack = ridge > 0.92 ? -0.25 : 0
        const mott  = n2(x, y, 8, 3)
        const v = 0.66 + mott * 0.26 + crack + (n3(x, y, 48, 1) - 0.5) * 0.08
        r = v; g = v * 0.99; b = v * 0.97
      } else if (kind === 'chitin') {
        // Glossy plates: broad bands broken by noise, faint growth lines
        const band = Math.sin((y + n1(x, y, 4, 2) * 0.15) * Math.PI * 10) * 0.5 + 0.5
        const v = 0.7 + band * 0.18 + (n2(x, y, 24, 2) - 0.5) * 0.1
        r = v; g = v; b = v
      } else if (kind === 'wood') {
        // Grain: stretched noise rings along x
        const grain = Math.sin((x * 6 + n1(x, y * 0.25, 4, 3) * 2.5) * Math.PI * 2) * 0.5 + 0.5
        const v = 0.64 + grain * 0.24 + (n2(x, y, 32, 2) - 0.5) * 0.08
        r = v * 1.03; g = v; b = v * 0.92
      } else {
        // silk: fine directional fibres
        const fib = Math.sin((x * 40 + n1(x, y, 8, 2) * 3) * Math.PI * 2) * 0.5 + 0.5
        const v = 0.82 + fib * 0.14 + (n2(x, y, 16, 2) - 0.5) * 0.06
        r = v; g = v; b = v * 1.02
      }
      const k = (j * N + i) * 4
      data[k]     = Math.max(0, Math.min(255, r * 255))
      data[k + 1] = Math.max(0, Math.min(255, g * 255))
      data[k + 2] = Math.max(0, Math.min(255, b * 255))
      data[k + 3] = 255
    }
  }
  const tex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat)
  tex.userData.shared = true   // cached for the whole session — zone teardown must not dispose it
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.colorSpace = THREE.SRGBColorSpace
  tex.magFilter = THREE.LinearFilter
  tex.minFilter = THREE.LinearMipmapLinearFilter
  tex.generateMipmaps = true
  tex.anisotropy = 4
  tex.needsUpdate = true
  return tex
}

export function proceduralTexture(kind: TexKind): THREE.DataTexture {
  let t = texCache.get(kind)
  if (!t) { t = buildTexture(kind); texCache.set(kind, t) }
  return t
}

// ── Shader patches ──────────────────────────────────────────────────────────────

const TRI_VERT_DECL = /* glsl */`
varying vec3 vTriPos;
varying vec3 vTriNormal;
`
const TRI_VERT = /* glsl */`
vTriPos    = (modelMatrix * vec4(transformed, 1.0)).xyz;
vTriNormal = normalize(mat3(modelMatrix) * objectNormal);
`
const TRI_FRAG_DECL = /* glsl */`
uniform float uTriScale;
varying vec3 vTriPos;
varying vec3 vTriNormal;
`
const TRI_FRAG_MAP = /* glsl */`
#ifdef USE_MAP
  vec3 triW = pow(abs(normalize(vTriNormal)), vec3(4.0));
  triW /= (triW.x + triW.y + triW.z);
  vec4 triTex = texture2D(map, vTriPos.zy * uTriScale) * triW.x
              + texture2D(map, vTriPos.xz * uTriScale) * triW.y
              + texture2D(map, vTriPos.xy * uTriScale) * triW.z;
  diffuseColor *= triTex;
#endif
`
const RIM_FRAG_DECL = /* glsl */`
uniform vec3  uRimColor;
uniform float uRimStrength;
`
// Toon rim: a crisp Fresnel band, slightly stronger on surfaces facing up/toward
// the key light so it reads as light wrapping the silhouette, not a glow.
const RIM_FRAG = /* glsl */`
{
  float fres = 1.0 - clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0);
  float band = smoothstep(0.62, 0.70, fres);
  outgoingLight += uRimColor * band * uRimStrength;
}
`

// nearFade: alpha ramps 0 → 1 between these view-space distances, so thin
// transparent things (silk) vanish instead of smearing across a close camera.
// cutaway: the material is cut open (dithered discard) inside a cylinder from
// the camera to CUTAWAY.center — tall walls between the camera and Webbs open
// a window onto him.  The uniforms are shared; the colony moves them per frame.
interface PatchOpts { triplanar?: number; rim?: { color: number; strength: number }; nearFade?: [number, number]; cutaway?: boolean }
type PatchData = { triScale?: { value: number }; rimColor?: { value: THREE.Color }; rimStrength?: { value: number }; nearFade?: { value: THREE.Vector2 }; cutaway?: boolean; patched?: string }

export const CUTAWAY = {
  center: { value: new THREE.Vector3(0, -1000, 0) },   // parked far below: nothing is cut
  cam:    { value: new THREE.Vector3(0, 10, 0) },
  radius: { value: 1.6 },
}
const CUT_VERT = /* glsl */`
#ifdef USE_INSTANCING
  vCutPos = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
#else
  vCutPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
#endif
`
const CUT_FRAG = /* glsl */`
{
  vec3 cc = uCutC - uCutCam;
  float t = dot(vCutPos - uCutCam, cc) / max(dot(cc, cc), 1e-4);
  if (t < 0.99) {
    float d = length(vCutPos - (uCutCam + cc * t));
    float n = fract(sin(dot(floor(gl_FragCoord.xy), vec2(12.9898, 78.233))) * 43758.5453);
    if (d < uCutR - 0.3 + n * 0.6) discard;
  }
}
`

// Material.clone() drops onBeforeCompile/customProgramCacheKey but JSON-copies
// userData (incl. the `patched` flag), so a plain clone silently loses its
// tri-planar mapping and rim.  Clone through here instead.
export function clonePatched<T extends THREE.Material>(src: T): T {
  const c = src.clone() as T
  const s = src.userData as PatchData
  const ud = c.userData
  delete ud.patched; delete ud.triScale; delete ud.rimColor; delete ud.rimStrength; delete ud.nearFade; delete ud.cutaway
  if (s.patched) {
    patchMaterial(c, {
      triplanar: s.triScale?.value,
      rim: s.rimColor && s.rimStrength ? { color: s.rimColor.value.getHex(), strength: s.rimStrength.value } : undefined,
      nearFade: s.nearFade ? [s.nearFade.value.x, s.nearFade.value.y] : undefined,
      cutaway: s.cutaway,
    })
  }
  return c
}

// Patch any lit three material (Toon/Standard/Lambert) in place.  Safe to call
// more than once; options merge into the existing patch.
export function patchMaterial(mat: THREE.Material, opts: PatchOpts): void {
  const ud = mat.userData as PatchData
  if (opts.triplanar !== undefined) ud.triScale = { value: opts.triplanar }
  if (opts.nearFade) ud.nearFade = { value: new THREE.Vector2(...opts.nearFade) }
  if (opts.cutaway) ud.cutaway = true
  if (opts.rim) {
    ud.rimColor    = { value: new THREE.Color(opts.rim.color) }
    ud.rimStrength = { value: opts.rim.strength }
  }
  const key = `${ud.triScale ? 'T' : ''}${ud.rimColor ? 'R' : ''}${ud.nearFade ? 'N' : ''}${ud.cutaway ? 'C' : ''}`
  if (ud.patched === key) return
  ud.patched = key
  mat.onBeforeCompile = (shader) => {
    if (ud.triScale) {
      shader.uniforms.uTriScale = ud.triScale
      shader.vertexShader = TRI_VERT_DECL + shader.vertexShader
        .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + TRI_VERT)
      shader.fragmentShader = TRI_FRAG_DECL + shader.fragmentShader
        .replace('#include <map_fragment>', TRI_FRAG_MAP)
    }
    if (ud.rimColor && ud.rimStrength) {
      shader.uniforms.uRimColor    = ud.rimColor
      shader.uniforms.uRimStrength = ud.rimStrength
      shader.fragmentShader = RIM_FRAG_DECL + shader.fragmentShader
        .replace('#include <opaque_fragment>', RIM_FRAG + '\n#include <opaque_fragment>')
    }
    if (ud.nearFade) {
      shader.uniforms.uNearFade = ud.nearFade
      shader.vertexShader = 'varying float vNearZ;\n' + shader.vertexShader
        .replace('#include <project_vertex>', '#include <project_vertex>\nvNearZ = -mvPosition.z;')
      shader.fragmentShader = 'uniform vec2 uNearFade;\nvarying float vNearZ;\n' + shader.fragmentShader
        .replace('#include <opaque_fragment>', 'diffuseColor.a *= smoothstep(uNearFade.x, uNearFade.y, vNearZ);\n#include <opaque_fragment>')
    }
    if (ud.cutaway) {
      shader.uniforms.uCutC   = CUTAWAY.center
      shader.uniforms.uCutCam = CUTAWAY.cam
      shader.uniforms.uCutR   = CUTAWAY.radius
      shader.vertexShader = 'varying vec3 vCutPos;\n' + shader.vertexShader
        .replace('#include <project_vertex>', '#include <project_vertex>\n' + CUT_VERT)
      shader.fragmentShader = 'uniform vec3 uCutC;\nuniform vec3 uCutCam;\nuniform float uCutR;\nvarying vec3 vCutPos;\n' +
        shader.fragmentShader.replace('void main() {', 'void main() {\n' + CUT_FRAG)
    }
  }
  mat.customProgramCacheKey = () => 'nolegs-' + key
  mat.needsUpdate = true
}

// ── Factories ───────────────────────────────────────────────────────────────────

export interface SurfaceOpts {
  color:       number
  tex?:        TexKind
  texScale?:   number          // texture repeats per world unit (tri-planar)
  gradientMap: THREE.Texture
  transparent?: boolean
  opacity?:     number
  depthWrite?:  boolean
}

// Environment surface: toon + world-space tri-planar procedural texture.
export function surface(o: SurfaceOpts): THREE.MeshToonMaterial {
  const mat = new THREE.MeshToonMaterial({
    color:       o.color,
    gradientMap: o.gradientMap,
    map:         o.tex ? proceduralTexture(o.tex) : null,
    transparent: o.transparent ?? false,
    opacity:     o.opacity ?? 1,
    depthWrite:  o.depthWrite ?? true,
  })
  if (o.tex) patchMaterial(mat, { triplanar: o.texScale ?? 0.4 })
  return mat
}

// Character / prop silhouette rim.  Walks a group and patches every lit material.
export const RIM_DEFAULT = { color: 0xbfd8ff, strength: 0.35 }
export function addRim(root: THREE.Object3D, rim = RIM_DEFAULT): void {
  root.traverse(o => {
    const m = o as THREE.Mesh
    if (!m.isMesh) return
    const mats = Array.isArray(m.material) ? m.material : [m.material]
    for (const mat of mats) {
      if (mat instanceof THREE.MeshToonMaterial || mat instanceof THREE.MeshStandardMaterial ||
          mat instanceof THREE.MeshLambertMaterial || mat instanceof THREE.MeshPhongMaterial) {
        if (mat.side === THREE.BackSide || mat.userData.noRim) continue   // outlines (and opt-outs) stay flat
        patchMaterial(mat, { rim })
      }
    }
  })
}
