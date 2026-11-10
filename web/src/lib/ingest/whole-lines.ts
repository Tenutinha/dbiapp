const NEWLINE = 0x0a;

/**
 * The first bytes of a text file cut after its last complete line, so the piece can be read as a file of
 * its own. Null when there are not at least two lines (a header and one row) in it.
 */
export function wholeLines(head: Uint8Array): Uint8Array | null {
  const end = head.lastIndexOf(NEWLINE);
  if (end <= 0 || head.indexOf(NEWLINE) === end) return null;
  return head.subarray(0, end + 1);
}
