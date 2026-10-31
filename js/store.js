// Data layer. Keeps everything in memory, mirrors it to localStorage so the app
// opens instantly (and offline), and syncs to Supabase when configured.
// Writes made offline are queued and pushed on the next successful connection.
// In cloud mode every entry and the settings are end-to-end encrypted (js/crypto.js):
// Supabase only ever stores ciphertext, and only the user's password or recovery code can open it.

import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../config.js'
import * as E2E from './crypto.js'

const SUPABASE_JS = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm'

export const DEFAULT_SETTINGS = {
  business: { name: '', address: '', state: '', gstin: '', pan: '', email: '', phone: '' },
  bank: { accountName: '', bankName: '', accountNo: '', ifsc: '', upi: '' },
  invoicePrefix: 'INV',
  paymentTermsDays: 30,
  gstRate: 18,
  tdsRate: 10,
  advancePct: 50,
  // SAC codes: 999612 production, 999613 editing, 999615 colour, 999616 VFX, 999617 animation.
  // Confirm the right codes for your work with your CA.
  categories: [
    { name: 'Video Editing', sac: '999613' },
    { name: 'AI Video Editing', sac: '999613' },
    { name: 'Video Shoot', sac: '999612' },
    { name: 'Motion Graphics', sac: '999617' },
    { name: 'Colour Grading', sac: '999615' },
    { name: 'VFX', sac: '999616' },
  ],
}

const state = {
  ready: false,
  mode: SUPABASE_URL && SUPABASE_ANON_KEY ? 'cloud' : 'local',
  user: null,
  locked: false, // signed in, but this device doesn't hold the encryption key yet
  recovering: false, // arrived from a "reset password" email
  unlockError: null,
  recoveryCode: null, // shown once, right after it's created
  entries: [],
  settings: structuredClone(DEFAULT_SETTINGS),
  syncing: false,
  syncError: null,
  pending: { entries: {}, settings: false },
}
let sb = null
let dataKey = null
const listeners = new Set()

export const getState = () => state
export const subscribe = (fn) => (listeners.add(fn), () => listeners.delete(fn))
const emit = () => listeners.forEach((fn) => fn())

// ---- localStorage mirror ----
const ns = () => (state.user ? state.user.id : 'local')
const key = (k) => `cit:${ns()}:${k}`
function readJSON(k, fallback) {
  try {
    const v = localStorage.getItem(k)
    return v ? JSON.parse(v) : fallback
  } catch {
    return fallback
  }
}
function writeJSON(k, v) {
  try {
    localStorage.setItem(k, JSON.stringify(v))
  } catch {}
}
function mergeSettings(s) {
  const d = structuredClone(DEFAULT_SETTINGS)
  if (!s) return d
  const { sheetUrl, ...rest } = s // dropped: the Google Sheets sync was removed
  return {
    ...d,
    ...rest,
    business: { ...d.business, ...(s.business || {}) },
    bank: { ...d.bank, ...(s.bank || {}) },
    categories: s.categories?.length ? s.categories : d.categories,
  }
}
function loadMirror() {
  state.entries = readJSON(key('entries'), [])
  state.settings = mergeSettings(readJSON(key('settings'), null))
  state.pending = readJSON(key('pending'), { entries: {}, settings: false })
}
function saveMirror() {
  writeJSON(key('entries'), state.entries)
  writeJSON(key('settings'), state.settings)
  writeJSON(key('pending'), state.pending)
}

// ---- lifecycle ----
export async function init() {
  if (state.mode === 'local') {
    loadMirror()
    state.ready = true
    emit()
    return
  }
  const recoveryLink = /type=recovery/.test(location.hash)
  try {
    const { createClient } = await import(SUPABASE_JS)
    sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true } })
    // Only recovery and sign-out are handled here; signIn/signUp drive their own unlock.
    sb.auth.onAuthStateChange((evt, session) => {
      if (evt === 'PASSWORD_RECOVERY' && session?.user) {
        state.user = session.user
        state.recovering = state.locked = true
        emit()
      } else if (!session?.user && state.user && evt === 'SIGNED_OUT') {
        // Session ended elsewhere: hide the data but keep the mirror (it may hold unsynced changes).
        dataKey = null
        Object.assign(state, { user: null, locked: false, entries: [], settings: mergeSettings(null) })
        emit()
      }
    })
    const { data } = await sb.auth.getSession()
    state.user = data.session?.user || null
    if (recoveryLink && state.user) state.recovering = state.locked = true
  } catch (err) {
    // Offline on a cold start before the SDK was cached: fall back to the last mirror.
    const lastUid = localStorage.getItem('cit:lastUid')
    if (lastUid) state.user = { id: lastUid, email: localStorage.getItem('cit:lastEmail') || '' }
    state.syncError = 'Offline — showing saved data'
  }
  if (state.user && !state.recovering) await resume()
  state.ready = true
  emit()
  addEventListener('online', () => pull())
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && pull())
}

// Reopening the app: use the key this device already unlocked, otherwise ask for the password.
async function resume() {
  dataKey = await E2E.loadDeviceKey(state.user.id)
  if (!dataKey) {
    state.locked = true
    return
  }
  await afterUnlock()
}

async function afterUnlock() {
  localStorage.setItem('cit:lastUid', state.user.id)
  localStorage.setItem('cit:lastEmail', state.user.email || '')
  state.locked = state.recovering = false
  state.unlockError = null
  loadMirror()
  emit()
  await pull()
}

// ---- encryption keys ----
async function fetchKeyRecord() {
  try {
    const { data, error } = await sb.from('user_keys').select('data').maybeSingle()
    if (error) throw error
    if (data) writeJSON(key('keyrec'), data.data)
    return data?.data || null
  } catch (err) {
    const cached = readJSON(key('keyrec'), null)
    if (cached) return cached
    throw err
  }
}

async function storeKeyRecord(record, isNew) {
  const { error } = isNew
    ? await sb.from('user_keys').insert({ data: record })
    : await sb.from('user_keys').update({ data: record, updated_at: new Date().toISOString() }).eq('user_id', state.user.id)
  if (error) throw error
  writeJSON(key('keyrec'), record)
}

async function useKey(k) {
  dataKey = k
  await E2E.saveDeviceKey(state.user.id, k)
  await afterUnlock()
}

async function createAndStoreKeys(password) {
  const { key: k, record, recoveryCode } = await E2E.createKeys(password)
  try {
    await storeKeyRecord(record, true)
  } catch (err) {
    if (err.code === '23505') return false // another device created the keys first
    throw err
  }
  state.recoveryCode = recoveryCode
  await useKey(k)
  return true
}

// The key must end up wrapped under the password the user actually signs in with.
async function checkLoginPassword(password) {
  const { error } = await sb.auth.signInWithPassword({ email: state.user.email, password })
  if (error) throw new Error('That isn\u2019t your login password.')
}

const WRONG_PASSWORD = "This password doesn't unlock your data. If you reset your password, unlock with your recovery code."

// Opens the data with the password. The first time (new account, or data saved before encryption
// existed), it creates the keys and shows the recovery code.
export async function unlock(password) {
  state.unlockError = null
  try {
    await unlockInner(password)
  } catch (err) {
    state.locked = true
    state.unlockError = err.message || String(err)
    emit()
    throw err
  }
}

async function unlockInner(password) {
  let record = await fetchKeyRecord()
  if (!record) {
    if (await createAndStoreKeys(password)) return
    record = await fetchKeyRecord()
  }
  let k
  try {
    k = await E2E.unlockWithPassword(record, password)
  } catch {
    throw new Error(WRONG_PASSWORD)
  }
  await useKey(k)
}

// Recovery code + new password. From a reset email it also changes the login password;
// from the unlock screen it re-wraps the key under the password the user just signed in with.
export async function recover(code, newPassword, { changeLogin = state.recovering } = {}) {
  if (!changeLogin) await checkLoginPassword(newPassword)
  const record = await fetchKeyRecord()
  let result = null
  if (record) {
    try {
      result = await E2E.resetWithRecovery(record, code, newPassword)
    } catch {
      throw new Error("That recovery code doesn't match this account.")
    }
  }
  if (changeLogin) {
    const { error } = await sb.auth.updateUser({ password: newPassword })
    if (error) throw error
  }
  if (!result) return void (await createAndStoreKeys(newPassword))
  await storeKeyRecord(result.record, false)
  await useKey(result.key)
}

// Lost both password and recovery code: the old data can never be opened, so delete it and start again.
export async function startOver(newPassword) {
  if (state.recovering) {
    const { error } = await sb.auth.updateUser({ password: newPassword })
    if (error) throw error
  } else await checkLoginPassword(newPassword)
  for (const t of ['entries', 'settings', 'user_keys']) {
    const { error } = await sb.from(t).delete().eq('user_id', state.user.id)
    if (error) throw error
  }
  for (const k of ['entries', 'settings', 'pending', 'keyrec']) localStorage.removeItem(key(k))
  await createAndStoreKeys(newPassword)
}

export async function changePassword(current, next) {
  const record = await fetchKeyRecord()
  let result
  try {
    result = await E2E.rekey(record, current, { newPassword: next })
  } catch {
    throw new Error('Current password is wrong.')
  }
  const { error } = await sb.auth.updateUser({ password: next })
  if (error) throw error
  await storeKeyRecord(result.record, false)
}

export async function newRecoveryCode(password) {
  const record = await fetchKeyRecord()
  let result
  try {
    result = await E2E.rekey(record, password, { newRecovery: true })
  } catch {
    throw new Error('Password is wrong.')
  }
  await storeKeyRecord(result.record, false)
  state.recoveryCode = result.recoveryCode
  emit()
}

export function ackRecoveryCode() {
  state.recoveryCode = null
  emit()
}

// ---- sync ----

// Fetch remote rows, keep any local edits that haven't been pushed yet, then push.
export async function pull() {
  if (state.mode !== 'cloud' || !sb || !state.user || !dataKey) return
  state.syncing = true
  emit()
  try {
    await flush()
    const [{ data: rows, error }, { data: srow, error: serr }] = await Promise.all([
      sb.from('entries').select('id,data'),
      sb.from('settings').select('data').maybeSingle(),
    ])
    if (error) throw error
    if (serr) throw serr
    const pend = state.pending.entries
    const local = new Map(state.entries.map((e) => [e.id, e]))
    const opened = []
    const plain = [] // saved before encryption existed: re-upload encrypted
    let unreadable = 0
    for (const r of rows) {
      if (!E2E.isSealed(r.data)) {
        opened.push(r)
        plain.push(r.id)
        continue
      }
      try {
        opened.push({ id: r.id, data: await E2E.open(dataKey, r.data) })
      } catch {
        unreadable++
      }
    }
    const merged = opened.filter((r) => pend[r.id] !== 'delete').map((r) => (pend[r.id] === 'upsert' ? local.get(r.id) : r.data))
    for (const [id, op] of Object.entries(pend)) if (op === 'upsert' && !rows.some((r) => r.id === id)) merged.push(local.get(id))
    state.entries = merged.filter(Boolean)
    if (srow && !state.pending.settings) {
      if (E2E.isSealed(srow.data)) state.settings = mergeSettings(await E2E.open(dataKey, srow.data))
      else (state.settings = mergeSettings(srow.data)), (state.pending.settings = true)
    }
    for (const id of plain) if (!pend[id]) pend[id] = 'upsert'
    saveMirror()
    if (plain.length || state.pending.settings) await flush()
    state.syncError = unreadable ? `${unreadable} entries couldn't be decrypted` : null
  } catch (err) {
    state.syncError = navigator.onLine ? `Sync failed: ${err.message || err}` : 'Offline — changes will sync later'
  }
  state.syncing = false
  emit()
}

async function flush() {
  if (state.mode !== 'cloud' || !sb || !state.user || !dataKey) return
  const pend = state.pending.entries
  for (const [id, op] of Object.entries(pend)) {
    if (op === 'delete') {
      const { error } = await sb.from('entries').delete().eq('id', id)
      if (error) throw error
    } else {
      const e = state.entries.find((x) => x.id === id)
      if (e) {
        const { error } = await sb.from('entries').upsert({ id, data: await E2E.seal(dataKey, e), updated_at: new Date().toISOString() })
        if (error) throw error
      }
    }
    delete pend[id]
    saveMirror()
  }
  if (state.pending.settings) {
    const { error } = await sb.from('settings').upsert({ user_id: state.user.id, data: await E2E.seal(dataKey, state.settings), updated_at: new Date().toISOString() })
    if (error) throw error
    state.pending.settings = false
    saveMirror()
  }
}

async function sync() {
  if (state.mode !== 'cloud') return
  try {
    await flush()
    state.syncError = null
  } catch (err) {
    state.syncError = navigator.onLine ? `Sync failed: ${err.message || err}` : 'Offline — changes will sync later'
  }
  emit()
}

export const pendingCount = () => Object.keys(state.pending.entries).length + (state.pending.settings ? 1 : 0)

// ---- mutations ----
export function saveEntry(entry) {
  const e = { ...entry, updatedAt: new Date().toISOString() }
  const i = state.entries.findIndex((x) => x.id === e.id)
  if (i >= 0) state.entries[i] = e
  else state.entries.push(e)
  state.entries = [...state.entries]
  if (state.mode === 'cloud') state.pending.entries[e.id] = 'upsert'
  saveMirror()
  emit()
  sync()
  return e
}

export function deleteEntry(id) {
  state.entries = state.entries.filter((x) => x.id !== id)
  if (state.mode === 'cloud') state.pending.entries[id] = 'delete'
  saveMirror()
  emit()
  sync()
}

export function saveSettings(settings) {
  state.settings = mergeSettings(settings)
  if (state.mode === 'cloud') state.pending.settings = true
  saveMirror()
  emit()
  sync()
}

export function importData({ entries, settings }) {
  for (const e of entries || []) saveEntry(e)
  if (settings) saveSettings(settings)
}

// ---- auth ----
export async function signIn(email, password) {
  const { data, error } = await sb.auth.signInWithPassword({ email, password })
  if (error) throw error
  state.user = data.user
  state.locked = true
  await unlock(password)
}

export async function signUp(email, password) {
  const { data, error } = await sb.auth.signUp({ email, password, options: { emailRedirectTo: location.origin + location.pathname } })
  if (error) throw error
  if (!data.session) return { needsConfirm: true } // keys are created on the first sign-in
  state.user = data.user
  state.locked = true
  await unlock(password)
  return { needsConfirm: false }
}

export async function forgotPassword(email) {
  const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname })
  if (error) throw error
}

// Signing out removes this account's data and key from the device (the encrypted copy stays in the cloud).
export async function signOut() {
  const uid = state.user?.id
  await sb?.auth.signOut().catch(() => {})
  if (uid) {
    await E2E.forgetDeviceKey(uid)
    for (const k of ['entries', 'settings', 'pending', 'keyrec']) localStorage.removeItem(`cit:${uid}:${k}`)
  }
  localStorage.removeItem('cit:lastUid')
  dataKey = null
  Object.assign(state, { user: null, locked: false, recovering: false, unlockError: null, recoveryCode: null, entries: [], settings: mergeSettings(null), pending: { entries: {}, settings: false } })
  emit()
}
