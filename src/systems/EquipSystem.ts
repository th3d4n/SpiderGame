import Phaser from 'phaser'
import { WeaponType } from './WeaponSystem'

const REGISTRY_KEY = 'equipLoadout'

export class EquipSystem {
  private loadout: (WeaponType | null)[]
  private scene: Phaser.Scene

  constructor(scene: Phaser.Scene) {
    this.scene = scene
    const saved = scene.registry.get(REGISTRY_KEY) as (WeaponType | null)[] | undefined
    this.loadout = saved ? [...saved] : Array(8).fill(null)
  }

  equipWeapon(legSlot: number, weaponType: WeaponType): boolean {
    if (legSlot < 0 || legSlot > 7) return false
    this.loadout[legSlot] = weaponType
    this.persist()
    this.scene.game.events.emit('loadoutChanged', this.getLoadout())
    return true
  }

  unequipWeapon(legSlot: number): WeaponType | null {
    const prev = this.loadout[legSlot] ?? null
    this.loadout[legSlot] = null
    this.persist()
    this.scene.game.events.emit('loadoutChanged', this.getLoadout())
    return prev
  }

  getEquippedWeapon(legSlot: number): WeaponType | null {
    return this.loadout[legSlot] ?? null
  }

  getLoadout(): Record<number, WeaponType | null> {
    const result: Record<number, WeaponType | null> = {}
    for (let i = 0; i < 8; i++) result[i] = this.loadout[i] ?? null
    return result
  }

  isEquipped(weaponType: WeaponType): boolean {
    return this.loadout.some(w => w === weaponType)
  }

  private persist(): void {
    this.scene.registry.set(REGISTRY_KEY, [...this.loadout])
  }
}
