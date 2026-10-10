/* Child-support scenarios. Pure estimates, not a legal determination. */
(function (root) {
  'use strict';
  const num = v => Number.isFinite(+v) ? +v : 0;
  const positive = v => Math.max(0, num(v));
  const own = (o, k) => Object.prototype.hasOwnProperty.call(o || {}, k);
  function ageOn(birth, date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(birth || '') || !/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return null;
    const b = new Date(birth + 'T00:00:00Z'), d = new Date(date + 'T00:00:00Z');
    if (!Number.isFinite(+b) || !Number.isFinite(+d) || b.toISOString().slice(0, 10) !== birth || d.toISOString().slice(0, 10) !== date || b > d) return null;
    return d.getUTCFullYear() - b.getUTCFullYear() - (d.toISOString().slice(5, 10) < b.toISOString().slice(5, 10) ? 1 : 0);
  }
  function defaults() { return { date: '', selfExpenses: { A: 0, B: 0 }, realOverride: { A: '', B: '' } }; }
  function income(state, who, mode) {
    const inc = (state.incomes || {})[who] || {}, bank = ((state.bank || {})[who] || {}).summary;
    const declared = positive(inc.salaryNet) + positive(inc.businessDeclared) + positive(inc.otherDeclared);
    const settings = state.support || defaults();
    const override = (settings.realOverride || {})[who];
    if (mode === 'real' && override != null && override !== '') return { value: positive(override), source: 'manual' };
    if (mode === 'real' && bank && bank.months > 0 && Number.isFinite(bank.realMonthly)) return { value: positive(bank.realMonthly), source: 'bank' };
    if (mode === 'real') return { value: declared, source: 'declaredFallback' };
    return { value: own(inc, 'salaryNet') || own(inc, 'businessDeclared') || own(inc, 'otherDeclared') ? declared : positive(bank && bank.declaredMonthly), source: 'declared' };
  }
  function compute(state, mode, asOf) {
    const settings = state.support || defaults();
    const date = settings.date || asOf || new Date().toISOString().slice(0, 10);
    const incomes = { A: income(state, 'A', mode), B: income(state, 'B', mode) };
    const available = { A: Math.max(0, incomes.A.value - positive((settings.selfExpenses || {}).A)), B: Math.max(0, incomes.B.value - positive((settings.selfExpenses || {}).B)) };
    const totalIncome = available.A + available.B;
    const shares = { A: totalIncome ? available.A / totalIncome : 0.5, B: totalIncome ? available.B / totalIncome : 0.5 };
    const warnings = [], rows = [], excluded = [];
    if (!totalIncome) warnings.push('לא הוזנה הכנסה פנויה חיובית; חלוקה שווה מוצגת כהמחשה בלבד.');
    if (mode === 'real') for (const who of ['A', 'B']) {
      if (incomes[who].source === 'declaredFallback') warnings.push(`${who}: אין נתוני הכנסה בפועל; נעשה שימוש בהכנסה המדווחת.`);
      if (incomes[who].source === 'bank') warnings.push(`${who}: הזיכויים בדפי הבנק הם אינדיקציה בלבד, ועשויים לכלול העברות או מחזור עסקי שאינם הכנסה נטו פנויה.`);
    }
    let signed = 0;
    for (const [index, child] of (state.kids || []).entries()) {
      const age = ageOn(child.birth, date);
      const band = age == null ? null : age < 6 ? '0–6' : age < 15 ? '6–15' : age < 18 ? '15–18' : '18+';
      const fail = reason => excluded.push({ index, child, age, band, reason });
      if (age == null) { fail('חסר תאריך לידה תקין או תאריך חישוב'); continue; }
      if (age >= 18) { fail('גיל 18 ומעלה: שירות צבאי/לאומי והמשך חיוב אינם כלולים'); continue; }
      const s = child.support || {};
      if (!own(s, 'daysA') || !own(s, 'daysB') || num(s.daysA) < 0 || num(s.daysB) < 0 || num(s.daysA) + num(s.daysB) <= 0) { fail('הזינו זמני שהות לשני ההורים באותה תקופה'); continue; }
      if (!(positive(s.basic) > 0)) { fail('הזינו צרכים בסיסיים חודשיים'); continue; }
      if (age < 6 && !['A', 'B'].includes(s.under6Payer)) { fail('מתחת לגיל 6: בחרו הורה חייב לצורך ההמחשה לאחר בירור הדין האישי'); continue; }
      if (!['A', 'B'].includes(s.expensePayer) && positive(s.housing) + positive(s.education) + positive(s.health) + positive(s.activities) > 0) { fail('בחרו מי משלם בפועל את המדור וההוצאות המיוחדות'); continue; }
      const custodyA = positive(s.daysA) / (positive(s.daysA) + positive(s.daysB));
      const basic = positive(s.basic), housing = positive(s.housing), special = positive(s.education) + positive(s.health) + positive(s.activities);
      const needs = basic + housing + special;
      // Time-dependent needs are assumed paid directly during custody.
      // Fixed expenses are assumed paid by the explicitly selected parent.
      const directA = basic * custodyA + (s.expensePayer === 'A' ? housing + special : 0);
      const targetA = age < 6 ? (s.under6Payer === 'A' ? basic + housing : 0) + shares.A * special : shares.A * needs;
      const payment = targetA - directA;
      signed += payment;
      rows.push({ index, child, age, band, custodyA, needs, basic, housing, special, directA, targetA, signed: payment, from: payment >= 0 ? 'A' : 'B', to: payment >= 0 ? 'B' : 'A', amount: Math.abs(payment) });
    }
    return { mode, date, incomes, available, shares, rows, excluded, warnings, complete: excluded.length === 0, transfer: { from: signed >= 0 ? 'A' : 'B', to: signed >= 0 ? 'B' : 'A', amount: Math.abs(signed) } };
  }
  const api = { defaults, ageOn, income, compute };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ArkSupport = api;
})(typeof window !== 'undefined' ? window : globalThis);
