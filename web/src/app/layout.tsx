import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono, Newsreader } from "next/font/google";
import { DevUserSwitcher } from "@/components/DevUserSwitcher";
import { ElementInspector } from "@/components/dev/ElementInspector";
import { NavigationProgress } from "@/components/NavigationProgress";
import { UploadCenterProvider } from "@/components/storage/UploadCenter";
import { Suspense } from "react";
import { APP_BACKGROUND, APP_DESCRIPTION, APP_NAME } from "@/lib/pwa";
import { defaultUiTheme, themeBootScript } from "@/lib/theme/ui-theme";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });
const mono = JetBrains_Mono({ variable: "--font-jetbrains", subsets: ["latin"] });
const serif = Newsreader({ variable: "--font-newsreader", subsets: ["latin"], weight: ["400", "500"] });

export const metadata: Metadata = {
  title: { default: APP_NAME, template: `%s · ${APP_NAME}` },
  description: APP_DESCRIPTION,
  applicationName: APP_NAME,
  // iPhone/iPad: opens full screen from the home screen (the manifest covers Android and desktop).
  appleWebApp: { capable: true, title: APP_NAME, statusBarStyle: "default" },
};

export const viewport: Viewport = { themeColor: APP_BACKGROUND };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    // The boot script sets data-theme before React hydrates, hence suppressHydrationWarning on <html>.
    <html lang="pt-BR" className={`${inter.variable} ${mono.variable} ${serif.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootScript(defaultUiTheme(process.env.NODE_ENV, process.env.DBI_TEMA_PADRAO)) }} />
      </head>
      <body className="min-h-screen antialiased">
        {/* Uploads keep going (and stay visible) across pages and modals. */}
        <UploadCenterProvider>{children}</UploadCenterProvider>
        {/* Feedback while a clicked link loads (useSearchParams needs its own Suspense boundary). */}
        <Suspense>
          <NavigationProgress />
        </Suspense>
        <DevUserSwitcher />
        <ElementInspector />
      </body>
    </html>
  );
}
