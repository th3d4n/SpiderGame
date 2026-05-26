// Round 8 Issue 8 — XP tracker.
// Awards XP for pickups, crafts, kills, and boss kills.  Combo bonus stacks
// for kills within COMBO_WINDOW_S of each other.

export type XPSource =
  | 'pickup' | 'rare_pickup'
  | 'craft'  | 'rare_craft'
  | 'kill'   | 'boss_kill'

const XP_VALUES: Record<XPSource, number> = {
  pickup:      2,
  rare_pickup: 10,
  craft:       5,
  rare_craft:  20,
  kill:        8,
  boss_kill:   200,
}

const COMBO_WINDOW_S       = 4.0
const COMBO_BONUS_PER_KILL = 5

export class XPSystem {
  total = 0
  private recentKillTimes: number[] = []

  // UI hook — flash the counter when XP is awarded
  onGain: ((amount: number, source: XPSource) => void) | null = null

  award(source: XPSource, amountOverride?: number): void {
    let xp = amountOverride ?? XP_VALUES[source]

    // Combo bonus for kills
    if (source === 'kill' || source === 'boss_kill') {
      const now = performance.now() / 1000
      this.recentKillTimes = this.recentKillTimes.filter(t => now - t < COMBO_WINDOW_S)
      const comboCount = this.recentKillTimes.length
      if (comboCount > 0) xp += COMBO_BONUS_PER_KILL * comboCount
      this.recentKillTimes.push(now)
    }

    this.total += xp
    this.onGain?.(xp, source)
  }

  reset(): void {
    this.total = 0
    this.recentKillTimes = []
  }
}
