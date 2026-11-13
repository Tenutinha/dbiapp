import "server-only";
import { sql } from "../db";

/**
 * SQL condition: the dashboard `i` (alias of dashboard_instances) is built on a template restricted to
 * the platform administrator (template field `access`, see permissions.ts → canSeeDashboard).
 */
export const restrictedInstance = () => sql`EXISTS (
  SELECT 1 FROM dashboard_templates rt WHERE rt.id = i.template_id AND rt.definition ->> 'access' = 'platformAdmin')`;

/** SQL condition that keeps only the dashboards this viewer may see (everything for the platform administrator). */
export const visibleToViewer = (platformAdmin: boolean) => (platformAdmin ? sql`TRUE` : sql`NOT ${restrictedInstance()}`);
