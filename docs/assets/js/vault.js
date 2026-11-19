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
export function vaultHas(p) { return p !== 'canary' && Object.prototype.hasOwnProperty.call(D, p); }
export async function vaultUnlock(flag) {
const raw = await crypto.subtle.digest('SHA-256', te.encode(String(flag == null ? '' : flag)));
const key = await K(raw);
return (await ok(key)) ? { key, raw: u2b(raw) } : null;
}
export async function vaultRestore(raw) {
try { const key = await K(b2u(String(raw == null ? '' : raw))); return (await ok(key)) ? key : null; } catch (e) { return null; }
}
export async function vaultRead(key, p) {
if (!key || !vaultHas(p)) return null;
try { return await DEC(key, D[p]); } catch (e) { return null; }
}