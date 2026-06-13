export function StatusBadge({ s }) {
  const map = {
    "Quote": { bg: "#f0e6cc", col: "#8a5e00" },
    "In Production": { bg: "#cce5cc", col: "#1a6b1a" },
    "Part Despatched": { bg: "#cce0f5", col: "#1a4a8a" },
    "Fully Despatched": { bg: "#e0ccf5", col: "#5a1a8a" },
    "Ready to Invoice": { bg: "#ffd6cc", col: "#8a2000" },
    "Invoiced": { bg: "#ddd", col: "#444" },
    "Needs Review": { bg: "#ffd6cc", col: "#8a2000" },
  };
  const m = map[s] || { bg: "#eee", col: "#333" };
  return <span style={{ background: m.bg, color: m.col, borderRadius: 12, padding: "3px 10px", fontSize: 12, fontWeight: 700 }}>{s}</span>;
}
