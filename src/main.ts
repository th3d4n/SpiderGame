import Phaser from 'phaser'
import BootScene from './scenes/BootScene'
import PreloadScene from './scenes/PreloadScene'
import MainMenuScene from './scenes/MainMenuScene'
import HomeBaseScene from './scenes/HomeBaseScene'
import AntColonyScene from './scenes/AntColonyScene'
import GameScene from './scenes/GameScene'
import BossRollerScene from './scenes/BossRollerScene'
import HUDScene from './ui/HUD'
import CraftingMenu from './ui/CraftingMenu'
import EquipScreen from './ui/EquipScreen'
import PickupNotification from './ui/PickupNotification'

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
  // HomeBaseScene is the entry point after the main menu.
  // GameScene is kept registered for direct dev access.
  scene: [BootScene, PreloadScene, MainMenuScene, HomeBaseScene, AntColonyScene, GameScene, BossRollerScene, HUDScene, CraftingMenu, EquipScreen, PickupNotification]
}

const game = new Phaser.Game(config)
export default game
