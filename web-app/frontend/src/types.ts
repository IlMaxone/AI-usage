export interface User { id: string; email: string; displayName: string }
export interface OcrDebugEvent { at: string; stage: string; level: string; code: string; details: Record<string, unknown> }
export interface OcrDebugReport {
  immagini_infette: Array<{ immagine: string; progetto: string; progetto_id: string | null; notifica_id: string; stato: string }>;
  logs_errori: Array<{
    immagine: string; progetto: string; notifica_id: string; coppia: string | null; immagini_associate: string[];
    stato: string; stato_rilevazione_attuale?: string; ultima_lettura_valida_conservata?: boolean; motivo: string; cartella: string | null; file_disponibile: boolean; sha256: string | null; dettaglio_disponibile: boolean;
    tentativi: Array<{ id: string; data: string; ruolo: string; stato: string; sha256: string | null; log: OcrDebugEvent[] }>;
    log_storico: Array<{ at: string; stage: string; level: string; code: string; message: string; note: string }>;
  }>;
  metadata: { formato: string; versione: number; esportato_il: string; numero_immagini: number; testo_ocr_completo_incluso: boolean };
}
export interface OcrFailureNotification {
  id: string; originalName: string; files: string[]; reason: string; createdAt: string;
  project: { id: string; name: string; folder: string } | null;
  fileAvailable: boolean; pairNumber: string | null;
}
export interface AuthResponse { accessToken: string; expiresIn: string; user: User }
export interface Project { id: string; name: string; color: string; modelId: string | null; folder?: string; recordCount?: number; usedPctSum?: number; usageSharePct?: number }
export interface Pricing {
  currency: 'USD' | 'EUR'; fiveHourWindowCost: number; costPerMinute: number; maxTimeWindowMinutes?: number;
}
export interface DerivedCalibration { fullWindowCredits: number; fullWindowEur: number; fullWindowPilotMinutes: number; eurPerCredit: number; pilotEurPerMinute: number }
export interface Calibration { id: string; recordedAt: string; derived: DerivedCalibration }
export interface Rule { id: string; name: string; outputUnit: string; expression: unknown; version: number; isDefault: boolean }
export interface AiModel {
  id: string; provider: string; name: string; reasoning: string; isDefault: boolean; version: number;
  pricing: Pricing;
  lockedAt: string | null;
  catalogKey: string; catalogAvailable: boolean; catalogSha256: string; catalogSyncedAt: string;
}
export interface UsageResult {
  status: 'MEASURED' | 'SEGMENT_MEASURED' | 'WAITING_FOR_OCR' | 'WINDOW_MISMATCH'; usedPct: number | null;
  alignment?: { fiveHourResetOffsetMinutes: number; weeklyResetSignal: 'SAME_WINDOW' | 'ROLLOVER' | 'SHIFTED' | 'UNAVAILABLE' };
}
export interface UsageSnapshot {
  capturedAt: string;
  fiveHourRemainingPct: number; fiveHourUsedPct: number; fiveHourResetsAt: string;
  weeklyRemainingPct: number; weeklyUsedPct: number; weeklyResetsOn: string;
}
export interface Upload {
  id: string; recordId: string; role: 'SINGLE' | 'START' | 'END'; originalName: string;
  status: 'DRAFT' | 'UPLOADED' | 'PROCESSING' | 'VALIDATED' | 'MANUAL_REVIEW' | 'FAILED';
  reviewReason: string | null; createdAt: string;
  modelId: string | null; modelTaggedAt: string | null;
}
export interface Reading {
  upload: Upload | null; rawSnapshot: UsageSnapshot | null; correction: (UsageSnapshot & { reason: string; createdAt: string }) | null;
  effectiveSnapshot: UsageSnapshot | null;
}
export interface UsageRecord {
  id: string; projectId: string; modelId: string | null; mode: 'CONSTANT' | 'SEGMENT';
  status: 'DRAFT' | 'VALIDATING' | 'VALIDATED' | 'MANUAL_REVIEW' | 'FAILED';
  note: string | null; createdAt: string; project: Project | null;
  single: Reading | null; start: Reading | null; end: Reading | null; usage: UsageResult;
}
export interface DashboardRecord {
  id: string; mode: 'CONSTANT' | 'SEGMENT'; status: UsageRecord['status']; createdAt: string; capturedAt: string | null;
  project: Project | null; usage: UsageResult;
  observedUsage: {
    fiveHourUsedPct: number; weeklyUsedPct: number; fiveHourResetsAt: string; weeklyResetsOn: string;
  } | null;
}
export interface CostAnalysisItem {
  recordId: string; project: Project | null; mode: 'CONSTANT' | 'SEGMENT'; capturedAt: string;
  fiveHourResetsAt: string | null; usedPct: number; attributedUsedPct: number; elapsedMinutes: number | null;
  windowCostAt100: number; usageMinutesAt100: number | null; estimatedCost: number | null;
  estimatedUsageMinutes: number | null;
  sourceModel: CostModel | null; model: CostModel | null; tagStatus: 'TAGGED' | 'UNTAGGED' | 'MODEL_MISMATCH' | 'UNAVAILABLE';
  actualEstimatedCost: number | null; costDifference: number | null;
}
export interface CostAnalysisWindow {
  resetsAt: string | null; records: number; rawUsedPct: number; attributedUsedPct: number;
  windowCostAt100: number; usageMinutesAt100: number | null; estimatedCost: number;
  estimatedUsageMinutes: number | null;
}
export type CostModel = Pick<AiModel, 'id' | 'provider' | 'name' | 'reasoning' | 'pricing'>;
export interface CostAnalysis {
  model: CostModel | null;
  exploratory: boolean; reference: { currency: 'EUR'; fiveHourWindowCost: number };
  summary: {
    records: number; windows: number; attributedUsedPct: number;
    estimatedCost: number; estimatedUsageMinutes: number | null;
    windowCostAt100: number; usageMinutesAt100: number | null;
    actualEstimatedCost: number; costDifference: number; unpricedRecords: number;
  };
  items: CostAnalysisItem[];
}
export interface GalleryUpload {
  id: string; recordId: string | null; role: 'SINGLE' | 'START' | 'END'; originalName: string;
  mime: string; size: number; status: Upload['status']; createdAt: string; capturedAt: string | null; recordDeleted: boolean;
  project: Pick<Project, 'id' | 'name' | 'color'> | null;
  modelId: string | null; modelTaggedAt: string | null;
}
export interface Dashboard {
  metrics: { records: number; measuredRecords: number; segments: number; usedPctSum: number; equivalentWindows: number; windowCount: number; extraCreditsSpent: number; extraPaidEur: number };
  projects: Project[];
  recentRecords: DashboardRecord[];
}
