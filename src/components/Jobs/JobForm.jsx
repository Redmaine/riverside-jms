import { useState } from "react";
import { C } from "../../lib/constants";
import { todayStr } from "../../lib/utils";
import { supabase } from "../../lib/supabase";
import { Modal } from "../ui/Modal";
import { Btn } from "../ui/Btn";
import { LinesEditor } from "./LinesEditor";
import { StagesEditor } from "./StagesEditor";

export function JobForm({ job, customers, allJobs, onSave, onClose, toast }) {
  const isNew = !job;
  const blank = { customer_id: "", customer_name: "", contact_id: "", contact_name: "", description: "", po_number: "", status: "In Production", priority: "Normal", quote_ref: "", quote_status: "N/A", quote_date: todayStr(), lines: [{ desc: "", qty: 1, price: "", drawingNo: "", despatched: false, despatchDate: null }], stages: [], stages_complete: {}, drawing_number: "", drawing_attached: false, date_received: todayStr(), due_date: "", notes: "" };
  const [form, setForm] = useState(isNew ? blank : { ...blank, ...job });
  const [lines, setLines] = useState((isNew ? blank : job).lines || [{ desc: "", qty: 1, price: "", drawingNo: "", despatched: false, despatchDate: null }]);
  const [stages, setStages] = useState((isNew ? blank : job).stages || []);
  const [laserPrompt, setLaserPrompt] = useState(false);
  const [saving, setSaving] = useState(false);

  const selCustomer = customers.find(c => c.id === form.customer_id);
  const contacts = selCustomer?.contacts || [];
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const pickCustomer = (id) => {
    const c = customers.find(x => x.id === id);
    set("customer_id", id);
    set("customer_name", c?.name || "");
    set("contact_id", "");
    set("contact_name", "");
    if (c?.name === "Tara Signs") setLaserPrompt(true);
  };

  const save = async () => {
    if (!form.customer_name) { toast("Customer is required", "error"); return; }
    setSaving(true);
    try {
      const payload = { ...form, lines, stages, stages_complete: form.stages_complete || {} };
      ["due_date", "date_received", "quote_date"].forEach(f => { if (!payload[f]) payload[f] = null; });
      if (isNew) {
        const { data: cnt } = await supabase.rpc("increment_job_counter");
        payload.job_ref = `R${String(cnt).padStart(6, "0")}`;
      }
      delete payload.id;
      const { error } = isNew
        ? await supabase.from("jobs").insert(payload)
        : await supabase.from("jobs").update(payload).eq("id", job.id);
      if (error) throw error;
      toast(isNew ? `Job ${payload.job_ref} created` : "Job updated");
      onSave();
    } catch (e) { toast("Save failed: " + e.message, "error"); }
    setSaving(false);
  };

  const inp = { padding: "7px 10px", border: `1px solid ${C.border}`, borderRadius: 4, fontSize: 13, width: "100%", boxSizing: "border-box" };
  const lbl = { fontSize: 12, fontWeight: 600, color: C.textLight, marginBottom: 4, display: "block" };

  return (
    <Modal onClose={onClose} wide>
      {laserPrompt && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 2000, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ background: C.white, borderRadius: 10, padding: 28, maxWidth: 380, textAlign: "center" }}>
            <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 10 }}>Tara Signs Order</div>
            <div style={{ fontSize: 14, marginBottom: 20, color: C.textLight }}>Is laser cutting required for this order?</div>
            <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
              <Btn onClick={() => { setStages(s => s.includes("Laser Cutting") ? s : ["Laser Cutting", ...s]); setLaserPrompt(false); }}>Yes</Btn>
              <Btn outline onClick={() => setLaserPrompt(false)}>No</Btn>
            </div>
          </div>
        </div>
      )}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <div style={{ fontSize: 18, fontWeight: 800, color: C.navy }}>{isNew ? "New Job" : `Edit ${job.job_ref}`}</div>
        <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer" }}>×</button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
        <div>
          <label style={lbl}>Customer *</label>
          <select value={form.customer_id} onChange={e => pickCustomer(e.target.value)} style={inp}>
            <option value="">Select customer…</option>
            {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div>
          <label style={lbl}>Contact</label>
          <select value={form.contact_id} onChange={e => { const ct = contacts.find(c => c.id === e.target.value); set("contact_id", e.target.value); set("contact_name", ct?.name || ""); }} style={inp}>
            <option value="">Select contact…</option>
            {contacts.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div>
          <label style={lbl}>PO Number</label>
          <input value={form.po_number || ""} onChange={e => set("po_number", e.target.value)} style={inp} placeholder="Customer PO #" />
        </div>
        <div>
          <label style={lbl}>Status</label>
          <select value={form.status} onChange={e => set("status", e.target.value)} style={inp}>
            {["Quote", "In Production", "Part Despatched", "Fully Despatched", "Ready to Invoice", "Invoiced", "Needs Review"].map(s => <option key={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <label style={lbl}>Priority</label>
          <select value={form.priority} onChange={e => set("priority", e.target.value)} style={inp}>
            {["Low", "Normal", "High", "Urgent"].map(p => <option key={p}>{p}</option>)}
          </select>
        </div>
        <div>
          <label style={lbl}>Date Received</label>
          <input type="date" value={form.date_received || ""} onChange={e => set("date_received", e.target.value)} style={inp} />
        </div>
        <div>
          <label style={lbl}>Due Date</label>
          <input type="date" value={form.due_date || ""} onChange={e => set("due_date", e.target.value)} style={inp} />
        </div>
        <div>
          <label style={lbl}>Quote Date</label>
          <input type="date" value={form.quote_date || ""} onChange={e => set("quote_date", e.target.value)} style={inp} />
        </div>
        <div>
          <label style={lbl}>Drawing Number</label>
          <input value={form.drawing_number || ""} onChange={e => set("drawing_number", e.target.value)} style={inp} placeholder="Drawing ref" />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, paddingTop: 20 }}>
          <input type="checkbox" checked={!!form.drawing_attached} onChange={e => set("drawing_attached", e.target.checked)} id="da" />
          <label htmlFor="da" style={{ fontSize: 13 }}>Drawing attached</label>
        </div>
      </div>
      <div style={{ marginBottom: 14 }}>
        <label style={lbl}>Notes</label>
        <textarea value={form.notes || ""} onChange={e => set("notes", e.target.value)} rows={2}
          style={{ ...inp, resize: "vertical" }} placeholder="Additional notes…" />
      </div>
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: C.navy, marginBottom: 8 }}>Order Lines</div>
        <LinesEditor lines={lines} setLines={setLines} allJobs={allJobs} />
      </div>
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: C.navy, marginBottom: 8 }}>Production Stages</div>
        <StagesEditor stages={stages} setStages={setStages} />
      </div>
      <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
        <Btn outline onClick={onClose}>Cancel</Btn>
        <Btn onClick={save} disabled={saving}>{saving ? "Saving…" : isNew ? "Create Job" : "Save Changes"}</Btn>
      </div>
    </Modal>
  );
}
