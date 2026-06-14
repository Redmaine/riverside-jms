-- =============================================================================
-- RIVERSIDE JMS — module setup for the new (riverside-v2) build.
-- Run in the Supabase SQL editor for project hzxfskdcluuluzpzevnz.
-- NOTHING here is run automatically — review before applying.
--
-- Riverside is single-tenant. The YCA modules expect an account_id + an
-- accounts row + a current_account_id() function. Section A provides a fixed
-- account and a single-tenant current_account_id() so every YCA
-- "account_id = current_account_id()" RLS policy just works.
--
-- IMPORTANT — do NOT drop/alter the existing live tables: jobs, customers,
-- hr_employees, hr_monthly_hours, job_files. Steph's live data lives there.
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION A — single-tenant shim (safe, foundational)
-- ─────────────────────────────────────────────────────────────────────────────

-- The fixed Riverside account id (matches RIVERSIDE_ACCOUNT_ID in src/lib/riverside.js).
create extension if not exists pgcrypto;

create table if not exists accounts (
  id uuid primary key,
  business_name text,
  trading_name text,
  invoice_prefix text default 'INV',
  invoice_sequence int default 1,
  vat_registered boolean default false,
  vat_number text,
  website_url text,
  calendly_url text,
  brand_colour text default '#1a2744',
  logo_url text,
  phone text,
  address_line1 text,
  town text,
  postcode text,
  created_at timestamptz default now()
);

insert into accounts (id, business_name, trading_name, invoice_prefix, phone, address_line1, town, postcode)
values ('a1f5c3e2-0000-4000-8000-000000000001',
        'Riverside Sheetmetal Fabrications Ltd', 'Riverside Sheetmetal Fabrications Ltd',
        'RIV', '01903 732486', 'L2 Riverside Industrial Estate, Littlehampton', 'West Sussex', 'BN17 5DF')
on conflict (id) do nothing;

-- Single-tenant: every module reads/writes this one account.
create or replace function current_account_id() returns uuid
  language sql stable as $$ select 'a1f5c3e2-0000-4000-8000-000000000001'::uuid $$;

-- Pension opt-out (Phase 3) — added to Riverside's existing hr_employees. Safe ADDs only.
alter table hr_employees add column if not exists opted_out_pension boolean default false;
alter table hr_employees add column if not exists opted_out_pension_at timestamptz;

-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION B — foundational tables used across many modules
-- ─────────────────────────────────────────────────────────────────────────────

-- audit_log — every module writes here via logAction().
create table if not exists audit_log (
  id uuid primary key default gen_random_uuid(),
  account_id uuid references accounts(id) on delete cascade,
  user_id uuid,
  user_name text,
  user_role text,
  action text,
  entity_type text,
  entity_id text,
  entity_name text,
  old_value jsonb,
  new_value jsonb,
  created_at timestamptz default now()
);
alter table audit_log enable row level security;
drop policy if exists audit_log_owner on audit_log;
create policy audit_log_owner on audit_log using (account_id = current_account_id()) with check (account_id = current_account_id());

-- contacts — Invoice Generation + Customer Portal need this (Riverside's existing
-- "customers" table is a different shape, so a parallel contacts table is used).
create table if not exists contacts (
  id uuid primary key default gen_random_uuid(),
  account_id uuid references accounts(id) on delete cascade,
  first_name text,
  last_name text,
  business_name text,
  company_name text,
  email text,
  phone text,
  mobile text,
  address_line1 text,
  town text,
  postcode text,
  is_vip boolean default false,
  created_at timestamptz default now()
);
alter table contacts enable row level security;
drop policy if exists contacts_owner on contacts;
create policy contacts_owner on contacts using (account_id = current_account_id()) with check (account_id = current_account_id());

-- =============================================================================
-- SECTION C — REMAINING MODULE TABLES (the full list — create before that
-- module will hold data). These are YCA-shaped tables. The RELIABLE way to
-- create them is to export the schema from the YCA Supabase project and apply
-- the matching tables here — DDL reconstructed from code comments has repeatedly
-- proved wrong (wrong column names / constraints), so it is intentionally NOT
-- hand-rolled here. For each, RLS should be:
--   ENABLE ROW LEVEL SECURITY;
--   CREATE POLICY x_owner ON <t> USING (account_id = current_account_id())
--       WITH CHECK (account_id = current_account_id());
-- Several already exist as migrations in the YCA repo
-- (~/Desktop/yca-platform/supabase/migrations/) — noted [YCA-MIGRATION].
--
--  INVOICES / QUOTES (Invoice Generation, Invoice Chasing, Customer Portal):
--    invoices                 [YCA-MIGRATION: 20260608_quotes.sql]
--    invoice_line_items       [YCA-MIGRATION: 20260608_quotes.sql]
--    quotes                   [YCA-MIGRATION: 20260608_quotes.sql]
--    invoice_chaser_configs
--    invoice_chaser_log
--    invoice_chaser_pauses
--
--  BILLS / EXPENSES (Bills & Expenses):
--    bills                    [YCA-MIGRATION: 20260608_bills_expenses.sql]
--    expenses                 [YCA-MIGRATION: 20260608_bills_expenses.sql]
--    receipts                 [YCA-MIGRATION: 20260608_bills_expenses.sql]
--
--  JOB COSTING:  job_costs, overhead_configs, supplier_price_lists
--    ⚠ Job Costing also reads `jobs` expecting the YCA jobs shape
--      (quoted_amount_pence, contact_id, costs join) — Riverside's existing
--      `jobs` table is a different shape (lines JSON). Needs adaptation; will
--      not show correct data until then.
--
--  HEALTH & SAFETY:
--    hs_risk_assessments, hs_risk_hazards, hs_toolbox_talks,
--    hs_accidents, hs_certifications,
--    hs_coshh                 [YCA-MIGRATION: 20260613_v2_quotes_hr.sql]
--
--  FLEET:   fleet_vehicles, fleet_costs, fleet_fault_reports, fleet_mileage_log
--  ASSETS:  asset_categories, asset_items, asset_checkouts
--  CUSTOMER PORTAL: portal_magic_links, portal_notifications
--  ONLINE BOOKING:  booking_services, bookings
--  WHATSAPP:        whatsapp_conversations, whatsapp_messages
--
--  COLLISIONS with Riverside's existing tables (need code adaptation, not just
--  a new table):
--    • jobs         — Bills/Portal/Invoices/JobCosting expect YCA jobs shape
--    • hr_employees — Bills expense dropdown expects YCA shape (Riverside uses
--                     name/leave). Cosmetic; HR module itself is Riverside's own.
-- =============================================================================
