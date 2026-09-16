# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Vanilla JavaScript Tetris on HTML5 Canvas. No dependencies, no `package.json`, no build step, no linter, no test suite. User-facing text and the README are in Spanish; keep new UI strings in Spanish.

## Running

Open `index.html` directly (`start index.html` on Windows), or serve the folder statically and visit `http://localhost:8000`:

```bash
python -m http.server 8000
```

Verification is manual: play the game in a browser.

## Architecture

Three files: `index.html` (DOM and canvases), `style.css` (dark theme), `game.js` (all logic). `game.js` is a single classic script in strict mode, loaded at the end of `<body>`. It grabs DOM elements by id at load time and calls `init()` right away, so element ids in `index.html` and `game.js` must stay in sync.

Things you only see by reading across the code:

- **State is module-level `let` globals** (`board`, `current`, `next`, `score`, `lines`, `level`, `paused`, `gameOver`, `lastTime`, `dropAccum`, `dropInterval`, `animId`). `init()` resets all of them and also restarts the game from the overlay's restart button.
- **Cell values are piece types.** `PIECES[type]` matrices store the type index in their filled cells, and that same number indexes `COLORS`. `merge()` copies those values into `board`, so the board holds color indices, not booleans. Index 0 / `null` means empty. A new piece needs matching entries in both arrays, and `randomPiece()` hardcodes `* 8` (normal pieces are 1–8).
- **Power-ups are types 9–13** (1×1 pieces, `POWERUPS`), plus `WILD = 14` for the comodín blocks that Tinte creates. They only enter the bag through `randomPowerPiece()`, which `spawn()` picks when `pendingPower` is set (every `POWER_LINES` lines, flagged in `clearLines()`). `lockPiece()` routes them to `applyPower()` instead of `merge()`, so they never land on the board. `POWER_ICONS` drives the glyph `drawBlock()` stamps on those cells. Wilds are wiped by `removeWilds()` + `compactBoard()` on the next line clear, with `collapseFullRows()` re-run once for the cascade.
- **Collision is the one rule everything uses.** `collide(shape, ox, oy)` handles movement, rotation (`tryRotate`, which tries column kicks `[0,-1,1,-2,2]`), gravity, soft and hard drop, ghost projection (`ghostY`), and spawn/game-over detection. Rows above the board (`ny < 0`) count as free.
- **Locking a piece:** `lockPiece()` → `merge()` → `clearLines()` (updates score, lines, level and `dropInterval`) → `spawn()` (`next` becomes `current`; if it collides at spawn, `endGame()`; then redraws the next-piece preview).
- **Loop and pause:** `loop(ts)` runs on `requestAnimationFrame`, adds up `dt` in `dropAccum`, and moves the piece down one row whenever `dropAccum >= dropInterval`. Pause and game over stop it with `cancelAnimationFrame(animId)`. Unpausing restarts it by calling `loop()` directly. The keydown handler runs `updateHUD()` after every key. `draw()` only runs inside the loop, while `drawNext()` only runs from `spawn()`.
- **Canvas sizes are duplicated.** The `<canvas>` width/height in `index.html` must equal `COLS × BLOCK` by `ROWS × BLOCK`. The next-piece preview assumes a 4×4 grid of 30px cells (`NB = 30`) on a 120×120 canvas.

## Known quirks (as the code stands)

- `togglePause()` shows the overlay when pausing but never adds `hidden` back when resuming.
- If `endGame()` fires from gravity inside `loop()`, the `cancelAnimationFrame` targets a frame that has already run, and `loop()` then schedules the next one. The loop keeps running after game over. When it fires from a key press (hard or soft drop), the loop does stop.
