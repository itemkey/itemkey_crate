import type { Metadata } from "next";
import { Manrope } from "next/font/google";
import "./globals.css";

const modernMain = Manrope({
  variable: "--font-main",
  subsets: ["latin", "cyrillic"],
  weight: ["400", "500", "600", "700"],
});

const modernDisplay = Manrope({
  variable: "--font-display",
  subsets: ["latin", "cyrillic"],
  weight: ["600", "700", "800"],
});

export const metadata: Metadata = {
  title: "Item Key",
  description: "3D workspace for nested categories and notes",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="ru"
      className={`${modernMain.variable} ${modernDisplay.variable} h-full`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
