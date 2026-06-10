import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";

export const metadata: Metadata = {
  title: "Exclusion Flag — Claims Decision Support",
  description:
    "Flags possible policy exclusions for a diagnosis, with clause citations. Decision support only.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${GeistSans.variable} ${GeistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col font-sans">
        <div className="flex-1 pb-14">{children}</div>
        <footer className="fixed inset-x-0 bottom-0 z-50 border-t bg-card/95 backdrop-blur">
          <p className="mx-auto max-w-7xl px-6 py-3 text-center text-xs text-muted-foreground">
            Decision support only — final assessment is made by a qualified
            assessor.
          </p>
        </footer>
      </body>
    </html>
  );
}
