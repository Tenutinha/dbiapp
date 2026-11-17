/**
 * Marks a strip of visuals side by side inside one analysis (its "row" layout). The header's scrollbar drives
 * the one on screen, and marks it with HEADER_DRIVEN_ATTR while it does, so the native bar under it can go.
 * Plain constants (no "use client"): the strip is drawn on the server.
 */
export const CARD_STRIP_ATTR = "data-card-strip";
export const HEADER_DRIVEN_ATTR = "data-header-scrollbar";
