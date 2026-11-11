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
  size?: "xs" | "sm" | "md" | "lg" | "xl";
  /** The person's uploaded picture; without it, the initials on their colour. */
  imageUrl?: string | null;
  /** Tooltip text (defaults to the name). */
  title?: string;
  className?: string;
}

const SIZE = { xs: "size-5 text-[8px]", sm: "size-7 text-[10px]", md: "size-9 text-xs", lg: "size-10 text-sm", xl: "size-20 text-2xl" } as const;

/** Round avatar: the person's picture when they uploaded one, otherwise their initials. */
export function Avatar({ name, email, size = "sm", imageUrl, title, className = "" }: AvatarProps) {
  const dim = SIZE[size];
  if (imageUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={imageUrl}
        alt={title ?? name}
        title={title ?? name}
        className={`inline-block shrink-0 rounded-full object-cover ring-2 ring-card ${dim} ${className}`}
      />
    );
  }
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
