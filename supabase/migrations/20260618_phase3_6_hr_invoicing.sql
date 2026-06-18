-- Riverside JMS — Phase 3 + Phase 6 migration
-- Run manually against the Supabase project (hzxfskdcluuluzpzevnz).
-- Everything here is ADDITIVE: new nullable columns + new tables. The live
-- monolith ignores columns/tables it doesn't use, so running this will NOT
-- break the currently-deployed site. Run it BEFORE using the new
-- add/edit-employee form or the Invoices tab on the v2 test site, because
-- those write to the new columns/tables.
--
-- NOTE on security: the app connects with the anon key and has no login, so
-- these tables are made readable/writable by the anon role to match how
-- jobs / customers / hr_employees already behave. If your existing tables use
-- stricter RLS, mirror that policy here instead.

-- ─────────────────────────────────────────────────────────────
-- PHASE 3 — HR: probation, appraisals, address, NI/tax
-- ─────────────────────────────────────────────────────────────
ALTER TABLE hr_employees ADD COLUMN IF NOT EXISTS probation_end_date    date;
ALTER TABLE hr_employees ADD COLUMN IF NOT EXISTS probation_complete    boolean DEFAULT false;
ALTER TABLE hr_employees ADD COLUMN IF NOT EXISTS probation_passed_date date;   -- supports "Probation passed [date]"
ALTER TABLE hr_employees ADD COLUMN IF NOT EXISTS next_appraisal_date   date;
ALTER TABLE hr_employees ADD COLUMN IF NOT EXISTS last_appraisal_date   date;
ALTER TABLE hr_employees ADD COLUMN IF NOT EXISTS address_line1         text;
ALTER TABLE hr_employees ADD COLUMN IF NOT EXISTS address_line2         text;
ALTER TABLE hr_employees ADD COLUMN IF NOT EXISTS town                  text;
ALTER TABLE hr_employees ADD COLUMN IF NOT EXISTS postcode              text;
ALTER TABLE hr_employees ADD COLUMN IF NOT EXISTS ni_number             text;
ALTER TABLE hr_employees ADD COLUMN IF NOT EXISTS tax_code              text;

-- Phase 3.5 — per-employee documents (files live in the existing job-files bucket under hr/{employee_id}/)
CREATE TABLE IF NOT EXISTS hr_employee_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid REFERENCES hr_employees(id) ON DELETE CASCADE,
  name text NOT NULL,
  file_path text NOT NULL,
  category text,
  uploaded_at timestamptz DEFAULT now()
);

ALTER TABLE hr_employee_documents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS hr_employee_documents_anon_all ON hr_employee_documents;
CREATE POLICY hr_employee_documents_anon_all ON hr_employee_documents
  FOR ALL TO anon USING (true) WITH CHECK (true);

-- ─────────────────────────────────────────────────────────────
-- PHASE 6 — Invoicing
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_number text NOT NULL,
  job_id uuid,
  job_ref text,
  customer_name text NOT NULL,
  contact_name text,
  po_number text,
  invoice_date date NOT NULL DEFAULT CURRENT_DATE,
  due_date date,
  payment_terms text DEFAULT '30 days end of month',
  lines jsonb DEFAULT '[]',
  subtotal numeric DEFAULT 0,
  vat_amount numeric DEFAULT 0,
  total numeric DEFAULT 0,
  status text DEFAULT 'unpaid' CHECK (status IN ('unpaid','paid','overdue','credit')),
  paid_date date,
  notes text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS invoices_anon_all ON invoices;
CREATE POLICY invoices_anon_all ON invoices
  FOR ALL TO anon USING (true) WITH CHECK (true);

-- Invoice numbering — atomic counter behind increment_invoice_counter()
-- (mirrors the existing increment_job_counter used for R000001 refs).
CREATE TABLE IF NOT EXISTS invoice_counter (
  id int PRIMARY KEY DEFAULT 1,
  value int NOT NULL DEFAULT 0
);
INSERT INTO invoice_counter (id, value) VALUES (1, 0) ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION increment_invoice_counter()
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE next_val integer;
BEGIN
  UPDATE invoice_counter SET value = value + 1 WHERE id = 1 RETURNING value INTO next_val;
  RETURN next_val;
END;
$$;

-- Allow the anon role to call the function (matches increment_job_counter usage).
GRANT EXECUTE ON FUNCTION increment_invoice_counter() TO anon;

-- Optional: if you want invoices to start at a specific number, set the counter
-- before creating any invoices, e.g. start at INV-100:
--   UPDATE invoice_counter SET value = 99 WHERE id = 1;
