import { ClerkProvider } from "@clerk/nextjs";
import type { Metadata } from "next";
import { Geist } from "next/font/google";
import { Providers } from "@/components/Providers";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "LendLoop: borrow what you need, lend what you don't",
  description: "A neighbourhood tool-lending board.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // `dynamic` renders every page per request. The CSP nonce from middleware.ts
  // is new each time, and both Next.js and Clerk need it on their <script> tags,
  // which only happens when rendering live.
  return (
    <ClerkProvider dynamic>
      <html lang="en">
        {/* Browser extensions (e.g. Grammarly) add attributes to <body> before
            React hydrates; ignore that one-level mismatch instead of warning. */}
        <body className={`${geistSans.variable} antialiased`} suppressHydrationWarning>
          <Providers>{children}</Providers>
        </body>
      </html>
    </ClerkProvider>
  );
}
