/**
 * JobCosting.jsx
 * Your Company AI — Job Costing & Profitability Module
 *
 * DEPENDENCIES (injected via props from core platform):
 *   supabase        — Supabase client instance
 *   accountId       — Current account UUID
 *   userId          — Current platform_user UUID
 *   userName        — Current user display name
 *   userRole        — 'owner' | 'manager' | 'staff'
 *
 * DATABASE TABLES USED:
 *   job_costs           — Materials, labour and subcontractor costs per job
 *   job_cost_settings   — Overhead config and target margin per account
 *   supplier_prices     — Supplier price list per account
 *   contacts            — Customer names (read only)
 *   invoices            — Invoice amounts for quoted values (read only)
 *   audit_log           — Audit trail
 *
 * EXTERNAL:
 *   Anthropic API — claude-haiku-4-5 for AI insights
 *
 * SCHEMA — add these tables to supabase_schema.sql:
 *
 * CREATE TABLE public.job_cost_settings (
 *   id                    uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
 *   account_id            uuid REFERENCES public.accounts(id) ON DELETE CASCADE UNIQUE,
 *   target_margin_pct     numeric(5,2) DEFAULT 30.0,
 *   overhead_monthly      numeric(10,2) DEFAULT 0,
 *   overhead_hours_monthly int DEFAULT 160,
 *   overhead_rate_per_hour numeric(8,2) GENERATED ALWAYS AS
 *     (CASE WHEN overhead_hours_monthly > 0 THEN overhead_monthly / overhead_hours_monthly ELSE 0 END) STORED,
 *   labour_rate_default   numeric(8,2) DEFAULT 35.0,
 *   created_at            timestamptz DEFAULT now(),
 *   updated_at            timestamptz DEFAULT now()
 * );
 *
 * CREATE TABLE public.jobs (
 *   id                uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
 *   account_id        uuid REFERENCES public.accounts(id) ON DELETE CASCADE,
 *   contact_id        uuid REFERENCES public.contacts(id),
 *   customer_name     text NOT NULL,
 *   description       text NOT NULL,
 *   job_type          text,
 *   quoted_amount     numeric(10,2) DEFAULT 0,
 *   status            text DEFAULT 'in_progress' CHECK (status IN ('quoted','in_progress','complete','invoiced','paid')),
 *   start_date        date,
 *   end_date          date,
 *   notes             text,
 *   created_at        timestamptz DEFAULT now(),
 *   updated_at        timestamptz DEFAULT now()
 * );
 *
 * CREATE TABLE public.job_costs (
 *   id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
 *   account_id      uuid REFERENCES public.accounts(id) ON DELETE CASCADE,
 *   job_id          uuid REFERENCES public.jobs(id) ON DELETE CASCADE,
 *   cost_type       text CHECK (cost_type IN ('material','labour','subcontractor','other')),
 *   description     text NOT NULL,
 *   quantity        numeric(10,3) DEFAULT 1,
 *   unit_cost       numeric(10,2) NOT NULL,
 *   total_cost      numeric(10,2) GENERATED ALWAYS AS (quantity * unit_cost) STORED,
 *   supplier        text,
 *   receipt_url     text,
 *   logged_by       text,
 *   created_at      timestamptz DEFAULT now()
 * );
 *
 * CREATE TABLE public.supplier_prices (
 *   id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
 *   account_id      uuid REFERENCES public.accounts(id) ON DELETE CASCADE,
 *   supplier_name   text NOT NULL,
 *   item_name       text NOT NULL,
 *   unit            text DEFAULT 'each',
 *   price           numeric(10,2) NOT NULL,
 *   last_updated    date DEFAULT CURRENT_DATE,
 *   created_at      timestamptz DEFAULT now()
 * );
 *
 * Enable RLS on all tables with standard account_id policies.
 */

import { useState, useMemo, useCallback, useEffect } from "react";

// ── CONSTANTS ───────────────────────────────────────────────────
const TABS = [
  { id: "dashboard",  label: "Dashboard" },
  { id: "jobs",       label: "All Jobs" },
  { id: "suppliers",  label: "Price List" },
  { id: "settings",   label: "Settings" },
];

const COST_TYPES = ["material", "labour", "subcontractor", "other"];
const COST_COLORS = {
  material: "#3B82F6",
  labour: "#8B5CF6",
  subcontractor: "#EC4899",
  other: "#9CA3AF",
};

// ── STYLES ──────────────────────────────────────────────────────
const css = `
  @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=DM+Sans:wght@300;400;500&display=swap');

  .jc-wrap * { box-sizing: border-box; margin: 0; padding: 0; }
  .jc-wrap {
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

  .jc-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 24px; }
  .jc-header h1 { font-family: 'Plus Jakarta Sans', sans-serif; font-weight: 800; font-size: 22px; color: var(--steel); }
  .jc-header p  { font-size: 13px; color: var(--mist); margin-top: 2px; }

  .jc-tabs { display: flex; gap: 4px; background: var(--white); border: 1px solid var(--rule); border-radius: var(--radius); padding: 4px; margin-bottom: 24px; overflow-x: auto; }
  .jc-tab  { flex: 1; min-width: fit-content; padding: 8px 14px; border: none; background: none; border-radius: 6px; font-family: 'DM Sans', sans-serif; font-size: 13px; font-weight: 500; color: var(--light); cursor: pointer; white-space: nowrap; transition: all 0.15s; }
  .jc-tab.active { background: var(--steel); color: var(--white); }

  .jc-card { background: var(--white); border: 1px solid var(--rule); border-radius: var(--radius); padding: 20px; margin-bottom: 16px; }
  .jc-card-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 16px; margin-bottom: 24px; }
  .jc-stat-card { background: var(--white); border: 1px solid var(--rule); border-radius: var(--radius); padding: 18px 20px; }
  .jc-stat-label { font-size: 11px; font-weight: 600; color: var(--mist); text-transform: uppercase; letter-spacing: 1px; margin-bottom: 8px; }
  .jc-stat-value { font-family: 'Plus Jakarta Sans', sans-serif; font-weight: 800; font-size: 28px; color: var(--steel); line-height: 1; }
  .jc-stat-sub   { font-size: 12px; color: var(--mist); margin-top: 4px; }

  .jc-section-heading { font-family: 'Plus Jakarta Sans', sans-serif; font-weight: 700; font-size: 14px; color: var(--steel); margin-bottom: 12px; padding-bottom: 8px; border-bottom: 1px solid var(--rule); }

  /* Margin indicator */
  .jc-margin-bar { height: 6px; border-radius: 3px; background: var(--rule); overflow: hidden; margin-top: 4px; }
  .jc-margin-fill { height: 100%; border-radius: 3px; transition: width 0.4s; }

  /* Job card */
  .jc-job-card { background: var(--white); border: 1px solid var(--rule); border-radius: var(--radius); padding: 18px 20px; margin-bottom: 12px; transition: border-color 0.15s; }
  .jc-job-card:hover { border-color: var(--mist); }
  .jc-job-card.expanded { border-color: var(--ember); }
  .jc-job-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; cursor: pointer; }
  .jc-job-name   { font-size: 15px; font-weight: 700; color: var(--steel); }
  .jc-job-meta   { font-size: 12px; color: var(--mist); margin-top: 2px; }

  /* Margin badge */
  .jc-margin-badge { display: inline-flex; align-items: center; padding: 4px 12px; border-radius: 20px; font-size: 13px; font-weight: 700; }
  .jc-margin-green  { background: #DCFCE7; color: #166534; }
  .jc-margin-amber  { background: #FFFBEB; color: #92400E; }
  .jc-margin-red    { background: #FEF2F2; color: #991B1B; }
  .jc-margin-grey   { background: #F3F4F6; color: #6B7280; }

  /* Cost breakdown */
  .jc-cost-row { display: flex; align-items: center; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid var(--rule); font-size: 13px; }
  .jc-cost-row:last-child { border-bottom: none; }
  .jc-cost-type-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; margin-right: 8px; }

  /* Add cost form */
  .jc-add-cost-row { display: grid; grid-template-columns: 1fr 2fr 80px 80px auto; gap: 8px; align-items: end; padding: 12px 0; border-top: 1px solid var(--rule); margin-top: 8px; }

  /* Leaderboard */
  .jc-leaderboard-row { display: flex; align-items: center; gap: 12px; padding: 10px 0; border-bottom: 1px solid var(--rule); }
  .jc-leaderboard-row:last-child { border-bottom: none; }
  .jc-lb-rank { width: 24px; text-align: center; font-family: 'Plus Jakarta Sans', sans-serif; font-weight: 800; font-size: 14px; color: var(--mist); }
  .jc-lb-rank.top { color: var(--ember); }

  /* Supplier row */
  .jc-supplier-row { display: flex; align-items: center; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid var(--rule); font-size: 13px; }
  .jc-supplier-row:last-child { border-bottom: none; }

  /* AI insight */
  .jc-insight { background: var(--steel); border-radius: var(--radius); padding: 16px 20px; margin-bottom: 16px; }
  .jc-insight-label { font-size: 11px; font-weight: 600; color: var(--ember); text-transform: uppercase; letter-spacing: 1px; margin-bottom: 8px; }
  .jc-insight-text  { font-size: 14px; color: rgba(255,255,255,0.85); line-height: 1.6; }

  /* Buttons */
  .jc-btn { display: inline-flex; align-items: center; gap: 6px; padding: 8px 14px; border-radius: 6px; font-family: 'DM Sans', sans-serif; font-size: 13px; font-weight: 500; cursor: pointer; border: none; transition: all 0.15s; white-space: nowrap; }
  .jc-btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .jc-btn-primary   { background: var(--ember); color: white; }
  .jc-btn-primary:hover:not(:disabled) { background: var(--ember-lt); }
  .jc-btn-secondary { background: var(--chalk); color: var(--steel); border: 1px solid var(--rule); }
  .jc-btn-secondary:hover:not(:disabled) { border-color: var(--mist); }
  .jc-btn-ghost     { background: none; color: var(--mist); border: 1px solid var(--rule); }
  .jc-btn-ghost:hover:not(:disabled) { color: var(--steel); border-color: var(--steel); }
  .jc-btn-sm        { padding: 5px 10px; font-size: 12px; }

  /* Pill */
  .jc-pill { display: inline-flex; align-items: center; padding: 3px 10px; border-radius: 20px; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; }
  .jc-pill-inprogress { background: #EFF6FF; color: #1E40AF; }
  .jc-pill-complete   { background: #DCFCE7; color: #166534; }
  .jc-pill-invoiced   { background: #F3E8FF; color: #6B21A8; }
  .jc-pill-paid       { background: #DCFCE7; color: #166534; }
  .jc-pill-quoted     { background: #FEF9C3; color: #854D0E; }

  /* Form */
  .jc-input { width: 100%; padding: 9px 12px; border: 1px solid var(--rule); border-radius: 6px; font-family: 'DM Sans', sans-serif; font-size: 14px; color: var(--steel); outline: none; transition: border-color 0.15s; background: white; }
  .jc-input:focus { border-color: var(--ember); }
  .jc-input-label { font-size: 13px; font-weight: 500; color: var(--steel); margin-bottom: 6px; display: block; }
  .jc-input-group { margin-bottom: 16px; }
  .jc-form-grid   { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  .jc-profit-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 16px; }
  @media (max-width: 640px) {
    .jc-profit-grid { grid-template-columns: 1fr; }
    .jc-form-grid   { grid-template-columns: 1fr; }
  }

  /* Modal */
  .jc-modal-overlay { position: fixed; inset: 0; background: rgba(28,28,46,0.5); display: flex; align-items: center; justify-content: center; z-index: 100; padding: 20px; }
  .jc-modal { background: var(--white); border-radius: var(--radius); padding: 24px; width: 100%; max-width: 560px; max-height: 90vh; overflow-y: auto; }
  .jc-modal-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px; }
  .jc-modal-title  { font-family: 'Plus Jakarta Sans', sans-serif; font-weight: 700; font-size: 16px; color: var(--steel); }

  /* Alert */
  .jc-alert { padding: 12px 16px; border-radius: var(--radius); font-size: 13px; margin-bottom: 16px; }
  .jc-alert-success { background: #DCFCE7; border: 1px solid #BBF7D0; color: #166534; }
  .jc-alert-warning { background: #FFFBEB; border: 1px solid #FDE68A; color: #92400E; }
  .jc-alert-info    { background: #EFF6FF; border: 1px solid #BFDBFE; color: #1E40AF; }

  /* Empty */
  .jc-empty { text-align: center; padding: 48px 24px; color: var(--mist); }
  .jc-empty h3 { font-size: 16px; color: var(--steel); margin-bottom: 6px; }

  /* Spinner */
  .jc-spinner { width: 18px; height: 18px; border: 2px solid var(--rule); border-top-color: var(--ember); border-radius: 50%; animation: jc-spin 0.6s linear infinite; display: inline-block; }
  @keyframes jc-spin { to { transform: rotate(360deg); } }

  /* Toggle */
  .jc-toggle-row { display: flex; align-items: center; justify-content: space-between; padding: 12px 0; border-bottom: 1px solid var(--rule); }
  .jc-toggle-row:last-child { border-bottom: none; }
`;

// ── HELPERS ─────────────────────────────────────────────────────
const formatCurrency = (n) => `£${(n || 0).toFixed(2)}`;
const formatPct = (n) => `${(n || 0).toFixed(1)}%`;
const formatDate = (d) => d ? new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—";

const calcMargin = (quoted, cost) => {
  if (!quoted || quoted === 0) return null;
  return ((quoted - cost) / quoted) * 100;
};

const marginColor = (pct, target) => {
  if (pct === null) return "grey";
  if (pct >= target) return "green";
  if (pct >= target * 0.8) return "amber";
  return "red";
};

const marginBarColor = { green: "#22C55E", amber: "#EAB308", red: "#EF4444", grey: "#9CA3AF" };

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
const MOCK_SETTINGS = {
  target_margin_pct: 30,
  overhead_monthly: 2400,
  overhead_hours_monthly: 160,
  labour_rate_default: 38,
};

const MOCK_JOBS = [
  {
    id: "j1", customer_name: "Smith Residence", description: "Full bathroom refit — tiles, fixtures, plumbing",
    job_type: "Bathroom", quoted_amount: 3800, status: "complete",
    start_date: "2026-05-20", end_date: "2026-05-28",
    costs: [
      { id: "c1", cost_type: "material", description: "Bathroom suite + taps", quantity: 1, unit_cost: 680, total_cost: 680, supplier: "Screwfix" },
      { id: "c2", cost_type: "material", description: "Wall tiles 20m²", quantity: 20, unit_cost: 18, total_cost: 360, supplier: "Topps Tiles" },
      { id: "c3", cost_type: "material", description: "Pipework and fittings", quantity: 1, unit_cost: 145, total_cost: 145, supplier: "Plumbcenter" },
      { id: "c4", cost_type: "labour", description: "Dave Thompson — 24 hours", quantity: 24, unit_cost: 38, total_cost: 912, supplier: null },
      { id: "c5", cost_type: "labour", description: "Steve Harris — 8 hours", quantity: 8, unit_cost: 38, total_cost: 304, supplier: null },
    ],
  },
  {
    id: "j2", customer_name: "Whitfield Commercial", description: "Office heating system installation",
    job_type: "Heating", quoted_amount: 6500, status: "invoiced",
    start_date: "2026-06-01", end_date: "2026-06-08",
    costs: [
      { id: "c6", cost_type: "material", description: "Radiators × 8", quantity: 8, unit_cost: 220, total_cost: 1760, supplier: "Plumbcenter" },
      { id: "c7", cost_type: "material", description: "Boiler unit", quantity: 1, unit_cost: 1100, total_cost: 1100, supplier: "Merchants Direct" },
      { id: "c8", cost_type: "material", description: "Pipework and fittings", quantity: 1, unit_cost: 380, total_cost: 380, supplier: "Plumbcenter" },
      { id: "c9", cost_type: "labour", description: "Dave Thompson — 40 hours", quantity: 40, unit_cost: 38, total_cost: 1520, supplier: null },
      { id: "c10", cost_type: "subcontractor", description: "Gas Safe engineer — certification", quantity: 1, unit_cost: 280, total_cost: 280, supplier: "J&B Gas Services" },
    ],
  },
  {
    id: "j3", customer_name: "Chen Property", description: "Emergency boiler repair + service",
    job_type: "Boiler", quoted_amount: 480, status: "paid",
    start_date: "2026-06-03", end_date: "2026-06-03",
    costs: [
      { id: "c11", cost_type: "material", description: "Pump and seals", quantity: 1, unit_cost: 85, total_cost: 85, supplier: "Screwfix" },
      { id: "c12", cost_type: "labour", description: "Dave Thompson — 3 hours", quantity: 3, unit_cost: 38, total_cost: 114, supplier: null },
    ],
  },
  {
    id: "j4", customer_name: "Burgess Residence", description: "Unvented cylinder replacement",
    job_type: "Hot Water", quoted_amount: 1800, status: "in_progress",
    start_date: "2026-06-05", end_date: null,
    costs: [
      { id: "c13", cost_type: "material", description: "Megaflo 250L cylinder", quantity: 1, unit_cost: 680, total_cost: 680, supplier: "Merchants Direct" },
      { id: "c14", cost_type: "labour", description: "Steve Harris — 6 hours", quantity: 6, unit_cost: 38, total_cost: 228, supplier: null },
    ],
  },
  {
    id: "j5", customer_name: "Johnson Flat", description: "Power flush + chemical treatment",
    job_type: "Heating", quoted_amount: 350, status: "complete",
    start_date: "2026-05-10", end_date: "2026-05-10",
    costs: [
      { id: "c15", cost_type: "material", description: "Inhibitor and chemicals", quantity: 1, unit_cost: 45, total_cost: 45, supplier: "Screwfix" },
      { id: "c16", cost_type: "labour", description: "Dave Thompson — 4 hours", quantity: 4, unit_cost: 38, total_cost: 152, supplier: null },
      { id: "c17", cost_type: "material", description: "Flushing equipment hire", quantity: 1, unit_cost: 85, total_cost: 85, supplier: "HSS Hire" },
    ],
  },
];

const MOCK_SUPPLIERS = [
  { id: "s1", supplier_name: "Screwfix", item_name: "Copper pipe 22mm (3m length)", unit: "length", price: 8.99 },
  { id: "s2", supplier_name: "Screwfix", item_name: "Compression fittings box 10", unit: "box", price: 12.49 },
  { id: "s3", supplier_name: "Plumbcenter", item_name: "Radiator 600×1000 single panel", unit: "each", price: 89.00 },
  { id: "s4", supplier_name: "Plumbcenter", item_name: "Speedfit 22mm push-fit elbow", unit: "each", price: 2.35 },
  { id: "s5", supplier_name: "Topps Tiles", item_name: "Porcelain wall tile 300×600", unit: "m²", price: 18.50 },
  { id: "s6", supplier_name: "Merchants Direct", item_name: "Worcester Bosch 25i combi", unit: "each", price: 785.00 },
];

// ── Live-schema <-> UI adapters ──────────────────────────────────
// Live schema stores money as pence, normalises customer onto contacts, and
// uses cost_type 'materials' (UI uses 'material'). Translate at the boundary.
const penceToPounds = (p) => (p ?? 0) / 100;
const poundsToPence = (v) => Math.round((parseFloat(v) || 0) * 100);
const contactName = (c) =>
  c ? ([c.first_name, c.last_name].filter(Boolean).join(" ") || c.business_name || "") : "";

function mapCost(c) {
  return {
    id: c.id,
    cost_type: c.cost_type === "materials" ? "material" : c.cost_type,
    description: c.description,
    quantity: Number(c.quantity),
    unit_cost: penceToPounds(c.unit_cost_pence),
    total_cost: penceToPounds(c.total_pence),
    supplier: c.supplier || null,
  };
}

function mapJob(row) {
  return {
    id: row.id,
    contact_id: row.contact_id,
    customer_name: contactName(row.contact) || row.title || "",
    description: row.description || "",
    job_type: row.job_type || "",
    quoted_amount: penceToPounds(row.quoted_amount_pence),
    status: row.status === "completed" ? "complete" : row.status,
    start_date: row.scheduled_date,
    end_date: row.completed_date,
    costs: (row.costs || []).map(mapCost),
  };
}

// ── MAIN COMPONENT ──────────────────────────────────────────────
export default function JobCosting({
  supabase,
  accountId,
  userId,
  userName,
  userRole,
}) {
  const [activeTab, setActiveTab] = useState("dashboard");
  const [jobs, setJobs] = useState([]);
  const [quotesByJob, setQuotesByJob] = useState({}); // job_id -> linked quote rows
  const [suppliers, setSuppliers] = useState([]);
  const [settings, setSettings] = useState(MOCK_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [expandedJob, setExpandedJob] = useState(null);
  const [showAddJob, setShowAddJob] = useState(false);
  const [showAddCost, setShowAddCost] = useState(null);
  const [showInsight, setShowInsight] = useState(null);
  const [insightLoading, setInsightLoading] = useState(false);
  const [insightText, setInsightText] = useState("");
  const [alert, setAlert] = useState(null);

  const showAlertMsg = (type, msg) => {
    setAlert({ type, message: msg });
    setTimeout(() => setAlert(null), 4000);
  };

  // ── Load real data (RLS scopes to this account) ──
  const loadData = useCallback(async () => {
    setLoading(true);
    const [jobRes, supRes, ohRes, quoteRes] = await Promise.all([
      supabase
        .from("jobs")
        .select("*, contact:contacts(*), costs:job_costs(*)")
        .order("created_at", { ascending: false }),
      supabase
        .from("supplier_price_lists")
        .select("supplier_name, items:supplier_price_items(*)")
        .eq("active", true),
      supabase.from("overhead_configs").select("*").eq("account_id", accountId).maybeSingle(),
      supabase.from("invoices").select("id, invoice_number, total_pence, status, quote_expiry_date, quote_accepted_at, converted_to_invoice_id, job_id").eq("document_type", "quote").not("job_id", "is", null),
    ]);
    if (jobRes.error) showAlertMsg("error", `Could not load jobs: ${jobRes.error.message}`);
    else setJobs((jobRes.data || []).map(mapJob));
    if (!quoteRes.error) {
      const byJob = {};
      (quoteRes.data || []).forEach((q) => { (byJob[q.job_id] ||= []).push(q); });
      setQuotesByJob(byJob);
    }
    if (!supRes.error) {
      const flat = [];
      for (const list of supRes.data || []) {
        for (const it of list.items || []) {
          flat.push({ id: it.id, supplier_name: list.supplier_name, item_name: it.description, unit: it.unit, price: penceToPounds(it.unit_cost_pence) });
        }
      }
      setSuppliers(flat);
    }
    if (!ohRes.error && ohRes.data) {
      setSettings((s) => ({
        ...s,
        overhead_monthly: penceToPounds(ohRes.data.monthly_overhead_pence),
        overhead_hours_monthly: ohRes.data.target_hours_per_month || s.overhead_hours_monthly,
      }));
    }
    setLoading(false);
  }, [supabase, accountId]);

  useEffect(() => { loadData(); }, [loadData]);

  // Compute job profitability
  const jobsWithMargin = useMemo(() => {
    const overheadRate = settings.overhead_hours_monthly > 0
      ? settings.overhead_monthly / settings.overhead_hours_monthly : 0;

    return jobs.map((job) => {
      const totalCost = job.costs.reduce((s, c) => s + c.total_cost, 0);
      const labourHours = job.costs
        .filter((c) => c.cost_type === "labour")
        .reduce((s, c) => s + c.quantity, 0);
      const overheadAlloc = labourHours * overheadRate;
      const totalCostWithOverhead = totalCost + overheadAlloc;
      const margin = calcMargin(job.quoted_amount, totalCostWithOverhead);
      const marginCat = marginColor(margin, settings.target_margin_pct);
      const costByType = COST_TYPES.reduce((acc, type) => {
        acc[type] = job.costs.filter((c) => c.cost_type === type).reduce((s, c) => s + c.total_cost, 0);
        return acc;
      }, {});
      return { ...job, totalCost, overheadAlloc, totalCostWithOverhead, margin, marginCat, costByType };
    });
  }, [jobs, settings]);

  // Dashboard stats
  const completedJobs = jobsWithMargin.filter((j) => ["complete", "invoiced", "paid"].includes(j.status));
  const avgMargin = completedJobs.length
    ? completedJobs.reduce((s, j) => s + (j.margin || 0), 0) / completedJobs.length : 0;
  const totalRevenue = completedJobs.reduce((s, j) => s + (j.quoted_amount || 0), 0);
  const totalProfit = completedJobs.reduce((s, j) => s + (j.quoted_amount - j.totalCostWithOverhead), 0);
  const bestJobs = [...completedJobs].sort((a, b) => (b.margin || 0) - (a.margin || 0)).slice(0, 3);
  const worstJobs = [...completedJobs].filter((j) => j.margin !== null).sort((a, b) => (a.margin || 0) - (b.margin || 0)).slice(0, 3);

  // Add cost to job
  const handleAddCost = async (jobId, costData) => {
    const qty = parseFloat(costData.quantity) || 0;
    const unit = parseFloat(costData.unit_cost) || 0;
    const row = {
      account_id: accountId,
      job_id: jobId,
      cost_type: costData.cost_type === "material" ? "materials" : costData.cost_type,
      description: costData.description,
      quantity: qty,
      unit_cost_pence: poundsToPence(unit),
      total_pence: Math.round(qty * unit * 100),
      supplier: costData.supplier || null,
      logged_by: userId,
    };
    const { data: inserted, error } = await supabase
      .from("job_costs").insert(row).select("*").single();
    if (error) { showAlertMsg("error", `Could not log cost: ${error.message}`); return; }
    const newCost = mapCost(inserted);
    setJobs((prev) => prev.map((j) =>
      j.id === jobId ? { ...j, costs: [...j.costs, newCost] } : j
    ));
    await logAction(supabase, {
      accountId, userId, userName, userRole,
      action: "created",
      entityType: "job_cost",
      entityId: jobId,
      entityName: `Cost: ${costData.description} — £${(qty * unit).toFixed(2)}`,
      newValue: newCost,
    });
    setShowAddCost(null);
    showAlertMsg("success", "Cost logged.");
  };

  // AI insight
  const handleInsight = async (job) => {
    setShowInsight(job.id);
    setInsightLoading(true);
    setInsightText("");
    try {
      const jobData = jobsWithMargin.find((j) => j.id === job.id);
      const prompt = `You are a business advisor helping a small trades business understand their job profitability.

Job: "${jobData.description}" for ${jobData.customer_name}
Job type: ${jobData.job_type}
Quoted: £${jobData.quoted_amount}
Total cost (excl. overhead): £${jobData.totalCost.toFixed(2)}
Overhead allocated: £${jobData.overheadAlloc.toFixed(2)}
Total cost with overhead: £${jobData.totalCostWithOverhead.toFixed(2)}
Margin: ${jobData.margin !== null ? jobData.margin.toFixed(1) + "%" : "No quote set"}
Target margin: ${settings.target_margin_pct}%
Cost breakdown: Materials £${jobData.costByType.material.toFixed(2)}, Labour £${jobData.costByType.labour.toFixed(2)}, Subcontractors £${jobData.costByType.subcontractor.toFixed(2)}

Write 2-3 sentences of plain English analysis. What happened with this job's profitability? What's the main driver? What would help next time? Be specific and practical. No bullet points. Sound like a knowledgeable colleague, not a consultant.`;

      const { data } = await supabase.functions.invoke("ai-proxy", {
        body: {
          model: "claude-haiku-4-5",
          max_tokens: 300,
          messages: [{ role: "user", content: prompt }],
        },
      });
      setInsightText(data?.content?.[0]?.text || "");
    } catch (e) {
      setInsightText("Couldn't generate insight right now. Try again in a moment.");
    } finally {
      setInsightLoading(false);
    }
  };

  // ── RENDER ───────────────────────────────────────────────────
  return (
    <>
      <style>{css}</style>
      <div className="jc-wrap">

        <div className="jc-header">
          <div>
            <h1>Job Costing & Profitability</h1>
            <p>Track costs · Monitor margins · Understand what's making money</p>
          </div>
          <button className="jc-btn jc-btn-primary" onClick={() => setShowAddJob(true)}>
            + Add Job
          </button>
        </div>

        {alert && <div className={`jc-alert jc-alert-${alert.type}`}>{alert.message}</div>}

        <div className="jc-tabs">
          {TABS.map((tab) => (
            <button key={tab.id} className={`jc-tab ${activeTab === tab.id ? "active" : ""}`} onClick={() => setActiveTab(tab.id)}>
              {tab.label}
            </button>
          ))}
        </div>

        {/* ── DASHBOARD ─────────────────────────────────────── */}
        {activeTab === "dashboard" && (
          <div>
            <div className="jc-card-grid">
              <div className="jc-stat-card">
                <div className="jc-stat-label">Avg Margin</div>
                <div className="jc-stat-value" style={{ color: avgMargin >= settings.target_margin_pct ? "#22C55E" : avgMargin >= settings.target_margin_pct * 0.8 ? "#EAB308" : "#EF4444" }}>
                  {formatPct(avgMargin)}
                </div>
                <div className="jc-stat-sub">Target: {formatPct(settings.target_margin_pct)}</div>
              </div>
              <div className="jc-stat-card">
                <div className="jc-stat-label">Revenue (Completed)</div>
                <div className="jc-stat-value" style={{ fontSize: 22 }}>{formatCurrency(totalRevenue)}</div>
                <div className="jc-stat-sub">{completedJobs.length} jobs</div>
              </div>
              <div className="jc-stat-card">
                <div className="jc-stat-label">Gross Profit</div>
                <div className="jc-stat-value" style={{ fontSize: 22, color: totalProfit > 0 ? "#22C55E" : "#EF4444" }}>{formatCurrency(totalProfit)}</div>
                <div className="jc-stat-sub">After overhead</div>
              </div>
              <div className="jc-stat-card">
                <div className="jc-stat-label">Active Jobs</div>
                <div className="jc-stat-value">{jobs.filter((j) => j.status === "in_progress").length}</div>
                <div className="jc-stat-sub">In progress</div>
              </div>
            </div>

            {/* Best and worst */}
            <div className="jc-profit-grid">
              <div className="jc-card">
                <div className="jc-section-heading">Most Profitable Jobs</div>
                {bestJobs.map((job, i) => (
                  <div key={job.id} className="jc-leaderboard-row">
                    <div className={`jc-lb-rank ${i === 0 ? "top" : ""}`}>{i + 1}</div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: "var(--steel)" }}>{job.description.slice(0, 35)}{job.description.length > 35 ? "…" : ""}</div>
                      <div style={{ fontSize: 12, color: "var(--mist)" }}>{job.customer_name}</div>
                    </div>
                    <MarginBadge margin={job.margin} />
                  </div>
                ))}
              </div>
              <div className="jc-card">
                <div className="jc-section-heading">Least Profitable Jobs</div>
                {worstJobs.map((job, i) => (
                  <div key={job.id} className="jc-leaderboard-row">
                    <div className="jc-lb-rank">{i + 1}</div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: "var(--steel)" }}>{job.description.slice(0, 35)}{job.description.length > 35 ? "…" : ""}</div>
                      <div style={{ fontSize: 12, color: "var(--mist)" }}>{job.customer_name}</div>
                    </div>
                    <MarginBadge margin={job.margin} target={settings.target_margin_pct} />
                  </div>
                ))}
              </div>
            </div>

            {/* Margin by job type */}
            <div className="jc-card">
              <div className="jc-section-heading">Margin by Job Type</div>
              {(() => {
                const byType = {};
                completedJobs.forEach((j) => {
                  const type = j.job_type || "Other";
                  if (!byType[type]) byType[type] = [];
                  byType[type].push(j.margin || 0);
                });
                return Object.entries(byType).map(([type, margins]) => {
                  const avg = margins.reduce((s, m) => s + m, 0) / margins.length;
                  return (
                    <div key={type} style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
                      <div style={{ width: 90, fontSize: 13, color: "var(--steel)", fontWeight: 500 }}>{type}</div>
                      <div style={{ flex: 1 }}>
                        <div className="jc-margin-bar">
                          <div className="jc-margin-fill" style={{ width: `${Math.min(avg, 100)}%`, background: marginBarColor[marginColor(avg, settings.target_margin_pct)] }} />
                        </div>
                      </div>
                      <div style={{ width: 50, textAlign: "right", fontSize: 13, fontWeight: 600, color: "var(--mid)" }}>{formatPct(avg)}</div>
                      <div style={{ width: 40, textAlign: "right", fontSize: 11, color: "var(--mist)" }}>{margins.length} job{margins.length > 1 ? "s" : ""}</div>
                    </div>
                  );
                });
              })()}
            </div>
          </div>
        )}

        {/* ── ALL JOBS ──────────────────────────────────────── */}
        {activeTab === "jobs" && (
          <div>
            {jobsWithMargin.map((job) => (
              <div key={job.id} className={`jc-job-card ${expandedJob === job.id ? "expanded" : ""}`}>
                <div className="jc-job-header" onClick={() => setExpandedJob(expandedJob === job.id ? null : job.id)}>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <span className="jc-job-name">{job.description}</span>
                      <span className={`jc-pill jc-pill-${job.status}`}>{job.status === "in_progress" ? "In progress" : job.status}</span>
                    </div>
                    <div className="jc-job-meta">{job.customer_name} · {job.job_type} · {formatDate(job.start_date)}</div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontSize: 13, color: "var(--mist)" }}>Quoted</div>
                      <div style={{ fontSize: 15, fontWeight: 700, color: "var(--steel)" }}>{formatCurrency(job.quoted_amount)}</div>
                    </div>
                    <MarginBadge margin={job.margin} target={settings.target_margin_pct} />
                  </div>
                </div>

                {expandedJob === job.id && (
                  <div style={{ marginTop: 16 }}>
                    {/* AI Insight */}
                    {showInsight === job.id && (
                      <div className="jc-insight" style={{ marginBottom: 16 }}>
                        <div className="jc-insight-label">AI Insight</div>
                        {insightLoading ? (
                          <div style={{ display: "flex", alignItems: "center", gap: 8, color: "rgba(255,255,255,0.6)" }}>
                            <span className="jc-spinner" />
                            <span style={{ fontSize: 13 }}>Analysing this job...</span>
                          </div>
                        ) : (
                          <div className="jc-insight-text">{insightText}</div>
                        )}
                      </div>
                    )}

                    {/* Summary row */}
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 16 }}>
                      {[
                        ["Quoted", formatCurrency(job.quoted_amount)],
                        ["Total cost", formatCurrency(job.totalCost)],
                        ["Overhead", formatCurrency(job.overheadAlloc)],
                        ["Gross profit", formatCurrency(job.quoted_amount - job.totalCostWithOverhead)],
                      ].map(([label, value]) => (
                        <div key={label} style={{ padding: "10px 12px", background: "var(--chalk)", borderRadius: 6 }}>
                          <div style={{ fontSize: 10, color: "var(--mist)", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 4 }}>{label}</div>
                          <div style={{ fontSize: 15, fontWeight: 700, color: "var(--steel)" }}>{value}</div>
                        </div>
                      ))}
                    </div>

                    {/* Quoted vs actual variance */}
                    {(() => {
                      const variance = (job.quoted_amount || 0) - (job.totalCost || 0);
                      const under = variance >= 0;
                      return (
                        <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap", padding: "10px 14px", marginBottom: 16, borderRadius: 6, background: under ? "#F0FDF4" : "#FEF2F2", border: `1px solid ${under ? "#BBF7D0" : "#FECACA"}` }}>
                          <span style={{ fontSize: 13, color: "var(--mist)" }}>Quoted <strong style={{ color: "var(--steel)" }}>{formatCurrency(job.quoted_amount)}</strong></span>
                          <span style={{ fontSize: 13, color: "var(--mist)" }}>Actual cost so far <strong style={{ color: "var(--steel)" }}>{formatCurrency(job.totalCost)}</strong></span>
                          <span style={{ fontSize: 13, color: under ? "#166534" : "#991B1B", fontWeight: 700 }}>
                            Variance {under ? "" : "−"}{formatCurrency(Math.abs(variance))} {under ? "(under)" : "(over)"}
                          </span>
                        </div>
                      );
                    })()}

                    {/* Linked quotes */}
                    {(quotesByJob[job.id] || []).length > 0 && (
                      <div style={{ marginBottom: 16 }}>
                        <div className="jc-section-heading">Linked Quotes</div>
                        {(quotesByJob[job.id] || []).map((q) => {
                          const st = q.quote_accepted_at || q.converted_to_invoice_id ? "accepted"
                            : q.status === "cancelled" ? "declined"
                            : (q.quote_expiry_date && q.quote_expiry_date < new Date().toISOString().split("T")[0]) ? "expired"
                            : "pending";
                          const c = { pending: ["#FEF9C3", "#854D0E"], accepted: ["#DCFCE7", "#166534"], declined: ["#FEE2E2", "#991B1B"], expired: ["#F3F4F6", "#6B7280"] }[st];
                          return (
                            <div key={q.id} className="jc-cost-row" style={{ justifyContent: "space-between" }}>
                              <div style={{ fontSize: 13, color: "var(--steel)", fontWeight: 600 }}>{q.invoice_number}</div>
                              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                                <span style={{ fontSize: 13, fontWeight: 700, color: "var(--steel)" }}>{formatCurrency((q.total_pence || 0) / 100)}</span>
                                <span className="jc-pill" style={{ background: c[0], color: c[1], textTransform: "capitalize" }}>{st}</span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* Margin bar */}
                    <div style={{ marginBottom: 16 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--mist)", marginBottom: 4 }}>
                        <span>Margin</span>
                        <span>{job.margin !== null ? formatPct(job.margin) : "No quote"} (target: {formatPct(settings.target_margin_pct)})</span>
                      </div>
                      <div className="jc-margin-bar" style={{ height: 10 }}>
                        <div className="jc-margin-fill" style={{ width: `${Math.min(Math.max(job.margin || 0, 0), 100)}%`, background: marginBarColor[job.marginCat] }} />
                      </div>
                      {settings.target_margin_pct && (
                        <div style={{ position: "relative", height: 0 }}>
                          <div style={{ position: "absolute", left: `${settings.target_margin_pct}%`, top: -10, width: 2, height: 10, background: "var(--steel)", opacity: 0.3 }} />
                        </div>
                      )}
                    </div>

                    {/* Cost list */}
                    <div className="jc-section-heading">Cost Breakdown</div>
                    {job.costs.map((cost) => (
                      <div key={cost.id} className="jc-cost-row">
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <div className="jc-cost-type-dot" style={{ background: COST_COLORS[cost.cost_type] }} />
                          <div>
                            <div style={{ fontSize: 13, color: "var(--steel)", fontWeight: 500 }}>{cost.description}</div>
                            <div style={{ fontSize: 11, color: "var(--mist)" }}>
                              {cost.quantity} × {formatCurrency(cost.unit_cost)} {cost.supplier ? `· ${cost.supplier}` : ""}
                            </div>
                          </div>
                        </div>
                        <div style={{ fontSize: 14, fontWeight: 700, color: "var(--steel)" }}>{formatCurrency(cost.total_cost)}</div>
                      </div>
                    ))}

                    {/* Add cost */}
                    <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
                      <button className="jc-btn jc-btn-primary jc-btn-sm" onClick={() => setShowAddCost(job)}>
                        + Log Cost
                      </button>
                      {(userRole === "owner" || userRole === "manager") && (
                        <button
                          className="jc-btn jc-btn-secondary jc-btn-sm"
                          onClick={() => handleInsight(job)}
                          disabled={insightLoading}
                        >
                          {insightLoading && showInsight === job.id ? <><span className="jc-spinner" /> Analysing...</> : "AI Insight"}
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* ── SUPPLIER PRICE LIST ───────────────────────────── */}
        {activeTab === "suppliers" && (
          <div>
            <div className="jc-alert jc-alert-info">
              Add your regular suppliers and prices here. When logging materials against a job, prices auto-suggest from this list.
            </div>
            <div className="jc-card">
              <div className="jc-section-heading">Supplier Price List</div>
              {suppliers.map((s) => (
                <div key={s.id} className="jc-supplier-row">
                  <div>
                    <div style={{ fontWeight: 500, color: "var(--steel)" }}>{s.item_name}</div>
                    <div style={{ fontSize: 12, color: "var(--mist)" }}>{s.supplier_name} · per {s.unit}</div>
                  </div>
                  <div style={{ fontWeight: 700, color: "var(--steel)" }}>{formatCurrency(s.price)}</div>
                </div>
              ))}
            </div>
            <button
              className="jc-btn jc-btn-primary"
              onClick={() => showAlertMsg("info", "Add supplier price — enter supplier name, item, unit and price.")}
            >
              + Add Price
            </button>
          </div>
        )}

        {/* ── SETTINGS ──────────────────────────────────────── */}
        {activeTab === "settings" && (
          <div className="jc-card">
            <div className="jc-section-heading">Profitability Settings</div>
            <div className="jc-form-grid">
              <div className="jc-input-group">
                <label className="jc-input-label">Target margin (%)</label>
                <input
                  type="number"
                  className="jc-input"
                  value={settings.target_margin_pct}
                  onChange={(e) => setSettings((s) => ({ ...s, target_margin_pct: parseFloat(e.target.value) }))}
                />
              </div>
              <div className="jc-input-group">
                <label className="jc-input-label">Default labour rate (£/hour)</label>
                <input
                  type="number"
                  className="jc-input"
                  value={settings.labour_rate_default}
                  onChange={(e) => setSettings((s) => ({ ...s, labour_rate_default: parseFloat(e.target.value) }))}
                />
              </div>
              <div className="jc-input-group">
                <label className="jc-input-label">Monthly overheads (£)</label>
                <input
                  type="number"
                  className="jc-input"
                  value={settings.overhead_monthly}
                  onChange={(e) => setSettings((s) => ({ ...s, overhead_monthly: parseFloat(e.target.value) }))}
                />
              </div>
              <div className="jc-input-group">
                <label className="jc-input-label">Billable hours per month</label>
                <input
                  type="number"
                  className="jc-input"
                  value={settings.overhead_hours_monthly}
                  onChange={(e) => setSettings((s) => ({ ...s, overhead_hours_monthly: parseInt(e.target.value) }))}
                />
              </div>
            </div>
            <div className="jc-alert jc-alert-info" style={{ marginBottom: 16 }}>
              Overhead rate: {formatCurrency(settings.overhead_monthly / settings.overhead_hours_monthly)}/hour — allocated per labour hour logged on each job.
            </div>
            <button className="jc-btn jc-btn-primary" onClick={async () => {
              const row = {
                account_id: accountId,
                monthly_overhead_pence: poundsToPence(settings.overhead_monthly),
                target_hours_per_month: parseInt(settings.overhead_hours_monthly) || 160,
              };
              const { error } = await supabase.from("overhead_configs").upsert(row, { onConflict: "account_id" });
              if (error) { showAlertMsg("error", `Could not save settings: ${error.message}`); return; }
              await logAction(supabase, { accountId, userId, userName, userRole, action: "updated", entityType: "overhead_config", entityName: "Overhead settings" });
              showAlertMsg("success", "Settings saved. (Target margin & default labour rate are UI-only — no column yet.)");
            }}>
              Save Settings
            </button>
          </div>
        )}

        {/* ── ADD JOB MODAL ─────────────────────────────────── */}
        {showAddJob && (
          <AddJobModal
            onSubmit={async (data) => {
              const row = {
                account_id: accountId,
                title: data.customer_name,
                description: data.description,
                job_type: data.job_type || null,
                quoted_amount_pence: poundsToPence(data.quoted_amount),
                status: data.status === "complete" ? "completed" : data.status,
                scheduled_date: data.start_date || null,
              };
              const { data: inserted, error } = await supabase
                .from("jobs").insert(row).select("*, contact:contacts(*), costs:job_costs(*)").single();
              if (error) { showAlertMsg("error", `Could not add job: ${error.message}`); return; }
              setJobs((prev) => [mapJob(inserted), ...prev]);
              setShowAddJob(false);
              await logAction(supabase, { accountId, userId, userName, userRole, action: "created", entityType: "job", entityId: inserted.id, entityName: data.customer_name });
              showAlertMsg("success", "Job added.");
            }}
            onClose={() => setShowAddJob(false)}
          />
        )}

        {/* ── ADD COST MODAL ────────────────────────────────── */}
        {showAddCost && (
          <AddCostModal
            job={showAddCost}
            suppliers={suppliers}
            defaultLabourRate={settings.labour_rate_default}
            onSubmit={(data) => handleAddCost(showAddCost.id, data)}
            onClose={() => setShowAddCost(null)}
          />
        )}
      </div>
    </>
  );
}

// ── MARGIN BADGE ─────────────────────────────────────────────────
function MarginBadge({ margin, target = 30 }) {
  if (margin === null || margin === undefined) {
    return <span className="jc-margin-badge jc-margin-grey">No quote</span>;
  }
  const cat = marginColor(margin, target);
  return (
    <span className={`jc-margin-badge jc-margin-${cat}`}>
      {formatPct(margin)}
    </span>
  );
}

// ── ADD JOB MODAL ────────────────────────────────────────────────
function AddJobModal({ onSubmit, onClose }) {
  const [form, setForm] = useState({
    customer_name: "", description: "", job_type: "", quoted_amount: "",
    status: "in_progress", start_date: new Date().toISOString().split("T")[0],
  });
  const f = (key) => (e) => setForm((p) => ({ ...p, [key]: e.target.value }));

  return (
    <div className="jc-modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="jc-modal">
        <div className="jc-modal-header">
          <span className="jc-modal-title">Add Job</span>
          <button className="jc-btn jc-btn-ghost jc-btn-sm" onClick={onClose}>Close</button>
        </div>
        <div className="jc-form-grid">
          <div className="jc-input-group">
            <label className="jc-input-label">Customer *</label>
            <input className="jc-input" placeholder="Customer name" value={form.customer_name} onChange={f("customer_name")} />
          </div>
          <div className="jc-input-group">
            <label className="jc-input-label">Job type</label>
            <input className="jc-input" placeholder="e.g. Boiler, Bathroom" value={form.job_type} onChange={f("job_type")} />
          </div>
          <div className="jc-input-group" style={{ gridColumn: "1 / -1" }}>
            <label className="jc-input-label">Description *</label>
            <input className="jc-input" placeholder="Brief description of the job" value={form.description} onChange={f("description")} />
          </div>
          <div className="jc-input-group">
            <label className="jc-input-label">Quoted amount (£)</label>
            <input type="number" className="jc-input" placeholder="0.00" value={form.quoted_amount} onChange={f("quoted_amount")} />
          </div>
          <div className="jc-input-group">
            <label className="jc-input-label">Start date</label>
            <input type="date" className="jc-input" value={form.start_date} onChange={f("start_date")} />
          </div>
        </div>
        <button
          className="jc-btn jc-btn-primary"
          style={{ width: "100%" }}
          disabled={!form.customer_name || !form.description}
          onClick={() => onSubmit({ ...form, quoted_amount: parseFloat(form.quoted_amount) || 0 })}
        >
          Add Job
        </button>
      </div>
    </div>
  );
}

// ── ADD COST MODAL ───────────────────────────────────────────────
function AddCostModal({ job, suppliers, defaultLabourRate, onSubmit, onClose }) {
  const [form, setForm] = useState({
    cost_type: "material",
    description: "",
    quantity: 1,
    unit_cost: "",
    supplier: "",
  });
  const f = (key) => (e) => setForm((p) => ({ ...p, [key]: e.target.value }));

  // Suggest labour rate when type changes
  const handleTypeChange = (e) => {
    const type = e.target.value;
    setForm((p) => ({
      ...p,
      cost_type: type,
      unit_cost: type === "labour" ? defaultLabourRate : p.unit_cost,
      description: type === "labour" ? "" : p.description,
    }));
  };

  const total = (parseFloat(form.quantity) || 0) * (parseFloat(form.unit_cost) || 0);

  return (
    <div className="jc-modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="jc-modal">
        <div className="jc-modal-header">
          <span className="jc-modal-title">Log Cost — {job.description.slice(0, 30)}</span>
          <button className="jc-btn jc-btn-ghost jc-btn-sm" onClick={onClose}>Close</button>
        </div>
        <div className="jc-input-group">
          <label className="jc-input-label">Cost type</label>
          <select className="jc-input" value={form.cost_type} onChange={handleTypeChange}>
            <option value="material">Material</option>
            <option value="labour">Labour (hours)</option>
            <option value="subcontractor">Subcontractor</option>
            <option value="other">Other</option>
          </select>
        </div>
        <div className="jc-input-group">
          <label className="jc-input-label">
            {form.cost_type === "labour" ? "Description (who, what)" : "Description"}
          </label>
          <input
            className="jc-input"
            placeholder={form.cost_type === "labour" ? "e.g. Dave Thompson — installation" : "e.g. 22mm copper pipe"}
            value={form.description}
            onChange={f("description")}
            list={form.cost_type === "material" ? "supplier-suggestions" : undefined}
          />
          {form.cost_type === "material" && (
            <datalist id="supplier-suggestions">
              {suppliers.map((s) => (
                <option key={s.id} value={s.item_name} />
              ))}
            </datalist>
          )}
        </div>
        <div className="jc-form-grid">
          <div className="jc-input-group">
            <label className="jc-input-label">{form.cost_type === "labour" ? "Hours" : "Quantity"}</label>
            <input type="number" className="jc-input" value={form.quantity} onChange={f("quantity")} min="0.01" step="0.01" />
          </div>
          <div className="jc-input-group">
            <label className="jc-input-label">{form.cost_type === "labour" ? "Rate (£/hr)" : "Unit cost (£)"}</label>
            <input type="number" className="jc-input" value={form.unit_cost} onChange={f("unit_cost")} min="0.01" step="0.01" />
          </div>
        </div>
        {form.cost_type === "material" && (
          <div className="jc-input-group">
            <label className="jc-input-label">Supplier (optional)</label>
            <input className="jc-input" placeholder="e.g. Screwfix" value={form.supplier} onChange={f("supplier")} />
          </div>
        )}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 0", borderTop: "1px solid var(--rule)", marginBottom: 16 }}>
          <span style={{ fontSize: 13, color: "var(--mist)" }}>Total cost</span>
          <span style={{ fontSize: 18, fontWeight: 800, color: "var(--steel)", fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
            {formatCurrency(total)}
          </span>
        </div>
        <button
          className="jc-btn jc-btn-primary"
          style={{ width: "100%" }}
          disabled={!form.description || !form.unit_cost}
          onClick={() => onSubmit({ ...form, quantity: parseFloat(form.quantity), unit_cost: parseFloat(form.unit_cost) })}
        >
          Log Cost
        </button>
      </div>
    </div>
  );
}
