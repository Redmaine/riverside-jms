import { useState } from "react";
import { C } from "../../lib/constants";
import { fmt, lineTotal } from "../../lib/utils";
import { supabase } from "../../lib/supabase";
import { Modal } from "../ui/Modal";
import { Btn } from "../ui/Btn";
import { StatusBadge } from "../ui/StatusBadge";
import { JobSheetDoc } from "./JobSheet";
import { QuoteDoc } from "./QuoteDoc";
import { DeliveryNoteFlow } from "./DeliveryNote";
import { FileAttachments } from "./FileAttachments";
import { JobForm } from "./JobForm";

export function JobDetail({ job: initialJob, jobs, customers, onClose, onRefresh, toast }) {
  const [job, setJob] = useState(initialJob);
  const [view, setView] = useState("detail");
  const [editing, setEditing] = useState(false);
  const [showDN, setShowDN] = useState(false);

  const reload = async () => {
    try {
      const { data } = await supabase.from("jobs").select("*").eq("id", job.id).single();
      if (data) setJob(data);
    } catch (e) { console.error("Reload error", e); }
  };

  const flow = ["Quote", "In Production", "Part Despatched", "Fully Despatched", "Ready to Invoice", "Invoiced"];
  const idx = flow.indexOf(job.status);

  const fireWebhook = (jobData) => {
    try {
      const webhookData = {
        job_ref: jobData.job_ref || "",
        customer_name: jobData.customer_name || "",
        contact_name: jobData.contact_name || "",
        po_number: jobData.po_number || "",
        due_date: jobData.due_date || "",
        total: (jobData.lines || []).reduce((s, l) => s + (parseFloat(l.qty) || 0) * (parseFloat(l.price) || 0), 0),
        lines: (jobData.lines || []).map(l => ({
          desc: l.desc || "",
          qty: parseFloat(l.qty) || 0,
          price: parseFloat(l.price) || 0,
          amount: (parseFloat(l.qty) || 0) * (parseFloat(l.price) || 0)
        }))
      };
      fetch("https://hooks.zapier.com/hooks/catch/27528894/4b13n1e/", {
        method: "POST",
        mode: "no-cors",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(webhookData)
      });
    } catch (e) { /* silently ignore if webhook fails */ }
  };

  const advance = async () => {
    if (idx < 0 || idx >= flow.length - 1) return;
    const next = flow[idx + 1];
    if (next === "Invoiced") {
      await supabase.from("jobs").update({ status: "Invoiced" }).eq("id", job.id);
      toast("Job invoiced — sending to QuickBooks…");
      const updatedJob = { ...job, status: "Invoiced" };
      setJob(updatedJob);
      onRefresh();
      fireWebhook(updatedJob);
      return;
    }
    await supabase.from("jobs").update({ status: next }).eq("id", job.id);
    toast("Job moved to " + next);
    setJob(j => ({ ...j, status: next }));
    onRefresh();
  };

  const resetDespatch = async () => {
    if (!window.confirm("Reset all despatch flags? This will mark all items as not despatched.")) return;
    const resetLines = (job.lines || []).map(l => ({ ...l, despatched: false, despatchDate: null }));
    await supabase.from("jobs").update({ lines: resetLines, status: "In Production" }).eq("id", job.id);
    toast("Despatch flags reset");
    setJob(j => ({ ...j, lines: resetLines, status: "In Production" }));
    onRefresh();
  };

  const tickStage = async (s) => {
    const sc = { ...(job.stages_complete || {}) };
    sc[s] = !sc[s];
    await supabase.from("jobs").update({ stages_complete: sc }).eq("id", job.id);
    setJob(j => ({ ...j, stages_complete: sc }));
  };

  const isOverdue = job.due_date && job.status !== "Invoiced" && new Date(job.due_date) < new Date();

  if (view === "jobsheet") return (
    <div style={{ position: "fixed", inset: 0, background: C.white, zIndex: 2000, overflowY: "auto", padding: "20px 40px" }}>
      <JobSheetDoc job={job} onBack={() => setView("detail")} />
    </div>
  );
  if (view === "quote") return <QuoteDoc job={job} onBack={() => setView("detail")} />;

  if (editing) return (
    <JobForm job={job} customers={customers} allJobs={jobs}
      onSave={() => { reload(); setEditing(false); onRefresh(); }}
      onClose={() => setEditing(false)} toast={toast} />
  );

  return (
    <Modal onClose={onClose} wide>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 900, color: C.navy }}>{job.job_ref}</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: C.accent }}>{job.customer_name}</div>
          {job.contact_name && <div style={{ fontSize: 13, color: C.textLight }}>{job.contact_name}</div>}
          {job.po_number && <div style={{ fontSize: 13 }}><strong>PO:</strong> {job.po_number}</div>}
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end", alignItems: "flex-start" }}>
          <StatusBadge s={job.status} />
          {job.priority === "Urgent" && <span style={{ background: C.danger, color: C.white, borderRadius: 12, padding: "3px 10px", fontSize: 12, fontWeight: 700 }}>URGENT</span>}
          {isOverdue && <span style={{ background: C.warning, color: C.white, borderRadius: 12, padding: "3px 10px", fontSize: 12, fontWeight: 700 }}>OVERDUE</span>}
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: C.textLight }}>×</button>
        </div>
      </div>

      <div style={{ display: "flex", gap: 4, marginBottom: 16, flexWrap: "wrap" }}>
        {flow.map((s, i) => (
          <div key={s} style={{
            flex: 1, minWidth: 80, textAlign: "center", padding: "6px 4px", borderRadius: 4, fontSize: 11, fontWeight: 600,
            background: i === idx ? C.navy : i < idx ? C.success : C.silverLighter,
            color: i <= idx ? C.white : C.textLight
          }}>{s}</div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 10, marginBottom: 16 }}>
        {[
          { label: "Received", val: job.date_received ? new Date(job.date_received).toLocaleDateString("en-GB") : "—" },
          { label: "Due", val: job.due_date ? new Date(job.due_date).toLocaleDateString("en-GB") : "—" },
          { label: "Total Value", val: fmt(lineTotal(job.lines)) },
          { label: "Drawing No", val: job.drawing_number || "—" },
        ].map(({ label, val }) => (
          <div key={label} style={{ background: C.silverLighter, borderRadius: 6, padding: "8px 12px" }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: C.textLight, marginBottom: 2 }}>{label}</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: C.navy }}>{val}</div>
          </div>
        ))}
      </div>

      {(job.lines || []).length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.textLight, marginBottom: 6 }}>ORDER LINES</div>
          {(job.lines || []).map((l, i) => (
            <div key={i} style={{
              display: "grid", gridTemplateColumns: "1fr 60px 80px 100px", gap: 8,
              padding: "7px 10px", marginBottom: 4,
              background: l.despatched ? "#e8f5e9" : C.silverLighter, borderRadius: 4, fontSize: 13
            }}>
              <span style={{ textDecoration: l.despatched ? "line-through" : "none", color: l.despatched ? C.textLight : C.text }}>
                {l.despatched ? "✓ " : ""}{l.desc}
              </span>
              <span style={{ textAlign: "center" }}>× {l.qty}</span>
              <span style={{ textAlign: "right" }}>{fmt((l.qty || 0) * (l.price || 0))}</span>
              <span style={{ fontSize: 11, color: C.textLight }}>
                {l.despatched && l.despatchDate ? new Date(l.despatchDate).toLocaleDateString("en-GB") : (l.drawingNo || "")}
              </span>
            </div>
          ))}
          <div style={{ textAlign: "right", fontWeight: 700, color: C.navy, fontSize: 15, padding: "4px 10px" }}>
            Total: {fmt(lineTotal(job.lines))}
          </div>
        </div>
      )}

      {(job.stages || []).length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.textLight, marginBottom: 6 }}>PRODUCTION STAGES</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {(job.stages || []).map(s => {
              const done = !!(job.stages_complete || {})[s];
              return (
                <button key={s} onClick={() => tickStage(s)} style={{
                  padding: "6px 14px", borderRadius: 16, border: `2px solid ${done ? C.success : C.border}`,
                  background: done ? C.success : C.white, color: done ? C.white : C.text,
                  cursor: "pointer", fontSize: 13, fontWeight: 600
                }}>{done ? "✓ " : ""}{s}</button>
              );
            })}
          </div>
        </div>
      )}

      {job.notes && (
        <div style={{ background: "#fffbe6", border: "1px solid #f0d060", borderRadius: 6, padding: 10, marginBottom: 14, fontSize: 13 }}>
          <strong>Notes:</strong> {job.notes}
        </div>
      )}

      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: C.textLight, marginBottom: 6 }}>ATTACHED FILES</div>
        <FileAttachments jobId={job.id} jobRef={job.job_ref} toast={toast} onDrawingUpload={async (suggested) => {
          if (!job.drawing_number || window.confirm(`Set drawing number to "${suggested}"?`)) {
            await supabase.from("jobs").update({ drawing_number: suggested, drawing_attached: true }).eq("id", job.id);
            setJob(j => ({ ...j, drawing_number: suggested, drawing_attached: true }));
            onRefresh();
          }
        }} />
      </div>

      {showDN && (
        <div style={{ marginBottom: 16, padding: 14, background: C.silverLighter, borderRadius: 8 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: C.navy, marginBottom: 10 }}>📋 Delivery Note</div>
          <DeliveryNoteFlow job={job} toast={toast} onDone={() => { setShowDN(false); reload(); onRefresh(); }} />
        </div>
      )}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
        <Btn onClick={() => setEditing(true)} outline small>✏ Edit</Btn>
        {job.status !== "Invoiced" && idx < flow.length - 1 && !["In Production", "Part Despatched"].includes(job.status) && (
          <Btn onClick={advance} small color={C.success}>→ {flow[idx + 1]}</Btn>
        )}
        {job.status !== "Quote" && (
          <Btn onClick={() => setShowDN(!showDN)} small outline>📋 Delivery Note</Btn>
        )}
        <Btn onClick={() => setView("jobsheet")} small outline>🖨 Job Sheet</Btn>
        {(job.lines || []).some(l => l.despatched) && (
          <Btn onClick={resetDespatch} small danger outline>↺ Reset Despatch</Btn>
        )}
        {job.status === "Quote" && <Btn onClick={() => setView("quote")} small outline>📄 Print Quote</Btn>}
      </div>
    </Modal>
  );
}
