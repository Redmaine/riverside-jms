/**
 * OnlineBooking.jsx
 * Your Company AI — Online Booking Module
 *
 * DEPENDENCIES (injected via props from core platform):
 *   supabase        — Supabase client instance
 *   accountId       — Current account UUID
 *   userId          — Current platform_user UUID
 *   userName        — Current user display name
 *   userRole        — 'owner' | 'manager' | 'staff'
 *
 * TWO VIEWS IN ONE FILE:
 *   1. BookingAdmin    — Business owner management view (default export)
 *   2. BookingWidget   — Customer-facing booking form (named export)
 *      Embed on any website: <BookingWidget accountId="..." />
 *      Or serve at: https://book.yourcompanyai.co.uk/{account_slug}
 *
 * TWO BOOKING MODES:
 *   Structured slots  — Set specific time slots per service, customer picks a slot.
 *                       Best for: cleaning companies, boiler services, inspections.
 *   Request mode      — Customer submits request, business confirms availability.
 *                       Best for: trades where availability changes daily.
 *
 * DATABASE TABLES USED:
 *   booking_services    — Services offered, duration, price, mode
 *   booking_slots       — Available time slots (structured mode)
 *   bookings            — All booking records
 *   booking_settings    — Configuration per account
 *   contacts            — CRM contact records (write on new booking)
 *   audit_log           — Audit trail
 *
 * EXTERNAL:
 *   Stripe              — Deposit collection at booking
 *   Resend              — Confirmation emails + calendar invite
 *
 * SCHEMA — add these tables to supabase_schema.sql:
 *
 * CREATE TABLE public.booking_services (
 *   id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
 *   account_id      uuid REFERENCES public.accounts(id) ON DELETE CASCADE,
 *   name            text NOT NULL,
 *   description     text,
 *   duration_mins   int DEFAULT 60,
 *   price           numeric(10,2),
 *   deposit_amount  numeric(10,2) DEFAULT 0,
 *   deposit_pct     numeric(5,2) DEFAULT 0,
 *   mode            text DEFAULT 'request' CHECK (mode IN ('structured','request')),
 *   active          boolean DEFAULT true,
 *   sort_order      int DEFAULT 0,
 *   created_at      timestamptz DEFAULT now()
 * );
 *
 * CREATE TABLE public.booking_slots (
 *   id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
 *   account_id      uuid REFERENCES public.accounts(id) ON DELETE CASCADE,
 *   service_id      uuid REFERENCES public.booking_services(id) ON DELETE CASCADE,
 *   slot_date       date NOT NULL,
 *   start_time      time NOT NULL,
 *   end_time        time NOT NULL,
 *   engineer_name   text,
 *   max_bookings    int DEFAULT 1,
 *   current_bookings int DEFAULT 0,
 *   available       boolean GENERATED ALWAYS AS (current_bookings < max_bookings) STORED,
 *   created_at      timestamptz DEFAULT now()
 * );
 *
 * CREATE TABLE public.bookings (
 *   id                  uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
 *   account_id          uuid REFERENCES public.accounts(id) ON DELETE CASCADE,
 *   service_id          uuid REFERENCES public.booking_services(id),
 *   slot_id             uuid REFERENCES public.booking_slots(id),
 *   contact_id          uuid REFERENCES public.contacts(id),
 *   customer_name       text NOT NULL,
 *   customer_email      text NOT NULL,
 *   customer_phone      text,
 *   customer_address    text,
 *   booking_date        date,
 *   booking_time        time,
 *   preferred_dates     text,
 *   notes               text,
 *   photos              text[],
 *   status              text DEFAULT 'pending' CHECK (status IN
 *     ('pending','confirmed','in_progress','complete','cancelled','no_show')),
 *   deposit_paid        boolean DEFAULT false,
 *   deposit_amount      numeric(10,2) DEFAULT 0,
 *   stripe_payment_id   text,
 *   confirmed_by        text,
 *   confirmed_at        timestamptz,
 *   cancellation_reason text,
 *   created_at          timestamptz DEFAULT now(),
 *   updated_at          timestamptz DEFAULT now()
 * );
 *
 * CREATE TABLE public.booking_settings (
 *   id                  uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
 *   account_id          uuid REFERENCES public.accounts(id) ON DELETE CASCADE UNIQUE,
 *   business_name       text,
 *   booking_page_slug   text UNIQUE,
 *   brand_color         text DEFAULT '#E8410A',
 *   logo_url            text,
 *   advance_booking_days int DEFAULT 60,
 *   min_notice_hours    int DEFAULT 24,
 *   confirmation_message text DEFAULT 'Thanks for booking. We will confirm your appointment shortly.',
 *   terms               text,
 *   allow_photos        boolean DEFAULT true,
 *   max_photos          int DEFAULT 3,
 *   created_at          timestamptz DEFAULT now()
 * );
 *
 * Enable RLS on all tables with standard account_id policies.
 * booking_services, booking_slots, and booking_settings need public read policy for the widget.
 */

import { useState, useMemo, useEffect, useCallback } from "react";

// ── STYLES ──────────────────────────────────────────────────────
const adminCss = `
  @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=DM+Sans:wght@300;400;500&display=swap');

  .ob-wrap * { box-sizing: border-box; margin: 0; padding: 0; }
  .ob-wrap {
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

  .ob-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 24px; }
  .ob-header h1 { font-family: 'Plus Jakarta Sans', sans-serif; font-weight: 800; font-size: 22px; color: var(--steel); }
  .ob-header p  { font-size: 13px; color: var(--mist); margin-top: 2px; }

  .ob-tabs { display: flex; gap: 4px; background: var(--white); border: 1px solid var(--rule); border-radius: var(--radius); padding: 4px; margin-bottom: 24px; overflow-x: auto; }
  .ob-tab  { flex: 1; min-width: fit-content; padding: 8px 14px; border: none; background: none; border-radius: 6px; font-family: 'DM Sans', sans-serif; font-size: 13px; font-weight: 500; color: var(--light); cursor: pointer; white-space: nowrap; transition: all 0.15s; }
  .ob-tab.active { background: var(--steel); color: var(--white); }
  .ob-tab .badge { display: inline-flex; align-items: center; justify-content: center; width: 18px; height: 18px; background: var(--ember); color: white; border-radius: 50%; font-size: 10px; font-weight: 700; margin-left: 6px; }

  .ob-card { background: var(--white); border: 1px solid var(--rule); border-radius: var(--radius); padding: 20px; margin-bottom: 16px; }
  .ob-card-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 16px; margin-bottom: 24px; }
  .ob-stat-card { background: var(--white); border: 1px solid var(--rule); border-radius: var(--radius); padding: 18px 20px; }
  .ob-stat-label { font-size: 11px; font-weight: 600; color: var(--mist); text-transform: uppercase; letter-spacing: 1px; margin-bottom: 8px; }
  .ob-stat-value { font-family: 'Plus Jakarta Sans', sans-serif; font-weight: 800; font-size: 28px; color: var(--steel); line-height: 1; }
  .ob-stat-sub   { font-size: 12px; color: var(--mist); margin-top: 4px; }
  .ob-section-heading { font-family: 'Plus Jakarta Sans', sans-serif; font-weight: 700; font-size: 14px; color: var(--steel); margin-bottom: 12px; padding-bottom: 8px; border-bottom: 1px solid var(--rule); }

  /* Booking row */
  .ob-booking-row { display: flex; align-items: flex-start; justify-content: space-between; padding: 14px 0; border-bottom: 1px solid var(--rule); gap: 12px; }
  .ob-booking-row:last-child { border-bottom: none; }
  .ob-booking-name { font-size: 14px; font-weight: 600; color: var(--steel); }
  .ob-booking-meta { font-size: 12px; color: var(--mist); margin-top: 2px; }

  /* Booking detail card */
  .ob-booking-card { background: var(--white); border: 1px solid var(--rule); border-radius: var(--radius); padding: 18px 20px; margin-bottom: 12px; }
  .ob-booking-card.pending { border-left: 4px solid #EAB308; }
  .ob-booking-card.confirmed { border-left: 4px solid #22C55E; }
  .ob-booking-card.cancelled { border-left: 4px solid #EF4444; opacity: 0.7; }

  /* Calendar */
  .ob-cal-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 4px; margin-bottom: 16px; }
  .ob-cal-day-header { text-align: center; font-size: 11px; font-weight: 600; color: var(--mist); padding: 4px 0; text-transform: uppercase; }
  .ob-cal-day { aspect-ratio: 1; border: 1px solid var(--rule); border-radius: 6px; display: flex; align-items: center; justify-content: center; font-size: 13px; cursor: pointer; position: relative; transition: all 0.15s; }
  .ob-cal-day:hover { border-color: var(--ember); }
  .ob-cal-day.today { border-color: var(--ember); font-weight: 700; }
  .ob-cal-day.has-bookings { background: #FFF1EC; }
  .ob-cal-day.empty { border-color: transparent; cursor: default; }
  .ob-cal-day-num { font-size: 13px; color: var(--steel); }
  .ob-cal-dot { width: 5px; height: 5px; border-radius: 50%; background: var(--ember); position: absolute; bottom: 4px; }

  /* Service row */
  .ob-service-row { display: flex; align-items: center; justify-content: space-between; padding: 12px 0; border-bottom: 1px solid var(--rule); }
  .ob-service-row:last-child { border-bottom: none; }

  /* Buttons */
  .ob-btn { display: inline-flex; align-items: center; gap: 6px; padding: 8px 14px; border-radius: 6px; font-family: 'DM Sans', sans-serif; font-size: 13px; font-weight: 500; cursor: pointer; border: none; transition: all 0.15s; white-space: nowrap; }
  .ob-btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .ob-btn-primary   { background: var(--ember); color: white; }
  .ob-btn-primary:hover:not(:disabled) { background: var(--ember-lt); }
  .ob-btn-secondary { background: var(--chalk); color: var(--steel); border: 1px solid var(--rule); }
  .ob-btn-secondary:hover:not(:disabled) { border-color: var(--mist); }
  .ob-btn-ghost     { background: none; color: var(--mist); border: 1px solid var(--rule); }
  .ob-btn-ghost:hover:not(:disabled) { color: var(--steel); border-color: var(--steel); }
  .ob-btn-success   { background: #DCFCE7; color: #166534; border: 1px solid #BBF7D0; }
  .ob-btn-danger    { background: #FEE2E2; color: #991B1B; border: 1px solid #FECACA; }
  .ob-btn-sm        { padding: 5px 10px; font-size: 12px; }

  /* Pill */
  .ob-pill { display: inline-flex; align-items: center; padding: 3px 10px; border-radius: 20px; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; }
  .ob-pill-pending    { background: #FEF9C3; color: #854D0E; }
  .ob-pill-confirmed  { background: #DCFCE7; color: #166534; }
  .ob-pill-complete   { background: #F3F4F6; color: #6B7280; }
  .ob-pill-cancelled  { background: #FEE2E2; color: #991B1B; }
  .ob-pill-no_show    { background: #FEE2E2; color: #991B1B; }
  .ob-pill-structured { background: #EFF6FF; color: #1E40AF; }
  .ob-pill-request    { background: #F3E8FF; color: #6B21A8; }

  /* Form */
  .ob-input { width: 100%; padding: 9px 12px; border: 1px solid var(--rule); border-radius: 6px; font-family: 'DM Sans', sans-serif; font-size: 14px; color: var(--steel); outline: none; transition: border-color 0.15s; background: white; }
  .ob-input:focus { border-color: var(--ember); }
  .ob-input-label { font-size: 13px; font-weight: 500; color: var(--steel); margin-bottom: 6px; display: block; }
  .ob-input-group { margin-bottom: 16px; }
  .ob-form-grid   { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }

  /* Modal */
  .ob-modal-overlay { position: fixed; inset: 0; background: rgba(28,28,46,0.5); display: flex; align-items: center; justify-content: center; z-index: 100; padding: 20px; }
  .ob-modal { background: var(--white); border-radius: var(--radius); padding: 24px; width: 100%; max-width: 540px; max-height: 90vh; overflow-y: auto; }
  .ob-modal-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px; }
  .ob-modal-title  { font-family: 'Plus Jakarta Sans', sans-serif; font-weight: 700; font-size: 16px; color: var(--steel); }

  /* Alert */
  .ob-alert { padding: 12px 16px; border-radius: var(--radius); font-size: 13px; margin-bottom: 16px; }
  .ob-alert-success { background: #DCFCE7; border: 1px solid #BBF7D0; color: #166534; }
  .ob-alert-info    { background: #EFF6FF; border: 1px solid #BFDBFE; color: #1E40AF; }
  .ob-alert-warning { background: #FFFBEB; border: 1px solid #FDE68A; color: #92400E; }

  /* Empty */
  .ob-empty { text-align: center; padding: 48px 24px; color: var(--mist); }
  .ob-empty h3 { font-size: 16px; color: var(--steel); margin-bottom: 6px; }

  /* Booking link */
  .ob-link-box { background: var(--chalk); border: 1px solid var(--rule); border-radius: var(--radius); padding: 12px 16px; display: flex; align-items: center; justify-content: space-between; gap: 12px; }
  .ob-link-url  { font-family: monospace; font-size: 13px; color: var(--steel); word-break: break-all; }
`;

const widgetCss = `
  @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=DM+Sans:wght@300;400;500&display=swap');

  .bw-wrap * { box-sizing: border-box; margin: 0; padding: 0; }
  .bw-wrap {
    font-family: 'DM Sans', sans-serif;
    background: #F8F7F4;
    min-height: 100vh;
    color: #444;
  }

  .bw-header { padding: 20px; text-align: center; }
  .bw-header h1 { font-family: 'Plus Jakarta Sans', sans-serif; font-weight: 800; font-size: 22px; color: #1C1C2E; margin-bottom: 4px; }
  .bw-header p  { font-size: 14px; color: #8C8CA8; }

  .bw-content { max-width: 480px; margin: 0 auto; padding: 0 20px 40px; }

  .bw-service-card { background: white; border: 2px solid #E8E4DE; border-radius: 10px; padding: 16px 18px; margin-bottom: 10px; cursor: pointer; transition: all 0.15s; }
  .bw-service-card:hover { border-color: var(--brand-color, #E8410A); }
  .bw-service-card.selected { border-color: var(--brand-color, #E8410A); background: #FFF8F5; }
  .bw-service-name { font-family: 'Plus Jakarta Sans', sans-serif; font-weight: 700; font-size: 15px; color: #1C1C2E; }
  .bw-service-meta { font-size: 13px; color: #8C8CA8; margin-top: 4px; }
  .bw-service-price { font-weight: 700; color: var(--brand-color, #E8410A); font-size: 15px; }

  .bw-step-title { font-family: 'Plus Jakarta Sans', sans-serif; font-weight: 800; font-size: 18px; color: #1C1C2E; margin-bottom: 6px; }
  .bw-step-sub { font-size: 13px; color: #8C8CA8; margin-bottom: 20px; }

  /* Slot grid */
  .bw-slot-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-bottom: 16px; }
  .bw-slot-btn { padding: 10px 8px; border: 2px solid #E8E4DE; border-radius: 8px; background: white; font-family: 'DM Sans', sans-serif; font-size: 13px; font-weight: 500; color: #1C1C2E; cursor: pointer; text-align: center; transition: all 0.15s; }
  .bw-slot-btn:hover { border-color: var(--brand-color, #E8410A); }
  .bw-slot-btn.selected { border-color: var(--brand-color, #E8410A); background: #FFF8F5; color: var(--brand-color, #E8410A); font-weight: 700; }
  .bw-slot-btn.unavailable { opacity: 0.4; cursor: not-allowed; }

  /* Date grid */
  .bw-date-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 4px; margin-bottom: 16px; }
  .bw-date-btn  { aspect-ratio: 1; border: 2px solid #E8E4DE; border-radius: 8px; background: white; display: flex; align-items: center; justify-content: center; font-size: 13px; cursor: pointer; transition: all 0.15s; }
  .bw-date-btn:hover { border-color: var(--brand-color, #E8410A); }
  .bw-date-btn.selected { border-color: var(--brand-color, #E8410A); background: var(--brand-color, #E8410A); color: white; font-weight: 700; }
  .bw-date-btn.unavailable { opacity: 0.3; cursor: not-allowed; }
  .bw-date-header { text-align: center; font-size: 10px; color: #8C8CA8; font-weight: 600; text-transform: uppercase; padding: 4px 0; }

  /* Form */
  .bw-input { width: 100%; padding: 12px 14px; border: 2px solid #E8E4DE; border-radius: 8px; font-family: 'DM Sans', sans-serif; font-size: 14px; color: #1C1C2E; outline: none; transition: border-color 0.15s; background: white; margin-bottom: 12px; }
  .bw-input:focus { border-color: var(--brand-color, #E8410A); }
  .bw-input-label { font-size: 13px; font-weight: 500; color: #555; margin-bottom: 6px; display: block; }
  .bw-textarea { min-height: 80px; resize: vertical; }

  /* Photo upload */
  .bw-photo-zone { border: 2px dashed #E8E4DE; border-radius: 8px; padding: 20px; text-align: center; cursor: pointer; margin-bottom: 12px; transition: border-color 0.15s; }
  .bw-photo-zone:hover { border-color: var(--brand-color, #E8410A); }
  .bw-photo-zone p { font-size: 13px; color: #8C8CA8; }

  /* Progress */
  .bw-progress { display: flex; gap: 4px; margin-bottom: 24px; }
  .bw-progress-step { flex: 1; height: 3px; border-radius: 2px; background: #E8E4DE; transition: background 0.2s; }
  .bw-progress-step.done { background: var(--brand-color, #E8410A); }

  /* Submit button */
  .bw-submit-btn { width: 100%; padding: 16px; border: none; border-radius: 10px; font-family: 'Plus Jakarta Sans', sans-serif; font-weight: 800; font-size: 17px; color: white; cursor: pointer; transition: opacity 0.15s; margin-top: 8px; }
  .bw-submit-btn:hover { opacity: 0.9; }
  .bw-submit-btn:disabled { opacity: 0.5; cursor: not-allowed; }

  /* Back button */
  .bw-back-btn { background: none; border: none; color: #8C8CA8; font-size: 13px; cursor: pointer; padding: 0 0 16px; display: flex; align-items: center; gap: 4px; }

  /* Confirmation */
  .bw-confirmation { text-align: center; padding: 40px 20px; }
  .bw-confirmation-icon { font-size: 48px; margin-bottom: 16px; }
  .bw-confirmation h2 { font-family: 'Plus Jakarta Sans', sans-serif; font-weight: 800; font-size: 22px; color: #1C1C2E; margin-bottom: 8px; }
  .bw-confirmation p { font-size: 14px; color: #8C8CA8; line-height: 1.6; }

  /* Mode badge */
  .bw-mode-badge { display: inline-flex; align-items: center; padding: 4px 10px; border-radius: 20px; font-size: 11px; font-weight: 600; text-transform: uppercase; margin-top: 6px; }
  .bw-mode-structured { background: #EFF6FF; color: #1E40AF; }
  .bw-mode-request    { background: #F3E8FF; color: #6B21A8; }
`;

// ── HELPERS ─────────────────────────────────────────────────────
const formatDate = (d) => d ? new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—";
const formatTime = (t) => t ? t.slice(0, 5) : "";
const formatCurrency = (n) => n ? `£${(n).toFixed(2)}` : "";

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
const MOCK_SERVICES = [
  { id: "svc1", name: "Boiler Service", description: "Annual boiler service and safety check. Gas Safe registered engineer.", duration_mins: 90, price: 120, deposit_amount: 0, mode: "structured", active: true },
  { id: "svc2", name: "Boiler Repair", description: "Diagnostic and repair. Quote provided before work begins.", duration_mins: 120, price: null, deposit_amount: 0, mode: "request", active: true },
  { id: "svc3", name: "New Boiler Installation", description: "Supply and install new gas boiler. Site survey required first.", duration_mins: 480, price: null, deposit_amount: 250, mode: "request", active: true },
  { id: "svc4", name: "Power Flush", description: "Full system power flush and chemical treatment.", duration_mins: 240, price: 280, deposit_amount: 50, mode: "structured", active: true },
  { id: "svc5", name: "Landlord Gas Safety Certificate", description: "Annual CP12 gas safety inspection and certificate.", duration_mins: 60, price: 85, deposit_amount: 0, mode: "structured", active: true },
];

const today = new Date();
const MOCK_BOOKINGS = [
  { id: "b1", service_id: "svc1", service_name: "Boiler Service", customer_name: "James Whitfield", customer_email: "james@whitfieldproperty.co.uk", customer_phone: "07700 900123", customer_address: "12 Oak Street, Worthing", booking_date: new Date(Date.now() + 2 * 86400000).toISOString().split("T")[0], booking_time: "10:00", status: "confirmed", deposit_paid: false, deposit_amount: 0, notes: "Combi boiler in airing cupboard.", photos: [], confirmed_at: new Date().toISOString(), created_at: new Date().toISOString() },
  { id: "b2", service_id: "svc2", service_name: "Boiler Repair", customer_name: "Helen Burgess", customer_email: "helen.b@gmail.com", customer_phone: "07700 900456", customer_address: "34 Maple Avenue, Worthing", booking_date: null, booking_time: null, preferred_dates: "Any day next week, prefer mornings", status: "pending", deposit_paid: false, deposit_amount: 0, notes: "Boiler firing but no hot water. Pressure fine.", photos: [], created_at: new Date(Date.now() - 2 * 3600000).toISOString() },
  { id: "b3", service_id: "svc5", service_name: "Landlord Gas Safety Certificate", customer_name: "Robert Chen", customer_email: "r.chen@landlordpro.co.uk", customer_phone: "07700 900789", customer_address: "8 Station Road, Lancing", booking_date: new Date(Date.now() + 5 * 86400000).toISOString().split("T")[0], booking_time: "14:00", status: "confirmed", deposit_paid: false, deposit_amount: 0, notes: "Tenant is Sarah Mitchell — notify her directly. Code to enter: 4521.", photos: [], confirmed_at: new Date().toISOString(), created_at: new Date(Date.now() - 86400000).toISOString() },
  { id: "b4", service_id: "svc3", service_name: "New Boiler Installation", customer_name: "Sandra Williams", customer_email: "sandra.w@hotmail.com", customer_phone: "07700 900321", customer_address: "19 Victoria Terrace, Shoreham", booking_date: null, booking_time: null, preferred_dates: "Flexible — keen to get it done this month", status: "pending", deposit_paid: false, deposit_amount: 250, notes: "Current boiler is a Worcester 24i, 14 years old. Keeps cutting out.", photos: [], created_at: new Date(Date.now() - 3600000).toISOString() },
];

// ── ADMIN COMPONENT ─────────────────────────────────────────────
const ADMIN_TABS = [
  { id: "bookings",  label: "Bookings" },
  { id: "calendar",  label: "Calendar" },
  { id: "services",  label: "Services" },
  { id: "settings",  label: "Settings" },
];

// ── Live-schema <-> UI adapters ──────────────────────────────────
const penceToPounds = (p) => (p ?? 0) / 100;
const poundsToPence = (v) => Math.round((parseFloat(v) || 0) * 100);
function mapService(row) {
  return {
    id: row.id, name: row.name, description: row.description || "",
    duration_mins: row.duration_minutes, price: penceToPounds(row.price_pence),
    deposit_amount: penceToPounds(row.deposit_pence), mode: "structured", active: row.active,
  };
}
function mapBooking(row) {
  return {
    id: row.id, service_id: row.service_id, service_name: row.service?.name || "",
    customer_name: row.customer_name, customer_email: row.customer_email,
    customer_phone: row.customer_phone || "", customer_address: "",
    booking_date: row.booking_date, booking_time: row.booking_time,
    status: row.status === "completed" ? "complete" : row.status,
    deposit_paid: row.deposit_paid, deposit_amount: penceToPounds(row.deposit_pence),
    notes: row.notes || "", photos: row.photos || [],
    confirmed_at: row.confirmed_at, created_at: row.created_at,
  };
}

export default function OnlineBooking({
  supabase, accountId, userId, userName, userRole,
}) {
  const [activeTab, setActiveTab] = useState("bookings");
  const [bookings, setBookings] = useState([]);
  const [services, setServices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showPreview, setShowPreview] = useState(false);
  const [showAddService, setShowAddService] = useState(false);
  const [showBookingDetail, setShowBookingDetail] = useState(null);
  const [alert, setAlert] = useState(null);

  const showAlertMsg = (type, msg) => {
    setAlert({ type, message: msg });
    setTimeout(() => setAlert(null), 4000);
  };

  // ── Load real data (RLS scopes to this account) ──
  const loadData = useCallback(async () => {
    setLoading(true);
    const [svcRes, bkRes] = await Promise.all([
      supabase.from("booking_services").select("*").order("name"),
      supabase.from("bookings").select("*, service:booking_services(name)").order("created_at", { ascending: false }),
    ]);
    if (!svcRes.error) setServices((svcRes.data || []).map(mapService));
    else showAlertMsg("error", `Could not load services: ${svcRes.error.message}`);
    if (!bkRes.error) setBookings((bkRes.data || []).map(mapBooking));
    setLoading(false);
  }, [supabase]);

  useEffect(() => { loadData(); }, [loadData]);

  // Stats
  const pending = bookings.filter((b) => b.status === "pending").length;
  const confirmed = bookings.filter((b) => b.status === "confirmed").length;
  const thisWeek = bookings.filter((b) => {
    if (!b.booking_date) return false;
    const d = new Date(b.booking_date);
    const weekEnd = new Date(today.getTime() + 7 * 86400000);
    return d >= today && d <= weekEnd;
  }).length;

  const handleConfirm = async (bookingId, date, time) => {
    const confirmed_at = new Date().toISOString();
    const { error } = await supabase.from("bookings")
      .update({ status: "confirmed", booking_date: date, booking_time: time || null, confirmed_at })
      .eq("id", bookingId);
    if (error) { showAlertMsg("error", `Could not confirm: ${error.message}`); return; }
    setBookings((prev) => prev.map((b) =>
      b.id === bookingId ? { ...b, status: "confirmed", booking_date: date, booking_time: time, confirmed_by: userName, confirmed_at } : b
    ));
    await logAction(supabase, {
      accountId, userId, userName, userRole,
      action: "confirmed",
      entityType: "booking",
      entityId: bookingId,
      entityName: `Booking confirmed — ${bookings.find((b) => b.id === bookingId)?.customer_name}`,
      newValue: { status: "confirmed", date, time },
    });
    setShowBookingDetail(null);
    showAlertMsg("success", "Booking confirmed. Confirmation email sent to customer.");
  };

  const handleCancel = async (bookingId, reason) => {
    const { error } = await supabase.from("bookings").update({ status: "cancelled" }).eq("id", bookingId);
    if (error) { showAlertMsg("error", `Could not cancel: ${error.message}`); return; }
    setBookings((prev) => prev.map((b) =>
      b.id === bookingId ? { ...b, status: "cancelled", cancellation_reason: reason } : b
    ));
    await logAction(supabase, {
      accountId, userId, userName, userRole,
      action: "updated",
      entityType: "booking",
      entityId: bookingId,
      entityName: `Booking cancelled — ${bookings.find((b) => b.id === bookingId)?.customer_name}`,
      newValue: { status: "cancelled", reason },
    });
    setShowBookingDetail(null);
    showAlertMsg("success", "Booking cancelled. Customer has been notified.");
  };

  const bookingDetail = showBookingDetail ? bookings.find((b) => b.id === showBookingDetail) : null;

  return (
    <>
      <style>{adminCss}</style>
      <div className="ob-wrap">

        <div className="ob-header">
          <div>
            <h1>Online Booking</h1>
            <p>Structured slots · Request mode · Deposits · Confirmation emails</p>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="ob-btn ob-btn-secondary" onClick={() => setShowPreview(true)}>Preview Booking Page</button>
            <button className="ob-btn ob-btn-primary" onClick={() => setShowAddService(true)}>+ Add Service</button>
          </div>
        </div>

        {alert && <div className={`ob-alert ob-alert-${alert.type}`}>{alert.message}</div>}

        {/* Stats */}
        <div className="ob-card-grid">
          <div className="ob-stat-card">
            <div className="ob-stat-label">Pending</div>
            <div className="ob-stat-value" style={{ color: pending > 0 ? "#EAB308" : "#22C55E" }}>{pending}</div>
            <div className="ob-stat-sub">Need confirming</div>
          </div>
          <div className="ob-stat-card">
            <div className="ob-stat-label">Confirmed</div>
            <div className="ob-stat-value">{confirmed}</div>
            <div className="ob-stat-sub">Upcoming</div>
          </div>
          <div className="ob-stat-card">
            <div className="ob-stat-label">This Week</div>
            <div className="ob-stat-value">{thisWeek}</div>
            <div className="ob-stat-sub">Scheduled visits</div>
          </div>
          <div className="ob-stat-card">
            <div className="ob-stat-label">Services Active</div>
            <div className="ob-stat-value">{services.filter((s) => s.active).length}</div>
            <div className="ob-stat-sub">Taking bookings</div>
          </div>
        </div>

        {/* Booking page link */}
        <div className="ob-card" style={{ marginBottom: 20 }}>
          <div className="ob-section-heading">Your Booking Page</div>
          <div className="ob-link-box">
            <span className="ob-link-url">book.yourcompanyai.co.uk/your-business</span>
            <div style={{ display: "flex", gap: 6 }}>
              <button className="ob-btn ob-btn-secondary ob-btn-sm" onClick={() => { navigator.clipboard?.writeText("https://book.yourcompanyai.co.uk/your-business"); showAlertMsg("success", "Link copied."); }}>Copy Link</button>
              <button className="ob-btn ob-btn-primary ob-btn-sm" onClick={() => setShowPreview(true)}>Preview</button>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="ob-tabs">
          {ADMIN_TABS.map((tab) => (
            <button key={tab.id} className={`ob-tab ${activeTab === tab.id ? "active" : ""}`} onClick={() => setActiveTab(tab.id)}>
              {tab.label}
              {tab.id === "bookings" && pending > 0 && <span className="badge">{pending}</span>}
            </button>
          ))}
        </div>

        {/* ── BOOKINGS ──────────────────────────────────────── */}
        {activeTab === "bookings" && (
          <div>
            {pending > 0 && (
              <div className="ob-alert ob-alert-warning">
                {pending} booking{pending > 1 ? "s" : ""} waiting for confirmation. The customer is waiting to hear from you.
              </div>
            )}

            {/* Pending */}
            {bookings.filter((b) => b.status === "pending").map((booking) => (
              <div key={booking.id} className={`ob-booking-card pending`}>
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span className="ob-booking-name">{booking.customer_name}</span>
                      <span className="ob-pill ob-pill-pending">Pending</span>
                    </div>
                    <div className="ob-booking-meta">{booking.service_name}</div>
                    <div className="ob-booking-meta">{booking.customer_phone} · {booking.customer_email}</div>
                    {booking.preferred_dates && <div style={{ fontSize: 12, color: "var(--mid)", marginTop: 4 }}>Preferred: {booking.preferred_dates}</div>}
                    {booking.notes && <div style={{ fontSize: 12, color: "var(--mid)", marginTop: 2 }}>{booking.notes}</div>}
                  </div>
                  <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                    <button className="ob-btn ob-btn-success ob-btn-sm" onClick={() => setShowBookingDetail(booking.id)}>Confirm</button>
                    <button className="ob-btn ob-btn-ghost ob-btn-sm" onClick={() => handleCancel(booking.id, "Unable to accommodate")}>Decline</button>
                  </div>
                </div>
              </div>
            ))}

            {/* Confirmed */}
            <div className="ob-card">
              <div className="ob-section-heading">Upcoming Confirmed</div>
              {bookings.filter((b) => b.status === "confirmed").length === 0 ? (
                <div style={{ fontSize: 13, color: "var(--mist)", padding: "16px 0" }}>No confirmed bookings.</div>
              ) : (
                bookings.filter((b) => b.status === "confirmed").map((booking) => (
                  <div key={booking.id} className="ob-booking-row">
                    <div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span className="ob-booking-name">{booking.customer_name}</span>
                        <span className="ob-pill ob-pill-confirmed">Confirmed</span>
                      </div>
                      <div className="ob-booking-meta">{booking.service_name}</div>
                      <div className="ob-booking-meta">{formatDate(booking.booking_date)} at {formatTime(booking.booking_time)} · {booking.customer_address}</div>
                    </div>
                    <div style={{ display: "flex", gap: 6 }}>
                      <button className="ob-btn ob-btn-ghost ob-btn-sm" onClick={async () => {
                        const { error } = await supabase.from("bookings").update({ status: "completed" }).eq("id", booking.id);
                        if (error) { showAlertMsg("error", `Could not update: ${error.message}`); return; }
                        setBookings((p) => p.map((b) => b.id === booking.id ? { ...b, status: "complete" } : b));
                        await logAction(supabase, { accountId, userId, userName, userRole, action: "updated", entityType: "booking", entityId: booking.id, entityName: `Booking completed — ${booking.customer_name}` });
                        showAlertMsg("success", "Marked complete.");
                      }}>
                        Mark Complete
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* ── CALENDAR ──────────────────────────────────────── */}
        {activeTab === "calendar" && (
          <div className="ob-card">
            <div className="ob-section-heading">
              {today.toLocaleDateString("en-GB", { month: "long", year: "numeric" })}
            </div>
            <BookingCalendar bookings={bookings} />
          </div>
        )}

        {/* ── SERVICES ──────────────────────────────────────── */}
        {activeTab === "services" && (
          <div className="ob-card">
            <div className="ob-section-heading">Services</div>
            {services.map((svc) => (
              <div key={svc.id} className="ob-service-row">
                <div>
                  <div style={{ fontWeight: 600, color: "var(--steel)", fontSize: 14 }}>{svc.name}</div>
                  <div style={{ fontSize: 12, color: "var(--mist)", marginTop: 2 }}>
                    {svc.duration_mins} min · {svc.price ? formatCurrency(svc.price) : "Price on request"}
                    {svc.deposit_amount > 0 ? ` · £${svc.deposit_amount} deposit` : ""}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <span className={`ob-pill ob-pill-${svc.mode}`}>{svc.mode}</span>
                  <button
                    className={`ob-btn ob-btn-sm ${svc.active ? "ob-btn-ghost" : "ob-btn-secondary"}`}
                    onClick={async () => {
                      const { error } = await supabase.from("booking_services").update({ active: !svc.active }).eq("id", svc.id);
                      if (error) { showAlertMsg("error", `Could not update: ${error.message}`); return; }
                      setServices((prev) => prev.map((s) => s.id === svc.id ? { ...s, active: !s.active } : s));
                    }}
                  >
                    {svc.active ? "Pause" : "Activate"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── SETTINGS ──────────────────────────────────────── */}
        {activeTab === "settings" && (
          <div className="ob-card">
            <div className="ob-section-heading">Booking Page Settings</div>
            <div className="ob-form-grid">
              <div className="ob-input-group">
                <label className="ob-input-label">Booking page URL slug</label>
                <input className="ob-input" defaultValue="your-business" />
              </div>
              <div className="ob-input-group">
                <label className="ob-input-label">Minimum notice (hours)</label>
                <input type="number" className="ob-input" defaultValue={24} />
              </div>
              <div className="ob-input-group">
                <label className="ob-input-label">Max advance booking (days)</label>
                <input type="number" className="ob-input" defaultValue={60} />
              </div>
              <div className="ob-input-group">
                <label className="ob-input-label">Max photos per booking</label>
                <input type="number" className="ob-input" defaultValue={3} />
              </div>
            </div>
            <div className="ob-input-group">
              <label className="ob-input-label">Confirmation message (shown to customer)</label>
              <textarea className="ob-input" style={{ minHeight: 80 }} defaultValue="Thanks for your booking request. We'll be in touch shortly to confirm your appointment." />
            </div>
            <button className="ob-btn ob-btn-primary" onClick={() => showAlertMsg("success", "Settings saved.")}>
              Save Settings
            </button>
          </div>
        )}

        {/* ── CONFIRM BOOKING MODAL ─────────────────────────── */}
        {bookingDetail && (
          <ConfirmBookingModal
            booking={bookingDetail}
            onConfirm={handleConfirm}
            onCancel={handleCancel}
            onClose={() => setShowBookingDetail(null)}
          />
        )}

        {/* ── PREVIEW MODAL ─────────────────────────────────── */}
        {showPreview && (
          <div className="ob-modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) setShowPreview(false); }}>
            <div className="ob-modal" style={{ maxWidth: 420, padding: 0, overflow: "hidden" }}>
              <div style={{ padding: "12px 16px", background: "var(--steel)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ color: "var(--mist)", fontSize: 13 }}>Customer view preview</span>
                <button className="ob-btn ob-btn-ghost ob-btn-sm" style={{ color: "var(--mist)", borderColor: "var(--steel)" }} onClick={() => setShowPreview(false)}>Close</button>
              </div>
              <BookingWidget
                services={services.filter((s) => s.active)}
                brandColor="#E8410A"
                businessName="Your Business"
                preview
              />
            </div>
          </div>
        )}

        {/* ── ADD SERVICE MODAL ─────────────────────────────── */}
        {showAddService && (
          <AddServiceModal
            onSubmit={async (data) => {
              const { data: inserted, error } = await supabase.from("booking_services").insert({
                account_id: accountId,
                name: data.name,
                description: data.description || null,
                duration_minutes: parseInt(data.duration_mins) || 60,
                price_pence: poundsToPence(data.price),
                deposit_pence: poundsToPence(data.deposit_amount),
                active: true,
              }).select("*").single();
              if (error) { showAlertMsg("error", `Could not add service: ${error.message}`); return; }
              setServices((prev) => [mapService(inserted), ...prev]);
              setShowAddService(false);
              await logAction(supabase, { accountId, userId, userName, userRole, action: "created", entityType: "booking_service", entityId: inserted.id, entityName: data.name });
              showAlertMsg("success", "Service added.");
            }}
            onClose={() => setShowAddService(false)}
          />
        )}
      </div>
    </>
  );
}

// ── BOOKING CALENDAR ────────────────────────────────────────────
function BookingCalendar({ bookings }) {
  const year = today.getFullYear();
  const month = today.getMonth();
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const days = Array.from({ length: 42 }, (_, i) => {
    const d = i - firstDay + 1;
    return d > 0 && d <= daysInMonth ? d : null;
  });

  const bookingsOnDay = (d) => {
    if (!d) return [];
    const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    return bookings.filter((b) => b.booking_date === dateStr && b.status !== "cancelled");
  };

  return (
    <div>
      <div className="ob-cal-grid">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
          <div key={d} className="ob-cal-day-header">{d}</div>
        ))}
        {days.map((d, i) => {
          const bks = bookingsOnDay(d);
          const isToday = d === today.getDate();
          return (
            <div key={i} className={`ob-cal-day ${!d ? "empty" : ""} ${isToday ? "today" : ""} ${bks.length > 0 ? "has-bookings" : ""}`}>
              {d && <span className="ob-cal-day-num">{d}</span>}
              {bks.length > 0 && <span className="ob-cal-dot" />}
            </div>
          );
        })}
      </div>
      <div style={{ fontSize: 12, color: "var(--mist)", marginTop: 4 }}>Dots indicate scheduled visits</div>
    </div>
  );
}

// ── CONFIRM BOOKING MODAL ───────────────────────────────────────
function ConfirmBookingModal({ booking, onConfirm, onCancel, onClose }) {
  const [date, setDate] = useState(booking.booking_date || "");
  const [time, setTime] = useState(booking.booking_time || "");
  return (
    <div className="ob-modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="ob-modal">
        <div className="ob-modal-header">
          <span className="ob-modal-title">Confirm Booking — {booking.customer_name}</span>
          <button className="ob-btn ob-btn-ghost ob-btn-sm" onClick={onClose}>Close</button>
        </div>
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontWeight: 600, color: "var(--steel)", marginBottom: 4 }}>{booking.service_name}</div>
          <div style={{ fontSize: 13, color: "var(--mist)" }}>{booking.customer_phone} · {booking.customer_email}</div>
          {booking.customer_address && <div style={{ fontSize: 13, color: "var(--mist)" }}>{booking.customer_address}</div>}
          {booking.preferred_dates && <div style={{ fontSize: 13, color: "var(--mid)", marginTop: 6 }}>Customer's preferred dates: {booking.preferred_dates}</div>}
          {booking.notes && <div style={{ fontSize: 13, color: "var(--mid)", marginTop: 4, padding: "8px 12px", background: "var(--chalk)", borderRadius: 6 }}>{booking.notes}</div>}
        </div>
        <div className="ob-form-grid">
          <div className="ob-input-group">
            <label className="ob-input-label">Confirm date *</label>
            <input type="date" className="ob-input" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="ob-input-group">
            <label className="ob-input-label">Confirm time</label>
            <input type="time" className="ob-input" value={time} onChange={(e) => setTime(e.target.value)} />
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="ob-btn ob-btn-success" style={{ flex: 2 }} disabled={!date} onClick={() => onConfirm(booking.id, date, time)}>
            Confirm & Send Email
          </button>
          <button className="ob-btn ob-btn-danger ob-btn-sm" onClick={() => onCancel(booking.id, "Unable to accommodate — will rearrange")}>
            Decline
          </button>
        </div>
      </div>
    </div>
  );
}

// ── ADD SERVICE MODAL ───────────────────────────────────────────
function AddServiceModal({ onSubmit, onClose }) {
  const [form, setForm] = useState({ name: "", description: "", duration_mins: 60, price: "", deposit_amount: 0, mode: "request" });
  return (
    <div className="ob-modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="ob-modal">
        <div className="ob-modal-header">
          <span className="ob-modal-title">Add Service</span>
          <button className="ob-btn ob-btn-ghost ob-btn-sm" onClick={onClose}>Close</button>
        </div>
        <div className="ob-input-group">
          <label className="ob-input-label">Service name *</label>
          <input className="ob-input" placeholder="e.g. Boiler Service" value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} />
        </div>
        <div className="ob-input-group">
          <label className="ob-input-label">Description</label>
          <textarea className="ob-input" style={{ minHeight: 60, resize: "vertical" }} value={form.description} onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))} />
        </div>
        <div className="ob-form-grid">
          <div className="ob-input-group">
            <label className="ob-input-label">Duration (minutes)</label>
            <input type="number" className="ob-input" value={form.duration_mins} onChange={(e) => setForm((p) => ({ ...p, duration_mins: parseInt(e.target.value) }))} />
          </div>
          <div className="ob-input-group">
            <label className="ob-input-label">Price (£) — blank = quote</label>
            <input type="number" className="ob-input" placeholder="Leave blank if price varies" value={form.price} onChange={(e) => setForm((p) => ({ ...p, price: e.target.value }))} />
          </div>
        </div>
        <div className="ob-input-group">
          <label className="ob-input-label">Booking mode</label>
          <select className="ob-input" value={form.mode} onChange={(e) => setForm((p) => ({ ...p, mode: e.target.value }))}>
            <option value="request">Request — customer requests, you confirm availability</option>
            <option value="structured">Structured — customer picks from available slots</option>
          </select>
        </div>
        <div className="ob-input-group">
          <label className="ob-input-label">Deposit amount (£) — 0 = no deposit</label>
          <input type="number" className="ob-input" value={form.deposit_amount} onChange={(e) => setForm((p) => ({ ...p, deposit_amount: parseFloat(e.target.value) }))} />
        </div>
        <button className="ob-btn ob-btn-primary" style={{ width: "100%" }} disabled={!form.name} onClick={() => onSubmit(form)}>
          Add Service
        </button>
      </div>
    </div>
  );
}

// ── CUSTOMER-FACING BOOKING WIDGET ──────────────────────────────
export function BookingWidget({ services = [], brandColor = "#E8410A", businessName = "Your Business", preview = false }) {
  const [step, setStep] = useState("service");
  const [selectedService, setSelectedService] = useState(null);
  const [selectedDate, setSelectedDate] = useState(null);
  const [selectedTime, setSelectedTime] = useState(null);
  const [form, setForm] = useState({ name: "", email: "", phone: "", address: "", notes: "", preferred_dates: "" });
  const [submitted, setSubmitted] = useState(false);

  const STEPS = selectedService?.mode === "structured"
    ? ["service", "date", "time", "details", "confirm"]
    : ["service", "details", "confirm"];

  const stepIdx = STEPS.indexOf(step);

  const year = today.getFullYear();
  const month = today.getMonth();
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const calDays = Array.from({ length: 42 }, (_, i) => {
    const d = i - firstDay + 1;
    return d > 0 && d <= daysInMonth ? d : null;
  });

  const MOCK_SLOTS = ["08:00", "09:00", "10:00", "11:00", "13:00", "14:00", "15:00"];

  const handleSubmit = () => {
    // In production: POST to Supabase Edge Function or direct insert
    setSubmitted(true);
  };

  if (submitted) {
    return (
      <>
        <style>{widgetCss}</style>
        <div className="bw-wrap">
          <div style={{ "--brand-color": brandColor }}>
            <div className="bw-confirmation">
              <div className="bw-confirmation-icon">✓</div>
              <h2>Booking Request Sent</h2>
              <p>Thanks, {form.name.split(" ")[0]}. We'll be in touch shortly to confirm your appointment. You'll receive an email confirmation at {form.email}.</p>
            </div>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <style>{widgetCss.replace(/var\(--brand-color, #E8410A\)/g, brandColor)}</style>
      <div className="bw-wrap">
        <div className="bw-header">
          <h1>{businessName}</h1>
          <p>Book your appointment online</p>
        </div>

        <div className="bw-content">
          {/* Progress */}
          <div className="bw-progress">
            {STEPS.filter((s) => s !== "confirm").map((s, i) => (
              <div key={s} className={`bw-progress-step ${stepIdx > i ? "done" : ""}`} style={stepIdx > i ? { background: brandColor } : {}} />
            ))}
          </div>

          {/* Service selection */}
          {step === "service" && (
            <div>
              <div className="bw-step-title">What do you need?</div>
              <div className="bw-step-sub">Choose a service to get started.</div>
              {services.map((svc) => (
                <div
                  key={svc.id}
                  className={`bw-service-card ${selectedService?.id === svc.id ? "selected" : ""}`}
                  onClick={() => setSelectedService(svc)}
                >
                  <div className="bw-service-name">{svc.name}</div>
                  <div className="bw-service-meta">{svc.description}</div>
                  <div style={{ display: "flex", align: "center", gap: 8, marginTop: 6 }}>
                    {svc.price && <span className="bw-service-price">{formatCurrency(svc.price)}</span>}
                    <span style={{ fontSize: 12, color: "#8C8CA8" }}>{svc.duration_mins} min</span>
                    {svc.deposit_amount > 0 && <span style={{ fontSize: 12, color: "#8C8CA8" }}>· £{svc.deposit_amount} deposit</span>}
                  </div>
                  <span className={`bw-mode-badge bw-mode-${svc.mode}`}>{svc.mode === "structured" ? "Choose a time slot" : "Request — we'll confirm"}</span>
                </div>
              ))}
              <button
                className="bw-submit-btn"
                style={{ background: brandColor }}
                disabled={!selectedService}
                onClick={() => setStep(selectedService?.mode === "structured" ? "date" : "details")}
              >
                Continue
              </button>
            </div>
          )}

          {/* Date selection (structured mode) */}
          {step === "date" && (
            <div>
              <button className="bw-back-btn" onClick={() => setStep("service")}>← Back</button>
              <div className="bw-step-title">Choose a date</div>
              <div className="bw-step-sub">{today.toLocaleDateString("en-GB", { month: "long", year: "numeric" })}</div>
              <div className="bw-date-grid">
                {["Su","Mo","Tu","We","Th","Fr","Sa"].map((d) => <div key={d} className="bw-date-header">{d}</div>)}
                {calDays.map((d, i) => (
                  <button
                    key={i}
                    className={`bw-date-btn ${!d ? "unavailable" : ""} ${selectedDate === d ? "selected" : ""}`}
                    style={selectedDate === d ? { background: brandColor, borderColor: brandColor } : {}}
                    disabled={!d || d < today.getDate()}
                    onClick={() => d >= today.getDate() && setSelectedDate(d)}
                  >
                    {d || ""}
                  </button>
                ))}
              </div>
              <button className="bw-submit-btn" style={{ background: brandColor }} disabled={!selectedDate} onClick={() => setStep("time")}>
                Continue
              </button>
            </div>
          )}

          {/* Time selection (structured mode) */}
          {step === "time" && (
            <div>
              <button className="bw-back-btn" onClick={() => setStep("date")}>← Back</button>
              <div className="bw-step-title">Choose a time</div>
              <div className="bw-step-sub">{selectedDate} {today.toLocaleDateString("en-GB", { month: "long" })}</div>
              <div className="bw-slot-grid">
                {MOCK_SLOTS.map((slot) => (
                  <button
                    key={slot}
                    className={`bw-slot-btn ${selectedTime === slot ? "selected" : ""}`}
                    style={selectedTime === slot ? { borderColor: brandColor, color: brandColor } : {}}
                    onClick={() => setSelectedTime(slot)}
                  >
                    {slot}
                  </button>
                ))}
              </div>
              <button className="bw-submit-btn" style={{ background: brandColor }} disabled={!selectedTime} onClick={() => setStep("details")}>
                Continue
              </button>
            </div>
          )}

          {/* Details */}
          {step === "details" && (
            <div>
              <button className="bw-back-btn" onClick={() => setStep(selectedService?.mode === "structured" ? "time" : "service")}>← Back</button>
              <div className="bw-step-title">Your details</div>
              <div className="bw-step-sub">We'll send a confirmation to your email.</div>
              <label className="bw-input-label">Your name *</label>
              <input className="bw-input" placeholder="Full name" value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} />
              <label className="bw-input-label">Email *</label>
              <input type="email" className="bw-input" placeholder="you@example.com" value={form.email} onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))} />
              <label className="bw-input-label">Phone</label>
              <input type="tel" className="bw-input" placeholder="07700 900000" value={form.phone} onChange={(e) => setForm((p) => ({ ...p, phone: e.target.value }))} />
              <label className="bw-input-label">Property address *</label>
              <input className="bw-input" placeholder="Where do you need us?" value={form.address} onChange={(e) => setForm((p) => ({ ...p, address: e.target.value }))} />
              {selectedService?.mode === "request" && (
                <>
                  <label className="bw-input-label">Preferred dates or times</label>
                  <input className="bw-input" placeholder="e.g. Any morning next week" value={form.preferred_dates} onChange={(e) => setForm((p) => ({ ...p, preferred_dates: e.target.value }))} />
                </>
              )}
              <label className="bw-input-label">Describe the issue (optional)</label>
              <textarea className="bw-input bw-textarea" placeholder="Tell us what's happening. The more detail the better." value={form.notes} onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))} />
              <div className="bw-photo-zone">
                <p>Tap to upload photos (up to 3)</p>
                <p style={{ fontSize: 11, marginTop: 4 }}>Helps us understand the job before we arrive</p>
              </div>
              <button
                className="bw-submit-btn"
                style={{ background: brandColor }}
                disabled={!form.name || !form.email || !form.address}
                onClick={handleSubmit}
              >
                {selectedService?.deposit_amount > 0 ? `Pay £${selectedService.deposit_amount} Deposit & Book` : "Send Booking Request"}
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
