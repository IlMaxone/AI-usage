import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { DataSource, IsNull } from 'typeorm';
import { AiModelEntity, AuditEventEntity, OcrFailureNotificationEntity, OcrModelChoice, UploadEntity } from './entities';
import { pairIdentity } from './inbox';
import { logOcr, OcrTrace } from './ocr-diagnostics';
import type { ModelSelectorResult } from './ocr-model';

export function failureModelOptions(notice: OcrFailureNotificationEntity, models: AiModelEntity[]) {
  if (!notice.pairNumber) return [];
  const mismatch = notice.diagnostics.flatMap((attempt) => attempt.events).filter((event) => event.code === 'PAIR_MODEL_MISMATCH').at(-1);
  if (mismatch) return models.filter((model) => [mismatch.details.modelId, mismatch.details.expectedModelId].includes(model.id));
  // Historical alerts contain explicit catalog labels, but no pass diagnostics.
  const labels = /^La coppia contiene modelli\/reasoning diversi: (.+)\. Usa screenshot/.exec(notice.reason)?.[1]?.split(' / ');
  return labels ? models.filter((model) => labels.includes(`${model.name} ${model.reasoning}`)) : [];
}

export async function saveFailureModelChoice(source: DataSource, ownerId: string, id: string, modelId: string) {
  return source.transaction(async (manager) => {
    const lock = await manager.query('SELECT pg_try_advisory_xact_lock(hashtextextended($1, 0)) AS acquired', [`ocr-retry:${ownerId}`]);
    if (!lock[0].acquired) throw new ConflictException('Preparazione OCR in corso. Attendi prima di salvare.');
    const notice = await manager.findOneBy(OcrFailureNotificationEntity, { id, ownerId, resolvedAt: IsNull() });
    if (!notice) throw new NotFoundException('Errore OCR non trovato');
    await manager.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [notice.projectId]);
    const models = await manager.findBy(AiModelEntity, { ownerId, catalogAvailable: true, supersededAt: IsNull() });
    const options = failureModelOptions(notice, models);
    if (options.length < 2 || !options.some((model) => model.id === modelId)) throw new BadRequestException('Scegli uno dei modelli riconosciuti nella coppia.');
    const uploads = await manager.getRepository(UploadEntity).createQueryBuilder('u').where('u.owner_id=:ownerId AND u.project_id=:projectId', { ownerId, projectId: notice.projectId }).setLock('pessimistic_write').getMany();
    const members = uploads.filter((upload) => (notice.recordId && upload.recordId === notice.recordId)
      || (upload.role !== 'SINGLE' && pairIdentity(upload.originalName)?.number === notice.pairNumber));
    if (members.some((upload) => ['UPLOADED', 'PROCESSING'].includes(upload.status))) throw new ConflictException('OCR già in coda o in corso. Attendi il completamento.');
    if (members.some((upload) => upload.modelId && upload.modelId !== modelId)) throw new ConflictException('La scelta non può cambiare un tag già assegnato e immutabile.');
    const modelChoice: OcrModelChoice = { modelId, observedModelIds: options.map((model) => model.id), notificationId: notice.id, chosenAt: new Date().toISOString(), source: 'USER_CHOICE' };
    await manager.update(OcrFailureNotificationEntity, notice.id, { modelChoice });
    await manager.insert(AuditEventEntity, { ownerId, action: 'OCR_PAIR_MODEL_CHOSEN', entityType: 'ocr_failure_notification', entityId: notice.id, metadata: { ...modelChoice } });
    return { modelChoice };
  });
}

// A choice resolves only a confirmed pair model mismatch. It cannot supply a
// missing OCR reading or bypass usage, reset, timestamp or immutable-tag checks.
export function applyFailureModelChoice(upload: Pick<UploadEntity, 'role' | 'modelChoice'>, selector: ModelSelectorResult, models: Array<{ id: string }>, trace: OcrTrace) {
  if (!upload.modelChoice) return selector.status === 'MATCHED' ? selector : null;
  const choice = upload.modelChoice;
  if (upload.role === 'SINGLE' || choice.source !== 'USER_CHOICE' || !choice.observedModelIds.includes(choice.modelId)
    || !models.some((model) => model.id === choice.modelId)) throw new Error('MODEL_CHOICE_UNAVAILABLE');
  if (selector.status !== 'MATCHED' || !choice.observedModelIds.includes(selector.modelId)) return null;
  logOcr(trace, 'model', 'warning', 'USER_MODEL_CHOICE_APPLIED', { modelId: choice.modelId, expectedModelId: selector.modelId });
  return { ...selector, modelId: choice.modelId };
}
