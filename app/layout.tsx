import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Vernier Caliper Simulator",
  description: "Interactive 2D and 3D Vernier caliper simulation",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
