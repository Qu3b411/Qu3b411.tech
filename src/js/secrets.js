// secrets.js — the hidden "filesystem" behind the terminal. No command here
// announces itself as a puzzle. It is meant to look like an ordinary, slightly
// messy box until someone pokes around (`ls -la`, read the shell history) and
// realizes the junk lying around is a crypto challenge.
//
// The buried puzzle: two RSA public keys in ~/.ssh were generated on a freshly
// provisioned VM with almost no entropy, so they SHARE a prime factor. The flag
// was "encrypted" with hand-rolled textbook RSA (pow(m, e, n), no padding) and
// left in ~/.secret/flag.enc. Everything here is public by definition — two
// public keys and a ciphertext — so there is no private key to grep. The move
// is gcd(n1, n2): the shared prime factors the modulus, which gives d, which
// decrypts the flag. ("Mining your Ps and Qs", on actual ssh keys.) The flag is
// not stored in cleartext anywhere, only a SHA-256 of it. `unlock <flag>` flips
// a cosmetic root prompt.

export const SECRETS = {
  // Looks like a boring, real passwd. It is. The trail is not here.
  '/etc/passwd': [
    'root:x:0:0:root:/root:/bin/bash',
    'daemon:x:1:1:daemon:/usr/sbin:/usr/sbin/nologin',
    'bin:x:2:2:bin:/bin:/usr/sbin/nologin',
    'sys:x:3:3:sys:/dev:/usr/sbin/nologin',
    'sshd:x:110:65534::/run/sshd:/usr/sbin/nologin',
    'qu3b411:x:1000:1000:,,,:/home/qu3b411:/bin/zsh',
    'guest:x:1001:1001:,,,:/home/guest:/usr/sbin/nologin',
    'nobody:x:65534:65534:nobody:/nonexistent:/usr/sbin/nologin',
  ],
  '/etc/shadow': [
    'root:!:19876:0:99999:7:::',
    'qu3b411:$6$rounds=656000$[redacted, nice try]:19876:0:99999:7:::',
    'cat: /etc/shadow: Permission denied',
  ],
  // The shell history is the real trail: what the owner did on this box.
  '/.bash_history': [
    'ls -la',
    'cd .games && ./snake.js',
    'cd ~',
    '# spun up a throwaway vm, needed ssh keys in a hurry',
    "ssh-keygen -t rsa -b 1024 -f ~/.ssh/id_rsa -N ''",
    '# meh, rotated it. (same box, same dead /dev/random, who cares)',
    "ssh-keygen -t rsa -b 1024 -f ~/.ssh/id_rsa.old -N ''",
    '# hid the flag where nobody looks. rolled my own rsa, padding is for cowards',
    'python3 -c "m=int.from_bytes(open(\'flag.txt\',\'rb\').read(),\'big\'); print(hex(pow(m, 65537, N)))" > ~/.secret/flag.enc',
    'rm -f flag.txt',
    'history -c   # (this obviously did not work, you are reading it)',
  ],
  // Two public keys. They look independent. They are not.
  '/.ssh/id_rsa.pub': [
    'ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAAAgQCYCyYqsR1RWYNi5fxnAfSWQCtEVLnfEoL61HOl9MrLuqaMm/bOvdL9yLQYjJfZSGv5rbhbN8pYrA+x4YKX65vSa9g8UOCM/yuoAyG5sA4OMy88FQJGcVQbp4zwssKq/oED4JKAmo0l2ieskEP4GWNnuVWsHM5nU8PAeewZrpMJIQ== qu3b411@vm',
  ],
  '/.ssh/id_rsa.old.pub': [
    'ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAAAgQDBxJvrnPHEHNU+AXAWZqSsZY8f8dpGvm/PjwXM+Xqq9oYacBWtbVQOECWvY1SwyXhFN7qm87w52SgQOmQ/1eshQ6BqWRFi/Wg6efw+iraxSYhf1OFG30KBb7nSek6n1cpAjeCK5OSf4SjhSVbllqm3uatCY2II16qFRx22sp9i/Q== qu3b411@vm',
  ],
  // The ciphertext: hex of pow(flag, 65537, n_of_id_rsa.pub). Textbook, no pad.
  '/.secret/flag.enc': [
    '0x1ce390ff2c14d3f7b04a26e78796b2a04cc277aec552c76ea373a4a508679aeb6eafae71fab0c71d6963854abc55c56ab1979a04630d8bae9dbd9b6ee5d59f7aef14390084a7b8181af97357ee2f03bf8cfb3e11af4ecdbc1d4460187b3f127e8d80741e94438c60557d7457394afb105f04706dc2a687f16b41a969f081ce3c',
  ],
};

// SHA-256 of the correct flag. The flag never appears here in cleartext.
const FLAG_SHA256 = 'deddbee3604eceb857620575aa06ad6709983d64f62748ea46feff1a4b86ebef';

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
    return { message: ['unlock: wrong flag. keep digging.'], rooted: false };
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
      'one gcd and the whole key fell over. two keys, one dead rng. textbook.',
      'flag accepted. you now have root. (cosmetic. purely for the vibes.)',
      '',
    ],
  };
}
