export interface ColonyStateConfig {
  state: number
  lights: boolean
  npcCount: number
  websRepaired: boolean
  fireLit: boolean
  decorations: boolean
  musicChange: boolean
}

const COLONY_STATES: ColonyStateConfig[] = [
  { state: 0, lights: false, npcCount: 0,  websRepaired: false, fireLit: false, decorations: false, musicChange: false },
  { state: 1, lights: true,  npcCount: 2,  websRepaired: true,  fireLit: true,  decorations: false, musicChange: false },
  { state: 2, lights: true,  npcCount: 5,  websRepaired: true,  fireLit: true,  decorations: false, musicChange: false },
  { state: 3, lights: true,  npcCount: 8,  websRepaired: true,  fireLit: true,  decorations: false, musicChange: true  },
  { state: 4, lights: true,  npcCount: 12, websRepaired: true,  fireLit: true,  decorations: true,  musicChange: true  },
  { state: 5, lights: true,  npcCount: 20, websRepaired: true,  fireLit: true,  decorations: true,  musicChange: true  },
]

const BOSS_ORDER = ['Roller', 'Hive', 'Misfit', 'DrSift', 'Talon']

export class ColonyRestorationSystem {
  getColonyState(bossesDefeated: string[]): number {
    let count = 0
    for (const boss of BOSS_ORDER) {
      if (bossesDefeated.includes(boss)) count++
    }
    return Math.min(count, 5)
  }

  getStateConfig(state: number): ColonyStateConfig {
    return COLONY_STATES[Math.max(0, Math.min(state, 5))]
  }
}
