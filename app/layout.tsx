import type { Metadata } from "next";

import "./globals.css";
import { Navigation } from "@/ui/navigation";

export const metadata: Metadata = {
  title: "Rank Local Growth OS",
  description: "Evidence-backed local growth operations.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body><Navigation />{children}</body>
    </html>
  );
}
