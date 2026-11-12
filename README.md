# Exile Guide: PoE1 campaign overlay

A step-by-step overlay for the Path of Exile 1 campaign. It follows you through the acts by reading `Client.txt` and shows, for the build you choose:

- **The current step**: where to go next, quest items and bosses, plus the directional hints from the speedrun route.
- **Gem actions at each quest hand-in**: which reward to **take** and which gems to **buy**, from which NPC, at what cost, with a vendor search string.
- **Links for your level**: each socket group, with a mark for gems you have and where to get the ones you don't.
- **Passive tree for your level**: the next notables, keystones and masteries to take (with the small nodes on the way), respecs at stage changes, and the ascendancy nodes for your next lab. It follows what you actually allocate, read from `Client.txt`.
- **Gear for your level**: weapon and item progression from the build's PoB item sets, plus your own milestones (movement-speed boots, weapon recipe, resist checks).
- **After Act 10, chapters to 4 voidstones**: early maps, white / yellow / red maps, then one chapter per voidstone, with the crafting steps, the order of upgrades and the search strings for each. The links and gear panels switch to the PoB set for that chapter.

The route and quest/vendor data come from [exile-leveling](https://github.com/HeartofPhos/exile-leveling) (MIT licence) in `data/exile-leveling/`. It is still the 3.29 data (exile-leveling had no 3.30 update on 11 Nov 2026); the 3.30 patch notes only add Arcane Link to campaign vendors and change gem prices (level 28-33 gems cost an Alteration, 34-37 an Alchemy), and the overlay uses the new prices.

## Start it

The app lives in **OneDrive\ExileGuide**, so every PC you sign in to has the same overlay, build, route progress and run timer.

- **First time on a PC**: open `OneDrive\ExileGuide`, run **`Create Desktop Shortcut.cmd`** once, then start it from the desktop shortcut (or **`Start Exile Guide.cmd`**). The first start tells OneDrive to keep the folder downloaded on that PC and finds that PC's `Client.txt` (Steam libraries, the standalone client, common folders). If it can't, set the path in Settings.
- **Switching PCs**: just start it on the other PC. Progress and the timer are saved on every change and picked up by the other PC (an overlay left open on the old PC follows along within a few seconds and never writes older progress back).
- **Per-PC settings** (the `Client.txt` path, the overlay position and size, lock and visibility) are in `user/devices/<PC name>.json`. A window position that isn't on any screen of this PC resets to the top right.

Double-click **`Start Exile Guide.cmd`** in the `PoE1-Speedrun` folder. The overlay appears at the top right, and a gold **›** icon appears in the tray. Right-click the icon for **Build & Settings**, the **Gem plan** and the **Route**.

Run PoE in **Windowed Fullscreen** (borderless), because overlays can't draw over exclusive fullscreen. Keep **local chat on**, since the zone and level-up lines come from it.

## Set up from GitHub (new PC without OneDrive)

1. Install [Node.js](https://nodejs.org) (LTS), then: `git clone https://github.com/angad666/ExileGuide.git` and `cd ExileGuide`, `npm install` (downloads Electron).
2. Run `Start Exile Guide.cmd`. Your progress, timer and per-PC settings live in `user/`, which is not in the repo; copy that folder over if you want to keep them.
3. `Build Loot Filter.cmd` builds the filter into `DocumentsMy GamesPath of Exile`.

## Hotkeys (change them in Settings)

| Key | Does |
|---|---|
| F2 / F1 | Next / previous step |
| Shift+F2 / Shift+F1 | Skip to the next zone / back one zone |
| F3 | Search menu at the mouse: this act's gem buys, then build and general strings. Press 1-9 or click to paste. Esc or F3 closes it |
| F4 | Paste the current gem search into the open vendor (Ctrl+F, Ctrl+A, Ctrl+V) |
| F6 | Cycle build stage (for example the 61 crit swap) |
| F7 | Compact overlay (step only) / full overlay |
| F8 | Lock (click-through) / unlock (drag to move, resize from the edges, buttons) |
| Shift+F8 | Timer: start if idle, pause / resume, or undo an accidental finish |
| F10 | Hide / show |
| F11 | Open Build & Settings |

F5 and F9 are left free for Awakened PoE Trade (`/hideout` and `/exit`). Windows reserves F12. The F3 menu replaces `PoE1 Vendor Regex.ahk`, so don't run both.

The F3 menu's general strings (shop sweep, links, movement speed, flasks) are edited on the Settings tab, and build strings on the Build tab, one per line as `Label => "search"`.

## Run timer

The timer sits under the overlay's header. It shows the run time, the current act's time, the goal for the end of this act, and how far ahead (green) or behind (red) you were at the last split. The run time turns red once you pass the current act's goal.

- **Starts** when you enter The Twilight Strand on a new run. Shift+F8 starts it by hand if it isn't running.
- **Splits** at Brutus (F2 on the Brutus step, or entering Prisoner's Gate), then at the end of each act when you enter the next act's first zone.
- **Finishes** when you press F2 on the Kitava step in Act 10, or when you go from The Feeding Trough to Oriath Docks. If that fires by mistake (for example, you died and went to town), Shift+F8 undoes it.
- **Pauses** on Shift+F8, and starts again by itself on your next zone change. It also pauses in the Labyrinth, because the goal times don't include labs. You can turn that off in Settings.
- **Pauses when you close the game**, so a run can be spread over several sessions and PCs. The overlay checks every 10 seconds whether Path of Exile is running and backdates the pause to when the game was last seen. If the overlay wasn't running when the game closed, it uses the last Client.txt write instead (or, for a run from another PC, that PC's last zone change, once the run has been idle for 10 minutes). Your next zone change after logging in resumes it.
- The timer uses real (wall-clock) time, so restarting the overlay doesn't lose it. Runs are saved in `user/timer.json`.
- In **Settings → Run timer**, choose the comparison (Goal 7h, 5h, 4h, 3h15, your PB, or nothing), reset the timer, and see recent runs. To edit the goal times, change `timer.goals` in `user/settings.json`.

## How it follows you

- **Entering a zone** jumps to the first step for that zone, but only when it's the next zone on the route. Up to 8 zones ahead is allowed for non-town areas, so skipping a zone still works. A town that isn't next on the route is ignored, so extra town trips and deaths don't move the guide.
- **Going ahead of the route** (for example the bandits before the Weaver) doesn't mark the skipped quest work as done. Skipped bosses, quest items, trials, hand-ins and gem rewards in zones you haven't been to show in an orange **Not done yet** box for the rest of the act. Entering one of those zones takes the route back there, follows it through (Weaver, then the town hand-in), and returns to where you were when you rejoin the route. A skipped town hand-in shows in a green **Also hand in here** box on your next visit to that town. Skipped something on purpose? Unlock (F8) and click ✕ on the box.
- **In town**, every gem reward and purchase of the visit is listed under the current step at once (with its search string for F4), so a buy that comes after a hand-in can't be missed.
- **Level ups** set the stage (links and gear). A stage you picked with F6 stays until your level reaches the next stage.
- **A new character** entering the Twilight Strand restarts the route.
- Inside a zone, press F2 as you finish each step. Progress is saved per build in `user/progress.json`.

## Loot filter

`Build Loot Filter.cmd` writes **`SSS-Slayer-3.30.filter`** to `Documents\My Games\Path of Exile` (OneDrive Documents, so every PC has it). In game: Options → Game → Item Filter → SSS-Slayer-3.30.

It combines three parts:
1. `filter/base.filter`: Tytykiller's melee preset of NeverSink's filter, exported from FilterBlade (8.20.0b, 3.29).
2. `filter/sss-block.filter`: the build's key bases, put first so they win. Pink + sound + star = a crafting base to pick up (crit-swap Reaver Axe, tower shields, Royal/Astral Plate, Leviathan/Precursor gloves, Giantslayer/General's helmet, Leviathan Greaves/Brimstone Treads/Two-Toned Boots, Stygian Vise, endgame flask bases, Prismatic Tincture). Pink frame = the same bases as rares to identify. Gold = 5/6-links, and 4-links while levelling. Cyan = movement-speed boots while levelling, and 3.30 Threads.
3. 3.30 fixes: item names that no longer exist (all Scarabs, Templar/Fruiting/Deceptive Astrolabes, Mortal fragments, the Djinn/Mirage coins, Fragmented/Skittering Delirium Orb) are taken out of `BaseType ==` lists, because a filter that names an unknown item fails to load. Custom sounds whose `.mp3` is missing play a built-in sound.

**Sounds**: the base filter's custom sounds (Tytykiller's pack) are not installed, so those rules play built-in alert sounds. To use a sound pack later, put the .mp3 files in `filter/sounds/` and run `Build Loot Filter.cmd` again.

**When NeverSink's 3.30 filter comes out** (normally a few hours before launch): load Tytykiller's preset on FilterBlade (https://www.filterblade.xyz/?profile=Tytykiller&saveState=AAAAMelee&platform=pc), export it, save it over `filter/base.filter`, run `Build Loot Filter.cmd` and reload the filter in game.

## Passive tree

The **Tree** panel (under Links) comes from the build's PoB trees, one per stage, checked against the 3.30 tree (`data/passive-tree.json`, from GGG's [skilltree-export](https://github.com/grindinggear/skilltree-export)).

- **Next to take**: PoB saves a tree as a set of nodes, not an order, so the overlay orders them: from the previous stage's tree, the nearest notable / keystone / jewel socket / mastery first, with the small nodes on the way ("via 3× Dexterity"). A mastery shows the effect to pick.
- **Points**: `allocated/total` for the stage's tree, and **N to spend** when you have unspent points (your level − 1 + quest points received).
- **Respec first**: when a new stage drops nodes (the level-61 crit swap drops the 2H nodes), the nodes to refund are listed until you've refunded them, plus mastery effects to switch.
- **Ascendancy**: the nodes for your next lab, in the build's order (`ascendancyOrder` in the build JSON; Impact, Bane of Legends, Brutal Fervour, Headsman for the included build).
- **How it knows**: Client.txt logs every "Successfully allocated passive skill" and every passive point a quest gives. The overlay counts these (Atlas and other trees are ignored) and catches up on what you did while it was closed. Without that data it follows your level.
- Turn the panel off in Settings (Show passive tree panel).

## Builds

Builds are JSON files in `builds/`. You can switch, edit, duplicate or import them from **Build & Settings**.

- **Import from PoB**: paste a pobb.in, pastebin or poe.ninja link, or a raw code. Each PoB **skill set** and **item set** becomes a stage, and numbers in the title set its levels (`lvl 1-12`, `12-28`, `61 Crit Swap`). Untitled or unnumbered sets count as post-campaign. Check the levels after importing, then **Save & apply**.
- **Stages**: one link group per line (`Label: Gem, Gem, Gem`), one gear item per line (`Slot: [rare] Base | 6S 6L | mod; mod`), plus notes.
- **Extra gems**: gems you want that aren't in a link (`Gem name @ level`).
- **Route notes**: your own reminders on a zone's first visit, at a quest hand-in, or when the route reaches a level. They can carry a search string that F4 pastes.
- **Gear milestones**: lines shown in the Gear panel for a level range.
- **Post-campaign route** (`endgame` in the build JSON): lines in the route format, appended after Act 10. `#section Name` starts a header, `#chapter Name` starts a chapter (Shift+F1/F2 move between chapters), `#stage Title` makes the links/gear panels show that stage from there on (if your level is within 5 of it), `#sub` adds a hint line, and `{copy|"search"}` adds a search string that F4 pastes and the F3 menu lists. `{generic|..}`, `{kill|..}` and `{arena|..}` highlight words.
- **Gem plan tab**: per gem, override the level it's needed at, pin it to a quest (take or buy it there), or skip it (for example if you'll find it as a drop).

### How the gem plan is chosen

1. The level a gem is needed at is the first stage that uses it, or the gem's own level requirement if that's higher.
2. At each quest hand-in, the free reward goes to the gem you need soonest. If no needed gem is due yet, it takes the next one you'll need, which costs nothing.
3. A gem is bought when the route gets within 3 levels of when you need it. It's bought earlier if the next vendor that sells it would come too late. For example, Nessa stops selling Ruthless after Mercy Mission.
4. After *Fallen from Grace* (Act 6), Lilly Roth sells every gem in every town. Late gems are bought at the town where they become due, so you don't spend currency early.

The included build, `static-strike-slayer.json`, is Alohaa's Static Strike Slayer levelling PoB updated on 6 Nov 2026 (https://pobb.in/2FlZU8rRPp3F) plus his guide sheet, the 3.30 patch-note changes and the route to 4 voidstones. `node scripts/make-default-build.js` rebuilds it (from the saved copy in `test/fixtures`, or from a newer PoB link given as an argument).

## Development

- `npm test`: engine tests. They cover route parsing, the PoB import, the gem plan, and a replay of a real `Client.txt` run.
- `npm start`: run from a terminal. In a VS Code terminal, clear `ELECTRON_RUN_AS_NODE` first (`$env:ELECTRON_RUN_AS_NODE=''`).
- To capture the windows as PNGs: set `EXILEGUIDE_SNAPSHOT=<dir>` and optionally `EXILEGUIDE_STEP=<n>` and `EXILEGUIDE_LEVEL=<n>`.
- To update the passive tree after a patch: download `data.json` of the new tag from https://github.com/grindinggear/skilltree-export and run `node scripts/make-tree-data.js <data.json> <version>`.
- To update the route and gem data after a patch, download the newest `common/data/json/*.json` and `common/data/routes/*.txt` from exile-leveling into `data/exile-leveling/`.
