import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Universos IA",
  description: "Historias originales en ocho clips con audio nativo.",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
