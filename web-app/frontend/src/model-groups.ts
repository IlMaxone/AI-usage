export interface ModelVariant { id: string; provider: string; name: string; reasoning: string }

export function variantOrder(reasoning: string) {
  const value = reasoning.trim().toLowerCase().replace(/[-_]+/g, ' ').replace(/\s+/g, ' ');
  const fast = / (?:fast|flash)$/.test(value);
  const base = value.replace(/ (?:fast|flash)$/, '').replace(/^low$/, 'light').replace(/^extra high$/, 'xhigh');
  const rank = ['light', 'medium', 'high', 'xhigh', 'ultra'].indexOf(base);
  return { base, fast, rank: rank < 0 ? 5 : rank };
}

export function groupModels<T extends ModelVariant>(models: readonly T[]) {
  const groups = new Map<string, { key: string; provider: string; name: string; variants: T[] }>();
  for (const model of models) {
    const key = model.provider.trim().toLowerCase() + ':' + model.name.trim().toLowerCase();
    const group = groups.get(key) ?? { key, provider: model.provider, name: model.name, variants: [] };
    group.variants.push(model); groups.set(key, group);
  }
  for (const group of groups.values()) group.variants.sort((left, right) => {
    const a = variantOrder(left.reasoning), b = variantOrder(right.reasoning);
    return a.rank - b.rank || a.base.localeCompare(b.base, 'it') || Number(a.fast) - Number(b.fast);
  });
  return [...groups.values()];
}
