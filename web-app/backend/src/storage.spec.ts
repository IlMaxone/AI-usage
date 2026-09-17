import { projectFolderName } from './storage';

describe('projectFolderName', () => {
  it('crea una cartella leggibile e stabile per il progetto', () => {
    expect(projectFolderName({ id: '2fc22683-7028-46a1-92a0-d5ece1682616', name: 'AI Usage' }))
      .toBe('ai-usage--2fc22683');
  });

  it('rimuove separatori di percorso e mantiene distinto l’id', () => {
    expect(projectFolderName({ id: '12345678-7028-46a1-92a0-d5ece1682616', name: '../Cliente Èlite' }))
      .toBe('cliente-elite--12345678');
  });
});
