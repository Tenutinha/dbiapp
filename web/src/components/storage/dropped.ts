/**
 * Files dropped from the computer, including whole folders (read through the File System entries API),
 * each with the sub-folder it came from so the structure can be recreated in the storage.
 */

export interface DroppedFile {
  file: File;
  /** Sub-folder relative to where it was dropped ("" for loose files; "notas/julho" for a dropped folder). */
  dir: string;
}

/** Internal drags (moving items inside the explorer) carry this type instead of files. */
export const INTERNAL_DRAG = "application/x-dbi-paths";

export function hasExternalFiles(dt: DataTransfer): boolean {
  return dt.types.includes("Files") && !dt.types.includes(INTERNAL_DRAG);
}

function readAll(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
  return new Promise((resolve, reject) => {
    const out: FileSystemEntry[] = [];
    const next = (): void =>
      reader.readEntries((batch) => {
        if (batch.length === 0) resolve(out);
        else {
          out.push(...batch);
          next();
        }
      }, reject);
    next();
  });
}

async function walk(entry: FileSystemEntry, dir: string, out: DroppedFile[]): Promise<void> {
  if (entry.isFile) {
    const file = await new Promise<File>((resolve, reject) => (entry as FileSystemFileEntry).file(resolve, reject));
    out.push({ file, dir });
    return;
  }
  if (entry.isDirectory) {
    const sub = dir ? `${dir}/${entry.name}` : entry.name;
    for (const child of await readAll((entry as FileSystemDirectoryEntry).createReader())) await walk(child, sub, out);
  }
}

/** Every file of a drop (folders expanded). Must be called synchronously inside the drop handler's tick. */
export async function droppedFiles(dt: DataTransfer): Promise<DroppedFile[]> {
  // Entries must be taken before the first await: the DataTransfer is emptied after the event.
  const entries = [...dt.items].map((i) => (i.kind === "file" ? i.webkitGetAsEntry() : null));
  const loose = [...dt.files];
  if (entries.every((e) => e === null)) return loose.map((file) => ({ file, dir: "" }));
  const out: DroppedFile[] = [];
  for (const entry of entries) if (entry) await walk(entry, "", out);
  return out;
}
