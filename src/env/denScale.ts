import * as THREE from 'three'

export const DEN_BASELINE = 10.5               // radius coords were authored at
export const DEN_RADIUS   = 52                 // target radius
export const DEN_SCALE    = DEN_RADIUS / DEN_BASELINE   // 4.952...

// Props/furniture grow with the room but less than the space itself,
// so a bottle-cap table doesn't dwarf Webbs.
export const PROP_SCALE   = DEN_SCALE * 0.75

// LIFE zone — the home stays intimate even though the room is huge.
// Props/furniture/interactables cluster inside LIFE_RADIUS instead of
// spreading all the way out to DEN_RADIUS (which scattered them behind walls).
export const LIFE_RADIUS  = DEN_RADIUS * 0.42   // ~22 wu — props cluster here
export const LIFE_SCALE   = DEN_SCALE * 0.42    // ~2.08 — prop position multiplier
const LIFE_Y              = DEN_SCALE * 0.55     // vertical multiplier for suspended props

// Scale an authored world position to the full den size (floor/walls/exits).
export function denPos(x: number, y: number, z: number): THREE.Vector3 {
  return new THREE.Vector3(x * DEN_SCALE, y * DEN_SCALE, z * DEN_SCALE)
}

// Remap an authored prop position into the central life cluster.
// XZ pulled inward by LIFE_SCALE; Y lifted by LIFE_Y for suspended items.
export function lifePos(x: number, y: number, z: number): THREE.Vector3 {
  return new THREE.Vector3(x * LIFE_SCALE, y * LIFE_Y, z * LIFE_SCALE)
}
