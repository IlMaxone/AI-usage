export interface User { id: string; email: string; displayName: string }
export interface AuthResponse { accessToken: string; expiresIn: string; user: User }
export interface Project { id: string; name: string; color: string; recordCount?: number; usedPctSum?: number }
export interface Pricing {
  currency: 'USD' | 'EUR'; fiveHourWindowCost: number; costPerMinute: number;
}
export interface DerivedCalibration { fullWindowCredits: number; fullWindowEur: number; fullWindowPilotMinutes: number; eurPerCredit: number; pilotEurPerMinute: number }
export interface Calibration { id: string; recordedAt: string; derived: DerivedCalibration }
export interface Rule { id: string; name: string; outputUnit: string; expression: unknown; version: number; isDefault: boolean }
export interface AiModel {
  id: string; provider: string; name: string; reasoning: string; isDefault: boolean; version: number;
  pricing: Pricing; rules: Rule[]; latestCalibration: Calibration | null;
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
}
export interface CostAnalysisItem {
  recordId: string; project: Project | null; mode: 'CONSTANT' | 'SEGMENT'; capturedAt: string;
  fiveHourResetsAt: string | null; usedPct: number; attributedUsedPct: number; elapsedMinutes: number | null;
  maximumWindowCost: number; maximumUsageMinutes: number | null; estimatedCost: number;
  estimatedUsageMinutes: number | null; remainingWindowCost: number; cappedByWindow: boolean;
}
export interface CostAnalysisWindow {
  resetsAt: string | null; records: number; rawUsedPct: number; attributedUsedPct: number; cappedByWindow: boolean;
  maximumWindowCost: number; maximumUsageMinutes: number | null; estimatedCost: number;
  estimatedUsageMinutes: number | null; remainingWindowCost: number;
}
export interface CostAnalysis {
  model: Pick<AiModel, 'id' | 'provider' | 'name' | 'reasoning' | 'pricing'>;
  summary: {
    records: number; windows: number; cappedWindows: number; attributedUsedPct: number;
    estimatedCost: number; estimatedUsageMinutes: number | null;
    maximumWindowCost: number; maximumUsageMinutesPerWindow: number | null;
  };
  items: CostAnalysisItem[];
  windows: CostAnalysisWindow[];
}
export interface GalleryUpload {
  id: string; recordId: string | null; role: 'SINGLE' | 'START' | 'END'; originalName: string;
  mime: string; size: number; status: Upload['status']; createdAt: string; capturedAt: string | null; recordDeleted: boolean;
  project: Pick<Project, 'id' | 'name' | 'color'> | null;
}
export interface Dashboard {
  metrics: { records: number; measuredRecords: number; segments: number; usedPctSum: number; extraCreditsSpent: number; extraPaidEur: number };
  projects: Project[];
  recentRecords: DashboardRecord[];
}
