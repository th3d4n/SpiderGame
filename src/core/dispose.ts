import * as THREE from 'three'

// ─── GPU resource teardown ───────────────────────────────────────────────────
// three.js keeps a GPU buffer/texture/program alive for every geometry,
// texture and material until dispose() is called — removing an object from the
// scene frees nothing.  Zone teardown and enemy cleanup run their roots through
// here.  Anything reused across zones (the toon gradient map, the procedural
// texture cache) is flagged `userData.shared` and left alone.

export function markShared<T extends { userData: Record<string, unknown> }>(res: T): T {
  res.userData.shared = true
  return res
}

const isShared = (res: { userData?: Record<string, unknown> }) => !!res.userData?.shared

export function disposeMaterial(mat: THREE.Material, seen = new Set<object>()): void {
  if (seen.has(mat) || isShared(mat)) return
  seen.add(mat)
  // Every texture slot (map, gradientMap, emissiveMap, alphaMap, …)
  for (const v of Object.values(mat)) {
    if (v instanceof THREE.Texture && !seen.has(v) && !isShared(v)) { seen.add(v); v.dispose() }
  }
  mat.dispose()
}

// Dispose every geometry, material and texture under `root` (and remove it
// from its parent).  Lights with shadow maps free those too.
export function disposeTree(root: THREE.Object3D): void {
  const seen = new Set<object>()
  root.traverse(o => {
    const m = o as THREE.Mesh
    if (m.geometry && !seen.has(m.geometry) && !isShared(m.geometry)) { seen.add(m.geometry); m.geometry.dispose() }
    if (m.material) for (const mat of Array.isArray(m.material) ? m.material : [m.material]) disposeMaterial(mat, seen)
    const l = o as THREE.Light & { shadow?: THREE.LightShadow }
    if (l.isLight && l.shadow?.map) l.shadow.map.dispose()
  })
  root.removeFromParent()
}
