'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const B = require('../assets/bank.js');

for (const delimiter of [',', ';', '\t']) test(`CSV delimiter ${JSON.stringify(delimiter)} with preamble and quoted cells`, () => {
  const text = '\uFEFFדוח תנועות\r\n' + ['תאריך', 'תיאור', 'סכום'].join(delimiter) + '\r\n' + ['01/01/2026', '"העברה, \"\"כהן\"\""', '"1,500"'].join(delimiter);
  const r = B.rowsToTransactions(B.parseCSV(text));
  assert.equal(r.tx.length, 1); assert.equal(r.tx[0].amount, 1500);
  assert.equal(r.tx[0].desc, 'העברה, "כהן"');
});

test('windows-1255 Hebrew exports decoded without losing header or counterparty', () => {
  const text = 'תאריך;תיאור;סכום\n01/01/2026;כהן;100';
  const bytes = Uint8Array.from([...text].map(c => c >= 'א' && c <= 'ת' ? c.charCodeAt(0) - 0x5d0 + 0xe0 : c.charCodeAt(0)));
  const r = B.rowsToTransactions(B.parseCSV(B.decodeText(bytes)));
  assert.deepEqual(r.tx[0], { date: '2026-01-01', desc: 'כהן', amount: 100, balance: null });
});

// Representative layouts, not certified exports; see fixtures/README.md.
const layouts = [
  ['Hapoalim', ['תאריך', 'הפעולה', 'חובה', 'זכות', 'יתרה'], ['01/01/2026', 'העברה', 250, '', 1000]],
  ['Leumi', ['תאריך פעולה', 'תאריך ערך', 'תיאור', 'חובה', 'זכות', 'יתרה'], ['01/01/2026', '02/01/2026', 'העברה', '', 300, 1000]],
  ['Discount', ['תאריך', 'תיאור הפעולה', 'סכום הפעולה', 'יתרה'], ['01/01/2026', 'העברה', -250, 1000]],
  ['Mizrahi-Tefahot', ['תאריך', 'פרטים', 'סכום חובה', 'סכום זכות', 'יתרה'], ['01/01/2026', 'העברה', 250, '', 1000]],
  ['Max', ['תאריך העסקה', 'שם בית העסק', 'סכום חיוב'], ['01/01/2026', 'חנות', 250]],
  ['Isracard', ['תאריך רכישה', 'שם בית עסק', 'סכום בש"ח'], ['01/01/2026', 'חנות', 250]],
  ['Cal', ['מועד עסקה', 'שם בית העסק', 'סכום העסקה'], ['01/01/2026', 'חנות', 250]]
];
for (const [name, header, row] of layouts) test(`${name} representative header detection and debit sign`, () => {
  const r = B.rowsToTransactions([['דוח תנועות'], header, row]);
  assert.equal(r.tx.length, 1); assert.equal(r.tx[0].amount, name === 'Leumi' ? 300 : -250);
  assert.equal(r.map.row, 1);
});

test('manual mapping imports headerless data, separate columns, and card refunds', () => {
  assert.ok(B.rowsToTransactions([['2026-01-01', 'shop', 50]]).error);
  const map = { row: -1, date: 0, desc: 1, amount: 2, amountSign: -1, balance: -1, extra: -1 };
  assert.equal(B.rowsToTransactions([['2026-01-01', 'shop', -50]], map).tx[0].amount, 50);
});

test('Hebrew counterparty strips stop words, references, niqqud and directional marks', () => {
  assert.equal(B.counterparty('העברה מאת דָּנִי כהן 123456 | הערות'), 'דני כהן');
  assert.equal(B.counterparty('ביט דני כהן 987654'), 'דני כהן');
  assert.equal(B.counterparty('BIT Alice 12345'), 'alice');
});

const tx = (date, desc, amount) => ({ date, desc, amount });
const types = (rows, ctx = {}) => B.analyze(rows, ctx).findings;
function finding(rows, type, ctx = {}) { const f = types(rows, ctx).find(f => f.type === type); assert.ok(f, `missing ${type}`); return f; }
test('recurringIncome over three months and own-account exclusions', () => {
  const rows = ['01', '02', '03'].map(m => tx(`2026-${m}-01`, 'העברה דני כהן', 3000));
  assert.equal(finding(rows, 'recurringIncome').monthly, 3000);
  assert.equal(types(rows, { ownAccounts: ['דני כהן'] }).length, 0);
});
test('wallet requires five credits and ignores debits', () => {
  const rows = Array.from({ length: 5 }, (_, i) => tx('2026-01-01', `ביט לקוח ${i}`, 1000));
  assert.equal(finding(rows, 'wallet').amount, 5000);
  assert.ok(!types(rows.slice(0, 4)).some(f => f.type === 'wallet'));
});
test('cashIn and checks use their own totals', () => {
  assert.equal(finding([tx('2026-01-01', 'הפקדת מזומן', 2000)], 'cashIn').amount, 2000);
  const rows = Array.from({ length: 3 }, () => tx('2026-01-01', 'הפקדת שיק', 1000));
  assert.equal(finding(rows, 'checks').amount, 3000);
  assert.ok(!types(rows.slice(0, 2)).some(f => f.type === 'checks'));
});
test('incomeGap and VAT thresholds; salaries excluded from business turnover', () => {
  const rows = [tx('2026-01-01', 'משכורת', 10000), tx('2026-01-05', 'העברה לקוח', 6000)];
  assert.equal(finding(rows, 'incomeGap', { declared: { salaryNet: 10000 } }).monthly, 6000);
  assert.equal(finding(rows, 'vat', { vatTurnover: 50000 }).amount, 22000);
  assert.ok(!types([rows[0]], { vatTurnover: 50000 }).some(f => f.type === 'vat'));
});
test('bigOut excludes ordinary card, tax and loan payments and post-crisis rows', () => {
  const rows = [tx('2026-09-01', 'העברה לאדם', -20000), tx('2026-09-01', 'ויזה', -20000), tx('2026-09-01', 'מס הכנסה', -20000), tx('2026-09-01', 'הלוואה', -20000), tx('2026-11-01', 'העברה לאדם', -30000)];
  const fs = types(rows, { crisisDate: '2026-10-01', lookbackMonths: 2 });
  assert.equal(fs.filter(f => f.type === 'bigOut').length, 1);
  assert.equal(fs.find(f => f.type === 'bigOut').amount, 20000);
});
test('cashSpike compares before and crisis-window rates', () => {
  const rows = [tx('2026-01-01', 'משיכת מזומן', -1000), tx('2026-09-01', 'משיכת מזומן', -5000)];
  assert.equal(finding(rows, 'cashSpike', { crisisDate: '2026-10-01', lookbackMonths: 2 }).monthly, 4000);
});
test('crypto transfers before crisis detected independently of large transaction threshold', () => {
  assert.equal(finding([tx('2026-09-01', 'Coinbase', -1000)], 'crypto', { crisisDate: '2026-10-01' }).amount, 1000);
});
test('incomeGap overlap warnings include marked sources and ignore dismissed findings', () => {
  const fs = [{ type: 'incomeGap' }, { type: 'wallet', asAsset: true }, { type: 'cashIn', asAsset: true, status: 'dismissed' }];
  assert.deepEqual(B.overlappingIncome(fs), [fs[1]]);
  assert.equal(B.overlappingIncome(fs.slice(1)).length, 0);
});
