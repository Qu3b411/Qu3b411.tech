// secrets.js — easter-egg "filesystem" + the real puzzle: broken RSA params.
//
// Surface layer: `cat /etc/passwd` returns canned text and a base64->rot13->hex
// breadcrumb that just points you at the `challenge` command. That part is a
// warm-up. The actual lock is a textbook-RSA parameter flaw.
//
// The sin: the app's RSA key and the SSH key sitting in ~/.ssh were generated
// on the same box with lousy entropy, so they SHARE a prime factor. Everything
// shipped here is public by definition — two moduli, a public exponent, one
// ciphertext. There is no private key anywhere in this bundle, so grepping gets
// you nothing. gcd(n_app, n_ssh) hands you the shared prime, which factors the
// app modulus, which gives you d, which decrypts the flag. ("Mining your Ps and
// Qs", for real.) The flag is NOT stored in cleartext here — only a SHA-256 of
// it — so you have to actually run the attack.

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
    '# bGF5ZXIgMiAtLSByb3QxMy4gZGVjb2RlLCB0aGVuIHJlYWQgdGhlIGhleDoKICA2cjZzNzQyMDYzNzI3OTcwNzQ2czJxMzEzMDMxMnIyMDc0Njg2NTIwNnA2czYzNm8yMDY5NzMyMDc0NjU3ODc0NjI2czZzNm8yMDcyNzM2MTJyMjA3Mjc1NnIzbjIwNjM2ODYxNnA2cDY1NnI2NzY1',
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
    'challenge',
    'cat ~/.ssh/id_rsa.pub',
    '# ...you are literally retracing someone else\'s steps. keep going.',
  ],
  // Blob #2: a stray SSH public key "left on the same box". Its modulus shares
  // a prime with the challenge modulus. Parse out n (ssh-rsa wire format) and
  // gcd it against the app modulus.
  '~/.ssh/id_rsa.pub': [
    'ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAAAgQCjQDXMsQhYd3eLZeFw9511rqZKr2j9JTHpnjSE06EPfkq+2z3+S88nEOyY2avWMdeZdf83zRrUttFG2rUYmRQj7lI9sS3zHJWSFVIMqOMk/0feJJ/UVM68uJFMHIJsT8uQ6MTO7rzTYcyAE/uq1b5cLWH/aSz+EZYob9Q/sCbU6w== qu3b411@terminal',
  ],
};
// Common aliases people type.
SECRETS['/home/qu3b411/.bash_history'] = SECRETS['~/.bash_history'];
SECRETS['/home/qu3b411/.ssh/id_rsa.pub'] = SECRETS['~/.ssh/id_rsa.pub'];

// --- The challenge (all public parameters) ----------------------------------
// Textbook RSA (no padding). n is the app modulus; it shares a prime with the
// ssh key's modulus. The plaintext is the flag.
export const CHALLENGE = {
  e: '65537',
  nHex: 'c45622b7ba04450eb4d03acd6cd96019d46f25daddc3d276d909bbd59ab43eabcc1678f55fbc3c638097a2774dad554c66827c90f394203873270d946e29f312a09f54c96d02f6c12495e54e8e82363a88be399fdd85af9b98e082c3e115fdccec7f00b76632d26fb490b58514538dd223075d9df533399a36b09edda0df4043',
  ctHex: '1f6b3f70ada24895b7705bc8d9548fff5f88e50c383627874d87076ab8b4309371b1b541b77a62224a8ce379abfbb46c002106fb7ad3902797cf0d98deebf1991928085260d4864be5763a8ca19c1571c472957935cc45ae9946d063cb675c389b379bd4e574742eb6cb4622c597252cd96d948cbd9acdc1549ded7f65bd6b7d',
};

// SHA-256 of the correct flag. The flag never appears here in cleartext.
const FLAG_SHA256 = '8e034d01927e7f013e9bcd3a882ec02b510a0468b920c1ac92111b4a22458a69';

async function sha256Hex(str) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Verify a submitted flag against the stored digest. Returns the unlock payload.
export async function tryUnlock(raw) {
  const guess = String(raw || '').trim();
  if (!guess) return { message: ['unlock: usage: unlock <flag>'], rooted: false };
  const digest = await sha256Hex(guess);
  if (digest !== FLAG_SHA256) {
    return { message: ['unlock: wrong flag. factor the modulus first.'], rooted: false };
  }
  return {
    rooted: true,
    message: [
      '',
      '   ____  ___   ___ _____ ',
      '  / __ \\/ _ \\ / _ \\_   _|',
      ' / /_/ / // // // / | |  ',
      ' \\____/\\___/ \\___/  |_|  ',
      '',
      'one gcd and the whole key fell over. textbook. respect.',
      'flag accepted. you now have root. (cosmetic. purely for the vibes.)',
      '',
    ],
  };
}

// Human-readable brief for the `challenge` command.
export function challengeBrief() {
  return [
    'CHALLENGE: textbook RSA, but the key is cursed.',
    '',
    'The flag was encrypted with this public key (no padding, straight m^e mod n):',
    '',
    `  e  = ${CHALLENGE.e}`,
    `  n  = 0x${CHALLENGE.nHex}`,
    `  ct = 0x${CHALLENGE.ctHex}`,
    '',
    'You do NOT have the private key, and you will not find it in this bundle.',
    'But this key was generated on a box with garbage entropy, and it was not the',
    'only key born there. Another public key is lying around on this machine --',
    'the kind of place a dev leaves one. Two keys, same bad RNG... what might they',
    'have in common?',
    '',
    'Recover the plaintext, then:  unlock QU3B411{...}',
    '',
    'no server, no private key, no padding oracle this time. pure arithmetic.',
  ];
}
