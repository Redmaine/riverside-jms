import { useState } from "react";
import { C } from "../lib/constants";
import { fmt, lineTotal, todayStr, addDays } from "../lib/utils";
import { StatusBadge } from "./ui/StatusBadge";

export function Dashboard({ jobs, onJobClick }) {
  const [filterStatus, setFilterStatus] = useState(null);
  const [filterAlert, setFilterAlert] = useState(null);

  const pipeline = jobs.filter(j => j.status === "In Production").reduce((a, j) => a + lineTotal(j.lines), 0);
  const overdueJobs = jobs.filter(j => j.due_date && j.status !== "Invoiced" && new Date(j.due_date) < new Date());
  const invoiceJobs = jobs.filter(j => j.status === "Ready to Invoice");
  const tomorrowStr = addDays(todayStr(), 1);
  const tomorrowJobs = jobs.filter(j => j.due_date === tomorrowStr && !["Fully Despatched", "Ready to Invoice", "Invoiced"].includes(j.status));
  const statuses = ["Quote", "In Production", "Part Despatched", "Fully Despatched", "Ready to Invoice", "Invoiced"];

  const alertJobList = filterAlert === "overdue" ? overdueJobs : filterAlert === "invoice" ? invoiceJobs : filterAlert === "tomorrow" ? tomorrowJobs : null;

  const displayJobs = alertJobList
    ? alertJobList
    : filterStatus
      ? jobs.filter(j => j.status === filterStatus)
      : [...jobs].sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0)).slice(0, 10);

  const filteredValue = filterStatus
    ? jobs.filter(j => j.status === filterStatus).reduce((a, j) => a + lineTotal(j.lines), 0)
    : null;

  const alertLabels = { overdue: "OVERDUE JOBS", invoice: "READY TO INVOICE", tomorrow: "DUE TOMORROW" };

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 14, marginBottom: 24 }}>
        {[
          { label: "In Production Value", val: fmt(pipeline), color: C.accent, alertKey: null },
          { label: "Overdue Jobs", val: overdueJobs.length, color: overdueJobs.length > 0 ? C.danger : C.success, alertKey: "overdue" },
          { label: "Ready to Invoice", val: invoiceJobs.length, color: invoiceJobs.length > 0 ? C.warning : C.success, alertKey: "invoice" },
          { label: "Due Tomorrow", val: tomorrowJobs.length, color: tomorrowJobs.length > 0 ? C.warning : C.success, alertKey: "tomorrow" },
        ].map(({ label, val, color, alertKey }) => {
          const active = filterAlert === alertKey && alertKey !== null;
          return (
            <div key={label} onClick={() => { if (alertKey) { setFilterStatus(null); setFilterAlert(active ? null : alertKey); } }}
              style={{ background: active ? C.navy : C.white, border: `1px solid ${active ? C.navy : C.border}`, borderRadius: 8, padding: 16, cursor: alertKey ? "pointer" : "default", transition: "all 0.15s" }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: active ? "rgba(255,255,255,0.7)" : C.textLight, marginBottom: 4, letterSpacing: 0.5 }}>{label.toUpperCase()}</div>
              <div style={{ fontSize: 26, fontWeight: 900, color: active ? C.white : color }}>{val}</div>
              {alertKey && <div style={{ fontSize: 10, color: active ? "rgba(255,255,255,0.6)" : C.textLight, marginTop: 2 }}>{active ? "click to clear" : "click to view"}</div>}
            </div>
          );
        })}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 10, marginBottom: 24 }}>
        {statuses.map(s => {
          const active = filterStatus === s;
          return (
            <div key={s} onClick={() => { setFilterAlert(null); setFilterStatus(active ? null : s); }} style={{
              background: active ? C.accent : C.navy, color: C.white, borderRadius: 8, padding: "12px 14px",
              textAlign: "center", cursor: "pointer", border: active ? `3px solid ${C.white}` : "3px solid transparent",
              boxShadow: active ? "0 0 0 2px " + C.accent : "none", transition: "all 0.15s"
            }}>
              <div style={{ fontSize: 28, fontWeight: 900 }}>{jobs.filter(j => j.status === s).length}</div>
              <div style={{ fontSize: 10, opacity: 0.85, marginTop: 2 }}>{s}</div>
            </div>
          );
        })}
      </div>

      {(filterStatus || filterAlert) ? (
        <div style={{ marginBottom: 12, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: C.navy }}>
            {filterAlert ? alertLabels[filterAlert] : filterStatus.toUpperCase()} — {displayJobs.length} job{displayJobs.length !== 1 ? "s" : ""}
            {filteredValue > 0 && <span style={{ marginLeft: 12, color: C.accent }}>Total: {fmt(filteredValue)}</span>}
          </div>
          <button onClick={() => { setFilterStatus(null); setFilterAlert(null); }} style={{ background: "none", border: `1px solid ${C.border}`, borderRadius: 4, padding: "3px 10px", cursor: "pointer", fontSize: 12, color: C.textLight }}>✕ Clear filter</button>
        </div>
      ) : (
        <div style={{ fontSize: 13, fontWeight: 700, color: C.textLight, marginBottom: 10 }}>RECENT JOBS</div>
      )}

      {displayJobs.map(j => {
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
