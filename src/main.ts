import Phaser from 'phaser'
import BootScene from './scenes/BootScene'
import PreloadScene from './scenes/PreloadScene'
import MainMenuScene from './scenes/MainMenuScene'
import GameScene from './scenes/GameScene'
import BossRollerScene from './scenes/BossRollerScene'
import HUDScene from './ui/HUD'
import CraftingMenu from './ui/CraftingMenu'

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
  scene: [BootScene, PreloadScene, MainMenuScene, GameScene, BossRollerScene, HUDScene, CraftingMenu]
}

const game = new Phaser.Game(config)
export default game
