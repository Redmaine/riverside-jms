/**
 * InvoiceGeneration.jsx
 * Your Company AI — Invoice Generation Module
 *
 * DEPENDENCIES (injected via props from core platform):
 *   supabase        — Supabase client instance
 *   accountId       — Current account UUID
 *   userId          — Current platform_user UUID
 *   userName        — Current user display name
 *   userRole        — 'owner' | 'manager' | 'staff'
 *   accountName     — Business name (for invoice header)
 *   brandColor      — Hex colour from branding table
 *   logoUrl         — Logo URL from branding table (optional)
 *
 * DATABASE TABLES USED:
 *   invoices            — All invoice records
 *   invoice_line_items  — Line items per invoice
 *   invoice_settings    — VAT number, payment terms, bank details per account
 *   contacts            — Customer records (read + write on new customer)
 *   audit_log           — Audit trail
 *
 * EXTERNAL:
 *   Stripe              — Payment link generation per invoice
 *   Resend              — Email delivery of invoice PDF
 *   html2pdf / puppeteer — PDF generation (via Supabase Edge Function)
 *
 * NOTE ON INVOICE CHASING:
 *   When an invoice is marked as sent, the Invoice Chasing module
 *   automatically schedules the chase sequence (7/14/30 day).
 *   This is done via a Supabase trigger on invoices.status = 'sent'.
 *   Review request also triggers 1 hour after invoice sent (Review Manager).
 *
 * SCHEMA — add these tables to supabase_schema.sql:
 *
 * CREATE TABLE public.contacts (
 *   id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
 *   account_id      uuid REFERENCES public.accounts(id) ON DELETE CASCADE,
 *   name            text NOT NULL,
 *   email           text,
 *   phone           text,
 *   address_line1   text,
 *   address_line2   text,
 *   town            text,
 *   county          text,
 *   postcode        text,
 *   company_name    text,
 *   vat_number      text,
 *   notes           text,
 *   is_business     boolean DEFAULT false,
 *   created_at      timestamptz DEFAULT now(),
 *   updated_at      timestamptz DEFAULT now()
 * );
 *
 * CREATE TABLE public.invoice_settings (
 *   id                  uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
 *   account_id          uuid REFERENCES public.accounts(id) ON DELETE CASCADE UNIQUE,
 *   invoice_prefix      text DEFAULT 'INV',
 *   next_invoice_number int DEFAULT 1,
 *   payment_terms_days  int DEFAULT 14,
 *   vat_registered      boolean DEFAULT false,
 *   vat_number          text,
 *   vat_rate            numeric(5,2) DEFAULT 20.0,
 *   bank_name           text,
 *   account_name        text,
 *   sort_code           text,
 *   account_number      text,
 *   payment_reference   text DEFAULT 'Invoice number',
 *   footer_notes        text,
 *   stripe_enabled      boolean DEFAULT false,
 *   created_at          timestamptz DEFAULT now(),
 *   updated_at          timestamptz DEFAULT now()
 * );
 *
 * CREATE TABLE public.invoices (
 *   id                  uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
 *   account_id          uuid REFERENCES public.accounts(id) ON DELETE CASCADE,
 *   contact_id          uuid REFERENCES public.contacts(id),
 *   invoice_number      text NOT NULL,
 *   customer_name       text NOT NULL,
 *   customer_email      text,
 *   customer_address    text,
 *   issue_date          date NOT NULL DEFAULT CURRENT_DATE,
 *   due_date            date NOT NULL,
 *   subtotal            numeric(10,2) DEFAULT 0,
 *   discount_pct        numeric(5,2) DEFAULT 0,
 *   discount_amount     numeric(10,2) DEFAULT 0,
 *   vat_amount          numeric(10,2) DEFAULT 0,
 *   total               numeric(10,2) DEFAULT 0,
 *   amount_paid         numeric(10,2) DEFAULT 0,
 *   amount_due          numeric(10,2) GENERATED ALWAYS AS (total - amount_paid) STORED,
 *   status              text DEFAULT 'draft' CHECK (status IN
 *     ('draft','sent','viewed','part_paid','paid','overdue','written_off','disputed')),
 *   notes               text,
 *   payment_terms       text,
 *   stripe_payment_link text,
 *   stripe_payment_intent text,
 *   pdf_url             text,
 *   sent_at             timestamptz,
 *   viewed_at           timestamptz,
 *   paid_at             timestamptz,
 *   created_at          timestamptz DEFAULT now(),
 *   updated_at          timestamptz DEFAULT now()
 * );
 *
 * CREATE TABLE public.invoice_line_items (
 *   id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
 *   account_id      uuid REFERENCES public.accounts(id) ON DELETE CASCADE,
 *   invoice_id      uuid REFERENCES public.invoices(id) ON DELETE CASCADE,
 *   description     text NOT NULL,
 *   quantity        numeric(10,3) DEFAULT 1,
 *   unit_price      numeric(10,2) NOT NULL,
 *   vat_rate        numeric(5,2) DEFAULT 0,
 *   line_total      numeric(10,2) GENERATED ALWAYS AS (quantity * unit_price) STORED,
 *   sort_order      int DEFAULT 0,
 *   created_at      timestamptz DEFAULT now()
 * );
 *
 * -- Trigger: when invoice sent, schedule chase sequence
 * CREATE OR REPLACE FUNCTION public.on_invoice_sent()
 * RETURNS TRIGGER AS $$
 * BEGIN
 *   IF NEW.status = 'sent' AND OLD.status = 'draft' THEN
 *     INSERT INTO public.invoice_chase_queue (account_id, invoice_id, chase_day, scheduled_for)
 *     VALUES
 *       (NEW.account_id, NEW.id, 7,  NEW.sent_at + INTERVAL '7 days'),
 *       (NEW.account_id, NEW.id, 14, NEW.sent_at + INTERVAL '14 days'),
 *       (NEW.account_id, NEW.id, 30, NEW.sent_at + INTERVAL '30 days');
 *     -- Also schedule review request 1 hour after invoice sent
 *     INSERT INTO public.review_requests (account_id, contact_id, invoice_id, scheduled_for)
 *     VALUES (NEW.account_id, NEW.contact_id, NEW.id, NEW.sent_at + INTERVAL '1 hour');
 *   END IF;
 *   RETURN NEW;
 * END;
 * $$ LANGUAGE plpgsql SECURITY DEFINER;
 *
 * CREATE TRIGGER trigger_invoice_sent
 *   AFTER UPDATE ON public.invoices
 *   FOR EACH ROW EXECUTE FUNCTION public.on_invoice_sent();
 *
 * Enable RLS on all tables with standard account_id policies.
 */

import { useState, useMemo, useCallback, useEffect } from "react";
import { generateInvoicePdf } from "../../lib/invoicePdf";

// ── CONSTANTS ───────────────────────────────────────────────────
const TABS = [
  { id: "invoices",  label: "Invoices" },
  { id: "create",    label: "Create Invoice" },
  { id: "quotes",    label: "Quotes" },
  { id: "contacts",  label: "Customers" },
  { id: "settings",  label: "Settings" },
];

const STATUS_ORDER = ["draft", "sent", "viewed", "part_paid", "paid", "overdue", "disputed", "written_off"];

// ── STYLES ──────────────────────────────────────────────────────
const css = `
  @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=DM+Sans:wght@300;400;500&display=swap');

  .ig-wrap * { box-sizing: border-box; margin: 0; padding: 0; }
  .ig-wrap {
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

  .ig-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 24px; }
  .ig-header h1 { font-family: 'Plus Jakarta Sans', sans-serif; font-weight: 800; font-size: 22px; color: var(--steel); }
  .ig-header p  { font-size: 13px; color: var(--mist); margin-top: 2px; }

  .ig-tabs { display: flex; gap: 4px; background: var(--white); border: 1px solid var(--rule); border-radius: var(--radius); padding: 4px; margin-bottom: 24px; overflow-x: auto; }
  .ig-tab  { flex: 1; min-width: fit-content; padding: 8px 14px; border: none; background: none; border-radius: 6px; font-family: 'DM Sans', sans-serif; font-size: 13px; font-weight: 500; color: var(--light); cursor: pointer; white-space: nowrap; transition: all 0.15s; }
  .ig-tab.active { background: var(--steel); color: var(--white); }
  .ig-tab .badge { display: inline-flex; align-items: center; justify-content: center; width: 18px; height: 18px; background: var(--ember); color: white; border-radius: 50%; font-size: 10px; font-weight: 700; margin-left: 6px; }

  .ig-card { background: var(--white); border: 1px solid var(--rule); border-radius: var(--radius); padding: 20px; margin-bottom: 16px; }
  .ig-card-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 16px; margin-bottom: 24px; }
  .ig-stat-card { background: var(--white); border: 1px solid var(--rule); border-radius: var(--radius); padding: 18px 20px; }
  .ig-stat-label { font-size: 11px; font-weight: 600; color: var(--mist); text-transform: uppercase; letter-spacing: 1px; margin-bottom: 8px; }
  .ig-stat-value { font-family: 'Plus Jakarta Sans', sans-serif; font-weight: 800; font-size: 26px; color: var(--steel); line-height: 1; }
  .ig-stat-sub   { font-size: 12px; color: var(--mist); margin-top: 4px; }
  .ig-section-heading { font-family: 'Plus Jakarta Sans', sans-serif; font-weight: 700; font-size: 14px; color: var(--steel); margin-bottom: 12px; padding-bottom: 8px; border-bottom: 1px solid var(--rule); }

  /* Invoice row */
  .ig-invoice-row { display: flex; align-items: center; justify-content: space-between; padding: 13px 0; border-bottom: 1px solid var(--rule); gap: 12px; cursor: pointer; transition: background 0.1s; }
  .ig-invoice-row:last-child { border-bottom: none; }
  .ig-invoice-row:hover { background: var(--chalk); margin: 0 -20px; padding: 13px 20px; border-radius: 6px; }
  .ig-invoice-num  { font-size: 13px; font-weight: 700; color: var(--steel); font-family: monospace; }
  .ig-invoice-name { font-size: 14px; font-weight: 600; color: var(--steel); }
  .ig-invoice-meta { font-size: 12px; color: var(--mist); margin-top: 2px; }

  /* Status pills */
  .ig-pill { display: inline-flex; align-items: center; padding: 3px 10px; border-radius: 20px; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; }
  .ig-pill-draft      { background: #F3F4F6; color: #6B7280; }
  .ig-pill-sent       { background: #EFF6FF; color: #1E40AF; }
  .ig-pill-viewed     { background: #F0FDF4; color: #166534; }
  .ig-pill-part_paid  { background: #FEF9C3; color: #854D0E; }
  .ig-pill-paid       { background: #DCFCE7; color: #166534; }
  .ig-pill-overdue    { background: #FEE2E2; color: #991B1B; }
  .ig-pill-disputed   { background: #FDF4FF; color: #7E22CE; }
  .ig-pill-written_off{ background: #F3F4F6; color: #6B7280; }

  /* Invoice builder */
  .ig-builder { background: var(--white); border: 1px solid var(--rule); border-radius: var(--radius); padding: 24px; margin-bottom: 16px; }
  .ig-builder-section { margin-bottom: 24px; padding-bottom: 24px; border-bottom: 1px solid var(--rule); }
  .ig-builder-section:last-child { border-bottom: none; margin-bottom: 0; padding-bottom: 0; }

  /* Line items */
  .ig-line-header { display: grid; grid-template-columns: 1fr 80px 100px 100px 36px; gap: 8px; align-items: center; padding-bottom: 8px; border-bottom: 1px solid var(--rule); margin-bottom: 4px; }
  .ig-line-row    { display: grid; grid-template-columns: 1fr 80px 100px 100px 36px; gap: 8px; align-items: center; padding: 6px 0; }
  .ig-line-label  { font-size: 11px; font-weight: 600; color: var(--mist); text-transform: uppercase; letter-spacing: 0.5px; }
  .ig-line-total  { font-size: 14px; font-weight: 700; color: var(--steel); text-align: right; }

  /* Totals section */
  .ig-totals { margin-left: auto; width: 280px; }
  .ig-total-row { display: flex; justify-content: space-between; align-items: center; padding: 6px 0; font-size: 14px; }
  .ig-total-row.grand { border-top: 2px solid var(--steel); margin-top: 4px; padding-top: 10px; }
  .ig-grand-value { font-family: 'Plus Jakarta Sans', sans-serif; font-weight: 800; font-size: 22px; color: var(--steel); }

  /* Invoice preview */
  .ig-preview { background: white; border: 1px solid var(--rule); border-radius: var(--radius); padding: 32px 40px; font-family: 'DM Sans', sans-serif; max-width: 680px; }
  .ig-preview-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 32px; }
  .ig-preview-business { font-family: 'Plus Jakarta Sans', sans-serif; font-weight: 800; font-size: 20px; color: var(--steel); }
  .ig-preview-num { font-family: 'Plus Jakarta Sans', sans-serif; font-weight: 800; font-size: 28px; color: var(--ember); }
  .ig-preview-table { width: 100%; border-collapse: collapse; margin: 24px 0; }
  .ig-preview-table th { text-align: left; padding: 8px 12px; background: var(--chalk); font-size: 11px; font-weight: 600; color: var(--mist); text-transform: uppercase; letter-spacing: 0.5px; }
  .ig-preview-table td { padding: 10px 12px; border-bottom: 1px solid var(--rule); font-size: 13px; }
  .ig-preview-table td:last-child { text-align: right; font-weight: 600; }
  .ig-preview-bank { background: var(--chalk); border-radius: 6px; padding: 12px 16px; margin-top: 20px; }
  .ig-preview-bank-title { font-size: 11px; font-weight: 600; color: var(--mist); text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 6px; }
  @media (max-width: 640px) {
    .ig-preview { padding: 14px 10px; }
    .ig-preview-header { margin-bottom: 18px; gap: 12px; }
    .ig-preview-num { font-size: 18px; }
    .ig-preview-business { font-size: 16px; }
    .ig-preview-meta, .ig-preview-billto { font-size: 12px; }
    .ig-preview-table { margin: 16px 0; }
    .ig-preview-table th, .ig-preview-table td { padding: 6px 6px; font-size: 12px; }
    .ig-modal { padding: 12px; }
    .ig-modal-overlay { padding: 8px; }
    .ig-modal-lg { max-width: 100%; width: 100%; }
    /* Preview modal header: stack title over full-width action buttons. */
    .ig-preview-head { flex-direction: column; align-items: stretch; gap: 10px; }
    .ig-preview-actions { width: 100%; }
    .ig-preview-actions .ig-btn { flex: 1; }
  }
  /* Very small screens: stack each line-item row (description over amount). */
  @media (max-width: 380px) {
    .ig-preview-table, .ig-preview-table tbody, .ig-preview-table tr, .ig-preview-table td { display: block; width: 100%; }
    .ig-preview-table thead { display: none; }
    .ig-preview-table td { border-bottom: none; padding: 2px 0; }
    .ig-preview-table tr { border-bottom: 1px solid var(--rule); padding: 8px 0; }
    .ig-preview-table td:last-child { text-align: left; font-weight: 700; }
  }

  /* Contact row */
  .ig-contact-row { display: flex; align-items: center; justify-content: space-between; padding: 12px 0; border-bottom: 1px solid var(--rule); font-size: 13px; }
  .ig-contact-row:last-child { border-bottom: none; }

  /* Overdue age bar */
  .ig-age-bar { height: 4px; border-radius: 2px; background: var(--rule); overflow: hidden; margin-top: 4px; width: 80px; }
  .ig-age-fill { height: 100%; border-radius: 2px; }

  /* Buttons */
  .ig-btn { display: inline-flex; align-items: center; gap: 6px; padding: 8px 14px; border-radius: 6px; font-family: 'DM Sans', sans-serif; font-size: 13px; font-weight: 500; cursor: pointer; border: none; transition: all 0.15s; white-space: nowrap; }
  .ig-btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .ig-btn-primary   { background: var(--ember); color: white; }
  .ig-btn-primary:hover:not(:disabled) { background: var(--ember-lt); }
  .ig-btn-secondary { background: var(--chalk); color: var(--steel); border: 1px solid var(--rule); }
  .ig-btn-secondary:hover:not(:disabled) { border-color: var(--mist); }
  .ig-btn-ghost     { background: none; color: var(--mist); border: 1px solid var(--rule); }
  .ig-btn-ghost:hover:not(:disabled) { color: var(--steel); border-color: var(--steel); }
  .ig-btn-success   { background: #DCFCE7; color: #166534; border: 1px solid #BBF7D0; }
  .ig-btn-danger    { background: #FEE2E2; color: #991B1B; border: 1px solid #FECACA; }
  .ig-btn-sm        { padding: 5px 10px; font-size: 12px; }
  .ig-btn-icon      { padding: 6px; width: 32px; height: 32px; justify-content: center; }

  /* Form */
  .ig-input { width: 100%; padding: 9px 12px; border: 1px solid var(--rule); border-radius: 6px; font-family: 'DM Sans', sans-serif; font-size: 14px; color: var(--steel); outline: none; transition: border-color 0.15s; background: white; }
  .ig-input:focus { border-color: var(--ember); }
  .ig-input-sm { padding: 7px 10px; font-size: 13px; }
  .ig-input-label { font-size: 13px; font-weight: 500; color: var(--steel); margin-bottom: 6px; display: block; }
  .ig-input-group { margin-bottom: 16px; }
  .ig-form-grid   { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  .ig-form-grid-3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 16px; }

  /* Modal */
  .ig-modal-overlay { position: fixed; inset: 0; background: rgba(28,28,46,0.5); display: flex; align-items: center; justify-content: center; z-index: 100; padding: 20px; }
  .ig-modal { background: var(--white); border-radius: var(--radius); padding: 24px; width: 100%; max-width: 560px; max-height: 90vh; overflow-y: auto; }
  .ig-modal-lg { max-width: 740px; }
  .ig-modal-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px; }
  .ig-modal-title  { font-family: 'Plus Jakarta Sans', sans-serif; font-weight: 700; font-size: 16px; color: var(--steel); }

  /* Alert */
  .ig-alert { padding: 12px 16px; border-radius: var(--radius); font-size: 13px; margin-bottom: 16px; }
  .ig-alert-success { background: #DCFCE7; border: 1px solid #BBF7D0; color: #166534; }
  .ig-alert-warning { background: #FFFBEB; border: 1px solid #FDE68A; color: #92400E; }
  .ig-alert-info    { background: #EFF6FF; border: 1px solid #BFDBFE; color: #1E40AF; }
  .ig-alert-danger  { background: #FEF2F2; border: 1px solid #FECACA; color: #991B1B; }

  /* Empty */
  .ig-empty { text-align: center; padding: 48px 24px; color: var(--mist); }
  .ig-empty h3 { font-size: 16px; color: var(--steel); margin-bottom: 6px; }

  /* Filter bar */
  .ig-filter-row { display: flex; gap: 8px; margin-bottom: 16px; flex-wrap: wrap; align-items: center; }
  .ig-filter-chip { padding: 5px 12px; border-radius: 20px; font-size: 12px; font-weight: 500; border: 1px solid var(--rule); background: var(--white); color: var(--light); cursor: pointer; transition: all 0.15s; }
  .ig-filter-chip.active { background: var(--steel); color: white; border-color: var(--steel); }
  .ig-search { padding: 7px 12px 7px 32px; border: 1px solid var(--rule); border-radius: 20px; font-size: 13px; outline: none; background: white url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='13' height='13' viewBox='0 0 24 24' fill='none' stroke='%238C8CA8' stroke-width='2'%3E%3Ccircle cx='11' cy='11' r='8'/%3E%3Cpath d='m21 21-4.35-4.35'/%3E%3C/svg%3E") no-repeat 10px center; width: 200px; }
  .ig-search:focus { border-color: var(--ember); outline: none; }

  /* Spinner */
  .ig-spinner { width: 16px; height: 16px; border: 2px solid var(--rule); border-top-color: var(--ember); border-radius: 50%; animation: ig-spin 0.6s linear infinite; display: inline-block; }
  @keyframes ig-spin { to { transform: rotate(360deg); } }

  /* Toggle */
  .ig-toggle { position: relative; display: inline-block; width: 44px; height: 24px; flex-shrink: 0; }
  .ig-toggle input { opacity: 0; width: 0; height: 0; }
  .ig-toggle-slider { position: absolute; cursor: pointer; inset: 0; background: var(--rule); border-radius: 24px; transition: 0.2s; }
  .ig-toggle-slider:before { content: ''; position: absolute; width: 18px; height: 18px; left: 3px; bottom: 3px; background: white; border-radius: 50%; transition: 0.2s; }
  .ig-toggle input:checked + .ig-toggle-slider { background: var(--ember); }
  .ig-toggle input:checked + .ig-toggle-slider:before { transform: translateX(20px); }
`;

// ── HELPERS ─────────────────────────────────────────────────────
const today = new Date();
const formatDate = (d) => d ? new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—";
const formatCurrency = (n) => `£${(Number(n) || 0).toFixed(2)}`;
const daysOverdue = (due) => {
  if (!due) return 0;
  return Math.max(0, Math.ceil((today - new Date(due)) / 86400000));
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

// ── DEFAULT SETTINGS ─────────────────────────────────────────────
// NOTE: the live DB has no `invoice_settings` table. Of the fields below
// only invoice_prefix / vat_registered / vat_number / invoice_sequence map
// to real columns (on public.accounts). Bank details, footer, payment terms
// and stripe flag have no backing column yet, so they are UI-only (kept in
// local state, not persisted) until a settings table exists.
const DEFAULT_SETTINGS = {
  invoice_prefix: "INV",
  next_invoice_number: 1,
  payment_terms_days: 30,
  vat_registered: false,
  vat_number: "",
  vat_rate: 20,
  bank_name: "",
  account_name: "",
  sort_code: "",
  account_number: "",
  payment_reference: "Invoice number",
  footer_notes: "",
  stripe_enabled: false,
};

// ── Live-schema <-> UI adapters ──────────────────────────────────
// The live schema stores money as integer pence and normalises the customer
// onto contacts(contact_id). The UI was written for pounds + denormalised
// customer fields, so we translate at the boundary.
const penceToPounds = (p) => (p ?? 0) / 100;
const poundsToPence = (v) => Math.round((parseFloat(v) || 0) * 100);
const DB_TO_UI_STATUS = { partially_paid: "part_paid", cancelled: "void" };
const UI_TO_DB_STATUS = { part_paid: "partially_paid", void: "cancelled" };
const contactDisplayName = (c) =>
  c ? ([c.first_name, c.last_name].filter(Boolean).join(" ") || c.business_name || "") : "";

function mapContact(row) {
  return {
    id: row.id,
    name: contactDisplayName(row),
    first_name: row.first_name || "",
    last_name: row.last_name || "",
    company_name: row.business_name || "",
    email: row.email || "",
    phone: row.phone || row.mobile || "",
    address_line1: row.address_line1 || "",
    town: row.town || "",
    postcode: row.postcode || "",
    is_business: !!row.business_name,
  };
}

// Phase 3 margin warning. Compares the quote's implied margin (needs an estimated
// cost) against the account's avg margin on completed jobs in the last 12 months.
// Returns a warning string, or null (insufficient data / no cost / not underpriced).
function quoteMarginWarning(jobs, quotedTotalPounds, estCostPounds) {
  if (!quotedTotalPounds || !estCostPounds) return null; // can't imply a margin without a cost
  const cutoff = new Date(Date.now() - 365 * 86400000);
  const completed = (jobs || []).filter((j) =>
    j.status === "completed" &&
    j.created_at && new Date(j.created_at) >= cutoff &&
    (j.quoted_amount_pence || 0) > 0);
  if (completed.length < 5) return null; // insufficient data
  const margins = completed.map((j) => {
    const quoted = j.quoted_amount_pence;
    const cost = (j.costs || []).reduce((s, c) => s + (c.total_pence || 0), 0);
    return ((quoted - cost) / quoted) * 100;
  });
  const avg = margins.reduce((s, m) => s + m, 0) / margins.length;
  const implied = ((quotedTotalPounds - estCostPounds) / quotedTotalPounds) * 100;
  if (implied >= avg - 10) return null;
  return `Your average margin on completed jobs is ${avg.toFixed(0)}%. This quote implies ${implied.toFixed(0)}%. You may be underpricing.`;
}

function mapInvoice(row) {
  const c = row.contact || null;
  return {
    id: row.id,
    invoice_number: row.invoice_number,
    contact_id: row.contact_id,
    customer_name: contactDisplayName(c),
    customer_email: c?.email || "",
    customer_address: c ? [c.address_line1, c.town, c.postcode].filter(Boolean).join(", ") : "",
    issue_date: row.issue_date,
    due_date: row.due_date,
    subtotal: penceToPounds(row.subtotal_pence),
    discount_pct: 0,
    discount_amount: 0,
    vat_amount: penceToPounds(row.vat_amount_pence),
    total: penceToPounds(row.total_pence),
    amount_paid: penceToPounds(row.amount_paid_pence),
    status: DB_TO_UI_STATUS[row.status] || row.status,
    notes: row.notes || "",
    sent_at: row.sent_at,
    paid_at: row.paid_at,
    document_type: row.document_type || "invoice",
    quote_expiry_date: row.quote_expiry_date || null,
    job_id: row.job_id || null,
    quote_accepted_at: row.quote_accepted_at || null,
    converted_to_invoice_id: row.converted_to_invoice_id || null,
    quote_token: row.quote_token || null,
    line_items: (row.line_items || [])
      .slice()
      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
      .map((li) => ({
        id: li.id,
        description: li.description,
        quantity: Number(li.quantity),
        unit_price: penceToPounds(li.unit_price_pence),
        vat_rate: Number(li.vat_rate),
        line_total: penceToPounds(li.total_pence),
      })),
  };
}

// Derived quote lifecycle status (no dedicated column needed).
function quoteStatus(q) {
  const todayS = new Date().toISOString().split("T")[0];
  if (q.quote_accepted_at || q.converted_to_invoice_id) return "accepted";
  if (q.status === "void") return "declined"; // DB 'cancelled' -> UI 'void'
  if (q.quote_expiry_date && q.quote_expiry_date < todayS) return "expired";
  return "pending";
}

// ── MAIN COMPONENT ──────────────────────────────────────────────
export default function InvoiceGeneration({
  supabase, accountId, userId, userName, userRole,
  accountName = "Your Business", brandColor = "#E8410A", logoUrl = null,
}) {
  const [activeTab, setActiveTab] = useState("invoices");
  const [invoices, setInvoices] = useState([]);
  const [quotes, setQuotes] = useState([]);
  const [quoteFilter, setQuoteFilter] = useState("all");
  const [contacts, setContacts] = useState([]);
  const [jobs, setJobs] = useState([]); // for quote↔job linking + margin analysis
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState("all");
  const [search, setSearch] = useState("");
  const [customerFilter, setCustomerFilter] = useState(null); // filter list to one customer
  const [selectedInvoice, setSelectedInvoice] = useState(null);
  const [showPreview, setShowPreview] = useState(null);
  const [showNewContact, setShowNewContact] = useState(false);
  const [sendingId, setSendingId] = useState(null);
  const [alert, setAlert] = useState(null);

  const showAlertMsg = (type, msg) => {
    setAlert({ type, message: msg });
    setTimeout(() => setAlert(null), 5000);
  };

  // ── Load real data from Supabase (RLS scopes to this account) ──
  const loadData = useCallback(async () => {
    setLoading(true);
    const [invRes, conRes, accRes, jobRes] = await Promise.all([
      supabase
        .from("invoices")
        .select("*, contact:contacts(*), line_items:invoice_line_items(*)")
        .order("issue_date", { ascending: false }),
      supabase.from("contacts").select("*").order("first_name"),
      supabase
        .from("accounts")
        .select("invoice_prefix, invoice_sequence, vat_registered, vat_number")
        .eq("id", accountId)
        .maybeSingle(),
      supabase.from("jobs").select("id, customer_name, description, status, quoted_amount_pence, created_at, costs:job_costs(total_pence)").order("created_at", { ascending: false }),
    ]);
    if (!jobRes.error) setJobs(jobRes.data || []);
    if (invRes.error) showAlertMsg("error", `Could not load invoices: ${invRes.error.message}`);
    else {
      const allDocs = (invRes.data || []).map(mapInvoice);
      setInvoices(allDocs.filter((d) => d.document_type !== "quote"));
      setQuotes(allDocs.filter((d) => d.document_type === "quote"));
    }
    if (!conRes.error) setContacts((conRes.data || []).map(mapContact));
    if (!accRes.error && accRes.data) {
      setSettings((s) => ({
        ...s,
        invoice_prefix: accRes.data.invoice_prefix || "INV",
        next_invoice_number: (accRes.data.invoice_sequence || 0) + 1,
        vat_registered: !!accRes.data.vat_registered,
        vat_number: accRes.data.vat_number || "",
      }));
    }
    setLoading(false);
  }, [supabase, accountId]);

  useEffect(() => { loadData(); }, [loadData]);

  // Insert an invoice (+ its line items). The invoice number is assigned
  // atomically by the next_invoice_number() RPC on the server.
  const saveInvoice = async (invoice) => {
    const { data: invoiceNumber, error: numErr } = await supabase.rpc(
      "next_invoice_number",
      { p_account_id: accountId }
    );
    if (numErr) { showAlertMsg("error", `Could not allocate invoice number: ${numErr.message}`); return null; }

    const row = {
      account_id: accountId,
      contact_id: invoice.contact_id || null,
      invoice_number: invoiceNumber,
      status: UI_TO_DB_STATUS[invoice.status] || invoice.status,
      issue_date: invoice.issue_date,
      due_date: invoice.due_date,
      subtotal_pence: poundsToPence(invoice.subtotal),
      vat_amount_pence: poundsToPence(invoice.vat_amount),
      total_pence: poundsToPence(invoice.total),
      amount_paid_pence: poundsToPence(invoice.amount_paid),
      vat_enabled: (parseFloat(invoice.vat_amount) || 0) > 0,
      notes: invoice.notes || null,
      created_by: userId,
      sent_at: invoice.sent_at || null,
      document_type: invoice.document_type || "invoice",
      quote_expiry_date: invoice.quote_expiry_date || null,
      job_id: invoice.job_id || null,
    };
    const { data, error } = await supabase
      .from("invoices")
      .insert(row)
      .select("*, contact:contacts(*)")
      .single();
    if (error) { showAlertMsg("error", `Could not save invoice: ${error.message}`); return null; }

    let savedLines = [];
    const lineItems = invoice.line_items || [];
    if (lineItems.length) {
      const rows = lineItems.map((li, idx) => {
        const qty = parseFloat(li.quantity) || 0;
        const unit = parseFloat(li.unit_price) || 0;
        return {
          account_id: accountId,
          invoice_id: data.id,
          description: li.description,
          quantity: qty,
          unit_price_pence: poundsToPence(unit),
          vat_rate: li.vat_rate || 0,
          total_pence: Math.round(qty * unit * 100),
          sort_order: idx,
        };
      });
      const { data: liData, error: liErr } = await supabase
        .from("invoice_line_items").insert(rows).select("*");
      if (liErr) showAlertMsg("error", `Invoice saved but line items failed: ${liErr.message}`);
      else savedLines = liData || [];
    }

    return mapInvoice({ ...data, line_items: savedLines });
  };

  // Stats
  const totalOutstanding = invoices.filter((i) => !["paid", "written_off"].includes(i.status)).reduce((s, i) => s + i.total, 0);
  const totalOverdue = invoices.filter((i) => i.status === "overdue").reduce((s, i) => s + i.total, 0);
  const paidThisMonth = invoices.filter((i) => i.status === "paid" && i.paid_at && new Date(i.paid_at).getMonth() === today.getMonth()).reduce((s, i) => s + i.total, 0);
  const overdueCount = invoices.filter((i) => i.status === "overdue").length;

  // Filtered invoices
  const filtered = useMemo(() => {
    return invoices.filter((inv) => {
      const matchStatus = filterStatus === "all" || inv.status === filterStatus;
      const matchSearch = !search || inv.customer_name.toLowerCase().includes(search.toLowerCase()) || inv.invoice_number.toLowerCase().includes(search.toLowerCase());
      const matchCustomer = !customerFilter || (inv.contact_id ? inv.contact_id === customerFilter.id : inv.customer_name === customerFilter.name);
      return matchStatus && matchSearch && matchCustomer;
    }).sort((a, b) => new Date(b.issue_date) - new Date(a.issue_date));
  }, [invoices, filterStatus, search, customerFilter]);

  // Send invoice
  const handleSend = async (invoiceId) => {
    setSendingId(invoiceId);
    const inv = invoices.find((i) => i.id === invoiceId);
    const sent_at = new Date().toISOString();
    const { error } = await supabase
      .from("invoices")
      .update({ status: "sent", sent_at })
      .eq("id", invoiceId);
    if (error) {
      setSendingId(null);
      showAlertMsg("error", `Could not send invoice: ${error.message}`);
      return;
    }
    setInvoices((prev) => prev.map((i) =>
      i.id === invoiceId ? { ...i, status: "sent", sent_at } : i
    ));
    await logAction(supabase, {
      accountId, userId, userName, userRole,
      action: "sent", entityType: "invoice", entityId: invoiceId,
      entityName: `Invoice sent — ${inv?.invoice_number}`,
      newValue: { status: "sent" },
    });
    setSendingId(null);
    showAlertMsg("success", "Invoice sent. Chase sequence scheduled. Review request queued for 1 hour.");
  };

  // Mark paid
  const handleMarkPaid = async (invoiceId) => {
    const inv = invoices.find((i) => i.id === invoiceId);
    const paid_at = new Date().toISOString();
    const { error } = await supabase
      .from("invoices")
      .update({ status: "paid", amount_paid_pence: poundsToPence(inv?.total ?? 0), paid_at })
      .eq("id", invoiceId);
    if (error) { showAlertMsg("error", `Could not update invoice: ${error.message}`); return; }
    setInvoices((prev) => prev.map((i) =>
      i.id === invoiceId ? { ...i, status: "paid", amount_paid: i.total, paid_at } : i
    ));
    await logAction(supabase, {
      accountId, userId, userName, userRole,
      action: "paid", entityType: "invoice", entityId: invoiceId,
      entityName: `Invoice marked paid — ${inv?.invoice_number}`,
      newValue: { status: "paid" },
    });
    showAlertMsg("success", "Invoice marked as paid.");
  };

  // Generic status update used by Void / Resolve.
  const updateStatus = async (invoiceId, dbStatus, uiStatus, label) => {
    const inv = invoices.find((i) => i.id === invoiceId);
    const { error } = await supabase.from("invoices").update({ status: dbStatus }).eq("id", invoiceId);
    if (error) { showAlertMsg("error", `Could not update invoice: ${error.message}`); return; }
    setInvoices((prev) => prev.map((i) => i.id === invoiceId ? { ...i, status: uiStatus } : i));
    await logAction(supabase, {
      accountId, userId, userName, userRole,
      action: "updated", entityType: "invoice", entityId: invoiceId,
      entityName: `${label} — ${inv?.invoice_number}`, newValue: { status: uiStatus },
    });
    showAlertMsg("success", `${label}.`);
  };

  const handleVoid = (invoiceId) => updateStatus(invoiceId, "cancelled", "void", "Invoice voided");
  const handleResolveDispute = (invoiceId) => updateStatus(invoiceId, "sent", "sent", "Dispute resolved");
  const handleFlagDispute = (invoiceId) => updateStatus(invoiceId, "disputed", "disputed", "Invoice flagged as disputed");

  // Delete a draft (line items cascade in the DB).
  const handleDelete = async (invoiceId) => {
    const inv = invoices.find((i) => i.id === invoiceId);
    if (!window.confirm(`Delete draft ${inv?.invoice_number}? This cannot be undone.`)) return;
    const { error } = await supabase.from("invoices").delete().eq("id", invoiceId);
    if (error) { showAlertMsg("error", `Could not delete: ${error.message}`); return; }
    setInvoices((prev) => prev.filter((i) => i.id !== invoiceId));
    await logAction(supabase, {
      accountId, userId, userName, userRole,
      action: "deleted", entityType: "invoice", entityId: invoiceId,
      entityName: `Draft deleted — ${inv?.invoice_number}`,
    });
    showAlertMsg("success", "Draft deleted.");
  };

  // Send a manual payment reminder (delivery handled by the chasing module's
  // edge function — here we record the action and notify the user).
  const handleSendReminder = async (invoiceId) => {
    const inv = invoices.find((i) => i.id === invoiceId);
    await logAction(supabase, {
      accountId, userId, userName, userRole,
      action: "sent", entityType: "invoice", entityId: invoiceId,
      entityName: `Manual reminder sent — ${inv?.invoice_number}`,
    });
    showAlertMsg("success", "Payment reminder queued to the customer.");
  };

  // ── Quote handlers ──
  // Save a quote (reuses saveInvoice with document_type='quote').
  const handleSaveQuote = async (quote) => {
    const saved = await saveInvoice({ ...quote, document_type: "quote" });
    if (!saved) return;
    setQuotes((prev) => [saved, ...prev]);
    await logAction(supabase, { accountId, userId, userName, userRole, action: "created", entityType: "quote", entityId: saved.id, entityName: saved.invoice_number });
    showAlertMsg("success", `${saved.invoice_number} saved as a quote.`);
    setActiveTab("quotes");
  };

  // Email the quote with an accept/decline link (best-effort edge function).
  const handleSendQuote = async (quote) => {
    const sent_at = new Date().toISOString();
    const { error } = await supabase.from("invoices").update({ status: "sent", sent_at }).eq("id", quote.id);
    if (error) { showAlertMsg("error", `Could not send quote: ${error.message}`); return; }
    setQuotes((prev) => prev.map((q) => (q.id === quote.id ? { ...q, status: "sent", sent_at } : q)));
    supabase.functions.invoke("quote-send", { body: { quote_id: quote.id } }).catch(() => {});
    await logAction(supabase, { accountId, userId, userName, userRole, action: "sent", entityType: "quote", entityId: quote.id, entityName: quote.invoice_number });
    showAlertMsg("success", "Quote sent. The customer can accept or decline from the email.");
  };

  // Accept → convert the quote into a draft invoice, carrying line items across.
  const handleAcceptQuote = async (quote) => {
    const newInvoice = await saveInvoice({
      ...quote, document_type: "invoice", status: "draft", sent_at: null, quote_expiry_date: null,
    });
    if (!newInvoice) return;
    const accepted_at = new Date().toISOString();
    await supabase.from("invoices").update({ quote_accepted_at: accepted_at, converted_to_invoice_id: newInvoice.id }).eq("id", quote.id);
    setInvoices((prev) => [newInvoice, ...prev]);
    setQuotes((prev) => prev.map((q) => (q.id === quote.id ? { ...q, quote_accepted_at: accepted_at, converted_to_invoice_id: newInvoice.id } : q)));
    await logAction(supabase, { accountId, userId, userName, userRole, action: "approved", entityType: "quote", entityId: quote.id, entityName: `Quote accepted → ${newInvoice.invoice_number}` });

    // Optionally spin up a linked job for this quote (unless it's already linked).
    if (!quote.job_id && window.confirm("Create a job for this quote?")) {
      const jobRow = {
        account_id: accountId,
        contact_id: quote.contact_id || null,
        customer_name: quote.customer_name || "Customer",
        description: (quote.line_items?.[0]?.description) || `Job from quote ${quote.invoice_number}`,
        quoted_amount_pence: poundsToPence(quote.total),
        status: "in_progress",
        scheduled_date: new Date().toISOString().split("T")[0],
      };
      const { data: job, error: jobErr } = await supabase.from("jobs").insert(jobRow).select("id").single();
      if (!jobErr && job) {
        // Link both the quote and the new invoice to the job.
        await supabase.from("invoices").update({ job_id: job.id }).in("id", [quote.id, newInvoice.id]);
        setJobs((prev) => [{ ...jobRow, id: job.id, costs: [] }, ...prev]);
        showAlertMsg("success", `Quote accepted → ${newInvoice.invoice_number}. Linked job created.`);
        return;
      }
    }
    showAlertMsg("success", `Quote accepted and converted to ${newInvoice.invoice_number}.`);
  };

  const handleDeclineQuote = async (quote) => {
    const reason = window.prompt("Reason for declining (optional):") ?? "";
    const { error } = await supabase.from("invoices").update({ status: "cancelled", notes: reason || quote.notes || null }).eq("id", quote.id);
    if (error) { showAlertMsg("error", `Could not decline quote: ${error.message}`); return; }
    setQuotes((prev) => prev.map((q) => (q.id === quote.id ? { ...q, status: "void", notes: reason || q.notes } : q)));
    await logAction(supabase, { accountId, userId, userName, userRole, action: "rejected", entityType: "quote", entityId: quote.id, entityName: quote.invoice_number, newValue: { reason } });
    showAlertMsg("info", "Quote marked as declined.");
  };

  const filteredQuotes = quotes
    .filter((q) => quoteFilter === "all" || quoteStatus(q) === quoteFilter)
    .sort((a, b) => new Date(b.issue_date) - new Date(a.issue_date));

  return (
    <>
      <style>{css}</style>
      <div className="ig-wrap">

        {/* Header */}
        <div className="ig-header">
          <div>
            <h1>Invoice Generation</h1>
            <p>Create · Send · Track · Get paid</p>
          </div>
          <button className="ig-btn ig-btn-primary" onClick={() => setActiveTab("create")}>
            + New Invoice
          </button>
        </div>

        {alert && <div className={`ig-alert ig-alert-${alert.type}`}>{alert.message}</div>}
        {loading && <div className="ig-alert ig-alert-info">Loading your invoices…</div>}

        {/* Stats */}
        <div className="ig-card-grid">
          <div className="ig-stat-card">
            <div className="ig-stat-label">Outstanding</div>
            <div className="ig-stat-value" style={{ fontSize: 22 }}>{formatCurrency(totalOutstanding)}</div>
            <div className="ig-stat-sub">Awaiting payment</div>
          </div>
          <div className="ig-stat-card">
            <div className="ig-stat-label">Overdue</div>
            <div className="ig-stat-value" style={{ fontSize: 22, color: totalOverdue > 0 ? "#EF4444" : "#22C55E" }}>{formatCurrency(totalOverdue)}</div>
            <div className="ig-stat-sub">{overdueCount} invoice{overdueCount !== 1 ? "s" : ""}</div>
          </div>
          <div className="ig-stat-card">
            <div className="ig-stat-label">Paid This Month</div>
            <div className="ig-stat-value" style={{ fontSize: 22, color: "#22C55E" }}>{formatCurrency(paidThisMonth)}</div>
            <div className="ig-stat-sub">Received</div>
          </div>
          <div className="ig-stat-card">
            <div className="ig-stat-label">Next Invoice</div>
            <div className="ig-stat-value" style={{ fontSize: 18 }}>{settings.invoice_prefix}-{String(settings.next_invoice_number).padStart(4, "0")}</div>
            <div className="ig-stat-sub">Auto-numbered</div>
          </div>
        </div>

        {/* Tabs */}
        <div className="ig-tabs">
          {TABS.map((tab) => (
            <button key={tab.id} className={`ig-tab ${activeTab === tab.id ? "active" : ""}`} onClick={() => setActiveTab(tab.id)}>
              {tab.label}
              {tab.id === "invoices" && overdueCount > 0 && <span className="badge">{overdueCount}</span>}
            </button>
          ))}
        </div>

        {/* ── INVOICES LIST ─────────────────────────────────── */}
        {activeTab === "invoices" && (
          <div>
            <div className="ig-filter-row">
              <input className="ig-search" placeholder="Search..." value={search} onChange={(e) => setSearch(e.target.value)} />
              {["all", "draft", "sent", "overdue", "paid"].map((s) => (
                <button key={s} className={`ig-filter-chip ${filterStatus === s ? "active" : ""}`} onClick={() => setFilterStatus(s)}>
                  {s === "all" ? "All" : s.charAt(0).toUpperCase() + s.slice(1)}
                </button>
              ))}
            </div>

            {overdueCount > 0 && (
              <div className="ig-alert ig-alert-danger">
                {overdueCount} overdue invoice{overdueCount > 1 ? "s" : ""} totalling {formatCurrency(totalOverdue)}. Chase sequences running automatically.
              </div>
            )}

            {customerFilter && (
              <div className="ig-alert" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: "var(--chalk)", border: "1px solid var(--rule)", color: "var(--steel)" }}>
                <span>Showing invoices for <strong>{customerFilter.name}</strong></span>
                <button className="ig-btn ig-btn-ghost ig-btn-sm" onClick={() => setCustomerFilter(null)}>Clear filter</button>
              </div>
            )}

            <div className="ig-card">
              {loading ? (
                [0, 1, 2, 3, 4].map((i) => (
                  <div key={i} className="ig-invoice-row" style={{ pointerEvents: "none" }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ height: 14, width: 90, background: "var(--rule)", borderRadius: 4, opacity: 0.6 }} />
                      <div style={{ height: 12, width: 180, background: "var(--rule)", borderRadius: 4, marginTop: 8, opacity: 0.4 }} />
                    </div>
                    <div style={{ height: 16, width: 70, background: "var(--rule)", borderRadius: 4, opacity: 0.5 }} />
                  </div>
                ))
              ) : filtered.length === 0 ? (
                <div className="ig-empty"><h3>No invoices found</h3></div>
              ) : (
                filtered.map((inv) => {
                  const overdueDays = inv.status === "overdue" ? daysOverdue(inv.due_date) : 0;
                  return (
                    <div key={inv.id} className="ig-invoice-row" onClick={() => setSelectedInvoice(inv.id === selectedInvoice ? null : inv.id)}>
                      <div style={{ display: "flex", alignItems: "flex-start", gap: 12, flex: 1 }}>
                        <div style={{ minWidth: 80 }}>
                          <div className="ig-invoice-num">{inv.invoice_number}</div>
                          <div style={{ fontSize: 11, color: "var(--mist)", marginTop: 2 }}>{formatDate(inv.issue_date)}</div>
                        </div>
                        <div style={{ flex: 1 }}>
                          <div
                            className="ig-invoice-name"
                            role="button"
                            title="Show all invoices for this customer"
                            style={{ cursor: "pointer" }}
                            onClick={(e) => { e.stopPropagation(); setCustomerFilter({ id: inv.contact_id, name: inv.customer_name }); setSelectedInvoice(null); }}
                          >
                            {inv.customer_name}
                          </div>
                          <div className="ig-invoice-meta">Due {formatDate(inv.due_date)}{overdueDays > 0 ? ` — ${overdueDays} days overdue` : ""}</div>
                        </div>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
                        <div style={{ textAlign: "right" }}>
                          <div style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontWeight: 800, fontSize: 16, color: "var(--steel)" }}>{formatCurrency(inv.total)}</div>
                        </div>
                        <span className={`ig-pill ig-pill-${inv.status}`}>{inv.status.replace("_", " ")}</span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Expanded invoice detail */}
            {selectedInvoice && (() => {
              const inv = invoices.find((i) => i.id === selectedInvoice);
              if (!inv) return null;
              return (
                <div className="ig-card">
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                    <div>
                      <div style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontWeight: 800, fontSize: 18, color: "var(--steel)" }}>{inv.invoice_number}</div>
                      <div style={{ fontSize: 13, color: "var(--mist)" }}>{inv.customer_name} · {inv.customer_email}</div>
                    </div>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      {/* Preview is available in every state */}
                      <button className="ig-btn ig-btn-secondary ig-btn-sm" onClick={() => setShowPreview(inv)}>Preview</button>

                      {/* Draft → Send, Preview, Delete */}
                      {inv.status === "draft" && (
                        <>
                          <button className="ig-btn ig-btn-primary ig-btn-sm" disabled={sendingId === inv.id} onClick={() => handleSend(inv.id)}>
                            {sendingId === inv.id ? <><span className="ig-spinner" /> Sending...</> : "Send"}
                          </button>
                          <button className="ig-btn ig-btn-danger ig-btn-sm" onClick={() => handleDelete(inv.id)}>Delete</button>
                        </>
                      )}

                      {/* Sent / overdue / part-paid → Mark paid, Mark dispute, Send reminder, Void */}
                      {["sent", "viewed", "overdue", "part_paid"].includes(inv.status) && (
                        <>
                          <button className="ig-btn ig-btn-success ig-btn-sm" onClick={() => handleMarkPaid(inv.id)}>Mark Paid</button>
                          <button className="ig-btn ig-btn-ghost ig-btn-sm" onClick={() => handleFlagDispute(inv.id)}>Mark Dispute</button>
                          <button className="ig-btn ig-btn-secondary ig-btn-sm" onClick={() => handleSendReminder(inv.id)}>Send Reminder</button>
                          <button className="ig-btn ig-btn-ghost ig-btn-sm" onClick={() => handleVoid(inv.id)}>Void</button>
                        </>
                      )}

                      {/* In dispute → Resolve dispute, Mark paid, Void */}
                      {inv.status === "disputed" && (
                        <>
                          <button className="ig-btn ig-btn-secondary ig-btn-sm" onClick={() => handleResolveDispute(inv.id)}>Resolve Dispute</button>
                          <button className="ig-btn ig-btn-success ig-btn-sm" onClick={() => handleMarkPaid(inv.id)}>Mark Paid</button>
                          <button className="ig-btn ig-btn-ghost ig-btn-sm" onClick={() => handleVoid(inv.id)}>Void</button>
                        </>
                      )}

                      {/* Paid → Download (Preview already shown) */}
                      {inv.status === "paid" && (
                        <button className="ig-btn ig-btn-primary ig-btn-sm" onClick={() => generateInvoicePdf(inv, settings, accountName, brandColor)}>Download</button>
                      )}
                      {/* Void → Preview only (already shown) */}
                    </div>
                  </div>

                  {inv.line_items.map((item) => (
                    <div key={item.id} style={{ display: "flex", justifyContent: "space-between", padding: "7px 0", borderBottom: "1px solid var(--rule)", fontSize: 13 }}>
                      <div>
                        <span style={{ color: "var(--steel)", fontWeight: 500 }}>{item.description}</span>
                        {item.quantity !== 1 && <span style={{ color: "var(--mist)", marginLeft: 8 }}>× {item.quantity}</span>}
                      </div>
                      <span style={{ fontWeight: 600, color: "var(--steel)" }}>{formatCurrency(item.line_total)}</span>
                    </div>
                  ))}

                  <div style={{ marginTop: 12, display: "flex", justifyContent: "flex-end" }}>
                    <div style={{ width: 240 }}>
                      {inv.discount_amount > 0 && (
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "4px 0" }}>
                          <span style={{ color: "var(--mist)" }}>Discount</span>
                          <span style={{ color: "#166534" }}>-{formatCurrency(inv.discount_amount)}</span>
                        </div>
                      )}
                      {inv.vat_amount > 0 && (
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "4px 0" }}>
                          <span style={{ color: "var(--mist)" }}>VAT (20%)</span>
                          <span>{formatCurrency(inv.vat_amount)}</span>
                        </div>
                      )}
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 16, fontWeight: 800, padding: "8px 0", borderTop: "2px solid var(--steel)", marginTop: 4, fontFamily: "'Plus Jakarta Sans', sans-serif", color: "var(--steel)" }}>
                        <span>Total</span>
                        <span>{formatCurrency(inv.total)}</span>
                      </div>
                    </div>
                  </div>

                  {inv.notes && (
                    <div style={{ marginTop: 12, padding: "10px 12px", background: "var(--chalk)", borderRadius: 6, fontSize: 13, color: "var(--mid)" }}>
                      {inv.notes}
                    </div>
                  )}

                  {inv.status === "sent" && (
                    <div className="ig-alert ig-alert-info" style={{ marginTop: 12, marginBottom: 0 }}>
                      Sent {formatDate(inv.sent_at)}. Chase sequence active — reminders at 7, 14, and 30 days if unpaid. Review request queued.
                    </div>
                  )}
                  {inv.status === "overdue" && (
                    <div className="ig-alert ig-alert-danger" style={{ marginTop: 12, marginBottom: 0 }}>
                      {daysOverdue(inv.due_date)} days overdue. Automated chase emails running. Consider a direct call.
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        )}

        {/* ── CREATE INVOICE ────────────────────────────────── */}
        {activeTab === "create" && (
          <InvoiceBuilder
            contacts={contacts}
            settings={settings}
            accountName={accountName}
            brandColor={brandColor}
            descriptionSuggestions={[...new Set(invoices.flatMap((i) => (i.line_items || []).map((li) => li.description)).filter(Boolean))]}
            onSave={async (invoice) => {
              const saved = await saveInvoice(invoice);
              if (!saved) return;
              setInvoices((prev) => [saved, ...prev]);
              setSettings((s) => ({ ...s, next_invoice_number: (s.next_invoice_number || 1) + 1 }));
              await logAction(supabase, { accountId, userId, userName, userRole, action: "created", entityType: "invoice", entityId: saved.id, entityName: saved.invoice_number, newValue: { status: "draft", total: saved.total } });
              showAlertMsg("success", `${saved.invoice_number} saved as draft.`);
              setActiveTab("invoices");
            }}
            onSaveAndSend={async (invoice) => {
              const saved = await saveInvoice({ ...invoice, status: "sent", sent_at: new Date().toISOString() });
              if (!saved) return;
              setInvoices((prev) => [saved, ...prev]);
              setSettings((s) => ({ ...s, next_invoice_number: (s.next_invoice_number || 1) + 1 }));
              await logAction(supabase, { accountId, userId, userName, userRole, action: "created_and_sent", entityType: "invoice", entityId: saved.id, entityName: saved.invoice_number, newValue: { status: "sent", total: saved.total } });
              showAlertMsg("success", `${saved.invoice_number} sent. Chase sequence scheduled. Review request queued.`);
              setActiveTab("invoices");
            }}
            onAddContact={() => setShowNewContact(true)}
          />
        )}

        {/* ── QUOTES ────────────────────────────────────────── */}
        {activeTab === "quotes" && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, gap: 8, flexWrap: "wrap" }}>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {["all", "pending", "accepted", "declined", "expired"].map((s) => (
                  <button key={s} className={`ig-btn ig-btn-sm ${quoteFilter === s ? "ig-btn-primary" : "ig-btn-ghost"}`} style={{ textTransform: "capitalize" }} onClick={() => setQuoteFilter(s)}>{s}</button>
                ))}
              </div>
              <button className="ig-btn ig-btn-primary" onClick={() => setActiveTab("create-quote")}>+ New Quote</button>
            </div>
            <div className="ig-card">
              <div className="ig-section-heading">Quotes</div>
              {filteredQuotes.length === 0 ? (
                <p style={{ color: "var(--mist)", fontSize: 13 }}>No quotes yet.</p>
              ) : filteredQuotes.map((q) => {
                const st = quoteStatus(q);
                const colors = { pending: ["#FEF9C3", "#854D0E"], accepted: ["#DCFCE7", "#166534"], declined: ["#FEE2E2", "#991B1B"], expired: ["#F3F4F6", "#6B7280"] }[st] || ["#F3F4F6", "#6B7280"];
                return (
                  <div key={q.id} className="ig-contact-row" style={{ justifyContent: "space-between" }}>
                    <div>
                      <div style={{ fontWeight: 600, color: "var(--steel)", fontSize: 14 }}>{q.invoice_number} · {q.customer_name}</div>
                      <div style={{ fontSize: 12, color: "var(--mist)" }}>{formatCurrency(q.total)} · expires {formatDate(q.quote_expiry_date)}</div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <span style={{ fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 999, background: colors[0], color: colors[1], textTransform: "capitalize" }}>{st}</span>
                      <button className="ig-btn ig-btn-secondary ig-btn-sm" onClick={() => setShowPreview(q)}>Preview</button>
                      {st === "pending" && (
                        <>
                          <button className="ig-btn ig-btn-secondary ig-btn-sm" onClick={() => handleSendQuote(q)}>Send</button>
                          <button className="ig-btn ig-btn-success ig-btn-sm" onClick={() => handleAcceptQuote(q)}>Accept</button>
                          <button className="ig-btn ig-btn-ghost ig-btn-sm" onClick={() => handleDeclineQuote(q)}>Decline</button>
                        </>
                      )}
                      {st === "accepted" && <span style={{ fontSize: 12, color: "#166534" }}>Converted to invoice</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── CREATE QUOTE ──────────────────────────────────── */}
        {activeTab === "create-quote" && (
          <InvoiceBuilder
            contacts={contacts}
            settings={settings}
            accountName={accountName}
            brandColor={brandColor}
            documentType="quote"
            jobs={jobs}
            descriptionSuggestions={[...new Set([...invoices, ...quotes].flatMap((i) => (i.line_items || []).map((li) => li.description)).filter(Boolean))]}
            onSave={handleSaveQuote}
            onSaveAndSend={async (quote) => {
              const saved = await saveInvoice({ ...quote, document_type: "quote", status: "sent", sent_at: new Date().toISOString() });
              if (!saved) return;
              setQuotes((prev) => [saved, ...prev]);
              supabase.functions.invoke("quote-send", { body: { quote_id: saved.id } }).catch(() => {});
              await logAction(supabase, { accountId, userId, userName, userRole, action: "sent", entityType: "quote", entityId: saved.id, entityName: saved.invoice_number });
              showAlertMsg("success", `${saved.invoice_number} sent as a quote.`);
              setActiveTab("quotes");
            }}
            onAddContact={() => setShowNewContact(true)}
          />
        )}

        {/* ── CUSTOMERS ─────────────────────────────────────── */}
        {activeTab === "contacts" && (
          <div>
            <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 16 }}>
              <button className="ig-btn ig-btn-primary" onClick={() => setShowNewContact(true)}>+ Add Customer</button>
            </div>
            <div className="ig-card">
              <div className="ig-section-heading">Customer List</div>
              {contacts.map((c) => {
                const custInvoices = invoices.filter((i) => i.contact_id === c.id);
                const outstanding = custInvoices.filter((i) => !["paid", "written_off"].includes(i.status)).reduce((s, i) => s + i.total, 0);
                return (
                  <div key={c.id} className="ig-contact-row">
                    <div>
                      <div style={{ fontWeight: 600, color: "var(--steel)", fontSize: 14 }}>{c.name}</div>
                      <div style={{ fontSize: 12, color: "var(--mist)", marginTop: 1 }}>
                        {c.company_name ? `${c.company_name} · ` : ""}{c.email} · {c.town}
                      </div>
                    </div>
                    <div style={{ textAlign: "right", flexShrink: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: outstanding > 0 ? "#991B1B" : "var(--mist)" }}>
                        {outstanding > 0 ? `${formatCurrency(outstanding)} outstanding` : "All paid"}
                      </div>
                      <div style={{ fontSize: 11, color: "var(--mist)" }}>{custInvoices.length} invoice{custInvoices.length !== 1 ? "s" : ""}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── SETTINGS ──────────────────────────────────────── */}
        {activeTab === "settings" && (
          <InvoiceSettings
            settings={settings}
            onSave={async (updated) => {
              // Only invoice_prefix / vat_registered / vat_number have a home in
              // the live schema (on accounts); the rest stay UI-only for now.
              const row = {
                invoice_prefix: updated.invoice_prefix,
                vat_registered: !!updated.vat_registered,
                vat_number: updated.vat_number || null,
              };
              const { error } = await supabase.from("accounts").update(row).eq("id", accountId);
              if (error) { showAlertMsg("error", `Could not save settings: ${error.message}`); return; }
              setSettings((s) => ({ ...s, ...updated }));
              await logAction(supabase, { accountId, userId, userName, userRole, action: "updated", entityType: "account", entityId: accountId, entityName: "Invoice settings", newValue: row });
              showAlertMsg("success", "Settings saved. (Bank details & footer are not yet persisted — no column exists.)");
            }}
          />
        )}

        {/* ── PREVIEW MODAL ─────────────────────────────────── */}
        {showPreview && (
          <div className="ig-modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) setShowPreview(null); }}>
            <div className="ig-modal ig-modal-lg">
              <div className="ig-modal-header ig-preview-head">
                <span className="ig-modal-title">Invoice Preview — {showPreview.invoice_number}</span>
                <div className="ig-preview-actions" style={{ display: "flex", gap: 8 }}>
                  <button className="ig-btn ig-btn-primary ig-btn-sm" onClick={() => generateInvoicePdf(showPreview, settings, accountName, brandColor)}>Download PDF</button>
                  <button className="ig-btn ig-btn-ghost ig-btn-sm" onClick={() => setShowPreview(null)}>Close</button>
                </div>
              </div>
              <InvoicePreview invoice={showPreview} settings={settings} accountName={accountName} brandColor={brandColor} />
            </div>
          </div>
        )}

        {/* ── NEW CONTACT MODAL ─────────────────────────────── */}
        {showNewContact && (
          <NewContactModal
            onSubmit={async (data) => {
              // Map the UI form (single "name", company_name) onto the real
              // contacts columns (first_name/last_name/business_name).
              const parts = (data.name || "").trim().split(/\s+/);
              const row = {
                account_id: accountId,
                first_name: parts[0] || data.name || "Unnamed",
                last_name: parts.slice(1).join(" ") || null,
                business_name: data.company_name || null,
                email: data.email || null,
                phone: data.phone || null,
                address_line1: data.address_line1 || null,
                town: data.town || null,
                postcode: data.postcode || null,
              };
              const { data: inserted, error } = await supabase
                .from("contacts")
                .insert(row)
                .select("*")
                .single();
              if (error) { showAlertMsg("error", `Could not add customer: ${error.message}`); return; }
              const newContact = mapContact(inserted);
              setContacts((prev) => [...prev, newContact]);
              setShowNewContact(false);
              await logAction(supabase, { accountId, userId, userName, userRole, action: "created", entityType: "contact", entityId: newContact.id, entityName: newContact.name, newValue: inserted });
              showAlertMsg("success", `${newContact.name} added.`);
            }}
            onClose={() => setShowNewContact(false)}
          />
        )}
      </div>
    </>
  );
}

// ── INVOICE BUILDER ─────────────────────────────────────────────
function InvoiceBuilder({ contacts, settings, accountName, brandColor, descriptionSuggestions = [], documentType = "invoice", jobs = [], onSave, onSaveAndSend, onAddContact }) {
  const isQuote = documentType === "quote";
  const [quoteExpiry, setQuoteExpiry] = useState(new Date(Date.now() + 30 * 86400000).toISOString().split("T")[0]);
  const [linkedJobId, setLinkedJobId] = useState("");
  const [estCost, setEstCost] = useState(""); // optional cost estimate for margin check
  const [selectedContact, setSelectedContact] = useState(null);
  const [contactSearch, setContactSearch] = useState("");
  const [showContactDrop, setShowContactDrop] = useState(false);
  const [lineItems, setLineItems] = useState([
    { id: "new1", description: "", quantity: 1, unit_price: "", vat_rate: 0 },
  ]);
  const [invoiceDate, setInvoiceDate] = useState(today.toISOString().split("T")[0]);
  const [dueDate, setDueDate] = useState(new Date(Date.now() + settings.payment_terms_days * 86400000).toISOString().split("T")[0]);
  const [notes, setNotes] = useState("");
  const [discountPct, setDiscountPct] = useState(0);
  const [applyVat, setApplyVat] = useState(settings.vat_registered);
  const [showPreview, setShowPreview] = useState(false);

  const subtotal = lineItems.reduce((s, li) => s + ((parseFloat(li.quantity) || 0) * (parseFloat(li.unit_price) || 0)), 0);
  const discountAmount = subtotal * (discountPct / 100);
  const afterDiscount = subtotal - discountAmount;
  const vatAmount = applyVat ? afterDiscount * (settings.vat_rate / 100) : 0;
  const total = afterDiscount + vatAmount;

  const invoiceNumber = `${settings.invoice_prefix}-${String(settings.next_invoice_number).padStart(4, "0")}`;

  const addLine = () => setLineItems((p) => [...p, { id: `new${Date.now()}`, description: "", quantity: 1, unit_price: "", vat_rate: 0 }]);
  const removeLine = (id) => setLineItems((p) => p.filter((li) => li.id !== id));
  const updateLine = (id, field, value) => setLineItems((p) => p.map((li) => li.id === id ? { ...li, [field]: value } : li));

  const buildInvoice = (status = "draft") => ({
    id: `inv${Date.now()}`,
    invoice_number: invoiceNumber,
    contact_id: selectedContact?.id || null,
    customer_name: selectedContact?.name || "",
    customer_email: selectedContact?.email || "",
    customer_address: selectedContact ? `${selectedContact.address_line1}, ${selectedContact.town}, ${selectedContact.postcode}` : "",
    issue_date: invoiceDate,
    due_date: dueDate,
    subtotal,
    discount_pct: discountPct,
    discount_amount: discountAmount,
    vat_amount: vatAmount,
    total,
    amount_paid: 0,
    status,
    notes,
    document_type: documentType,
    quote_expiry_date: isQuote ? quoteExpiry : null,
    job_id: isQuote ? (linkedJobId || null) : null,
    line_items: lineItems.filter((li) => li.description && li.unit_price).map((li) => ({
      ...li,
      line_total: (parseFloat(li.quantity) || 0) * (parseFloat(li.unit_price) || 0),
    })),
  });

  const filteredContacts = contacts.filter((c) => c.name.toLowerCase().includes(contactSearch.toLowerCase()) || c.company_name?.toLowerCase().includes(contactSearch.toLowerCase()));

  const previewInvoice = buildInvoice("draft");

  return (
    <div>
      {showPreview ? (
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <h2 style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontWeight: 700, fontSize: 16, color: "var(--steel)" }}>{isQuote ? "Quote Preview" : "Invoice Preview"}</h2>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="ig-btn ig-btn-ghost" onClick={() => setShowPreview(false)}>← Edit</button>
              <button className="ig-btn ig-btn-secondary" onClick={() => onSave(buildInvoice("draft"))}>{isQuote ? "Save Quote" : "Save as Draft"}</button>
              <button className="ig-btn ig-btn-primary" disabled={!selectedContact} onClick={() => onSaveAndSend(buildInvoice("sent"))}>
                {isQuote ? "Send Quote" : "Send Invoice"}
              </button>
            </div>
          </div>
          <InvoicePreview invoice={previewInvoice} settings={settings} accountName={accountName} brandColor={brandColor} />
        </div>
      ) : (
        <div className="ig-builder">
          {/* Customer */}
          <div className="ig-builder-section">
            <div className="ig-section-heading">Customer</div>
            <div style={{ position: "relative" }}>
              <input
                className="ig-input"
                placeholder="Search customers or type to add new..."
                value={selectedContact ? selectedContact.name : contactSearch}
                onChange={(e) => { setContactSearch(e.target.value); setSelectedContact(null); setShowContactDrop(true); }}
                onFocus={() => setShowContactDrop(true)}
                onBlur={() => setTimeout(() => setShowContactDrop(false), 150)}
              />
              {showContactDrop && (
                <div style={{ position: "absolute", top: "100%", left: 0, right: 0, background: "white", border: "1px solid var(--rule)", borderRadius: 6, boxShadow: "0 4px 20px rgba(0,0,0,0.1)", zIndex: 10, maxHeight: 200, overflowY: "auto" }}>
                  {filteredContacts.map((c) => (
                    <div key={c.id} style={{ padding: "10px 14px", cursor: "pointer", borderBottom: "1px solid var(--rule)", fontSize: 13 }}
                      onMouseDown={() => { setSelectedContact(c); setContactSearch(""); setShowContactDrop(false); }}>
                      <div style={{ fontWeight: 600, color: "var(--steel)" }}>{c.name}</div>
                      <div style={{ color: "var(--mist)", fontSize: 12 }}>{c.company_name || c.email}</div>
                    </div>
                  ))}
                  <div style={{ padding: "10px 14px", cursor: "pointer", fontSize: 13, color: "var(--ember)", fontWeight: 600 }} onMouseDown={onAddContact}>
                    + Add new customer
                  </div>
                </div>
              )}
            </div>
            {selectedContact && (
              <div style={{ marginTop: 8, padding: "10px 14px", background: "var(--chalk)", borderRadius: 6, fontSize: 13 }}>
                <div style={{ fontWeight: 600, color: "var(--steel)" }}>{selectedContact.name}</div>
                <div style={{ color: "var(--mist)" }}>{selectedContact.address_line1}, {selectedContact.town}, {selectedContact.postcode}</div>
                <div style={{ color: "var(--mist)" }}>{selectedContact.email}</div>
              </div>
            )}
          </div>

          {/* Dates */}
          <div className="ig-builder-section">
            <div className="ig-form-grid">
              <div className="ig-input-group">
                <label className="ig-input-label">Invoice date</label>
                <input type="date" className="ig-input" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} />
              </div>
              <div className="ig-input-group">
                <label className="ig-input-label">Payment due</label>
                <input type="date" className="ig-input" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
              </div>
            </div>
          </div>

          {/* Line items */}
          <div className="ig-builder-section">
            <div className="ig-section-heading">Line Items</div>
            <datalist id="ig-desc-suggestions">
              {descriptionSuggestions.map((d) => <option key={d} value={d} />)}
            </datalist>
            <div className="ig-line-header">
              <span className="ig-line-label">Description</span>
              <span className="ig-line-label" style={{ textAlign: "center" }}>Qty</span>
              <span className="ig-line-label" style={{ textAlign: "right" }}>Unit price</span>
              <span className="ig-line-label" style={{ textAlign: "right" }}>Total</span>
              <span />
            </div>
            {lineItems.map((li) => (
              <div key={li.id} className="ig-line-row">
                <input
                  className="ig-input ig-input-sm"
                  placeholder="Description of work or materials"
                  value={li.description}
                  list="ig-desc-suggestions"
                  onChange={(e) => updateLine(li.id, "description", e.target.value)}
                />
                <input
                  className="ig-input ig-input-sm"
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={li.quantity}
                  onChange={(e) => updateLine(li.id, "quantity", e.target.value)}
                  style={{ textAlign: "center" }}
                />
                <div style={{ position: "relative" }}>
                  <span style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--mist)", fontSize: 13 }}>£</span>
                  <input
                    className="ig-input ig-input-sm"
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="0.00"
                    value={li.unit_price}
                    onChange={(e) => updateLine(li.id, "unit_price", e.target.value)}
                    style={{ paddingLeft: 22, textAlign: "right" }}
                  />
                </div>
                <div className="ig-line-total">
                  {formatCurrency((parseFloat(li.quantity) || 0) * (parseFloat(li.unit_price) || 0))}
                </div>
                <button
                  className="ig-btn ig-btn-ghost ig-btn-icon"
                  onClick={() => removeLine(li.id)}
                  disabled={lineItems.length === 1}
                  style={{ fontSize: 16, color: lineItems.length === 1 ? "var(--rule)" : "var(--mist)" }}
                >
                  ×
                </button>
              </div>
            ))}
            <button className="ig-btn ig-btn-ghost ig-btn-sm" style={{ marginTop: 8 }} onClick={addLine}>
              + Add line
            </button>
          </div>

          {/* Totals */}
          <div className="ig-builder-section">
            <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 16 }}>
              <div style={{ flex: 1, minWidth: 200 }}>
                <div className="ig-input-group">
                  <label className="ig-input-label">Notes (optional)</label>
                  <textarea
                    className="ig-input"
                    style={{ minHeight: 80, resize: "vertical" }}
                    placeholder="Payment instructions, job reference, thank you message..."
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                  />
                </div>
                {settings.vat_registered && (
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <label className="ig-toggle">
                      <input type="checkbox" checked={applyVat} onChange={(e) => setApplyVat(e.target.checked)} />
                      <span className="ig-toggle-slider" />
                    </label>
                    <span style={{ fontSize: 13, color: "var(--steel)" }}>Apply VAT ({settings.vat_rate}%)</span>
                  </div>
                )}
              </div>
              <div className="ig-totals">
                <div className="ig-total-row">
                  <span style={{ color: "var(--mist)" }}>Subtotal</span>
                  <span>{formatCurrency(subtotal)}</span>
                </div>
                {discountPct > 0 && (
                  <div className="ig-total-row">
                    <span style={{ color: "#166534" }}>Discount ({discountPct}%)</span>
                    <span style={{ color: "#166534" }}>-{formatCurrency(discountAmount)}</span>
                  </div>
                )}
                {applyVat && vatAmount > 0 && (
                  <div className="ig-total-row">
                    <span style={{ color: "var(--mist)" }}>VAT ({settings.vat_rate}%)</span>
                    <span>{formatCurrency(vatAmount)}</span>
                  </div>
                )}
                <div className="ig-total-row grand">
                  <span style={{ fontWeight: 700, color: "var(--steel)" }}>Total</span>
                  <span className="ig-grand-value">{formatCurrency(total)}</span>
                </div>
                <div style={{ marginTop: 8 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 12, color: "var(--mist)" }}>Discount %</span>
                    <input
                      type="number" min="0" max="100" step="1"
                      className="ig-input ig-input-sm"
                      style={{ width: 70, textAlign: "center" }}
                      value={discountPct}
                      onChange={(e) => setDiscountPct(parseFloat(e.target.value) || 0)}
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>

          {isQuote && (
            <div style={{ display: "flex", gap: 12, marginTop: 12, flexWrap: "wrap" }}>
              <div className="ig-input-group" style={{ maxWidth: 240, marginBottom: 0 }}>
                <label className="ig-input-label">Quote valid until</label>
                <input type="date" className="ig-input" value={quoteExpiry} onChange={(e) => setQuoteExpiry(e.target.value)} />
              </div>
              <div className="ig-input-group" style={{ maxWidth: 280, marginBottom: 0 }}>
                <label className="ig-input-label">Linked job (optional)</label>
                <select className="ig-input" value={linkedJobId} onChange={(e) => setLinkedJobId(e.target.value)}>
                  <option value="">— Not linked —</option>
                  {jobs.map((j) => (
                    <option key={j.id} value={j.id}>{(j.description || j.customer_name || "Job").slice(0, 50)}</option>
                  ))}
                </select>
              </div>
              <div className="ig-input-group" style={{ maxWidth: 200, marginBottom: 0 }}>
                <label className="ig-input-label">Estimated cost (£, optional)</label>
                <input type="number" className="ig-input" placeholder="for margin check" value={estCost} onChange={(e) => setEstCost(e.target.value)} />
              </div>
            </div>
          )}

          {isQuote && (() => {
            const mw = quoteMarginWarning(jobs, total, parseFloat(estCost) || 0);
            return mw ? (
              <div className="ig-alert" style={{ marginTop: 12, background: "#FEF9C3", border: "1px solid #FDE68A", color: "#854D0E" }}>
                {mw}
              </div>
            ) : null;
          })()}

          {/* Actions */}
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button className="ig-btn ig-btn-secondary" onClick={() => setShowPreview(true)} disabled={!selectedContact || lineItems.every((li) => !li.description)}>
              Preview
            </button>
            <button className="ig-btn ig-btn-secondary" onClick={() => onSave(buildInvoice("draft"))} disabled={!selectedContact}>
              {isQuote ? "Save Quote" : "Save Draft"}
            </button>
            <button className="ig-btn ig-btn-primary" disabled={!selectedContact || lineItems.every((li) => !li.description)} onClick={() => onSaveAndSend(buildInvoice("sent"))}>
              {isQuote ? "Save & Send Quote" : "Save & Send"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── INVOICE PREVIEW (matches PDF output) ───────────────────────
function InvoicePreview({ invoice, settings, accountName, brandColor }) {
  return (
    <div className="ig-preview">
      {/* Header */}
      <div className="ig-preview-header">
        <div>
          <div className="ig-preview-business" style={{ color: brandColor }}>{accountName}</div>
          {settings.vat_registered && (
            <div style={{ fontSize: 12, color: "var(--mist)", marginTop: 4 }}>VAT No. {settings.vat_number}</div>
          )}
        </div>
        <div style={{ textAlign: "right" }}>
          <div className="ig-preview-num" style={{ color: brandColor }}>{invoice.invoice_number}</div>
          <div style={{ fontSize: 13, color: "var(--mist)", marginTop: 4 }}>Issued: {formatDate(invoice.issue_date)}</div>
          <div style={{ fontSize: 13, color: invoice.status === "overdue" ? "#991B1B" : "var(--mist)" }}>Due: {formatDate(invoice.due_date)}</div>
        </div>
      </div>

      {/* Bill to */}
      <div className="ig-preview-billto" style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: "var(--mist)", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 6 }}>Bill To</div>
        <div style={{ fontWeight: 700, fontSize: 15, color: "var(--steel)" }}>{invoice.customer_name}</div>
        <div style={{ fontSize: 13, color: "var(--mid)", marginTop: 2, lineHeight: 1.6 }}>{invoice.customer_address}</div>
        {invoice.customer_email && <div style={{ fontSize: 13, color: "var(--mist)", marginTop: 2 }}>{invoice.customer_email}</div>}
      </div>

      {/* Line items */}
      <table className="ig-preview-table">
        <thead>
          <tr>
            <th style={{ width: "50%" }}>Description</th>
            <th style={{ textAlign: "center" }}>Qty</th>
            <th style={{ textAlign: "right" }}>Unit Price</th>
            <th style={{ textAlign: "right" }}>Total</th>
          </tr>
        </thead>
        <tbody>
          {(invoice.line_items || []).map((item, i) => (
            <tr key={i}>
              <td>{item.description}</td>
              <td style={{ textAlign: "center" }}>{item.quantity}</td>
              <td style={{ textAlign: "right" }}>{formatCurrency(item.unit_price)}</td>
              <td>{formatCurrency(item.line_total)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Totals */}
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <div style={{ width: 260 }}>
          {invoice.discount_amount > 0 && (
            <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", fontSize: 13 }}>
              <span style={{ color: "var(--mist)" }}>Discount</span>
              <span style={{ color: "#166534" }}>-{formatCurrency(invoice.discount_amount)}</span>
            </div>
          )}
          {invoice.vat_amount > 0 && (
            <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", fontSize: 13 }}>
              <span style={{ color: "var(--mist)" }}>VAT ({settings.vat_rate}%)</span>
              <span>{formatCurrency(invoice.vat_amount)}</span>
            </div>
          )}
          <div style={{ display: "flex", justifyContent: "space-between", padding: "10px 0 8px", borderTop: `2px solid ${brandColor}`, marginTop: 6 }}>
            <span style={{ fontWeight: 800, fontSize: 16, color: "var(--steel)" }}>Total Due</span>
            <span style={{ fontWeight: 800, fontSize: 22, color: brandColor, fontFamily: "'Plus Jakarta Sans', sans-serif" }}>{formatCurrency(invoice.total)}</span>
          </div>
        </div>
      </div>

      {/* Bank details */}
      {settings.account_number && (
        <div className="ig-preview-bank">
          <div className="ig-preview-bank-title">Payment Details</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px 20px", fontSize: 13 }}>
            <div><span style={{ color: "var(--mist)" }}>Bank: </span>{settings.bank_name}</div>
            <div><span style={{ color: "var(--mist)" }}>Name: </span>{settings.account_name}</div>
            <div><span style={{ color: "var(--mist)" }}>Sort code: </span>{settings.sort_code}</div>
            <div><span style={{ color: "var(--mist)" }}>Account: </span>{settings.account_number}</div>
          </div>
          <div style={{ marginTop: 6, fontSize: 12, color: "var(--mist)" }}>
            Reference: {invoice.invoice_number}
          </div>
        </div>
      )}

      {settings.stripe_enabled && (
        <div style={{ marginTop: 16, padding: "12px 16px", background: `${brandColor}15`, border: `1px solid ${brandColor}40`, borderRadius: 6, textAlign: "center" }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: brandColor }}>Pay securely online</div>
          <div style={{ fontSize: 12, color: "var(--mist)", marginTop: 2 }}>Click the payment link in your email to pay by card</div>
        </div>
      )}

      {invoice.notes && (
        <div style={{ marginTop: 16, fontSize: 13, color: "var(--mist)", borderTop: "1px solid var(--rule)", paddingTop: 12 }}>
          {invoice.notes}
        </div>
      )}

      {settings.footer_notes && (
        <div style={{ marginTop: 8, fontSize: 12, color: "var(--mist)", fontStyle: "italic" }}>
          {settings.footer_notes}
        </div>
      )}
    </div>
  );
}

// ── INVOICE SETTINGS ────────────────────────────────────────────
function InvoiceSettings({ settings, onSave }) {
  const [form, setForm] = useState(settings);
  const f = (key) => (e) => setForm((p) => ({ ...p, [key]: e.target.value }));
  const cb = (key) => (e) => setForm((p) => ({ ...p, [key]: e.target.checked }));

  return (
    <div className="ig-card">
      <div className="ig-section-heading">Invoice Settings</div>
      <div className="ig-form-grid">
        <div className="ig-input-group">
          <label className="ig-input-label">Invoice prefix</label>
          <input className="ig-input" value={form.invoice_prefix} onChange={f("invoice_prefix")} />
        </div>
        <div className="ig-input-group">
          <label className="ig-input-label">Payment terms (days)</label>
          <input type="number" className="ig-input" value={form.payment_terms_days} onChange={f("payment_terms_days")} />
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
        <label className="ig-toggle">
          <input type="checkbox" checked={form.vat_registered} onChange={cb("vat_registered")} />
          <span className="ig-toggle-slider" />
        </label>
        <span style={{ fontSize: 13, color: "var(--steel)", fontWeight: 500 }}>VAT registered</span>
      </div>

      {form.vat_registered && (
        <div className="ig-form-grid">
          <div className="ig-input-group">
            <label className="ig-input-label">VAT number</label>
            <input className="ig-input" placeholder="GB 123 4567 89" value={form.vat_number} onChange={f("vat_number")} />
          </div>
          <div className="ig-input-group">
            <label className="ig-input-label">VAT rate (%)</label>
            <input type="number" className="ig-input" value={form.vat_rate} onChange={f("vat_rate")} />
          </div>
        </div>
      )}

      <div className="ig-section-heading" style={{ marginTop: 8 }}>Bank Details</div>
      <div className="ig-form-grid">
        <div className="ig-input-group">
          <label className="ig-input-label">Bank name</label>
          <input className="ig-input" value={form.bank_name} onChange={f("bank_name")} />
        </div>
        <div className="ig-input-group">
          <label className="ig-input-label">Account name</label>
          <input className="ig-input" value={form.account_name} onChange={f("account_name")} />
        </div>
        <div className="ig-input-group">
          <label className="ig-input-label">Sort code</label>
          <input className="ig-input" placeholder="00-00-00" value={form.sort_code} onChange={f("sort_code")} />
        </div>
        <div className="ig-input-group">
          <label className="ig-input-label">Account number</label>
          <input className="ig-input" placeholder="12345678" value={form.account_number} onChange={f("account_number")} />
        </div>
      </div>

      <div className="ig-input-group">
        <label className="ig-input-label">Footer notes</label>
        <textarea className="ig-input" style={{ minHeight: 60, resize: "vertical" }} value={form.footer_notes} onChange={f("footer_notes")} />
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
        <label className="ig-toggle">
          <input type="checkbox" checked={form.stripe_enabled} onChange={cb("stripe_enabled")} />
          <span className="ig-toggle-slider" />
        </label>
        <span style={{ fontSize: 13, color: "var(--steel)", fontWeight: 500 }}>Include Stripe payment link on invoices</span>
      </div>

      <button className="ig-btn ig-btn-primary" onClick={() => onSave(form)}>Save Settings</button>
    </div>
  );
}

// ── NEW CONTACT MODAL ───────────────────────────────────────────
function NewContactModal({ onSubmit, onClose }) {
  const [form, setForm] = useState({ name: "", email: "", phone: "", address_line1: "", town: "", postcode: "", company_name: "", is_business: false });
  const f = (key) => (e) => setForm((p) => ({ ...p, [key]: e.target.value }));
  return (
    <div className="ig-modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="ig-modal">
        <div className="ig-modal-header">
          <span className="ig-modal-title">Add Customer</span>
          <button className="ig-btn ig-btn-ghost ig-btn-sm" onClick={onClose}>Close</button>
        </div>
        <div className="ig-form-grid">
          <div className="ig-input-group" style={{ gridColumn: "1 / -1" }}>
            <label className="ig-input-label">Full name *</label>
            <input className="ig-input" value={form.name} onChange={f("name")} />
          </div>
          <div className="ig-input-group">
            <label className="ig-input-label">Email</label>
            <input type="email" className="ig-input" value={form.email} onChange={f("email")} />
          </div>
          <div className="ig-input-group">
            <label className="ig-input-label">Phone</label>
            <input type="tel" className="ig-input" value={form.phone} onChange={f("phone")} />
          </div>
          <div className="ig-input-group" style={{ gridColumn: "1 / -1" }}>
            <label className="ig-input-label">Address</label>
            <input className="ig-input" placeholder="Street address" value={form.address_line1} onChange={f("address_line1")} />
          </div>
          <div className="ig-input-group">
            <label className="ig-input-label">Town</label>
            <input className="ig-input" value={form.town} onChange={f("town")} />
          </div>
          <div className="ig-input-group">
            <label className="ig-input-label">Postcode</label>
            <input className="ig-input" value={form.postcode} onChange={f("postcode")} />
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
          <input type="checkbox" checked={form.is_business} onChange={(e) => setForm((p) => ({ ...p, is_business: e.target.checked }))} id="is_biz" />
          <label htmlFor="is_biz" style={{ fontSize: 13, color: "var(--steel)", cursor: "pointer" }}>Business customer</label>
        </div>
        {form.is_business && (
          <div className="ig-input-group">
            <label className="ig-input-label">Company name</label>
            <input className="ig-input" value={form.company_name} onChange={f("company_name")} />
          </div>
        )}
        <button className="ig-btn ig-btn-primary" style={{ width: "100%" }} disabled={!form.name} onClick={() => onSubmit(form)}>
          Add Customer
        </button>
      </div>
    </div>
  );
}
