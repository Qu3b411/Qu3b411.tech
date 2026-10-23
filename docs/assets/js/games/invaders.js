// invaders.js — Space Invaders. Left/Right = move, space = fire, q = quit.
// Clear all invaders to win; don't let them reach you or get hit by a bomb.

export function run(term, { onExit } = {}) {
  const CSI = '\x1b[';
  const W = Math.max(28, Math.min((term.cols || 80) - 2, 64));
  const H = Math.max(16, Math.min((term.rows || 24) - 2, 28));
  const TICK = 60;

  const ROWS = 5;
  const COLS = Math.max(6, Math.min(11, Math.floor((W - 4) / 3)));
  let inv, ox, oy, dirx, px, bullets, bombs, score, over, won, timer, t, moveEvery;

  function reset() {
    inv = Array.from({ length: ROWS }, () => new Array(COLS).fill(true));
    ox = 2; oy = 1; dirx = 1;
    px = Math.floor(W / 2);
    bullets = []; bombs = [];
    score = 0; over = false; won = false; t = 0; moveEvery = 12;
  }

  function invX(c) { return ox + c * 3; }
  function invY(r) { return oy + r; }
  function aliveCount() { return inv.flat().filter(Boolean).length; }

  function moveInvaders() {
    let minX = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) if (inv[r][c]) {
      minX = Math.min(minX, invX(c)); maxX = Math.max(maxX, invX(c)); maxY = Math.max(maxY, invY(r));
    }
    if (maxX + dirx >= W - 1 || minX + dirx <= 1) { dirx = -dirx; oy++; }
    else ox += dirx;
    if (maxY + 1 >= H - 2) { over = true; } // reached the player line
    // random bomb from a random alive invader
    if (Math.random() < 0.3) {
      const alive = [];
      for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) if (inv[r][c]) alive.push([r, c]);
      if (alive.length) { const [r, c] = alive[Math.floor(Math.random() * alive.length)]; bombs.push({ x: invX(c), y: invY(r) + 1 }); }
    }
  }

  function tick() {
    t++;
    // bullets up
    bullets.forEach((b) => (b.y -= 1));
    bullets = bullets.filter((b) => b.y > 0);
    // bomb down (every other tick)
    if (t % 2 === 0) { bombs.forEach((b) => (b.y += 1)); bombs = bombs.filter((b) => b.y < H - 1); }
    // invader march (speeds up as fewer remain)
    const n = aliveCount();
    moveEvery = Math.max(3, Math.floor(2 + n / 3));
    if (t % moveEvery === 0) moveInvaders();
    // collisions: bullets vs invaders
    bullets.forEach((b) => {
      for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
        if (inv[r][c] && b.x === invX(c) && b.y === invY(r)) { inv[r][c] = false; b.y = -1; score += 10; }
      }
    });
    bullets = bullets.filter((b) => b.y > 0);
    // bombs vs player
    if (bombs.some((b) => b.y >= H - 2 && Math.abs(b.x - px) <= 0)) over = true;
    if (aliveCount() === 0) { won = true; over = true; }
    draw();
    if (over) end();
  }

  function draw() {
    const g = Array.from({ length: H }, () => new Array(W).fill(' '));
    for (let x = 0; x < W; x++) { g[0][x] = '#'; g[H - 1][x] = '#'; }
    for (let y = 0; y < H; y++) { g[y][0] = '#'; g[y][W - 1] = '#'; }
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) if (inv[r][c]) { const x = invX(c), y = invY(r); if (y > 0 && y < H - 1 && x > 0 && x < W - 1) g[y][x] = 'W'; }
    bombs.forEach((b) => { if (b.y > 0 && b.y < H - 1) g[b.y][b.x] = '!'; });
    bullets.forEach((b) => { if (b.y > 0 && b.y < H - 1) g[b.y][b.x] = '|'; });
    g[H - 2][px] = '^';
    let out = CSI + '2J' + CSI + 'H\x1b[1;32m';
    out += ` SPACE INVADERS   score ${score}   left/right=move space=fire q=quit\r\n`;
    out += g.map((row) => row.join('')).join('\r\n');
    term.write(out + '\x1b[0m');
  }

  function end() {
    clearInterval(timer);
    term.write('\x1b[0m\r\n  ' + (won ? 'YOU WIN!' : 'GAME OVER') + ' — score ' + score + '. Press any key.\r\n');
    over = 'done';
  }

  function input(data) {
    if (over === 'done') return stop();
    switch (data) {
      case '\x1b[D': if (px > 1) px--; break;
      case '\x1b[C': if (px < W - 2) px++; break;
      case ' ': if (bullets.length < 3) bullets.push({ x: px, y: H - 3 }); break;
      case 'q': case '\x1b': case '\x03': stop(); break;
    }
  }

  function stop() {
    clearInterval(timer);
    term.write('\x1b[0m' + CSI + '2J' + CSI + 'H');
    if (onExit) onExit();
  }

  reset();
  draw();
  timer = setInterval(tick, TICK);
  return { input, stop };
}
