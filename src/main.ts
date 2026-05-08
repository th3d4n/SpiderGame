import Phaser from 'phaser'

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  width: 1280,
  height: 720,
  backgroundColor: '#1a1a2e',
  parent: 'game-container',
  physics: {
    default: 'arcade',
    arcade: { debug: false }
  },
  scene: []
}

const game = new Phaser.Game(config)
export default game
