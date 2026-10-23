// secrets.js — easter-egg "filesystem" red herrings and the unlock puzzle.
//
// `cat /etc/passwd` (and a couple of other classic paths) returns canned text.
// /etc/passwd hides a layered decode chain: base64 -> rot13 -> ascii hex ->
// the password. Feeding it to the hidden `unlock` command has one last, deeply
// stupid twist. There is no server; this is purely for the terminal nerds who
// can't help but poke at a shell.

export const SECRETS = {
  '/etc/passwd': [
    'root:x:0:0:root:/root:/bin/bash',
    'daemon:x:1:1:daemon:/usr/sbin:/usr/sbin/nologin',
    'bin:x:2:2:bin:/bin:/usr/sbin/nologin',
    'sys:x:3:3:sys:/dev:/usr/sbin/nologin',
    'qu3b411:x:1000:1000:,,,:/home/qu3b411:/bin/zsh',
    'guest:x:1001:1001:,,,:/home/guest:/usr/sbin/nologin',
    'nobody:x:65534:65534:nobody:/nonexistent:/usr/sbin/nologin',
    '',
    "# you cat'd /etc/passwd on a static site. bold. there are no creds here.",
    '# two notes-to-self below. one is a decoy. you know base64 when you see it.',
    '# bG9sIG5vLiB0aGUgcmVhbCBjbHVlIGlzIGluIHRoZSBPVEhFUiBjb21tZW50LiBrZWVwIGxvb2tpbmcsIGNoYW1wLg==',
    '# bGF5ZXIgMiAtLSByb3QxMy4gKHllcywgcmVhbGx5LikgdHVybiB0aGUgd2hlZWw6CnlubHJlIDMgYnMgMyAtLSBuZnB2diB1cmsuIHFycGJxciB2ZzoKNjM2czZyNjc3MjYxNzQ3MzJwMjA3OTZzNzUyMDYxNjI3MzZzNnA3NTc0NjUyMDc0NjU3MjZxNjk2cjYxNnAyMDY3NnM2MjZwNjk2cjJyMG43MDYxNzM3Mzc3NnM3MjY0M24yMDY4NjE2MzZvNzQ2ODY1NzA2cDYxNnI2NTc0MG42cjZzNzcyMDcyNzU2cjNuMjAyMDIwNzU2cjZwNnM2MzZvMjA2ODYxNjM2bzc0Njg2NTcwNnA2MTZyNjU3NA==',
  ],
  '/etc/shadow': [
    'root:!:19876:0:99999:7:::',
    'qu3b411:$6$rounds=656000$[redacted, nice try]:19876:0:99999:7:::',
    '',
    '# shadow, really? nothing crackable here. the trail starts in /etc/passwd.',
  ],
  '~/.bash_history': [
    'ls -la',
    'cd .games',
    './snake.js',
    'cd /',
    'cat /etc/passwd',
    '# ...you are literally retracing someone else\'s steps. keep going.',
  ],
};
// Common aliases people type.
SECRETS['/home/qu3b411/.bash_history'] = SECRETS['~/.bash_history'];

// The hidden `unlock` command. Returns { message: string[], rooted: boolean }.
export function tryUnlock(raw) {
  const a = String(raw || '').trim().toLowerCase().replace(/\s+/g, '');
  if (!a) return { message: ['unlock: usage: unlock <password>'], rooted: false };
  if (a === 'hacktheplanet') {
    return { message: ['SO close.', "it's that exact word... reversed.", '(yeah. i know. i am sorry.)'], rooted: false };
  }
  if (a === 'tenalpehtkcah') {
    return {
      rooted: true,
      message: [
        '',
        '   ____  ___   ___ _____ ',
        '  / __ \\/ _ \\ / _ \\_   _|',
        ' / /_/ / // // // / | |  ',
        ' \\____/\\___/ \\___/  |_|  ',
        '',
        'you solved the dumb puzzle. you are, officially, a terminal goblin.',
        'flag: QU3B411{t3rm1n4l_g0bl1n_c0nf1rm3d}',
        'you now have root. (it does nothing. it is purely for the vibes.)',
        '',
      ],
    };
  }
  return { message: ['unlock: access denied'], rooted: false };
}
