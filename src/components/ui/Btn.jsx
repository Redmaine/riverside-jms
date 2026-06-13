import { C } from "../../lib/constants";

export function Btn({ children, onClick, color, outline, small, danger, disabled, style: s }) {
  const bg = disabled ? C.silverLight : danger ? C.danger : outline ? "transparent" : (color || C.accent);
  const col = outline ? (danger ? C.danger : (color || C.accent)) : C.white;
  const bdr = danger ? C.danger : outline ? (color || C.accent) : "transparent";
  return (
    <button onClick={onClick} disabled={disabled} style={{
      background: bg, color: col, border: `2px solid ${bdr}`,
      borderRadius: 6, padding: small ? "5px 12px" : "8px 18px", fontSize: small ? 12 : 14,
      fontWeight: 600, cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.6 : 1, ...s
    }}>{children}</button>
  );
}
