import { useState } from "react";
import { C } from "../../lib/constants";
import { supabase } from "../../lib/supabase";
import { Modal } from "../ui/Modal";
import { Btn } from "../ui/Btn";

export function CustomerForm({ customer, onSave, onClose, toast }) {
  const [name, setName] = useState(customer?.name || "");
  const [contacts, setContacts] = useState(customer?.contacts || []);
  const [notes, setNotes] = useState(customer?.notes || "");
  const [saving, setSaving] = useState(false);

  const addContact = () => setContacts(cs => [...cs, { id: Date.now().toString(), name: "", email: "", phone: "" }]);
  const updContact = (id, f, v) => setContacts(cs => cs.map(c => c.id === id ? { ...c, [f]: v } : c));
  const remContact = (id) => setContacts(cs => cs.filter(c => c.id !== id));

  const save = async () => {
    if (!name.trim()) { toast("Name required", "error"); return; }
    setSaving(true);
    try {
      const payload = { name: name.trim(), contacts, notes };
      const { error } = customer
        ? await supabase.from("customers").update(payload).eq("id", customer.id)
        : await supabase.from("customers").insert(payload);
      if (error) throw error;
      toast(customer ? "Customer updated" : `${name} added`);
      onSave();
    } catch (e) { toast("Save failed: " + e.message, "error"); }
    setSaving(false);
  };

  const inp = { padding: "7px 10px", border: `1px solid ${C.border}`, borderRadius: 4, fontSize: 13 };
  return (
    <Modal onClose={onClose}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16 }}>
        <div style={{ fontSize: 18, fontWeight: 800, color: C.navy }}>{customer ? "Edit Customer" : "New Customer"}</div>
        <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer" }}>×</button>
      </div>
      <div style={{ marginBottom: 12 }}>
        <label style={{ fontSize: 12, fontWeight: 600, color: C.textLight, display: "block", marginBottom: 4 }}>Company Name *</label>
        <input value={name} onChange={e => setName(e.target.value)} style={{ ...inp, width: "100%", boxSizing: "border-box" }} />
      </div>
      <div style={{ marginBottom: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <label style={{ fontSize: 12, fontWeight: 600, color: C.textLight }}>Contacts</label>
          <Btn small onClick={addContact}>+ Add Contact</Btn>
        </div>
        {contacts.map(c => (
          <div key={c.id} style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 28px", gap: 6, marginBottom: 6 }}>
            <input value={c.name} onChange={e => updContact(c.id, "name", e.target.value)} placeholder="Name" style={inp} />
            <input value={c.email} onChange={e => updContact(c.id, "email", e.target.value)} placeholder="Email" style={inp} />
            <input value={c.phone} onChange={e => updContact(c.id, "phone", e.target.value)} placeholder="Phone" style={inp} />
            <button onClick={() => remContact(c.id)} style={{ background: C.danger, color: C.white, border: "none", borderRadius: 4, cursor: "pointer" }}>×</button>
          </div>
        ))}
      </div>
      <div style={{ marginBottom: 16 }}>
        <label style={{ fontSize: 12, fontWeight: 600, color: C.textLight, display: "block", marginBottom: 4 }}>Notes</label>
        <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
          style={{ ...inp, width: "100%", boxSizing: "border-box", resize: "vertical" }} />
      </div>
      <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
        <Btn outline onClick={onClose}>Cancel</Btn>
        <Btn onClick={save} disabled={saving}>{saving ? "Saving…" : "Save Customer"}</Btn>
      </div>
    </Modal>
  );
}
