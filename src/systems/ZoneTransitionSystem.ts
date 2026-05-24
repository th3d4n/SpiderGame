import Phaser from 'phaser'

export type ExitDir = 'left' | 'right' | 'up' | 'down'

const OPPOSITE: Record<ExitDir, ExitDir> = {
  left:  'right',
  right: 'left',
  up:    'down',
  down:  'up',
}

// Registry keys used by the system
const KEY_ENTRY_FROM = 'zoneEntryFrom'
const KEY_HEALTH     = 'health'

const ZONE_BEATS: Record<string, { label: string; subtitle: string }> = {
  HomeBaseScene:   { label: 'HOME BASE',            subtitle: 'The Den.'                            },
  AntColonyScene:  { label: 'ZONE 1 — ANT COLONY', subtitle: 'The western passage.'                },
  BossRollerScene: { label: 'THE BOSS CHAMBER',     subtitle: 'The thing at the end of the tunnel.' },
}

export class ZoneTransitionSystem {

  /**
   * Fade out, store player state, then show a brief zone-label beat
   * before starting the target scene.
   * exitDir: the direction Webbs is leaving through ('left' = walked off the left edge).
   */
  static transition(
    scene:     Phaser.Scene,
    targetKey: string,
    exitDir:   ExitDir,
    health?:   number,
  ): void {
    scene.registry.set(KEY_ENTRY_FROM, OPPOSITE[exitDir])
    if (health !== undefined) scene.registry.set(KEY_HEALTH, health)

    const beat = ZONE_BEATS[targetKey] ?? { label: targetKey, subtitle: '' }
    scene.registry.set('transitionBeatData', {
      targetKey,
      label:    beat.label,
      subtitle: beat.subtitle,
    })

    scene.cameras.main.fade(400, 0, 0, 0)
    scene.time.delayedCall(400, () => scene.scene.start('ZoneTransitionBeat'))
  }

  /**
   * Call in the new scene's create() to get the correct Webbs spawn X.
   * Returns fallbackX when there is no entry direction (e.g. first game load).
   */
  static spawnX(scene: Phaser.Scene, worldW: number, fallbackX: number): number {
    const from = scene.registry.get(KEY_ENTRY_FROM) as ExitDir | undefined
    if (from === 'right') return worldW - 180
    if (from === 'left')  return 180
    return fallbackX
  }

  /**
   * Show a brief zone-name banner at the top of the screen that fades out.
   * Call at the end of each scene's create().
   */
  static announceZone(scene: Phaser.Scene, label: string): void {
    const { width } = scene.scale
    const txt = scene.add.text(width / 2, 70, label, {
      fontFamily: 'monospace',
      fontSize:   '18px',
      color:      '#ccccff',
      stroke:     '#000000',
      strokeThickness: 3,
      backgroundColor: '#00000088',
      padding:    { x: 14, y: 6 },
    })
      .setScrollFactor(0)
      .setOrigin(0.5)
      .setDepth(100)
      .setAlpha(0)

    scene.tweens.add({
      targets:  txt,
      alpha:    1,
      duration: 400,
      ease:     'Power2',
      onComplete: () => {
        scene.tweens.add({
          targets:    txt,
          alpha:      0,
          duration:   500,
          delay:      1700,
          onComplete: () => txt.destroy(),
        })
      },
    })
  }
}
