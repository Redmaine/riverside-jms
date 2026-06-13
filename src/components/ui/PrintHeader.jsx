import { C, COMPANY } from "../../lib/constants";

export function PrintHeader() {
  return (
    <div style={{ borderBottom: `3px solid ${C.navy}`, paddingBottom: 12, marginBottom: 16 }}>
      <div style={{ fontSize: 22, fontWeight: 900, color: C.navy }}>{COMPANY.name}</div>
      <div style={{ fontSize: 11, color: C.textLight, marginTop: 2 }}>{COMPANY.address}</div>
      <div style={{ fontSize: 11, color: C.textLight }}>Tel: {COMPANY.phone} | Email: {COMPANY.email}</div>
    </div>
  );
}
