// ─── UI theme ─────────────────────────────────────────────────────────────────
// One stylesheet for every menu, overlay and HUD element: tokens, components and
// motion.  Look: a tiny spider's homemade world — warm candle-lit panels with a
// silk-thread border, storybook serif for names and titles, a clean sans for UI,
// mono for keys and numbers.  Webbs' cool silk-blue marks "yours"; amber marks
// the world; red marks danger.

export const UI = {
  silk:   '#a8d8ff',
  amber:  '#ffb35c',
  danger: '#ff5d4f',
  good:   '#8fd694',
  xp:     '#d4f27a',
  gold:   '#e9c46a',
  text:   '#efe6d8',
  dim:    '#a89d8c',
  faint:  '#6f665a',
} as const

export const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`

const CSS = /* css */`
:root {
  --nl-bg:        #0e0b09;
  --nl-panel:     rgba(22, 17, 14, 0.94);
  --nl-panel-2:   rgba(34, 27, 21, 0.96);
  --nl-line:      rgba(232, 214, 186, 0.13);
  --nl-line-2:    rgba(232, 214, 186, 0.30);
  --nl-text:      ${UI.text};
  --nl-dim:       ${UI.dim};
  --nl-faint:     ${UI.faint};
  --nl-silk:      ${UI.silk};
  --nl-amber:     ${UI.amber};
  --nl-danger:    ${UI.danger};
  --nl-good:      ${UI.good};
  --nl-xp:        ${UI.xp};
  --nl-gold:      ${UI.gold};
  --nl-display:   'Fraunces', Georgia, 'Times New Roman', serif;
  --nl-ui:        'Space Grotesk', system-ui, -apple-system, 'Segoe UI', sans-serif;
  --nl-mono:      'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace;
  --nl-radius:    12px;
  --nl-ease:      cubic-bezier(.2, .8, .2, 1);
  --nl-ease-back: cubic-bezier(.34, 1.56, .64, 1);
}

/* Set once and inherit (an "#game-container *" rule would out-rank every
   display-font class below by ID specificity). */
#game-container { font-family: var(--nl-ui); }
#game-container button { font: inherit; }
#game-container * { scrollbar-width: thin; scrollbar-color: rgba(232,214,186,.22) transparent; }
#game-container ::-webkit-scrollbar { width: 6px; height: 6px; }
#game-container ::-webkit-scrollbar-thumb { background: rgba(232,214,186,.22); border-radius: 3px; }
#game-container ::-webkit-scrollbar-track { background: transparent; }
#hud-overlay, #audio-toggle { transition: opacity 400ms ease; }
#game-container.hud-hidden #hud-overlay, #game-container.hud-hidden #audio-toggle { opacity: 0; }

/* ── Panels ────────────────────────────────────────────────────────────────── */
.nl-panel {
  position: relative;
  background:
    radial-gradient(120% 80% at 50% 0%, rgba(255, 214, 160, 0.05), transparent 60%),
    var(--nl-panel);
  border: 1px solid var(--nl-line-2);
  border-radius: var(--nl-radius);
  box-shadow: 0 18px 60px rgba(0,0,0,.55), inset 0 1px 0 rgba(255,240,220,.06);
  color: var(--nl-text);
}
/* silk-thread double border */
.nl-panel::before {
  content: ''; position: absolute; inset: 5px; border-radius: calc(var(--nl-radius) - 4px);
  border: 1px solid var(--nl-line); pointer-events: none;
}
.nl-scrim {
  position: absolute; inset: 0; pointer-events: auto;
  background: radial-gradient(ellipse at center, rgba(8,6,5,.55), rgba(5,4,3,.88));
  backdrop-filter: blur(3px);
  animation: nl-fade-in 220ms var(--nl-ease) both;
}
.nl-title {
  font-family: var(--nl-display); font-weight: 600; letter-spacing: .5px; color: var(--nl-text);
}
.nl-eyebrow {
  font-size: 10.5px; font-weight: 600; letter-spacing: 3.2px; text-transform: uppercase; color: var(--nl-dim);
}
.nl-rule { height: 1px; background: linear-gradient(90deg, transparent, var(--nl-line-2), transparent); }
.nl-muted { color: var(--nl-dim); }
.nl-faint { color: var(--nl-faint); }

/* ── Keycaps / chips ───────────────────────────────────────────────────────── */
.nl-key {
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 22px; height: 22px; padding: 0 6px; margin: 0 2px;
  font-family: var(--nl-mono); font-size: 11px; font-weight: 600; line-height: 1;
  color: var(--nl-text); background: linear-gradient(#3a3027, #2a221b);
  border: 1px solid rgba(255,235,210,.22); border-bottom-width: 3px; border-radius: 6px;
  vertical-align: middle; box-shadow: 0 1px 0 rgba(0,0,0,.4);
}
.nl-chip {
  display: inline-flex; align-items: center; gap: 6px; padding: 4px 9px;
  font-size: 11px; border-radius: 999px; border: 1px solid var(--nl-line-2);
  background: rgba(255,240,220,.04); color: var(--nl-dim); white-space: nowrap;
}
.nl-chip b { color: var(--nl-text); font-family: var(--nl-mono); font-weight: 600; }
.nl-chip.ok   { border-color: rgba(143,214,148,.45); color: #cfe9d0; }
.nl-chip.bad  { border-color: rgba(255,93,79,.45);  color: #ffc2bb; }
.nl-hints { display: flex; gap: 14px; flex-wrap: wrap; justify-content: center; font-size: 11px; color: var(--nl-dim); }
.nl-hints span { display: inline-flex; align-items: center; gap: 4px; }

/* ── Stat bars ─────────────────────────────────────────────────────────────── */
.nl-stat { display: grid; grid-template-columns: 64px 1fr 34px; align-items: center; gap: 8px; font-size: 11px; color: var(--nl-dim); }
.nl-stat-track { height: 6px; border-radius: 3px; background: rgba(255,240,220,.07); overflow: hidden; }
.nl-stat-fill  { height: 100%; border-radius: 3px; background: var(--nl-silk); transform-origin: left; animation: nl-grow-x 500ms var(--nl-ease) both; }
.nl-stat-val   { font-family: var(--nl-mono); color: var(--nl-text); text-align: right; }

/* ── Buttons / list rows ───────────────────────────────────────────────────── */
.nl-btn {
  position: relative; display: flex; align-items: center; justify-content: center; gap: 10px;
  padding: 12px 34px; min-width: 240px; cursor: pointer; user-select: none;
  font-family: var(--nl-display); font-size: 18px; letter-spacing: 1px; color: var(--nl-dim);
  border: 1px solid transparent; border-radius: 10px; background: transparent;
  transition: color 140ms, background 140ms, border-color 140ms, transform 140ms var(--nl-ease);
}
.nl-btn::before { content: ''; width: 0; height: 1px; background: var(--nl-amber); transition: width 200ms var(--nl-ease); }
.nl-btn.sel, .nl-btn:hover { color: var(--nl-text); background: rgba(255,214,160,.06); border-color: var(--nl-line-2); }
.nl-btn.sel::before { width: 18px; }
.nl-btn.off { opacity: .32; pointer-events: none; }
.nl-row {
  display: flex; align-items: center; gap: 12px; padding: 9px 12px; border-radius: 9px; cursor: pointer;
  border: 1px solid transparent; transition: background 120ms, border-color 120ms, transform 120ms var(--nl-ease);
}
.nl-row:hover { background: rgba(255,240,220,.04); }
.nl-row.sel { background: rgba(168,216,255,.08); border-color: rgba(168,216,255,.35); }
.nl-row.dim { opacity: .45; }

/* ── HUD ───────────────────────────────────────────────────────────────────── */
#hud-overlay { position: absolute; inset: 0; pointer-events: none; }
.hud-card {
  background: linear-gradient(180deg, rgba(24,18,14,.82), rgba(16,12,10,.82));
  border: 1px solid var(--nl-line-2); border-radius: 10px; box-shadow: 0 6px 24px rgba(0,0,0,.45);
}
#zone-label {
  position: absolute; top: 14px; left: 50%; transform: translateX(-50%);
  padding: 6px 18px; font-family: var(--nl-display); font-size: 13px; letter-spacing: 2.5px;
  color: var(--nl-text); text-transform: uppercase;
}
#bars-group { position: absolute; left: 18px; bottom: 18px; padding: 12px 14px 10px; display: flex; flex-direction: column; gap: 7px; min-width: 250px; }
.bar-row { display: grid; grid-template-columns: 38px 1fr 54px; align-items: center; gap: 9px; }
.bar-label { font-size: 10px; font-weight: 700; letter-spacing: 1.8px; color: var(--nl-dim); }
.bar-track { position: relative; height: 10px; border-radius: 5px; background: rgba(0,0,0,.45); border: 1px solid rgba(255,240,220,.10); overflow: hidden; }
.bar-ghost, .bar-fill { position: absolute; left: 0; top: 0; bottom: 0; border-radius: 5px; }
.bar-ghost { background: rgba(255,248,236,.75); transition: width 420ms ease-in 160ms; }
.bar-fill  { transition: width 90ms linear; box-shadow: inset 0 1px 0 rgba(255,255,255,.25); }
.bar-num   { font-family: var(--nl-mono); font-size: 10.5px; color: var(--nl-dim); text-align: right; }
#hp-fill     { background: linear-gradient(90deg, #c2333f, #ff5d4f); }
#stam-fill   { background: linear-gradient(90deg, #c99a1f, #f2c94c); }
#energy-fill { background: linear-gradient(90deg, #2f78c4, #6cc3ff); }
#bars-group.low-hp #hp-fill { animation: nl-pulse 0.9s ease-in-out infinite; }
#bars-group.winded #stam-fill { opacity: .55; }

#weapon-ring-wrap { position: absolute; right: 14px; bottom: 10px; filter: drop-shadow(0 6px 18px rgba(0,0,0,.5)); }
#weapon-ring .slot-bg     { fill: rgba(20,15,12,.86); stroke: rgba(232,214,186,.22); stroke-width: 1.2; }
#weapon-ring .slot-active { fill: none; stroke: var(--nl-silk); stroke-width: 2; opacity: 0; transition: opacity 120ms; }
#weapon-ring .slot-active.on { opacity: 1; }
#weapon-ring .slot-num    { font-family: var(--nl-mono); font-size: 8.5px; font-weight: 700; }
#weapon-ring .ring-core   { fill: rgba(20,15,12,.8); stroke: rgba(232,214,186,.16); }

#controls-hint { position: absolute; bottom: 14px; left: 50%; transform: translateX(-50%); display: flex; gap: 12px; font-size: 10.5px; color: var(--nl-faint); white-space: nowrap; }
#controls-hint .nl-key { height: 18px; min-width: 18px; font-size: 9.5px; border-bottom-width: 2px; opacity: .8; }
#interact-hint {
  display: none; position: absolute; left: 50%; bottom: 46%; transform: translateX(-50%);
  padding: 7px 14px 7px 8px; font-size: 13px; color: var(--nl-text); align-items: center; gap: 8px;
  animation: nl-rise 180ms var(--nl-ease) both;
}
#xp-counter { position: absolute; top: 56px; right: 16px; padding: 6px 12px; display: flex; align-items: baseline; gap: 8px; }
#xp-counter .xp-label { font-size: 10px; font-weight: 700; letter-spacing: 2px; color: var(--nl-xp); }
#xp-value { font-family: var(--nl-mono); font-size: 14px; color: var(--nl-text); }
.xp-pop { position: absolute; right: 18px; top: 92px; font-family: var(--nl-mono); font-size: 13px; font-weight: 700; color: var(--nl-xp); text-shadow: 0 2px 10px rgba(0,0,0,.6); animation: nl-xp-pop 1100ms var(--nl-ease) both; }
#ammo-panel { display: none; position: absolute; right: 18px; bottom: 182px; padding: 5px 11px; font-size: 11px; color: var(--nl-gold); }
#ammo-panel b { font-family: var(--nl-mono); color: var(--nl-text); }
#ammo-panel.empty { color: var(--nl-danger); border-color: rgba(255,93,79,.5); animation: nl-pulse 1s ease-in-out infinite; }
#audio-toggle {
  position: absolute; top: 14px; right: 16px; z-index: 200; cursor: pointer;
  padding: 6px 12px; font-size: 10.5px; font-weight: 700; letter-spacing: 1.6px; color: var(--nl-dim);
}
#audio-toggle:hover { color: var(--nl-text); border-color: var(--nl-line-2); }

/* Boss */
#boss-hp-wrap { display: none; position: absolute; top: 52px; left: 50%; transform: translateX(-50%); flex-direction: column; align-items: center; gap: 6px; animation: nl-rise 300ms var(--nl-ease) both; }
#boss-hp-label { font-family: var(--nl-display); font-size: 16px; letter-spacing: 3px; color: #ffd2c9; text-shadow: 0 2px 12px rgba(255,60,40,.45); text-transform: uppercase; }
#boss-hp-track { position: relative; width: 440px; height: 14px; border-radius: 7px; background: rgba(0,0,0,.6); border: 1px solid rgba(255,120,100,.45); overflow: hidden; box-shadow: 0 0 24px rgba(255,60,40,.18); }
#boss-hp-ghost, #boss-hp-fill { position: absolute; left: 0; top: 0; bottom: 0; }
#boss-hp-ghost { background: rgba(255,240,230,.8); transition: width 500ms ease-in 200ms; }
#boss-hp-fill  { background: linear-gradient(90deg, #a3121f, #ff4d3a); transition: width 80ms linear; }
#boss-msg {
  display: none; position: absolute; top: 112px; left: 50%; transform: translateX(-50%);
  font-family: var(--nl-display); font-size: 26px; font-weight: 700; letter-spacing: 2px; color: #ffe3dc;
  text-shadow: 0 0 18px rgba(255,50,30,.8), 0 3px 0 rgba(0,0,0,.6); white-space: nowrap;
}
#boss-msg.show { display: block; animation: nl-callout 520ms var(--nl-ease-back) both, nl-shake 360ms ease-in-out 520ms 2; }

/* Damage vignette */
#damage-vignette { position: absolute; inset: 0; pointer-events: none; opacity: 0; z-index: 50;
  background: radial-gradient(ellipse at center, transparent 38%, rgba(190,10,10,.62) 100%); transition: opacity 70ms ease-in; }

/* ── Toasts (system messages) ──────────────────────────────────────────────── */
#nl-toasts { position: absolute; top: 96px; left: 50%; transform: translateX(-50%); display: flex; flex-direction: column; align-items: center; gap: 8px; pointer-events: none; z-index: 120; }
.nl-toast {
  display: flex; align-items: center; gap: 10px; padding: 9px 16px 9px 12px; font-size: 13px; color: var(--nl-text);
  animation: nl-toast-in 260ms var(--nl-ease-back) both;
}
.nl-toast .ico { width: 20px; height: 20px; border-radius: 50%; display: grid; place-items: center; font-size: 12px; font-weight: 800; color: #120d0a; }
.nl-toast.info   .ico { background: var(--nl-silk); }
.nl-toast.warn   .ico { background: var(--nl-gold); }
.nl-toast.danger .ico { background: var(--nl-danger); }
.nl-toast.good   .ico { background: var(--nl-good); }
.nl-toast.danger { border-color: rgba(255,93,79,.55); }
.nl-toast.out { animation: nl-toast-out 260ms ease-in both; }

/* ── Loot feed ─────────────────────────────────────────────────────────────── */
#pickup-notifications { position: absolute; left: 18px; bottom: 132px; display: flex; flex-direction: column-reverse; gap: 6px; pointer-events: none; }
.nl-loot { display: flex; align-items: center; gap: 10px; min-width: 230px; padding: 7px 12px 7px 8px; animation: nl-slide-in 280ms var(--nl-ease-back) both; }
.nl-loot .swatch { width: 26px; height: 26px; border-radius: 7px; display: grid; place-items: center; box-shadow: inset 0 0 0 1px rgba(255,255,255,.15); }
.nl-loot .t { font-size: 12.5px; color: var(--nl-text); line-height: 1.2; }
.nl-loot .s { font-size: 10.5px; color: var(--nl-dim); line-height: 1.2; }
.nl-loot .n { margin-left: auto; font-family: var(--nl-mono); font-size: 13px; font-weight: 700; }
.nl-loot.bump { animation: nl-bump 260ms var(--nl-ease-back); }
.nl-loot.out { animation: nl-slide-out 300ms ease-in both; }

/* ── Motion ────────────────────────────────────────────────────────────────── */
@keyframes nl-fade-in   { from { opacity: 0 } to { opacity: 1 } }
@keyframes nl-fade-out  { from { opacity: 1 } to { opacity: 0 } }
@keyframes nl-rise      { from { opacity: 0; transform: translate(var(--tx, -50%), 8px) } to { opacity: 1; transform: translate(var(--tx, -50%), 0) } }
@keyframes nl-up        { from { opacity: 0; transform: translateY(10px) } to { opacity: 1; transform: none } }
@keyframes nl-pop       { 0% { opacity: 0; transform: scale(.4) } 60% { opacity: 1; transform: scale(1.12) } 100% { transform: scale(1) } }
@keyframes nl-panel-in  { from { opacity: 0; transform: translate(-50%, -46%) scale(.96) } to { opacity: 1; transform: translate(-50%, -50%) scale(1) } }
@keyframes nl-panel-out { from { opacity: 1; transform: translate(-50%, -50%) scale(1) } to { opacity: 0; transform: translate(-50%, -52%) scale(.97) } }
@keyframes nl-grow-x    { from { transform: scaleX(0) } to { transform: scaleX(1) } }
@keyframes nl-pulse     { 0%, 100% { filter: brightness(1) } 50% { filter: brightness(1.6) } }
@keyframes nl-spin      { to { transform: rotate(360deg) } }
@keyframes nl-shine     { from { transform: translateX(-140%) skewX(-18deg) } to { transform: translateX(240%) skewX(-18deg) } }
@keyframes nl-float     { 0%, 100% { transform: translateY(0) rotate(-3deg) } 50% { transform: translateY(-8px) rotate(3deg) } }
@keyframes nl-letter    { from { opacity: 0; transform: translateY(12px); filter: blur(4px) } to { opacity: 1; transform: none; filter: none } }
@keyframes nl-blink     { 0%, 100% { opacity: 1 } 50% { opacity: .35 } }
@keyframes nl-callout   { 0% { opacity: 0; transform: translateX(-50%) scale(1.6) } 100% { opacity: 1; transform: translateX(-50%) scale(1) } }
@keyframes nl-shake     { 0%, 100% { margin-left: 0 } 25% { margin-left: -4px } 75% { margin-left: 4px } }
@keyframes nl-toast-in  { from { opacity: 0; transform: translateY(-10px) scale(.96) } to { opacity: 1; transform: none } }
@keyframes nl-toast-out { to { opacity: 0; transform: translateY(-8px) } }
@keyframes nl-slide-in  { from { opacity: 0; transform: translateX(-24px) } to { opacity: 1; transform: none } }
@keyframes nl-slide-out { to { opacity: 0; transform: translateX(-16px) } }
@keyframes nl-bump      { 0% { transform: scale(1) } 40% { transform: scale(1.06) } 100% { transform: scale(1) } }
@keyframes nl-xp-pop    { 0% { opacity: 0; transform: translateY(8px) scale(.8) } 20% { opacity: 1; transform: translateY(0) scale(1.1) } 70% { opacity: 1 } 100% { opacity: 0; transform: translateY(-16px) } }
@keyframes nl-weave     { from { stroke-dashoffset: 283 } to { stroke-dashoffset: 0 } }
@keyframes nl-ripple    { from { opacity: .7; transform: scale(.6) } to { opacity: 0; transform: scale(2.2) } }

@media (prefers-reduced-motion: reduce) {
  #game-container *, #game-container *::before { animation-duration: 1ms !important; animation-iteration-count: 1 !important; transition-duration: 1ms !important; }
}
`

let installed = false
export function installTheme(): void {
  if (installed) return
  installed = true
  const fonts = document.createElement('link')
  fonts.rel  = 'stylesheet'
  fonts.href = 'https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600;9..144,700&family=JetBrains+Mono:wght@500;700&family=Space+Grotesk:wght@400;500;600;700&display=swap'
  document.head.appendChild(fonts)
  const style = document.createElement('style')
  style.id = 'nl-theme'
  style.textContent = CSS
  document.head.appendChild(style)
}

// ── DOM helpers ─────────────────────────────────────────────────────────────────

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K, cls = '', text?: string,
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag)
  if (cls) el.className = cls
  if (text !== undefined) el.textContent = text
  return el
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// Plain text → HTML: escapes, keeps line breaks, and renders [Q]-style key
// tokens as keycaps.
export function richText(s: string): string {
  return escapeHtml(s)
    .replace(/\[\s*([A-Za-z0-9←→↑↓]{1,6}|Space|Esc|Enter)\s*\]/g, '<span class="nl-key">$1</span>')
    .replace(/\n/g, '<br>')
}

export const keycap = (label: string) => `<span class="nl-key">${escapeHtml(label)}</span>`

// Animate an element out, then run `done` (removes jank from instant hides).
export function animateOut(el: HTMLElement, animation: string, ms: number, done: () => void): void {
  el.style.animation = animation
  window.setTimeout(done, ms)
}

// ── Materials (names, colours, glyphs for loot and recipes) ─────────────────────

export const MATERIAL_INFO: Record<string, { name: string; color: string; glyph: string }> = {
  SilkThread:   { name: 'Silk Thread',   color: '#e8e3f4', glyph: 'M-6,4 C-2,-6 2,6 6,-4' },
  ChitinShard:  { name: 'Chitin Shard',  color: '#9fc46a', glyph: 'M-5,5 L0,-6 L5,5 Z' },
  VenomGland:   { name: 'Venom Gland',   color: '#b77fe0', glyph: 'M0,-6 C5,-1 4,6 0,6 C-4,6 -5,-1 0,-6 Z' },
  WebFluid:     { name: 'Web Fluid',     color: '#6cc3ff', glyph: 'M0,-6 C4,0 4,6 0,6 C-4,6 -4,0 0,-6 Z' },
  CrystalDust:  { name: 'Crystal Dust',  color: '#c9f0ff', glyph: 'M-4,-2 L-1,-5 M2,-4 L5,-1 M-2,3 L1,0 M3,4 L4,3' },
  BoneFragment: { name: 'Bone Fragment', color: '#e6d9c3', glyph: 'M-6,-2 L6,2 M-6,2 L-4,-3 M6,-2 L4,3' },
  Thistle:      { name: 'Thistle Seed',  color: '#d79bff', glyph: 'M0,6 L0,-1 M0,-1 L-4,-6 M0,-1 L4,-6 M0,-1 L0,-6' },
  Stone:        { name: 'Stone',         color: '#b3aca2', glyph: 'M-6,3 L-3,-4 L4,-4 L6,2 L1,5 Z' },
  Wood:         { name: 'Wood',          color: '#c58a52', glyph: 'M-6,-3 L6,-3 L6,3 L-6,3 Z M-2,-3 L-2,3' },
  BugPartsAnt:  { name: 'Ant Parts',     color: '#d4744a', glyph: 'M-4,0 A2,2 0 1,0 0,0 A2,2 0 1,0 4,0' },
  DriedFungus:  { name: 'Dried Fungus',  color: '#7ee0b0', glyph: 'M-6,0 C-6,-6 6,-6 6,0 Z M-1,0 L-1,5 L1,5 L1,0' },
  CrystalShard: { name: 'Crystal Shard', color: '#8ff0ff', glyph: 'M0,-7 L4,0 L0,7 L-4,0 Z' },
}

export function materialSvg(mat: string, size = 18): string {
  const info = MATERIAL_INFO[mat]
  if (!info) return ''
  return `<svg width="${size}" height="${size}" viewBox="-8 -8 16 16"><path d="${info.glyph}" fill="${info.color}" fill-opacity=".9" stroke="${info.color}" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`
}
