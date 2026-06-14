/**
 * FleetManager.jsx
 * Your Company AI — Fleet & Vehicle Management Module
 *
 * DEPENDENCIES (injected via props from core platform):
 *   supabase        — Supabase client instance
 *   accountId       — Current account UUID
 *   userId          — Current platform_user UUID
 *   userName        — Current user display name
 *   userRole        — 'owner' | 'manager' | 'staff'
 *
 * DATABASE TABLES USED:
 *   fleet_vehicles        — Vehicle register
 *   fleet_assignments     — Vehicle assignment to employee/job
 *   fleet_service_history — Service and maintenance records
 *   fleet_faults          — Fault reports
 *   fleet_mileage         — Mileage log entries
 *   fleet_costs           — Fuel, repairs, tyres per vehicle
 *   platform_users        — Employee names for assignment (read only)
 *   audit_log             — Audit trail
 *
 * EXTERNAL:
 *   DVLA MOT History API  — Free, no auth. GET https://beta.check-mot.service.gov.uk/trade/vehicles/mot-tests?registration={reg}
 *   Note: In production call via Supabase Edge Function to protect the API key and handle CORS.
 *
 * SCHEMA — add these tables to supabase_schema.sql:
 *
 * CREATE TABLE public.fleet_vehicles (
 *   id                uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
 *   account_id        uuid REFERENCES public.accounts(id) ON DELETE CASCADE,
 *   registration      text NOT NULL,
 *   make              text,
 *   model             text,
 *   year              int,
 *   colour            text,
 *   engine_size       text,
 *   fuel_type         text,
 *   mot_expiry        date,
 *   tax_expiry        date,
 *   insurance_expiry  date,
 *   insurance_provider text,
 *   insurance_policy  text,
 *   service_interval_miles int DEFAULT 12000,
 *   service_interval_months int DEFAULT 12,
 *   last_service_date date,
 *   last_service_miles int,
 *   next_service_date date,
 *   current_mileage   int DEFAULT 0,
 *   purchase_date     date,
 *   purchase_price    numeric(10,2),
 *   assigned_user_id  uuid REFERENCES public.platform_users(id),
 *   notes             text,
 *   status            text DEFAULT 'active' CHECK (status IN ('active','off_road','sold','stolen')),
 *   dvla_last_checked timestamptz,
 *   created_at        timestamptz DEFAULT now(),
 *   updated_at        timestamptz DEFAULT now()
 * );
 *
 * CREATE TABLE public.fleet_faults (
 *   id            uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
 *   account_id    uuid REFERENCES public.accounts(id) ON DELETE CASCADE,
 *   vehicle_id    uuid REFERENCES public.fleet_vehicles(id) ON DELETE CASCADE,
 *   reported_by   uuid REFERENCES public.platform_users(id),
 *   reporter_name text NOT NULL,
 *   description   text NOT NULL,
 *   photo_url     text,
 *   severity      text DEFAULT 'medium' CHECK (severity IN ('low','medium','high','critical')),
 *   status        text DEFAULT 'open' CHECK (status IN ('open','in_progress','resolved')),
 *   resolution    text,
 *   resolved_at   timestamptz,
 *   created_at    timestamptz DEFAULT now()
 * );
 *
 * CREATE TABLE public.fleet_service_history (
 *   id            uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
 *   account_id    uuid REFERENCES public.accounts(id) ON DELETE CASCADE,
 *   vehicle_id    uuid REFERENCES public.fleet_vehicles(id) ON DELETE CASCADE,
 *   service_date  date NOT NULL,
 *   mileage       int,
 *   garage        text,
 *   work_done     text NOT NULL,
 *   cost          numeric(10,2),
 *   next_due_date date,
 *   notes         text,
 *   created_at    timestamptz DEFAULT now()
 * );
 *
 * CREATE TABLE public.fleet_mileage (
 *   id            uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
 *   account_id    uuid REFERENCES public.accounts(id) ON DELETE CASCADE,
 *   vehicle_id    uuid REFERENCES public.fleet_vehicles(id) ON DELETE CASCADE,
 *   user_id       uuid REFERENCES public.platform_users(id),
 *   driver_name   text NOT NULL,
 *   trip_date     date NOT NULL,
 *   start_location text,
 *   end_location  text,
 *   miles         numeric(8,1) NOT NULL,
 *   purpose       text NOT NULL,
 *   is_business   boolean DEFAULT true,
 *   created_at    timestamptz DEFAULT now()
 * );
 *
 * CREATE TABLE public.fleet_costs (
 *   id            uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
 *   account_id    uuid REFERENCES public.accounts(id) ON DELETE CASCADE,
 *   vehicle_id    uuid REFERENCES public.fleet_vehicles(id) ON DELETE CASCADE,
 *   cost_date     date NOT NULL,
 *   cost_type     text CHECK (cost_type IN ('fuel','repair','tyre','mot','service','insurance','tax','other')),
 *   amount        numeric(10,2) NOT NULL,
 *   description   text,
 *   mileage       int,
 *   litres        numeric(6,2),
 *   created_at    timestamptz DEFAULT now()
 * );
 *
 * Enable RLS on all tables with standard account_id policies.
 */

import { useState, useEffect, useCallback } from "react";

// ── CONSTANTS ───────────────────────────────────────────────────
const TABS = [
  { id: "dashboard", label: "Dashboard" },
  { id: "vehicles",  label: "Vehicles" },
  { id: "faults",    label: "Faults" },
  { id: "mileage",   label: "Mileage Log" },
  { id: "costs",     label: "Costs" },
];

const HMRC_RATE_FIRST  = 0.45; // per mile, first 10,000
const HMRC_RATE_AFTER  = 0.25; // per mile, after 10,000

const ALERT_DAYS = { critical: 7, warning: 30, advisory: 60 };

// ── STYLES ──────────────────────────────────────────────────────
const css = `
  @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=DM+Sans:wght@300;400;500&display=swap');

  .fm-wrap * { box-sizing: border-box; margin: 0; padding: 0; }
  .fm-wrap {
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
    --blue:     #3B82F6;
    --radius:   8px;
    font-family: 'DM Sans', sans-serif;
    color: var(--mid);
    background: #F0EDE8;
    min-height: 100vh;
    padding: 24px;
  }

  .fm-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 24px;
  }
  .fm-header h1 {
    font-family: 'Plus Jakarta Sans', sans-serif;
    font-weight: 800;
    font-size: 22px;
    color: var(--steel);
    letter-spacing: -0.3px;
  }
  .fm-header p { font-size: 13px; color: var(--mist); margin-top: 2px; }

  .fm-tabs {
    display: flex;
    gap: 4px;
    background: var(--white);
    border: 1px solid var(--rule);
    border-radius: var(--radius);
    padding: 4px;
    margin-bottom: 24px;
    overflow-x: auto;
  }
  .fm-tab {
    flex: 1;
    min-width: fit-content;
    padding: 8px 14px;
    border: none;
    background: none;
    border-radius: 6px;
    font-family: 'DM Sans', sans-serif;
    font-size: 13px;
    font-weight: 500;
    color: var(--light);
    cursor: pointer;
    white-space: nowrap;
    transition: all 0.15s;
  }
  .fm-tab.active { background: var(--steel); color: var(--white); }
  .fm-tab .badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 18px; height: 18px;
    background: var(--ember);
    color: white;
    border-radius: 50%;
    font-size: 10px;
    font-weight: 700;
    margin-left: 6px;
  }

  .fm-card {
    background: var(--white);
    border: 1px solid var(--rule);
    border-radius: var(--radius);
    padding: 20px;
    margin-bottom: 16px;
  }
  .fm-card-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    gap: 16px;
    margin-bottom: 24px;
  }
  .fm-stat-card {
    background: var(--white);
    border: 1px solid var(--rule);
    border-radius: var(--radius);
    padding: 18px 20px;
  }
  .fm-stat-label {
    font-size: 11px;
    font-weight: 600;
    color: var(--mist);
    text-transform: uppercase;
    letter-spacing: 1px;
    margin-bottom: 8px;
  }
  .fm-stat-value {
    font-family: 'Plus Jakarta Sans', sans-serif;
    font-weight: 800;
    font-size: 28px;
    color: var(--steel);
    line-height: 1;
  }
  .fm-stat-sub { font-size: 12px; color: var(--mist); margin-top: 4px; }

  .fm-section-heading {
    font-family: 'Plus Jakarta Sans', sans-serif;
    font-weight: 700;
    font-size: 14px;
    color: var(--steel);
    margin-bottom: 12px;
    padding-bottom: 8px;
    border-bottom: 1px solid var(--rule);
  }

  /* Vehicle card */
  .fm-vehicle-card {
    background: var(--white);
    border: 1px solid var(--rule);
    border-radius: var(--radius);
    padding: 20px;
    margin-bottom: 16px;
    transition: border-color 0.15s;
  }
  .fm-vehicle-card:hover { border-color: var(--mist); }
  .fm-vehicle-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 16px;
  }
  .fm-reg-plate {
    font-family: 'Plus Jakarta Sans', sans-serif;
    font-weight: 800;
    font-size: 20px;
    color: var(--steel);
    letter-spacing: 2px;
    background: #FFF9C4;
    border: 2px solid #F59E0B;
    padding: 4px 12px;
    border-radius: 4px;
    display: inline-block;
  }
  .fm-vehicle-make {
    font-size: 15px;
    font-weight: 600;
    color: var(--steel);
    margin-top: 6px;
  }
  .fm-vehicle-sub { font-size: 12px; color: var(--mist); margin-top: 2px; }

  /* Compliance grid */
  .fm-compliance-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
    gap: 10px;
    margin-top: 14px;
  }
  .fm-compliance-item {
    padding: 10px 12px;
    border-radius: 6px;
    border: 1px solid;
  }
  .fm-compliance-label { font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px; }
  .fm-compliance-date  { font-size: 13px; font-weight: 600; }
  .fm-compliance-days  { font-size: 11px; margin-top: 2px; }
  .fm-compliance-green  { background: #F0FDF4; border-color: #BBF7D0; color: #166534; }
  .fm-compliance-amber  { background: #FFFBEB; border-color: #FDE68A; color: #92400E; }
  .fm-compliance-red    { background: #FEF2F2; border-color: #FECACA; color: #991B1B; }
  .fm-compliance-grey   { background: #F9FAFB; border-color: #E5E7EB; color: #6B7280; }

  /* Traffic light */
  .fm-traffic {
    display: flex;
    gap: 4px;
    align-items: center;
  }
  .fm-traffic-dot {
    width: 10px; height: 10px;
    border-radius: 50%;
  }

  /* DVLA lookup */
  .fm-dvla-row {
    display: flex;
    gap: 8px;
    align-items: center;
    margin-bottom: 16px;
  }
  .fm-reg-input {
    font-family: 'Plus Jakarta Sans', sans-serif;
    font-weight: 800;
    font-size: 18px;
    letter-spacing: 3px;
    text-transform: uppercase;
    padding: 10px 16px;
    border: 2px solid #F59E0B;
    border-radius: 6px;
    background: #FFF9C4;
    color: var(--steel);
    outline: none;
    width: 180px;
  }
  .fm-reg-input:focus { border-color: var(--ember); background: white; letter-spacing: 3px; }

  /* Fault item */
  .fm-fault-item {
    padding: 14px 0;
    border-bottom: 1px solid var(--rule);
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
  }
  .fm-fault-item:last-child { border-bottom: none; }
  .fm-fault-severity {
    width: 8px; height: 8px;
    border-radius: 50%;
    margin-top: 5px;
    flex-shrink: 0;
  }

  /* Mileage row */
  .fm-mileage-row {
    display: grid;
    grid-template-columns: 90px 1fr 1fr 80px 60px;
    gap: 12px;
    align-items: center;
    padding: 10px 0;
    border-bottom: 1px solid var(--rule);
    font-size: 13px;
  }
  .fm-mileage-row:last-child { border-bottom: none; }
  .fm-mileage-header { font-weight: 600; color: var(--steel); font-size: 12px; }

  /* Cost row */
  .fm-cost-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 0;
    border-bottom: 1px solid var(--rule);
    font-size: 13px;
  }
  .fm-cost-row:last-child { border-bottom: none; }

  /* Buttons */
  .fm-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 8px 14px;
    border-radius: 6px;
    font-family: 'DM Sans', sans-serif;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    border: none;
    transition: all 0.15s;
    white-space: nowrap;
  }
  .fm-btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .fm-btn-primary   { background: var(--ember); color: white; }
  .fm-btn-primary:hover:not(:disabled) { background: var(--ember-lt); }
  .fm-btn-secondary { background: var(--chalk); color: var(--steel); border: 1px solid var(--rule); }
  .fm-btn-secondary:hover:not(:disabled) { border-color: var(--mist); }
  .fm-btn-ghost     { background: none; color: var(--mist); border: 1px solid var(--rule); }
  .fm-btn-ghost:hover:not(:disabled) { color: var(--steel); border-color: var(--steel); }
  .fm-btn-sm        { padding: 5px 10px; font-size: 12px; }
  .fm-btn-danger    { background: #FEE2E2; color: #991B1B; border: 1px solid #FECACA; }

  /* Pill */
  .fm-pill {
    display: inline-flex;
    align-items: center;
    padding: 3px 10px;
    border-radius: 20px;
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  .fm-pill-active   { background: #DCFCE7; color: #166534; }
  .fm-pill-offroad  { background: #FEE2E2; color: #991B1B; }
  .fm-pill-open     { background: #FEF9C3; color: #854D0E; }
  .fm-pill-resolved { background: #DCFCE7; color: #166534; }
  .fm-pill-critical { background: #FEE2E2; color: #991B1B; }

  /* Form */
  .fm-input {
    width: 100%;
    padding: 9px 12px;
    border: 1px solid var(--rule);
    border-radius: 6px;
    font-family: 'DM Sans', sans-serif;
    font-size: 14px;
    color: var(--steel);
    outline: none;
    transition: border-color 0.15s;
    background: white;
  }
  .fm-input:focus { border-color: var(--ember); }
  .fm-input-label { font-size: 13px; font-weight: 500; color: var(--steel); margin-bottom: 6px; display: block; }
  .fm-input-group { margin-bottom: 16px; }
  .fm-form-grid   { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }

  /* Modal overlay */
  .fm-modal-overlay {
    position: fixed;
    inset: 0;
    background: rgba(28,28,46,0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 100;
    padding: 20px;
  }
  .fm-modal {
    background: var(--white);
    border-radius: var(--radius);
    padding: 24px;
    width: 100%;
    max-width: 520px;
    max-height: 90vh;
    overflow-y: auto;
  }
  .fm-modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 20px;
  }
  .fm-modal-title {
    font-family: 'Plus Jakarta Sans', sans-serif;
    font-weight: 700;
    font-size: 16px;
    color: var(--steel);
  }

  /* Alert */
  .fm-alert {
    padding: 12px 16px;
    border-radius: var(--radius);
    font-size: 13px;
    margin-bottom: 16px;
  }
  .fm-alert-success { background: #DCFCE7; border: 1px solid #BBF7D0; color: #166534; }
  .fm-alert-warning { background: #FFFBEB; border: 1px solid #FDE68A; color: #92400E; }
  .fm-alert-info    { background: #EFF6FF; border: 1px solid #BFDBFE; color: #1E40AF; }

  /* Empty */
  .fm-empty {
    text-align: center;
    padding: 48px 24px;
    color: var(--mist);
  }
  .fm-empty h3 { font-size: 16px; color: var(--steel); margin-bottom: 6px; }
  .fm-empty p  { font-size: 13px; }

  /* Spinner */
  .fm-spinner {
    width: 18px; height: 18px;
    border: 2px solid var(--rule);
    border-top-color: var(--ember);
    border-radius: 50%;
    animation: fm-spin 0.6s linear infinite;
    display: inline-block;
  }
  @keyframes fm-spin { to { transform: rotate(360deg); } }

  /* Incident walkthrough */
  .fm-incident-step {
    padding: 16px;
    background: var(--chalk);
    border-radius: 6px;
    margin-bottom: 10px;
    border-left: 3px solid var(--ember);
  }
  .fm-incident-step h4 {
    font-size: 14px;
    font-weight: 700;
    color: var(--steel);
    margin-bottom: 6px;
  }
  .fm-incident-step p {
    font-size: 13px;
    color: var(--mid);
    line-height: 1.6;
  }
  .fm-incident-step ul {
    margin: 6px 0 0 16px;
    font-size: 13px;
    color: var(--mid);
    line-height: 1.8;
  }
`;

// ── HELPERS ─────────────────────────────────────────────────────
const today = new Date();

const daysUntil = (dateStr) => {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  return Math.ceil((d - today) / (1000 * 60 * 60 * 24));
};

const complianceStatus = (dateStr) => {
  const days = daysUntil(dateStr);
  if (days === null) return "grey";
  if (days < 0)  return "red";
  if (days <= ALERT_DAYS.critical)  return "red";
  if (days <= ALERT_DAYS.warning)   return "amber";
  if (days <= ALERT_DAYS.advisory)  return "amber";
  return "green";
};

const formatDate = (d) => {
  if (!d) return "Not set";
  return new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
};

const formatCurrency = (n) => `£${(n || 0).toFixed(2)}`;

const logAction = async (supabase, params) => {
  try {
    await supabase.from("audit_log").insert({
      account_id: params.accountId,
      user_id: params.userId,
      user_name: params.userName,
      user_role: params.userRole,
      action: params.action,
      entity_type: params.entityType,
      entity_id: params.entityId,
      entity_name: params.entityName,
      old_value: params.oldValue || null,
      new_value: params.newValue || null,
    });
  } catch (e) {
    console.warn("Audit log failed:", e.message);
  }
};

// ── MOCK DATA ───────────────────────────────────────────────────
const MOCK_VEHICLES = [
  {
    id: "v1",
    registration: "FG21 XKT",
    make: "Ford",
    model: "Transit Custom",
    year: 2021,
    colour: "White",
    fuel_type: "Diesel",
    mot_expiry: "2026-08-14",
    tax_expiry: "2026-07-01",
    insurance_expiry: "2026-09-30",
    insurance_provider: "AXA",
    last_service_date: "2025-11-20",
    next_service_date: "2026-11-20",
    current_mileage: 34200,
    assigned_user_id: "u1",
    assigned_user_name: "Dave Thompson",
    status: "active",
    purchase_price: 24500,
  },
  {
    id: "v2",
    registration: "BK23 LMP",
    make: "Vauxhall",
    model: "Vivaro",
    year: 2023,
    colour: "Silver",
    fuel_type: "Diesel",
    mot_expiry: "2026-06-20",
    tax_expiry: "2026-08-01",
    insurance_expiry: "2026-09-30",
    insurance_provider: "AXA",
    last_service_date: "2026-01-10",
    next_service_date: "2027-01-10",
    current_mileage: 18900,
    assigned_user_id: "u2",
    assigned_user_name: "Steve Harris",
    status: "active",
    purchase_price: 31000,
  },
  {
    id: "v3",
    registration: "YH19 ZRP",
    make: "Mercedes",
    model: "Sprinter 314",
    year: 2019,
    colour: "White",
    fuel_type: "Diesel",
    mot_expiry: "2027-03-08",
    tax_expiry: "2026-12-01",
    insurance_expiry: "2026-09-30",
    insurance_provider: "AXA",
    last_service_date: "2025-09-05",
    next_service_date: "2026-09-05",
    current_mileage: 89400,
    assigned_user_id: null,
    assigned_user_name: null,
    status: "active",
    purchase_price: 38000,
  },
];

const MOCK_FAULTS = [
  { id: "f1", vehicle_id: "v1", vehicle_reg: "FG21 XKT", description: "Dashboard warning light — possible DPF issue", severity: "high", status: "open", reporter_name: "Dave Thompson", created_at: "2026-06-04T08:30:00Z" },
  { id: "f2", vehicle_id: "v2", vehicle_reg: "BK23 LMP", description: "Rear door seal needs replacing — letting in water", severity: "medium", status: "in_progress", reporter_name: "Steve Harris", created_at: "2026-06-01T14:00:00Z" },
  { id: "f3", vehicle_id: "v3", vehicle_reg: "YH19 ZRP", description: "Front left tyre worn to legal limit — needs replacing", severity: "critical", status: "open", reporter_name: "Adrian Fielding", created_at: "2026-06-05T09:15:00Z" },
];

const MOCK_MILEAGE = [
  { id: "m1", vehicle_id: "v1", vehicle_reg: "FG21 XKT", driver_name: "Dave Thompson", trip_date: "2026-06-05", start_location: "Workshop", end_location: "14 Maple Ave, Worthing", miles: 12.4, purpose: "Boiler installation", is_business: true },
  { id: "m2", vehicle_id: "v1", vehicle_reg: "FG21 XKT", driver_name: "Dave Thompson", trip_date: "2026-06-05", start_location: "14 Maple Ave, Worthing", end_location: "Workshop", miles: 12.4, purpose: "Return", is_business: true },
  { id: "m3", vehicle_id: "v2", vehicle_reg: "BK23 LMP", driver_name: "Steve Harris", trip_date: "2026-06-04", start_location: "Workshop", end_location: "Shoreham Industrial Estate", miles: 8.1, purpose: "Commercial job — pipe installation", is_business: true },
  { id: "m4", vehicle_id: "v3", vehicle_reg: "YH19 ZRP", driver_name: "Adrian Fielding", trip_date: "2026-06-03", start_location: "Workshop", end_location: "Supplier — Travis Perkins Worthing", miles: 3.2, purpose: "Materials collection", is_business: true },
];

const MOCK_COSTS = [
  { id: "c1", vehicle_id: "v1", vehicle_reg: "FG21 XKT", cost_date: "2026-06-03", cost_type: "fuel", amount: 87.50, description: "Shell Worthing — 60L diesel", litres: 60 },
  { id: "c2", vehicle_id: "v2", vehicle_reg: "BK23 LMP", cost_date: "2026-05-28", cost_type: "fuel", amount: 72.30, description: "BP Shoreham — 50L diesel", litres: 50 },
  { id: "c3", vehicle_id: "v3", vehicle_reg: "YH19 ZRP", cost_date: "2026-05-20", cost_type: "repair", amount: 340.00, description: "Alternator replacement — Kwik Fit" },
  { id: "c4", vehicle_id: "v1", vehicle_reg: "FG21 XKT", cost_date: "2026-05-15", cost_type: "tyre", amount: 156.00, description: "Two rear tyres — National Tyres" },
];

// Incident AI walkthrough steps
const INCIDENT_STEPS = [
  {
    step: "1. Check for injuries first",
    content: "Before anything else — is anyone hurt? If yes, call 999 immediately. Do not move anyone who may have a neck or back injury unless there is immediate danger.",
  },
  {
    step: "2. Make the scene safe",
    content: "Turn on hazard lights. If safe to do so, move the vehicle off the road. Do not admit fault to anyone at the scene.",
  },
  {
    step: "3. Exchange details",
    checklist: ["Full name and address", "Phone number", "Insurance company and policy number", "Vehicle registration", "Make and model"],
  },
  {
    step: "4. Photograph everything",
    checklist: ["Both vehicles from multiple angles", "Any damage close up", "Road conditions, skid marks, road signs", "The other driver's licence plate", "Any injuries (if relevant)"],
  },
  {
    step: "5. Get witness details",
    content: "If anyone witnessed the incident, ask for their name and phone number. Do not rely on memory.",
  },
  {
    step: "6. Report to your insurer",
    content: "Call your insurer as soon as possible — even if you don't intend to claim. Most policies require you to report all incidents. Failure to do so can invalidate your cover.",
  },
  {
    step: "7. Log the incident in the platform",
    content: "Use the Fault Report button on this vehicle to log what happened, the other party's details, and attach your photos. This creates a timestamped record.",
  },
];

// ── SUB-COMPONENTS ──────────────────────────────────────────────

const ComplianceItem = ({ label, date }) => {
  const status = complianceStatus(date);
  const days = daysUntil(date);
  return (
    <div className={`fm-compliance-item fm-compliance-${status}`}>
      <div className="fm-compliance-label">{label}</div>
      <div className="fm-compliance-date">{formatDate(date)}</div>
      <div className="fm-compliance-days">
        {days === null ? "Not set" :
         days < 0    ? `Expired ${Math.abs(days)}d ago` :
         days === 0  ? "Expires today" :
         `${days} days`}
      </div>
    </div>
  );
};

const TrafficLight = ({ vehicle }) => {
  const statuses = [
    complianceStatus(vehicle.mot_expiry),
    complianceStatus(vehicle.tax_expiry),
    complianceStatus(vehicle.insurance_expiry),
  ];
  const overall = statuses.includes("red") ? "red" : statuses.includes("amber") ? "amber" : "green";
  return (
    <div className="fm-traffic">
      <div className="fm-traffic-dot" style={{
        background: overall === "red" ? "#EF4444" : overall === "amber" ? "#EAB308" : "#22C55E",
        boxShadow: `0 0 6px ${overall === "red" ? "#EF444480" : overall === "amber" ? "#EAB30880" : "#22C55E80"}`
      }} />
      <span style={{ fontSize: 12, color: overall === "red" ? "#991B1B" : overall === "amber" ? "#92400E" : "#166534", fontWeight: 600 }}>
        {overall === "red" ? "Action required" : overall === "amber" ? "Due soon" : "All clear"}
      </span>
    </div>
  );
};

// ── DVLA LOOKUP (mocked — in production call via Edge Function) ──
const lookupDVLA = async (registration) => {
  // In production:
  // const { data } = await supabase.functions.invoke('dvla-lookup', { body: { registration } });
  // return data;
  
  // Mock response matching DVLA API structure
  await new Promise((r) => setTimeout(r, 1200));
  const reg = registration.replace(/\s/g, "").toUpperCase();
  
  // Return mock data — in production this comes from DVLA
  return {
    registration: reg,
    make: "FORD",
    model: "TRANSIT CUSTOM",
    primaryColour: "WHITE",
    fuelType: "DIESEL",
    engineCapacity: "1995",
    yearOfManufacture: 2021,
    motExpiryDate: "2026-08-14",
    taxDueDate: "2026-07-01",
    taxStatus: "Taxed",
  };
};

// ── MAIN COMPONENT ──────────────────────────────────────────────
// ── Live-schema <-> UI adapters ──────────────────────────────────
const penceToPounds = (p) => (p ?? 0) / 100;
const poundsToPence = (v) => Math.round((parseFloat(v) || 0) * 100);
function mapVehicle(row) {
  return {
    id: row.id, registration: row.registration, make: row.make, model: row.model,
    year: row.year, colour: row.colour, fuel_type: row.fuel_type,
    mot_expiry: row.mot_expiry, tax_expiry: row.tax_expiry,
    insurance_expiry: row.insurance_expiry, insurance_provider: row.insurer || "",
    last_service_date: null, next_service_date: row.service_due_date,
    current_mileage: row.current_mileage || 0, status: row.status,
    assigned_user_name: null, purchase_price: 0,
  };
}
function mapFault(row, regById) {
  return {
    id: row.id, vehicle_id: row.vehicle_id, vehicle_reg: regById[row.vehicle_id] || "",
    description: row.description, severity: "medium",
    status: row.status === "reported" ? "open" : row.status,
    reporter_name: "", created_at: row.created_at, resolved_at: row.resolved_at,
  };
}
function mapMileage(row, regById) {
  return {
    id: row.id, vehicle_id: row.vehicle_id, vehicle_reg: regById[row.vehicle_id] || "",
    driver_name: "", trip_date: row.journey_date,
    start_location: row.from_location || "", end_location: row.to_location || "",
    miles: row.mileage, purpose: row.purpose || "", is_business: row.is_business,
  };
}
function mapFleetCost(row, regById) {
  return {
    id: row.id, vehicle_id: row.vehicle_id, vehicle_reg: regById[row.vehicle_id] || "",
    cost_date: row.cost_date, cost_type: row.cost_type === "tyres" ? "tyre" : row.cost_type,
    amount: penceToPounds(row.amount_pence), description: row.description || "",
  };
}

export default function FleetManager({
  supabase,
  accountId,
  userId,
  userName,
  userRole,
}) {
  const [activeTab, setActiveTab] = useState("dashboard");
  const [vehicles, setVehicles] = useState([]);
  const [faults, setFaults] = useState([]);
  const [mileage, setMileage] = useState([]);
  const [costs, setCosts] = useState([]);
  const [loading, setLoading] = useState(true);

  const [showAddVehicle, setShowAddVehicle] = useState(false);
  const [showFaultReport, setShowFaultReport] = useState(null);
  const [showIncident, setShowIncident] = useState(false);
  const [showAddMileage, setShowAddMileage] = useState(false);
  const [showAddCost, setShowAddCost] = useState(false);

  const [dvlaLoading, setDvlaLoading] = useState(false);
  const [dvlaResult, setDvlaResult] = useState(null);
  const [newReg, setNewReg] = useState("");
  const [alert, setAlert] = useState(null);

  const showAlert = (type, message) => {
    setAlert({ type, message });
    setTimeout(() => setAlert(null), 4000);
  };

  // ── Load real data (RLS scopes to this account) ──
  const loadData = useCallback(async () => {
    setLoading(true);
    const { data: vehData, error: vehErr } = await supabase
      .from("fleet_vehicles").select("*").order("registration");
    if (vehErr) { showAlert("error", `Could not load fleet: ${vehErr.message}`); setLoading(false); return; }
    const vehRows = vehData || [];
    const regById = Object.fromEntries(vehRows.map((v) => [v.id, v.registration]));
    setVehicles(vehRows.map(mapVehicle));
    const [faultRes, mileRes, costRes] = await Promise.all([
      supabase.from("fleet_fault_reports").select("*").order("created_at", { ascending: false }),
      supabase.from("fleet_mileage_log").select("*").order("journey_date", { ascending: false }),
      supabase.from("fleet_costs").select("*").order("cost_date", { ascending: false }),
    ]);
    if (!faultRes.error) setFaults((faultRes.data || []).map((f) => mapFault(f, regById)));
    if (!mileRes.error) setMileage((mileRes.data || []).map((m) => mapMileage(m, regById)));
    if (!costRes.error) setCosts((costRes.data || []).map((c) => mapFleetCost(c, regById)));
    setLoading(false);
  }, [supabase]);

  useEffect(() => { loadData(); }, [loadData]);

  // Stats
  const totalVehicles = vehicles.filter((v) => v.status === "active").length;
  const expiringSoon = vehicles.filter((v) => {
    const s = [
      complianceStatus(v.mot_expiry),
      complianceStatus(v.tax_expiry),
      complianceStatus(v.insurance_expiry),
    ];
    return s.includes("red") || s.includes("amber");
  }).length;
  const openFaults = faults.filter((f) => f.status === "open").length;
  const criticalFaults = faults.filter((f) => f.severity === "critical" && f.status === "open").length;
  const thisMonthCosts = costs
    .filter((c) => new Date(c.cost_date).getMonth() === today.getMonth())
    .reduce((s, c) => s + c.amount, 0);
  const businessMiles = mileage.filter((m) => m.is_business).reduce((s, m) => s + m.miles, 0);
  const hmrcValue = businessMiles <= 10000
    ? businessMiles * HMRC_RATE_FIRST
    : 10000 * HMRC_RATE_FIRST + (businessMiles - 10000) * HMRC_RATE_AFTER;

  const handleDVLALookup = async () => {
    if (!newReg.trim()) return;
    setDvlaLoading(true);
    setDvlaResult(null);
    try {
      const result = await lookupDVLA(newReg);
      setDvlaResult(result);
    } catch (e) {
      showAlert("warning", "DVLA lookup failed. Please check the registration and try again.");
    } finally {
      setDvlaLoading(false);
    }
  };

  const handleAddVehicleFromDVLA = async () => {
    if (!dvlaResult) return;
    const row = {
      account_id: accountId,
      registration: dvlaResult.registration,
      make: dvlaResult.make,
      model: dvlaResult.model,
      year: dvlaResult.yearOfManufacture ? parseInt(dvlaResult.yearOfManufacture) : null,
      colour: dvlaResult.primaryColour,
      fuel_type: dvlaResult.fuelType,
      mot_expiry: dvlaResult.motExpiryDate || null,
      tax_expiry: dvlaResult.taxDueDate || null,
      status: "active",
      current_mileage: 0,
    };
    const { data: inserted, error } = await supabase.from("fleet_vehicles").insert(row).select("*").single();
    if (error) { showAlert("error", `Could not add vehicle: ${error.message}`); return; }
    const newVehicle = mapVehicle(inserted);
    setVehicles((prev) => [...prev, newVehicle]);
    await logAction(supabase, {
      accountId, userId, userName, userRole,
      action: "created", entityType: "fleet_vehicle", entityId: inserted.id,
      entityName: `${newVehicle.registration} — ${newVehicle.make} ${newVehicle.model}`,
    });
    setDvlaResult(null);
    setNewReg("");
    setShowAddVehicle(false);
    showAlert("success", `${newVehicle.registration} added to your fleet.`);
  };

  const handleFaultSubmit = async (fault) => {
    const { data: inserted, error } = await supabase.from("fleet_fault_reports").insert({
      account_id: accountId, vehicle_id: fault.vehicle_id, description: fault.description,
      status: "reported", reported_by: userId,
    }).select("*").single();
    if (error) { showAlert("error", `Could not report fault: ${error.message}`); return; }
    const regById = Object.fromEntries(vehicles.map((v) => [v.id, v.registration]));
    setFaults((prev) => [mapFault(inserted, regById), ...prev]);
    await logAction(supabase, {
      accountId, userId, userName, userRole,
      action: "created", entityType: "fleet_fault", entityId: inserted.id,
      entityName: `Fault: ${fault.vehicle_reg} — ${fault.description.slice(0, 50)}`,
    });
    setShowFaultReport(null);
    showAlert("success", "Fault reported. Manager has been notified.");
  };

  const handleResolveFault = async (faultId) => {
    const { error } = await supabase.from("fleet_fault_reports")
      .update({ status: "resolved", resolved_at: new Date().toISOString(), resolved_by: userId })
      .eq("id", faultId);
    if (error) { showAlert("error", `Could not resolve fault: ${error.message}`); return; }
    setFaults((prev) =>
      prev.map((f) =>
        f.id === faultId ? { ...f, status: "resolved", resolved_at: new Date().toISOString() } : f
      )
    );
    await logAction(supabase, {
      accountId, userId, userName, userRole,
      action: "updated", entityType: "fleet_fault", entityId: faultId,
      entityName: "Fault resolved", newValue: { status: "resolved" },
    });
    showAlert("success", "Fault marked as resolved.");
  };

  // ── RENDER ───────────────────────────────────────────────────
  return (
    <>
      <style>{css}</style>
      <div className="fm-wrap">

        {/* Header */}
        <div className="fm-header">
          <div>
            <h1>Fleet & Vehicle Management</h1>
            <p>MOT · Tax · Insurance · Faults · Mileage · Costs</p>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="fm-btn fm-btn-ghost" onClick={() => setShowIncident(true)}>
              Van Incident?
            </button>
            <button className="fm-btn fm-btn-primary" onClick={() => setShowAddVehicle(true)}>
              + Add Vehicle
            </button>
          </div>
        </div>

        {alert && (
          <div className={`fm-alert fm-alert-${alert.type}`}>{alert.message}</div>
        )}

        {/* Tabs */}
        <div className="fm-tabs">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              className={`fm-tab ${activeTab === tab.id ? "active" : ""}`}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
              {tab.id === "faults" && openFaults > 0 && (
                <span className="badge">{openFaults}</span>
              )}
            </button>
          ))}
        </div>

        {/* ── DASHBOARD ─────────────────────────────────────── */}
        {activeTab === "dashboard" && (
          <div>
            <div className="fm-card-grid">
              <div className="fm-stat-card">
                <div className="fm-stat-label">Active Vehicles</div>
                <div className="fm-stat-value">{totalVehicles}</div>
                <div className="fm-stat-sub">In your fleet</div>
              </div>
              <div className="fm-stat-card">
                <div className="fm-stat-label">Expiring Soon</div>
                <div className="fm-stat-value" style={{ color: expiringSoon > 0 ? "#EF4444" : "#22C55E" }}>
                  {expiringSoon}
                </div>
                <div className="fm-stat-sub">MOT, tax or insurance</div>
              </div>
              <div className="fm-stat-card">
                <div className="fm-stat-label">Open Faults</div>
                <div className="fm-stat-value" style={{ color: criticalFaults > 0 ? "#EF4444" : openFaults > 0 ? "#EAB308" : "#22C55E" }}>
                  {openFaults}
                </div>
                <div className="fm-stat-sub">{criticalFaults > 0 ? `${criticalFaults} critical` : "No critical faults"}</div>
              </div>
              <div className="fm-stat-card">
                <div className="fm-stat-label">Costs This Month</div>
                <div className="fm-stat-value">{formatCurrency(thisMonthCosts)}</div>
                <div className="fm-stat-sub">Fuel, repairs, tyres</div>
              </div>
            </div>

            {/* Fleet overview */}
            <div className="fm-card">
              <div className="fm-section-heading">Fleet Status</div>
              {vehicles.map((v) => (
                <div key={v.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 0", borderBottom: "1px solid var(--rule)" }}>
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                      <span className="fm-reg-plate" style={{ fontSize: 14, padding: "2px 8px" }}>{v.registration}</span>
                      <span style={{ fontSize: 14, fontWeight: 600, color: "var(--steel)" }}>{v.make} {v.model}</span>
                    </div>
                    <div style={{ fontSize: 12, color: "var(--mist)", marginTop: 4 }}>
                      {v.assigned_user_name ? `Assigned to ${v.assigned_user_name}` : "Unassigned"} · {v.current_mileage?.toLocaleString()} miles
                    </div>
                  </div>
                  <TrafficLight vehicle={v} />
                </div>
              ))}
            </div>

            {/* HMRC mileage summary */}
            <div className="fm-card">
              <div className="fm-section-heading">HMRC Mileage Claim Summary</div>
              <div style={{ display: "flex", gap: 32, flexWrap: "wrap" }}>
                <div>
                  <div className="fm-stat-label">Business Miles (This Year)</div>
                  <div style={{ fontSize: 22, fontWeight: 800, color: "var(--steel)", fontFamily: "'Plus Jakarta Sans', sans-serif" }}>{businessMiles.toFixed(1)}</div>
                </div>
                <div>
                  <div className="fm-stat-label">HMRC Claim Value</div>
                  <div style={{ fontSize: 22, fontWeight: 800, color: "var(--ember)", fontFamily: "'Plus Jakarta Sans', sans-serif" }}>{formatCurrency(hmrcValue)}</div>
                </div>
                <div>
                  <div className="fm-stat-label">Rate Applied</div>
                  <div style={{ fontSize: 14, color: "var(--mid)", marginTop: 4 }}>
                    {businessMiles <= 10000 ? "45p/mile (all)" : "45p first 10,000 · 25p thereafter"}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── VEHICLES ──────────────────────────────────────── */}
        {activeTab === "vehicles" && (
          <div>
            {vehicles.map((vehicle) => (
              <div key={vehicle.id} className="fm-vehicle-card">
                <div className="fm-vehicle-header">
                  <div>
                    <div className="fm-reg-plate">{vehicle.registration}</div>
                    <div className="fm-vehicle-make">{vehicle.make} {vehicle.model} {vehicle.year}</div>
                    <div className="fm-vehicle-sub">
                      {vehicle.colour} · {vehicle.fuel_type} · {vehicle.current_mileage?.toLocaleString()} miles
                    </div>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8 }}>
                    <TrafficLight vehicle={vehicle} />
                    <span className="fm-pill fm-pill-active">Active</span>
                  </div>
                </div>

                {vehicle.assigned_user_name && (
                  <div style={{ fontSize: 13, color: "var(--mid)", marginBottom: 8 }}>
                    <strong style={{ color: "var(--steel)" }}>Assigned to:</strong> {vehicle.assigned_user_name}
                  </div>
                )}

                <div className="fm-compliance-grid">
                  <ComplianceItem label="MOT" date={vehicle.mot_expiry} />
                  <ComplianceItem label="Road Tax" date={vehicle.tax_expiry} />
                  <ComplianceItem label="Insurance" date={vehicle.insurance_expiry} />
                  <ComplianceItem label="Next Service" date={vehicle.next_service_date} />
                </div>

                <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
                  <button
                    className="fm-btn fm-btn-secondary fm-btn-sm"
                    onClick={() => {
                      setShowFaultReport(vehicle);
                    }}
                  >
                    Report Fault
                  </button>
                  <button
                    className="fm-btn fm-btn-ghost fm-btn-sm"
                    onClick={() => setActiveTab("mileage")}
                  >
                    Log Mileage
                  </button>
                  <button
                    className="fm-btn fm-btn-ghost fm-btn-sm"
                    onClick={() => setActiveTab("costs")}
                  >
                    Log Cost
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── FAULTS ────────────────────────────────────────── */}
        {activeTab === "faults" && (
          <div>
            {criticalFaults > 0 && (
              <div className="fm-alert fm-alert-warning">
                {criticalFaults} critical fault{criticalFaults > 1 ? "s" : ""} require immediate attention. Check the vehicle is safe to drive before use.
              </div>
            )}
            <div className="fm-card">
              <div className="fm-section-heading">Open Faults</div>
              {faults.filter((f) => f.status !== "resolved").length === 0 ? (
                <div className="fm-empty" style={{ padding: "32px 0" }}>
                  <p>No open faults. All vehicles clear.</p>
                </div>
              ) : (
                faults.filter((f) => f.status !== "resolved").map((fault) => (
                  <div key={fault.id} className="fm-fault-item">
                    <div style={{ display: "flex", gap: 10 }}>
                      <div
                        className="fm-fault-severity"
                        style={{
                          background:
                            fault.severity === "critical" ? "#EF4444" :
                            fault.severity === "high" ? "#F97316" :
                            fault.severity === "medium" ? "#EAB308" : "#22C55E",
                        }}
                      />
                      <div>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                          <span className="fm-reg-plate" style={{ fontSize: 12, padding: "2px 6px" }}>{fault.vehicle_reg}</span>
                          {fault.severity === "critical" && (
                            <span className="fm-pill fm-pill-critical">Critical</span>
                          )}
                        </div>
                        <div style={{ fontSize: 14, color: "var(--steel)", fontWeight: 500, marginTop: 4 }}>
                          {fault.description}
                        </div>
                        <div style={{ fontSize: 12, color: "var(--mist)", marginTop: 2 }}>
                          Reported by {fault.reporter_name} · {formatDate(fault.created_at)}
                        </div>
                      </div>
                    </div>
                    {(userRole === "owner" || userRole === "manager") && (
                      <button
                        className="fm-btn fm-btn-success fm-btn-sm"
                        onClick={() => handleResolveFault(fault.id)}
                      >
                        Resolve
                      </button>
                    )}
                  </div>
                ))
              )}
            </div>

            {faults.filter((f) => f.status === "resolved").length > 0 && (
              <div className="fm-card">
                <div className="fm-section-heading">Resolved</div>
                {faults.filter((f) => f.status === "resolved").map((fault) => (
                  <div key={fault.id} className="fm-fault-item">
                    <div style={{ display: "flex", gap: 10 }}>
                      <div className="fm-fault-severity" style={{ background: "#22C55E" }} />
                      <div>
                        <span className="fm-reg-plate" style={{ fontSize: 12, padding: "2px 6px" }}>{fault.vehicle_reg}</span>
                        <div style={{ fontSize: 13, color: "var(--mid)", marginTop: 4 }}>{fault.description}</div>
                      </div>
                    </div>
                    <span className="fm-pill fm-pill-resolved">Resolved</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── MILEAGE ───────────────────────────────────────── */}
        {activeTab === "mileage" && (
          <div>
            <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 16 }}>
              <button className="fm-btn fm-btn-primary" onClick={() => setShowAddMileage(true)}>
                + Log Trip
              </button>
            </div>
            <div className="fm-card">
              <div className="fm-section-heading">Mileage Log</div>
              <div className="fm-mileage-row fm-mileage-header">
                <span>Date</span>
                <span>Driver / Vehicle</span>
                <span>Route</span>
                <span>Purpose</span>
                <span style={{ textAlign: "right" }}>Miles</span>
              </div>
              {mileage.map((entry) => (
                <div key={entry.id} className="fm-mileage-row">
                  <span style={{ color: "var(--mist)" }}>{formatDate(entry.trip_date)}</span>
                  <div>
                    <div style={{ fontWeight: 500, color: "var(--steel)", fontSize: 13 }}>{entry.driver_name}</div>
                    <span className="fm-reg-plate" style={{ fontSize: 11, padding: "1px 5px" }}>{entry.vehicle_reg}</span>
                  </div>
                  <div style={{ fontSize: 12, color: "var(--mid)" }}>
                    {entry.start_location} → {entry.end_location}
                  </div>
                  <span style={{ fontSize: 12, color: "var(--mist)" }}>{entry.purpose}</span>
                  <span style={{ textAlign: "right", fontWeight: 600, color: "var(--steel)" }}>{entry.miles}</span>
                </div>
              ))}
            </div>
            <div className="fm-card">
              <div className="fm-section-heading">HMRC Summary</div>
              <div style={{ display: "flex", gap: 32, flexWrap: "wrap" }}>
                <div>
                  <div className="fm-stat-label">Total Business Miles</div>
                  <div style={{ fontSize: 24, fontWeight: 800, color: "var(--steel)", fontFamily: "'Plus Jakarta Sans', sans-serif" }}>{businessMiles.toFixed(1)}</div>
                </div>
                <div>
                  <div className="fm-stat-label">Claimable Amount</div>
                  <div style={{ fontSize: 24, fontWeight: 800, color: "var(--ember)", fontFamily: "'Plus Jakarta Sans', sans-serif" }}>{formatCurrency(hmrcValue)}</div>
                </div>
              </div>
              <button className="fm-btn fm-btn-secondary fm-btn-sm" style={{ marginTop: 12 }}>
                Export CSV for Accountant
              </button>
            </div>
          </div>
        )}

        {/* ── COSTS ─────────────────────────────────────────── */}
        {activeTab === "costs" && (
          <div>
            <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 16 }}>
              <button className="fm-btn fm-btn-primary" onClick={() => setShowAddCost(true)}>
                + Log Cost
              </button>
            </div>
            <div className="fm-card">
              <div className="fm-section-heading">Cost Log</div>
              {costs.map((cost) => (
                <div key={cost.id} className="fm-cost-row">
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <span className="fm-reg-plate" style={{ fontSize: 11, padding: "1px 5px" }}>{cost.vehicle_reg}</span>
                      <span style={{ fontSize: 13, fontWeight: 500, color: "var(--steel)", textTransform: "capitalize" }}>{cost.cost_type}</span>
                    </div>
                    <div style={{ fontSize: 12, color: "var(--mist)", marginTop: 2 }}>
                      {cost.description} · {formatDate(cost.cost_date)}
                    </div>
                  </div>
                  <span style={{ fontWeight: 700, color: "var(--steel)", fontSize: 15 }}>
                    {formatCurrency(cost.amount)}
                  </span>
                </div>
              ))}
              <div style={{ borderTop: "2px solid var(--rule)", paddingTop: 12, marginTop: 4, display: "flex", justifyContent: "space-between" }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: "var(--steel)" }}>Total this month</span>
                <span style={{ fontSize: 16, fontWeight: 800, color: "var(--ember)", fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
                  {formatCurrency(thisMonthCosts)}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* ── ADD VEHICLE MODAL ─────────────────────────────── */}
        {showAddVehicle && (
          <div className="fm-modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) setShowAddVehicle(false); }}>
            <div className="fm-modal">
              <div className="fm-modal-header">
                <span className="fm-modal-title">Add Vehicle — DVLA Lookup</span>
                <button className="fm-btn fm-btn-ghost fm-btn-sm" onClick={() => { setShowAddVehicle(false); setDvlaResult(null); setNewReg(""); }}>Close</button>
              </div>
              <p style={{ fontSize: 13, color: "var(--mist)", marginBottom: 16 }}>
                Enter the registration plate and we'll pull the vehicle details from the DVLA automatically.
              </p>
              <div className="fm-dvla-row">
                <input
                  className="fm-reg-input"
                  placeholder="AB12 CDE"
                  value={newReg}
                  onChange={(e) => setNewReg(e.target.value.toUpperCase())}
                  onKeyDown={(e) => e.key === "Enter" && handleDVLALookup()}
                />
                <button
                  className="fm-btn fm-btn-primary"
                  onClick={handleDVLALookup}
                  disabled={dvlaLoading || !newReg.trim()}
                >
                  {dvlaLoading ? <><span className="fm-spinner" /> Looking up...</> : "Lookup"}
                </button>
              </div>

              {dvlaResult && (
                <div>
                  <div className="fm-alert fm-alert-success">DVLA data retrieved successfully.</div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
                    {[
                      ["Registration", dvlaResult.registration],
                      ["Make", dvlaResult.make],
                      ["Model", dvlaResult.model],
                      ["Year", dvlaResult.yearOfManufacture],
                      ["Colour", dvlaResult.primaryColour],
                      ["Fuel", dvlaResult.fuelType],
                      ["MOT Expiry", formatDate(dvlaResult.motExpiryDate)],
                      ["Tax Due", formatDate(dvlaResult.taxDueDate)],
                    ].map(([label, value]) => (
                      <div key={label}>
                        <div style={{ fontSize: 11, color: "var(--mist)", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 2 }}>{label}</div>
                        <div style={{ fontSize: 14, fontWeight: 600, color: "var(--steel)" }}>{value}</div>
                      </div>
                    ))}
                  </div>
                  <div className="fm-input-group">
                    <label className="fm-input-label">Insurance expiry date (add manually)</label>
                    <input type="date" className="fm-input" />
                  </div>
                  <div className="fm-input-group">
                    <label className="fm-input-label">Current mileage</label>
                    <input type="number" className="fm-input" placeholder="e.g. 45000" />
                  </div>
                  <button className="fm-btn fm-btn-primary" style={{ width: "100%" }} onClick={handleAddVehicleFromDVLA}>
                    Add to Fleet
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── FAULT REPORT MODAL ────────────────────────────── */}
        {showFaultReport && (
          <FaultReportModal
            vehicle={showFaultReport}
            onSubmit={handleFaultSubmit}
            onClose={() => setShowFaultReport(null)}
          />
        )}

        {/* ── INCIDENT WALKTHROUGH MODAL ────────────────────── */}
        {showIncident && (
          <div className="fm-modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) setShowIncident(false); }}>
            <div className="fm-modal">
              <div className="fm-modal-header">
                <span className="fm-modal-title">Vehicle Incident — What to Do Now</span>
                <button className="fm-btn fm-btn-ghost fm-btn-sm" onClick={() => setShowIncident(false)}>Close</button>
              </div>
              <div className="fm-alert fm-alert-warning" style={{ marginBottom: 16 }}>
                Stay calm. Work through these steps in order.
              </div>
              {INCIDENT_STEPS.map((step, i) => (
                <div key={i} className="fm-incident-step">
                  <h4>{step.step}</h4>
                  {step.content && <p>{step.content}</p>}
                  {step.checklist && (
                    <ul>
                      {step.checklist.map((item, j) => (
                        <li key={j}>{item}</li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
              <div style={{ marginTop: 16 }}>
                <button
                  className="fm-btn fm-btn-primary"
                  style={{ width: "100%" }}
                  onClick={() => {
                    setShowIncident(false);
                    setShowFaultReport(vehicles[0]);
                  }}
                >
                  Log Incident as a Fault Report
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── ADD MILEAGE MODAL ─────────────────────────────── */}
        {showAddMileage && (
          <AddMileageModal
            vehicles={vehicles}
            userName={userName}
            onSubmit={async (entry) => {
              const { data: inserted, error } = await supabase.from("fleet_mileage_log").insert({
                account_id: accountId, vehicle_id: entry.vehicle_id, user_id: userId,
                journey_date: entry.trip_date, mileage: Math.round(parseFloat(entry.miles) || 0),
                purpose: entry.purpose || null, is_business: entry.is_business !== false,
                from_location: entry.start_location || null, to_location: entry.end_location || null,
              }).select("*").single();
              if (error) { showAlert("error", `Could not log trip: ${error.message}`); return; }
              const regById = Object.fromEntries(vehicles.map((v) => [v.id, v.registration]));
              setMileage((prev) => [mapMileage(inserted, regById), ...prev]);
              setShowAddMileage(false);
              await logAction(supabase, { accountId, userId, userName, userRole, action: "created", entityType: "fleet_mileage", entityId: inserted.id, entityName: `Trip — ${entry.vehicle_reg}` });
              showAlert("success", "Trip logged.");
            }}
            onClose={() => setShowAddMileage(false)}
          />
        )}

        {/* ── ADD COST MODAL ────────────────────────────────── */}
        {showAddCost && (
          <AddCostModal
            vehicles={vehicles}
            onSubmit={async (cost) => {
              const { data: inserted, error } = await supabase.from("fleet_costs").insert({
                account_id: accountId, vehicle_id: cost.vehicle_id,
                cost_type: cost.cost_type === "tyre" ? "tyres" : cost.cost_type,
                amount_pence: poundsToPence(cost.amount),
                description: cost.description || null,
                cost_date: cost.cost_date || new Date().toISOString().split("T")[0],
                logged_by: userId,
              }).select("*").single();
              if (error) { showAlert("error", `Could not log cost: ${error.message}`); return; }
              const regById = Object.fromEntries(vehicles.map((v) => [v.id, v.registration]));
              setCosts((prev) => [mapFleetCost(inserted, regById), ...prev]);
              setShowAddCost(false);
              await logAction(supabase, { accountId, userId, userName, userRole, action: "created", entityType: "fleet_cost", entityId: inserted.id, entityName: `${cost.cost_type} — ${cost.vehicle_reg}` });
              showAlert("success", "Cost logged.");
            }}
            onClose={() => setShowAddCost(false)}
          />
        )}
      </div>
    </>
  );
}

// ── FAULT REPORT MODAL ──────────────────────────────────────────
function FaultReportModal({ vehicle, onSubmit, onClose }) {
  const [form, setForm] = useState({
    vehicle_id: vehicle.id,
    vehicle_reg: vehicle.registration,
    description: "",
    severity: "medium",
  });

  return (
    <div className="fm-modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="fm-modal">
        <div className="fm-modal-header">
          <span className="fm-modal-title">Report Fault — {vehicle.registration}</span>
          <button className="fm-btn fm-btn-ghost fm-btn-sm" onClick={onClose}>Close</button>
        </div>
        <div className="fm-input-group">
          <label className="fm-input-label">Describe the fault</label>
          <textarea
            className="fm-input"
            style={{ minHeight: 100, resize: "vertical" }}
            placeholder="What's wrong? Be as specific as possible..."
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
          />
        </div>
        <div className="fm-input-group">
          <label className="fm-input-label">Severity</label>
          <select
            className="fm-input"
            value={form.severity}
            onChange={(e) => setForm((f) => ({ ...f, severity: e.target.value }))}
          >
            <option value="low">Low — monitor, not urgent</option>
            <option value="medium">Medium — fix soon</option>
            <option value="high">High — fix this week</option>
            <option value="critical">Critical — vehicle may not be safe to drive</option>
          </select>
        </div>
        {form.severity === "critical" && (
          <div className="fm-alert fm-alert-warning">
            Critical fault reported. The vehicle should not be used until this is resolved. Manager will be notified immediately.
          </div>
        )}
        <button
          className="fm-btn fm-btn-primary"
          style={{ width: "100%" }}
          disabled={!form.description.trim()}
          onClick={() => onSubmit(form)}
        >
          Submit Fault Report
        </button>
      </div>
    </div>
  );
}

// ── ADD MILEAGE MODAL ───────────────────────────────────────────
function AddMileageModal({ vehicles, userName, onSubmit, onClose }) {
  const [form, setForm] = useState({
    vehicle_id: vehicles[0]?.id || "",
    vehicle_reg: vehicles[0]?.registration || "",
    driver_name: userName,
    trip_date: new Date().toISOString().split("T")[0],
    start_location: "",
    end_location: "",
    miles: "",
    purpose: "",
    is_business: true,
  });

  const handleVehicleChange = (e) => {
    const v = vehicles.find((v) => v.id === e.target.value);
    setForm((f) => ({ ...f, vehicle_id: e.target.value, vehicle_reg: v?.registration || "" }));
  };

  return (
    <div className="fm-modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="fm-modal">
        <div className="fm-modal-header">
          <span className="fm-modal-title">Log Trip</span>
          <button className="fm-btn fm-btn-ghost fm-btn-sm" onClick={onClose}>Close</button>
        </div>
        <div className="fm-form-grid">
          <div className="fm-input-group">
            <label className="fm-input-label">Vehicle</label>
            <select className="fm-input" value={form.vehicle_id} onChange={handleVehicleChange}>
              {vehicles.map((v) => (
                <option key={v.id} value={v.id}>{v.registration} — {v.make} {v.model}</option>
              ))}
            </select>
          </div>
          <div className="fm-input-group">
            <label className="fm-input-label">Date</label>
            <input type="date" className="fm-input" value={form.trip_date} onChange={(e) => setForm((f) => ({ ...f, trip_date: e.target.value }))} />
          </div>
          <div className="fm-input-group">
            <label className="fm-input-label">From</label>
            <input className="fm-input" placeholder="Start location" value={form.start_location} onChange={(e) => setForm((f) => ({ ...f, start_location: e.target.value }))} />
          </div>
          <div className="fm-input-group">
            <label className="fm-input-label">To</label>
            <input className="fm-input" placeholder="End location" value={form.end_location} onChange={(e) => setForm((f) => ({ ...f, end_location: e.target.value }))} />
          </div>
          <div className="fm-input-group">
            <label className="fm-input-label">Miles</label>
            <input type="number" className="fm-input" placeholder="0.0" value={form.miles} onChange={(e) => setForm((f) => ({ ...f, miles: parseFloat(e.target.value) }))} />
          </div>
          <div className="fm-input-group">
            <label className="fm-input-label">Purpose</label>
            <input className="fm-input" placeholder="e.g. Site visit" value={form.purpose} onChange={(e) => setForm((f) => ({ ...f, purpose: e.target.value }))} />
          </div>
        </div>
        <button
          className="fm-btn fm-btn-primary"
          style={{ width: "100%" }}
          disabled={!form.miles || !form.purpose}
          onClick={() => onSubmit(form)}
        >
          Log Trip
        </button>
      </div>
    </div>
  );
}

// ── ADD COST MODAL ──────────────────────────────────────────────
function AddCostModal({ vehicles, onSubmit, onClose }) {
  const [form, setForm] = useState({
    vehicle_id: vehicles[0]?.id || "",
    vehicle_reg: vehicles[0]?.registration || "",
    cost_date: new Date().toISOString().split("T")[0],
    cost_type: "fuel",
    amount: "",
    description: "",
    litres: "",
  });

  const handleVehicleChange = (e) => {
    const v = vehicles.find((v) => v.id === e.target.value);
    setForm((f) => ({ ...f, vehicle_id: e.target.value, vehicle_reg: v?.registration || "" }));
  };

  return (
    <div className="fm-modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="fm-modal">
        <div className="fm-modal-header">
          <span className="fm-modal-title">Log Cost</span>
          <button className="fm-btn fm-btn-ghost fm-btn-sm" onClick={onClose}>Close</button>
        </div>
        <div className="fm-form-grid">
          <div className="fm-input-group">
            <label className="fm-input-label">Vehicle</label>
            <select className="fm-input" value={form.vehicle_id} onChange={handleVehicleChange}>
              {vehicles.map((v) => (
                <option key={v.id} value={v.id}>{v.registration} — {v.make} {v.model}</option>
              ))}
            </select>
          </div>
          <div className="fm-input-group">
            <label className="fm-input-label">Date</label>
            <input type="date" className="fm-input" value={form.cost_date} onChange={(e) => setForm((f) => ({ ...f, cost_date: e.target.value }))} />
          </div>
          <div className="fm-input-group">
            <label className="fm-input-label">Cost Type</label>
            <select className="fm-input" value={form.cost_type} onChange={(e) => setForm((f) => ({ ...f, cost_type: e.target.value }))}>
              <option value="fuel">Fuel</option>
              <option value="repair">Repair</option>
              <option value="tyre">Tyre</option>
              <option value="mot">MOT</option>
              <option value="service">Service</option>
              <option value="insurance">Insurance</option>
              <option value="tax">Road Tax</option>
              <option value="other">Other</option>
            </select>
          </div>
          <div className="fm-input-group">
            <label className="fm-input-label">Amount (£)</label>
            <input type="number" className="fm-input" placeholder="0.00" value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: parseFloat(e.target.value) }))} />
          </div>
          {form.cost_type === "fuel" && (
            <div className="fm-input-group">
              <label className="fm-input-label">Litres</label>
              <input type="number" className="fm-input" placeholder="0.0" value={form.litres} onChange={(e) => setForm((f) => ({ ...f, litres: parseFloat(e.target.value) }))} />
            </div>
          )}
          <div className="fm-input-group" style={{ gridColumn: form.cost_type === "fuel" ? "1" : "1 / -1" }}>
            <label className="fm-input-label">Description</label>
            <input className="fm-input" placeholder="e.g. Shell Worthing — 60L diesel" value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
          </div>
        </div>
        <button
          className="fm-btn fm-btn-primary"
          style={{ width: "100%" }}
          disabled={!form.amount || !form.description}
          onClick={() => onSubmit(form)}
        >
          Log Cost
        </button>
      </div>
    </div>
  );
}
