import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Retirement Protection Lab",
  description: "An interactive retirement strategy lab with validated market models, classroom scenarios, and a sequence-risk demonstration.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
