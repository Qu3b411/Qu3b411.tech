// secrets.js — easter-egg "filesystem" + the real puzzle: a CBC padding oracle.
//
// Surface layer: `cat /etc/passwd` returns canned text and a base64->rot13->hex
// breadcrumb that just points you at the `challenge` command. That part is a
// warm-up. The actual lock is a Vaudenay-style CBC padding-oracle attack.
//
// There is no server — this is a static site — so the oracle necessarily runs
// in your browser and the AES key is somewhere in this bundle. Yes. You could
// dig it out and decrypt in one step. Don't. The intended solve is the attack:
// forge an IV / previous block, ask the oracle "is the PKCS#7 padding valid?",
// and peel the plaintext a byte at a time, exactly as you would against a real
// server. The flag itself is NOT stored in cleartext anywhere here — only a
// SHA-256 of it — so grepping the source won't hand you the answer. Earn it.

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
    '# bGF5ZXIgMiAtLSByb3QxMy4gZGVjb2RlLCB0aGVuIHJlYWQgdGhlIGhleDoKICA3NDY4NjUyMDcyNjU2MTZwMjA2cDZzNjM2bzIwNjk3MzIwNjEyMDYzNjI2MzIwNzA2MTY0NjQ2OTZyNjcyMDZzNzI2MTYzNnA2NTJyMjA3Mjc1NnIzbjIwNjM2ODYxNnA2cDY1NnI2NzY1',
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
    '# ...you are literally retracing someone else\'s steps. keep going.',
  ],
};
// Common aliases people type.
SECRETS['/home/qu3b411/.bash_history'] = SECRETS['~/.bash_history'];

// --- The challenge (public parameters) --------------------------------------
// AES-128-CBC, PKCS#7. IV and ciphertext are public, as they always are. The
// plaintext IS the flag. Block size 16.
export const CHALLENGE = {
  ivHex: '34a350cd7e174b9645eb857524ecb853',
  ctHex: '8fd57f16e519394c77982dbcf71427db94997a4032057323993863ea2b0a3c3407a63560f9467889ba88527dfdecfe17',
};

// SHA-256 of the correct flag. The flag never appears here in cleartext.
const FLAG_SHA256 = '339025155a066c647e53634aba112d0aac1c4b7e83d251b19b25b0c7dbd41e38';

// The key, split so it is not a grep-able hex blob. Reconstructed at runtime by
// XORing against a mask derived from a benign string. (This is obfuscation, not
// security — the whole point is that you attack the oracle instead.)
const KEY_STORED = [147, 86, 88, 123, 42, 205, 207, 198, 35, 198, 83, 240, 205, 177, 176, 222];
const KEY_SALT = 'qu3b411:do-the-attack:not-the-grep';

let _keyPromise = null;
async function getKey() {
  if (_keyPromise) return _keyPromise;
  _keyPromise = (async () => {
    const maskBuf = new Uint8Array(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(KEY_SALT))
    );
    const raw = new Uint8Array(16);
    for (let i = 0; i < 16; i++) raw[i] = KEY_STORED[i] ^ maskBuf[i];
    return crypto.subtle.importKey('raw', raw, { name: 'AES-CBC' }, false, ['decrypt']);
  })();
  return _keyPromise;
}

function hexToBytes(hex) {
  const s = String(hex || '').trim().replace(/^0x/i, '').replace(/\s+/g, '');
  if (!/^[0-9a-fA-F]*$/.test(s) || s.length % 2) throw new Error('bad hex');
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.substr(i * 2, 2), 16);
  return out;
}

function bytesToHex(buf) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// The padding oracle. Given a forged IV (16 bytes) and a ciphertext (one or
// more 16-byte blocks), both hex, return true iff the PKCS#7 padding of the
// decrypted result is valid. Web Crypto throws OperationError on bad padding
// and succeeds on good padding — that difference is the whole oracle.
export async function padOracle(ivHex, ctHex) {
  const iv = hexToBytes(ivHex);
  const ct = hexToBytes(ctHex);
  if (iv.length !== 16) throw new Error('iv must be 16 bytes');
  if (ct.length === 0 || ct.length % 16) throw new Error('ciphertext must be a multiple of 16 bytes');
  const key = await getKey();
  try {
    await crypto.subtle.decrypt({ name: 'AES-CBC', iv }, key, ct);
    return true;
  } catch {
    return false;
  }
}

async function sha256Hex(str) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return bytesToHex(d);
}

// Verify a submitted flag against the stored digest. Returns the unlock payload.
export async function tryUnlock(raw) {
  const guess = String(raw || '').trim();
  if (!guess) return { message: ['unlock: usage: unlock <flag>'], rooted: false };
  const digest = await sha256Hex(guess);
  if (digest !== FLAG_SHA256) {
    return { message: ['unlock: wrong flag. the oracle is right there. use it.'], rooted: false };
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
      'you ran a padding-oracle attack against a browser. respect.',
      'flag accepted. you now have root. (cosmetic. purely for the vibes.)',
      '',
    ],
  };
}

// Human-readable brief for the `challenge` command.
export function challengeBrief() {
  return [
    'CHALLENGE: CBC padding oracle (AES-128-CBC, PKCS#7, block size 16).',
    '',
    'The plaintext is a flag of the form QU3B411{...}. You are given the IV and',
    'the ciphertext. There is no server and you do NOT have the key. Recover the',
    'plaintext using the oracle alone.',
    '',
    `  iv = ${CHALLENGE.ivHex}`,
    `  ct = ${CHALLENGE.ctHex}`,
    '',
    'ORACLE: manual poke  ->  oracle <ivHex> <ctHex>   (prints VALID / INVALID)',
    'ORACLE: scriptable    ->  await window.__padoracle(ivHex, ctHex) -> boolean',
    '',
    'Automate it from the devtools console (you are not typing 4096 queries by',
    'hand). Forge the previous block byte-by-byte, watch for valid padding, peel',
    'the intermediate state, XOR back the real previous block. When you have the',
    'plaintext:  unlock QU3B411{...}',
    '',
    "it's a padding oracle. no, i will not make it a server. figure it out.",
  ];
}
