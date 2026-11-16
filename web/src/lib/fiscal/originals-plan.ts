/**
 * Which raw SPED files of a folder on this machine still have to go to the storage, where the originals are
 * kept as a backup. Pure: the preparing script lists both sides and does the sending.
 *
 * The storage keeps one file per company and period. This plan only ever adds: a period already stored with
 * another content is reported, never replaced — which version is the valid one is a person's call.
 */
import type { SpedRecord } from "./sped";

/** A raw file found on this machine, already identified by its 0000 record. */
export interface LocalOriginal {
  path: string;
  cnpj: string;
  /** "YYYY-MM". */
  periodo: string;
  sizeBytes: number;
  /** When the file was last written here (ms). */
  modifiedAt: number;
  /** A retificadora (EFD) or a substituta (ECD): it replaces the original of the period. */
  correcting: boolean;
}

export interface StoredOriginal {
  key: string;
  cnpj: string;
  periodo: string;
  sizeBytes: number;
}

export interface OriginalsPlan {
  /** Periods the storage does not have: the file to send. */
  upload: LocalOriginal[];
  /** Periods whose stored file has the size of a local one. */
  inSync: number;
  /** Periods sent although the folder has more than one candidate of the same kind (the newest one went). */
  ambiguous: { chosen: LocalOriginal; others: LocalOriginal[] }[];
  /** Periods whose stored file is a version the folder has, but not the one that stands for the period (e.g. the original, with a retificadora here): left alone. */
  outdated: { stored: StoredOriginal; preferred: LocalOriginal }[];
  /** Periods stored with a content this folder does not have: left alone. */
  conflicts: { cnpj: string; periodo: string; local: LocalOriginal[]; stored: StoredOriginal[] }[];
  /** Stored periods this folder has no file for. */
  onlyStored: StoredOriginal[];
}

/** Whether a file corrects an earlier one of the same period, by its 0000 record. */
export function isCorrecting(templateId: string, first: SpedRecord | undefined): boolean {
  if (!first) return false;
  // EFD ICMS/IPI: COD_FIN; EFD Contribuições: TIPO_ESCRIT; ECD: IND_FIN_ESC (1 = substituta).
  if (templateId === "ecd") return first[13] === "1";
  return first[2] === "1";
}

/** The file that stands for its period: a correcting one before an original, then the newest. */
export function preferred(candidates: readonly LocalOriginal[]): LocalOriginal {
  return [...candidates].sort((a, b) => Number(b.correcting) - Number(a.correcting) || b.modifiedAt - a.modifiedAt)[0];
}

const place = (f: { cnpj: string; periodo: string }): string => `${f.cnpj}/${f.periodo}`;

function group<T extends { cnpj: string; periodo: string }>(items: readonly T[]): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const item of items) out.set(place(item), [...(out.get(place(item)) ?? []), item]);
  return out;
}

export function planOriginals(local: readonly LocalOriginal[], stored: readonly StoredOriginal[]): OriginalsPlan {
  const here = group(local);
  const there = group(stored);
  const plan: OriginalsPlan = { upload: [], inSync: 0, ambiguous: [], outdated: [], conflicts: [], onlyStored: [] };
  for (const [key, candidates] of [...here].sort(([a], [b]) => a.localeCompare(b))) {
    const kept = there.get(key);
    if (!kept) {
      const chosen = preferred(candidates);
      plan.upload.push(chosen);
      const rivals = candidates.filter((c) => c !== chosen && c.correcting === chosen.correcting);
      if (rivals.length > 0) plan.ambiguous.push({ chosen, others: rivals });
      continue;
    }
    const best = preferred(candidates);
    const same = kept.find((s) => candidates.some((c) => c.sizeBytes === s.sizeBytes));
    if (same && same.sizeBytes !== best.sizeBytes) plan.outdated.push({ stored: same, preferred: best });
    else if (same) plan.inSync += 1;
    else plan.conflicts.push({ cnpj: candidates[0].cnpj, periodo: candidates[0].periodo, local: candidates, stored: kept });
  }
  for (const [key, kept] of there) if (!here.has(key)) plan.onlyStored.push(...kept);
  return plan;
}
