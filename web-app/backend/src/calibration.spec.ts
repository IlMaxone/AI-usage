import { BillingCalibrationEntity } from './entities';
import { deriveCalibration } from './calibration';

describe('deriveCalibration', () => {
  it('derives values without persisting calculated totals', () => {
    const input = {
      observedUsagePct: 50,
      estimatedBilledEur: 5,
      creditPackCredits: 200,
      creditPackPaidEur: 10,
      pilotDurationSeconds: 600,
      pilotBilledEur: 1,
    } as BillingCalibrationEntity;
    expect(deriveCalibration(input)).toEqual({
      fullWindowEur: 10,
      eurPerCredit: 0.05,
      fullWindowCredits: 200,
      pilotEurPerMinute: 0.1,
      fullWindowPilotMinutes: 100,
    });
  });
});
