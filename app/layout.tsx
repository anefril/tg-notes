import "./globals.css";
import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { ThemeProvider } from "@/components/layout/theme-provider";
import { AuthProvider } from "@/contexts/auth-context";
import { TagColorsProvider } from "@/contexts/tag-colors-context";
import { AuthGate } from "@/components/auth/auth-gate";
import { ConfirmProvider } from "@/components/ui/confirm-provider";
import { Toaster } from "@/components/ui/sonner";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "TG Notes",
  description: "Notes from Telegram",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={inter.className}>
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <AuthProvider>
            <TagColorsProvider>
              <ConfirmProvider>
                <AuthGate>{children}</AuthGate>
              </ConfirmProvider>
            </TagColorsProvider>
          </AuthProvider>
          <Toaster position="bottom-right" richColors />
        </ThemeProvider>
      </body>
    </html>
  );
}
