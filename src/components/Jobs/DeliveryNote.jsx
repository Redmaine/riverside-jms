import { useState } from "react";
import { C, COMPANY } from "../../lib/constants";
import { todayStr } from "../../lib/utils";
import { supabase } from "../../lib/supabase";
import { Btn } from "../ui/Btn";

export function DeliveryNoteFlow({ job, onDone, toast }) {
  const pendingLines = (job.lines || []).filter(l => !l.despatched);
  const doneLines = (job.lines || []).filter(l => l.despatched);
  const [selected, setSelected] = useState(() => pendingLines.map((_, i) => i));
  const [noteText, setNoteText] = useState("");
  const [step, setStep] = useState("select");
  const [dnItems, setDnItems] = useState([]);
  const [emailAddr, setEmailAddr] = useState("");
  const [showEmail, setShowEmail] = useState(false);

  const toggle = (i) => setSelected(s => s.includes(i) ? s.filter(x => x !== i) : [...s, i]);

  const confirm = async () => {
    const going = pendingLines.filter((_, i) => selected.includes(i));
    if (!going.length) { toast("Select at least one item", "error"); return; }
    const now = todayStr();
    const updatedLines = (job.lines || []).map(l => {
      const match = going.find(g => g.desc === l.desc && String(g.qty) === String(l.qty));
      return match && !l.despatched ? { ...l, despatched: true, despatchDate: now } : l;
    });
    const allDone = updatedLines.every(l => l.despatched);
    const newStatus = allDone ? "Fully Despatched" : "Part Despatched";
    await supabase.from("jobs").update({ lines: updatedLines, status: newStatus }).eq("id", job.id);
    setDnItems(going);
    setStep("send");
  };

  const doPrint = () => {
    const itemsHtml = dnItems.map(l =>
      `<tr><td style="padding:8px 10px">${l.desc}</td><td style="padding:8px 10px;text-align:center">${l.qty}</td><td style="padding:8px 10px">${l.drawingNo || ""}</td><td style="padding:8px 10px;text-align:center"></td></tr>`
    ).join("");
    const copy = (n, t) => `
      <div style="page-break-after:${n < t ? "always" : "auto"};padding-bottom:20px">
        <div style="border-bottom:3px solid #1a2744;padding-bottom:12px;margin-bottom:16px;display:flex;justify-content:space-between;align-items:flex-start">
          <div>
            <strong style="font-size:18px;color:#1a2744">${COMPANY.name}</strong><br>
            <span style="font-size:11px;color:#666">${COMPANY.address}</span><br>
            <span style="font-size:11px;color:#666">Tel: ${COMPANY.phone} | ${COMPANY.email}</span>
          </div>
          <div style="text-align:right">
            <div style="font-size:20px;font-weight:900;color:#1a2744">DELIVERY NOTE</div>
            <div style="font-size:11px;color:#666">Copy ${n} of ${t}</div>
          </div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px">
          <div style="border:1px solid #d0d8e8;border-radius:4px;padding:10px 14px">
            <div style="font-size:10px;font-weight:700;color:#666;letter-spacing:1px;margin-bottom:4px">CUSTOMER</div>
            <div style="font-size:16px;font-weight:800;color:#1a2744">${job.customer_name}</div>
            ${job.contact_name ? `<div style="font-size:13px;color:#666">${job.contact_name}</div>` : ""}
          </div>
          <div style="font-size:12px;text-align:right">
            <div><strong>Our Ref:</strong> ${job.job_ref}</div>
            ${job.po_number ? `<div><strong>Customer PO:</strong> ${job.po_number}</div>` : ""}
            <div><strong>Date:</strong> ${new Date().toLocaleDateString("en-GB")}</div>
          </div>
        </div>
        ${noteText ? `<div style="background:#fffbe6;border:1px solid #f0d060;border-radius:6px;padding:10px;margin-bottom:12px;font-size:13px"><strong>Note:</strong> ${noteText}</div>` : ""}
        <table style="width:100%;border-collapse:collapse;font-size:13px">
          <thead><tr style="background:#1a2744;color:#fff">
            <th style="padding:8px 10px;text-align:left">Description</th>
            <th style="padding:8px 10px;text-align:center;width:60px">Qty</th>
            <th style="padding:8px 10px;text-align:left;width:100px">Drawing No</th>
            <th style="padding:8px 10px;text-align:center;width:80px">Received ✓</th>
          </tr></thead>
          <tbody>${itemsHtml}</tbody>
        </table>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-top:24px">
          <div><div style="font-size:12px;font-weight:600;margin-bottom:24px">Received by (Customer):</div><div style="border-bottom:1px solid #1a2744;margin-bottom:8px"></div><div style="font-size:11px;color:#666">Name: _________________________ Date: ___________</div></div>
          <div><div style="font-size:12px;font-weight:600;margin-bottom:24px">Authorised by (Riverside):</div><div style="border-bottom:1px solid #1a2744;margin-bottom:8px"></div><div style="font-size:11px;color:#666">Name: _________________________ Date: ___________</div></div>
        </div>
      </div>`;
    const w = window.open("", "_blank");
    w.document.write(`<!DOCTYPE html><html><head><title>Delivery Note - ${job.job_ref}</title><style>body{font-family:Arial,sans-serif;margin:20px}@page{size:A4 portrait;margin:15mm}</style></head><body>${copy(1,2)}<div style="border-top:2px dashed #aaa;margin:20px 0;text-align:center;font-size:11px;color:#aaa">✂ CUT HERE</div>${copy(2,2)}</body></html>`);
    w.document.close();
    w.print();
  };

  if (step === "send") {
    return (
      <div>
        <div style={{ fontWeight: 700, marginBottom: 12, color: C.success }}>✅ Items marked as despatched</div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
          <Btn onClick={() => { doPrint(); onDone(); }}>🖨 Print (2 copies)</Btn>
          <Btn outline onClick={() => setShowEmail(true)}>✉ Email Instead</Btn>
          <Btn outline onClick={() => { doPrint(); setShowEmail(true); }}>🖨 + ✉ Both</Btn>
          <Btn outline onClick={onDone}>Skip — do later</Btn>
        </div>
        {showEmail && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input value={emailAddr} onChange={e => setEmailAddr(e.target.value)} placeholder="Email address…"
              style={{ padding: "7px 10px", border: `1px solid ${C.border}`, borderRadius: 4, fontSize: 13, width: 260 }} />
            <Btn small onClick={() => { toast("Email functionality requires email service setup"); onDone(); }}>Send</Btn>
          </div>
        )}
      </div>
    );
  }

  return (
    <div>
      {doneLines.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.textLight, marginBottom: 6 }}>PREVIOUSLY DESPATCHED</div>
          {doneLines.map((l, i) => (
            <div key={i} style={{ display: "flex", gap: 10, padding: "6px 10px", background: "#e8f5e9", borderRadius: 4, marginBottom: 4, fontSize: 13 }}>
              <span style={{ color: C.success }}>✓</span>
              <span style={{ flex: 1 }}>{l.desc} × {l.qty}</span>
              <span style={{ fontSize: 11, color: C.textLight }}>{l.despatchDate ? new Date(l.despatchDate).toLocaleDateString("en-GB") : ""}</span>
            </div>
          ))}
        </div>
      )}
      {pendingLines.length === 0 ? (
        <div style={{ color: C.textLight, fontSize: 14 }}>All items have already been despatched.</div>
      ) : (
        <>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.textLight, marginBottom: 6 }}>SELECT ITEMS GOING TODAY</div>
          {pendingLines.map((l, i) => (
            <div key={i} onClick={() => toggle(i)} style={{ display: "flex", gap: 10, alignItems: "center", padding: "8px 10px", background: selected.includes(i) ? "#e8f5e9" : C.silverLighter, borderRadius: 4, marginBottom: 4, cursor: "pointer" }}>
              <input type="checkbox" checked={selected.includes(i)} onChange={() => toggle(i)} onClick={e => e.stopPropagation()} />
              <span style={{ flex: 1, fontSize: 13 }}>{l.desc}</span>
              <span style={{ fontSize: 12, color: C.textLight }}>× {l.qty}</span>
            </div>
          ))}
          <input value={noteText} onChange={e => setNoteText(e.target.value)} placeholder="Optional note (driver, vehicle…)"
            style={{ width: "100%", padding: "7px 10px", border: `1px solid ${C.border}`, borderRadius: 4, fontSize: 13, boxSizing: "border-box", margin: "10px 0" }} />
          <Btn onClick={confirm} disabled={!selected.length}>Confirm & Create Delivery Note</Btn>
        </>
      )}
    </div>
  );
}
