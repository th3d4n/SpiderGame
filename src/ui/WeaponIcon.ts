import Phaser from 'phaser'
import { WeaponType } from '../systems/WeaponSystem'

// Draws a small vector emblem for each weapon onto the given Graphics object,
// centered at local (0, 0). Coordinates fit roughly within a 22px box. Callers
// scale the host container/graphics as needed (e.g. a HUD slot uses scale 0.6,
// a menu row uses 1.3).
export function drawWeaponIcon(g: Phaser.GameObjects.Graphics, weapon: WeaponType, color: number): void {
  switch (weapon) {
    case WeaponType.Sword: {
      g.fillStyle(color, 1)
      g.fillTriangle(-7, -2, -7, 2, 8, 0)
      g.lineStyle(1, 0x222222, 1)
      g.strokeTriangle(-7, -2, -7, 2, 8, 0)
      g.fillStyle(0x665533, 1)
      g.fillRect(-8, -4, 2, 8)
      break
    }
    case WeaponType.Bow: {
      g.lineStyle(2, color, 1)
      g.beginPath()
      g.arc(0, 0, 8, Phaser.Math.DegToRad(-80), Phaser.Math.DegToRad(80))
      g.strokePath()
      g.lineStyle(1, 0xeeeeee, 0.9)
      g.lineBetween(0, -8, 0, 8)
      break
    }
    case WeaponType.Axe: {
      g.lineStyle(2, 0x553322, 1)
      g.lineBetween(-7, 0, 3, 0)
      g.fillStyle(color, 1)
      g.fillTriangle(1, -7, 1, 7, 10, 0)
      g.lineStyle(1, 0x222222, 1)
      g.strokeTriangle(1, -7, 1, 7, 10, 0)
      break
    }
    case WeaponType.BoxingGloves: {
      g.lineStyle(2, color, 1)
      g.lineBetween(-9, 0, 6, 0)
      g.fillStyle(color, 1)
      g.fillTriangle(5, -2, 5, 2, 10, 0)
      g.lineStyle(1, 0x665533, 1)
      g.strokeTriangle(5, -2, 5, 2, 10, 0)
      break
    }
    case WeaponType.Glider: {
      g.fillStyle(color, 0.85)
      g.fillTriangle(-6, -1, 6, -7, 6, -1)
      g.fillTriangle(-6,  1, 6,  7, 6,  1)
      g.lineStyle(1, 0x4477aa, 1)
      g.strokeTriangle(-6, -1, 6, -7, 6, -1)
      g.strokeTriangle(-6,  1, 6,  7, 6,  1)
      break
    }
    case WeaponType.FlameBreather: {
      g.fillStyle(0x333333, 1)
      g.fillRect(-6, -3, 9, 6)
      g.lineStyle(1, 0x111111, 1)
      g.strokeRect(-6, -3, 9, 6)
      g.fillStyle(color, 1)
      g.fillTriangle(3, -3, 3, 3, 9, 0)
      break
    }
    case WeaponType.WebLauncher: {
      g.lineStyle(1.5, 0x333344, 1)
      g.strokeRect(-5, -5, 10, 10)
      g.fillStyle(color, 0.9)
      g.fillCircle(0, 0, 3.5)
      g.lineStyle(1, 0x888899, 1)
      g.strokeCircle(0, 0, 3.5)
      g.lineStyle(1, color, 1)
      g.lineBetween(5, 0, 9, 0)
      break
    }
    case WeaponType.Empty:
    default:
      break
  }
}

// Convenience: create a Graphics game object pre-populated with the icon, at the
// given scale. Returned graphics object is parented to the scene's root unless
// the caller adds it into a container.
export function createWeaponIconGraphics(
  scene: Phaser.Scene,
  weapon: WeaponType,
  color: number,
  scale: number = 1,
): Phaser.GameObjects.Graphics {
  const g = scene.add.graphics()
  drawWeaponIcon(g, weapon, color)
  if (scale !== 1) g.setScale(scale)
  return g
}
