'use strict';

const COLS = 10;
const ROWS = 20;
const BLOCK = 30;

const COLORS = [
  null,
  '#4dd0e1', // I - cyan
  '#ffd54f', // O - yellow
  '#ba68c8', // T - purple
  '#81c784', // S - green
  '#e57373', // Z - red
  '#90caf9', // J - azul pálido
  '#ffb74d', // L - orange
  '#b0bec5', // TUERCA - gris acero
  '#ff7043', // BOMBA
  '#ffee58', // RAYO
  '#ab47bc', // TINTE
  '#66bb6a', // GRAVEDAD
  '#4fc3f7', // CONGELAR
  '#eceff1', // COMODÍN
];

const PIECES = [
  null,
  [[0,0,0,0],[1,1,1,1],[0,0,0,0],[0,0,0,0]], // I
  [[2,2],[2,2]],                               // O
  [[0,3,0],[3,3,3],[0,0,0]],                  // T
  [[0,4,4],[4,4,0],[0,0,0]],                  // S
  [[5,5,0],[0,5,5],[0,0,0]],                  // Z
  [[6,0,0],[6,6,6],[0,0,0]],                  // J
  [[0,0,7],[7,7,7],[0,0,0]],                  // L
  [[8,8,8],[8,0,8],[8,8,8]],                  // TUERCA (3x3 con hueco)
  [[9]],                                       // BOMBA
  [[10]],                                      // RAYO
  [[11]],                                      // TINTE
  [[12]],                                      // GRAVEDAD
  [[13]],                                      // CONGELAR
  null,                                        // COMODÍN: no es una pieza jugable
];

const LINE_SCORES = [0, 100, 300, 500, 800];

// ---- Power-ups ----
const POWER_BASE = 9;   // los tipos 9..13 son piezas power-up de 1x1
const WILD = 14;        // bloque comodín generado por TINTE
const POWER_LINES = 5;  // cada cuántas líneas aparece un power-up
const FREEZE_MS = 5000;
const POWER_SCORE = 10; // puntos por celda destruida

const POWERUPS = [
  { type: 9,  label: 'BOMBA',    icon: '💣' },
  { type: 10, label: 'RAYO',     icon: '⚡' },
  { type: 11, label: 'TINTE',    icon: '🎨' },
  { type: 12, label: 'GRAVEDAD', icon: '⬇' },
  { type: 13, label: 'CONGELAR', icon: '❄' },
];

const POWER_ICONS = {};
for (const p of POWERUPS) POWER_ICONS[p.type] = p.icon;
POWER_ICONS[WILD] = '★';

const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d');
const nextCanvas = document.getElementById('next-canvas');
const nextCtx = nextCanvas.getContext('2d');
const scoreEl = document.getElementById('score');
const linesEl = document.getElementById('lines');
const levelEl = document.getElementById('level');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const restartBtn = document.getElementById('restart-btn');
const themeToggle = document.getElementById('theme-toggle');
const powerEl = document.getElementById('power');

// ---- Records: elementos del DOM ----
const scoreListEl = document.getElementById('score-list');
const bestComboEl = document.getElementById('best-combo');
const bestLinesEl = document.getElementById('best-lines');
const resetScoresBtn = document.getElementById('reset-scores');
const saveScoreBox = document.getElementById('save-score');
const playerNameInput = document.getElementById('player-name');
const saveScoreBtn = document.getElementById('save-score-btn');

const THEME_KEY = 'tetris-theme';

// ---- Records: persistencia ----
const SCORES_KEY = 'tetris-scores';
const STATS_KEY = 'tetris-stats';
const MAX_SCORES = 5;

let board, current, next, score, lines, level, paused, gameOver, lastTime, dropAccum, dropInterval, animId;
let nextPowerAt, pendingPower, freezeMs, powerLabel;
let combo, maxCombo, highlightIndex, statsIncludeRun;

function createBoard() {
  return Array.from({ length: ROWS }, () => new Array(COLS).fill(0));
}

function randomPiece() {
  const type = Math.floor(Math.random() * 8) + 1;
  const shape = PIECES[type].map(row => [...row]);
  return { type, shape, x: Math.floor(COLS / 2) - Math.floor(shape[0].length / 2), y: 0 };
}

function randomPowerPiece() {
  const { type } = POWERUPS[Math.floor(Math.random() * POWERUPS.length)];
  return { type, shape: [[type]], x: Math.floor(COLS / 2), y: 0 };
}

function collide(shape, ox, oy) {
  for (let r = 0; r < shape.length; r++) {
    for (let c = 0; c < shape[r].length; c++) {
      if (!shape[r][c]) continue;
      const nx = ox + c;
      const ny = oy + r;
      if (nx < 0 || nx >= COLS || ny >= ROWS) return true;
      if (ny >= 0 && board[ny][nx]) return true;
    }
  }
  return false;
}

function rotateCW(shape) {
  const rows = shape.length, cols = shape[0].length;
  const result = Array.from({ length: cols }, () => new Array(rows).fill(0));
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      result[c][rows - 1 - r] = shape[r][c];
  return result;
}

function tryRotate() {
  const rotated = rotateCW(current.shape);
  const kicks = [0, -1, 1, -2, 2];
  for (const kick of kicks) {
    if (!collide(rotated, current.x + kick, current.y)) {
      current.shape = rotated;
      current.x += kick;
      return;
    }
  }
}

function merge() {
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      if (current.shape[r][c])
        board[current.y + r][current.x + c] = current.shape[r][c];
}

function collapseFullRows() {
  let cleared = 0;
  for (let r = ROWS - 1; r >= 0; r--) {
    if (board[r].every(v => v !== 0)) {
      board.splice(r, 1);
      board.unshift(new Array(COLS).fill(0));
      cleared++;
      r++;
    }
  }
  return cleared;
}

// Elimina todos los comodines del tablero. Devuelve true si borró alguno.
function removeWilds() {
  let found = false;
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++)
      if (board[r][c] === WILD) { board[r][c] = 0; found = true; }
  return found;
}

// Hace caer cada columna sobre sí misma, eliminando los huecos.
function compactBoard() {
  for (let c = 0; c < COLS; c++) {
    const stack = [];
    for (let r = ROWS - 1; r >= 0; r--) if (board[r][c]) stack.push(board[r][c]);
    for (let r = ROWS - 1, i = 0; r >= 0; r--, i++) board[r][c] = stack[i] || 0;
  }
}

function clearLines() {
  let cleared = collapseFullRows();
  if (cleared && removeWilds()) {
    compactBoard();
    cleared += collapseFullRows();
  }
  if (cleared) {
    lines += cleared;
    score += (LINE_SCORES[cleared] || 0) * level;
    level = Math.floor(lines / 10) + 1;
    dropInterval = Math.max(100, 1000 - (level - 1) * 90);
    while (lines >= nextPowerAt) {
      pendingPower = true;
      nextPowerAt += POWER_LINES;
    }
    updateHUD();
  }
  return cleared;
}

function ghostY() {
  let gy = current.y;
  while (!collide(current.shape, current.x, gy + 1)) gy++;
  return gy;
}

function hardDrop() {
  const gy = ghostY();
  score += (gy - current.y) * 2;
  current.y = gy;
  lockPiece();
}

function softDrop() {
  if (!collide(current.shape, current.x, current.y + 1)) {
    current.y++;
    score += 1;
    updateHUD();
  } else {
    lockPiece();
  }
}

function lockPiece() {
  if (current.type >= POWER_BASE) applyPower(current.type, current.x, current.y);
  else merge();
  const cleared = clearLines();
  // combo clásico: piezas consecutivas que limpian al menos una línea
  if (cleared) {
    combo++;
    maxCombo = Math.max(maxCombo, combo);
  } else {
    combo = 0;
  }
  spawn();
}

// Vacía una celda si está dentro del tablero y tenía bloque. Devuelve 1 si la destruyó.
function clearCell(x, y) {
  if (x < 0 || x >= COLS || y < 0 || y >= ROWS || !board[y][x]) return 0;
  board[y][x] = 0;
  return 1;
}

// Tiñe de comodín todos los bloques del color más abundante del tablero.
function dyeMostCommon() {
  const counts = new Array(COLORS.length).fill(0);
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++)
      if (board[r][c] && board[r][c] !== WILD) counts[board[r][c]]++;

  let best = 0;
  for (let t = 1; t < counts.length; t++) if (counts[t] > counts[best]) best = t;
  if (!best) return;

  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++)
      if (board[r][c] === best) board[r][c] = WILD;
}

function applyPower(type, x, y) {
  const power = POWERUPS[type - POWER_BASE];
  let destroyed = 0;

  switch (type) {
    case 9: // BOMBA: área 3x3
      for (let r = y - 1; r <= y + 1; r++)
        for (let c = x - 1; c <= x + 1; c++)
          destroyed += clearCell(c, r);
      break;
    case 10: // RAYO: fila y columna completas
      for (let c = 0; c < COLS; c++) destroyed += clearCell(c, y);
      for (let r = 0; r < ROWS; r++) destroyed += clearCell(x, r);
      break;
    case 11: // TINTE: comodines
      dyeMostCommon();
      break;
    case 12: // GRAVEDAD: compacta los huecos
      compactBoard();
      break;
    case 13: // CONGELAR: 5s sin caída
      freezeMs = FREEZE_MS;
      break;
  }

  score += destroyed * POWER_SCORE;
  powerLabel = power.icon + ' ' + power.label;
  updateHUD();
}

function spawn() {
  current = next;
  next = pendingPower ? randomPowerPiece() : randomPiece();
  pendingPower = false;
  if (collide(current.shape, current.x, current.y)) {
    endGame();
  }
  drawNext();
}

function powerText() {
  if (freezeMs > 0) return `❄ ${(freezeMs / 1000).toFixed(1)}s`;
  const queued = [current, next].find(p => p && p.type >= POWER_BASE);
  if (queued) {
    const power = POWERUPS[queued.type - POWER_BASE];
    return `${power.icon} ${power.label}`;
  }
  return powerLabel || '—';
}

function updateHUD() {
  scoreEl.textContent = score.toLocaleString();
  linesEl.textContent = lines;
  levelEl.textContent = level;
  powerEl.textContent = powerText();
}

function drawBlock(context, x, y, colorIndex, size, alpha) {
  if (!colorIndex) return;
  const color = COLORS[colorIndex];
  context.globalAlpha = alpha ?? 1;
  context.fillStyle = color;
  context.fillRect(x * size + 1, y * size + 1, size - 2, size - 2);
  // highlight
  context.fillStyle = 'rgba(255,255,255,0.12)';
  context.fillRect(x * size + 1, y * size + 1, size - 2, 4);
  // icono de power-up / comodín
  const icon = POWER_ICONS[colorIndex];
  if (icon) {
    context.fillStyle = '#1a1a25';
    context.font = `${Math.round(size * 0.6)}px system-ui, sans-serif`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(icon, x * size + size / 2, y * size + size / 2 + 1);
  }
  context.globalAlpha = 1;
}

function drawGrid() {
  ctx.strokeStyle = getComputedStyle(document.body).getPropertyValue('--grid-line').trim();
  ctx.lineWidth = 0.5;
  for (let c = 1; c < COLS; c++) {
    ctx.beginPath();
    ctx.moveTo(c * BLOCK, 0);
    ctx.lineTo(c * BLOCK, ROWS * BLOCK);
    ctx.stroke();
  }
  for (let r = 1; r < ROWS; r++) {
    ctx.beginPath();
    ctx.moveTo(0, r * BLOCK);
    ctx.lineTo(COLS * BLOCK, r * BLOCK);
    ctx.stroke();
  }
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawGrid();

  // board
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++)
      drawBlock(ctx, c, r, board[r][c], BLOCK);

  // tras el game over la pieza actual colisiona en el spawn: no dibujarla
  if (gameOver) return;

  // ghost
  const gy = ghostY();
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      if (current.shape[r][c])
        drawBlock(ctx, current.x + c, gy + r, current.shape[r][c], BLOCK, 0.2);

  // current piece
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      drawBlock(ctx, current.x + c, current.y + r, current.shape[r][c], BLOCK);
}

function drawNext() {
  const NB = 30;
  nextCtx.clearRect(0, 0, nextCanvas.width, nextCanvas.height);
  const shape = next.shape;
  const offX = Math.floor((4 - shape[0].length) / 2);
  const offY = Math.floor((4 - shape.length) / 2);
  for (let r = 0; r < shape.length; r++)
    for (let c = 0; c < shape[r].length; c++)
      drawBlock(nextCtx, offX + c, offY + r, shape[r][c], NB);
}

// ---- Records: tabla local ----
function loadScores() {
  try {
    const raw = JSON.parse(localStorage.getItem(SCORES_KEY));
    if (!Array.isArray(raw)) return [];
    return raw
      .filter(e => e && typeof e === 'object')
      .map(e => ({
        name: String(e.name || 'ANÓNIMO'),
        score: Number(e.score) || 0,
        lines: Number(e.lines) || 0,
        level: Number(e.level) || 1,
        date: String(e.date || ''),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_SCORES);
  } catch (err) {
    return [];
  }
}

function loadStats() {
  try {
    const raw = JSON.parse(localStorage.getItem(STATS_KEY));
    if (!raw || typeof raw !== 'object') return { bestCombo: 0, bestLines: 0 };
    return { bestCombo: Number(raw.bestCombo) || 0, bestLines: Number(raw.bestLines) || 0 };
  } catch (err) {
    return { bestCombo: 0, bestLines: 0 };
  }
}

function qualifies(value) {
  const list = loadScores();
  if (value <= 0) return false;
  if (list.length < MAX_SCORES) return true;
  return value > list[list.length - 1].score;
}

// Inserta la partida actual y devuelve su posición en el top (o -1).
function saveScore(name) {
  const entry = {
    name: (name || '').trim().slice(0, 12).toUpperCase() || 'ANÓNIMO',
    score,
    lines,
    level,
    date: new Date().toISOString().slice(0, 10),
  };
  const list = loadScores();
  list.push(entry);
  list.sort((a, b) => b.score - a.score);
  const top = list.slice(0, MAX_SCORES);
  const index = top.indexOf(entry);
  try {
    localStorage.setItem(SCORES_KEY, JSON.stringify(top));
  } catch (err) { /* storage no disponible */ }
  return index;
}

function updateStats() {
  const stats = loadStats();
  const next = {
    bestCombo: Math.max(stats.bestCombo, maxCombo),
    bestLines: Math.max(stats.bestLines, lines),
  };
  try {
    localStorage.setItem(STATS_KEY, JSON.stringify(next));
  } catch (err) { /* storage no disponible */ }
  return next;
}

function resetRecords() {
  try {
    localStorage.removeItem(SCORES_KEY);
    localStorage.removeItem(STATS_KEY);
  } catch (err) { /* storage no disponible */ }
  highlightIndex = -1;
  // tras borrar, la partida en curso vuelve a contar; la ya terminada no
  statsIncludeRun = !gameOver;
  saveScoreBox.classList.add('hidden');
  renderScores();
}

function renderScores() {
  const list = loadScores();
  scoreListEl.innerHTML = '';
  if (!list.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = 'Sin records todavía';
    scoreListEl.appendChild(li);
  } else {
    list.forEach((entry, i) => {
      const li = document.createElement('li');
      if (i === highlightIndex) li.classList.add('highlight');
      const name = document.createElement('span');
      name.className = 'score-name';
      name.textContent = entry.name;
      const value = document.createElement('span');
      value.className = 'score-value';
      value.textContent = entry.score.toLocaleString();
      li.appendChild(name);
      li.appendChild(value);
      scoreListEl.appendChild(li);
    });
  }
  const stats = loadStats();
  const runCombo = statsIncludeRun ? (maxCombo || 0) : 0;
  const runLines = statsIncludeRun ? (lines || 0) : 0;
  bestComboEl.textContent = Math.max(stats.bestCombo, runCombo);
  bestLinesEl.textContent = Math.max(stats.bestLines, runLines);
}

function endGame() {
  if (gameOver) return;
  gameOver = true;
  if (animId !== null) cancelAnimationFrame(animId);
  animId = null;
  overlayTitle.textContent = 'GAME OVER';
  overlayScore.textContent = `Puntuación: ${score.toLocaleString()}`;
  updateStats();
  highlightIndex = -1;
  if (qualifies(score)) {
    saveScoreBox.classList.remove('hidden');
    playerNameInput.value = '';
  } else {
    saveScoreBox.classList.add('hidden');
  }
  renderScores();
  overlay.classList.remove('hidden');
}

function confirmSaveScore() {
  if (saveScoreBox.classList.contains('hidden')) return;
  highlightIndex = saveScore(playerNameInput.value);
  saveScoreBox.classList.add('hidden');
  renderScores();
}

function togglePause() {
  if (gameOver) return;
  paused = !paused;
  if (!paused) {
    overlay.classList.add('hidden');
    lastTime = performance.now();
    loop(lastTime);
  } else {
    if (animId !== null) cancelAnimationFrame(animId);
    animId = null;
    overlayTitle.textContent = 'PAUSA';
    overlayScore.textContent = '';
    saveScoreBox.classList.add('hidden');
    renderScores();
    overlay.classList.remove('hidden');
  }
}

function loop(ts) {
  const dt = ts - lastTime;
  lastTime = ts;
  if (freezeMs > 0) {
    freezeMs = Math.max(0, freezeMs - dt);
    dropAccum = 0;
    updateHUD();
  } else {
    dropAccum += dt;
    if (dropAccum >= dropInterval) {
      dropAccum = 0;
      if (!collide(current.shape, current.x, current.y + 1)) {
        current.y++;
      } else {
        lockPiece();
      }
    }
  }
  draw();
  if (gameOver || paused) { animId = null; return; }
  animId = requestAnimationFrame(loop);
}

function setTheme(isLight) {
  document.body.classList.toggle('light-theme', isLight);
  themeToggle.checked = isLight;
  localStorage.setItem(THEME_KEY, isLight ? 'light' : 'dark');
  draw();
  drawNext();
}

function init() {
  if (animId !== null && animId !== undefined) cancelAnimationFrame(animId);
  animId = null;
  board = createBoard();
  score = 0;
  lines = 0;
  level = 1;
  paused = false;
  gameOver = false;
  dropInterval = 1000;
  dropAccum = 0;
  nextPowerAt = POWER_LINES;
  pendingPower = false;
  freezeMs = 0;
  powerLabel = '';
  combo = 0;
  maxCombo = 0;
  highlightIndex = -1;
  statsIncludeRun = true;
  saveScoreBox.classList.add('hidden');
  renderScores();
  lastTime = performance.now();
  next = randomPiece();
  spawn();
  updateHUD();
  overlay.classList.add('hidden');
  animId = requestAnimationFrame(loop);
}

document.addEventListener('keydown', e => {
  // escribir el nombre del record no debe disparar acciones del juego
  if (e.target instanceof HTMLInputElement && e.target.type === 'text') return;
  if (e.code === 'KeyP') { togglePause(); return; }
  if (paused || gameOver) return;
  switch (e.code) {
    case 'ArrowLeft':
      if (!collide(current.shape, current.x - 1, current.y)) current.x--;
      break;
    case 'ArrowRight':
      if (!collide(current.shape, current.x + 1, current.y)) current.x++;
      break;
    case 'ArrowDown':
      softDrop();
      break;
    case 'ArrowUp':
    case 'KeyX':
      tryRotate();
      break;
    case 'Space':
      e.preventDefault();
      hardDrop();
      break;
  }
  updateHUD();
});

restartBtn.addEventListener('click', init);

// ---- Records: eventos ----
saveScoreBtn.addEventListener('click', confirmSaveScore);
playerNameInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); confirmSaveScore(); }
});
resetScoresBtn.addEventListener('click', () => {
  if (confirm('¿Borrar todos los records?')) resetRecords();
});
themeToggle.addEventListener('change', () => setTheme(themeToggle.checked));

document.body.classList.toggle('light-theme', localStorage.getItem(THEME_KEY) === 'light');
themeToggle.checked = document.body.classList.contains('light-theme');

init();
