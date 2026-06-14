import { jsPDF } from 'jspdf'

const money = (n) => `GBP ${(Number(n) || 0).toFixed(2)}`
const dateStr = (d) => (d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '')

function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '')
  if (!m) return [232, 65, 10] // YCA ember fallback
  const i = parseInt(m[1], 16)
  return [(i >> 16) & 255, (i >> 8) & 255, i & 255]
}

/**
 * Generate and download a real PDF for an invoice OR quote.
 * `doc` is the UI-shaped object used in InvoiceGeneration
 * (invoice_number, customer_*, issue_date, due_date, line_items[], subtotal,
 *  vat_amount, total, notes, document_type, quote_expiry_date).
 */
export function generateInvoicePdf(doc, settings = {}, accountName = 'Your Business', brandColor = '#E8410A') {
  const isQuote = doc.document_type === 'quote'
  const pdf = new jsPDF({ unit: 'pt', format: 'a4' })
  const [r, g, b] = hexToRgb(brandColor)
  const W = pdf.internal.pageSize.getWidth()
  const M = 48
  let y = 56

  // Header
  pdf.setFont('helvetica', 'bold').setFontSize(20).setTextColor(r, g, b)
  pdf.text(accountName, M, y)
  pdf.setFontSize(22).setTextColor(30, 30, 46)
  pdf.text(isQuote ? 'QUOTE' : 'INVOICE', W - M, y, { align: 'right' })

  y += 22
  pdf.setFont('helvetica', 'normal').setFontSize(10).setTextColor(110, 110, 120)
  if (settings.vat_registered && settings.vat_number) pdf.text(`VAT No. ${settings.vat_number}`, M, y)
  pdf.text(`${doc.invoice_number || ''}`, W - M, y, { align: 'right' })
  y += 14
  pdf.text(`Issued: ${dateStr(doc.issue_date)}`, W - M, y, { align: 'right' })
  y += 14
  pdf.text(isQuote ? `Valid until: ${dateStr(doc.quote_expiry_date)}` : `Due: ${dateStr(doc.due_date)}`, W - M, y, { align: 'right' })

  // Bill to
  y += 30
  pdf.setFontSize(9).setTextColor(150, 150, 160)
  pdf.text(isQuote ? 'QUOTE FOR' : 'BILL TO', M, y)
  y += 15
  pdf.setFont('helvetica', 'bold').setFontSize(12).setTextColor(30, 30, 46)
  pdf.text(doc.customer_name || '', M, y)
  pdf.setFont('helvetica', 'normal').setFontSize(10).setTextColor(90, 90, 100)
  if (doc.customer_address) { y += 14; pdf.text(String(doc.customer_address), M, y) }
  if (doc.customer_email) { y += 14; pdf.text(String(doc.customer_email), M, y) }

  // Table header
  y += 28
  const cols = { desc: M, qty: W - M - 200, unit: W - M - 120, total: W - M }
  pdf.setDrawColor(230, 230, 235).line(M, y, W - M, y)
  y += 14
  pdf.setFont('helvetica', 'bold').setFontSize(9).setTextColor(120, 120, 130)
  pdf.text('DESCRIPTION', cols.desc, y)
  pdf.text('QTY', cols.qty, y, { align: 'right' })
  pdf.text('UNIT', cols.unit, y, { align: 'right' })
  pdf.text('TOTAL', cols.total, y, { align: 'right' })
  y += 8
  pdf.line(M, y, W - M, y)
  y += 16

  // Rows
  pdf.setFont('helvetica', 'normal').setFontSize(10).setTextColor(40, 40, 55)
  for (const li of doc.line_items || []) {
    if (y > 720) { pdf.addPage(); y = 56 }
    const desc = pdf.splitTextToSize(String(li.description || ''), cols.qty - cols.desc - 12)
    pdf.text(desc, cols.desc, y)
    pdf.text(String(li.quantity ?? ''), cols.qty, y, { align: 'right' })
    pdf.text(money(li.unit_price), cols.unit, y, { align: 'right' })
    pdf.text(money(li.line_total ?? (Number(li.quantity) || 0) * (Number(li.unit_price) || 0)), cols.total, y, { align: 'right' })
    y += Math.max(16, desc.length * 13)
  }

  // Totals
  y += 6
  pdf.setDrawColor(230, 230, 235).line(cols.qty - 20, y, W - M, y)
  y += 18
  const totalLine = (label, val, bold = false) => {
    pdf.setFont('helvetica', bold ? 'bold' : 'normal').setFontSize(bold ? 13 : 10)
    pdf.setTextColor(bold ? r : 90, bold ? g : 90, bold ? b : 100)
    pdf.text(label, cols.unit, y, { align: 'right' })
    pdf.setTextColor(30, 30, 46)
    pdf.text(val, cols.total, y, { align: 'right' })
    y += bold ? 22 : 16
  }
  totalLine('Subtotal', money(doc.subtotal))
  if ((Number(doc.vat_amount) || 0) > 0) totalLine(`VAT (${settings.vat_rate ?? 20}%)`, money(doc.vat_amount))
  totalLine(isQuote ? 'Quote total' : 'Total due', money(doc.total), true)

  // Bank details (invoices only) + footer
  if (!isQuote && settings.account_number) {
    y += 14
    pdf.setFont('helvetica', 'bold').setFontSize(9).setTextColor(120, 120, 130).text('PAYMENT DETAILS', M, y)
    pdf.setFont('helvetica', 'normal').setFontSize(10).setTextColor(60, 60, 75)
    y += 15; pdf.text(`Bank: ${settings.bank_name || ''}   Account: ${settings.account_name || ''}`, M, y)
    y += 14; pdf.text(`Sort code: ${settings.sort_code || ''}   Account no: ${settings.account_number || ''}`, M, y)
    y += 14; pdf.text(`Reference: ${doc.invoice_number || ''}`, M, y)
  }
  if (doc.notes) { y += 20; pdf.setFontSize(9).setTextColor(120, 120, 130).text(pdf.splitTextToSize(String(doc.notes), W - 2 * M), M, y) }
  if (settings.footer_notes) {
    pdf.setFontSize(8).setTextColor(160, 160, 170)
    pdf.text(pdf.splitTextToSize(String(settings.footer_notes), W - 2 * M), M, pdf.internal.pageSize.getHeight() - 40)
  }

  pdf.save(`${isQuote ? 'quote' : 'invoice'}-${doc.invoice_number || 'document'}.pdf`)
}
