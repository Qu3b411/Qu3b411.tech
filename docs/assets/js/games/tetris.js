// tetris.js — left/right = move, up = rotate, down = soft drop,
// space = hard drop, q = quit.

export function run(term, { onExit } = {}) {
  const CSI = '\x1b[';
  const W = 10;
  const H = Math.max(14, Math.min((term.rows || 24) - 3, 20));
  const DROP_MS = 500;

  const PIECES = {
    I: { n: 4, cells: [[0, 1], [1, 1], [2, 1], [3, 1]] },
    O: { n: 2, cells: [[0, 0], [1, 0], [0, 1], [1, 1]] },
    T: { n: 3, cells: [[1, 0], [0, 1], [1, 1], [2, 1]] },
    S: { n: 3, cells: [[1, 0], [2, 0], [0, 1], [1, 1]] },
    Z: { n: 3, cells: [[0, 0], [1, 0], [1, 1], [2, 1]] },
    J: { n: 3, cells: [[0, 0], [0, 1], [1, 1], [2, 1]] },
    L: { n: 3, cells: [[2, 0], [0, 1], [1, 1], [2, 1]] },
  };
  const TYPES = Object.keys(PIECES);

  let board, cur, score, lines, over, timer;

  function spawn() {
    const type = TYPES[Math.floor(Math.random() * TYPES.length)];
    const p = PIECES[type];
    cur = { type, n: p.n, cells: p.cells.map((c) => c.slice()), x: Math.floor((W - p.n) / 2), y: 0 };
    if (collides(cur.cells, cur.x, cur.y)) { over = true; }
  }

  function collides(cells, ox, oy) {
    return cells.some(([cx, cy]) => {
      const x = ox + cx, y = oy + cy;
      return x < 0 || x >= W || y >= H || (y >= 0 && board[y][x]);
    });
  }

  function lock() {
    cur.cells.forEach(([cx, cy]) => { const x = cur.x + cx, y = cur.y + cy; if (y >= 0) board[y][x] = cur.type; });
    // clear full lines
    let cleared = 0;
    for (let y = H - 1; y >= 0; y--) {
      if (board[y].every((c) => c)) { board.splice(y, 1); board.unshift(new Array(W).fill(0)); cleared++; y++; }
    }
    if (cleared) { lines += cleared; score += [0, 100, 300, 500, 800][cleared]; }
    spawn();
  }

  function move(dx, dy) {
    if (!collides(cur.cells, cur.x + dx, cur.y + dy)) { cur.x += dx; cur.y += dy; return true; }
    return false;
  }

  function rotate() {
    const r = cur.cells.map(([x, y]) => [cur.n - 1 - y, x]);
    if (!collides(r, cur.x, cur.y)) cur.cells = r;
  }

  function tick() {
    if (!move(0, 1)) lock();
    draw();
    if (over) end();
  }

  function draw() {
    const g = Array.from({ length: H }, (_, y) => board[y].slice());
    cur.cells.forEach(([cx, cy]) => { const x = cur.x + cx, y = cur.y + cy; if (y >= 0 && y < H) g[y][x] = cur.type; });
    let out = CSI + '2J' + CSI + 'H\x1b[1;32m';
    out += ` TETRIS   score ${score}   lines ${lines}   arrows+space q=quit\r\n`;
    out += '  +' + '--'.repeat(W) + '+\r\n';
    for (let y = 0; y < H; y++) {
      out += '  |' + g[y].map((c) => (c ? '[]' : '  ')).join('') + '|\r\n';
    }
    out += '  +' + '--'.repeat(W) + '+\r\n';
    term.write(out + '\x1b[0m');
  }

  function end() {
    clearInterval(timer);
    term.write('\x1b[0m\r\n  GAME OVER — score ' + score + ', lines ' + lines + '. Press any key.\r\n');
    over = 'done';
  }

  function input(data) {
    if (over === 'done') return stop();
    switch (data) {
      case '\x1b[D': move(-1, 0); draw(); break;
      case '\x1b[C': move(1, 0); draw(); break;
      case '\x1b[A': rotate(); draw(); break;
      case '\x1b[B': move(0, 1); draw(); break;
      case ' ': while (move(0, 1)) {} lock(); draw(); if (over) end(); break;
      case 'q': case '\x1b': case '\x03': stop(); break;
    }
  }

  function stop() {
    clearInterval(timer);
    term.write('\x1b[0m' + CSI + '2J' + CSI + 'H');
    if (onExit) onExit();
  }

  board = Array.from({ length: H }, () => new Array(W).fill(0));
  score = 0; lines = 0; over = false;
  spawn();
  draw();
  timer = setInterval(tick, DROP_MS);
  return { input, stop };
}
