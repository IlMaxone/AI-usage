import { randomUUID } from 'node:crypto';

export interface OcrLogEvent {
  at: string; stage: string; level: 'info' | 'warning' | 'error'; code: string; details: Record<string, unknown>;
}
export interface OcrAttemptDiagnostic {
  id: string; recordedAt: string; originalName: string; uploadId: string; role: string;
  status: string; sha256: string | null; storageKey: string; events: OcrLogEvent[];
  fileAvailable?: boolean;
}
export type OcrTrace = OcrLogEvent[];
const keys = new Set(['pass', 'confidence', 'width', 'height', 'format', 'sha256', 'capturedAt',
  'fiveHourRemainingPct', 'fiveHourUsedPct', 'fiveHourResetsAt', 'weeklyRemainingPct', 'weeklyUsedPct', 'weeklyResetsOn',
  'modelId', 'modelName', 'reasoning', 'fast', 'expectedModelId', 'matchingPasses', 'validPasses',
  'requiredMatchingPasses', 'catalogCount', 'catalog', 'key', 'name', 'status', 'resetOffsetMinutes',
  'fileMoved', 'fileAvailable', 'cause', 'errorName', 'frames', 'region', 'left', 'top']);
function safeDetails(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(safeDetails);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([key]) => keys.has(key)).map(([key, item]) => [key, safeDetails(item)]));
  return typeof value === 'number' ? (Number.isFinite(value) ? value : null)
    : typeof value === 'string' ? value.slice(0, 500) : typeof value === 'boolean' || value === null ? value : null;
}
export function logOcr(trace: OcrTrace | undefined, stage: string, level: OcrLogEvent['level'], code: string, details: Record<string, unknown> = {}) {
  trace?.push({ at: new Date().toISOString(), stage, level, code, details: safeDetails(details) as Record<string, unknown> });
}
export function sanitizeEvents(events: OcrTrace): OcrTrace {
  return events.map((event) => ({ at: event.at, stage: event.stage, level: event.level, code: event.code, details: safeDetails(event.details) as Record<string, unknown> }));
}
export class OcrDiagnosticError extends Error {
  constructor(readonly original: unknown, readonly events: OcrTrace) { super('OCR_PROCESSING_EXCEPTION'); }
}
export function technicalOcrError(error: unknown) {
  const original = error instanceof OcrDiagnosticError ? error.original : error;
  const item = original as { code?: string; message?: string; name?: string; stack?: string } | null;
  const known = item?.code ?? item?.message ?? '';
  const code = /^(?:[A-Z][A-Z0-9_]{2,79}|\d{5})$/.test(known) ? known : 'OCR_ENGINE_OR_PROCESSING_ERROR';
  const frames = [...(item?.stack ?? '').matchAll(/\/app\/dist\/[a-z0-9_/-]+\.js:\d+:\d+/gi)].map((match) => match[0]);
  return { code, errorName: /^[A-Za-z]+Error$/.test(item?.name ?? '') ? item!.name : 'Error', frames };
}
export function makeAttempt(upload: { id: string; originalName: string; role: string; sha256?: string | null }, storageKey: string, status: string, events: OcrTrace, sha256?: string) : OcrAttemptDiagnostic {
  return { id: randomUUID(), recordedAt: new Date().toISOString(), originalName: upload.originalName, uploadId: upload.id,
    role: upload.role, status, sha256: sha256 ?? upload.sha256 ?? null, storageKey, events: sanitizeEvents(events) };
}

interface DebugNotice {
  modelChoice?: unknown;
  id: string; originalName: string; reason: string; files: string[]; createdAt: Date | string; pairNumber: string | null;
  status: string; fileAvailable: boolean; diagnostics?: OcrAttemptDiagnostic[];
  project: { id: string; name: string; folder: string } | null;
}
export function buildOcrDebugReport(notifications: DebugNotice[]) {
  const logs = notifications.flatMap((notice) => {
    const attempts = notice.diagnostics ?? [];
    const names = [...new Set(attempts.length ? attempts.map((attempt) => attempt.originalName) : [notice.originalName])];
    return names.map((name) => {
      const history = attempts.filter((attempt) => attempt.originalName === name);
      const latest = history.at(-1);
      const detailed = history.some((attempt) => attempt.events.some((event) => !['LEGACY_FAILURE', 'FAILURE_PINNED', 'FAILURE_RECORDED'].includes(event.code)));
      return { immagine: name, progetto: notice.project?.name ?? 'Progetto non disponibile', progetto_id: notice.project?.id ?? null,
        scelta_modello_utente: notice.modelChoice ?? null,
        notifica_id: notice.id, coppia: notice.pairNumber, immagini_associate: notice.files,
        stato: latest?.status ?? (notice.status === 'VALIDATED' ? 'MANUAL_REVIEW' : notice.status), motivo: notice.reason,
        stato_rilevazione_attuale: notice.status, ultima_lettura_valida_conservata: notice.status === 'VALIDATED',
        cartella: notice.project?.folder ?? null, file_disponibile: latest?.fileAvailable ?? notice.fileAvailable,
        sha256: latest?.sha256 ?? null, dettaglio_disponibile: detailed,
        tentativi: history.map((attempt) => ({ id: attempt.id, data: attempt.recordedAt, ruolo: attempt.role,
          stato: attempt.status, sha256: attempt.sha256, log: sanitizeEvents(attempt.events) })),
        log_storico: detailed ? [] : [{ at: new Date(notice.createdAt).toISOString(), stage: 'legacy', level: 'error', code: 'HISTORICAL_FAILURE',
          message: notice.reason, note: 'Il dettaglio dei passaggi non era registrato. Disponibile dopo una nuova elaborazione.' }],
      };
    });
  });
  // Property order is intentional: failed images come first in the JSON file.
  return {
    immagini_infette: logs.map((item) => ({ immagine: item.immagine, progetto: item.progetto, progetto_id: item.progetto_id, notifica_id: item.notifica_id, stato: item.stato })),
    logs_errori: logs,
    metadata: { formato: 'ai-usage-error-logs', versione: 1, esportato_il: new Date().toISOString(), numero_immagini: logs.length,
      significato_immagini_infette: 'Immagini non convalidate o bloccate dalla coppia OCR.', testo_ocr_completo_incluso: false,
      ambiente: { node: process.version, timezone: process.env.TZ ?? 'Europe/Rome' } },
  };
}
