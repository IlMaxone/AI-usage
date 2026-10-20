import { parseModelLabel } from './ocr-model';

const models = [
  { id: 'sol-high', name: 'GPT-5.6 Sol', reasoning: 'high' },
  { id: 'sol-xhigh', name: 'GPT-5.6 Sol', reasoning: 'xhigh' },
  { id: 'astra', name: 'GPT-6 Astra', reasoning: 'high' },
];
describe('modello e reasoning dallo screenshot', () => {
  it('legge le etichette italiane e le separazioni OCR', () => {
    expect(parseModelLabel('GPT - 5.6 Sol Alto', models)).toBe('sol-high');
    expect(parseModelLabel('GPT-6 Astra High', models)).toBe('astra');
    expect(parseModelLabel('GPT-5.6 Sol Molto alto', models)).toBe('sol-xhigh');
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
});
