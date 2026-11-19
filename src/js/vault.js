// vault.js — encrypted store for privileged virtual-filesystem content.
//
// Protected plaintext is held only as AES-GCM ciphertext. The key is derived
// from the recovered flag (SHA-256); it is never stored here, and neither is any
// plaintext or the flag itself — only ciphertext and a validation canary. A
// forged or guessed key fails the GCM authentication tag, so privilege cannot be
// faked: the only way to read protected content is to hold the real flag, which
// means solving the challenge. This file is deliberately terse and is further
// minified in the production bundle; the readable games, filesystem, and
// intentionally discoverable CTF clues live in their own modules.

const D = {
  canary: { iv: 'TlaQrcuzv919gpFj', ct: '3KSezbqePVk4bShsXL8kEM3c+rNILL46EcpzLYxVSSjRtJTq+RWWqw==' },
  '/etc/shadow': { iv: 'NYH7CQHiZNgKm2KH', ct: '4+s5sks9Wl02JRCrKgGtrfQTc6LZBVCyYC3el8a89Z0FsGV9BWtVlIxmvUMeN/+3YAzgsm6xUa31dKjKFdws3iQW1PjhVTpl+/aSkFxYgqO1jJ5iuF8SawA/R2OeqbMPx+5uFnOoRtv8Qg==' },
};
const M = 'cXUzYjQxMTpyb290OnVubG9ja2VkOnYx'; // canary marker, base64(plaintext)

const te = new TextEncoder();
const td = new TextDecoder();
const b2u = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const u2b = (u) => btoa(String.fromCharCode(...new Uint8Array(u)));
const K = (raw) => crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['decrypt']);
const DEC = async (k, blob) => td.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b2u(blob.iv) }, k, b2u(blob.ct)));

async function ok(k) {
  try { return u2b(te.encode(await DEC(k, D.canary))) === M; } catch (e) { return false; }
}

// Whether a path is stored privileged + encrypted here.
export function vaultHas(p) { return p !== 'canary' && Object.prototype.hasOwnProperty.call(D, p); }

// Derive a key from the flag and validate it. Returns { key, raw } (raw =
// base64 key material, for persistence) or null when the flag is wrong.
export async function vaultUnlock(flag) {
  const raw = await crypto.subtle.digest('SHA-256', te.encode(String(flag == null ? '' : flag)));
  const key = await K(raw);
  return (await ok(key)) ? { key, raw: u2b(raw) } : null;
}

// Re-import a persisted key and return it only if it still validates; a forged
// or corrupt value yields null.
export async function vaultRestore(raw) {
  try { const key = await K(b2u(String(raw == null ? '' : raw))); return (await ok(key)) ? key : null; } catch (e) { return null; }
}

// Decrypt a protected path with a validated key, or null.
export async function vaultRead(key, p) {
  if (!key || !vaultHas(p)) return null;
  try { return await DEC(key, D[p]); } catch (e) { return null; }
}
