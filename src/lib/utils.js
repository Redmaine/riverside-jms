// Shared helpers — verbatim from the original app.
export const fmt = (n) => `£${(Number(n) || 0).toFixed(2)}`;
export const lineTotal = (lines) => (lines || []).reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.price) || 0), 0);
export const todayStr = () => new Date().toISOString().split("T")[0];
export const addDays = (d, n) => { const dt = new Date(d); dt.setDate(dt.getDate() + n); return dt.toISOString().split("T")[0]; };

// Render description text as plain text — strip common markdown symbols.
export const stripMarkdown = (s) => String(s || "")
  .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
  .replace(/[*_`~#>]/g, "")
  .replace(/\s+/g, " ")
  .trim();
