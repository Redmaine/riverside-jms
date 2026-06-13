import { useEffect } from "react";
import { C, COMPANY } from "../../lib/constants";
import { Btn } from "../ui/Btn";

export function JobSheetDoc({ job, onBack }) {
  useEffect(() => { window.scrollTo(0, 0); }, []);
  const version = `v${(job.job_ref || "").replace(/\D/g, "") || "0"}.0`;
  const rows = [
    { label: "Our Ref", val: job.job_ref },
    { label: "Customer PO", val: job.po_number || "—" },
    { label: "Due Date", val: job.due_date ? new Date(job.due_date).toLocaleDateString("en-GB") : "—" },
    { label: "Drawing No", val: job.drawing_number || "—" },
    { label: "Drawing Attached", val: job.drawing_attached ? "Yes" : "No" },
    { label: "Status", val: job.status },
    ...(job.notes ? [{ label: "Notes", val: job.notes }] : []),
  ];
  return (
    <div>
      <div className="no-print" style={{ padding: 16, background: C.silverLighter, display: "flex", gap: 12, alignItems: "center", marginBottom: 16, borderRadius: 6 }}>
        <Btn onClick={onBack} outline small>← Back</Btn>
        <Btn onClick={() => {
          const el = document.getElementById("job-sheet-content");
          const w = window.open("", "_blank", "width=900,height=700");
          w.document.write(`<!DOCTYPE html><html><head><title>Job Sheet</title><style>body{font-family:Arial,sans-serif;margin:20px;color:#1a2744}table{border-collapse:collapse}@page{margin:15mm}</style></head><body>${el ? el.innerHTML : ""}</body></html>`);
          w.document.close();
          w.focus();
          w.print();
          w.onafterprint = () => w.close();
        }} small>🖨 Print Job Sheet</Btn>
        <span style={{ fontSize: 12, color: C.textLight }}>Back button will not appear on printed copy</span>
      </div>
      <div id="job-sheet-content">
      <div style={{ borderBottom: "3px solid #1a2744", paddingBottom: 10, marginBottom: 16, display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 900, color: C.navy }}>{COMPANY.name}</div>
          <div style={{ fontSize: 11, color: C.textLight }}>{COMPANY.address}</div>
          <div style={{ fontSize: 11, color: C.textLight }}>{COMPANY.phone}</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 11, color: C.textLight, letterSpacing: 1 }}>JOB SHEET</div>
          <div style={{ fontSize: 28, fontWeight: 900, color: C.navy, lineHeight: 1 }}>{job.job_ref}</div>
          {job.po_number && <div style={{ fontSize: 12, color: C.textLight }}>Customer PO: {job.po_number}</div>}
        </div>
      </div>
      <div style={{ border: `1px solid ${C.border}`, borderRadius: 4, padding: "10px 14px", marginBottom: 16 }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: C.textLight, letterSpacing: 1, marginBottom: 4 }}>CUSTOMER</div>
        <div style={{ fontSize: 16, fontWeight: 800, color: C.navy }}>{job.customer_name}</div>
        {job.contact_name && <div style={{ fontSize: 13, color: C.textLight }}>Contact: {job.contact_name}</div>}
      </div>
      <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 16, fontSize: 13 }}>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} style={{ borderBottom: `1px solid ${C.border}` }}>
              <td style={{ padding: "7px 12px", fontWeight: 700, background: C.silverLighter, width: "30%" }}>{r.label}</td>
              <td style={{ padding: "7px 12px" }}>{r.val}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: C.navy, marginBottom: 8 }}>Items to Manufacture</div>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, border: `1px solid ${C.border}` }}>
          <thead>
            <tr style={{ background: C.silverLighter }}>
              <th style={{ padding: "7px 12px", textAlign: "left", fontWeight: 700, borderBottom: `1px solid ${C.border}` }}>Description</th>
              <th style={{ padding: "7px 12px", textAlign: "center", width: 60, fontWeight: 700, borderBottom: `1px solid ${C.border}` }}>Qty</th>
              <th style={{ padding: "7px 12px", textAlign: "left", width: 120, fontWeight: 700, borderBottom: `1px solid ${C.border}` }}>Drawing No</th>
              <th style={{ padding: "7px 12px", textAlign: "center", width: 90, fontWeight: 700, borderBottom: `1px solid ${C.border}` }}>Complete ✓</th>
            </tr>
          </thead>
          <tbody>
            {(job.lines || []).map((l, i) => (
              <tr key={i} style={{ borderBottom: `1px solid ${C.border}` }}>
                <td style={{ padding: "8px 12px" }}>{l.desc}</td>
                <td style={{ padding: "8px 12px", textAlign: "center", fontWeight: 700 }}>{l.qty}</td>
                <td style={{ padding: "8px 12px" }}>{l.drawingNo || ""}</td>
                <td style={{ padding: "8px 12px", textAlign: "center" }}>□</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {(job.stages || []).length > 0 ? (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: C.navy, marginBottom: 8 }}>Production Stages</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {(job.stages || []).map((s, i) => (
              <div key={i} style={{ border: `1px solid ${C.border}`, borderRadius: 4, padding: "6px 14px", fontSize: 13, display: "flex", gap: 8, alignItems: "center" }}>
                <span style={{ width: 14, height: 14, border: "1px solid #999", display: "inline-block", borderRadius: 2 }}></span>
                {s}
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div style={{ fontSize: 13, color: C.textLight, marginBottom: 16 }}>No stages defined.</div>
      )}
      <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 8, marginTop: 20, display: "flex", justifyContent: "space-between", fontSize: 11, color: C.textLight }}>
        <span>{COMPANY.name} · {COMPANY.address}</span>
        <span>Job Sheet {job.job_ref} · {version}</span>
      </div>
      </div>
    </div>
  );
}
