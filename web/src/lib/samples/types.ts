/** What a recipe can rely on while describing the rows of a template. */
export interface SampleContext {
  /** SQL DATE literal: the first day of the current month. Every date is generated before it. */
  anchor: string;
  /** Key value of a dimension at a 0-based index expression (wraps around the dimension's rows). */
  key(table: string, index: string): string;
  /** A key of that dimension chosen at random for a row; `base` groups rows that share the choice. */
  anyKey(table: string, salt: string, base?: string): string;
  /** How many rows a table gets. */
  rows(table: string): number;
}

/** Helper expressions of one table: each stage can use the names declared by the previous ones. */
export type Stages = readonly { readonly [name: string]: string }[];

/**
 * Hand-written part of one table. Whatever a recipe leaves out is filled by the generic generator.
 * Expressions are SQL over the row index `i`, the helpers `g` (city index) and `p` (product index)
 * and the names declared in earlier `stages`.
 */
export interface TableRecipe {
  /** Helper expressions, one stage after the other; a stage can use the names of the previous ones. */
  stages?: Stages;
  /** Column name → SQL expression. */
  columns?: Readonly<Record<string, string>>;
  /** Column name → integer expression used instead of `i` as its random seed (rows of one sale agree). */
  seedBy?: Readonly<Record<string, string>>;
}

export interface Recipe {
  /** Row count per table, overriding the defaults. */
  rows?: Readonly<Record<string, number>>;
  tables(ctx: SampleContext): Readonly<Record<string, TableRecipe>>;
}
