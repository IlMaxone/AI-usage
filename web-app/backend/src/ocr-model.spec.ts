import { modelSelectorFailure, parseModelLabel } from './ocr-model';

const models = [
  { id: 'sol-high', name: 'GPT-5.6 Sol', reasoning: 'high' },
  { id: 'sol-xhigh', name: 'GPT-5.6 Sol', reasoning: 'xhigh' },
  { id: 'astra', name: 'GPT-6 Astra', reasoning: 'high' },
  { id: 'sol61', name: 'GPT-6.1 Sol', reasoning: 'high' },
];
describe('modello e reasoning dallo screenshot', () => {
  it('legge le etichette italiane e le separazioni OCR', () => {
    expect(parseModelLabel('GPT - 5.6 Sol Alto', models)).toBe('sol-high');
    expect(parseModelLabel('GPT-6 Astra High', models)).toBe('astra');
    expect(parseModelLabel('GPT-5.6 Sol Molto alto', models)).toBe('sol-xhigh');
  });
  it('riconosce etichette compatte e 6/6.0 senza confondere versioni', () => {
    expect(parseModelLabel('5.6 Sol Alto', models)).toBe('sol-high');
    expect(parseModelLabel('6 Astra Alto', models)).toBe('astra');
    expect(parseModelLabel('GPT-6.0 Astra High', models)).toBe('astra');
    expect(parseModelLabel('6.0 Astra Alto', models)).toBe('astra');
    expect(parseModelLabel('6.1 Sol Alto', models)).toBe('sol61');
    expect(parseModelLabel('GPT-6.1 Sol High', models)).toBe('sol61');
    expect(parseModelLabel('6 Astra Alto', [{ id: 'six', name: 'GPT-6.0 Astra', reasoning: 'high' }])).toBe('six');
  });
  it('non forza reasoning assenti né interpreta versioni diverse come alias', () => {
    for (const label of ['5.6 Sol Medio', '5.6 Sol Light', '6 Astra Light', '56 Sol Alto', '6.1 Astra Alto', '6.0 Sol Alto', '16.1 Sol Alto', '1.5.6 Sol Alto']) {
      expect(parseModelLabel(label, models)).toBeNull();
    }
    expect(parseModelLabel('6.0 Astra Alto', [...models, { id: 'ambiguous-six', name: 'GPT-6.0 Astra', reasoning: 'high' }])).toBeNull();
    expect(parseModelLabel('5.6 Sol Light', [{ ...models[0]!, id: 'light', reasoning: 'light' }])).toBe('light');
    expect(parseModelLabel('5.6 Sol Light', [{ ...models[0]!, id: 'low', reasoning: 'low' }])).toBe('low');
    expect(parseModelLabel('6 Astra Low', [{ ...models[2]!, id: 'light', reasoning: 'light' }])).toBe('light');
  });
  it('non usa un modello predefinito né confonde versioni o reasoning', () => {
    expect(parseModelLabel('GPT-5.6 Sol', models)).toBeNull();
    expect(parseModelLabel('GPT-6.1 Astra Alto', models)).toBeNull();
    expect(parseModelLabel('GPT-6 Astra Basso', models)).toBeNull();
    expect(parseModelLabel('GPT-6 Astra Altogether', models)).toBeNull();
  });
  it('rifiuta cataloghi ambigui e due modelli nella stessa lettura', () => {
    expect(parseModelLabel('GPT-5.6 Sol Alto GPT-6 Astra Alto', models)).toBeNull();
    expect(parseModelLabel('GPT-5.6 Sol Alto', [models[0]!, { ...models[0]!, id: 'duplicate' }])).toBeNull();
  });
  it('segnala una modalità Fast assente senza confonderla con Light', () => {
    expect(modelSelectorFailure({ status: 'UNAVAILABLE', modelName: 'GPT-6.1 Sol', reasoning: 'high', flash: true, matchingPasses: ['model-1', 'model-2'] })).toContain('modalità Fast');
    const light = modelSelectorFailure({ status: 'UNAVAILABLE', modelName: 'GPT-6 Astra', reasoning: 'light', flash: false, matchingPasses: ['model-1', 'model-2'] });
    expect(light).toContain('reasoning light'); expect(light).not.toContain('modalità Fast');
  });
});
