import { useState, useEffect } from "react";
import { supabase } from "../../lib/supabase";
import { C, COMPANY } from "../../lib/constants";

function SignIn() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setErr("");
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (error) setErr(error.message);
  };

  return (
    <div style={{ minHeight: "100vh", background: C.bg, display: "flex", alignItems: "center", justifyContent: "center", padding: 16, fontFamily: "system-ui, sans-serif" }}>
      <form onSubmit={submit} style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 12, padding: 32, width: "100%", maxWidth: 380, boxShadow: "0 8px 40px rgba(0,0,0,0.12)" }}>
        <div style={{ fontSize: 18, fontWeight: 900, color: C.navy }}>{COMPANY.name}</div>
        <div style={{ fontSize: 12, color: C.textLight, marginBottom: 22 }}>Job Management System — sign in</div>
        <label style={{ fontSize: 12, fontWeight: 600, color: C.textLight, display: "block", marginBottom: 4 }}>Email</label>
        <input type="email" value={email} onChange={e => setEmail(e.target.value)} required autoFocus
          style={{ width: "100%", boxSizing: "border-box", padding: "9px 12px", border: `1px solid ${C.border}`, borderRadius: 6, fontSize: 14, marginBottom: 14 }} />
        <label style={{ fontSize: 12, fontWeight: 600, color: C.textLight, display: "block", marginBottom: 4 }}>Password</label>
        <input type="password" value={password} onChange={e => setPassword(e.target.value)} required
          style={{ width: "100%", boxSizing: "border-box", padding: "9px 12px", border: `1px solid ${C.border}`, borderRadius: 6, fontSize: 14, marginBottom: 18 }} />
        {err && <div style={{ background: "#fff0f0", border: `1px solid ${C.danger}`, color: C.danger, borderRadius: 6, padding: "8px 12px", fontSize: 13, marginBottom: 14 }}>{err}</div>}
        <button type="submit" disabled={busy}
          style={{ width: "100%", background: C.navy, color: C.white, border: "none", borderRadius: 6, padding: "11px", fontSize: 14, fontWeight: 700, cursor: busy ? "wait" : "pointer", opacity: busy ? 0.7 : 1 }}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}

export function AuthGate({ children }) {
  const [session, setSession] = useState(undefined); // undefined = still loading

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  if (session === undefined) {
    return (
      <div style={{ minHeight: "100vh", background: C.bg, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ color: C.navy, fontWeight: 700 }}>Loading…</div>
      </div>
    );
  }
  if (!session) return <SignIn />;
  return children;
}
