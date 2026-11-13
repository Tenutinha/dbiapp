/**
 * Thin bar sliding along the top edge of a card while its numbers are on their way: the skeleton says
 * "something goes here", the bar says "and it is coming". The card must be `relative`.
 */
export function CardProgress() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-x-4 top-0 h-[2px] overflow-hidden rounded-full">
      <div className="dbi-card-progress h-full w-1/3 rounded-full" />
    </div>
  );
}
