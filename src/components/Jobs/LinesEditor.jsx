import { useState } from "react";
import { C } from "../../lib/constants";
import { fmt, lineTotal } from "../../lib/utils";
import { Btn } from "../ui/Btn";
import { PriceSuggestions } from "./PriceSuggestions";

export function LinesEditor({ lines, setLines, allJobs }) {
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
            {activeDesc === i && <PriceSuggestions desc={l.desc} allJobs={allJobs} onSelect={s => { setLines(ls => ls.map((l, j) => j === i ? { ...l, desc: s.desc, price: s.price, qty: s.qty } : l)); setActiveDesc(null); }} />}
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
