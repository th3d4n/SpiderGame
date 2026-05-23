import { MaterialType } from '../systems/CraftingSystem'
import { ConsumableType } from '../systems/ConsumableSystem'

export interface ChestLoot {
  material?:   MaterialType
  consumable?: ConsumableType
  qty:         number
}

interface MaterialEntry {
  material: MaterialType
  qty:      number
  weight:   number
}

interface ConsumableEntry {
  consumable: ConsumableType
  weight:     number
}

const MATERIAL_POOL: MaterialEntry[] = [
  { material: MaterialType.Stone,       qty: 3, weight: 30 },
  { material: MaterialType.Wood,        qty: 2, weight: 25 },
  { material: MaterialType.BugPartsAnt, qty: 2, weight: 20 },
  { material: MaterialType.DriedFungus, qty: 1, weight: 10 },
  { material: MaterialType.SilkThread,  qty: 2, weight: 25 },
  { material: MaterialType.ChitinShard, qty: 2, weight: 20 },
  { material: MaterialType.WebFluid,    qty: 2, weight: 15 },
  { material: MaterialType.VenomGland,  qty: 1, weight: 8  },
]

// Consumable pool — one optional consumable per chest, weighted by rarity.
const CONSUMABLE_POOL: ConsumableEntry[] = [
  { consumable: ConsumableType.HpPotion,        weight: 40 },
  { consumable: ConsumableType.StaminaTonicI,   weight: 25 },
  { consumable: ConsumableType.StaminaTonicII,  weight: 12 },
  { consumable: ConsumableType.StaminaTonicIII, weight: 5  },
  { consumable: ConsumableType.MaxPotion,       weight: 3  },
]

const MAT_TOTAL = MATERIAL_POOL.reduce((s, e) => s + e.weight, 0)
const CON_TOTAL = CONSUMABLE_POOL.reduce((s, e) => s + e.weight, 0)

function pickMaterial(): MaterialEntry {
  let roll = Math.random() * MAT_TOTAL
  for (const e of MATERIAL_POOL) {
    roll -= e.weight
    if (roll <= 0) return e
  }
  return MATERIAL_POOL[MATERIAL_POOL.length - 1]
}

function pickConsumable(): ConsumableType {
  let roll = Math.random() * CON_TOTAL
  for (const e of CONSUMABLE_POOL) {
    roll -= e.weight
    if (roll <= 0) return e.consumable
  }
  return CONSUMABLE_POOL[CONSUMABLE_POOL.length - 1].consumable
}

/**
 * Roll a chest's full loot: `materialCount` unique material drops plus a 30%
 * chance of one consumable drop.
 */
export function rollChestLoot(materialCount = 3): ChestLoot[] {
  const seen = new Set<MaterialType>()
  const result: ChestLoot[] = []
  let tries = 0

  while (result.length < materialCount && tries < materialCount * 4) {
    const entry = pickMaterial()
    tries++
    if (!seen.has(entry.material)) {
      seen.add(entry.material)
      result.push({ material: entry.material, qty: entry.qty })
    }
  }

  // 30% chance of a bonus consumable
  if (Math.random() < 0.3) {
    result.push({ consumable: pickConsumable(), qty: 1 })
  }

  return result
}
