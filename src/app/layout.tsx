import "./globals.css";
import { Montserrat } from "next/font/google";
import type { Metadata } from "next";

const montserrat = Montserrat({ 
  subsets: ["latin"],
  display: 'swap',
});

export const metadata: Metadata = {
  title: "Äly-Nappi Arkisto",
  description: "Nappi-lehden tekoälyarkisto",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fi" className={montserrat.className}>
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}