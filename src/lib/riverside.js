// Riverside is single-tenant. The YCA modules expect an account_id + an
// accounts row; we give them one fixed id. The matching SQL creates an accounts
// row with this id and a single-tenant current_account_id() that returns it, so
// every YCA `account_id = current_account_id()` RLS policy just works.
export const RIVERSIDE_ACCOUNT_ID = "a1f5c3e2-0000-4000-8000-000000000001";
export const RIVERSIDE_ACCOUNT_NAME = "Riverside Sheetmetal Fabrications Ltd";
