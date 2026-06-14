/**
 * WhatsAppBusiness.jsx
 * Your Company AI — WhatsApp Business Integration Module
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
 *   Uses Meta's WhatsApp Business API (Cloud API).
 *   Messages sent and received are logged against the relevant contact/job.
 *   Automated notifications go out on key events (booking confirmed,
 *   invoice sent, job status updated, etc.)
 *   Pass-through billing: Meta charges per conversation (~£0.05–£0.08).
 *   Platform adds margin and charges client monthly based on usage.
 *
 * PRICING:
 *   Module: £19.99/mo
 *   Message pass-through: billed at cost + 20% margin
 *   Free tier: 1,000 conversations/month included with Meta
 *
 * TABS:
 *   Inbox · Contacts · Automations · Templates · Analytics · Settings
 *
 * DATABASE TABLES USED:
 *   wa_conversations    — Conversation threads per contact
 *   wa_messages         — Individual messages per conversation
 *   wa_templates        — Approved message templates
 *   wa_automations      — Trigger-based automation rules
 *   wa_settings         — WhatsApp config per account
 *   contacts            — CRM contacts (read + write)
 *   audit_log           — Audit trail
 *
 * EXTERNAL:
 *   Meta WhatsApp Cloud API  — Send/receive messages
 *   Meta Business Manager    — Template approval
 *   Supabase Edge Function   — Webhook receiver for incoming messages
 *   Resend                   — Fallback email if WhatsApp fails
 *
 * SCHEMA — add these tables to supabase_schema.sql:
 *
 * CREATE TABLE public.wa_settings (
 *   id                    uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
 *   account_id            uuid REFERENCES public.accounts(id) ON DELETE CASCADE UNIQUE,
 *   phone_number_id       text,
 *   whatsapp_business_id  text,
 *   display_phone_number  text,
 *   business_name         text,
 *   connected             boolean DEFAULT false,
 *   connected_at          timestamptz,
 *   monthly_conversations int DEFAULT 0,
 *   monthly_spend_pence   int DEFAULT 0,
 *   billing_period_start  date,
 *   created_at            timestamptz DEFAULT now(),
 *   updated_at            timestamptz DEFAULT now()
 * );
 *
 * CREATE TABLE public.wa_conversations (
 *   id                  uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
 *   account_id          uuid REFERENCES public.accounts(id) ON DELETE CASCADE,
 *   contact_id          uuid REFERENCES public.contacts(id),
 *   contact_name        text NOT NULL,
 *   contact_phone       text NOT NULL,
 *   last_message        text,
 *   last_message_at     timestamptz,
 *   unread_count        int DEFAULT 0,
 *   status              text DEFAULT 'open' CHECK (status IN ('open','resolved','blocked')),
 *   linked_job_id       uuid,
 *   linked_invoice_id   uuid,
 *   created_at          timestamptz DEFAULT now(),
 *   updated_at          timestamptz DEFAULT now()
 * );
 *
 * CREATE TABLE public.wa_messages (
 *   id                  uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
 *   account_id          uuid REFERENCES public.accounts(id) ON DELETE CASCADE,
 *   conversation_id     uuid REFERENCES public.wa_conversations(id) ON DELETE CASCADE,
 *   direction           text CHECK (direction IN ('inbound','outbound')),
 *   message_type        text DEFAULT 'text' CHECK (message_type IN
 *     ('text','image','document','audio','template','reaction')),
 *   content             text,
 *   media_url           text,
 *   template_name       text,
 *   status              text DEFAULT 'sent' CHECK (status IN
 *     ('pending','sent','delivered','read','failed')),
 *   wa_message_id       text UNIQUE,
 *   sent_by             text,
 *   created_at          timestamptz DEFAULT now()
 * );
 *
 * CREATE TABLE public.wa_templates (
 *   id                  uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
 *   account_id          uuid REFERENCES public.accounts(id) ON DELETE CASCADE,
 *   name                text NOT NULL,
 *   category            text CHECK (category IN ('utility','marketing','authentication')),
 *   language            text DEFAULT 'en_GB',
 *   body                text NOT NULL,
 *   variables           text[],
 *   status              text DEFAULT 'pending' CHECK (status IN
 *     ('pending','approved','rejected')),
 *   meta_template_id    text,
 *   created_at          timestamptz DEFAULT now()
 * );
 *
 * CREATE TABLE public.wa_automations (
 *   id                  uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
 *   account_id          uuid REFERENCES public.accounts(id) ON DELETE CASCADE,
 *   name                text NOT NULL,
 *   trigger_event       text NOT NULL,
 *   template_id         uuid REFERENCES public.wa_templates(id),
 *   template_name       text,
 *   delay_minutes       int DEFAULT 0,
 *   active              boolean DEFAULT true,
 *   run_count           int DEFAULT 0,
 *   last_run_at         timestamptz,
 *   created_at          timestamptz DEFAULT now()
 * );
 *
 * Enable RLS on all tables with standard account_id policies.
 *
 * WEBHOOK SETUP (Supabase Edge Function):
 *   POST /functions/v1/whatsapp-webhook
 *   Receives messages from Meta, inserts into wa_messages,
 *   updates wa_conversations.unread_count and last_message.
 *   Must verify webhook with Meta challenge token.
 */

import { useState, useMemo, useRef, useEffect, useCallback } from "react";

// ── CONSTANTS ───────────────────────────────────────────────────
const TABS = [
  { id: "inbox",       label: "Inbox" },
  { id: "contacts",    label: "Contacts" },
  { id: "automations", label: "Automations" },
  { id: "templates",   label: "Templates" },
  { id: "analytics",   label: "Analytics" },
  { id: "settings",    label: "Settings" },
];

const AUTOMATION_TRIGGERS = [
  { value: "booking_confirmed",   label: "Booking confirmed" },
  { value: "booking_reminder",    label: "Booking reminder (24h before)" },
  { value: "invoice_sent",        label: "Invoice sent" },
  { value: "invoice_overdue",     label: "Invoice overdue" },
  { value: "invoice_paid",        label: "Invoice paid — thank you" },
  { value: "job_started",         label: "Job started" },
  { value: "job_complete",        label: "Job complete" },
  { value: "quote_sent",          label: "Quote sent" },
  { value: "review_request",      label: "Review request" },
  { value: "new_message",         label: "New inbound message (auto-reply)" },
];

// ── STYLES ──────────────────────────────────────────────────────
const css = `
  @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=DM+Sans:wght@300;400;500&display=swap');

  .wa-wrap * { box-sizing: border-box; margin: 0; padding: 0; }
  .wa-wrap {
    --ember:    #E8410A;
    --ember-lt: #FF6B3D;
    --steel:    #1C1C2E;
    --chalk:    #F7F4EF;
    --mist:     #8C8CA8;
    --mid:      #555555;
    --light:    #888888;
    --rule:     #E8E4DE;
    --white:    #FFFFFF;
    --wa-green: #25D366;
    --wa-dark:  #075E54;
    --wa-light: #DCF8C6;
    --wa-bg:    #ECE5DD;
    --radius:   8px;
    font-family: 'DM Sans', sans-serif;
    color: var(--mid);
    background: #F0EDE8;
    min-height: 100vh;
    padding: 24px;
  }

  .wa-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 24px; }
  .wa-header h1 { font-family: 'Plus Jakarta Sans', sans-serif; font-weight: 800; font-size: 22px; color: var(--steel); }
  .wa-header p  { font-size: 13px; color: var(--mist); margin-top: 2px; }

  .wa-tabs { display: flex; gap: 4px; background: var(--white); border: 1px solid var(--rule); border-radius: var(--radius); padding: 4px; margin-bottom: 24px; overflow-x: auto; }
  .wa-tab  { flex: 1; min-width: fit-content; padding: 8px 14px; border: none; background: none; border-radius: 6px; font-family: 'DM Sans', sans-serif; font-size: 13px; font-weight: 500; color: var(--light); cursor: pointer; white-space: nowrap; transition: all 0.15s; }
  .wa-tab.active { background: var(--steel); color: var(--white); }
  .wa-tab .badge { display: inline-flex; align-items: center; justify-content: center; width: 18px; height: 18px; background: var(--wa-green); color: white; border-radius: 50%; font-size: 10px; font-weight: 700; margin-left: 6px; }

  .wa-card { background: var(--white); border: 1px solid var(--rule); border-radius: var(--radius); padding: 20px; margin-bottom: 16px; }
  .wa-card-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 16px; margin-bottom: 24px; }
  .wa-stat-card { background: var(--white); border: 1px solid var(--rule); border-radius: var(--radius); padding: 18px 20px; }
  .wa-stat-label { font-size: 11px; font-weight: 600; color: var(--mist); text-transform: uppercase; letter-spacing: 1px; margin-bottom: 8px; }
  .wa-stat-value { font-family: 'Plus Jakarta Sans', sans-serif; font-weight: 800; font-size: 26px; color: var(--steel); line-height: 1; }
  .wa-stat-sub   { font-size: 12px; color: var(--mist); margin-top: 4px; }
  .wa-section-heading { font-family: 'Plus Jakarta Sans', sans-serif; font-weight: 700; font-size: 14px; color: var(--steel); margin-bottom: 12px; padding-bottom: 8px; border-bottom: 1px solid var(--rule); }

  /* WhatsApp chat UI */
  .wa-chat-layout { display: grid; grid-template-columns: 280px 1fr; gap: 0; background: white; border: 1px solid var(--rule); border-radius: var(--radius); overflow: hidden; height: 580px; }

  /* Conversation list */
  .wa-conv-list { border-right: 1px solid var(--rule); overflow-y: auto; }
  .wa-conv-header { padding: 14px 16px; background: var(--wa-dark); display: flex; align-items: center; justify-content: space-between; }
  .wa-conv-header-title { font-family: 'Plus Jakarta Sans', sans-serif; font-weight: 700; font-size: 15px; color: white; }
  .wa-conv-search { padding: 8px; background: #f0f0f0; }
  .wa-conv-search input { width: 100%; padding: 7px 12px; border: none; border-radius: 20px; font-size: 13px; background: white; outline: none; }
  .wa-conv-item { display: flex; align-items: center; gap: 10px; padding: 12px 14px; border-bottom: 1px solid #f5f5f5; cursor: pointer; transition: background 0.1s; }
  .wa-conv-item:hover { background: #f9f9f9; }
  .wa-conv-item.active { background: #f0f0f0; }
  .wa-conv-avatar { width: 42px; height: 42px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 16px; color: white; flex-shrink: 0; }
  .wa-conv-name { font-size: 14px; font-weight: 600; color: #111; }
  .wa-conv-preview { font-size: 12px; color: #888; margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 150px; }
  .wa-conv-time { font-size: 11px; color: #888; flex-shrink: 0; }
  .wa-conv-unread { width: 20px; height: 20px; border-radius: 50%; background: var(--wa-green); color: white; font-size: 11px; font-weight: 700; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }

  /* Chat window */
  .wa-chat-window { display: flex; flex-direction: column; }
  .wa-chat-header { padding: 12px 16px; background: var(--wa-dark); display: flex; align-items: center; gap: 10px; flex-shrink: 0; }
  .wa-chat-contact-name { font-family: 'Plus Jakarta Sans', sans-serif; font-weight: 700; font-size: 15px; color: white; }
  .wa-chat-contact-sub { font-size: 12px; color: rgba(255,255,255,0.7); }
  .wa-chat-messages { flex: 1; overflow-y: auto; padding: 16px; background: var(--wa-bg); display: flex; flex-direction: column; gap: 6px; }
  .wa-message { max-width: 75%; padding: 8px 12px; border-radius: 8px; font-size: 13px; line-height: 1.5; position: relative; }
  .wa-message-out { background: var(--wa-light); align-self: flex-end; border-bottom-right-radius: 2px; }
  .wa-message-in  { background: white; align-self: flex-start; border-bottom-left-radius: 2px; box-shadow: 0 1px 1px rgba(0,0,0,0.05); }
  .wa-message-time { font-size: 10px; color: #999; margin-top: 3px; text-align: right; }
  .wa-message-status { font-size: 10px; color: var(--wa-green); }
  .wa-message-template { background: #E8F5E9; border: 1px solid #A5D6A7; }
  .wa-chat-input { padding: 12px; background: #f0f0f0; display: flex; gap: 8px; align-items: center; flex-shrink: 0; }
  .wa-chat-input input { flex: 1; padding: 10px 14px; border: none; border-radius: 20px; font-size: 14px; outline: none; background: white; }
  .wa-send-btn { width: 40px; height: 40px; border-radius: 50%; background: var(--wa-dark); border: none; cursor: pointer; display: flex; align-items: center; justify-content: center; flex-shrink: 0; transition: background 0.15s; }
  .wa-send-btn:hover { background: var(--wa-green); }
  .wa-empty-chat { display: flex; align-items: center; justify-content: center; height: 100%; color: #999; flex-direction: column; gap: 8px; background: var(--wa-bg); }

  /* Automation row */
  .wa-auto-row { display: flex; align-items: center; justify-content: space-between; padding: 12px 0; border-bottom: 1px solid var(--rule); gap: 12px; }
  .wa-auto-row:last-child { border-bottom: none; }
  .wa-auto-name { font-size: 14px; font-weight: 600; color: var(--steel); }
  .wa-auto-meta { font-size: 12px; color: var(--mist); margin-top: 2px; }

  /* Template row */
  .wa-tmpl-row { padding: 14px 0; border-bottom: 1px solid var(--rule); }
  .wa-tmpl-row:last-child { border-bottom: none; }
  .wa-tmpl-name { font-size: 14px; font-weight: 600; color: var(--steel); margin-bottom: 6px; }
  .wa-tmpl-body { font-size: 13px; color: var(--mid); background: var(--chalk); padding: 10px 12px; border-radius: 6px; line-height: 1.5; font-family: monospace; }

  /* Analytics bars */
  .wa-analytics-row { display: flex; align-items: center; gap: 12px; padding: 8px 0; }
  .wa-analytics-label { width: 140px; font-size: 13px; color: var(--mid); flex-shrink: 0; }
  .wa-analytics-bar-wrap { flex: 1; height: 8px; background: var(--rule); border-radius: 4px; overflow: hidden; }
  .wa-analytics-bar-fill { height: 100%; border-radius: 4px; transition: width 0.4s; }
  .wa-analytics-value { width: 40px; text-align: right; font-size: 13px; font-weight: 600; color: var(--steel); }

  /* Connected badge */
  .wa-connected-badge { display: flex; align-items: center; gap: 8px; padding: 10px 14px; background: #E8F5E9; border: 1px solid #A5D6A7; border-radius: 6px; font-size: 13px; color: #1B5E20; }
  .wa-connected-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--wa-green); box-shadow: 0 0 6px #25D36680; flex-shrink: 0; }

  /* Buttons */
  .wa-btn { display: inline-flex; align-items: center; gap: 6px; padding: 8px 14px; border-radius: 6px; font-family: 'DM Sans', sans-serif; font-size: 13px; font-weight: 500; cursor: pointer; border: none; transition: all 0.15s; white-space: nowrap; }
  .wa-btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .wa-btn-primary   { background: var(--wa-dark); color: white; }
  .wa-btn-primary:hover:not(:disabled) { background: var(--wa-green); }
  .wa-btn-secondary { background: var(--chalk); color: var(--steel); border: 1px solid var(--rule); }
  .wa-btn-secondary:hover:not(:disabled) { border-color: var(--mist); }
  .wa-btn-ghost     { background: none; color: var(--mist); border: 1px solid var(--rule); }
  .wa-btn-ghost:hover:not(:disabled) { color: var(--steel); border-color: var(--steel); }
  .wa-btn-success   { background: #DCFCE7; color: #166534; border: 1px solid #BBF7D0; }
  .wa-btn-sm        { padding: 5px 10px; font-size: 12px; }

  /* Pill */
  .wa-pill { display: inline-flex; align-items: center; padding: 3px 10px; border-radius: 20px; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; }
  .wa-pill-approved { background: #DCFCE7; color: #166534; }
  .wa-pill-pending  { background: #FEF9C3; color: #854D0E; }
  .wa-pill-rejected { background: #FEE2E2; color: #991B1B; }
  .wa-pill-active   { background: #DCFCE7; color: #166534; }
  .wa-pill-inactive { background: #F3F4F6; color: #6B7280; }

  /* Form */
  .wa-input { width: 100%; padding: 9px 12px; border: 1px solid var(--rule); border-radius: 6px; font-family: 'DM Sans', sans-serif; font-size: 14px; color: var(--steel); outline: none; transition: border-color 0.15s; background: white; }
  .wa-input:focus { border-color: var(--wa-green); }
  .wa-input-label { font-size: 13px; font-weight: 500; color: var(--steel); margin-bottom: 6px; display: block; }
  .wa-input-group { margin-bottom: 16px; }
  .wa-form-grid   { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }

  /* Toggle */
  .wa-toggle { position: relative; display: inline-block; width: 44px; height: 24px; flex-shrink: 0; }
  .wa-toggle input { opacity: 0; width: 0; height: 0; }
  .wa-toggle-slider { position: absolute; cursor: pointer; inset: 0; background: var(--rule); border-radius: 24px; transition: 0.2s; }
  .wa-toggle-slider:before { content: ''; position: absolute; width: 18px; height: 18px; left: 3px; bottom: 3px; background: white; border-radius: 50%; transition: 0.2s; }
  .wa-toggle input:checked + .wa-toggle-slider { background: var(--wa-green); }
  .wa-toggle input:checked + .wa-toggle-slider:before { transform: translateX(20px); }

  /* Modal */
  .wa-modal-overlay { position: fixed; inset: 0; background: rgba(28,28,46,0.5); display: flex; align-items: center; justify-content: center; z-index: 100; padding: 20px; }
  .wa-modal { background: var(--white); border-radius: var(--radius); padding: 24px; width: 100%; max-width: 520px; max-height: 90vh; overflow-y: auto; }
  .wa-modal-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px; }
  .wa-modal-title  { font-family: 'Plus Jakarta Sans', sans-serif; font-weight: 700; font-size: 16px; color: var(--steel); }

  /* Alert */
  .wa-alert { padding: 12px 16px; border-radius: var(--radius); font-size: 13px; margin-bottom: 16px; }
  .wa-alert-success { background: #DCFCE7; border: 1px solid #BBF7D0; color: #166534; }
  .wa-alert-warning { background: #FFFBEB; border: 1px solid #FDE68A; color: #92400E; }
  .wa-alert-info    { background: #EFF6FF; border: 1px solid #BFDBFE; color: #1E40AF; }

  /* Empty */
  .wa-empty { text-align: center; padding: 40px 24px; color: var(--mist); }
  .wa-empty h3 { font-size: 15px; color: var(--steel); margin-bottom: 4px; }

  /* Spinner */
  .wa-spinner { width: 16px; height: 16px; border: 2px solid rgba(255,255,255,0.3); border-top-color: white; border-radius: 50%; animation: wa-spin 0.6s linear infinite; display: inline-block; }
  @keyframes wa-spin { to { transform: rotate(360deg); } }
`;

// ── HELPERS ─────────────────────────────────────────────────────
const formatTime = (d) => d ? new Date(d).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : "";
const formatDate = (d) => d ? new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "";
const formatCurrency = (n) => `£${(n || 0).toFixed(2)}`;
const avatarColors = ["#075E54", "#128C7E", "#25D366", "#E8410A", "#3B82F6", "#8B5CF6", "#EC4899"];
const avatarColor = (name) => avatarColors[name.charCodeAt(0) % avatarColors.length];
const getInitials = (name) => name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2);

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
const now = new Date();
const minsAgo = (m) => new Date(now - m * 60000).toISOString();
const hrsAgo  = (h) => new Date(now - h * 3600000).toISOString();
const daysAgo = (d) => new Date(now - d * 86400000).toISOString();

const MOCK_CONVERSATIONS = [
  {
    id: "conv1", contact_name: "James Whitfield", contact_phone: "+447700900123",
    last_message: "That's great, thanks!", last_message_at: minsAgo(8),
    unread_count: 0, status: "open", linked_invoice_id: "inv1",
    messages: [
      { id: "m1", direction: "outbound", content: "Hi James, just to let you know your invoice INV-0046 for £3,800 has been sent. You can pay securely online at the link in your email.", status: "read", created_at: hrsAgo(2), sent_by: "Adrian Fielding" },
      { id: "m2", direction: "inbound", content: "Hi, got it thanks. Will sort it today.", created_at: hrsAgo(1) },
      { id: "m3", direction: "outbound", content: "Perfect, thanks James. Payment link is valid for 30 days. Let me know if you have any questions.", status: "read", created_at: minsAgo(45), sent_by: "Adrian Fielding" },
      { id: "m4", direction: "inbound", content: "That's great, thanks!", created_at: minsAgo(8) },
    ],
  },
  {
    id: "conv2", contact_name: "Helen Burgess", contact_phone: "+447700900456",
    last_message: "Still no hot water this morning 😤", last_message_at: minsAgo(3),
    unread_count: 2, status: "open", linked_job_id: "job1",
    messages: [
      { id: "m5", direction: "outbound", content: "Hi Helen, your boiler repair is booked for Thursday 10th June at 9am. Steve will be with you. Any questions give us a call.", status: "delivered", created_at: daysAgo(2), sent_by: "System" },
      { id: "m6", direction: "inbound", content: "Great thank you!", created_at: daysAgo(2) },
      { id: "m7", direction: "inbound", content: "Still no hot water this morning 😤", created_at: minsAgo(3) },
    ],
  },
  {
    id: "conv3", contact_name: "Robert Chen", contact_phone: "+447700900789",
    last_message: "Can we push to next week?", last_message_at: hrsAgo(3),
    unread_count: 1, status: "open",
    messages: [
      { id: "m8", direction: "outbound", content: "Morning Robert, quick reminder that the heating installation is booked to start Monday 8am. See you then.", status: "read", created_at: daysAgo(1), sent_by: "Adrian Fielding" },
      { id: "m9", direction: "inbound", content: "Can we push to next week?", created_at: hrsAgo(3) },
    ],
  },
  {
    id: "conv4", contact_name: "Sandra Williams", contact_phone: "+447700900321",
    last_message: "When can you do the survey?", last_message_at: hrsAgo(6),
    unread_count: 0, status: "open",
    messages: [
      { id: "m10", direction: "inbound", content: "Hi, I'd like a new boiler. When can you do the survey?", created_at: hrsAgo(6) },
      { id: "m11", direction: "outbound", content: "Hi Sandra! We can do a free survey this week. How does Thursday or Friday afternoon work?", status: "read", created_at: hrsAgo(5), sent_by: "Adrian Fielding" },
    ],
  },
];

const MOCK_TEMPLATES = [
  { id: "t1", name: "booking_confirmation", category: "utility", body: "Hi {{1}}, your {{2}} is confirmed for {{3}} at {{4}}. We look forward to seeing you. Reply STOP to unsubscribe.", variables: ["customer_name", "service_name", "date", "time"], status: "approved" },
  { id: "t2", name: "invoice_notification", category: "utility", body: "Hi {{1}}, invoice {{2}} for {{3}} is ready. Pay securely: {{4}}. Due date: {{5}}. Reply STOP to unsubscribe.", variables: ["customer_name", "invoice_number", "amount", "payment_link", "due_date"], status: "approved" },
  { id: "t3", name: "job_complete", category: "utility", body: "Hi {{1}}, the {{2}} at {{3}} is now complete. If you're happy with the work, we'd really appreciate a quick Google review: {{4}}", variables: ["customer_name", "job_type", "address", "review_link"], status: "approved" },
  { id: "t4", name: "payment_reminder", category: "utility", body: "Hi {{1}}, just a reminder that invoice {{2}} for {{3}} was due on {{4}}. Pay now: {{5}}. Thanks!", variables: ["customer_name", "invoice_number", "amount", "due_date", "payment_link"], status: "approved" },
  { id: "t5", name: "appointment_reminder_24h", category: "utility", body: "Reminder: your {{1}} with {{2}} is tomorrow at {{3}}. Address: {{4}}. Reply to reschedule.", variables: ["service_name", "business_name", "time", "address"], status: "approved" },
];

const MOCK_AUTOMATIONS = [
  { id: "a1", name: "Booking confirmed notification", trigger_event: "booking_confirmed", template_name: "booking_confirmation", delay_minutes: 0, active: true, run_count: 47, last_run_at: hrsAgo(2) },
  { id: "a2", name: "Invoice notification", trigger_event: "invoice_sent", template_name: "invoice_notification", delay_minutes: 0, active: true, run_count: 23, last_run_at: hrsAgo(4) },
  { id: "a3", name: "24h appointment reminder", trigger_event: "booking_reminder", template_name: "appointment_reminder_24h", delay_minutes: 0, active: true, run_count: 31, last_run_at: daysAgo(1) },
  { id: "a4", name: "Job complete + review request", trigger_event: "job_complete", template_name: "job_complete", delay_minutes: 60, active: true, run_count: 18, last_run_at: daysAgo(2) },
  { id: "a5", name: "Payment reminder", trigger_event: "invoice_overdue", template_name: "payment_reminder", delay_minutes: 0, active: false, run_count: 8, last_run_at: daysAgo(5) },
];

// ── Live-schema <-> UI adapters ──────────────────────────────────
// Only conversations/messages have tables. Templates and automations have no
// backing table in the live schema, so they remain built-in UI defaults
// (seeded from the constants below) until such tables exist.
const contactName = (c) =>
  c ? ([c.first_name, c.last_name].filter(Boolean).join(" ") || c.business_name || "") : "";
function mapConversation(row) {
  const msgs = (row.messages || []).slice().sort((a, b) => new Date(a.sent_at) - new Date(b.sent_at));
  const last = msgs[msgs.length - 1];
  return {
    id: row.id,
    contact_id: row.contact_id,
    contact_name: contactName(row.contact) || row.customer_phone,
    contact_phone: row.customer_phone,
    last_message: last?.content || "",
    last_message_at: row.last_message_at || last?.sent_at,
    unread_count: msgs.filter((m) => m.direction === "inbound" && !m.read_at).length,
    status: row.status,
    messages: msgs.map((m) => ({
      id: m.id, direction: m.direction, content: m.content,
      message_type: m.message_type, template_name: m.template_name,
      status: m.read_at ? "read" : m.delivered_at ? "delivered" : "sent",
      created_at: m.sent_at, sent_by: "",
    })),
  };
}

// ── MAIN COMPONENT ──────────────────────────────────────────────
export default function WhatsAppBusiness({
  supabase, accountId, userId, userName, userRole,
  accountName = "Your Business", brandColor = "#E8410A",
}) {
  const [activeTab, setActiveTab] = useState("inbox");
  const [conversations, setConversations] = useState([]);
  const [templates, setTemplates] = useState(MOCK_TEMPLATES);
  const [automations, setAutomations] = useState(MOCK_AUTOMATIONS);
  const [loading, setLoading] = useState(true);
  const [selectedConvId, setSelectedConvId] = useState(null);
  const [messageInput, setMessageInput] = useState("");
  const [convSearch, setConvSearch] = useState("");
  const [showSendTemplate, setShowSendTemplate] = useState(false);
  const [showNewAutomation, setShowNewAutomation] = useState(false);
  const [showNewTemplate, setShowNewTemplate] = useState(false);
  const [waSettings, setWaSettings] = useState({
    connected: true,
    display_phone_number: "+44 7700 900 000",
    business_name: accountName,
    monthly_conversations: 127,
    monthly_spend_pence: 640,
  });
  const [alert, setAlert] = useState(null);
  const messagesEndRef = useRef(null);

  const showAlertMsg = (type, msg) => {
    setAlert({ type, message: msg });
    setTimeout(() => setAlert(null), 4000);
  };

  // ── Load real conversations + messages (RLS scopes to this account) ──
  const loadData = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("whatsapp_conversations")
      .select("*, contact:contacts(first_name,last_name,business_name), messages:whatsapp_messages(*)")
      .order("last_message_at", { ascending: false });
    if (error) showAlertMsg("error", `Could not load conversations: ${error.message}`);
    else {
      const mapped = (data || []).map(mapConversation);
      setConversations(mapped);
      setSelectedConvId((cur) => (mapped.some((c) => c.id === cur) ? cur : mapped[0]?.id || null));
    }
    setLoading(false);
  }, [supabase]);

  useEffect(() => { loadData(); }, [loadData]);

  const selectedConv = conversations.find((c) => c.id === selectedConvId);
  const totalUnread = conversations.reduce((s, c) => s + c.unread_count, 0);

  // Auto-scroll to bottom of messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [selectedConvId, conversations]);

  // Mark as read when conversation opened
  useEffect(() => {
    if (selectedConvId) {
      setConversations((prev) => prev.map((c) => c.id === selectedConvId ? { ...c, unread_count: 0 } : c));
    }
  }, [selectedConvId]);

  // Send message
  const handleSend = async () => {
    if (!messageInput.trim() || !selectedConvId) return;
    const content = messageInput.trim();
    // Record the outbound message. (Actual WhatsApp delivery is via the
    // 360dialog/Meta edge function — out of scope here.)
    const { data: inserted, error } = await supabase.from("whatsapp_messages").insert({
      account_id: accountId, conversation_id: selectedConvId,
      direction: "outbound", message_type: "text", content, sent_by: userId,
    }).select("*").single();
    if (error) { showAlertMsg("error", `Could not send: ${error.message}`); return; }
    await supabase.from("whatsapp_conversations").update({ last_message_at: inserted.sent_at }).eq("id", selectedConvId);
    const newMsg = {
      id: inserted.id, direction: "outbound", content, status: "sent",
      created_at: inserted.sent_at, sent_by: userName,
    };
    setConversations((prev) => prev.map((c) =>
      c.id === selectedConvId
        ? { ...c, messages: [...c.messages, newMsg], last_message: newMsg.content, last_message_at: newMsg.created_at }
        : c
    ));
    setMessageInput("");

    await logAction(supabase, {
      accountId, userId, userName, userRole,
      action: "sent_whatsapp", entityType: "wa_message", entityId: newMsg.id,
      entityName: `WhatsApp to ${selectedConv?.contact_name}: ${newMsg.content.slice(0, 50)}`,
    });
  };

  // Toggle automation
  const handleToggleAutomation = async (autoId) => {
    setAutomations((prev) => prev.map((a) => a.id === autoId ? { ...a, active: !a.active } : a));
    const auto = automations.find((a) => a.id === autoId);
    showAlertMsg("success", `${auto.name} ${auto.active ? "paused" : "activated"}.`);
  };

  // Filtered conversations
  const filteredConvs = conversations.filter((c) =>
    !convSearch || c.contact_name.toLowerCase().includes(convSearch.toLowerCase())
  ).sort((a, b) => new Date(b.last_message_at) - new Date(a.last_message_at));

  // ── RENDER ───────────────────────────────────────────────────
  return (
    <>
      <style>{css}</style>
      <div className="wa-wrap">

        <div className="wa-header">
          <div>
            <h1>WhatsApp Business</h1>
            <p>Inbox · Automations · Templates · Analytics</p>
          </div>
          {waSettings.connected && (
            <div className="wa-connected-badge">
              <div className="wa-connected-dot" />
              {waSettings.display_phone_number} connected
            </div>
          )}
        </div>

        {alert && <div className={`wa-alert wa-alert-${alert.type}`}>{alert.message}</div>}

        {/* Stats */}
        <div className="wa-card-grid">
          <div className="wa-stat-card">
            <div className="wa-stat-label">Unread</div>
            <div className="wa-stat-value" style={{ color: totalUnread > 0 ? "#075E54" : "#22C55E" }}>{totalUnread}</div>
            <div className="wa-stat-sub">Messages waiting</div>
          </div>
          <div className="wa-stat-card">
            <div className="wa-stat-label">Conversations</div>
            <div className="wa-stat-value">{waSettings.monthly_conversations}</div>
            <div className="wa-stat-sub">This month</div>
          </div>
          <div className="wa-stat-card">
            <div className="wa-stat-label">Message Cost</div>
            <div className="wa-stat-value" style={{ fontSize: 20 }}>{formatCurrency(waSettings.monthly_spend_pence / 100)}</div>
            <div className="wa-stat-sub">This month (pass-through)</div>
          </div>
          <div className="wa-stat-card">
            <div className="wa-stat-label">Automations Active</div>
            <div className="wa-stat-value">{automations.filter((a) => a.active).length}</div>
            <div className="wa-stat-sub">Running</div>
          </div>
        </div>

        {/* Tabs */}
        <div className="wa-tabs">
          {TABS.map((tab) => (
            <button key={tab.id} className={`wa-tab ${activeTab === tab.id ? "active" : ""}`} onClick={() => setActiveTab(tab.id)}>
              {tab.label}
              {tab.id === "inbox" && totalUnread > 0 && <span className="badge">{totalUnread}</span>}
            </button>
          ))}
        </div>

        {/* ── INBOX ─────────────────────────────────────────── */}
        {activeTab === "inbox" && (
          <div>
            <div className="wa-chat-layout">
              {/* Conversation list */}
              <div className="wa-conv-list">
                <div className="wa-conv-header">
                  <span className="wa-conv-header-title">Messages</span>
                  <button
                    className="wa-btn wa-btn-sm"
                    style={{ background: "rgba(255,255,255,0.15)", color: "white", border: "none", fontSize: 12 }}
                    onClick={() => setShowSendTemplate(true)}
                  >
                    New
                  </button>
                </div>
                <div className="wa-conv-search">
                  <input placeholder="Search..." value={convSearch} onChange={(e) => setConvSearch(e.target.value)} />
                </div>
                {filteredConvs.map((conv) => (
                  <div
                    key={conv.id}
                    className={`wa-conv-item ${selectedConvId === conv.id ? "active" : ""}`}
                    onClick={() => setSelectedConvId(conv.id)}
                  >
                    <div className="wa-conv-avatar" style={{ background: avatarColor(conv.contact_name) }}>
                      {getInitials(conv.contact_name)}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                        <div className="wa-conv-name">{conv.contact_name}</div>
                        <div className="wa-conv-time">{formatTime(conv.last_message_at)}</div>
                      </div>
                      <div className="wa-conv-preview">{conv.last_message}</div>
                    </div>
                    {conv.unread_count > 0 && (
                      <div className="wa-conv-unread">{conv.unread_count}</div>
                    )}
                  </div>
                ))}
              </div>

              {/* Chat window */}
              {selectedConv ? (
                <div className="wa-chat-window">
                  <div className="wa-chat-header">
                    <div className="wa-conv-avatar" style={{ width: 36, height: 36, fontSize: 13, background: avatarColor(selectedConv.contact_name) }}>
                      {getInitials(selectedConv.contact_name)}
                    </div>
                    <div>
                      <div className="wa-chat-contact-name">{selectedConv.contact_name}</div>
                      <div className="wa-chat-contact-sub">{selectedConv.contact_phone}</div>
                    </div>
                    <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
                      <button
                        className="wa-btn wa-btn-sm"
                        style={{ background: "rgba(255,255,255,0.15)", color: "white", border: "none", fontSize: 12 }}
                        onClick={() => setShowSendTemplate(true)}
                      >
                        Template
                      </button>
                    </div>
                  </div>

                  <div className="wa-chat-messages">
                    {selectedConv.messages.map((msg) => (
                      <div key={msg.id} className={`wa-message ${msg.direction === "outbound" ? "wa-message-out" : "wa-message-in"}`}>
                        {msg.content}
                        <div className="wa-message-time">
                          {formatTime(msg.created_at)}
                          {msg.direction === "outbound" && (
                            <span className="wa-message-status"> {msg.status === "read" ? "✓✓" : msg.status === "delivered" ? "✓✓" : "✓"}</span>
                          )}
                        </div>
                      </div>
                    ))}
                    <div ref={messagesEndRef} />
                  </div>

                  <div className="wa-chat-input">
                    <input
                      placeholder="Type a message..."
                      value={messageInput}
                      onChange={(e) => setMessageInput(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleSend()}
                    />
                    <button className="wa-send-btn" disabled={!messageInput.trim()} onClick={handleSend}>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
                        <path d="m22 2-7 20-4-9-9-4 20-7z"/>
                        <path d="M22 2 11 13"/>
                      </svg>
                    </button>
                  </div>
                </div>
              ) : (
                <div className="wa-empty-chat">
                  <div style={{ fontSize: 32 }}>💬</div>
                  <div style={{ fontSize: 14 }}>Select a conversation</div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── CONTACTS ──────────────────────────────────────── */}
        {activeTab === "contacts" && (
          <div className="wa-card">
            <div className="wa-section-heading">WhatsApp Contacts</div>
            {conversations.map((conv) => (
              <div key={conv.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 0", borderBottom: "1px solid var(--rule)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div className="wa-conv-avatar" style={{ width: 36, height: 36, fontSize: 13, background: avatarColor(conv.contact_name) }}>
                    {getInitials(conv.contact_name)}
                  </div>
                  <div>
                    <div style={{ fontWeight: 600, color: "var(--steel)", fontSize: 14 }}>{conv.contact_name}</div>
                    <div style={{ fontSize: 12, color: "var(--mist)" }}>{conv.contact_phone}</div>
                  </div>
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  <button className="wa-btn wa-btn-ghost wa-btn-sm" onClick={() => { setSelectedConvId(conv.id); setActiveTab("inbox"); }}>Open Chat</button>
                  <button className="wa-btn wa-btn-secondary wa-btn-sm" onClick={() => setShowSendTemplate(true)}>Send Template</button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── AUTOMATIONS ───────────────────────────────────── */}
        {activeTab === "automations" && (
          <div>
            <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 16 }}>
              <button className="wa-btn wa-btn-primary" onClick={() => setShowNewAutomation(true)}>+ New Automation</button>
            </div>
            <div className="wa-alert wa-alert-info">
              Automations send approved WhatsApp templates automatically when events occur in the platform. No manual action required.
            </div>
            <div className="wa-card">
              {automations.map((auto) => (
                <div key={auto.id} className="wa-auto-row">
                  <div style={{ flex: 1 }}>
                    <div className="wa-auto-name">{auto.name}</div>
                    <div className="wa-auto-meta">
                      Trigger: {AUTOMATION_TRIGGERS.find((t) => t.value === auto.trigger_event)?.label || auto.trigger_event}
                      {auto.delay_minutes > 0 && ` — ${auto.delay_minutes} min delay`}
                      {" · "}Template: {auto.template_name}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--mist)", marginTop: 2 }}>
                      Sent {auto.run_count} times · Last run: {auto.last_run_at ? formatDate(auto.last_run_at) : "Never"}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <span className={`wa-pill wa-pill-${auto.active ? "active" : "inactive"}`}>{auto.active ? "Active" : "Paused"}</span>
                    <label className="wa-toggle">
                      <input type="checkbox" checked={auto.active} onChange={() => handleToggleAutomation(auto.id)} />
                      <span className="wa-toggle-slider" />
                    </label>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── TEMPLATES ─────────────────────────────────────── */}
        {activeTab === "templates" && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
              <div className="wa-alert wa-alert-warning" style={{ marginBottom: 0, flex: 1, marginRight: 12 }}>
                Templates must be approved by Meta before they can be sent. Approval takes 24–72 hours. Only approved templates can be used in automations or to initiate conversations.
              </div>
              <button className="wa-btn wa-btn-primary" style={{ flexShrink: 0 }} onClick={() => setShowNewTemplate(true)}>+ New Template</button>
            </div>
            <div className="wa-card">
              {templates.map((tpl) => (
                <div key={tpl.id} className="wa-tmpl-row">
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                    <div>
                      <div className="wa-tmpl-name">{tpl.name}</div>
                      <div style={{ fontSize: 12, color: "var(--mist)" }}>{tpl.category} · en_GB</div>
                    </div>
                    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      <span className={`wa-pill wa-pill-${tpl.status}`}>{tpl.status}</span>
                    </div>
                  </div>
                  <div className="wa-tmpl-body">{tpl.body}</div>
                  {tpl.variables && tpl.variables.length > 0 && (
                    <div style={{ marginTop: 6, fontSize: 12, color: "var(--mist)" }}>
                      Variables: {tpl.variables.map((v, i) => `{{${i + 1}}} = ${v}`).join(" · ")}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── ANALYTICS ─────────────────────────────────────── */}
        {activeTab === "analytics" && (
          <div>
            <div className="wa-card">
              <div className="wa-section-heading">This Month</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 20 }}>
                {[
                  ["Total conversations", waSettings.monthly_conversations, "#075E54"],
                  ["Messages sent", 312, "#25D366"],
                  ["Messages received", 189, "#128C7E"],
                  ["Automations fired", 119, "#E8410A"],
                  ["Templates sent", 87, "#3B82F6"],
                  ["Cost (pass-through)", `£${(waSettings.monthly_spend_pence / 100).toFixed(2)}`, "#EAB308"],
                ].map(([label, value, color]) => (
                  <div key={label} style={{ padding: "14px 16px", background: "var(--chalk)", borderRadius: 8 }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: "var(--mist)", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 4 }}>{label}</div>
                    <div style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontWeight: 800, fontSize: 24, color }}>{value}</div>
                  </div>
                ))}
              </div>

              <div className="wa-section-heading">Message Delivery Rates</div>
              {[
                ["Delivered", 98],
                ["Read", 73],
                ["Replied", 44],
                ["Automation open", 61],
              ].map(([label, pct]) => (
                <div key={label} className="wa-analytics-row">
                  <div className="wa-analytics-label">{label}</div>
                  <div className="wa-analytics-bar-wrap">
                    <div className="wa-analytics-bar-fill" style={{ width: `${pct}%`, background: "#25D366" }} />
                  </div>
                  <div className="wa-analytics-value">{pct}%</div>
                </div>
              ))}
            </div>

            <div className="wa-card">
              <div className="wa-section-heading">Top Performing Automations</div>
              {automations.sort((a, b) => b.run_count - a.run_count).slice(0, 3).map((auto) => (
                <div key={auto.id} style={{ display: "flex", justifyContent: "space-between", padding: "10px 0", borderBottom: "1px solid var(--rule)", fontSize: 13 }}>
                  <span style={{ fontWeight: 500, color: "var(--steel)" }}>{auto.name}</span>
                  <span style={{ fontWeight: 700, color: "#075E54" }}>{auto.run_count} sent</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── SETTINGS ──────────────────────────────────────── */}
        {activeTab === "settings" && (
          <div>
            <div className="wa-card">
              <div className="wa-section-heading">WhatsApp Business Connection</div>
              {waSettings.connected ? (
                <div>
                  <div className="wa-connected-badge" style={{ marginBottom: 16 }}>
                    <div className="wa-connected-dot" />
                    Connected — {waSettings.display_phone_number}
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16, fontSize: 13 }}>
                    <div><span style={{ color: "var(--mist)" }}>Business name: </span><strong>{waSettings.business_name}</strong></div>
                    <div><span style={{ color: "var(--mist)" }}>Phone number: </span><strong>{waSettings.display_phone_number}</strong></div>
                    <div><span style={{ color: "var(--mist)" }}>Conversations this month: </span><strong>{waSettings.monthly_conversations}</strong></div>
                    <div><span style={{ color: "var(--mist)" }}>Spend this month: </span><strong>{formatCurrency(waSettings.monthly_spend_pence / 100)}</strong></div>
                  </div>
                  <button className="wa-btn wa-btn-ghost wa-btn-sm" onClick={() => showAlertMsg("info", "To disconnect, contact support. This cannot be done automatically.")}>Disconnect</button>
                </div>
              ) : (
                <div>
                  <div className="wa-alert wa-alert-info">
                    Connect your WhatsApp Business account to start sending and receiving messages from the platform. You'll need a Meta Business Manager account and a dedicated phone number.
                  </div>
                  <button className="wa-btn wa-btn-primary">Connect WhatsApp Business</button>
                </div>
              )}
            </div>

            <div className="wa-card">
              <div className="wa-section-heading">Billing & Usage</div>
              <p style={{ fontSize: 13, color: "var(--mist)", lineHeight: 1.6, marginBottom: 12 }}>
                WhatsApp message costs are passed through at Meta's rate plus 20%. The first 1,000 conversations per month are free (Meta's free tier). After that, costs are typically £0.05–£0.08 per conversation depending on conversation type and destination.
              </p>
              <div style={{ padding: "12px 16px", background: "var(--chalk)", borderRadius: 6, fontSize: 13 }}>
                <div style={{ fontWeight: 600, color: "var(--steel)", marginBottom: 4 }}>This billing period</div>
                <div>Conversations: {waSettings.monthly_conversations}</div>
                <div>Est. charge: {formatCurrency(waSettings.monthly_spend_pence / 100)}</div>
                <div style={{ fontSize: 11, color: "var(--mist)", marginTop: 4 }}>Added to your next invoice automatically.</div>
              </div>
            </div>
          </div>
        )}

        {/* ── SEND TEMPLATE MODAL ───────────────────────────── */}
        {showSendTemplate && (
          <SendTemplateModal
            templates={templates.filter((t) => t.status === "approved")}
            conversations={conversations}
            selectedConvId={selectedConvId}
            onSend={async (convId, template, message) => {
              const { data: inserted, error } = await supabase.from("whatsapp_messages").insert({
                account_id: accountId, conversation_id: convId,
                direction: "outbound", message_type: "template", template_name: template.name,
                content: message, sent_by: userId,
              }).select("*").single();
              if (error) { showAlertMsg("error", `Could not send template: ${error.message}`); return; }
              await supabase.from("whatsapp_conversations").update({ last_message_at: inserted.sent_at }).eq("id", convId);
              const newMsg = {
                id: inserted.id, direction: "outbound", content: message,
                message_type: "template", template_name: template.name, status: "sent",
                created_at: inserted.sent_at, sent_by: userName,
              };
              setConversations((prev) => prev.map((c) =>
                c.id === convId
                  ? { ...c, messages: [...c.messages, newMsg], last_message: message, last_message_at: newMsg.created_at }
                  : c
              ));
              setSelectedConvId(convId);
              setShowSendTemplate(false);
              await logAction(supabase, { accountId, userId, userName, userRole, action: "sent_whatsapp", entityType: "wa_message", entityId: inserted.id, entityName: `Template ${template.name}` });
              showAlertMsg("success", "Template message sent.");
            }}
            onClose={() => setShowSendTemplate(false)}
          />
        )}

        {/* ── NEW AUTOMATION MODAL ──────────────────────────── */}
        {showNewAutomation && (
          <NewAutomationModal
            templates={templates.filter((t) => t.status === "approved")}
            onSubmit={(data) => {
              setAutomations((prev) => [{ id: `a${Date.now()}`, ...data, run_count: 0, last_run_at: null }, ...prev]);
              setShowNewAutomation(false);
              showAlertMsg("success", "Automation created.");
            }}
            onClose={() => setShowNewAutomation(false)}
          />
        )}

        {/* ── NEW TEMPLATE MODAL ────────────────────────────── */}
        {showNewTemplate && (
          <NewTemplateModal
            onSubmit={(data) => {
              setTemplates((prev) => [{ id: `t${Date.now()}`, ...data, status: "pending" }, ...prev]);
              setShowNewTemplate(false);
              showAlertMsg("info", "Template submitted to Meta for approval. Typically approved within 24–72 hours.");
            }}
            onClose={() => setShowNewTemplate(false)}
          />
        )}
      </div>
    </>
  );
}

// ── SEND TEMPLATE MODAL ─────────────────────────────────────────
function SendTemplateModal({ templates, conversations, selectedConvId, onSend, onClose }) {
  const [selectedTemplate, setSelectedTemplate] = useState(templates[0]?.id || "");
  const [targetConvId, setTargetConvId] = useState(selectedConvId || conversations[0]?.id || "");
  const [variables, setVariables] = useState({});

  const tpl = templates.find((t) => t.id === selectedTemplate);
  const preview = tpl ? tpl.body.replace(/\{\{(\d+)\}\}/g, (_, i) => variables[i] || `[${tpl.variables?.[i - 1] || "variable"}]`) : "";

  return (
    <div className="wa-modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="wa-modal">
        <div className="wa-modal-header">
          <span className="wa-modal-title">Send Template Message</span>
          <button className="wa-btn wa-btn-ghost wa-btn-sm" onClick={onClose}>Close</button>
        </div>
        <div className="wa-input-group">
          <label className="wa-input-label">Contact</label>
          <select className="wa-input" value={targetConvId} onChange={(e) => setTargetConvId(e.target.value)}>
            {conversations.map((c) => <option key={c.id} value={c.id}>{c.contact_name} — {c.contact_phone}</option>)}
          </select>
        </div>
        <div className="wa-input-group">
          <label className="wa-input-label">Template</label>
          <select className="wa-input" value={selectedTemplate} onChange={(e) => { setSelectedTemplate(e.target.value); setVariables({}); }}>
            {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
        {tpl?.variables && tpl.variables.length > 0 && (
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: "var(--mist)", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 8 }}>Fill in variables</div>
            {tpl.variables.map((varName, i) => (
              <div key={i} className="wa-input-group">
                <label className="wa-input-label">{"{{"}{i + 1}{"}}"} — {varName}</label>
                <input className="wa-input" placeholder={varName} value={variables[i + 1] || ""} onChange={(e) => setVariables((p) => ({ ...p, [i + 1]: e.target.value }))} />
              </div>
            ))}
          </div>
        )}
        {tpl && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: "var(--mist)", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 6 }}>Preview</div>
            <div style={{ padding: "10px 14px", background: "#DCF8C6", borderRadius: 8, fontSize: 13, color: "#111", lineHeight: 1.6 }}>{preview}</div>
          </div>
        )}
        <button
          className="wa-btn wa-btn-primary"
          style={{ width: "100%", justifyContent: "center" }}
          disabled={!selectedTemplate || !targetConvId}
          onClick={() => onSend(targetConvId, tpl, preview)}
        >
          Send
        </button>
      </div>
    </div>
  );
}

// ── NEW AUTOMATION MODAL ────────────────────────────────────────
function NewAutomationModal({ templates, onSubmit, onClose }) {
  const [form, setForm] = useState({ name: "", trigger_event: "booking_confirmed", template_id: templates[0]?.id || "", template_name: templates[0]?.name || "", delay_minutes: 0, active: true });
  return (
    <div className="wa-modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="wa-modal">
        <div className="wa-modal-header">
          <span className="wa-modal-title">New Automation</span>
          <button className="wa-btn wa-btn-ghost wa-btn-sm" onClick={onClose}>Close</button>
        </div>
        <div className="wa-input-group">
          <label className="wa-input-label">Automation name</label>
          <input className="wa-input" placeholder="e.g. Booking confirmation" value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} />
        </div>
        <div className="wa-input-group">
          <label className="wa-input-label">Trigger event</label>
          <select className="wa-input" value={form.trigger_event} onChange={(e) => setForm((p) => ({ ...p, trigger_event: e.target.value }))}>
            {AUTOMATION_TRIGGERS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </div>
        <div className="wa-input-group">
          <label className="wa-input-label">Template to send</label>
          <select className="wa-input" value={form.template_id} onChange={(e) => { const t = templates.find((t) => t.id === e.target.value); setForm((p) => ({ ...p, template_id: e.target.value, template_name: t?.name || "" })); }}>
            {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
        <div className="wa-input-group">
          <label className="wa-input-label">Delay (minutes after trigger)</label>
          <input type="number" className="wa-input" min="0" value={form.delay_minutes} onChange={(e) => setForm((p) => ({ ...p, delay_minutes: parseInt(e.target.value) }))} />
        </div>
        <button className="wa-btn wa-btn-primary" style={{ width: "100%" }} disabled={!form.name || !form.template_id} onClick={() => onSubmit(form)}>
          Create Automation
        </button>
      </div>
    </div>
  );
}

// ── NEW TEMPLATE MODAL ──────────────────────────────────────────
function NewTemplateModal({ onSubmit, onClose }) {
  const [form, setForm] = useState({ name: "", category: "utility", body: "", language: "en_GB" });
  const varCount = (form.body.match(/\{\{\d+\}\}/g) || []).length;

  return (
    <div className="wa-modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="wa-modal">
        <div className="wa-modal-header">
          <span className="wa-modal-title">New Template</span>
          <button className="wa-btn wa-btn-ghost wa-btn-sm" onClick={onClose}>Close</button>
        </div>
        <div className="wa-alert wa-alert-info">
          Templates are reviewed by Meta. Use {"{{"+"1}}"} for variables. Category must be utility (transactional) or marketing. Utility templates have higher approval rates.
        </div>
        <div className="wa-form-grid">
          <div className="wa-input-group">
            <label className="wa-input-label">Template name (lowercase, underscores)</label>
            <input className="wa-input" placeholder="booking_confirmation" value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value.toLowerCase().replace(/\s/g, "_") }))} />
          </div>
          <div className="wa-input-group">
            <label className="wa-input-label">Category</label>
            <select className="wa-input" value={form.category} onChange={(e) => setForm((p) => ({ ...p, category: e.target.value }))}>
              <option value="utility">Utility — transactional messages</option>
              <option value="marketing">Marketing — promotional content</option>
            </select>
          </div>
        </div>
        <div className="wa-input-group">
          <label className="wa-input-label">Template body</label>
          <textarea
            className="wa-input"
            style={{ minHeight: 120, resize: "vertical", fontFamily: "monospace", fontSize: 13 }}
            placeholder={"Hi {{1}}, your booking is confirmed for {{2}} at {{3}}."}
            value={form.body}
            onChange={(e) => setForm((p) => ({ ...p, body: e.target.value }))}
          />
          <div style={{ fontSize: 12, color: "var(--mist)", marginTop: 4 }}>{varCount} variable{varCount !== 1 ? "s" : ""} detected</div>
        </div>
        <button className="wa-btn wa-btn-primary" style={{ width: "100%" }} disabled={!form.name || !form.body} onClick={() => onSubmit(form)}>
          Submit to Meta for Approval
        </button>
      </div>
    </div>
  );
}
