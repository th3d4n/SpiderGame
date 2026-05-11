import Phaser from 'phaser'
import { WeaponType } from '../systems/WeaponSystem'
import { WEAPON_COLORS, WEAPON_DATA } from '../config/WeaponData'

// A weapon lying on the ground. Walk over it to add the weapon to your inventory
// (where it can be assigned to a leg slot via the EquipScreen). Each WeaponPickup
// instance also exposes a string id so scenes can persist "collected" state across
// re-entries and avoid respawning the same weapon.

export default class WeaponPickup extends Phaser.GameObjects.Container {
  readonly weapon: WeaponType
  readonly pickupId: string
  private collected = false

  constructor(scene: Phaser.Scene, x: number, y: number, weapon: WeaponType, pickupId: string) {
    super(scene, x, y)
    this.weapon   = weapon
    this.pickupId = pickupId

    const color = WEAPON_COLORS[weapon]

    // Outer halo
    const halo = scene.add.arc(0, 0, 18, 0, 360, false, color, 0.18)
    this.add(halo)

    // Core glow
    const glow = scene.add.arc(0, 0, 11, 0, 360, false, color, 0.55)
    glow.setStrokeStyle(1, 0xffffff, 0.4)
    this.add(glow)

    // Tiny weapon emblem — same icon used on the leg tip
    const icon = scene.add.graphics()
    this.drawIcon(icon, weapon, color)
    this.add(icon)

    // Floating label
    const label = scene.add.text(0, 18, WEAPON_DATA.get(weapon)?.name ?? weapon, {
      fontFamily: 'monospace',
      fontSize:   '9px',
      color:      '#ddddff',
      backgroundColor: '#0d0d1aaa',
      padding:    { x: 4, y: 1 },
    }).setOrigin(0.5, 0)
    this.add(label)

    scene.add.existing(this)
    scene.physics.add.existing(this, true)
    const staticPb = this.body as Phaser.Physics.Arcade.StaticBody
    staticPb.setCircle(16, -16, -16)

    // Idle bob
    scene.tweens.add({
      targets:  this,
      y:        y - 5,
      duration: 1100,
      yoyo:     true,
      repeat:   -1,
      ease:     'Sine.easeInOut',
    })

    // Pulsing halo
    scene.tweens.add({
      targets:  halo,
      alpha:    { from: 0.1, to: 0.4 },
      duration: 900,
      yoyo:     true,
      repeat:   -1,
      ease:     'Sine.easeInOut',
    })
  }

  collect(): boolean {
    if (this.collected) return false
    this.collected = true

    // Append to weapon inventory in the registry
    const inv = (this.scene.registry.get('weaponInventory') as WeaponType[] | undefined) ?? []
    inv.push(this.weapon)
    this.scene.registry.set('weaponInventory', inv)

    // Notification
    this.scene.events.emit('itemCrafted', {
      displayName: WEAPON_DATA.get(this.weapon)?.name ?? this.weapon,
      color:       WEAPON_COLORS[this.weapon],
    })

    this.scene.tweens.killTweensOf(this)
    this.scene.tweens.add({
      targets:    this,
      scaleX:     2,
      scaleY:     2,
      alpha:      0,
      duration:   240,
      ease:       'Back.easeIn',
      onComplete: () => this.destroy(),
    })
    return true
  }

  // Mirror of Webbs' weapon-tip drawings so the ground pickup matches the equipped look
  private drawIcon(g: Phaser.GameObjects.Graphics, weapon: WeaponType, c: number): void {
    switch (weapon) {
      case WeaponType.Sword:
        g.fillStyle(c, 1); g.fillTriangle(-7, -2, -7, 2, 7, 0)
        g.fillStyle(0x665533, 1); g.fillRect(-8, -4, 2, 8)
        break
      case WeaponType.Bow:
        g.lineStyle(2, c, 1)
        g.beginPath(); g.arc(0, 0, 7, Phaser.Math.DegToRad(-80), Phaser.Math.DegToRad(80)); g.strokePath()
        g.lineStyle(1, 0xeeeeee, 0.9); g.lineBetween(0, -7, 0, 7)
        break
      case WeaponType.Axe:
        g.lineStyle(2, 0x553322, 1); g.lineBetween(-6, 0, 4, 0)
        g.fillStyle(c, 1); g.fillTriangle(2, -7, 2, 7, 10, 0)
        break
      case WeaponType.BoxingGloves:
        g.lineStyle(2, c, 1); g.lineBetween(-7, 0, 5, 0)
        g.fillStyle(c, 1); g.fillTriangle(4, -2, 4, 2, 9, 0)
        break
      case WeaponType.Glider:
        g.fillStyle(c, 0.85); g.fillTriangle(-6, -1, 6, -6, 6, -1); g.fillTriangle(-6, 1, 6, 6, 6, 1)
        break
      case WeaponType.FlameBreather:
        g.fillStyle(0x333333, 1); g.fillRect(-5, -3, 8, 6)
        g.fillStyle(c, 1); g.fillTriangle(3, -2, 3, 2, 8, 0)
        break
      case WeaponType.WebLauncher:
        g.lineStyle(1.5, 0x333344, 1); g.strokeRect(-5, -5, 10, 10)
        g.fillStyle(c, 0.9); g.fillCircle(0, 0, 3.5)
        break
    }
  }
}
