import * as THREE from 'three'
import { createFuzzyBodyTexture } from './SpiderLegs'

// ─── Webbs' body ──────────────────────────────────────────────────────────────
// Same footprint as before (the leg sockets in SpiderLegs depend on it):
// cephalothorax centred (0, 0.42, 0.16), abdomen (0, 0.40, −0.18), facing +Z.
//   • abdomen painted with dorsal markings — a pale "heart" stripe, chevrons and
//     paired spots — computed per texel from the sphere direction, so the
//     pattern sits where a real spider's would regardless of UV seams
//   • carapace with radial grooves; a silk harness stitched round it where the
//     borrowed legs are bound on ("silk wrapped tight around hollow bone")
//   • glossy eyes with a glowing cyan iris ring and highlights
//   • chunky chelicerae with fangs, little pedipalps, spinnerets
//   • fine hair tufts over both segments (one instanced draw)

export const WEBBS_BODY_COLOR = 0x6a4d8a

// Sphere UV (three's SphereGeometry) → unit direction
function dirFromUV(u: number, v: number, out: THREE.Vector3): THREE.Vector3 {
  const phi = u * Math.PI * 2, theta = v * Math.PI
  return out.set(-Math.cos(phi) * Math.sin(theta), Math.cos(theta), Math.sin(phi) * Math.sin(theta))
}

function paint(w: number, h: number, fn: (d: THREE.Vector3, n: number) => [number, number, number]): THREE.DataTexture {
  const data = new Uint8Array(w * h * 4)
  const d = new THREE.Vector3()
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    dirFromUV((x + 0.5) / w, (y + 0.5) / h, d)
    const n = (Math.sin(x * 12.9898 + y * 78.233) * 43758.5453) % 1   // fur grain
    const [r, g, b] = fn(d, Math.abs(n))
    const i = ((h - 1 - y) * w + x) * 4   // texture v runs bottom→top
    data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255
  }
  const tex = new THREE.DataTexture(data, w, h, THREE.RGBAFormat)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.magFilter = THREE.LinearFilter
  tex.minFilter = THREE.LinearMipmapLinearFilter
  tex.generateMipmaps = true
  tex.needsUpdate = true
  return tex
}

const BASE  = [92, 72, 152] as const    // violet — the den's warm light pushes purple toward pink
const DARK  = [40, 28, 70] as const
const PALE  = [214, 200, 255] as const
const SPOT  = [244, 236, 255] as const
const mix = (a: readonly number[], b: readonly number[], t: number) =>
  [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t] as [number, number, number]

function abdomenTexture(): THREE.DataTexture {
  return paint(256, 128, (d, n) => {
    let c = mix(BASE, DARK, Math.max(0, -d.y) * 0.8)          // darker belly
    if (d.y > 0.05) {
      const ax = Math.abs(d.x)
      // heart stripe down the back, waisted
      const sw = 0.11 + 0.06 * Math.cos(d.z * 7)
      if (ax < sw && d.y > 0.35) c = mix(c, PALE, 0.95 - ax / sw * 0.3)
      else if (ax < sw + 0.035 && d.y > 0.35) c = mix(c, DARK, 0.7)   // dark outline makes the stripe read
      // chevrons: V's pointing forward, fading toward the tail
      for (let k = 0; k < 4; k++) {
        const zc = 0.5 - k * 0.32
        const off = Math.abs(d.z - (zc - 0.7 * ax))
        if (off < 0.05 && ax > sw + 0.035 && ax < 0.66) c = mix(c, PALE, 0.8 * (1 - k * 0.15) * (1 - off / 0.05))
      }
      // paired spots
      for (const zs of [0.32, 0.0, -0.32]) for (const sx of [-0.34, 0.34]) {
        const r = Math.hypot(d.x - sx, d.z - zs)
        if (r < 0.075 && d.y > 0.2) c = mix(c, SPOT, Math.min(1, (1 - r / 0.075) * 1.6))
      }
    }
    const grain = 0.88 + n * 0.2
    return [Math.min(255, c[0] * grain), Math.min(255, c[1] * grain), Math.min(255, c[2] * grain)]
  })
}

function carapaceTexture(): THREE.DataTexture {
  return paint(256, 128, (d, n) => {
    let c = mix(BASE, DARK, Math.max(0, -d.y) * 0.7)
    if (d.y > 0.3) {
      // radial grooves from the fovea (top centre) + a pale median line
      const ang = Math.atan2(d.z, d.x)
      const groove = Math.abs(Math.sin(ang * 4)) < 0.12 ? 0.35 : 0
      c = mix(c, DARK, groove * Math.min(1, (1 - d.y) * 3))
      if (Math.abs(d.x) < 0.04 && d.z < 0.2) c = mix(c, PALE, 0.55)
    }
    const grain = 0.9 + n * 0.18
    return [Math.min(255, c[0] * grain), Math.min(255, c[1] * grain), Math.min(255, c[2] * grain)]
  })
}

export interface WebbsBodyParts {
  ceph:    THREE.Mesh
  abd:     THREE.Mesh
  flashMats: THREE.MeshToonMaterial[]   // tinted red on a hit
}

export function buildWebbsBody(group: THREE.Group, gm: THREE.Texture): WebbsBodyParts {
  const fuzz = createFuzzyBodyTexture()
  // The old body was colour × fur map (a linear multiplier ≈ 0.41/0.30/0.54);
  // the painted maps carry the colour, so tint by the same multiplier to keep
  // Webbs' established brightness (white here washed him out ~2.4×).
  const cephMat = new THREE.MeshToonMaterial({ gradientMap: gm, map: carapaceTexture(), bumpMap: fuzz, bumpScale: 0.035 })
  const abdMat  = new THREE.MeshToonMaterial({ gradientMap: gm, map: abdomenTexture(), bumpMap: fuzz, bumpScale: 0.04 })
  for (const m of [cephMat, abdMat]) { m.color.setRGB(0.52, 0.46, 0.7); m.userData.baseColor = m.color.getHex() }
  const dark    = new THREE.MeshToonMaterial({ color: 0x2a1a36, gradientMap: gm })
  const silk    = new THREE.MeshToonMaterial({ color: 0xc9ced8, gradientMap: gm })   // matte: no glow band

  // ── Segments ───────────────────────────────────────────────────────────
  const cephGeo = new THREE.SphereGeometry(0.20, 24, 16); cephGeo.scale(1, 0.7, 1)
  const ceph = new THREE.Mesh(cephGeo, cephMat); ceph.castShadow = true
  ceph.position.set(0, 0.42, 0.16)
  group.add(ceph)

  const abdGeo = new THREE.SphereGeometry(0.26, 28, 20); abdGeo.scale(1, 0.75, 1.15)
  const abd = new THREE.Mesh(abdGeo, abdMat); abd.castShadow = true
  abd.position.set(0, 0.40, -0.18)
  group.add(abd)

  const pedicel = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.06, 0.12, 10), dark)
  pedicel.rotation.x = Math.PI / 2; pedicel.position.set(0, 0.39, -0.01); group.add(pedicel)

  // spinnerets at the tail
  for (const x of [-0.03, 0.03]) {
    const sp = new THREE.Mesh(new THREE.ConeGeometry(0.022, 0.06, 6), dark)
    sp.rotation.x = -Math.PI / 2 - 0.35; sp.position.set(x, -0.03, -0.3)   // abdomen-local rear tip
    abd.add(sp)
  }

  // ── Silk harness round the carapace, cross-stitched ───────────────────
  // An open arc round the sides and back — the face stays clear
  const ARC = Math.PI * 1.35
  const harness = new THREE.Mesh(new THREE.TorusGeometry(0.197, 0.012, 6, 36, ARC), silk)
  harness.rotation.x = Math.PI / 2
  harness.rotation.z = Math.PI / 2 + (Math.PI * 2 - ARC) / 2   // gap centred on +Z (the face)
  harness.position.set(0, -0.015, 0)
  ceph.add(harness)
  for (let i = 0; i < 10; i++) {
    const a = Math.PI / 2 + (Math.PI * 2 - ARC) / 2 + (i + 0.5) / 10 * ARC   // stitches along the arc only
    const st = new THREE.Mesh(new THREE.CapsuleGeometry(0.006, 0.035, 2, 4), silk)
    st.position.set(Math.cos(a) * 0.197, -0.015, Math.sin(a) * 0.197)
    st.rotation.set(0.6, -a, 0)
    ceph.add(st)
  }

  // ── Eyes ──────────────────────────────────────────────────────────────
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0x05080e, roughness: 0.32, metalness: 0.0, emissive: 0x16608c, emissiveIntensity: 0.45 })
  const irisMat = new THREE.MeshBasicMaterial({ color: 0x3fa6c8 })   // below the bloom threshold
  const hiMat = new THREE.MeshBasicMaterial({ color: 0xffffff })
  for (const x of [-0.072, 0.072]) {           // two big primaries
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.047, 16, 12), eyeMat)
    eye.position.set(x, 0.515, 0.315); group.add(eye)
    const iris = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.006, 6, 20), irisMat)
    iris.position.set(x, 0.515, 0.357); iris.rotation.x = -0.15; group.add(iris)
    for (const [hx, hy, r] of [[-0.016, 0.017, 0.012], [0.014, -0.012, 0.006]] as Array<[number, number, number]>) {
      const hi = new THREE.Mesh(new THREE.SphereGeometry(r, 8, 6), hiMat)
      hi.position.set(x + hx, 0.515 + hy, 0.356); group.add(hi)
    }
  }
  const small = new THREE.MeshStandardMaterial({ color: 0x020306, roughness: 0.4, emissive: 0x0f3f5c, emissiveIntensity: 0.6 })
  small.userData.noRim = true; eyeMat.userData.noRim = true   // the rim band made them read as metal beads
  for (const [x, y, z, r] of [
    [-0.14, 0.548, 0.255, 0.024], [0.14, 0.548, 0.255, 0.024],
    [-0.115, 0.585, 0.21, 0.019], [0.115, 0.585, 0.21, 0.019],
    [-0.032, 0.578, 0.29, 0.017], [0.032, 0.578, 0.29, 0.017],
  ] as Array<[number, number, number, number]>) {
    const e = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 8), small); e.position.set(x, y, z); group.add(e)
    const hi = new THREE.Mesh(new THREE.SphereGeometry(r * 0.3, 5, 4), hiMat); hi.position.set(x - r * 0.3, y + r * 0.35, z + r * 0.8); group.add(hi)
  }

  // ── Chelicerae + fangs, pedipalps ─────────────────────────────────────
  const fang = new THREE.MeshToonMaterial({ color: 0x1a1020, gradientMap: gm })
  const mouth = new THREE.MeshToonMaterial({ color: 0x3a2852, gradientMap: gm })   // dark chitin — read as mouthparts
  for (const s of [-1, 1]) {
    const che = new THREE.Mesh(new THREE.CapsuleGeometry(0.035, 0.05, 4, 8), mouth)
    che.position.set(s * 0.042, 0.37, 0.33); che.rotation.set(0.55, 0, s * 0.12); group.add(che)
    const f = new THREE.Mesh(new THREE.ConeGeometry(0.012, 0.05, 6), fang)
    f.position.set(s * 0.036, 0.32, 0.355); f.rotation.set(Math.PI - 0.3, 0, -s * 0.5); group.add(f)
    // pedipalp: two short segments curling forward
    const p1 = new THREE.Mesh(new THREE.CapsuleGeometry(0.014, 0.06, 3, 6), mouth)
    p1.position.set(s * 0.1, 0.37, 0.32); p1.rotation.set(1.0, 0, s * 0.5); group.add(p1)
    const p2 = new THREE.Mesh(new THREE.CapsuleGeometry(0.016, 0.04, 3, 6), dark)
    p2.position.set(s * 0.12, 0.33, 0.37); p2.rotation.set(1.6, 0, s * 0.3); group.add(p2)
  }

  // ── Hair tufts (instanced) ────────────────────────────────────────────
  const hairGeo = new THREE.ConeGeometry(0.0035, 0.028, 3); hairGeo.translate(0, 0.012, 0)
  const hairMat = new THREE.MeshToonMaterial({ color: 0x4a3670, gradientMap: gm })
  hairMat.userData.noRim = true   // rim lit every tip into a sparkle
  const N_ABD = 320, N_CEPH = 90
  const hair = new THREE.InstancedMesh(hairGeo, hairMat, N_ABD + N_CEPH)
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0)
  const p = new THREE.Vector3(), nrm = new THREE.Vector3(), sc = new THREE.Vector3()
  let k = 0
  const place = (cx: number, cy: number, cz: number, rx: number, ry: number, rz: number, count: number, minY: number) => {
    for (let i = 0; i < count; i++) {
      // golden-spiral points on the upper part of the ellipsoid
      const t = (i + 0.5) / count
      const y = 1 - t * (1 - minY)
      const r = Math.sqrt(Math.max(0, 1 - y * y))
      const a = i * 2.399963
      nrm.set(Math.cos(a) * r, y, Math.sin(a) * r)
      p.set(cx + nrm.x * rx, cy + nrm.y * ry, cz + nrm.z * rz)
      // surface normal of the ellipsoid, then tilt hairs backward a little
      nrm.set(nrm.x / rx, nrm.y / ry, nrm.z / rz).normalize()
      nrm.z -= 0.6; nrm.normalize()   // combed back toward the tail
      q.setFromUnitVectors(up, nrm)
      const len = 0.6 + ((i * 37) % 11) / 11 * 0.8
      sc.set(1, len, 1)
      m.compose(p, q, sc)
      hair.setMatrixAt(k++, m)
    }
  }
  place(0, 0.40, -0.18, 0.26, 0.195, 0.3, N_ABD, -0.35)
  place(0, 0.42, 0.16, 0.2, 0.14, 0.2, N_CEPH, 0.15)
  hair.instanceMatrix.needsUpdate = true
  hair.castShadow = false
  group.add(hair)

  return { ceph, abd, flashMats: [cephMat, abdMat] }
}
