import { useState } from "react";
import { C } from "../../lib/constants";
import { Btn } from "../ui/Btn";

export function StagesEditor({ stages, setStages }) {
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
