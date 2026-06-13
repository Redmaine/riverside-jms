import { useState } from "react";
import { C } from "../../lib/constants";
import { fmt, lineTotal, stripMarkdown } from "../../lib/utils";
import { StatusBadge } from "../ui/StatusBadge";

export function JobListCard({ j, onJobClick }) {
  const [expanded, setExpanded] = useState(false);
  const isOverdue = j.due_date && j.status !== "Invoiced" && new Date(j.due_date) < new Date();
  const lines = j.lines || [];
  return (
    <div className="rv-job-card" onClick={() => onJobClick(j)} style={{ border: `1px solid ${isOverdue ? C.warning : C.border}` }}>
      <div className="rv-job-head">
        <div className="rv-job-meta">
          <strong style={{ color: C.accent }}>{j.job_ref}</strong>
          <span style={{ fontWeight: 600 }}>{j.customer_name}</span>
          {j.po_number && <span style={{ fontSize: 12, color: C.textLight }}>PO: {j.po_number}</span>}
          {j.due_date && <span style={{ fontSize: 12, color: isOverdue ? C.danger : C.textLight }}>Due: {new Date(j.due_date).toLocaleDateString("en-GB")}</span>}
        </div>
        <div className="rv-job-right">
          <StatusBadge s={j.status} />
          <span style={{ fontWeight: 700 }}>{fmt(lineTotal(j.lines))}</span>
        </div>
      </div>
      {lines.length > 0 && (
        <>
          <div className={"rv-job-desc" + (expanded ? " expanded" : "")}>
            {lines.map((l, i) => (
              <div key={i} style={{ fontSize: 12, color: C.textLight }}>
                {l.despatched ? <span style={{ color: C.success }}>✓ </span> : "• "}
                {stripMarkdown(l.desc)} × {l.qty}
                {l.despatched && l.despatchDate ? <span style={{ fontSize: 11, marginLeft: 6 }}>({new Date(l.despatchDate).toLocaleDateString("en-GB")})</span> : null}
              </div>
            ))}
          </div>
          {lines.length > 2 && (
            <button className="rv-showmore" style={{ color: C.accent }} onClick={(e) => { e.stopPropagation(); setExpanded((v) => !v); }}>
              {expanded ? "Show less" : "Show more"}
            </button>
          )}
        </>
      )}
    </div>
  );
}
