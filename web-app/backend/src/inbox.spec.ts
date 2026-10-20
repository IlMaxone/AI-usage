import { pairIdentity, planPairs } from './inbox';
import { currentObservations } from './observations';

describe('cartella coppie A/B', () => {
  it('abbina per numero, non per ordine o estensione, senza richiedere numeri contigui', () => {
    expect(planPairs(['B10.jpg', 'A2.png', 'B2.webp', 'A10.PNG']).pairs).toEqual([
      { number: '2', start: 'A2.png', end: 'B2.webp' }, { number: '10', start: 'A10.PNG', end: 'B10.jpg' },
    ]);
  });
  it('lascia in attesa coppie incomplete e rifiuta nomi ambigui', () => {
    const plan = planPairs(['A1.png', 'B2.png', 'A3.png', 'A03.jpg', 'B3.jpg', 'notes.txt']);
    expect(plan.pairs).toEqual([]);
    expect(plan.pending).toEqual([
      { number: '1', reason: 'Manca B1' }, { number: '2', reason: 'Manca A2' },
      { number: '3', reason: 'Nomi ambigui: usa una sola A e una sola B per numero.' },
    ]);
    expect(plan.ignored).toEqual(['notes.txt']);
    expect(pairIdentity('../A1.png')).toBeNull();
  });
  it('le rettifiche precedenti non nascondono una nuova lettura OCR', () => {
    const old = { uploadId: 'id', createdAt: new Date('2026-10-19') };
    const recent = { uploadId: 'id', createdAt: new Date('2026-10-21') };
    expect(currentObservations([old, recent], [{ uploadId: 'id', createdAt: new Date('2026-10-20') }])).toEqual([recent]);
  });
});
