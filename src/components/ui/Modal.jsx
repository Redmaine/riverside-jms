import { useEffect } from "react";
import { C } from "../../lib/constants";

export function Modal({ children, onClose, wide }) {
  useEffect(() => {
    const handler = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);
  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)",
      zIndex: 3000, overflowY: "auto", padding: "32px 16px"
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: C.white, borderRadius: 10, margin: "0 auto",
        width: "100%", maxWidth: wide ? 900 : 680, padding: 28,
        boxShadow: "0 8px 40px rgba(0,0,0,0.25)"
      }}>
        {children}
      </div>
    </div>
  );
}
