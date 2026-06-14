/**
 * BillsExpenses.jsx — Module 11
 * Bills (supplier invoices), Expenses (with receipt capture), and a P&L that
 * pulls income from Invoice Generation and outgoings from Bills + Expenses.
 *
 * Props (injected by the platform host):
 *   supabase, accountId, userId, userName, userRole
 *
 * Tables: bills, expenses (see 20260608_bills_expenses.sql). Money in pence.
 * Integrations: jobs (Job Costing), hr_employees (HR), fleet_vehicles (Fleet).
 * Receipts/PDFs upload to the Supabase Storage 'receipts' bucket.
 */
import { useState, useMemo, useEffect, useCallback } from "react";

const penceToPounds = (p) => (p ?? 0) / 100;
const poundsToPence = (v) => Math.round((parseFloat(v) || 0) * 100);
const fmt = (p) => `£${(penceToPounds(p)).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—");
const todayISO = () => new Date().toISOString().split("T")[0];

const logAction = async (supabase, params) => {
  try {
    await supabase.from("audit_log").insert({
      account_id: params.accountId, user_id: params.userId,
      user_name: params.userName, user_role: params.userRole,
      action: params.action, entity_type: params.entityType,
      entity_id: params.entityId, entity_name: params.entityName,
      old_value: params.oldValue || null, new_value: params.newValue || null,
    });
  } catch (e) { console.warn("Audit log failed:", e.message); }
};

const css = `
  .be-wrap { font-family: 'DM Sans', system-ui, sans-serif; color: #1C1C2E; max-width: 1000px; margin: 0 auto; padding: 4px; }
  .be-h { display:flex; justify-content:space-between; align-items:flex-start; gap:12px; margin-bottom:16px; flex-wrap:wrap; }
  .be-h h1 { font-size:20px; font-weight:800; margin:0; }
  .be-h p { font-size:13px; color:#6B7280; margin:2px 0 0; }
  .be-tabs { display:flex; gap:4px; margin-bottom:16px; border-bottom:1px solid #E5E7EB; }
  .be-tab { padding:8px 14px; font-size:13px; font-weight:600; color:#6B7280; background:none; border:none; border-bottom:2px solid transparent; cursor:pointer; }
  .be-tab.active { color:#E8410A; border-bottom-color:#E8410A; }
  .be-card { background:#fff; border:1px solid #E5E7EB; border-radius:12px; padding:16px; margin-bottom:12px; }
  .be-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:12px; margin-bottom:16px; }
  .be-stat { background:#fff; border:1px solid #E5E7EB; border-radius:12px; padding:14px; }
  .be-stat .l { font-size:12px; color:#6B7280; }
  .be-stat .v { font-size:20px; font-weight:800; margin-top:2px; font-family:'Plus Jakarta Sans',sans-serif; }
  .be-row { display:flex; justify-content:space-between; align-items:center; gap:10px; padding:10px 0; border-bottom:1px solid #F3F4F6; }
  .be-btn { display:inline-flex; align-items:center; gap:6px; padding:7px 12px; border-radius:6px; font-size:13px; font-weight:500; cursor:pointer; border:none; }
  .be-btn-primary { background:#E8410A; color:#fff; }
  .be-btn-ghost { background:none; color:#6B7280; border:1px solid #E5E7EB; }
  .be-btn-success { background:#DCFCE7; color:#166534; }
  .be-btn-sm { padding:5px 9px; font-size:12px; }
  .be-pill { font-size:11px; font-weight:600; padding:2px 8px; border-radius:999px; }
  .be-input { width:100%; border:1px solid #D1D5DB; border-radius:8px; padding:9px 11px; font-size:13px; box-sizing:border-box; }
  .be-label { font-size:12px; font-weight:600; color:#374151; display:block; margin-bottom:4px; }
  .be-modal-bg { position:fixed; inset:0; background:rgba(0,0,0,.4); display:flex; align-items:center; justify-content:center; padding:16px; z-index:50; }
  .be-modal { background:#fff; border-radius:12px; padding:20px; width:100%; max-width:460px; max-height:90vh; overflow:auto; }
  .be-bar { display:flex; align-items:flex-end; gap:6px; height:160px; padding-top:10px; }
  .be-bar-col { flex:1; display:flex; flex-direction:column; align-items:center; gap:4px; }
  .be-alert { padding:10px 12px; border-radius:8px; font-size:13px; margin-bottom:12px; }
`;

const STATUS_COLOR = {
  pending: { background: "#FEF9C3", color: "#854D0E" },
  approved: { background: "#DBEAFE", color: "#1E40AF" },
  paid: { background: "#DCFCE7", color: "#166534" },
  overdue: { background: "#FEE2E2", color: "#991B1B" },
};

// Auto-flag overdue: a pending/approved bill past its due date.
const effectiveStatus = (bill) => {
  if (bill.status === "paid") return "paid";
  if (bill.due_date && new Date(bill.due_date) < new Date(todayISO())) return "overdue";
  return bill.status;
};

export default function BillsExpenses({ supabase, accountId, userId, userName, userRole }) {
  const [tab, setTab] = useState("bills");
  const [bills, setBills] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [income, setIncome] = useState([]); // paid invoices for P&L
  const [jobs, setJobs] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [vehicles, setVehicles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showBill, setShowBill] = useState(false);
  const [showExpense, setShowExpense] = useState(false);
  const [detail, setDetail] = useState(null); // { type: 'bill'|'expense', record }
  const [alert, setAlert] = useState(null);

  const notify = (type, message) => { setAlert({ type, message }); setTimeout(() => setAlert(null), 4000); };

  const load = useCallback(async () => {
    setLoading(true);
    const [b, e, inv, j, emp, veh] = await Promise.all([
      supabase.from("bills").select("*").order("issue_date", { ascending: false }),
      supabase.from("expenses").select("*").order("expense_date", { ascending: false }),
      supabase.from("invoices").select("total_pence, vat_amount_pence, paid_at, status").eq("status", "paid"),
      supabase.from("jobs").select("id, title").order("created_at", { ascending: false }),
      supabase.from("hr_employees").select("id, first_name, last_name").order("first_name"),
      supabase.from("fleet_vehicles").select("id, registration").order("registration"),
    ]);
    if (b.error) notify("error", `Could not load bills: ${b.error.message}`); else setBills(b.data || []);
    if (!e.error) setExpenses(e.data || []);
    if (!inv.error) setIncome(inv.data || []);
    if (!j.error) setJobs(j.data || []);
    if (!emp.error) setEmployees(emp.data || []);
    if (!veh.error) setVehicles(veh.data || []);
    setLoading(false);
  }, [supabase]);

  useEffect(() => { load(); }, [load]);

  // Upload a file to the 'receipts' storage bucket, return its public URL.
  const uploadFile = async (file) => {
    if (!file) return null;
    const path = `${accountId}/${Date.now()}-${file.name.replace(/[^\w.-]/g, "_")}`;
    const { error } = await supabase.storage.from("receipts").upload(path, file, { upsert: true });
    if (error) { notify("error", `Upload failed: ${error.message}`); return null; }
    return supabase.storage.from("receipts").getPublicUrl(path).data.publicUrl;
  };

  // ── Bill actions ──
  const addBill = async (data, file) => {
    const pdf_url = file ? await uploadFile(file) : null;
    const amount = poundsToPence(data.amount), vat = poundsToPence(data.vat);
    const row = {
      account_id: accountId, supplier_name: data.supplier_name, reference: data.reference || null,
      description: data.description || null, amount_pence: amount, vat_pence: vat, total_pence: amount + vat,
      issue_date: data.issue_date || todayISO(), due_date: data.due_date || null,
      status: "pending", job_id: data.job_id || null, pdf_url, created_by: userId,
    };
    const { data: ins, error } = await supabase.from("bills").insert(row).select("*").single();
    if (error) { notify("error", `Could not add bill: ${error.message}`); return; }
    setBills((p) => [ins, ...p]);
    setShowBill(false);
    await logAction(supabase, { accountId, userId, userName, userRole, action: "created", entityType: "bill", entityId: ins.id, entityName: `Bill — ${data.supplier_name}` });
    notify("success", "Bill logged.");
  };

  const updateBill = async (id, patch, label) => {
    const { error } = await supabase.from("bills").update(patch).eq("id", id);
    if (error) { notify("error", error.message); return; }
    setBills((p) => p.map((b) => (b.id === id ? { ...b, ...patch } : b)));
    await logAction(supabase, { accountId, userId, userName, userRole, action: "updated", entityType: "bill", entityId: id, entityName: label });
    notify("success", `${label}.`);
  };

  // ── Expense actions ──
  const addExpense = async (data, file) => {
    const receipt_url = file ? await uploadFile(file) : null;
    const row = {
      account_id: accountId, description: data.description, category: data.category || null,
      amount_pence: poundsToPence(data.amount), vat_pence: poundsToPence(data.vat),
      expense_date: data.expense_date || todayISO(), receipt_url,
      job_id: data.job_id || null, employee_id: data.employee_id || null, vehicle_id: data.vehicle_id || null,
      reimbursable: !!data.reimbursable, logged_by: userId,
    };
    const { data: ins, error } = await supabase.from("expenses").insert(row).select("*").single();
    if (error) { notify("error", `Could not add expense: ${error.message}`); return; }
    setExpenses((p) => [ins, ...p]);
    setShowExpense(false);
    await logAction(supabase, { accountId, userId, userName, userRole, action: "created", entityType: "expense", entityId: ins.id, entityName: `Expense — ${data.description}` });
    notify("success", "Expense logged.");
  };

  const markReimbursed = async (id) => {
    const patch = { reimbursed: true, reimbursed_at: new Date().toISOString() };
    const { error } = await supabase.from("expenses").update(patch).eq("id", id);
    if (error) { notify("error", error.message); return; }
    setExpenses((p) => p.map((e) => (e.id === id ? { ...e, ...patch } : e)));
    await logAction(supabase, { accountId, userId, userName, userRole, action: "paid", entityType: "expense", entityId: id, entityName: "Expense reimbursed" });
    notify("success", "Marked reimbursed.");
  };

  // ── P&L computation ──
  const pnl = useMemo(() => {
    const incomeTotal = income.reduce((s, i) => s + (i.total_pence || 0), 0);
    const billsTotal = bills.reduce((s, b) => s + (b.total_pence || 0), 0);
    const expTotal = expenses.reduce((s, e) => s + (e.amount_pence || 0) + (e.vat_pence || 0), 0);
    const outgoings = billsTotal + expTotal;
    const gross = incomeTotal - outgoings;
    const margin = incomeTotal > 0 ? (gross / incomeTotal) * 100 : 0;
    const vatOnSales = income.reduce((s, i) => s + (i.vat_amount_pence || 0), 0);
    const vatOnPurchases = bills.reduce((s, b) => s + (b.vat_pence || 0), 0) + expenses.reduce((s, e) => s + (e.vat_pence || 0), 0);

    // 12-month buckets
    const months = [];
    const now = new Date();
    for (let k = 11; k >= 0; k--) {
      const d = new Date(now.getFullYear(), now.getMonth() - k, 1);
      months.push({ key: `${d.getFullYear()}-${d.getMonth()}`, label: d.toLocaleDateString("en-GB", { month: "short" }), income: 0, out: 0 });
    }
    const bucket = (dateStr) => { const d = new Date(dateStr); return `${d.getFullYear()}-${d.getMonth()}`; };
    income.forEach((i) => { if (i.paid_at) { const m = months.find((x) => x.key === bucket(i.paid_at)); if (m) m.income += i.total_pence || 0; } });
    bills.forEach((b) => { const ds = b.paid_at || b.issue_date; if (ds) { const m = months.find((x) => x.key === bucket(ds)); if (m) m.out += b.total_pence || 0; } });
    expenses.forEach((e) => { if (e.expense_date) { const m = months.find((x) => x.key === bucket(e.expense_date)); if (m) m.out += (e.amount_pence || 0) + (e.vat_pence || 0); } });
    const maxv = Math.max(1, ...months.map((m) => Math.max(m.income, m.out)));
    return { incomeTotal, outgoings, gross, margin, vatOnSales, vatOnPurchases, vatNet: vatOnSales - vatOnPurchases, months, maxv };
  }, [income, bills, expenses]);

  const exportCSV = () => {
    const rows = [["Type", "Date", "Name", "Net", "VAT", "Total"]];
    bills.forEach((b) => rows.push(["Bill", b.issue_date || "", b.supplier_name, penceToPounds(b.amount_pence), penceToPounds(b.vat_pence), penceToPounds(b.total_pence)]));
    expenses.forEach((e) => rows.push(["Expense", e.expense_date || "", e.description, penceToPounds(e.amount_pence), penceToPounds(e.vat_pence), penceToPounds((e.amount_pence || 0) + (e.vat_pence || 0))]));
    income.forEach((i) => rows.push(["Income", i.paid_at ? i.paid_at.split("T")[0] : "", "Invoice", penceToPounds(i.total_pence - i.vat_amount_pence), penceToPounds(i.vat_amount_pence), penceToPounds(i.total_pence)]));
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a"); a.href = url; a.download = `profit-loss-${todayISO()}.csv`; a.click();
    URL.revokeObjectURL(url);
    logAction(supabase, { accountId, userId, userName, userRole, action: "exported", entityType: "pnl", entityName: "P&L CSV export" });
  };

  return (
    <>
      <style>{css}</style>
      <div className="be-wrap">
        <div className="be-h">
          <div>
            <h1>Bills &amp; Expenses</h1>
            <p>Track what you owe, what you spend, and what's left.</p>
          </div>
          {tab === "bills" && <button className="be-btn be-btn-primary" onClick={() => setShowBill(true)}>+ Add Bill</button>}
          {tab === "expenses" && <button className="be-btn be-btn-primary" onClick={() => setShowExpense(true)}>+ Add Expense</button>}
          {tab === "pnl" && (
            <div style={{ display: "flex", gap: 8 }}>
              <button className="be-btn be-btn-ghost" onClick={exportCSV}>Export CSV</button>
              <button className="be-btn be-btn-ghost" onClick={() => window.print()}>Export PDF</button>
            </div>
          )}
        </div>

        {alert && <div className="be-alert" style={{ background: alert.type === "error" ? "#FEE2E2" : "#DCFCE7", color: alert.type === "error" ? "#991B1B" : "#166534" }}>{alert.message}</div>}
        {loading && <div className="be-alert" style={{ background: "#DBEAFE", color: "#1E40AF" }}>Loading…</div>}

        <div className="be-tabs">
          {[["bills", "Bills"], ["expenses", "Expenses"], ["pnl", "Profit & Loss"]].map(([id, label]) => (
            <button key={id} className={`be-tab ${tab === id ? "active" : ""}`} onClick={() => setTab(id)}>{label}</button>
          ))}
        </div>

        {/* ── BILLS ── */}
        {tab === "bills" && (
          <div className="be-card">
            {bills.length === 0 ? <p style={{ color: "#6B7280", fontSize: 13 }}>No bills yet.</p> : bills.map((b) => {
              const st = effectiveStatus(b);
              return (
                <div key={b.id} className="be-row" style={{ cursor: "pointer" }} onClick={() => setDetail({ type: "bill", record: b })}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>{b.supplier_name} <span style={{ color: "#9CA3AF", fontWeight: 400 }}>{b.reference}</span></div>
                    <div style={{ fontSize: 12, color: "#6B7280" }}>{b.description} · due {fmtDate(b.due_date)}</div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }} onClick={(ev) => ev.stopPropagation()}>
                    <span className="be-pill" style={STATUS_COLOR[st]}>{st}</span>
                    <strong>{fmt(b.total_pence)}</strong>
                    {b.pdf_url && <a className="be-btn be-btn-ghost be-btn-sm" href={b.pdf_url} target="_blank" rel="noreferrer">PDF</a>}
                    {(userRole === "owner" || userRole === "manager") && b.status === "pending" && (
                      <button className="be-btn be-btn-ghost be-btn-sm" onClick={() => updateBill(b.id, { status: "approved", approved_by: userId, approved_at: new Date().toISOString() }, "Bill approved")}>Approve</button>
                    )}
                    {b.status !== "paid" && (
                      <button className="be-btn be-btn-success be-btn-sm" onClick={() => updateBill(b.id, { status: "paid", paid_at: new Date().toISOString() }, "Bill marked paid")}>Mark Paid</button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* ── EXPENSES ── */}
        {tab === "expenses" && (
          <div className="be-card">
            {expenses.length === 0 ? <p style={{ color: "#6B7280", fontSize: 13 }}>No expenses yet.</p> : expenses.map((e) => (
              <div key={e.id} className="be-row" style={{ cursor: "pointer" }} onClick={() => setDetail({ type: "expense", record: e })}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{e.description}</div>
                  <div style={{ fontSize: 12, color: "#6B7280" }}>{e.category || "Uncategorised"} · {fmtDate(e.expense_date)}{e.reimbursable ? " · reimbursable" : ""}</div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }} onClick={(ev) => ev.stopPropagation()}>
                  <strong>{fmt((e.amount_pence || 0) + (e.vat_pence || 0))}</strong>
                  {e.receipt_url && <a className="be-btn be-btn-ghost be-btn-sm" href={e.receipt_url} target="_blank" rel="noreferrer">Receipt</a>}
                  {e.reimbursable && !e.reimbursed && (
                    <button className="be-btn be-btn-success be-btn-sm" onClick={() => markReimbursed(e.id)}>Mark Reimbursed</button>
                  )}
                  {e.reimbursed && <span className="be-pill" style={STATUS_COLOR.paid}>reimbursed</span>}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── P&L ── */}
        {tab === "pnl" && (
          <div>
            <div className="be-grid">
              <div className="be-stat"><div className="l">Income</div><div className="v" style={{ color: "#166534" }}>{fmt(pnl.incomeTotal)}</div></div>
              <div className="be-stat"><div className="l">Outgoings</div><div className="v" style={{ color: "#991B1B" }}>{fmt(pnl.outgoings)}</div></div>
              <div className="be-stat"><div className="l">Gross profit</div><div className="v" style={{ color: pnl.gross >= 0 ? "#166534" : "#991B1B" }}>{fmt(pnl.gross)}</div></div>
              <div className="be-stat"><div className="l">Margin</div><div className="v">{pnl.margin.toFixed(1)}%</div></div>
            </div>

            <div className="be-card">
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>Last 12 months</div>
              <div className="be-bar">
                {pnl.months.map((m) => (
                  <div key={m.key} className="be-bar-col">
                    <div style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 130 }}>
                      <div title={`Income ${fmt(m.income)}`} style={{ width: 8, height: `${(m.income / pnl.maxv) * 130}px`, background: "#22C55E", borderRadius: 2 }} />
                      <div title={`Out ${fmt(m.out)}`} style={{ width: 8, height: `${(m.out / pnl.maxv) * 130}px`, background: "#EF4444", borderRadius: 2 }} />
                    </div>
                    <span style={{ fontSize: 10, color: "#9CA3AF" }}>{m.label}</span>
                  </div>
                ))}
              </div>
              <div style={{ display: "flex", gap: 16, marginTop: 8, fontSize: 11, color: "#6B7280" }}>
                <span><span style={{ display: "inline-block", width: 8, height: 8, background: "#22C55E", borderRadius: 2 }} /> Income</span>
                <span><span style={{ display: "inline-block", width: 8, height: 8, background: "#EF4444", borderRadius: 2 }} /> Outgoings</span>
              </div>
            </div>

            <div className="be-card">
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>VAT summary <span style={{ fontWeight: 400, color: "#9CA3AF" }}>(informational — not an MTD submission)</span></div>
              <div className="be-row"><span>VAT on sales</span><strong>{fmt(pnl.vatOnSales)}</strong></div>
              <div className="be-row"><span>VAT on purchases</span><strong>{fmt(pnl.vatOnPurchases)}</strong></div>
              <div className="be-row" style={{ borderBottom: "none" }}><span style={{ fontWeight: 700 }}>Net VAT position</span><strong>{fmt(pnl.vatNet)}</strong></div>
            </div>
          </div>
        )}

        {showBill && (
          <BillModal jobs={jobs} onClose={() => setShowBill(false)} onSubmit={addBill} />
        )}
        {showExpense && (
          <ExpenseModal jobs={jobs} employees={employees} vehicles={vehicles} onClose={() => setShowExpense(false)} onSubmit={addExpense} />
        )}
        {detail && <RecordDetailModal type={detail.type} record={detail.record} onClose={() => setDetail(null)} />}
      </div>
    </>
  );
}

// Hidden internal columns; everything else is shown in the detail view.
const DETAIL_HIDDEN = new Set(["id", "account_id", "created_at", "updated_at"]);

/** Read-only detail view for a single bill or expense — shows every stored field. */
function RecordDetailModal({ type, record, onClose }) {
  const fields = Object.keys(record).filter((k) => !DETAIL_HIDDEN.has(k) && record[k] != null && record[k] !== "");
  const show = (k, v) => {
    if (k.endsWith("_pence")) return fmt(v);
    if (k.endsWith("_date") || k.endsWith("_at")) return fmtDate(v);
    if (typeof v === "boolean") return v ? "Yes" : "No";
    return String(v);
  };
  const title = type === "bill" ? (record.supplier_name || "Bill") : (record.description || "Expense");
  return (
    <div className="be-modal-bg" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="be-modal">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <h3 style={{ margin: 0 }}>{title}</h3>
          <button onClick={onClose} style={{ border: "none", background: "none", fontSize: 22, lineHeight: 1, cursor: "pointer", color: "#9CA3AF" }}>×</button>
        </div>
        <div style={{ display: "grid", gap: 0 }}>
          {fields.map((k) => (
            <div key={k} className="be-row" style={{ padding: "8px 0" }}>
              <span style={{ color: "#6B7280", fontSize: 13, textTransform: "capitalize" }}>{k.replace(/_pence$/, "").replace(/_/g, " ")}</span>
              <strong style={{ fontSize: 13, textAlign: "right", wordBreak: "break-word" }}>{show(k, record[k])}</strong>
            </div>
          ))}
        </div>
        <div style={{ display: "flex", marginTop: 16 }}>
          <button className="be-btn be-btn-primary" style={{ flex: 1 }} onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

function BillModal({ jobs, onClose, onSubmit }) {
  const [f, setF] = useState({ supplier_name: "", reference: "", description: "", amount: "", vat: "", issue_date: todayISO(), due_date: "", job_id: "" });
  const [file, setFile] = useState(null);
  const u = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }));
  return (
    <div className="be-modal-bg" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="be-modal">
        <h3 style={{ marginTop: 0 }}>Add Bill</h3>
        <div style={{ display: "grid", gap: 10 }}>
          <div><label className="be-label">Supplier *</label><input className="be-input" value={f.supplier_name} onChange={u("supplier_name")} /></div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div><label className="be-label">Reference</label><input className="be-input" value={f.reference} onChange={u("reference")} /></div>
            <div><label className="be-label">Job (optional)</label>
              <select className="be-input" value={f.job_id} onChange={u("job_id")}><option value="">—</option>{jobs.map((j) => <option key={j.id} value={j.id}>{j.title}</option>)}</select>
            </div>
          </div>
          <div><label className="be-label">Description</label><input className="be-input" value={f.description} onChange={u("description")} /></div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div><label className="be-label">Net amount (£)</label><input className="be-input" type="number" value={f.amount} onChange={u("amount")} /></div>
            <div><label className="be-label">VAT (£)</label><input className="be-input" type="number" value={f.vat} onChange={u("vat")} /></div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div><label className="be-label">Issue date</label><input className="be-input" type="date" value={f.issue_date} onChange={u("issue_date")} /></div>
            <div><label className="be-label">Due date</label><input className="be-input" type="date" value={f.due_date} onChange={u("due_date")} /></div>
          </div>
          <div><label className="be-label">Attach PDF</label><input type="file" accept="application/pdf,image/*" onChange={(e) => setFile(e.target.files?.[0] || null)} /></div>
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
          <button className="be-btn be-btn-ghost" onClick={onClose}>Cancel</button>
          <button className="be-btn be-btn-primary" style={{ flex: 1 }} disabled={!f.supplier_name || !f.amount} onClick={() => onSubmit(f, file)}>Save Bill</button>
        </div>
      </div>
    </div>
  );
}

function ExpenseModal({ jobs, employees, vehicles, onClose, onSubmit }) {
  const [f, setF] = useState({ description: "", category: "", amount: "", vat: "", expense_date: todayISO(), job_id: "", employee_id: "", vehicle_id: "", reimbursable: false });
  const [file, setFile] = useState(null);
  const u = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }));
  return (
    <div className="be-modal-bg" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="be-modal">
        <h3 style={{ marginTop: 0 }}>Add Expense</h3>
        <div style={{ display: "grid", gap: 10 }}>
          <div><label className="be-label">Description *</label><input className="be-input" value={f.description} onChange={u("description")} /></div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div><label className="be-label">Category</label><input className="be-input" placeholder="Fuel, materials…" value={f.category} onChange={u("category")} /></div>
            <div><label className="be-label">Date</label><input className="be-input" type="date" value={f.expense_date} onChange={u("expense_date")} /></div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div><label className="be-label">Net amount (£)</label><input className="be-input" type="number" value={f.amount} onChange={u("amount")} /></div>
            <div><label className="be-label">VAT (£)</label><input className="be-input" type="number" value={f.vat} onChange={u("vat")} /></div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
            <div><label className="be-label">Job</label><select className="be-input" value={f.job_id} onChange={u("job_id")}><option value="">—</option>{jobs.map((j) => <option key={j.id} value={j.id}>{j.title}</option>)}</select></div>
            <div><label className="be-label">Staff</label><select className="be-input" value={f.employee_id} onChange={u("employee_id")}><option value="">—</option>{employees.map((e) => <option key={e.id} value={e.id}>{e.first_name} {e.last_name}</option>)}</select></div>
            <div><label className="be-label">Vehicle</label><select className="be-input" value={f.vehicle_id} onChange={u("vehicle_id")}><option value="">—</option>{vehicles.map((v) => <option key={v.id} value={v.id}>{v.registration}</option>)}</select></div>
          </div>
          <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13 }}>
            <input type="checkbox" checked={f.reimbursable} onChange={(e) => setF((p) => ({ ...p, reimbursable: e.target.checked }))} /> Reimbursable to staff member
          </label>
          <div><label className="be-label">Snap / attach receipt</label><input type="file" accept="image/*" capture="environment" onChange={(e) => setFile(e.target.files?.[0] || null)} /></div>
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
          <button className="be-btn be-btn-ghost" onClick={onClose}>Cancel</button>
          <button className="be-btn be-btn-primary" style={{ flex: 1 }} disabled={!f.description || !f.amount} onClick={() => onSubmit(f, file)}>Save Expense</button>
        </div>
      </div>
    </div>
  );
}
