/** Room for a file name in the database (dataset_files.original_name). */
const MAX_NAME = 255;
const SEPARATOR = ", ";

/**
 * The name kept for a table that came from several files: every name when they fit ("2022.txt, 2023.txt"),
 * otherwise the first one and how many more ("2022.txt + 4 arquivos").
 */
export function joinedName(names: readonly string[], max: number = MAX_NAME): string {
  const all = names.join(SEPARATOR);
  if (names.length <= 1 || all.length <= max) return all.slice(0, max);
  const more = names.length - 1;
  const tail = ` + ${more} arquivo${more === 1 ? "" : "s"}`;
  return `${names[0].slice(0, max - tail.length)}${tail}`;
}

/** The file names a stored name stands for (a single name is itself). */
export function namesIn(stored: string): string[] {
  return stored.split(SEPARATOR);
}
