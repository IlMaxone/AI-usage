export function pairUploadFiles<T extends { name: string }>(files: T[]) {
  const groups = new Map<string, { start: T[]; end: T[] }>();
  const issues: string[] = [];
  for (const file of files) {
    const match = /^([ab])(\d+)\.(png|jpe?g|webp)$/i.exec(file.name);
    if (!match) { issues.push(`Nome non valido: ${file.name}. Usa A1/B1, A2/B2, ecc.`); continue; }
    const number = BigInt(match[2]!).toString();
    const group = groups.get(number) ?? { start: [], end: [] };
    group[match[1]!.toUpperCase() === 'A' ? 'start' : 'end'].push(file);
    groups.set(number, group);
  }
  const pairs: Array<{ number: string; start: T; end: T }> = [];
  for (const [number, group] of [...groups].sort(([a], [b]) => BigInt(a) < BigInt(b) ? -1 : 1)) {
    if (group.start.length > 1 || group.end.length > 1) issues.push(`Coppia ${number}: nomi ambigui, seleziona una sola A e una sola B.`);
    else if (!group.start.length || !group.end.length) issues.push(`Manca ${group.start.length ? 'B' : 'A'}${number}.`);
    else pairs.push({ number, start: group.start[0]!, end: group.end[0]! });
  }
  return { pairs, issues };
}
