import assert from 'node:assert/strict';
import test from 'node:test';
import {mxPointDisplay} from '../../../../../packages/contracts/src/platform.js';
import {summarizeCloudBilling} from './cloud-billing.js';

test('MX billing separates settled charges from pending holds without rounding', () => {
  const result = summarizeCloudBilling('mx-points', [
    {settlement:'settled', chargedCredits:'1.870925', reservedCredits:'37.2736'},
    {settlement:'reconciliation_pending', chargedCredits:null, reservedCredits:'0.25'},
    {settlement:'released', chargedCredits:'0', reservedCredits:'5'},
  ]);
  assert.deepEqual(result, {billable:true, charged:'1.870925', held:'0.25', unit:'MX 点'});
});

test('paid credits retain four decimal places and alpha calls stay free', () => {
  assert.deepEqual(summarizeCloudBilling('paid-credits', [
    {settlement:'settled', chargedCredits:'0.0041', reservedCredits:'1'},
    {settlement:'reserved', chargedCredits:null, reservedCredits:'0.1000'},
  ]), {billable:true, charged:'0.0041', held:'0.1', unit:'积分'});
  assert.equal(summarizeCloudBilling('alpha-test', []).billable, false);
  assert.equal(mxPointDisplay(-1870925n), '-1.870925');
});
