// End-to-end encryption. Every entry and the settings are encrypted on the device before
// they reach Supabase, so the database (and whoever runs it) only ever sees ciphertext.
//
// Keys:
//   data key  - random AES-256-GCM key that encrypts the user's data. Never leaves the device unwrapped.
//   password  - PBKDF2 turns it into a key that wraps (encrypts) the data key.
//   recovery  - a random code shown once at sign-up; wraps a second copy of the data key,
//               so a forgotten password doesn't lose the data.
// Only the two wrapped copies (+ salts) are stored in Supabase, in public.user_keys.

const ITERATIONS = 600000 // PBKDF2-SHA256, OWASP 2023 recommendation
const te = new TextEncoder()
const td = new TextDecoder()
const subtle = crypto.subtle

const rand = (n) => crypto.getRandomValues(new Uint8Array(n))
function b64(buf) {
  const bytes = new Uint8Array(buf)
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))

async function wrappingKey(secret, salt, iterations) {
  const base = await subtle.importKey('raw', te.encode(secret), 'PBKDF2', false, ['deriveKey'])
  return subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, base, { name: 'AES-GCM', length: 256 }, false, ['wrapKey', 'unwrapKey'])
}

async function wrap(dek, secret) {
  const salt = rand(16)
  const iv = rand(12)
  const wrapped = await subtle.wrapKey('raw', dek, await wrappingKey(secret, salt, ITERATIONS), { name: 'AES-GCM', iv })
  return { salt: b64(salt), iv: b64(iv), key: b64(wrapped), iter: ITERATIONS }
}

// Throws if the secret is wrong (AES-GCM authentication fails).
async function unwrap(w, secret, extractable) {
  const kek = await wrappingKey(secret, unb64(w.salt), w.iter)
  return subtle.unwrapKey('raw', unb64(w.key), kek, { name: 'AES-GCM', iv: unb64(w.iv) }, { name: 'AES-GCM', length: 256 }, extractable, ['encrypt', 'decrypt'])
}

// Non-extractable copy for day-to-day use: scripts can encrypt/decrypt with it but never read it out.
async function lockDown(dek) {
  return subtle.importKey('raw', await subtle.exportKey('raw', dek), { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
}

// ---- recovery code: 24 Crockford base32 chars (120 bits), shown as XXXX-XXXX-XXXX-XXXX-XXXX-XXXX ----
const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
function newRecoveryCode() {
  const bytes = rand(15)
  let bits = 0, val = 0, out = ''
  for (const b of bytes) {
    val = (val << 8) | b
    bits += 8
    while (bits >= 5) out += B32[(val >>> (bits -= 5)) & 31]
  }
  return out.match(/.{4}/g).join('-')
}
export const normalizeRecoveryCode = (code) =>
  String(code || '').toUpperCase().replace(/[^0-9A-Z]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1').match(/.{1,4}/g)?.join('-') || ''

// ---- key record (what's stored in public.user_keys.data) ----

// New account (or first sign-in after encryption was added).
export async function createKeys(password) {
  const dek = await subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt'])
  const recoveryCode = newRecoveryCode()
  const record = { v: 1, password: await wrap(dek, password), recovery: await wrap(dek, recoveryCode) }
  return { key: await lockDown(dek), record, recoveryCode }
}

export const unlockWithPassword = (record, password) => unwrap(record.password, password, false)

// Forgotten password: open with the recovery code, then wrap the data key under the new password.
export async function resetWithRecovery(record, code, newPassword) {
  const dek = await unwrap(record.recovery, normalizeRecoveryCode(code), true)
  return { key: await lockDown(dek), record: { ...record, password: await wrap(dek, newPassword) } }
}

// Change password and/or issue a new recovery code (needs the current password).
export async function rekey(record, password, { newPassword, newRecovery } = {}) {
  const dek = await unwrap(record.password, password, true)
  const next = { ...record }
  let recoveryCode = null
  if (newPassword) next.password = await wrap(dek, newPassword)
  if (newRecovery) next.recovery = await wrap(dek, (recoveryCode = newRecoveryCode()))
  return { record: next, recoveryCode }
}

// ---- data ----
export const isSealed = (d) => !!d && d.v === 1 && typeof d.ct === 'string' && typeof d.iv === 'string'

export async function seal(key, obj) {
  const iv = rand(12)
  const ct = await subtle.encrypt({ name: 'AES-GCM', iv }, key, te.encode(JSON.stringify(obj)))
  return { v: 1, iv: b64(iv), ct: b64(ct) }
}

export async function open(key, box) {
  const pt = await subtle.decrypt({ name: 'AES-GCM', iv: unb64(box.iv) }, key, unb64(box.ct))
  return JSON.parse(td.decode(pt))
}

// ---- keep the unlocked key on this device (IndexedDB stores CryptoKey objects as-is) ----
function db() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('cit-keys', 1)
    req.onupgradeneeded = () => req.result.createObjectStore('keys')
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}
async function idb(mode, fn) {
  const d = await db()
  return new Promise((resolve, reject) => {
    const tx = d.transaction('keys', mode)
    const req = fn(tx.objectStore('keys'))
    tx.oncomplete = () => (d.close(), resolve(req.result))
    tx.onerror = () => (d.close(), reject(tx.error))
  })
}
export const saveDeviceKey = (uid, key) => idb('readwrite', (s) => s.put(key, uid))
export const loadDeviceKey = (uid) => idb('readonly', (s) => s.get(uid)).catch(() => null)
export const forgetDeviceKey = (uid) => idb('readwrite', (s) => s.delete(uid)).catch(() => {})
