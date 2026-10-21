import { BadRequestException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { promises as fs, constants } from 'node:fs';
import path from 'node:path';
import { DataSource } from 'typeorm';
import { AuditEventEntity, OcrModelChoice, ProjectEntity, UploadEntity, UploadRole, UsageRecordEntity } from './entities';
import { ensureProjectFolders, projectFolderName, relativeStorageKey, resolveStoredFile, uploadDir } from './storage';
import { ImageArchive, restoreArchive } from './deleted';

export function pairIdentity(name: string): { number: string; role: 'START' | 'END' } | null {
  const match = /^([ab])(\d+)\.(png|jpe?g|webp)$/i.exec(name);
  if (!match) return null;
  return { number: BigInt(match[2]!).toString(), role: match[1]!.toUpperCase() === 'A' ? 'START' : 'END' };
}

export function planPairs(names: string[]) {
  const groups = new Map<string, { START: string[]; END: string[] }>();
  const ignored: string[] = [];
  for (const name of names) {
    const identity = pairIdentity(name);
    if (!identity) { ignored.push(name); continue; }
    const group = groups.get(identity.number) ?? { START: [], END: [] };
    group[identity.role].push(name); groups.set(identity.number, group);
  }
  const pairs: Array<{ number: string; start: string; end: string }> = [];
  const pending: Array<{ number: string; reason: string }> = [];
  for (const [number, group] of [...groups].sort(([a], [b]) => BigInt(a) < BigInt(b) ? -1 : 1)) {
    if (group.START.length > 1 || group.END.length > 1) pending.push({ number, reason: 'Nomi ambigui: usa una sola A e una sola B per numero.' });
    else if (!group.START.length || !group.END.length) pending.push({ number, reason: `Manca ${group.START.length ? 'B' : 'A'}${number}` });
    else pairs.push({ number, start: group.START[0]!, end: group.END[0]! });
  }
  return { pairs, pending, ignored };
}

export interface ImportImage { filePath: string; originalName: string; role: UploadRole; mime: string; size: number }

// Shared by authenticated HTTP uploads and the local worker. Serialize per project
// so a browser upload and an inbox scan cannot create the same record twice.
export async function importRecord(
  source: DataSource, project: ProjectEntity, images: ImportImage[], note: string | null,
  queued: boolean, skipUnchanged = false, modelChoice: OcrModelChoice | null = null,
): Promise<UsageRecordEntity | null> {
  const inspected = await Promise.all(images.map(async (image) => {
    const stat = await fs.lstat(image.filePath);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size <= 0 || stat.size > Number(process.env.MAX_UPLOAD_BYTES ?? 10_485_760)) {
      throw new BadRequestException('File non valido o oltre il limite configurato');
    }
    const hash = createHash('sha256').update(await fs.readFile(image.filePath)).digest('hex');
    const after = await fs.stat(image.filePath);
    if (stat.size !== after.size || stat.mtimeMs !== after.mtimeMs) throw new BadRequestException('File ancora in scrittura: riprova al prossimo controllo.');
    return { ...image, size: stat.size, hash, fingerprint: `${stat.size}:${stat.mtimeMs}:${hash}` };
  }));
  return source.transaction(async (manager) => {
    await manager.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [project.id]);
    const currentProject = await manager.findOneBy(ProjectEntity, { id: project.id, ownerId: project.ownerId });
    if (!currentProject || currentProject.name !== project.name) throw new BadRequestException('Progetto modificato: aggiorna e riprova.');
    const matches: Array<UploadEntity | null> = [];
    for (const image of inspected) {
      const byName = await manager.getRepository(UploadEntity).createQueryBuilder('u')
        .where('u.owner_id = :owner AND u.project_id = :project', { owner: project.ownerId, project: project.id })
        .andWhere('lower(u.original_name) = lower(:name)', { name: image.originalName }).getMany();
      let exact = byName.filter((u) => u.role === image.role);
      const pair = image.role === 'SINGLE' ? null : pairIdentity(image.originalName);
      if (pair) {
        const candidates = await manager.findBy(UploadEntity, { ownerId: project.ownerId, projectId: project.id, role: image.role });
        exact = candidates.filter((candidate) => pairIdentity(candidate.originalName)?.number === pair.number);
      }
      const hashes = await manager.findBy(UploadEntity, { ownerId: project.ownerId, projectId: project.id, sha256: image.hash });
      const match = exact[0] ?? hashes.find((u) => u.role === image.role) ?? null;
      if (exact.length > 1 || (!match && hashes.length)) throw new BadRequestException('Immagine già associata a un ruolo diverso: verifica il progetto e la coppia.');
      matches.push(match);
    }
    const ids = new Set(matches.filter((u) => u !== null).map((u) => u.recordId));
    if (ids.size > 1 || (ids.size && images.length > 1 && matches.some((u) => !u))) {
      throw new BadRequestException('La coppia non corrisponde a una rilevazione esistente. Usa un nuovo numero per una nuova coppia.');
    }
    if (matches.some((u) => u?.status === 'PROCESSING')) {
      if (skipUnchanged) return null;
      throw new BadRequestException('OCR già in corso: attendi il completamento.');
    }
    if (skipUnchanged && matches.every((u, index) => u?.inboxFingerprint === inspected[index]!.fingerprint)) return null;
    const recordId = [...ids][0];
    let record = recordId ? await manager.findOneByOrFail(UsageRecordEntity, { id: recordId }) : null;
    if (!record) record = await manager.save(UsageRecordEntity, {
      ownerId: project.ownerId, projectId: project.id, modelId: null,
      mode: images.length === 1 ? 'CONSTANT' : 'SEGMENT', status: queued ? 'VALIDATING' : 'DRAFT', note,
    });
    const mode = images.length === 1 ? 'CONSTANT' : 'SEGMENT';
    if (record.mode !== mode) throw new BadRequestException('Immagine già associata a un tipo di rilevazione diverso.');
    for (let i = 0; i < inspected.length; i++) {
      const image = inspected[i]!;
      let upload = matches[i];
      // In a pending pair, do not repeatedly requeue its already archived partner.
      if (skipUnchanged && upload?.inboxFingerprint === image.fingerprint) continue;
      const values = {
        modelChoice,
        originalName: image.originalName.slice(0, 255), storageKey: relativeStorageKey(image.filePath),
        sha256: image.hash, mime: image.mime, size: image.size, inboxFingerprint: image.fingerprint,
        status: queued ? 'UPLOADED' as const : 'DRAFT' as const, reviewReason: null, processedAt: null,
      };
      if (upload) {
        const priorUpload = upload.priorUpload ?? (upload.status === 'VALIDATED' ? {
          storageKey: upload.storageKey, originalName: upload.originalName, sha256: upload.sha256,
          processedAt: upload.processedAt, status: upload.status,
        } : null);
        await manager.update(UploadEntity, upload.id, values);
        await manager.query('UPDATE uploads SET prior_upload=$2::jsonb, pending_ocr=NULL WHERE id=$1', [upload.id, JSON.stringify(priorUpload)]);
      }
      else upload = await manager.save(UploadEntity, {
        ...values, ownerId: project.ownerId, projectId: project.id, recordId: record.id, eventId: null, role: image.role,
      });
      if (image.role === 'SINGLE') record.singleUploadId = upload.id;
      else if (image.role === 'START') record.startUploadId = upload.id;
      else record.endUploadId = upload.id;
    }
    record.status = queued ? 'VALIDATING' : 'DRAFT';
    if (note !== null) record.note = note;
    await manager.save(UsageRecordEntity, record);
    await manager.insert(AuditEventEntity, {
      ownerId: project.ownerId, action: recordId ? 'OCR_REPLACEMENT_REQUESTED' : 'USAGE_RECORD_CREATED',
      entityType: 'usage_record', entityId: record.id, metadata: { mode, source: skipUnchanged ? 'project-folder' : 'browser' },
    });
    return record;
  });
}

export async function scanProjectInbox(source: DataSource, project: ProjectEntity) {
  const root = await ensureProjectFolders(project);
  const inbox = path.join(root, 'to-process');
  const entries = await fs.readdir(inbox, { withFileTypes: true });
  const names: string[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || entry.isSymbolicLink() || !pairIdentity(entry.name)) continue;
    const stat = await fs.stat(path.join(inbox, entry.name));
    if (Date.now() - stat.mtimeMs >= 1500) names.push(entry.name);
  }
  // When only one image is reinserted, reuse its accepted partner. Include
  // only numbers present in the inbox; never rescan the whole archive.
  const paths = new Map(names.map((name) => [name, path.join(inbox, name)]));
  const numbers = new Set(names.map((name) => pairIdentity(name)!.number));
  const stored = await source.getRepository(UploadEntity).findBy({ projectId: project.id });
  for (const upload of stored) {
    const identity = pairIdentity(upload.originalName);
    if (!identity || !numbers.has(identity.number)) continue;
    if (names.some((name) => {
      const incoming = pairIdentity(name)!;
      return incoming.number === identity.number && incoming.role === identity.role;
    })) continue;
    if (!upload.storageKey.includes('/processed/')) continue;
    paths.set(upload.originalName, resolveStoredFile(upload.storageKey));
  }
  const plan = planPairs([...paths.keys()]);
  let imported = 0;
  const errors: Array<{ number: string; reason: string }> = [];
  for (const pair of plan.pairs) {
    const image = (name: string, role: UploadRole): ImportImage => ({
      filePath: paths.get(name)!, originalName: name, role, size: 0,
      mime: /\.png$/i.test(name) ? 'image/png' : /\.webp$/i.test(name) ? 'image/webp' : 'image/jpeg',
    });
    try {
      const record = await importRecord(source, project, [image(pair.start, 'START'), image(pair.end, 'END')], null, true, true);
      if (record) imported++;
    } catch (error) {
      errors.push({ number: pair.number, reason: error instanceof BadRequestException ? error.message : 'Impossibile importare la coppia: verifica i file e riprova.' });
    }
  }
  return { imported, pending: [...plan.pending, ...errors], ignored: entries.filter((entry) => entry.isFile() && !pairIdentity(entry.name)).map((entry) => entry.name) };
}

export async function migrateProjectStorage(source: DataSource) {
  const legacy = process.env.LEGACY_UPLOAD_DIR ?? path.resolve('storage/uploads');
  const projects = await source.getRepository(ProjectEntity).find({ withDeleted: true });
  for (const project of projects) {
    if (project.deletedAt && !project.storageFolder) continue;
    const projectRoot = await ensureProjectFolders(project);
    // If the process stopped during a delete, the database transaction rolled
    // back. Restore its moved files before serving requests again.
    for (const entry of await fs.readdir(path.join(projectRoot, 'deleted'), { withFileTypes: true })) {
      if (!entry.isDirectory() || !/^[0-9a-f-]{36}$/i.test(entry.name)) continue;
      if (!await source.getRepository(UsageRecordEntity).findOne({ where: { id: entry.name, projectId: project.id }, withDeleted: true })) continue;
      const directory = path.join(projectRoot, 'deleted', entry.name);
      let archive: ImageArchive;
      try { archive = { directory, files: JSON.parse(await fs.readFile(path.join(directory, 'manifest.json'), 'utf8')).files }; }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error; }
      if (archive.files.some((file) => !file.storageKey.startsWith(projectFolderName(project) + '/'))) throw new Error('INVALID_ARCHIVE_PROJECT');
      await restoreArchive(archive);
    }
    const uploads = await source.getRepository(UploadEntity).findBy({ projectId: project.id });
    for (const upload of uploads) {
      const key = `${projectFolderName(project)}/${upload.status === 'VALIDATED' ? 'processed' : 'to-process'}/${upload.id}${path.extname(upload.originalName).toLowerCase()}`;
      if (upload.storageKey.includes('/processed/') || upload.storageKey.includes('/to-process/') || upload.storageKey.includes('/unprocessed/')) {
        if (upload.status === 'PROCESSING' && upload.storageKey.includes('/to-process/')) {
          const incoming = resolveStoredFile(upload.storageKey);
          const destination = path.join(projectRoot, 'processed', upload.id + path.extname(upload.originalName).toLowerCase());
          const backup = destination + '.previous';
          const exists = async (file: string) => {
            try { await fs.access(file); return true; }
            catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
          };
          if (!await exists(incoming) && await exists(destination)) await fs.rename(destination, incoming);
          if (await exists(backup) && !await exists(destination)) await fs.rename(backup, destination);
        }
        continue;
      }
      const oldPath = path.resolve(legacy, upload.storageKey);
      if (!oldPath.startsWith(path.resolve(legacy) + path.sep)) throw new Error('INVALID_LEGACY_STORAGE_KEY');
      const target = resolveStoredFile(key);
      try {
        await fs.copyFile(oldPath, target, constants.COPYFILE_EXCL);
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === 'ENOENT') continue;
        if (code !== 'EEXIST') throw error;
        const [a, b] = await Promise.all([fs.readFile(oldPath), fs.readFile(target)]);
        if (!a.equals(b)) throw new Error('STORAGE_MIGRATION_CONFLICT');
      }
      await source.getRepository(UploadEntity).update(upload.id, { storageKey: key });
      await fs.unlink(oldPath);
    }
  }
}
