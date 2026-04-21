import type { ChargeHistory } from './chargeHistory';

export type ChargeRuntime = {
  history: ChargeHistory;
  charge: number; // signed charge value
};
