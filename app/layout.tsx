import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Item Key",
  description: "Понятное пространство для проектов, материалов и заметок",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru" className="h-full">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
