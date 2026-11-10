/**
 * Section to land on after another dashboard opens. Opening goes through a server action whose redirect
 * keeps the address of the space, so the wish is kept here for the next screen. Storage may be
 * unavailable (private mode): the dashboard then simply opens at its top.
 */
const PENDING_KEY = "dbi:ir-para-analise";

export function rememberJump(anchor: string): void {
  try {
    window.sessionStorage.setItem(PENDING_KEY, anchor);
  } catch {
    // not kept: the dashboard opens at its top
  }
}

/** The section asked for, if it belongs to the dashboard now on screen (then forgotten). */
export function takeJump(anchors: readonly string[]): string | null {
  try {
    const anchor = window.sessionStorage.getItem(PENDING_KEY);
    if (anchor === null || !anchors.includes(anchor)) return null;
    window.sessionStorage.removeItem(PENDING_KEY);
    return anchor;
  } catch {
    return null;
  }
}

/** Marks that the next dashboard to open was reached going back: it opens at its end, not at its top. */
const END_KEY = "dbi:abrir-no-fim";

export function rememberLandAtEnd(): void {
  try {
    window.sessionStorage.setItem(END_KEY, "1");
  } catch {
    // not kept: the dashboard opens at its top
  }
}

/** Whether the dashboard now on screen should open at its end (then forgotten). */
export function takeLandAtEnd(): boolean {
  try {
    const wanted = window.sessionStorage.getItem(END_KEY) === "1";
    window.sessionStorage.removeItem(END_KEY);
    return wanted;
  } catch {
    return false;
  }
}
