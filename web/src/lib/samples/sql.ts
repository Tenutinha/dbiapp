/**
 * Small SQL builders for deterministic sample data. Every expression is evaluated per row of
 * `range(n) t(i)`; randomness is a hash of the row index plus a salt, so the same template always
 * yields the same rows. Nothing here takes user input: the strings come from this codebase.
 */

export const lit = (value: string): string => `'${value.replace(/'/g, "''")}'`;

const PRIME = 1000003;

/** Uniform number in [0, 1) derived from `base` (an SQL integer expression) and a salt. */
export const uBy = (base: string, salt: string): string => `((hash(${base}, ${lit(salt)}) % ${PRIME}) / ${PRIME}.0)`;

/** Uniform number in [0, 1) for the current row. */
export const u = (salt: string): string => uBy("i", salt);

/** Integer in [0, n) from a uniform expression; `power` > 1 concentrates on the first values. */
export const indexOf = (uniform: string, n: number, power = 1): string =>
  `CAST(floor(pow(${uniform}, ${power}) * ${n}) AS BIGINT)`;

/** The value at a 0-based index expression (wraps around the list). */
export const pickAt = (values: readonly string[], index: string): string =>
  `list_extract([${values.map(lit).join(", ")}], CAST(1 + ((${index}) % ${values.length}) AS INTEGER))`;

/** A random value of the list, uniform. */
export const pick = (values: readonly string[], salt: string): string => pickAt(values, indexOf(u(salt), values.length));

/** One of the SQL expressions, by weight (weights need not add up to 1). */
export function weighted(options: readonly (readonly [expr: string, weight: number])[], uniform: string): string {
  const total = options.reduce((sum, [, w]) => sum + w, 0);
  const steps = options.reduce<{ acc: number; parts: string[] }>(
    (state, [expr, w], idx) => {
      const acc = state.acc + w / total;
      const part = idx === options.length - 1 ? `ELSE ${expr}` : `WHEN ${uniform} < ${acc.toFixed(6)} THEN ${expr}`;
      return { acc, parts: [...state.parts, part] };
    },
    { acc: 0, parts: [] },
  );
  return options.length === 1 ? options[0][0] : `CASE ${steps.parts.join(" ")} END`;
}

/** A number between `lo` and `hi`; `power` > 1 makes small values more common. */
export const between = (lo: number, hi: number, uniform: string, power = 1): string =>
  `(${lo} + pow(${uniform}, ${power}) * ${hi - lo})`;

export const money = (expr: string): string => `round(CAST(${expr} AS DOUBLE), 2)`;

/** `anchor` minus a number of days (integer SQL expression). */
export const daysBefore = (anchor: string, days: string): string => `(${anchor} - CAST(${days} AS INTEGER))`;
