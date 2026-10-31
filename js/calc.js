// Money, dates and financial-year helpers. Pure functions, no DOM.

export const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100
export const num = (v) => {
  const n = parseFloat(String(v ?? '').replace(/,/g, ''))
  return Number.isFinite(n) ? n : 0
}

const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2, minimumFractionDigits: 0 })
const inrShort = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 })
export const fmt = (n) => inr.format(round2(n))
export const fmt0 = (n) => inrShort.format(Math.round(n || 0))

// Compact form for the header counters: ₹1.2L, ₹3.4Cr
export function fmtCompact(n) {
  const v = Math.abs(n || 0)
  const sign = n < 0 ? '-' : ''
  if (v >= 1e7) return `${sign}₹${(v / 1e7).toFixed(v >= 1e8 ? 1 : 2).replace(/\.?0+$/, '')}Cr`
  if (v >= 1e5) return `${sign}₹${(v / 1e5).toFixed(2).replace(/\.?0+$/, '')}L`
  return fmt0(n)
}

// ---- Dates (stored as local YYYY-MM-DD strings) ----
const pad = (n) => String(n).padStart(2, '0')
export const toISO = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
export const todayISO = () => toISO(new Date())
export const parseISO = (s) => {
  const [y, m, d] = String(s).split('-').map(Number)
  return new Date(y, (m || 1) - 1, d || 1)
}
export const addDays = (iso, days) => {
  const d = parseISO(iso)
  d.setDate(d.getDate() + Number(days || 0))
  return toISO(d)
}
// Whole days from `from` to `to` (positive when `to` is later)
export const daysBetween = (from, to) => Math.round((parseISO(to) - parseISO(from)) / 86400000)

const dateFmt = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
const dateFmtShort = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short' })
export const fmtDate = (iso) => (iso ? dateFmt.format(parseISO(iso)) : '')
export const fmtDateShort = (iso) => (iso ? dateFmtShort.format(parseISO(iso)) : '')

// ---- Indian financial year (1 April – 31 March) ----
export const fyOf = (iso) => {
  const d = parseISO(iso)
  return d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1
}
export const fyLabel = (fy) => `FY ${fy}-${String((fy + 1) % 100).padStart(2, '0')}`
export const fyShort = (fy) => `${String(fy % 100).padStart(2, '0')}-${String((fy + 1) % 100).padStart(2, '0')}`
export const inFY = (iso, fy) => !!iso && fyOf(iso) === fy

// ---- Entry maths ----
// base     = quoted amount (excl. GST)
// gst      = base × GST%            (added on top, collected from client)
// total    = base + gst             (invoice value)
// tds      = base × TDS%            (withheld by client, claimable later)
// net      = total − tds            (what actually lands in the bank)
export function calc(e) {
  const base = round2(num(e.amount))
  const gst = e.gstOn ? round2((base * num(e.gstRate)) / 100) : 0
  const total = round2(base + gst)
  const tds = e.tdsOn ? round2((base * num(e.tdsRate)) / 100) : 0
  const net = round2(total - tds)
  const payments = e.payments || []
  const received = round2(payments.reduce((s, p) => s + num(p.amount), 0))
  const advance = round2(payments.filter((p) => p.kind === 'advance').reduce((s, p) => s + num(p.amount), 0))
  const balance = Math.max(0, round2(net - received))
  const vendorCost = round2(num(e.vendorCost))
  const margin = round2(base - vendorCost)
  const advanceSuggested = Math.round((net * num(e.advancePct ?? 50)) / 100)
  return { base, gst, total, tds, net, received, advance, balance, vendorCost, margin, advanceSuggested }
}

export function nextInvoiceNumber(entries, prefix, fy) {
  const tag = `${prefix}/${fyShort(fy)}/`
  let max = 0
  for (const e of entries) {
    const no = e.invoice?.number
    if (no && no.startsWith(tag)) {
      const n = parseInt(no.slice(tag.length), 10)
      if (n > max) max = n
    }
  }
  return `${tag}${String(max + 1).padStart(3, '0')}`
}

// ---- Amount in words (Indian numbering) ----
const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen']
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety']
function twoDigits(n) {
  if (n < 20) return ONES[n]
  return `${TENS[Math.floor(n / 10)]}${n % 10 ? ' ' + ONES[n % 10] : ''}`
}
function threeDigits(n) {
  const h = Math.floor(n / 100)
  const r = n % 100
  return [h ? `${ONES[h]} Hundred` : '', r ? twoDigits(r) : ''].filter(Boolean).join(' ')
}
function intToWords(n) {
  if (n === 0) return 'Zero'
  const parts = []
  const crore = Math.floor(n / 1e7)
  n %= 1e7
  const lakh = Math.floor(n / 1e5)
  n %= 1e5
  const thousand = Math.floor(n / 1000)
  n %= 1000
  if (crore) parts.push(`${intToWords(crore)} Crore`)
  if (lakh) parts.push(`${twoDigits(lakh)} Lakh`)
  if (thousand) parts.push(`${twoDigits(thousand)} Thousand`)
  if (n) parts.push(threeDigits(n))
  return parts.join(' ')
}
export function amountInWords(amount) {
  const rupees = Math.floor(round2(amount))
  const paise = Math.round((round2(amount) - rupees) * 100)
  return `Rupees ${intToWords(rupees)}${paise ? ` and ${twoDigits(paise)} Paise` : ''} Only`
}
