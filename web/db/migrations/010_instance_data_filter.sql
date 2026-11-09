-- Data filter of a dashboard: which rows of its fact table it keeps before anything is shown
-- (e.g. only cargo = 'Presidente'). A JSON list of {column, op: "in" | "not_in", values[]},
-- validated by the app against the fact table's contract (src/lib/query/fact-filter.ts).
-- Empty list = every row. Applies to the viewing screen, shared links and on-screen filter options.
ALTER TABLE dashboard_instances ADD COLUMN IF NOT EXISTS data_filter jsonb NOT NULL DEFAULT '[]'::jsonb;
