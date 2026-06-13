import { C, COMPANY } from "../../lib/constants";
import { fmt, lineTotal, todayStr, addDays } from "../../lib/utils";
import { Btn } from "../ui/Btn";
import { PrintHeader } from "../ui/PrintHeader";

export function QuoteDoc({ job, onBack }) {
  const quoteDate = job.quote_date || job.date_received || todayStr();
  const expiryDate = addDays(quoteDate, 7);
  return (
    <div>
      <div className="no-print" style={{ padding: 16, background: C.silverLighter, display: "flex", gap: 12, alignItems: "center", marginBottom: 16, borderRadius: 6 }}>
        <Btn onClick={onBack} outline small>← Back</Btn>
        <Btn onClick={() => window.print()} small>🖨 Print Quote</Btn>
        <span style={{ fontSize: 12, color: C.textLight }}>Back button will not appear on printed copy</span>
      </div>
      <PrintHeader />
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 20 }}>
        <div style={{ fontSize: 20, fontWeight: 800, color: C.navy }}>QUOTATION</div>
        <div style={{ textAlign: "right", fontSize: 12 }}>
          <div><strong>Our Ref:</strong> {job.job_ref}</div>
          {job.po_number && <div><strong>Customer Ref:</strong> {job.po_number}</div>}
          <div><strong>Quote Date:</strong> {new Date(quoteDate).toLocaleDateString("en-GB")}</div>
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 20 }}>
        <div style={{ background: C.silverLighter, borderRadius: 6, padding: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.textLight, marginBottom: 4 }}>TO</div>
          <div style={{ fontWeight: 700 }}>{job.customer_name}</div>
          {job.contact_name && <div style={{ fontSize: 13 }}>{job.contact_name}</div>}
        </div>
        <div style={{ background: C.silverLighter, borderRadius: 6, padding: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.textLight, marginBottom: 4 }}>FROM</div>
          <div style={{ fontWeight: 700 }}>{COMPANY.name}</div>
          <div style={{ fontSize: 12 }}>{COMPANY.address}</div>
          <div style={{ fontSize: 12 }}>{COMPANY.phone} | {COMPANY.email}</div>
        </div>
      </div>
      <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 20, fontSize: 13 }}>
        <thead>
          <tr style={{ background: C.navy, color: C.white }}>
            <th style={{ padding: "8px 10px", textAlign: "left" }}>Description</th>
            <th style={{ padding: "8px 10px", textAlign: "center", width: 60 }}>Qty</th>
            <th style={{ padding: "8px 10px", textAlign: "right", width: 100 }}>Unit Price</th>
            <th style={{ padding: "8px 10px", textAlign: "right", width: 100 }}>Total</th>
          </tr>
        </thead>
        <tbody>
          {(job.lines || []).map((l, i) => (
            <tr key={i} style={{ background: i % 2 === 0 ? C.white : C.silverLighter }}>
              <td style={{ padding: "8px 10px" }}>{l.desc}</td>
              <td style={{ padding: "8px 10px", textAlign: "center" }}>{l.qty}</td>
              <td style={{ padding: "8px 10px", textAlign: "right" }}>{fmt(l.price)}</td>
              <td style={{ padding: "8px 10px", textAlign: "right" }}>{fmt((l.qty || 0) * (l.price || 0))}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr style={{ background: C.navy, color: C.white, fontWeight: 700 }}>
            <td colSpan={3} style={{ padding: "8px 10px", textAlign: "right" }}>TOTAL (excl. VAT)</td>
            <td style={{ padding: "8px 10px", textAlign: "right" }}>{fmt(lineTotal(job.lines))}</td>
          </tr>
        </tfoot>
      </table>
      {job.notes && <div style={{ marginBottom: 16, fontSize: 13 }}><strong>Notes:</strong> {job.notes}</div>}
      <div style={{ marginTop: 24, padding: 14, background: C.silverLighter, borderRadius: 6, fontSize: 12, color: C.textLight, borderLeft: `4px solid ${C.navy}` }}>
        This quote is only valid until <strong>{new Date(expiryDate).toLocaleDateString("en-GB")}</strong>. All prices exclude VAT unless stated. E&amp;OE.
      </div>
    </div>
  );
}
