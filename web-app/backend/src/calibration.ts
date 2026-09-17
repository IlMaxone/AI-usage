import { BillingCalibrationEntity } from './entities';

export interface DerivedCalibration {
  fullWindowEur: number;
  eurPerCredit: number;
  fullWindowCredits: number;
  pilotEurPerMinute: number;
  fullWindowPilotMinutes: number;
}

export function deriveCalibration(item: BillingCalibrationEntity): DerivedCalibration {
  const observedUsagePct = Number(item.observedUsagePct);
  const estimatedBilledEur = Number(item.estimatedBilledEur);
  const creditPackCredits = Number(item.creditPackCredits);
  const creditPackPaidEur = Number(item.creditPackPaidEur);
  const pilotDurationSeconds = Number(item.pilotDurationSeconds);
  const pilotBilledEur = Number(item.pilotBilledEur);
  const fullWindowEur = estimatedBilledEur / (observedUsagePct / 100);
  const eurPerCredit = creditPackPaidEur / creditPackCredits;
  const pilotEurPerMinute = pilotBilledEur / (pilotDurationSeconds / 60);
  return {
    fullWindowEur,
    eurPerCredit,
    fullWindowCredits: fullWindowEur / eurPerCredit,
    pilotEurPerMinute,
    fullWindowPilotMinutes: fullWindowEur / pilotEurPerMinute,
  };
}
