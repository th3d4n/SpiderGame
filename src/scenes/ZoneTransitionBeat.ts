import Phaser from 'phaser'

interface BeatData {
  targetKey: string
  label:     string
  subtitle:  string
}

// Full-screen black beat between zone transitions.
// Fades in a zone label + subtitle, holds briefly, then starts the target scene.
// Space or M skips the hold early.
export default class ZoneTransitionBeat extends Phaser.Scene {
  constructor() {
    super({ key: 'ZoneTransitionBeat' })
  }

  create() {
    const data = this.registry.get('transitionBeatData') as BeatData | undefined
    if (!data?.targetKey) {
      this.scene.start('HomeBaseScene')
      return
    }

    const { width, height } = this.scale
    const cx = width  / 2
    const cy = height / 2

    this.add.rectangle(cx, cy, width, height, 0x000000, 1)

    const label = this.add.text(cx, cy - 18, data.label, {
      fontFamily: 'monospace',
      fontSize:   '26px',
      color:      '#ccccff',
    }).setOrigin(0.5).setAlpha(0)

    const sub = this.add.text(cx, cy + 22, data.subtitle, {
      fontFamily: 'monospace',
      fontSize:   '13px',
      color:      '#445566',
    }).setOrigin(0.5).setAlpha(0)

    this.tweens.add({
      targets:  [label, sub],
      alpha:    1,
      duration: 350,
      ease:     'Power2',
    })

    let advanced = false
    const advance = () => {
      if (advanced) return
      advanced = true
      this.tweens.add({
        targets:    [label, sub],
        alpha:      0,
        duration:   300,
        delay:      150,
        onComplete: () => this.scene.start(data.targetKey),
      })
    }

    this.time.delayedCall(2000, advance)
    this.input.keyboard!.once('keydown-SPACE', advance)
    this.input.keyboard!.once('keydown-M',     advance)
  }
}
