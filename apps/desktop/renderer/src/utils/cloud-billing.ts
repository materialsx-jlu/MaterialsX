import {creditDisplay, creditSubunits, mxPointDisplay, mxPointSubunits, type AlphaRequest, type AlphaTask} from '../../../../../packages/contracts/src/platform.js';

type Charge = Pick<AlphaRequest, 'settlement' | 'reservedCredits' | 'chargedCredits'>;

export function summarizeCloudBilling(mode: AlphaTask['billingMode'], requests: Charge[]) {
  const mx = mode === 'mx-points';
  const subunits = mx ? mxPointSubunits : creditSubunits;
  const display = mx ? mxPointDisplay : creditDisplay;
  let charged = 0n;
  let held = 0n;
  for (const request of requests) {
    if (request.settlement === 'settled' && request.chargedCredits !== null) charged += subunits(request.chargedCredits);
    if (request.settlement === 'reserved' || request.settlement === 'reconciliation_pending') held += subunits(request.reservedCredits);
  }
  return {
    billable: mode !== 'alpha-test',
    charged: display(charged),
    held: display(held),
    unit: mx ? 'MX 点' : mode === 'paid-credits' ? '积分' : 'test-credit',
  };
}
