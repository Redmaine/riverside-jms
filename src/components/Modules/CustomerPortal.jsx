/**
 * CustomerPortal.jsx
 * Your Company AI — Customer Portal Module
 *
 * DEPENDENCIES (injected via props from core platform):
 *   supabase        — Supabase client instance
 *   accountId       — Current account UUID
 *   userId          — Current platform_user UUID
 *   userName        — Current user display name
 *   userRole        — 'owner' | 'manager' | 'staff'
 *
 * TWO VIEWS IN ONE FILE:
 *   1. PortalAdmin     — The business owner's management view (default export)
 *   2. PortalCustomer  — The customer-facing view (named export)
 *
 * The customer-facing view is accessed via magic link:
 *   https://app.yourcompanyai.co.uk/portal/{portal_token}
 *   No password required. Token expires after 30 days of inactivity.
 *   Supabase Edge Function generates and emails the magic link.
 *
 * DATABASE TABLES USED:
 *   portal_clients      — Portal access per contact
 *   portal_jobs         — Jobs visible to each portal client
 *   portal_invoices     — Invoices shared via portal
 *   portal_quotes       — Quotes awaiting approval
 *   portal_documents    — Files shared with client
 *   portal_messages     — Direct messages between business and client
 *   contacts            — Customer records (read only)
 *   audit_log           — Audit trail
 *
 * EXTERNAL:
 *   Stripe              — Invoice payment processing
 *   Supabase Storage    — Document storage
 *   Resend              — Magic link email delivery
 *
 * SCHEMA — add these tables to supabase_schema.sql:
 *
 * CREATE TABLE public.portal_clients (
 *   id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
 *   account_id      uuid REFERENCES public.accounts(id) ON DELETE CASCADE,
 *   contact_id      uuid REFERENCES public.contacts(id),
 *   customer_name   text NOT NULL,
 *   customer_email  text NOT NULL,
 *   portal_token    text UNIQUE DEFAULT encode(gen_random_bytes(32), 'hex'),
 *   active          boolean DEFAULT true,
 *   last_login      timestamptz,
 *   invite_sent_at  timestamptz,
 *   branding_color  text DEFAULT '#E8410A',
 *   created_at      timestamptz DEFAULT now()
 * );
 *
 * CREATE TABLE public.portal_jobs (
 *   id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
 *   account_id      uuid REFERENCES public.accounts(id) ON DELETE CASCADE,
 *   portal_client_id uuid REFERENCES public.portal_clients(id) ON DELETE CASCADE,
 *   title           text NOT NULL,
 *   description     text,
 *   status          text DEFAULT 'booked' CHECK (status IN
 *     ('enquiry','booked','in_progress','on_hold','complete','invoiced','paid')),
 *   stage_notes     text,
 *   scheduled_date  date,
 *   completion_date date,
 *   engineer_name   text,
 *   visible_to_client boolean DEFAULT true,
 *   created_at      timestamptz DEFAULT now(),
 *   updated_at      timestamptz DEFAULT now()
 * );
 *
 * CREATE TABLE public.portal_quotes (
 *   id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
 *   account_id      uuid REFERENCES public.accounts(id) ON DELETE CASCADE,
 *   portal_client_id uuid REFERENCES public.portal_clients(id) ON DELETE CASCADE,
 *   title           text NOT NULL,
 *   description     text,
 *   line_items      jsonb DEFAULT '[]',
 *   subtotal        numeric(10,2) DEFAULT 0,
 *   vat_amount      numeric(10,2) DEFAULT 0,
 *   total           numeric(10,2) DEFAULT 0,
 *   valid_until     date,
 *   status          text DEFAULT 'pending' CHECK (status IN ('pending','approved','declined','expired')),
 *   approved_at     timestamptz,
 *   declined_reason text,
 *   created_at      timestamptz DEFAULT now()
 * );
 *
 * CREATE TABLE public.portal_invoices (
 *   id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
 *   account_id      uuid REFERENCES public.accounts(id) ON DELETE CASCADE,
 *   portal_client_id uuid REFERENCES public.portal_clients(id) ON DELETE CASCADE,
 *   invoice_number  text NOT NULL,
 *   description     text,
 *   amount          numeric(10,2) NOT NULL,
 *   vat_amount      numeric(10,2) DEFAULT 0,
 *   total           numeric(10,2) NOT NULL,
 *   due_date        date,
 *   status          text DEFAULT 'unpaid' CHECK (status IN ('unpaid','paid','overdue','written_off')),
 *   stripe_payment_intent text,
 *   paid_at         timestamptz,
 *   pdf_url         text,
 *   created_at      timestamptz DEFAULT now()
 * );
 *
 * CREATE TABLE public.portal_documents (
 *   id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
 *   account_id      uuid REFERENCES public.accounts(id) ON DELETE CASCADE,
 *   portal_client_id uuid REFERENCES public.portal_clients(id) ON DELETE CASCADE,
 *   file_name       text NOT NULL,
 *   file_type       text,
 *   file_url        text NOT NULL,
 *   description     text,
 *   created_at      timestamptz DEFAULT now()
 * );
 *
 * CREATE TABLE public.portal_messages (
 *   id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
 *   account_id      uuid REFERENCES public.accounts(id) ON DELETE CASCADE,
 *   portal_client_id uuid REFERENCES public.portal_clients(id) ON DELETE CASCADE,
 *   sender          text CHECK (sender IN ('business','client')),
 *   message         text NOT NULL,
 *   read            boolean DEFAULT false,
 *   created_at      timestamptz DEFAULT now()
 * );
 *
 * Enable RLS on all tables with standard account_id policies.
 * Portal customer view uses portal_token to identify — separate RLS policy needed.
 */

import { useState, useMemo, useEffect, useCallback } from "react";

// ── STYLES ──────────────────────────────────────────────────────
const adminCss = `
  @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=DM+Sans:wght@300;400;500&display=swap');

  .cp-wrap * { box-sizing: border-box; margin: 0; padding: 0; }
  .cp-wrap {
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
    --radius:   8px;
    font-family: 'DM Sans', sans-serif;
    color: var(--mid);
    background: #F0EDE8;
    min-height: 100vh;
    padding: 24px;
  }

  .cp-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 24px; }
  .cp-header h1 { font-family: 'Plus Jakarta Sans', sans-serif; font-weight: 800; font-size: 22px; color: var(--steel); }
  .cp-header p  { font-size: 13px; color: var(--mist); margin-top: 2px; }

  .cp-tabs { display: flex; gap: 4px; background: var(--white); border: 1px solid var(--rule); border-radius: var(--radius); padding: 4px; margin-bottom: 24px; overflow-x: auto; }
  .cp-tab  { flex: 1; min-width: fit-content; padding: 8px 14px; border: none; background: none; border-radius: 6px; font-family: 'DM Sans', sans-serif; font-size: 13px; font-weight: 500; color: var(--light); cursor: pointer; white-space: nowrap; transition: all 0.15s; }
  .cp-tab.active { background: var(--steel); color: var(--white); }
  .cp-tab .badge { display: inline-flex; align-items: center; justify-content: center; width: 18px; height: 18px; background: var(--ember); color: white; border-radius: 50%; font-size: 10px; font-weight: 700; margin-left: 6px; }

  .cp-card { background: var(--white); border: 1px solid var(--rule); border-radius: var(--radius); padding: 20px; margin-bottom: 16px; }
  .cp-card-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 16px; margin-bottom: 24px; }
  .cp-stat-card { background: var(--white); border: 1px solid var(--rule); border-radius: var(--radius); padding: 18px 20px; }
  .cp-stat-label { font-size: 11px; font-weight: 600; color: var(--mist); text-transform: uppercase; letter-spacing: 1px; margin-bottom: 8px; }
  .cp-stat-value { font-family: 'Plus Jakarta Sans', sans-serif; font-weight: 800; font-size: 28px; color: var(--steel); line-height: 1; }
  .cp-stat-sub   { font-size: 12px; color: var(--mist); margin-top: 4px; }
  .cp-section-heading { font-family: 'Plus Jakarta Sans', sans-serif; font-weight: 700; font-size: 14px; color: var(--steel); margin-bottom: 12px; padding-bottom: 8px; border-bottom: 1px solid var(--rule); }

  /* Client row */
  .cp-client-row { display: flex; align-items: center; justify-content: space-between; padding: 14px 0; border-bottom: 1px solid var(--rule); gap: 12px; }
  .cp-client-row:last-child { border-bottom: none; }
  .cp-client-name { font-size: 14px; font-weight: 600; color: var(--steel); }
  .cp-client-meta { font-size: 12px; color: var(--mist); margin-top: 2px; }

  /* Client detail */
  .cp-client-card { background: var(--white); border: 1px solid var(--rule); border-radius: var(--radius); padding: 18px 20px; margin-bottom: 12px; transition: border-color 0.15s; }
  .cp-client-card:hover { border-color: var(--mist); }
  .cp-client-card.selected { border-color: var(--ember); }

  /* Job timeline */
  .cp-timeline { position: relative; padding-left: 24px; }
  .cp-timeline::before { content: ''; position: absolute; left: 7px; top: 8px; bottom: 8px; width: 2px; background: var(--rule); }
  .cp-timeline-item { position: relative; padding-bottom: 20px; }
  .cp-timeline-item:last-child { padding-bottom: 0; }
  .cp-timeline-dot { position: absolute; left: -24px; top: 4px; width: 16px; height: 16px; border-radius: 50%; border: 2px solid var(--white); }
  .cp-timeline-title { font-size: 14px; font-weight: 600; color: var(--steel); }
  .cp-timeline-meta  { font-size: 12px; color: var(--mist); margin-top: 2px; }
  .cp-timeline-note  { font-size: 13px; color: var(--mid); margin-top: 4px; line-height: 1.5; }

  /* Invoice row */
  .cp-invoice-row { display: flex; align-items: center; justify-content: space-between; padding: 12px 0; border-bottom: 1px solid var(--rule); }
  .cp-invoice-row:last-child { border-bottom: none; }

  /* Message thread */
  .cp-message { padding: 10px 14px; border-radius: 12px; max-width: 80%; margin-bottom: 8px; font-size: 13px; line-height: 1.5; }
  .cp-message-business { background: var(--steel); color: white; margin-left: auto; border-bottom-right-radius: 4px; }
  .cp-message-client   { background: var(--chalk); color: var(--mid); margin-right: auto; border-bottom-left-radius: 4px; }
  .cp-message-time { font-size: 10px; opacity: 0.6; margin-top: 4px; }

  /* Buttons */
  .cp-btn { display: inline-flex; align-items: center; gap: 6px; padding: 8px 14px; border-radius: 6px; font-family: 'DM Sans', sans-serif; font-size: 13px; font-weight: 500; cursor: pointer; border: none; transition: all 0.15s; white-space: nowrap; }
  .cp-btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .cp-btn-primary   { background: var(--ember); color: white; }
  .cp-btn-primary:hover:not(:disabled) { background: var(--ember-lt); }
  .cp-btn-secondary { background: var(--chalk); color: var(--steel); border: 1px solid var(--rule); }
  .cp-btn-secondary:hover:not(:disabled) { border-color: var(--mist); }
  .cp-btn-ghost     { background: none; color: var(--mist); border: 1px solid var(--rule); }
  .cp-btn-ghost:hover:not(:disabled) { color: var(--steel); border-color: var(--steel); }
  .cp-btn-sm        { padding: 5px 10px; font-size: 12px; }
  .cp-btn-success   { background: #DCFCE7; color: #166534; border: 1px solid #BBF7D0; }

  /* Pill */
  .cp-pill { display: inline-flex; align-items: center; padding: 3px 10px; border-radius: 20px; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; }
  .cp-pill-active   { background: #DCFCE7; color: #166534; }
  .cp-pill-inactive { background: #F3F4F6; color: #6B7280; }
  .cp-pill-unpaid   { background: #FEF9C3; color: #854D0E; }
  .cp-pill-paid     { background: #DCFCE7; color: #166534; }
  .cp-pill-overdue  { background: #FEE2E2; color: #991B1B; }
  .cp-pill-pending  { background: #FEF9C3; color: #854D0E; }
  .cp-pill-approved { background: #DCFCE7; color: #166534; }
  .cp-pill-declined { background: #FEE2E2; color: #991B1B; }

  /* Form */
  .cp-input { width: 100%; padding: 9px 12px; border: 1px solid var(--rule); border-radius: 6px; font-family: 'DM Sans', sans-serif; font-size: 14px; color: var(--steel); outline: none; transition: border-color 0.15s; background: white; }
  .cp-input:focus { border-color: var(--ember); }
  .cp-input-label { font-size: 13px; font-weight: 500; color: var(--steel); margin-bottom: 6px; display: block; }
  .cp-input-group { margin-bottom: 16px; }
  .cp-form-grid   { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  .cp-layout { display: grid; grid-template-columns: 280px 1fr; gap: 20px; }
  .cp-layout.single { grid-template-columns: 1fr; }
  @media (max-width: 640px) {
    .cp-layout, .cp-layout.single { grid-template-columns: 1fr; }
    .cp-form-grid { grid-template-columns: 1fr; }
  }

  /* Modal */
  .cp-modal-overlay { position: fixed; inset: 0; background: rgba(28,28,46,0.5); display: flex; align-items: center; justify-content: center; z-index: 100; padding: 20px; }
  .cp-modal { background: var(--white); border-radius: var(--radius); padding: 24px; width: 100%; max-width: 540px; max-height: 90vh; overflow-y: auto; }
  .cp-modal-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px; }
  .cp-modal-title  { font-family: 'Plus Jakarta Sans', sans-serif; font-weight: 700; font-size: 16px; color: var(--steel); }

  /* Alert */
  .cp-alert { padding: 12px 16px; border-radius: var(--radius); font-size: 13px; margin-bottom: 16px; }
  .cp-alert-success { background: #DCFCE7; border: 1px solid #BBF7D0; color: #166534; }
  .cp-alert-info    { background: #EFF6FF; border: 1px solid #BFDBFE; color: #1E40AF; }
  .cp-alert-warning { background: #FFFBEB; border: 1px solid #FDE68A; color: #92400E; }

  /* Empty */
  .cp-empty { text-align: center; padding: 48px 24px; color: var(--mist); }
  .cp-empty h3 { font-size: 16px; color: var(--steel); margin-bottom: 6px; }
`;

const customerCss = `
  @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=DM+Sans:wght@300;400;500&display=swap');

  .cpc-wrap * { box-sizing: border-box; margin: 0; padding: 0; }
  .cpc-wrap {
    font-family: 'DM Sans', sans-serif;
    background: #F8F7F4;
    min-height: 100vh;
    color: #444;
  }

  /* Header bar — branded to client's business */
  .cpc-topbar {
    padding: 0 20px;
    height: 60px;
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .cpc-business-name {
    font-family: 'Plus Jakarta Sans', sans-serif;
    font-weight: 800;
    font-size: 18px;
    color: white;
  }
  .cpc-powered {
    font-size: 11px;
    color: rgba(255,255,255,0.5);
  }

  /* Welcome section */
  .cpc-welcome {
    padding: 24px 20px 16px;
    border-bottom: 1px solid #E8E4DE;
    background: white;
  }
  .cpc-welcome h2 { font-family: 'Plus Jakarta Sans', sans-serif; font-weight: 800; font-size: 20px; color: #1C1C2E; }
  .cpc-welcome p  { font-size: 13px; color: #8C8CA8; margin-top: 4px; }

  /* Nav tabs */
  .cpc-nav { display: flex; background: white; border-bottom: 1px solid #E8E4DE; overflow-x: auto; }
  .cpc-nav-btn { flex: 1; min-width: fit-content; padding: 14px 16px; border: none; background: none; font-family: 'DM Sans', sans-serif; font-size: 13px; font-weight: 500; color: #8C8CA8; cursor: pointer; border-bottom: 2px solid transparent; white-space: nowrap; transition: all 0.15s; }
  .cpc-nav-btn.active { color: #1C1C2E; border-bottom-color: var(--brand-color, #E8410A); }

  /* Content */
  .cpc-content { padding: 20px; max-width: 600px; margin: 0 auto; }

  /* Job card */
  .cpc-job-card { background: white; border: 1px solid #E8E4DE; border-radius: 8px; padding: 16px 18px; margin-bottom: 12px; }
  .cpc-job-title { font-family: 'Plus Jakarta Sans', sans-serif; font-weight: 700; font-size: 15px; color: #1C1C2E; }
  .cpc-job-meta  { font-size: 12px; color: #8C8CA8; margin-top: 3px; }

  /* Status track */
  .cpc-status-track { display: flex; gap: 4px; margin-top: 14px; }
  .cpc-status-step { flex: 1; height: 4px; border-radius: 2px; background: #E8E4DE; }
  .cpc-status-step.done { background: var(--brand-color, #E8410A); }
  .cpc-status-step.current { background: var(--brand-color, #E8410A); opacity: 0.5; }
  .cpc-status-label { font-size: 11px; color: #8C8CA8; margin-top: 6px; text-align: center; }

  /* Invoice card */
  .cpc-invoice-card { background: white; border: 1px solid #E8E4DE; border-radius: 8px; padding: 16px 18px; margin-bottom: 12px; }
  .cpc-invoice-num  { font-size: 12px; color: #8C8CA8; margin-bottom: 4px; }
  .cpc-invoice-desc { font-weight: 600; color: #1C1C2E; font-size: 14px; }
  .cpc-invoice-amount { font-family: 'Plus Jakarta Sans', sans-serif; font-weight: 800; font-size: 22px; color: #1C1C2E; margin: 8px 0; }

  /* Quote card */
  .cpc-quote-card { background: white; border: 1px solid #E8E4DE; border-radius: 8px; padding: 16px 18px; margin-bottom: 12px; }

  /* Pay button */
  .cpc-pay-btn { width: 100%; padding: 14px; border: none; border-radius: 8px; font-family: 'Plus Jakarta Sans', sans-serif; font-weight: 700; font-size: 16px; color: white; cursor: pointer; margin-top: 12px; transition: opacity 0.15s; }
  .cpc-pay-btn:hover { opacity: 0.9; }

  /* Action buttons */
  .cpc-approve-btn { flex: 1; padding: 12px; border: none; border-radius: 6px; font-family: 'DM Sans', sans-serif; font-weight: 600; font-size: 14px; cursor: pointer; transition: opacity 0.15s; }
  .cpc-approve-btn:hover { opacity: 0.9; }

  /* Document row */
  .cpc-doc-row { display: flex; align-items: center; justify-content: space-between; padding: 12px 0; border-bottom: 1px solid #E8E4DE; }
  .cpc-doc-row:last-child { border-bottom: none; }

  /* Message input */
  .cpc-msg-input { width: 100%; padding: 10px 12px; border: 1px solid #E8E4DE; border-radius: 6px; font-family: 'DM Sans', sans-serif; font-size: 14px; outline: none; resize: none; background: white; }
  .cpc-msg-input:focus { border-color: var(--brand-color, #E8410A); }
`;

// ── HELPERS ─────────────────────────────────────────────────────
const formatCurrency = (n) => `£${(n || 0).toFixed(2)}`;
const formatDate = (d) => d ? new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—";

const JOB_STATUSES = ["enquiry", "booked", "in_progress", "on_hold", "complete", "invoiced", "paid"];
const JOB_STATUS_LABELS = {
  enquiry: "Enquiry", booked: "Booked", in_progress: "In Progress",
  on_hold: "On Hold", complete: "Complete", invoiced: "Invoiced", paid: "Paid",
};
const JOB_STATUS_COLORS = {
  enquiry: "#8C8CA8", booked: "#3B82F6", in_progress: "#F97316",
  on_hold: "#EAB308", complete: "#22C55E", invoiced: "#8B5CF6", paid: "#22C55E",
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
const MOCK_CLIENTS = [
  {
    id: "pc1",
    customer_name: "James Whitfield",
    customer_email: "james@whitfieldproperty.co.uk",
    active: true,
    last_login: "2026-06-04T10:30:00Z",
    invite_sent_at: "2026-05-20T09:00:00Z",
    portal_token: "abc123",
    jobs: [
      { id: "pj1", title: "Full bathroom refit", status: "complete", scheduled_date: "2026-05-20", completion_date: "2026-05-28", engineer_name: "Dave Thompson", stage_notes: "Job completed. Snagging visit booked for 10 June.", visible_to_client: true },
    ],
    invoices: [
      { id: "pi1", invoice_number: "INV-0042", description: "Full bathroom refit — Whitfield", amount: 3800, vat_amount: 0, total: 3800, due_date: "2026-06-15", status: "unpaid" },
    ],
    quotes: [],
    documents: [
      { id: "pd1", file_name: "Completion certificate.pdf", file_type: "pdf", description: "Gas Safe certificate", created_at: "2026-05-28" },
      { id: "pd2", file_name: "Job photos.zip", file_type: "zip", description: "Before and after photos", created_at: "2026-05-28" },
    ],
    messages: [
      { id: "pm1", sender: "business", message: "Hi James — just to let you know the bathroom is all finished. Invoice attached. Let me know if you have any questions.", created_at: "2026-05-28T16:00:00Z", read: true },
      { id: "pm2", sender: "client", message: "Thanks, looks brilliant! Really pleased with the result.", created_at: "2026-05-29T09:15:00Z", read: true },
    ],
  },
  {
    id: "pc2",
    customer_name: "Whitfield Commercial Ltd",
    customer_email: "facilities@whitfieldcommercial.co.uk",
    active: true,
    last_login: "2026-06-05T08:45:00Z",
    invite_sent_at: "2026-06-01T09:00:00Z",
    portal_token: "def456",
    jobs: [
      { id: "pj2", title: "Office heating system installation", status: "in_progress", scheduled_date: "2026-06-01", completion_date: null, engineer_name: "Dave Thompson", stage_notes: "Pipework first fix complete. Radiators being fitted Monday.", visible_to_client: true },
    ],
    invoices: [],
    quotes: [
      { id: "pq1", title: "Office heating system — Whitfield Commercial", description: "Supply and install new gas heating system across ground and first floor. 8 radiators, new boiler, full pipework.", line_items: [{ desc: "Worcester Bosch 25i combi boiler", qty: 1, price: 1850 }, { desc: "Double panel radiators × 8", qty: 8, price: 195 }, { desc: "Labour — 40 hours", qty: 40, price: 38 }, { desc: "Materials and fittings", qty: 1, price: 420 }], subtotal: 5130, vat_amount: 1026, total: 6156, valid_until: "2026-06-20", status: "approved", approved_at: "2026-06-02T10:30:00Z" },
    ],
    documents: [],
    messages: [
      { id: "pm3", sender: "business", message: "Morning — first fix is done. Radiators going on Monday, should be complete by Wednesday.", created_at: "2026-06-05T08:00:00Z", read: true },
    ],
  },
  {
    id: "pc3",
    customer_name: "Sarah Mitchell",
    customer_email: "sarah.mitchell@gmail.com",
    active: true,
    last_login: null,
    invite_sent_at: "2026-06-05T11:00:00Z",
    portal_token: "ghi789",
    jobs: [
      { id: "pj3", title: "Unvented cylinder replacement", status: "booked", scheduled_date: "2026-06-10", completion_date: null, engineer_name: "Steve Harris", stage_notes: "Booked for Tuesday 10 June, 8am start.", visible_to_client: true },
    ],
    invoices: [],
    quotes: [
      { id: "pq2", title: "Megaflo 250L unvented cylinder — supply and fit", description: "Remove existing vented cylinder. Supply and fit Megaflo 250L unvented cylinder with expansion vessel and pressure relief.", line_items: [{ desc: "Megaflo 250L cylinder", qty: 1, price: 680 }, { desc: "Labour — 6 hours", qty: 6, price: 38 }, { desc: "Materials and fittings", qty: 1, price: 120 }], subtotal: 1028, vat_amount: 0, total: 1028, valid_until: "2026-06-15", status: "pending" },
    ],
    documents: [],
    messages: [],
  },
];

// ── Live-schema <-> UI adapters ──────────────────────────────────
// "Clients" = contacts, enriched with their real jobs/invoices/quotes plus
// portal magic-links and notifications. Money is pence in the live schema.
const penceToPounds = (p) => (p ?? 0) / 100;
const contactName = (c) =>
  c ? ([c.first_name, c.last_name].filter(Boolean).join(" ") || c.business_name || "") : "";
const QUOTE_DB_TO_UI = { sent: "pending", draft: "pending", approved: "approved", rejected: "declined", expired: "declined", converted: "approved" };
const JOB_STATUS_UI_TO_DB = { complete: "completed", booked: "scheduled" };

function mapPortalJob(j) {
  return { id: j.id, title: j.title, status: j.status === "completed" ? "complete" : j.status, scheduled_date: j.scheduled_date, completion_date: j.completed_date, engineer_name: "", stage_notes: j.description || "", visible_to_client: true };
}
function mapPortalInvoice(i) {
  return { id: i.id, invoice_number: i.invoice_number, description: i.notes || "", amount: penceToPounds(i.total_pence), vat_amount: penceToPounds(i.vat_amount_pence), total: penceToPounds(i.total_pence), due_date: i.due_date, status: i.status === "paid" ? "paid" : "unpaid" };
}
function mapPortalQuote(q) {
  return { id: q.id, title: q.reference || q.quote_number, description: q.notes || "", line_items: [], subtotal: penceToPounds(q.subtotal_pence), vat_amount: penceToPounds(q.vat_amount_pence), total: penceToPounds(q.total_pence), valid_until: q.valid_until, status: QUOTE_DB_TO_UI[q.status] || q.status, approved_at: q.approved_at };
}
function mapClient(c) {
  const magic = (c.magic_links || []).slice().sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0] || null;
  return {
    id: c.id,
    customer_name: contactName(c),
    customer_email: c.email || "",
    active: true,
    last_login: magic?.used_at || null,
    invite_sent_at: magic?.created_at || null,
    portal_token: magic?.token || null,
    jobs: (c.jobs || []).map(mapPortalJob),
    invoices: (c.invoices || []).map(mapPortalInvoice),
    quotes: (c.quotes || []).map(mapPortalQuote),
    documents: [],
    messages: (c.notifications || []).filter((n) => n.type === "message").map((n) => ({ id: n.id, sender: "business", message: n.message, created_at: n.sent_at, read: !!n.read_at })),
  };
}

// ── ADMIN COMPONENT (business owner view) ───────────────────────
const ADMIN_TABS = [
  { id: "clients",   label: "Clients" },
  { id: "activity",  label: "Recent Activity" },
];

export default function CustomerPortal({
  supabase, accountId, userId, userName, userRole,
}) {
  const [activeTab, setActiveTab] = useState("clients");
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedClient, setSelectedClient] = useState(null);
  const [clientTab, setClientTab] = useState("jobs");
  const [showInvite, setShowInvite] = useState(false);
  const [showAddJob, setShowAddJob] = useState(false);
  const [showAddInvoice, setShowAddInvoice] = useState(false);
  const [showAddQuote, setShowAddQuote] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [newMessage, setNewMessage] = useState("");
  const [alert, setAlert] = useState(null);

  const showAlertMsg = (type, msg) => {
    setAlert({ type, message: msg });
    setTimeout(() => setAlert(null), 4000);
  };

  // ── Load real data (RLS scopes to this account) ──
  const loadData = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("contacts")
      .select("*, jobs:jobs(*), invoices:invoices(*), quotes:quotes(*), magic_links:portal_magic_links(*), notifications:portal_notifications(*)")
      .order("first_name");
    if (error) showAlertMsg("error", `Could not load clients: ${error.message}`);
    else setClients((data || []).map(mapClient));
    setLoading(false);
  }, [supabase]);

  useEffect(() => { loadData(); }, [loadData]);

  const totalClients = clients.filter((c) => c.active).length;
  const pendingQuotes = clients.flatMap((c) => c.quotes).filter((q) => q.status === "pending").length;
  const unpaidInvoices = clients.flatMap((c) => c.invoices).filter((i) => i.status === "unpaid").length;
  const unreadMessages = clients.flatMap((c) => c.messages).filter((m) => m.sender === "client" && !m.read).length;

  const sendInvite = async (clientId) => {
    // Issues a magic-link token. The actual email is sent by an edge function.
    const { data: link, error } = await supabase
      .from("portal_magic_links")
      .insert({ account_id: accountId, contact_id: clientId })
      .select("*")
      .single();
    if (error) { showAlertMsg("error", `Could not send invite: ${error.message}`); return; }
    setClients((prev) => prev.map((c) =>
      c.id === clientId ? { ...c, invite_sent_at: link.created_at, portal_token: link.token } : c
    ));
    await logAction(supabase, { accountId, userId, userName, userRole, action: "invited", entityType: "contact", entityId: clientId, entityName: "Portal invite" });
    showAlertMsg("success", "Portal invitation sent. The client will receive a magic link by email.");
  };

  const handleSendMessage = async (clientId) => {
    if (!newMessage.trim()) return;
    const { data: n, error } = await supabase
      .from("portal_notifications")
      .insert({ account_id: accountId, contact_id: clientId, type: "message", title: "Message from your installer", message: newMessage })
      .select("*")
      .single();
    if (error) { showAlertMsg("error", `Could not send message: ${error.message}`); return; }
    const msg = { id: n.id, sender: "business", message: n.message, created_at: n.sent_at, read: false };
    setClients((prev) => prev.map((c) =>
      c.id === clientId ? { ...c, messages: [...c.messages, msg] } : c
    ));
    setNewMessage("");
    showAlertMsg("success", "Message sent.");
  };

  const handleApproveQuoteAdmin = async (clientId, quoteId) => {
    const approved_at = new Date().toISOString();
    const { error } = await supabase.from("quotes").update({ status: "approved", approved_at }).eq("id", quoteId);
    if (error) { showAlertMsg("error", `Could not approve quote: ${error.message}`); return; }
    setClients((prev) => prev.map((c) =>
      c.id === clientId
        ? { ...c, quotes: c.quotes.map((q) => q.id === quoteId ? { ...q, status: "approved", approved_at } : q) }
        : c
    ));
    await logAction(supabase, { accountId, userId, userName, userRole, action: "approved", entityType: "quote", entityId: quoteId, entityName: "Quote approved" });
  };

  const selected = clients.find((c) => c.id === selectedClient);

  return (
    <>
      <style>{adminCss}</style>
      <div className="cp-wrap">

        <div className="cp-header">
          <div>
            <h1>Customer Portal</h1>
            <p>Client logins · Job updates · Invoices · Quote approvals</p>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {selectedClient && (
              <button className="cp-btn cp-btn-secondary" onClick={() => setShowPreview(true)}>
                Preview Client View
              </button>
            )}
            <button className="cp-btn cp-btn-primary" onClick={() => setShowInvite(true)}>
              + Invite Client
            </button>
          </div>
        </div>

        {alert && <div className={`cp-alert cp-alert-${alert.type}`}>{alert.message}</div>}

        {/* Stats */}
        <div className="cp-card-grid">
          <div className="cp-stat-card">
            <div className="cp-stat-label">Active Portals</div>
            <div className="cp-stat-value">{totalClients}</div>
            <div className="cp-stat-sub">Clients with access</div>
          </div>
          <div className="cp-stat-card">
            <div className="cp-stat-label">Pending Quotes</div>
            <div className="cp-stat-value" style={{ color: pendingQuotes > 0 ? "#EAB308" : "#22C55E" }}>{pendingQuotes}</div>
            <div className="cp-stat-sub">Awaiting approval</div>
          </div>
          <div className="cp-stat-card">
            <div className="cp-stat-label">Unpaid Invoices</div>
            <div className="cp-stat-value" style={{ color: unpaidInvoices > 0 ? "#EF4444" : "#22C55E" }}>{unpaidInvoices}</div>
            <div className="cp-stat-sub">Via portal</div>
          </div>
          <div className="cp-stat-card">
            <div className="cp-stat-label">Unread Messages</div>
            <div className="cp-stat-value" style={{ color: unreadMessages > 0 ? "#E8410A" : "#22C55E" }}>{unreadMessages}</div>
            <div className="cp-stat-sub">From clients</div>
          </div>
        </div>

        <div className={`cp-layout ${selectedClient ? "" : "single"}`}>

          {/* Client list */}
          <div>
            <div className="cp-card">
              <div className="cp-section-heading">Clients</div>
              {clients.map((client) => (
                <div
                  key={client.id}
                  className={`cp-client-card ${selectedClient === client.id ? "selected" : ""}`}
                  onClick={() => { setSelectedClient(client.id); setClientTab("jobs"); }}
                  style={{ cursor: "pointer", padding: "14px 16px", marginBottom: 8 }}
                >
                  <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
                    <div style={{ minWidth: 0 }}>
                      <div className="cp-client-name">{client.customer_name}</div>
                      <div className="cp-client-meta" style={{ wordBreak: "break-word" }}>{client.customer_email}</div>
                      <div className="cp-client-meta" style={{ marginTop: 4 }}>
                        {client.last_login ? `Last login: ${formatDate(client.last_login)}` : "Never logged in"}
                      </div>
                    </div>
                    <span className={`cp-pill cp-pill-${client.active ? "active" : "inactive"}`} style={{ flexShrink: 0 }}>
                      {client.active ? "Active" : "Inactive"}
                    </span>
                  </div>
                  {!client.last_login && (
                    <button
                      className="cp-btn cp-btn-secondary cp-btn-sm"
                      style={{ marginTop: 10 }}
                      onClick={(e) => { e.stopPropagation(); sendInvite(client.id); }}
                    >
                      Resend invite
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Client detail */}
          {selected && (
            <div>
              <div className="cp-card" style={{ marginBottom: 0, borderBottom: "none", borderBottomLeftRadius: 0, borderBottomRightRadius: 0 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div>
                    <div style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontWeight: 800, fontSize: 18, color: "var(--steel)" }}>{selected.customer_name}</div>
                    <div style={{ fontSize: 13, color: "var(--mist)", marginTop: 2 }}>{selected.customer_email}</div>
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button className="cp-btn cp-btn-secondary cp-btn-sm" onClick={() => setShowAddJob(true)}>+ Job</button>
                    <button className="cp-btn cp-btn-secondary cp-btn-sm" onClick={() => setShowAddQuote(true)}>+ Quote</button>
                    <button className="cp-btn cp-btn-secondary cp-btn-sm" onClick={() => setShowAddInvoice(true)}>+ Invoice</button>
                  </div>
                </div>
              </div>

              <div className="cp-tabs" style={{ borderTopLeftRadius: 0, borderTopRightRadius: 0, borderTop: "none" }}>
                {[
                  { id: "jobs", label: "Jobs" },
                  { id: "quotes", label: `Quotes${selected.quotes.filter((q) => q.status === "pending").length > 0 ? ` (${selected.quotes.filter((q) => q.status === "pending").length})` : ""}` },
                  { id: "invoices", label: `Invoices${selected.invoices.filter((i) => i.status === "unpaid").length > 0 ? ` (${selected.invoices.filter((i) => i.status === "unpaid").length})` : ""}` },
                  { id: "documents", label: "Documents" },
                  { id: "messages", label: `Messages${selected.messages.filter((m) => m.sender === "client" && !m.read).length > 0 ? ` (${selected.messages.filter((m) => m.sender === "client" && !m.read).length})` : ""}` },
                ].map((tab) => (
                  <button key={tab.id} className={`cp-tab ${clientTab === tab.id ? "active" : ""}`} onClick={() => setClientTab(tab.id)}>
                    {tab.label}
                  </button>
                ))}
              </div>

              {/* Jobs */}
              {clientTab === "jobs" && (
                <div>
                  {selected.jobs.length === 0 ? (
                    <div className="cp-empty"><h3>No jobs yet</h3></div>
                  ) : (
                    selected.jobs.map((job) => (
                      <div key={job.id} className="cp-card">
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                          <div>
                            <div style={{ fontWeight: 700, fontSize: 15, color: "var(--steel)" }}>{job.title}</div>
                            <div style={{ fontSize: 12, color: "var(--mist)", marginTop: 2 }}>
                              Engineer: {job.engineer_name} · {job.scheduled_date ? formatDate(job.scheduled_date) : "Date TBC"}
                            </div>
                          </div>
                          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <div style={{ width: 8, height: 8, borderRadius: "50%", background: JOB_STATUS_COLORS[job.status] }} />
                            <span style={{ fontSize: 13, fontWeight: 600, color: JOB_STATUS_COLORS[job.status] }}>
                              {JOB_STATUS_LABELS[job.status]}
                            </span>
                          </div>
                        </div>
                        {job.stage_notes && (
                          <div style={{ padding: "10px 12px", background: "var(--chalk)", borderRadius: 6, fontSize: 13, color: "var(--mid)" }}>
                            {job.stage_notes}
                          </div>
                        )}
                        <div style={{ marginTop: 10 }}>
                          <select
                            className="cp-input"
                            style={{ maxWidth: 200, fontSize: 12 }}
                            value={job.status}
                            onChange={async (e) => {
                              const ui = e.target.value;
                              const dbStatus = JOB_STATUS_UI_TO_DB[ui] || ui;
                              const { error } = await supabase.from("jobs").update({ status: dbStatus }).eq("id", job.id);
                              if (error) { showAlertMsg("error", `Could not update job: ${error.message}`); return; }
                              setClients((prev) => prev.map((c) =>
                                c.id === selected.id
                                  ? { ...c, jobs: c.jobs.map((j) => j.id === job.id ? { ...j, status: ui } : j) }
                                  : c
                              ));
                            }}
                          >
                            {JOB_STATUSES.map((s) => <option key={s} value={s}>{JOB_STATUS_LABELS[s]}</option>)}
                          </select>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}

              {/* Quotes */}
              {clientTab === "quotes" && (
                <div>
                  {selected.quotes.length === 0 ? (
                    <div className="cp-empty"><h3>No quotes</h3></div>
                  ) : (
                    selected.quotes.map((quote) => (
                      <div key={quote.id} className="cp-card">
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
                          <div style={{ fontWeight: 700, color: "var(--steel)", fontSize: 15 }}>{quote.title}</div>
                          <span className={`cp-pill cp-pill-${quote.status}`}>{quote.status}</span>
                        </div>
                        <div style={{ fontSize: 13, color: "var(--mid)", marginBottom: 12 }}>{quote.description}</div>
                        {quote.line_items.map((item, i) => (
                          <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "4px 0", borderBottom: "1px solid var(--rule)" }}>
                            <span>{item.desc} {item.qty > 1 ? `× ${item.qty}` : ""}</span>
                            <span style={{ fontWeight: 600 }}>{formatCurrency(item.qty * item.price)}</span>
                          </div>
                        ))}
                        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 10, paddingTop: 8, borderTop: "2px solid var(--rule)" }}>
                          <span style={{ fontWeight: 700, color: "var(--steel)" }}>Total</span>
                          <span style={{ fontWeight: 800, fontSize: 18, color: "var(--steel)", fontFamily: "'Plus Jakarta Sans', sans-serif" }}>{formatCurrency(quote.total)}</span>
                        </div>
                        {quote.status === "pending" && (
                          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                            <button className="cp-btn cp-btn-success" onClick={() => handleApproveQuoteAdmin(selected.id, quote.id)}>Mark Approved</button>
                          </div>
                        )}
                        {quote.approved_at && (
                          <div style={{ marginTop: 8, fontSize: 12, color: "#166534" }}>Approved {formatDate(quote.approved_at)}</div>
                        )}
                      </div>
                    ))
                  )}
                </div>
              )}

              {/* Invoices */}
              {clientTab === "invoices" && (
                <div>
                  {selected.invoices.length === 0 ? (
                    <div className="cp-empty"><h3>No invoices</h3></div>
                  ) : (
                    selected.invoices.map((inv) => (
                      <div key={inv.id} className="cp-card">
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                          <div>
                            <div style={{ fontWeight: 700, color: "var(--steel)" }}>{inv.invoice_number}</div>
                            <div style={{ fontSize: 13, color: "var(--mist)", marginTop: 2 }}>{inv.description} · Due {formatDate(inv.due_date)}</div>
                          </div>
                          <div style={{ textAlign: "right" }}>
                            <div style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontWeight: 800, fontSize: 20, color: "var(--steel)" }}>{formatCurrency(inv.total)}</div>
                            <span className={`cp-pill cp-pill-${inv.status}`}>{inv.status}</span>
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}

              {/* Documents */}
              {clientTab === "documents" && (
                <div className="cp-card">
                  {selected.documents.length === 0 ? (
                    <div className="cp-empty" style={{ padding: "32px 0" }}><p>No documents shared yet.</p></div>
                  ) : (
                    selected.documents.map((doc) => (
                      <div key={doc.id} className="cp-invoice-row">
                        <div>
                          <div style={{ fontWeight: 500, color: "var(--steel)", fontSize: 14 }}>{doc.file_name}</div>
                          <div style={{ fontSize: 12, color: "var(--mist)" }}>{doc.description} · {formatDate(doc.created_at)}</div>
                        </div>
                        <button className="cp-btn cp-btn-ghost cp-btn-sm">Download</button>
                      </div>
                    ))
                  )}
                  <button className="cp-btn cp-btn-secondary" style={{ marginTop: 12 }}>Upload Document</button>
                </div>
              )}

              {/* Messages */}
              {clientTab === "messages" && (
                <div className="cp-card">
                  <div className="cp-section-heading">Messages with {selected.customer_name}</div>
                  <div style={{ marginBottom: 16, maxHeight: 300, overflowY: "auto" }}>
                    {selected.messages.length === 0 ? (
                      <div style={{ textAlign: "center", padding: "20px", color: "var(--mist)", fontSize: 13 }}>No messages yet.</div>
                    ) : (
                      selected.messages.map((msg) => (
                        <div key={msg.id} style={{ display: "flex", flexDirection: "column", marginBottom: 4 }}>
                          <div className={`cp-message cp-message-${msg.sender}`}>
                            {msg.message}
                            <div className="cp-message-time">{formatDate(msg.created_at)}</div>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <textarea
                      className="cp-input"
                      style={{ flex: 1, minHeight: 60, resize: "none" }}
                      placeholder="Write a message..."
                      value={newMessage}
                      onChange={(e) => setNewMessage(e.target.value)}
                    />
                    <button className="cp-btn cp-btn-primary" disabled={!newMessage.trim()} onClick={() => handleSendMessage(selected.id)}>
                      Send
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Portal Preview Modal */}
        {showPreview && selected && (
          <div className="cp-modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) setShowPreview(false); }}>
            <div className="cp-modal" style={{ maxWidth: 420, padding: 0, overflow: "hidden" }}>
              <div style={{ padding: "12px 16px", background: "var(--steel)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ color: "var(--mist)", fontSize: 13 }}>Customer view preview</span>
                <button className="cp-btn cp-btn-ghost cp-btn-sm" style={{ color: "var(--mist)", borderColor: "var(--steel)" }} onClick={() => setShowPreview(false)}>Close</button>
              </div>
              <PortalCustomer client={selected} brandColor="#E8410A" businessName="Your Company AI" preview />
            </div>
          </div>
        )}

        {/* Invite modal */}
        {showInvite && (
          <InviteClientModal
            onSubmit={async (data) => {
              const parts = (data.customer_name || "").trim().split(/\s+/);
              const { data: contact, error } = await supabase
                .from("contacts")
                .insert({ account_id: accountId, first_name: parts[0] || data.customer_name, last_name: parts.slice(1).join(" ") || null, email: data.customer_email })
                .select("*")
                .single();
              if (error) { showAlertMsg("error", `Could not add client: ${error.message}`); return; }
              const { data: link } = await supabase
                .from("portal_magic_links")
                .insert({ account_id: accountId, contact_id: contact.id })
                .select("*")
                .single();
              const newClient = { ...mapClient(contact), invite_sent_at: link?.created_at || new Date().toISOString(), portal_token: link?.token || null };
              setClients((prev) => [...prev, newClient]);
              setShowInvite(false);
              await logAction(supabase, { accountId, userId, userName, userRole, action: "invited", entityType: "contact", entityId: contact.id, entityName: contactName(contact) });
              showAlertMsg("success", `Portal invitation sent to ${data.customer_email}.`);
            }}
            onClose={() => setShowInvite(false)}
          />
        )}
      </div>
    </>
  );
}

// ── CUSTOMER-FACING PORTAL VIEW ─────────────────────────────────
export function PortalCustomer({ client, brandColor = "#E8410A", businessName = "Your Company", preview = false }) {
  const [activeSection, setActiveSection] = useState("jobs");
  const [jobs, setJobs] = useState(client.jobs);
  const [quotes, setQuotes] = useState(client.quotes);
  const [messages, setMessages] = useState(client.messages);
  const [newMessage, setNewMessage] = useState("");
  const [paid, setPaid] = useState({});

  const statusStepIndex = (status) => JOB_STATUSES.indexOf(status);

  const handleApproveQuote = (quoteId) => {
    setQuotes((prev) => prev.map((q) => q.id === quoteId ? { ...q, status: "approved", approved_at: new Date().toISOString() } : q));
  };
  const handleDeclineQuote = (quoteId) => {
    setQuotes((prev) => prev.map((q) => q.id === quoteId ? { ...q, status: "declined" } : q));
  };

  return (
    <>
      <style>{customerCss.replace(/var\(--brand-color, #E8410A\)/g, brandColor)}</style>
      <div className="cpc-wrap">

        <div className="cpc-topbar" style={{ background: brandColor }}>
          <div className="cpc-business-name">{businessName}</div>
          <div className="cpc-powered">Powered by Your Company AI</div>
        </div>

        <div className="cpc-welcome">
          <h2>Hello, {client.customer_name.split(" ")[0]}</h2>
          <p>Your job updates, invoices, and documents — all in one place.</p>
        </div>

        <nav className="cpc-nav">
          {[
            { id: "jobs",      label: "My Jobs" },
            { id: "quotes",    label: `Quotes${quotes.filter((q) => q.status === "pending").length > 0 ? ` (${quotes.filter((q) => q.status === "pending").length})` : ""}` },
            { id: "invoices",  label: `Invoices${client.invoices.filter((i) => i.status === "unpaid").length > 0 ? ` (${client.invoices.filter((i) => i.status === "unpaid").length})` : ""}` },
            { id: "documents", label: "Documents" },
            { id: "messages",  label: "Messages" },
          ].map((s) => (
            <button key={s.id} className={`cpc-nav-btn ${activeSection === s.id ? "active" : ""}`} style={{ "--brand-color": brandColor }} onClick={() => setActiveSection(s.id)}>
              {s.label}
            </button>
          ))}
        </nav>

        <div className="cpc-content">

          {/* Jobs */}
          {activeSection === "jobs" && (
            <div>
              {jobs.length === 0 ? (
                <div style={{ textAlign: "center", padding: "40px 20px", color: "#8C8CA8" }}>No jobs yet.</div>
              ) : (
                jobs.map((job) => {
                  const stepIdx = statusStepIndex(job.status);
                  const visibleSteps = ["booked", "in_progress", "complete", "paid"];
                  const curStep = visibleSteps.indexOf(["booked", "in_progress", "complete", "invoiced", "paid"].includes(job.status) ? job.status : "booked");
                  return (
                    <div key={job.id} className="cpc-job-card">
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                        <div>
                          <div className="cpc-job-title">{job.title}</div>
                          <div className="cpc-job-meta">
                            {job.engineer_name && `${job.engineer_name} · `}
                            {job.scheduled_date ? formatDate(job.scheduled_date) : "Date to be confirmed"}
                          </div>
                        </div>
                        <div style={{ width: 10, height: 10, borderRadius: "50%", background: JOB_STATUS_COLORS[job.status], flexShrink: 0, marginTop: 4 }} />
                      </div>
                      {job.stage_notes && (
                        <div style={{ marginTop: 10, padding: "10px 12px", background: "#F8F7F4", borderRadius: 6, fontSize: 13, color: "#555", borderLeft: `3px solid ${brandColor}` }}>
                          {job.stage_notes}
                        </div>
                      )}
                      <div className="cpc-status-track" style={{ marginTop: 14 }}>
                        {visibleSteps.map((step, i) => (
                          <div key={step} className={`cpc-status-step ${i < curStep ? "done" : i === curStep ? "current" : ""}`} style={i < curStep || i === curStep ? { background: brandColor } : {}} />
                        ))}
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between" }}>
                        {visibleSteps.map((step) => (
                          <div key={step} className="cpc-status-label" style={{ flex: 1 }}>{JOB_STATUS_LABELS[step]}</div>
                        ))}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}

          {/* Quotes */}
          {activeSection === "quotes" && (
            <div>
              {quotes.length === 0 ? (
                <div style={{ textAlign: "center", padding: "40px 20px", color: "#8C8CA8" }}>No quotes.</div>
              ) : (
                quotes.map((quote) => (
                  <div key={quote.id} className="cpc-quote-card">
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                      <div style={{ fontWeight: 700, color: "#1C1C2E", fontSize: 14 }}>{quote.title}</div>
                      <span className={`cp-pill cp-pill-${quote.status}`}>{quote.status}</span>
                    </div>
                    <div style={{ fontSize: 13, color: "#888", marginBottom: 12 }}>{quote.description}</div>
                    {quote.line_items.map((item, i) => (
                      <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "4px 0", borderBottom: "1px solid #E8E4DE" }}>
                        <span style={{ color: "#555" }}>{item.desc}</span>
                        <span style={{ fontWeight: 600, color: "#1C1C2E" }}>{formatCurrency(item.qty * item.price)}</span>
                      </div>
                    ))}
                    <div style={{ display: "flex", justifyContent: "space-between", marginTop: 10, paddingTop: 8, borderTop: "2px solid #E8E4DE" }}>
                      <span style={{ fontWeight: 700, color: "#1C1C2E" }}>Total</span>
                      <span style={{ fontWeight: 800, fontSize: 20, color: "#1C1C2E" }}>{formatCurrency(quote.total)}</span>
                    </div>
                    {quote.status === "pending" && (
                      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                        <button className="cpc-approve-btn" style={{ background: brandColor, color: "white" }} onClick={() => handleApproveQuote(quote.id)}>
                          Approve Quote
                        </button>
                        <button className="cpc-approve-btn" style={{ background: "#F3F4F6", color: "#6B7280", flex: 0.4 }} onClick={() => handleDeclineQuote(quote.id)}>
                          Decline
                        </button>
                      </div>
                    )}
                    {quote.approved_at && <div style={{ marginTop: 8, fontSize: 12, color: "#166534" }}>Approved {formatDate(quote.approved_at)}</div>}
                    {quote.valid_until && quote.status === "pending" && <div style={{ marginTop: 6, fontSize: 11, color: "#92400E" }}>Valid until {formatDate(quote.valid_until)}</div>}
                  </div>
                ))
              )}
            </div>
          )}

          {/* Invoices */}
          {activeSection === "invoices" && (
            <div>
              {client.invoices.length === 0 ? (
                <div style={{ textAlign: "center", padding: "40px 20px", color: "#8C8CA8" }}>No invoices.</div>
              ) : (
                client.invoices.map((inv) => (
                  <div key={inv.id} className="cpc-invoice-card">
                    <div className="cpc-invoice-num">{inv.invoice_number}</div>
                    <div className="cpc-invoice-desc">{inv.description}</div>
                    <div className="cpc-invoice-amount">{formatCurrency(inv.total)}</div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ fontSize: 13, color: "#8C8CA8" }}>Due {formatDate(inv.due_date)}</span>
                      <span className={`cp-pill cp-pill-${inv.status}`}>{inv.status}</span>
                    </div>
                    {inv.status === "unpaid" && !paid[inv.id] && (
                      <button
                        className="cpc-pay-btn"
                        style={{ background: brandColor }}
                        onClick={() => { setPaid((p) => ({ ...p, [inv.id]: true })); }}
                      >
                        Pay Now — {formatCurrency(inv.total)}
                      </button>
                    )}
                    {paid[inv.id] && (
                      <div style={{ marginTop: 8, padding: "10px 12px", background: "#DCFCE7", borderRadius: 6, fontSize: 13, color: "#166534", fontWeight: 500 }}>
                        Payment processing — you'll receive a receipt by email.
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          )}

          {/* Documents */}
          {activeSection === "documents" && (
            <div style={{ background: "white", borderRadius: 8, border: "1px solid #E8E4DE", padding: "16px 18px" }}>
              {client.documents.length === 0 ? (
                <div style={{ textAlign: "center", padding: "32px 0", color: "#8C8CA8" }}>No documents shared yet.</div>
              ) : (
                client.documents.map((doc) => (
                  <div key={doc.id} className="cpc-doc-row">
                    <div>
                      <div style={{ fontWeight: 500, color: "#1C1C2E", fontSize: 14 }}>{doc.file_name}</div>
                      <div style={{ fontSize: 12, color: "#8C8CA8" }}>{doc.description}</div>
                    </div>
                    <button style={{ padding: "6px 12px", background: brandColor, color: "white", border: "none", borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                      Download
                    </button>
                  </div>
                ))
              )}
            </div>
          )}

          {/* Messages */}
          {activeSection === "messages" && (
            <div>
              <div style={{ background: "white", borderRadius: 8, border: "1px solid #E8E4DE", padding: "16px 18px", marginBottom: 12 }}>
                {messages.length === 0 ? (
                  <div style={{ textAlign: "center", padding: "24px 0", color: "#8C8CA8", fontSize: 13 }}>No messages yet.</div>
                ) : (
                  <div style={{ maxHeight: 300, overflowY: "auto" }}>
                    {messages.map((msg) => (
                      <div key={msg.id} style={{ display: "flex", flexDirection: "column", marginBottom: 4 }}>
                        <div className={`cp-message cp-message-${msg.sender}`} style={msg.sender === "business" ? { background: brandColor } : {}}>
                          {msg.message}
                          <div className="cp-message-time">{formatDate(msg.created_at)}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <textarea
                  className="cpc-msg-input"
                  style={{ flex: 1, minHeight: 60 }}
                  placeholder="Write a message..."
                  value={newMessage}
                  onChange={(e) => setNewMessage(e.target.value)}
                />
                <button
                  style={{ padding: "10px 16px", background: brandColor, color: "white", border: "none", borderRadius: 6, fontWeight: 600, cursor: "pointer", alignSelf: "flex-end" }}
                  disabled={!newMessage.trim()}
                  onClick={() => {
                    setMessages((prev) => [...prev, { id: `pm${Date.now()}`, sender: "client", message: newMessage, created_at: new Date().toISOString(), read: false }]);
                    setNewMessage("");
                  }}
                >
                  Send
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

// ── INVITE CLIENT MODAL ─────────────────────────────────────────
function InviteClientModal({ onSubmit, onClose }) {
  const [form, setForm] = useState({ customer_name: "", customer_email: "", invite_sent_at: new Date().toISOString() });
  return (
    <div className="cp-modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="cp-modal">
        <div className="cp-modal-header">
          <span className="cp-modal-title">Invite Client to Portal</span>
          <button className="cp-btn cp-btn-ghost cp-btn-sm" onClick={onClose}>Close</button>
        </div>
        <div className="cp-alert cp-alert-info">
          The client will receive a magic link by email. One tap — they're straight in. No password needed.
        </div>
        <div className="cp-input-group">
          <label className="cp-input-label">Client name *</label>
          <input className="cp-input" placeholder="Full name" value={form.customer_name} onChange={(e) => setForm((p) => ({ ...p, customer_name: e.target.value }))} />
        </div>
        <div className="cp-input-group">
          <label className="cp-input-label">Email address *</label>
          <input type="email" className="cp-input" placeholder="client@example.com" value={form.customer_email} onChange={(e) => setForm((p) => ({ ...p, customer_email: e.target.value }))} />
        </div>
        <button className="cp-btn cp-btn-primary" style={{ width: "100%" }} disabled={!form.customer_name || !form.customer_email} onClick={() => onSubmit(form)}>
          Send Portal Invitation
        </button>
      </div>
    </div>
  );
}
