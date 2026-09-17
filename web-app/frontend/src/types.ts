export interface User { id: string; email: string; displayName: string }
export interface AuthResponse { accessToken: string; expiresIn: string; user: User }
export interface Project { id: string; name: string; color: string; eventCount?: number; usedPctSum?: number }
export interface Pricing {
  currency: 'USD' | 'EUR'; inputPerMillion: number; cachedInputPerMillion: number; outputPerMillion: number;
  creditsPerMillionInput?: number; creditsPerMillionCachedInput?: number; creditsPerMillionOutput?: number;
}
export interface DerivedCalibration { fullWindowCredits: number; fullWindowEur: number; fullWindowPilotMinutes: number; eurPerCredit: number; pilotEurPerMinute: number }
export interface Calibration { id: string; recordedAt: string; derived: DerivedCalibration }
export interface Rule { id: string; name: string; outputUnit: string; expression: unknown; version: number; isDefault: boolean }
export interface AiModel {
  id: string; provider: string; name: string; reasoning: string; isDefault: boolean; version: number;
  pricing: Pricing; rules: Rule[]; latestCalibration: Calibration | null;
}
export interface UsageResult { status: 'PAIRED' | 'END_ONLY' | 'WAITING_FOR_END' | 'WINDOW_MISMATCH' | 'NO_USAGE'; usedPct: number | null }
export interface UsageEvent {
  id: string; projectId: string; modelId: string; title: string; startsAt: string; endsAt: string | null;
  notes: string | null; startUploadId: string | null; endUploadId: string | null; usage: UsageResult;
}
export interface Upload {
  id: string; projectId: string; eventId: string | null; role: 'SINGLE' | 'START' | 'END'; originalName: string;
  status: 'UPLOADED' | 'PROCESSING' | 'VALIDATED' | 'MANUAL_REVIEW' | 'FAILED'; reviewReason: string | null; createdAt: string;
}
export interface Dashboard {
  metrics: { events: number; measuredEvents: number; pairedEvents: number; usedPctSum: number; extraCreditsSpent: number; extraPaidEur: number };
  projects: Project[];
  recentEvents: Array<{ id: string; title: string; startsAt: string; project: Project | null; model: Pick<AiModel, 'id'|'name'|'provider'|'reasoning'> | null; usage: UsageResult; calculated: { value: number; unit: string; ruleName: string } | null }>;
}
