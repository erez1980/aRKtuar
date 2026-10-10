/* ==========================================================================
   aRKtuar AI - balancing engine (pure functions, no DOM, no network)
   Implements a simplified resources-balancing model in the spirit of the
   Israeli Spouses Property Relations Law (1973): each spouse's net marital
   resources accrued between the marriage date and the crisis date are
   summed, and the spouse with more pays half of the difference.
   Works in the browser (window.ArkEngine) and in Node (module.exports).
   ========================================================================== */
(function (root) {
  'use strict';

  // ---------- Category catalogue ----------
  // kind: how the item is valued
  //   'asset'     value (- debt) * share
  //   'accrual'   savings accrued over time, pro-rated to marital period (pension, gemel...)
  //   'vesting'   equity compensation pro-rated by grant/vest dates (time rule)
  //   'gain'      tax applies to the gain only (value - cost)
  //   'debt'      liability, entered as a positive amount and subtracted
  // tax: default tax rate (%) for the net-after-tax view
  // taxOn: 'value' | 'gain'
  const CATS = {
    realestate: { label: 'נדל״ן',                 icon: '🏠', kind: 'asset',   tax: 0,  taxOn: 'gain' },
    pension:    { label: 'קרן פנסיה',             icon: '🧓', kind: 'accrual', tax: 15, taxOn: 'value' },
    managers:   { label: 'ביטוח מנהלים',          icon: '📜', kind: 'accrual', tax: 15, taxOn: 'value' },
    gemel:      { label: 'קופת גמל',              icon: '🏦', kind: 'accrual', tax: 15, taxOn: 'value' },
    gemelInv:   { label: 'גמל להשקעה',            icon: '📈', kind: 'accrual', tax: 25, taxOn: 'gain' },
    hishtalmut: { label: 'קרן השתלמות',           icon: '🎓', kind: 'accrual', tax: 0,  taxOn: 'value' },
    severance:  { label: 'פיצויים (קופה/מעסיק)',  icon: '📦', kind: 'accrual', tax: 20, taxOn: 'value' },
    bank:       { label: 'עו״ש ופיקדונות',        icon: '💳', kind: 'asset',   tax: 0,  taxOn: 'value' },
    securities: { label: 'ניירות ערך',            icon: '📊', kind: 'gain',    tax: 25, taxOn: 'gain' },
    crypto:     { label: 'קריפטו',                icon: '🪙', kind: 'gain',    tax: 25, taxOn: 'gain' },
    rsu:        { label: 'RSU / אופציות',         icon: '🧾', kind: 'vesting', tax: 25, taxOn: 'value' },
    business:   { label: 'עסק / שותפות',          icon: '🏢', kind: 'asset',   tax: 0,  taxOn: 'value' },
    vehicle:    { label: 'רכב',                   icon: '🚗', kind: 'asset',   tax: 0,  taxOn: 'value' },
    foreign:    { label: 'נכס / חשבון בחו״ל',     icon: '🌍', kind: 'asset',   tax: 0,  taxOn: 'value' },
    receivable: { label: 'הלוואה שניתנה לאחר',    icon: '🤝', kind: 'asset',   tax: 0,  taxOn: 'value' },
    insurance:  { label: 'פוליסת חיסכון',         icon: '🛡️', kind: 'accrual', tax: 25, taxOn: 'gain' },
    other:      { label: 'נכס אחר',               icon: '💎', kind: 'asset',   tax: 0,  taxOn: 'value' },
    debt:       { label: 'חוב / הלוואה',          icon: '➖', kind: 'debt',    tax: 0,  taxOn: 'value' },
    hidden:     { label: 'ממצא מדפי בנק',         icon: '🔎', kind: 'asset',   tax: 0,  taxOn: 'value' }
  };
  const PENSION_CATS = ['pension', 'managers', 'gemel', 'severance'];

  const DAY = 86400000;
  function toTime(s) {
    if (!s) return NaN;
    const m = String(s).match(/^(\d{4})-(\d{2})(?:-(\d{2}))?/);
    if (!m) return NaN;
    return Date.UTC(+m[1], +m[2] - 1, m[3] ? +m[3] : 1);
  }
  const num = v => { const n = typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(/[₪,\s]/g, '')); return isFinite(n) ? n : 0; };
  const clamp01 = x => Math.max(0, Math.min(1, x));

  function newState() {
    return {
      v: 1,
      meta: { caseName: '', marriageDate: '', crisisDate: '', regime: 'balance', reportDate: '' },
      spouses: {
        A: { name: 'בן/בת זוג א׳', employment: 'salaried', flags: {} },
        B: { name: 'בן/בת זוג ב׳', employment: 'salaried', flags: {} }
      },
      items: [],
      incomes: { A: { salaryNet: 0, businessDeclared: 0, otherDeclared: 0 }, B: { salaryNet: 0, businessDeclared: 0, otherDeclared: 0 } },
      bank: { A: { tx: [], findings: [], files: [] }, B: { tx: [], findings: [], files: [] } },
      docs: {},
      kids: [],
      support: { date: '', selfExpenses: { A: 0, B: 0 }, realOverride: { A: '', B: '' } },
      settings: { largeTx: 10000, lookbackMonths: 12 }
    };
  }

  function newItem(partial) {
    const cat = (partial && partial.cat) || 'other';
    return Object.assign({
      id: 'i' + Math.random().toString(36).slice(2, 10),
      cat, owner: 'A', label: '',
      value: 0,          // market value / balance at crisis date
      debt: 0,           // mortgage or lien attached to this asset
      cost: 0,           // cost basis (for gain-taxed items)
      share: 100,        // % owned by the owner (joint items are split 50/50 regardless)
      startDate: '',     // accrual start (fund join date / grant date / purchase date)
      endDate: '',       // vesting end date (RSU)
      preMarital: 0,     // value that belonged to the owner on the marriage date (excluded)
      excluded: false,   // excluded entirely (inheritance, gift, pre-marital asset)
      excludedReason: '',
      sharedIntent: false, // specific sharing (e.g. pre-marital family home) - include despite pre-marital
      familyDebt: true,  // debts: taken for family needs (shared) vs personal
      taxPct: CATS[cat] ? CATS[cat].tax : 0,
      notes: '', source: 'manual', confidence: null
    }, partial || {});
  }

  // Fraction of an accrual period that falls inside the marriage
  function maritalFraction(startDate, marriageDate, crisisDate) {
    const s = toTime(startDate), m = toTime(marriageDate), c = toTime(crisisDate);
    if (!isFinite(c)) return 1;
    if (!isFinite(s)) return 1;
    if (s >= c) return 0;
    const from = isFinite(m) ? Math.max(s, m) : s;
    return clamp01((c - from) / (c - s));
  }

  // Time rule for equity grants: portion of the vesting period that was
  // inside the marriage and before the crisis date.
  function vestingFraction(grantDate, vestEnd, marriageDate, crisisDate) {
    const g = toTime(grantDate), e = toTime(vestEnd), m = toTime(marriageDate), c = toTime(crisisDate);
    if (!isFinite(g)) return 1;
    const end = isFinite(e) ? e : (isFinite(c) ? c : g);
    if (end <= g) return isFinite(m) && g < m ? 0 : 1;
    const from = isFinite(m) ? Math.max(g, m) : g;
    const to = isFinite(c) ? Math.min(end, c) : end;
    return clamp01((to - from) / (end - g));
  }

  // Value one item -> { gross, net, factor, status, note }
  function valueItem(it, meta) {
    const cat = CATS[it.cat] || CATS.other;
    const res = { gross: 0, net: 0, factor: 1, status: 'in', note: '' };
    if (it.excluded) { res.status = 'excluded'; res.note = it.excludedReason || 'הוחרג'; return res; }

    const v = num(it.value), d = num(it.debt), cost = num(it.cost), pre = num(it.preMarital);
    const share = it.owner === 'J' ? 1 : clamp01(num(it.share ?? 100) / 100);
    const taxPct = clamp01(num(it.taxPct) / 100);

    if (cat.kind === 'debt') {
      if (!it.familyDebt) { res.status = 'excluded'; res.note = 'חוב אישי שלא נלקח לצורכי המשפחה'; return res; }
      res.gross = -v * share;
      res.net = res.gross;
      return res;
    }

    let base = (v - d) * share;
    let gain = (v - cost) * share;

    if (cat.kind === 'accrual') {
      const f = it.startDate ? maritalFraction(it.startDate, meta.marriageDate, meta.crisisDate) : 1;
      res.factor = f;
      if (f < 1) res.note = `חלק יחסי לתקופת הנישואין ${(f * 100).toFixed(0)}%`;
      base = base * f;
      gain = gain * f;
      if (pre > 0) { base -= pre; gain -= pre; res.note = (res.note ? res.note + ' · ' : '') + 'בניכוי יתרה מלפני הנישואין'; }
    } else if (cat.kind === 'vesting') {
      const f = vestingFraction(it.startDate, it.endDate, meta.marriageDate, meta.crisisDate);
      res.factor = f;
      res.note = `כלל הזמן: ${(f * 100).toFixed(0)}% מתקופת ההבשלה בתוך הנישואין`;
      base = base * f;
      gain = gain * f;
    } else {
      if (pre > 0 && !it.sharedIntent) {
        // Pre-marital value is excluded; growth during marriage stays in
        base -= pre * share;
        gain -= pre * share;
        res.note = 'בניכוי שווי מלפני הנישואין';
      }
      if (it.sharedIntent && pre > 0) res.note = 'נכלל במלואו בשל כוונת שיתוף ספציפית';
    }

    res.gross = base;
    const taxBase = cat.taxOn === 'gain' ? Math.max(0, Math.min(gain, base)) : Math.max(0, base);
    res.net = base - taxBase * taxPct;
    return res;
  }

  // Main calculation
  // opts.includeFindings: include 'hidden' items (bank findings)
  function compute(state, opts) {
    opts = opts || {};
    const meta = state.meta || {};
    const out = {
      perSpouse: { A: { gross: 0, net: 0, pensionGross: 0, pensionNet: 0, byCat: {} }, B: { gross: 0, net: 0, pensionGross: 0, pensionNet: 0, byCat: {} } },
      joint: { gross: 0, net: 0 },
      rows: [], excluded: [], transfer: null
    };
    for (const it of state.items || []) {
      if (it.cat === 'hidden' && !opts.includeFindings) continue;
      const r = valueItem(it, meta);
      const row = Object.assign({ item: it }, r);
      if (r.status === 'excluded') { out.excluded.push(row); continue; }
      out.rows.push(row);
      const isPension = PENSION_CATS.includes(it.cat);
      const add = (who, g, n) => {
        const s = out.perSpouse[who];
        s.gross += g; s.net += n;
        s.byCat[it.cat] = s.byCat[it.cat] || { gross: 0, net: 0 };
        s.byCat[it.cat].gross += g; s.byCat[it.cat].net += n;
        if (isPension) { s.pensionGross += g; s.pensionNet += n; }
      };
      if (it.owner === 'J') {
        out.joint.gross += r.gross; out.joint.net += r.net;
        add('A', r.gross / 2, r.net / 2);
        add('B', r.gross / 2, r.net / 2);
      } else {
        add(it.owner === 'B' ? 'B' : 'A', r.gross, r.net);
      }
    }
    out.transfer = transferFrom(out.perSpouse);
    return out;
  }

  function transferFrom(ps) {
    const t = side => {
      const diff = ps.A[side] - ps.B[side];
      return { from: diff >= 0 ? 'A' : 'B', to: diff >= 0 ? 'B' : 'A', amount: Math.abs(diff) / 2 };
    };
    const gross = t('gross'), net = t('net');
    // Pension component of the balancing (can be done by in-source split)
    const pDiff = ps.A.pensionGross - ps.B.pensionGross;
    const pensionPart = pDiff / 2;           // signed, positive = A owes B
    const totalSigned = (ps.A.gross - ps.B.gross) / 2;
    return {
      gross, net,
      pensionInSource: { from: pensionPart >= 0 ? 'A' : 'B', amount: Math.abs(pensionPart) },
      remainderAfterPension: { from: (totalSigned - pensionPart) >= 0 ? 'A' : 'B', amount: Math.abs(totalSigned - pensionPart) }
    };
  }

  const api = { CATS, PENSION_CATS, newState, newItem, valueItem, compute, maritalFraction, vestingFraction, num, toTime };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ArkEngine = api;
})(typeof window !== 'undefined' ? window : globalThis);
