// Data layer. Keeps everything in memory, mirrors it to localStorage so the app
// opens instantly (and offline), and syncs to Supabase when configured.
// Writes made offline are queued and pushed on the next successful connection.

import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../config.js'

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
  entries: [],
  settings: structuredClone(DEFAULT_SETTINGS),
  syncing: false,
  syncError: null,
  pending: { entries: {}, settings: false },
}
let sb = null
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
  return {
    ...d,
    ...s,
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
  try {
    const { createClient } = await import(SUPABASE_JS)
    sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true } })
    const { data } = await sb.auth.getSession()
    state.user = data.session?.user || null
    sb.auth.onAuthStateChange((_evt, session) => {
      const u = session?.user || null
      if (u?.id !== state.user?.id) {
        state.user = u
        if (u) afterLogin()
        else emit()
      }
    })
  } catch (err) {
    // Offline on a cold start before the SDK was cached: fall back to the last mirror.
    const lastUid = localStorage.getItem('cit:lastUid')
    if (lastUid) state.user = { id: lastUid, email: localStorage.getItem('cit:lastEmail') || '' }
    state.syncError = 'Offline — showing saved data'
  }
  if (state.user) await afterLogin()
  state.ready = true
  emit()
  addEventListener('online', () => pull())
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && pull())
}

async function afterLogin() {
  localStorage.setItem('cit:lastUid', state.user.id)
  localStorage.setItem('cit:lastEmail', state.user.email || '')
  loadMirror()
  emit()
  await pull()
}

// Fetch remote rows, keep any local edits that haven't been pushed yet, then push.
export async function pull() {
  if (state.mode !== 'cloud' || !sb || !state.user) return
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
    const merged = rows.filter((r) => pend[r.id] !== 'delete').map((r) => (pend[r.id] === 'upsert' ? local.get(r.id) : r.data))
    for (const [id, op] of Object.entries(pend)) if (op === 'upsert' && !rows.some((r) => r.id === id)) merged.push(local.get(id))
    state.entries = merged.filter(Boolean)
    if (srow && !state.pending.settings) state.settings = mergeSettings(srow.data)
    state.syncError = null
    saveMirror()
  } catch (err) {
    state.syncError = navigator.onLine ? `Sync failed: ${err.message || err}` : 'Offline — changes will sync later'
  }
  state.syncing = false
  emit()
}

async function flush() {
  if (state.mode !== 'cloud' || !sb || !state.user) return
  const pend = state.pending.entries
  for (const [id, op] of Object.entries(pend)) {
    if (op === 'delete') {
      const { error } = await sb.from('entries').delete().eq('id', id)
      if (error) throw error
    } else {
      const e = state.entries.find((x) => x.id === id)
      if (e) {
        const { error } = await sb.from('entries').upsert({ id, data: e, updated_at: new Date().toISOString() })
        if (error) throw error
      }
    }
    delete pend[id]
    saveMirror()
  }
  if (state.pending.settings) {
    const { error } = await sb.from('settings').upsert({ user_id: state.user.id, data: state.settings, updated_at: new Date().toISOString() })
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
  const { error } = await sb.auth.signInWithPassword({ email, password })
  if (error) throw error
}
export async function signUp(email, password) {
  const { data, error } = await sb.auth.signUp({ email, password })
  if (error) throw error
  return { needsConfirm: !data.session }
}
export async function signOut() {
  await sb.auth.signOut()
  state.user = null
  state.entries = []
  state.settings = mergeSettings(null)
  localStorage.removeItem('cit:lastUid')
  emit()
}
