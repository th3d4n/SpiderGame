import Phaser from 'phaser'
import { RECIPES, type Recipe, type MaterialType } from '../systems/CraftingSystem'
import { WEAPON_COLORS } from '../config/WeaponData'
import { drawWeaponIcon } from './WeaponIcon'

const ACCENT     = 0x7777ff
const ACCENT_STR = '#7777ff'
const PANEL_BG   = 0x0d0d1a
const DIM_STR    = '#555566'
const WHITE_STR  = '#ccccdd'

const MAT_ABBREV: Record<MaterialType, string> = {
  SilkThread:   'SLK',
  ChitinShard:  'CHT',
  VenomGland:   'VNM',
  WebFluid:     'WBF',
  CrystalDust:  'CRS',
  BoneFragment: 'BNF',
  Thistle:      'THS',
}

function formatCost(materials: Partial<Record<MaterialType, number>>): string {
  return (Object.keys(materials) as MaterialType[])
    .map(m => `${materials[m]}×${MAT_ABBREV[m]}`)
    .join('  ')
}

export default class CraftingMenu extends Phaser.Scene {
  private selectedIndex = 0
  private rowTexts:    Phaser.GameObjects.Text[] = []
  private costText!:   Phaser.GameObjects.Text
  private statusText!: Phaser.GameObjects.Text
  private inventory!:  Partial<Record<MaterialType, number>>
  private legTier!:    number
  private spaceKey!:   Phaser.Input.Keyboard.Key
  private escKey!:     Phaser.Input.Keyboard.Key
  private upKey!:      Phaser.Input.Keyboard.Key
  private downKey!:    Phaser.Input.Keyboard.Key
  private flashTween:  Phaser.Tweens.Tween | null = null
  private invCountTexts: Phaser.GameObjects.Text[] = []

  constructor() {
    super({ key: 'CraftingMenu' })
  }

  create() {
    // Reset per-launch state — Phaser reuses the scene instance across stop/launch,
    // so stale references to destroyed Text objects from a prior session would crash
    // renderSelection() on the second visit.
    this.selectedIndex  = 0
    this.rowTexts       = []
    this.invCountTexts  = []
    this.flashTween     = null

    const { width, height } = this.scale

    this.inventory = this.registry.get('craftingInventory') ?? {}
    this.legTier   = this.registry.get('legTier') ?? 0

    // Pause the game world while menu is open
    const caller = this.registry.get('callerScene') as string ?? 'HomeBaseScene'
    this.scene.pause(caller)

    // Dark overlay
    this.add.rectangle(width / 2, height / 2, width, height, 0x000000, 0.72)

    // Panel
    const panelW = 440, panelH = 380
    const px = width / 2 - panelW / 2
    const py = height / 2 - panelH / 2
    this.add.rectangle(width / 2, height / 2, panelW, panelH, PANEL_BG, 0.97)
      .setStrokeStyle(1.5, ACCENT)

    // Title
    this.add.text(width / 2, py + 20, 'WORKBENCH', {
      fontFamily: 'monospace',
      fontSize: '15px',
      color: ACCENT_STR,
    }).setOrigin(0.5, 0)

    // Divider
    this.add.line(width / 2, py + 44, -panelW / 2 + 16, 0, panelW / 2 - 16, 0, ACCENT, 0.3)

    // Recipe rows — icon + label side by side
    const rowStartY = py + 60
    const rowH      = 32
    RECIPES.forEach((recipe, i) => {
      const y = rowStartY + i * rowH
      const color = WEAPON_COLORS[recipe.produces] ?? 0xccccdd
      const icon = this.add.graphics()
      icon.setPosition(px + 28, y + 8)
      drawWeaponIcon(icon, recipe.produces, color)
      const text = this.add.text(px + 46, y, this.rowLabel(recipe), {
        fontFamily: 'monospace',
        fontSize:   '12px',
        color:      DIM_STR,
      })
      this.rowTexts.push(text)
      // Hold the icon as part of the row so it can be tinted alongside the text
      void icon
    })

    // Cost display
    this.costText = this.add.text(width / 2, py + panelH - 76, '', {
      fontFamily: 'monospace',
      fontSize:   '11px',
      color:      '#888899',
    }).setOrigin(0.5, 0)

    // Status flash line
    this.statusText = this.add.text(width / 2, py + panelH - 54, '', {
      fontFamily: 'monospace',
      fontSize:   '12px',
      color:      ACCENT_STR,
    }).setOrigin(0.5, 0)

    // Inventory sidebar
    this.buildInventoryPanel(px, py, panelW)

    // Controls hint
    this.add.text(width / 2, py + panelH - 26, '↑↓ navigate    SPACE craft    ESC close', {
      fontFamily: 'monospace',
      fontSize:   '10px',
      color:      DIM_STR,
    }).setOrigin(0.5, 0)

    // Input
    this.upKey    = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.UP)
    this.downKey  = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.DOWN)
    this.spaceKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE)
    this.escKey   = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.ESC)

    this.renderSelection()
  }

  private rowLabel(recipe: Recipe): string {
    if (recipe.findOnly) return `${recipe.displayName} [FIND ONLY]`
    const locked = recipe.requiredTier > this.legTier ? ' [LOCKED]' : ''
    return `${recipe.displayName}${locked}`
  }

  private renderSelection(): void {
    const canCraft = this.canCraftSelected()
    RECIPES.forEach((recipe, i) => {
      const text = this.rowTexts[i]
      if (i === this.selectedIndex) {
        text.setColor(canCraft ? ACCENT_STR : '#cc4455')
        text.setText('▶ ' + this.rowLabel(recipe))
      } else {
        text.setColor(DIM_STR)
        text.setText(this.rowLabel(recipe))
      }
    })

    const recipe = RECIPES[this.selectedIndex]
    this.costText.setText('Cost: ' + formatCost(recipe.materials))
    this.statusText.setText('')
  }

  private canCraftSelected(): boolean {
    const recipe = RECIPES[this.selectedIndex]
    if (recipe.requiredTier > this.legTier) return false
    for (const mat of Object.keys(recipe.materials) as MaterialType[]) {
      const needed = recipe.materials[mat] ?? 0
      const have   = this.inventory[mat] ?? 0
      if (have < needed) return false
    }
    return true
  }

  update() {
    if (Phaser.Input.Keyboard.JustDown(this.upKey)) {
      this.selectedIndex = (this.selectedIndex - 1 + RECIPES.length) % RECIPES.length
      this.renderSelection()
    }
    if (Phaser.Input.Keyboard.JustDown(this.downKey)) {
      this.selectedIndex = (this.selectedIndex + 1) % RECIPES.length
      this.renderSelection()
    }
    if (Phaser.Input.Keyboard.JustDown(this.spaceKey)) {
      this.tryCraft()
    }
    if (Phaser.Input.Keyboard.JustDown(this.escKey)) {
      this.closeMenu()
    }
  }

  private tryCraft(): void {
    const recipeSel = RECIPES[this.selectedIndex]
    if (recipeSel.findOnly) {
      this.flashStatus('Cannot craft — find this weapon in the world', '#cc4455')
      return
    }
    if (!this.canCraftSelected()) {
      this.flashStatus('Cannot craft — missing materials', '#cc4455')
      return
    }
    const recipe = RECIPES[this.selectedIndex]
    // Deduct materials locally so display updates immediately
    for (const mat of Object.keys(recipe.materials) as MaterialType[]) {
      const needed = recipe.materials[mat] ?? 0
      this.inventory[mat] = (this.inventory[mat] ?? 0) - needed
    }
    // Signal GameScene to equip this weapon
    this.registry.set('pendingEquip', recipe.produces)
    this.registry.set('craftingInventory', { ...this.inventory })

    // Fire notification overlay popup
    this.events.emit('itemCrafted', {
      displayName: recipe.displayName,
      color:       WEAPON_COLORS[recipe.produces] ?? 0xccccdd,
    })

    this.flashStatus(`Crafted: ${recipe.displayName}`, ACCENT_STR)
    this.refreshInventoryPanel()
    this.renderSelection()
  }

  private flashStatus(msg: string, color: string): void {
    if (this.flashTween) this.flashTween.stop()
    this.statusText.setText(msg).setColor(color).setAlpha(1)
    this.flashTween = this.tweens.add({
      targets:  this.statusText,
      alpha:    0,
      delay:    900,
      duration: 400,
    })
  }

  private closeMenu(): void {
    const caller = this.registry.get('callerScene') as string ?? 'HomeBaseScene'
    this.scene.resume(caller)
    this.scene.stop()
  }

  // Inventory display panel — top right of menu, shows current stock
  private buildInventoryPanel(px: number, py: number, panelW: number): void {
    const ix = px + panelW - 130
    this.add.text(ix, py + 60, 'INVENTORY', {
      fontFamily: 'monospace',
      fontSize:   '10px',
      color:      DIM_STR,
    })
    const mats = Object.keys(MAT_ABBREV) as MaterialType[]
    this.invCountTexts = []
    mats.forEach((mat, i) => {
      const amt = this.inventory[mat] ?? 0
      const t = this.add.text(ix, py + 76 + i * 16, `${MAT_ABBREV[mat]}  ${amt}`, {
        fontFamily: 'monospace',
        fontSize:   '10px',
        color:      amt > 0 ? WHITE_STR : DIM_STR,
      })
      this.invCountTexts.push(t)
    })
  }

  private refreshInventoryPanel(): void {
    const mats = Object.keys(MAT_ABBREV) as MaterialType[]
    mats.forEach((mat, i) => {
      const amt = this.inventory[mat] ?? 0
      this.invCountTexts[i].setText(`${MAT_ABBREV[mat]}  ${amt}`)
      this.invCountTexts[i].setColor(amt > 0 ? WHITE_STR : DIM_STR)
    })
  }
}
