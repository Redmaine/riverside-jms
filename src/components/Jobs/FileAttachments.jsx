import { useState, useEffect, useCallback } from "react";
import { C } from "../../lib/constants";
import { supabase } from "../../lib/supabase";
import { Btn } from "../ui/Btn";

export function FileAttachments({ jobId, jobRef, toast, onDrawingUpload }) {
  const [files, setFiles] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [category, setCategory] = useState("Drawing");
  const CATS = ["Drawing", "Purchase Order", "Email / Correspondence", "Other"];

  const load = useCallback(async () => {
    if (!jobId) return;
    const { data } = await supabase.from("job_files").select("*").eq("job_id", jobId).order("uploaded_at", { ascending: false });
    setFiles(data || []);
  }, [jobId]);

  useEffect(() => { load(); }, [load]);

  const extractDrawingNumber = (filename) => {
    return filename.replace(/\.[^/.]+$/, "").replace(/[_-]?(rev|revision|v|ver)\s*\d+$/i, "").trim();
  };

  const handleFile = async (file) => {
    if (!file) return;
    if (!jobId) { toast("Cannot attach file — job ID missing. Please close and reopen this job.", "error"); return; }
    setUploading(true);
    try {
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const path = `${jobRef}/${Date.now()}_${safeName}`;
      const { error: upErr } = await supabase.storage.from("job-files").upload(path, file);
      if (upErr) throw upErr;
      const { error: dbErr } = await supabase.from("job_files").insert({ job_id: jobId, job_ref: jobRef, file_name: file.name, file_path: path, category, file_type: file.type });
      if (dbErr) throw dbErr;
      toast("File attached");
      if (category === "Drawing" && onDrawingUpload) {
        const suggested = extractDrawingNumber(file.name);
        onDrawingUpload(suggested);
      }
      load();
    } catch (err) { toast("Upload failed: " + err.message, "error"); }
    setUploading(false);
  };

  const open = async (f) => {
    const { data } = await supabase.storage.from("job-files").createSignedUrl(f.file_path, 3600);
    if (data?.signedUrl) window.open(data.signedUrl, "_blank");
    else toast("Could not open file", "error");
  };

  const del = async (f) => {
    await supabase.storage.from("job-files").remove([f.file_path]);
    await supabase.from("job_files").delete().eq("id", f.id);
    toast("File removed");
    load();
  };

  return (
    <div>
      <div style={{ display: "flex", gap: 6, marginBottom: 8, flexWrap: "wrap" }}>
        {CATS.map(c => (
          <button key={c} onClick={() => setCategory(c)} style={{
            padding: "4px 10px", border: `2px solid ${category === c ? C.navy : C.border}`,
            borderRadius: 6, background: category === c ? C.navy : "transparent",
            color: category === c ? C.white : C.text, cursor: "pointer", fontSize: 12, fontWeight: 600
          }}>{c}</button>
        ))}
      </div>
      <div onDrop={e => { e.preventDefault(); handleFile(e.dataTransfer.files[0]); }} onDragOver={e => e.preventDefault()}
        style={{ border: `2px dashed ${C.border}`, borderRadius: 6, padding: 14, textAlign: "center", background: C.silverLighter, marginBottom: 8 }}>
        <input type="file" onChange={e => handleFile(e.target.files[0])} style={{ display: "none" }} id={`file-${jobId}`} />
        <label htmlFor={`file-${jobId}`} style={{ cursor: "pointer", fontSize: 13, color: C.textLight }}>
          {uploading ? "Uploading…" : "📎 Drag file here or click to browse"}
        </label>
      </div>
      {files.map(f => (
        <div key={f.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", background: C.silverLighter, borderRadius: 4, marginBottom: 4, fontSize: 13 }}>
          <span style={{ flex: 1 }}>{f.file_name}</span>
          <span style={{ fontSize: 11, color: C.textLight, background: "#dde", borderRadius: 10, padding: "2px 8px" }}>{f.category}</span>
          <Btn small outline onClick={() => open(f)}>Open</Btn>
          <Btn small danger onClick={() => del(f)}>✕</Btn>
        </div>
      ))}
    </div>
  );
}
