import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupModels } from '../src/model-groups.ts';

test('ordina le varianti per reasoning con Fast subito dopo Standard, senza dipendere dal CSV', () => {
  const labels = ['ultra fast', 'high fast', 'xhigh', 'medium fast', 'light fast', 'ultra', 'medium', 'high', 'xhigh fast', 'light'];
  const input = labels.map((reasoning, index) => ({ id: String(index), provider: 'OpenAI', name: 'GPT-5.6 Sol', reasoning }));
  assert.deepEqual(groupModels(input)[0].variants.map((model) => model.reasoning), ['light', 'light fast', 'medium', 'medium fast', 'high', 'high fast', 'xhigh', 'xhigh fast', 'ultra', 'ultra fast']);
  assert.deepEqual(input.map((model) => model.reasoning), labels);
});

test('raggruppa per famiglia e provider e ordina anche gli alias Low e Flash', () => {
  const item = (id, name, reasoning, provider = 'OpenAI') => ({ id, name, reasoning, provider });
  const groups = groupModels([
    item('high', 'GPT-5.6 Sol', 'high'), item('astra', 'GPT-6 Astra', 'high'),
    item('flash', 'GPT-5.6 Sol', 'LOW FLASH'), item('low', 'GPT-5.6 Sol', 'low'),
    item('other', 'GPT-5.6 Sol', 'medium', 'Other'), item('medium', 'GPT-5.6 Sol', 'medium'),
  ]);
  assert.equal(groups.length, 3);
  assert.deepEqual(groups[0].variants.map((model) => model.id), ['low', 'flash', 'medium', 'high']);
  assert.equal(groups[1].name, 'GPT-6 Astra');
  assert.equal(groups[2].provider, 'Other');
  assert.deepEqual(groupModels([]), []);
});
