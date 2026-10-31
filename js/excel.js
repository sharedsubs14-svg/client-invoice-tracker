// Excel (.xlsx) export, generated on-device with SheetJS (loaded on first use, then cached offline).
// Three sheets: Jobs (one row per entry), Payments (one row per payment), FY Summary.

import { calc, fyOf, fyLabel, daysBetween, todayISO } from './calc.js'

const XLSX_URL = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js'
let loading = null
function loadXLSX() {
  if (window.XLSX) return Promise.resolve(window.XLSX)
  loading ||= new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = XLSX_URL
    s.onload = () => resolve(window.XLSX)
    s.onerror = () => {
      loading = null
      reject(new Error('Could not load the Excel engine. Connect to the internet once and try again.'))
    }
    document.head.appendChild(s)
  })
  return loading
}

const STATUS_LABEL = { quoted: 'Quoted', wip: 'Work in progress', done: 'Invoice pending', invoiced: 'Invoiced', paid: 'Paid', lost: 'Lost' }

export function jobRows(entries, today = todayISO()) {
  return [...entries]
    .sort((a, b) => (a.quotedAt || '').localeCompare(b.quotedAt || ''))
    .map((e) => {
      const c = calc(e)
      const due = e.status === 'invoiced' && e.invoice?.dueDate ? daysBetween(today, e.invoice.dueDate) : ''
      return {
        'Client': e.client,
        'Project': e.project || '',
        'Category': e.category || '',
        'Status': STATUS_LABEL[e.status] || e.status,
        'Quote date': e.quotedAt || '',
        'FY': e.quotedAt ? fyLabel(fyOf(e.quotedAt)) : '',
        'Quote (excl. GST)': c.base,
        'GST %': e.gstOn ? Number(e.gstRate) : 0,
        'GST': c.gst,
        'Invoice total': c.total,
        'TDS %': e.tdsOn ? Number(e.tdsRate) : 0,
        'TDS': c.tds,
        'Net receivable': c.net,
        'Received': c.received,
        'Balance': c.balance,
        'Vendor': e.vendor || '',
        'Vendor cost': c.vendorCost,
        'Vendor paid': c.vendorCost ? (e.vendorPaid ? 'Yes' : 'No') : '',
        'Margin (excl. GST)': c.margin,
        'Work started': e.wipAt || '',
        'Work done': e.doneAt || '',
        'Invoice no.': e.invoice?.number || '',
        'Invoice date': e.invoice?.date || '',
        'Due date': e.invoice?.dueDate || '',
        'Days left (− = overdue)': due,
        'Paid on': e.paidAt || '',
        'Client GSTIN': e.billing?.gstin || '',
        'Client state': e.billing?.state || '',
        'Notes': e.notes || '',
        'ID': e.id,
      }
    })
}

export function paymentRows(entries) {
  const rows = []
  for (const e of entries)
    for (const p of e.payments || [])
      rows.push({
        'Date': p.date,
        'FY': fyLabel(fyOf(p.date)),
        'Client': e.client,
        'Project': e.project || '',
        'Type': p.kind === 'advance' ? 'Advance' : 'Payment',
        'Amount': Number(p.amount) || 0,
        'Invoice no.': e.invoice?.number || '',
        'Entry ID': e.id,
      })
  return rows.sort((a, b) => a.Date.localeCompare(b.Date))
}

export function summaryRows(entries) {
  const by = new Map()
  const row = (fy) => {
    if (!by.has(fy)) by.set(fy, { FY: fyLabel(fy), 'Received': 0, 'Jobs invoiced': 0, 'Invoiced (incl. GST)': 0, 'GST collected': 0, 'TDS deducted': 0, 'Vendor costs': 0, 'Margin (excl. GST)': 0 })
    return by.get(fy)
  }
  for (const e of entries) {
    for (const p of e.payments || []) row(fyOf(p.date))['Received'] += Number(p.amount) || 0
    if (e.invoice?.date) {
      const r = row(fyOf(e.invoice.date))
      const c = calc(e)
      r['Jobs invoiced']++
      r['Invoiced (incl. GST)'] += c.total
      r['GST collected'] += c.gst
      r['TDS deducted'] += c.tds
      r['Vendor costs'] += c.vendorCost
      r['Margin (excl. GST)'] += c.margin
    }
  }
  return [...by.entries()].sort((a, b) => b[0] - a[0]).map(([, r]) => r)
}

function sheet(XLSX, rows, fallbackHeader) {
  const ws = rows.length ? XLSX.utils.json_to_sheet(rows) : XLSX.utils.aoa_to_sheet([fallbackHeader])
  const keys = rows.length ? Object.keys(rows[0]) : fallbackHeader
  ws['!cols'] = keys.map((k) => ({ wch: Math.min(40, Math.max(k.length + 2, ...rows.map((r) => String(r[k] ?? '').length + 1))) }))
  return ws
}

export async function buildWorkbook(entries) {
  const XLSX = await loadXLSX()
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, sheet(XLSX, jobRows(entries), ['Client']), 'Jobs')
  XLSX.utils.book_append_sheet(wb, sheet(XLSX, paymentRows(entries), ['Date']), 'Payments')
  XLSX.utils.book_append_sheet(wb, sheet(XLSX, summaryRows(entries), ['FY']), 'FY Summary')
  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
  return new File([buf], `invoice-tracker-${todayISO()}.xlsx`, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
}
