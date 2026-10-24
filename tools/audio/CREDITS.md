# Sound sources and licenses

These are checked against each source's page on 2026-10-24.

The game ships only:

- CC0 sounds;
- Sonniss #GameAudioGDC bundle sounds: royalty-free, commercial use, no attribution, but the raw files must not be offered as a sound library.

Builder scratch WAVs (`tools/audio/.work/`) are git-ignored.

## Freesound.org — all CC0

Credit is not required, but given here as a courtesy.

| ID | Title | Author | Used for |
|---|---|---|---|
| 658429 | Animal Footsteps | IENBA | footstep_dirt |
| 489997, 489998 | Swoosh04 / Swoosh05 | falcospizaetus | web_swing |
| 507466 | Clean fast Swoosh | Danjocross | web_swing |
| 683101 | quick woosh | florianreichelt | webbs_dodge |
| 825632 | whoosequick | RG2Cents | webbs_dodge |
| 617267 | Wooh! | sheblum | webbs_dodge |
| 680447 | slime - squishing sounds | rubberduck9999 | web_attach_*, tongue_slap |
| 840716, 840717 | Sword Swing 1 / 3 | Nomagician | sword_swing (also the axe, pitched) |
| 522701 | Weapon, Sword, Metal sword, Swing | julianmateo_ | sword_swing |
| 59992 | Swosh Sword Swing | qubodup | sword_swing |
| 367182 | swing.mp3 | GaussTheWizard | sword_swing |
| 562191 | snd_swing_whoosh | gristi | sword_swing |
| 411122 | Sword hits the body | vdovitsky | sword_hit_enemy |
| 420674 | Deep Cut / Slash / Gash | SypherZent | sword_hit_enemy |
| 263675 | Bow_release | PorkMuncher | bow_release |
| 384918 | Bow Release (Bow and Arrow) 3 | Ali_6868 | bow_release |
| 394179 | Longbow Release 2 | saturdaysoundguy | bow_release |
| 443832 | 42 Disparar Flecha | checholio | bow_release |
| 161098 | arrow_damage | braqoon | bow_hit_enemy |
| 574044 | Arrow | thecrow_br | bow_hit_enemy |
| 673811 | Creature Reeling From an Attack | LucasDuff | boss_growl |
| 686721, 686722 | Monster_growl_02 / 03 | up2067433 | boss_growl |
| 259542 | stabs | nicktermer | toothpick_stab |
| 352870 | Footsteps Dirt Gravel | PotatokingXII | (earlier footstep source) |
| 815415 | AAD Sword Fall On Dirt | AwenAudio | sword_hit_ground |
| 514162 | Swinging axe | ZHRØ | (earlier axe swing) |
| 521869 | Skittering bugs | Mendenhall02 | centipede_skitter |
| 502211 | Beetle Squark5 | warrenXG | centipede_attack |
| 568000, 559621 | monster_sound_big/medium_death | Leadstarson | beetle_death, webbs_death |
| 547434 | Loop_SimulatedHeartbeat_Normal | RavenWolfProds | heartbeat |
| 795440 | Grunting | randbsoundbites | half_hp_pain |
| 403319 | Underground Tunnel | bruce965 | amb_colony_entry |
| 516566 | Dark Dungeon Ambience | Kinoton | amb_colony_mid |
| 789913 | Underground Eerie Breathing Ambience 8 | newlocknew | amb_colony_deep |
| 171178 | MonsterGrowl | yatoimtop | boss_idle |
| 734841 | dyingBeast | QuantumFellow | boss_death |
| 852822 | Subterranean Howling Wind Loop | KolbyRFX | amb_boss |
| 640204 | Heavy Metal Thud on Ground | 7of9Designs | (earlier axe ground hit) |
| 241807 | silly filly stampede heels | martian | beetle_charging |

Not shipped, and needs credit if it ever is: 346265 "RPG SFX #1 - Item Jingle" by Sirkoto51 is
**CC BY 4.0**.

## Kenney.nl — CC0

These packs are used:

- Impact Sounds: impact families for plates, wood, mining and generic hits.
- RPG Audio: book flips, metal click and latch, draw knife, handle coins.
- Interface Sounds: clicks, switches, scratches, plucks, confirmations.

## Sonniss #GameAudioGDC 2024 bundle

Royalty-free, commercial use, no attribution. Raw files must not be redistributed as sound effects.

| Publisher and pack | Used for |
|---|---|
| Justsoundeffects – Gore Mini Pack | chitin_crack, bug_squish, sac_burst, toothpick_hit |
| Justsoundeffects – Melee Weapons | axe_hit_enemy, axe_hit_ground |
| Justsoundeffects – Steampunk Gadgets | ant_hiss, boss_snort, web_pull_loop |
| Mechanical Wave – Farm Animals (pig snort) | boss_snort |
| Mechanical Wave – Cardboard and Paper | wax_crumble |
| Systematic Sound – Rural Countryside 01 (horse snorts) | boss_sniff |
| Rescopic Sound – Distinct Whooshes | tongue_lash, centipede_burst |
| Jake Fielding – Squeaky Gates | gate_creak |
| Pole Position – Metal Hit Sweeteners (toolbox drop) | chain_snap |
| InMotionAudio – Wood | wax_crumble |
| InMotionAudio – Cave Design | cave_drip, amb_homebase |
| David Dumais – Monster Sound FX (creature growl) | beetle_charge_windup, boss_windup |

The David Dumais file sits loose in the library rather than in a pack folder. Its name format matches the GDC bundles, but confirm before release.

## Not used: Bluezone Corporation free packs

Their terms require attribution and say the files must not be extractable from the project. A web game serves
its audio as public URLs, so these sounds were replaced with Kenney CC0 sounds (rubble, lock clicks, ant clicks)
or dropped (`boss_charge`).

## Origin not recorded

These came from the first sound pass ("Chosen and named"), and their source isn't written down:

- webbs_damage, workbench_open, crafting_complete, web_launcher_equipped
- ui_back, ui_title_*, celeb_*, xp_gain_small
- energy_depleted, stamina_winded, flame_loop, flame_hit, boss_suction
- boss_phase_change ("GRWL ROAR ANGRY")

Check these before any commercial release.
