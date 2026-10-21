import { applyFailureModelChoice, failureModelOptions } from './ocr-model-choice';
import { AiModelEntity, OcrFailureNotificationEntity, OcrModelChoice } from './entities';
import { OcrTrace } from './ocr-diagnostics';

const choice: OcrModelChoice = { source: 'USER_CHOICE', modelId: 'sol', observedModelIds: ['sol', 'astra'], notificationId: 'notice', chosenAt: '2026-10-21T10:00:00Z' };
const models = [{ id: 'sol', name: 'GPT-5.6 Sol', reasoning: 'high' }, { id: 'astra', name: 'GPT-6 Astra', reasoning: 'high' }] as AiModelEntity[];
describe('scelta manuale nei conflitti di modello della coppia', () => {
  it('conserva la lettura OCR originale nei log mentre attribuisce il modello scelto', () => {
    const trace: OcrTrace = [];
    expect(applyFailureModelChoice({ role: 'END', modelChoice: choice }, { status: 'MATCHED', modelId: 'astra', flash: false, matchingPasses: ['one', 'two'] }, models, trace)?.modelId).toBe('sol');
    expect(trace[0]?.details).toEqual({ modelId: 'sol', expectedModelId: 'astra' });
  });
  it('non inventa letture, non accetta un terzo modello e non si applica ai singoli', () => {
    expect(applyFailureModelChoice({ role: 'END', modelChoice: choice }, { status: 'UNREADABLE' }, models, [])).toBeNull();
    expect(applyFailureModelChoice({ role: 'END', modelChoice: choice }, { status: 'MATCHED', modelId: 'other', flash: false, matchingPasses: ['one', 'two'] }, models, [])).toBeNull();
    expect(() => applyFailureModelChoice({ role: 'SINGLE', modelChoice: choice }, { status: 'UNREADABLE' }, models, [])).toThrow('MODEL_CHOICE_UNAVAILABLE');
  });
  it('offre solo i modelli del conflitto e riconosce anche il messaggio storico esplicito', () => {
    const notice = { pairNumber: '1', diagnostics: [], reason: 'La coppia contiene modelli/reasoning diversi: GPT-5.6 Sol high / GPT-6 Astra high. Usa screenshot della stessa sessione e dello stesso modello.' } as unknown as OcrFailureNotificationEntity;
    expect(failureModelOptions(notice, models).map((model) => model.id)).toEqual(['sol', 'astra']);
    expect(failureModelOptions({ ...notice, reason: 'Reset settimanale non leggibile' }, models)).toEqual([]);
    expect(failureModelOptions({ ...notice, pairNumber: null }, models)).toEqual([]);
  });
});
