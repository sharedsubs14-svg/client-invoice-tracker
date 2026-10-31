/**
 * Invoice Tracker → Google Sheets receiver.
 *
 * Paste this into your sheet's Extensions → Apps Script, set the SECRET script property,
 * and deploy as a web app (see docs/google-sheets-sync.md). Supabase posts every change here.
 *
 * The sheet keeps a hidden "_data" tab with the raw entries (one row per entry ID).
 * After every change the visible tabs are rebuilt from it, so they are always consistent:
 *   Jobs · Payments · FY Summary
 * The visible tabs are a mirror - edits made there are overwritten on the next sync.
 */

const DATA = '_data'

function doPost(e) {
  const body = JSON.parse((e && e.postData && e.postData.contents) || '{}')
  const secret = PropertiesService.getScriptProperties().getProperty('SECRET')
  if (!secret || body.secret !== secret) return json_({ ok: false, error: 'unauthorized' })

  const lock = LockService.getScriptLock()
  lock.waitLock(30000)
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet()
    const store = readStore_(ss)
    if (body.type === 'RESYNC') {
      store.clear()
      for (const r of body.records || []) if (r && r.id) store.set(r.id, r)
    } else if (body.type === 'DELETE') {
      store.delete(body.id)
    } else if (body.type === 'UPSERT' && body.record) {
      store.set(body.id || body.record.id, body.record)
    }
    writeStore_(ss, store)
    render_(ss, [...store.values()])
    return json_({ ok: true, entries: store.size })
  } finally {
    lock.releaseLock()
  }
}

// Visit the web app URL in a browser to check it's deployed.
function doGet() {
  return json_({ ok: true, app: 'invoice-tracker-sheets' })
}

// Run manually from the Apps Script editor to rebuild the visible tabs.
function rebuild() {
  const ss = SpreadsheetApp.getActiveSpreadsheet()
  render_(ss, [...readStore_(ss).values()])
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON)
}

// ---------- raw store ----------
function dataSheet_(ss) {
  let sh = ss.getSheetByName(DATA)
  if (!sh) {
    sh = ss.insertSheet(DATA)
    sh.hideSheet()
  }
  return sh
}
function readStore_(ss) {
  const sh = dataSheet_(ss)
  const map = new Map()
  const n = sh.getLastRow()
  if (n) for (const [id, raw] of sh.getRange(1, 1, n, 2).getValues()) if (id) map.set(String(id), JSON.parse(raw))
  return map
}
function writeStore_(ss, map) {
  const sh = dataSheet_(ss)
  sh.clearContents()
  const rows = [...map.entries()].map(([id, rec]) => [id, JSON.stringify(rec)])
  if (rows.length) sh.getRange(1, 1, rows.length, 2).setValues(rows)
}

// ---------- maths (same as js/calc.js in the app) ----------
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100
const num = (v) => {
  const n = parseFloat(String(v == null ? '' : v).replace(/,/g, ''))
  return isFinite(n) ? n : 0
}
function calc_(e) {
  const base = r2(num(e.amount))
  const gst = e.gstOn ? r2((base * num(e.gstRate)) / 100) : 0
  const total = r2(base + gst)
  const tds = e.tdsOn ? r2((base * num(e.tdsRate)) / 100) : 0
  const net = r2(total - tds)
  const received = r2((e.payments || []).reduce((s, p) => s + num(p.amount), 0))
  const vendorCost = r2(num(e.vendorCost))
  return { base, gst, total, tds, net, received, balance: Math.max(0, r2(net - received)), vendorCost, margin: r2(base - vendorCost) }
}
const fyOf_ = (iso) => {
  const y = Number(iso.slice(0, 4))
  return Number(iso.slice(5, 7)) >= 4 ? y : y - 1
}
const fyLabel_ = (fy) => `FY ${fy}-${String((fy + 1) % 100).padStart(2, '0')}`
const date_ = (iso) => {
  if (!iso) return ''
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d)
}
const STATUS = { quoted: 'Quoted', wip: 'Work in progress', done: 'Invoice pending', invoiced: 'Invoiced', paid: 'Paid', lost: 'Lost' }

// ---------- rendering ----------
const JOB_COLS = [
  ['Client', (e) => e.client || ''],
  ['Project', (e) => e.project || ''],
  ['Category', (e) => e.category || ''],
  ['Status', (e) => STATUS[e.status] || e.status || ''],
  ['Quote date', (e) => date_(e.quotedAt), 'date'],
  ['FY', (e) => (e.quotedAt ? fyLabel_(fyOf_(e.quotedAt)) : '')],
  ['Quote (excl. GST)', (e, c) => c.base, 'money'],
  ['GST %', (e) => (e.gstOn ? num(e.gstRate) : 0)],
  ['GST', (e, c) => c.gst, 'money'],
  ['Invoice total', (e, c) => c.total, 'money'],
  ['TDS %', (e) => (e.tdsOn ? num(e.tdsRate) : 0)],
  ['TDS', (e, c) => c.tds, 'money'],
  ['Net receivable', (e, c) => c.net, 'money'],
  ['Received', (e, c) => c.received, 'money'],
  ['Balance', (e, c) => c.balance, 'money'],
  ['Vendor', (e) => e.vendor || ''],
  ['Vendor cost', (e, c) => c.vendorCost, 'money'],
  ['Vendor paid', (e, c) => (c.vendorCost ? (e.vendorPaid ? 'Yes' : 'No') : '')],
  ['Margin (excl. GST)', (e, c) => c.margin, 'money'],
  ['Work started', (e) => date_(e.wipAt), 'date'],
  ['Work done', (e) => date_(e.doneAt), 'date'],
  ['Invoice no.', (e) => (e.invoice && e.invoice.number) || ''],
  ['Invoice date', (e) => date_(e.invoice && e.invoice.date), 'date'],
  ['Due date', (e) => date_(e.invoice && e.invoice.dueDate), 'date'],
  ['Days left (− = overdue)', null, 'daysLeft'], // live formula, updates every day
  ['Paid on', (e) => date_(e.paidAt), 'date'],
  ['Client GSTIN', (e) => (e.billing && e.billing.gstin) || ''],
  ['Client state', (e) => (e.billing && e.billing.state) || ''],
  ['Notes', (e) => e.notes || ''],
  ['ID', (e) => e.id],
]

function colLetter_(i) {
  let s = ''
  for (i++; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s
  return s
}

function writeTable_(ss, name, headers, rows, types, index) {
  let sh = ss.getSheetByName(name)
  if (!sh) sh = ss.insertSheet(name, index)
  sh.clear()
  sh.getRange(1, 1, 1, headers.length).setValues([headers])
    .setFontWeight('bold').setFontColor('#ffffff').setBackground('#1746d8')
  if (rows.length) sh.getRange(2, 1, rows.length, headers.length).setValues(rows)
  types.forEach((t, i) => {
    if (!rows.length || !t) return
    const range = sh.getRange(2, i + 1, rows.length, 1)
    if (t === 'money') range.setNumberFormat('"₹"#,##0.00')
    if (t === 'date') range.setNumberFormat('dd mmm yyyy')
    if (t === 'daysLeft') range.setNumberFormat('0')
  })
  sh.setFrozenRows(1)
  if (rows.length) sh.getRange(2, 1, rows.length, headers.length).setBackground(null)
  sh.autoResizeColumns(1, headers.length)
  return sh
}

function render_(ss, entries) {
  entries.sort((a, b) => String(a.quotedAt || '').localeCompare(String(b.quotedAt || '')))

  // Jobs
  const headers = JOB_COLS.map((c) => c[0])
  const statusCol = colLetter_(headers.indexOf('Status'))
  const dueCol = colLetter_(headers.indexOf('Due date'))
  const jobs = entries.map((e, i) => {
    const c = calc_(e)
    const r = i + 2
    return JOB_COLS.map(([, fn, type]) =>
      type === 'daysLeft' ? `=IF(AND(${statusCol}${r}="Invoiced",${dueCol}${r}<>""),${dueCol}${r}-TODAY(),"")` : fn(e, c))
  })
  const jobSheet = writeTable_(ss, 'Jobs', headers, jobs, JOB_COLS.map((c) => c[2]), 0)
  if (jobs.length) {
    const dl = jobSheet.getRange(2, headers.indexOf('Days left (− = overdue)') + 1, jobs.length, 1)
    jobSheet.setConditionalFormatRules([
      SpreadsheetApp.newConditionalFormatRule().whenNumberLessThan(0).setFontColor('#dc3545').setBold(true).setRanges([dl]).build(),
      SpreadsheetApp.newConditionalFormatRule().whenNumberBetween(0, 7).setFontColor('#c2780a').setBold(true).setRanges([dl]).build(),
    ])
  }

  // Payments
  const pays = []
  for (const e of entries)
    for (const p of e.payments || [])
      pays.push([date_(p.date), fyLabel_(fyOf_(p.date)), e.client || '', e.project || '', p.kind === 'advance' ? 'Advance' : 'Payment', num(p.amount), (e.invoice && e.invoice.number) || '', e.id])
  pays.sort((a, b) => a[0] - b[0])
  writeTable_(ss, 'Payments', ['Date', 'FY', 'Client', 'Project', 'Type', 'Amount', 'Invoice no.', 'Entry ID'], pays, ['date', '', '', '', '', 'money', '', ''], 1)

  // FY Summary
  const by = new Map()
  const row = (fy) => {
    if (!by.has(fy)) by.set(fy, [fyLabel_(fy), 0, 0, 0, 0, 0, 0, 0])
    return by.get(fy)
  }
  for (const e of entries) {
    for (const p of e.payments || []) row(fyOf_(p.date))[1] += num(p.amount)
    if (e.invoice && e.invoice.date) {
      const r = row(fyOf_(e.invoice.date))
      const c = calc_(e)
      r[2]++; r[3] += c.total; r[4] += c.gst; r[5] += c.tds; r[6] += c.vendorCost; r[7] += c.margin
    }
  }
  const summary = [...by.entries()].sort((a, b) => b[0] - a[0]).map(([, r]) => r)
  writeTable_(ss, 'FY Summary', ['FY', 'Received', 'Jobs invoiced', 'Invoiced (incl. GST)', 'GST collected', 'TDS deducted', 'Vendor costs', 'Margin (excl. GST)'],
    summary, ['', 'money', '', 'money', 'money', 'money', 'money', 'money'], 2)

  // Drop the blank "Sheet1" a new spreadsheet starts with.
  const blank = ss.getSheetByName('Sheet1')
  if (blank && blank.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(blank)
}
