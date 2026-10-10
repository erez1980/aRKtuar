'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const C = require('../assets/support.js');
const E = require('../assets/engine.js');
function state() {
  const s = E.newState();
  s.support.date = '2026-10-10';
  s.incomes.A.salaryNet = 12000; s.incomes.B.salaryNet = 8000;
  s.kids = [{ name: 'Child', birth: '2016-10-10', lives: 'shared', support: { daysA: 7, daysB: 7, basic: 2000, housing: 600, education: 200, health: 100, activities: 100, expensePayer: 'B' } }];
  return s;
}
test('age bands change on birthday and exclude invalid/future births', () => {
  assert.equal(C.ageOn('2020-10-10', '2026-10-10'), 6);
  assert.equal(C.ageOn('2020-10-11', '2026-10-10'), 5);
  assert.equal(C.ageOn('2026-02-30', '2026-10-10'), null);
  assert.equal(C.ageOn('2027-01-01', '2026-10-10'), null);
  const s = state();
  for (const [birth, band] of [['2020-10-10', '6–15'], ['2011-10-10', '15–18']]) { s.kids[0].birth = birth; assert.equal(C.compute(s, 'declared').rows[0].band, band); }
});
test('relative income and custody produce explicit monthly transfer', () => {
  const r = C.compute(state(), 'declared');
  assert.deepEqual(r.available, { A: 12000, B: 8000 });
  assert.equal(r.shares.A, 0.6);
  assert.deepEqual(r.transfer, { from: 'A', to: 'B', amount: 800 });
  assert.equal(r.rows[0].directA, 1000);
});
test('equal income and custody cancel time-dependent needs; fixed expenses reimbursed', () => {
  const s = state(); s.incomes.A.salaryNet = 8000;
  assert.equal(C.compute(s, 'declared').transfer.amount, 500);
  Object.assign(s.kids[0].support, { housing: 0, education: 0, health: 0, activities: 0 });
  assert.equal(C.compute(s, 'declared').transfer.amount, 0);
});
test('real bank income and declared income are separate scenarios', () => {
  const s = state(); s.bank.A.summary = { months: 6, realMonthly: 24000, declaredMonthly: 12000 };
  assert.equal(C.compute(s, 'real').transfer.amount, 1250);
  assert.equal(C.compute(s, 'declared').transfer.amount, 800);
  assert.equal(C.compute(s, 'real').incomes.B.source, 'declaredFallback');
});
test('essential personal expenses deducted and clamped; known zero income retained', () => {
  const s = state(); s.support.selfExpenses.A = 4000;
  assert.equal(C.compute(s, 'declared').shares.A, 0.5);
  s.bank.A.summary = { months: 1, realMonthly: 0 };
  assert.equal(C.compute(s, 'real').incomes.A.value, 0);
  assert.equal(C.compute(s, 'real').available.A, 0);
});
test('manual real override accepts zero; clearing restores bank value', () => {
  const s = state(); s.bank.A.summary = { months: 1, realMonthly: 15000 };
  s.support.realOverride.A = 0; assert.equal(C.compute(s, 'real').incomes.A.source, 'manual');
  assert.equal(C.compute(s, 'real').incomes.A.value, 0);
  s.support.realOverride.A = ''; assert.equal(C.compute(s, 'real').incomes.A.value, 15000);
});
test('under six requires explicit obligation selection and uses separate scenario', () => {
  const s = state(); s.kids[0].birth = '2022-01-01';
  assert.equal(C.compute(s, 'declared').rows.length, 0);
  Object.assign(s.kids[0].support, { under6Payer: 'A', daysA: 0, daysB: 7 });
  const r = C.compute(s, 'declared');
  assert.equal(r.rows[0].band, '0–6'); assert.equal(r.transfer.amount, 2840);
});
test('custody ratio affects transfer; fixed expense payer changes its direction', () => {
  const s = state(); Object.assign(s.kids[0].support, { daysA: 1, daysB: 3 });
  assert.equal(C.compute(s, 'declared').transfer.amount, 1300);
  s.kids[0].support.expensePayer = 'A';
  assert.equal(C.compute(s, 'declared').transfer.amount, 300);
  s.kids[0].support.daysA = 3; s.kids[0].support.daysB = 1;
  assert.deepEqual(C.compute(s, 'declared').transfer, { from: 'B', to: 'A', amount: 700 });
});
test('missing needs, invalid dates and custody are explicit exclusions', () => {
  const s = state(); delete s.kids[0].support.daysB;
  assert.equal(C.compute(s, 'declared').complete, false);
  s.kids[0].support.daysB = 7; s.kids[0].support.basic = 0;
  assert.match(C.compute(s, 'declared').excluded[0].reason, /צרכים/);
  s.kids[0].birth = ''; assert.match(C.compute(s, 'declared').excluded[0].reason, /תאריך/);
});
test('18 and older excluded; netting opposite child transfers preserves direction', () => {
  const s = state(); s.kids[0].birth = '2008-10-10';
  assert.equal(C.compute(s, 'declared').excluded[0].band, '18+');
  s.kids[0].birth = '2016-10-10';
  s.kids.push({ birth: '2015-01-01', support: { daysA: 7, daysB: 0, basic: 2000, housing: 1000, expensePayer: 'A' } });
  assert.deepEqual(C.compute(s, 'declared').transfer, { from: 'B', to: 'A', amount: 400 });
});
test('zero total income warns and uses illustrative equal ratio without NaN', () => {
  const s = state(); s.incomes.A.salaryNet = 0; s.incomes.B.salaryNet = 0;
  const r = C.compute(s, 'declared'); assert.equal(r.shares.A, 0.5);
  assert.ok(r.warnings.length); assert.ok(Number.isFinite(r.transfer.amount));
});
test('calculation does not mutate imported case data and supports old cases', () => {
  const s = state(), before = JSON.stringify(s); C.compute(s, 'real'); assert.equal(JSON.stringify(s), before);
  delete s.support; assert.ok(C.compute(s, 'real', '2026-10-10').rows.length);
});
