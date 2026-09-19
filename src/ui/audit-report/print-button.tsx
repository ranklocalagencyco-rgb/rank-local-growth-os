"use client";

import { useEffect } from "react";

// The report's only client code: opens the browser's print dialog (Print / Save as PDF). Collapsed <details> do not print, so the
// score breakdown is opened for printing and put back afterwards.
export function PrintButton() {
  useEffect(() => {
    const opened: HTMLDetailsElement[] = [];
    const before = () => {
      document.querySelectorAll<HTMLDetailsElement>(".audit-report details:not([open])").forEach((element) => {
        element.open = true;
        opened.push(element);
      });
    };
    const after = () => {
      while (opened.length > 0) {
        const element = opened.pop();
        if (element) element.open = false;
      }
    };
    window.addEventListener("beforeprint", before);
    window.addEventListener("afterprint", after);
    return () => {
      window.removeEventListener("beforeprint", before);
      window.removeEventListener("afterprint", after);
    };
  }, []);
  return <button type="button" className="ar-button" onClick={() => window.print()}>Print / Save as PDF</button>;
}
