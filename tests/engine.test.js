'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const E = require('../assets/engine.js');
const meta = { marriageDate: '2020-01-01', crisisDate: '2022-01-01' };
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 0.001, `${actual} != ${expected}`);

test('marital pro-rata uses actual overlapping days and excludes future accrual', () => {
  close(E.maritalFraction('2018-01-01', meta.marriageDate, meta.crisisDate), 731 / 1461);
  assert.equal(E.maritalFraction('2021-01-01', meta.marriageDate, meta.crisisDate), 1);
  assert.equal(E.maritalFraction('2023-01-01', meta.marriageDate, meta.crisisDate), 0);
  assert.equal(E.maritalFraction('2018-01-01', '2023-01-01', meta.crisisDate), 0);
  const r = E.valueItem(E.newItem({ cat: 'pension', value: 146100, startDate: '2018-01-01', taxPct: 10 }), meta);
  close(r.gross, 73100); close(r.net, 65790);
});

test('RSU time rule clips at marriage and crisis, including unvested portion', () => {
  const f = E.vestingFraction('2019-01-01', '2023-01-01', meta.marriageDate, meta.crisisDate);
  close(f, 731 / 1461);
  close(E.valueItem(E.newItem({ cat: 'rsu', value: 146100, startDate: '2019-01-01', endDate: '2023-01-01', taxPct: 0 }), meta).gross, 73100);
  assert.equal(E.vestingFraction('2023-01-01', '2025-01-01', meta.marriageDate, meta.crisisDate), 0);
});

test('joint asset is allocated 50/50 independent of entered ownership share', () => {
  const s = E.newState(); s.items = [E.newItem({ owner: 'J', cat: 'realestate', value: 1000000, debt: 200000, share: 20 })];
  const r = E.compute(s);
  assert.equal(r.perSpouse.A.gross, 400000); assert.equal(r.perSpouse.B.gross, 400000);
  assert.equal(r.transfer.gross.amount, 0);
});

test('gifts and inheritance excluded, premarital value and specific sharing handled', () => {
  const it = E.newItem({ cat: 'bank', value: 100000, preMarital: 25000, taxPct: 0 });
  assert.equal(E.valueItem(it, meta).gross, 75000);
  assert.equal(E.valueItem({ ...it, sharedIntent: true }, meta).gross, 100000);
  assert.equal(E.valueItem({ ...it, excluded: true, excludedReason: 'inheritance' }, meta).status, 'excluded');
  assert.equal(E.valueItem({ ...it, share: 0 }, meta).gross, 0);
});

test('family debt reduces resources; personal debt excluded; greater resources pays half', () => {
  const s = E.newState(); s.items = [E.newItem({ owner: 'A', cat: 'bank', value: 100000 }), E.newItem({ owner: 'A', cat: 'debt', value: 20000 }), E.newItem({ owner: 'B', cat: 'debt', value: 90000, familyDebt: false })];
  const r = E.compute(s);
  assert.deepEqual(r.transfer.gross, { from: 'A', to: 'B', amount: 40000 });
  assert.equal(r.excluded.length, 1);
});

test('hidden findings affect only explicit alternative scenario; tax limited to gains', () => {
  const s = E.newState(); s.items = [E.newItem({ cat: 'hidden', owner: 'B', value: 10000 })];
  assert.equal(E.compute(s).transfer.gross.amount, 0);
  assert.deepEqual(E.compute(s, { includeFindings: true }).transfer.gross, { from: 'B', to: 'A', amount: 5000 });
  assert.equal(E.valueItem(E.newItem({ cat: 'securities', value: 10000, cost: 8000, taxPct: 25 }), meta).net, 9500);
});
