import { C } from "../../lib/constants";
import { fmt, lineTotal } from "../../lib/utils";
import { Modal } from "../ui/Modal";
import { Btn } from "../ui/Btn";
import { StatusBadge } from "../ui/StatusBadge";

export function CustomerDetail({ customer, jobs, onClose, onEdit, onJobClick }) {
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
