// Round 10 — Comprehensive sound design via Howler.js.
//
// Centralised audio bus.  Every game event resolves through `audio.play(key)`
// or `audio.playLoop(key)`.  Sounds are lazily loaded on first play and gently
// fail when files are missing (e.g. Tier 1/2/3 asset acquisition pending) so
// the game still runs silent without console-spam.
//
// 3D spatial audio uses Howler's stereo pan + falloff model.  The listener
// position follows the player; per-call worldX/worldZ positions sounds in 3D.
//
// Files live under `/public/audio/<key>.webm` (preferred) and `<key>.mp3`
// (fallback).  Howler auto-picks the best supported codec.

import { Howl, Howler } from 'howler'

export type SoundKey =
  // Player
  | 'footstep_dirt' | 'footstep_stone'
  | 'web_swing' | 'webbs_damage' | 'webbs_death' | 'webbs_dodge'
  | 'heartbeat_low_hp' | 'half_hp_pain'
  // Weapons
  | 'sword_swing' | 'sword_hit_enemy' | 'sword_hit_ground'
  | 'axe_swing' | 'axe_hit_enemy' | 'axe_hit_ground'
  | 'toothpick_stab' | 'toothpick_hit'
  | 'bow_draw' | 'bow_release' | 'bow_hit_enemy' | 'bow_hit_wall'
  | 'flame_loop' | 'flame_hit'
  | 'web_fire' | 'web_attach_wall' | 'web_attach_enemy' | 'web_pull_loop'
  // Enemies — Centipede
  | 'centipede_idle' | 'centipede_burst' | 'centipede_skitter' | 'centipede_attack'
  | 'centipede_hit' | 'centipede_death_generic'
  | 'centipede_death_sword' | 'centipede_death_axe'
  | 'centipede_death_stab' | 'centipede_death_bow' | 'centipede_death_flame'
  // Enemies — Beetle
  | 'beetle_walk' | 'beetle_charge_windup' | 'beetle_charging' | 'beetle_charge_crash'
  | 'beetle_hit' | 'beetle_death_generic'
  | 'beetle_death_sword' | 'beetle_death_axe'
  | 'beetle_death_stab' | 'beetle_death_flame'
  // Boss
  | 'boss_idle' | 'boss_suction' | 'boss_charge' | 'boss_hit'
  | 'boss_phase_change' | 'boss_death'
  // Ambience (looping)
  | 'amb_homebase' | 'amb_colony_entry' | 'amb_colony_mid' | 'amb_colony_deep' | 'amb_boss'
  // UI
  | 'ui_hover' | 'ui_click' | 'ui_back'
  | 'ui_title_new_game' | 'ui_title_continue'
  | 'ui_text_advance'
  | 'celeb_swell' | 'celeb_burst' | 'celeb_tutorial'
  | 'pickup_notify'
  | 'xp_gain_small' | 'xp_gain_combo'
  | 'stamina_winded' | 'energy_depleted'
  | 'workbench_open' | 'crafting_complete'
  | 'web_launcher_equipped'

interface SoundConfig {
  src:        string[]
  volume?:    number
  loop?:      boolean
  rate?:      number
  rateRandom?: [number, number]
  pool?:      number
}

const SOUND_REGISTRY: Record<SoundKey, SoundConfig> = {
  // ── Player ──────────────────────────────────────────────────────────────
  footstep_dirt:    { src: ['/audio/footstep_dirt.webm',   '/audio/footstep_dirt.mp3'],   volume: 0.35, rateRandom: [0.9, 1.1], pool: 8 },
  footstep_stone:   { src: ['/audio/footstep_stone.webm',  '/audio/footstep_stone.mp3'],  volume: 0.35, rateRandom: [0.9, 1.1], pool: 8 },
  web_swing:        { src: ['/audio/web_swing.webm',       '/audio/web_swing.mp3'],       volume: 0.5 },
  webbs_damage:     { src: ['/audio/webbs_damage.webm',    '/audio/webbs_damage.mp3'],    volume: 0.7, rateRandom: [0.92, 1.08] },
  webbs_death:      { src: ['/audio/webbs_death.webm',     '/audio/webbs_death.mp3'],     volume: 0.9 },
  webbs_dodge:      { src: ['/audio/webbs_dodge.webm',     '/audio/webbs_dodge.mp3'],     volume: 0.55 },
  heartbeat_low_hp: { src: ['/audio/heartbeat.webm',       '/audio/heartbeat.mp3'],       volume: 0.45, loop: true },
  half_hp_pain:     { src: ['/audio/half_hp_pain.webm',    '/audio/half_hp_pain.mp3'],    volume: 0.8 },

  // ── Weapons ─────────────────────────────────────────────────────────────
  sword_swing:      { src: ['/audio/sword_swing.webm',     '/audio/sword_swing.mp3'],     volume: 0.6,  rateRandom: [0.95, 1.05] },
  sword_hit_enemy:  { src: ['/audio/sword_hit_enemy.webm', '/audio/sword_hit_enemy.mp3'], volume: 0.7,  rateRandom: [0.92, 1.08] },
  sword_hit_ground: { src: ['/audio/sword_hit_ground.webm','/audio/sword_hit_ground.mp3'],volume: 0.6 },
  axe_swing:        { src: ['/audio/axe_swing.webm',       '/audio/axe_swing.mp3'],       volume: 0.7,  rateRandom: [0.92, 1.05] },
  axe_hit_enemy:    { src: ['/audio/axe_hit_enemy.webm',   '/audio/axe_hit_enemy.mp3'],   volume: 0.85, rateRandom: [0.9, 1.05] },
  axe_hit_ground:   { src: ['/audio/axe_hit_ground.webm',  '/audio/axe_hit_ground.mp3'],  volume: 0.8 },
  toothpick_stab:   { src: ['/audio/toothpick_stab.webm',  '/audio/toothpick_stab.mp3'],  volume: 0.5,  rateRandom: [0.95, 1.1] },
  toothpick_hit:    { src: ['/audio/toothpick_hit.webm',   '/audio/toothpick_hit.mp3'],   volume: 0.55, rateRandom: [0.92, 1.08] },
  bow_draw:         { src: ['/audio/bow_draw.webm',        '/audio/bow_draw.mp3'],        volume: 0.5 },
  bow_release:      { src: ['/audio/bow_release.webm',     '/audio/bow_release.mp3'],     volume: 0.6 },
  bow_hit_enemy:    { src: ['/audio/bow_hit_enemy.webm',   '/audio/bow_hit_enemy.mp3'],   volume: 0.65, rateRandom: [0.95, 1.05] },
  bow_hit_wall:     { src: ['/audio/bow_hit_wall.webm',    '/audio/bow_hit_wall.mp3'],    volume: 0.55 },
  flame_loop:       { src: ['/audio/flame_loop.webm',      '/audio/flame_loop.mp3'],      volume: 0.55, loop: true },
  flame_hit:        { src: ['/audio/flame_hit.webm',       '/audio/flame_hit.mp3'],       volume: 0.6 },
  web_fire:         { src: ['/audio/web_fire.webm',        '/audio/web_fire.mp3'],        volume: 0.5 },
  web_attach_wall:  { src: ['/audio/web_attach_wall.webm', '/audio/web_attach_wall.mp3'], volume: 0.6 },
  web_attach_enemy: { src: ['/audio/web_attach_enemy.webm','/audio/web_attach_enemy.mp3'],volume: 0.6 },
  web_pull_loop:    { src: ['/audio/web_pull_loop.webm',   '/audio/web_pull_loop.mp3'],   volume: 0.4, loop: true },

  // ── Centipede ───────────────────────────────────────────────────────────
  centipede_idle:           { src: ['/audio/centipede_idle.webm',           '/audio/centipede_idle.mp3'],           volume: 0.3, loop: true },
  centipede_burst:          { src: ['/audio/centipede_burst.webm',          '/audio/centipede_burst.mp3'],          volume: 0.65 },
  centipede_skitter:        { src: ['/audio/centipede_skitter.webm',        '/audio/centipede_skitter.mp3'],        volume: 0.4, loop: true },
  centipede_attack:         { src: ['/audio/centipede_attack.webm',         '/audio/centipede_attack.mp3'],         volume: 0.55 },
  centipede_hit:            { src: ['/audio/centipede_hit.webm',            '/audio/centipede_hit.mp3'],            volume: 0.4, rateRandom: [0.9, 1.1] },
  centipede_death_generic:  { src: ['/audio/centipede_death.webm',          '/audio/centipede_death.mp3'],          volume: 0.55 },
  centipede_death_sword:    { src: ['/audio/centipede_death_sword.webm',    '/audio/centipede_death_sword.mp3'],    volume: 0.6 },
  centipede_death_axe:      { src: ['/audio/centipede_death_axe.webm',      '/audio/centipede_death_axe.mp3'],      volume: 0.75 },
  centipede_death_stab:     { src: ['/audio/centipede_death_stab.webm',     '/audio/centipede_death_stab.mp3'],     volume: 0.55 },
  centipede_death_bow:      { src: ['/audio/centipede_death_bow.webm',      '/audio/centipede_death_bow.mp3'],      volume: 0.55 },
  centipede_death_flame:    { src: ['/audio/centipede_death_flame.webm',    '/audio/centipede_death_flame.mp3'],    volume: 0.6 },

  // ── Beetle ──────────────────────────────────────────────────────────────
  beetle_walk:           { src: ['/audio/beetle_walk.webm',           '/audio/beetle_walk.mp3'],           volume: 0.4, loop: true },
  beetle_charge_windup:  { src: ['/audio/beetle_charge_windup.webm',  '/audio/beetle_charge_windup.mp3'],  volume: 0.55 },
  beetle_charging:       { src: ['/audio/beetle_charging.webm',       '/audio/beetle_charging.mp3'],       volume: 0.6, loop: true },
  beetle_charge_crash:   { src: ['/audio/beetle_charge_crash.webm',   '/audio/beetle_charge_crash.mp3'],   volume: 0.7 },
  beetle_hit:            { src: ['/audio/beetle_hit.webm',            '/audio/beetle_hit.mp3'],            volume: 0.45, rateRandom: [0.9, 1.1] },
  beetle_death_generic:  { src: ['/audio/beetle_death.webm',          '/audio/beetle_death.mp3'],          volume: 0.65 },
  beetle_death_sword:    { src: ['/audio/beetle_death_sword.webm',    '/audio/beetle_death_sword.mp3'],    volume: 0.7 },
  beetle_death_axe:      { src: ['/audio/beetle_death_axe.webm',      '/audio/beetle_death_axe.mp3'],      volume: 0.85 },
  beetle_death_stab:     { src: ['/audio/beetle_death_stab.webm',     '/audio/beetle_death_stab.mp3'],     volume: 0.6 },
  beetle_death_flame:    { src: ['/audio/beetle_death_flame.webm',    '/audio/beetle_death_flame.mp3'],    volume: 0.7 },

  // ── Boss ────────────────────────────────────────────────────────────────
  boss_idle:         { src: ['/audio/boss_idle.webm',         '/audio/boss_idle.mp3'],         volume: 0.5, loop: true },
  boss_suction:      { src: ['/audio/boss_suction.webm',      '/audio/boss_suction.mp3'],      volume: 0.7, loop: true },
  boss_charge:       { src: ['/audio/boss_charge.webm',       '/audio/boss_charge.mp3'],       volume: 0.75 },
  boss_hit:          { src: ['/audio/boss_hit.webm',          '/audio/boss_hit.mp3'],          volume: 0.7 },
  boss_phase_change: { src: ['/audio/boss_phase_change.webm', '/audio/boss_phase_change.mp3'], volume: 0.85 },
  boss_death:        { src: ['/audio/boss_death.webm',        '/audio/boss_death.mp3'],        volume: 0.95 },

  // ── Ambience ────────────────────────────────────────────────────────────
  amb_homebase:      { src: ['/audio/amb_homebase.webm',      '/audio/amb_homebase.mp3'],      volume: 0.35, loop: true },
  amb_colony_entry:  { src: ['/audio/amb_colony_entry.webm',  '/audio/amb_colony_entry.mp3'],  volume: 0.4,  loop: true },
  amb_colony_mid:    { src: ['/audio/amb_colony_mid.webm',    '/audio/amb_colony_mid.mp3'],    volume: 0.4,  loop: true },
  amb_colony_deep:   { src: ['/audio/amb_colony_deep.webm',   '/audio/amb_colony_deep.mp3'],   volume: 0.45, loop: true },
  amb_boss:          { src: ['/audio/amb_boss.webm',          '/audio/amb_boss.mp3'],          volume: 0.5,  loop: true },

  // ── UI ──────────────────────────────────────────────────────────────────
  ui_hover:           { src: ['/audio/ui_hover.webm',          '/audio/ui_hover.mp3'],          volume: 0.3 },
  ui_click:           { src: ['/audio/ui_click.webm',          '/audio/ui_click.mp3'],          volume: 0.45 },
  ui_back:            { src: ['/audio/ui_back.webm',           '/audio/ui_back.mp3'],           volume: 0.4 },
  ui_title_new_game:  { src: ['/audio/ui_title_new_game.webm', '/audio/ui_title_new_game.mp3'], volume: 0.6 },
  ui_title_continue:  { src: ['/audio/ui_title_continue.webm', '/audio/ui_title_continue.mp3'], volume: 0.55 },
  ui_text_advance:    { src: ['/audio/ui_text_advance.webm',   '/audio/ui_text_advance.mp3'],   volume: 0.3 },
  celeb_swell:        { src: ['/audio/celeb_swell.webm',       '/audio/celeb_swell.mp3'],       volume: 0.65 },
  celeb_burst:        { src: ['/audio/celeb_burst.webm',       '/audio/celeb_burst.mp3'],       volume: 0.75 },
  celeb_tutorial:     { src: ['/audio/celeb_tutorial.webm',    '/audio/celeb_tutorial.mp3'],    volume: 0.45 },
  pickup_notify:      { src: ['/audio/pickup_notify.webm',     '/audio/pickup_notify.mp3'],     volume: 0.5 },
  xp_gain_small:      { src: ['/audio/xp_gain_small.webm',     '/audio/xp_gain_small.mp3'],     volume: 0.4 },
  xp_gain_combo:      { src: ['/audio/xp_gain_combo.webm',     '/audio/xp_gain_combo.mp3'],     volume: 0.55 },
  stamina_winded:     { src: ['/audio/stamina_winded.webm',    '/audio/stamina_winded.mp3'],    volume: 0.5 },
  energy_depleted:    { src: ['/audio/energy_depleted.webm',   '/audio/energy_depleted.mp3'],   volume: 0.5 },
  workbench_open:     { src: ['/audio/workbench_open.webm',    '/audio/workbench_open.mp3'],    volume: 0.55 },
  crafting_complete:  { src: ['/audio/crafting_complete.webm', '/audio/crafting_complete.mp3'], volume: 0.6 },
  web_launcher_equipped: { src: ['/audio/web_launcher_equipped.webm', '/audio/web_launcher_equipped.mp3'], volume: 0.55 },
}

// Sentinel sound id returned when audio is muted / file missing — safe to
// pass back to stop() / pos() etc. (Howler treats unknown ids as no-ops).
const NULL_SOUND_ID = -1

export class AudioManager {
  private sounds      = new Map<SoundKey, Howl>()
  private failedKeys  = new Set<SoundKey>()
  private activeLoops = new Map<SoundKey, number>()
  private masterVolume = 1.0
  private muted        = false

  private getOrCreate(key: SoundKey): Howl | null {
    if (this.failedKeys.has(key)) return null
    const existing = this.sounds.get(key)
    if (existing) return existing

    const cfg = SOUND_REGISTRY[key]
    const h = new Howl({
      src:    cfg.src,
      volume: (cfg.volume ?? 0.7) * this.masterVolume,
      loop:   cfg.loop ?? false,
      rate:   cfg.rate  ?? 1.0,
      pool:   cfg.pool  ?? 4,
      // Load error = permanent failure (file missing/corrupt). Play error is
      // transient — most commonly the browser autoplay policy blocking audio
      // before the first user gesture. Don't blacklist on play error; the next
      // playLoop/play call after user interaction will succeed.
      onloaderror: () => { this.failedKeys.add(key); this.sounds.delete(key) },
      onplayerror: () => { /* transient — do not add to failedKeys */ },
    })
    this.sounds.set(key, h)
    return h
  }

  // One-shot SFX, optionally positioned in 3D world space.
  play(key: SoundKey, worldX?: number, worldZ?: number): number {
    if (this.muted) return NULL_SOUND_ID
    const h = this.getOrCreate(key)
    if (!h) return NULL_SOUND_ID
    const id = h.play()

    const cfg = SOUND_REGISTRY[key]
    if (cfg.rateRandom) {
      const [min, max] = cfg.rateRandom
      h.rate(min + Math.random() * (max - min), id)
    }
    if (worldX !== undefined && worldZ !== undefined) {
      h.pos(worldX, 0, worldZ, id)
    }
    return id
  }

  // Start a looping sound (idempotent — repeated calls return the same id).
  playLoop(key: SoundKey, worldX?: number, worldZ?: number): number {
    if (this.muted) return NULL_SOUND_ID
    const existing = this.activeLoops.get(key)
    if (existing !== undefined) {
      const h = this.sounds.get(key)
      // If the ID is stale (e.g. the initial play was blocked by browser autoplay
      // policy before the first user gesture), clear it and fall through to retry.
      if (h && h.playing(existing)) {
        if (worldX !== undefined && worldZ !== undefined) {
          h.pos(worldX, 0, worldZ, existing)
        }
        return existing
      }
      // Stale entry — sound is not actually playing.
      this.activeLoops.delete(key)
    }
    const h = this.getOrCreate(key)
    if (!h) return NULL_SOUND_ID
    const id = h.play()
    if (worldX !== undefined && worldZ !== undefined) {
      h.pos(worldX, 0, worldZ, id)
    }
    this.activeLoops.set(key, id)
    return id
  }

  stopLoop(key: SoundKey): void {
    const id = this.activeLoops.get(key)
    if (id === undefined) return
    this.sounds.get(key)?.stop(id)
    this.activeLoops.delete(key)
  }

  // Re-position a running loop (for moving enemies).
  updateLoopPosition(key: SoundKey, worldX: number, worldZ: number): void {
    const id = this.activeLoops.get(key)
    if (id === undefined) return
    this.sounds.get(key)?.pos(worldX, 0, worldZ, id)
  }

  // Move the global listener — call every frame with Webbs' world position.
  setListenerPosition(worldX: number, worldZ: number): void {
    Howler.pos(worldX, 0, worldZ)
  }

  setMasterVolume(v: number): void {
    this.masterVolume = Math.max(0, Math.min(1, v))
    Howler.volume(this.masterVolume)
  }

  mute(): void   { this.muted = true;  Howler.mute(true) }
  unmute(): void { this.muted = false; Howler.mute(false) }
  isMuted(): boolean { return this.muted }

  // Stop every active loop — call on scene teardown to keep ambient sounds
  // from carrying across into the next zone.
  stopAllLoops(): void {
    for (const key of Array.from(this.activeLoops.keys())) this.stopLoop(key)
  }
}

export const audio = new AudioManager()
