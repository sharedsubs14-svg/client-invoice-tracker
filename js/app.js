import { html, render, useState, useEffect, useLayoutEffect, useMemo, useRef } from 'https://cdn.jsdelivr.net/npm/htm@3.1.1/preact/standalone.module.js'
import * as store from './store.js'
import { calc, num, round2, fmt, fmt0, fmtCompact, todayISO, addDays, daysBetween, fmtDate, fmtDateShort, fyOf, fyLabel, inFY, nextInvoiceNumber } from './calc.js'
import { buildInvoicePdf, shareFile, downloadFile } from './invoice.js'
import { buildWorkbook } from './excel.js'

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : 'id-' + Date.now().toString(36) + Math.random().toString(36).slice(2))
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`
const lsGet = (k) => { try { return localStorage.getItem('cit:ui:' + k) } catch { return null } }
const lsSet = (k, v) => { try { localStorage.setItem('cit:ui:' + k, v) } catch {} }
const stop = (ev) => ev.stopPropagation()

const STATUS = {
  quoted: { label: 'Quoted', tone: 'neutral' },
  wip: { label: 'In progress', tone: 'blue' },
  done: { label: 'Invoice pending', tone: 'amber' },
  invoiced: { label: 'Invoiced', tone: 'orange' },
  paid: { label: 'Paid', tone: 'green' },
  lost: { label: 'Lost', tone: 'muted' },
}
const STAGE_INDEX = { quoted: 0, wip: 1, done: 2, invoiced: 3, paid: 4 }
const STAGE_LABELS = ['Quote', 'Advance', 'Work done', 'Invoice', 'Paid']

// ---------- icons ----------
const svg = (d, size = 22) => html`<svg width=${size} height=${size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`
const Icon = {
  quotes: () => svg(html`<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>`),
  work: () => svg(html`<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>`),
  due: () => svg(html`<path d="M3 10h18M7 3v4M17 3v4"/><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M12 14v3"/>`),
  done: () => svg(html`<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>`),
  plus: () => svg(html`<path d="M12 5v14M5 12h14"/>`, 28),
  gear: () => svg(html`<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>`),
  close: () => svg(html`<path d="M18 6 6 18M6 6l12 12"/>`),
  share: () => svg(html`<path d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7M16 6l-4-4-4 4M12 2v13"/>`, 18),
  chat: () => svg(html`<path d="M21 12a8 8 0 0 1-11.6 7.1L4 21l1.9-5.4A8 8 0 1 1 21 12z"/>`, 18),
  file: () => svg(html`<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>`, 18),
  alert: () => svg(html`<path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/>`, 18),
  chevron: () => svg(html`<path d="m9 18 6-6-6-6"/>`, 18),
  sheet: () => svg(html`<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18"/>`, 18),
}

// ---------- hooks ----------
function useStore() {
  const [, force] = useState(0)
  // Layout effect: subscribes synchronously after mount, before anything can emit.
  useLayoutEffect(() => {
    const unsub = store.subscribe(() => force((n) => n + 1))
    if (store.getState().ready) force((n) => n + 1)
    return unsub
  }, [])
  return store.getState()
}

// Re-renders when the calendar date changes so countdowns tick over at midnight
// and whenever the app comes back to the foreground.
function useToday() {
  const [today, setToday] = useState(todayISO())
  useEffect(() => {
    const check = () => setToday(todayISO())
    const t = setInterval(check, 60_000)
    document.addEventListener('visibilitychange', check)
    return () => (clearInterval(t), document.removeEventListener('visibilitychange', check))
  }, [])
  return today
}

// ---------- toast ----------
let pushToast = () => {}
const toast = (msg) => pushToast(msg)
function Toaster() {
  const [t, setT] = useState(null)
  useEffect(() => { pushToast = (msg) => setT({ msg, k: Date.now() }) }, [])
  useEffect(() => {
    if (!t) return
    const h = setTimeout(() => setT(null), 2800)
    return () => clearTimeout(h)
  }, [t])
  return t ? html`<div class="toast" key=${t.k} role="status">${t.msg}</div>` : null
}

// ---------- actions ----------
const update = (e, patch) => store.saveEntry({ ...e, ...patch })
const actions = {
  recordAdvance(e, amount, date) {
    const payments = [...(e.payments || []), { id: uid(), kind: 'advance', amount: round2(amount), date }]
    return update(e, { status: 'wip', wipAt: date, payments })
  },
  markDone(e) {
    return update(e, { status: 'done', doneAt: todayISO() })
  },
  raiseInvoice(e, invoice, billing) {
    return update(e, { status: 'invoiced', invoice, billing })
  },
  recordPayment(e, amount, date) {
    const payments = [...(e.payments || []), { id: uid(), kind: 'balance', amount: round2(amount), date }]
    const next = { ...e, payments }
    const settled = calc(next).balance <= 0.5
    return update(next, settled ? { status: 'paid', paidAt: date } : {})
  },
  markLost(e) {
    return update(e, { status: 'lost', lostAt: todayISO(), prevStatus: e.status })
  },
  reopen(e) {
    return update(e, { status: e.prevStatus && e.prevStatus !== 'lost' ? e.prevStatus : 'quoted', lostAt: null })
  },
  undo(e) {
    switch (e.status) {
      case 'wip': return update(e, { status: 'quoted', wipAt: null, payments: (e.payments || []).filter((p) => p.kind !== 'advance') })
      case 'done': return update(e, { status: 'wip', doneAt: null })
      case 'invoiced': return update(e, { status: 'done', invoice: null })
      case 'paid': return update(e, { status: 'invoiced', paidAt: null, payments: (e.payments || []).slice(0, -1) })
    }
  },
  toggleVendorPaid(e) {
    return update(e, { vendorPaid: !e.vendorPaid, vendorPaidAt: e.vendorPaid ? null : todayISO() })
  },
}

// ---------- small UI pieces ----------
function Sheet({ title, onClose, children, footer }) {
  useEffect(() => {
    document.body.classList.add('noscroll')
    const onKey = (ev) => ev.key === 'Escape' && onClose()
    addEventListener('keydown', onKey)
    return () => (document.body.classList.remove('noscroll'), removeEventListener('keydown', onKey))
  }, [])
  return html`
    <div class="sheet-wrap" onClick=${(ev) => ev.target === ev.currentTarget && onClose()}>
      <div class="sheet" role="dialog" aria-modal="true" aria-label=${title}>
        <div class="sheet-head">
          <h2>${title}</h2>
          <button class="icon-btn" onClick=${onClose} aria-label="Close">${Icon.close()}</button>
        </div>
        <div class="sheet-body">${children}</div>
        ${footer && html`<div class="sheet-foot">${footer}</div>`}
      </div>
    </div>`
}

const Field = ({ label, hint, children, className = '' }) => html`
  <label class="field ${className}">
    <span class="field-label">${label}</span>
    ${children}
    ${hint && html`<span class="field-hint">${hint}</span>`}
  </label>`

const Toggle = ({ checked, onChange, label, sub }) => html`
  <label class="toggle-row">
    <span><span class="toggle-label">${label}</span>${sub && html`<span class="toggle-sub">${sub}</span>`}</span>
    <input type="checkbox" class="switch" checked=${checked} onChange=${(ev) => onChange(ev.target.checked)} />
  </label>`

const Chip = ({ active, onClick, children }) => html`
  <button type="button" class="chip ${active ? 'active' : ''}" onClick=${onClick}>${children}</button>`

const Badge = ({ status }) => html`<span class="badge tone-${STATUS[status]?.tone}">${STATUS[status]?.label}</span>`

function Breakdown({ e, compact }) {
  const c = calc(e)
  const rows = [
    ['Quote (excl. GST)', fmt(c.base)],
    e.gstOn && [`GST ${e.gstRate}%`, '+ ' + fmt(c.gst)],
    ['Invoice total', fmt(c.total), 'strong'],
    e.tdsOn && [`TDS ${e.tdsRate}% (client withholds)`, '− ' + fmt(c.tds)],
    ['You receive', fmt(c.net), 'strong accent'],
    !compact && [`${e.advancePct ?? 50}% advance`, fmt(c.advanceSuggested)],
    c.vendorCost > 0 && ['Vendor cost', '− ' + fmt(c.vendorCost)],
    c.vendorCost > 0 && ['Your margin (excl. GST)', fmt(c.margin), 'strong'],
  ].filter(Boolean)
  return html`<dl class="breakdown">
    ${rows.map(([k, v, cls]) => html`<div class="bd-row ${cls || ''}" key=${k}><dt>${k}</dt><dd>${v}</dd></div>`)}
  </dl>`
}

function StageTrack({ status }) {
  const idx = STAGE_INDEX[status] ?? -1
  return html`<ol class="stages ${status === 'lost' ? 'lost' : ''}">
    ${STAGE_LABELS.map((l, i) => html`<li key=${l} class=${i < idx ? 'past' : i === idx ? 'now' : ''}><span class="dot"></span><span class="lbl">${l}</span></li>`)}
  </ol>`
}

function Countdown({ e, today }) {
  const left = daysBetween(today, e.invoice.dueDate)
  const term = Math.max(1, daysBetween(e.invoice.date, e.invoice.dueDate))
  const pct = Math.min(100, Math.max(0, ((term - left) / term) * 100))
  const tone = left < 0 ? 'danger' : left <= 7 ? 'warn' : 'ok'
  const big = left < 0 ? Math.abs(left) : left
  const label = left < 0 ? `day${Math.abs(left) === 1 ? '' : 's'} overdue` : left === 0 ? 'due today' : `day${left === 1 ? '' : 's'} left`
  return html`<div class="countdown tone-${tone}">
    <div class="cd-num"><strong>${left === 0 ? '!' : big}</strong><span>${label}</span></div>
    <div class="cd-bar"><span style=${`width:${pct}%`}></span></div>
    <div class="cd-dates"><span>Invoiced ${fmtDateShort(e.invoice.date)}</span><span>Due ${fmtDateShort(e.invoice.dueDate)}</span></div>
  </div>`
}

function Card({ e, onOpen, children, accent, meta }) {
  const c = calc(e)
  return html`<article class="card ${accent || ''}" onClick=${onOpen} tabIndex="0" onKeyDown=${(ev) => ev.key === 'Enter' && ev.target === ev.currentTarget && onOpen()}>
    <div class="card-top">
      <div class="card-title">
        <h3>${e.client}</h3>
        <p>${[e.category, e.project].filter(Boolean).join(' · ')}</p>
      </div>
      <div class="card-amt">
        <strong>${fmt0(c.total)}</strong>
        <span>${e.gstOn ? `incl. ${e.gstRate}% GST` : 'no GST'}</span>
      </div>
    </div>
    ${meta && html`<div class="card-meta">${meta}</div>`}
    ${children && html`<div class="card-actions" onClick=${stop}>${children}</div>`}
  </article>`
}

const Empty = ({ title, text }) => html`<div class="empty"><strong>${title}</strong><p>${text}</p></div>`

// ---------- header ----------
function Header({ s, fy, setFy, today, onSettings }) {
  const { entries } = s
  const stats = useMemo(() => {
    let received = 0, count = 0, pending = 0, overdue = 0, invCount = 0
    const fys = new Set([fyOf(today)])
    for (const e of entries) {
      for (const p of e.payments || []) {
        fys.add(fyOf(p.date))
        if (inFY(p.date, fy)) (received += num(p.amount)), count++
      }
      if (e.quotedAt) fys.add(fyOf(e.quotedAt))
      if (e.status === 'invoiced') {
        const b = calc(e).balance
        pending += b
        invCount++
        if (daysBetween(today, e.invoice.dueDate) < 0) overdue += b
      }
    }
    return { received, count, pending, overdue, invCount, fys: [...fys].sort((a, b) => b - a) }
  }, [entries, fy, today])

  const syncLabel = s.mode === 'local' ? 'This device only' : s.syncError ? 'Not synced' : s.syncing ? 'Syncing…' : 'Synced'
  const syncTone = s.mode === 'local' ? 'muted' : s.syncError ? 'warn' : 'ok'

  return html`<header class="top">
    <div class="top-row">
      <label class="fy-pill">
        <select value=${fy} onChange=${(ev) => setFy(Number(ev.target.value))} aria-label="Financial year">
          ${stats.fys.map((y) => html`<option value=${y} key=${y}>${fyLabel(y)}</option>`)}
        </select>
        <span>${fyLabel(fy)}</span><span class="caret">▾</span>
      </label>
      <button class="sync sync-${syncTone}" onClick=${() => toast(s.syncError || syncLabel)} title=${s.syncError || syncLabel}>
        <span class="sync-dot"></span>${syncLabel}
      </button>
      <button class="icon-btn" onClick=${onSettings} aria-label="Settings">${Icon.gear()}</button>
    </div>
    <div class="counters">
      <div class="counter received">
        <span class="c-label">Received · ${fyLabel(fy).replace('FY ', '')}</span>
        <span class="c-value">${fmtCompact(stats.received)}</span>
        <span class="c-sub">${plural(stats.count, 'payment')}</span>
      </div>
      <div class="counter pending">
        <span class="c-label">Pending</span>
        <span class="c-value">${fmtCompact(stats.pending)}</span>
        <span class="c-sub ${stats.overdue > 0 ? 'danger' : ''}">${stats.overdue > 0 ? `${fmtCompact(stats.overdue)} overdue` : plural(stats.invCount, 'invoice')}</span>
      </div>
    </div>
  </header>`
}

// Surfaces urgent items on whichever tab you're on.
function HeadsUp({ entries, today, tab, setTab }) {
  const items = []
  const due = entries.filter((e) => e.status === 'invoiced')
  const overdue = due.filter((e) => daysBetween(today, e.invoice.dueDate) < 0).length
  const soon = due.filter((e) => { const d = daysBetween(today, e.invoice.dueDate); return d >= 0 && d <= 7 }).length
  const toInvoice = entries.filter((e) => e.status === 'done').length
  if (tab !== 'due' && overdue) items.push({ tone: 'danger', text: `${plural(overdue, 'payment')} overdue`, go: 'due' })
  if (tab !== 'due' && soon) items.push({ tone: 'warn', text: `${plural(soon, 'payment')} due this week`, go: 'due' })
  if (tab !== 'work' && toInvoice) items.push({ tone: 'warn', text: `${plural(toInvoice, 'invoice')} to raise`, go: 'work' })
  if (!items.length) return null
  return html`<div class="headsup">
    ${items.map((i) => html`<button class="hu tone-${i.tone}" key=${i.text} onClick=${() => setTab(i.go)}>${Icon.alert()}<span>${i.text}</span>${Icon.chevron()}</button>`)}
  </div>`
}

function InstallTip() {
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone
  const [hidden, setHidden] = useState(() => standalone || lsGet('installTip') === 'off')
  const [prompt, setPrompt] = useState(null)
  useEffect(() => {
    const h = (ev) => (ev.preventDefault(), setPrompt(ev))
    addEventListener('beforeinstallprompt', h)
    return () => removeEventListener('beforeinstallprompt', h)
  }, [])
  if (hidden) return null
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent)
  const dismiss = () => (lsSet('installTip', 'off'), setHidden(true))
  return html`<div class="install-tip">
    <div>
      <strong>Add to your home screen</strong>
      <p>${ios ? 'Tap the Share button, then “Add to Home Screen”.' : prompt ? 'Install it like an app for one-tap access.' : 'Use your browser menu → “Add to Home screen”.'}</p>
    </div>
    ${prompt && html`<button class="btn small primary" onClick=${async () => { prompt.prompt(); await prompt.userChoice; dismiss() }}>Install</button>`}
    <button class="icon-btn" onClick=${dismiss} aria-label="Dismiss">${Icon.close()}</button>
  </div>`
}

// ---------- tabs ----------
function QuotesTab({ entries, today, open }) {
  const list = entries.filter((e) => e.status === 'quoted').sort((a, b) => (b.quotedAt || '').localeCompare(a.quotedAt || ''))
  const total = list.reduce((s, e) => s + calc(e).total, 0)
  return html`<section>
    <div class="sec-head"><h2>Quotes</h2><span>${list.length ? `${list.length} open · ${fmt0(total)}` : ''}</span></div>
    ${list.length === 0 && html`<${Empty} title="No open quotes" text="Tap + to log a quote you've sent a client." />`}
    ${list.map((e) => {
      const c = calc(e)
      const age = daysBetween(e.quotedAt, today)
      return html`<${Card} key=${e.id} e=${e} onOpen=${() => open('detail', { id: e.id })}
        meta=${html`<span>Quoted ${fmtDateShort(e.quotedAt)}${age > 0 ? ` · ${age}d ago` : ''}</span><span>Advance ${fmt0(c.advanceSuggested)}</span>`}>
        <button class="btn primary grow" onClick=${() => open('advance', { id: e.id })}>Advance received → Start work</button>
      <//>`
    })}
  </section>`
}

function WorkTab({ entries, today, open }) {
  const done = entries.filter((e) => e.status === 'done').sort((a, b) => (a.doneAt || '').localeCompare(b.doneAt || ''))
  const wip = entries.filter((e) => e.status === 'wip').sort((a, b) => (a.wipAt || '').localeCompare(b.wipAt || ''))
  return html`<section>
    ${done.length > 0 && html`
      <div class="sec-head"><h2>Ready to invoice</h2><span>${done.length}</span></div>
      ${done.map((e) => html`<${Card} key=${e.id} e=${e} accent="accent-amber" onOpen=${() => open('detail', { id: e.id })}
          meta=${html`<span>Work done ${fmtDateShort(e.doneAt)}</span><span>Invoice not raised</span>`}>
          <button class="btn primary grow" onClick=${() => open('invoice', { id: e.id })}>${Icon.file()} Raise invoice</button>
        <//>`)}
    `}
    <div class="sec-head"><h2>Work in progress</h2><span>${wip.length || ''}</span></div>
    ${wip.length === 0 && html`<${Empty} title="Nothing in progress" text="Quotes move here once the 50% advance is in." />`}
    ${wip.map((e) => {
      const c = calc(e)
      const day = daysBetween(e.wipAt, today) + 1
      return html`<${Card} key=${e.id} e=${e} onOpen=${() => open('detail', { id: e.id })}
        meta=${html`<span>Started ${fmtDateShort(e.wipAt)} · day ${day}</span><span class="pos">Advance ${fmt0(c.advance)} ✓</span>`}>
        <button class="btn primary grow" onClick=${() => { actions.markDone(e); open('donePrompt', { id: e.id }) }}>Mark work done</button>
      <//>`
    })}
  </section>`
}

function reminderLink(e, today) {
  const c = calc(e)
  const left = daysBetween(today, e.invoice.dueDate)
  const when = left < 0 ? `was due on ${fmtDate(e.invoice.dueDate)}` : `is due on ${fmtDate(e.invoice.dueDate)}`
  const msg = `Hi ${e.client}, a gentle reminder that invoice ${e.invoice.number} (balance ${fmt(c.balance)}) ${when}. Thank you!`
  const phone = (e.clientPhone || '').replace(/\D/g, '')
  const to = phone ? (phone.length === 10 ? '91' + phone : phone) : ''
  return `https://wa.me/${to}?text=${encodeURIComponent(msg)}`
}

function DueTab({ entries, today, open }) {
  const list = entries.filter((e) => e.status === 'invoiced').sort((a, b) => a.invoice.dueDate.localeCompare(b.invoice.dueDate))
  const total = list.reduce((s, e) => s + calc(e).balance, 0)
  return html`<section>
    <div class="sec-head"><h2>Receivables</h2><span>${list.length ? `${list.length} · ${fmt0(total)} to collect` : ''}</span></div>
    ${list.length === 0 && html`<${Empty} title="All caught up" text="Raised invoices show here with a 30-day countdown." />`}
    ${list.map((e) => {
      const c = calc(e)
      return html`<${Card} key=${e.id} e=${e} onOpen=${() => open('detail', { id: e.id })}
        meta=${html`<span>${e.invoice.number}</span><span class="strong">Balance ${fmt0(c.balance)}</span>`}>
        <${Countdown} e=${e} today=${today} />
        <div class="btn-row">
          <button class="btn primary grow" onClick=${() => open('payment', { id: e.id })}>Payment received</button>
          <a class="btn ghost" href=${reminderLink(e, today)} target="_blank" rel="noopener" aria-label="Send WhatsApp reminder">${Icon.chat()}</a>
          <button class="btn ghost" onClick=${() => open('invoiceReady', { id: e.id })} aria-label="Invoice PDF">${Icon.file()}</button>
        </div>
      <//>`
    })}
  </section>`
}

// ---------- charts (plain HTML/CSS so they stay crisp and responsive) ----------
const FY_MONTHS = ['Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar']
const fyMonthIndex = (iso) => (Number(iso.slice(5, 7)) + 8) % 12
const WON = ['wip', 'done', 'invoiced', 'paid']
const jobDate = (e) => e.wipAt || e.quotedAt || ''

function fmtAxis(n) {
  if (n >= 1e7) return `₹${+(n / 1e7).toFixed(1)}Cr`
  if (n >= 1e5) return `₹${+(n / 1e5).toFixed(1)}L`
  if (n >= 1e3) return `₹${+(n / 1e3).toFixed(0)}K`
  return `₹${n}`
}
function niceMax(v) {
  if (v <= 0) return 1
  const p = 10 ** Math.floor(Math.log10(v))
  const n = v / p
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p
}

function analytics(entries, fy, today) {
  const received = Array(12).fill(0)
  const invoiced = Array(12).fill(0)
  const clients = new Map()
  const cats = new Map()
  const allTimeJobs = new Map()
  let quotes = 0, won = 0, lost = 0, invoicedJobs = 0, paidJobs = 0, paidDays = 0, paidCount = 0, wonValue = 0
  for (const e of entries) {
    const c = calc(e)
    for (const p of e.payments || []) if (inFY(p.date, fy)) received[fyMonthIndex(p.date)] += num(p.amount)
    if (e.invoice?.date && inFY(e.invoice.date, fy)) invoiced[fyMonthIndex(e.invoice.date)] += c.total
    if (WON.includes(e.status)) allTimeJobs.set(e.client, (allTimeJobs.get(e.client) || 0) + 1)
    if (inFY(e.quotedAt, fy)) {
      quotes++
      if (WON.includes(e.status)) won++
      if (e.status === 'lost') lost++
      if (e.invoice) invoicedJobs++
      if (e.status === 'paid') paidJobs++
    }
    if (WON.includes(e.status) && inFY(jobDate(e), fy)) {
      const cl = clients.get(e.client) || { name: e.client, value: 0, jobs: 0 }
      cl.value += c.base
      cl.jobs++
      clients.set(e.client, cl)
      const cat = e.category || 'Other'
      cats.set(cat, (cats.get(cat) || 0) + c.base)
      wonValue += c.base
    }
    if (e.status === 'paid' && inFY(e.paidAt, fy) && e.invoice?.date) {
      paidDays += Math.max(0, daysBetween(e.invoice.date, e.paidAt))
      paidCount++
    }
  }
  const clientList = [...clients.values()].map((c) => ({ ...c, repeat: (allTimeJobs.get(c.name) || 0) >= 2 })).sort((a, b) => b.value - a.value)
  const repeatValue = clientList.filter((c) => c.repeat).reduce((s, c) => s + c.value, 0)
  const curMonth = inFY(today, fy) ? fyMonthIndex(today) : 11
  return {
    received, invoiced, curMonth,
    clients: clientList,
    repeatCount: clientList.filter((c) => c.repeat).length,
    repeatShare: wonValue ? Math.round((repeatValue / wonValue) * 100) : 0,
    cats: [...cats.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value),
    funnel: { quotes, won, invoicedJobs, paidJobs },
    winRate: won + lost ? Math.round((won / (won + lost)) * 100) : null,
    avgDaysToPay: paidCount ? Math.round(paidDays / paidCount) : null,
    avgJob: won ? wonValue / won : 0,
    wonValue,
  }
}

function ColumnChart({ values, labels, upto }) {
  const [sel, setSel] = useState(null)
  const max = niceMax(Math.max(...values))
  let peak = -1
  values.forEach((v, i) => { if (v > 0 && (peak < 0 || v > values[peak])) peak = i })
  const show = sel ?? peak
  return html`<div class="colchart">
    <div class="cc-plot">
      ${[0, 0.5, 1].map((t) => html`<div class="cc-grid" key=${t} style=${`bottom:${t * 100}%`}><span>${fmtAxis(max * t)}</span></div>`)}
      <div class="cc-bars">
        ${values.map((v, i) => {
          const h = (v / max) * 100
          return html`<button key=${i} class="cc-col ${sel === i ? 'sel' : ''} ${v ? '' : 'empty-val'}" style=${`--h:${h}%;${i > upto ? 'opacity:.45' : ''}`}
              onClick=${() => setSel(sel === i ? null : i)} aria-label=${`${labels[i]}: ${fmt0(v)}`} title=${`${labels[i]}: ${fmt0(v)}`}>
            ${show === i && html`<span class="cc-tip">${fmtCompact(v)}</span>`}
            <span class="cc-bar" style=${`height:${h}%`}></span>
          </button>`
        })}
      </div>
    </div>
    <div class="cc-x">${labels.map((l, i) => html`<span key=${i}>${l}</span>`)}</div>
  </div>`
}

function BarList({ rows, empty }) {
  if (!rows.length) return html`<p class="chart-empty">${empty}</p>`
  const max = Math.max(...rows.map((r) => r.value)) || 1
  return html`<div class="barlist">
    ${rows.map((r) => html`<div key=${r.label}>
      <div class="bl-head"><span class="bl-label">${r.label}${r.tag && html`<span class="tag">${r.tag}</span>`}</span><span class="bl-val">${fmtCompact(r.value)}</span></div>
      <div class="bl-track"><span style=${`width:${Math.max(2, (r.value / max) * 100)}%`}></span></div>
      ${r.sub && html`<span class="bl-sub">${r.sub}</span>`}
    </div>`)}
  </div>`
}

function Insights({ entries, fy, today }) {
  const [series, setSeries] = useState('received')
  const a = useMemo(() => analytics(entries, fy, today), [entries, fy, today])
  const values = series === 'received' ? a.received : a.invoiced
  const total = values.reduce((s, v) => s + v, 0)
  const top = a.clients.slice(0, 6)
  const f = a.funnel
  return html`
    <div class="chart-card">
      <div class="chart-head">
        <div><h3>${series === 'received' ? 'Received' : 'Invoiced'} by month</h3><p>${fmt0(total)} in ${fyLabel(fy)} · tap a bar</p></div>
        <div class="seg">
          <button class=${series === 'received' ? 'on' : ''} onClick=${() => setSeries('received')}>Received</button>
          <button class=${series === 'invoiced' ? 'on' : ''} onClick=${() => setSeries('invoiced')}>Invoiced</button>
        </div>
      </div>
      <${ColumnChart} values=${values} labels=${FY_MONTHS} upto=${a.curMonth} />
    </div>

    <div class="stat-grid">
      <div class="stat"><span>Win rate</span><strong>${a.winRate == null ? '—' : a.winRate + '%'}</strong><em>quotes won vs lost</em></div>
      <div class="stat"><span>Avg. days to get paid</span><strong>${a.avgDaysToPay == null ? '—' : a.avgDaysToPay}</strong><em>invoice → final payment</em></div>
      <div class="stat"><span>Avg. job value</span><strong>${fmt0(a.avgJob)}</strong><em>excl. GST</em></div>
      <div class="stat"><span>Repeat clients</span><strong>${a.repeatCount}</strong><em>${a.repeatShare}% of work value</em></div>
    </div>

    <div class="chart-card" style="margin-top:12px">
      <div class="chart-head"><div><h3>Top clients</h3><p>Work value excl. GST · ${plural(a.clients.length, 'client')} this year</p></div></div>
      <${BarList} empty="Clients show up here once work starts."
        rows=${top.map((c) => ({ label: c.name, value: c.value, tag: c.repeat ? 'Repeat' : '', sub: plural(c.jobs, 'job') + ' this year' }))} />
    </div>

    <div class="chart-card">
      <div class="chart-head"><div><h3>Work by category</h3><p>Share of work value excl. GST</p></div></div>
      <${BarList} empty="No work started this year yet."
        rows=${a.cats.slice(0, 6).map((c) => ({ label: c.name, value: c.value, sub: a.wonValue ? `${Math.round((c.value / a.wonValue) * 100)}%` : '' }))} />
    </div>

    <div class="chart-card">
      <div class="chart-head"><div><h3>Pipeline</h3><p>Quotes sent this year and how far they got</p></div></div>
      <div class="funnel">
        <div style="--a:.06"><strong>${f.quotes}</strong><span>Quoted</span></div>
        <div style="--a:.12"><strong>${f.won}</strong><span>Won</span></div>
        <div style="--a:.18"><strong>${f.invoicedJobs}</strong><span>Invoiced</span></div>
        <div style="--a:.26"><strong>${f.paidJobs}</strong><span>Paid</span></div>
      </div>
    </div>`
}

async function exportExcel(entries) {
  try {
    toast('Preparing Excel file…')
    const file = await buildWorkbook(entries)
    await shareFile(file, 'Invoice tracker')
  } catch (err) {
    toast(err.message || String(err))
  }
}

function DoneTab({ entries, fy, open, today }) {
  const [showLost, setShowLost] = useState(false)
  const sum = useMemo(() => {
    let received = 0, invoiced = 0, gst = 0, tds = 0, vendor = 0, margin = 0, jobs = 0
    for (const e of entries) {
      for (const p of e.payments || []) if (inFY(p.date, fy)) received += num(p.amount)
      if (e.invoice && inFY(e.invoice.date, fy)) {
        const c = calc(e)
        invoiced += c.total; gst += c.gst; tds += c.tds; vendor += c.vendorCost; margin += c.margin; jobs++
      }
    }
    return { received, invoiced, gst, tds, vendor, margin, jobs }
  }, [entries, fy])
  const paid = entries.filter((e) => e.status === 'paid' && inFY(e.paidAt, fy)).sort((a, b) => b.paidAt.localeCompare(a.paidAt))
  const vendorsDue = entries.filter((e) => ['wip', 'done', 'invoiced', 'paid'].includes(e.status) && num(e.vendorCost) > 0 && !e.vendorPaid)
  const lost = entries.filter((e) => e.status === 'lost')

  return html`<section>
    <div class="sec-head"><h2>${fyLabel(fy)}</h2><span>${plural(sum.jobs, 'job')} invoiced</span></div>
    <div class="stat-grid">
      <div class="stat hero"><span>Received this year</span><strong>${fmt0(sum.received)}</strong><em>of ${fmt0(sum.invoiced)} invoiced</em></div>
      <div class="stat"><span>GST collected</span><strong>${fmt0(sum.gst)}</strong></div>
      <div class="stat"><span>TDS deducted</span><strong>${fmt0(sum.tds)}</strong></div>
      <div class="stat"><span>Vendor costs</span><strong>${fmt0(sum.vendor)}</strong></div>
      <div class="stat"><span>Your margin</span><strong>${fmt0(sum.margin)}</strong></div>
    </div>
    <div class="done-tools">
      <button class="btn ghost grow" onClick=${() => exportExcel(entries)}>${Icon.sheet()} Download Excel</button>
    </div>

    <div class="sec-head"><h2>Insights</h2><span>${fyLabel(fy)}</span></div>
    <${Insights} entries=${entries} fy=${fy} today=${today} />

    ${vendorsDue.length > 0 && html`
      <div class="sec-head"><h2>Vendors to pay</h2><span>${fmt0(vendorsDue.reduce((s, e) => s + num(e.vendorCost), 0))}</span></div>
      <div class="list">
        ${vendorsDue.map((e) => html`<div class="list-row" key=${e.id}>
          <div><strong>${e.vendor || 'Vendor'}</strong><span>${e.client} · ${STATUS[e.status].label}</span></div>
          <div class="list-end"><strong>${fmt0(e.vendorCost)}</strong>
            <button class="btn small" onClick=${() => (actions.toggleVendorPaid(e), toast(`Marked ${e.vendor || 'vendor'} as paid`))}>Mark paid</button></div>
        </div>`)}
      </div>`}

    <div class="sec-head"><h2>Completed</h2><span>${paid.length || ''}</span></div>
    ${paid.length === 0 && html`<${Empty} title="Nothing completed yet" text="Jobs land here once the final payment is in." />`}
    ${paid.map((e) => html`<${Card} key=${e.id} e=${e} accent="accent-green" onOpen=${() => open('detail', { id: e.id })}
      meta=${html`<span>Paid ${fmtDateShort(e.paidAt)}</span><span class="pos">${fmt0(calc(e).received)} received</span>`} />`)}

    ${lost.length > 0 && html`
      <button class="link-btn" onClick=${() => setShowLost(!showLost)}>${showLost ? 'Hide' : 'Show'} lost quotes (${lost.length})</button>
      ${showLost && lost.map((e) => html`<${Card} key=${e.id} e=${e} accent="accent-muted" onOpen=${() => open('detail', { id: e.id })} meta=${html`<span>Lost ${fmtDateShort(e.lostAt)}</span>`} />`)}`}
  </section>`
}

// ---------- sheets ----------
function EntryForm({ entry, close }) {
  const { settings, entries } = store.getState()
  const isEdit = !!entry
  const [f, setF] = useState(() => entry
    ? { ...entry, billing: { gstin: '', address: '', state: '', ...(entry.billing || {}) } }
    : {
        client: '', clientPhone: '', project: '', vendor: '', vendorCost: '', category: settings.categories[0]?.name || '',
        amount: '', gstOn: true, gstRate: settings.gstRate, tdsOn: true, tdsRate: settings.tdsRate,
        advancePct: settings.advancePct, notes: '', quotedAt: todayISO(), billing: { gstin: '', address: '', state: '' },
      })
  const [showBilling, setShowBilling] = useState(!!(f.billing.gstin || f.billing.address))
  const catNames = settings.categories.map((c) => c.name)
  const [customCat, setCustomCat] = useState(!!f.category && !catNames.includes(f.category))
  const set = (k) => (ev) => setF((p) => ({ ...p, [k]: ev.target.value }))
  const setVal = (k, v) => setF((p) => ({ ...p, [k]: v }))
  const setB = (k) => (ev) => setF((p) => ({ ...p, billing: { ...p.billing, [k]: ev.target.value } }))
  const clients = [...new Set(entries.map((e) => e.client).filter(Boolean))]
  const vendors = [...new Set(entries.map((e) => e.vendor).filter(Boolean))]
  const c = calc(f)
  const valid = f.client.trim() && num(f.amount) > 0

  // Picking a known client pre-fills their billing details from the latest job.
  const onClient = (ev) => {
    const name = ev.target.value
    setF((p) => {
      const prev = entries.filter((e) => e.client === name).sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))[0]
      if (!prev || p.billing.gstin || p.billing.address) return { ...p, client: name }
      if (prev.billing?.gstin || prev.billing?.address) setShowBilling(true)
      return { ...p, client: name, clientPhone: p.clientPhone || prev.clientPhone || '', billing: { ...p.billing, ...(prev.billing || {}) } }
    })
  }

  const save = () => {
    if (!valid) return
    const e = {
      ...f,
      client: f.client.trim(), project: f.project.trim(), vendor: f.vendor.trim(),
      amount: num(f.amount), vendorCost: num(f.vendorCost), gstRate: num(f.gstRate), tdsRate: num(f.tdsRate), advancePct: num(f.advancePct),
    }
    if (!isEdit) Object.assign(e, { id: uid(), status: 'quoted', payments: [], createdAt: new Date().toISOString() })
    store.saveEntry(e)
    toast(isEdit ? 'Saved' : `Quote for ${e.client} added`)
    close()
  }

  return html`<${Sheet} title=${isEdit ? 'Edit entry' : 'New quote'} onClose=${close}
    footer=${html`<button class="btn primary block" disabled=${!valid} onClick=${save}>${isEdit ? 'Save changes' : 'Save quote'}</button>`}>
    <form class="form" onSubmit=${(ev) => (ev.preventDefault(), save())}>
      <${Field} label="Client">
        <input value=${f.client} onInput=${onClient} list="dl-clients" placeholder="Client or company name" autocomplete="off" required />
        <datalist id="dl-clients">${clients.map((n) => html`<option value=${n} key=${n} />`)}</datalist>
      <//>
      <${Field} label="Project" hint="Shown on the invoice line item">
        <input value=${f.project} onInput=${set('project')} placeholder="e.g. Diwali campaign reel ×3" />
      <//>
      <div class="field">
        <span class="field-label">Category</span>
        <div class="chips">
          ${catNames.map((n) => html`<${Chip} key=${n} active=${!customCat && f.category === n} onClick=${() => (setCustomCat(false), setVal('category', n))}>${n}<//>`)}
          <${Chip} active=${customCat} onClick=${() => (setCustomCat(true), setVal('category', ''))}>Other…<//>
        </div>
        ${customCat && html`<input value=${f.category} onInput=${set('category')} placeholder="Category" />`}
      </div>
      <div class="grid2">
        <${Field} label="Quote amount (₹)" hint="Before GST">
          <input class="money" inputMode="decimal" value=${f.amount} onInput=${set('amount')} placeholder="0" />
        <//>
        <${Field} label="Quote date">
          <input type="date" value=${f.quotedAt} onInput=${set('quotedAt')} />
        <//>
      </div>

      <div class="group">
        <${Toggle} label="GST" sub="Added on top of the quote" checked=${f.gstOn} onChange=${(v) => setVal('gstOn', v)} />
        ${f.gstOn && html`<div class="inline-rate"><span>Rate</span><input inputMode="decimal" value=${f.gstRate} onInput=${set('gstRate')} /><span>%</span></div>`}
        <${Toggle} label="TDS" sub="Client deducts this from payment" checked=${f.tdsOn} onChange=${(v) => setVal('tdsOn', v)} />
        ${f.tdsOn && html`<div class="inline-rate">
          <${Chip} active=${num(f.tdsRate) === 1} onClick=${() => setVal('tdsRate', 1)}>1%<//>
          <${Chip} active=${num(f.tdsRate) === 10} onClick=${() => setVal('tdsRate', 10)}>10%<//>
          <input inputMode="decimal" value=${f.tdsRate} onInput=${set('tdsRate')} aria-label="TDS rate" /><span>%</span>
        </div>`}
        <div class="inline-rate"><span>Advance before work starts</span><input inputMode="decimal" value=${f.advancePct} onInput=${set('advancePct')} /><span>%</span></div>
      </div>

      <div class="grid2">
        <${Field} label="Vendor / subcontractor">
          <input value=${f.vendor} onInput=${set('vendor')} list="dl-vendors" placeholder="Optional" autocomplete="off" />
          <datalist id="dl-vendors">${vendors.map((n) => html`<option value=${n} key=${n} />`)}</datalist>
        <//>
        <${Field} label="Vendor cost (₹)" hint="What you pay them">
          <input class="money" inputMode="decimal" value=${f.vendorCost} onInput=${set('vendorCost')} placeholder="0" />
        <//>
      </div>

      ${num(f.amount) > 0 && html`<${Breakdown} e=${f} />`}

      <button type="button" class="link-btn" onClick=${() => setShowBilling(!showBilling)}>${showBilling ? '− Hide' : '+ Add'} client billing details (for invoice)</button>
      ${showBilling && html`<div class="group pad">
        <${Field} label="Client GSTIN"><input value=${f.billing.gstin} onInput=${setB('gstin')} placeholder="Optional" autocapitalize="characters" /><//>
        <${Field} label="Billing address"><textarea rows="2" value=${f.billing.address} onInput=${setB('address')} /><//>
        <div class="grid2">
          <${Field} label="State" hint="Same state → CGST+SGST"><input value=${f.billing.state} onInput=${setB('state')} placeholder=${settings.business.state || 'e.g. Delhi'} /><//>
          <${Field} label="WhatsApp no."><input type="tel" value=${f.clientPhone} onInput=${set('clientPhone')} placeholder="For reminders" /><//>
        </div>
      </div>`}
      <${Field} label="Notes"><textarea rows="2" value=${f.notes} onInput=${set('notes')} placeholder="Deliverables, revisions, links…" /><//>
    </form>
  <//>`
}

function AdvanceSheet({ e, close }) {
  const c = calc(e)
  const [amt, setAmt] = useState(String(c.advanceSuggested))
  const [date, setDate] = useState(todayISO())
  const pct = (p) => String(Math.round((c.net * p) / 100))
  const go = () => {
    actions.recordAdvance(e, num(amt), date)
    toast(`${e.client} moved to Work in progress`)
    close()
  }
  return html`<${Sheet} title="Advance received" onClose=${close}
    footer=${html`<button class="btn primary block" disabled=${num(amt) < 0} onClick=${go}>Start work</button>`}>
    <p class="lead">${e.client}${e.project ? ` · ${e.project}` : ''}</p>
    <div class="chips">
      ${[25, 50, 100].map((p) => html`<${Chip} key=${p} active=${amt === pct(p)} onClick=${() => setAmt(pct(p))}>${p}%<//>`)}
    </div>
    <div class="grid2">
      <${Field} label="Amount received (₹)"><input class="money" inputMode="decimal" value=${amt} onInput=${(ev) => setAmt(ev.target.value)} /><//>
      <${Field} label="Date"><input type="date" value=${date} onInput=${(ev) => setDate(ev.target.value)} /><//>
    </div>
    <p class="hint">You'll receive ${fmt(c.net)} in total${e.tdsOn ? ` after ${fmt(c.tds)} TDS` : ''}. Balance after this: <strong>${fmt(Math.max(0, c.net - num(amt)))}</strong></p>
  <//>`
}

function DonePrompt({ e, open, close }) {
  return html`<${Sheet} title="Work done 🎉" onClose=${close}>
    <div class="prompt">
      <p class="lead">${e.client}${e.project ? ` · ${e.project}` : ''}</p>
      <p>Raise the invoice now to start the ${store.getState().settings.paymentTermsDays}-day payment countdown.</p>
      <button class="btn primary block" onClick=${() => open('invoice', { id: e.id })}>${Icon.file()} Raise invoice now</button>
      <button class="btn ghost block" onClick=${() => (toast('Saved under “Ready to invoice”'), close())}>Later</button>
    </div>
  <//>`
}

function InvoiceSheet({ e, open, close }) {
  const { settings, entries } = store.getState()
  const cat = settings.categories.find((x) => x.name === e.category)
  const [date, setDate] = useState(todayISO())
  const [no, setNo] = useState(() => nextInvoiceNumber(entries, settings.invoicePrefix, fyOf(todayISO())))
  const [noTouched, setNoTouched] = useState(false)
  const [terms, setTerms] = useState(String(settings.paymentTermsDays))
  const [sac, setSac] = useState(cat?.sac || '')
  const [b, setBill] = useState({ gstin: '', address: '', state: settings.business.state || '', ...(e.billing || {}) })
  const setB = (k) => (ev) => setBill((p) => ({ ...p, [k]: ev.target.value }))
  useEffect(() => { if (!noTouched) setNo(nextInvoiceNumber(entries, settings.invoicePrefix, fyOf(date))) }, [date])
  const due = addDays(date, num(terms))
  const dup = entries.some((x) => x.id !== e.id && x.invoice?.number === no.trim())
  const missingBiz = !settings.business.name
  const raise = () => {
    actions.raiseInvoice(e, { number: no.trim(), date, dueDate: due, sac: sac.trim(), terms: num(terms) }, b)
    open('invoiceReady', { id: e.id, fresh: true })
  }
  return html`<${Sheet} title="Raise invoice" onClose=${close}
    footer=${html`<button class="btn primary block" disabled=${!no.trim() || dup} onClick=${raise}>Raise invoice & create PDF</button>`}>
    ${missingBiz && html`<div class="notice warn">${Icon.alert()}<span>Your business name, GSTIN and bank details aren't set yet. <button class="link-btn inline" onClick=${() => open('settings', { back: { type: 'invoice', id: e.id } })}>Add them in Settings</button></span></div>`}
    <p class="lead">${e.client} · ${fmt(calc(e).total)}</p>
    <div class="grid2">
      <${Field} label="Invoice no." hint=${dup ? 'Already used on another invoice' : ''} className=${dup ? 'error' : ''}>
        <input value=${no} onInput=${(ev) => (setNo(ev.target.value), setNoTouched(true))} />
      <//>
      <${Field} label="Invoice date"><input type="date" value=${date} onInput=${(ev) => setDate(ev.target.value)} /><//>
    </div>
    <div class="grid2">
      <${Field} label="Payment terms (days)" hint=${`Due ${fmtDate(due)}`}><input inputMode="numeric" value=${terms} onInput=${(ev) => setTerms(ev.target.value)} /><//>
      <${Field} label="SAC code"><input inputMode="numeric" value=${sac} onInput=${(ev) => setSac(ev.target.value)} /><//>
    </div>
    <div class="group pad">
      <${Field} label="Client GSTIN"><input value=${b.gstin} onInput=${setB('gstin')} placeholder="Optional" autocapitalize="characters" /><//>
      <${Field} label="Billing address"><textarea rows="2" value=${b.address} onInput=${setB('address')} /><//>
      <${Field} label="Client state (place of supply)" hint=${settings.business.state ? `Same as yours (${settings.business.state}) → CGST + SGST, otherwise IGST` : 'Set your own state in Settings to split CGST/SGST'}>
        <input value=${b.state} onInput=${setB('state')} />
      <//>
    </div>
    <${Breakdown} e=${e} compact />
  <//>`
}

function InvoiceReady({ e, fresh, close }) {
  const { settings } = store.getState()
  const [file, setFile] = useState(null)
  const [err, setErr] = useState(null)
  useEffect(() => { buildInvoicePdf(e, settings).then(setFile).catch((x) => setErr(x.message || String(x))) }, [])
  const preview = () => window.open(URL.createObjectURL(file), '_blank')
  return html`<${Sheet} title=${fresh ? 'Invoice raised' : 'Invoice PDF'} onClose=${close}>
    <div class="prompt">
      ${fresh && html`<div class="success-mark">${Icon.done()}</div>`}
      <p class="lead">${e.invoice.number} · ${e.client}</p>
      <p>${fresh ? `The countdown has started. Payment is due on ` : 'Due '}<strong>${fmtDate(e.invoice.dueDate)}</strong>.</p>
      ${err && html`<div class="notice warn">${Icon.alert()}<span>${err}</span></div>`}
      ${!file && !err && html`<p class="hint">Creating PDF…</p>`}
      <button class="btn primary block" disabled=${!file} onClick=${() => shareFile(file, e.invoice.number)}>${Icon.share()} Share PDF</button>
      <div class="btn-row">
        <button class="btn ghost grow" disabled=${!file} onClick=${preview}>Preview</button>
        <button class="btn ghost grow" disabled=${!file} onClick=${() => downloadFile(file)}>Download</button>
      </div>
      <button class="link-btn" onClick=${close}>Done</button>
    </div>
  <//>`
}

function PaymentSheet({ e, close }) {
  const c = calc(e)
  const [amt, setAmt] = useState(String(c.balance))
  const [date, setDate] = useState(todayISO())
  const after = Math.max(0, round2(c.balance - num(amt)))
  const completes = after <= 0.5
  const go = () => {
    actions.recordPayment(e, num(amt), date)
    toast(completes ? `🎉 ${e.client} completed — ${fmt0(c.received + num(amt))} received` : `${fmt0(num(amt))} recorded · ${fmt0(after)} still due`)
    close()
  }
  return html`<${Sheet} title="Payment received" onClose=${close}
    footer=${html`<button class="btn primary block" disabled=${num(amt) <= 0} onClick=${go}>${completes ? 'Mark paid & complete' : 'Record part payment'}</button>`}>
    <p class="lead">${e.client} · ${e.invoice?.number}</p>
    <div class="grid2">
      <${Field} label="Amount (₹)"><input class="money" inputMode="decimal" value=${amt} onInput=${(ev) => setAmt(ev.target.value)} /><//>
      <${Field} label="Date"><input type="date" value=${date} onInput=${(ev) => setDate(ev.target.value)} /><//>
    </div>
    <dl class="breakdown">
      <div class="bd-row"><dt>Invoice total</dt><dd>${fmt(c.total)}</dd></div>
      ${e.tdsOn && html`<div class="bd-row"><dt>TDS withheld by client</dt><dd>− ${fmt(c.tds)}</dd></div>`}
      <div class="bd-row"><dt>Received so far</dt><dd>− ${fmt(c.received)}</dd></div>
      <div class="bd-row strong"><dt>Balance expected</dt><dd>${fmt(c.balance)}</dd></div>
      ${!completes && html`<div class="bd-row"><dt>Still due after this</dt><dd>${fmt(after)}</dd></div>`}
    </dl>
  <//>`
}

function Detail({ e, open, close }) {
  const c = calc(e)
  const next = {
    quoted: html`<button class="btn primary block" onClick=${() => open('advance', { id: e.id })}>Advance received → Start work</button>`,
    wip: html`<button class="btn primary block" onClick=${() => { actions.markDone(e); open('donePrompt', { id: e.id }) }}>Mark work done</button>`,
    done: html`<button class="btn primary block" onClick=${() => open('invoice', { id: e.id })}>Raise invoice</button>`,
    invoiced: html`<button class="btn primary block" onClick=${() => open('payment', { id: e.id })}>Payment received</button>`,
  }[e.status]
  const timeline = [
    ['Quoted', e.quotedAt],
    ...(e.payments || []).map((p) => [p.kind === 'advance' ? `Advance ${fmt0(p.amount)}` : `Payment ${fmt0(p.amount)}`, p.date]),
    e.wipAt && ['Work started', e.wipAt],
    e.doneAt && ['Work done', e.doneAt],
    e.invoice && [`Invoice ${e.invoice.number}`, e.invoice.date],
    e.invoice && e.status === 'invoiced' && ['Payment due', e.invoice.dueDate],
    e.paidAt && ['Completed', e.paidAt],
    e.lostAt && ['Marked lost', e.lostAt],
  ].filter((x) => x && x[1]).sort((a, b) => a[1].localeCompare(b[1]))

  const del = () => {
    if (!confirm(`Delete ${e.client}${e.project ? ` · ${e.project}` : ''}? This can't be undone.`)) return
    store.deleteEntry(e.id)
    toast('Deleted')
    close()
  }

  return html`<${Sheet} title=${e.client} onClose=${close} footer=${next}>
    <div class="detail-head">
      <${Badge} status=${e.status} />
      <span class="muted">${[e.category, e.project].filter(Boolean).join(' · ')}</span>
    </div>
    <${StageTrack} status=${e.status} />
    ${e.status === 'invoiced' && html`<${Countdown} e=${e} today=${todayISO()} />`}
    <${Breakdown} e=${e} />
    ${c.received > 0 && html`<dl class="breakdown">
      <div class="bd-row"><dt>Received so far</dt><dd class="pos">${fmt(c.received)}</dd></div>
      <div class="bd-row strong"><dt>Balance</dt><dd>${fmt(c.balance)}</dd></div>
    </dl>`}

    ${e.vendor && html`<div class="group pad vendor-box">
      <div><span class="field-label">Vendor</span><strong>${e.vendor}</strong><span class="muted">${c.vendorCost ? fmt(c.vendorCost) : 'No cost set'}</span></div>
      ${c.vendorCost > 0 && html`<${Toggle} label=${e.vendorPaid ? `Paid ${fmtDateShort(e.vendorPaidAt)}` : 'Not paid yet'} checked=${!!e.vendorPaid} onChange=${() => actions.toggleVendorPaid(e)} />`}
    </div>`}

    <h3 class="sub">Timeline</h3>
    <ol class="timeline">${timeline.map(([l, d], i) => html`<li key=${i}><span>${l}</span><time>${fmtDate(d)}</time></li>`)}</ol>
    ${e.notes && html`<h3 class="sub">Notes</h3><p class="notes">${e.notes}</p>`}

    <div class="detail-actions">
      ${e.invoice && html`<button class="btn ghost" onClick=${() => open('invoiceReady', { id: e.id })}>${Icon.file()} Invoice PDF</button>`}
      <button class="btn ghost" onClick=${() => open('edit', { id: e.id })}>Edit</button>
      ${STAGE_INDEX[e.status] > 0 && html`<button class="btn ghost" onClick=${() => (actions.undo(e), toast('Moved back one step'))}>Undo last step</button>`}
      ${e.status === 'quoted' && html`<button class="btn ghost" onClick=${() => (actions.markLost(e), toast('Marked as lost'), close())}>Mark lost</button>`}
      ${e.status === 'lost' && html`<button class="btn ghost" onClick=${() => (actions.reopen(e), toast('Reopened'))}>Reopen</button>`}
      <button class="btn ghost danger" onClick=${del}>Delete</button>
    </div>
  <//>`
}

function SettingsSheet({ close, back, open }) {
  const s = store.getState()
  const [f, setF] = useState(() => structuredClone(s.settings))
  const [cats, setCats] = useState(() => s.settings.categories.map((c) => (c.sac ? `${c.name} | ${c.sac}` : c.name)).join('\n'))
  const fileRef = useRef()
  const setIn = (group, k) => (ev) => setF((p) => ({ ...p, [group]: { ...p[group], [k]: ev.target.value } }))
  const set = (k) => (ev) => setF((p) => ({ ...p, [k]: ev.target.value }))
  const save = () => {
    const categories = cats.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
      const [name, sac] = l.split('|').map((x) => x.trim())
      return { name, sac: sac || '' }
    })
    store.saveSettings({
      ...f, categories,
      paymentTermsDays: num(f.paymentTermsDays) || 30, gstRate: num(f.gstRate), tdsRate: num(f.tdsRate), advancePct: num(f.advancePct),
      invoicePrefix: (f.invoicePrefix || 'INV').trim(),
    })
    toast('Settings saved')
    back ? open(back.type, { id: back.id }) : close()
  }
  const exportData = () => {
    const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), entries: s.entries, settings: s.settings }, null, 2)], { type: 'application/json' })
    downloadFile(new File([blob], `invoice-tracker-backup-${todayISO()}.json`, { type: 'application/json' }))
  }
  const importData = async (ev) => {
    const file = ev.target.files[0]
    if (!file) return
    try {
      const data = JSON.parse(await file.text())
      if (!Array.isArray(data.entries)) throw new Error('Not a backup file')
      if (!confirm(`Import ${data.entries.length} entries? Entries with the same ID will be overwritten.`)) return
      store.importData(data)
      toast(`Imported ${data.entries.length} entries`)
      close()
    } catch (err) {
      alert('Import failed: ' + err.message)
    }
    ev.target.value = ''
  }
  const b = f.business, k = f.bank
  return html`<${Sheet} title="Settings" onClose=${close} footer=${html`<button class="btn primary block" onClick=${save}>Save settings</button>`}>
    <form class="form" onSubmit=${(ev) => (ev.preventDefault(), save())}>
      <h3 class="sub">Your business (on invoices)</h3>
      <${Field} label="Business / trade name"><input value=${b.name} onInput=${setIn('business', 'name')} /><//>
      <${Field} label="Address"><textarea rows="2" value=${b.address} onInput=${setIn('business', 'address')} /><//>
      <div class="grid2">
        <${Field} label="State"><input value=${b.state} onInput=${setIn('business', 'state')} placeholder="e.g. Delhi" /><//>
        <${Field} label="GSTIN"><input value=${b.gstin} onInput=${setIn('business', 'gstin')} autocapitalize="characters" /><//>
      </div>
      <div class="grid2">
        <${Field} label="PAN"><input value=${b.pan} onInput=${setIn('business', 'pan')} autocapitalize="characters" /><//>
        <${Field} label="Phone"><input type="tel" value=${b.phone} onInput=${setIn('business', 'phone')} /><//>
      </div>
      <${Field} label="Email"><input type="email" value=${b.email} onInput=${setIn('business', 'email')} /><//>

      <h3 class="sub">Bank details (on invoices)</h3>
      <${Field} label="Account name"><input value=${k.accountName} onInput=${setIn('bank', 'accountName')} /><//>
      <div class="grid2">
        <${Field} label="Bank"><input value=${k.bankName} onInput=${setIn('bank', 'bankName')} /><//>
        <${Field} label="IFSC"><input value=${k.ifsc} onInput=${setIn('bank', 'ifsc')} autocapitalize="characters" /><//>
      </div>
      <${Field} label="Account number"><input inputMode="numeric" value=${k.accountNo} onInput=${setIn('bank', 'accountNo')} /><//>
      <${Field} label="UPI ID"><input value=${k.upi} onInput=${setIn('bank', 'upi')} /><//>

      <h3 class="sub">Defaults</h3>
      <div class="grid2">
        <${Field} label="Invoice prefix" hint=${`e.g. ${f.invoicePrefix || 'INV'}/26-27/001`}><input value=${f.invoicePrefix} onInput=${set('invoicePrefix')} /><//>
        <${Field} label="Payment terms (days)"><input inputMode="numeric" value=${f.paymentTermsDays} onInput=${set('paymentTermsDays')} /><//>
      </div>
      <div class="grid3">
        <${Field} label="GST %"><input inputMode="decimal" value=${f.gstRate} onInput=${set('gstRate')} /><//>
        <${Field} label="TDS %"><input inputMode="decimal" value=${f.tdsRate} onInput=${set('tdsRate')} /><//>
        <${Field} label="Advance %"><input inputMode="decimal" value=${f.advancePct} onInput=${set('advancePct')} /><//>
      </div>
      <${Field} label="Categories" hint="One per line as “Name | SAC code”. Check SAC codes with your CA.">
        <textarea rows="6" value=${cats} onInput=${(ev) => setCats(ev.target.value)} />
      <//>

      <h3 class="sub">Data</h3>
      <div class="btn-row">
        <button type="button" class="btn ghost grow" onClick=${() => exportExcel(s.entries)}>Excel</button>
        <button type="button" class="btn ghost grow" onClick=${exportData}>Export backup</button>
        <button type="button" class="btn ghost grow" onClick=${() => fileRef.current.click()}>Import backup</button>
        <input ref=${fileRef} type="file" accept="application/json,.json" hidden onChange=${importData} />
      </div>
      ${s.mode === 'cloud'
        ? html`<div class="account"><span>Signed in as <strong>${s.user?.email}</strong></span>
            <button type="button" class="btn ghost danger" onClick=${async () => { if (confirm('Sign out?')) { await store.signOut(); close() } }}>Sign out</button></div>`
        : html`<p class="hint">Data is saved on this device only. Add your Supabase keys to <code>config.js</code> to sync and back up to the cloud.</p>`}
    </form>
  <//>`
}

function SheetRouter({ sheet, open, close }) {
  const { entries } = store.getState()
  const e = sheet.id ? entries.find((x) => x.id === sheet.id) : null
  if (sheet.id && !e) return null
  const p = { e, open, close, ...sheet }
  switch (sheet.type) {
    case 'new': return html`<${EntryForm} close=${close} />`
    case 'edit': return html`<${EntryForm} entry=${e} close=${() => open('detail', { id: e.id })} />`
    case 'detail': return html`<${Detail} key=${e.id} ...${p} />`
    case 'advance': return html`<${AdvanceSheet} ...${p} />`
    case 'donePrompt': return html`<${DonePrompt} ...${p} />`
    case 'invoice': return html`<${InvoiceSheet} ...${p} />`
    case 'invoiceReady': return html`<${InvoiceReady} ...${p} />`
    case 'payment': return html`<${PaymentSheet} ...${p} />`
    case 'settings': return html`<${SettingsSheet} ...${p} />`
  }
  return null
}

// ---------- login ----------
function Login() {
  const [mode, setMode] = useState('signin')
  const [email, setEmail] = useState(localStorage.getItem('cit:lastEmail') || '')
  const [pw, setPw] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  const submit = async (ev) => {
    ev.preventDefault()
    setBusy(true)
    setMsg(null)
    try {
      if (mode === 'signin') await store.signIn(email.trim(), pw)
      else {
        const { needsConfirm } = await store.signUp(email.trim(), pw)
        if (needsConfirm) setMsg({ ok: true, text: 'Account created. Check your email to confirm, then sign in.' })
      }
    } catch (err) {
      setMsg({ ok: false, text: err.message || String(err) })
    }
    setBusy(false)
  }
  return html`<div class="login">
    <div class="login-card glass">
      <img src="icons/icon-192.png" alt="" width="64" height="64" />
      <h1>Invoice Tracker</h1>
      <p class="muted">Quotes → advance → work → invoice → paid.</p>
      <form class="form" onSubmit=${submit}>
        <${Field} label="Email"><input type="email" autocomplete="email" value=${email} onInput=${(ev) => setEmail(ev.target.value)} required /><//>
        <${Field} label="Password"><input type="password" autocomplete=${mode === 'signin' ? 'current-password' : 'new-password'} minlength="6" value=${pw} onInput=${(ev) => setPw(ev.target.value)} required /><//>
        ${msg && html`<div class="notice ${msg.ok ? 'ok' : 'warn'}"><span>${msg.text}</span></div>`}
        <button class="btn primary block" disabled=${busy}>${busy ? 'Please wait…' : mode === 'signin' ? 'Sign in' : 'Create account'}</button>
      </form>
      <button class="link-btn" onClick=${() => (setMode(mode === 'signin' ? 'signup' : 'signin'), setMsg(null))}>
        ${mode === 'signin' ? 'First time? Create your account' : 'Have an account? Sign in'}
      </button>
    </div>
  </div>`
}

// ---------- app ----------
const TABS = [
  { id: 'quotes', label: 'Quotes', icon: Icon.quotes },
  { id: 'work', label: 'Work', icon: Icon.work },
  { id: 'due', label: 'Due', icon: Icon.due },
  { id: 'done', label: 'Done', icon: Icon.done },
]

function App() {
  const s = useStore()
  const today = useToday()
  const [tab, setTabState] = useState(() => lsGet('tab') || 'quotes')
  const [sheet, setSheet] = useState(null)
  const [fy, setFy] = useState(() => fyOf(todayISO()))
  const setTab = (t) => (setTabState(t), lsSet('tab', t), scrollTo({ top: 0 }))
  const open = (type, props = {}) => setSheet({ type, ...props })
  const close = () => setSheet(null)

  if (!s.ready) return html`<div class="splash"><img src="icons/icon-192.png" alt="" width="72" height="72" /></div>`
  if (s.mode === 'cloud' && !s.user) return html`<${Login} /><${Toaster} />`

  const { entries } = s
  const badge = {
    quotes: entries.filter((e) => e.status === 'quoted').length,
    work: entries.filter((e) => e.status === 'wip' || e.status === 'done').length,
    due: entries.filter((e) => e.status === 'invoiced').length,
  }
  const overdue = entries.some((e) => e.status === 'invoiced' && daysBetween(today, e.invoice.dueDate) < 0)
  const props = { entries, today, open, fy }

  const nav = (t) => html`<button key=${t.id} class="tab ${tab === t.id ? 'active' : ''}" onClick=${() => setTab(t.id)} aria-current=${tab === t.id ? 'page' : null}>
    <span class="tab-icon">${t.icon()}${badge[t.id] > 0 && html`<span class="tab-badge ${t.id === 'due' && overdue ? 'danger' : ''}">${badge[t.id]}</span>`}</span>
    <span>${t.label}</span>
  </button>`

  return html`<div class="app">
    <${Header} s=${s} fy=${fy} setFy=${setFy} today=${today} onSettings=${() => open('settings')} />
    <main class="main">
      <${InstallTip} />
      <${HeadsUp} entries=${entries} today=${today} tab=${tab} setTab=${setTab} />
      ${tab === 'quotes' && html`<${QuotesTab} ...${props} />`}
      ${tab === 'work' && html`<${WorkTab} ...${props} />`}
      ${tab === 'due' && html`<${DueTab} ...${props} />`}
      ${tab === 'done' && html`<${DoneTab} ...${props} />`}
    </main>
    <nav class="bottom-nav" aria-label="Sections">
      ${nav(TABS[0])}${nav(TABS[1])}
      <button class="fab" onClick=${() => open('new')} aria-label="New quote">${Icon.plus()}</button>
      ${nav(TABS[2])}${nav(TABS[3])}
    </nav>
    ${sheet && html`<${SheetRouter} key=${sheet.type + (sheet.id || '')} sheet=${sheet} open=${open} close=${close} />`}
    <${Toaster} />
  </div>`
}

store.init()
render(html`<${App} />`, document.getElementById('app'))
