import { supabase } from "../../lib/supabase";
import { C } from "../../lib/constants";
import { RIVERSIDE_ACCOUNT_ID, RIVERSIDE_ACCOUNT_NAME } from "../../lib/riverside";

import InvoiceGeneration from "./InvoiceGeneration";
import InvoiceChasing from "./InvoiceChasing";
import JobCosting from "./JobCosting";
import CustomerPortal from "./CustomerPortal";
import HealthSafety from "./HealthSafety";
import FleetManager from "./FleetManager";
import AssetTracker from "./AssetTracker";
import BillsExpenses from "./BillsExpenses";
import OnlineBooking from "./OnlineBooking";
import WhatsAppBusiness from "./WhatsAppBusiness";

// YCA modules receive the platform context as props. Riverside is single-tenant,
// so we feed a fixed account id + the signed-in user.
const REAL_MODULES = {
  invoices: InvoiceGeneration,
  chasing: InvoiceChasing,
  "job-costing": JobCosting,
  portal: CustomerPortal,
  "health-safety": HealthSafety,
  fleet: FleetManager,
  assets: AssetTracker,
  bills: BillsExpenses,
  booking: OnlineBooking,
  whatsapp: WhatsAppBusiness,
};

function Placeholder({ title, note }) {
  return (
    <div style={{ background: C.white, border: `1px dashed ${C.border}`, borderRadius: 8, padding: 40, textAlign: "center" }}>
      <div style={{ fontSize: 18, fontWeight: 800, color: C.navy, marginBottom: 8 }}>{title}</div>
      <div style={{ fontSize: 13, color: C.textLight, maxWidth: 460, margin: "0 auto" }}>{note}</div>
    </div>
  );
}

const PLACEHOLDERS = {
  reviews: { title: "Review Manager", note: "Post-job review requests. Placeholder — not yet wired for Riverside." },
  proposals: { title: "Proposals & E-Signature", note: "Send proposals and capture e-signatures. Placeholder — not yet wired." },
  loyalty: { title: "Loyalty & Repeat Customer", note: "Repeat-customer tracking and loyalty offers. Placeholder — not yet wired." },
  documents: { title: "Document Vault", note: "Central document store. Placeholder — wire to a Riverside documents table + storage bucket when ready." },
};

export function ModulesHost({ moduleKey, session }) {
  const Mod = REAL_MODULES[moduleKey];
  if (Mod) {
    const userId = session?.user?.id || null;
    const userName = session?.user?.email || "Riverside";
    return (
      <Mod
        supabase={supabase}
        accountId={RIVERSIDE_ACCOUNT_ID}
        userId={userId}
        userName={userName}
        userRole="owner"
        accountName={RIVERSIDE_ACCOUNT_NAME}
        brandColor={C.navy}
        logoUrl={null}
      />
    );
  }
  const ph = PLACEHOLDERS[moduleKey];
  if (ph) return <Placeholder title={ph.title} note={ph.note} />;
  return <Placeholder title="Module" note="Unknown module." />;
}
