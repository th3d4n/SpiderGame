import { RECIPES, recipeLearned, type Recipe, type MaterialType } from '../systems/CraftingSystem'
import { registry } from '../core/Registry'
import type { InputManager } from '../core/InputManager'
import type { WeaponType } from '../systems/WeaponSystem'
import { weaponIconSvg } from './WeaponIcon3D'
import { audio } from '../systems/AudioManager'
import { h, MATERIAL_INFO, materialSvg } from './theme'
import { weaponColor, weaponStatBars, weaponTypeLabel } from './weaponInfo'
import { CONSUMABLE_RECIPES, CONSUMABLE_INFO, type ConsumableRecipe, type ConsumableSystem } from '../systems/ConsumableSystem'
import { consumableSvg } from './QuickItems'

// ─── Workbench ────────────────────────────────────────────────────────────────
// Two tabs — Weapons and Brews (potions/tonics for the C/V/X quick-use keys).
// Left: recipe cards with status (ready / missing / tier / owned / find-only).
// Right: the selected recipe — stat bars, ingredient chips (have / need), and
// the craft action.  Crafting plays a short "weave" (a silk ring winds around
// the item, ingredients pulse) before the result lands; a first-ever craft then
// hands off to the full discovery presentation.

const WEAVE_MS = 620
const OUT_MS   = 200
const MATS     = Object.keys(MATERIAL_INFO) as MaterialType[]

const STYLE = /* css */`
.nl-wb { position:absolute; left:50%; top:50%; width: 880px; height: 540px; transform: translate(-50%,-50%);
  display:grid; grid-template-columns: 330px 1fr; grid-template-rows: auto 1fr auto auto; animation: nl-panel-in 300ms var(--nl-ease) both; }
.nl-wb.out { animation: nl-panel-out ${OUT_MS}ms ease-in both; }
.nl-wb header { grid-column: 1 / 3; padding: 22px 28px 14px; border-bottom: 1px solid var(--nl-line); }
.nl-wb header .nl-title { font-size: 26px; }
.nl-wb .list { padding: 14px 14px; display:flex; flex-direction:column; gap:6px; overflow:auto; border-right: 1px solid var(--nl-line); }
.nl-wb .list .nl-row .ico { width:36px; height:36px; border-radius:9px; display:grid; place-items:center; background: rgba(255,240,220,.04); box-shadow: inset 0 0 0 1px rgba(255,255,255,.08); flex:none; }
.nl-wb .list .nl-row .nm { font-size: 14px; }
.nl-wb .status { margin-left:auto; font-size: 10px; font-weight: 700; letter-spacing: 1.2px; text-transform: uppercase; padding: 3px 8px; border-radius: 999px; white-space:nowrap; }
.nl-wb .status.ready  { color:#0f1a10; background: var(--nl-good); }
.nl-wb .status.need   { color: #ffc2bb; border: 1px solid rgba(255,93,79,.45); }
.nl-wb .status.locked { color: var(--nl-dim); border: 1px solid var(--nl-line-2); }
.nl-wb .status.find   { color: var(--nl-gold); border: 1px solid rgba(233,196,106,.4); }
.nl-wb .status.owned  { color: var(--nl-silk); border: 1px solid rgba(168,216,255,.35); }
.nl-wb header { display:grid; grid-template-columns: 1fr auto; align-items:end; }
.nl-wb header .tabs { grid-row: 1 / 3; grid-column: 2; display:flex; gap:4px; padding:3px; border-radius: 999px; background: rgba(255,240,220,.04); box-shadow: inset 0 0 0 1px var(--nl-line); }
.nl-wb header .tab { padding: 6px 14px; border-radius: 999px; font-size: 12px; font-weight: 700; letter-spacing: .6px; color: var(--nl-dim); cursor:pointer; transition: background 160ms, color 160ms; }
.nl-wb header .tab.on { color: #140f0b; background: linear-gradient(#ffcf8a, #f0a24a); }
.nl-wb .detail .blurb { grid-column: 2; font-size: 13.5px; line-height: 1.5; color: var(--nl-text); opacity: .85; max-width: 420px; }
.nl-wb .detail { padding: 18px 28px; display:grid; grid-template-columns: 150px 1fr; gap: 6px 22px; align-content: start; }
.nl-wb .forge { grid-row: 1 / 4; position:relative; width:150px; height:150px; display:grid; place-items:center; }
.nl-wb .forge .disc { position:absolute; inset:12px; border-radius:50%;
  background: radial-gradient(circle at 50% 40%, color-mix(in srgb, var(--c) 30%, transparent), rgba(10,8,6,.9) 72%);
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--c) 55%, transparent); }
.nl-wb .forge svg.ring { position:absolute; inset:0; transform: rotate(-90deg); }
.nl-wb .forge svg.ring circle { fill:none; stroke: var(--c); stroke-width: 3; stroke-linecap: round; stroke-dasharray: 283; stroke-dashoffset: 283; }
.nl-wb .forge.weaving svg.ring circle { animation: nl-weave ${WEAVE_MS}ms cubic-bezier(.5,0,.5,1) both; }
.nl-wb .forge .item { position:relative; z-index:1; transition: transform 200ms var(--nl-ease), filter 200ms; }
.nl-wb .forge.weaving .item { transform: scale(.82); filter: brightness(.7); }
.nl-wb .forge.done .item { animation: nl-pop 480ms var(--nl-ease-back) both; }
.nl-wb .forge.done::after { content:''; position:absolute; inset:12px; border-radius:50%; border:2px solid var(--c); animation: nl-ripple 700ms ease-out both; }
.nl-wb .forge.locked .item { filter: grayscale(1) brightness(.6); }
.nl-wb .detail .nl-title { font-size: 22px; align-self:end; }
.nl-wb .detail .ingredients { grid-column: 1 / 3; display:flex; flex-wrap:wrap; gap:8px; margin-top: 12px; }
.nl-wb .weaving ~ .ingredients .nl-chip, .nl-wb .ingredients.weaving .nl-chip { animation: nl-pulse 300ms ease-in-out 2; }
.nl-wb .craft { grid-column: 1 / 3; display:flex; align-items:center; gap: 14px; margin-top: 16px; }
.nl-wb .craft .btn { padding: 10px 22px; border-radius: 10px; font-family: var(--nl-display); font-size: 17px; cursor:pointer;
  color: #140f0b; background: linear-gradient(#ffcf8a, #f0a24a); border: 1px solid rgba(255,220,170,.7); box-shadow: 0 6px 18px rgba(240,162,74,.25); }
.nl-wb .craft .btn.off { color: var(--nl-dim); background: rgba(255,240,220,.05); border-color: var(--nl-line-2); box-shadow:none; cursor: default; }
.nl-wb .craft .btn.shake { animation: nl-shake 260ms ease-in-out 2; }
.nl-wb .craft .msg { font-size: 13px; color: var(--nl-dim); }
.nl-wb .craft .msg.good { color: var(--nl-good); animation: nl-up 260ms var(--nl-ease) both; }
.nl-wb .craft .msg.bad  { color: #ffb1a8; animation: nl-up 260ms var(--nl-ease) both; }
.nl-wb .wallet { grid-column: 1 / 3; display:flex; flex-wrap:wrap; gap:6px; padding: 12px 20px; border-top: 1px solid var(--nl-line); }
.nl-wb .wallet .nl-chip { padding: 3px 8px 3px 5px; }
.nl-wb .wallet .nl-chip.zero { opacity: .35; }
.nl-wb .wallet .nl-chip.tick b { animation: nl-pulse 400ms ease-in-out; color: #ffb1a8; }
.nl-wb footer { grid-column: 1 / 3; padding: 10px 20px 14px; border-top: 1px solid var(--nl-line); }
`

type Status = 'ready' | 'need' | 'locked' | 'find' | 'owned'
type Tab    = 'weapons' | 'brews'
type Entry  = { kind: 'weapon'; r: Recipe } | { kind: 'brew'; r: ConsumableRecipe }

const TABS: Record<Tab, Entry[]> = {
  weapons: RECIPES.map(r => ({ kind: 'weapon' as const, r })),
  brews:   CONSUMABLE_RECIPES.map(r => ({ kind: 'brew' as const, r })),
}

export class CraftingMenu3D {
  private overlay:  HTMLElement
  private root:     HTMLDivElement
  private panel!:   HTMLDivElement
  private tabsEl!:  HTMLElement
  private listEl!:  HTMLElement
  private detailEl!: HTMLElement
  private walletEl!: HTMLElement
  private forgeEl:  HTMLElement | null = null
  private msgEl:    HTMLElement | null = null

  private tab: Tab  = 'weapons'
  private selectedIndex = 0
  private inventory: Partial<Record<MaterialType, number>> = {}
  private owned     = new Set<WeaponType>()
  private legTier   = 0
  private weaving   = false
  private weaveStart = 0
  private weaveEntry: Entry | null = null
  private weaveFirst = false
  private closing   = false
  private justSpent = new Set<MaterialType>()

  isOpen  = false
  // Set by main — brewed potions land here
  consumables: ConsumableSystem | null = null
  onClose?: () => void
  onFirstDiscover?: (wt: WeaponType) => void

  constructor(menuOverlay: HTMLElement) {
    this.overlay = menuOverlay
    if (!document.getElementById('nl-wb-style')) {
      const st = h('style'); st.id = 'nl-wb-style'; st.textContent = STYLE
      document.head.appendChild(st)
    }
    this.root = h('div') as HTMLDivElement
    this.root.style.cssText = 'display:none; position:absolute; inset:0;'
    this.buildPanel()
    menuOverlay.appendChild(this.root)
  }

  show(): void {
    this.inventory     = { ...(registry.get<Partial<Record<MaterialType, number>>>('craftingInventory') ?? {}) }
    this.owned         = new Set(registry.get<WeaponType[]>('weaponInventory') ?? [])
    this.legTier       = registry.get<number>('legTier') ?? 0
    this.selectedIndex = 0
    this.weaving = this.closing = false
    this.panel.classList.remove('out')
    this.root.style.display = 'block'
    this.overlay.style.display = 'block'
    this.isOpen = true
    this.render()
    audio.play('workbench_open')
  }

  update(input: InputManager): void {
    if (!this.isOpen || this.closing) return
    // The weave runs on the game loop's clock (not a timer), so it can't fire
    // late or out of order relative to the frames that draw it.
    if (this.weaving) {
      if (performance.now() - this.weaveStart >= WEAVE_MS) this.finishWeave()
      return
    }
    const n = this.entries().length
    if (input.justDown('ArrowUp'))   { this.select((this.selectedIndex - 1 + n) % n) }
    if (input.justDown('ArrowDown')) { this.select((this.selectedIndex + 1) % n) }
    if (input.justDown('ArrowLeft') || input.justDown('ArrowRight') || input.justDown('Tab')) {
      this.setTab(this.tab === 'weapons' ? 'brews' : 'weapons')
    }
    if (input.justDown('Space') || input.justDown('Enter')) this.tryCraft()
    if (input.justDown('Escape') || input.justDown('KeyE')) this.close()
  }

  close(): void {
    if (!this.isOpen || this.closing) return
    this.closing = true
    this.panel.classList.add('out')
    audio.play('ui_back')
    window.setTimeout(() => {
      this.root.style.display = 'none'
      this.overlay.style.display = 'none'
      this.isOpen  = false
      this.closing = false
      this.onClose?.()
    }, OUT_MS)
  }

  // ── Construction ───────────────────────────────────────────────────────────

  private buildPanel(): void {
    this.root.appendChild(h('div', 'nl-scrim'))
    const panel = h('div', 'nl-panel nl-wb') as HTMLDivElement
    this.panel = panel
    const header = h('header')
    header.appendChild(h('div', 'nl-eyebrow', 'Workbench'))
    header.appendChild(h('div', 'nl-title', 'What can these legs become?'))
    this.tabsEl = h('div', 'tabs')
    header.appendChild(this.tabsEl)
    panel.appendChild(header)
    this.listEl   = h('div', 'list');   panel.appendChild(this.listEl)
    this.detailEl = h('div', 'detail'); panel.appendChild(this.detailEl)
    this.walletEl = h('div', 'wallet'); panel.appendChild(this.walletEl)
    const footer = h('footer', 'nl-hints')
    footer.innerHTML = [['↑↓', 'recipe'], ['←→', 'weapons / brews'], ['Space', 'craft'], ['Esc', 'close']]
      .map(([k, t]) => `<span><span class="nl-key">${k}</span> ${t}</span>`).join('')
    panel.appendChild(footer)
    this.root.appendChild(panel)
  }

  // ── Logic ──────────────────────────────────────────────────────────────────

  private entries(): Entry[] { return TABS[this.tab] }

  private setTab(t: Tab): void {
    if (t === this.tab) return
    this.tab = t
    this.selectedIndex = 0
    this.render()
    audio.play('ui_hover')
  }

  private status(e: Entry): Status {
    if (e.r.findOnly) return 'find'
    if (e.kind === 'weapon') {
      if (!recipeLearned(e.r) || e.r.requiredTier > this.legTier) return 'locked'
      // Re-crafting an owned weapon used to eat the materials for a duplicate
      if (this.owned.has(e.r.produces)) return 'owned'
    }
    const mats = e.r.materials as Partial<Record<MaterialType, number>>
    for (const m of Object.keys(mats) as MaterialType[]) {
      if ((this.inventory[m] ?? 0) < (mats[m] ?? 0)) return 'need'
    }
    return 'ready'
  }

  private select(i: number): void {
    this.selectedIndex = i
    this.render()
    audio.play('ui_hover')
  }

  private icon(e: Entry, size: number): string {
    return e.kind === 'weapon' ? weaponIconSvg(e.r.produces, weaponColor(e.r.produces), size) : consumableSvg(e.r.id, size)
  }

  private color(e: Entry): string {
    return e.kind === 'weapon' ? weaponColor(e.r.produces) : CONSUMABLE_INFO[e.r.id].color
  }

  private render(): void {
    // Tabs
    this.tabsEl.innerHTML = ''
    for (const t of ['weapons', 'brews'] as Tab[]) {
      const b = h('span', `tab${t === this.tab ? ' on' : ''}`, t === 'weapons' ? 'Weapons' : 'Brews')
      b.addEventListener('click', () => { if (!this.weaving) this.setTab(t) })
      this.tabsEl.appendChild(b)
    }

    // Recipe list
    const list = this.entries()
    this.listEl.innerHTML = ''
    list.forEach((e, i) => {
      const st  = this.status(e)
      const row = h('div', `nl-row${i === this.selectedIndex ? ' sel' : ''}${st === 'ready' ? '' : ' dim'}`)
      if (i === this.selectedIndex) row.classList.remove('dim')
      const ico = h('div', 'ico'); ico.innerHTML = this.icon(e, 24)
      row.appendChild(ico)
      row.appendChild(h('div', 'nm', e.r.displayName))
      const label = st === 'ready' ? 'Ready' : st === 'need' ? 'Missing' : st === 'owned' ? 'Owned'
                  : st === 'locked' ? (recipeLearned(e.r as Recipe) ? `Tier ${(e.r as Recipe).requiredTier}` : 'Unknown') : 'Find it'
      row.appendChild(h('span', `status ${st}`, label))
      row.addEventListener('click', () => { if (!this.weaving) this.select(i) })
      this.listEl.appendChild(row)
    })

    // Detail
    const e  = list[this.selectedIndex]
    const st = this.status(e)
    const c  = this.color(e)
    this.detailEl.innerHTML = ''
    this.detailEl.style.setProperty('--c', c)

    const forge = h('div', `forge${st === 'locked' || st === 'find' ? ' locked' : ''}`)
    forge.innerHTML = `<div class="disc"></div><svg class="ring" viewBox="0 0 100 100"><circle cx="50" cy="50" r="45"/></svg>`
    const item = h('div', 'item'); item.innerHTML = this.icon(e, 74)
    forge.appendChild(item)
    this.detailEl.appendChild(forge)
    this.forgeEl = forge

    this.detailEl.appendChild(h('div', 'nl-title', e.r.displayName))
    const chips = h('div'); chips.style.cssText = 'display:flex; gap:6px;'
    if (e.kind === 'weapon') {
      chips.innerHTML = `<span class="nl-chip">${weaponTypeLabel(e.r.produces)}</span>` +
        (e.r.requiredTier > 0 ? `<span class="nl-chip">Leg tier <b>${e.r.requiredTier}</b></span>` : '')
      this.detailEl.appendChild(chips)
      this.detailEl.appendChild(weaponStatBars(e.r.produces))
    } else {
      const info = CONSUMABLE_INFO[e.r.id]
      chips.innerHTML = `<span class="nl-chip">Brew</span><span class="nl-chip"><span class="nl-key">${info.key}</span> to drink</span>` +
        `<span class="nl-chip">Carrying <b>${this.consumables?.getAmount(e.r.id) ?? 0}</b></span>`
      this.detailEl.appendChild(chips)
      this.detailEl.appendChild(h('div', 'blurb', info.blurb))
    }

    const ing = h('div', 'ingredients')
    const mats = e.r.materials as Partial<Record<MaterialType, number>>
    for (const m of Object.keys(mats) as MaterialType[]) {
      const need = mats[m] ?? 0
      const have = this.inventory[m] ?? 0
      const chip = h('span', `nl-chip ${have >= need ? 'ok' : 'bad'}`)
      chip.innerHTML = `${materialSvg(m, 14)} ${MATERIAL_INFO[m]?.name ?? m} <b>${have}/${need}</b>`
      ing.appendChild(chip)
    }
    this.detailEl.appendChild(ing)

    const craft = h('div', 'craft')
    const btnText = st === 'find' ? 'Found in the world' : st === 'owned' ? 'Already in your armory'
                  : st === 'locked' ? this.lockedText(e.r as Recipe)
                  : e.kind === 'brew' ? 'Brew it' : 'Weave it'
    const btn = h('div', `btn${st === 'ready' ? '' : ' off'}`, btnText)
    btn.addEventListener('click', () => this.tryCraft())
    craft.appendChild(btn)
    this.msgEl = h('div', 'msg')
    if (st === 'ready') this.msgEl.innerHTML = '<span class="nl-key">Space</span> to craft'
    craft.appendChild(this.msgEl)
    this.detailEl.appendChild(craft)

    // Wallet
    this.walletEl.innerHTML = ''
    for (const m of MATS) {
      const n = this.inventory[m] ?? 0
      const chip = h('span', `nl-chip${n ? '' : ' zero'}${this.justSpent.has(m) ? ' tick' : ''}`)
      chip.innerHTML = `${materialSvg(m, 14)} <b>${n}</b>`
      chip.title = MATERIAL_INFO[m]?.name ?? m
      this.walletEl.appendChild(chip)
    }
    this.justSpent.clear()
  }

  private lockedText(r: Recipe): string {
    return recipeLearned(r) ? `Needs leg tier ${r.requiredTier}` : r.lockedHint ?? 'Not learned yet'
  }

  private say(text: string, kind: 'good' | 'bad'): void {
    if (!this.msgEl) return
    this.msgEl.className = `msg ${kind}`
    this.msgEl.textContent = text
  }

  private tryCraft(): void {
    if (this.weaving) return
    const e  = this.entries()[this.selectedIndex]
    const st = this.status(e)
    if (st !== 'ready') {
      const btn = this.detailEl.querySelector('.btn') as HTMLElement | null
      btn?.classList.remove('shake'); void btn?.offsetWidth; btn?.classList.add('shake')
      this.say(st === 'find' ? 'This one has to be found, not made.'
             : st === 'owned' ? 'You already carry this one.'
             : st === 'locked' ? (recipeLearned(e.r as Recipe) ? `Your legs need tier ${(e.r as Recipe).requiredTier} for this.` : "You don't know how to make this yet.")
             : 'Not enough materials yet.', 'bad')
      return
    }

    // Spend now; the weave is presentation only
    const mats = e.r.materials as Partial<Record<MaterialType, number>>
    for (const mat of Object.keys(mats) as MaterialType[]) {
      this.inventory[mat] = (this.inventory[mat] ?? 0) - (mats[mat] ?? 0)
      this.justSpent.add(mat)
    }
    registry.set('craftingInventory', { ...this.inventory })
    let first = false
    if (e.kind === 'weapon') {
      const inv = (registry.get<WeaponType[]>('weaponInventory') ?? []).slice()
      first = !inv.includes(e.r.produces)
      inv.push(e.r.produces)
      registry.set('weaponInventory', inv)
      this.owned.add(e.r.produces)
    } else {
      this.consumables?.addConsumable(e.r.id, 1)
    }

    this.weaving    = true
    this.weaveStart = performance.now()
    this.weaveEntry = e
    this.weaveFirst = first
    this.forgeEl?.classList.add('weaving')
    this.detailEl.querySelector('.ingredients')?.classList.add('weaving')
    audio.play('ui_click')
  }

  private finishWeave(): void {
    const e = this.weaveEntry!
    this.weaving = false
    this.weaveEntry = null
    if (e.kind === 'weapon' && this.weaveFirst && this.onFirstDiscover) {
      this.onFirstDiscover(e.r.produces)
      return
    }
    audio.play('crafting_complete')
    this.render()
    this.forgeEl?.classList.add('done')
    if (e.kind === 'weapon') this.say(`${e.r.displayName} added to your armory.`, 'good')
    else this.say(`${e.r.displayName} brewed — carrying ${this.consumables?.getAmount(e.r.id) ?? 1}.`, 'good')
  }
}
