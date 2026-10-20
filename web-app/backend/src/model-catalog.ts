import { Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { DataSource, EntityManager } from 'typeorm';
import { AiModelEntity, AuditEventEntity, UserEntity } from './entities';
import { FIXED_WINDOW } from './fixed-window';

export interface CatalogRow {
  key: string; provider: string; name: string; reasoning: string;
  currency: 'EUR'; fiveHourWindowCost: number; costPerMinute: number; maxTimeWindowMinutes: number; available: boolean;
}
const headers = ['key', 'provider', 'name', 'reasoning', 'currency', 'five_hour_window_cost', 'cost_per_minute', 'max_time_window_minutes', 'available'];
const identity = (value: string) => value.normalize('NFKD').toLowerCase().replace(/[^a-z0-9]/g, '');
const reasoningLabelIdentity = (value: string) => identity(value.replace(/\blight\b/gi, 'low').replace(/[\s-]+flash$/i, ' fast'));

function csvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], field = '', quoted = false, closed = false;
  const input = text.replace(/^\uFEFF/, '');
  const finish = () => { row.push(field.trim()); if (row.some(Boolean)) rows.push(row); row = []; field = ''; closed = false; };
  for (let i = 0; i < input.length; i++) {
    const c = input[i]!;
    if (quoted) {
      if (c === '"' && input[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') { quoted = false; closed = true; }
      else field += c;
    } else if (c === '"') {
      if (field.trim() || closed) throw new Error('MODEL_CATALOG_INVALID_QUOTES');
      field = ''; quoted = true;
    } else if (c === ',') { row.push(field.trim()); field = ''; closed = false; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && input[i + 1] === '\n') i++; finish(); }
    else {
      if (closed && c.trim()) throw new Error('MODEL_CATALOG_INVALID_QUOTES');
      field += c;
    }
  }
  if (quoted) throw new Error('MODEL_CATALOG_UNCLOSED_QUOTES');
  if (field || row.length) finish();
  return rows;
}

export function parseModelCatalog(text: string): CatalogRow[] {
  const rows = csvRows(text);
  if (rows[0]?.join(',') !== headers.join(',')) throw new Error('MODEL_CATALOG_INVALID_HEADER');
  if (rows.length < 2) throw new Error('MODEL_CATALOG_EMPTY');
  const keys = new Set<string>(), labels = new Set<string>();
  return rows.slice(1).map((row, index) => {
    const fail = (reason: string): never => { throw new Error(`MODEL_CATALOG_ROW_${index + 2}: ${reason}`); };
    if (row.length !== headers.length) fail('numero di colonne errato');
    const [key, provider, name, reasoning, currency, window, minute, maxTime, available] = row as [string, string, string, string, string, string, string, string, string];
    if (!/^[a-z0-9][a-z0-9. -]{0,99}$/.test(key) || keys.has(key)) fail('key non valida o duplicata');
    if (!provider || provider.length > 80 || !name || name.length > 120 || !reasoning || reasoning.length > 80 || [provider, name, reasoning].some((value) => /[\r\n\x00]/.test(value))) fail('identità del modello non valida');
    const label = identity(name) + ':' + reasoningLabelIdentity(reasoning);
    if (labels.has(label)) fail('nome e reasoning ambigui');
    const number = (value: string) => /^\d+(?:[.,]\d+)?$/.test(value) ? Number(value.replace(',', '.')) : NaN;
    const fiveHourWindowCost = number(window), costPerMinute = number(minute);
    if (currency !== FIXED_WINDOW.currency || fiveHourWindowCost !== FIXED_WINDOW.fiveHourWindowCost) fail('finestra fissa: 13.54 EUR');
    if (!Number.isFinite(costPerMinute) || costPerMinute <= 0) fail('tariffa al minuto non valida');
    const duration = /^(\d+):([0-5]\d)$/.exec(maxTime);
    const maxTimeWindowMinutes = duration ? Number(duration[1]) + Number(duration[2]) / 60 : number(maxTime);
    if (!Number.isFinite(maxTimeWindowMinutes) || maxTimeWindowMinutes <= 0 || maxTimeWindowMinutes > 300) fail('max_time_window_minutes deve essere tra 0 e 300 minuti, in formato minuti decimali o minuti:secondi');
    if (!['true', 'false'].includes(available)) fail('available deve essere true o false');
    keys.add(key); labels.add(label);
    return { key, provider, name, reasoning, currency: 'EUR', fiveHourWindowCost, costPerMinute, maxTimeWindowMinutes, available: available === 'true' };
  });
}

@Injectable()
export class ModelCatalogService {
  private rows: CatalogRow[] | null = null;
  private hash = '';
  constructor(private readonly source: DataSource) {}

  async loadAndSync() {
    const file = process.env.MODEL_CATALOG_PATH ?? path.resolve('../../models/models.csv');
    const buffer = await fs.readFile(file);
    const rows = parseModelCatalog(buffer.toString('utf8'));
    const hash = createHash('sha256').update(buffer).digest('hex');
    await this.source.transaction(async (manager) => {
      await manager.query("SELECT pg_advisory_xact_lock(hashtextextended('model-catalog', 0))");
      await manager.query(`INSERT INTO model_catalog_sources(sha256, file_name, rows) VALUES ($1, 'models/models.csv', $2::jsonb) ON CONFLICT (sha256) DO NOTHING`, [hash, JSON.stringify(rows)]);
      for (const owner of await manager.find(UserEntity)) await this.applyOwner(manager, owner.id, rows, hash);
    });
    this.rows = rows; this.hash = hash;
  }

  async syncOwner(manager: EntityManager, ownerId: string) {
    if (!this.rows) throw new Error('MODEL_CATALOG_NOT_LOADED');
    return this.applyOwner(manager, ownerId, this.rows, this.hash);
  }

  private async applyOwner(manager: EntityManager, ownerId: string, rows: CatalogRow[], hash: string) {
    await manager.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', ['catalog:' + ownerId]);
    await manager.query("SELECT set_config('app.catalog_sync', 'on', true)");
    const existing = await manager.find(AiModelEntity, { where: { ownerId }, withDeleted: true });
    const retained = new Set<string>();
    const imported: AiModelEntity[] = [];
    const syncedAt = new Date();
    for (const row of rows) {
      let model = existing.find((model) => model.catalogKey === row.key);
      if (!model) {
        const matches = existing.filter((model) => !model.deletedAt && !model.supersededAt && identity(model.provider) === identity(row.provider) && identity(model.name) === identity(row.name) && identity(model.reasoning) === identity(row.reasoning));
        // A renamed CSV key can retain the same model UUID and immutable OCR tags.
        // Reject aliases that are also present in this import or match ambiguously.
        if (matches.length > 1 || matches.some((model) => model.catalogKey && rows.some((candidate) => candidate.key === model.catalogKey))) throw new Error(`MODEL_CATALOG_AMBIGUOUS_IDENTITY: ${row.key}`);
        model = matches[0];
      }
      if (model && (model.deletedAt || model.supersededAt || identity(model.provider) !== identity(row.provider) || identity(model.name) !== identity(row.name) || identity(model.reasoning) !== identity(row.reasoning))) throw new Error(`MODEL_CATALOG_IDENTITY_CHANGED: ${row.key}`);
      const pricing = { ...FIXED_WINDOW, costPerMinute: row.costPerMinute, maxTimeWindowMinutes: row.maxTimeWindowMinutes };
      const changed = !model || model.catalogKey !== row.key || model.catalogAvailable !== row.available || model.pricing.currency !== pricing.currency || model.pricing.fiveHourWindowCost !== pricing.fiveHourWindowCost || model.pricing.costPerMinute !== pricing.costPerMinute || model.pricing.maxTimeWindowMinutes !== pricing.maxTimeWindowMinutes;
      const before = model ? { key: model.catalogKey, pricing: model.pricing, available: model.catalogAvailable } : null;
      if (!model) model = await manager.save(AiModelEntity, { ownerId, logicalKey: randomUUID(), version: 1, provider: row.provider, name: row.name, reasoning: row.reasoning, isDefault: false, pricing, calibration: {}, catalogKey: row.key, catalogAvailable: row.available, catalogSha256: hash, catalogSyncedAt: syncedAt });
      else {
        await manager.update(AiModelEntity, model.id, { pricing, catalogKey: row.key, catalogAvailable: row.available, catalogSha256: hash, catalogSyncedAt: syncedAt });
        Object.assign(model, { pricing, catalogKey: row.key, catalogAvailable: row.available, catalogSha256: hash, catalogSyncedAt: syncedAt });
      }
      retained.add(model.id); imported.push(model);
      if (changed) await manager.insert(AuditEventEntity, { ownerId, action: 'MODEL_CSV_IMPORTED', entityType: 'model', entityId: model.id, metadata: { source: 'models/models.csv', sha256: hash, before: before ?? { firstImport: true }, after: { key: row.key, pricing, available: row.available } } });
    }
    for (const model of existing) if (model.catalogAvailable && !retained.has(model.id)) {
      await manager.update(AiModelEntity, model.id, { catalogAvailable: false, catalogSha256: hash, catalogSyncedAt: syncedAt });
      await manager.insert(AuditEventEntity, { ownerId, action: 'MODEL_CSV_UNAVAILABLE', entityType: 'model', entityId: model.id, metadata: { source: 'models/models.csv', sha256: hash } });
    }
    return imported;
  }
}
