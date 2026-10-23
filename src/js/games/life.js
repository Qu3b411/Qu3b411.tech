// life.js — Conway's Game of Life. space = pause/resume, r = randomize,
// n = step once, q = quit. The grid fills the terminal.

export function run(term, { onExit } = {}) {
  const CSI = '\x1b[';
  const W = Math.max(20, Math.min((term.cols || 80), 100));
  const H = Math.max(10, Math.min((term.rows || 24) - 2, 40));
  const SPEED_MS = 120;

  let grid, gen, paused, timer;

  function randomize() {
    grid = Array.from({ length: H }, () => Array.from({ length: W }, () => (Math.random() < 0.28 ? 1 : 0)));
    gen = 0;
  }

  function step() {
    const next = Array.from({ length: H }, () => new Array(W).fill(0));
    let pop = 0;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        let n = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const yy = (y + dy + H) % H; // toroidal wrap
            const xx = (x + dx + W) % W;
            n += grid[yy][xx];
          }
        }
        next[y][x] = grid[y][x] ? (n === 2 || n === 3 ? 1 : 0) : (n === 3 ? 1 : 0);
        pop += next[y][x];
      }
    }
    grid = next;
    gen++;
    return pop;
  }

  function draw(pop) {
    let out = CSI + '2J' + CSI + 'H\x1b[1;32m';
    out += ` LIFE   gen ${gen}   pop ${pop}   ${paused ? '[paused]' : ''}  space=pause r=random n=step q=quit\r\n`;
    for (let y = 0; y < H; y++) {
      let row = '';
      for (let x = 0; x < W; x++) row += grid[y][x] ? '#' : ' ';
      out += row + '\r\n';
    }
    term.write(out + '\x1b[0m');
  }

  function tick() {
    if (paused) return;
    const pop = step();
    draw(pop);
    if (pop === 0) { paused = true; draw(0); }
  }

  function input(data) {
    switch (data) {
      case ' ': paused = !paused; draw(countPop()); break;
      case 'r': randomize(); draw(countPop()); break;
      case 'n': { const pop = step(); draw(pop); break; }
      case 'q': case '\x1b': case '\x03': stop(); break;
    }
  }

  function countPop() {
    let p = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) p += grid[y][x];
    return p;
  }

  function stop() {
    clearInterval(timer);
    term.write('\x1b[0m' + CSI + '2J' + CSI + 'H');
    if (onExit) onExit();
  }

  randomize();
  paused = false;
  draw(countPop());
  timer = setInterval(tick, SPEED_MS);
  return { input, stop };
}
