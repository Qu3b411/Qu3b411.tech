// snake.js — terminal Snake for the hidden /games directory.
//
// This is the actual implementation: it is both served as a module (so
// `./snake.js` can run it) and shown verbatim by `cat`/`vim`/`nano snake.js`.
// It renders into the xterm.js instance with VT escape sequences and exposes a
// small controller { input, stop } so the shell can route keypresses to it.
//
// Controls: arrow keys to steer, `q` / Esc / Ctrl+C to quit.

export function runSnake(term, { onExit } = {}) {
  const W = 30; // play field width in cells (including walls)
  const H = 18; // play field height in cells (including walls)
  const CSI = '\x1b[';
  const SPEED_MS = 110;

  let snake = [{ x: 6, y: 9 }, { x: 5, y: 9 }, { x: 4, y: 9 }];
  let dir = { x: 1, y: 0 };
  let nextDir = dir;
  let food = spawnFood();
  let score = 0;
  let dead = false;
  let timer = null;

  function spawnFood() {
    let f;
    do {
      f = { x: 1 + Math.floor(Math.random() * (W - 2)), y: 1 + Math.floor(Math.random() * (H - 2)) };
    } while (snake.some((s) => s.x === f.x && s.y === f.y));
    return f;
  }

  function draw() {
    let out = CSI + '2J' + CSI + 'H'; // clear screen + cursor home
    out += '\x1b[1;32m'; // bold green
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
    out += '\x1b[0m';
    term.write(out);
  }

  function tick() {
    dir = nextDir;
    const head = { x: snake[0].x + dir.x, y: snake[0].y + dir.y };
    const hitWall = head.x <= 0 || head.x >= W - 1 || head.y <= 0 || head.y >= H - 1;
    const hitSelf = snake.some((s) => s.x === head.x && s.y === head.y);
    if (hitWall || hitSelf) return gameOver();
    snake.unshift(head);
    if (head.x === food.x && head.y === food.y) {
      score += 10;
      food = spawnFood();
    } else {
      snake.pop();
    }
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
      case '\x1b[A': if (dir.y === 0) nextDir = { x: 0, y: -1 }; break; // up
      case '\x1b[B': if (dir.y === 0) nextDir = { x: 0, y: 1 }; break;  // down
      case '\x1b[C': if (dir.x === 0) nextDir = { x: 1, y: 0 }; break;  // right
      case '\x1b[D': if (dir.x === 0) nextDir = { x: -1, y: 0 }; break; // left
      case 'q':
      case '\x1b':
      case '\x03': stop(); break; // quit
    }
  }

  function stop() {
    clearInterval(timer);
    term.write('\x1b[0m' + CSI + '2J' + CSI + 'H');
    if (onExit) onExit();
  }

  draw();
  timer = setInterval(tick, SPEED_MS);
  return { input, stop };
}
