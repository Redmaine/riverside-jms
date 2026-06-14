/**
 * InvoiceChasing.jsx
 * Your Company AI — Automated Invoice Chasing Module
 *
 * DEPENDENCIES (injected via props from core platform):
 *   supabase        — Supabase client instance
 *   accountId       — Current account UUID
 *   userId          — Current platform_user UUID
 *   userName        — Current user display name
 *   userRole        — 'owner' | 'manager' | 'staff'
 *   accountName     — Business name
 *   brandColor      — Hex colour from branding table
 *
 * HOW IT WORKS:
 *   When an invoice is marked as sent (InvoiceGeneration module),
 *   a Supabase trigger creates entries in invoice_chase_queue for
 *   days 7, 14, and 30. A daily cron Edge Function runs at 08:00
 *   and dispatches emails via Resend for any due entries.
 *   The business owner can pause, skip, or override any step.
 *   Open Banking (TrueLayer) is an add-on at £2.99/mo — when enabled,
 *   payment confirmation is automatic (no manual "mark paid" needed).
 *
 * DATABASE TABLES USED:
 *   invoice_chase_queue     — Scheduled chase emails per invoice
 *   invoice_chase_settings  — Email templates and sequence config per account
 *   invoice_chase_log       — Record of every email sent
 *   invoices                — Invoice status (read + update)
 *   contacts                — Customer details (read only)
 *   audit_log               — Audit trail
 *
 * EXTERNAL:
 *   Resend              — Email delivery
 *   TrueLayer           — Open Banking payment confirmation (add-on)
 *   Stripe              — Payment link in chase emails
 *
 * SCHEMA — add these tables to supabase_schema.sql:
 *
 * CREATE TABLE public.invoice_chase_queue (
 *   id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
 *   account_id      uuid REFERENCES public.accounts(id) ON DELETE CASCADE,
 *   invoice_id      uuid REFERENCES public.invoices(id) ON DELETE CASCADE,
 *   chase_day       int NOT NULL CHECK (chase_day IN (7, 14, 30)),
 *   scheduled_for   timestamptz NOT NULL,
 *   status          text DEFAULT 'scheduled' CHECK (status IN
 *     ('scheduled','sent','skipped','paused','failed')),
 *   sent_at         timestamptz,
 *   opened_at       timestamptz,
 *   skip_reason     text,
 *   override_message text,
 *   created_at      timestamptz DEFAULT now()
 * );
 *
 * CREATE TABLE public.invoice_chase_settings (
 *   id                  uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
 *   account_id          uuid REFERENCES public.accounts(id) ON DELETE CASCADE UNIQUE,
 *   sequence_enabled    boolean DEFAULT true,
 *   day7_enabled        boolean DEFAULT true,
 *   day14_enabled       boolean DEFAULT true,
 *   day30_enabled       boolean DEFAULT true,
 *   day7_subject        text DEFAULT 'Friendly reminder — invoice {invoice_number} due',
 *   day14_subject       text DEFAULT 'Invoice {invoice_number} — payment overdue',
 *   day30_subject       text DEFAULT 'Final notice — invoice {invoice_number}',
 *   day7_body           text,
 *   day14_body          text,
 *   day30_body          text,
 *   send_from_name      text,
 *   pause_on_dispute    boolean DEFAULT true,
 *   pause_on_part_pay   boolean DEFAULT true,
 *   open_banking_enabled boolean DEFAULT false,
 *   open_banking_addon  boolean DEFAULT false,
 *   created_at          timestamptz DEFAULT now(),
 *   updated_at          timestamptz DEFAULT now()
 * );
 *
 * CREATE TABLE public.invoice_chase_log (
 *   id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
 *   account_id      uuid REFERENCES public.accounts(id) ON DELETE CASCADE,
 *   invoice_id      uuid REFERENCES public.invoices(id) ON DELETE CASCADE,
 *   chase_day       int NOT NULL,
 *   sent_at         timestamptz DEFAULT now(),
 *   recipient_email text NOT NULL,
 *   subject         text,
 *   opened          boolean DEFAULT false,
 *   opened_at       timestamptz,
 *   bounced         boolean DEFAULT false,
 *   created_at      timestamptz DEFAULT now()
 * );
 *
 * -- Cron Edge Function (runs daily at 08:00 UTC):
 * -- SELECT * FROM public.invoice_chase_queue
 * -- WHERE status = 'scheduled' AND scheduled_for <= now()
 * -- For each row: send email via Resend, update status = 'sent', sent_at = now()
 * -- Also check invoices.due_date < now() AND status = 'sent' → update to 'overdue'
 *
 * Enable RLS on all tables with standard account_id policies.
 */

import { useState, useMemo, useEffect, useCallback } from "react";

// ── CONSTANTS ───────────────────────────────────────────────────
const TABS = [
  { id: "overview",   label: "Overview" },
  { id: "queue",      label: "Chase Queue" },
  { id: "templates",  label: "Email Templates" },
  { id: "log",        label: "Activity Log" },
  { id: "settings",   label: "Settings" },
];

const CHASE_DAYS = [7, 14, 30];

const CHASE_TONE = {
  7:  { label: "Friendly reminder",  color: "#3B82F6", bg: "#EFF6FF" },
  14: { label: "Polite but firm",    color: "#EAB308", bg: "#FFFBEB" },
  30: { label: "Final notice",       color: "#EF4444", bg: "#FEF2F2" },
};

// ── DEFAULT EMAIL TEMPLATES ──────────────────────────────────────
const DEFAULT_TEMPLATES = {
  day7: {
    subject: "Friendly reminder — invoice {invoice_number} due",
    body: `Hi {customer_name},

I hope you're well. Just a friendly reminder that invoice {invoice_number} for {amount} was due on {due_date}.

If you've already sent payment, please ignore this — it may just be crossing in the post. If not, you can pay securely online using the link below.

{payment_link}

If you have any questions about the invoice, just reply to this email.

Thanks again for your business.

{business_name}`,
  },
  day14: {
    subject: "Invoice {invoice_number} — payment now overdue",
    body: `Hi {customer_name},

Invoice {invoice_number} for {amount} was due on {due_date} and remains unpaid.

I'd appreciate payment as soon as possible. You can settle this securely online:

{payment_link}

If there's a problem with the invoice or you'd like to discuss payment, please get in touch — I'm happy to help resolve any issues quickly.

{business_name}`,
  },
  day30: {
    subject: "Final notice — invoice {invoice_number} — {amount} outstanding",
    body: `Hi {customer_name},

Despite previous reminders, invoice {invoice_number} for {amount} — originally due {due_date} — remains outstanding.

This is a final notice before the matter is referred for further action. Please arrange payment immediately using the link below.

{payment_link}

If you believe there is an error or you would like to make a payment arrangement, please contact us within 48 hours.

{business_name}`,
  },
};

// ── STYLES ──────────────────────────────────────────────────────
const css = `
  @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=DM+Sans:wght@300;400;500&display=swap');

  .ic-wrap * { box-sizing: border-box; margin: 0; padding: 0; }
  .ic-wrap {
    --ember:    #E8410A;
    --ember-lt: #FF6B3D;
    --steel:    #1C1C2E;
    --chalk:    #F7F4EF;
    --mist:     #8C8CA8;
    --mid:      #555555;
    --light:    #888888;
    --rule:     #E8E4DE;
    --white:    #FFFFFF;
    --radius:   8px;
    font-family: 'DM Sans', sans-serif;
    color: var(--mid);
    background: #F0EDE8;
    min-height: 100vh;
    padding: 24px;
  }

  .ic-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 24px; }
  .ic-header h1 { font-family: 'Plus Jakarta Sans', sans-serif; font-weight: 800; font-size: 22px; color: var(--steel); }
  .ic-header p  { font-size: 13px; color: var(--mist); margin-top: 2px; }

  .ic-tabs { display: flex; gap: 4px; background: var(--white); border: 1px solid var(--rule); border-radius: var(--radius); padding: 4px; margin-bottom: 24px; overflow-x: auto; }
  .ic-tab  { flex: 1; min-width: fit-content; padding: 8px 14px; border: none; background: none; border-radius: 6px; font-family: 'DM Sans', sans-serif; font-size: 13px; font-weight: 500; color: var(--light); cursor: pointer; white-space: nowrap; transition: all 0.15s; }
  .ic-tab.active { background: var(--steel); color: var(--white); }
  .ic-tab .badge { display: inline-flex; align-items: center; justify-content: center; width: 18px; height: 18px; background: var(--ember); color: white; border-radius: 50%; font-size: 10px; font-weight: 700; margin-left: 6px; }

  .ic-card { background: var(--white); border: 1px solid var(--rule); border-radius: var(--radius); padding: 20px; margin-bottom: 16px; }
  .ic-card-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 16px; margin-bottom: 24px; }
  .ic-stat-card { background: var(--white); border: 1px solid var(--rule); border-radius: var(--radius); padding: 18px 20px; }
  .ic-stat-label { font-size: 11px; font-weight: 600; color: var(--mist); text-transform: uppercase; letter-spacing: 1px; margin-bottom: 8px; }
  .ic-stat-value { font-family: 'Plus Jakarta Sans', sans-serif; font-weight: 800; font-size: 26px; color: var(--steel); line-height: 1; }
  .ic-stat-sub   { font-size: 12px; color: var(--mist); margin-top: 4px; }
  .ic-section-heading { font-family: 'Plus Jakarta Sans', sans-serif; font-weight: 700; font-size: 14px; color: var(--steel); margin-bottom: 12px; padding-bottom: 8px; border-bottom: 1px solid var(--rule); }

  /* Invoice chase card */
  .ic-invoice-card { background: var(--white); border: 1px solid var(--rule); border-radius: var(--radius); padding: 16px 18px; margin-bottom: 12px; }
  .ic-invoice-card.overdue { border-left: 4px solid #EF4444; }
  .ic-invoice-name { font-size: 15px; font-weight: 700; color: var(--steel); }
  .ic-invoice-meta { font-size: 12px; color: var(--mist); margin-top: 2px; }

  /* Chase steps */
  .ic-chase-steps { display: flex; gap: 8px; margin-top: 14px; align-items: stretch; }
  .ic-chase-step { flex: 1; min-width: 0; padding: 10px 12px; border-radius: 6px; border: 1px solid; text-align: center; display: flex; flex-direction: column; }
  .ic-step-actions { margin-top: auto; padding-top: 8px; }
  .ic-step-day   { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px; }
  .ic-step-label { font-size: 12px; font-weight: 500; }
  .ic-step-date  { font-size: 11px; margin-top: 2px; opacity: 0.7; }

  .ic-step-scheduled { background: #F8FAFF; border-color: #BFDBFE; color: #1E40AF; }
  .ic-step-sent      { background: #F0FDF4; border-color: #BBF7D0; color: #166534; }
  .ic-step-skipped   { background: #F9FAFB; border-color: #E5E7EB; color: #9CA3AF; }
  .ic-step-paused    { background: #FFFBEB; border-color: #FDE68A; color: #92400E; }
  .ic-step-overdue   { background: #FEF2F2; border-color: #FECACA; color: #991B1B; }

  /* Timeline */
  .ic-timeline { position: relative; padding-left: 28px; }
  .ic-timeline::before { content: ''; position: absolute; left: 8px; top: 6px; bottom: 6px; width: 2px; background: var(--rule); }
  .ic-timeline-item { position: relative; padding-bottom: 18px; }
  .ic-timeline-item:last-child { padding-bottom: 0; }
  .ic-timeline-dot { position: absolute; left: -28px; top: 3px; width: 18px; height: 18px; border-radius: 50%; border: 2px solid var(--white); display: flex; align-items: center; justify-content: center; }
  .ic-timeline-title { font-size: 13px; font-weight: 600; color: var(--steel); }
  .ic-timeline-meta  { font-size: 12px; color: var(--mist); margin-top: 1px; }

  /* Email preview */
  .ic-email-preview { background: white; border: 1px solid var(--rule); border-radius: var(--radius); overflow: hidden; margin-top: 12px; }
  .ic-email-header { padding: 12px 16px; background: var(--chalk); border-bottom: 1px solid var(--rule); }
  .ic-email-subject { font-weight: 600; color: var(--steel); font-size: 14px; }
  .ic-email-body { padding: 16px; font-size: 13px; color: var(--mid); line-height: 1.7; white-space: pre-wrap; }
  .ic-email-link { display: inline-block; margin: 8px 0; padding: 10px 20px; background: var(--ember); color: white; border-radius: 6px; font-weight: 600; font-size: 13px; text-decoration: none; }

  /* Open Banking badge */
  .ic-ob-badge { display: flex; align-items: center; gap: 8px; padding: 10px 14px; background: #F0FDF4; border: 1px solid #BBF7D0; border-radius: 6px; font-size: 13px; color: #166534; }
  .ic-ob-dot { width: 8px; height: 8px; border-radius: 50%; background: #22C55E; box-shadow: 0 0 6px #22C55E80; flex-shrink: 0; }

  /* Dispute flag */
  .ic-dispute-banner { background: #FDF4FF; border: 1px solid #E9D5FF; border-radius: 6px; padding: 12px 14px; font-size: 13px; color: #7E22CE; margin-top: 10px; }

  /* Template editor */
  .ic-template-tabs { display: flex; gap: 4px; margin-bottom: 16px; }
  .ic-template-tab { padding: 7px 14px; border-radius: 6px; border: 1px solid var(--rule); background: var(--white); font-size: 13px; font-weight: 500; cursor: pointer; transition: all 0.15s; color: var(--light); }
  .ic-template-tab.active { background: var(--steel); color: white; border-color: var(--steel); }

  /* Buttons */
  .ic-btn { display: inline-flex; align-items: center; gap: 6px; padding: 8px 14px; border-radius: 6px; font-family: 'DM Sans', sans-serif; font-size: 13px; font-weight: 500; cursor: pointer; border: none; transition: all 0.15s; white-space: nowrap; }
  .ic-btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .ic-btn-primary   { background: var(--ember); color: white; }
  .ic-btn-primary:hover:not(:disabled) { background: var(--ember-lt); }
  .ic-btn-secondary { background: var(--chalk); color: var(--steel); border: 1px solid var(--rule); }
  .ic-btn-secondary:hover:not(:disabled) { border-color: var(--mist); }
  .ic-btn-ghost     { background: none; color: var(--mist); border: 1px solid var(--rule); }
  .ic-btn-ghost:hover:not(:disabled) { color: var(--steel); border-color: var(--steel); }
  .ic-btn-success   { background: #DCFCE7; color: #166534; border: 1px solid #BBF7D0; }
  .ic-btn-danger    { background: #FEE2E2; color: #991B1B; border: 1px solid #FECACA; }
  .ic-btn-sm        { padding: 5px 10px; font-size: 12px; }

  /* Pill */
  .ic-pill { display: inline-flex; align-items: center; padding: 3px 10px; border-radius: 20px; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; }
  .ic-pill-sent      { background: #DCFCE7; color: #166534; }
  .ic-pill-scheduled { background: #EFF6FF; color: #1E40AF; }
  .ic-pill-skipped   { background: #F3F4F6; color: #6B7280; }
  .ic-pill-paused    { background: #FFFBEB; color: #92400E; }
  .ic-pill-overdue   { background: #FEE2E2; color: #991B1B; }
  .ic-pill-disputed  { background: #FDF4FF; color: #7E22CE; }
  .ic-pill-paid      { background: #DCFCE7; color: #166534; }

  /* Form */
  .ic-input { width: 100%; padding: 9px 12px; border: 1px solid var(--rule); border-radius: 6px; font-family: 'DM Sans', sans-serif; font-size: 14px; color: var(--steel); outline: none; transition: border-color 0.15s; background: white; }
  .ic-input:focus { border-color: var(--ember); }
  .ic-textarea { min-height: 180px; resize: vertical; font-size: 13px; line-height: 1.6; }
  .ic-input-label { font-size: 13px; font-weight: 500; color: var(--steel); margin-bottom: 6px; display: block; }
  .ic-input-group { margin-bottom: 16px; }

  /* Modal */
  .ic-modal-overlay { position: fixed; inset: 0; background: rgba(28,28,46,0.5); display: flex; align-items: center; justify-content: center; z-index: 100; padding: 20px; }
  .ic-modal { background: var(--white); border-radius: var(--radius); padding: 24px; width: 100%; max-width: 520px; max-height: 90vh; overflow-y: auto; }
  .ic-modal-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px; }
  .ic-modal-title  { font-family: 'Plus Jakarta Sans', sans-serif; font-weight: 700; font-size: 16px; color: var(--steel); }

  /* Alert */
  .ic-alert { padding: 12px 16px; border-radius: var(--radius); font-size: 13px; margin-bottom: 16px; }
  .ic-alert-success { background: #DCFCE7; border: 1px solid #BBF7D0; color: #166534; }
  .ic-alert-warning { background: #FFFBEB; border: 1px solid #FDE68A; color: #92400E; }
  .ic-alert-info    { background: #EFF6FF; border: 1px solid #BFDBFE; color: #1E40AF; }
  .ic-alert-danger  { background: #FEF2F2; border: 1px solid #FECACA; color: #991B1B; }

  /* Toggle */
  .ic-toggle { position: relative; display: inline-block; width: 44px; height: 24px; flex-shrink: 0; }
  .ic-toggle input { opacity: 0; width: 0; height: 0; }
  .ic-toggle-slider { position: absolute; cursor: pointer; inset: 0; background: var(--rule); border-radius: 24px; transition: 0.2s; }
  .ic-toggle-slider:before { content: ''; position: absolute; width: 18px; height: 18px; left: 3px; bottom: 3px; background: white; border-radius: 50%; transition: 0.2s; }
  .ic-toggle input:checked + .ic-toggle-slider { background: var(--ember); }
  .ic-toggle input:checked + .ic-toggle-slider:before { transform: translateX(20px); }

  /* Empty */
  .ic-empty { text-align: center; padding: 40px 24px; color: var(--mist); }
  .ic-empty h3 { font-size: 15px; color: var(--steel); margin-bottom: 4px; }
`;

// ── HELPERS ─────────────────────────────────────────────────────
const today = new Date();
const formatDate = (d) => d ? new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—";
const formatCurrency = (n) => `£${(n || 0).toFixed(2)}`;
const daysAgo = (d) => d ? Math.ceil((today - new Date(d)) / 86400000) : 0;
const daysUntil = (d) => d ? Math.ceil((new Date(d) - today) / 86400000) : null;

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

// Merge template variables
const mergeTemplate = (template, vars) => {
  return template.replace(/\{(\w+)\}/g, (_, key) => vars[key] || `{${key}}`);
};

// ── MOCK DATA ───────────────────────────────────────────────────
const MOCK_CHASE_INVOICES = [
  {
    id: "inv1",
    invoice_number: "INV-0046",
    customer_name: "James Whitfield",
    customer_email: "james@whitfieldproperty.co.uk",
    total: 3800,
    due_date: "2026-06-15",
    sent_at: "2026-06-01T10:00:00Z",
    status: "sent",
    disputed: false,
    chase_queue: [
      { id: "cq1", chase_day: 7,  scheduled_for: "2026-06-08T08:00:00Z", status: "scheduled" },
      { id: "cq2", chase_day: 14, scheduled_for: "2026-06-15T08:00:00Z", status: "scheduled" },
      { id: "cq3", chase_day: 30, scheduled_for: "2026-07-01T08:00:00Z", status: "scheduled" },
    ],
  },
  {
    id: "inv2",
    invoice_number: "INV-0044",
    customer_name: "Helen Burgess",
    customer_email: "helen.b@gmail.com",
    total: 480,
    due_date: "2026-05-24",
    sent_at: "2026-05-10T09:00:00Z",
    status: "overdue",
    disputed: false,
    chase_queue: [
      { id: "cq4", chase_day: 7,  scheduled_for: "2026-05-17T08:00:00Z", status: "sent", sent_at: "2026-05-17T08:02:00Z" },
      { id: "cq5", chase_day: 14, scheduled_for: "2026-05-24T08:00:00Z", status: "sent", sent_at: "2026-05-24T08:02:00Z" },
      { id: "cq6", chase_day: 30, scheduled_for: "2026-06-09T08:00:00Z", status: "scheduled" },
    ],
  },
  {
    id: "inv3",
    invoice_number: "INV-0043",
    customer_name: "Sandra Williams",
    customer_email: "sandra.w@hotmail.com",
    total: 1028,
    due_date: "2026-05-10",
    sent_at: "2026-04-26T10:00:00Z",
    status: "overdue",
    disputed: true,
    chase_queue: [
      { id: "cq7", chase_day: 7,  scheduled_for: "2026-05-03T08:00:00Z", status: "sent", sent_at: "2026-05-03T08:02:00Z" },
      { id: "cq8", chase_day: 14, scheduled_for: "2026-05-10T08:00:00Z", status: "paused", skip_reason: "Invoice disputed — chase paused" },
      { id: "cq9", chase_day: 30, scheduled_for: "2026-05-26T08:00:00Z", status: "paused", skip_reason: "Invoice disputed — chase paused" },
    ],
  },
  {
    id: "inv4",
    invoice_number: "INV-0042",
    customer_name: "Robert Chen",
    customer_email: "r.chen@landlordpro.co.uk",
    total: 6500,
    due_date: "2026-05-01",
    sent_at: "2026-04-17T10:00:00Z",
    status: "overdue",
    disputed: false,
    chase_queue: [
      { id: "cq10", chase_day: 7,  scheduled_for: "2026-04-24T08:00:00Z", status: "sent", sent_at: "2026-04-24T08:02:00Z" },
      { id: "cq11", chase_day: 14, scheduled_for: "2026-05-01T08:00:00Z", status: "sent", sent_at: "2026-05-01T08:02:00Z" },
      { id: "cq12", chase_day: 30, scheduled_for: "2026-05-17T08:00:00Z", status: "sent", sent_at: "2026-05-17T08:02:00Z" },
    ],
  },
];

const MOCK_LOG = [
  { id: "log1", invoice_number: "INV-0044", customer_name: "Helen Burgess", chase_day: 14, sent_at: "2026-05-24T08:02:00Z", subject: "Invoice INV-0044 — payment overdue", opened: true, opened_at: "2026-05-24T09:15:00Z" },
  { id: "log2", invoice_number: "INV-0044", customer_name: "Helen Burgess", chase_day: 7, sent_at: "2026-05-17T08:02:00Z", subject: "Friendly reminder — invoice INV-0044 due", opened: true, opened_at: "2026-05-17T10:30:00Z" },
  { id: "log3", invoice_number: "INV-0043", customer_name: "Sandra Williams", chase_day: 7, sent_at: "2026-05-03T08:02:00Z", subject: "Friendly reminder — invoice INV-0043 due", opened: false },
  { id: "log4", invoice_number: "INV-0042", customer_name: "Robert Chen", chase_day: 30, sent_at: "2026-05-17T08:02:00Z", subject: "Final notice — invoice INV-0042 — £6,500.00 outstanding", opened: true, opened_at: "2026-05-17T11:00:00Z" },
  { id: "log5", invoice_number: "INV-0042", customer_name: "Robert Chen", chase_day: 14, sent_at: "2026-05-01T08:02:00Z", subject: "Invoice INV-0042 — payment now overdue", opened: true, opened_at: "2026-05-01T14:22:00Z" },
];

// ── Live-schema <-> UI adapters ──────────────────────────────────
// The live DB has no stored "chase queue": the 7/14/30 schedule is derived
// from invoices.sent_at + invoice_chaser_configs, with sent stages recorded in
// invoice_chaser_log and pauses in invoice_chaser_pauses.
const penceToPounds = (p) => (p ?? 0) / 100;
const contactName = (c) =>
  c ? ([c.first_name, c.last_name].filter(Boolean).join(" ") || c.business_name || "") : "";

function deriveChaseQueue(invoice, config, sentStages, pause) {
  const days = [7, 14, 30].filter((d) => config?.[`day${d}_enabled`] !== false);
  const base = invoice.sent_at ? new Date(invoice.sent_at).getTime() : null;
  return days.map((d) => {
    const sentRow = sentStages.find((s) => s.stage === d);
    let status = "scheduled", sent_at = null, skip_reason = null;
    if (sentRow) { status = "sent"; sent_at = sentRow.sent_at; }
    else if (pause) { status = "paused"; skip_reason = pause.note || "Chase paused"; }
    return {
      id: `${invoice.id}-${d}`,
      chase_day: d,
      scheduled_for: base ? new Date(base + d * 86400000).toISOString() : null,
      status, sent_at, skip_reason,
    };
  });
}

function mapChaseInvoice(row, config, logRows, pauses) {
  const c = row.contact || null;
  const sentStages = logRows.filter((l) => l.invoice_id === row.id);
  const pause = pauses.find((p) => p.invoice_id === row.id) || null;
  return {
    id: row.id,
    contact_id: row.contact_id,
    invoice_number: row.invoice_number,
    customer_name: contactName(c),
    customer_email: c?.email || "",
    total: penceToPounds(row.total_pence),
    due_date: row.due_date,
    sent_at: row.sent_at,
    status: row.status === "partially_paid" ? "part_paid" : row.status,
    disputed: row.status === "disputed" || !!pause,
    dispute_notes: pause?.note || null,
    chase_queue: deriveChaseQueue(row, config, sentStages, pause),
  };
}

function mapChaserLog(row) {
  const inv = row.invoice || null;
  const c = row.contact || null;
  return {
    id: row.id,
    invoice_number: inv?.invoice_number || "",
    customer_name: contactName(c),
    chase_day: row.stage,
    sent_at: row.sent_at,
    subject: `Day ${row.stage} chase — ${inv?.invoice_number || ""}`,
    opened: !!row.opened_at,
    opened_at: row.opened_at,
  };
}

// ── MAIN COMPONENT ──────────────────────────────────────────────
export default function InvoiceChasing({
  supabase, accountId, userId, userName, userRole,
  accountName = "Your Business", brandColor = "#E8410A",
}) {
  const [activeTab, setActiveTab] = useState("overview");
  const [invoices, setInvoices] = useState([]);
  const [log, setLog] = useState([]);
  const [loading, setLoading] = useState(true);
  const [chaseSettings, setChaseSettings] = useState({
    sequence_enabled: true,
    day7_enabled: true,
    day14_enabled: true,
    day30_enabled: true,
    pause_on_dispute: true,
    pause_on_part_pay: true,
    open_banking_enabled: false,
    open_banking_addon: false,
    send_from_name: accountName,
  });
  const [templates, setTemplates] = useState(DEFAULT_TEMPLATES);
  const [activeTemplateTab, setActiveTemplateTab] = useState(7);
  const [showOverrideModal, setShowOverrideModal] = useState(null);
  const [showDisputeModal, setShowDisputeModal] = useState(null);
  const [alert, setAlert] = useState(null);

  const showAlertMsg = (type, msg) => {
    setAlert({ type, message: msg });
    setTimeout(() => setAlert(null), 4000);
  };

  // ── Load real data (RLS scopes to this account) ──
  const loadData = useCallback(async () => {
    setLoading(true);
    const [cfgRes, invRes, logRes, pauseRes] = await Promise.all([
      supabase.from("invoice_chaser_configs").select("*").eq("account_id", accountId).maybeSingle(),
      supabase
        .from("invoices")
        .select("*, contact:contacts(*)")
        .in("status", ["sent", "overdue", "partially_paid", "disputed"])
        .order("sent_at", { ascending: false }),
      supabase
        .from("invoice_chaser_log")
        .select("*, invoice:invoices(invoice_number), contact:contacts(first_name,last_name,business_name)")
        .order("sent_at", { ascending: false }),
      supabase.from("invoice_chaser_pauses").select("*"),
    ]);
    const config = cfgRes.data || {};
    const logRows = logRes.data || [];
    const pauses = pauseRes.data || [];
    if (invRes.error) showAlertMsg("error", `Could not load invoices: ${invRes.error.message}`);
    else setInvoices((invRes.data || []).map((r) => mapChaseInvoice(r, config, logRows, pauses)));
    setLog(logRows.map(mapChaserLog));
    if (cfgRes.data) {
      setChaseSettings((s) => ({
        ...s,
        sequence_enabled: config.enabled ?? true,
        day7_enabled: config.day7_enabled ?? true,
        day14_enabled: config.day14_enabled ?? true,
        day30_enabled: config.day30_enabled ?? true,
      }));
      setTemplates({
        day7: { subject: config.day7_subject || DEFAULT_TEMPLATES.day7.subject, body: config.day7_body || DEFAULT_TEMPLATES.day7.body },
        day14: { subject: config.day14_subject || DEFAULT_TEMPLATES.day14.subject, body: config.day14_body || DEFAULT_TEMPLATES.day14.body },
        day30: { subject: config.day30_subject || DEFAULT_TEMPLATES.day30.subject, body: config.day30_body || DEFAULT_TEMPLATES.day30.body },
      });
    }
    setLoading(false);
  }, [supabase, accountId]);

  useEffect(() => { loadData(); }, [loadData]);

  // Upsert the per-account chaser config (templates + enabled flags live here).
  const saveConfig = async (patch) => {
    const { error } = await supabase
      .from("invoice_chaser_configs")
      .upsert({ account_id: accountId, ...patch }, { onConflict: "account_id" });
    if (error) { showAlertMsg("error", `Could not save: ${error.message}`); return false; }
    return true;
  };

  // Stats
  const activeChases = invoices.filter((i) => ["sent", "overdue"].includes(i.status)).length;
  const overdueCount = invoices.filter((i) => i.status === "overdue").length;
  const totalOverdue = invoices.filter((i) => i.status === "overdue").reduce((s, i) => s + i.total, 0);
  const scheduledToday = invoices.flatMap((i) => i.chase_queue).filter((q) => {
    if (q.status !== "scheduled") return false;
    const d = new Date(q.scheduled_for);
    return d.toDateString() === today.toDateString();
  }).length;
  const emailsSent = log.length;

  // Skip a chase step
  const handleSkip = async (invoiceId, queueId, reason = "Manually skipped") => {
    setInvoices((prev) => prev.map((inv) =>
      inv.id === invoiceId
        ? { ...inv, chase_queue: inv.chase_queue.map((q) => q.id === queueId ? { ...q, status: "skipped", skip_reason: reason } : q) }
        : inv
    ));
    await logAction(supabase, {
      accountId, userId, userName, userRole,
      action: "skipped", entityType: "chase_queue", entityId: queueId,
      entityName: `Chase step skipped — ${invoices.find((i) => i.id === invoiceId)?.invoice_number}`,
      newValue: { status: "skipped", reason },
    });
    showAlertMsg("success", "Chase step skipped.");
  };

  // Pause all remaining chase steps — persists a pause row for the invoice.
  const handlePauseAll = async (invoiceId) => {
    const inv = invoices.find((i) => i.id === invoiceId);
    const { error } = await supabase.from("invoice_chaser_pauses").upsert(
      { account_id: accountId, invoice_id: invoiceId, contact_id: inv?.contact_id || null, paused_by: userId, note: "Manually paused", permanent: true },
      { onConflict: "account_id,invoice_id" }
    );
    if (error) { showAlertMsg("error", `Could not pause: ${error.message}`); return; }
    setInvoices((prev) => prev.map((i) =>
      i.id === invoiceId
        ? { ...i, chase_queue: i.chase_queue.map((q) => q.status === "scheduled" ? { ...q, status: "paused", skip_reason: "Manually paused" } : q) }
        : i
    ));
    await logAction(supabase, {
      accountId, userId, userName, userRole,
      action: "paused", entityType: "invoice", entityId: invoiceId,
      entityName: `All chase steps paused — ${inv?.invoice_number}`,
    });
    showAlertMsg("success", "Chase sequence paused for this invoice.");
  };

  // Resume paused steps — removes the pause row.
  const handleResume = async (invoiceId) => {
    const { error } = await supabase
      .from("invoice_chaser_pauses")
      .delete()
      .eq("account_id", accountId)
      .eq("invoice_id", invoiceId);
    if (error) { showAlertMsg("error", `Could not resume: ${error.message}`); return; }
    setInvoices((prev) => prev.map((i) =>
      i.id === invoiceId
        ? { ...i, chase_queue: i.chase_queue.map((q) => q.status === "paused" ? { ...q, status: "scheduled", skip_reason: null } : q) }
        : i
    ));
    await logAction(supabase, {
      accountId, userId, userName, userRole,
      action: "updated", entityType: "invoice", entityId: invoiceId,
      entityName: `Chase resumed — ${invoices.find((i) => i.id === invoiceId)?.invoice_number}`,
    });
    showAlertMsg("success", "Chase sequence resumed.");
  };

  // Flag dispute — sets invoice status and (optionally) pauses the chase.
  const handleDispute = async (invoiceId, notes) => {
    const inv = invoices.find((i) => i.id === invoiceId);
    const { error } = await supabase.from("invoices").update({ status: "disputed" }).eq("id", invoiceId);
    if (error) { showAlertMsg("error", `Could not flag dispute: ${error.message}`); return; }
    if (chaseSettings.pause_on_dispute) {
      await supabase.from("invoice_chaser_pauses").upsert(
        { account_id: accountId, invoice_id: invoiceId, contact_id: inv?.contact_id || null, paused_by: userId, note: notes || "Invoice disputed — chase paused", permanent: true },
        { onConflict: "account_id,invoice_id" }
      );
    }
    setInvoices((prev) => prev.map((i) =>
      i.id === invoiceId
        ? {
            ...i,
            status: "disputed",
            disputed: true,
            dispute_notes: notes,
            chase_queue: chaseSettings.pause_on_dispute
              ? i.chase_queue.map((q) => q.status === "scheduled" ? { ...q, status: "paused", skip_reason: "Invoice disputed — chase paused" } : q)
              : i.chase_queue,
          }
        : i
    ));
    await logAction(supabase, {
      accountId, userId, userName, userRole,
      action: "disputed", entityType: "invoice", entityId: invoiceId,
      entityName: `Invoice disputed — ${inv?.invoice_number}`,
      newValue: { disputed: true, notes },
    });
    setShowDisputeModal(null);
    showAlertMsg("warning", "Invoice flagged as disputed. Chase sequence paused.");
  };

  // Resolve a dispute — clears disputed status and resumes the chase sequence.
  const handleResolveDispute = async (invoiceId) => {
    const inv = invoices.find((i) => i.id === invoiceId);
    const { error } = await supabase.from("invoices").update({ status: "sent" }).eq("id", invoiceId);
    if (error) { showAlertMsg("error", `Could not resolve dispute: ${error.message}`); return; }
    // Lift the pause so scheduled chases resume.
    await supabase.from("invoice_chaser_pauses").delete().eq("account_id", accountId).eq("invoice_id", invoiceId);
    setInvoices((prev) => prev.map((i) =>
      i.id === invoiceId
        ? {
            ...i,
            status: "sent",
            disputed: false,
            dispute_notes: null,
            chase_queue: i.chase_queue.map((q) => q.status === "paused" ? { ...q, status: "scheduled", skip_reason: null } : q),
          }
        : i
    ));
    await logAction(supabase, {
      accountId, userId, userName, userRole,
      action: "updated", entityType: "invoice", entityId: invoiceId,
      entityName: `Dispute resolved — ${inv?.invoice_number}`, newValue: { status: "sent", disputed: false },
    });
    showAlertMsg("success", "Dispute resolved. Chase sequence resumed.");
  };

  // Send now (manual override)
  const handleSendNow = async (invoiceId, queueItem) => {
    const invoice = invoices.find((i) => i.id === invoiceId);
    const sentAt = new Date().toISOString();
    // Record the chase in invoice_chaser_log. (Actual email delivery is handled
    // by a separate Resend edge function — out of scope here.)
    const { data: logRow, error } = await supabase
      .from("invoice_chaser_log")
      .insert({ account_id: accountId, invoice_id: invoiceId, contact_id: invoice.contact_id || null, stage: queueItem.chase_day, sent_at: sentAt })
      .select("*")
      .single();
    if (error) { showAlertMsg("error", `Could not record chase: ${error.message}`); return; }

    setInvoices((prev) => prev.map((inv) =>
      inv.id === invoiceId
        ? { ...inv, chase_queue: inv.chase_queue.map((q) => q.id === queueItem.id ? { ...q, status: "sent", sent_at: sentAt } : q) }
        : inv
    ));

    const newLog = {
      id: logRow.id,
      invoice_number: invoice.invoice_number,
      customer_name: invoice.customer_name,
      chase_day: queueItem.chase_day,
      sent_at: sentAt,
      subject: `Day ${queueItem.chase_day} chase — ${invoice.invoice_number}`,
      opened: false,
    };
    setLog((prev) => [newLog, ...prev]);

    await logAction(supabase, {
      accountId, userId, userName, userRole,
      action: "sent_manually", entityType: "chase_email", entityId: queueItem.id,
      entityName: `Manual chase sent — ${invoice.invoice_number} day ${queueItem.chase_day}`,
    });

    setShowOverrideModal(null);
    showAlertMsg("success", `Day ${queueItem.chase_day} chase email sent to ${invoice.customer_email}.`);
  };

  // ── RENDER ───────────────────────────────────────────────────
  return (
    <>
      <style>{css}</style>
      <div className="ic-wrap">

        <div className="ic-header">
          <div>
            <h1>Invoice Chasing</h1>
            <p>Automated sequences · Manual override · Open Banking</p>
          </div>
          {chaseSettings.open_banking_enabled && (
            <div className="ic-ob-badge">
              <div className="ic-ob-dot" />
              Open Banking active — payments confirmed automatically
            </div>
          )}
        </div>

        {alert && <div className={`ic-alert ic-alert-${alert.type}`}>{alert.message}</div>}

        {/* Stats */}
        <div className="ic-card-grid">
          <div className="ic-stat-card">
            <div className="ic-stat-label">Active Chases</div>
            <div className="ic-stat-value">{activeChases}</div>
            <div className="ic-stat-sub">Sequences running</div>
          </div>
          <div className="ic-stat-card">
            <div className="ic-stat-label">Overdue Value</div>
            <div className="ic-stat-value" style={{ fontSize: 20, color: totalOverdue > 0 ? "#EF4444" : "#22C55E" }}>{formatCurrency(totalOverdue)}</div>
            <div className="ic-stat-sub">{overdueCount} invoice{overdueCount !== 1 ? "s" : ""}</div>
          </div>
          <div className="ic-stat-card">
            <div className="ic-stat-label">Sending Today</div>
            <div className="ic-stat-value" style={{ color: scheduledToday > 0 ? "#E8410A" : "#22C55E" }}>{scheduledToday}</div>
            <div className="ic-stat-sub">Emails queued</div>
          </div>
          <div className="ic-stat-card">
            <div className="ic-stat-label">Emails Sent</div>
            <div className="ic-stat-value">{emailsSent}</div>
            <div className="ic-stat-sub">All time</div>
          </div>
        </div>

        {/* Tabs */}
        <div className="ic-tabs">
          {TABS.map((tab) => (
            <button key={tab.id} className={`ic-tab ${activeTab === tab.id ? "active" : ""}`} onClick={() => setActiveTab(tab.id)}>
              {tab.label}
              {tab.id === "queue" && overdueCount > 0 && <span className="badge">{overdueCount}</span>}
            </button>
          ))}
        </div>

        {/* ── OVERVIEW ──────────────────────────────────────── */}
        {activeTab === "overview" && (
          <div>
            {!chaseSettings.sequence_enabled && (
              <div className="ic-alert ic-alert-warning">
                Automated chase sequences are currently paused. Enable them in Settings.
              </div>
            )}

            {invoices.filter((i) => i.status === "overdue").length > 0 && (
              <div className="ic-alert ic-alert-danger">
                {overdueCount} overdue invoice{overdueCount > 1 ? "s" : ""} totalling {formatCurrency(totalOverdue)}. Chase sequences are running.
              </div>
            )}

            {invoices.map((invoice) => (
              <ChaseCard
                key={invoice.id}
                invoice={invoice}
                templates={templates}
                accountName={accountName}
                onSkip={handleSkip}
                onPauseAll={handlePauseAll}
                onResume={handleResume}
                onResolveDispute={handleResolveDispute}
                onDispute={() => setShowDisputeModal(invoice.id)}
                onSendNow={(qItem) => setShowOverrideModal({ invoice, queueItem: qItem })}
                onMarkPaid={async () => {
                  const { error } = await supabase
                    .from("invoices")
                    .update({ status: "paid", amount_paid_pence: Math.round((invoice.total || 0) * 100), paid_at: new Date().toISOString() })
                    .eq("id", invoice.id);
                  if (error) { showAlertMsg("error", `Could not update: ${error.message}`); return; }
                  setInvoices((prev) => prev.filter((inv) => inv.id !== invoice.id));
                  await logAction(supabase, { accountId, userId, userName, userRole, action: "paid", entityType: "invoice", entityId: invoice.id, entityName: `Invoice paid — ${invoice.invoice_number}` });
                  showAlertMsg("success", `${invoice.invoice_number} marked as paid. Chase sequence stopped.`);
                }}
                userRole={userRole}
              />
            ))}
          </div>
        )}

        {/* ── CHASE QUEUE ───────────────────────────────────── */}
        {activeTab === "queue" && (
          <div className="ic-card">
            <div className="ic-section-heading">All Scheduled Chase Emails</div>
            {invoices.flatMap((inv) =>
              inv.chase_queue.map((q) => ({
                ...q,
                invoice_number: inv.invoice_number,
                customer_name: inv.customer_name,
                total: inv.total,
                invoiceId: inv.id,
              }))
            )
            .sort((a, b) => new Date(a.scheduled_for) - new Date(b.scheduled_for))
            .map((item) => {
              const days = daysUntil(item.scheduled_for);
              const tone = CHASE_TONE[item.chase_day];
              return (
                <div key={item.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 0", borderBottom: "1px solid var(--rule)", gap: 12 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <div style={{ padding: "4px 10px", borderRadius: 6, background: tone.bg, color: tone.color, fontSize: 12, fontWeight: 700, flexShrink: 0 }}>
                      Day {item.chase_day}
                    </div>
                    <div>
                      <div style={{ fontWeight: 600, color: "var(--steel)", fontSize: 13 }}>{item.invoice_number} — {item.customer_name}</div>
                      <div style={{ fontSize: 12, color: "var(--mist)", marginTop: 1 }}>
                        {item.status === "sent" ? `Sent ${formatDate(item.sent_at)}` : formatDate(item.scheduled_for)}
                        {item.status === "scheduled" && days !== null && days >= 0 && ` — in ${days} day${days !== 1 ? "s" : ""}`}
                        {item.skip_reason && ` — ${item.skip_reason}`}
                      </div>
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                    <span className={`ic-pill ic-pill-${item.status}`}>{item.status}</span>
                    {item.status === "scheduled" && (
                      <button className="ic-btn ic-btn-ghost ic-btn-sm" onClick={() => handleSkip(item.invoiceId, item.id)}>Skip</button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* ── EMAIL TEMPLATES ───────────────────────────────── */}
        {activeTab === "templates" && (
          <div>
            <div className="ic-alert ic-alert-info">
              Use {"{customer_name}"}, {"{invoice_number}"}, {"{amount}"}, {"{due_date}"}, {"{business_name}"}, {"{payment_link}"} as placeholders. They're replaced automatically when emails send.
            </div>
            <div className="ic-template-tabs">
              {CHASE_DAYS.map((day) => (
                <button key={day} className={`ic-template-tab ${activeTemplateTab === day ? "active" : ""}`} onClick={() => setActiveTemplateTab(day)}>
                  Day {day} — {CHASE_TONE[day].label}
                </button>
              ))}
            </div>
            <div className="ic-card">
              <div className="ic-input-group">
                <label className="ic-input-label">Subject line</label>
                <input
                  className="ic-input"
                  value={templates[`day${activeTemplateTab}`].subject}
                  onChange={(e) => setTemplates((p) => ({ ...p, [`day${activeTemplateTab}`]: { ...p[`day${activeTemplateTab}`], subject: e.target.value } }))}
                />
              </div>
              <div className="ic-input-group">
                <label className="ic-input-label">Email body</label>
                <textarea
                  className="ic-input ic-textarea"
                  value={templates[`day${activeTemplateTab}`].body}
                  onChange={(e) => setTemplates((p) => ({ ...p, [`day${activeTemplateTab}`]: { ...p[`day${activeTemplateTab}`], body: e.target.value } }))}
                />
              </div>

              {/* Live preview */}
              <div style={{ marginTop: 4 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: "var(--mist)", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 8 }}>Preview</div>
                <div className="ic-email-preview">
                  <div className="ic-email-header">
                    <div className="ic-email-subject">
                      {mergeTemplate(templates[`day${activeTemplateTab}`].subject, {
                        invoice_number: "INV-0044",
                        amount: "£480.00",
                      })}
                    </div>
                    <div style={{ fontSize: 12, color: "var(--mist)", marginTop: 4 }}>To: helen.b@gmail.com</div>
                  </div>
                  <div className="ic-email-body">
                    {mergeTemplate(templates[`day${activeTemplateTab}`].body, {
                      customer_name: "Helen",
                      invoice_number: "INV-0044",
                      amount: "£480.00",
                      due_date: "24 May 2026",
                      business_name: accountName,
                      payment_link: "",
                    }).replace("{payment_link}", "")}
                    <div style={{ margin: "8px 0" }}>
                      <span className="ic-email-link" style={{ background: brandColor }}>Pay £480.00 Now →</span>
                    </div>
                  </div>
                </div>
              </div>

              <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
                <button className="ic-btn ic-btn-primary" onClick={async () => {
                  const d = activeTemplateTab;
                  const t = templates[`day${d}`];
                  if (await saveConfig({ [`day${d}_subject`]: t.subject, [`day${d}_body`]: t.body })) {
                    await logAction(supabase, { accountId, userId, userName, userRole, action: "updated", entityType: "invoice_chaser_config", entityName: `Day ${d} chase template` });
                    showAlertMsg("success", `Day ${d} template saved.`);
                  }
                }}>Save Template</button>
                <button className="ic-btn ic-btn-ghost" onClick={() => setTemplates((p) => ({ ...p, [`day${activeTemplateTab}`]: DEFAULT_TEMPLATES[`day${activeTemplateTab}`] }))}>Reset to Default</button>
              </div>
            </div>
          </div>
        )}

        {/* ── ACTIVITY LOG ──────────────────────────────────── */}
        {activeTab === "log" && (
          <div className="ic-card">
            <div className="ic-section-heading">Email Activity Log</div>
            {log.length === 0 ? (
              <div className="ic-empty"><h3>No emails sent yet</h3></div>
            ) : (
              <div className="ic-timeline">
                {log.map((entry) => {
                  const tone = CHASE_TONE[entry.chase_day];
                  return (
                    <div key={entry.id} className="ic-timeline-item">
                      <div className="ic-timeline-dot" style={{ background: entry.opened ? "#22C55E" : tone.color }}>
                        <div style={{ width: 6, height: 6, borderRadius: "50%", background: "white" }} />
                      </div>
                      <div className="ic-timeline-title">{entry.customer_name} — {entry.invoice_number}</div>
                      <div className="ic-timeline-meta">
                        Day {entry.chase_day} · {formatDate(entry.sent_at)}
                        {entry.opened
                          ? <span style={{ color: "#166534", marginLeft: 6 }}>Opened {formatDate(entry.opened_at)}</span>
                          : <span style={{ color: "var(--mist)", marginLeft: 6 }}>Not opened</span>}
                      </div>
                      <div style={{ fontSize: 12, color: "var(--mist)", marginTop: 1, fontStyle: "italic" }}>{entry.subject}</div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ── SETTINGS ──────────────────────────────────────── */}
        {activeTab === "settings" && (
          <div className="ic-card">
            <div className="ic-section-heading">Chase Sequence Settings</div>

            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {[
                { key: "sequence_enabled", label: "Automated chase sequences enabled", sub: "Turn off to pause all chasing across all invoices" },
                { key: "day7_enabled",  label: "Day 7 — Friendly reminder" },
                { key: "day14_enabled", label: "Day 14 — Polite but firm" },
                { key: "day30_enabled", label: "Day 30 — Final notice" },
                { key: "pause_on_dispute",  label: "Pause chase when invoice is disputed" },
                { key: "pause_on_part_pay", label: "Pause chase when part payment received" },
              ].map(({ key, label, sub }) => (
                <div key={key} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", paddingBottom: 14, borderBottom: "1px solid var(--rule)" }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 500, color: "var(--steel)" }}>{label}</div>
                    {sub && <div style={{ fontSize: 12, color: "var(--mist)", marginTop: 2 }}>{sub}</div>}
                  </div>
                  <label className="ic-toggle">
                    <input type="checkbox" checked={chaseSettings[key]} onChange={(e) => setChaseSettings((p) => ({ ...p, [key]: e.target.checked }))} />
                    <span className="ic-toggle-slider" />
                  </label>
                </div>
              ))}
            </div>

            {/* Open Banking add-on */}
            <div style={{ marginTop: 20 }}>
              <div className="ic-section-heading">Open Banking — TrueLayer</div>
              <div style={{ padding: "16px", background: chaseSettings.open_banking_enabled ? "#F0FDF4" : "var(--chalk)", border: `1px solid ${chaseSettings.open_banking_enabled ? "#BBF7D0" : "var(--rule)"}`, borderRadius: 8, marginBottom: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 14, color: "var(--steel)", marginBottom: 4 }}>
                      Automatic payment confirmation
                    </div>
                    <div style={{ fontSize: 13, color: "var(--mist)", lineHeight: 1.5 }}>
                      When a customer pays, TrueLayer detects the bank transfer and automatically marks the invoice as paid — no manual checking required. Chase sequence stops immediately.
                    </div>
                    <div style={{ marginTop: 8, fontSize: 13, fontWeight: 600, color: "var(--ember)" }}>
                      + £2.99/month add-on
                    </div>
                  </div>
                </div>
                {!chaseSettings.open_banking_enabled ? (
                  <button
                    className="ic-btn ic-btn-primary"
                    style={{ marginTop: 12 }}
                    onClick={() => setChaseSettings((p) => ({ ...p, open_banking_enabled: true, open_banking_addon: true }))}
                  >
                    Enable Open Banking — £2.99/mo
                  </button>
                ) : (
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12 }}>
                    <div className="ic-ob-dot" />
                    <span style={{ fontSize: 13, color: "#166534", fontWeight: 600 }}>Connected — payments confirmed automatically</span>
                  </div>
                )}
              </div>
            </div>

            <button className="ic-btn ic-btn-primary" onClick={async () => {
              if (await saveConfig({ enabled: chaseSettings.sequence_enabled, day7_enabled: chaseSettings.day7_enabled, day14_enabled: chaseSettings.day14_enabled, day30_enabled: chaseSettings.day30_enabled })) {
                await logAction(supabase, { accountId, userId, userName, userRole, action: "updated", entityType: "invoice_chaser_config", entityName: "Chase settings" });
                showAlertMsg("success", "Settings saved.");
              }
            }}>
              Save Settings
            </button>
          </div>
        )}

        {/* ── SEND NOW OVERRIDE MODAL ───────────────────────── */}
        {showOverrideModal && (
          <SendNowModal
            invoice={showOverrideModal.invoice}
            queueItem={showOverrideModal.queueItem}
            template={templates[`day${showOverrideModal.queueItem.chase_day}`]}
            accountName={accountName}
            brandColor={brandColor}
            onSend={() => handleSendNow(showOverrideModal.invoice.id, showOverrideModal.queueItem)}
            onClose={() => setShowOverrideModal(null)}
          />
        )}

        {/* ── DISPUTE MODAL ────────────────────────────────── */}
        {showDisputeModal && (
          <DisputeModal
            invoice={invoices.find((i) => i.id === showDisputeModal)}
            onSubmit={(notes) => handleDispute(showDisputeModal, notes)}
            onClose={() => setShowDisputeModal(null)}
          />
        )}
      </div>
    </>
  );
}

// ── CHASE CARD ──────────────────────────────────────────────────
function ChaseCard({ invoice, templates, accountName, onSkip, onPauseAll, onResume, onResolveDispute, onDispute, onSendNow, onMarkPaid, userRole }) {
  const [expanded, setExpanded] = useState(false);
  const isOverdue = invoice.status === "overdue";
  const isPaused = invoice.chase_queue.every((q) => ["paused", "sent", "skipped"].includes(q.status));
  const hasPaused = invoice.chase_queue.some((q) => q.status === "paused");
  const overdueDays = isOverdue ? Math.ceil((today - new Date(invoice.due_date)) / 86400000) : 0;

  return (
    <div className={`ic-invoice-card ${isOverdue ? "overdue" : ""}`}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
        <div style={{ flex: 1, cursor: "pointer" }} onClick={() => setExpanded(!expanded)}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span className="ic-invoice-name">{invoice.customer_name}</span>
            <span style={{ fontSize: 12, fontFamily: "monospace", color: "var(--mist)" }}>{invoice.invoice_number}</span>
            {invoice.disputed && <span className="ic-pill ic-pill-disputed">Disputed</span>}
            {isOverdue && <span className="ic-pill ic-pill-overdue">{overdueDays}d overdue</span>}
          </div>
          <div className="ic-invoice-meta">
            {formatCurrency(invoice.total)} · Due {formatDate(invoice.due_date)}
            {invoice.chase_queue.filter((q) => q.status === "sent").length > 0 && (
              <span style={{ marginLeft: 8 }}>· {invoice.chase_queue.filter((q) => q.status === "sent").length} chase{invoice.chase_queue.filter((q) => q.status === "sent").length > 1 ? "s" : ""} sent</span>
            )}
          </div>
        </div>
        {(userRole === "owner" || userRole === "manager") && (
          <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
            <button className="ic-btn ic-btn-success ic-btn-sm" onClick={onMarkPaid}>Mark Paid</button>
            {invoice.disputed ? (
              <button className="ic-btn ic-btn-secondary ic-btn-sm" onClick={() => onResolveDispute(invoice.id)}>Resolve Dispute</button>
            ) : (
              <button className="ic-btn ic-btn-ghost ic-btn-sm" onClick={onDispute}>Dispute</button>
            )}
            {hasPaused ? (
              <button className="ic-btn ic-btn-secondary ic-btn-sm" onClick={() => onResume(invoice.id)}>Resume</button>
            ) : !isPaused ? (
              <button className="ic-btn ic-btn-ghost ic-btn-sm" onClick={() => onPauseAll(invoice.id)}>Pause</button>
            ) : null}
          </div>
        )}
      </div>

      {/* Chase steps */}
      <div className="ic-chase-steps">
        {invoice.chase_queue.map((q) => {
          const tone = CHASE_TONE[q.chase_day];
          const stepClass = {
            scheduled: "ic-step-scheduled",
            sent: "ic-step-sent",
            skipped: "ic-step-skipped",
            paused: "ic-step-paused",
            failed: "ic-step-overdue",
          }[q.status];
          return (
            <div key={q.id} className={`ic-chase-step ${stepClass}`}>
              <div className="ic-step-day">Day {q.chase_day}</div>
              <div className="ic-step-label">{tone.label}</div>
              <div className="ic-step-date">
                {q.status === "sent" ? `Sent ${formatDate(q.sent_at)}` :
                 q.status === "skipped" ? "Skipped" :
                 q.status === "paused" ? "Paused" :
                 formatDate(q.scheduled_for)}
              </div>
              {q.status === "scheduled" && (userRole === "owner" || userRole === "manager") && (
                <div className="ic-step-actions" style={{ display: "flex", gap: 4, justifyContent: "center", flexWrap: "wrap" }}>
                  {/* Send now only once the scheduled date has passed — prevents premature sends. */}
                  {new Date(q.scheduled_for) <= new Date() && (
                    <button className="ic-btn ic-btn-primary ic-btn-sm" style={{ padding: "3px 8px", fontSize: 11 }} onClick={() => onSendNow(q)}>Send now</button>
                  )}
                  <button className="ic-btn ic-btn-ghost ic-btn-sm" style={{ padding: "3px 8px", fontSize: 11 }} onClick={() => onSkip(invoice.id, q.id)}>Skip</button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {invoice.disputed && (
        <div className="ic-dispute-banner">
          Disputed — chase paused pending resolution. Notes: {invoice.dispute_notes || "No notes added."}
        </div>
      )}
    </div>
  );
}

// ── SEND NOW MODAL ──────────────────────────────────────────────
function SendNowModal({ invoice, queueItem, template, accountName, brandColor, onSend, onClose }) {
  const [customMsg, setCustomMsg] = useState("");
  const vars = {
    customer_name: invoice.customer_name,
    invoice_number: invoice.invoice_number,
    amount: formatCurrency(invoice.total),
    due_date: formatDate(invoice.due_date),
    business_name: accountName,
    payment_link: "[Payment link will be inserted]",
  };
  const preview = mergeTemplate(customMsg || template.body, vars);
  const subject = mergeTemplate(template.subject, vars);

  return (
    <div className="ic-modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="ic-modal" style={{ maxWidth: 560 }}>
        <div className="ic-modal-header">
          <span className="ic-modal-title">Send Day {queueItem.chase_day} Chase Now</span>
          <button className="ic-btn ic-btn-ghost ic-btn-sm" onClick={onClose}>Close</button>
        </div>
        <div style={{ marginBottom: 12, padding: "10px 14px", background: "var(--chalk)", borderRadius: 6, fontSize: 13 }}>
          <strong>{invoice.customer_name}</strong> · {invoice.invoice_number} · {formatCurrency(invoice.total)}
        </div>
        <div className="ic-input-group">
          <label className="ic-input-label">Customise message (optional — leave blank to use template)</label>
          <textarea
            className="ic-input"
            style={{ minHeight: 120, resize: "vertical", fontSize: 13, lineHeight: 1.6 }}
            placeholder="Leave blank to use the standard template..."
            value={customMsg}
            onChange={(e) => setCustomMsg(e.target.value)}
          />
        </div>
        <div className="ic-email-preview" style={{ marginBottom: 16 }}>
          <div className="ic-email-header">
            <div className="ic-email-subject">{subject}</div>
            <div style={{ fontSize: 12, color: "var(--mist)", marginTop: 2 }}>To: {invoice.customer_email}</div>
          </div>
          <div className="ic-email-body" style={{ maxHeight: 150, overflowY: "auto" }}>{preview}</div>
        </div>
        <button className="ic-btn ic-btn-primary" style={{ width: "100%" }} onClick={onSend}>
          Send to {invoice.customer_email}
        </button>
      </div>
    </div>
  );
}

// ── DISPUTE MODAL ───────────────────────────────────────────────
function DisputeModal({ invoice, onSubmit, onClose }) {
  const [notes, setNotes] = useState("");
  return (
    <div className="ic-modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="ic-modal">
        <div className="ic-modal-header">
          <span className="ic-modal-title">Flag Invoice as Disputed</span>
          <button className="ic-btn ic-btn-ghost ic-btn-sm" onClick={onClose}>Close</button>
        </div>
        <div className="ic-alert ic-alert-warning">
          Flagging as disputed will pause the automated chase sequence. You'll need to resolve the dispute manually before chasing resumes.
        </div>
        <div style={{ marginBottom: 12, fontSize: 14, color: "var(--steel)" }}>
          <strong>{invoice?.customer_name}</strong> · {invoice?.invoice_number} · {formatCurrency(invoice?.total)}
        </div>
        <div className="ic-input-group">
          <label className="ic-input-label">Dispute notes</label>
          <textarea
            className="ic-input"
            style={{ minHeight: 80, resize: "vertical" }}
            placeholder="What is the customer disputing? What's the next step?"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>
        <button className="ic-btn ic-btn-danger" style={{ width: "100%" }} onClick={() => onSubmit(notes)}>
          Flag as Disputed & Pause Chase
        </button>
      </div>
    </div>
  );
}
