"""Which recordings feed which multi-take sound (see build_sprites.py).

Per source:
  file      path under the library root
  whole     use the whole file as one take (Kenney-style single takes)
  n / how   how many takes to keep ('spread' through the file, or 'loudest')
  gate      energy gate in dB below the loudest 10 ms window (default -34)
  hold      s of quiet that ends a take (default 0.08)
  min_len / max_len / tail / fade   take length limits and release
  start / dur   only analyse this window of a long recording
  af        extra ffmpeg filters (EQ, pitch) before cutting
Licenses: CREDITS.md next to this file.  Only CC0 / Sonniss-GDC sources here —
Bluezone's free packs need attribution and forbid extractable files (a web
game serves its audio as public URLs), so they are not used.
"""

R = 'Raw\\Sounds\\'
S = 'Raw\\Sounds\\Sonniss\\'
C = 'Chosen and named\\Extra\\'


def kenney(*names, max_len=None):
    return [{'file': R + n + '.ogg', 'whole': True, **({'max_len': max_len} if max_len else {})} for n in names]


def whole(*paths, max_len=None):
    return [{'file': p, 'whole': True, **({'max_len': max_len} if max_len else {})} for p in paths]


SPEC = {
    # ── Webbs ─────────────────────────────────────────────────────────────────
    # Light, quick feet: an animal-footsteps session, single steps only
    'footstep_dirt': {'src': [
        {'file': R + '658429__ienba__animal-footsteps.wav', 'n': 10, 'max_len': 0.22, 'hold': 0.05, 'gate': -30},
    ]},
    'footstep_stone': {'src': kenney('footstep_concrete_000', 'footstep_concrete_001', 'footstep_concrete_002',
                                     'footstep_concrete_003', 'footstep_concrete_004')},
    'web_swing': {'src': whole(R + '489997__falcospizaetus__swoosh04.wav', R + '489998__falcospizaetus__swoosh05.wav',
                               R + '507466__danjocross__clean-fast-swoosh.wav', max_len=0.7)},
    'webbs_dodge': {'src': whole(R + '683101__florianreichelt__quick-woosh.mp3', R + '825632__rg2cents__whoosequick.wav',
                                 R + '617267__sheblum__wooh.wav', max_len=0.6)},
    'web_fire': {'src': [{'file': C + 'web_fire_EDIT_BEFORE_USE.wav', 'n': 5, 'max_len': 0.5}]},
    # Sticky splats: a slime-squish session (57 events) — short wet ones
    'web_attach_wall': {'src': [{'file': R + '680447__rubberduck9999__slime-squishing-sounds.wav', 'n': 7,
                                 'dur': 70, 'max_len': 0.32, 'hold': 0.05}]},
    'web_attach_enemy': {'src': [{'file': R + '680447__rubberduck9999__slime-squishing-sounds.wav', 'n': 6,
                                  'start': 70, 'max_len': 0.45, 'hold': 0.06}]},

    # ── Weapons ───────────────────────────────────────────────────────────────
    'sword_swing': {'src': whole(R + '840716__nomagician__sword-swing-1.mp3', R + '840717__nomagician__sword-swing-3.mp3',
                                 R + '522701__julianmateo__weapon-sword-metal-sword-swing-fast-i.wav',
                                 R + '59992__qubodup__swosh-sword-swing.flac', R + '367182__gaussthewizard__swing.wav',
                                 R + '562191__gristi__snd_swing_whoosh.wav', max_len=0.6)},
    'sword_hit_enemy': {'src': whole(R + '411122__vdovitsky__sword-hits-the-body.wav', R + '420674__sypherzent__deep-cut-slash-gash.wav',
                                     R + 'knifeSlice.ogg', R + 'knifeSlice2.ogg', max_len=0.7)},
    'axe_hit_enemy': {'src': [{'file': C + 'axe_hit_enemy.wav', 'n': 5, 'max_len': 0.9, 'hold': 0.12}]},
    'axe_hit_ground': {'src': [{'file': S + 'Justsoundeffects - Melee Weapons\\WEAPAxe_One-Handed Axe Drops_JSE_MW.wav',
                                'n': 6, 'max_len': 0.7, 'hold': 0.1}]},
    'toothpick_stab': {'src': [{'file': C + 'toothpick_stab.wav', 'n': 8, 'max_len': 0.45}]},
    'toothpick_hit': {'src': [{'file': C + 'toothpick_hit.wav', 'n': 8, 'max_len': 0.5, 'hold': 0.1}]},
    'bow_release': {'src': whole(R + '263675__porkmuncher__bow_release.wav', R + '384918__ali_6868__bow-release-bow-and-arrow-3.wav',
                                 R + '394179__saturdaysoundguy__longbow-release-2.wav', R + '443832__checholio__42-disparar-flecha.wav',
                                 max_len=0.8)},
    'bow_hit_enemy': {'src': whole(R + '161098__braqoon__arrow_damage.wav', R + '574044__thecrow_br__arrow.wav', max_len=0.6)},
    'bow_hit_wall': {'src': kenney('impactWood_light_000', 'impactWood_light_001', 'impactWood_light_002',
                                   'impactWood_light_003', 'impactWood_light_004')},
    # Every blade/stab hit on a bug also cracks its shell (celery-snap foley)
    'chitin_crack': {'src': [{'file': S + 'Justsoundeffects - Gore Mini Pack\\GOREBone_Bone Breaks Celery 01_JSE_GMP.wav',
                              'n': 8, 'max_len': 0.45, 'hold': 0.06}]},

    # ── Bugs ──────────────────────────────────────────────────────────────────
    'centipede_death': {'src': [{'file': C + 'centipede_death_generic.wav', 'n': 6, 'max_len': 1.0, 'hold': 0.12}]},
    'beetle_hit': {'src': kenney('impactPlate_heavy_000', 'impactPlate_heavy_001', 'impactPlate_heavy_002',
                                 'impactPlate_heavy_003', 'impactPlate_heavy_004')},
    # Small bugs dying: a crunch, then a wet squish
    'bug_squish': {'src': [
        {'file': S + 'Justsoundeffects - Gore Mini Pack\\GOREBone_Bone Breaks Celery 01_JSE_GMP.wav', 'n': 4,
         'max_len': 0.5, 'how': 'loudest'},
        {'file': S + 'Justsoundeffects - Gore Mini Pack\\GORESplt_Gore Splatter 01_JSE_GMP.wav', 'n': 4, 'max_len': 0.5},
    ]},
    # Mandible clicks: tiny mechanism clicks and scratches
    'ant_click': {'src': kenney('scratch_001', 'scratch_002', 'scratch_003', 'scratch_004', 'scratch_005')},
    # Hiss: short steam bursts, high and thin
    'ant_hiss': {'src': [{'file': S + 'Justsoundeffects - Steampunk Gadgets\\AIRBrst_Steam Release Short 03_JSE_SG_Mono.wav',
                          'n': 5, 'max_len': 0.7, 'af': 'highpass=f=1800'}]},
    'sac_burst': {'src': [{'file': S + 'Justsoundeffects - Gore Mini Pack\\GORESplt_Gore Splatter 01_JSE_GMP.wav', 'n': 4,
                           'max_len': 0.9, 'how': 'loudest'}]},

    # ── Colony traps + cave ───────────────────────────────────────────────────
    'trap_click': {'src': kenney('metalClick', 'metalLatch')},
    'trap_spike': {'src': kenney('drawKnife1', 'drawKnife2', 'drawKnife3')},
    'rubble_fall': {'src': kenney('impactMining_000', 'impactMining_001', 'impactMining_002', 'impactMining_003', 'impactMining_004')},
    'cave_drip': {'src': [
        *whole(S + 'InMotionAudio - Cave Design\\WATRDrip_SingleDrip03_InMotionAudio_CaveDesign.wav'),
        {'file': S + 'InMotionAudio - Cave Design\\WATRDrip_SingleDripDesign05_InMotionAudio_CaveDesign.wav', 'n': 3,
         'max_len': 1.2, 'gate': -40},
    ]},

    # ── The Anteater ──────────────────────────────────────────────────────────
    'boss_snort': {'src': [
        *whole(S + 'Mechanical Wave - Farm Animals\\ANMLFarm_Pig Squeal and Snort-18_MWSFX_FA.wav', max_len=1.2),
        {'file': S + 'Justsoundeffects - Steampunk Gadgets\\AIRBrst_Steam Release Short 03_JSE_SG_Mono.wav', 'n': 3,
         'max_len': 0.8, 'af': 'lowpass=f=2500'},
    ]},
    'boss_sniff': {'src': [{'file': S + 'Systematic Sound - General Ambience Series - Rural Countryside 01\\'
                                        'AMBFarm_Ranch Horse Pasture Snorting Chewing Trotting_SYSO_SYSO011.wav',
                            'n': 6, 'how': 'loudest', 'min_len': 0.25, 'max_len': 1.1, 'hold': 0.12}]},
    'boss_growl': {'src': [
        {'file': R + '673811__lucasduff__creature-reeling-from-an-attack.wav', 'n': 3, 'max_len': 1.6, 'hold': 0.15},
        *whole(R + '686721__up2067433__monster_growl_02.wav', R + '686722__up2067433__monster_growl_03.wav', max_len=1.8),
    ]},
    'tongue_lash': {'src': whole(S + 'Rescopic Sound - Distinct Whooshes\\WHSH_Deviant-Whoosh Flabby Slow 09_RSCPC_DW.wav',
                                 S + 'Rescopic Sound - Distinct Whooshes\\WHSH_Watery-Whoosh FIzzy Fast 03_RSCPC_DW.wav',
                                 max_len=1.1)},
    'tongue_slap': {'src': [{'file': R + '680447__rubberduck9999__slime-squishing-sounds.wav', 'n': 4, 'how': 'loudest',
                             'max_len': 0.6, 'hold': 0.08}]},

    # ── Crossroads locks ──────────────────────────────────────────────────────
    'lock_click': {'src': kenney('metalClick', 'switch3', 'switch7', 'switch12')},
    'lock_open': {'src': kenney('metalLatch', 'handleCoins2')},
    'gate_creak': {'src': [{'file': S + 'Jake Fielding - Squeaky Gates\\DOORGate_Wooden Metal Hinge Creaks_Jake Fielding_Squeaky Gates.wav',
                            'n': 4, 'max_len': 1.6, 'hold': 0.2, 'how': 'loudest'}]},
    'chain_snap': {'src': [{'file': S + 'Pole Position - The Metal Hit Sweeteners Library\\Toolbox - DROP.wav', 'n': 4,
                            'max_len': 1.0, 'how': 'loudest'}]},
    'wax_crumble': {'src': [{'file': S + 'InMotionAudio - Wood\\WOODBrk_Snap09_InMotionAudio_Wood.wav', 'n': 4, 'max_len': 0.6},
                            {'file': S + 'Mechanical Wave - Cardboard and Paper\\PAPRHndl_Paper Sheet Crumple_ 04_MWSFX_CDAP.wav',
                             'n': 2, 'max_len': 1.2}]},

}
