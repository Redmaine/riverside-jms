import { useState } from "react";
import { C } from "../../lib/constants";
import { JobListCard } from "./JobCard";

export function JobsList({ jobs, onJobClick }) {
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("All");
  const statuses = ["All", "Quote", "In Production", "Part Despatched", "Fully Despatched", "Ready to Invoice", "Invoiced", "Needs Review"];
  const filtered = jobs.filter(j => {
    const q = search.toLowerCase();
    const matchSearch = !q || (j.job_ref || "").toLowerCase().includes(q) || (j.customer_name || "").toLowerCase().includes(q) || (j.po_number || "").toLowerCase().includes(q) || (j.lines || []).some(l => (l.desc || "").toLowerCase().includes(q));
    return matchSearch && (filterStatus === "All" || j.status === filterStatus);
  }).sort((a, b) => {
    const aDate = a.due_date ? new Date(a.due_date) : new Date("9999-12-31");
    const bDate = b.due_date ? new Date(b.due_date) : new Date("9999-12-31");
    if (aDate - bDate !== 0) return aDate - bDate;
    return (a.job_ref || "").localeCompare(b.job_ref || "");
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
      {filtered.map(j => <JobListCard key={j.id} j={j} onJobClick={onJobClick} />)}
    </div>
  );
}
