import { parseModelCatalog } from './model-catalog';

const header = 'key,provider,name,reasoning,currency,five_hour_window_cost,cost_per_minute,max_time_window_minutes,available';
const row = 'gpt-5.6-sol,OpenAI,GPT-5.6 Sol,high,EUR,13.54,0.1455,93:03,true';

describe('catalogo CSV', () => {
  it('legge BOM e CRLF preservando precisione e disponibilità', () => {
    expect(parseModelCatalog('\uFEFF' + header + '\r\n' + row + '\r\n')[0]).toMatchObject({
      key: 'gpt-5.6-sol', costPerMinute: 0.1455, maxTimeWindowMinutes: 93.05, fiveHourWindowCost: 13.54, available: true,
    });
  });
  it('accetta la virgola decimale soltanto in un campo CSV quotato', () => {
    expect(parseModelCatalog(header + '\n' + row.replace('0.1455', '"0,1455"'))[0]?.costPerMinute).toBe(0.1455);
    expect(() => parseModelCatalog(header + '\n' + row.replace('0.1455', '0,145'))).toThrow('colonne');
  });
  it('accetta key leggibili con spazi preservandone il valore', () => {
    expect(parseModelCatalog(header + '\n' + row.replace('gpt-5.6-sol,', '5.6 sol high,'))[0]?.key).toBe('5.6 sol high');
  });
  it('rifiuta duplicati, etichette OCR ambigue, quote errate e file vuoti', () => {
    expect(() => parseModelCatalog(header)).toThrow('EMPTY');
    expect(() => parseModelCatalog(header + '\n' + row + '\n' + row)).toThrow('key');
    expect(() => parseModelCatalog(header + '\n' + row + '\n' + row.replace('sol,', 'another,'))).toThrow('ambigui');
    expect(() => parseModelCatalog(header + '\n"unclosed')).toThrow('UNCLOSED_QUOTES');
  });
  it('considera Fast e il vecchio alias Flash la stessa modalità', () => {
    const fast = row.replace('gpt-5.6-sol,', 'sol fast,').replace(',high,', ',high fast,');
    const flash = row.replace('gpt-5.6-sol,', 'sol flash,').replace(',high,', ',high flash,');
    expect(() => parseModelCatalog(header + '\n' + fast + '\n' + flash)).toThrow('ambigui');
    expect(parseModelCatalog(header + '\n' + row + '\n' + fast)).toHaveLength(2);
    const low = row.replace('gpt-5.6-sol,', 'sol low,').replace(',high,', ',low,');
    const light = row.replace('gpt-5.6-sol,', 'sol light,').replace(',high,', ',light,');
    expect(() => parseModelCatalog(header + '\n' + low + '\n' + light)).toThrow('ambigui');
  });
  it('non importa tariffe non valide, cambi al riferimento fisso o booleani ambigui', () => {
    for (const invalid of ['-1', 'NaN', 'Infinity', '0', '1e300']) {
      expect(() => parseModelCatalog(header + '\n' + row.replace('0.1455', invalid))).toThrow('tariffa');
    }
    expect(() => parseModelCatalog(header + '\n' + row.replace('13.54', '20'))).toThrow('finestra fissa');
    expect(() => parseModelCatalog(header + '\n' + row.replace(',true', ',yes'))).toThrow('available');
    expect(parseModelCatalog(header + '\n' + row.replace(',true', ',false'))[0]?.available).toBe(false);
  });
  it('converte minuti:secondi e minuti decimali senza usare la tariffa arrotondata', () => {
    for (const [input, expected] of [['93:03', 93.05], ['40:08', 40 + 8 / 60], ['111:43', 111 + 43 / 60], ['93.05', 93.05], ['300:00', 300]] as const) {
      expect(parseModelCatalog(header + '\n' + row.replace('93:03', input))[0]?.maxTimeWindowMinutes).toBe(expected);
    }
    for (const input of ['', '0', '0:00', '-1', '93:60', '1:2', '300:01', '301', 'Infinity']) {
      expect(() => parseModelCatalog(header + '\n' + row.replace('93:03', input))).toThrow('max_time_window_minutes');
    }
  });
});
