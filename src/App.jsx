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

export default function App() {
  const [tab, setTab] = useState("dashboard");
  const [jobs, setJobs] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedJob, setSelectedJob] = useState(null);
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [showJobForm, setShowJobForm] = useState(false);
  const [editCustomer, setEditCustomer] = useState(null);
  const [showCustomerForm, setShowCustomerForm] = useState(false);
  const { toasts, add: toast } = useToast();

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

  const TABS = [
    { id: "dashboard", label: "📊 Dashboard" },
    { id: "jobs", label: "💼 Jobs" },
    { id: "customers", label: "👥 Customers" },
    { id: "alerts", label: "⚠️ Alerts" },
    { id: "prices", label: "🔍 Prices" },
    { id: "hr", label: "👤 HR" },
  ];

  if (loading) return (
    <div style={{ minHeight: "100vh", background: C.bg, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ textAlign: "center", color: C.navy }}>
        <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>Loading…</div>
        <div style={{ fontSize: 13, color: C.textLight }}>Connecting to database</div>
      </div>
    </div>
  );

  return (
    <div style={{ minHeight: "100vh", background: C.bg, fontFamily: "system-ui, sans-serif" }}>
      <Toasts toasts={toasts} />
      <div style={{ background: C.navy, color: C.white, padding: "0 20px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 0" }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 900, letterSpacing: 0.5 }}>{COMPANY.name}</div>
            <div style={{ fontSize: 10, opacity: 0.6 }}>Job Management System</div>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Btn small onClick={() => setShowJobForm(true)} color={C.accent}>+ New Job</Btn>
            <Btn small onClick={() => { setEditCustomer(null); setShowCustomerForm(true); }} outline style={{ borderColor: "rgba(255,255,255,0.4)", color: C.white }}>+ Customer</Btn>
            <Btn small onClick={exportCSV} outline style={{ borderColor: "rgba(255,255,255,0.4)", color: C.white }}>↓ Export</Btn>
          </div>
        </div>
        <div style={{ display: "flex", gap: 2, flexWrap: "wrap" }}>
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} style={{
              padding: "8px 14px", border: "none", cursor: "pointer", fontSize: 12, fontWeight: 600,
              background: tab === t.id ? "rgba(255,255,255,0.15)" : "transparent",
              color: tab === t.id ? C.white : "rgba(255,255,255,0.6)",
              borderBottom: tab === t.id ? `2px solid ${C.white}` : "2px solid transparent",
            }}>{t.label}</button>
          ))}
        </div>
      </div>

      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "20px 16px" }}>
        {tab === "dashboard" && <Dashboard jobs={jobs} onJobClick={setSelectedJob} />}
        {tab === "jobs" && <JobsList jobs={jobs} onJobClick={setSelectedJob} />}
        {tab === "customers" && <CustomersList customers={customers} jobs={jobs} onEdit={c => { setEditCustomer(c); setShowCustomerForm(true); }} onCustomerClick={setSelectedCustomer} />}
        {tab === "alerts" && <Alerts jobs={jobs} onJobClick={setSelectedJob} />}
        {tab === "prices" && <PriceSearch jobs={jobs} />}
        {tab === "hr" && <HRModule toast={toast} />}
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
