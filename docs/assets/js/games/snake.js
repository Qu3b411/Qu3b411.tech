// snake.js — terminal Snake. Arrows to steer, q / Esc / Ctrl+C to quit.
// The play field scales to fill the terminal. Exposes { input, stop }.

export function run(term, { onExit } = {}) {
  const CSI = '\x1b[';
  const W = Math.max(24, Math.min((term.cols || 80) - 2, 90));
  const H = Math.max(12, Math.min((term.rows || 24) - 3, 38));
  const SPEED_MS = 90;

  let snake, dir, nextDir, food, score, dead, timer;

  function spawnFood() {
    let f;
    do {
      f = { x: 1 + Math.floor(Math.random() * (W - 2)), y: 1 + Math.floor(Math.random() * (H - 2)) };
    } while (snake.some((s) => s.x === f.x && s.y === f.y));
    return f;
  }

  function reset() {
    const cy = Math.floor(H / 2);
    snake = [{ x: 6, y: cy }, { x: 5, y: cy }, { x: 4, y: cy }];
    dir = { x: 1, y: 0 };
    nextDir = dir;
    score = 0;
    dead = false;
    food = spawnFood();
  }

  function draw() {
    let out = CSI + '2J' + CSI + 'H\x1b[1;32m';
    out += ` SNAKE    score ${score}    arrows = move, q = quit\r\n`;
    for (let y = 0; y < H; y++) {
      let row = '';
      for (let x = 0; x < W; x++) {
        if (y === 0 || y === H - 1 || x === 0 || x === W - 1) row += '#';
        else if (snake[0].x === x && snake[0].y === y) row += '@';
        else if (snake.some((s) => s.x === x && s.y === y)) row += 'o';
        else if (food.x === x && food.y === y) row += '*';
        else row += ' ';
      }
      out += row + '\r\n';
    }
    term.write(out + '\x1b[0m');
  }

  function tick() {
    dir = nextDir;
    const head = { x: snake[0].x + dir.x, y: snake[0].y + dir.y };
    const hit = head.x <= 0 || head.x >= W - 1 || head.y <= 0 || head.y >= H - 1 || snake.some((s) => s.x === head.x && s.y === head.y);
    if (hit) return gameOver();
    snake.unshift(head);
    if (head.x === food.x && head.y === food.y) { score += 10; food = spawnFood(); } else snake.pop();
    draw();
  }

  function gameOver() {
    dead = true;
    clearInterval(timer);
    term.write('\x1b[0m\r\n  GAME OVER — score ' + score + '. Press any key.\r\n');
  }

  function input(data) {
    if (dead) return stop();
    switch (data) {
      case '\x1b[A': if (dir.y === 0) nextDir = { x: 0, y: -1 }; break;
      case '\x1b[B': if (dir.y === 0) nextDir = { x: 0, y: 1 }; break;
      case '\x1b[C': if (dir.x === 0) nextDir = { x: 1, y: 0 }; break;
      case '\x1b[D': if (dir.x === 0) nextDir = { x: -1, y: 0 }; break;
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
  timer = setInterval(tick, SPEED_MS);
  return { input, stop };
}
