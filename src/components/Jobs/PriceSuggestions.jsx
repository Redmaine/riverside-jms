import { useMemo } from "react";
import { C } from "../../lib/constants";
import { fmt } from "../../lib/utils";

export function PriceSuggestions({ desc, allJobs, onSelect }) {
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
