import { themeCssVars, type Theme } from "@/lib/theme/theme";

interface ThemeScopeProps {
  theme: Theme;
  className?: string;
  children: React.ReactNode;
}

/**
 * Applies a space's theme to everything inside it via CSS custom properties.
 * Values come from themeCssVars (validated hex only), so inline styles are safe.
 */
export function ThemeScope({ theme, className = "", children }: ThemeScopeProps) {
  const style = { ...themeCssVars(theme), colorScheme: theme.appearance } as React.CSSProperties;
  return (
    <div style={style} className={`min-h-screen bg-bg text-text ${className}`}>
      {children}
    </div>
  );
}

/** Space logo; the image is decorative next to the space name, which is always rendered as text too. */
export function SpaceLogo({ url, className = "" }: { url: string | null; className?: string }) {
  if (!url) return null;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={url} alt="" className={`object-contain object-left ${className}`} />;
}
