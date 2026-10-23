// Registry of runnable games in the hidden /.games directory.
// Each module exports run(term, { onExit }) -> { input, stop }.
// Adding a game: drop a module here and add one line below (the build bundles
// its source for cat/vim/nano and ls lists it automatically).

import { run as snake } from './snake.js';
import { run as life } from './life.js';
import { run as invaders } from './invaders.js';
import { run as asteroids } from './asteroids.js';
import { run as tetris } from './tetris.js';

export const GAMES = {
  'snake.js': snake,
  'life.js': life,
  'invaders.js': invaders,
  'asteroids.js': asteroids,
  'tetris.js': tetris,
};
