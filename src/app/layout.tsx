import type { Metadata } from "next";
import "./globals.css"; // Tämä on ainoa Tailwind-viittaus, joka täällä saa olla

export const metadata: Metadata = {
  title: "Äly-Nappi Arkisto",
  description: "Nappi-lehden tekoälyarkisto",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="fi">
      <body>{children}</body>
    </html>
  );
}