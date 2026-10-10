/* ==========================================================================
   aRKtuar AI - bank statement parsing and forensic heuristics
   Pure functions, no DOM, no network. Runs entirely in the browser.
   Input: rows (array of arrays) from CSV / Excel exports of Israeli banks.
   Output: normalized transactions + findings about income sources that
   may not be declared, cash patterns and pre-crisis anomalies.
   ========================================================================== */
(function (root) {
  'use strict';

  const num = v => {
    if (v == null || v === '') return 0;
    if (typeof v === 'number') return isFinite(v) ? v : 0;
    let s = String(v).replace(/[₪,\s‎‏]/g, '');
    let neg = false;
    if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
    if (/-$/.test(s)) { neg = true; s = s.slice(0, -1); }
    const f = parseFloat(s);
    return isFinite(f) ? (neg ? -Math.abs(f) : f) : 0;
  };
  const pad = n => String(n).padStart(2, '0');

  // Parse a date cell into 'YYYY-MM-DD'
  function parseDate(v) {
    if (v == null || v === '') return '';
    if (typeof v === 'number' && v > 20000 && v < 80000) { // Excel serial
      const d = new Date(Math.round((v - 25569) * 86400000));
      return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
    }
    if (v instanceof Date && !isNaN(v)) return `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())}`;
    const s = String(v).trim();
    let m;
    if ((m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/))) {
      let y = +m[3]; if (y < 100) y += 2000;
      return `${y}-${pad(m[2])}-${pad(m[1])}`;
    }
    if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})/))) return `${m[1]}-${m[2]}-${m[3]}`;
    return '';
  }

  // ---------- CSV ----------
  function parseCSV(text) {
    text = String(text || '').replace(/^﻿/, '');
    const first = text.split(/\r?\n/).find(l => l.trim()) || '';
    const delim = [',', ';', '\t', '|'].sort((a, b) => first.split(b).length - first.split(a).length)[0];
    const rows = []; let row = [], cell = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
        else cell += c;
      } else if (c === '"') q = true;
      else if (c === delim) { row.push(cell); cell = ''; }
      else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
      else if (c !== '\r') cell += c;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return rows;
  }

  // ---------- Column detection ----------
  const H = {
    date: /^(תאריך(\s*(ה)?פעולה|\s*ערך)?|date|תאריך)$/i,
    desc: /(תיאור|פרטים|הפעולה|סוג\s*פעולה|description|שם\s*בית\s*העסק|פירוט)/i,
    credit: /(זכות|בזכות|הכנסה|credit|זיכוי)/i,
    debit: /(חובה|בחובה|הוצאה|debit|חיוב)/i,
    amount: /(^סכום|amount|סכום\s*(ה)?פעולה|סכום\s*בש"ח)/i,
    balance: /(יתרה|balance)/i,
    ref: /(אסמכתא|reference)/i,
    extra: /(הערות|פרטים\s*נוספים|לטובת|עבור|מאת)/i
  };

  function detectHeader(rows) {
    for (let r = 0; r < Math.min(rows.length, 40); r++) {
      const cells = (rows[r] || []).map(c => String(c ?? '').trim());
      const find = re => cells.findIndex(c => c && re.test(c));
      const date = cells.findIndex(c => /^תאריך|^date/i.test(c));
      const desc = find(H.desc);
      const credit = find(H.credit), debit = find(H.debit), amount = find(H.amount);
      if (date >= 0 && desc >= 0 && (amount >= 0 || (credit >= 0 && debit >= 0))) {
        const extra = cells.findIndex((c, i) => i !== desc && H.extra.test(c));
        return { row: r, date, desc, credit, debit, amount: (credit >= 0 && debit >= 0) ? -1 : amount, balance: find(H.balance), extra };
      }
    }
    return null;
  }

  function rowsToTransactions(rows, map) {
    map = map || detectHeader(rows);
    if (!map) return { tx: [], error: 'לא זוהו עמודות תאריך, תיאור וסכום בקובץ' };
    const tx = [];
    for (let r = map.row + 1; r < rows.length; r++) {
      const c = rows[r] || [];
      const date = parseDate(c[map.date]);
      if (!date) continue;
      let amount = map.amount >= 0 ? num(c[map.amount]) : num(c[map.credit]) - Math.abs(num(c[map.debit]));
      if (!amount) continue;
      let desc = String(c[map.desc] ?? '').trim();
      if (map.extra >= 0 && c[map.extra]) desc += ' | ' + String(c[map.extra]).trim();
      tx.push({ date, desc, amount, balance: map.balance >= 0 ? num(c[map.balance]) : null });
    }
    tx.sort((a, b) => a.date.localeCompare(b.date));
    return { tx, map };
  }

  // ---------- Classification ----------
  const RULES = [
    ['salary',     /משכורת|שכר|מש"כ|משכ'|salary|payroll/i],
    ['wallet',     /\bbit\b|ביט|פייבוקס|paybox|pepper\s*pay|פייפאל|paypal|apple\s*cash/i],
    ['cashIn',     /הפקדת\s*מזומן|הפק['.]?\s*מזומן|הפקדה\s*במזומן|מזומן\s*בקופה|הפקדה\s*בכספומט/i],
    ['cashOut',    /משיכ[הת]?\s*(מ)?מזומן|כספומט|מש['.]?\s*מזומן|\batm\b|משיכה\s*מבנקט/i],
    ['check',      /שיק|צ'ק|צק\b|המחא/i],
    ['tax',        /מע"מ|מעמ|מס\s*הכנסה|ביטוח\s*לאומי|מקדמ|רשות\s*המסים|מס\s*שבח/i],
    ['benefit',    /קצבת\s*ילדים|קצבה|דמי\s*אבטלה|דמי\s*לידה|מילואים|החזר\s*מס/i],
    ['card',       /ישראכרט|כאל|\bmax\b|מקס\s*איט|לאומי\s*קארד|ויזה|visa|אמריקן\s*אקספרס|דיינרס|כרטיס\s*אשראי/i],
    ['loan',       /הלוואה|הלוואת|פירעון|משכנתא|משכנתה/i],
    ['invest',     /ני"ע|ניירות\s*ערך|פיקדון|פקדון|קניה\s*ני|מכירה\s*ני|דיבידנד|ריבית\s*זכות|קרן\s*כספית/i],
    ['crypto',     /binance|coinbase|kraken|bit2c|bits\s*of\s*gold|ביטס\s*אוף\s*גולד|קריפטו|crypto/i],
    ['transfer',   /העברה|העב['.]|העב\s|זיכוי\s*מ|ה\.ב|העברת|מסלקה|swift|הפקדה\s*מ/i],
    ['refund',     /החזר|זיכוי\s*עסקה|ביטול/i]
  ];

  function classify(desc, amount, ctx) {
    const d = String(desc || '');
    const low = d.toLowerCase();
    if (ctx && ctx.ownAccounts && ctx.ownAccounts.some(a => a && low.includes(a.toLowerCase()))) return 'internal';
    if (ctx && ctx.employers && amount > 0 && ctx.employers.some(e => e && low.includes(e.toLowerCase()))) return 'salary';
    for (const [k, re] of RULES) if (re.test(d)) return k;
    return amount > 0 ? 'otherIn' : 'otherOut';
  }

  const STOP = new Set(['העברה', 'העב', "העב'", 'העברת', 'זיכוי', 'מ', 'ל', 'הפקדה', 'bit', 'ביט', 'פייבוקס', 'paybox', 'מאת', 'עבור', 'לטובת', 'באמצעות', 'ב']);
  // Normalize a description into a counterparty key
  function counterparty(desc) {
    return String(desc || '')
      .replace(/\|.*$/, '')
      .replace(/\d{3,}/g, '')
      .replace(/[^֐-׿a-zA-Z\s'"]/g, ' ')
      .split(/\s+/)
      // Hebrew has no \b word boundary in JS regex, so stop words are filtered per token
      .filter(w => w && !STOP.has(w.toLowerCase()))
      .join(' ').trim().slice(0, 40) || '(ללא תיאור)';
  }

  const LABELS = {
    salary: 'משכורת', wallet: 'ביט / פייבוקס / PayPal', cashIn: 'הפקדת מזומן', cashOut: 'משיכת מזומן',
    check: 'שיקים', tax: 'מיסים / ביטוח לאומי', benefit: 'קצבאות', card: 'חברות אשראי', loan: 'הלוואות',
    invest: 'השקעות / פיקדונות', crypto: 'קריפטו', transfer: 'העברות', refund: 'החזרים',
    internal: 'העברה בין חשבונות עצמיים', otherIn: 'זיכוי אחר', otherOut: 'חיוב אחר'
  };

  const monthOf = d => d.slice(0, 7);
  const sum = arr => arr.reduce((a, t) => a + t.amount, 0);

  // ---------- Analysis ----------
  // ctx: { employers:[], ownAccounts:[], declared:{ salaryNet, businessDeclared, otherDeclared } (monthly),
  //        crisisDate, largeTx, lookbackMonths, vatTurnover (annual, optional) }
  function analyze(tx, ctx) {
    ctx = ctx || {};
    const largeTx = ctx.largeTx || 10000;
    const lookback = ctx.lookbackMonths || 12;
    const all = tx.map(t => Object.assign({}, t, { cls: t.cls || classify(t.desc, t.amount, ctx), cp: counterparty(t.desc) }));
    const months = Array.from(new Set(all.map(t => monthOf(t.date)))).sort();
    const nMonths = Math.max(1, months.length);
    const credits = all.filter(t => t.amount > 0);
    const findings = [];
    const F = (o) => findings.push(Object.assign({ id: 'f' + Math.random().toString(36).slice(2, 9), status: 'open', asAsset: false, assetValue: 0 }, o));

    // Totals by class
    const byCls = {};
    for (const t of all) {
      const k = t.cls; byCls[k] = byCls[k] || { in: 0, out: 0, n: 0 };
      if (t.amount > 0) byCls[k].in += t.amount; else byCls[k].out += -t.amount;
      byCls[k].n++;
    }

    // 1) Recurring non-salary income sources (possible undeclared income)
    const nonSalaryIn = credits.filter(t => !['salary', 'internal', 'refund', 'benefit', 'loan', 'invest', 'card'].includes(t.cls));
    const groups = {};
    // Cash and checks get their own findings below, so they are not grouped by counterparty
    for (const t of nonSalaryIn.filter(x => x.cls !== 'cashIn' && x.cls !== 'check')) {
      const k = t.cls + '::' + t.cp;
      const g = groups[k] = groups[k] || { cls: t.cls, cp: t.cp, total: 0, n: 0, months: new Set(), tx: [] };
      g.total += t.amount; g.n++; g.months.add(monthOf(t.date)); g.tx.push(t);
    }
    Object.values(groups)
      .filter(g => g.months.size >= 3 || g.total >= largeTx * 2)
      .sort((a, b) => b.total - a.total)
      .slice(0, 25)
      .forEach(g => F({
        type: 'recurringIncome', severity: g.total >= largeTx * 5 ? 'high' : 'mid',
        title: `מקור הכנסה חוזר: ${g.cp}`,
        detail: `${LABELS[g.cls] || g.cls} · ${g.n} זיכויים ב־${g.months.size} חודשים · ממוצע חודשי ${Math.round(g.total / nMonths).toLocaleString('he-IL')} ₪`,
        amount: g.total, monthly: g.total / nMonths, cp: g.cp, cls: g.cls
      }));

    // 2) Digital wallets (typical channel for unreported small-business income)
    const wallet = credits.filter(t => t.cls === 'wallet');
    if (wallet.length >= 5) {
      const payers = new Set(wallet.map(t => t.cp)).size;
      F({ type: 'wallet', severity: payers >= 10 ? 'high' : 'mid', title: 'זיכויים בביט / פייבוקס / PayPal',
        detail: `${wallet.length} זיכויים מ־${payers} משלמים שונים. ריבוי משלמים בסכומים דומים מאפיין הכנסה עסקית.`,
        amount: sum(wallet), monthly: sum(wallet) / nMonths });
    }

    // 3) Cash and checks deposited
    const cashIn = credits.filter(t => t.cls === 'cashIn');
    if (cashIn.length) F({ type: 'cashIn', severity: sum(cashIn) >= largeTx * 3 ? 'high' : 'mid', title: 'הפקדות מזומן',
      detail: `${cashIn.length} הפקדות. מקור המזומן דורש הסבר ותיעוד.`, amount: sum(cashIn), monthly: sum(cashIn) / nMonths });
    const checks = credits.filter(t => t.cls === 'check');
    if (checks.length >= 3) F({ type: 'checks', severity: 'mid', title: 'הפקדות שיקים',
      detail: `${checks.length} שיקים שהופקדו. כדאי לבקש צילומי שיקים כדי לזהות את המשלמים.`, amount: sum(checks), monthly: sum(checks) / nMonths });

    // 4) Real income vs declared
    const salaryIn = sum(credits.filter(t => t.cls === 'salary'));
    const unexplained = sum(nonSalaryIn);
    const decl = ctx.declared || {};
    const declaredMonthly = (+decl.salaryNet || 0) + (+decl.businessDeclared || 0) + (+decl.otherDeclared || 0);
    const realMonthly = (salaryIn + unexplained) / nMonths;
    const gap = realMonthly - declaredMonthly;
    if (declaredMonthly > 0 && gap > declaredMonthly * 0.15 && gap > 2000) {
      F({ type: 'incomeGap', severity: gap > declaredMonthly * 0.5 ? 'high' : 'mid', title: 'פער בין הכנסה בפועל להכנסה המדווחת',
        detail: `נכנסים בפועל בממוצע ${Math.round(realMonthly).toLocaleString('he-IL')} ₪ לחודש, מול ${Math.round(declaredMonthly).toLocaleString('he-IL')} ₪ מדווחים. פער של כ־${Math.round(gap).toLocaleString('he-IL')} ₪ לחודש.`,
        amount: gap * nMonths, monthly: gap });
    }

    // 5) VAT turnover check for licensed dealers (oseק murshe)
    if (+ctx.vatTurnover > 0) {
      const annualized = (unexplained / nMonths) * 12;
      if (annualized > +ctx.vatTurnover * 1.15) {
        F({ type: 'vat', severity: 'high', title: 'זיכויים עסקיים מעל המחזור המדווח למע״מ',
          detail: `זיכויים שאינם משכורת בהיקף שנתי של כ־${Math.round(annualized).toLocaleString('he-IL')} ₪, מול מחזור מדווח של ${Math.round(+ctx.vatTurnover).toLocaleString('he-IL')} ₪.`,
          amount: annualized - +ctx.vatTurnover, monthly: (annualized - +ctx.vatTurnover) / 12 });
      }
    }

    // 6) Pre-crisis anomalies: large outflows and cash withdrawal spikes
    if (ctx.crisisDate) {
      const c = new Date(ctx.crisisDate + 'T00:00:00Z');
      const from = new Date(c); from.setUTCMonth(from.getUTCMonth() - lookback);
      const fromS = from.toISOString().slice(0, 10), cS = ctx.crisisDate;
      const win = all.filter(t => t.date >= fromS && t.date <= cS);
      const before = all.filter(t => t.date < fromS);
      const bigOut = win.filter(t => t.amount < 0 && -t.amount >= largeTx && !['card', 'tax', 'loan'].includes(t.cls));
      bigOut.sort((a, b) => a.amount - b.amount).slice(0, 15).forEach(t => F({
        type: 'bigOut', severity: -t.amount >= largeTx * 5 ? 'high' : 'mid',
        title: `יציאה חריגה לפני הקרע: ${Math.round(-t.amount).toLocaleString('he-IL')} ₪`,
        detail: `${t.date} · ${t.desc}`, amount: -t.amount, date: t.date }));
      const cashW = win.filter(t => t.cls === 'cashOut');
      const cashB = before.filter(t => t.cls === 'cashOut');
      const winMonths = Math.max(1, new Set(win.map(t => monthOf(t.date))).size);
      const befMonths = Math.max(1, new Set(before.map(t => monthOf(t.date))).size);
      const rateW = -sum(cashW) / winMonths, rateB = -sum(cashB) / befMonths;
      if (cashW.length && (cashB.length ? rateW > rateB * 1.5 && rateW - rateB > 1500 : rateW > 3000)) {
        F({ type: 'cashSpike', severity: 'mid', title: 'עלייה במשיכות מזומן לפני הקרע',
          detail: `ממוצע חודשי של ${Math.round(rateW).toLocaleString('he-IL')} ₪ ב־${lookback} החודשים שלפני הקרע${cashB.length ? `, לעומת ${Math.round(rateB).toLocaleString('he-IL')} ₪ קודם לכן` : ''}.`,
          amount: (rateW - rateB) * winMonths, monthly: rateW - rateB });
      }
      const cryptoOut = win.filter(t => t.cls === 'crypto' && t.amount < 0);
      if (cryptoOut.length) F({ type: 'crypto', severity: 'high', title: 'העברות לפלטפורמות קריפטו',
        detail: `${cryptoOut.length} העברות לפני הקרע. יש לבקש דוחות מהבורסות הרלוונטיות.`, amount: -sum(cryptoOut) });
    }

    return {
      months: months.length, from: months[0] || '', to: months[months.length - 1] || '',
      totals: { credits: sum(credits), debits: -sum(all.filter(t => t.amount < 0)), salaryIn, unexplained },
      realMonthly, declaredMonthly, gap, byCls, findings, labels: LABELS,
      // Aggregated, anonymized view that can be sent to AI for a second opinion
      aiDigest: Object.values(groups).sort((a, b) => b.total - a.total).slice(0, 60)
        .map(g => ({ cp: g.cp, cls: g.cls, total: Math.round(g.total), count: g.n, months: g.months.size }))
    };
  }

  const api = { parseCSV, parseDate, detectHeader, rowsToTransactions, classify, counterparty, analyze, LABELS, num };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ArkBank = api;
})(typeof window !== 'undefined' ? window : globalThis);
