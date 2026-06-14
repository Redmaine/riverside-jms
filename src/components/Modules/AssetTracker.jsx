/**
 * AssetTracker.jsx
 * Your Company AI — Equipment & Asset Tracking Module
 *
 * DEPENDENCIES (injected via props from core platform):
 *   supabase        — Supabase client instance
 *   accountId       — Current account UUID
 *   userId          — Current platform_user UUID
 *   userName        — Current user display name
 *   userRole        — 'owner' | 'manager' | 'staff'
 *
 * DATABASE TABLES USED:
 *   assets              — Asset register
 *   asset_checkouts     — Check in / check out log
 *   asset_maintenance   — Maintenance and PAT test history
 *   asset_categories    — Custom categories per account
 *   platform_users      — Employee names (read only)
 *   contacts            — Customer/job names (read only)
 *   audit_log           — Audit trail
 *
 * SCHEMA — add these tables to supabase_schema.sql:
 *
 * CREATE TABLE public.asset_categories (
 *   id            uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
 *   account_id    uuid REFERENCES public.accounts(id) ON DELETE CASCADE,
 *   name          text NOT NULL,
 *   icon          text DEFAULT 'tool',
 *   created_at    timestamptz DEFAULT now()
 * );
 *
 * CREATE TABLE public.assets (
 *   id                    uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
 *   account_id            uuid REFERENCES public.accounts(id) ON DELETE CASCADE,
 *   category_id           uuid REFERENCES public.asset_categories(id),
 *   name                  text NOT NULL,
 *   description           text,
 *   serial_number         text,
 *   model                 text,
 *   manufacturer          text,
 *   purchase_date         date,
 *   purchase_price        numeric(10,2),
 *   current_value         numeric(10,2),
 *   photo_url             text,
 *   qr_code               text UNIQUE,
 *   location              text DEFAULT 'workshop',
 *   status                text DEFAULT 'available' CHECK (status IN ('available','checked_out','in_repair','written_off','stolen')),
 *   pat_required          boolean DEFAULT true,
 *   pat_interval_months   int DEFAULT 12,
 *   last_pat_date         date,
 *   last_pat_result       text CHECK (last_pat_result IN ('pass','fail',null)),
 *   next_pat_date         date,
 *   checked_out_to_user   uuid REFERENCES public.platform_users(id),
 *   checked_out_to_name   text,
 *   checked_out_to_job    text,
 *   checked_out_at        timestamptz,
 *   expected_return       date,
 *   notes                 text,
 *   created_at            timestamptz DEFAULT now(),
 *   updated_at            timestamptz DEFAULT now()
 * );
 *
 * CREATE TABLE public.asset_checkouts (
 *   id                uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
 *   account_id        uuid REFERENCES public.accounts(id) ON DELETE CASCADE,
 *   asset_id          uuid REFERENCES public.assets(id) ON DELETE CASCADE,
 *   user_id           uuid REFERENCES public.platform_users(id),
 *   user_name         text NOT NULL,
 *   job_name          text,
 *   checked_out_at    timestamptz DEFAULT now(),
 *   expected_return   date,
 *   returned_at       timestamptz,
 *   condition_out     text DEFAULT 'good',
 *   condition_in      text,
 *   notes             text,
 *   created_at        timestamptz DEFAULT now()
 * );
 *
 * CREATE TABLE public.asset_maintenance (
 *   id                uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
 *   account_id        uuid REFERENCES public.accounts(id) ON DELETE CASCADE,
 *   asset_id          uuid REFERENCES public.assets(id) ON DELETE CASCADE,
 *   maintenance_type  text CHECK (maintenance_type IN ('pat_test','service','repair','inspection')),
 *   performed_date    date NOT NULL,
 *   performed_by      text,
 *   result            text,
 *   cost              numeric(10,2),
 *   notes             text,
 *   next_due_date     date,
 *   created_at        timestamptz DEFAULT now()
 * );
 *
 * Enable RLS on all tables with standard account_id policies.
 *
 * QR CODE GENERATION:
 *   Use the 'qrcode' npm package on the backend to generate QR codes.
 *   Each QR code encodes: https://app.yourcompanyai.co.uk/asset/{asset.qr_code}
 *   Scanning opens the asset record in the platform.
 *   Print labels as PDF — 6 per A4 sheet via Supabase Edge Function.
 */

import { useState, useMemo, useEffect, useCallback } from "react";

// ── CONSTANTS ───────────────────────────────────────────────────
const VIEWS = [
  { id: "asset",    label: "Asset View" },
  { id: "employee", label: "Employee View" },
  { id: "job",      label: "Job View" },
];

const TABS = [
  { id: "register",    label: "Asset Register" },
  { id: "checkout",    label: "Checked Out" },
  { id: "pat",         label: "PAT Testing" },
  { id: "maintenance", label: "Maintenance" },
  { id: "theft",       label: "Theft Report" },
];

const DEFAULT_CATEGORIES = [
  "Power Tools", "Hand Tools", "Test Equipment",
  "Ladders", "Generators", "Safety Equipment", "Other",
];

const ALERT_DAYS = { critical: 7, warning: 30 };

// ── STYLES ──────────────────────────────────────────────────────
const css = `
  @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=DM+Sans:wght@300;400;500&display=swap');

  .at-wrap * { box-sizing: border-box; margin: 0; padding: 0; }
  .at-wrap {
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

  .at-header {
    display: flex; align-items: center; justify-content: space-between; margin-bottom: 24px;
  }
  .at-header h1 { font-family: 'Plus Jakarta Sans', sans-serif; font-weight: 800; font-size: 22px; color: var(--steel); }
  .at-header p  { font-size: 13px; color: var(--mist); margin-top: 2px; }

  .at-tabs {
    display: flex; gap: 4px; background: var(--white);
    border: 1px solid var(--rule); border-radius: var(--radius);
    padding: 4px; margin-bottom: 24px; overflow-x: auto;
  }
  .at-tab {
    flex: 1; min-width: fit-content; padding: 8px 14px; border: none;
    background: none; border-radius: 6px; font-family: 'DM Sans', sans-serif;
    font-size: 13px; font-weight: 500; color: var(--light); cursor: pointer;
    white-space: nowrap; transition: all 0.15s;
  }
  .at-tab.active { background: var(--steel); color: var(--white); }
  .at-tab .badge {
    display: inline-flex; align-items: center; justify-content: center;
    width: 18px; height: 18px; background: var(--ember); color: white;
    border-radius: 50%; font-size: 10px; font-weight: 700; margin-left: 6px;
  }

  /* View switcher */
  .at-view-switcher {
    display: flex; gap: 4px; background: var(--white);
    border: 1px solid var(--rule); border-radius: 6px;
    padding: 3px; margin-bottom: 20px; width: fit-content;
  }
  .at-view-btn {
    padding: 6px 14px; border: none; background: none; border-radius: 4px;
    font-size: 12px; font-weight: 500; color: var(--light); cursor: pointer; transition: all 0.15s;
  }
  .at-view-btn.active { background: var(--steel); color: white; }

  /* Cards */
  .at-card { background: var(--white); border: 1px solid var(--rule); border-radius: var(--radius); padding: 20px; margin-bottom: 16px; }
  .at-card-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 16px; margin-bottom: 24px; }
  .at-stat-card { background: var(--white); border: 1px solid var(--rule); border-radius: var(--radius); padding: 18px 20px; }
  .at-stat-label { font-size: 11px; font-weight: 600; color: var(--mist); text-transform: uppercase; letter-spacing: 1px; margin-bottom: 8px; }
  .at-stat-value { font-family: 'Plus Jakarta Sans', sans-serif; font-weight: 800; font-size: 28px; color: var(--steel); line-height: 1; }
  .at-stat-sub   { font-size: 12px; color: var(--mist); margin-top: 4px; }

  .at-section-heading { font-family: 'Plus Jakarta Sans', sans-serif; font-weight: 700; font-size: 14px; color: var(--steel); margin-bottom: 12px; padding-bottom: 8px; border-bottom: 1px solid var(--rule); }

  /* Asset row */
  .at-asset-row {
    display: flex; align-items: center; justify-content: space-between;
    padding: 14px 0; border-bottom: 1px solid var(--rule); gap: 12px;
  }
  .at-asset-row:last-child { border-bottom: none; }
  .at-asset-name { font-size: 14px; font-weight: 600; color: var(--steel); }
  .at-asset-meta { font-size: 12px; color: var(--mist); margin-top: 2px; }

  /* Asset detail card */
  .at-asset-card {
    background: var(--white); border: 1px solid var(--rule); border-radius: var(--radius);
    padding: 18px 20px; margin-bottom: 12px; cursor: pointer; transition: border-color 0.15s;
  }
  .at-asset-card:hover { border-color: var(--mist); }
  .at-asset-card.expanded { border-color: var(--ember); }

  /* Status dot */
  .at-status-dot {
    width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0;
  }

  /* QR badge */
  .at-qr-badge {
    display: inline-flex; align-items: center; gap: 4px;
    padding: 3px 8px; background: var(--chalk); border: 1px solid var(--rule);
    border-radius: 4px; font-size: 11px; color: var(--mist); font-family: monospace;
  }

  /* PAT status */
  .at-pat-pass { color: #166534; background: #DCFCE7; }
  .at-pat-fail { color: #991B1B; background: #FEE2E2; }
  .at-pat-due  { color: #92400E; background: #FFFBEB; }
  .at-pat-ok   { color: #166534; background: #F0FDF4; }

  /* Employee / Job group */
  .at-group-header {
    display: flex; align-items: center; gap: 10px;
    padding: 12px 16px; background: var(--chalk);
    border: 1px solid var(--rule); border-radius: var(--radius);
    margin-bottom: 8px; cursor: pointer;
  }
  .at-group-header h3 { font-family: 'Plus Jakarta Sans', sans-serif; font-weight: 700; font-size: 14px; color: var(--steel); }
  .at-group-header p  { font-size: 12px; color: var(--mist); }
  .at-group-body { padding: 0 8px; margin-bottom: 16px; }

  /* Theft report */
  .at-theft-section { background: #FEF2F2; border: 2px solid #FECACA; border-radius: var(--radius); padding: 20px; margin-bottom: 16px; }
  .at-theft-title   { font-family: 'Plus Jakarta Sans', sans-serif; font-weight: 800; font-size: 16px; color: #991B1B; margin-bottom: 8px; }
  .at-theft-body    { font-size: 13px; color: #7F1D1D; line-height: 1.6; }

  /* Buttons */
  .at-btn { display: inline-flex; align-items: center; gap: 6px; padding: 8px 14px; border-radius: 6px; font-family: 'DM Sans', sans-serif; font-size: 13px; font-weight: 500; cursor: pointer; border: none; transition: all 0.15s; white-space: nowrap; }
  .at-btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .at-btn-primary   { background: var(--ember); color: white; }
  .at-btn-primary:hover:not(:disabled) { background: var(--ember-lt); }
  .at-btn-secondary { background: var(--chalk); color: var(--steel); border: 1px solid var(--rule); }
  .at-btn-secondary:hover:not(:disabled) { border-color: var(--mist); }
  .at-btn-ghost     { background: none; color: var(--mist); border: 1px solid var(--rule); }
  .at-btn-ghost:hover:not(:disabled) { color: var(--steel); border-color: var(--steel); }
  .at-btn-danger    { background: #FEE2E2; color: #991B1B; border: 1px solid #FECACA; }
  .at-btn-sm        { padding: 5px 10px; font-size: 12px; }

  /* Pill */
  .at-pill { display: inline-flex; align-items: center; padding: 3px 10px; border-radius: 20px; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; }
  .at-pill-available   { background: #DCFCE7; color: #166534; }
  .at-pill-out         { background: #FEF9C3; color: #854D0E; }
  .at-pill-repair      { background: #EFF6FF; color: #1E40AF; }
  .at-pill-stolen      { background: #FEE2E2; color: #991B1B; }
  .at-pill-written_off { background: #F3F4F6; color: #6B7280; }

  /* Modal */
  .at-modal-overlay { position: fixed; inset: 0; background: rgba(28,28,46,0.5); display: flex; align-items: center; justify-content: center; z-index: 100; padding: 20px; }
  .at-modal { background: var(--white); border-radius: var(--radius); padding: 24px; width: 100%; max-width: 520px; max-height: 90vh; overflow-y: auto; }
  .at-modal-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px; }
  .at-modal-title  { font-family: 'Plus Jakarta Sans', sans-serif; font-weight: 700; font-size: 16px; color: var(--steel); }

  /* Form */
  .at-input { width: 100%; padding: 9px 12px; border: 1px solid var(--rule); border-radius: 6px; font-family: 'DM Sans', sans-serif; font-size: 14px; color: var(--steel); outline: none; transition: border-color 0.15s; background: white; }
  .at-input:focus { border-color: var(--ember); }
  .at-input-label { font-size: 13px; font-weight: 500; color: var(--steel); margin-bottom: 6px; display: block; }
  .at-input-group { margin-bottom: 16px; }
  .at-form-grid   { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }

  /* Alert */
  .at-alert { padding: 12px 16px; border-radius: var(--radius); font-size: 13px; margin-bottom: 16px; }
  .at-alert-success { background: #DCFCE7; border: 1px solid #BBF7D0; color: #166534; }
  .at-alert-warning { background: #FFFBEB; border: 1px solid #FDE68A; color: #92400E; }
  .at-alert-info    { background: #EFF6FF; border: 1px solid #BFDBFE; color: #1E40AF; }
  .at-alert-danger  { background: #FEF2F2; border: 1px solid #FECACA; color: #991B1B; }

  /* Empty */
  .at-empty { text-align: center; padding: 48px 24px; color: var(--mist); }
  .at-empty h3 { font-size: 16px; color: var(--steel); margin-bottom: 6px; }

  /* Spinner */
  .at-spinner { width: 18px; height: 18px; border: 2px solid var(--rule); border-top-color: var(--ember); border-radius: 50%; animation: at-spin 0.6s linear infinite; display: inline-block; }
  @keyframes at-spin { to { transform: rotate(360deg); } }

  /* Search */
  .at-search { width: 100%; padding: 9px 12px 9px 36px; border: 1px solid var(--rule); border-radius: 6px; font-size: 14px; outline: none; transition: border-color 0.15s; background: white url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='%238C8CA8' stroke-width='2'%3E%3Ccircle cx='11' cy='11' r='8'/%3E%3Cpath d='m21 21-4.35-4.35'/%3E%3C/svg%3E") no-repeat 12px center; }
  .at-search:focus { border-color: var(--ember); }

  /* Filter row */
  .at-filter-row { display: flex; gap: 8px; margin-bottom: 16px; flex-wrap: wrap; }
  .at-filter-chip { padding: 5px 12px; border-radius: 20px; font-size: 12px; font-weight: 500; border: 1px solid var(--rule); background: var(--white); color: var(--light); cursor: pointer; transition: all 0.15s; }
  .at-filter-chip.active { background: var(--steel); color: white; border-color: var(--steel); }

  /* Checkout history */
  .at-history-row { padding: 10px 0; border-bottom: 1px solid var(--rule); font-size: 13px; }
  .at-history-row:last-child { border-bottom: none; }

  /* Theft report document preview */
  .at-doc-preview { border: 1px solid var(--rule); border-radius: var(--radius); padding: 20px; background: white; margin-top: 16px; }
  .at-doc-header  { font-family: 'Plus Jakarta Sans', sans-serif; font-weight: 800; font-size: 18px; color: var(--steel); border-bottom: 3px solid var(--ember); padding-bottom: 8px; margin-bottom: 16px; }
  .at-doc-row     { display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px solid #f0ede8; font-size: 13px; }
  .at-doc-label   { font-weight: 600; color: var(--steel); }
  .at-doc-value   { color: var(--mid); }
`;

// ── HELPERS ─────────────────────────────────────────────────────
const today = new Date();

const daysUntil = (d) => d ? Math.ceil((new Date(d) - today) / 86400000) : null;
const formatDate = (d) => d ? new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "Not set";
const formatCurrency = (n) => `£${(n || 0).toFixed(2)}`;

const patStatus = (asset) => {
  if (!asset.pat_required) return null;
  if (!asset.last_pat_date) return "never";
  const days = daysUntil(asset.next_pat_date);
  if (asset.last_pat_result === "fail") return "fail";
  if (days === null) return "never";
  if (days < 0) return "overdue";
  if (days <= ALERT_DAYS.critical) return "due_soon";
  if (days <= ALERT_DAYS.warning) return "due_soon";
  return "ok";
};

const statusColor = {
  available: "#22C55E",
  checked_out: "#EAB308",
  in_repair: "#3B82F6",
  stolen: "#EF4444",
  written_off: "#9CA3AF",
};

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
const MOCK_ASSETS = [
  { id: "a1", name: "Makita SDS Drill 36V", category: "Power Tools", serial_number: "MKT-2891-XZ", model: "DHR242Z", manufacturer: "Makita", purchase_date: "2023-04-10", purchase_price: 289, current_value: 180, qr_code: "YCA-A001", location: "van", status: "checked_out", pat_required: true, last_pat_date: "2025-12-01", last_pat_result: "pass", next_pat_date: "2026-06-01", pat_interval_months: 6, checked_out_to_name: "Dave Thompson", checked_out_to_job: "14 Maple Ave, Worthing", checked_out_at: "2026-06-02T08:00:00Z", expected_return: "2026-06-06" },
  { id: "a2", name: "DeWalt Angle Grinder 125mm", category: "Power Tools", serial_number: "DWT-5534-KL", model: "DCG412N", manufacturer: "DeWalt", purchase_date: "2022-09-15", purchase_price: 175, current_value: 90, qr_code: "YCA-A002", location: "van", status: "checked_out", pat_required: true, last_pat_date: "2026-01-15", last_pat_result: "pass", next_pat_date: "2026-07-15", pat_interval_months: 6, checked_out_to_name: "Dave Thompson", checked_out_to_job: "14 Maple Ave, Worthing", checked_out_at: "2026-06-02T08:00:00Z", expected_return: "2026-06-06" },
  { id: "a3", name: "Extension Ladder 7m", category: "Ladders", serial_number: "LAD-0044-PP", model: "Pro Series 7m", manufacturer: "Youngman", purchase_date: "2021-03-20", purchase_price: 320, current_value: 200, qr_code: "YCA-A003", location: "workshop", status: "available", pat_required: false, last_pat_date: null, last_pat_result: null, next_pat_date: null, checked_out_to_name: null, checked_out_to_job: null },
  { id: "a4", name: "Fluke 117 Multimeter", category: "Test Equipment", serial_number: "FLK-9921-TR", model: "117", manufacturer: "Fluke", purchase_date: "2024-01-08", purchase_price: 220, current_value: 190, qr_code: "YCA-A004", location: "van", status: "checked_out", pat_required: true, last_pat_date: "2025-06-10", last_pat_result: "pass", next_pat_date: "2026-06-10", pat_interval_months: 12, checked_out_to_name: "Steve Harris", checked_out_to_job: "Shoreham Industrial Estate", checked_out_at: "2026-06-03T09:00:00Z", expected_return: "2026-06-07" },
  { id: "a5", name: "Honda Generator EU22i", category: "Generators", serial_number: "HON-1122-GEN", model: "EU22i", manufacturer: "Honda", purchase_date: "2022-06-01", purchase_price: 1100, current_value: 750, qr_code: "YCA-A005", location: "workshop", status: "available", pat_required: true, last_pat_date: "2026-03-01", last_pat_result: "pass", next_pat_date: "2027-03-01", pat_interval_months: 12, checked_out_to_name: null },
  { id: "a6", name: "Bosch Laser Level GLL 3-80", category: "Test Equipment", serial_number: "BSH-7734-LL", model: "GLL 3-80", manufacturer: "Bosch", purchase_date: "2023-11-20", purchase_price: 340, current_value: 260, qr_code: "YCA-A006", location: "workshop", status: "in_repair", pat_required: true, last_pat_date: null, last_pat_result: null, next_pat_date: "2026-05-20", pat_interval_months: 12, checked_out_to_name: null, notes: "Sent to Bosch repair centre 30 May" },
  { id: "a7", name: "Hilti TE 30 Rotary Hammer", category: "Power Tools", serial_number: "HLT-4456-RH", model: "TE 30", manufacturer: "Hilti", purchase_date: "2020-07-14", purchase_price: 680, current_value: 280, qr_code: "YCA-A007", location: "workshop", status: "available", pat_required: true, last_pat_date: "2026-05-05", last_pat_result: "fail", next_pat_date: null, pat_interval_months: 6, checked_out_to_name: null, notes: "Failed PAT — do not use until repaired" },
];

const MOCK_CHECKOUTS = [
  { id: "co1", asset_id: "a1", asset_name: "Makita SDS Drill 36V", user_name: "Dave Thompson", job_name: "14 Maple Ave, Worthing", checked_out_at: "2026-06-02T08:00:00Z", expected_return: "2026-06-06", condition_out: "good", returned_at: null },
  { id: "co2", asset_id: "a2", asset_name: "DeWalt Angle Grinder", user_name: "Dave Thompson", job_name: "14 Maple Ave, Worthing", checked_out_at: "2026-06-02T08:00:00Z", expected_return: "2026-06-06", condition_out: "good", returned_at: null },
  { id: "co3", asset_id: "a4", asset_name: "Fluke 117 Multimeter", user_name: "Steve Harris", job_name: "Shoreham Industrial Estate", checked_out_at: "2026-06-03T09:00:00Z", expected_return: "2026-06-07", condition_out: "good", returned_at: null },
  { id: "co4", asset_id: "a3", asset_name: "Extension Ladder 7m", user_name: "Dave Thompson", job_name: "32 Church St, Lancing", checked_out_at: "2026-05-28T07:30:00Z", expected_return: "2026-05-30", condition_out: "good", returned_at: "2026-05-30T17:00:00Z", condition_in: "good" },
];

// ── Live-schema <-> UI adapters ──────────────────────────────────
const penceToPounds = (p) => (p ?? 0) / 100;
const poundsToPence = (v) => Math.round((parseFloat(v) || 0) * 100);
const userFullName = (u) => (u ? `${u.first_name || ""} ${u.last_name || ""}`.trim() : null);

function mapAsset(row) {
  const openCo = (row.checkouts || []).find((c) => !c.checked_in_at);
  const pats = (row.pat || []).slice().sort((a, b) => new Date(b.test_date) - new Date(a.test_date));
  const lastPat = pats[0];
  return {
    id: row.id,
    name: row.name,
    category: row.category?.name || "Uncategorised",
    serial_number: row.serial_number || "",
    model: "",
    manufacturer: "",
    purchase_date: row.purchase_date,
    purchase_price: penceToPounds(row.purchase_price_pence),
    current_value: penceToPounds(row.purchase_price_pence),
    qr_code: row.qr_code,
    location: row.current_location,
    status: row.status === "in_use" ? "checked_out" : row.status,
    pat_required: row.category?.pat_required || false,
    last_pat_date: lastPat?.test_date || null,
    last_pat_result: lastPat?.result || null,
    next_pat_date: lastPat?.next_test_date || null,
    pat_interval_months: row.category?.pat_interval_months || 12,
    checked_out_to_name: openCo ? userFullName(openCo.user) : null,
    checked_out_to_job: null,
    checked_out_at: openCo?.checked_out_at || null,
    expected_return: openCo?.expected_return || null,
    notes: row.notes || "",
  };
}
function mapCheckout(row) {
  return {
    id: row.id,
    asset_id: row.asset_id,
    asset_name: row.asset?.name || "",
    user_name: userFullName(row.user) || "",
    job_name: "",
    checked_out_at: row.checked_out_at,
    expected_return: row.expected_return,
    condition_out: row.condition_out || "good",
    returned_at: row.checked_in_at,
    condition_in: row.condition_in,
  };
}

// ── MAIN COMPONENT ──────────────────────────────────────────────
export default function AssetTracker({
  supabase,
  accountId,
  userId,
  userName,
  userRole,
}) {
  const [activeTab, setActiveTab] = useState("register");
  const [activeView, setActiveView] = useState("asset");
  const [assets, setAssets] = useState([]);
  const [checkouts, setCheckouts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterCategory, setFilterCategory] = useState("All");
  const [filterStatus, setFilterStatus] = useState("All");
  const [expandedId, setExpandedId] = useState(null);
  const [showAddAsset, setShowAddAsset] = useState(false);
  const [showCheckout, setShowCheckout] = useState(null);
  const [showCheckin, setShowCheckin] = useState(null);
  const [showTheft, setShowTheft] = useState(false);
  const [selectedForTheft, setSelectedForTheft] = useState([]);
  const [alert, setAlert] = useState(null);

  const showAlertMsg = (type, msg) => {
    setAlert({ type, message: msg });
    setTimeout(() => setAlert(null), 4000);
  };

  // ── Load real data (RLS scopes to this account) ──
  const loadData = useCallback(async () => {
    setLoading(true);
    const [assetRes, coRes] = await Promise.all([
      supabase.from("asset_items").select(
        "*, category:asset_categories(name, pat_required, pat_interval_months), checkouts:asset_checkouts(*, user:platform_users(first_name,last_name)), pat:asset_pat_tests(*)"
      ).order("name"),
      supabase.from("asset_checkouts").select("*, asset:asset_items(name), user:platform_users(first_name,last_name)").order("checked_out_at", { ascending: false }),
    ]);
    if (assetRes.error) showAlertMsg("error", `Could not load assets: ${assetRes.error.message}`);
    else setAssets((assetRes.data || []).map(mapAsset));
    if (!coRes.error) setCheckouts((coRes.data || []).map(mapCheckout));
    setLoading(false);
  }, [supabase]);

  useEffect(() => { loadData(); }, [loadData]);

  // Stats
  const totalAssets = assets.length;
  const checkedOut = assets.filter((a) => a.status === "checked_out").length;
  const patDue = assets.filter((a) => {
    const s = patStatus(a);
    return s === "overdue" || s === "due_soon" || s === "fail" || s === "never";
  }).length;
  const totalValue = assets.filter((a) => a.status !== "stolen" && a.status !== "written_off")
    .reduce((s, a) => s + (a.current_value || 0), 0);

  // Filtered assets
  const categories = ["All", ...new Set(assets.map((a) => a.category))];
  const filteredAssets = useMemo(() => {
    return assets.filter((a) => {
      const matchSearch = !search || a.name.toLowerCase().includes(search.toLowerCase()) || a.serial_number?.toLowerCase().includes(search.toLowerCase());
      const matchCat = filterCategory === "All" || a.category === filterCategory;
      const matchStatus = filterStatus === "All" || a.status === filterStatus;
      return matchSearch && matchCat && matchStatus;
    });
  }, [assets, search, filterCategory, filterStatus]);

  // Employee view grouping
  const employeeGroups = useMemo(() => {
    const groups = {};
    assets.filter((a) => a.status === "checked_out").forEach((a) => {
      const name = a.checked_out_to_name || "Unassigned";
      if (!groups[name]) groups[name] = [];
      groups[name].push(a);
    });
    return groups;
  }, [assets]);

  // Job view grouping
  const jobGroups = useMemo(() => {
    const groups = {};
    assets.filter((a) => a.status === "checked_out").forEach((a) => {
      const job = a.checked_out_to_job || "No job assigned";
      if (!groups[job]) groups[job] = [];
      groups[job].push(a);
    });
    return groups;
  }, [assets]);

  // Check out asset
  const handleCheckout = async (assetId, data) => {
    const checked_out_at = new Date().toISOString();
    // Persist the checkout. The typed employee name has no FK in the schema, so
    // user_id is the current actor; the name is kept in the UI for this session.
    const { data: co, error: coErr } = await supabase.from("asset_checkouts").insert({
      account_id: accountId, asset_id: assetId, user_id: userId,
      checked_out_at, expected_return: data.expected_return || null, condition_out: data.condition || null,
    }).select("*").single();
    if (coErr) { showAlertMsg("error", `Could not check out: ${coErr.message}`); return; }
    const { error: aErr } = await supabase.from("asset_items")
      .update({ status: "in_use", current_location: "van" }).eq("id", assetId);
    if (aErr) { showAlertMsg("error", `Could not update asset: ${aErr.message}`); return; }

    setAssets((prev) => prev.map((a) =>
      a.id === assetId ? {
        ...a, status: "checked_out",
        checked_out_to_name: data.employee,
        checked_out_to_job: data.job,
        checked_out_at,
        expected_return: data.expected_return,
      } : a
    ));
    setCheckouts((prev) => [{
      id: co.id,
      asset_id: assetId,
      asset_name: assets.find((a) => a.id === assetId)?.name,
      user_name: data.employee,
      job_name: data.job,
      checked_out_at,
      expected_return: data.expected_return,
      condition_out: data.condition,
      returned_at: null,
    }, ...prev]);

    await logAction(supabase, {
      accountId, userId, userName, userRole,
      action: "checked_out",
      entityType: "asset",
      entityId: assetId,
      entityName: `${assets.find((a) => a.id === assetId)?.name} → ${data.employee} (${data.job})`,
      newValue: data,
    });

    setShowCheckout(null);
    showAlertMsg("success", `Asset checked out to ${data.employee}.`);
  };

  // Check in asset
  const handleCheckin = async (assetId, condition) => {
    const checked_in_at = new Date().toISOString();
    // Close the open checkout row for this asset.
    const { data: openCo } = await supabase.from("asset_checkouts")
      .select("id").eq("asset_id", assetId).is("checked_in_at", null)
      .order("checked_out_at", { ascending: false }).limit(1).maybeSingle();
    if (openCo) {
      await supabase.from("asset_checkouts")
        .update({ checked_in_at, condition_in: condition, damage_noted: condition === "damaged" })
        .eq("id", openCo.id);
    }
    const { error } = await supabase.from("asset_items")
      .update({ status: "available", current_location: "workshop" }).eq("id", assetId);
    if (error) { showAlertMsg("error", `Could not check in: ${error.message}`); return; }

    setAssets((prev) => prev.map((a) =>
      a.id === assetId ? {
        ...a, status: "available",
        checked_out_to_name: null,
        checked_out_to_job: null,
        checked_out_at: null,
        expected_return: null,
        location: "workshop",
      } : a
    ));
    setCheckouts((prev) => prev.map((co) =>
      co.asset_id === assetId && !co.returned_at
        ? { ...co, returned_at: checked_in_at, condition_in: condition }
        : co
    ));

    await logAction(supabase, {
      accountId, userId, userName, userRole,
      action: "checked_in",
      entityType: "asset",
      entityId: assetId,
      entityName: `${assets.find((a) => a.id === assetId)?.name} — returned, condition: ${condition}`,
      newValue: { condition_in: condition },
    });

    setShowCheckin(null);
    showAlertMsg("success", "Asset checked back in.");
  };

  // Generate theft report
  const generateTheftReport = () => {
    const stolen = assets.filter((a) => selectedForTheft.includes(a.id));
    const totalStolenValue = stolen.reduce((s, a) => s + (a.purchase_price || 0), 0);
    return { stolen, totalStolenValue };
  };

  // ── RENDER ───────────────────────────────────────────────────
  return (
    <>
      <style>{css}</style>
      <div className="at-wrap">

        {/* Header */}
        <div className="at-header">
          <div>
            <h1>Equipment & Asset Tracking</h1>
            <p>Register · Check in/out · PAT testing · Theft report</p>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="at-btn at-btn-danger at-btn-sm" onClick={() => setShowTheft(true)}>
              Report Theft
            </button>
            <button className="at-btn at-btn-primary" onClick={() => setShowAddAsset(true)}>
              + Add Asset
            </button>
          </div>
        </div>

        {alert && (
          <div className={`at-alert at-alert-${alert.type}`}>{alert.message}</div>
        )}

        {/* Tabs */}
        <div className="at-tabs">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              className={`at-tab ${activeTab === tab.id ? "active" : ""}`}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
              {tab.id === "pat" && patDue > 0 && <span className="badge">{patDue}</span>}
              {tab.id === "checkout" && checkedOut > 0 && <span className="badge">{checkedOut}</span>}
            </button>
          ))}
        </div>

        {/* ── ASSET REGISTER ────────────────────────────────── */}
        {activeTab === "register" && (
          <div>
            {/* Stats */}
            <div className="at-card-grid">
              <div className="at-stat-card">
                <div className="at-stat-label">Total Assets</div>
                <div className="at-stat-value">{totalAssets}</div>
                <div className="at-stat-sub">In register</div>
              </div>
              <div className="at-stat-card">
                <div className="at-stat-label">Checked Out</div>
                <div className="at-stat-value" style={{ color: checkedOut > 0 ? "#EAB308" : "#22C55E" }}>{checkedOut}</div>
                <div className="at-stat-sub">Currently on site</div>
              </div>
              <div className="at-stat-card">
                <div className="at-stat-label">PAT Due/Overdue</div>
                <div className="at-stat-value" style={{ color: patDue > 0 ? "#EF4444" : "#22C55E" }}>{patDue}</div>
                <div className="at-stat-sub">Need attention</div>
              </div>
              <div className="at-stat-card">
                <div className="at-stat-label">Fleet Value</div>
                <div className="at-stat-value" style={{ fontSize: 22 }}>{formatCurrency(totalValue)}</div>
                <div className="at-stat-sub">Current est. value</div>
              </div>
            </div>

            {/* View switcher */}
            <div className="at-view-switcher">
              {VIEWS.map((v) => (
                <button
                  key={v.id}
                  className={`at-view-btn ${activeView === v.id ? "active" : ""}`}
                  onClick={() => setActiveView(v.id)}
                >
                  {v.label}
                </button>
              ))}
            </div>

            {/* ASSET VIEW */}
            {activeView === "asset" && (
              <div>
                <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
                  <div style={{ flex: 1, minWidth: 200, position: "relative" }}>
                    <input
                      className="at-search"
                      placeholder="Search by name or serial number..."
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                  </div>
                </div>
                <div className="at-filter-row">
                  {categories.map((c) => (
                    <button key={c} className={`at-filter-chip ${filterCategory === c ? "active" : ""}`} onClick={() => setFilterCategory(c)}>{c}</button>
                  ))}
                </div>
                <div className="at-filter-row">
                  {["All", "available", "checked_out", "in_repair"].map((s) => (
                    <button key={s} className={`at-filter-chip ${filterStatus === s ? "active" : ""}`} onClick={() => setFilterStatus(s)}>
                      {s === "All" ? "All statuses" : s === "checked_out" ? "Checked out" : s === "in_repair" ? "In repair" : "Available"}
                    </button>
                  ))}
                </div>
                {filteredAssets.map((asset) => (
                  <AssetCard
                    key={asset.id}
                    asset={asset}
                    expanded={expandedId === asset.id}
                    onToggle={() => setExpandedId(expandedId === asset.id ? null : asset.id)}
                    onCheckout={() => setShowCheckout(asset)}
                    onCheckin={() => setShowCheckin(asset)}
                    checkouts={checkouts.filter((c) => c.asset_id === asset.id)}
                    userRole={userRole}
                  />
                ))}
              </div>
            )}

            {/* EMPLOYEE VIEW */}
            {activeView === "employee" && (
              <div>
                {Object.keys(employeeGroups).length === 0 ? (
                  <div className="at-empty"><h3>No assets checked out</h3><p>All assets are currently in the workshop or available.</p></div>
                ) : (
                  Object.entries(employeeGroups).map(([name, empAssets]) => (
                    <div key={name}>
                      <div className="at-group-header">
                        <div>
                          <h3>{name}</h3>
                          <p>{empAssets.length} asset{empAssets.length > 1 ? "s" : ""} currently assigned</p>
                        </div>
                      </div>
                      <div className="at-group-body">
                        {empAssets.map((asset) => (
                          <div key={asset.id} className="at-asset-row">
                            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                              <div className="at-status-dot" style={{ background: statusColor[asset.status] }} />
                              <div>
                                <div className="at-asset-name">{asset.name}</div>
                                <div className="at-asset-meta">SN: {asset.serial_number || "Not recorded"} · Job: {asset.checked_out_to_job || "No job"}</div>
                              </div>
                            </div>
                            <button className="at-btn at-btn-secondary at-btn-sm" onClick={() => setShowCheckin(asset)}>Check In</button>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}

            {/* JOB VIEW */}
            {activeView === "job" && (
              <div>
                {Object.keys(jobGroups).length === 0 ? (
                  <div className="at-empty"><h3>No assets on jobs</h3><p>All assets are in the workshop.</p></div>
                ) : (
                  Object.entries(jobGroups).map(([job, jobAssets]) => (
                    <div key={job}>
                      <div className="at-group-header">
                        <div>
                          <h3>{job}</h3>
                          <p>{jobAssets.length} asset{jobAssets.length > 1 ? "s" : ""} on this job · Est. value: {formatCurrency(jobAssets.reduce((s, a) => s + (a.current_value || 0), 0))}</p>
                        </div>
                      </div>
                      <div className="at-group-body">
                        {jobAssets.map((asset) => (
                          <div key={asset.id} className="at-asset-row">
                            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                              <div className="at-status-dot" style={{ background: statusColor[asset.status] }} />
                              <div>
                                <div className="at-asset-name">{asset.name}</div>
                                <div className="at-asset-meta">Assigned to: {asset.checked_out_to_name || "Unknown"} · SN: {asset.serial_number || "Not recorded"}</div>
                              </div>
                            </div>
                            <div style={{ fontSize: 13, fontWeight: 600, color: "var(--mid)" }}>{formatCurrency(asset.current_value)}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        )}

        {/* ── CHECKED OUT TAB ───────────────────────────────── */}
        {activeTab === "checkout" && (
          <div>
            {checkouts.filter((c) => !c.returned_at).length === 0 ? (
              <div className="at-empty"><h3>Nothing checked out</h3><p>All assets are in the workshop.</p></div>
            ) : (
              <div className="at-card">
                <div className="at-section-heading">Currently Checked Out</div>
                {checkouts.filter((c) => !c.returned_at).map((co) => {
                  const asset = assets.find((a) => a.id === co.asset_id);
                  const overdue = co.expected_return && daysUntil(co.expected_return) < 0;
                  return (
                    <div key={co.id} className="at-asset-row">
                      <div>
                        <div className="at-asset-name">{co.asset_name}</div>
                        <div className="at-asset-meta">
                          {co.user_name} · Job: {co.job_name || "No job"} · Out: {formatDate(co.checked_out_at)}
                        </div>
                        {overdue && (
                          <div style={{ fontSize: 11, color: "#991B1B", fontWeight: 600, marginTop: 2 }}>
                            Overdue — expected back {formatDate(co.expected_return)}
                          </div>
                        )}
                      </div>
                      {asset && (
                        <button className="at-btn at-btn-secondary at-btn-sm" onClick={() => setShowCheckin(asset)}>Check In</button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            <div className="at-card">
              <div className="at-section-heading">Recent Returns</div>
              {checkouts.filter((c) => c.returned_at).slice(0, 5).map((co) => (
                <div key={co.id} className="at-history-row">
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div>
                      <div style={{ fontWeight: 500, color: "var(--steel)", fontSize: 13 }}>{co.asset_name}</div>
                      <div style={{ fontSize: 12, color: "var(--mist)" }}>
                        {co.user_name} · Returned {formatDate(co.returned_at)} · Condition: {co.condition_in || "not noted"}
                      </div>
                    </div>
                    <span className="at-pill at-pill-available">Returned</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── PAT TESTING ───────────────────────────────────── */}
        {activeTab === "pat" && (
          <div>
            {patDue > 0 && (
              <div className="at-alert at-alert-warning">
                {patDue} asset{patDue > 1 ? "s" : ""} require PAT testing attention. Failed or untested equipment must not be used.
              </div>
            )}
            <div className="at-card">
              <div className="at-section-heading">PAT Testing Status</div>
              {assets.filter((a) => a.pat_required).map((asset) => {
                const status = patStatus(asset);
                const statusLabels = { ok: "Pass", fail: "Failed — do not use", overdue: "Overdue", due_soon: "Due soon", never: "Never tested" };
                const statusClass = { ok: "at-pat-ok", fail: "at-pat-fail", overdue: "at-pat-fail", due_soon: "at-pat-due", never: "at-pat-due" };
                return (
                  <div key={asset.id} className="at-asset-row">
                    <div>
                      <div className="at-asset-name">{asset.name}</div>
                      <div className="at-asset-meta">
                        SN: {asset.serial_number} · Last tested: {formatDate(asset.last_pat_date)} · Next due: {formatDate(asset.next_pat_date)}
                      </div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                      <span className={`at-pill ${statusClass[status]}`}>{statusLabels[status]}</span>
                      {(userRole === "owner" || userRole === "manager") && (
                        <button
                          className="at-btn at-btn-secondary at-btn-sm"
                          onClick={() => {
                            setAssets((prev) => prev.map((a) =>
                              a.id === asset.id ? {
                                ...a,
                                last_pat_date: new Date().toISOString().split("T")[0],
                                last_pat_result: "pass",
                                next_pat_date: new Date(Date.now() + a.pat_interval_months * 30 * 86400000).toISOString().split("T")[0],
                              } : a
                            ));
                            showAlertMsg("success", `PAT test recorded for ${asset.name}.`);
                          }}
                        >
                          Log PAT Test
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── MAINTENANCE ───────────────────────────────────── */}
        {activeTab === "maintenance" && (
          <div className="at-card">
            <div className="at-section-heading">Maintenance & Repair Log</div>
            {assets.filter((a) => a.notes || a.status === "in_repair").map((asset) => (
              <div key={asset.id} className="at-asset-row">
                <div>
                  <div className="at-asset-name">{asset.name}</div>
                  <div className="at-asset-meta">{asset.notes}</div>
                </div>
                <span className={`at-pill at-pill-${asset.status}`}>
                  {asset.status === "in_repair" ? "In repair" : "Note"}
                </span>
              </div>
            ))}
            {assets.filter((a) => a.notes || a.status === "in_repair").length === 0 && (
              <div className="at-empty" style={{ padding: "32px 0" }}><p>No maintenance records.</p></div>
            )}
          </div>
        )}

        {/* ── THEFT REPORT ──────────────────────────────────── */}
        {activeTab === "theft" && (
          <div>
            <div className="at-theft-section">
              <div className="at-theft-title">Theft Response Pack</div>
              <div className="at-theft-body">
                Select the assets that have been stolen below. The platform will generate a complete theft report — serial numbers, photos, values, movement history — ready to hand to the police and send to your insurer. This takes 10 seconds. Do it immediately.
              </div>
            </div>
            <div className="at-card">
              <div className="at-section-heading">Select stolen assets</div>
              {assets.filter((a) => a.status !== "stolen" && a.status !== "written_off").map((asset) => (
                <div key={asset.id} className="at-asset-row">
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <input
                      type="checkbox"
                      checked={selectedForTheft.includes(asset.id)}
                      onChange={(e) => {
                        setSelectedForTheft((prev) =>
                          e.target.checked ? [...prev, asset.id] : prev.filter((id) => id !== asset.id)
                        );
                      }}
                      style={{ width: 16, height: 16, cursor: "pointer" }}
                    />
                    <div>
                      <div className="at-asset-name">{asset.name}</div>
                      <div className="at-asset-meta">
                        SN: {asset.serial_number || "NOT RECORDED"} · Value: {formatCurrency(asset.purchase_price)}
                        {asset.checked_out_to_name && ` · Last seen with: ${asset.checked_out_to_name}`}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
              {selectedForTheft.length > 0 && <TheftReportPreview assets={assets} selectedIds={selectedForTheft} />}
            </div>
          </div>
        )}

        {/* ── MODALS ────────────────────────────────────────── */}
        {showAddAsset && (
          <AddAssetModal
            onSubmit={async (data) => {
              // Find-or-create the category so it can be referenced by FK.
              let categoryId = null;
              if (data.category) {
                const { data: existing } = await supabase.from("asset_categories")
                  .select("id").eq("name", data.category).limit(1).maybeSingle();
                if (existing) categoryId = existing.id;
                else {
                  const { data: created } = await supabase.from("asset_categories")
                    .insert({ account_id: accountId, name: data.category, pat_required: !!data.pat_required, pat_interval_months: parseInt(data.pat_interval_months) || 12 })
                    .select("id").single();
                  categoryId = created?.id || null;
                }
              }
              const { data: inserted, error } = await supabase.from("asset_items").insert({
                account_id: accountId,
                category_id: categoryId,
                name: data.name,
                serial_number: data.serial_number || null,
                purchase_date: data.purchase_date || null,
                purchase_price_pence: poundsToPence(data.purchase_price),
                status: "available",
                current_location: "workshop",
              }).select("*, category:asset_categories(name, pat_required, pat_interval_months)").single();
              if (error) { showAlertMsg("error", `Could not add asset: ${error.message}`); return; }
              const newAsset = mapAsset({ ...inserted, checkouts: [], pat: [] });
              setAssets((prev) => [...prev, newAsset]);
              setShowAddAsset(false);
              await logAction(supabase, { accountId, userId, userName, userRole, action: "created", entityType: "asset", entityId: inserted.id, entityName: data.name });
              showAlertMsg("success", `${data.name} added to asset register. QR code generated: ${newAsset.qr_code}`);
            }}
            onClose={() => setShowAddAsset(false)}
          />
        )}

        {showCheckout && (
          <CheckoutModal
            asset={showCheckout}
            onSubmit={(data) => handleCheckout(showCheckout.id, data)}
            onClose={() => setShowCheckout(null)}
          />
        )}

        {showCheckin && (
          <CheckinModal
            asset={showCheckin}
            onSubmit={(condition) => handleCheckin(showCheckin.id, condition)}
            onClose={() => setShowCheckin(null)}
          />
        )}
      </div>
    </>
  );
}

// ── ASSET CARD ──────────────────────────────────────────────────
function AssetCard({ asset, expanded, onToggle, onCheckout, onCheckin, checkouts, userRole }) {
  const canCheckout = asset.status === "available" && asset.last_pat_result !== "fail";
  const history = checkouts.filter((c) => c.returned_at).slice(0, 3);

  return (
    <div className={`at-asset-card ${expanded ? "expanded" : ""}`}>
      <div onClick={onToggle} style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, cursor: "pointer" }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
          <div className="at-status-dot" style={{ background: statusColor[asset.status], marginTop: 5 }} />
          <div>
            <div style={{ fontWeight: 700, fontSize: 14, color: "var(--steel)" }}>{asset.name}</div>
            <div style={{ fontSize: 12, color: "var(--mist)", marginTop: 2 }}>
              {asset.category} · SN: {asset.serial_number || "Not recorded"}
            </div>
            {asset.status === "checked_out" && (
              <div style={{ fontSize: 12, color: "#92400E", marginTop: 2 }}>
                With {asset.checked_out_to_name} · {asset.checked_out_to_job}
              </div>
            )}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
          <span className={`at-pill at-pill-${asset.status}`}>
            {asset.status === "checked_out" ? "Out" : asset.status === "in_repair" ? "Repair" : asset.status}
          </span>
          {asset.last_pat_result === "fail" && (
            <span className="at-pill at-pat-fail">PAT Fail</span>
          )}
          <div className="at-qr-badge">QR {asset.qr_code}</div>
        </div>
      </div>

      {expanded && (
        <div style={{ marginTop: 16 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
            {[
              ["Model", asset.model || "—"],
              ["Manufacturer", asset.manufacturer || "—"],
              ["Purchase Date", formatDate(asset.purchase_date)],
              ["Purchase Price", formatCurrency(asset.purchase_price)],
              ["Current Value", formatCurrency(asset.current_value)],
              ["Location", asset.location || "Workshop"],
              ["Last PAT", formatDate(asset.last_pat_date)],
              ["Next PAT Due", formatDate(asset.next_pat_date)],
            ].map(([label, value]) => (
              <div key={label}>
                <div style={{ fontSize: 10, color: "var(--mist)", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 2 }}>{label}</div>
                <div style={{ fontSize: 13, fontWeight: 500, color: "var(--steel)" }}>{value}</div>
              </div>
            ))}
          </div>

          {asset.notes && (
            <div style={{ padding: "10px 12px", background: "#FFFBEB", border: "1px solid #FDE68A", borderRadius: 6, fontSize: 13, color: "#92400E", marginBottom: 12 }}>
              {asset.notes}
            </div>
          )}

          {history.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: "var(--mist)", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 6 }}>Recent History</div>
              {history.map((co) => (
                <div key={co.id} className="at-history-row">
                  <span style={{ color: "var(--mid)" }}>{co.user_name}</span>
                  <span style={{ color: "var(--mist)", margin: "0 6px" }}>·</span>
                  <span style={{ color: "var(--mist)" }}>{co.job_name || "No job"}</span>
                  <span style={{ color: "var(--mist)", margin: "0 6px" }}>·</span>
                  <span style={{ color: "var(--mist)" }}>{formatDate(co.checked_out_at)} → {formatDate(co.returned_at)}</span>
                </div>
              ))}
            </div>
          )}

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {(userRole === "owner" || userRole === "manager") && (
              <>
                {canCheckout && (
                  <button className="at-btn at-btn-primary at-btn-sm" onClick={(e) => { e.stopPropagation(); onCheckout(); }}>
                    Check Out
                  </button>
                )}
                {asset.status === "checked_out" && (
                  <button className="at-btn at-btn-secondary at-btn-sm" onClick={(e) => { e.stopPropagation(); onCheckin(); }}>
                    Check In
                  </button>
                )}
              </>
            )}
            {asset.last_pat_result === "fail" && (
              <span style={{ fontSize: 12, color: "#991B1B", fontWeight: 600, alignSelf: "center" }}>
                Do not use — PAT failed
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── THEFT REPORT PREVIEW ────────────────────────────────────────
function TheftReportPreview({ assets, selectedIds }) {
  const stolen = assets.filter((a) => selectedIds.includes(a.id));
  const total = stolen.reduce((s, a) => s + (a.purchase_price || 0), 0);

  return (
    <div className="at-doc-preview">
      <div className="at-doc-header">Theft Report — {new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}</div>
      {stolen.map((asset) => (
        <div key={asset.id} style={{ marginBottom: 16, paddingBottom: 16, borderBottom: "1px solid var(--rule)" }}>
          <div style={{ fontWeight: 700, color: "var(--steel)", marginBottom: 6 }}>{asset.name}</div>
          <div className="at-doc-row"><span className="at-doc-label">Serial number</span><span className="at-doc-value">{asset.serial_number || "NOT RECORDED"}</span></div>
          <div className="at-doc-row"><span className="at-doc-label">Model</span><span className="at-doc-value">{asset.model || "—"}</span></div>
          <div className="at-doc-row"><span className="at-doc-label">Manufacturer</span><span className="at-doc-value">{asset.manufacturer || "—"}</span></div>
          <div className="at-doc-row"><span className="at-doc-label">Purchase date</span><span className="at-doc-value">{formatDate(asset.purchase_date)}</span></div>
          <div className="at-doc-row"><span className="at-doc-label">Purchase price</span><span className="at-doc-value">{formatCurrency(asset.purchase_price)}</span></div>
          {asset.checked_out_to_name && (
            <div className="at-doc-row"><span className="at-doc-label">Last seen with</span><span className="at-doc-value">{asset.checked_out_to_name} — {asset.checked_out_to_job || "no job recorded"}</span></div>
          )}
        </div>
      ))}
      <div className="at-doc-row" style={{ borderTop: "2px solid var(--rule)", paddingTop: 8 }}>
        <span className="at-doc-label">Total value stolen</span>
        <span style={{ fontWeight: 800, color: "#991B1B", fontSize: 16 }}>{formatCurrency(total)}</span>
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
        <button className="at-btn at-btn-danger" style={{ flex: 1, justifyContent: "center" }}>
          Download for Police
        </button>
        <button className="at-btn at-btn-secondary" style={{ flex: 1, justifyContent: "center" }}>
          Send to Insurer
        </button>
      </div>
    </div>
  );
}

// ── ADD ASSET MODAL ─────────────────────────────────────────────
function AddAssetModal({ onSubmit, onClose }) {
  const [form, setForm] = useState({
    name: "", category: "Power Tools", serial_number: "", model: "",
    manufacturer: "", purchase_date: "", purchase_price: "",
    current_value: "", pat_required: true, pat_interval_months: 12,
  });
  const f = (key) => (e) => setForm((p) => ({ ...p, [key]: e.target.value }));

  return (
    <div className="at-modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="at-modal">
        <div className="at-modal-header">
          <span className="at-modal-title">Add Asset</span>
          <button className="at-btn at-btn-ghost at-btn-sm" onClick={onClose}>Close</button>
        </div>
        <div className="at-form-grid">
          <div className="at-input-group" style={{ gridColumn: "1 / -1" }}>
            <label className="at-input-label">Asset name *</label>
            <input className="at-input" placeholder="e.g. Makita SDS Drill 36V" value={form.name} onChange={f("name")} />
          </div>
          <div className="at-input-group">
            <label className="at-input-label">Category</label>
            <select className="at-input" value={form.category} onChange={f("category")}>
              {DEFAULT_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="at-input-group">
            <label className="at-input-label">Serial number</label>
            <input className="at-input" placeholder="Manufacturer serial" value={form.serial_number} onChange={f("serial_number")} />
          </div>
          <div className="at-input-group">
            <label className="at-input-label">Manufacturer</label>
            <input className="at-input" placeholder="e.g. Makita" value={form.manufacturer} onChange={f("manufacturer")} />
          </div>
          <div className="at-input-group">
            <label className="at-input-label">Model</label>
            <input className="at-input" placeholder="e.g. DHR242Z" value={form.model} onChange={f("model")} />
          </div>
          <div className="at-input-group">
            <label className="at-input-label">Purchase date</label>
            <input type="date" className="at-input" value={form.purchase_date} onChange={f("purchase_date")} />
          </div>
          <div className="at-input-group">
            <label className="at-input-label">Purchase price (£)</label>
            <input type="number" className="at-input" placeholder="0.00" value={form.purchase_price} onChange={f("purchase_price")} />
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
          <input type="checkbox" checked={form.pat_required} onChange={(e) => setForm((p) => ({ ...p, pat_required: e.target.checked }))} id="pat_req" style={{ width: 16, height: 16 }} />
          <label htmlFor="pat_req" style={{ fontSize: 13, color: "var(--steel)", cursor: "pointer" }}>PAT testing required</label>
        </div>
        <button className="at-btn at-btn-primary" style={{ width: "100%" }} disabled={!form.name} onClick={() => onSubmit(form)}>
          Add Asset & Generate QR Code
        </button>
      </div>
    </div>
  );
}

// ── CHECKOUT MODAL ──────────────────────────────────────────────
function CheckoutModal({ asset, onSubmit, onClose }) {
  const [form, setForm] = useState({ employee: "", job: "", expected_return: "", condition: "good" });
  return (
    <div className="at-modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="at-modal">
        <div className="at-modal-header">
          <span className="at-modal-title">Check Out — {asset.name}</span>
          <button className="at-btn at-btn-ghost at-btn-sm" onClick={onClose}>Close</button>
        </div>
        <div className="at-input-group">
          <label className="at-input-label">Employee</label>
          <input className="at-input" placeholder="Who is taking this?" value={form.employee} onChange={(e) => setForm((p) => ({ ...p, employee: e.target.value }))} />
        </div>
        <div className="at-input-group">
          <label className="at-input-label">Job / Location</label>
          <input className="at-input" placeholder="Where is it going?" value={form.job} onChange={(e) => setForm((p) => ({ ...p, job: e.target.value }))} />
        </div>
        <div className="at-input-group">
          <label className="at-input-label">Expected return</label>
          <input type="date" className="at-input" value={form.expected_return} onChange={(e) => setForm((p) => ({ ...p, expected_return: e.target.value }))} />
        </div>
        <div className="at-input-group">
          <label className="at-input-label">Condition on checkout</label>
          <select className="at-input" value={form.condition} onChange={(e) => setForm((p) => ({ ...p, condition: e.target.value }))}>
            <option value="good">Good</option>
            <option value="fair">Fair</option>
            <option value="poor">Poor — noted</option>
          </select>
        </div>
        <button className="at-btn at-btn-primary" style={{ width: "100%" }} disabled={!form.employee} onClick={() => onSubmit(form)}>
          Check Out
        </button>
      </div>
    </div>
  );
}

// ── CHECK IN MODAL ──────────────────────────────────────────────
function CheckinModal({ asset, onSubmit, onClose }) {
  const [condition, setCondition] = useState("good");
  const [notes, setNotes] = useState("");
  return (
    <div className="at-modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="at-modal">
        <div className="at-modal-header">
          <span className="at-modal-title">Check In — {asset.name}</span>
          <button className="at-btn at-btn-ghost at-btn-sm" onClick={onClose}>Close</button>
        </div>
        <div className="at-input-group">
          <label className="at-input-label">Condition on return</label>
          <select className="at-input" value={condition} onChange={(e) => setCondition(e.target.value)}>
            <option value="good">Good — no issues</option>
            <option value="fair">Fair — minor wear</option>
            <option value="damaged">Damaged — needs repair</option>
            <option value="missing_parts">Missing parts</option>
          </select>
        </div>
        {condition === "damaged" && (
          <div className="at-input-group">
            <label className="at-input-label">Describe the damage</label>
            <textarea className="at-input" style={{ minHeight: 80, resize: "vertical" }} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        )}
        <button className="at-btn at-btn-primary" style={{ width: "100%" }} onClick={() => onSubmit(condition)}>
          Check In
        </button>
      </div>
    </div>
  );
}
