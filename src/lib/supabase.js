import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Riverside live project — unchanged from the original single-file app.
const SUPABASE_URL = "https://hzxfskdcluuluzpzevnz.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh6eGZza2RjbHV1bHV6cHpldm56Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc5ODM0NTQsImV4cCI6MjA5MzU1OTQ1NH0.D2mXA0yDZQFYBrh09kjlzV4W49f792XBqsP5TCpOo3s";

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
