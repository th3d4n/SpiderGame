import { RECIPES, type Recipe, type MaterialType } from '../systems/CraftingSystem'
import { WEAPON_COLORS } from '../config/WeaponData'
import { registry } from '../core/Registry'
import type { InputManager } from '../core/InputManager'
import type { WeaponType } from '../systems/WeaponSystem'

const MAT_ABBREV: Record<MaterialType, string> = {
  SilkThread: 'SLK', ChitinShard: 'CHT', VenomGland: 'VNM',
  WebFluid:   'WBF', CrystalDust: 'CRS', BoneFragment:'BNF',
  Thistle:    'THS', Stone:       'STN', Wood:        'WOD',
  BugPartsAnt:'ANT', DriedFungus: 'FNG', CrystalShard:'CSH',
}

export class CraftingMenu3D {
  private overlay:   HTMLElement
  private panel:     HTMLDivElement
  private rowEls:    HTMLDivElement[]                 = []
  private costEl!:   HTMLDivElement
  private statusEl!: HTMLDivElement
  private invEls:    Map<MaterialType, HTMLSpanElement> = new Map()

  private selectedIndex = 0
  private inventory: Partial<Record<MaterialType, number>> = {}
  private legTier   = 0
  private statusTimer: ReturnType<typeof setTimeout> | null = null

  isOpen  = false
  onClose?: () => void

  constructor(menuOverlay: HTMLElement) {
    this.overlay = menuOverlay
    this.panel   = this.buildPanel()
    menuOverlay.appendChild(this.panel)
  }

  show(): void {
    this.inventory     = { ...(registry.get<Partial<Record<MaterialType, number>>>('craftingInventory') ?? {}) }
    this.legTier       = registry.get<number>('legTier') ?? 0
    this.selectedIndex = 0
    this.panel.style.display = 'flex'
    this.overlay.style.display = 'block'
    this.isOpen = true
    this.refreshInventory()
    this.renderSelection()
  }

  update(input: InputManager): void {
    if (!this.isOpen) return
    if (input.justDown('ArrowUp'))   { this.selectedIndex = (this.selectedIndex - 1 + RECIPES.length) % RECIPES.length; this.renderSelection() }
    if (input.justDown('ArrowDown')) { this.selectedIndex = (this.selectedIndex + 1) % RECIPES.length; this.renderSelection() }
    if (input.justDown('Space'))   this.tryCraft()
    if (input.justDown('Escape'))  this.close()
  }

  close(): void {
    this.panel.style.display = 'none'
    this.overlay.style.display = 'none'
    this.isOpen = false
    this.onClose?.()
  }

  // ── Panel construction ───────────────────────────────────────────────────────

  private buildPanel(): HTMLDivElement {
    const panel = document.createElement('div')
    panel.style.cssText = [
      'display:none; position:absolute; top:50%; left:50%;',
      'transform:translate(-50%,-50%);',
      'width:520px; background:#0d0d1a; border:1.5px solid #7777ff;',
      'font-family:monospace; color:#ccccdd; user-select:none;',
    ].join('')

    // Title
    const title = document.createElement('div')
    title.style.cssText = 'padding:12px 20px; color:#7777ff; font-size:13px; letter-spacing:3px; border-bottom:1px solid rgba(119,119,255,0.3);'
    title.textContent = 'WORKBENCH'
    panel.appendChild(title)

    // Body row
    const body = document.createElement('div')
    body.style.cssText = 'display:flex;'

    // Left: recipe list + controls
    const left = document.createElement('div')
    left.style.cssText = 'flex:1; padding:12px 16px;'

    this.rowEls = []
    for (let i = 0; i < RECIPES.length; i++) {
      const recipe = RECIPES[i]
      const row = document.createElement('div')
      row.style.cssText = 'display:flex; align-items:center; gap:8px; padding:6px 8px; font-size:12px; border-radius:2px; margin-bottom:2px; cursor:default;'
      row.addEventListener('click', () => { this.selectedIndex = i; this.renderSelection() })

      const dot = document.createElement('span')
      const c = WEAPON_COLORS[recipe.produces]
      dot.style.cssText = `width:8px; height:8px; border-radius:50%; flex-shrink:0; background:#${c.toString(16).padStart(6,'0')};`

      const name = document.createElement('span')
      row.appendChild(dot)
      row.appendChild(name)
      left.appendChild(row)
      this.rowEls.push(row)
    }

    // Cost + status
    this.costEl = document.createElement('div')
    this.costEl.style.cssText = 'font-size:11px; color:#888899; padding:10px 8px 4px; border-top:1px solid #1e1e2e; margin-top:4px;'
    left.appendChild(this.costEl)

    this.statusEl = document.createElement('div')
    this.statusEl.style.cssText = 'font-size:11px; color:#7777ff; padding:2px 8px 8px; min-height:20px;'
    left.appendChild(this.statusEl)

    const hint = document.createElement('div')
    hint.style.cssText = 'font-size:10px; color:#445566; padding:0 8px 12px;'
    hint.textContent = '↑↓  navigate   Space  craft   Esc  close'
    left.appendChild(hint)

    // Right: inventory
    const right = document.createElement('div')
    right.style.cssText = 'width:130px; padding:12px; border-left:1px solid #1e1e2e; font-size:10px;'
    const invTitle = document.createElement('div')
    invTitle.style.cssText = 'color:#445566; letter-spacing:1px; margin-bottom:8px;'
    invTitle.textContent = 'INVENTORY'
    right.appendChild(invTitle)

    for (const mat of Object.keys(MAT_ABBREV) as MaterialType[]) {
      const row = document.createElement('div')
      row.style.cssText = 'display:flex; justify-content:space-between; margin-bottom:3px;'
      const abbr = document.createElement('span')
      abbr.style.color = '#445566'
      abbr.textContent = MAT_ABBREV[mat]
      const count = document.createElement('span')
      count.style.color = '#334455'
      count.textContent = '0'
      row.appendChild(abbr)
      row.appendChild(count)
      right.appendChild(row)
      this.invEls.set(mat, count)
    }

    body.appendChild(left)
    body.appendChild(right)
    panel.appendChild(body)
    return panel
  }

  // ── Logic ────────────────────────────────────────────────────────────────────

  private renderSelection(): void {
    RECIPES.forEach((recipe, i) => {
      const row  = this.rowEls[i]
      const name = row.children[1] as HTMLSpanElement
      const canCraft = this.canCraft(recipe)
      const isSel    = i === this.selectedIndex

      let label = recipe.displayName
      if (recipe.findOnly)                      label += '  [FIND ONLY]'
      else if (recipe.requiredTier > this.legTier) label += '  [LOCKED]'

      name.textContent = isSel ? `▶ ${label}` : `  ${label}`
      if (isSel) {
        row.style.background = canCraft ? 'rgba(119,119,255,0.15)' : 'rgba(204,68,85,0.15)'
        name.style.color     = canCraft ? '#aaaaff'                 : '#cc4455'
      } else {
        row.style.background = 'transparent'
        name.style.color     = '#445566'
      }
    })

    const recipe = RECIPES[this.selectedIndex]
    const costStr = (Object.keys(recipe.materials) as MaterialType[])
      .map(m => `${recipe.materials[m]}×${MAT_ABBREV[m]}`).join('  ')
    this.costEl.textContent = `Cost: ${costStr}`
    this.statusEl.textContent = ''
  }

  private canCraft(recipe: Recipe): boolean {
    if (recipe.findOnly || recipe.requiredTier > this.legTier) return false
    for (const mat of Object.keys(recipe.materials) as MaterialType[]) {
      if ((this.inventory[mat] ?? 0) < (recipe.materials[mat] ?? 0)) return false
    }
    return true
  }

  private tryCraft(): void {
    const recipe = RECIPES[this.selectedIndex]
    if (recipe.findOnly)           { this.flash('Cannot craft — find this weapon in the world', '#cc4455'); return }
    if (!this.canCraft(recipe))    { this.flash('Cannot craft — missing materials', '#cc4455'); return }

    for (const mat of Object.keys(recipe.materials) as MaterialType[]) {
      this.inventory[mat] = (this.inventory[mat] ?? 0) - (recipe.materials[mat] ?? 0)
    }
    const inv = (registry.get<WeaponType[]>('weaponInventory') ?? []).slice()
    inv.push(recipe.produces)
    registry.set('weaponInventory', inv)
    registry.set('craftingInventory', { ...this.inventory })

    this.refreshInventory()
    this.renderSelection()
    this.flash(`Crafted: ${recipe.displayName}`, '#7777ff')
  }

  private flash(msg: string, color: string): void {
    if (this.statusTimer !== null) clearTimeout(this.statusTimer)
    this.statusEl.textContent = msg
    this.statusEl.style.color = color
    this.statusTimer = setTimeout(() => { this.statusEl.textContent = '' }, 1400)
  }

  private refreshInventory(): void {
    for (const [mat, el] of this.invEls) {
      const amt = this.inventory[mat] ?? 0
      el.textContent = String(amt)
      el.style.color = amt > 0 ? '#ccccdd' : '#334455'
    }
  }
}
