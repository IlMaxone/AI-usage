import { buildOcrDebugReport, logOcr, makeAttempt, OcrTrace, technicalOcrError } from './ocr-diagnostics';

describe('esportazione diagnostica OCR', () => {
  const notice = { id: 'notice', originalName: 'B1.png', reason: 'Timestamp non convalidato.', files: ['A1.png', 'B1.png'],
    createdAt: new Date('2026-10-21T10:00:00Z'), pairNumber: '1', status: 'MANUAL_REVIEW', fileAvailable: true,
    project: { id: 'project', name: 'Demo', folder: 'projects/demo/unprocessed' } };
  it('elenca prima i file falliti e distingue la metà bloccata, conservando tentativi e dati numerici', () => {
    const trace: OcrTrace = [];
    logOcr(trace, 'timestamp', 'error', 'TIMESTAMP_NO_AGREEMENT', { requiredMatchingPasses: 2, capturedAt: new Date('2026-10-21T09:00:00Z') });
    const failed = makeAttempt({ id: 'b', originalName: 'B1.png', role: 'END' }, 'demo/unprocessed/b.png', 'MANUAL_REVIEW', trace, 'a'.repeat(64));
    const blocked: OcrTrace = []; logOcr(blocked, 'pair', 'error', 'PAIR_BLOCKED', { cause: 'OTHER_IMAGE_FAILED' });
    const partner = makeAttempt({ id: 'a', originalName: 'A1.png', role: 'START' }, 'demo/unprocessed/a.png', 'PAIR_BLOCKED', blocked);
    const report = buildOcrDebugReport([{ ...notice, diagnostics: [failed, partner, { ...failed, id: 'retry' }] }]);
    expect(Object.keys(report).slice(0, 2)).toEqual(['immagini_infette', 'logs_errori']);
    expect(report.immagini_infette.map((item) => [item.immagine, item.stato])).toEqual([['B1.png', 'MANUAL_REVIEW'], ['A1.png', 'PAIR_BLOCKED']]);
    expect(report.logs_errori[0]!.tentativi).toHaveLength(2);
    expect(report.logs_errori[0]!.tentativi[0]!.log[0]!.details.capturedAt).toBe('2026-10-21T09:00:00.000Z');
    expect(report.logs_errori[0]!.dettaglio_disponibile).toBe(true);
  });
  it('non esporta testo OCR, credenziali o stack e distingue i vecchi log mancanti', () => {
    const trace: OcrTrace = [];
    logOcr(trace, 'model', 'error', 'MODEL_NO_AGREEMENT', { fullOcrText: 'private conversation', password: 'secret',
      confidence: 70, catalog: [{ name: 'GPT-6 Astra', reasoning: 'high', rawText: 'private name' }] });
    const event = makeAttempt({ id: 'b', originalName: 'B1.png', role: 'END' }, '/private/home/test', 'FAILED', trace);
    const report = buildOcrDebugReport([{ ...notice, diagnostics: [event] }]);
    const json = JSON.stringify(report);
    for (const value of ['private conversation', 'secret', 'private name', '/private/home/test', 'rawText', 'password']) expect(json).not.toContain(value);
    expect(report.logs_errori[0]!.tentativi[0]!.log[0]!.details.confidence).toBe(70);
    const error = new Error('Error while reading private screenshot content and /home/user/private');
    expect(technicalOcrError(error).code).toBe('OCR_ENGINE_OR_PROCESSING_ERROR');
    const old = buildOcrDebugReport([notice]);
    expect(old.logs_errori[0]!.dettaglio_disponibile).toBe(false);
    expect(old.logs_errori[0]!.log_storico[0]!.note).toContain('non era registrato');
    expect(buildOcrDebugReport([]).immagini_infette).toEqual([]);
    const preserved = buildOcrDebugReport([{ ...notice, status: 'VALIDATED' }]);
    expect(preserved.immagini_infette[0]!.stato).toBe('MANUAL_REVIEW');
    expect(preserved.logs_errori[0]!.ultima_lettura_valida_conservata).toBe(true);
  });
});
