import { C } from "../lib/constants";
import { todayStr, addDays } from "../lib/utils";
import { StatusBadge } from "./ui/StatusBadge";

export function Alerts({ jobs, onJobClick }) {
  const overdue = jobs.filter(j => j.due_date && j.status !== "Invoiced" && new Date(j.due_date) < new Date());
  const awaitingInvoice = jobs.filter(j => j.status === "Ready to Invoice");
  const tomorrowStr = addDays(todayStr(), 1);
  const dueTomorrow = jobs.filter(j => j.due_date === tomorrowStr && !["Fully Despatched", "Ready to Invoice", "Invoiced"].includes(j.status));

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
      <Section title="READY TO INVOICE" items={awaitingInvoice} color={C.warning} icon="⚠️" />
      <Section title="DUE TOMORROW" items={dueTomorrow} color={C.accent} icon="📅" />
    </div>
  );
}
