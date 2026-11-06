import type { Metadata } from "next";
import { Inter, JetBrains_Mono, Newsreader } from "next/font/google";
import { DevUserSwitcher } from "@/components/DevUserSwitcher";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });
const mono = JetBrains_Mono({ variable: "--font-jetbrains", subsets: ["latin"] });
const serif = Newsreader({ variable: "--font-newsreader", subsets: ["latin"], weight: ["400", "500"] });

export const metadata: Metadata = {
  title: { default: "DBI", template: "%s · DBI" },
  description: "Dashboards prontos — é só engatar os seus dados.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR" className={`${inter.variable} ${mono.variable} ${serif.variable}`}>
      <body className="min-h-screen antialiased">
        {children}
        <DevUserSwitcher />
      </body>
    </html>
  );
}
