// ─── Audio engine ─────────────────────────────────────────────────────────────
// A small Web Audio engine (replaces Howler).  Every game event still resolves
// through `audio.play(key)` / `audio.playLoop(key)`, but now:
//
//  • Everything decodes up front, after boot — no first-hit decode lag.
//  • Each buffer is analysed once: leading silence is trimmed (some source files
//    started 0.1–0.6 s late) and loudness is normalised, so the `volume` numbers
//    below are a real mix (1.0 ≈ -20 dBFS RMS), not compensation for wild files.
//  • Positional sounds pan by where they are ON SCREEN (camera right vector) and
//    fall off in units of creature scale, so the den (scale 2.4) and colony (1.0)
//    sound the same size.  Distance also darkens the sound (low-pass).
//  • Loops can belong to an owner (one skitter per centipede, not one shared).
//  • Buses: world (sfx + ambience, through a menu "muffle" filter), UI (dry),
//    a per-zone cave reverb send, and a master limiter so stacked hits can't clip.
//  • A tiny synth layers weight under impacts (sub thump, weak-point ting).
//  • Multi-take sounds: one file packs several takes (tools/audio/build_sprites.py
//    writes the split points to audioSprites.ts); each play picks a random take,
//    never the same one twice running, and every take is normalised on its own.
//  • Ambient one-shots (cave drips…) scatter around the listener per zone.
//
// Files live under `/public/audio/<file>.webm` (Opus) with `.mp3` fallback.

import { AUDIO_SPRITES, AUDIO_HASH } from './audioSprites'

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
  | 'centipede_burst' | 'centipede_skitter' | 'centipede_attack'
  | 'centipede_hit' | 'centipede_death_generic'
  | 'centipede_death_sword' | 'centipede_death_axe'
  | 'centipede_death_stab' | 'centipede_death_bow' | 'centipede_death_flame'
  // Enemies — Beetle
  | 'beetle_walk' | 'beetle_charge_windup' | 'beetle_charging' | 'beetle_charge_crash'
  | 'beetle_hit' | 'beetle_death_generic'
  | 'beetle_death_sword' | 'beetle_death_axe'
  | 'beetle_death_stab' | 'beetle_death_flame'
  // Enemies — small fry (ants, jumping spiders) reuse pitched sources
  | 'small_death' | 'spider_coil' | 'spider_leap' | 'spider_land' | 'ant_bite' | 'ant_hiss'
  | 'chitin_crack' | 'sac_burst'
  // Colony traps, cave, Crossroads locks
  | 'trap_click' | 'trap_spike' | 'rubble_fall' | 'rock_smack' | 'cave_drip'
  | 'lock_click' | 'lock_open' | 'gate_creak' | 'chain_snap' | 'wax_crumble'
  // Boss
  | 'boss_idle' | 'boss_suction' | 'boss_windup' | 'boss_hit'
  | 'boss_phase_change' | 'boss_death'
  | 'boss_snort' | 'boss_sniff' | 'boss_growl' | 'tongue_lash' | 'tongue_slap'
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
  | 'workbench_open' | 'crafting_complete' | 'potion_drink'
  | 'web_launcher_equipped'

type Bus = 'sfx' | 'amb' | 'ui'

interface SoundConfig {
  file:        string             // basename under /audio
  volume:      number             // mix level on the normalised buffer
  bus?:        Bus                // default sfx
  loop?:       boolean
  rate?:       number             // fixed playback rate (pitch); 2^(st/12)
  rateRandom?: [number, number]   // multiplies `rate`
  maxVoices?:  number             // concurrent voices of this key (default 4)
  minGap?:     number             // s — ignore retriggers closer than this (default 0.03)
  maxLen?:     number             // s — one-shots fade out here (long-tailed sources)
  lowpass?:    number             // Hz — tone shaping
  reverb?:     number             // send level (default: 1 for sfx, 0 otherwise)
  trimDb?:     number             // leading-silence threshold vs peak (default -30; noisy sources need higher)
  maxLoop?:    number             // s — crop long loops (crossfaded seam) to save decoded memory
}

const ST = (semitones: number) => 2 ** (semitones / 12)

// Volumes are a mix, relative to a normalised -20 dBFS RMS buffer.
const SOUND_REGISTRY: Record<SoundKey, SoundConfig> = {
  // ── Player ──────────────────────────────────────────────────────────────
  // Multi-take files (10 dirt steps, 5 stone): light, quick feet
  footstep_dirt:    { file: 'footstep_dirt',  volume: 0.17, rateRandom: [0.9, 1.15], maxVoices: 6, minGap: 0.05, maxLen: 0.22, lowpass: 6000, reverb: 0.4 },
  footstep_stone:   { file: 'footstep_stone', volume: 0.16, rateRandom: [0.95, 1.25], maxVoices: 6, minGap: 0.05, reverb: 0.5 },
  web_swing:        { file: 'web_swing',      volume: 0.45, rateRandom: [0.95, 1.08] },
  webbs_damage:     { file: 'webbs_damage',   volume: 0.80, rateRandom: [0.92, 1.08] },
  webbs_death:      { file: 'webbs_death',    volume: 0.90 },
  webbs_dodge:      { file: 'webbs_dodge',    volume: 0.45, maxLen: 0.45, rateRandom: [0.95, 1.1] },
  heartbeat_low_hp: { file: 'heartbeat',      volume: 0.45, loop: true, reverb: 0, lowpass: 900 },
  half_hp_pain:     { file: 'half_hp_pain',   volume: 0.65, maxLen: 1.6 },

  // ── Weapons ─────────────────────────────────────────────────────────────
  sword_swing:      { file: 'sword_swing',      volume: 0.50, rateRandom: [0.95, 1.05] },
  sword_hit_enemy:  { file: 'sword_hit_enemy',  volume: 0.95, rateRandom: [0.92, 1.08], maxLen: 0.7 },
  sword_hit_ground: { file: 'sword_hit_ground', volume: 0.40, maxLen: 0.6 },
  // The 6 sword swings pitched down read as a heavier blade (was a single axe whoosh)
  axe_swing:        { file: 'sword_swing',      volume: 0.62, rate: ST(-4), rateRandom: [0.92, 1.05] },
  axe_hit_enemy:    { file: 'axe_hit_enemy',    volume: 1.00, rateRandom: [0.9, 1.05], maxLen: 0.8 },
  axe_hit_ground:   { file: 'axe_hit_ground',   volume: 0.45, maxLen: 0.6 },
  toothpick_stab:   { file: 'toothpick_stab',   volume: 0.45, rateRandom: [0.95, 1.1] },
  toothpick_hit:    { file: 'toothpick_hit',    volume: 0.85, rateRandom: [0.92, 1.08] },
  // Placeholder (string flutter) — darkened and slowed so it reads as a creak
  bow_draw:         { file: 'bow_draw',         volume: 0.30, rate: ST(-4), lowpass: 2400 },
  bow_release:      { file: 'bow_release',      volume: 0.55, rateRandom: [0.95, 1.08], maxLen: 0.7 },
  bow_hit_enemy:    { file: 'bow_hit_enemy',    volume: 0.70, rateRandom: [0.95, 1.05] },
  bow_hit_wall:     { file: 'bow_hit_wall',     volume: 0.50, rateRandom: [1.0, 1.3] },
  flame_loop:       { file: 'flame_loop',       volume: 0.55, loop: true, maxLoop: 10 },
  flame_hit:        { file: 'flame_hit',        volume: 0.45, maxLen: 0.45, minGap: 0.3, maxVoices: 2 },
  // The source asked for −3…−5 st; done here
  web_fire:         { file: 'web_fire',         volume: 0.55, rate: ST(-3), rateRandom: [0.95, 1.08], maxLen: 0.5 },
  web_attach_wall:  { file: 'web_attach_wall',  volume: 0.50, rateRandom: [0.95, 1.15] },
  web_attach_enemy: { file: 'web_attach_enemy', volume: 0.58, rateRandom: [0.9, 1.05], maxLen: 0.5 },
  web_pull_loop:    { file: 'web_pull_loop',    volume: 0.40, loop: true },

  // ── Centipede ───────────────────────────────────────────────────────────
  centipede_burst:          { file: 'centipede_burst',   volume: 0.70 },
  centipede_skitter:        { file: 'centipede_skitter', volume: 0.35, loop: true },
  centipede_attack:         { file: 'centipede_attack',  volume: 0.65 },
  centipede_hit:            { file: 'centipede_hit',     volume: 0.50, rateRandom: [0.9, 1.1] },
  // One source for every death — each weapon gets its own pitch/tone
  centipede_death_generic:  { file: 'centipede_death', volume: 0.70 },
  centipede_death_sword:    { file: 'centipede_death', volume: 0.75 },
  centipede_death_axe:      { file: 'centipede_death', volume: 0.85, rate: ST(-3), lowpass: 2200 },
  centipede_death_stab:     { file: 'centipede_death', volume: 0.65, rate: ST(2) },
  centipede_death_bow:      { file: 'centipede_death', volume: 0.65, rate: ST(1), maxLen: 0.6 },
  centipede_death_flame:    { file: 'centipede_death', volume: 0.70, rate: ST(-2), lowpass: 1500 },

  // ── Beetle ──────────────────────────────────────────────────────────────
  beetle_walk:           { file: 'beetle_walk',          volume: 0.35, loop: true },
  beetle_charge_windup:  { file: 'beetle_charge_windup', volume: 0.70 },
  beetle_charging:       { file: 'beetle_charging',      volume: 0.60, loop: true },
  beetle_charge_crash:   { file: 'beetle_charge_crash',  volume: 0.85 },
  beetle_hit:            { file: 'beetle_hit',           volume: 0.55, rateRandom: [0.9, 1.1] },
  beetle_death_generic:  { file: 'beetle_death', volume: 0.80 },
  beetle_death_sword:    { file: 'beetle_death', volume: 0.80 },
  beetle_death_axe:      { file: 'beetle_death', volume: 0.90, rate: ST(-3), lowpass: 2000 },
  beetle_death_stab:     { file: 'beetle_death', volume: 0.75, rate: ST(2) },
  beetle_death_flame:    { file: 'beetle_death', volume: 0.80, rate: ST(-2), lowpass: 1400 },

  // ── Small fry ───────────────────────────────────────────────────────────
  // Shell crunch + wet squish (8 takes)
  small_death:   { file: 'bug_squish',       volume: 0.50, rate: ST(3), rateRandom: [0.9, 1.12], maxLen: 0.45 },
  spider_coil:   { file: 'ant_hiss',         volume: 0.35, rate: ST(3), rateRandom: [0.95, 1.1], maxLen: 0.45 },   // telegraph hiss
  spider_leap:   { file: 'webbs_dodge',      volume: 0.40, rate: ST(4), maxLen: 0.35 },
  spider_land:   { file: 'footstep_stone',   volume: 0.40, rate: ST(-2), rateRandom: [0.9, 1.1] },
  // Mandible clicks (bite tell) and a hiss when a soldier has you
  ant_bite:      { file: 'ant_click',        volume: 0.40, rateRandom: [1.1, 1.5], maxLen: 0.3, minGap: 0.1 },
  ant_hiss:      { file: 'ant_hiss',         volume: 0.42, rateRandom: [0.9, 1.15], maxLen: 0.6, minGap: 0.3 },
  // Every blade/stab hit on a bug also cracks its shell
  chitin_crack:  { file: 'chitin_crack',     volume: 0.38, rateRandom: [1.0, 1.35], maxLen: 0.35, maxVoices: 3 },
  sac_burst:     { file: 'sac_burst',        volume: 0.80, rate: ST(-3), rateRandom: [0.9, 1.05], maxLen: 0.9 },

  // ── Colony traps · cave · Crossroads locks ──────────────────────────────
  trap_click:    { file: 'trap_click',       volume: 0.45, rateRandom: [0.9, 1.1] },
  trap_spike:    { file: 'trap_spike',       volume: 0.60, rate: ST(-3), rateRandom: [0.92, 1.08] },
  rubble_fall:   { file: 'rubble_fall',      volume: 0.70, rateRandom: [0.85, 1.05], maxLen: 0.9 },
  rock_smack:    { file: 'rubble_fall',      volume: 0.50, rate: ST(5), rateRandom: [0.95, 1.15], maxLen: 0.35 },   // a pebble, batted
  cave_drip:     { file: 'cave_drip',        volume: 0.22, rateRandom: [0.8, 1.35], maxVoices: 3, reverb: 1.6 },
  lock_click:    { file: 'lock_click',       volume: 0.45, rateRandom: [1.0, 1.4], maxLen: 0.3 },
  lock_open:     { file: 'lock_open',        volume: 0.60, rateRandom: [0.95, 1.05] },
  gate_creak:    { file: 'gate_creak',       volume: 0.55, rate: ST(3), rateRandom: [0.95, 1.05] },
  chain_snap:    { file: 'chain_snap',       volume: 0.75, rateRandom: [0.95, 1.1] },
  wax_crumble:   { file: 'wax_crumble',      volume: 0.60, rateRandom: [0.85, 1.05], maxVoices: 3 },

  // ── Boss ────────────────────────────────────────────────────────────────
  boss_idle:         { file: 'boss_idle',         volume: 0.55, loop: true },
  boss_suction:      { file: 'boss_suction',      volume: 0.75 },
  boss_windup:       { file: 'beetle_charge_windup', volume: 0.80, rate: ST(-6), maxLen: 0.8 },   // attack telegraph
  // Pained growls (5 takes), deep
  boss_hit:          { file: 'boss_growl',        volume: 0.80, rate: ST(-4), rateRandom: [0.92, 1.05], maxLen: 1.2 },
  // Snout: a pig snort + steam bursts for the rock volley; horse snorts for sniffing
  boss_snort:        { file: 'boss_snort',        volume: 0.75, rate: ST(-5), rateRandom: [0.9, 1.05], maxLen: 1.0 },
  boss_sniff:        { file: 'boss_sniff',        volume: 0.55, rate: ST(-3), rateRandom: [0.9, 1.1], maxLen: 0.9, minGap: 0.6 },
  boss_growl:        { file: 'boss_growl',        volume: 0.85, rate: ST(-6), rateRandom: [0.95, 1.05], maxLen: 1.6 },
  tongue_lash:       { file: 'tongue_lash',       volume: 0.70, rateRandom: [1.05, 1.25], maxLen: 0.8 },
  tongue_slap:       { file: 'tongue_slap',       volume: 0.80, rate: ST(-4), rateRandom: [0.9, 1.05], maxLen: 0.6 },
  boss_phase_change: { file: 'boss_phase_change', volume: 0.90 },
  boss_death:        { file: 'boss_death',        volume: 1.00 },

  // ── Ambience ────────────────────────────────────────────────────────────
  // Beds sit ~10 dB under the action
  // Den: pitched down and darkened to a low, felt-more-than-heard bed
  amb_homebase:      { file: 'amb_homebase',     volume: 0.17, loop: true, bus: 'amb', rate: ST(-3), lowpass: 850 },
  amb_colony_entry:  { file: 'amb_colony_entry', volume: 0.26, loop: true, bus: 'amb' },
  amb_colony_mid:    { file: 'amb_colony_mid',   volume: 0.26, loop: true, bus: 'amb', maxLoop: 50 },
  amb_colony_deep:   { file: 'amb_colony_deep',  volume: 0.30, loop: true, bus: 'amb' },
  amb_boss:          { file: 'amb_boss',         volume: 0.32, loop: true, bus: 'amb', maxLoop: 50 },

  // ── UI ──────────────────────────────────────────────────────────────────
  ui_hover:           { file: 'ui_hover',          volume: 0.30, bus: 'ui', minGap: 0.04 },
  ui_click:           { file: 'ui_click',          volume: 0.45, bus: 'ui' },
  ui_back:            { file: 'ui_back',           volume: 0.40, bus: 'ui' },
  ui_title_new_game:  { file: 'ui_title_new_game', volume: 0.45, bus: 'ui' },
  ui_title_continue:  { file: 'ui_title_continue', volume: 0.45, bus: 'ui' },
  ui_text_advance:    { file: 'ui_text_advance',   volume: 0.35, bus: 'ui' },
  celeb_swell:        { file: 'celeb_swell',       volume: 0.60, bus: 'ui' },
  // The edit the consolidation report asked for (+2 st, room) — done at runtime
  celeb_burst:        { file: 'celeb_burst',       volume: 0.65, bus: 'ui', rate: ST(2), reverb: 0.9 },
  celeb_tutorial:     { file: 'celeb_tutorial',    volume: 0.45, bus: 'ui' },
  pickup_notify:      { file: 'pickup_notify',     volume: 0.45, bus: 'ui', minGap: 0.06 },
  xp_gain_small:      { file: 'xp_gain_small',     volume: 0.35, bus: 'ui' },
  // Same source as the title "new game" sting — pitched up so they differ
  xp_gain_combo:      { file: 'xp_gain_combo',     volume: 0.40, bus: 'ui', rate: ST(4) },
  stamina_winded:     { file: 'stamina_winded',    volume: 0.55, maxLen: 2.2 },
  energy_depleted:    { file: 'energy_depleted',   volume: 0.40, bus: 'ui' },
  workbench_open:     { file: 'workbench_open',    volume: 0.50, bus: 'ui' },
  crafting_complete:  { file: 'crafting_complete', volume: 0.55, bus: 'ui' },
  potion_drink:       { file: 'xp_gain_small',     volume: 0.45, bus: 'ui', rate: ST(-5) },   // low, round gulp
  web_launcher_equipped: { file: 'web_launcher_equipped', volume: 0.50, bus: 'ui' },
}

const FILE_TRIM_DB = new Map<string, number>()
const FILE_MAX_LOOP = new Map<string, number>()
for (const cfg of Object.values(SOUND_REGISTRY)) {
  if (cfg.trimDb !== undefined) FILE_TRIM_DB.set(cfg.file, cfg.trimDb)
  if (cfg.maxLoop !== undefined) FILE_MAX_LOOP.set(cfg.file, cfg.maxLoop)
}

// ── Tuning ────────────────────────────────────────────────────────────────────
const TARGET_RMS   = 0.1      // -20 dBFS: what every buffer is normalised to
const MAX_BOOST    = 16       // +24 dB at most (very quiet source files)
const PEAK_CEIL    = 1.4      // normalised peak may exceed full scale a little — the limiter catches it
const TRIM_REL_DB  = -30      // leading silence = below peak -30 dB…
const TRIM_ABS     = 0.002    // …or below -54 dBFS
const TRIM_PREROLL = 0.004    // keep 4 ms before the first transient
const NEAR_UNITS   = 4        // full volume within this many creature-scale units
const FALLOFF      = 9        // then -6 dB per ~FALLOFF units further
const PAN_UNITS    = 12       // screen-right distance that pans fully
const MAX_VOICES   = 48
const AMB_BUS      = 0.8      // ambience bus level under the world
const LOAD_CONCURRENCY = 6

// Per-zone cave reverb: decay time and how wet the world sounds
export type AudioRoom = 'homeBase' | 'crossroads' | 'antColony' | 'bossRoller'
// `rumble`: level of the synthetic sub-bass bed under the zone's ambience
// (the sampled beds have almost nothing below 250 Hz).
const ROOMS: Record<AudioRoom, { decay: number; wet: number; damp: number; rumble: number; rumbleHz: number }> = {
  homeBase:   { decay: 0.9, wet: 0.14, damp: 0.55, rumble: 0.18, rumbleHz: 95 },   // small, soft dirt den
  crossroads: { decay: 2.2, wet: 0.26, damp: 0.4,  rumble: 0.14, rumbleHz: 100 },  // open cave junction
  antColony:  { decay: 1.7, wet: 0.24, damp: 0.45, rumble: 0.12, rumbleHz: 120 },  // packed-earth tunnels
  bossRoller: { decay: 2.8, wet: 0.30, damp: 0.35, rumble: 0.22, rumbleHz: 80 },   // big hollow
}

export type ImpactKind = 'light' | 'medium' | 'heavy' | 'weak' | 'kill' | 'hurt'

interface Analysed { buffer: AudioBuffer; start: number; gain: number }

interface Voice {
  id:      number
  key:     SoundKey | null      // null for synth voices
  src:     AudioScheduledSourceNode
  gain:    GainNode               // per-voice level (fades)
  base:    number                 // level before distance attenuation
  level:   number                 // level it started at (after attenuation)
  loop:    boolean
  pan:     StereoPannerNode | null
  lp:      BiquadFilterNode | null
  x?:      number
  z?:      number
  started: number
  ended:   boolean
}

interface LoopEntry { voice: Voice | null; pending: boolean; x?: number; z?: number }

const NULL_SOUND_ID = -1
const MUTE_STORE    = 'nolegs.audio.muted'

export class AudioManager {
  private ctx:    AudioContext
  private master: GainNode
  private limiter: DynamicsCompressorNode
  private world:  GainNode           // sfx + amb → muffle → master
  private muffle: BiquadFilterNode
  private buses:  Record<Bus, GainNode>
  private reverbIn:  GainNode
  private convolver: ConvolverNode
  private reverbWet: GainNode
  private noise:  AudioBuffer
  private rumble!:   GainNode
  private rumbleLp!: BiquadFilterNode

  private buffers = new Map<string, Analysed>()        // by file
  private takes   = new Map<string, Analysed[]>()      // multi-take files, by file
  private lastTake = new Map<string, number>()
  private loading = new Map<string, Promise<Analysed | null>>()
  private failed  = new Set<string>()
  private ext:    'webm' | 'mp3'

  private voices: Voice[] = []
  private loops  = new Map<string, LoopEntry>()
  private lastPlay = new Map<SoundKey, number>()
  private owners = new WeakMap<object, number>()
  private nextOwner = 1
  private nextId = 1

  private lx = 0; private lz = 0           // listener
  private rx = 1; private rz = 0           // screen-right on the ground plane
  private unit = 1                          // creature scale
  private masterVolume = 1
  private ambLevel = 1
  private muted = false

  constructor() {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    this.ctx = new Ctx({ latencyHint: 'interactive' })
    const c = this.ctx

    this.limiter = c.createDynamicsCompressor()
    this.limiter.threshold.value = -9
    this.limiter.knee.value      = 4
    this.limiter.ratio.value     = 16
    this.limiter.attack.value    = 0.002
    this.limiter.release.value   = 0.14
    this.master = c.createGain()
    this.master.connect(this.limiter).connect(c.destination)

    this.muffle = c.createBiquadFilter()
    this.muffle.type = 'lowpass'
    this.muffle.frequency.value = 20000
    this.muffle.Q.value = 0.5
    this.world = c.createGain()
    this.world.connect(this.muffle).connect(this.master)

    this.buses = { sfx: c.createGain(), amb: c.createGain(), ui: c.createGain() }
    this.buses.sfx.connect(this.world)
    // Ambience gets gentle compression so sparse spikes in the beds stay subtle.
    // Web Audio compressors add automatic make-up gain ((1/gain at 0 dBFS)^0.6),
    // which would make the beds LOUDER — cancel it.
    const ambComp = c.createDynamicsCompressor()
    const T = -34, R = 3
    ambComp.threshold.value = T; ambComp.knee.value = 10; ambComp.ratio.value = R
    ambComp.attack.value = 0.01; ambComp.release.value = 0.4
    const makeupDb = 0.6 * -(T - T / R)
    const ambTrim = c.createGain(); ambTrim.gain.value = 10 ** (-makeupDb / 20)
    this.buses.amb.connect(ambComp).connect(ambTrim).connect(this.world)
    this.buses.ui.connect(this.master)
    this.buses.amb.gain.value = AMB_BUS

    this.reverbIn  = c.createGain()
    this.convolver = c.createConvolver()
    this.reverbWet = c.createGain()
    this.reverbIn.connect(this.convolver).connect(this.reverbWet).connect(this.world)

    // Sub-bass bed: looping brown noise → low-pass, breathing on a slow LFO
    const bn = c.createBuffer(1, c.sampleRate * 6, c.sampleRate)
    const bd = bn.getChannelData(0)
    let last = 0
    let ss = 0
    for (let i = 0; i < bd.length; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; bd[i] = last; ss += last * last }
    const norm = TARGET_RMS / Math.sqrt(ss / bd.length)   // same -20 dBFS reference as the samples
    for (let i = 0; i < bd.length; i++) bd[i] *= norm
    const fade = Math.floor(c.sampleRate * 0.25)   // crossfade the loop seam
    for (let i = 0; i < fade; i++) { const t = i / fade; bd[i] = bd[i] * t + bd[bd.length - fade + i] * (1 - t) }
    const src = c.createBufferSource(); src.buffer = bn; src.loop = true; src.loopEnd = (bd.length - fade) / c.sampleRate
    this.rumbleLp = c.createBiquadFilter(); this.rumbleLp.type = 'lowpass'; this.rumbleLp.Q.value = 0.7
    this.rumble = c.createGain(); this.rumble.gain.value = 0
    const breath = c.createGain(); breath.gain.value = 1
    const lfo = c.createOscillator(); lfo.frequency.value = 0.06
    const depth = c.createGain(); depth.gain.value = 0.35
    lfo.connect(depth).connect(breath.gain)
    src.connect(this.rumbleLp).connect(breath).connect(this.rumble).connect(this.buses.amb)
    src.start(); lfo.start()
    this.setRoom('homeBase')

    // 0.5 s of white noise for synth layers
    this.noise = c.createBuffer(1, Math.floor(c.sampleRate * 0.5), c.sampleRate)
    const nd = this.noise.getChannelData(0)
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1

    this.ext = new Audio().canPlayType('audio/webm; codecs="opus"') ? 'webm' : 'mp3'

    try { this.muted = localStorage.getItem(MUTE_STORE) === '1' } catch { /* storage blocked */ }
    this.master.gain.value = this.muted ? 0 : this.masterVolume

    // Browsers start the context suspended until a gesture
    const unlock = () => { if (this.ctx.state !== 'running') void this.ctx.resume() }
    for (const ev of ['pointerdown', 'keydown', 'touchend']) window.addEventListener(ev, unlock, { capture: true })

  }

  // ── Loading ────────────────────────────────────────────────────────────────

  // Call once the first frame is up (not at module load, where it competed with
  // the JS + physics WASM for bandwidth).  Every one-shot loads now — they must
  // be ready the instant they're triggered — plus the den's ambience.  Other
  // loops (colony/boss beds, flame, heartbeat — the multi-MB files) load on
  // their first playLoop(), which already waits for the buffer and fades in.
  preload(): void {
    const files = new Set<string>()
    for (const cfg of Object.values(SOUND_REGISTRY)) if (!cfg.loop) files.add(cfg.file)
    files.add(SOUND_REGISTRY.amb_homebase.file)
    const queue = [...files]
    let i = 0
    const next = (): void => {
      if (i >= queue.length) return
      void this.load(queue[i++]).then(next)
    }
    for (let k = 0; k < LOAD_CONCURRENCY; k++) next()
  }

  private load(file: string): Promise<Analysed | null> {
    const have = this.buffers.get(file)
    if (have) return Promise.resolve(have)
    const pending = this.loading.get(file)
    if (pending) return pending
    const p = this.fetchDecode(file, this.ext)
      .catch(() => this.ext === 'webm' ? this.fetchDecode(file, 'mp3') : null)
      .catch(() => null)
      .then(buf => {
        this.loading.delete(file)
        if (!buf) { this.failed.add(file); return null }
        const max = FILE_MAX_LOOP.get(file)
        if (max !== undefined) buf = cropLoop(this.ctx, buf, max)
        const cuts = AUDIO_SPRITES[file]
        if (cuts) {
          const list = splitTakes(this.ctx, buf, cuts).map(b => analyse(b, FILE_TRIM_DB.get(file) ?? TRIM_REL_DB))
          this.takes.set(file, list)
          this.buffers.set(file, list[0])
          return list[0]
        }
        const a = analyse(buf, FILE_TRIM_DB.get(file) ?? TRIM_REL_DB)
        this.buffers.set(file, a)
        return a
      })
    this.loading.set(file, p)
    return p
  }

  private async fetchDecode(file: string, ext: string): Promise<AudioBuffer> {
    // ?v= is the file's content hash: a changed sound gets a new URL, so no
    // cache (browser or CDN edge) can hand back the old file
    const v = AUDIO_HASH[file]
    const res = await fetch(`/audio/${file}.${ext}${v ? `?v=${v}` : ''}`)
    if (!res.ok) throw new Error(`${res.status}`)
    return await this.ctx.decodeAudioData(await res.arrayBuffer())
  }

  // ── One-shots ──────────────────────────────────────────────────────────────

  play(key: SoundKey, worldX?: number, worldZ?: number, opts: { volume?: number; rate?: number } = {}): number {
    if (this.muted || this.ctx.state !== 'running') return NULL_SOUND_ID
    const cfg = SOUND_REGISTRY[key]
    const a = this.buffers.get(cfg.file)
    if (!a) { if (!this.failed.has(cfg.file)) void this.load(cfg.file); return NULL_SOUND_ID }   // late = worse than silent

    const now = this.ctx.currentTime
    const last = this.lastPlay.get(key)
    if (last !== undefined && now - last < (cfg.minGap ?? 0.03)) return NULL_SOUND_ID
    this.lastPlay.set(key, now)

    // Voice limits: oldest of this key, then oldest overall
    const same = this.voices.filter(v => v.key === key && !v.ended)
    if (same.length >= (cfg.maxVoices ?? 4)) this.release(same[0], 0.02)
    if (this.voices.length >= MAX_VOICES) {
      const victim = this.voices.find(x => !x.loop && !x.ended)   // never steal a loop
      if (victim) this.release(victim, 0.02)
    }

    const v = this.startVoice(key, this.pickTake(cfg.file) ?? a, cfg, worldX, worldZ, opts, false)
    if (cfg.maxLen) {
      const rate = (v.src as AudioBufferSourceNode).playbackRate.value
      const len  = cfg.maxLen
      if ((a.buffer.duration - a.start) / rate > len) {
        v.gain.gain.setValueAtTime(v.level, now + len * 0.7)
        v.gain.gain.linearRampToValueAtTime(0, now + len)
        v.src.stop(now + len + 0.02)
      }
    }
    return v.id
  }

  // A random take, never the one this file played last
  private pickTake(file: string): Analysed | null {
    const list = this.takes.get(file)
    if (!list || list.length < 2) return null
    const last = this.lastTake.get(file) ?? -1
    let i = Math.floor(Math.random() * (list.length - 1))
    if (i >= last) i++
    this.lastTake.set(file, i)
    return list[i]
  }

  // ── Ambient one-shots ──────────────────────────────────────────────────────
  // A few sounds scattered around the listener at random intervals (drips in
  // the caves).  setAmbientSpots(null) stops it.  Ticked from setListener.
  private spots: { key: SoundKey; every: [number, number]; radius: number; next: number } | null = null
  setAmbientSpots(cfg: { key: SoundKey; every: [number, number]; radius: number } | null): void {
    this.spots = cfg ? { ...cfg, next: this.ctx.currentTime + cfg.every[0] } : null
  }
  private tickSpots(): void {
    const s = this.spots
    if (!s || this.ctx.currentTime < s.next) return
    s.next = this.ctx.currentTime + s.every[0] + Math.random() * (s.every[1] - s.every[0])
    const a = Math.random() * Math.PI * 2, r = s.radius * (0.35 + Math.random() * 0.65) * this.unit
    this.play(s.key, this.lx + Math.cos(a) * r, this.lz + Math.sin(a) * r)
  }

  // ── Loops ──────────────────────────────────────────────────────────────────
  // `owner` makes the loop per-instance (each centipede has its own skitter).
  // Idempotent: repeated calls just move it.

  playLoop(key: SoundKey, worldX?: number, worldZ?: number, owner?: object): number {
    const id = this.loopId(key, owner)
    const cur = this.loops.get(id)
    if (cur) {
      if (worldX !== undefined && worldZ !== undefined) { cur.x = worldX; cur.z = worldZ; if (cur.voice) { cur.voice.x = worldX; cur.voice.z = worldZ } }
      return cur.voice?.id ?? NULL_SOUND_ID
    }
    const entry: LoopEntry = { voice: null, pending: true, x: worldX, z: worldZ }
    this.loops.set(id, entry)
    const cfg = SOUND_REGISTRY[key]
    void this.load(cfg.file).then(a => {
      if (!a || this.loops.get(id) !== entry) return   // stopped before it loaded
      entry.pending = false
      entry.voice = this.startVoice(key, a, cfg, entry.x, entry.z, {}, true)
    })
    return NULL_SOUND_ID
  }

  stopLoop(key: SoundKey, owner?: object): void {
    const id = this.loopId(key, owner)
    const e = this.loops.get(id)
    if (!e) return
    this.loops.delete(id)
    if (e.voice) this.release(e.voice, SOUND_REGISTRY[key].bus === 'amb' ? 1.2 : 0.08)
  }

  updateLoopPosition(key: SoundKey, worldX: number, worldZ: number, owner?: object): void {
    const e = this.loops.get(this.loopId(key, owner))
    if (!e) return
    e.x = worldX; e.z = worldZ
    if (e.voice) { e.voice.x = worldX; e.voice.z = worldZ }
  }

  // Move every loop an owner started (call from the owner's per-frame sync)
  moveOwner(owner: object, worldX: number, worldZ: number): void {
    const n = this.owners.get(owner)
    if (n === undefined) return
    const tag = `#${n}`
    for (const [id, e] of this.loops) {
      if (!id.endsWith(tag)) continue
      e.x = worldX; e.z = worldZ
      if (e.voice) { e.voice.x = worldX; e.voice.z = worldZ }
    }
  }

  // Stop every loop an owner started (enemy cleanup)
  stopOwner(owner: object): void {
    const n = this.owners.get(owner)
    if (n === undefined) return
    const tag = `#${n}`
    for (const [id, e] of [...this.loops]) {
      if (!id.endsWith(tag)) continue
      this.loops.delete(id)
      if (e.voice) this.release(e.voice, 0.08)
    }
  }

  stopAllLoops(): void {
    for (const [id, e] of [...this.loops]) {
      this.loops.delete(id)
      if (e.voice) this.release(e.voice, e.voice.key && SOUND_REGISTRY[e.voice.key].bus === 'amb' ? 1.2 : 0.08)
    }
  }

  // ── Synth impact layer ─────────────────────────────────────────────────────
  // Weight under the sampled hit: a pitched-down sine "thump" plus a short
  // filtered-noise crack; weak points add a bright inharmonic ting.
  impact(kind: ImpactKind, worldX?: number, worldZ?: number): void {
    if (this.muted || this.ctx.state !== 'running') return
    const T = {
      light:  { f0: 170, f1: 75, len: 0.10, lvl: 0.35, crack: 0.12 },
      medium: { f0: 130, f1: 55, len: 0.14, lvl: 0.55, crack: 0.16 },
      heavy:  { f0: 105, f1: 40, len: 0.20, lvl: 0.80, crack: 0.22 },
      weak:   { f0: 140, f1: 60, len: 0.14, lvl: 0.55, crack: 0.18 },
      kill:   { f0: 95,  f1: 32, len: 0.28, lvl: 0.90, crack: 0.20 },
      hurt:   { f0: 150, f1: 50, len: 0.18, lvl: 0.70, crack: 0.10 },
    }[kind]
    const c = this.ctx, t = c.currentTime

    const osc = c.createOscillator()
    osc.frequency.setValueAtTime(T.f0, t)
    osc.frequency.exponentialRampToValueAtTime(T.f1, t + T.len)
    this.synthVoice(osc, T.lvl, 0.003, T.len, worldX, worldZ, 0.3)

    const crack = c.createBufferSource()
    crack.buffer = this.noise
    crack.playbackRate.value = 0.8 + Math.random() * 0.4
    const bp = c.createBiquadFilter()
    bp.type = 'bandpass'; bp.frequency.value = kind === 'hurt' ? 900 : 2200; bp.Q.value = 0.9
    crack.connect(bp)
    this.synthVoice(crack, T.crack, 0.001, 0.05, worldX, worldZ, 0.6, bp)

    if (kind === 'weak' || kind === 'kill') {
      for (const [f, l] of kind === 'weak' ? [[2637, 0.16], [3951, 0.09]] : [[1760, 0.10]]) {
        const ping = c.createOscillator()
        ping.type = 'triangle'
        ping.frequency.value = f
        this.synthVoice(ping, l, 0.002, 0.22, worldX, worldZ, 1)
      }
    }
  }

  // ── Listener / mix ─────────────────────────────────────────────────────────

  // Call every frame: listener (player) position, the camera's right vector on
  // the ground plane, and the zone's creature scale.
  setListener(x: number, z: number, rightX: number, rightZ: number, unit: number): void {
    this.lx = x; this.lz = z
    const l = Math.hypot(rightX, rightZ) || 1
    this.rx = rightX / l; this.rz = rightZ / l
    this.unit = unit
    this.updateSpatial()
    this.tickSpots()
  }

  setListenerPosition(x: number, z: number): void {
    this.lx = x; this.lz = z
    this.updateSpatial()
  }

  setRoom(room: AudioRoom): void {
    const r = ROOMS[room]
    this.convolver.buffer = makeImpulse(this.ctx, r.decay, r.damp)
    this.reverbWet.gain.setTargetAtTime(r.wet, this.ctx.currentTime, 0.1)
    this.rumble.gain.setTargetAtTime(r.rumble, this.ctx.currentTime, 0.8)
    this.rumbleLp.frequency.setTargetAtTime(r.rumbleHz, this.ctx.currentTime, 0.3)
  }

  // Pause menus etc.: the world goes dull and quieter; UI stays crisp.
  setMuffled(on: boolean): void {
    const t = this.ctx.currentTime
    this.muffle.frequency.setTargetAtTime(on ? 700 : 20000, t, on ? 0.06 : 0.12)
    this.world.gain.setTargetAtTime(on ? 0.6 : 1, t, 0.08)
  }

  // Hold ambience at a level (story text, discoveries) — 1 = normal
  setAmbienceLevel(level: number): void {
    this.ambLevel = level
    const g = this.buses.amb.gain, t = this.ctx.currentTime
    g.cancelScheduledValues(t)
    g.setTargetAtTime(AMB_BUS * level, t, 0.25)
  }

  // Briefly pull ambience down under a big moment (boss roar), then recover
  duck(level: number, seconds: number): void {
    const g = this.buses.amb.gain, t = this.ctx.currentTime
    g.cancelScheduledValues(t)
    g.setTargetAtTime(AMB_BUS * this.ambLevel * level, t, 0.05)
    g.setTargetAtTime(AMB_BUS * this.ambLevel, t + seconds, 0.5)
  }

  setMasterVolume(v: number): void {
    this.masterVolume = Math.max(0, Math.min(1, v))
    if (!this.muted) this.master.gain.setTargetAtTime(this.masterVolume, this.ctx.currentTime, 0.02)
  }

  mute(): void   { this.setMute(true) }
  unmute(): void { this.setMute(false) }
  isMuted(): boolean { return this.muted }

  private setMute(on: boolean): void {
    this.muted = on
    this.master.gain.setTargetAtTime(on ? 0 : this.masterVolume, this.ctx.currentTime, 0.03)
    try { localStorage.setItem(MUTE_STORE, on ? '1' : '0') } catch { /* storage blocked */ }
  }

  // Dev: what's loaded / playing
  debug(): { loaded: number; failed: string[]; voices: number; loops: string[]; state: string } {
    return { loaded: this.buffers.size, failed: [...this.failed], voices: this.voices.length, loops: [...this.loops.keys()], state: this.ctx.state }
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  private loopId(key: SoundKey, owner?: object): string {
    if (!owner) return key
    let n = this.owners.get(owner)
    if (n === undefined) { n = this.nextOwner++; this.owners.set(owner, n) }
    return `${key}#${n}`
  }

  private startVoice(key: SoundKey, a: Analysed, cfg: SoundConfig, x: number | undefined, z: number | undefined,
                     opts: { volume?: number; rate?: number }, loop: boolean): Voice {
    const c = this.ctx, t = c.currentTime
    const src = c.createBufferSource()
    src.buffer = a.buffer
    let rate = (cfg.rate ?? 1) * (opts.rate ?? 1)
    if (cfg.rateRandom) rate *= cfg.rateRandom[0] + Math.random() * (cfg.rateRandom[1] - cfg.rateRandom[0])
    src.playbackRate.value = rate
    if (loop) src.loop = true

    const base = a.gain * cfg.volume * (opts.volume ?? 1)
    const bus  = cfg.bus ?? 'sfx'
    const gain = c.createGain()
    let head: AudioNode = src
    if (cfg.lowpass) {
      const f = c.createBiquadFilter()
      f.type = 'lowpass'; f.frequency.value = cfg.lowpass
      head.connect(f); head = f
    }
    const positional = x !== undefined && z !== undefined
    let lp: BiquadFilterNode | null = null, pan: StereoPannerNode | null = null
    if (positional) {
      lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 20000
      head.connect(lp); head = lp
    }
    head.connect(gain)
    let out: AudioNode = gain
    if (positional) { pan = c.createStereoPanner(); gain.connect(pan); out = pan }
    out.connect(this.buses[bus])
    const send = cfg.reverb ?? (bus === 'sfx' ? 1 : 0)
    if (send > 0) {
      const s = c.createGain(); s.gain.value = send
      out.connect(s).connect(this.reverbIn)
    }

    const v: Voice = { id: this.nextId++, key, src, gain, base, level: base, loop, pan, lp, x, z, started: t, ended: false }
    if (positional) {
      const { att, p, cutoff } = this.place(x!, z!)
      v.level = base * att
      pan!.pan.value = p
      lp!.frequency.value = cutoff
    }
    // Loops fade in (ambience slowly); one-shots start hard — transients matter
    const fadeIn = loop ? (bus === 'amb' ? 1.2 : 0.05) : 0
    if (fadeIn > 0) { gain.gain.setValueAtTime(0, t); gain.gain.linearRampToValueAtTime(v.level, t + fadeIn) }
    else gain.gain.value = v.level
    src.onended = () => this.retire(v)
    src.start(t, loop ? 0 : a.start)
    this.voices.push(v)
    return v
  }

  private synthVoice(src: AudioScheduledSourceNode, level: number, attack: number, decay: number,
                     x: number | undefined, z: number | undefined, send: number, tail?: AudioNode): void {
    const c = this.ctx, t = c.currentTime
    const env = c.createGain()
    env.gain.setValueAtTime(0, t)
    env.gain.linearRampToValueAtTime(level, t + attack)
    env.gain.exponentialRampToValueAtTime(0.0005, t + attack + decay)
    ;(tail ?? src).connect(env)
    const out = c.createGain()          // distance attenuation
    const pan = c.createStereoPanner()
    if (x !== undefined && z !== undefined) {
      const { att, p } = this.place(x, z)
      out.gain.value = att
      pan.pan.value = p
    }
    env.connect(out).connect(pan).connect(this.buses.sfx)
    const s = c.createGain(); s.gain.value = send
    pan.connect(s).connect(this.reverbIn)
    // Short-lived: positions aren't tracked per frame (x/z left undefined)
    const v: Voice = { id: this.nextId++, key: null, src, gain: env, base: level, level, loop: false, pan, lp: null, started: t, ended: false }
    src.onended = () => this.retire(v)
    src.start(t)
    src.stop(t + attack + decay + 0.05)
    this.voices.push(v)
  }

  private release(v: Voice, fade: number): void {
    if (v.ended) return
    v.ended = true
    const t = this.ctx.currentTime
    v.gain.gain.cancelScheduledValues(t)
    v.gain.gain.setValueAtTime(v.gain.gain.value, t)
    v.gain.gain.linearRampToValueAtTime(0, t + fade)
    try { v.src.stop(t + fade + 0.01) } catch { /* already stopped */ }
  }

  private retire(v: Voice): void {
    v.ended = true
    const i = this.voices.indexOf(v)
    if (i >= 0) this.voices.splice(i, 1)
    v.gain.disconnect()
    v.pan?.disconnect()
  }

  private place(x: number, z: number): { att: number; p: number; cutoff: number } {
    const dx = x - this.lx, dz = z - this.lz
    const u = Math.max(0.01, this.unit)
    const du = Math.hypot(dx, dz) / u
    const far = Math.max(0, du - NEAR_UNITS) / FALLOFF
    const att = 1 / (1 + far * far)
    const side = (dx * this.rx + dz * this.rz) / (PAN_UNITS * u)
    return { att, p: Math.max(-1, Math.min(1, side)) * 0.85, cutoff: Math.max(700, 20000 * att ** 1.6) }
  }

  private spatialise(v: Voice): void {
    if (v.x === undefined || v.z === undefined || !v.pan || v.ended) return
    const { att, p, cutoff } = this.place(v.x, v.z)
    const t = this.ctx.currentTime
    v.pan.pan.setTargetAtTime(p, t, 0.05)
    v.lp?.frequency.setTargetAtTime(cutoff, t, 0.05)
    // Only steady (looping) voices track level — one-shots keep their envelopes
    if (v.loop) v.gain.gain.setTargetAtTime(v.base * att, t, 0.08)
  }

  private updateSpatial(): void {
    for (const v of this.voices) if (v.x !== undefined) this.spatialise(v)
  }
}

// ── Buffer analysis: leading-silence trim + loudness normalisation ───────────
function analyse(buffer: AudioBuffer, trimDb: number): Analysed {
  const ch = buffer.getChannelData(0)
  let peak = 0
  for (let i = 0; i < ch.length; i++) { const v = Math.abs(ch[i]); if (v > peak) peak = v }
  if (peak < 1e-5) return { buffer, start: 0, gain: 1 }
  const thr = Math.max(peak * 10 ** (trimDb / 20), TRIM_ABS)
  let first = 0, last = ch.length - 1
  while (first < ch.length && Math.abs(ch[first]) < thr) first++
  while (last > first && Math.abs(ch[last]) < thr) last--
  let sum = 0
  for (let i = first; i <= last; i++) sum += ch[i] * ch[i]
  const rms  = Math.sqrt(sum / Math.max(1, last - first + 1))
  const gain = Math.min(TARGET_RMS / Math.max(rms, 1e-6), MAX_BOOST, PEAK_CEIL / peak)
  return { buffer, start: Math.max(0, first / buffer.sampleRate - TRIM_PREROLL), gain }
}

// Cut a multi-take file at its split points (s) into one buffer per take
function splitTakes(ctx: BaseAudioContext, src: AudioBuffer, cuts: number[]): AudioBuffer[] {
  const sr = src.sampleRate
  const edges = [0, ...cuts.map(c => Math.min(src.length, Math.round(c * sr))), src.length]
  const out: AudioBuffer[] = []
  for (let i = 0; i < edges.length - 1; i++) {
    const n = edges[i + 1] - edges[i]
    if (n <= 0) continue
    const b = ctx.createBuffer(src.numberOfChannels, n, sr)
    for (let c = 0; c < src.numberOfChannels; c++) b.getChannelData(c).set(src.getChannelData(c).subarray(edges[i], edges[i + 1]))
    out.push(b)
  }
  return out
}

// Crop a long loop to `seconds`, crossfading the tail of the kept part into
// what followed it so the new seam is as smooth as the original material
// (decoded PCM is ~0.2 MB/s; a 219 s bed was 42 MB).
function cropLoop(ctx: BaseAudioContext, src: AudioBuffer, seconds: number): AudioBuffer {
  const sr = src.sampleRate
  const L = Math.floor(seconds * sr), X = Math.floor(1.5 * sr)
  if (src.length < L + X) return src
  const out = ctx.createBuffer(src.numberOfChannels, L, sr)
  for (let c = 0; c < src.numberOfChannels; c++) {
    const i0 = src.getChannelData(c), o = out.getChannelData(c)
    o.set(i0.subarray(0, L))
    // Wrapping from o[L-1] lands on o[0]: start it as the continuation i0[L]
    // and blend (equal power) back into the original opening by X.
    for (let i = 0; i < X; i++) {
      const t = (i / X) * Math.PI / 2
      o[i] = i0[L + i] * Math.cos(t) + i0[i] * Math.sin(t)
    }
  }
  return out
}

// Stereo exponential-decay noise impulse, darkened by a one-pole low-pass
function makeImpulse(ctx: BaseAudioContext, decay: number, damp: number): AudioBuffer {
  const sr = ctx.sampleRate
  const len = Math.floor(sr * decay)
  const pre = Math.floor(sr * 0.012)
  const buf = ctx.createBuffer(2, len + pre, sr)
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c)
    let lp = 0
    for (let i = 0; i < len; i++) {
      const t = i / sr
      lp += (1 - damp) * ((Math.random() * 2 - 1) - lp)
      d[pre + i] = lp * Math.exp(-6.9 * t / decay)
    }
  }
  return buf
}

export const audio = new AudioManager()
