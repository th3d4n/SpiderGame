import * as THREE from 'three'

export const DEN_BASELINE = 10.5               // radius coords were authored at
export const DEN_RADIUS   = 52                 // target radius
export const DEN_SCALE    = DEN_RADIUS / DEN_BASELINE   // 4.952...

// Props/furniture grow with the room but less than the space itself,
// so a bottle-cap table doesn't dwarf Webbs.
export const PROP_SCALE   = DEN_SCALE * 0.75

// Scale an authored world position to the new den size.
export function denPos(x: number, y: number, z: number): THREE.Vector3 {
  return new THREE.Vector3(x * DEN_SCALE, y * DEN_SCALE, z * DEN_SCALE)
}
