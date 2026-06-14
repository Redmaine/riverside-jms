/**
 * HealthSafety.jsx
 * Your Company AI — Health & Safety Compliance Module
 *
 * DEPENDENCIES (injected via props from core platform):
 *   supabase        — Supabase client instance
 *   accountId       — Current account UUID
 *   userId          — Current platform_user UUID
 *   userName        — Current user display name
 *   userRole        — 'owner' | 'manager' | 'staff'
 *
 * DATABASE TABLES USED:
 *   hs_risk_assessments   — Risk assessment documents
 *   hs_coshh              — COSHH assessments per substance
 *   hs_accidents          — Accident log with RIDDOR flag
 *   hs_toolbox_talks      — Toolbox talk records with sign-off
 *   hs_certifications     — Insurance, accreditations, expiry dates
 *   platform_users        — Employee sign-off records
 *   audit_log             — Audit trail
 *
 * EXTERNAL:
 *   Anthropic API — claude-haiku-4-5 for AI risk assessment walkthrough
 *
 * SCHEMA — add these tables to supabase_schema.sql:
 *
 * CREATE TABLE public.hs_risk_assessments (
 *   id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
 *   account_id      uuid REFERENCES public.accounts(id) ON DELETE CASCADE,
 *   title           text NOT NULL,
 *   activity        text NOT NULL,
 *   location        text,
 *   hazards         jsonb DEFAULT '[]',
 *   control_measures jsonb DEFAULT '[]',
 *   risk_level      text CHECK (risk_level IN ('low','medium','high','very_high')),
 *   residual_risk   text CHECK (residual_risk IN ('low','medium','high')),
 *   assessor_name   text,
 *   review_date     date,
 *   status          text DEFAULT 'draft' CHECK (status IN ('draft','active','review_due','archived')),
 *   created_at      timestamptz DEFAULT now(),
 *   updated_at      timestamptz DEFAULT now()
 * );
 *
 * CREATE TABLE public.hs_coshh (
 *   id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
 *   account_id      uuid REFERENCES public.accounts(id) ON DELETE CASCADE,
 *   substance_name  text NOT NULL,
 *   supplier        text,
 *   hazard_type     text[],
 *   ppe_required    text[],
 *   storage         text,
 *   disposal        text,
 *   emergency_proc  text,
 *   sds_url         text,
 *   review_date     date,
 *   created_at      timestamptz DEFAULT now()
 * );
 *
 * CREATE TABLE public.hs_accidents (
 *   id                  uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
 *   account_id          uuid REFERENCES public.accounts(id) ON DELETE CASCADE,
 *   incident_date       date NOT NULL,
 *   incident_time       time,
 *   location            text NOT NULL,
 *   person_name         text NOT NULL,
 *   person_type         text CHECK (person_type IN ('employee','subcontractor','member_of_public','visitor')),
 *   description         text NOT NULL,
 *   injury_type         text,
 *   first_aid_given     boolean DEFAULT false,
 *   hospital_attendance boolean DEFAULT false,
 *   days_lost           int DEFAULT 0,
 *   riddor_reportable   boolean DEFAULT false,
 *   riddor_type         text,
 *   riddor_reported_at  timestamptz,
 *   reported_by         text,
 *   witnesses           text,
 *   action_taken        text,
 *   created_at          timestamptz DEFAULT now()
 * );
 *
 * CREATE TABLE public.hs_toolbox_talks (
 *   id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
 *   account_id      uuid REFERENCES public.accounts(id) ON DELETE CASCADE,
 *   topic           text NOT NULL,
 *   delivered_by    text NOT NULL,
 *   delivered_date  date NOT NULL,
 *   location        text,
 *   notes           text,
 *   sign_offs       jsonb DEFAULT '[]',
 *   created_at      timestamptz DEFAULT now()
 * );
 *
 * CREATE TABLE public.hs_certifications (
 *   id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
 *   account_id      uuid REFERENCES public.accounts(id) ON DELETE CASCADE,
 *   name            text NOT NULL,
 *   cert_type       text,
 *   holder          text,
 *   issue_date      date,
 *   expiry_date     date NOT NULL,
 *   cert_number     text,
 *   document_url    text,
 *   reminder_days   int DEFAULT 60,
 *   created_at      timestamptz DEFAULT now()
 * );
 *
 * Enable RLS on all tables with standard account_id policies.
 */

import { useState, useMemo, useEffect, useCallback } from "react";

// ── CONSTANTS ───────────────────────────────────────────────────
const TABS = [
  { id: "dashboard",  label: "Dashboard" },
  { id: "risk",       label: "Risk Assessments" },
  { id: "coshh",      label: "COSHH" },
  { id: "accidents",  label: "Accident Log" },
  { id: "toolbox",    label: "Toolbox Talks" },
  { id: "certs",      label: "Certifications" },
];

const RISK_TEMPLATES = [
  { id: "working_at_height", title: "Working at Height", hazards: ["Falls from ladders or scaffolding", "Objects falling on others below", "Unstable surfaces", "Weather conditions"] },
  { id: "electrical_work",   title: "Electrical Work", hazards: ["Electric shock", "Arc flash", "Fire from short circuit", "Working near live conductors"] },
  { id: "manual_handling",   title: "Manual Handling", hazards: ["Musculoskeletal injury", "Dropped loads", "Crush injuries", "Slip/trip with load"] },
  { id: "coshh_substances",  title: "Working with Chemicals", hazards: ["Skin/eye contact", "Inhalation of fumes", "Ingestion", "Environmental contamination"] },
  { id: "confined_spaces",   title: "Confined Spaces", hazards: ["Oxygen deficiency", "Toxic atmosphere", "Engulfment", "Restricted movement"] },
  { id: "lone_working",      title: "Lone Working", hazards: ["No assistance if injured", "Assault or harassment", "Medical emergency", "Communication failure"] },
  { id: "hot_works",         title: "Hot Works (Welding/Cutting)", hazards: ["Burns and fire", "Toxic fumes", "Eye damage from UV", "Explosion risk"] },
  { id: "excavation",        title: "Excavation / Groundworks", hazards: ["Collapse of trench sides", "Underground services", "Falling objects", "Flooding"] },
];

const RIDDOR_TYPES = [
  "Death", "Specified injury (fracture, amputation, loss of sight, etc.)",
  "Over-7-day incapacitation", "Dangerous occurrence", "Disease (occupational)",
  "Gas incident",
];

const today = new Date();
const daysUntil = (d) => d ? Math.ceil((new Date(d) - today) / 86400000) : null;
const formatDate = (d) => d ? new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—";

// ── STYLES ──────────────────────────────────────────────────────
const css = `
  @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=DM+Sans:wght@300;400;500&display=swap');

  .hs-wrap * { box-sizing: border-box; margin: 0; padding: 0; }
  .hs-wrap {
    --ember:    #E8410A;
    --ember-lt: #FF6B3D;
    --steel:    #1C1C2E;
    --chalk:    #F7F4EF;
    --mist:     #8C8CA8;
    --mid:      #555555;
    --light:    #888888;
    --rule:     #E8E4DE;
    --white:    #FFFFFF;
    --green:    #22C55E;
    --amber:    #EAB308;
    --red:      #EF4444;
    --radius:   8px;
    font-family: 'DM Sans', sans-serif;
    color: var(--mid);
    background: #F0EDE8;
    min-height: 100vh;
    padding: 24px;
  }

  .hs-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 24px; }
  .hs-header h1 { font-family: 'Plus Jakarta Sans', sans-serif; font-weight: 800; font-size: 22px; color: var(--steel); }
  .hs-header p  { font-size: 13px; color: var(--mist); margin-top: 2px; }

  .hs-tabs { display: flex; gap: 4px; background: var(--white); border: 1px solid var(--rule); border-radius: var(--radius); padding: 4px; margin-bottom: 24px; overflow-x: auto; }
  .hs-tab  { flex: 1; min-width: fit-content; padding: 8px 14px; border: none; background: none; border-radius: 6px; font-family: 'DM Sans', sans-serif; font-size: 13px; font-weight: 500; color: var(--light); cursor: pointer; white-space: nowrap; transition: all 0.15s; }
  .hs-tab.active { background: var(--steel); color: var(--white); }
  .hs-tab .badge { display: inline-flex; align-items: center; justify-content: center; width: 18px; height: 18px; background: var(--ember); color: white; border-radius: 50%; font-size: 10px; font-weight: 700; margin-left: 6px; }

  .hs-card { background: var(--white); border: 1px solid var(--rule); border-radius: var(--radius); padding: 20px; margin-bottom: 16px; }
  .hs-card-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 16px; margin-bottom: 24px; }
  .hs-stat-card { background: var(--white); border: 1px solid var(--rule); border-radius: var(--radius); padding: 18px 20px; }
  .hs-stat-label { font-size: 11px; font-weight: 600; color: var(--mist); text-transform: uppercase; letter-spacing: 1px; margin-bottom: 8px; }
  .hs-stat-value { font-family: 'Plus Jakarta Sans', sans-serif; font-weight: 800; font-size: 28px; color: var(--steel); line-height: 1; }
  .hs-stat-sub   { font-size: 12px; color: var(--mist); margin-top: 4px; }
  .hs-section-heading { font-family: 'Plus Jakarta Sans', sans-serif; font-weight: 700; font-size: 14px; color: var(--steel); margin-bottom: 12px; padding-bottom: 8px; border-bottom: 1px solid var(--rule); }

  /* Risk level badges */
  .hs-risk-low      { background: #DCFCE7; color: #166534; }
  .hs-risk-medium   { background: #FFFBEB; color: #92400E; }
  .hs-risk-high     { background: #FEE2E2; color: #991B1B; }
  .hs-risk-very_high{ background: #450A0A; color: #FCA5A5; }

  /* RA card */
  .hs-ra-card { background: var(--white); border: 1px solid var(--rule); border-radius: var(--radius); padding: 16px 18px; margin-bottom: 10px; transition: border-color 0.15s; }
  .hs-ra-card:hover { border-color: var(--mist); }

  /* Document row */
  .hs-doc-row { display: flex; align-items: center; justify-content: space-between; padding: 12px 0; border-bottom: 1px solid var(--rule); font-size: 13px; }
  .hs-doc-row:last-child { border-bottom: none; }

  /* AI walkthrough */
  .hs-ai-chat { background: var(--chalk); border: 1px solid var(--rule); border-radius: var(--radius); padding: 16px; margin-bottom: 16px; }
  .hs-ai-message { padding: 10px 14px; border-radius: 10px; margin-bottom: 8px; font-size: 13px; line-height: 1.6; }
  .hs-ai-from-ai   { background: var(--steel); color: rgba(255,255,255,0.9); border-bottom-left-radius: 2px; }
  .hs-ai-from-user { background: var(--white); color: var(--mid); border: 1px solid var(--rule); border-bottom-right-radius: 2px; margin-left: 24px; }

  /* Template grid */
  .hs-template-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 10px; margin-bottom: 20px; }
  .hs-template-btn { padding: 12px 14px; border: 1px solid var(--rule); border-radius: 6px; background: var(--white); cursor: pointer; text-align: left; font-family: 'DM Sans', sans-serif; font-size: 13px; font-weight: 500; color: var(--steel); transition: all 0.15s; }
  .hs-template-btn:hover { border-color: var(--ember); background: var(--chalk); }
  .hs-template-btn.selected { border-color: var(--ember); background: #FFF1EC; }

  /* Accident RIDDOR banner */
  .hs-riddor-banner { background: #450A0A; border: 1px solid #991B1B; border-radius: var(--radius); padding: 16px 20px; margin-bottom: 16px; }
  .hs-riddor-title  { font-family: 'Plus Jakarta Sans', sans-serif; font-weight: 800; font-size: 15px; color: #FCA5A5; margin-bottom: 4px; }
  .hs-riddor-body   { font-size: 13px; color: #FECACA; line-height: 1.5; }

  /* Sign off row */
  .hs-signoff-row { display: flex; align-items: center; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid var(--rule); font-size: 13px; }
  .hs-signoff-row:last-child { border-bottom: none; }

  /* Cert expiry */
  .hs-cert-green  { border-left: 3px solid #22C55E; }
  .hs-cert-amber  { border-left: 3px solid #EAB308; }
  .hs-cert-red    { border-left: 3px solid #EF4444; }

  /* Buttons */
  .hs-btn { display: inline-flex; align-items: center; gap: 6px; padding: 8px 14px; border-radius: 6px; font-family: 'DM Sans', sans-serif; font-size: 13px; font-weight: 500; cursor: pointer; border: none; transition: all 0.15s; white-space: nowrap; }
  .hs-btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .hs-btn-primary   { background: var(--ember); color: white; }
  .hs-btn-primary:hover:not(:disabled) { background: var(--ember-lt); }
  .hs-btn-secondary { background: var(--chalk); color: var(--steel); border: 1px solid var(--rule); }
  .hs-btn-secondary:hover:not(:disabled) { border-color: var(--mist); }
  .hs-btn-ghost     { background: none; color: var(--mist); border: 1px solid var(--rule); }
  .hs-btn-ghost:hover:not(:disabled) { color: var(--steel); border-color: var(--steel); }
  .hs-btn-sm        { padding: 5px 10px; font-size: 12px; }
  .hs-btn-danger    { background: #FEE2E2; color: #991B1B; border: 1px solid #FECACA; }

  /* Pill */
  .hs-pill { display: inline-flex; align-items: center; padding: 3px 10px; border-radius: 20px; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; }
  .hs-pill-active   { background: #DCFCE7; color: #166534; }
  .hs-pill-draft    { background: #EFF6FF; color: #1E40AF; }
  .hs-pill-review   { background: #FEF9C3; color: #854D0E; }
  .hs-pill-archived { background: #F3F4F6; color: #6B7280; }
  .hs-pill-riddor   { background: #450A0A; color: #FCA5A5; }

  /* Form */
  .hs-input { width: 100%; padding: 9px 12px; border: 1px solid var(--rule); border-radius: 6px; font-family: 'DM Sans', sans-serif; font-size: 14px; color: var(--steel); outline: none; transition: border-color 0.15s; background: white; }
  .hs-input:focus { border-color: var(--ember); }
  .hs-input-label { font-size: 13px; font-weight: 500; color: var(--steel); margin-bottom: 6px; display: block; }
  .hs-input-group { margin-bottom: 16px; }
  .hs-form-grid   { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  .hs-textarea    { min-height: 80px; resize: vertical; }

  /* Modal */
  .hs-modal-overlay { position: fixed; inset: 0; background: rgba(28,28,46,0.5); display: flex; align-items: center; justify-content: center; z-index: 100; padding: 20px; }
  .hs-modal { background: var(--white); border-radius: var(--radius); padding: 24px; width: 100%; max-width: 580px; max-height: 90vh; overflow-y: auto; }
  .hs-modal-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px; }
  .hs-modal-title  { font-family: 'Plus Jakarta Sans', sans-serif; font-weight: 700; font-size: 16px; color: var(--steel); }

  /* Alert */
  .hs-alert { padding: 12px 16px; border-radius: var(--radius); font-size: 13px; margin-bottom: 16px; }
  .hs-alert-success { background: #DCFCE7; border: 1px solid #BBF7D0; color: #166534; }
  .hs-alert-warning { background: #FFFBEB; border: 1px solid #FDE68A; color: #92400E; }
  .hs-alert-info    { background: #EFF6FF; border: 1px solid #BFDBFE; color: #1E40AF; }
  .hs-alert-danger  { background: #FEF2F2; border: 1px solid #FECACA; color: #991B1B; }

  /* Empty */
  .hs-empty { text-align: center; padding: 48px 24px; color: var(--mist); }
  .hs-empty h3 { font-size: 16px; color: var(--steel); margin-bottom: 6px; }

  /* Spinner */
  .hs-spinner { width: 18px; height: 18px; border: 2px solid rgba(255,255,255,0.3); border-top-color: white; border-radius: 50%; animation: hs-spin 0.6s linear infinite; display: inline-block; }
  @keyframes hs-spin { to { transform: rotate(360deg); } }
`;

// ── HELPERS ─────────────────────────────────────────────────────
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

// ── MOCK DATA ───────────────────────────────────────────────────
const MOCK_RAS = [
  { id: "ra1", title: "Working at Height — Ladder Use", activity: "External gutter clearing and fascia work", risk_level: "high", residual_risk: "low", assessor_name: "Adrian Fielding", review_date: "2027-01-01", status: "active", hazards: ["Falls from ladders", "Objects falling on others", "Unstable ground"], control_measures: ["Inspect ladder before use", "Three-point contact always", "Cordon off below working area", "Spotter present for heights over 2m"], created_at: "2026-01-15" },
  { id: "ra2", title: "Electrical Work — Consumer Unit", activity: "Consumer unit replacement and circuit testing", risk_level: "very_high", residual_risk: "medium", assessor_name: "Adrian Fielding", review_date: "2026-07-01", status: "review_due", hazards: ["Electric shock", "Arc flash", "Fire"], control_measures: ["Isolate supply before starting", "Lock off and prove dead", "Insulated tools only", "PPE — Class 0 gloves and face shield"], created_at: "2026-01-15" },
  { id: "ra3", title: "Manual Handling — Heavy Components", activity: "Moving boilers, cylinders, and heavy equipment", risk_level: "medium", residual_risk: "low", assessor_name: "Steve Harris", review_date: "2027-01-15", status: "active", hazards: ["Back injury", "Crush injuries", "Trips with load"], control_measures: ["Team lift for items over 25kg", "Mechanical aids where possible", "Clear path before moving"], created_at: "2026-01-20" },
];

const MOCK_ACCIDENTS = [
  { id: "acc1", incident_date: "2026-04-12", location: "23 Oak Street, Worthing", person_name: "Dave Thompson", person_type: "employee", description: "Slipped on wet floor while carrying tools. Twisted ankle. No hospital attendance.", injury_type: "Sprain — ankle", first_aid_given: true, hospital_attendance: false, days_lost: 1, riddor_reportable: false, reported_by: "Adrian Fielding" },
];

const MOCK_TOOLBOX = [
  { id: "tb1", topic: "Working at Height — Ladder Safety", delivered_by: "Adrian Fielding", delivered_date: "2026-05-15", location: "Workshop", notes: "Refresher ahead of summer exterior maintenance season.", sign_offs: [{ name: "Dave Thompson", signed: true, date: "2026-05-15" }, { name: "Steve Harris", signed: true, date: "2026-05-15" }] },
  { id: "tb2", topic: "Manual Handling Best Practice", delivered_by: "Adrian Fielding", delivered_date: "2026-04-01", location: "Workshop", notes: "New guidance on team lifts for boiler replacements.", sign_offs: [{ name: "Dave Thompson", signed: true, date: "2026-04-01" }, { name: "Steve Harris", signed: false, date: null }] },
];

const MOCK_CERTS = [
  { id: "cert1", name: "Public Liability Insurance", holder: "Redmaine Ltd", expiry_date: "2026-09-30", cert_type: "Insurance", cert_number: "PLI-2024-8841" },
  { id: "cert2", name: "Gas Safe Registration", holder: "Dave Thompson", expiry_date: "2026-08-01", cert_type: "Accreditation", cert_number: "GS-54443" },
  { id: "cert3", name: "NICEIC Domestic Installer", holder: "Redmaine Ltd", expiry_date: "2027-03-15", cert_type: "Accreditation", cert_number: "NICE-00441" },
  { id: "cert4", name: "Employers Liability Insurance", holder: "Redmaine Ltd", expiry_date: "2026-09-30", cert_type: "Insurance", cert_number: "ELI-2024-2287" },
];

// ── Live-schema <-> UI adapters ──────────────────────────────────
// hs_risk_assessments stores hazards in a child table (hs_risk_hazards) and
// has no single risk_level column, so we derive sensible UI values.
function mapRA(row) {
  const hazardRows = row.hazards || [];
  const controls = [];
  for (const h of hazardRows) {
    if (h.controls) controls.push(...String(h.controls).split(";").map((s) => s.trim()).filter(Boolean));
  }
  return {
    id: row.id,
    title: row.title,
    activity: row.activity_type || "",
    location: row.location || "",
    risk_level: "medium",
    residual_risk: "low",
    assessor_name: row.assessor_name || "",
    review_date: row.review_date,
    status: row.status,
    hazards: hazardRows.map((h) => h.hazard),
    control_measures: [...new Set(controls)],
    created_at: row.created_at,
  };
}
function mapAccident(row) {
  return {
    id: row.id,
    incident_date: row.incident_date ? String(row.incident_date).split("T")[0] : null,
    location: row.location,
    person_name: row.person_involved,
    person_type: row.is_employee ? "employee" : "other",
    description: row.description,
    injury_type: row.injury_details || "",
    first_aid_given: false,
    hospital_attendance: false,
    days_lost: 0,
    riddor_reportable: !!row.riddor_reportable,
    reported_by: "",
  };
}
function mapToolbox(row) {
  return {
    id: row.id,
    topic: row.title,
    delivered_by: "",
    delivered_date: row.delivery_date,
    location: "",
    notes: row.content || "",
    sign_offs: (row.signoffs || []).map((s) => ({ name: s.employee_id, signed: true, date: s.signed_at ? String(s.signed_at).split("T")[0] : null })),
  };
}
function mapCert(row) {
  return {
    id: row.id,
    name: row.cert_type,
    holder: row.holder_name || "",
    expiry_date: row.expiry_date,
    cert_type: row.issuer || "",
    cert_number: row.cert_number || "",
  };
}

// ── MAIN COMPONENT ──────────────────────────────────────────────
export default function HealthSafety({
  supabase, accountId, userId, userName, userRole,
}) {
  const [activeTab, setActiveTab] = useState("dashboard");
  const [ras, setRas] = useState([]);
  const [accidents, setAccidents] = useState([]);
  const [toolbox, setToolbox] = useState([]);
  const [certs, setCerts] = useState([]);
  const [coshh, setCoshh] = useState([]);
  const [coshhDetail, setCoshhDetail] = useState(null); // substance whose detail view is open
  const [loading, setLoading] = useState(true);

  const [showRABuilder, setShowRABuilder] = useState(false);
  const [showAccidentForm, setShowAccidentForm] = useState(false);
  const [showToolboxForm, setShowToolboxForm] = useState(false);
  const [showCertForm, setShowCertForm] = useState(false);
  const [alert, setAlert] = useState(null);

  const showAlertMsg = (type, msg) => {
    setAlert({ type, message: msg });
    setTimeout(() => setAlert(null), 4000);
  };

  // ── Load real data (RLS scopes to this account) ──
  const loadData = useCallback(async () => {
    setLoading(true);
    const [raRes, accRes, tbRes, certRes, coshhRes] = await Promise.all([
      supabase.from("hs_risk_assessments").select("*, hazards:hs_risk_hazards(*)").order("created_at", { ascending: false }),
      supabase.from("hs_accidents").select("*").order("incident_date", { ascending: false }),
      supabase.from("hs_toolbox_talks").select("*, signoffs:hs_toolbox_talk_signoffs(*)").order("delivery_date", { ascending: false }),
      supabase.from("hs_certifications").select("*").order("expiry_date"),
      supabase.from("hs_coshh").select("*").order("substance_name"),
    ]);
    if (!raRes.error) setRas((raRes.data || []).map(mapRA));
    else showAlertMsg("error", `Could not load risk assessments: ${raRes.error.message}`);
    if (!accRes.error) setAccidents((accRes.data || []).map(mapAccident));
    if (!tbRes.error) setToolbox((tbRes.data || []).map(mapToolbox));
    if (!certRes.error) setCerts((certRes.data || []).map(mapCert));
    if (!coshhRes.error) setCoshh(coshhRes.data || []);
    setLoading(false);
  }, [supabase]);

  useEffect(() => { loadData(); }, [loadData]);

  // Stats
  const activeRAs = ras.filter((r) => r.status === "active").length;
  const reviewDue = ras.filter((r) => r.status === "review_due").length;
  const riddorAccidents = accidents.filter((a) => a.riddor_reportable).length;
  const certsDue = certs.filter((c) => { const d = daysUntil(c.expiry_date); return d !== null && d <= 60; }).length;
  const unsignedToolbox = toolbox.flatMap((t) => t.sign_offs).filter((s) => !s.signed).length;

  const certStatus = (expiry) => {
    const d = daysUntil(expiry);
    if (d === null) return "grey";
    if (d < 0) return "red";
    if (d <= 30) return "red";
    if (d <= 60) return "amber";
    return "green";
  };

  return (
    <>
      <style>{css}</style>
      <div className="hs-wrap">

        <div className="hs-header">
          <div>
            <h1>Health & Safety</h1>
            <p>Risk assessments · COSHH · Accident log · Toolbox talks · Certifications</p>
          </div>
          <button className="hs-btn hs-btn-primary" onClick={() => setShowRABuilder(true)}>
            + Risk Assessment
          </button>
        </div>

        {alert && <div className={`hs-alert hs-alert-${alert.type}`}>{alert.message}</div>}

        {/* Stats */}
        <div className="hs-card-grid">
          <div className="hs-stat-card">
            <div className="hs-stat-label">Active RAs</div>
            <div className="hs-stat-value">{activeRAs}</div>
            <div className="hs-stat-sub">{reviewDue > 0 ? `${reviewDue} due for review` : "All current"}</div>
          </div>
          <div className="hs-stat-card">
            <div className="hs-stat-label">RIDDOR Accidents</div>
            <div className="hs-stat-value" style={{ color: riddorAccidents > 0 ? "#EF4444" : "#22C55E" }}>{riddorAccidents}</div>
            <div className="hs-stat-sub">Reported this year</div>
          </div>
          <div className="hs-stat-card">
            <div className="hs-stat-label">Certs Expiring</div>
            <div className="hs-stat-value" style={{ color: certsDue > 0 ? "#EAB308" : "#22C55E" }}>{certsDue}</div>
            <div className="hs-stat-sub">Within 60 days</div>
          </div>
          <div className="hs-stat-card">
            <div className="hs-stat-label">Unsigned Talks</div>
            <div className="hs-stat-value" style={{ color: unsignedToolbox > 0 ? "#EAB308" : "#22C55E" }}>{unsignedToolbox}</div>
            <div className="hs-stat-sub">Awaiting sign-off</div>
          </div>
        </div>

        {/* Tabs */}
        <div className="hs-tabs">
          {TABS.map((tab) => (
            <button key={tab.id} className={`hs-tab ${activeTab === tab.id ? "active" : ""}`} onClick={() => setActiveTab(tab.id)}>
              {tab.label}
              {tab.id === "risk" && reviewDue > 0 && <span className="badge">{reviewDue}</span>}
              {tab.id === "accidents" && riddorAccidents > 0 && <span className="badge">{riddorAccidents}</span>}
              {tab.id === "certs" && certsDue > 0 && <span className="badge">{certsDue}</span>}
            </button>
          ))}
        </div>

        {/* ── DASHBOARD ─────────────────────────────────────── */}
        {activeTab === "dashboard" && (
          <div>
            {reviewDue > 0 && (
              <div className="hs-alert hs-alert-warning">
                {reviewDue} risk assessment{reviewDue > 1 ? "s are" : " is"} due for review. Review and update before the next time this activity is carried out.
              </div>
            )}
            {certsDue > 0 && (
              <div className="hs-alert hs-alert-warning">
                {certsDue} certification{certsDue > 1 ? "s are" : " is"} expiring within 60 days. Check the Certifications tab.
              </div>
            )}
            <div className="hs-card">
              <div className="hs-section-heading">All Risk Assessments</div>
              {ras.map((ra) => (
                <div key={ra.id} className="hs-doc-row">
                  <div>
                    <div style={{ fontWeight: 600, color: "var(--steel)", fontSize: 14 }}>{ra.title}</div>
                    <div style={{ fontSize: 12, color: "var(--mist)", marginTop: 2 }}>Review due: {formatDate(ra.review_date)} · {ra.assessor_name}</div>
                  </div>
                  <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <span className={`hs-pill hs-pill-${ra.status}`}>{ra.status === "review_due" ? "Review due" : ra.status}</span>
                    <span className={`hs-pill hs-risk-${ra.risk_level}`}>{ra.risk_level?.replace("_", " ")}</span>
                  </div>
                </div>
              ))}
            </div>
            <div className="hs-card">
              <div className="hs-section-heading">Certifications Expiry</div>
              {certs.map((cert) => {
                const days = daysUntil(cert.expiry_date);
                const status = certStatus(cert.expiry_date);
                return (
                  <div key={cert.id} className="hs-doc-row">
                    <div>
                      <div style={{ fontWeight: 600, color: "var(--steel)", fontSize: 14 }}>{cert.name}</div>
                      <div style={{ fontSize: 12, color: "var(--mist)", marginTop: 2 }}>{cert.holder} · {cert.cert_number}</div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: status === "red" ? "#991B1B" : status === "amber" ? "#92400E" : "#166534" }}>
                        {formatDate(cert.expiry_date)}
                      </div>
                      <div style={{ fontSize: 11, color: "var(--mist)", marginTop: 1 }}>
                        {days === null ? "" : days < 0 ? "Expired" : `${days} days`}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── RISK ASSESSMENTS ──────────────────────────────── */}
        {activeTab === "risk" && (
          <div>
            <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 16 }}>
              <button className="hs-btn hs-btn-primary" onClick={() => setShowRABuilder(true)}>+ New Risk Assessment</button>
            </div>
            {ras.map((ra) => (
              <div key={ra.id} className="hs-ra-card">
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 10 }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 15, color: "var(--steel)" }}>{ra.title}</div>
                    <div style={{ fontSize: 13, color: "var(--mist)", marginTop: 2 }}>{ra.activity}</div>
                    <div style={{ fontSize: 12, color: "var(--mist)", marginTop: 2 }}>Assessed by {ra.assessor_name} · Review: {formatDate(ra.review_date)}</div>
                  </div>
                  <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                    <span className={`hs-pill hs-risk-${ra.risk_level}`}>{ra.risk_level?.replace("_", " ")} risk</span>
                    <span className={`hs-pill hs-pill-${ra.status}`}>{ra.status === "review_due" ? "Review due" : ra.status}</span>
                  </div>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 600, color: "var(--mist)", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 6 }}>Hazards identified</div>
                    {ra.hazards.map((h, i) => <div key={i} style={{ fontSize: 12, color: "var(--mid)", paddingLeft: 10, borderLeft: "2px solid #EF4444", marginBottom: 3 }}>{h}</div>)}
                  </div>
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 600, color: "var(--mist)", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 6 }}>Control measures</div>
                    {ra.control_measures.map((m, i) => <div key={i} style={{ fontSize: 12, color: "var(--mid)", paddingLeft: 10, borderLeft: "2px solid #22C55E", marginBottom: 3 }}>{m}</div>)}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                  <button className="hs-btn hs-btn-secondary hs-btn-sm">Download PDF</button>
                  {ra.status === "review_due" && (
                    <button className="hs-btn hs-btn-primary hs-btn-sm" onClick={() => {
                      setRas((prev) => prev.map((r) => r.id === ra.id ? { ...r, status: "active", review_date: new Date(Date.now() + 365 * 86400000).toISOString().split("T")[0] } : r));
                      showAlertMsg("success", "Risk assessment reviewed and updated.");
                    }}>Mark Reviewed</button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── COSHH ─────────────────────────────────────────── */}
        {activeTab === "coshh" && (
          <div>
            <div className="hs-alert hs-alert-info">
              COSHH — Control of Substances Hazardous to Health. Log every chemical or hazardous substance used in your work. Include the safety data sheet (SDS) from the manufacturer.
            </div>
            <div className="hs-card">
              <div className="hs-section-heading">Substances Register</div>
              {coshh.length === 0 ? (
                <p style={{ fontSize: 13, color: "var(--mist)" }}>No substances logged yet.</p>
              ) : coshh.map((s) => (
                <div
                  key={s.id}
                  className="hs-doc-row"
                  role="button"
                  style={{ cursor: "pointer" }}
                  onClick={() => setCoshhDetail(s)}
                >
                  <div>
                    <div style={{ fontWeight: 600, color: "var(--steel)", fontSize: 14 }}>{s.substance_name}</div>
                    <div style={{ fontSize: 12, color: "var(--mist)", marginTop: 2 }}>
                      {[s.supplier && `Supplier: ${s.supplier}`, (s.ppe_required?.length) && `PPE: ${s.ppe_required.join(", ")}`].filter(Boolean).join(" · ")}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
                    {(s.hazard_type || []).map((h) => (
                      <span key={h} className="hs-pill" style={{ background: "#FEF9C3", color: "#854D0E" }}>{h}</span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <button className="hs-btn hs-btn-primary">+ Add Substance</button>
          </div>
        )}

        {/* ── ACCIDENT LOG ──────────────────────────────────── */}
        {activeTab === "accidents" && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
              <div className="hs-alert hs-alert-warning" style={{ marginBottom: 0, flex: 1, marginRight: 12 }}>
                All accidents must be logged, however minor. RIDDOR reportable incidents must be reported to the HSE within 10 days (or 15 days for over-7-day injuries).
              </div>
              <button className="hs-btn hs-btn-danger" style={{ flexShrink: 0 }} onClick={() => setShowAccidentForm(true)}>
                Log Accident
              </button>
            </div>

            {accidents.filter((a) => a.riddor_reportable).map((acc) => (
              <div key={acc.id} className="hs-riddor-banner">
                <div className="hs-riddor-title">RIDDOR Reportable Incident</div>
                <div className="hs-riddor-body">
                  {acc.person_name} · {formatDate(acc.incident_date)} · {acc.location}
                  <br />{acc.description}
                  <br /><strong>Action required:</strong> Report to HSE at riddor.hse.gov.uk within the statutory time limit.
                </div>
              </div>
            ))}

            <div className="hs-card">
              <div className="hs-section-heading">All Accidents ({accidents.length})</div>
              {accidents.length === 0 ? (
                <div className="hs-empty" style={{ padding: "32px 0" }}><p>No accidents logged. Keep it that way.</p></div>
              ) : (
                accidents.map((acc) => (
                  <div key={acc.id} className="hs-doc-row">
                    <div>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
                        <span style={{ fontWeight: 600, color: "var(--steel)", fontSize: 14 }}>{acc.person_name}</span>
                        {acc.riddor_reportable && <span className="hs-pill hs-pill-riddor">RIDDOR</span>}
                      </div>
                      <div style={{ fontSize: 12, color: "var(--mist)" }}>
                        {formatDate(acc.incident_date)} · {acc.location} · {acc.injury_type}
                      </div>
                      <div style={{ fontSize: 12, color: "var(--mid)", marginTop: 4 }}>{acc.description}</div>
                    </div>
                    <button className="hs-btn hs-btn-ghost hs-btn-sm">View</button>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* ── TOOLBOX TALKS ─────────────────────────────────── */}
        {activeTab === "toolbox" && (
          <div>
            <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 16 }}>
              <button className="hs-btn hs-btn-primary" onClick={() => setShowToolboxForm(true)}>+ Record Toolbox Talk</button>
            </div>
            {toolbox.map((talk) => (
              <div key={talk.id} className="hs-card">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 15, color: "var(--steel)" }}>{talk.topic}</div>
                    <div style={{ fontSize: 12, color: "var(--mist)", marginTop: 2 }}>
                      Delivered by {talk.delivered_by} · {formatDate(talk.delivered_date)} · {talk.location}
                    </div>
                    {talk.notes && <div style={{ fontSize: 13, color: "var(--mid)", marginTop: 4 }}>{talk.notes}</div>}
                  </div>
                  <button className="hs-btn hs-btn-ghost hs-btn-sm">Download PDF</button>
                </div>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: "var(--mist)", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 8 }}>Sign-off</div>
                  {talk.sign_offs.map((s) => (
                    <div key={s.name} className="hs-signoff-row">
                      <span style={{ fontWeight: 500, color: "var(--steel)", fontSize: 13 }}>{s.name}</span>
                      {s.signed ? (
                        <span style={{ fontSize: 12, color: "#166534" }}>Signed {formatDate(s.date)}</span>
                      ) : (
                        <button
                          className="hs-btn hs-btn-primary hs-btn-sm"
                          onClick={() => {
                            setToolbox((prev) => prev.map((t) =>
                              t.id === talk.id ? {
                                ...t,
                                sign_offs: t.sign_offs.map((so) =>
                                  so.name === s.name ? { ...so, signed: true, date: new Date().toISOString().split("T")[0] } : so
                                ),
                              } : t
                            ));
                            showAlertMsg("success", `${s.name} signed off.`);
                          }}
                        >
                          Sign Off
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── CERTIFICATIONS ────────────────────────────────── */}
        {activeTab === "certs" && (
          <div>
            <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 16 }}>
              <button className="hs-btn hs-btn-primary" onClick={() => setShowCertForm(true)}>+ Add Certification</button>
            </div>
            {certs.map((cert) => {
              const days = daysUntil(cert.expiry_date);
              const status = certStatus(cert.expiry_date);
              return (
                <div key={cert.id} className="hs-card" style={{ borderLeft: `4px solid ${status === "red" ? "#EF4444" : status === "amber" ? "#EAB308" : "#22C55E"}` }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 15, color: "var(--steel)" }}>{cert.name}</div>
                      <div style={{ fontSize: 13, color: "var(--mist)", marginTop: 2 }}>{cert.holder} · {cert.cert_type} · {cert.cert_number}</div>
                    </div>
                    <div style={{ textAlign: "right", flexShrink: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: 14, color: status === "red" ? "#991B1B" : status === "amber" ? "#92400E" : "#166534" }}>
                        Expires {formatDate(cert.expiry_date)}
                      </div>
                      <div style={{ fontSize: 12, color: "var(--mist)", marginTop: 1 }}>
                        {days === null ? "" : days < 0 ? "Expired" : days === 0 ? "Expires today" : `${days} days remaining`}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* ── MODALS ────────────────────────────────────────── */}
        {showRABuilder && (
          <RABuilderModal
            supabase={supabase}
            onSubmit={async (data) => {
              const { data: ra, error } = await supabase.from("hs_risk_assessments").insert({
                account_id: accountId,
                title: data.title,
                activity_type: data.activity || null,
                location: data.location || null,
                status: "active",
                review_date: data.review_date || null,
                assessor_name: data.assessor_name || userName,
              }).select("*").single();
              if (error) { showAlertMsg("error", `Could not create RA: ${error.message}`); return; }
              const controlsJoined = (data.control_measures || []).join("; ") || null;
              const hazardRows = (data.hazards || []).map((h, idx) => ({
                account_id: accountId, risk_assessment_id: ra.id, hazard: h, controls: controlsJoined, sort_order: idx,
              }));
              let hazards = [];
              if (hazardRows.length) {
                const { data: hz } = await supabase.from("hs_risk_hazards").insert(hazardRows).select("*");
                hazards = hz || [];
              }
              setRas((prev) => [mapRA({ ...ra, hazards }), ...prev]);
              setShowRABuilder(false);
              await logAction(supabase, { accountId, userId, userName, userRole, action: "created", entityType: "risk_assessment", entityId: ra.id, entityName: data.title });
              showAlertMsg("success", "Risk assessment created.");
            }}
            onClose={() => setShowRABuilder(false)}
            userName={userName}
          />
        )}

        {showAccidentForm && (
          <AccidentFormModal
            onSubmit={async (data) => {
              const extras = [data.injury_type, data.first_aid_given ? "First aid given" : null, data.hospital_attendance ? "Hospital attendance" : null, data.days_lost ? `${data.days_lost} days lost` : null].filter(Boolean).join(" · ");
              const { data: inserted, error } = await supabase.from("hs_accidents").insert({
                account_id: accountId,
                incident_date: data.incident_date || new Date().toISOString(),
                location: data.location,
                description: data.description,
                injury_details: extras || null,
                person_involved: data.person_name,
                is_employee: data.person_type === "employee",
                riddor_reportable: !!data.riddor_reportable,
                logged_by: userId,
              }).select("*").single();
              if (error) { showAlertMsg("error", `Could not log accident: ${error.message}`); return; }
              setAccidents((prev) => [mapAccident(inserted), ...prev]);
              setShowAccidentForm(false);
              await logAction(supabase, { accountId, userId, userName, userRole, action: "created", entityType: "accident", entityId: inserted.id, entityName: `Incident — ${data.person_name}` });
              if (data.riddor_reportable) {
                showAlertMsg("warning", "RIDDOR reportable incident logged. Report to HSE at riddor.hse.gov.uk within the statutory time limit.");
              } else {
                showAlertMsg("success", "Accident logged.");
              }
            }}
            onClose={() => setShowAccidentForm(false)}
          />
        )}

        {showToolboxForm && (
          <ToolboxFormModal
            onSubmit={async (data) => {
              const { data: inserted, error } = await supabase.from("hs_toolbox_talks").insert({
                account_id: accountId,
                title: data.topic,
                content: data.notes || null,
                delivery_date: data.delivered_date || new Date().toISOString().split("T")[0],
                delivered_by: userId,
              }).select("*").single();
              if (error) { showAlertMsg("error", `Could not record talk: ${error.message}`); return; }
              const mapped = { ...mapToolbox(inserted), delivered_by: data.delivered_by || userName, location: data.location || "", sign_offs: data.sign_offs || [] };
              setToolbox((prev) => [mapped, ...prev]);
              setShowToolboxForm(false);
              await logAction(supabase, { accountId, userId, userName, userRole, action: "created", entityType: "toolbox_talk", entityId: inserted.id, entityName: data.topic });
              showAlertMsg("success", "Toolbox talk recorded.");
            }}
            onClose={() => setShowToolboxForm(false)}
            deliveredBy={userName}
          />
        )}

        {showCertForm && (
          <CertFormModal
            onSubmit={async (data) => {
              const { data: inserted, error } = await supabase.from("hs_certifications").insert({
                account_id: accountId,
                cert_type: data.name,
                holder_name: data.holder || null,
                cert_number: data.cert_number || null,
                issuer: data.cert_type || null,
                issue_date: data.issue_date || null,
                expiry_date: data.expiry_date || null,
              }).select("*").single();
              if (error) { showAlertMsg("error", `Could not add certification: ${error.message}`); return; }
              setCerts((prev) => [mapCert(inserted), ...prev]);
              setShowCertForm(false);
              await logAction(supabase, { accountId, userId, userName, userRole, action: "created", entityType: "certification", entityId: inserted.id, entityName: data.name });
              showAlertMsg("success", "Certification added.");
            }}
            onClose={() => setShowCertForm(false)}
          />
        )}
        {coshhDetail && <CoshhDetailModal substance={coshhDetail} onClose={() => setCoshhDetail(null)} />}
      </div>
    </>
  );
}

// ── COSHH DETAIL MODAL ──────────────────────────────────────────
function CoshhDetailModal({ substance, onClose }) {
  const fmtD = (d) => (d ? new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—");
  const rows = [
    ["Supplier", substance.supplier],
    ["Hazard type", (substance.hazard_type || []).join(", ")],
    ["PPE required", (substance.ppe_required || []).join(", ")],
    ["Storage", substance.storage],
    ["Disposal", substance.disposal],
    ["Emergency procedure", substance.emergency_proc],
    ["SDS review date", fmtD(substance.review_date)],
  ].filter(([, v]) => v != null && v !== "");
  return (
    <div className="hs-modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="hs-modal" style={{ maxWidth: 520 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 17, color: "var(--steel)" }}>{substance.substance_name}</div>
            <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
              {(substance.hazard_type || []).map((h) => (
                <span key={h} className="hs-pill" style={{ background: "#FEF9C3", color: "#854D0E" }}>{h}</span>
              ))}
            </div>
          </div>
          <button className="hs-btn hs-btn-ghost hs-btn-sm" onClick={onClose}>Close</button>
        </div>
        <div>
          {rows.map(([label, value]) => (
            <div key={label} style={{ padding: "9px 0", borderBottom: "1px solid var(--rule, #F3F4F6)" }}>
              <div style={{ fontSize: 11, color: "var(--mist)", textTransform: "uppercase", letterSpacing: 0.3 }}>{label}</div>
              <div style={{ fontSize: 14, color: "var(--steel)", marginTop: 2 }}>{value}</div>
            </div>
          ))}
          {substance.sds_url && (
            <a href={substance.sds_url} target="_blank" rel="noreferrer" className="hs-btn hs-btn-secondary hs-btn-sm" style={{ marginTop: 14, display: "inline-block" }}>
              View safety data sheet
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

// ── RA BUILDER MODAL (with AI walkthrough) ──────────────────────
function RABuilderModal({ supabase, onSubmit, onClose, userName }) {
  const [step, setStep] = useState("template");
  const [selectedTemplate, setSelectedTemplate] = useState(null);
  const [form, setForm] = useState({
    title: "", activity: "", location: "",
    hazards: [], control_measures: [],
    risk_level: "medium", residual_risk: "low",
    assessor_name: userName, review_date: "",
  });
  const [aiMessages, setAiMessages] = useState([]);
  const [aiInput, setAiInput] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [hazardInput, setHazardInput] = useState("");
  const [controlInput, setControlInput] = useState("");

  const selectTemplate = (tpl) => {
    setSelectedTemplate(tpl);
    setForm((f) => ({ ...f, title: tpl.title, hazards: tpl.hazards, activity: tpl.title }));
  };

  const startAIWalkthrough = async () => {
    setStep("ai");
    setAiLoading(true);
    try {
      const { data } = await supabase.functions.invoke("ai-proxy", {
        body: {
          model: "claude-haiku-4-5",
          max_tokens: 400,
          system: `You are helping a small trades business owner complete a risk assessment for "${form.title}".
Ask one question at a time to gather the information needed. Be conversational and plain English — like a knowledgeable colleague helping them through the process.
Start by asking where this activity takes place. Then ask about who is exposed to the hazards. Then ask what control measures they currently have in place.
Keep responses short — 2-3 sentences maximum. No bullet points, no corporate language.`,
          messages: [{ role: "user", content: "Start the risk assessment walkthrough" }],
        },
      });
      setAiMessages([{ role: "assistant", content: data?.content?.[0]?.text || "Let's work through this together. First — where does this activity typically take place?" }]);
    } catch {
      setAiMessages([{ role: "assistant", content: "Let's work through this risk assessment. Where does this activity typically take place?" }]);
    } finally {
      setAiLoading(false);
    }
  };

  const sendAIMessage = async () => {
    if (!aiInput.trim()) return;
    const newMessages = [...aiMessages, { role: "user", content: aiInput }];
    setAiMessages(newMessages);
    setAiInput("");
    setAiLoading(true);
    try {
      const { data } = await supabase.functions.invoke("ai-proxy", {
        body: {
          model: "claude-haiku-4-5",
          max_tokens: 400,
          system: `You are helping complete a risk assessment for "${form.title}". Continue the conversational walkthrough. Keep responses short and practical. After 4-5 exchanges, summarise the completed assessment and suggest they proceed to finalise it.`,
          messages: newMessages.map((m) => ({ role: m.role, content: m.content })),
        },
      });
      setAiMessages((prev) => [...prev, { role: "assistant", content: data?.content?.[0]?.text || "Thanks for that. Let's continue building the assessment." }]);
    } catch {
      setAiMessages((prev) => [...prev, { role: "assistant", content: "Got it. Let's keep going with the assessment." }]);
    } finally {
      setAiLoading(false);
    }
  };

  return (
    <div className="hs-modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="hs-modal">
        <div className="hs-modal-header">
          <span className="hs-modal-title">New Risk Assessment</span>
          <button className="hs-btn hs-btn-ghost hs-btn-sm" onClick={onClose}>Close</button>
        </div>

        {step === "template" && (
          <div>
            <p style={{ fontSize: 13, color: "var(--mist)", marginBottom: 16 }}>
              Start from a template or build from scratch. Templates include common hazards pre-filled.
            </p>
            <div className="hs-template-grid">
              {RISK_TEMPLATES.map((tpl) => (
                <button key={tpl.id} className={`hs-template-btn ${selectedTemplate?.id === tpl.id ? "selected" : ""}`} onClick={() => selectTemplate(tpl)}>
                  {tpl.title}
                </button>
              ))}
              <button className={`hs-template-btn ${selectedTemplate === "blank" ? "selected" : ""}`} onClick={() => { setSelectedTemplate("blank"); setForm((f) => ({ ...f, title: "", hazards: [] })); }}>
                Blank — start from scratch
              </button>
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <button className="hs-btn hs-btn-primary" disabled={!selectedTemplate} onClick={() => setStep("build")}>
                Continue →
              </button>
              {selectedTemplate && selectedTemplate !== "blank" && (
                <button className="hs-btn hs-btn-secondary" onClick={startAIWalkthrough}>
                  AI Walkthrough
                </button>
              )}
            </div>
          </div>
        )}

        {step === "ai" && (
          <div>
            <div className="hs-ai-chat">
              {aiMessages.map((msg, i) => (
                <div key={i} className={`hs-ai-message hs-ai-from-${msg.role === "assistant" ? "ai" : "user"}`}>
                  {msg.content}
                </div>
              ))}
              {aiLoading && (
                <div className="hs-ai-message hs-ai-from-ai" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span className="hs-spinner" />
                  <span>Thinking...</span>
                </div>
              )}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <input className="hs-input" style={{ flex: 1 }} placeholder="Your answer..." value={aiInput} onChange={(e) => setAiInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && sendAIMessage()} />
              <button className="hs-btn hs-btn-primary" disabled={!aiInput.trim() || aiLoading} onClick={sendAIMessage}>Send</button>
            </div>
            <button className="hs-btn hs-btn-ghost" style={{ marginTop: 12 }} onClick={() => setStep("build")}>
              Skip AI — build manually →
            </button>
          </div>
        )}

        {step === "build" && (
          <div>
            <div className="hs-input-group">
              <label className="hs-input-label">Assessment title *</label>
              <input className="hs-input" value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} />
            </div>
            <div className="hs-input-group">
              <label className="hs-input-label">Activity description</label>
              <textarea className="hs-input hs-textarea" value={form.activity} onChange={(e) => setForm((f) => ({ ...f, activity: e.target.value }))} />
            </div>
            <div className="hs-form-grid">
              <div className="hs-input-group">
                <label className="hs-input-label">Risk level</label>
                <select className="hs-input" value={form.risk_level} onChange={(e) => setForm((f) => ({ ...f, risk_level: e.target.value }))}>
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="very_high">Very High</option>
                </select>
              </div>
              <div className="hs-input-group">
                <label className="hs-input-label">Review date</label>
                <input type="date" className="hs-input" value={form.review_date} onChange={(e) => setForm((f) => ({ ...f, review_date: e.target.value }))} />
              </div>
            </div>

            {/* Hazards */}
            <div className="hs-input-group">
              <label className="hs-input-label">Hazards</label>
              {form.hazards.map((h, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                  <span style={{ flex: 1, fontSize: 13, color: "var(--mid)", padding: "6px 10px", background: "var(--chalk)", borderRadius: 4 }}>{h}</span>
                  <button className="hs-btn hs-btn-ghost hs-btn-sm" onClick={() => setForm((f) => ({ ...f, hazards: f.hazards.filter((_, j) => j !== i) }))}>×</button>
                </div>
              ))}
              <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                <input className="hs-input" style={{ flex: 1 }} placeholder="Add hazard..." value={hazardInput} onChange={(e) => setHazardInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && hazardInput.trim()) { setForm((f) => ({ ...f, hazards: [...f.hazards, hazardInput.trim()] })); setHazardInput(""); }}} />
                <button className="hs-btn hs-btn-secondary hs-btn-sm" onClick={() => { if (hazardInput.trim()) { setForm((f) => ({ ...f, hazards: [...f.hazards, hazardInput.trim()] })); setHazardInput(""); }}}>Add</button>
              </div>
            </div>

            {/* Controls */}
            <div className="hs-input-group">
              <label className="hs-input-label">Control measures</label>
              {form.control_measures.map((m, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                  <span style={{ flex: 1, fontSize: 13, color: "var(--mid)", padding: "6px 10px", background: "#F0FDF4", borderRadius: 4, borderLeft: "2px solid #22C55E" }}>{m}</span>
                  <button className="hs-btn hs-btn-ghost hs-btn-sm" onClick={() => setForm((f) => ({ ...f, control_measures: f.control_measures.filter((_, j) => j !== i) }))}>×</button>
                </div>
              ))}
              <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                <input className="hs-input" style={{ flex: 1 }} placeholder="Add control measure..." value={controlInput} onChange={(e) => setControlInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && controlInput.trim()) { setForm((f) => ({ ...f, control_measures: [...f.control_measures, controlInput.trim()] })); setControlInput(""); }}} />
                <button className="hs-btn hs-btn-secondary hs-btn-sm" onClick={() => { if (controlInput.trim()) { setForm((f) => ({ ...f, control_measures: [...f.control_measures, controlInput.trim()] })); setControlInput(""); }}}>Add</button>
              </div>
            </div>

            <div className="hs-alert hs-alert-info">
              This document is prepared with AI assistance. For high-risk activities, have assessments reviewed by a qualified Health & Safety professional. This is not legal advice.
            </div>
            <button className="hs-btn hs-btn-primary" style={{ width: "100%" }} disabled={!form.title} onClick={() => onSubmit(form)}>
              Save Risk Assessment
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── ACCIDENT FORM MODAL ─────────────────────────────────────────
function AccidentFormModal({ onSubmit, onClose }) {
  const [form, setForm] = useState({
    incident_date: new Date().toISOString().split("T")[0],
    incident_time: "",
    location: "",
    person_name: "",
    person_type: "employee",
    description: "",
    injury_type: "",
    first_aid_given: false,
    hospital_attendance: false,
    days_lost: 0,
    riddor_reportable: false,
    riddor_type: "",
    witnesses: "",
    action_taken: "",
  });
  const f = (key) => (e) => setForm((p) => ({ ...p, [key]: e.target.value }));
  const cb = (key) => (e) => setForm((p) => ({ ...p, [key]: e.target.checked }));

  // Auto-suggest RIDDOR based on inputs
  const likelyRIDDOR = form.hospital_attendance || parseInt(form.days_lost) > 7;

  return (
    <div className="hs-modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="hs-modal">
        <div className="hs-modal-header">
          <span className="hs-modal-title">Log Accident / Incident</span>
          <button className="hs-btn hs-btn-ghost hs-btn-sm" onClick={onClose}>Close</button>
        </div>
        <div className="hs-form-grid">
          <div className="hs-input-group">
            <label className="hs-input-label">Date *</label>
            <input type="date" className="hs-input" value={form.incident_date} onChange={f("incident_date")} />
          </div>
          <div className="hs-input-group">
            <label className="hs-input-label">Time</label>
            <input type="time" className="hs-input" value={form.incident_time} onChange={f("incident_time")} />
          </div>
          <div className="hs-input-group" style={{ gridColumn: "1 / -1" }}>
            <label className="hs-input-label">Location *</label>
            <input className="hs-input" placeholder="Where did this happen?" value={form.location} onChange={f("location")} />
          </div>
          <div className="hs-input-group">
            <label className="hs-input-label">Person injured *</label>
            <input className="hs-input" placeholder="Full name" value={form.person_name} onChange={f("person_name")} />
          </div>
          <div className="hs-input-group">
            <label className="hs-input-label">Person type</label>
            <select className="hs-input" value={form.person_type} onChange={f("person_type")}>
              <option value="employee">Employee</option>
              <option value="subcontractor">Subcontractor</option>
              <option value="member_of_public">Member of public</option>
              <option value="visitor">Visitor</option>
            </select>
          </div>
        </div>
        <div className="hs-input-group">
          <label className="hs-input-label">What happened? *</label>
          <textarea className="hs-input hs-textarea" placeholder="Describe the incident in detail" value={form.description} onChange={f("description")} />
        </div>
        <div className="hs-form-grid">
          <div className="hs-input-group">
            <label className="hs-input-label">Injury type</label>
            <input className="hs-input" placeholder="e.g. Sprained ankle" value={form.injury_type} onChange={f("injury_type")} />
          </div>
          <div className="hs-input-group">
            <label className="hs-input-label">Days lost</label>
            <input type="number" className="hs-input" min="0" value={form.days_lost} onChange={f("days_lost")} />
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--steel)", cursor: "pointer" }}>
            <input type="checkbox" checked={form.first_aid_given} onChange={cb("first_aid_given")} />
            First aid given
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--steel)", cursor: "pointer" }}>
            <input type="checkbox" checked={form.hospital_attendance} onChange={cb("hospital_attendance")} />
            Hospital attendance required
          </label>
        </div>

        {likelyRIDDOR && (
          <div className="hs-alert hs-alert-danger">
            This incident may be RIDDOR reportable (hospital attendance or over 7 days lost). Tick the box below if applicable.
          </div>
        )}

        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--steel)", cursor: "pointer", marginBottom: 16 }}>
          <input type="checkbox" checked={form.riddor_reportable} onChange={cb("riddor_reportable")} />
          <strong>RIDDOR reportable</strong>
        </label>

        {form.riddor_reportable && (
          <div className="hs-input-group">
            <label className="hs-input-label">RIDDOR category</label>
            <select className="hs-input" value={form.riddor_type} onChange={f("riddor_type")}>
              <option value="">Select category</option>
              {RIDDOR_TYPES.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
        )}

        <button className="hs-btn hs-btn-primary" style={{ width: "100%" }} disabled={!form.person_name || !form.description || !form.location} onClick={() => onSubmit(form)}>
          Log Accident
        </button>
      </div>
    </div>
  );
}

// ── TOOLBOX TALK FORM ───────────────────────────────────────────
function ToolboxFormModal({ onSubmit, onClose, deliveredBy }) {
  const [form, setForm] = useState({
    topic: "", delivered_by: deliveredBy, delivered_date: new Date().toISOString().split("T")[0],
    location: "Workshop", notes: "", sign_offs: [],
  });
  const [attendeeInput, setAttendeeInput] = useState("");

  const TOOLBOX_TOPICS = [
    "Working at Height — Ladder Safety", "Manual Handling Best Practice", "Electrical Safety",
    "Working in Confined Spaces", "COSHH and Chemical Safety", "Fire Safety", "First Aid Awareness",
    "PPE — Correct Use", "Near Miss Reporting", "Lone Working Safety",
  ];

  return (
    <div className="hs-modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="hs-modal">
        <div className="hs-modal-header">
          <span className="hs-modal-title">Record Toolbox Talk</span>
          <button className="hs-btn hs-btn-ghost hs-btn-sm" onClick={onClose}>Close</button>
        </div>
        <div className="hs-input-group">
          <label className="hs-input-label">Topic *</label>
          <input className="hs-input" placeholder="Or select below" value={form.topic} onChange={(e) => setForm((f) => ({ ...f, topic: e.target.value }))} list="toolbox-topics" />
          <datalist id="toolbox-topics">
            {TOOLBOX_TOPICS.map((t) => <option key={t} value={t} />)}
          </datalist>
        </div>
        <div className="hs-form-grid">
          <div className="hs-input-group">
            <label className="hs-input-label">Delivered by</label>
            <input className="hs-input" value={form.delivered_by} onChange={(e) => setForm((f) => ({ ...f, delivered_by: e.target.value }))} />
          </div>
          <div className="hs-input-group">
            <label className="hs-input-label">Date</label>
            <input type="date" className="hs-input" value={form.delivered_date} onChange={(e) => setForm((f) => ({ ...f, delivered_date: e.target.value }))} />
          </div>
        </div>
        <div className="hs-input-group">
          <label className="hs-input-label">Add attendees (who needs to sign off)</label>
          <div style={{ display: "flex", gap: 6 }}>
            <input className="hs-input" placeholder="Employee name" value={attendeeInput} onChange={(e) => setAttendeeInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && attendeeInput.trim()) { setForm((f) => ({ ...f, sign_offs: [...f.sign_offs, { name: attendeeInput.trim(), signed: false, date: null }] })); setAttendeeInput(""); }}} />
            <button className="hs-btn hs-btn-secondary hs-btn-sm" onClick={() => { if (attendeeInput.trim()) { setForm((f) => ({ ...f, sign_offs: [...f.sign_offs, { name: attendeeInput.trim(), signed: false, date: null }] })); setAttendeeInput(""); }}}>Add</button>
          </div>
          {form.sign_offs.map((s, i) => (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "6px 10px", background: "var(--chalk)", borderRadius: 4, marginTop: 4, fontSize: 13 }}>
              <span>{s.name}</span>
              <button style={{ background: "none", border: "none", color: "var(--mist)", cursor: "pointer" }} onClick={() => setForm((f) => ({ ...f, sign_offs: f.sign_offs.filter((_, j) => j !== i) }))}>×</button>
            </div>
          ))}
        </div>
        <button className="hs-btn hs-btn-primary" style={{ width: "100%" }} disabled={!form.topic} onClick={() => onSubmit(form)}>
          Save Toolbox Talk
        </button>
      </div>
    </div>
  );
}

// ── CERT FORM MODAL ─────────────────────────────────────────────
function CertFormModal({ onSubmit, onClose }) {
  const [form, setForm] = useState({ name: "", cert_type: "", holder: "", cert_number: "", expiry_date: "", issue_date: "" });
  return (
    <div className="hs-modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="hs-modal">
        <div className="hs-modal-header">
          <span className="hs-modal-title">Add Certification</span>
          <button className="hs-btn hs-btn-ghost hs-btn-sm" onClick={onClose}>Close</button>
        </div>
        <div className="hs-form-grid">
          <div className="hs-input-group" style={{ gridColumn: "1 / -1" }}>
            <label className="hs-input-label">Certification name *</label>
            <input className="hs-input" placeholder="e.g. Gas Safe Registration" value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} />
          </div>
          <div className="hs-input-group">
            <label className="hs-input-label">Type</label>
            <select className="hs-input" value={form.cert_type} onChange={(e) => setForm((p) => ({ ...p, cert_type: e.target.value }))}>
              <option value="">Select type</option>
              <option value="Insurance">Insurance</option>
              <option value="Accreditation">Accreditation</option>
              <option value="Training">Training / Qualification</option>
              <option value="Licence">Licence</option>
              <option value="Other">Other</option>
            </select>
          </div>
          <div className="hs-input-group">
            <label className="hs-input-label">Held by</label>
            <input className="hs-input" placeholder="Person or company name" value={form.holder} onChange={(e) => setForm((p) => ({ ...p, holder: e.target.value }))} />
          </div>
          <div className="hs-input-group">
            <label className="hs-input-label">Certificate number</label>
            <input className="hs-input" value={form.cert_number} onChange={(e) => setForm((p) => ({ ...p, cert_number: e.target.value }))} />
          </div>
          <div className="hs-input-group">
            <label className="hs-input-label">Expiry date *</label>
            <input type="date" className="hs-input" value={form.expiry_date} onChange={(e) => setForm((p) => ({ ...p, expiry_date: e.target.value }))} />
          </div>
        </div>
        <button className="hs-btn hs-btn-primary" style={{ width: "100%" }} disabled={!form.name || !form.expiry_date} onClick={() => onSubmit(form)}>
          Add Certification
        </button>
      </div>
    </div>
  );
}
