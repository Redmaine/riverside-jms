import { useState, useEffect, useMemo, useCallback } from "react";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const printStyle = document.createElement("style");
printStyle.innerHTML = `@media print { .no-print { display: none !important; } @page { margin: 15mm; } }`;
document.head.appendChild(printStyle);

const SUPABASE_URL = "https://hzxfskdcluuluzpzevnz.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh6eGZza2RjbHV1bHV6cHpldm56Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc5ODM0NTQsImV4cCI6MjA5MzU1OTQ1NH0.D2mXA0yDZQFYBrh09kjlzV4W49f792XBqsP5TCpOo3s";
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const C = {
  navy: "#1a2744", navyDark: "#111c33", navyLight: "#243560",
  silver: "#8a9ab5", silverLight: "#c8d0e0", silverLighter: "#e8ecf4",
  white: "#ffffff", accent: "#2e6db4", accentLight: "#3a80d2",
  danger: "#c0392b", warning: "#e67e22", success: "#27ae60",
  text: "#1a2744", textLight: "#5a6a8a", bg: "#f0f2f7", border: "#d0d8e8"
};

const COMPANY = {
  name: "Riverside Sheetmetal Fabrications Ltd",
  address: "L2 Riverside Industrial Estate, Littlehampton, West Sussex, BN17 5DF",
  phone: "01903 732486",
  email: "info@riversidesheetmetal.co.uk"
};

const fmt = (n) => `£${(Number(n) || 0).toFixed(2)}`;
const lineTotal = (lines) => (lines || []).reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.price) || 0), 0);
const todayStr = () => new Date().toISOString().split("T")[0];
const addDays = (d, n) => { const dt = new Date(d); dt.setDate(dt.getDate() + n); return dt.toISOString().split("T")[0]; };

function useToast() {
  const [toasts, setToasts] = useState([]);
  const add = (msg, type = "success") => {
    const id = Date.now();
    setToasts(t => [...t, { id, msg, type }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3500);
  };
  return { toasts, add };
}

function Toasts({ toasts }) {
  return (
    <div style={{ position: "fixed", top: 16, right: 16, zIndex: 9999, display: "flex", flexDirection: "column", gap: 8 }}>
      {toasts.map(t => (
        <div key={t.id} style={{
          background: t.type === "error" ? C.danger : C.success, color: "#fff",
          padding: "10px 18px", borderRadius: 6, fontSize: 14, fontWeight: 600,
          boxShadow: "0 4px 16px rgba(0,0,0,0.2)", maxWidth: 320
        }}>{t.msg}</div>
      ))}
    </div>
  );
}

function Modal({ children, onClose, wide }) {
  useEffect(() => {
    const handler = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);
  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)",
      zIndex: 1000, overflowY: "auto", padding: "32px 16px"
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: C.white, borderRadius: 10, margin: "0 auto",
        width: "100%", maxWidth: wide ? 900 : 680, padding: 28,
        boxShadow: "0 8px 40px rgba(0,0,0,0.25)"
      }}>
        {children}
      </div>
    </div>
  );
}

function Btn({ children, onClick, color, outline, small, danger, disabled, style: s }) {
  const bg = disabled ? C.silverLight : danger ? C.danger : outline ? "transparent" : (color || C.accent);
  const col = outline ? (danger ? C.danger : (color || C.accent)) : C.white;
  const bdr = danger ? C.danger : outline ? (color || C.accent) : "transparent";
  return (
    <button onClick={onClick} disabled={disabled} style={{
      background: bg, color: col, border: `2px solid ${bdr}`,
      borderRadius: 6, padding: small ? "5px 12px" : "8px 18px", fontSize: small ? 12 : 14,
      fontWeight: 600, cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.6 : 1, ...s
    }}>{children}</button>
  );
}

function StatusBadge({ s }) {
  const map = {
    "Quote": { bg: "#f0e6cc", col: "#8a5e00" },
    "In Production": { bg: "#cce5cc", col: "#1a6b1a" },
    "Part Despatched": { bg: "#cce0f5", col: "#1a4a8a" },
    "Ready to Despatch": { bg: "#e0ccf5", col: "#5a1a8a" },
    "Invoiced": { bg: "#ddd", col: "#444" },
    "Needs Review": { bg: "#ffd6cc", col: "#8a2000" },
  };
  const m = map[s] || { bg: "#eee", col: "#333" };
  return <span style={{ background: m.bg, color: m.col, borderRadius: 12, padding: "3px 10px", fontSize: 12, fontWeight: 700 }}>{s}</span>;
}

function PrintHeader() {
  return (
    <div style={{ borderBottom: `3px solid ${C.navy}`, paddingBottom: 12, marginBottom: 16 }}>
      <div style={{ fontSize: 22, fontWeight: 900, color: C.navy }}>{COMPANY.name}</div>
      <div style={{ fontSize: 11, color: C.textLight, marginTop: 2 }}>{COMPANY.address}</div>
      <div style={{ fontSize: 11, color: C.textLight }}>Tel: {COMPANY.phone} | Email: {COMPANY.email}</div>
    </div>
  );
}

function JobSheetDoc({ job, onBack }) {
  return (
    <div>
      <div className="no-print" style={{ padding: 16, background: C.silverLighter, display: "flex", gap: 12, alignItems: "center", marginBottom: 16, borderRadius: 6 }}>
        <Btn onClick={onBack} outline small>← Back</Btn>
        <Btn onClick={() => window.print()} small>🖨 Print Job Sheet</Btn>
        <span style={{ fontSize: 12, color: C.textLight }}>Back button will not appear on printed copy</span>
      </div>
      <PrintHeader />
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 800, color: C.navy }}>JOB SHEET</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: C.accent }}>{job.customer_name}</div>
        </div>
        <div style={{ textAlign: "right", fontSize: 12 }}>
          <div><strong>Our Ref:</strong> {job.job_ref}</div>
          {job.po_number && <div><strong>Customer PO:</strong> {job.po_number}</div>}
          <div><strong>Due:</strong> {job.due_date ? new Date(job.due_date).toLocaleDateString("en-GB") : "—"}</div>
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
        <div style={{ background: C.silverLighter, borderRadius: 6, padding: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.textLight, marginBottom: 4 }}>CUSTOMER</div>
          <div style={{ fontWeight: 700 }}>{job.customer_name}</div>
          {job.contact_name && <div style={{ fontSize: 13 }}>{job.contact_name}</div>}
        </div>
        <div style={{ background: C.silverLighter, borderRadius: 6, padding: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.textLight, marginBottom: 4 }}>JOB INFO</div>
          <div style={{ fontSize: 13 }}>Priority: <strong>{job.priority}</strong></div>
          <div style={{ fontSize: 13 }}>Status: <strong>{job.status}</strong></div>
          {job.drawing_number && <div style={{ fontSize: 13 }}>Drawing No: <strong>{job.drawing_number}</strong></div>}
        </div>
      </div>
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: C.textLight, marginBottom: 6 }}>ITEMS TO MANUFACTURE</div>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ background: C.navy, color: C.white }}>
              <th style={{ padding: "8px 10px", textAlign: "left" }}>Description</th>
              <th style={{ padding: "8px 10px", textAlign: "center", width: 60 }}>Qty</th>
              <th style={{ padding: "8px 10px", textAlign: "left", width: 100 }}>Drawing No</th>
              <th style={{ padding: "8px 10px", textAlign: "center", width: 80 }}>Complete ✓</th>
            </tr>
          </thead>
          <tbody>
            {(job.lines || []).map((l, i) => (
              <tr key={i} style={{ background: i % 2 === 0 ? C.white : C.silverLighter }}>
                <td style={{ padding: "8px 10px" }}>{l.desc}</td>
                <td style={{ padding: "8px 10px", textAlign: "center" }}>{l.qty}</td>
                <td style={{ padding: "8px 10px" }}>{l.drawingNo || ""}</td>
                <td style={{ padding: "8px 10px" }}></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {job.notes && (
        <div style={{ background: "#fffbe6", border: "1px solid #f0d060", borderRadius: 6, padding: 10, marginBottom: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.textLight, marginBottom: 4 }}>NOTES</div>
          <div style={{ fontSize: 13 }}>{job.notes}</div>
        </div>
      )}
      {(job.stages || []).length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.textLight, marginBottom: 8 }}>PRODUCTION STAGES</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {(job.stages || []).map((s, i) => (
              <div key={i} style={{ border: `1px solid ${C.border}`, borderRadius: 6, padding: "6px 14px", fontSize: 13, display: "flex", gap: 8, alignItems: "center" }}>
                <span style={{ width: 16, height: 16, border: "1px solid #999", display: "inline-block", borderRadius: 2 }}></span>
                {s}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function QuoteDoc({ job, onBack }) {
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

function PriceSuggestions({ desc, allJobs, onSelect }) {
  const suggestions = useMemo(() => {
    if (!desc || desc.length < 3) return [];
    const d = desc.toLowerCase();
    const results = [];
    const seen = new Set();
    for (const job of allJobs) {
      for (const line of (job.lines || [])) {
        if (line.desc && line.desc.toLowerCase().includes(d)) {
          const key = `${line.desc}|${line.price}`;
          if (!seen.has(key)) {
            seen.add(key);
            results.push({ desc: line.desc, qty: line.qty, price: line.price, jobRef: job.job_ref, customer: job.customer_name });
          }
        }
      }
    }
    return results.slice(0, 5);
  }, [desc, allJobs]);
  if (!suggestions.length) return null;
  return (
    <div style={{ position: "absolute", top: "100%", left: 0, right: 0, background: C.white, border: `1px solid ${C.border}`, borderRadius: 6, zIndex: 100, boxShadow: "0 4px 16px rgba(0,0,0,0.12)" }}>
      <div style={{ padding: "4px 10px", fontSize: 11, color: C.textLight, borderBottom: `1px solid ${C.border}` }}>Previous prices — click to use</div>
      {suggestions.map((s, i) => (
        <div key={i} style={{ padding: "8px 10px", cursor: "pointer", fontSize: 12, borderBottom: `1px solid ${C.silverLighter}`, display: "flex", justifyContent: "space-between" }}
          onMouseDown={() => onSelect(s)}>
          <span>{s.desc} (x{s.qty}) — {s.jobRef} / {s.customer}</span>
          <strong style={{ color: C.accent }}>{fmt(s.price)}</strong>
        </div>
      ))}
    </div>
  );
}

function LinesEditor({ lines, setLines, allJobs }) {
  const [activeDesc, setActiveDesc] = useState(null);
  const upd = (i, f, v) => setLines(ls => ls.map((l, j) => j === i ? { ...l, [f]: v } : l));
  const add = () => setLines(ls => [...ls, { desc: "", qty: 1, price: "", drawingNo: "", despatched: false, despatchDate: null }]);
  const rem = (i) => setLines(ls => ls.filter((_, j) => j !== i));
  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 70px 100px 100px 28px", gap: 6, marginBottom: 4 }}>
        {["Description", "Qty", "Unit Price", "Drawing No", ""].map(h => (
          <div key={h} style={{ fontSize: 11, fontWeight: 700, color: C.textLight }}>{h}</div>
        ))}
      </div>
      {lines.map((l, i) => (
        <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 70px 100px 100px 28px", gap: 6, marginBottom: 6, position: "relative" }}>
          <div style={{ position: "relative" }}>
            <input value={l.desc || ""} onChange={e => { upd(i, "desc", e.target.value); setActiveDesc(i); }}
              onFocus={() => setActiveDesc(i)} onBlur={() => setTimeout(() => setActiveDesc(null), 200)}
              placeholder="Description" style={{ width: "100%", padding: "6px 8px", border: `1px solid ${C.border}`, borderRadius: 4, fontSize: 13, boxSizing: "border-box" }} />
            {activeDesc === i && <PriceSuggestions desc={l.desc} allJobs={allJobs} onSelect={s => { upd(i, "price", s.price); upd(i, "qty", s.qty); setActiveDesc(null); }} />}
          </div>
          <input value={l.qty || ""} onChange={e => upd(i, "qty", e.target.value)} type="number" min="1"
            style={{ padding: "6px 8px", border: `1px solid ${C.border}`, borderRadius: 4, fontSize: 13 }} />
          <input value={l.price || ""} onChange={e => upd(i, "price", e.target.value)} type="number" min="0" step="0.01" placeholder="0.00"
            style={{ padding: "6px 8px", border: `1px solid ${C.border}`, borderRadius: 4, fontSize: 13 }} />
          <input value={l.drawingNo || ""} onChange={e => upd(i, "drawingNo", e.target.value)} placeholder="Dwg #"
            style={{ padding: "6px 8px", border: `1px solid ${C.border}`, borderRadius: 4, fontSize: 13 }} />
          <button onClick={() => rem(i)} style={{ background: C.danger, color: C.white, border: "none", borderRadius: 4, cursor: "pointer", fontSize: 16 }}>×</button>
        </div>
      ))}
      <Btn onClick={add} outline small style={{ marginTop: 4 }}>+ Add Line</Btn>
      {lineTotal(lines) > 0 && (
        <div style={{ textAlign: "right", fontWeight: 700, fontSize: 15, marginTop: 10, color: C.navy }}>Total: {fmt(lineTotal(lines))}</div>
      )}
    </div>
  );
}

function StagesEditor({ stages, setStages }) {
  const PRESETS = ["Laser Cutting", "Cutting", "Bending", "Folding", "Welding", "Grinding", "Drilling", "Punching", "Assembly", "Powder Coat", "Galvanising", "Painting", "QC Check"];
  const [custom, setCustom] = useState("");
  return (
    <div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
        {PRESETS.map(p => {
          const on = stages.includes(p);
          return (
            <button key={p} onClick={() => setStages(s => on ? s.filter(x => x !== p) : [...s, p])} style={{
              padding: "5px 12px", border: `2px solid ${on ? C.success : C.border}`, borderRadius: 6,
              background: on ? C.success : "transparent", color: on ? C.white : C.text,
              cursor: "pointer", fontSize: 12, fontWeight: 600
            }}>{on ? "✓ " : ""}{p}</button>
          );
        })}
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <input value={custom} onChange={e => setCustom(e.target.value)} placeholder="Custom stage…"
          onKeyDown={e => { if (e.key === "Enter" && custom.trim()) { setStages(s => [...s, custom.trim()]); setCustom(""); } }}
          style={{ flex: 1, padding: "6px 10px", border: `1px solid ${C.border}`, borderRadius: 4, fontSize: 13 }} />
        <Btn small onClick={() => { if (custom.trim()) { setStages(s => [...s, custom.trim()]); setCustom(""); } }}>Add</Btn>
      </div>
    </div>
  );
}

function FileAttachments({ jobId, jobRef, toast }) {
  const [files, setFiles] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [category, setCategory] = useState("Drawing");
  const CATS = ["Drawing", "Purchase Order", "Email / Correspondence", "Other"];

  const load = useCallback(async () => {
    if (!jobId) return;
    const { data } = await supabase.from("job_files").select("*").eq("job_id", jobId).order("uploaded_at", { ascending: false });
    setFiles(data || []);
  }, [jobId]);

  useEffect(() => { load(); }, [load]);

  const handleFile = async (file) => {
    if (!file) return;
    setUploading(true);
    try {
      const path = `${jobRef}/${Date.now()}_${file.name}`;
      const { error: upErr } = await supabase.storage.from("job-files").upload(path, file);
      if (upErr) throw upErr;
      await supabase.from("job_files").insert({ job_id: jobId, job_ref: jobRef, file_name: file.name, file_path: path, category, file_type: file.type });
      toast("File attached");
      load();
    } catch (err) { toast("Upload failed: " + err.message, "error"); }
    setUploading(false);
  };

  const open = async (f) => {
    const { data } = await supabase.storage.from("job-files").createSignedUrl(f.file_path, 3600);
    if (data?.signedUrl) window.open(data.signedUrl, "_blank");
    else toast("Could not open file", "error");
  };

  const del = async (f) => {
    await supabase.storage.from("job-files").remove([f.file_path]);
    await supabase.from("job_files").delete().eq("id", f.id);
    toast("File removed");
    load();
  };

  return (
    <div>
      <div style={{ display: "flex", gap: 6, marginBottom: 8, flexWrap: "wrap" }}>
        {CATS.map(c => (
          <button key={c} onClick={() => setCategory(c)} style={{
            padding: "4px 10px", border: `2px solid ${category === c ? C.navy : C.border}`,
            borderRadius: 6, background: category === c ? C.navy : "transparent",
            color: category === c ? C.white : C.text, cursor: "pointer", fontSize: 12, fontWeight: 600
          }}>{c}</button>
        ))}
      </div>
      <div onDrop={e => { e.preventDefault(); handleFile(e.dataTransfer.files[0]); }} onDragOver={e => e.preventDefault()}
        style={{ border: `2px dashed ${C.border}`, borderRadius: 6, padding: 14, textAlign: "center", background: C.silverLighter, marginBottom: 8 }}>
        <input type="file" onChange={e => handleFile(e.target.files[0])} style={{ display: "none" }} id={`file-${jobId}`} />
        <label htmlFor={`file-${jobId}`} style={{ cursor: "pointer", fontSize: 13, color: C.textLight }}>
          {uploading ? "Uploading…" : "📎 Drag file here or click to browse"}
        </label>
      </div>
      {files.map(f => (
        <div key={f.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", background: C.silverLighter, borderRadius: 4, marginBottom: 4, fontSize: 13 }}>
          <span style={{ flex: 1 }}>{f.file_name}</span>
          <span style={{ fontSize: 11, color: C.textLight, background: "#dde", borderRadius: 10, padding: "2px 8px" }}>{f.category}</span>
          <Btn small outline onClick={() => open(f)}>Open</Btn>
          <Btn small danger onClick={() => del(f)}>✕</Btn>
        </div>
      ))}
    </div>
  );
}

function DeliveryNoteFlow({ job, onDone, toast }) {
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
    const newStatus = allDone ? "Ready to Despatch" : "Part Despatched";
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
        <div style="border-bottom:3px solid #1a2744;padding-bottom:12px;margin-bottom:16px">
          <strong style="font-size:18px;color:#1a2744">${COMPANY.name}</strong><br>
          <span style="font-size:11px;color:#666">${COMPANY.address}</span><br>
          <span style="font-size:11px;color:#666">Tel: ${COMPANY.phone} | ${COMPANY.email}</span>
        </div>
        <div style="display:flex;justify-content:space-between;margin-bottom:16px">
          <div><strong style="font-size:18px">DELIVERY NOTE</strong><br><span style="font-size:11px;color:#666">Copy ${n} of ${t}</span></div>
          <div style="text-align:right;font-size:12px">
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
    w.document.write(`<!DOCTYPE html><html><head><title>Delivery Note - ${job.job_ref}</title><style>body{font-family:Arial,sans-serif;margin:20px}</style></head><body>${copy(1,2)}<div style="border-top:2px dashed #aaa;margin:20px 0;text-align:center;font-size:11px;color:#aaa">✂ CUT HERE</div>${copy(2,2)}</body></html>`);
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

function JobForm({ job, customers, allJobs, onSave, onClose, toast }) {
  const isNew = !job;
  const blank = { customer_id: "", customer_name: "", contact_id: "", contact_name: "", description: "", po_number: "", status: "In Production", priority: "Normal", quote_ref: "", quote_status: "N/A", quote_date: todayStr(), lines: [{ desc: "", qty: 1, price: "", drawingNo: "", despatched: false, despatchDate: null }], stages: [], stages_complete: {}, drawing_number: "", drawing_attached: false, date_received: todayStr(), due_date: "", invoice_ref: "", notes: "" };
  const [form, setForm] = useState(isNew ? blank : { ...blank, ...job });
  const [lines, setLines] = useState((isNew ? blank : job).lines || [{ desc: "", qty: 1, price: "", drawingNo: "", despatched: false, despatchDate: null }]);
  const [stages, setStages] = useState((isNew ? blank : job).stages || []);
  const [laserPrompt, setLaserPrompt] = useState(false);
  const [saving, setSaving] = useState(false);

  const selCustomer = customers.find(c => c.id === form.customer_id);
  const contacts = selCustomer?.contacts || [];
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const pickCustomer = (id) => {
    const c = customers.find(x => x.id === id);
    set("customer_id", id);
    set("customer_name", c?.name || "");
    set("contact_id", "");
    set("contact_name", "");
    if (c?.name === "Tara Signs") setLaserPrompt(true);
  };

  const save = async () => {
    if (!form.customer_name) { toast("Customer is required", "error"); return; }
    setSaving(true);
    try {
      const payload = { ...form, lines, stages, stages_complete: form.stages_complete || {} };
      if (isNew) {
        const { data: cnt } = await supabase.rpc("increment_job_counter");
        payload.job_ref = `R${String(cnt).padStart(6, "0")}`;
      }
      delete payload.id;
      const { error } = isNew
        ? await supabase.from("jobs").insert(payload)
        : await supabase.from("jobs").update(payload).eq("id", job.id);
      if (error) throw error;
      toast(isNew ? `Job ${payload.job_ref} created` : "Job updated");
      onSave();
    } catch (e) { toast("Save failed: " + e.message, "error"); }
    setSaving(false);
  };

  const inp = { padding: "7px 10px", border: `1px solid ${C.border}`, borderRadius: 4, fontSize: 13, width: "100%", boxSizing: "border-box" };
  const lbl = { fontSize: 12, fontWeight: 600, color: C.textLight, marginBottom: 4, display: "block" };

  return (
    <Modal onClose={onClose} wide>
      {laserPrompt && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 2000, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ background: C.white, borderRadius: 10, padding: 28, maxWidth: 380, textAlign: "center" }}>
            <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 10 }}>Tara Signs Order</div>
            <div style={{ fontSize: 14, marginBottom: 20, color: C.textLight }}>Is laser cutting required for this order?</div>
            <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
              <Btn onClick={() => { setStages(s => s.includes("Laser Cutting") ? s : ["Laser Cutting", ...s]); setLaserPrompt(false); }}>Yes</Btn>
              <Btn outline onClick={() => setLaserPrompt(false)}>No</Btn>
            </div>
          </div>
        </div>
      )}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <div style={{ fontSize: 18, fontWeight: 800, color: C.navy }}>{isNew ? "New Job" : `Edit ${job.job_ref}`}</div>
        <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer" }}>×</button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
        <div>
          <label style={lbl}>Customer *</label>
          <select value={form.customer_id} onChange={e => pickCustomer(e.target.value)} style={inp}>
            <option value="">Select customer…</option>
            {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div>
          <label style={lbl}>Contact</label>
          <select value={form.contact_id} onChange={e => { const ct = contacts.find(c => c.id === e.target.value); set("contact_id", e.target.value); set("contact_name", ct?.name || ""); }} style={inp}>
            <option value="">Select contact…</option>
            {contacts.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div>
          <label style={lbl}>PO Number</label>
          <input value={form.po_number || ""} onChange={e => set("po_number", e.target.value)} style={inp} placeholder="Customer PO #" />
        </div>
        <div>
          <label style={lbl}>Status</label>
          <select value={form.status} onChange={e => set("status", e.target.value)} style={inp}>
            {["Quote", "In Production", "Part Despatched", "Ready to Despatch", "Invoiced", "Needs Review"].map(s => <option key={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <label style={lbl}>Priority</label>
          <select value={form.priority} onChange={e => set("priority", e.target.value)} style={inp}>
            {["Low", "Normal", "High", "Urgent"].map(p => <option key={p}>{p}</option>)}
          </select>
        </div>
        <div>
          <label style={lbl}>Date Received</label>
          <input type="date" value={form.date_received || ""} onChange={e => set("date_received", e.target.value)} style={inp} />
        </div>
        <div>
          <label style={lbl}>Due Date</label>
          <input type="date" value={form.due_date || ""} onChange={e => set("due_date", e.target.value)} style={inp} />
        </div>
        <div>
          <label style={lbl}>Quote Date</label>
          <input type="date" value={form.quote_date || ""} onChange={e => set("quote_date", e.target.value)} style={inp} />
        </div>
        <div>
          <label style={lbl}>Drawing Number</label>
          <input value={form.drawing_number || ""} onChange={e => set("drawing_number", e.target.value)} style={inp} placeholder="Drawing ref" />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, paddingTop: 20 }}>
          <input type="checkbox" checked={!!form.drawing_attached} onChange={e => set("drawing_attached", e.target.checked)} id="da" />
          <label htmlFor="da" style={{ fontSize: 13 }}>Drawing attached</label>
        </div>
      </div>
      <div style={{ marginBottom: 14 }}>
        <label style={lbl}>Notes</label>
        <textarea value={form.notes || ""} onChange={e => set("notes", e.target.value)} rows={2}
          style={{ ...inp, resize: "vertical" }} placeholder="Additional notes…" />
      </div>
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: C.navy, marginBottom: 8 }}>Order Lines</div>
        <LinesEditor lines={lines} setLines={setLines} allJobs={allJobs} />
      </div>
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: C.navy, marginBottom: 8 }}>Production Stages</div>
        <StagesEditor stages={stages} setStages={setStages} />
      </div>
      <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
        <Btn outline onClick={onClose}>Cancel</Btn>
        <Btn onClick={save} disabled={saving}>{saving ? "Saving…" : isNew ? "Create Job" : "Save Changes"}</Btn>
      </div>
    </Modal>
  );
}

function CustomerForm({ customer, onSave, onClose, toast }) {
  const [name, setName] = useState(customer?.name || "");
  const [contacts, setContacts] = useState(customer?.contacts || []);
  const [notes, setNotes] = useState(customer?.notes || "");
  const [saving, setSaving] = useState(false);

  const addContact = () => setContacts(cs => [...cs, { id: Date.now().toString(), name: "", email: "", phone: "" }]);
  const updContact = (id, f, v) => setContacts(cs => cs.map(c => c.id === id ? { ...c, [f]: v } : c));
  const remContact = (id) => setContacts(cs => cs.filter(c => c.id !== id));

  const save = async () => {
    if (!name.trim()) { toast("Name required", "error"); return; }
    setSaving(true);
    try {
      const payload = { name: name.trim(), contacts, notes };
      const { error } = customer
        ? await supabase.from("customers").update(payload).eq("id", customer.id)
        : await supabase.from("customers").insert(payload);
      if (error) throw error;
      toast(customer ? "Customer updated" : `${name} added`);
      onSave();
    } catch (e) { toast("Save failed: " + e.message, "error"); }
    setSaving(false);
  };

  const inp = { padding: "7px 10px", border: `1px solid ${C.border}`, borderRadius: 4, fontSize: 13 };
  return (
    <Modal onClose={onClose}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16 }}>
        <div style={{ fontSize: 18, fontWeight: 800, color: C.navy }}>{customer ? "Edit Customer" : "New Customer"}</div>
        <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer" }}>×</button>
      </div>
      <div style={{ marginBottom: 12 }}>
        <label style={{ fontSize: 12, fontWeight: 600, color: C.textLight, display: "block", marginBottom: 4 }}>Company Name *</label>
        <input value={name} onChange={e => setName(e.target.value)} style={{ ...inp, width: "100%", boxSizing: "border-box" }} />
      </div>
      <div style={{ marginBottom: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <label style={{ fontSize: 12, fontWeight: 600, color: C.textLight }}>Contacts</label>
          <Btn small onClick={addContact}>+ Add Contact</Btn>
        </div>
        {contacts.map(c => (
          <div key={c.id} style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 28px", gap: 6, marginBottom: 6 }}>
            <input value={c.name} onChange={e => updContact(c.id, "name", e.target.value)} placeholder="Name" style={inp} />
            <input value={c.email} onChange={e => updContact(c.id, "email", e.target.value)} placeholder="Email" style={inp} />
            <input value={c.phone} onChange={e => updContact(c.id, "phone", e.target.value)} placeholder="Phone" style={inp} />
            <button onClick={() => remContact(c.id)} style={{ background: C.danger, color: C.white, border: "none", borderRadius: 4, cursor: "pointer" }}>×</button>
          </div>
        ))}
      </div>
      <div style={{ marginBottom: 16 }}>
        <label style={{ fontSize: 12, fontWeight: 600, color: C.textLight, display: "block", marginBottom: 4 }}>Notes</label>
        <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
          style={{ ...inp, width: "100%", boxSizing: "border-box", resize: "vertical" }} />
      </div>
      <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
        <Btn outline onClick={onClose}>Cancel</Btn>
        <Btn onClick={save} disabled={saving}>{saving ? "Saving…" : "Save Customer"}</Btn>
      </div>
    </Modal>
  );
}

function JobDetail({ job: initialJob, jobs, customers, onClose, onRefresh, toast }) {
  const [job, setJob] = useState(initialJob);
  const [view, setView] = useState("detail");
  const [editing, setEditing] = useState(false);
  const [showDN, setShowDN] = useState(false);
  const [invoiceRef, setInvoiceRef] = useState("");
  const [showInvoicePrompt, setShowInvoicePrompt] = useState(false);

  const reload = async () => {
    try {
      const { data } = await supabase.from("jobs").select("*").eq("id", job.id).single();
      if (data) setJob(data);
    } catch (e) { console.error("Reload error", e); }
  };

  const flow = ["Quote", "In Production", "Part Despatched", "Ready to Despatch", "Invoiced"];
  const idx = flow.indexOf(job.status);

  const advance = async () => {
    if (idx < 0 || idx >= flow.length - 1) return;
    const next = flow[idx + 1];
    if (next === "Invoiced") { setShowInvoicePrompt(true); return; }
    await supabase.from("jobs").update({ status: next }).eq("id", job.id);
    toast("Job moved to " + next);
    setJob(j => ({ ...j, status: next }));
    onRefresh();
  };

  const confirmInvoice = async () => {
    await supabase.from("jobs").update({ status: "Invoiced", invoice_ref: invoiceRef }).eq("id", job.id);
    toast("Job invoiced");
    setJob(j => ({ ...j, status: "Invoiced", invoice_ref: invoiceRef }));
    setShowInvoicePrompt(false);
    onRefresh();
  };

  const tickStage = async (s) => {
    const sc = { ...(job.stages_complete || {}) };
    sc[s] = !sc[s];
    await supabase.from("jobs").update({ stages_complete: sc }).eq("id", job.id);
    setJob(j => ({ ...j, stages_complete: sc }));
  };

  const isOverdue = job.due_date && job.status !== "Invoiced" && new Date(job.due_date) < new Date();

  if (view === "jobsheet") return <JobSheetDoc job={job} onBack={() => setView("detail")} />;
  if (view === "quote") return <QuoteDoc job={job} onBack={() => setView("detail")} />;

  if (editing) return (
    <JobForm job={job} customers={customers} allJobs={jobs}
      onSave={() => { reload(); setEditing(false); onRefresh(); }}
      onClose={() => setEditing(false)} toast={toast} />
  );

  return (
    <Modal onClose={onClose} wide>
      {showInvoicePrompt && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 2000, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ background: C.white, borderRadius: 10, padding: 28, maxWidth: 380 }}>
            <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 12 }}>Enter QB Invoice Reference</div>
            <input value={invoiceRef} onChange={e => setInvoiceRef(e.target.value)} placeholder="QB Invoice #"
              style={{ width: "100%", padding: "8px 10px", border: `1px solid ${C.border}`, borderRadius: 4, fontSize: 14, boxSizing: "border-box", marginBottom: 14 }} />
            <div style={{ display: "flex", gap: 10 }}>
              <Btn onClick={confirmInvoice}>Confirm Invoiced</Btn>
              <Btn outline onClick={() => setShowInvoicePrompt(false)}>Cancel</Btn>
            </div>
          </div>
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 900, color: C.navy }}>{job.job_ref}</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: C.accent }}>{job.customer_name}</div>
          {job.contact_name && <div style={{ fontSize: 13, color: C.textLight }}>{job.contact_name}</div>}
          {job.po_number && <div style={{ fontSize: 13 }}><strong>PO:</strong> {job.po_number}</div>}
          {job.invoice_ref && <div style={{ fontSize: 13 }}><strong>Invoice Ref:</strong> {job.invoice_ref}</div>}
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end", alignItems: "flex-start" }}>
          <StatusBadge s={job.status} />
          {job.priority === "Urgent" && <span style={{ background: C.danger, color: C.white, borderRadius: 12, padding: "3px 10px", fontSize: 12, fontWeight: 700 }}>URGENT</span>}
          {isOverdue && <span style={{ background: C.warning, color: C.white, borderRadius: 12, padding: "3px 10px", fontSize: 12, fontWeight: 700 }}>OVERDUE</span>}
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: C.textLight }}>×</button>
        </div>
      </div>

      <div style={{ display: "flex", gap: 4, marginBottom: 16, flexWrap: "wrap" }}>
        {flow.map((s, i) => (
          <div key={s} style={{
            flex: 1, minWidth: 80, textAlign: "center", padding: "6px 4px", borderRadius: 4, fontSize: 11, fontWeight: 600,
            background: i === idx ? C.navy : i < idx ? C.success : C.silverLighter,
            color: i <= idx ? C.white : C.textLight
          }}>{s}</div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 10, marginBottom: 16 }}>
        {[
          { label: "Received", val: job.date_received ? new Date(job.date_received).toLocaleDateString("en-GB") : "—" },
          { label: "Due", val: job.due_date ? new Date(job.due_date).toLocaleDateString("en-GB") : "—" },
          { label: "Total Value", val: fmt(lineTotal(job.lines)) },
          { label: "Drawing No", val: job.drawing_number || "—" },
        ].map(({ label, val }) => (
          <div key={label} style={{ background: C.silverLighter, borderRadius: 6, padding: "8px 12px" }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: C.textLight, marginBottom: 2 }}>{label}</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: C.navy }}>{val}</div>
          </div>
        ))}
      </div>

      {(job.lines || []).length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.textLight, marginBottom: 6 }}>ORDER LINES</div>
          {(job.lines || []).map((l, i) => (
            <div key={i} style={{
              display: "grid", gridTemplateColumns: "1fr 60px 80px 100px", gap: 8,
              padding: "7px 10px", marginBottom: 4,
              background: l.despatched ? "#e8f5e9" : C.silverLighter, borderRadius: 4, fontSize: 13
            }}>
              <span style={{ textDecoration: l.despatched ? "line-through" : "none", color: l.despatched ? C.textLight : C.text }}>
                {l.despatched ? "✓ " : ""}{l.desc}
              </span>
              <span style={{ textAlign: "center" }}>× {l.qty}</span>
              <span style={{ textAlign: "right" }}>{fmt((l.qty || 0) * (l.price || 0))}</span>
              <span style={{ fontSize: 11, color: C.textLight }}>
                {l.despatched && l.despatchDate ? new Date(l.despatchDate).toLocaleDateString("en-GB") : (l.drawingNo || "")}
              </span>
            </div>
          ))}
          <div style={{ textAlign: "right", fontWeight: 700, color: C.navy, fontSize: 15, padding: "4px 10px" }}>
            Total: {fmt(lineTotal(job.lines))}
          </div>
        </div>
      )}

      {(job.stages || []).length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.textLight, marginBottom: 6 }}>PRODUCTION STAGES</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {(job.stages || []).map(s => {
              const done = !!(job.stages_complete || {})[s];
              return (
                <button key={s} onClick={() => tickStage(s)} style={{
                  padding: "6px 14px", borderRadius: 16, border: `2px solid ${done ? C.success : C.border}`,
                  background: done ? C.success : C.white, color: done ? C.white : C.text,
                  cursor: "pointer", fontSize: 13, fontWeight: 600
                }}>{done ? "✓ " : ""}{s}</button>
              );
            })}
          </div>
        </div>
      )}

      {job.notes && (
        <div style={{ background: "#fffbe6", border: "1px solid #f0d060", borderRadius: 6, padding: 10, marginBottom: 14, fontSize: 13 }}>
          <strong>Notes:</strong> {job.notes}
        </div>
      )}

      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: C.textLight, marginBottom: 6 }}>ATTACHED FILES</div>
        <FileAttachments jobId={job.id} jobRef={job.job_ref} toast={toast} />
      </div>

      {showDN && (
        <div style={{ marginBottom: 16, padding: 14, background: C.silverLighter, borderRadius: 8 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: C.navy, marginBottom: 10 }}>📋 Delivery Note</div>
          <DeliveryNoteFlow job={job} toast={toast} onDone={() => { setShowDN(false); reload(); onRefresh(); }} />
        </div>
      )}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
        <Btn onClick={() => setEditing(true)} outline small>✏ Edit</Btn>
        {job.status !== "Invoiced" && idx < flow.length - 1 && (
          <Btn onClick={advance} small color={C.success}>→ {flow[idx + 1]}</Btn>
        )}
        {!["Quote", "Invoiced"].includes(job.status) && (
          <Btn onClick={() => setShowDN(!showDN)} small outline>📋 Delivery Note</Btn>
        )}
        <Btn onClick={() => setView("jobsheet")} small outline>🖨 Job Sheet</Btn>
        {job.status === "Quote" && <Btn onClick={() => setView("quote")} small outline>📄 Print Quote</Btn>}
      </div>
    </Modal>
  );
}

function HRModule({ toast }) {
  const [employees, setEmployees] = useState(() => {
    try { return JSON.parse(localStorage.getItem("rsm_hr_employees") || "[]"); } catch { return []; }
  });
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: "", title: "", startDate: todayStr() });
  const [leaveForm, setLeaveForm] = useState(null);
  const HOLIDAY_ALLOWANCE = 28;

  const save = (emps) => {
    setEmployees(emps);
    try { localStorage.setItem("rsm_hr_employees", JSON.stringify(emps)); } catch {}
  };

  const holidayYearStart = () => {
    const now = new Date();
    const yr = now.getMonth() >= 10 ? now.getFullYear() : now.getFullYear() - 1;
    return new Date(yr, 10, 1);
  };

  const workingDays = (from, to) => {
    if (!from || !to) return 0;
    let count = 0;
    const cur = new Date(from);
    const end = new Date(to);
    while (cur <= end) {
      const d = cur.getDay();
      if (d !== 0 && d !== 6) count++;
      cur.setDate(cur.getDate() + 1);
    }
    return count;
  };

  const holidayTaken = (emp) => {
    const yrStart = holidayYearStart();
    return (emp.leave || []).filter(l => l.type === "Holiday" && new Date(l.from) >= yrStart)
      .reduce((s, l) => s + workingDays(l.from, l.to), 0);
  };

  const sickDays = (emp) => (emp.leave || []).filter(l => l.type === "Sickness")
    .reduce((s, l) => s + workingDays(l.from, l.to), 0);

  const addEmployee = () => {
    if (!form.name.trim()) return;
    save([...employees, { id: Date.now().toString(), ...form, leave: [] }]);
    setForm({ name: "", title: "", startDate: todayStr() });
    setShowForm(false);
    toast("Employee added");
  };

  const addLeave = () => {
    if (!leaveForm || !leaveForm.from || !leaveForm.to) return;
    const emps = employees.map(e => e.id === leaveForm.empId
      ? { ...e, leave: [...(e.leave || []), { id: Date.now().toString(), type: leaveForm.type, from: leaveForm.from, to: leaveForm.to }] }
      : e);
    save(emps);
    setLeaveForm(null);
    toast("Leave recorded");
  };

  const delLeave = (empId, leaveId) => save(employees.map(e => e.id === empId ? { ...e, leave: (e.leave || []).filter(l => l.id !== leaveId) } : e));
  const delEmployee = (id) => { if (window.confirm("Remove employee?")) save(employees.filter(e => e.id !== id)); };

  const inp = { padding: "7px 10px", border: `1px solid ${C.border}`, borderRadius: 4, fontSize: 13 };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <div style={{ fontSize: 20, fontWeight: 800, color: C.navy }}>HR — Holiday &amp; Sickness</div>
        <Btn onClick={() => setShowForm(true)}>+ Add Employee</Btn>
      </div>
      <div style={{ fontSize: 12, color: C.textLight, marginBottom: 16 }}>Holiday year: 1 Nov – 31 Oct | Allowance: {HOLIDAY_ALLOWANCE} days | Sickness: unpaid</div>

      {showForm && (
        <div style={{ background: C.silverLighter, borderRadius: 8, padding: 16, marginBottom: 20 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 150px", gap: 10, marginBottom: 10 }}>
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, color: C.textLight, display: "block", marginBottom: 4 }}>Full Name</label>
              <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} style={{ ...inp, width: "100%", boxSizing: "border-box" }} />
            </div>
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, color: C.textLight, display: "block", marginBottom: 4 }}>Job Title</label>
              <input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} style={{ ...inp, width: "100%", boxSizing: "border-box" }} />
            </div>
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, color: C.textLight, display: "block", marginBottom: 4 }}>Start Date</label>
              <input type="date" value={form.startDate} onChange={e => setForm(f => ({ ...f, startDate: e.target.value }))} style={inp} />
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <Btn onClick={addEmployee}>Save Employee</Btn>
            <Btn outline onClick={() => setShowForm(false)}>Cancel</Btn>
          </div>
        </div>
      )}

      {leaveForm && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ background: C.white, borderRadius: 10, padding: 24, maxWidth: 380, width: "90%" }}>
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 14 }}>Add Leave — {employees.find(e => e.id === leaveForm.empId)?.name}</div>
            <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
              {["Holiday", "Sickness"].map(t => (
                <button key={t} onClick={() => setLeaveForm(f => ({ ...f, type: t }))} style={{
                  padding: "6px 14px", border: `2px solid ${leaveForm.type === t ? C.navy : C.border}`,
                  borderRadius: 6, background: leaveForm.type === t ? C.navy : "transparent",
                  color: leaveForm.type === t ? C.white : C.text, cursor: "pointer", fontSize: 13, fontWeight: 600
                }}>{t === "Holiday" ? "🌴" : "🤒"} {t}</button>
              ))}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: C.textLight, display: "block", marginBottom: 4 }}>From</label>
                <input type="date" value={leaveForm.from || ""} onChange={e => setLeaveForm(f => ({ ...f, from: e.target.value }))} style={inp} />
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: C.textLight, display: "block", marginBottom: 4 }}>To</label>
                <input type="date" value={leaveForm.to || ""} onChange={e => setLeaveForm(f => ({ ...f, to: e.target.value }))} style={inp} />
              </div>
            </div>
            {leaveForm.from && leaveForm.to && (
              <div style={{ fontSize: 13, color: C.textLight, marginBottom: 12 }}>Working days: <strong>{workingDays(leaveForm.from, leaveForm.to)}</strong></div>
            )}
            <div style={{ display: "flex", gap: 10 }}>
              <Btn onClick={addLeave}>Save Leave</Btn>
              <Btn outline onClick={() => setLeaveForm(null)}>Cancel</Btn>
            </div>
          </div>
        </div>
      )}

      {employees.length === 0 && (
        <div style={{ textAlign: "center", padding: 40, color: C.textLight }}>No employees added yet. Click + Add Employee to start.</div>
      )}

      {employees.map(emp => {
        const taken = holidayTaken(emp);
        const remaining = HOLIDAY_ALLOWANCE - taken;
        const sick = sickDays(emp);
        const pct = Math.min(100, (taken / HOLIDAY_ALLOWANCE) * 100);
        return (
          <div key={emp.id} style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 8, padding: 18, marginBottom: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
              <div>
                <div style={{ fontSize: 16, fontWeight: 800, color: C.navy }}>{emp.name}</div>
                <div style={{ fontSize: 13, color: C.textLight }}>{emp.title}{emp.startDate ? ` · Started ${new Date(emp.startDate).toLocaleDateString("en-GB")}` : ""}</div>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <Btn small onClick={() => setLeaveForm({ empId: emp.id, type: "Holiday", from: todayStr(), to: todayStr() })}>+ Add Leave</Btn>
                <Btn small danger onClick={() => delEmployee(emp.id)}>Remove</Btn>
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 10 }}>
              <div style={{ background: C.silverLighter, borderRadius: 6, padding: "10px 14px" }}>
                <div style={{ fontSize: 11, color: C.textLight, fontWeight: 600 }}>HOLIDAY TAKEN</div>
                <div style={{ fontSize: 22, fontWeight: 900, color: C.navy }}>{taken}</div>
                <div style={{ fontSize: 11, color: C.textLight }}>of {HOLIDAY_ALLOWANCE} days</div>
              </div>
              <div style={{ background: remaining <= 5 ? "#fff0f0" : "#e8f5e9", borderRadius: 6, padding: "10px 14px" }}>
                <div style={{ fontSize: 11, color: C.textLight, fontWeight: 600 }}>REMAINING</div>
                <div style={{ fontSize: 22, fontWeight: 900, color: remaining <= 5 ? C.danger : C.success }}>{remaining}</div>
                <div style={{ fontSize: 11, color: C.textLight }}>days left</div>
              </div>
              <div style={{ background: sick >= 5 ? "#fff0f0" : C.silverLighter, borderRadius: 6, padding: "10px 14px" }}>
                <div style={{ fontSize: 11, color: C.textLight, fontWeight: 600 }}>SICK DAYS</div>
                <div style={{ fontSize: 22, fontWeight: 900, color: sick >= 5 ? C.danger : C.navy }}>{sick}</div>
                <div style={{ fontSize: 11, color: C.textLight }}>total (unpaid)</div>
              </div>
            </div>
            <div style={{ background: "#eee", borderRadius: 4, height: 8, marginBottom: 10, overflow: "hidden" }}>
              <div style={{ background: pct > 85 ? C.danger : C.accent, width: `${pct}%`, height: "100%", borderRadius: 4 }}></div>
            </div>
            {(emp.leave || []).length > 0 && (
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: C.textLight, marginBottom: 6 }}>LEAVE HISTORY</div>
                {[...(emp.leave || [])].sort((a, b) => new Date(b.from) - new Date(a.from)).map(l => (
                  <div key={l.id} style={{ display: "flex", gap: 10, alignItems: "center", padding: "5px 10px", background: l.type === "Holiday" ? "#e8f5e9" : "#fff0f0", borderRadius: 4, marginBottom: 3, fontSize: 12 }}>
                    <span>{l.type === "Holiday" ? "🌴" : "🤒"}</span>
                    <span style={{ flex: 1 }}>{l.type}: {new Date(l.from).toLocaleDateString("en-GB")} – {new Date(l.to).toLocaleDateString("en-GB")}</span>
                    <span style={{ color: C.textLight }}>{workingDays(l.from, l.to)} days</span>
                    <button onClick={() => delLeave(emp.id, l.id)} style={{ background: "none", border: "none", color: C.danger, cursor: "pointer", fontSize: 16 }}>×</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function CustomerDetail({ customer, jobs, onClose, onEdit, onJobClick }) {
  const custJobs = jobs.filter(j => j.customer_id === customer.id || j.customer_name === customer.name);
  return (
    <Modal onClose={onClose} wide>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 900, color: C.navy }}>{customer.name}</div>
          {customer.notes && <div style={{ fontSize: 13, color: C.textLight, marginTop: 4 }}>{customer.notes}</div>}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Btn small outline onClick={() => onEdit(customer)}>✏ Edit</Btn>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer" }}>×</button>
        </div>
      </div>
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: C.textLight, marginBottom: 8 }}>CONTACTS</div>
        {(customer.contacts || []).length === 0 && <div style={{ color: C.textLight, fontSize: 13 }}>No contacts added</div>}
        {(customer.contacts || []).map(c => (
          <div key={c.id} style={{ display: "flex", gap: 16, padding: "8px 12px", background: C.silverLighter, borderRadius: 6, marginBottom: 6, fontSize: 13 }}>
            <strong style={{ minWidth: 120 }}>{c.name}</strong>
            {c.email && <a href={`mailto:${c.email}`} style={{ color: C.accent }}>{c.email}</a>}
            {c.phone && <span>{c.phone}</span>}
          </div>
        ))}
      </div>
      <div>
        <div style={{ fontSize: 12, fontWeight: 700, color: C.textLight, marginBottom: 8 }}>ORDER HISTORY</div>
        {custJobs.length === 0 && <div style={{ color: C.textLight, fontSize: 13 }}>No orders yet</div>}
        {custJobs.map(j => (
          <div key={j.id} onClick={() => onJobClick(j)} style={{ padding: "10px 14px", background: C.silverLighter, borderRadius: 6, marginBottom: 6, cursor: "pointer" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
              <strong style={{ color: C.accent }}>{j.job_ref}</strong>
              <div style={{ display: "flex", gap: 8 }}>
                <StatusBadge s={j.status} />
                <strong>{fmt(lineTotal(j.lines))}</strong>
              </div>
            </div>
            {j.po_number && <div style={{ fontSize: 12, color: C.textLight }}>PO: {j.po_number}</div>}
            {(j.lines || []).map((l, i) => (
              <div key={i} style={{ fontSize: 12, color: C.textLight }}>• {l.desc} × {l.qty} — {fmt((l.qty || 0) * (l.price || 0))}</div>
            ))}
          </div>
        ))}
        {custJobs.length > 0 && (
          <div style={{ textAlign: "right", fontWeight: 700, marginTop: 8, color: C.navy }}>
            Total business: {fmt(custJobs.reduce((s, j) => s + lineTotal(j.lines), 0))}
          </div>
        )}
      </div>
    </Modal>
  );
}

function Dashboard({ jobs, onJobClick }) {
  const pipeline = jobs.filter(j => j.status === "In Production").reduce((a, j) => a + lineTotal(j.lines), 0);
  const overdue = jobs.filter(j => j.due_date && j.status !== "Invoiced" && new Date(j.due_date) < new Date()).length;
  const awaitingInvoice = jobs.filter(j => j.status === "Ready to Despatch").length;
  const tomorrowStr = addDays(todayStr(), 1);
  const dueTomorrow = jobs.filter(j => j.due_date === tomorrowStr && !["Ready to Despatch", "Invoiced"].includes(j.status)).length;
  const statuses = ["Quote", "In Production", "Part Despatched", "Ready to Despatch", "Invoiced"];
  const recentJobs = [...jobs].sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0)).slice(0, 10);

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 14, marginBottom: 24 }}>
        {[
          { label: "In Production Value", val: fmt(pipeline), color: C.accent },
          { label: "Overdue Jobs", val: overdue, color: overdue > 0 ? C.danger : C.success },
          { label: "Awaiting Invoice", val: awaitingInvoice, color: awaitingInvoice > 0 ? C.warning : C.success },
          { label: "Due Tomorrow", val: dueTomorrow, color: dueTomorrow > 0 ? C.warning : C.success },
        ].map(({ label, val, color }) => (
          <div key={label} style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 8, padding: 16 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: C.textLight, marginBottom: 4, letterSpacing: 0.5 }}>{label.toUpperCase()}</div>
            <div style={{ fontSize: 26, fontWeight: 900, color }}>{val}</div>
          </div>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 10, marginBottom: 24 }}>
        {statuses.map(s => (
          <div key={s} style={{ background: C.navy, color: C.white, borderRadius: 8, padding: "12px 14px", textAlign: "center" }}>
            <div style={{ fontSize: 28, fontWeight: 900 }}>{jobs.filter(j => j.status === s).length}</div>
            <div style={{ fontSize: 10, opacity: 0.75, marginTop: 2 }}>{s}</div>
          </div>
        ))}
      </div>
      <div style={{ fontSize: 13, fontWeight: 700, color: C.textLight, marginBottom: 10 }}>RECENT JOBS</div>
      {recentJobs.map(j => {
        const isOverdue = j.due_date && j.status !== "Invoiced" && new Date(j.due_date) < new Date();
        return (
          <div key={j.id} onClick={() => onJobClick(j)}
            style={{ padding: "12px 14px", background: C.white, border: `1px solid ${isOverdue ? C.warning : C.border}`, borderRadius: 6, marginBottom: 6, cursor: "pointer" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <strong style={{ color: C.accent }}>{j.job_ref}</strong>
                <span style={{ fontWeight: 600 }}>{j.customer_name}</span>
                {j.po_number && <span style={{ fontSize: 12, color: C.textLight }}>PO: {j.po_number}</span>}
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <StatusBadge s={j.status} />
                <span style={{ fontWeight: 700, fontSize: 14 }}>{fmt(lineTotal(j.lines))}</span>
              </div>
            </div>
            {(j.lines || []).map((l, i) => (
              <div key={i} style={{ fontSize: 12, color: C.textLight }}>
                {l.despatched ? <span style={{ color: C.success }}>✓ </span> : "• "}
                {l.desc} × {l.qty}
                {l.despatched && l.despatchDate ? <span style={{ fontSize: 11, marginLeft: 6 }}>({new Date(l.despatchDate).toLocaleDateString("en-GB")})</span> : null}
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

function JobsList({ jobs, onJobClick }) {
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("All");
  const statuses = ["All", "Quote", "In Production", "Part Despatched", "Ready to Despatch", "Invoiced", "Needs Review"];
  const filtered = jobs.filter(j => {
    const q = search.toLowerCase();
    const matchSearch = !q || (j.job_ref || "").toLowerCase().includes(q) || (j.customer_name || "").toLowerCase().includes(q) || (j.po_number || "").toLowerCase().includes(q) || (j.lines || []).some(l => (l.desc || "").toLowerCase().includes(q));
    return matchSearch && (filterStatus === "All" || j.status === filterStatus);
  });
  return (
    <div>
      <div style={{ display: "flex", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search jobs, customers, PO, items…"
          style={{ flex: 1, minWidth: 200, padding: "8px 12px", border: `1px solid ${C.border}`, borderRadius: 6, fontSize: 13 }} />
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
          style={{ padding: "8px 12px", border: `1px solid ${C.border}`, borderRadius: 6, fontSize: 13 }}>
          {statuses.map(s => <option key={s}>{s}</option>)}
        </select>
      </div>
      <div style={{ fontSize: 12, color: C.textLight, marginBottom: 8 }}>{filtered.length} job{filtered.length !== 1 ? "s" : ""}</div>
      {filtered.map(j => {
        const isOverdue = j.due_date && j.status !== "Invoiced" && new Date(j.due_date) < new Date();
        return (
          <div key={j.id} onClick={() => onJobClick(j)}
            style={{ padding: "12px 14px", background: C.white, border: `1px solid ${isOverdue ? C.warning : C.border}`, borderRadius: 6, marginBottom: 6, cursor: "pointer" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <strong style={{ color: C.accent }}>{j.job_ref}</strong>
                <span style={{ fontWeight: 600 }}>{j.customer_name}</span>
                {j.po_number && <span style={{ fontSize: 12, color: C.textLight }}>PO: {j.po_number}</span>}
                {j.due_date && <span style={{ fontSize: 12, color: isOverdue ? C.danger : C.textLight }}>Due: {new Date(j.due_date).toLocaleDateString("en-GB")}</span>}
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <StatusBadge s={j.status} />
                <span style={{ fontWeight: 700 }}>{fmt(lineTotal(j.lines))}</span>
              </div>
            </div>
            {(j.lines || []).map((l, i) => (
              <div key={i} style={{ fontSize: 12, color: C.textLight }}>
                {l.despatched ? <span style={{ color: C.success }}>✓ </span> : "• "}
                {l.desc} × {l.qty}
                {l.despatched && l.despatchDate ? <span style={{ fontSize: 11, marginLeft: 6 }}>({new Date(l.despatchDate).toLocaleDateString("en-GB")})</span> : null}
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

function CustomersList({ customers, jobs, onEdit, onCustomerClick }) {
  const [search, setSearch] = useState("");
  const filtered = customers.filter(c => !search || c.name.toLowerCase().includes(search.toLowerCase()));
  return (
    <div>
      <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search customers…"
        style={{ width: "100%", padding: "8px 12px", border: `1px solid ${C.border}`, borderRadius: 6, fontSize: 13, marginBottom: 14, boxSizing: "border-box" }} />
      {filtered.map(c => {
        const custJobs = jobs.filter(j => j.customer_id === c.id || j.customer_name === c.name);
        const uninvoiced = custJobs.filter(j => j.status === "Ready to Despatch");
        return (
          <div key={c.id} onDoubleClick={() => onCustomerClick(c)}
            style={{ padding: "12px 14px", background: C.white, border: `1px solid ${uninvoiced.length > 0 ? C.warning : C.border}`, borderRadius: 6, marginBottom: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 15 }}>{c.name}</div>
                <div style={{ fontSize: 12, color: C.textLight }}>{(c.contacts || []).length} contact{(c.contacts || []).length !== 1 ? "s" : ""} · {custJobs.length} orders</div>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                {uninvoiced.length > 0 && <span style={{ background: C.warning, color: C.white, borderRadius: 12, padding: "3px 10px", fontSize: 12, fontWeight: 700 }}>⚠ Awaiting Invoice</span>}
                <Btn small outline onClick={e => { e.stopPropagation(); onEdit(c); }}>✏ Edit</Btn>
                <Btn small outline onClick={() => onCustomerClick(c)}>View</Btn>
              </div>
            </div>
            {(c.contacts || []).map(ct => (
              <div key={ct.id} style={{ display: "flex", gap: 12, fontSize: 12, color: C.textLight, marginBottom: 2 }}>
                <span style={{ fontWeight: 600 }}>{ct.name}</span>
                {ct.email && <a href={`mailto:${ct.email}`} onClick={e => e.stopPropagation()} style={{ color: C.accent }}>{ct.email}</a>}
                {ct.phone && <span>{ct.phone}</span>}
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

function Alerts({ jobs, onJobClick }) {
  const overdue = jobs.filter(j => j.due_date && j.status !== "Invoiced" && new Date(j.due_date) < new Date());
  const awaitingInvoice = jobs.filter(j => j.status === "Ready to Despatch");
  const tomorrowStr = addDays(todayStr(), 1);
  const dueTomorrow = jobs.filter(j => j.due_date === tomorrowStr && !["Ready to Despatch", "Invoiced"].includes(j.status));

  const Section = ({ title, items, color, icon }) => (
    <div style={{ marginBottom: 24 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color, marginBottom: 8 }}>{icon} {title} ({items.length})</div>
      {items.length === 0 && <div style={{ color: C.textLight, fontSize: 13 }}>None — all clear ✓</div>}
      {items.map(j => (
        <div key={j.id} onClick={() => onJobClick(j)} style={{ padding: "10px 14px", background: C.white, border: `1px solid ${color}`, borderRadius: 6, marginBottom: 6, cursor: "pointer" }}>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span><strong style={{ color: C.accent }}>{j.job_ref}</strong> — {j.customer_name}</span>
            <StatusBadge s={j.status} />
          </div>
          {j.po_number && <div style={{ fontSize: 12, color: C.textLight }}>PO: {j.po_number}</div>}
          {j.due_date && <div style={{ fontSize: 12, color }}>Due: {new Date(j.due_date).toLocaleDateString("en-GB")}</div>}
        </div>
      ))}
    </div>
  );

  return (
    <div>
      <Section title="OVERDUE" items={overdue} color={C.danger} icon="🔴" />
      <Section title="AWAITING INVOICE" items={awaitingInvoice} color={C.warning} icon="⚠️" />
      <Section title="DUE TOMORROW" items={dueTomorrow} color={C.accent} icon="📅" />
    </div>
  );
}

function PriceSearch({ jobs }) {
  const [q, setQ] = useState("");
  const results = useMemo(() => {
    if (q.length < 2) return [];
    const d = q.toLowerCase();
    const out = [];
    for (const job of jobs) {
      for (const l of (job.lines || [])) {
        if (l.desc && l.desc.toLowerCase().includes(d)) {
          out.push({ ...l, jobRef: job.job_ref, customer: job.customer_name, date: job.date_received });
        }
      }
    }
    return out.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
  }, [q, jobs]);

  return (
    <div>
      <div style={{ fontSize: 16, fontWeight: 700, color: C.navy, marginBottom: 14 }}>Price Search</div>
      <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search item descriptions…"
        style={{ width: "100%", padding: "10px 14px", border: `2px solid ${C.border}`, borderRadius: 8, fontSize: 14, boxSizing: "border-box", marginBottom: 14 }} />
      {q.length >= 2 && <div style={{ fontSize: 12, color: C.textLight, marginBottom: 8 }}>{results.length} result{results.length !== 1 ? "s" : ""}</div>}
      {results.map((r, i) => (
        <div key={i} style={{ padding: "10px 14px", background: C.white, border: `1px solid ${C.border}`, borderRadius: 6, marginBottom: 6 }}>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span style={{ fontSize: 14 }}>{r.desc}</span>
            <strong style={{ color: C.accent }}>{fmt(r.price)} ea</strong>
          </div>
          <div style={{ fontSize: 12, color: C.textLight }}>
            Qty: {r.qty} · Total: {fmt((r.qty || 0) * (r.price || 0))} · {r.jobRef} / {r.customer} · {r.date ? new Date(r.date).toLocaleDateString("en-GB") : ""}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function App() {
  const [tab, setTab] = useState("dashboard");
  const [jobs, setJobs] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedJob, setSelectedJob] = useState(null);
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [showJobForm, setShowJobForm] = useState(false);
  const [editCustomer, setEditCustomer] = useState(null);
  const [showCustomerForm, setShowCustomerForm] = useState(false);
  const { toasts, add: toast } = useToast();

  const loadData = useCallback(async () => {
    const [{ data: j }, { data: c }] = await Promise.all([
      supabase.from("jobs").select("*").order("created_at", { ascending: false }),
      supabase.from("customers").select("*").order("name")
    ]);
    setJobs(j || []);
    setCustomers(c || []);
    setLoading(false);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const exportCSV = () => {
    const headers = ["Job Ref", "Customer", "PO Number", "Status", "Priority", "Date Received", "Due Date", "Total Value", "Drawing No", "Invoice Ref", "Notes"];
    const rows = jobs.map(j => [j.job_ref, j.customer_name, j.po_number || "", j.status, j.priority, j.date_received || "", j.due_date || "", lineTotal(j.lines).toFixed(2), j.drawing_number || "", j.invoice_ref || "", (j.notes || "").replace(/,/g, ";")]);
    const csv = [headers, ...rows].map(r => r.join(",")).join("\n");
    const a = document.createElement("a");
    a.href = "data:text/csv;charset=utf-8," + encodeURIComponent(csv);
    a.download = `riverside-jobs-${todayStr()}.csv`;
    a.click();
  };

  const TABS = [
    { id: "dashboard", label: "📊 Dashboard" },
    { id: "jobs", label: "💼 Jobs" },
    { id: "customers", label: "👥 Customers" },
    { id: "alerts", label: "⚠️ Alerts" },
    { id: "prices", label: "🔍 Prices" },
    { id: "hr", label: "👤 HR" },
  ];

  if (loading) return (
    <div style={{ minHeight: "100vh", background: C.bg, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ textAlign: "center", color: C.navy }}>
        <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>Loading…</div>
        <div style={{ fontSize: 13, color: C.textLight }}>Connecting to database</div>
      </div>
    </div>
  );

  return (
    <div style={{ minHeight: "100vh", background: C.bg, fontFamily: "system-ui, sans-serif" }}>
      <Toasts toasts={toasts} />
      <div style={{ background: C.navy, color: C.white, padding: "0 20px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 0" }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 900, letterSpacing: 0.5 }}>{COMPANY.name}</div>
            <div style={{ fontSize: 10, opacity: 0.6 }}>Job Management System</div>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Btn small onClick={() => setShowJobForm(true)} color={C.accent}>+ New Job</Btn>
            <Btn small onClick={() => { setEditCustomer(null); setShowCustomerForm(true); }} outline style={{ borderColor: "rgba(255,255,255,0.4)", color: C.white }}>+ Customer</Btn>
            <Btn small onClick={exportCSV} outline style={{ borderColor: "rgba(255,255,255,0.4)", color: C.white }}>↓ Export</Btn>
          </div>
        </div>
        <div style={{ display: "flex", gap: 2, flexWrap: "wrap" }}>
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} style={{
              padding: "8px 14px", border: "none", cursor: "pointer", fontSize: 12, fontWeight: 600,
              background: tab === t.id ? "rgba(255,255,255,0.15)" : "transparent",
              color: tab === t.id ? C.white : "rgba(255,255,255,0.6)",
              borderBottom: tab === t.id ? `2px solid ${C.white}` : "2px solid transparent",
            }}>{t.label}</button>
          ))}
        </div>
      </div>

      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "20px 16px" }}>
        {tab === "dashboard" && <Dashboard jobs={jobs} onJobClick={setSelectedJob} />}
        {tab === "jobs" && <JobsList jobs={jobs} onJobClick={setSelectedJob} />}
        {tab === "customers" && <CustomersList customers={customers} jobs={jobs} onEdit={c => { setEditCustomer(c); setShowCustomerForm(true); }} onCustomerClick={setSelectedCustomer} />}
        {tab === "alerts" && <Alerts jobs={jobs} onJobClick={setSelectedJob} />}
        {tab === "prices" && <PriceSearch jobs={jobs} />}
        {tab === "hr" && <HRModule toast={toast} />}
      </div>

      {showJobForm && (
        <JobForm job={null} customers={customers} allJobs={jobs}
          onSave={() => { setShowJobForm(false); loadData(); }}
          onClose={() => setShowJobForm(false)} toast={toast} />
      )}
      {showCustomerForm && (
        <CustomerForm customer={editCustomer}
          onSave={() => { setShowCustomerForm(false); setEditCustomer(null); loadData(); }}
          onClose={() => { setShowCustomerForm(false); setEditCustomer(null); }} toast={toast} />
      )}
      {selectedJob && (
        <JobDetail job={selectedJob} jobs={jobs} customers={customers}
          onClose={() => setSelectedJob(null)} onRefresh={loadData} toast={toast} />
      )}
      {selectedCustomer && (
        <CustomerDetail customer={selectedCustomer} jobs={jobs}
          onClose={() => setSelectedCustomer(null)}
          onEdit={c => { setEditCustomer(c); setShowCustomerForm(true); setSelectedCustomer(null); }}
          onJobClick={j => { setSelectedCustomer(null); setSelectedJob(j); }} />
      )}
    </div>
  );
}
