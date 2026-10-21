import { ownedProjectFolder, projectFolderName } from './storage';

describe('projectFolderName', () => {
  it('crea una cartella leggibile e stabile per il progetto', () => {
    expect(projectFolderName({ id: '2fc22683-7028-46a1-92a0-d5ece1682616', name: 'AI Usage' }))
      .toBe('ai-usage--2fc22683-7028-46a1-92a0-d5ece1682616');
  });

  it('normalizza il nome e separa le cartelle tramite UUID', () => {
    expect(projectFolderName({ id: '12345678-7028-46a1-92a0-d5ece1682616', name: '../Cliente Èlite' }))
      .toBe('cliente-elite--12345678-7028-46a1-92a0-d5ece1682616');
    expect(ownedProjectFolder('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '12345678-7028-46a1-92a0-d5ece1682616', 'Cliente Èlite'))
      .toBe('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/cliente-elite--12345678-7028-46a1-92a0-d5ece1682616');
    expect(() => ownedProjectFolder('../other', '12345678-7028-46a1-92a0-d5ece1682616', 'Test')).toThrow();
  });
});
