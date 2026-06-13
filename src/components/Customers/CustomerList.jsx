import { useState } from "react";
import { C } from "../../lib/constants";
import { Btn } from "../ui/Btn";

export function CustomersList({ customers, jobs, onEdit, onCustomerClick }) {
  const [search, setSearch] = useState("");
  const filtered = customers.filter(c => !search || c.name.toLowerCase().includes(search.toLowerCase()));
  return (
    <div>
      <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search customers…"
        style={{ width: "100%", padding: "8px 12px", border: `1px solid ${C.border}`, borderRadius: 6, fontSize: 13, marginBottom: 14, boxSizing: "border-box" }} />
      {filtered.map(c => {
        const custJobs = jobs.filter(j => j.customer_id === c.id || j.customer_name === c.name);
        const uninvoiced = custJobs.filter(j => j.status === "Ready to Invoice");
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
