/** Initials ("Ana Souza" → "AS"); falls back to the e-mail's first letter. */
export function initials(name: string, email = ""): string {
  const parts = name.trim().split(/\s+/).filter((p) => /^[\p{L}\p{N}]/u.test(p));
  const letters = parts.length >= 2 ? parts[0][0] + parts[parts.length - 1][0] : (parts[0] ?? email).slice(0, 2);
  return letters.toUpperCase() || "?";
}

/** Stable hue per person, so the same user always gets the same colour. */
export function avatarHue(key: string): number {
  let h = 0;
  for (const ch of key) h = (h * 31 + ch.codePointAt(0)!) % 360;
  return h;
}

interface AvatarProps {
  name: string;
  email: string;
  size?: "sm" | "md";
  /** Tooltip text (defaults to the name). */
  title?: string;
  className?: string;
}

/** Round avatar with the person's initials (no photos are stored yet). */
export function Avatar({ name, email, size = "sm", title, className = "" }: AvatarProps) {
  const dim = size === "sm" ? "size-7 text-[10px]" : "size-9 text-xs";
  return (
    <span
      title={title ?? name}
      aria-label={title ?? name}
      role="img"
      style={{ backgroundColor: `hsl(${avatarHue(email || name)} 55% 45%)` }}
      className={`inline-grid shrink-0 select-none place-items-center rounded-full font-semibold text-white ring-2 ring-card ${dim} ${className}`}
    >
      {initials(name, email)}
    </span>
  );
}
