import { useState, useEffect, useCallback } from "react";
import { C } from "../../lib/constants";
import { supabase } from "../../lib/supabase";
import { todayStr } from "../../lib/utils";
import { Btn } from "../ui/Btn";

function MonthlyHours({ emp, bankHolidays }) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [entries, setEntries] = useState({});
  const [hourlyRate, setHourlyRate] = useState(emp.hourly_rate || "");
  const [saving, setSaving] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [adjustmentHours, setAdjustmentHours] = useState("");
  const [adjustmentNote, setAdjustmentNote] = useState("");

  const monthKey = `${year}-${String(month + 1).padStart(2, "0")}`;

  useEffect(() => {
    const loadMonth = async () => {
      try {
        const { data } = await supabase.from("hr_monthly_hours")
          .select("*").eq("employee_id", emp.id).eq("month_key", monthKey).single();
        if (data) {
          setEntries(data.entries || {});
          setAdjustmentHours(data.adjustment_hours ? String(data.adjustment_hours) : "");
          setAdjustmentNote(data.adjustment_note || "");
        } else {
          setEntries({});
          setAdjustmentHours("");
          setAdjustmentNote("");
        }
      } catch { setEntries({}); setAdjustmentHours(""); setAdjustmentNote(""); }
    };
    loadMonth();
  }, [emp.id, monthKey]);

  const prevMonth = () => {
    if (month === 0) { setMonth(11); setYear(y => y - 1); }
    else setMonth(m => m - 1);
  };
  const nextMonth = () => {
    if (month === 11) { setMonth(0); setYear(y => y + 1); }
    else setMonth(m => m + 1);
  };

  const getDays = () => {
    const days = [];
    const d = new Date(year, month, 1);
    while (d.getMonth() === month) {
      const dow = d.getDay();
      if (dow !== 0) { days.push(new Date(d)); }
      d.setDate(d.getDate() + 1);
    }
    return days;
  };

  const days = getDays();
  const bankHolDates = new Set(bankHolidays.map(h => h.date));

  const getLeaveType = (dateStr) => {
    for (const l of (emp.leave || [])) {
      if (dateStr >= l.from && dateStr <= l.to) return l.type;
    }
    return null;
  };

  const calcHours = (start, finish) => {
    if (!start || !finish) return 0;
    const [sh, sm] = start.split(":").map(Number);
    const [fh, fm] = finish.split(":").map(Number);
    const totalMins = (fh * 60 + fm) - (sh * 60 + sm) - 30;
    return Math.max(0, totalMins / 60);
  };

  const updateEntry = (dateStr, field, val) => {
    const updated = { ...entries, [dateStr]: { ...(entries[dateStr] || {}), [field]: val } };
    setEntries(updated);
  };

  const saveMonth = async () => {
    setSaving(true);
    try {
      await supabase.from("hr_monthly_hours").upsert({
        employee_id: emp.id,
        month_key: monthKey,
        entries,
        adjustment_hours: parseFloat(adjustmentHours) || 0,
        adjustment_note: adjustmentNote
      }, { onConflict: "employee_id,month_key" });
    } catch (e) { console.error("Save failed", e); }
    setTimeout(() => setSaving(false), 800);
  };

  const totalHours = days.reduce((sum, d) => {
    const ds = d.toISOString().split("T")[0];
    const e = entries[ds];
    if (!e?.start || !e?.finish) return sum;
    return sum + calcHours(e.start, e.finish);
  }, 0);

  const rate = parseFloat(hourlyRate) || 0;
  const adjustment = parseFloat(adjustmentHours) || 0;
  const adjustedTotal = totalHours + adjustment;
  const totalPay = adjustedTotal * rate;
  const monthName = new Date(year, month, 1).toLocaleDateString("en-GB", { month: "long", year: "numeric" });

  const emailAccountant = () => {
    const lines = days.map(d => {
      const ds = d.toISOString().split("T")[0];
      const dayName = d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
      const isBH = bankHolDates.has(ds);
      const leave = getLeaveType(ds);
      const e = entries[ds];
      if (isBH) return `${dayName}: Bank Holiday`;
      if (leave) return `${dayName}: ${leave}`;
      if (!e?.start || !e?.finish) return `${dayName}: No entry`;
      const hrs = calcHours(e.start, e.finish);
      return `${dayName}: ${e.start}–${e.finish} = ${hrs.toFixed(2)} hrs`;
    }).join("\n");
    const body = `Monthly Hours — ${emp.name} — ${monthName}\n\nHourly Rate: £${rate.toFixed(2)}\n\n${lines}\n\nHOURS TOTAL: ${totalHours.toFixed(2)}${adjustment !== 0 ? `\nADJUSTMENT: ${adjustment > 0 ? "+" : ""}${adjustment.toFixed(2)} hrs${adjustmentNote ? ` (${adjustmentNote})` : ""}\nADJUSTED TOTAL: ${adjustedTotal.toFixed(2)} hrs` : ""}\nTOTAL PAY: £${totalPay.toFixed(2)}`;
    const mailto = `mailto:karen@mmsaccountants.co.uk?subject=Monthly Hours - ${emp.name} - ${monthName}&body=${encodeURIComponent(body)}`;
    window.open(mailto);
  };

  const inp = { padding: "5px 8px", border: `1px solid ${C.border}`, borderRadius: 4, fontSize: 12 };

  if (!expanded) {
    return (
      <div style={{ marginTop: 10, borderTop: `1px solid ${C.border}`, paddingTop: 10 }}>
        <button onClick={() => setExpanded(true)} style={{ background: "none", border: "none", color: C.accent, cursor: "pointer", fontSize: 13, fontWeight: 600 }}>
          ▼ Monthly Hours
        </button>
      </div>
    );
  }

  return (
    <div style={{ marginTop: 10, borderTop: `1px solid ${C.border}`, paddingTop: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <button onClick={() => setExpanded(false)} style={{ background: "none", border: "none", color: C.accent, cursor: "pointer", fontSize: 13, fontWeight: 600 }}>
          ▲ Monthly Hours
        </button>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button onClick={prevMonth} style={{ background: C.navy, color: C.white, border: "none", borderRadius: 4, padding: "4px 10px", cursor: "pointer", fontSize: 14 }}>◀</button>
          <span style={{ fontSize: 13, fontWeight: 700, color: C.navy, minWidth: 130, textAlign: "center" }}>{monthName}</span>
          <button onClick={nextMonth} style={{ background: C.navy, color: C.white, border: "none", borderRadius: 4, padding: "4px 10px", cursor: "pointer", fontSize: 14 }}>▶</button>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <label style={{ fontSize: 12, color: C.textLight }}>Rate: £</label>
          <input value={hourlyRate} onChange={e => setHourlyRate(e.target.value)} type="number" step="0.01" placeholder="0.00"
            style={{ ...inp, width: 70 }} />
          <span style={{ fontSize: 12, color: C.textLight }}>/hr</span>
        </div>
      </div>

      {/* Adjustment panel */}
      <div style={{ background: adjustment > 0 ? "#e8f5e9" : adjustment < 0 ? "#fff0f0" : C.silverLighter, border: `1px solid ${adjustment > 0 ? C.success : adjustment < 0 ? C.danger : C.border}`, borderRadius: 6, padding: "10px 14px", marginBottom: 14 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: C.textLight, marginBottom: 8, letterSpacing: 0.5 }}>HOURS ADJUSTMENT (previous month correction)</div>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <button onClick={() => setAdjustmentHours(v => String((parseFloat(v) || 0) - 0.5))}
              style={{ background: C.danger, color: C.white, border: "none", borderRadius: 4, padding: "4px 10px", cursor: "pointer", fontSize: 16, fontWeight: 700, lineHeight: 1 }}>−</button>
            <input
              value={adjustmentHours}
              onChange={e => setAdjustmentHours(e.target.value)}
              type="number"
              step="0.5"
              placeholder="0.00"
              style={{ ...inp, width: 70, textAlign: "center", fontWeight: 700, color: adjustment > 0 ? C.success : adjustment < 0 ? C.danger : C.text }}
            />
            <button onClick={() => setAdjustmentHours(v => String((parseFloat(v) || 0) + 0.5))}
              style={{ background: C.success, color: C.white, border: "none", borderRadius: 4, padding: "4px 10px", cursor: "pointer", fontSize: 16, fontWeight: 700, lineHeight: 1 }}>+</button>
            <span style={{ fontSize: 12, color: C.textLight }}>hrs</span>
          </div>
          <input
            value={adjustmentNote}
            onChange={e => setAdjustmentNote(e.target.value)}
            placeholder="Reason (e.g. extra day worked in Jan)…"
            style={{ ...inp, flex: 1, minWidth: 180 }}
          />
          {adjustment !== 0 && (
            <button onClick={() => { setAdjustmentHours(""); setAdjustmentNote(""); }}
              style={{ background: "none", border: "none", color: C.textLight, cursor: "pointer", fontSize: 18, lineHeight: 1 }}>×</button>
          )}
        </div>
        {adjustment !== 0 && (
          <div style={{ marginTop: 8, fontSize: 12, color: adjustment > 0 ? C.success : C.danger, fontWeight: 600 }}>
            {adjustment > 0 ? `+${adjustment.toFixed(2)}` : adjustment.toFixed(2)} hrs adjustment · Adjusted total: {adjustedTotal.toFixed(2)} hrs · Pay: £{totalPay.toFixed(2)}
          </div>
        )}
      </div>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, marginBottom: 12 }}>
        <thead>
          <tr style={{ background: C.navy, color: C.white }}>
            <th style={{ padding: "6px 8px", textAlign: "left" }}>Day</th>
            <th style={{ padding: "6px 8px", textAlign: "center", width: 80 }}>Start</th>
            <th style={{ padding: "6px 8px", textAlign: "center", width: 80 }}>Finish</th>
            <th style={{ padding: "6px 8px", textAlign: "center", width: 70 }}>Hours</th>
            <th style={{ padding: "6px 8px", textAlign: "right", width: 80 }}>Pay</th>
          </tr>
        </thead>
        <tbody>
          {days.map((d, i) => {
            const ds = d.toISOString().split("T")[0];
            const isBH = bankHolDates.has(ds);
            const leave = getLeaveType(ds);
            const isSat = d.getDay() === 6;
            const e = entries[ds] || {};
            const hrs = calcHours(e.start, e.finish);
            const pay = hrs * rate;
            const dayLabel = d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
            let rowBg = i % 2 === 0 ? C.white : C.silverLighter;
            let statusCell = null;
            if (isBH) {
              rowBg = "#fff8e1";
              statusCell = <td colSpan={3} style={{ padding: "6px 8px", textAlign: "center", color: "#b8860b", fontStyle: "italic" }}>Bank Holiday</td>;
            } else if (leave) {
              rowBg = leave === "Holiday" ? "#e8f5e9" : "#fff0f0";
              statusCell = <td colSpan={3} style={{ padding: "6px 8px", textAlign: "center", color: leave === "Holiday" ? C.success : C.danger, fontStyle: "italic" }}>{leave}</td>;
            }
            return (
              <tr key={ds} style={{ background: rowBg }}>
                <td style={{ padding: "5px 8px", fontWeight: isSat ? 700 : 400, color: isSat ? C.accent : C.text }}>
                  {dayLabel}{isSat ? " (OT)" : ""}
                </td>
                {statusCell || (
                  <>
                    <td style={{ padding: "4px 6px" }}>
                      <input type="time" value={e.start || ""} onChange={ev => updateEntry(ds, "start", ev.target.value)} style={{ ...inp, width: "100%" }} />
                    </td>
                    <td style={{ padding: "4px 6px" }}>
                      <input type="time" value={e.finish || ""} onChange={ev => updateEntry(ds, "finish", ev.target.value)} style={{ ...inp, width: "100%" }} />
                    </td>
                    <td style={{ padding: "6px 8px", textAlign: "center", fontWeight: 600, color: hrs > 0 ? C.navy : C.textLight }}>
                      {hrs > 0 ? hrs.toFixed(2) : "—"}
                    </td>
                  </>
                )}
                {!statusCell && (
                  <td style={{ padding: "6px 8px", textAlign: "right", color: pay > 0 ? C.success : C.textLight }}>
                    {pay > 0 ? `£${pay.toFixed(2)}` : "—"}
                  </td>
                )}
                {statusCell && <td style={{ padding: "6px 8px" }}></td>}
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          {adjustment !== 0 && (
            <tr style={{ background: adjustment > 0 ? "#e8f5e9" : "#fff0f0", fontWeight: 600 }}>
              <td colSpan={3} style={{ padding: "6px 10px", textAlign: "right", fontSize: 12, color: C.textLight }}>
                Recorded hours subtotal
              </td>
              <td style={{ padding: "6px 10px", textAlign: "center", fontSize: 12 }}>{totalHours.toFixed(2)} hrs</td>
              <td style={{ padding: "6px 10px", textAlign: "right", fontSize: 12 }}>£{(totalHours * rate).toFixed(2)}</td>
            </tr>
          )}
          {adjustment !== 0 && (
            <tr style={{ background: adjustment > 0 ? "#e8f5e9" : "#fff0f0", fontWeight: 600 }}>
              <td colSpan={3} style={{ padding: "6px 10px", textAlign: "right", fontSize: 12, color: adjustment > 0 ? C.success : C.danger }}>
                Adjustment{adjustmentNote ? `: ${adjustmentNote}` : ""}
              </td>
              <td style={{ padding: "6px 10px", textAlign: "center", fontSize: 12, color: adjustment > 0 ? C.success : C.danger }}>
                {adjustment > 0 ? "+" : ""}{adjustment.toFixed(2)} hrs
              </td>
              <td style={{ padding: "6px 10px", textAlign: "right", fontSize: 12, color: adjustment > 0 ? C.success : C.danger }}>
                {adjustment > 0 ? "+" : ""}£{(adjustment * rate).toFixed(2)}
              </td>
            </tr>
          )}
          <tr style={{ background: C.navy, color: C.white, fontWeight: 700 }}>
            <td colSpan={3} style={{ padding: "8px 10px", textAlign: "right" }}>TOTALS</td>
            <td style={{ padding: "8px 10px", textAlign: "center" }}>{adjustedTotal.toFixed(2)} hrs</td>
            <td style={{ padding: "8px 10px", textAlign: "right" }}>£{totalPay.toFixed(2)}</td>
          </tr>
        </tfoot>
      </table>
      <div style={{ display: "flex", gap: 10 }}>
        <Btn small onClick={saveMonth} disabled={saving}>{saving ? "Saved ✓" : "💾 Save Month"}</Btn>
        <Btn small outline onClick={emailAccountant}>✉ Email to Accountant</Btn>
      </div>
    </div>
  );
}

export function HRModule({ toast }) {
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: "", title: "", startDate: todayStr(), hourly_rate: "" });
  const [leaveForm, setLeaveForm] = useState(null);
  const [bankHolidays, setBankHolidays] = useState([]);
  const [showBankHols, setShowBankHols] = useState(false);
  const HOLIDAY_ALLOWANCE = 20;

  const loadEmployees = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.from("hr_employees").select("*").order("name");
    if (!error) setEmployees(data || []);
    setLoading(false);
  }, []);

  useEffect(() => { loadEmployees(); }, [loadEmployees]);

  const holidayYearStart = () => {
    const now = new Date();
    const yr = now.getMonth() >= 10 ? now.getFullYear() : now.getFullYear() - 1;
    return new Date(yr, 10, 1);
  };

  const holidayYearEnd = () => {
    const start = holidayYearStart();
    return new Date(start.getFullYear() + 1, 10, 0);
  };

  useEffect(() => {
    fetch("https://www.gov.uk/bank-holidays.json")
      .then(r => r.json())
      .then(data => {
        const yrStart = holidayYearStart();
        const yrEnd = holidayYearEnd();
        const hols = (data["england-and-wales"]?.events || [])
          .filter(e => { const d = new Date(e.date); return d >= yrStart && d <= yrEnd; })
          .sort((a, b) => new Date(a.date) - new Date(b.date));
        setBankHolidays(hols);
      })
      .catch(() => {});
  }, []);

  const bhDates = new Set(bankHolidays.map(h => h.date));

  const workingDays = (from, to, excludeBankHols = false) => {
    if (!from || !to) return 0;
    let count = 0;
    const cur = new Date(from);
    const end = new Date(to);
    while (cur <= end) {
      const dow = cur.getDay();
      const ds = cur.toISOString().split("T")[0];
      if (dow !== 0 && dow !== 6) {
        if (!(excludeBankHols && bhDates.has(ds))) count++;
      }
      cur.setDate(cur.getDate() + 1);
    }
    return count;
  };

  const bankHolsInRange = (from, to) => {
    if (!from || !to) return 0;
    let count = 0;
    const cur = new Date(from);
    const end = new Date(to);
    while (cur <= end) {
      const dow = cur.getDay();
      const ds = cur.toISOString().split("T")[0];
      if (dow !== 0 && dow !== 6 && bhDates.has(ds)) count++;
      cur.setDate(cur.getDate() + 1);
    }
    return count;
  };

  const holidayTaken = (emp) => {
    const yrStart = holidayYearStart();
    return (emp.leave || []).filter(l => l.type === "Holiday" && new Date(l.from) >= yrStart)
      .reduce((s, l) => s + workingDays(l.from, l.to, true), 0);
  };

  const bankHolsTaken = (emp) => {
    const yrStart = holidayYearStart();
    return (emp.leave || []).filter(l => l.type === "Holiday" && new Date(l.from) >= yrStart)
      .reduce((s, l) => s + bankHolsInRange(l.from, l.to), 0);
  };

  const sickDays = (emp) => (emp.leave || []).filter(l => l.type === "Sickness")
    .reduce((s, l) => s + workingDays(l.from, l.to, false), 0);

  const addEmployee = async () => {
    if (!form.name.trim()) return;
    const payload = { name: form.name.trim(), title: form.title, start_date: form.startDate || null, hourly_rate: parseFloat(form.hourly_rate) || null, leave: [] };
    const { error } = await supabase.from("hr_employees").insert(payload);
    if (error) { toast("Failed to add employee", "error"); return; }
    setForm({ name: "", title: "", startDate: todayStr(), hourly_rate: "" });
    setShowForm(false);
    toast("Employee added");
    loadEmployees();
  };

  const addLeave = async () => {
    if (!leaveForm || !leaveForm.from || !leaveForm.to) return;
    const emp = employees.find(e => e.id === leaveForm.empId);
    if (!emp) return;
    const updatedLeave = [...(emp.leave || []), { id: Date.now().toString(), type: leaveForm.type, from: leaveForm.from, to: leaveForm.to }];
    const { error } = await supabase.from("hr_employees").update({ leave: updatedLeave }).eq("id", leaveForm.empId);
    if (error) { toast("Failed to save leave", "error"); return; }
    setLeaveForm(null);
    toast("Leave recorded");
    loadEmployees();
  };

  const delLeave = async (empId, leaveId) => {
    const emp = employees.find(e => e.id === empId);
    if (!emp) return;
    const updatedLeave = (emp.leave || []).filter(l => l.id !== leaveId);
    const { error } = await supabase.from("hr_employees").update({ leave: updatedLeave }).eq("id", empId);
    if (!error) loadEmployees();
  };

  const delEmployee = async (id) => {
    if (!window.confirm("Remove employee? This will also delete all their hours records.")) return;
    await supabase.from("hr_employees").delete().eq("id", id);
    toast("Employee removed");
    loadEmployees();
  };

  const inp = { padding: "7px 10px", border: `1px solid ${C.border}`, borderRadius: 4, fontSize: 13 };

  if (loading) return <div style={{ padding: 40, textAlign: "center", color: C.textLight }}>Loading HR data…</div>;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <div style={{ fontSize: 20, fontWeight: 800, color: C.navy }}>HR — Holiday &amp; Sickness</div>
        <Btn onClick={() => setShowForm(true)}>+ Add Employee</Btn>
      </div>
      <div style={{ fontSize: 12, color: C.textLight, marginBottom: 16 }}>
        Holiday year: 1 Nov – 31 Oct | Personal allowance: {HOLIDAY_ALLOWANCE} days | Bank holidays: separate (see below) | Sickness: unpaid
      </div>

      <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 8, padding: 14, marginBottom: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: C.navy }}>
            🏦 UK Bank Holidays {holidayYearStart().getFullYear()}/{holidayYearEnd().getFullYear()} — {bankHolidays.length} days
          </div>
          <button onClick={() => setShowBankHols(!showBankHols)} style={{ background: "none", border: `1px solid ${C.border}`, borderRadius: 4, padding: "3px 10px", cursor: "pointer", fontSize: 12, color: C.textLight }}>
            {showBankHols ? "Hide" : "Show"}
          </button>
        </div>
        {showBankHols && (
          <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 6 }}>
            {bankHolidays.length === 0 && <div style={{ fontSize: 13, color: C.textLight }}>Loading bank holidays…</div>}
            {bankHolidays.map((h, i) => {
              const d = new Date(h.date);
              const isPast = d < new Date();
              return (
                <div key={i} style={{ display: "flex", gap: 10, alignItems: "center", padding: "5px 10px", background: isPast ? C.silverLighter : "#e8f5e9", borderRadius: 4, fontSize: 12 }}>
                  <span style={{ fontSize: 14 }}>{isPast ? "✓" : "📅"}</span>
                  <span style={{ flex: 1, color: isPast ? C.textLight : C.text, textDecoration: isPast ? "line-through" : "none" }}>{h.title}</span>
                  <span style={{ color: C.textLight, fontWeight: 600 }}>{d.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {showForm && (
        <div style={{ background: C.silverLighter, borderRadius: 8, padding: 16, marginBottom: 20 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 130px 100px", gap: 10, marginBottom: 10 }}>
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, color: C.textLight, display: "block", marginBottom: 4 }}>Full Name</label>
              <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} style={{ ...inp, width: "100%", boxSizing: "border-box" }} />
            </div>
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, color: C.textLight, display: "block", marginBottom: 4 }}>Job Title</label>
              <input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} style={{ ...inp, width: "100%", boxSizing: "border-box" }} />
            </div>
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, color: C.textLight, display: "block", marginBottom: 4 }}>Start Date</label>
              <input type="date" value={form.startDate} onChange={e => setForm(f => ({ ...f, startDate: e.target.value }))} style={inp} />
            </div>
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, color: C.textLight, display: "block", marginBottom: 4 }}>Hourly Rate £</label>
              <input type="number" step="0.01" value={form.hourly_rate} onChange={e => setForm(f => ({ ...f, hourly_rate: e.target.value }))} style={{ ...inp, width: "100%", boxSizing: "border-box" }} placeholder="0.00" />
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <Btn onClick={addEmployee}>Save Employee</Btn>
            <Btn outline onClick={() => setShowForm(false)}>Cancel</Btn>
          </div>
        </div>
      )}

      {leaveForm && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ background: C.white, borderRadius: 10, padding: 24, maxWidth: 380, width: "90%" }}>
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 14 }}>Add Leave — {employees.find(e => e.id === leaveForm.empId)?.name}</div>
            <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
              {["Holiday", "Sickness"].map(t => (
                <button key={t} onClick={() => setLeaveForm(f => ({ ...f, type: t }))} style={{
                  padding: "6px 14px", border: `2px solid ${leaveForm.type === t ? C.navy : C.border}`,
                  borderRadius: 6, background: leaveForm.type === t ? C.navy : "transparent",
                  color: leaveForm.type === t ? C.white : C.text, cursor: "pointer", fontSize: 13, fontWeight: 600
                }}>{t === "Holiday" ? "🌴" : "🤒"} {t}</button>
              ))}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: C.textLight, display: "block", marginBottom: 4 }}>From</label>
                <input type="date" value={leaveForm.from || ""} onChange={e => setLeaveForm(f => ({ ...f, from: e.target.value }))} style={inp} />
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: C.textLight, display: "block", marginBottom: 4 }}>To</label>
                <input type="date" value={leaveForm.to || ""} onChange={e => setLeaveForm(f => ({ ...f, to: e.target.value }))} style={inp} />
              </div>
            </div>
            {leaveForm.from && leaveForm.to && (
              <div style={{ fontSize: 13, color: C.textLight, marginBottom: 12 }}>Working days: <strong>{workingDays(leaveForm.from, leaveForm.to)}</strong></div>
            )}
            <div style={{ display: "flex", gap: 10 }}>
              <Btn onClick={addLeave}>Save Leave</Btn>
              <Btn outline onClick={() => setLeaveForm(null)}>Cancel</Btn>
            </div>
          </div>
        </div>
      )}

      {employees.length === 0 && (
        <div style={{ textAlign: "center", padding: 40, color: C.textLight }}>No employees added yet. Click + Add Employee to start.</div>
      )}

      {employees.map(emp => {
        const taken = holidayTaken(emp);
        const bhTaken = bankHolsTaken(emp);
        const remaining = HOLIDAY_ALLOWANCE - taken;
        const sick = sickDays(emp);
        const pct = Math.min(100, (taken / HOLIDAY_ALLOWANCE) * 100);
        const BANK_HOL_ALLOWANCE = 8;
        return (
          <div key={emp.id} style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 8, padding: 18, marginBottom: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
              <div>
                <div style={{ fontSize: 16, fontWeight: 800, color: C.navy }}>{emp.name}</div>
                <div style={{ fontSize: 13, color: C.textLight }}>
                  {emp.title}{emp.start_date ? ` · Started ${new Date(emp.start_date).toLocaleDateString("en-GB")}` : ""}
                  {emp.hourly_rate ? ` · £${parseFloat(emp.hourly_rate).toFixed(2)}/hr` : ""}
                </div>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <Btn small onClick={() => setLeaveForm({ empId: emp.id, type: "Holiday", from: todayStr(), to: todayStr() })}>+ Add Leave</Btn>
                <Btn small danger onClick={() => delEmployee(emp.id)}>Remove</Btn>
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginBottom: 10 }}>
              <div style={{ background: C.silverLighter, borderRadius: 6, padding: "10px 14px" }}>
                <div style={{ fontSize: 11, color: C.textLight, fontWeight: 600 }}>HOLIDAY TAKEN</div>
                <div style={{ fontSize: 22, fontWeight: 900, color: C.navy }}>{taken}</div>
                <div style={{ fontSize: 11, color: C.textLight }}>of {HOLIDAY_ALLOWANCE} days</div>
              </div>
              <div style={{ background: remaining <= 3 ? "#fff0f0" : "#e8f5e9", borderRadius: 6, padding: "10px 14px" }}>
                <div style={{ fontSize: 11, color: C.textLight, fontWeight: 600 }}>REMAINING</div>
                <div style={{ fontSize: 22, fontWeight: 900, color: remaining <= 3 ? C.danger : C.success }}>{remaining}</div>
                <div style={{ fontSize: 11, color: C.textLight }}>days left</div>
              </div>
              <div style={{ background: C.silverLighter, borderRadius: 6, padding: "10px 14px" }}>
                <div style={{ fontSize: 11, color: C.textLight, fontWeight: 600 }}>BANK HOLS USED</div>
                <div style={{ fontSize: 22, fontWeight: 900, color: bhTaken >= BANK_HOL_ALLOWANCE ? C.danger : C.navy }}>{bhTaken}</div>
                <div style={{ fontSize: 11, color: C.textLight }}>of {BANK_HOL_ALLOWANCE} days</div>
              </div>
              <div style={{ background: sick >= 5 ? "#fff0f0" : C.silverLighter, borderRadius: 6, padding: "10px 14px" }}>
                <div style={{ fontSize: 11, color: C.textLight, fontWeight: 600 }}>SICK DAYS</div>
                <div style={{ fontSize: 22, fontWeight: 900, color: sick >= 5 ? C.danger : C.navy }}>{sick}</div>
                <div style={{ fontSize: 11, color: C.textLight }}>total (unpaid)</div>
              </div>
            </div>
            <div style={{ background: "#eee", borderRadius: 4, height: 8, marginBottom: 10, overflow: "hidden" }}>
              <div style={{ background: pct > 85 ? C.danger : C.accent, width: `${pct}%`, height: "100%", borderRadius: 4 }}></div>
            </div>
            {(emp.leave || []).length > 0 && (
              <div style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: C.textLight, marginBottom: 6 }}>LEAVE HISTORY</div>
                {[...(emp.leave || [])].sort((a, b) => new Date(b.from) - new Date(a.from)).map(l => {
                  const bh = l.type === "Holiday" ? bankHolsInRange(l.from, l.to) : 0;
                  const days = workingDays(l.from, l.to, l.type === "Holiday");
                  return (
                    <div key={l.id} style={{ display: "flex", gap: 10, alignItems: "center", padding: "5px 10px", background: l.type === "Holiday" ? "#e8f5e9" : "#fff0f0", borderRadius: 4, marginBottom: 3, fontSize: 12 }}>
                      <span>{l.type === "Holiday" ? "🌴" : "🤒"}</span>
                      <span style={{ flex: 1 }}>{l.type}: {new Date(l.from).toLocaleDateString("en-GB")} – {new Date(l.to).toLocaleDateString("en-GB")}</span>
                      <span style={{ color: C.textLight }}>
                        {days} day{days !== 1 ? "s" : ""}
                        {bh > 0 && <span style={{ color: "#b8860b", marginLeft: 6 }}>+ {bh} bank hol{bh !== 1 ? "s" : ""}</span>}
                      </span>
                      <button onClick={() => delLeave(emp.id, l.id)} style={{ background: "none", border: "none", color: C.danger, cursor: "pointer", fontSize: 16 }}>×</button>
                    </div>
                  );
                })}
              </div>
            )}
            <MonthlyHours emp={emp} bankHolidays={bankHolidays} />
          </div>
        );
      })}
    </div>
  );
}
