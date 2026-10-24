import { registry } from '../core/Registry'
import type { TextDisplayData } from '../ui/TextDisplay3D'
import type { Thoughts } from '../ui/Thoughts'

// ─── Story ────────────────────────────────────────────────────────────────────
// Every line of the chapter-one story lives here, so it can be read and edited
// in one place.  The arc:
//
//   Webbs wakes on his Molt Day (birthday) to a silent, wrecked den.  At first
//   it might be a surprise party.  The card from Mum says everyone is hiding —
//   but nobody jumps out.  The clues walk him from "something happened" to
//   "they were attacked", "they were carried off by ants" and finally
//   "something BIG sent the ants" (the realization card, TAKEN_TEXT).  Then he
//   gets ready — a weapon, his mother's web launcher — and goes after them.
//
//   West door → the Crossroads: six tunnels, all shut.  The ants locked theirs
//   behind them; the toothpick picks the padlock.  The colony leads to the
//   Anteater.  Beating it frees three of the family — but not Mum, who was
//   carried on toward the Hive.  The Anteater's shed armor makes a Chitin
//   Axe, and the axe chops the chain off the Hive tunnel (Chapter Two).
//
// Big moments use the text cards (TextDisplayData).  Everything else is
// Webbs' inner voice (ui/Thoughts) — short lines while you keep playing.

// ── Text cards ──────────────────────────────────────────────────────────────

export const OPENING_INTRO: TextDisplayData = {
  pages: [
    'Molt Day.\n\nWebbs wakes up seventeen moults old,\ngrinning before his eyes are even open.',
    'He reaches for his legs —\nchitin and thread and hollow bone,\nthe ones his mother built him,\nbecause he was born without his own.\n\nHe straps them on, one by one.',
    'The den should be loud by now.\n\nHis sisters arguing. Mum humming at her loom.\nSomeone tugging the wake-line too early, on purpose.',
    'Nothing.\n\nJust a cold draft,\ncoming through a door\nthat should be closed.',
  ],
  title:       '— NO LEG LEFT TO STAND ON —',
  accentColor: '#c8a8ff',
  style:       'story',
}

export const BIRTHDAY_CARD_TEXT: TextDisplayData = {
  pages: [
    '"Happy Molt Day, little weaver!\n\nSeventeen. I still count every one."',
    '"Everyone\'s hiding for your surprise —\nyour sisters picked the spot, so act shocked.\n\nOpen my present first.\n\n— Mum"',
    'The card is crumpled — stepped on.\nA print across one corner,\ntoo wide to be anyone\'s foot.\n\nNobody jumps out.',
  ],
  title:       '— A CARD FROM MUM —',
  accentColor: '#cc8844',
}

export const TUTORIAL_WEB_LAUNCHER: TextDisplayData = {
  pages: [
    'Wrapped in Mum\'s tidy knots, a note:\n\n"For reaching the high places —\nand for pulling yourself out of the low ones."\n\nA Web Launcher. She finished it.',
    'Press [Q] (or right-click) to fire a strand of silk.\n\nIt anchors to walls, pulls light enemies to you,\nand pulls you to heavy ones.\n\n[Q] again to let go.',
  ],
  title:       '— MUM\'S PRESENT —',
  accentColor: '#ddeeff',
}

export const TUTORIAL_TOOTHPICK: TextDisplayData = {
  pages: [
    'A Toothpick Stabber, jammed point-down in the floor —\nchipped and bent. Someone fought with this.\n\nLight and quick, short reach.\nThin enough to work a lock, too.',
    'Press [I] to open your equipment screen\nand put it in a weapon slot.',
  ],
  title:       '— SOMETHING SHARP —',
  accentColor: '#ddccaa',
}

// The four den clues.  Each describes only what's in front of him; how much
// it MEANS comes from how many he's found (CLUE_STAGE_THOUGHTS), so the
// realization builds in order whichever clue he finds first.
export const CLUES: Array<{ title: string; text: string }> = [
  { title: '— THE CRADLE —',
    text: 'The little ones\' cradle, tipped on its side.\n\nThe silk lining is still warm.\nWhatever happened here, it happened while you slept.' },
  { title: '— TRACKS —',
    text: 'A torn bundle of chewed leaf and spit, still tacky —\nthe way ants wrap a catch to carry it.\n\nAround it, tracks. Hundreds of them. Six legs each.\nAll heading for the west door.' },
  { title: '— THE DOOR —',
    text: 'Furrows gouged into the floor at the doorway,\neach one wider than you are.\n\nSnagged in the splinters, a single bristle —\ncoarse, barbed, longer than your leg.\n\nNo ant made these.' },
  { title: '— MUM\'S HAMMOCK —',
    text: 'Mum\'s hammock, slashed clean through.\n\nFresh silk is sprayed across the floor below —\nfast, thick, angry. The way she spins when she\'s fighting.\n\nShe fought back.' },
]
export const CLUE_TOTAL = CLUES.length

// Said after the Nth clue is read (N = clues found so far)
export const CLUE_STAGE_THOUGHTS: Record<number, string[]> = {
  1: ['Something happened here. Last night, while I slept.'],
  2: ['This wasn\'t an accident.', 'Someone came for them.'],
  3: ['Not someone. Something.', 'And they were taken… alive. They have to be alive.'],
}

// After the last clue: the realization
export const TAKEN_TEXT: TextDisplayData = {
  pages: [
    'The cradle. Mum\'s hammock. The tracks.\nThe furrows at the door.\n\nNobody is hiding.\nNobody is going to jump out and shout surprise.',
    'The ants carried them off — wrapped up like food.\n\nBut ants don\'t raid a spider den.\nNot alone. Not unless something much bigger\nis eating what they bring it.',
    'Something that big could swallow the den whole.\n\nAnd it has his family.',
    'Webbs has never been past the west door.\nHe\'s never had a reason to.\n\nHe has one now.',
  ],
  title:       '— TAKEN —',
  accentColor: '#ff8a6a',
  style:       'story',
}

export const CROSSROADS_INTRO: TextDisplayData = {
  pages: [
    'Past the west door, the earth opens into a crossroads.\n\nSix tunnels. Webbs knows them only from bedtime stories —\nthe kind meant to keep little spiders home.',
    'Every one of them is shut.\n\nRoots. Rock. Black water. Wax.\nAnd a gate with a padlock that wasn\'t here yesterday.',
    'The ant tracks run straight to it.',
  ],
  title:       '— THE CROSSROADS —',
  accentColor: '#9fc3ff',
  style:       'story',
}

export const COLONY_INTRO: TextDisplayData = {
  pages: [
    'Past the gate, the tracks run down into the dark —\na maze of ant tunnels, dug deep and patrolled.\n\nThe ants carried his family through here.',
    'The tracks lead west, to the Queen\'s tunnel —\nsealed with resin, held shut by three pheromone sacs\nhidden deep in the colony.\n\nBurst them. The colony will know when you do.',
    'Stay out of sight. Listen.\nIf they see you, run — and don\'t run\ninto a dead end.',
  ],
  title:       '— ZONE 1: ANT COLONY —',
  accentColor: '#66aa44',
}

export const TUTORIAL_AXE_RECIPE: TextDisplayData = {
  pages: [
    'Where the snout tore free of the wall, the Anteater\nleft its armor behind — plates of hard chitin\nand splintered bone.\n\nEnough to build something heavy.',
    'New recipe: Chitin Axe.\nWeave it at a workbench.\n\nAn axe like that could chop through a chain.',
  ],
  title:       '— NEW RECIPE —',
  accentColor: '#c9d0d8',
}

// Chapter-one ending — plays once, back in the den after the Anteater
export const ENDING_TEXT: TextDisplayData = {
  pages: [
    'Behind the wall where the Anteater fed,\nWebbs finds its larder:\ncocoons, stuck to the stone in rows.',
    'Three of them are moving.\n\nHe cuts them free, one strand at a time.\nHis sisters — and the littlest,\nasking where her acorn toy went.',
    'He brings them home.\n\nSomeone rights the stool. Someone mends a hammock.\nThe hearth is lit again.',
    'Mum is not among them.',
    'The littlest one remembers:\nthe ants fought over Mum. Too big a prize.\n\nThey carried her off another way —\ntoward the humming. Toward the Hive.',
    'At the crossroads, the Hive tunnel is chained shut.\n\nWebbs looks at the Anteater\'s armor.\nAn axe could cut that chain.',
    'Eight legs. A new one growing.\n\nHe goes after her.',
  ],
  title:       '— HOME, FOR NOW —',
  accentColor: '#ffb35c',
  style:       'story',
}

export const CHAPTER_TWO_TEXT: TextDisplayData = {
  pages: [
    'Beyond the broken chain, the tunnel slopes down\ninto warm, humming dark.\n\nAnd caught on a root, a single thread of silk.\nMum\'s. He\'d know it anywhere.',
    'CHAPTER TWO — THE HIVE\n\nis still being dug.\nThanks for playing this far.',
  ],
  title:       '— TO BE CONTINUED —',
  accentColor: '#ffcc55',
  style:       'story',
}

// ── Inner voice ─────────────────────────────────────────────────────────────

export const THOUGHT = {
  wake:         ['Mum? …Hello?', 'It\'s my Molt Day. They must be hiding somewhere.'],
  cardRead:     ['Hiding. They\'re just hiding… right?'],
  giftOpened:   ['She finished it. She always said she\'d never get the trigger right.'],
  firstPickup:  ['Good silk. Mum always says: never walk past good silk.'],
  toothpick:    ['Someone fought with this.', 'I\'ll keep it.'],
  crafted:      ['It\'s not much.', 'It\'ll have to do.'],
  takenUnready: ['If I\'m going out there, I need to be ready.'],   // + a line per missing thing (READY_MISSING)
  takenReady:   ['Then I go. Now. Through the west door.'],
  crossroads:   ['The ants locked it behind them.', 'Good thing I can pick a lock. Mum taught me — for emergencies.'],
  lockPicked:   ['Click.', 'This counts as an emergency.'],
  colonyEnter:  ['They came through here. All of them.', 'Hold on. I\'m coming.'],
  bossArena:    ['That smell. The bristle at the door…', 'It\'s this. It was always this.'],
  axeMade:      ['Heavy. Good.', 'That chain on the Hive tunnel won\'t know what hit it.'],
  chainCut:     ['The chain\'s gone.', 'Hang on, Mum.'],
  hiveLocked:   ['A chain this thick… I\'d need something that chops, not something that pokes.'],
} as const

// After the realization: what he still needs before going
export const READY_MISSING = {
  gift:      'Mum\'s present first. She wanted me to open it.',
  toothpick: 'Something sharp. There was a glint by the hammocks…',
  weapon:    'And a real weapon. Mum\'s workbench can make one.',
} as const

// [E] at a tunnel that won't open (yet)
export const TUNNEL_THOUGHTS: Record<'drowned' | 'roots' | 'glow' | 'fall' | 'hiveSealed', readonly string[]> = {
  drowned:    ['Black water, right up to the roof.', 'Something would have to drain this… or breathe under it.'],
  roots:      ['Roots as thick as I am, knotted shut.', 'Fire would get through these. Not a toothpick.'],
  glow:       ['Glowing fungus has grown right over this one.', 'The spores sting my eyes. Not this way. Not yet.'],
  fall:       ['The roof came down here a long time ago.', 'Something strong could shift these rocks. Not me. Not yet.'],
  hiveSealed: ['Wax, poured over the whole tunnel — and a chain across it.', 'Something behind it is humming.'],
}

// Why the ants' padlock won't open yet (shown as a message, not a thought)
export const ANT_LOCK_REFUSALS = {
  clues:     "You don't know enough about what's out there to leave yet. Go look for more clues.",
  toothpick: 'You need something thin and sharp to pick this lock. Search the den.',
  gift:      "Open Mum's present before you go. You might need it out there.",
  weapon:    "Not without a real weapon. Weave one at Mum's workbench first.",
} as const

// Lines that trigger once, the first time Webbs walks near something in the den.
// `stage` limits a beat to before (`max`) or after (`min`) the realization.
interface Beat { id: string; x: number; z: number; r: number; lines: readonly string[]; min?: number; max?: number }
const DEN_BEATS: Beat[] = [
  { id: 'cake',   x:   0,   z:   0,   r: 11, lines: ['The cake\'s not even cut.', 'Nobody lit the candles.'] },
  { id: 'stools', x:  -6.9, z:   4,   r: 5,  lines: ['The stools are knocked flat. Like everyone jumped up at once.'] },
  { id: 'toy',    x:  -8.3, z:  -6.2, r: 4.5, lines: ['The littlest one\'s acorn toy. She never puts it down.'] },
  { id: 'drag',   x: -13,   z:   2.5, r: 5,  lines: ['Scrape marks in the dirt, all pointing west.', 'Like something heavy got dragged.'] },
  { id: 'pantry', x:  19,   z:  12,   r: 6,  lines: ['The pantry\'s torn open. Food everywhere…', '…and none of it eaten. They didn\'t come for food.'] },
  { id: 'bench',  x: -18,   z: -20,   r: 7,  lines: ['Mum\'s workbench.', 'The spare leg she was building me is still on the stand.'] },
  { id: 'door',   x: -42,   z:   0,   r: 9,  lines: ['The west door\'s wide open.', 'It\'s never open.'], max: CLUE_TOTAL - 1 },
  { id: 'doorGo', x: -42,   z:   0,   r: 9,  lines: ['Whatever\'s out there — I\'m coming.'], min: CLUE_TOTAL },
]

// ── Voice: thoughts that only play once per save ───────────────────────────

const SEEN_KEY = 'storySeen'

export function storySeen(id: string): boolean {
  return (registry.get<string[]>(SEEN_KEY) ?? []).includes(id)
}

export class StoryVoice {
  private thoughts: Thoughts
  constructor(thoughts: Thoughts) { this.thoughts = thoughts }

  // Say `lines` the first time `id` happens; returns false if already said
  once(id: string, lines: readonly string[], opts: { now?: boolean } = {}): boolean {
    const seen = registry.get<string[]>(SEEN_KEY) ?? []
    if (seen.includes(id)) return false
    seen.push(id)
    registry.set(SEEN_KEY, seen)
    this.thoughts.think([...lines], opts)
    return true
  }

  // Said every time (refusals, reminders)
  say(lines: string | readonly string[], opts: { now?: boolean } = {}): void {
    this.thoughts.think(typeof lines === 'string' ? lines : [...lines], opts)
  }

  // Per frame in the den: walk-up beats
  updateDen(x: number, z: number, cluesFound: number): void {
    if (this.thoughts.busy) return   // let the current thought finish first
    for (const b of DEN_BEATS) {
      if (b.min !== undefined && cluesFound < b.min) continue
      if (b.max !== undefined && cluesFound > b.max) continue
      if ((x - b.x) ** 2 + (z - b.z) ** 2 > b.r * b.r) continue
      if (this.once(b.id, b.lines)) return
    }
  }
}
