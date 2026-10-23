// asteroids.js — left/right = rotate, up = thrust, space = fire, q = quit.
// Shoot the rocks; big ones split. Don't fly into one. Clear them all to win.

export function run(term, { onExit } = {}) {
  const CSI = '\x1b[';
  const W = Math.max(28, Math.min((term.cols || 80) - 2, 80));
  const H = Math.max(14, Math.min((term.rows || 24) - 2, 34));
  const TICK = 70;
  const DIRS = [[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]];
  const SHIP = ['^', '/', '>', '\\', 'v', '/', '<', '\\'];

  let ship, heading, rocks, bullets, score, over, won, timer;

  function wrap(p) { p.x = (p.x + W) % W; p.y = (p.y + H) % H; return p; }

  function spawnRocks(n) {
    rocks = [];
    for (let i = 0; i < n; i++) {
      let x, y;
      do { x = Math.random() * W; y = Math.random() * H; } while (Math.hypot(x - ship.x, y - ship.y) < 8);
      const a = Math.random() * Math.PI * 2;
      rocks.push({ x, y, vx: Math.cos(a) * 0.35, vy: Math.sin(a) * 0.25, size: 2 });
    }
  }

  function reset() {
    ship = { x: W / 2, y: H / 2, vx: 0, vy: 0 };
    heading = 0;
    bullets = [];
    score = 0; over = false; won = false;
    spawnRocks(4);
  }

  function tick() {
    ship.vx *= 0.94; ship.vy *= 0.94;
    ship.x += ship.vx; ship.y += ship.vy; wrap(ship);
    rocks.forEach((r) => { r.x += r.vx; r.y += r.vy; wrap(r); });
    bullets.forEach((b) => { b.x += b.vx; b.y += b.vy; b.life--; });
    bullets = bullets.filter((b) => b.life > 0 && b.x >= 0 && b.x < W && b.y >= 0 && b.y < H);

    for (let i = rocks.length - 1; i >= 0; i--) {
      const r = rocks[i];
      for (let j = bullets.length - 1; j >= 0; j--) {
        const b = bullets[j];
        if (Math.abs(b.x - r.x) < 1.4 && Math.abs(b.y - r.y) < 1.1) {
          bullets.splice(j, 1);
          rocks.splice(i, 1);
          score += r.size === 2 ? 20 : 10;
          if (r.size === 2) {
            for (let k = 0; k < 2; k++) {
              const a = Math.random() * Math.PI * 2;
              rocks.push({ x: r.x, y: r.y, vx: Math.cos(a) * 0.6, vy: Math.sin(a) * 0.45, size: 1 });
            }
          }
          break;
        }
      }
    }
    if (rocks.some((r) => Math.abs(r.x - ship.x) < 1.3 && Math.abs(r.y - ship.y) < 1.0)) { over = true; }
    if (rocks.length === 0) { won = true; over = true; }
    draw();
    if (over) end();
  }

  function draw() {
    const g = Array.from({ length: H }, () => new Array(W).fill(' '));
    rocks.forEach((r) => { const x = Math.round(r.x) % W, y = Math.round(r.y) % H; if (g[y]) g[y][x] = r.size === 2 ? 'O' : 'o'; });
    bullets.forEach((b) => { const x = Math.round(b.x), y = Math.round(b.y); if (g[y] && g[y][x] === ' ') g[y][x] = '.'; });
    const sx = Math.round(ship.x) % W, sy = Math.round(ship.y) % H;
    if (g[sy]) g[sy][sx] = SHIP[heading];
    let out = CSI + '2J' + CSI + 'H\x1b[1;32m';
    out += ` ASTEROIDS   score ${score}   left/right=turn up=thrust space=fire q=quit\r\n`;
    out += g.map((row) => row.join('')).join('\r\n');
    term.write(out + '\x1b[0m');
  }

  function end() {
    clearInterval(timer);
    term.write('\x1b[0m\r\n  ' + (won ? 'ALL CLEAR!' : 'GAME OVER') + ' — score ' + score + '. Press any key.\r\n');
    over = 'done';
  }

  function input(data) {
    if (over === 'done') return stop();
    switch (data) {
      case '\x1b[D': heading = (heading + 7) % 8; draw(); break;
      case '\x1b[C': heading = (heading + 1) % 8; draw(); break;
      case '\x1b[A': { const d = DIRS[heading]; ship.vx = Math.max(-1.3, Math.min(1.3, ship.vx + d[0] * 0.5)); ship.vy = Math.max(-1.1, Math.min(1.1, ship.vy + d[1] * 0.5)); break; }
      case ' ': { const d = DIRS[heading]; if (bullets.length < 4) bullets.push({ x: ship.x + d[0], y: ship.y + d[1], vx: d[0] * 1.1, vy: d[1] * 1.0, life: Math.max(W, H) }); break; }
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
