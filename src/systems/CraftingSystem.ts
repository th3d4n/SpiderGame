import { WeaponType } from './WeaponSystem'

export const MaterialType = {
  SilkThread:   'SilkThread',
  ChitinShard:  'ChitinShard',
  VenomGland:   'VenomGland',
  WebFluid:     'WebFluid',
  CrystalDust:  'CrystalDust',
  BoneFragment: 'BoneFragment',
  Thistle:      'Thistle',     // bow ammunition — fired by Web Bow, recoverable on miss/kill
} as const
export type MaterialType = (typeof MaterialType)[keyof typeof MaterialType]

export const RecipeType = {
  Sword:         'Sword',
  Bow:           'Bow',
  Axe:           'Axe',
  BoxingGloves:  'BoxingGloves',
  Glider:        'Glider',
  FlameBreather: 'FlameBreather',
} as const
export type RecipeType = (typeof RecipeType)[keyof typeof RecipeType]

export interface Recipe {
  id:           RecipeType
  displayName:  string
  materials:    Partial<Record<MaterialType, number>>
  requiredTier: number
  produces:     WeaponType
}

export const RECIPES: Recipe[] = [
  {
    id:          RecipeType.Sword,
    displayName: 'Silk Sword',
    materials:   { [MaterialType.SilkThread]: 3, [MaterialType.ChitinShard]: 2 },
    requiredTier: 0,
    produces:    WeaponType.Sword,
  },
  {
    id:          RecipeType.Bow,
    displayName: 'Web Bow',
    materials:   { [MaterialType.SilkThread]: 4, [MaterialType.WebFluid]: 2 },
    requiredTier: 0,
    produces:    WeaponType.Bow,
  },
  {
    id:          RecipeType.Axe,
    displayName: 'Chitin Axe',
    materials:   { [MaterialType.ChitinShard]: 4, [MaterialType.BoneFragment]: 2 },
    requiredTier: 1,
    produces:    WeaponType.Axe,
  },
  {
    id:          RecipeType.BoxingGloves,
    displayName: 'Boxing Gloves',
    materials:   { [MaterialType.SilkThread]: 2, [MaterialType.WebFluid]: 3 },
    requiredTier: 1,
    produces:    WeaponType.BoxingGloves,
  },
  {
    id:          RecipeType.Glider,
    displayName: 'Web Glider',
    materials:   { [MaterialType.SilkThread]: 5, [MaterialType.WebFluid]: 4, [MaterialType.CrystalDust]: 1 },
    requiredTier: 2,
    produces:    WeaponType.Glider,
  },
  {
    id:          RecipeType.FlameBreather,
    displayName: 'Flame Breather',
    materials:   { [MaterialType.VenomGland]: 3, [MaterialType.CrystalDust]: 2, [MaterialType.ChitinShard]: 2 },
    requiredTier: 2,
    produces:    WeaponType.FlameBreather,
  },
]

export class CraftingSystem {
  private inventory: Map<MaterialType, number> = new Map()

  getAmount(mat: MaterialType): number {
    return this.inventory.get(mat) ?? 0
  }

  addMaterial(mat: MaterialType, amount: number): void {
    this.inventory.set(mat, this.getAmount(mat) + amount)
  }

  canCraft(recipe: Recipe, legTier: number): boolean {
    if (legTier < recipe.requiredTier) return false
    for (const mat of Object.keys(recipe.materials) as MaterialType[]) {
      const needed = recipe.materials[mat] ?? 0
      if (this.getAmount(mat) < needed) return false
    }
    return true
  }

  craft(recipe: Recipe, legTier: number): boolean {
    if (!this.canCraft(recipe, legTier)) return false
    for (const mat of Object.keys(recipe.materials) as MaterialType[]) {
      const needed = recipe.materials[mat] ?? 0
      this.inventory.set(mat, this.getAmount(mat) - needed)
    }
    return true
  }

  getInventorySnapshot(): Record<MaterialType, number> {
    const snap = {} as Record<MaterialType, number>
    for (const mat of Object.values(MaterialType)) {
      snap[mat] = this.getAmount(mat)
    }
    return snap
  }

  restoreFromSnapshot(snap: Record<string, number>): void {
    this.inventory.clear()
    for (const [mat, amt] of Object.entries(snap)) {
      this.inventory.set(mat as MaterialType, amt)
    }
  }
}
