import type { Metadata } from "next";
import { Manrope } from "next/font/google";

import I18nProvider from "@/components/i18n-provider";
import { getServerLocale } from "@/lib/i18n-server";
import "./globals.css";

const manrope = Manrope({
  variable: "--font-manrope",
  subsets: ["latin", "cyrillic"],
});

export const metadata: Metadata = {
  title: "Item Key",
  description: "3D workspace for nested categories and notes",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await getServerLocale();

  return (
    <html
      lang={locale}
      className={`${manrope.variable} h-full`}
    >
      <body className="min-h-full flex flex-col">
        <I18nProvider initialLocale={locale}>{children}</I18nProvider>
      </body>
    </html>
  );
}
