import type { Metadata } from "next";
import { Inter, JetBrains_Mono, Newsreader } from "next/font/google";
import { DevUserSwitcher } from "@/components/DevUserSwitcher";
import { ElementInspector } from "@/components/dev/ElementInspector";
import { defaultUiTheme, themeBootScript } from "@/lib/theme/ui-theme";
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
    // The boot script sets data-theme before React hydrates, hence suppressHydrationWarning on <html>.
    <html lang="pt-BR" className={`${inter.variable} ${mono.variable} ${serif.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootScript(defaultUiTheme(process.env.NODE_ENV, process.env.DBI_TEMA_PADRAO)) }} />
      </head>
      <body className="min-h-screen antialiased">
        {children}
        <DevUserSwitcher />
        <ElementInspector />
      </body>
    </html>
  );
}
