import { useState, useEffect, useCallback } from "react";
import { supabase } from "./lib/supabase";
import { C, COMPANY } from "./lib/constants";
import { lineTotal, todayStr } from "./lib/utils";
import { useToast, Toasts } from "./components/ui/Toast";
import { Btn } from "./components/ui/Btn";
import { Dashboard } from "./components/Dashboard";
import { Alerts } from "./components/Alerts";
import { PriceSearch } from "./components/PriceSearch";
import { JobsList } from "./components/Jobs/JobList";
import { JobForm } from "./components/Jobs/JobForm";
import { JobDetail } from "./components/Jobs/JobDetail";
import { CustomersList } from "./components/Customers/CustomerList";
import { CustomerForm } from "./components/Customers/CustomerForm";
import { CustomerDetail } from "./components/Customers/CustomerDetail";
import { HRModule } from "./components/HR/HRModule";
import { ModulesHost } from "./components/Modules/ModulesHost";

// Nav model. type "view" = built-in Riverside screen; "module" = a YCA module.
const NAV = [
  { group: "MAIN", items: [
    { id: "dashboard", label: "📊 Dashboard", type: "view" },
    { id: "jobs", label: "💼 Jobs", type: "view" },
    { id: "customers", label: "👥 Customers", type: "view" },
    { id: "alerts", label: "⚠️ Alerts", type: "view" },
    { id: "prices", label: "🔍 Price Search", type: "view" },
    { id: "hr", label: "👤 HR & Staff", type: "view" },
  ]},
  { group: "FINANCE", items: [
    { id: "invoices", label: "🧾 Invoices", type: "module" },
    { id: "chasing", label: "📨 Invoice Chasing", type: "module" },
    { id: "bills", label: "💳 Bills & Expenses", type: "module" },
    { id: "job-costing", label: "📐 Job Costing", type: "module" },
  ]},
  { group: "CUSTOMER", items: [
    { id: "portal", label: "🔑 Customer Portal", type: "module" },
    { id: "booking", label: "📅 Online Booking", type: "module" },
    { id: "reviews", label: "⭐ Review Manager", type: "module" },
  ]},
  { group: "COMPLIANCE & ASSETS", items: [
    { id: "health-safety", label: "🦺 Health & Safety", type: "module" },
    { id: "fleet", label: "🚐 Fleet", type: "module" },
    { id: "assets", label: "🔧 Assets", type: "module" },
    { id: "documents", label: "📁 Documents", type: "module" },
  ]},
  { group: "MORE", items: [
    { id: "whatsapp", label: "💬 WhatsApp", type: "module" },
    { id: "proposals", label: "✍️ Proposals & E-Sign", type: "module" },
    { id: "loyalty", label: "🎁 Loyalty", type: "module" },
  ]},
];

const ALL_ITEMS = NAV.flatMap(g => g.items);

export default function App() {
  const [active, setActive] = useState("dashboard");
  const [navOpen, setNavOpen] = useState(false);
  const [jobs, setJobs] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState(null);
  const [selectedJob, setSelectedJob] = useState(null);
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [showJobForm, setShowJobForm] = useState(false);
  const [editCustomer, setEditCustomer] = useState(null);
  const [showCustomerForm, setShowCustomerForm] = useState(false);
  const { toasts, add: toast } = useToast();

  useEffect(() => { supabase.auth.getSession().then(({ data }) => setSession(data.session)); }, []);

  const loadData = useCallback(async () => {
    const [{ data: j }, { data: c }] = await Promise.all([
      supabase.from("jobs").select("*").order("created_at", { ascending: false }),
      supabase.from("customers").select("*").order("name")
    ]);
    setJobs(j || []);
    setCustomers(c || []);
    setLoading(false);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const exportCSV = () => {
    const headers = ["Job Ref", "Customer", "PO Number", "Status", "Priority", "Date Received", "Due Date", "Total Value", "Drawing No", "Notes"];
    const rows = jobs.map(j => [j.job_ref, j.customer_name, j.po_number || "", j.status, j.priority, j.date_received || "", j.due_date || "", lineTotal(j.lines).toFixed(2), j.drawing_number || "", (j.notes || "").replace(/,/g, ";")]);
    const csv = [headers, ...rows].map(r => r.join(",")).join("\n");
    const a = document.createElement("a");
    a.href = "data:text/csv;charset=utf-8," + encodeURIComponent(csv);
    a.download = `riverside-jobs-${todayStr()}.csv`;
    a.click();
  };

  const go = (id) => { setActive(id); setNavOpen(false); };
  const current = ALL_ITEMS.find(i => i.id === active) || ALL_ITEMS[0];

  if (loading) return (
    <div style={{ minHeight: "100vh", background: C.bg, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ textAlign: "center", color: C.navy }}>
        <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>Loading…</div>
        <div style={{ fontSize: 13, color: C.textLight }}>Connecting to database</div>
      </div>
    </div>
  );

  return (
    <div className="rv-shell" style={{ fontFamily: "system-ui, sans-serif" }}>
      <Toasts toasts={toasts} />

      {/* Sidebar */}
      <div className={"rv-sidebar" + (navOpen ? " open" : "")}>
        <div style={{ padding: "16px 18px", borderBottom: "1px solid rgba(255,255,255,0.1)" }}>
          <div style={{ fontSize: 14, fontWeight: 900, color: C.white, lineHeight: 1.2 }}>Riverside</div>
          <div style={{ fontSize: 10, color: "rgba(255,255,255,0.5)" }}>Job Management System</div>
        </div>
        {NAV.map(g => (
          <div key={g.group}>
            <div className="rv-navgroup">{g.group}</div>
            {g.items.map(it => (
              <button key={it.id} className={"rv-navitem" + (active === it.id ? " active" : "")} onClick={() => go(it.id)}>{it.label}</button>
            ))}
          </div>
        ))}
        <div className="rv-navgroup">ACCOUNT</div>
        <button className="rv-navitem" onClick={() => supabase.auth.signOut()}>↩ Sign out</button>
        <div style={{ height: 20 }} />
      </div>
      <div className={"rv-backdrop" + (navOpen ? " open" : "")} onClick={() => setNavOpen(false)} />

      {/* Main */}
      <div className="rv-main">
        <div style={{ background: C.white, borderBottom: `1px solid ${C.border}`, padding: "10px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
            <button className="rv-hamburger" onClick={() => setNavOpen(v => !v)}>☰</button>
            <div style={{ fontSize: 16, fontWeight: 800, color: C.navy }}>{current.label.replace(/^[^ ]+ /, "")}</div>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Btn small onClick={() => setShowJobForm(true)} color={C.accent}>+ New Job</Btn>
            <Btn small outline onClick={() => { setEditCustomer(null); setShowCustomerForm(true); }}>+ Customer</Btn>
            <Btn small outline onClick={exportCSV}>↓ Export</Btn>
          </div>
        </div>

        <div style={{ maxWidth: 1100, width: "100%", margin: "0 auto", padding: "20px 16px", boxSizing: "border-box" }}>
          {current.type === "view" && active === "dashboard" && <Dashboard jobs={jobs} onJobClick={setSelectedJob} />}
          {current.type === "view" && active === "jobs" && <JobsList jobs={jobs} onJobClick={setSelectedJob} />}
          {current.type === "view" && active === "customers" && <CustomersList customers={customers} jobs={jobs} onEdit={c => { setEditCustomer(c); setShowCustomerForm(true); }} onCustomerClick={setSelectedCustomer} />}
          {current.type === "view" && active === "alerts" && <Alerts jobs={jobs} onJobClick={setSelectedJob} />}
          {current.type === "view" && active === "prices" && <PriceSearch jobs={jobs} />}
          {current.type === "view" && active === "hr" && <HRModule toast={toast} />}
          {current.type === "module" && <ModulesHost moduleKey={active} session={session} />}
        </div>
      </div>

      {showJobForm && (
        <JobForm job={null} customers={customers} allJobs={jobs}
          onSave={() => { setShowJobForm(false); loadData(); }}
          onClose={() => setShowJobForm(false)} toast={toast} />
      )}
      {showCustomerForm && (
        <CustomerForm customer={editCustomer}
          onSave={() => { setShowCustomerForm(false); setEditCustomer(null); loadData(); }}
          onClose={() => { setShowCustomerForm(false); setEditCustomer(null); }} toast={toast} />
      )}
      {selectedJob && (
        <JobDetail job={selectedJob} jobs={jobs} customers={customers}
          onClose={() => setSelectedJob(null)} onRefresh={loadData} toast={toast} />
      )}
      {selectedCustomer && (
        <CustomerDetail customer={selectedCustomer} jobs={jobs}
          onClose={() => setSelectedCustomer(null)}
          onEdit={c => { setEditCustomer(c); setShowCustomerForm(true); setSelectedCustomer(null); }}
          onJobClick={j => { setSelectedCustomer(null); setSelectedJob(j); }} />
      )}
    </div>
  );
}
