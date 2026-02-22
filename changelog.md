# Changelog

## 2026-02-22 — README Overhaul for GitHub Public Release

- **Completely rewrote README** to be useful for anyone cloning the repo:
  - Added centered header with badges (Node.js version, license, player count)
  - Quick start section with copy-paste commands for local development
  - ASCII architecture diagram showing tech stack
  - Styled tables for all 8 characters and 9 weapons + evolutions
  - Collapsible production deployment guide
  - Configuration section with ports and customization
  - Gameplay tips section
  - Removed incorrect port 4005 URL references (Caddy uses standard HTTPS on 443)
  - Fixed URL to localhost:3002 for local dev
  - Added MIT license reference

## 2026-02-22 — Repo Renamed to Shadow Survivors + Major Cleanup

- **Renamed game from "Dark Survivors" to "Shadow Survivors"**
- **Renamed GitHub repo**: `vampire-survivors-game` → `shadow-survivors`
- **Removed dev cheat system**: Deleted hardcoded dev passwords (`/api/dev-command` endpoint and client-side secret listener) before making repo public
- **Rewrote git history**: Force-pushed to completely remove any traces of secrets from all commits
- **Deleted contaminated files from word-mind-game**:
  - Removed `backend/` folder (entire Python backend that didn't belong)
  - Removed `frontend/` folder (React build from word-mind-game)
  - Removed `requirements.txt` (Python dependencies)
- **Fixed bat scripts**: Rewrote `start.bat`, `stop.bat`, `restart.bat` to launch the Node.js server instead of a non-existent Python backend
- **Updated deploy.ps1**: Changed remote directory from `vampire-survivors-game` to `shadow-survivors`
- **Renamed `readme.md` → `README.md`** (standard convention)
- **Made repo public**

## 2026-02-19 — Fixed Co-op Lobby Title Clipped Off-Screen

- **Fixed "CO-OP LOBBY" heading going off-screen** after clicking Create Room in non-fullscreen mode. Root cause: `.screen-content` used `transform-origin: top center`, but `justify-content: center` positions the flex item above the container when it overflows — anchoring the scale at the element's own top pinned it off-screen. Changed `transform-origin` to `center` so scaling anchors at the element's center (which aligns with the container's center), keeping all content visible.

## 2026-02-19 — Letterboxing: Fixed 1280×720 Play Area

- **Added letterboxing**: The game now always renders exactly the 1280×720 reference play area. On wider or taller screens (including fullscreen), black bars appear on the sides or top/bottom so that every player sees the same portion of the world.
- Changed `resize()` to use `Math.min(scaleX, scaleY)` (contain mode) instead of height-only anchoring, maintaining 16:9 aspect ratio at all times.
- Introduced `#game-container` div that is positioned and sized by JS to the letterboxed area; canvas and UI overlay live inside it.
- Fixed mouse-aim coordinates to subtract the letterbox offset (`canvasOffsetX/Y`) before dividing by `gameZoom`, so aiming remains accurate when bars are present.

## 2026-02-17 22:48 — Fixed Vertical View Consistency & Top Border

- **Fixed fullscreen showing more vertical world than windowed**: Changed zoom from `Math.max(W/REF_W, H/REF_H)` (cover mode) to height-anchored `innerHeight / REFERENCE_H`. Vertical world shown is now always exactly 720 units regardless of windowed/fullscreen. Width varies with aspect ratio (wider windows see more horizontally).
- **Fixed tiny black border at top**: Canvas was in a flex-centered body which caused sub-pixel gaps. Changed canvas to `position: fixed; top: 0; left: 0` and removed flex centering from body.

## 2026-02-17 22:38 — Fixed Fullscreen Zoom: Constant Scale (Math.max approach)

- **Fixed fullscreen showing different zoom than windowed**: Replaced contain-mode letterboxing (which caused black bars and still had zoom differences) with `Math.max`-based zoom anchoring. Zoom is now locked to the dominant screen dimension — since toggling fullscreen only changes height (width stays constant), objects stay the same size. No letterboxing, no black bars. Windowed mode just sees slightly less vertically; fullscreen reveals more vertical game world as a bonus.

## 2026-02-17 22:32 — (Reverted) Fixed Fullscreen Zoom: Contain-mode letterboxing

- Attempted contain-mode with fixed 1280x720 viewport and letterbox bars — caused tiny black bar on top and didn't fully fix width differences.

## 2026-02-17 22:21 — Fixed Fullscreen Zoom Inconsistency

- **Fixed fullscreen showing more zoom than windowed**: Replaced fixed-height viewport (H=720) with fixed-area viewport (1280×720 = 921,600 sq units). Previously, windowed browsers had wider aspect ratios (browser chrome reduces height), giving more horizontal game area than fullscreen. Now the total visible game area is constant regardless of window size — wider windows trade vertical for horizontal and vice versa, but total area stays the same.

## 2026-02-17 22:06 — Audio Overhaul, Viewport Fix, UI Scaling & Cleanup

### Viewport: Consistent Play Area
- **Fixed fullscreen vs windowed giving different game areas**: Game viewport is now locked to 720 units tall regardless of window/fullscreen mode. Width scales proportionally with aspect ratio. All players see the same vertical game area — no advantage from fullscreen. Removed the `Math.max(1, ...)` zoom clamp that caused small windows to show less game world.

### Audio: Complete SFX Overhaul
- **Rebuilt all game sounds**: Replaced basic single-oscillator beeps with layered synthesized SFX using frequency sweeps, band-pass filtered noise, and multi-tone chords. Each sound is now distinct and satisfying:
  - Hit: punchy thwack with transient click
  - Kill: crunch-pop with high sparkle
  - XP: bright sparkle ting (randomized pitch)
  - Level Up: triumphant 4-note ascending arpeggio with harmonics
  - Hurt: heavy bass impact with filtered noise crunch
  - Shoot: quick snap with high-frequency click
  - Boss: deep ominous dual horn with sub-bass rumble
  - Explosion: bass boom with layered shrapnel noise
  - Revive: uplifting 3-note ascending chime
  - Evolve: epic 4-note chord with triangle harmonics and shimmer tail
- **Noise buffer reuse**: Pre-creates a single 1-second noise buffer and reuses it for all noise-based sounds, eliminating per-call buffer allocation.
- **Added UI click sounds**: All interactive elements (buttons, tabs, toggles, cards) play a soft pop sound on click. Uses event delegation for dynamic elements.
- **Volume sliders control UI sounds**: UI click sounds respect Master + SFX volume settings like all other sounds.

### UI: Music Options Removed
- **Removed Music Volume slider and Music Enabled toggle** from Options screen — no music exists in the game. Cleaned up Settings object (removed `music`, `musicEnabled`, `getMusicVol`).

### UI: Profile Screen Layout Fix
- **Fixed tab bar and back button repositioning**: In Characters & Upgrades, switching between tabs caused the header, tab bar, and back button to shift position because the entire screen content was inside the auto-scaling wrapper. Restructured: title, gold display, tab bar, and back button are now outside the scaling container. Only tab content (character grid, upgrades, achievements, stats) scales to fit.

### Scaling & Text Readability
- **Minimum scale floor**: `scaleScreen()` now floors at 0.55x to prevent text from becoming unreadably small on any screen.
- **Larger in-game text**: Increased font sizes for player names (11→13px), boss names (11→13px), damage numbers (14→15px), dead markers (16→18px), off-screen player indicators (12→13px, 10→11px).
- **Larger HUD text**: `.hud-text` 14→16px, `.hud-text-big` 18→22px for better readability.

## 2026-02-17 21:32 — Fix: Tooltips, Rerolls Per-Run, Remove Custom Cursor

- **Tooltip fix**: Skill bar weapon/passive slots were rebuilt via `innerHTML` every frame, destroying DOM elements under the cursor. This broke `mouseover`/`mouseout` events — the tooltip could never stay visible. Fixed by caching the HTML and only updating `innerHTML` when weapon/passive data actually changes.
- **Rerolls now per-run**: Rerolls were resetting to max for every level-up, making them effectively infinite. Changed to per-run: total rerolls for the entire game = meta Reroll upgrade level. Once used, they're gone until next run.
- **Removed custom cursor**: Deleted the canvas-drawn crosshair and all `cursor: none` CSS. The game now uses the OS default cursor everywhere.

## 2026-02-17 — Fix: Cursor invisible on menus

- `body { cursor: none }` hid the cursor everywhere, but the canvas crosshair is only drawn during active gameplay. On lobby/menu screens, cursor was completely invisible. Fixed by toggling `body.style.cursor` in `showScreen()` — `none` during gameplay (id=null), `default` during menus.

## 2026-02-17 — Fix: Skill Bar Tooltips, Custom Cursor, and Key Bleed-Through

- **Tooltip bug**: `mouseout` was hiding the tooltip when mouse moved between child elements within a slot (e.g. emoji → slot background). Fixed by checking `e.relatedTarget` — only hide when mouse leaves the slot entirely.
- **Cursor bug**: `cursor: none` was only on the canvas element. When hovering over the skill bar, the browser showed the Windows default cursor. Fixed by applying `cursor: none` to `body` and skill slots; mouse tracking moved from canvas to window so the crosshair follows the cursor over the HUD.
- **Key bleed-through**: The previous 250ms time-based cooldown didn't cover the case where a player holds two keys (e.g. up+right) and releases one while still holding the other — the browser fires a new non-repeat `keydown` for the remaining key. Replaced with held-key set tracking: keys held at screen-open time are individually blocked until physically released.

## 2026-02-17 — Fix: Upgrade Screen No Hold-to-Scroll

- A/D navigation in upgrade screen now requires a fresh keypress each time — holding the key no longer scrolls through cards

## 2026-02-17 — Fix: Upgrade Screen Input Bleed-Through

- Added 250ms input cooldown when the upgrade selection screen opens
- Prevents held movement keys (A/D/arrows) from immediately moving the card selection when the screen pops up mid-movement

## 2026-02-17 — Keyboard Navigation for Skill Selection

- **A/D** (or arrow keys) navigate between upgrade cards; selected card highlighted with gold border + glow
- **Space** accepts/picks the currently selected card
- **R** triggers reroll
- **Q** skips the current level-up
- Key hints displayed on all action buttons and in a hint row below them
- Keyboard input blocked from game movement while level-up screen is open

## 2026-02-17 20:06 — HUD Fixes + Evolution UI + Evolved Weapon Visuals

### HUD Layout Fixes
- **HP bar overlap**: Moved HP bar up (`bottom: 60px` → `72px`) so it no longer sits on top of WEAPONS/PASSIVES labels.
- **Weapons/passives gap**: Increased divider margin (12px → 18px) and brightness.
- **Player bars hidden on menus**: `#player-bars` (co-op HP bars top-left) now toggled in `showScreen()` — was always visible even on menu overlays.

### Evolution UI
- **Weapon tooltip**: Color-coded checklist — green ✓ for met requirements, red for missing. Shows "READY TO EVOLVE — open a chest!" when both are met.
- **Passive tooltip**: Shows weapon level progress toward Lv 7 and "READY" state.
- **Level-up card (weapon Lv 7)**: States whether you already have the passive needed.

### Canvas Sharpness
- **HiDPI fix**: Canvas renders at `devicePixelRatio × gameZoom`. Removed `image-rendering: pixelated`. Game looks sharp instead of blocky on all screens.

### Evolved Weapon Visuals
- **Holy Wand**: Orb shape (pulsing circle + white core). All evolved projectiles get extra outer glow + white center highlight.
- **Thousand Edge**: Blue-tinted blades (`#ccddff`) with trail enabled.
- **Death Spiral**: Scythe shape (dual curved blades, fast spin), red trail, bigger radius.
- **Heaven Sword**: Ornate flared cross shape, slower spin.
- **Soul Eater**: Three-layer aura (outer fade + pulsing fill + bright ring + inner drain ring).
- **La Borra**: Purple AOE zones with pulse animation and bright core.
- **Hellfire**: Multi-ring inferno explosion (shockwave + fire layers + white-hot center). Longer duration (0.4s). Evolved flag flows from projectile → `doExplosion`.
- **Thunder Loop**: Blue-white chain lightning (thick `#88ccff` outer + white core), impact flash at targets. 2 chains (was 1), wider chain range.
- **Bloody Tear**: Wider double-edged crimson slash, dual center lines, longer fade (0.25s).
- New compact protocol fields: `evolved` flag on projectiles (idx 9), AOE zones (idx 5-6), lightning (idx 4), slash (idx 6), explosions (idx 4).

## 2026-02-17 19:32 — Keyboard Slow Walk (Shift)
- **Slow walk on keyboard**: Hold Shift while moving to walk at 40% speed, matching the analog stick slow-walk that controllers already had. Works with both WASD and arrow keys. Applies to both server input and client-side prediction.

## 2026-02-17 19:31 — Separate Weapons & Passives in Skill Bar
- **Visual separation**: Weapons and passives in the bottom HUD are now clearly distinct. Each group has its own "WEAPONS" / "PASSIVES" label above it. Passive slots have a purple-tinted border and background instead of matching weapon slots. The divider between them is now a gradient line with more spacing.
- **Groups hide when empty**: Each group (label + slots) is fully hidden when there are no items of that type, so no empty labels appear.

## 2026-02-17 19:29 — Auto-Scale All UI Screens
- **Generic screen scaling**: Replaced lobby-only `scaleLobbyContent()` with generic `scaleScreen()` that works on any screen with a `.screen-content` wrapper. Auto-scales content to fit viewport using `transform: scale()`.
- **Profile screen scaling**: Wrapped Characters & Upgrades screen content in scaleable container. Re-scales on tab switch, character unlock, and meta upgrade purchase.
- **Level-up screen scaling**: Wrapped upgrade card choices in scaleable container. Re-scales on reroll.
- **Options screen scaling**: Wrapped options content in scaleable container.
- **Resize handler**: Now scales all active screens on window resize, not just lobby.
- **Character icon canvas fix**: Added `width: 100%; height: 100%` to `.char-card canvas` to prevent global `100vw/100vh` canvas rule from blowing up character icons.

## 2026-02-17 19:19 — Evolved Weapon Balance Pass
- **Soul Eater lifesteal**: 20% → 8%, added per-tick heal cap at 3% of maxHp. Prevents full-heal every tick when surrounded by many enemies.
- **Bloody Tear lifesteal**: 15% → 6%, added per-swing heal cap at 4% of maxHp. Still provides meaningful sustain without making the player unkillable.
- **Thousand Edge**: Cooldown 0.25s → 0.45s, count 6 → 4. Was 3.5x faster than base knife with 6 projectiles — brought to a reasonable 1.56x faster with 4 projectiles.
- **La Borra (evolved holy water)**: Count 3 → 2 zones, duration 4.0s → 3.0s, tick rate 0.25s → 0.35s. Total damage ticks per cast went from 48 to ~17 — still a clear upgrade over base but no longer a screen-melting monster.
- **Thunder Loop**: Chain count 2 → 1, chain damage 0.6x → 0.5x. Limits total targets hit from 18+ down to 12, prevents full-screen chain spam.
- **Death Spiral**: Damage 40 → 35, pierce 8 → 5. Spiral pattern already covers all angles — pierce 8 was overkill.
- **Heaven Sword**: Pierce 20 → 12. Still very high for boomerangs but no longer feels unlimited.
- **Holy Wand**: Cooldown 0.5s → 0.6s, count 4 → 3. Homing already makes every shot count — didn't need 4 projectiles at near-instant fire rate.

## 2026-02-17 19:22 — Visual Map Border
- **Map edge border**: Added a three-layer visual border at the world edges. Dark void outside the map, a pulsing crimson gradient warning zone (150 units inner strip), and a glowing red/orange border line at the exact boundary. Makes it immediately obvious when you're at or near the edge of the map.

## 2026-02-17 19:06 — Visual Overhaul + Pickup Fixes + Evolution UI
- **Non-round projectile shapes**: All projectile types now have distinct non-circular shapes to differentiate them from round enemies. Star (wand), blade (knife), diamond (fire wand), cross (boomerang), axe (spinning) shapes. Each has trail/glow effects.
- **Fix enemy shadows on top of other enemies**: Enemy shadows are now rendered in a separate pass before enemy bodies, preventing shadows from appearing on top of overlapping enemies.
- **Fix XP/pickup magnet overshooting**: Magnet-pulled pickups could overshoot past the player and oscillate without being collected. Now clamps pull distance and recalculates collection after pull.
- **Fix health/XP pickup blinking**: Pickups cycling in/out of the 60-pickup broadcast cap caused blinking. Now prioritizes heals/chests (always sent), sorts XP by distance (closest first), increased cap to 80.
- **Evolution hints in both directions**: Level-up cards now show evolution recipes at ALL weapon levels (not just max), passive cards always show which weapon they can evolve (not just when weapon is max), skill bar passive tooltips show evolution info, evolved weapon tooltips show "evolved from" info.
- **Evolved weapon skill bar icons**: Evolved weapons now have an animated golden pulse glow, ★ indicator, and darker background to clearly distinguish them from base weapons.

## 2026-02-17 18:52 — Holy Water Spawn Distance Fix
- **Increased holy water spawn distance**: Pools were spawning 40-120px from the player (practically on top of them). Now uses a normal distribution centered at 200px (stddev 60, clamped 80-400px). Most pools land at a natural mid-range distance with occasional close/far outliers.

## 2026-02-17 18:49 — Game Scaling, Passive Display, Skill Tooltips
- **Auto-zoom for high-res displays**: Canvas now renders at a reduced internal resolution (~720p effective height) and CSS scales it up to fill the window. On 1080p this means ~1.5x zoom, on 1440p ~2x, on 4K ~3x. Game elements are no longer tiny on large/high-res screens. Mouse input adjusted for zoom.
- **Passive display in HUD**: Passives now appear in their own column to the right of weapons in the bottom skill bar, separated by a divider. Server now sends `passives` in player static data.
- **Skill tooltips**: Hovering over weapon or passive slots shows a tooltip with name, level, description, and level-specific upgrade details. Weapon tooltips also show evolution recipe hints (which passive evolves into which weapon).

## 2026-02-17 18:42 — Fix Rerolls Defaulting to 1 at Meta Level 0
- **Bug fix**: Players with meta reroll level 0 were getting 1 reroll per level-up instead of 0. The `|| 1` fallback in three places (level-up trigger, skip handler, choice handler) treated 0 as falsy and defaulted to 1. Changed to `|| 0` so reroll count strictly matches meta progression level (0 = 0 rerolls, 1 = 1, ..., 10 = 10).

## 2026-02-17 18:37 — Improve Locked Character Card Readability in Shop
- **Redesign lock overlay**: Moved from a full-card dark overlay (which obscured the description, stats, and weapon info) to a bottom-anchored gradient bar showing a lock icon + gold cost. Card content (description, stats, starting weapon) is now fully readable even on locked characters.

## 2026-02-17 18:31 — Fix Enemy Spawn Near World Edges + Spectator UI Fixes
- **Fix enemies spawning on top of players near world edges**: When players were near the world boundary, enemy spawn positions got clamped to bounds and could end up directly on the player (e.g., 80 units away instead of 500-700). Now retries up to 5 different angles; skips spawn if all attempts are too close. Same fix applied to boss spawns (also added missing world-bounds clamping for bosses).
- **Fix spectator bar stuck after game end/give up**: The spectating UI (name, nav arrows, respawn timer) was not being hidden when the game ended or the player gave up. Now explicitly resets spectator state and hides the bar on game_end.
- **Move spectator bar to bottom center**: Spectator UI now shows at the bottom center of the screen instead of centered on top of the spectated player.

## 2026-02-17 16:45 — Economy Rebalance: 1 Month → 1 Week
- **~2.4x gold earning rates** to compress full progression from ~1 month to ~1 week (tuned for 5-6 runs/day):
  - Gold per second: 0.5 → 1.2
  - Gold per kill: 0.2 → 0.5
  - Victory bonus: 500 → 1,200
- Average gold per 20-min winning run: ~1,200 → ~2,940
- Estimated ~38 runs (~1 week at 5-6 runs/day) to complete all unlocks

## 2026-02-17 16:15 — Fix Missing Weapon Visuals
- **Whip slash effect**: Whip attacks now display a visible tapered lash shape in the attack direction. Previously the whip was completely invisible — enemies would take damage with zero visual feedback.
- **Bloody Tear slash effect**: Evolved whip now shows red slash effects in both directions (forward + behind).
- **Fire Wand explosion effect**: Fireball impacts now display an expanding explosion flash (outer ring + inner flash + white center). Previously projectiles would vanish on hit with no explosion visual.
- **Hellfire explosion effect**: Same explosion visual for the evolved fire wand.
- Added new `slashEffects` and `explosionEffects` data channels (server broadcast + client decode + fade rendering).

## 2026-02-17 16:12 — Reroll Upgrade Rework
- **Rerolls no longer granted by default.** Players start with 0 rerolls. Must purchase the Reroll meta upgrade to unlock them.
- **Reroll meta upgrade expanded to 10 levels** (was 5). Level 1 = 1 reroll, level 10 = 10 rerolls. Cost curve: 200, 400, 700, 1100, 1600, 2200, 2900, 3700, 4600, 5500 gold.

## 2026-02-17 16:11 — Replace Browser Popups with In-Game Modal
- Replaced all browser `alert()` and `confirm()` calls with a styled in-game popup modal. Affected: character unlock confirmation, character unlock error, meta upgrade error, account reset error. The modal uses the game's dark theme with gold accents and animated entrance.

## 2026-02-17 16:09 — Fix Chrome Password Check Popup
- Changed password input from `type="password"` to `type="text"` with CSS `-webkit-text-security: disc` masking. Chrome ignores `autocomplete="off"` on password fields and triggers the "Check passwords" popup. Using a text input with visual masking prevents Chrome from detecting it as a credential field, eliminating the popup entirely.

## 2026-02-17 15:53 — Reset Account & Delete Account
- **Reset Account**: New button in Options > Account. Wipes all progression (gold, XP, level, kills, unlocks, upgrades) back to fresh state with only Knight unlocked. Account (username/password) is preserved. Two-step confirmation required.
- **Delete Account**: New button in Options > Account. Permanently removes the account and all data. Requires typing your username to confirm. Logs out and returns to auth screen.
- Added danger-styled buttons (red) for destructive actions.

## 2026-02-17 15:43 — Hide HUD on Menu/Lobby Screens
- **Fix HUD overlapping lobby content**: The game HUD (timer, level, kills, Give Up) was rendering on top of the lobby screen and other menu screens, covering the "CO-OP LOBBY" title and top content. HUD is now hidden when any screen overlay is active and shown only during gameplay.

## 2026-02-17 15:29 — Fix Lobby Auto-Scale Clipping
- **Fix top content clipping**: Lobby auto-scale was placing content at the very top of the container with no padding, causing the "CO-OP LOBBY" title to get clipped. Added 15px padding to the lobby container and updated the scale calculation to subtract padding from available space.

## 2026-02-17 14:00 — Reroll Limit + Meta Upgrade + Lobby Auto-Scale
- **Reroll limited to 1 per level-up**: Rerolls are no longer infinite. Base rerolls per level-up: 1. Button shows remaining count and disables when exhausted.
- **Meta upgrade: Reroll**: New permanent meta upgrade (5 levels, costs 200-1600 gold). Each level grants +1 reroll per level-up, up to 6 total.
- **Co-op lobby auto-scaling**: Lobby page now scales its content to fit the viewport instead of allowing scrolling. Rescales on window resize and when lobby info appears.

## 2026-02-17 13:49 — Rejoin State Preservation + Upgrade Skip/Reroll Fix
- **Rejoin restores player state**: When a player gives up, leaves, or disconnects from a running game and rejoins the same room, their full state is restored — character, weapons, passives, stats, level, kills, etc. Previously, rejoining created a fresh level-1 player.
- **Forced character on rejoin**: Rejoining a room forces the same character the player originally started with. The server ignores the client's character selection on rejoin.
- **Room persistence for rejoin**: Rooms with disconnected players are kept alive (not deleted) so players can rejoin. Rooms are cleaned up when the game ends or when all players and disconnected players are gone.
- **Fix upgrade skip doing nothing**: Skip appeared to not work because level-up choices were being double-queued — the server sent each level-up on trigger AND again after the previous pick/skip. Skipping one copy immediately showed the duplicate with identical choices. Fixed by only sending the first pending level-up; subsequent ones are sent after each pick/skip/reroll.
- **Fix reroll adding duplicates to queue**: Reroll response (`level_up` with `rerolled: true`) was being pushed to the queue as a new entry instead of replacing the current display. Every reroll added a phantom pending level-up. Now reroll replaces the current choices in-place.
- **Pending count uses server count**: The "X more pending" text now uses the server's authoritative pending count instead of the client queue length, preventing inflated numbers.

## 2026-02-17 13:15 — Three UI/UX Bug Fixes
- **Damage numbers on insta-kills**: Enemies killed in a single frame (before client saw HP drop) now show their damage number. Previously only enemies whose HP decreased across frames spawned floating damage text.
- **Lobby scroll fix**: Room lobby no longer causes page-level scrolling when many players join. Player list scrolls internally within a constrained box.
- **Character icon cursor fix**: Hovering over the mini character canvas on unlocked char-cards now shows a pointer cursor instead of hiding it. The global `canvas { cursor: none }` rule was overriding char-card cursor styles.

## 2026-02-17 13:02 — Major Character Balance Overhaul
- **Necromancer**: Capped mightPerKill at +1.5 max with diminishing returns past 50% of cap. Was infinite scaling — dominated every other class by minute 5.
- **Priest**: Now self-heals at 50% aura rate (was 0 in solo). Heal aura scales with game time (3→8 HP/s over 15 min). Added +10% area bonus. HP 85→95. Cost 5000 (unchanged). No longer useless in solo.
- **Druid**: Might aura now buffs self at 50% rate (was self-excluded). Heal-on-kill rate-capped at 20 HP/sec to prevent infinite scaling at high kill rates. Aura buffed 0.10→0.15. Cost 8000→6000.
- **Paladin**: Armor 2→1, HP 150→140, maxHP 25%→20%. Cost 3000→5000. Was the best class for 3000 gold — now properly priced for its tankiness.
- **Berserker**: Rage cap 80%→100% might. Added 15% lifesteal on kill (scales with missing HP). Base might 0.05→0.10, HP 90→100. Cost 18000→10000. Was worst value in the game — now a viable high-risk playstyle.
- **Armor formula**: Changed from flat subtraction (`dmg - armor`) to percentage-based (`armor/(armor+10)` reduction). Fixes armor making you immune to weak enemies while being useless vs strong ones.
- **Stat pollution fix**: Special ability keys (healAura, berserkerRage, etc.) no longer get added to the generic stats object.

## 2026-02-17 12:35 — Security: Remove Client-Side Dev Secrets + Hash All Transit
- **SECURITY FIX**: Dev secret passwords were hardcoded in client-side HTML, fully visible in browser DevTools. Removed all plaintext secrets from client code.
- **Hashed transit**: Client now SHA-256 hashes every possible suffix of the typed buffer before sending. Server compares against pre-computed hashes. The raw secret never appears in source code, network requests, or DevTools — only opaque hex hashes are transmitted.

## 2026-02-17 — Fix Dev Reset Removing Starter Character
- **Fixed**: Account reset no longer removes the Knight starter character — knight unlock is re-added immediately after wiping all unlocks.

## 2026-02-17 12:26 — Fix Dev Secret Code Input
- **Fixed secret code input bug**: Modifier keys (Shift, Ctrl, Alt) were clearing the keypress buffer, so any secret requiring uppercase or shifted characters could never be typed. Now modifier keys are ignored instead of resetting the buffer.

## 2026-02-17 12:22 — Dev Test Mode
- **Added secret dev gold cheat**: Type the secret password on the main menu to set gold to 999,999. Protected by server-side secret validation — no UI hints exist. For tester use only.
- **Added secret dev progression reset**: Type a second secret password on the main menu to reset all gold, XP, level, unlocks, and upgrades to zero. Same secret-protected pattern.

## 2026-02-17 11:52 — Polish & Edge Case Fixes

- **Fixed AOE zone smoothing key collisions**: AOE zones used position-based cache keys (`aoe_x_y_idx`) which collided when zones overlapped, causing jitter. Server now assigns unique IDs to each zone; client uses `aoe_<id>` as the smoothing key.
- **Fixed WebSocket close/open race condition**: Calling `connectWS` while a previous socket was closing could fire stale events on the new connection. Old socket handlers are now detached before close, and all new handlers guard against stale socket references.
- **Fixed gamepad multi-controller edge cases**: Input from all connected gamepads was mixed together (first with input wins per-frame). Now locks to the first controller that provides input and sticks to it until disconnected, preventing cross-controller interference.
- **Fixed canvas textAlign/textBaseline state leaks**: 5 locations set `ctx.textAlign = 'center'` or `ctx.textBaseline = 'middle'` without cleanup — `DmgNumbers.draw()`, `drawPlayer()`, `drawEnemy()` (boss name), off-screen player arrows, and death overlay. All now use `ctx.save()`/`ctx.restore()` for proper state hygiene.
- **CSS dead code audit**: Reviewed all 233 lines of CSS — no unused selectors found.

## 2026-02-17 11:45 — Bug Fix Pass

### Critical
- **Fixed final boss never spawning**: Victory check ran before boss spawn logic at minute 20, causing instant victory without fighting the dragon. Moved boss spawn check above victory check.

### High
- **Fixed division by zero in pickup magnet**: When a player stood exactly on a pickup (distance=0), dividing by zero produced NaN coordinates, making the pickup permanently uncollectible.
- **Fixed healer aura invisible**: `Camera.scale` was undefined (Camera has no zoom), so Priest/Druid heal radius visual was `NaN` and never rendered. Now uses direct world units.
- **Fixed evolved garlic (Soul Eater) losing visual aura**: Client only checked for `weapons.garlic` key, but evolution replaces it with `soul_eater`. Now renders both with appropriate colors/sizes.
- **Added API error handling**: `apiPost`/`apiGet` now catch network failures and non-OK responses instead of throwing unhandled exceptions that silently break login/profile flows.

### Medium
- **Fixed bosses could be despawned by kiting**: All enemies >1200 units from players were despawned, including bosses. Bosses are now exempt from distance despawn.
- **Fixed upgrade choice consuming pending entry before validation**: Sending an invalid `choiceIndex` would permanently lose the level-up. Now validates before consuming.
- **Fixed `player.level` always 1 in upgrade notifications**: Used per-player level (never updated) instead of shared room level in follow-up level_up messages.
- **Fixed off-screen player arrows at cardinal directions**: `Math.tan()` approach produced Infinity at 0/90/180/270 degrees, sending arrows to screen corners. Replaced with parametric ray-box intersection.
- **Fixed lightning effects pop in/out without fade**: Lightning was recreated from server state each tick (no decay). Now accumulated client-side with smooth fade-out and stable bolt shapes (no per-frame flicker).
- **Added WebSocket JSON parse error handling**: Malformed server messages no longer crash the client message handler.
- **Added session expiration (24h TTL)**: Sessions previously never expired, growing memory unboundedly. Added hourly cleanup sweep.

### Low
- **Fixed enemy spawns outside world bounds**: Enemies near world edges could spawn at negative coordinates. Now clamped to world bounds.
- **Removed no-op WAL pragma**: sql.js is in-memory; WAL mode had no effect.
- **Fixed XP bar NaN**: Division by zero when `roomXpToNext` is 0 could produce invalid CSS width.
- **Cleared client lightning effects on game start**: Prevents stale lightning from previous game bleeding into new session.

## 2026-02-17 11:33

- **Added 4 new characters** (8 total):
  - **Priest** (Healer): Healing aura passively restores HP to nearby allies (3 HP/s within 150px). High regen, starts with Holy Water. Cost: 5,000 gold.
  - **Druid** (Healer): Kills heal all nearby allies (+5 HP). Grants +10% Might aura to nearby teammates. Starts with Garlic. Cost: 8,000 gold.
  - **Necromancer**: Gains +0.2% Might per kill — snowballs into a glass cannon. Starts with Lightning Ring. Cost: 12,000 gold.
  - **Berserker**: Up to +80% bonus damage at low HP (Berserker Rage). Fast and aggressive, starts with Axe. Cost: 18,000 gold.
- **Visual healer aura rings**: Priest shows pink dashed circle, Druid shows green dashed circle around their heal/buff radius.
- **Complete economy overhaul** (target: ~1 month to fully complete):
  - Gold per second: 3 → 0.5
  - Gold per kill: 1 → 0.2
  - Victory bonus: 2,000 → 500
  - Character unlock costs rebalanced: 0/500/1,500/3,000/5,000/8,000/12,000/18,000
  - Meta upgrades expanded to 10 levels each (was 5) with exponentially increasing costs
  - Total gold to unlock everything: ~88,000 (was ~11,350)
  - Average gold per 20-min run: ~700 (was ~4,000), ~1,200 with victory
  - Estimated ~90 runs (~1 month at 3 runs/day) to complete all unlocks
- **Updated Gold Hoarder achievement** threshold: 10,000 → 50,000

## 2026-02-17 11:25

- **Added Options screen**: Accessible from main menu with volume sliders (Master, SFX, Music), SFX/Music enable toggles, and Spectator Mode toggle. All settings persist to localStorage.
- **Added Spectator Mode**: When dead in co-op, camera follows alive teammates instead of staring at your corpse for 10s. Use Q/E keys or on-screen buttons to cycle between teammates. Death overlay becomes translucent so you can watch the action. Shows respawn timer and spectated player name. Can be toggled off in Options.
- **Improved minimap readability**: Increased minimap size from 100px to 180px. Added grid lines for orientation, larger player/enemy dots, glow effect on local player, boss enemies shown bigger in brighter red, and chest/heal pickups shown on map. Higher opacity background for better contrast.

## 2026-02-17 11:18

- **Added Reroll/Skip on upgrade screen**: Players can now reroll for new random choices or skip a level-up entirely during the upgrade selection screen. Buttons appear below the upgrade cards.
- **Added Damage Numbers**: Floating damage numbers now appear above enemies when they take damage. Critical hits (>15% of max HP) shown in gold. Numbers float upward and fade out.
- **Added Death Particles**: Enemies now burst into colored particles matching their color when killed, plus white sparkle particles for visual feedback.
- **Added Achievement System** (18 achievements):
  - Combat: First Blood, Slayer (100 kills), Mass Extinction (500 kills), Boss Slayer
  - Survival: Survivor (5min), Enduring (10min), Ironclad (15min), Champion (victory)
  - Progression: Evolution, Perfection (max weapon), Full Arsenal (6 weapons), Experienced (Lv20), Veteran (Lv40)
  - Account: Gold Hoarder (10k gold), Genocide (1k total kills), Armageddon (10k total kills), Regular (10 games), Collector (all characters)
  - Achievements persist in database, displayed in new Achievements tab in Characters & Upgrades screen
  - Achievement unlock notifications shown with golden border at end of game
  - API endpoint: GET /api/achievements returns all definitions + earned list

## 2026-02-17 11:07

- **Added 3 new weapons** with full 7-level progression and evolution paths:
  - **Axe** (🪓) — Throws high-damage axes that arc through enemies with gravity. Evolves with Spinach into **Death Spiral** (axes spiral outward in all directions)
  - **Whip** (🦯) — Instant horizontal lash hitting enemies in a line. At Lv 7 hits behind too. Evolves with Wings into **Bloody Tear** (life-stealing whip lashes both ways)
  - **Cross** (✝️) — Boomerang projectile that goes out and returns, hitting enemies twice. Evolves with Empty Tome into **Heaven Sword** (3 homing boomerangs with massive pierce)
- Added gravity physics for axe projectiles and boomerang return mechanic for cross projectiles

## 2026-02-17 11:02

- **Added Weapon Evolution system**: Core Vampire Survivors mechanic — max a base weapon (Lv 7) + have the required passive, then pick up a chest to evolve. 6 evolution recipes:
  - Magic Wand + Empty Tome → Holy Wand (homing bolts, 4 projectiles, high pierce)
  - Knife + Spinach → Thousand Edge (6 rapid-fire knives, high speed)
  - Garlic + Hollow Heart → Soul Eater (massive aura, life steal 20% of damage dealt)
  - Holy Water + Attractorb → La Borra (3 pools that follow the player)
  - Fire Wand + Candelabrador → Hellfire (4 huge explosive fireballs)
  - Lightning Ring + Armor → Thunder Loop (6 targets + chain lightning)
- Chests now check for evolution eligibility before giving a level-up (evolution takes priority)
- Evolved weapons show golden border + "EVO" label in weapon HUD
- Evolution notification banner shown to all players when someone evolves
- Level-up cards show evolution hints (which passive is needed at Lv 7, or which weapon a passive enables)
- Added "evolve" sound effect (ascending chord)
- Homing projectile system (used by Holy Wand) — projectiles steer toward nearest enemy
- Follow-player AOE zones (used by La Borra) — pools orbit around the player

## 2026-02-15 15:49

- **Deployed to VPS**: Mirror-style deploy via deploy.ps1. Service roguelite.service restarted, https://roguelite.shadowdog.cat verified live (HTTP 200).

## 2026-02-15 15:41

- **Fixed projectile knockback pulling enemies toward player**: Projectile hits (magic wand, knife, fire wand) were dragging enemies toward the player instead of pushing them away. The knockback direction vector `dx = proj.x - e.x` pointed from enemy to projectile (i.e. toward the player), but was being added to enemy position. Reversed the sign so enemies are correctly knocked away from the projectile impact.

## 2026-02-15 15:31

- **Removed player knockback on enemy contact**: Players no longer get pushed back when hit by enemies, matching the original Vampire Survivors behavior where enemies deal damage on contact without displacing the player. Removed the 30px server-side push and all client-side knockback prediction/cooldown logic. Garlic knockback on enemies is unchanged.

## 2026-02-15 15:27

- **Fixed Max HP meta upgrade not applying to starting health**: Players with Max HP meta upgrades were starting games with base HP instead of their upgraded max HP. Root cause: `recalcPlayerStats` correctly increased `maxHp` but only clamped `hp` downward (`Math.min`), never upward. Added `player.hp = player.maxHp` after the initial stat recalc so new players always start at full health.

## 2026-02-15 15:23

- **Fixed phantom contact damage**: Reduced player collision radius from 12 to 8 to match the visible character body width (~8px half-width). Previously the hitbox extended 4px beyond the character on every side, causing players to take contact damage from enemies that weren't visually touching them.
- **Fixed boss spawn timing**: Bosses were spawning 6 seconds early (e.g. Reaper at 4:54 instead of 5:00) because `getBossForTime` used `minute >= 4.9` thresholds. Changed to exact minute boundaries: Reaper at 5:00, Lich at 10:00 and 15:00, Dragon at 20:00.

## 2026-02-15 15:06

- **Deployed to VPS**: Mirror-style deploy via deploy.ps1. Service roguelite.service restarted, https://roguelite.shadowdog.cat verified live (HTTP 200).

## 2026-02-15 15:04

- **Fixed rejoin gold earning**: Removed the overzealous gold deduction ledger (`userGoldAwarded`) that was zeroing out gold on rejoin. The personal-time-based calculation alone is sufficient anti-farm protection — each session earns gold only for time actually played and kills made in that session. Rejoiners now properly earn gold for each session they play. Additionally, `games_played` now only increments on the first session in a room (not on rejoins), preventing stat inflation.

## 2026-02-15 14:59

- **Deployed to VPS**: Mirror-style deploy via deploy.ps1. Service roguelite.service restarted, https://roguelite.shadowdog.cat verified live (HTTP 200).

## 2026-02-15 14:53

- **Fixed gold farming exploit via rejoin**: Players could give up, rejoin the same room, and give up again to repeatedly earn gold based on the total room time. Fix: (1) Gold is now calculated based on personal time played since joining, not total room time. (2) A per-user gold ledger tracks total gold already awarded in each room — rejoining and giving up again only awards the incremental difference, preventing double-dipping. (3) The same deduplication applies to the natural game end (victory/gameover). Players can still freely rejoin rooms but won't profit from it.
- **Fixed invisible game on rejoin during skill selection**: When a player joined a running game that was paused (other players choosing upgrades), they saw a blank screen because the server's tick loop skips broadcasting while paused. Fix: the server now sends an immediate state snapshot to the joining player on mid-game join, plus the current pause state if the game is paused. This ensures the new player sees the game world and the "waiting for upgrade choice" overlay right away.

## 2026-02-15 14:20

- **Fixed excessive knockback with speed boosts**: When the player had speed upgrades, getting hit by an enemy caused a massive visual knockback. Root cause: client-side prediction drifts further ahead of the server at higher speeds. The old `onKnockback` snapped position from predicted to server, so the visual displacement = prediction gap + actual push (30px). With high speed the prediction gap alone could be 40-70px, making knockback feel enormous. Fix: now applies only the knockback delta (server new pos - server old pos) to the predicted position, keeping visual knockback at a consistent 30px regardless of speed.

## 2026-02-15 13:55

- **Fixed damage knockback for real**: Three-part fix for knockback visual bugs:
  1. **Other players no longer bounce wildly when hit**: During iframes, ALL interpolation and extrapolation is now bypassed — other players use raw server positions. Previously the snapshot interpolation would extrapolate the knockback velocity, overshooting the actual position and then snapping back on the next update, creating a back-and-forth bouncing effect.
  2. **Local player now visibly shows knockback**: On hit, the client-side prediction snaps to the server's post-knockback position AND suppresses input-based movement for 150ms. This gives the player time to actually see/feel the push before movement resumes. Previously the prediction absorbed the push in a single frame (~16ms) and immediately resumed input, making it invisible.
  3. **Increased knockback push from 15px to 30px**: The old 15px push was barely perceptible even when rendered correctly. Doubled to 30px for clear visual feedback on both local and remote players.

## 2026-02-15 13:30

- **Gold economy rebalance**: Completely rebalanced the gold economy so that ~1 hour of active gameplay (~3 games) is enough to unlock all characters and max all meta upgrades. Gold earning increased from ~165/game to ~4,000-8,000/game (3 gold/sec survived + 1 gold/kill + 2,000 victory bonus). Character unlock costs reduced (rogue 500→200, mage 1000→500, paladin 2000→1000). Meta upgrade costs reduced ~75% across the board. Total cost to unlock everything: ~11,350 gold (was ~34,500).

## 2026-02-15 13:24

- **Removed enemy-enemy separation**: Enemies now freely overlap and stack on top of each other, matching Vampire Survivors' behavior. Previously enemies pushed apart with a 30% force over 5-neighbor checks, creating unnatural spacing. Dense horde pileups now form naturally.

## 2026-02-15 13:02

- **Netcode optimization for co-op**: Doubled server broadcast rate from 10Hz to 20Hz (matching tick rate) so remote players update every 50ms instead of 100ms. Reduced client interpolation window from 120ms to 65ms accordingly. Increased client input send rate from 30Hz to 50Hz. Improved local prediction reconciliation with adaptive correction (3-15% per frame based on divergence distance, was flat 1%). Combined effect: remote player movement perceived latency reduced from ~250ms to ~130ms.
- **Fixed movement during pause**: Players can no longer move during pause (upgrade selection or manual Escape pause). Server now rejects input messages while paused and zeros all player inputs on pause start. Client stops sending input and running local prediction during pause. Previously, client-side prediction would move the player locally during pause, then snap back to the correct position on unpause.
- **Verified give-up is per-player**: Give Up button only ends the game for the player who presses it. Other players in the room receive a `player_left` event and continue playing. Gold calculation for give-up uses the same formula as natural game end (time-based + kill-based gold, XP from time + kills) without the victory bonus.

## 2026-02-15 13:00

- **Fixed duplicate room join bug**: Prevented the same user (by userId) from joining or creating multiple rooms simultaneously. A `userRooms` map tracks which userId is in which room, and attempts to join/create while already in a room return an error. Cleanup occurs on leave/disconnect.

## 2026-02-15 12:45

- **Added manual pause system**: Any player can pause the game by pressing Escape (or gamepad Start button). In multiplayer, any player can pause and any player can unpause. The pause overlay shows who paused the game and includes a Resume button. Manual pause works alongside the existing upgrade-choice pause (both can be active simultaneously — the game stays paused until both are resolved). Solo players can also pause with Escape.

## 2026-02-15 10:22

- **Deployed to VPS**: Mirror-style deploy via deploy.ps1. Service roguelite.service restarted, https://roguelite.shadowdog.cat verified live (HTTP 200).

## 2026-02-15 10:18

- **Deployed to VPS**: Mirror-style deploy to root@91.98.135.72. Transferred code, ran npm install, restarted roguelite.service. Created `deploy.ps1` for future one-command deploys.

## 2026-02-15 10:06

- **Fixed stuttery/teleporting enemy movement**: The previous snapshot interpolation clamped `t` to 1.0, causing enemies to freeze at their target position while waiting for the next server message (100ms later). Any network jitter created a visible move-pause-move-pause stutter. Fix: added velocity extrapolation when `t > 1.0` so enemies keep moving in their last direction instead of stopping. Also increased interpolation buffer from 100ms to 120ms for jitter tolerance. Sent enemy positions with 1 decimal place (was integer-rounded) to eliminate rounding-induced stepping at low speeds. Applied same extrapolation fix to other-player interpolation.

## 2026-02-15 10:25

- **Fixed jittery enemy movement**: Replaced velocity-estimation + lerp interpolation (which caused stepping/oscillation due to float comparison issues and extrapolation fighting correction) with snapshot interpolation. Enemies and other players now smoothly interpolate from their previous position to the new server position over 100ms (matching the 10Hz broadcast rate), eliminating jitter entirely.

## 2026-02-15 10:16

- **Made movement feel more instant**: Reduced server-correction drag from 5% to 1% per frame — prediction now trusts client input more and barely fights it. Increased dead-zone for corrections (2px→5px) so micro-jitter doesn't cause drag. Lowered hard-snap threshold (80→50px) so real desyncs correct faster. Bumped input send rate from 20Hz to 30Hz for snappier server response.

## 2026-02-15 10:08

- **Fixed enemy stuttering near player**: Proximity-based lerp overrides (0.85/0.5 snap factors) were causing enemies close to the player to rapidly converge to stale 10Hz server positions then visibly jump on each tick. Removed the aggressive proximity correction — velocity extrapolation + standard lerp now handles all enemies uniformly and smoothly.

## 2026-02-15 09:51

- **Fixed heavy input lag on player movement**: Added client-side prediction so the local player moves instantly on input instead of waiting for the server round-trip. Server position is reconciled smoothly to prevent drift. Also sends `baseSpeed` in player static data so the client can predict at the correct speed.
- **Fixed jittery movement from prediction**: Reconciliation was running every render frame against the same stale server data, fighting the prediction. Now reconciliation (`onServerUpdate`) only runs when new server data arrives via WebSocket, and a gentle per-frame drift correction prevents long-term divergence without causing jitter.

## 2026-02-15 09:39

- **Fixed invisible enemy damage bug**: Server broadcast capped at 150 enemies in spawn order, meaning nearby enemies could be invisible but still deal contact damage. Now sorts by distance to player (closest first) and increased cap to 200.
- **Fixed client interpolation overshoot**: Enemies near the player now snap much harder to their server position, preventing visual offset that made contact damage feel unfair (enemies appearing further away than they actually are).
- **Rewrote bat files for local dev**: Removed Caddy reverse proxy dependency from start/stop/restart scripts. Now launches only the Node.js server on `http://localhost:3002` in console mode. Replaced deprecated WMIC with PowerShell `Get-CimInstance` for PID management.
- **Switched from better-sqlite3 to sql.js**: Pure JavaScript SQLite driver — no native compilation or Visual Studio required. Same `.db` file format, works on any platform including VPS. Old database removed (fresh start).

## 2026-02-13 21:28

- Added Caddy reverse proxy configuration (`Caddyfile`) serving on port 4005 for domain `roguelite.shadowdog.cat`
- Node.js backend remains on internal port 3002, proxied through Caddy
- Created `start.bat` to launch both Node.js server and Caddy proxy
- Created `stop.bat` to cleanly shut down both services by PID (avoids killing unrelated node processes)
- Created `restart.bat` to stop and restart both services
- Created `readme.md` with project documentation
- Created `changelog.md`
