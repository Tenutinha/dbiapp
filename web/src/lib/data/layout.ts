import "server-only";
import { sql } from "../db";
import type { DashboardRow, LayoutPlan, SectionRow } from "../layout/toc";

/** A "space" is the organization itself (clientId null) or one of its clients. */
export interface SpaceRef {
  orgId: string;
  clientId: string | null;
}

const clientFilter = (clientId: string | null) =>
  clientId === null ? sql`client_id IS NULL` : sql`client_id = ${clientId}`;

export interface SpaceLayout {
  sections: SectionRow[];
  dashboards: DashboardRow[];
}

export async function getSpaceLayout(space: SpaceRef): Promise<SpaceLayout> {
  const [sections, dashboards] = await Promise.all([
    sql<SectionRow[]>`
      SELECT id, title, position FROM dashboard_sections
      WHERE organization_id = ${space.orgId} AND ${clientFilter(space.clientId)}
      ORDER BY position`,
    sql<DashboardRow[]>`
      SELECT i.id, i.name, i.description, i.section_id AS "sectionId", i.position, i.template_id AS "templateId",
             (i.active_version_id IS NOT NULL) AS published, v.published_at AS "publishedAt"
      FROM dashboard_instances i
      LEFT JOIN dataset_versions v ON v.id = i.active_version_id
      WHERE i.organization_id = ${space.orgId} AND ${clientFilter(space.clientId)} AND i.archived_at IS NULL
      ORDER BY i.position, i.created_at`,
  ]);
  return { sections, dashboards };
}

/** Applies an admin's sidebar plan atomically (plan already validated by planLayout). */
export async function applyLayoutPlan(space: SpaceRef, plan: LayoutPlan): Promise<void> {
  await sql.begin(async (tx) => {
    // Serialise concurrent "organizar" saves for this organization.
    await tx`SELECT 1 FROM organizations WHERE id = ${space.orgId} FOR UPDATE`;
    const scope = space.clientId === null ? tx`client_id IS NULL` : tx`client_id = ${space.clientId}`;

    const sectionIds: string[] = [];
    for (const s of plan.sections) {
      if (s.id === null) {
        const [row] = await tx<{ id: string }[]>`
          INSERT INTO dashboard_sections (organization_id, client_id, title, position)
          VALUES (${space.orgId}, ${space.clientId}, ${s.title}, ${s.position}) RETURNING id`;
        sectionIds.push(row.id);
      } else {
        await tx`UPDATE dashboard_sections SET title = ${s.title}, position = ${s.position}
                 WHERE id = ${s.id} AND organization_id = ${space.orgId} AND ${scope}`;
        sectionIds.push(s.id);
      }
    }

    for (const p of plan.placements) {
      const sectionId = p.sectionIndex === null ? null : sectionIds[p.sectionIndex];
      await tx`UPDATE dashboard_instances SET section_id = ${sectionId}, position = ${p.position}
               WHERE id = ${p.dashboardId} AND organization_id = ${space.orgId} AND ${scope}`;
    }
    for (const r of plan.renames) {
      await tx`UPDATE dashboard_instances SET name = ${r.name}, description = ${r.description}
               WHERE id = ${r.id} AND organization_id = ${space.orgId} AND ${scope}`;
    }
    if (plan.deleteSectionIds.length > 0) {
      await tx`DELETE FROM dashboard_sections
               WHERE id IN ${tx(plan.deleteSectionIds)} AND organization_id = ${space.orgId} AND ${scope}`;
    }
  });
}
