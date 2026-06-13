import { useState, useMemo } from "react";
import { C } from "../lib/constants";
import { fmt } from "../lib/utils";

export function PriceSearch({ jobs }) {
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
