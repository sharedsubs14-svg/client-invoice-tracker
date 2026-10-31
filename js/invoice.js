// GST invoice PDF, generated on-device with jsPDF (loaded on first use, then cached by the service worker).

import { calc, fmtDate, amountInWords, round2 } from './calc.js'

const JSPDF_URL = 'https://cdn.jsdelivr.net/npm/jspdf@2.5.2/dist/jspdf.umd.min.js'
let loading = null
function loadJsPDF() {
  if (window.jspdf) return Promise.resolve(window.jspdf.jsPDF)
  loading ||= new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = JSPDF_URL
    s.onload = () => resolve(window.jspdf.jsPDF)
    s.onerror = () => {
      loading = null
      reject(new Error('Could not load the PDF engine. Connect to the internet once and try again.'))
    }
    document.head.appendChild(s)
  })
  return loading
}

// jsPDF's built-in fonts have no ₹ glyph, so the PDF uses "Rs."
const rs = (n) => 'Rs. ' + round2(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export function invoiceFileName(entry) {
  const no = (entry.invoice?.number || 'invoice').replace(/[^\w-]+/g, '-')
  const client = (entry.client || '').replace(/[^\w]+/g, '-').slice(0, 30)
  return `${no}_${client}.pdf`.replace(/-+/g, '-')
}

export async function buildInvoicePdf(entry, settings) {
  const jsPDF = await loadJsPDF()
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const c = calc(entry)
  const inv = entry.invoice || {}
  const biz = settings.business
  const bank = settings.bank
  const bill = entry.billing || {}
  const W = 210
  const M = 16
  const R = W - M
  let y = 20

  const text = (t, x, yy, opts = {}) => {
    doc.setFont('helvetica', opts.bold ? 'bold' : 'normal')
    doc.setFontSize(opts.size || 10)
    doc.setTextColor(...(opts.color || [20, 20, 20]))
    doc.text(String(t ?? ''), x, yy, opts.align ? { align: opts.align } : undefined)
  }
  const wrap = (t, x, yy, width, opts = {}) => {
    doc.setFont('helvetica', opts.bold ? 'bold' : 'normal')
    doc.setFontSize(opts.size || 10)
    doc.setTextColor(...(opts.color || [20, 20, 20]))
    const lines = doc.splitTextToSize(String(t || ''), width)
    doc.text(lines, x, yy)
    return yy + lines.length * (opts.size || 10) * 0.42
  }
  const grey = [110, 110, 110]
  const line = (yy, color = [225, 225, 225]) => {
    doc.setDrawColor(...color)
    doc.setLineWidth(0.3)
    doc.line(M, yy, R, yy)
  }

  // Header
  text(biz.name || 'Your Business Name', M, y, { bold: true, size: 18 })
  text(biz.gstin ? 'TAX INVOICE' : 'INVOICE', R, y, { bold: true, size: 13, align: 'right', color: [23, 70, 216] })
  y += 6
  let ly = wrap(biz.address, M, y, 100, { size: 9, color: grey })
  const contact = [biz.phone, biz.email].filter(Boolean).join('  ·  ')
  if (contact) ly = wrap(contact, M, ly, 100, { size: 9, color: grey })
  const ids = [biz.gstin && `GSTIN: ${biz.gstin}`, biz.pan && `PAN: ${biz.pan}`].filter(Boolean).join('   ')
  if (ids) ly = wrap(ids, M, ly, 110, { size: 9, bold: true })

  // Invoice meta (right column)
  let my = y
  const meta = [
    ['Invoice No.', inv.number],
    ['Invoice Date', fmtDate(inv.date)],
    ['Due Date', fmtDate(inv.dueDate)],
    ['Place of Supply', bill.state || biz.state || '-'],
  ]
  for (const [k, v] of meta) {
    text(k, R - 48, my, { size: 9, color: grey })
    text(v || '-', R, my, { size: 9, bold: true, align: 'right' })
    my += 5
  }
  y = Math.max(ly, my) + 4
  line(y)
  y += 7

  // Bill to
  text('BILL TO', M, y, { size: 8, bold: true, color: grey })
  y += 5
  text(entry.client, M, y, { size: 11, bold: true })
  y += 5
  y = wrap(bill.address, M, y, 110, { size: 9, color: grey })
  if (bill.gstin) y = wrap(`GSTIN: ${bill.gstin}`, M, y, 110, { size: 9, bold: true })
  if (bill.state) y = wrap(`State: ${bill.state}`, M, y, 110, { size: 9, color: grey })
  y += 5

  // Line item table
  doc.setFillColor(236, 242, 255)
  doc.rect(M, y - 4.5, R - M, 8, 'F')
  text('#', M + 2, y, { size: 9, bold: true })
  text('Description', M + 10, y, { size: 9, bold: true })
  text('SAC', R - 52, y, { size: 9, bold: true })
  text('Amount', R - 2, y, { size: 9, bold: true, align: 'right' })
  y += 9
  text('1', M + 2, y, { size: 10 })
  const desc = [entry.category, entry.project].filter(Boolean).join(' — ') || 'Professional services'
  const descEnd = wrap(desc, M + 10, y, R - M - 75, { size: 10 })
  text(inv.sac || '-', R - 52, y, { size: 10 })
  text(rs(c.base), R - 2, y, { size: 10, align: 'right' })
  y = Math.max(descEnd, y + 4) + 3
  line(y)
  y += 7

  // Totals
  const intra = !bill.state || !biz.state || bill.state.trim().toLowerCase() === biz.state.trim().toLowerCase()
  const rows = [['Taxable Value', rs(c.base)]]
  if (entry.gstOn) {
    const rate = Number(entry.gstRate) || 0
    if (intra) {
      rows.push([`CGST @ ${rate / 2}%`, rs(c.gst / 2)])
      rows.push([`SGST @ ${rate / 2}%`, rs(c.gst - round2(c.gst / 2))])
    } else rows.push([`IGST @ ${rate}%`, rs(c.gst)])
  }
  const tx = R - 70
  for (const [k, v] of rows) {
    text(k, tx, y, { size: 10, color: grey })
    text(v, R - 2, y, { size: 10, align: 'right' })
    y += 6
  }
  doc.setFillColor(23, 70, 216)
  doc.rect(tx - 3, y - 4.5, R - tx + 3, 9, 'F')
  text('Invoice Total', tx, y + 1, { size: 11, bold: true, color: [255, 255, 255] })
  text(rs(c.total), R - 2, y + 1, { size: 11, bold: true, align: 'right', color: [255, 255, 255] })
  y += 10
  y = wrap(amountInWords(c.total), M, y, R - M, { size: 9, color: grey }) + 2

  if (c.advance > 0) {
    text('Less: Advance received', tx, y, { size: 10, color: grey })
    text(`- ${rs(c.advance)}`, R - 2, y, { size: 10, align: 'right' })
    y += 6
    text('Balance Payable', tx, y, { size: 10, bold: true })
    text(rs(c.total - c.advance), R - 2, y, { size: 10, bold: true, align: 'right' })
    y += 6
  }
  if (entry.tdsOn && c.tds > 0) {
    y += 2
    y = wrap(
      `TDS @ ${entry.tdsRate}% on taxable value (${rs(c.tds)}) is deductible by the client. Net amount payable after TDS: ${rs(c.total - c.advance - c.tds)}. Kindly share the TDS certificate.`,
      M, y, R - M, { size: 9, color: grey },
    )
  }
  y += 6
  line(y)
  y += 7

  // Payment details
  const bankLines = [
    bank.accountName && `Account Name: ${bank.accountName}`,
    bank.bankName && `Bank: ${bank.bankName}`,
    bank.accountNo && `A/c No: ${bank.accountNo}`,
    bank.ifsc && `IFSC: ${bank.ifsc}`,
    bank.upi && `UPI: ${bank.upi}`,
  ].filter(Boolean)
  if (bankLines.length) {
    text('PAYMENT DETAILS', M, y, { size: 8, bold: true, color: grey })
    y += 5
    for (const l of bankLines) {
      text(l, M, y, { size: 9 })
      y += 4.6
    }
    y += 3
  }
  const terms = settings.paymentTermsDays || 30
  y = wrap(`Payment due within ${terms} days of the invoice date (by ${fmtDate(inv.dueDate)}).`, M, y, R - M, { size: 9, color: grey })

  // Signature
  const sy = Math.max(y + 18, 250)
  text(`For ${biz.name || ''}`, R, sy, { size: 10, bold: true, align: 'right' })
  text('Authorised Signatory', R, sy + 14, { size: 9, color: grey, align: 'right' })
  text('This is a computer-generated invoice.', W / 2, 287, { size: 8, color: [150, 150, 150], align: 'center' })

  const blob = doc.output('blob')
  return new File([blob], invoiceFileName(entry), { type: 'application/pdf' })
}

export async function shareFile(file, title) {
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title })
      return 'shared'
    } catch (err) {
      if (err.name === 'AbortError') return 'cancelled'
    }
  }
  downloadFile(file)
  return 'downloaded'
}

export function downloadFile(file) {
  const url = URL.createObjectURL(file)
  const a = document.createElement('a')
  a.href = url
  a.download = file.name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}
