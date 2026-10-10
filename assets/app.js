/* ==========================================================================
   aRKtuar AI - application UI
   State lives in memory. Optional draft in localStorage (off by default).
   ========================================================================== */
(function () {
  'use strict';
  const E = window.ArkEngine, BK = window.ArkBank, AI = window.ArkAI, M = window.Mislaka;
  const CFG = window.ARK_CONFIG || {};
  const DRAFT_KEY = 'ark-draft-v1', DRAFT_FLAG = 'ark-draft-on';

  // ---------- Utils ----------
  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = v => (v < 0 ? '-' : '') + '₪' + Math.round(Math.abs(v || 0)).toLocaleString('he-IL');
  const pct = v => Math.round((v || 0) * 100) + '%';
  const uid = () => Math.random().toString(36).slice(2, 10);
  const extOf = n => (String(n).toLowerCase().match(/\.([a-z0-9]+)$/) || [])[1] || '';
  const today = () => new Date().toISOString().slice(0, 10);

  let S = E.newState();
  const ui = { step: 'setup', who: { pension: 'A', bank: 'A' }, bankResult: { A: null, B: null }, aiOpinion: { A: null, B: null }, mislaka: { A: null, B: null }, busy: false, lastPw: null };
  const nm = w => w === 'J' ? 'משותף' : (S.spouses[w] && S.spouses[w].name) || w;
  const whoTag = w => `<span class="who ${w}">${esc(nm(w))}</span>`;

  function toast(msg, err) {
    const t = document.createElement('div');
    t.className = 'toast' + (err ? ' err' : '');
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), err ? 5200 : 2800);
  }

  // ---------- Persistence ----------
  const draftOn = () => { try { return localStorage.getItem(DRAFT_FLAG) === '1'; } catch (e) { return false; } };
  function save() {
    if (!draftOn()) return;
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify(S)); } catch (e) { /* quota or blocked */ }
  }
  function load(obj) {
    const base = E.newState();
    S = Object.assign(base, obj);
    S.meta = Object.assign(base.meta, obj.meta || {});
    S.settings = Object.assign(E.newState().settings, obj.settings || {});
    for (const w of ['A', 'B']) {
      S.spouses[w] = Object.assign(E.newState().spouses[w], (obj.spouses || {})[w] || {});
      S.incomes[w] = Object.assign(E.newState().incomes[w], (obj.incomes || {})[w] || {});
      S.bank[w] = Object.assign(E.newState().bank[w], (obj.bank || {})[w] || {});
    }
    S.items = (obj.items || []).map(i => E.newItem(i));
  }
  function exportJson() {
    const blob = new Blob([JSON.stringify(S, null, 1)], { type: 'application/json' });
    const a = document.createElement('a');
    const nmCase = (S.meta.caseName || 'case').replace(/[^\w֐-׿-]+/g, '_');
    a.href = URL.createObjectURL(blob);
    a.download = `arktuar_${nmCase}_${today()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  function pickFile(accept, multiple) {
    return new Promise(resolve => {
      const inp = $('#fileAny');
      inp.value = ''; inp.accept = accept || ''; inp.multiple = !!multiple;
      inp.onchange = () => resolve(Array.from(inp.files || []));
      inp.click();
    });
  }

  // ---------- Steps ----------
  const STEPS = [
    ['setup', 'פתיחה ופרטי התיק'],
    ['docs', 'רשימת מסמכים'],
    ['pension', 'פנסיה ומסלקה'],
    ['assets', 'נכסים וחובות'],
    ['bank', 'הכנסות ודפי בנק'],
    ['report', 'הדוח']
  ];

  function renderRail() {
    const res = E.compute(S);
    $('#rail').innerHTML = STEPS.map(([k, l], i) =>
      `<button class="step ${ui.step === k ? 'on' : ''} ${stepDone(k) ? 'done' : ''}" data-step="${k}"><span class="n">${i + 1}</span><span class="lbl">${l}</span></button>`).join('') +
      `<div class="mini"><div class="faint">שורה תחתונה (ברוטו)</div><div class="big">${fmt(res.transfer.gross.amount)}</div>
       <div class="faint">${res.transfer.gross.amount > 0 ? `${esc(nm(res.transfer.gross.from))} ← ${esc(nm(res.transfer.gross.to))}` : 'עדיין אין נתונים'}</div></div>`;
  }
  // Re-rendering inside a 'change' (fired on blur) can remove the element the
  // user is clicking, so renders triggered by input changes are deferred.
  let renderQueued = false;
  function renderSoon() { if (renderQueued) return; renderQueued = true; setTimeout(() => { renderQueued = false; render(); }, 0); }
  function render() {
    renderRail();
    const fn = { setup: renderSetup, docs: renderDocs, pension: renderPension, assets: renderAssets, bank: renderBank, report: renderReport }[ui.step];
    $('#main').innerHTML = `<section class="screen">${fn()}</section>`;
    const on = $('.step.on'); if (on && on.scrollIntoView && window.innerWidth < 900) on.scrollIntoView({ block: 'nearest', inline: 'center' });
    renderAuth();
    save();
  }
  function stepDone(k) {
    if (k === 'setup') return !!(S.meta.marriageDate && S.meta.crisisDate);
    if (k === 'pension') return S.items.some(i => E.PENSION_CATS.includes(i.cat) || i.cat === 'hishtalmut');
    if (k === 'assets') return S.items.some(i => !E.PENSION_CATS.includes(i.cat) && i.cat !== 'hidden');
    if (k === 'bank') return !!(S.bank.A.tx.length || S.bank.B.tx.length);
    if (k === 'docs') return Object.keys(S.docs).length > 4;
    return false;
  }
  function go(step) { ui.step = step; render(); window.scrollTo({ top: 0, behavior: 'smooth' }); }
  const nav = (prev, next) => `<div class="row noprint" style="margin-top:8px">${prev ? `<button class="btn ghost" data-step="${prev}">→ הקודם</button>` : ''}<span style="flex:1"></span>${next ? `<button class="btn pri" data-step="${next}">הבא ←</button>` : ''}</div>`;

  // ---------- Auth widget ----------
  function renderAuth() {
    const u = AI.available() ? AI.user() : null;
    $('#auth').innerHTML = u
      ? `<span>🔐 ${esc(u.name)}</span><button class="btn sm ghost" data-act="signout">יציאה</button>`
      : (AI.available() ? `<button class="btn sm" data-act="signin">התחברות עם Google ל־AI</button>` : '');
  }

  // =====================================================================
  //  1. Setup
  // =====================================================================
  const EMP = [['salaried', 'שכיר'], ['self', 'עצמאי'], ['both', 'שכיר ועצמאי'], ['none', 'לא עובד/ת']];
  const FLAGS = [
    ['property', 'דירה / נדל״ן'], ['mortgage', 'משכנתא'], ['rsu', 'RSU / אופציות'], ['business', 'עסק / חברה / שותפות'],
    ['securities', 'תיק השקעות'], ['crypto', 'קריפטו'], ['foreign', 'נכסים / חשבונות בחו״ל'], ['vehicle', 'רכב'],
    ['loans', 'הלוואות (שנלקחו או ניתנו)'], ['premarital', 'נכסים מלפני הנישואין / ירושה / מתנה']
  ];
  function renderSetup() {
    const sp = w => {
      const s = S.spouses[w];
      return `<div class="card col${w}">
        <h2>${whoTag(w)} בן/בת זוג ${w === 'A' ? 'א׳' : 'ב׳'}</h2>
        <label class="f">שם לתצוגה<input type="text" data-bind="spouses.${w}.name" value="${esc(s.name)}"></label>
        <div style="margin:12px 0 6px" class="faint">סוג תעסוקה</div>
        <div class="seg">${EMP.map(([k, l]) => `<button data-act="emp" data-w="${w}" data-v="${k}" class="${s.employment === k ? 'on' : ''}">${l}</button>`).join('')}</div>
        <div style="margin:14px 0 6px" class="faint">מה רלוונטי? (קובע את רשימת המסמכים)</div>
        <div class="grid2" style="gap:8px">${FLAGS.map(([k, l]) => `<label class="chk"><input type="checkbox" data-flag="${w}.${k}" ${s.flags[k] ? 'checked' : ''}>${l}</label>`).join('')}</div>
      </div>`;
    };
    const u = AI.available() ? AI.user() : null;
    return `<h1>פתיחת תיק איזון</h1>
      <p class="lead">מזינים תאריכים ופרופיל לכל אחד מבני הזוג. לפי זה המערכת בונה רשימת מסמכים מלאה, כדי שלא יתפספס אף נכס, ובסוף מפיקה דוח עם השורה התחתונה: מי מעביר למי וכמה.</p>
      <div class="card">
        <h2>📅 פרטי התיק</h2>
        <div class="grid3">
          <label class="f">שם התיק<input type="text" data-bind="meta.caseName" value="${esc(S.meta.caseName)}" placeholder="למשל: כהן 2026"></label>
          <label class="f">תאריך הנישואין<input type="date" data-bind="meta.marriageDate" value="${esc(S.meta.marriageDate)}"></label>
          <label class="f">מועד הקרע<input type="date" data-bind="meta.crisisDate" value="${esc(S.meta.crisisDate)}"><span class="h">בדרך כלל מועד הגשת התביעה הראשונה או הפירוד בפועל. כל השווים מחושבים למועד הזה.</span></label>
        </div>
        <div class="row" style="margin-top:12px">
          <label class="f" style="max-width:420px">משטר רכושי
            <select data-bind="meta.regime">
              <option value="balance" ${S.meta.regime === 'balance' ? 'selected' : ''}>איזון משאבים (נישאו אחרי 1.1.1974)</option>
              <option value="sharing" ${S.meta.regime === 'sharing' ? 'selected' : ''}>הלכת השיתוף (נישאו לפני 1974)</option>
              <option value="agreement" ${S.meta.regime === 'agreement' ? 'selected' : ''}>קיים הסכם ממון (החישוב להמחשה בלבד)</option>
            </select></label>
        </div>
        ${S.meta.regime === 'agreement' ? '<p class="note" style="margin-top:10px">כשיש הסכם ממון, ההסכם גובר. סמנו כ״מוחרג״ כל נכס שההסכם מוציא מהאיזון.</p>' : ''}
        ${S.meta.regime === 'sharing' ? '<p class="note" role="alert">הלכת השיתוף אינה מיושמת במנוע זה. הסכומים מוצגים כהמחשת איזון משאבים בלבד, ואינם קביעה של זכויות לפי הלכת השיתוף. נדרשת בדיקה משפטית פרטנית.</p>' : ''}
      </div>
      <div class="grid2">${sp('A')}${sp('B')}</div>
      <div class="card">
        <h2>👧 ילדים <span class="pill">ישמש לחישוב מזונות בשלב הבא</span></h2>
        ${S.kids.length ? `<table class="tbl"><thead><tr><th>שם</th><th>תאריך לידה</th><th>מתגורר/ת בעיקר אצל</th><th></th></tr></thead><tbody>
          ${S.kids.map((k, i) => `<tr><td><input type="text" data-kid="${i}.name" value="${esc(k.name)}"></td><td><input type="date" data-kid="${i}.birth" value="${esc(k.birth)}"></td>
          <td><select data-kid="${i}.lives"><option value="A" ${k.lives === 'A' ? 'selected' : ''}>${esc(nm('A'))}</option><option value="B" ${k.lives === 'B' ? 'selected' : ''}>${esc(nm('B'))}</option><option value="shared" ${k.lives === 'shared' ? 'selected' : ''}>משמורת משותפת</option></select></td>
          <td><button class="link" data-act="kidDel" data-i="${i}">הסרה</button></td></tr>`).join('')}</tbody></table>` : '<p class="faint">לא הוזנו ילדים.</p>'}
        <button class="btn sm" style="margin-top:10px" data-act="kidAdd">+ הוספת ילד/ה</button>
      </div>
      <div class="grid2">
        <div class="card">
          <h2>🤖 קריאת מסמכים עם AI</h2>
          <p class="muted" style="font-size:14px;margin-bottom:10px">אפשר להעלות PDF או צילום של תלושים, דוחות שנתיים, אישורי יתרה ודפי בנק, וה־AI ממלא את הנתונים. הקובץ נשלח לשרת מאובטח, מעובד ואינו נשמר. רק משתמשים מורשים יכולים להשתמש בזה.</p>
          ${!AI.available() ? '<p class="note">שירות ה־AI אינו פעיל כרגע. אפשר להמשיך להזין נתונים ולייבא CSV, Excel וקובצי מסלקה מקומית.</p>' : u ? `<p class="note g">מחובר/ת כ־${esc(u.email)}</p>` : '<button class="btn pri" data-act="signin">התחברות עם Google</button>'}
        </div>
        <div class="card">
          <h2>💾 שמירה וטעינה</h2>
          <p class="muted" style="font-size:14px;margin-bottom:10px">הנתונים נמצאים רק בדפדפן. כדי להמשיך מאוחר יותר או לשלוח לצד השני, מייצאים קובץ תיק.</p>
          <div class="row"><button class="btn" data-act="export">⬇️ ייצוא קובץ תיק</button><button class="btn" data-act="import">⬆️ טעינת קובץ תיק</button><button class="btn ghost danger" data-act="reset">איפוס</button></div>
          <label class="chk" style="margin-top:12px"><input type="checkbox" data-act="draft" ${draftOn() ? 'checked' : ''}>שמירת טיוטה אוטומטית במכשיר הזה</label>
          <div class="faint" style="margin-top:4px">מומלץ רק במחשב אישי. מי שיש לו גישה למכשיר יוכל לראות את הנתונים.</div>
        </div>
      </div>
      ${nav(null, 'docs')}`;
  }

  // =====================================================================
  //  2. Documents checklist
  // =====================================================================
  function checklist(w) {
    const s = S.spouses[w], f = s.flags, emp = s.employment;
    const L = [];
    const add = (id, title, why, opt) => L.push(Object.assign({ id, title, why, req: true }, opt || {}));
    add('mislaka', 'דוח המסלקה הפנסיונית (ZIP)', 'כל קרנות הפנסיה, הגמל, ההשתלמות וביטוחי המנהלים. מורידים מאזור החוסכים ב־swiftness.co.il', { go: 'pension', ai: 'mislaka' });
    add('bank', 'דפי חשבון עו״ש ל־24–36 חודשים, לכל החשבונות', 'עדיף בקובץ Excel או CSV מאתר הבנק. משמש לזיהוי יתרות, מקורות הכנסה נוספים והעברות חריגות', { go: 'bank', ai: 'bank' });
    add('credit', 'פירוט כרטיסי אשראי ל־12 חודשים', 'רמת חיים, הוצאות חריגות וכרטיסים לא מוכרים', { req: false });
    add('harHakesef', 'דוח ״הר הכסף״ + דוח ממערכת נתוני האשראי', 'חושף חשבונות, פיקדונות והלוואות שלא דווחו. מוזמנים בחינם באתרי משרד האוצר ובנק ישראל');
    add('harBituach', 'דוח ״הר הביטוח״', 'פוליסות חיסכון וביטוחי חיים עם ערך פדיון', { req: false });
    add('deposits', 'אישורי יתרה לפיקדונות, חסכונות ותוכניות חיסכון לילד', 'יתרה נכון למועד הקרע', { ai: 'other' });
    if (emp === 'salaried' || emp === 'both') {
      add('payslips', 'תלושי שכר ל־12 החודשים האחרונים', 'שכר נטו וברוטו, צבירת פיצויים וימי חופשה', { ai: 'payslip' });
      add('f106', 'טופסי 106 לשלוש השנים האחרונות', 'הכנסה שנתית ובונוסים', { ai: 'payslip' });
      add('severance', 'אישור מעסיק על פיצויים שאינם בקופה', 'פיצויים שנצברו אצל המעסיק הם חלק מהאיזון', { req: false, ai: 'other' });
    }
    if (emp === 'self' || emp === 'both') {
      add('taxReturn', 'דוחות שנתיים למס הכנסה (1301) לשלוש שנים + שומות', 'ההכנסה המדווחת. בסיס להשוואה מול מה שנכנס בפועל לחשבון', { ai: 'taxReturn' });
      add('vat', 'דוחות מע״מ תקופתיים ל־24 חודשים', 'מחזור מדווח. המערכת משווה אותו לזיכויים בחשבון', { ai: 'taxReturn' });
      add('bizBank', 'דפי חשבון של החשבון העסקי', 'בנפרד מהעו״ש הפרטי', { ai: 'bank' });
      add('bituachLeumi', 'אישורי ביטוח לאומי כעצמאי', 'מאמת את ההכנסה המדווחת', { req: false });
      add('books', 'כרטסת הנהלת חשבונות / דוח רווח והפסד', 'הוצאות שהועמסו על העסק', { req: false, ai: 'business' });
    }
    if (f.property) {
      add('tabu', 'נסח טאבו / אישור זכויות לכל נכס', 'רישום הבעלות והשעבודים', { ai: 'property' });
      add('appraisal', 'שומת שמאי עדכנית', 'שווי שוק למועד הקרע. בלי שומה הערך הוא הערכה בלבד', { ai: 'property' });
      add('purchase', 'חוזה רכישה ומקור המימון', 'קובע אם הנכס או חלקו מלפני הנישואין', { req: false, ai: 'property' });
    }
    if (f.mortgage) add('mortgage', 'אישור יתרה לסילוק משכנתא', 'נכון למועד הקרע', { ai: 'mortgage' });
    if (f.rsu) add('rsu', 'דוח מהברוקר (Morgan Stanley, Schwab, Altshare) + הסכמי הקצאה', 'כמות, תאריכי הענקה והבשלה, מסלול מס', { ai: 'rsu' });
    if (f.business) {
      add('fin', 'דוחות כספיים מבוקרים ל־3 שנים', 'הון עצמי, רווחיות, משיכות בעלים', { ai: 'business' });
      add('valuation', 'הערכת שווי לעסק', 'אם אין, המערכת מחשבת הערכה גסה לפי מכפיל רווח', { req: false });
      add('partnership', 'הסכם שותפות / מסמכי התאגדות', 'אחוזי הבעלות', { req: false });
    }
    if (f.securities) add('portfolio', 'דוח תיק השקעות למועד הקרע', 'שווי שוק ועלות מקורית לחישוב מס', { ai: 'securities' });
    if (f.crypto) add('cryptoRep', 'דוחות מהבורסות והארנקים', 'יתרות והעברות', { ai: 'securities' });
    if (f.foreign) add('foreignRep', 'דפי חשבון ודוחות של נכסים בחו״ל', 'כולל שער המרה למועד הקרע', { ai: 'other' });
    if (f.vehicle) add('car', 'רישיון רכב + מחירון', 'שווי הרכב', { req: false, ai: 'vehicle' });
    if (f.loans) add('loansDoc', 'הסכמי הלוואה ודוחות יתרה', 'חובות לצורכי המשפחה נכנסים לאיזון', { ai: 'loan' });
    if (f.premarital) add('premaritalDoc', 'אסמכתאות לנכסים מלפני הנישואין, ירושות ומתנות', 'כדי להחריג אותם מהאיזון', { ai: 'other' });
    return L;
  }
  const DOC_STATUS = [['', 'חסר'], ['got', 'התקבל'], ['na', 'לא רלוונטי']];
  function renderDocs() {
    const col = w => {
      const L = checklist(w);
      const got = L.filter(d => S.docs[w + ':' + d.id] === 'got').length;
      return `<div class="card col${w}"><h2>${whoTag(w)}<span class="sp"></span><span class="faint">${got}/${L.length}</span></h2>
        ${L.map(d => { const st = S.docs[w + ':' + d.id] || ''; return `<div class="ck ${st}">
          <div class="t"><b>${esc(d.title)}</b>${d.req ? '<span class="pill req">חובה</span>' : ''}<div>${esc(d.why)}</div></div>
          <div class="row" style="flex-direction:column;align-items:flex-end;gap:6px">
            <select data-doc="${w}:${d.id}">${DOC_STATUS.map(([v, l]) => `<option value="${v}" ${st === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
            ${d.go ? `<button class="link" data-step="${d.go}">למסך הייעודי ←</button>` : d.ai ? `<button class="link" data-act="aiDoc" data-w="${w}" data-type="${d.ai}" data-doc="${w}:${d.id}">🤖 קריאה עם AI</button>` : ''}
          </div></div>`; }).join('')}
      </div>`;
    };
    return `<h1>רשימת מסמכים</h1>
      <p class="lead">הרשימה נבנית לפי הפרופיל של כל אחד. מסמך שמסומן ״חסר״ יופיע בנספח הדוח, כדי שיהיה ברור מה עוד צריך לבקש מהצד השני או בבית המשפט (צו גילוי מסמכים).</p>
      <div class="grid2">${col('A')}${col('B')}</div>${nav('setup', 'pension')}`;
  }

  // =====================================================================
  //  3. Pension (Mislaka)
  // =====================================================================
  const MIS_MAP = { pension: 'pension', hishtalmut: 'hishtalmut', gemel: 'gemel', life: 'managers', other: 'other' };
  function renderPension() {
    const w = ui.who.pension;
    const mis = ui.mislaka[w];
    const items = S.items.filter(i => (E.PENSION_CATS.includes(i.cat) || ['hishtalmut', 'gemelInv', 'insurance'].includes(i.cat)) && i.owner === w);
    return `<h1>פנסיה ומסלקה</h1>
      <p class="lead">מעלים את קובץ ה־ZIP מהמסלקה (גם אם הוא מוגן בסיסמה). הקריאה נעשית בדפדפן בלבד. כל קופה נכנסת לאיזון באופן יחסי לתקופת הנישואין, לפי תאריך ההצטרפות.</p>
      ${whoSeg('pension')}
      <div class="card">
        <div class="drop" data-act="misUpload" data-w="${w}">📂 <b>העלאת קבצי מסלקה של ${esc(nm(w))}</b><br><span class="faint">ZIP, Excel או XML · נקרא מקומית בלבד</span></div>
        <div class="row" style="margin-top:10px"><span class="faint">יש לך רק PDF של דוח מסלקה או דוח שנתי מקופה?</span><button class="link" data-act="aiDoc" data-w="${w}" data-type="mislaka">🤖 קריאת PDF עם AI</button></div>
        ${mis ? `<div style="margin-top:14px"><h2>נמצאו ${mis.products.length} מוצרים <span class="sp"></span><button class="btn sm pri" data-act="misAdd" data-w="${w}">הוספת המוצרים הנבחרים לאיזון</button></h2>
          <div class="tbl-wrap"><table class="tbl"><thead><tr><th></th><th>מוצר</th><th>חברה</th><th>סוג</th><th>הצטרפות</th><th class="num">צבירה</th></tr></thead><tbody>
          ${mis.products.map((p, i) => `<tr><td><input type="checkbox" data-mis="${i}" ${p.savings > 0 && p.type !== 'risk' ? 'checked' : ''}></td>
            <td>${esc(p.name)}<div class="faint">${esc(p.policy ? '…' + String(p.policy).slice(-4) : '')} ${p.status === 'off' ? '· לא פעיל' : ''}</div></td><td>${esc(p.company)}</td>
            <td>${esc((M.TYPES[p.type] || {}).label || p.type)}</td><td>${esc(p.joinDate)}</td><td class="num">${fmt(p.savings)}</td></tr>`).join('')}
          </tbody></table></div></div>` : ''}
      </div>
      ${itemsTable(items, 'קופות שנכללות באיזון')}
      <p class="faint" style="margin-bottom:12px">שימו לב: חלוקה יחסית לפי זמן היא הערכה. אקטואר מחשב לפי הפקדות בפועל. אם ידועה הצבירה בתאריך הנישואין, הזינו אותה ב״שווי מלפני הנישואין״ ומחקו את תאריך ההצטרפות.</p>
      ${nav('docs', 'assets')}`;
  }
  const whoSeg = scope => `<div class="seg noprint" style="margin-bottom:14px">${['A', 'B'].map(w => `<button data-act="who" data-scope="${scope}" data-w="${w}" class="${ui.who[scope] === w ? 'on' : ''}">${esc(nm(w))}</button>`).join('')}</div>`;

  async function misUpload(w, dropped) {
    const files = dropped || await pickFile('.zip,.xls,.xlsx,.xml', true);
    if (!files.length) return;
    const ds = M.newDataset();
    const log = () => {};
    const items = [];
    try {
      for (const f of files) {
        const ext = extOf(f.name);
        if (ext === 'zip') { const got = await readZip(f, f.name, 0); if (got) items.push(...got); }
        else if (['xls', 'xlsx', 'xml'].includes(ext)) items.push({ name: f.name, ext, bytes: new Uint8Array(await f.arrayBuffer()) });
      }
      items.sort((a, b) => (a.ext === 'xml') - (b.ext === 'xml'));
      for (const it of items) {
        try { if (it.ext === 'xml') M.parseXml(it.bytes, it.name, ds, log); else M.parseWorkbook(it.bytes, it.name, ds, log); }
        catch (e) { console.error(e); }
      }
      M.finalize(ds);
      ui.mislaka[w] = ds;
      toast(ds.products.length ? `נמצאו ${ds.products.length} מוצרים` : 'לא נמצאו מוצרים בקבצים', !ds.products.length);
      if (ds.products.length) S.docs[w + ':mislaka'] = 'got';
    } catch (e) { toast('שגיאה בקריאת הקבצים: ' + e.message, true); }
    render();
  }
  async function readZip(blob, name, depth) {
    const reader = new zip.ZipReader(new zip.BlobReader(blob));
    let entries;
    try { entries = await reader.getEntries(); } catch (e) { toast(`${name} אינו ZIP תקין`, true); return []; }
    const files = entries.filter(e => !e.directory);
    const locked = files.filter(e => e.encrypted);
    let password;
    if (locked.length) {
      const probe = locked.slice().sort((a, b) => a.uncompressedSize - b.uncompressedSize)[0];
      const tryPw = async pw => { try { await probe.getData(new zip.Uint8ArrayWriter(), { password: pw }); return true; } catch (e) { return false; } };
      if (ui.lastPw && await tryPw(ui.lastPw)) password = ui.lastPw;
      let err = '';
      while (password === undefined) {
        const pw = await askPassword(name, err);
        if (pw === null) { await reader.close(); return null; }
        if (await tryPw(pw)) { password = pw; ui.lastPw = pw; } else err = 'הסיסמה לא מתאימה. נסו שוב.';
      }
    }
    const out = [];
    for (const e of files) {
      const base = e.filename.split('/').pop(), ext = extOf(base);
      if (base.startsWith('.') || e.filename.startsWith('__MACOSX')) continue;
      if (!['xls', 'xlsx', 'xml', 'zip'].includes(ext)) continue;
      const bytes = await e.getData(new zip.Uint8ArrayWriter(), password ? { password } : undefined);
      if (ext === 'zip') { if (depth < 2) { const inner = await readZip(new Blob([bytes]), base, depth + 1); if (inner) out.push(...inner); } }
      else out.push({ name: base, ext, bytes });
    }
    await reader.close();
    return out;
  }
  function askPassword(name, error) {
    return new Promise(resolve => {
      const dlg = $('#pwModal');
      $('#pwText').textContent = `${name} נעול. הזינו את הסיסמה שקיבלתם מהמסלקה.`;
      $('#pwError').textContent = error || '';
      $('#pwInput').value = '';
      const onClose = () => { dlg.removeEventListener('close', onClose); const v = $('#pwInput').value; $('#pwInput').value = ''; resolve(dlg.returnValue === 'ok' && v ? v : null); };
      dlg.addEventListener('close', onClose);
      dlg.showModal();
    });
  }
  function misAdd(w) {
    const ds = ui.mislaka[w];
    if (!ds) return;
    let n = 0;
    $$('[data-mis]').forEach(cb => {
      if (!cb.checked) return;
      const p = ds.products[+cb.dataset.mis];
      let cat = MIS_MAP[p.type] || 'other';
      if (cat === 'gemel' && /להשקעה/.test(p.name)) cat = 'gemelInv';
      const d = M.parseDate(p.joinDate);
      const startDate = d && /^\d{4}-\d{2}/.test(d.key) ? (d.key.length === 7 ? d.key + '-01' : d.key) : '';
      const label = [p.company, p.name, p.policy ? '…' + String(p.policy).slice(-4) : ''].filter(Boolean).join(' · ');
      const dup = S.items.find(i => i.owner === w && i.source === 'mislaka' && i.label === label);
      const it = E.newItem({ cat, owner: w, label, value: Math.round(p.savings), startDate, source: 'mislaka' });
      if (dup) Object.assign(dup, { value: it.value, startDate }); else S.items.push(it);
      n++;
    });
    ui.mislaka[w] = null;
    toast(`${n} קופות נוספו לאיזון`);
    render();
  }

  // =====================================================================
  //  4. Assets & debts
  // =====================================================================
  const ADD_CATS = ['realestate', 'bank', 'securities', 'rsu', 'business', 'vehicle', 'crypto', 'foreign', 'receivable', 'insurance', 'severance', 'hishtalmut', 'gemelInv', 'other', 'debt'];
  function itemsTable(items, title) {
    if (!items.length) return `<div class="card"><h2>${esc(title)}</h2><p class="faint">עדיין אין פריטים.</p></div>`;
    let tg = 0;
    const rows = items.map(it => {
      const r = E.valueItem(it, S.meta); const ex = r.status === 'excluded';
      if (!ex) tg += r.gross;
      const c = E.CATS[it.cat] || E.CATS.other;
      return `<tr class="${ex ? 'ex' : ''}"><td>${c.icon}</td><td><b>${esc(it.label || c.label)}</b><div class="faint">${esc(c.label)}${it.source !== 'manual' ? ' · ' + (it.source === 'ai' ? '🤖 AI' : it.source === 'mislaka' ? 'מסלקה' : it.source === 'bank' ? 'דפי בנק' : '') : ''}${r.note ? ' · ' + esc(r.note) : ''}</div></td>
        <td>${whoTag(it.owner)}</td><td class="num">${fmt(it.cat === 'debt' ? -it.value : it.value)}</td><td class="num">${ex ? 'מוחרג' : fmt(r.gross)}</td>
        <td class="noprint"><button class="link" data-act="edit" data-id="${it.id}">עריכה</button> · <button class="link" data-act="del" data-id="${it.id}" style="color:var(--neg)">מחיקה</button></td></tr>`;
    }).join('');
    return `<div class="card"><h2>${esc(title)}</h2><div class="tbl-wrap"><table class="tbl"><thead><tr><th></th><th>פריט</th><th>בעלות</th><th class="num">שווי / יתרה</th><th class="num">נכנס לאיזון</th><th></th></tr></thead>
      <tbody>${rows}</tbody><tfoot><tr><td></td><td>סה״כ</td><td></td><td></td><td class="num">${fmt(tg)}</td><td></td></tr></tfoot></table></div></div>`;
  }
  function renderAssets() {
    const items = S.items.filter(i => !E.PENSION_CATS.includes(i.cat) && !['hishtalmut', 'gemelInv', 'insurance', 'hidden'].includes(i.cat));
    return `<h1>נכסים וחובות</h1>
      <p class="lead">כל נכס או חוב של כל אחד מבני הזוג, או משותף, נכון למועד הקרע. נכס רשום על שני בני הזוג מסמנים כ״משותף״. ירושה, מתנה או נכס מלפני הנישואין מסמנים כמוחרג, או מזינים את השווי שהיה לו לפני הנישואין.</p>
      <div class="card noprint"><h2>הוספת פריט</h2><div class="row">${ADD_CATS.map(c => `<button class="btn sm" data-act="add" data-cat="${c}">${E.CATS[c].icon} ${E.CATS[c].label}</button>`).join('')}</div>
        <div class="row" style="margin-top:12px"><span class="faint">יש לך מסמך? </span><button class="link" data-act="aiDoc" data-w="A" data-type="other">🤖 קריאה עם AI ל${esc(nm('A'))}</button><button class="link" data-act="aiDoc" data-w="B" data-type="other">🤖 קריאה עם AI ל${esc(nm('B'))}</button></div></div>
      ${itemsTable(items, 'נכסים וחובות')}
      ${nav('pension', 'bank')}`;
  }

  // Item editor
  function itemForm(it) {
    const c = E.CATS[it.cat] || E.CATS.other, k = c.kind;
    const fld = (key, label, type, help, attrs) => `<label class="f">${label}<input type="${type || 'number'}" name="${key}" value="${esc(it[key] ?? '')}" ${attrs || ''}>${help ? `<span class="h">${help}</span>` : ''}</label>`;
    return `<h3>${c.icon} ${esc(c.label)}</h3>
      <form id="itemForm" class="grid2" style="gap:12px">
        <label class="f">בעלות<select name="owner">${['A', 'B', 'J'].map(w => `<option value="${w}" ${it.owner === w ? 'selected' : ''}>${esc(nm(w))}</option>`).join('')}</select></label>
        ${fld('label', 'תיאור', 'text', '', 'placeholder="למשל: דירה ברחוב הרצל, תל אביב"')}
        ${fld('value', k === 'debt' ? 'יתרת החוב (₪)' : 'שווי / יתרה במועד הקרע (₪)')}
        ${it.cat === 'realestate' ? fld('debt', 'יתרת משכנתא על הנכס (₪)', 'number', 'או הוסיפו את המשכנתא כפריט ״חוב״ נפרד, לא בשני המקומות') : ''}
        ${['realestate', 'securities', 'crypto', 'gemelInv', 'insurance'].includes(it.cat) ? fld('cost', 'עלות / הפקדות (₪)', 'number', 'לחישוב מס על הרווח בלבד') : ''}
        ${k === 'accrual' ? fld('startDate', 'תאריך הצטרפות', 'date', 'משמש לחלוקה יחסית לתקופת הנישואין') : ''}
        ${k === 'vesting' ? fld('startDate', 'תאריך הענקה', 'date') + fld('endDate', 'תאריך הבשלה סופית', 'date', 'החלק היחסי נקבע לפי כלל הזמן') : ''}
        ${it.cat === 'realestate' ? fld('startDate', 'תאריך רכישה', 'date') : ''}
        ${k !== 'debt' && k !== 'vesting' ? fld('preMarital', 'שווי שהיה לנכס בתאריך הנישואין (₪)', 'number', 'מנוכה מהאיזון. השאירו 0 אם הנכס נצבר כולו בנישואין') : ''}
        ${it.owner !== 'J' && k !== 'debt' ? fld('share', 'אחוז בעלות של בעל/ת הנכס', 'number', '', 'min="0" max="100"') : ''}
        ${k !== 'debt' ? fld('taxPct', 'שיעור מס משוער (%)', 'number', c.taxOn === 'gain' ? 'מחושב על הרווח בלבד' : 'מחושב על השווי, לתרחיש ״נטו אחרי מס״') : ''}
        ${it.cat === 'business' ? `<div class="card" style="grid-column:1/-1;margin:0;padding:12px"><b>מחשבון שווי עסק</b><div class="grid3" style="margin-top:8px">
            <label class="f">רווח נקי שנתי ממוצע<input type="number" id="bizProfit"></label><label class="f">מכפיל<input type="number" id="bizMult" value="3"></label>
            <div style="align-self:end"><button type="button" class="btn sm" data-act="bizCalc">חישוב ← שווי</button></div></div>
            <div class="faint" style="margin-top:6px">הערכה גסה בלבד. בעסק משמעותי נדרשת הערכת שווי של מומחה. מוניטין אישי של העוסק לרוב אינו נכלל.</div></div>` : ''}
        ${k === 'debt' ? `<label class="chk" style="grid-column:1/-1"><input type="checkbox" name="familyDebt" ${it.familyDebt ? 'checked' : ''}>החוב נלקח לצורכי המשפחה (נכנס לאיזון)</label>` : ''}
        ${it.cat === 'realestate' ? `<label class="chk" style="grid-column:1/-1"><input type="checkbox" name="sharedIntent" ${it.sharedIntent ? 'checked' : ''}>דירת מגורים מלפני הנישואין עם כוונת שיתוף ספציפית (נכללת במלואה)</label>` : ''}
        <label class="chk" style="grid-column:1/-1"><input type="checkbox" name="excluded" ${it.excluded ? 'checked' : ''}>להחריג מהאיזון (ירושה, מתנה, נכס חיצוני לפי הסכם)</label>
        ${fld('excludedReason', 'סיבת ההחרגה', 'text')}
        <label class="f" style="grid-column:1/-1">הערות<textarea name="notes" rows="2">${esc(it.notes)}</textarea></label>
      </form>
      <div class="row" style="margin-top:14px"><button class="btn pri" data-act="saveItem" data-id="${it.id}">שמירה</button><button class="btn ghost" data-act="closeDlg">ביטול</button></div>`;
  }
  let editing = null;
  function openItem(it, isNew) {
    editing = { it, isNew };
    $('#dlgBody').innerHTML = itemForm(it);
    $('#dlg').showModal();
  }
  function saveItem() {
    const f = $('#itemForm'); if (!f || !editing) return;
    const it = editing.it;
    for (const el of f.elements) {
      if (!el.name) continue;
      if (el.type === 'checkbox') it[el.name] = el.checked;
      else if (el.type === 'number') it[el.name] = el.value === '' ? 0 : +el.value;
      else it[el.name] = el.value;
    }
    if (editing.isNew) S.items.push(it);
    editing = null;
    $('#dlg').close();
    render();
  }

  // =====================================================================
  //  5. Income & bank statements
  // =====================================================================
  function renderBank() {
    const w = ui.who.bank, inc = S.incomes[w], b = S.bank[w];
    const res = ui.bankResult[w];
    const emp = S.spouses[w].employment;
    const findings = b.findings || [];
    return `<h1>הכנסות ודפי בנק</h1>
      <p class="lead">משווים בין ההכנסה המדווחת לבין מה שנכנס בפועל לחשבון. המערכת מזהה מקורות הכנסה חוזרים, זיכויים בביט ובפייבוקס ממשלמים רבים, הפקדות מזומן ושיקים, פער מול המחזור המדווח למע״מ, ויציאות חריגות לפני הקרע. הניתוח רץ בדפדפן.</p>
      ${whoSeg('bank')}
      <div class="card">
        <h2>💼 הכנסה מדווחת (חודשית)</h2>
        <div class="grid3">
          <label class="f">שכר נטו חודשי<input type="number" data-bind="incomes.${w}.salaryNet" value="${inc.salaryNet || ''}"></label>
          <label class="f">הכנסה עסקית מדווחת לחודש<input type="number" data-bind="incomes.${w}.businessDeclared" value="${inc.businessDeclared || ''}"><span class="h">ההכנסה החייבת מהדוח השנתי, חלקי 12</span></label>
          <label class="f">הכנסות מדווחות אחרות לחודש<input type="number" data-bind="incomes.${w}.otherDeclared" value="${inc.otherDeclared || ''}"><span class="h">שכירות, קצבאות, ריבית</span></label>
          ${emp === 'self' || emp === 'both' ? `<label class="f">מחזור שנתי מדווח למע״מ<input type="number" data-bind="incomes.${w}.vatTurnover" value="${inc.vatTurnover || ''}"></label>` : ''}
          <label class="f">שמות מעסיקים (מופרדים בפסיק)<input type="text" data-bind="incomes.${w}.employers" value="${esc(inc.employers || '')}"><span class="h">כדי לזהות משכורת בתיאור התנועה</span></label>
          <label class="f">חשבונות עצמיים / שם בעל החשבון<input type="text" data-bind="incomes.${w}.ownAccounts" value="${esc(inc.ownAccounts || '')}"><span class="h">העברות בין חשבונות של אותו אדם לא ייספרו כהכנסה</span></label>
        </div>
        <div class="row" style="margin-top:10px"><button class="link" data-act="aiDoc" data-w="${w}" data-type="${emp === 'self' ? 'taxReturn' : 'payslip'}">🤖 מילוי מתוך ${emp === 'self' ? 'דוח שנתי' : 'תלוש שכר'} עם AI</button></div>
      </div>
      <div class="card">
        <h2>🏦 דפי חשבון <span class="sp"></span><span class="faint">${b.tx.length ? `${b.tx.length} תנועות` : ''}</span></h2>
        <div class="grid2">
          <div class="drop" data-act="bankUpload" data-w="${w}">📄 <b>Excel או CSV מאתר הבנק</b><br><span class="faint">נקרא מקומית בלבד · אפשר כמה קבצים</span></div>
          <div class="drop" data-act="aiDoc" data-w="${w}" data-type="bank">🤖 <b>PDF של דף חשבון</b><br><span class="faint">נקרא עם AI · עד 4 קבצים בכל פעם</span></div>
        </div>
        ${b.files.length ? `<div class="faint" style="margin-top:8px">נטענו: ${b.files.map(esc).join(' · ')} <button class="link" data-act="bankClear" data-w="${w}" style="color:var(--neg)">ניקוי</button></div>` : ''}
        <div class="row" style="margin-top:12px">
          <label class="f" style="max-width:200px">סף לתנועה חריגה (₪)<input type="number" data-bind="settings.largeTx" value="${S.settings.largeTx}"></label>
          <label class="f" style="max-width:200px">חודשים לבדיקה לפני הקרע<input type="number" data-bind="settings.lookbackMonths" value="${S.settings.lookbackMonths}"></label>
          <button class="btn pri" data-act="analyze" data-w="${w}" ${b.tx.length ? '' : 'disabled'} style="align-self:end">🔎 ניתוח</button>
        </div>
      </div>
      ${res ? `<div class="kpis">
          <div class="kpi"><div class="l">תקופה</div><div class="v" style="font-size:15px">${esc(res.from)} – ${esc(res.to)}</div></div>
          <div class="kpi"><div class="l">הכנסה בפועל לחודש</div><div class="v">${fmt(res.realMonthly)}</div></div>
          <div class="kpi"><div class="l">הכנסה מדווחת לחודש</div><div class="v">${fmt(res.declaredMonthly)}</div></div>
          <div class="kpi"><div class="l">פער חודשי</div><div class="v" style="color:${res.gap > 0 ? 'var(--warn)' : 'var(--pos)'}">${fmt(res.gap)}</div></div>
        </div>
        <div class="card"><h2>💡 ניתוח AI נוסף <span class="sp"></span><button class="btn sm" data-act="aiBank" data-w="${w}">שליחת סיכום מקובץ ל־AI</button></h2>
          <p class="faint">נשלחת רק רשימה מקובצת של מקורות זיכוי (שם הגורם, סוג, סכום כולל, מספר חודשים), לא דפי החשבון עצמם.</p>
          ${aiOpinionHtml(w)}</div>` : ''}
      ${findings.length ? `<div class="card"><h2>ממצאים (${findings.filter(f => f.status !== 'dismissed').length})</h2>
        <p class="faint" style="margin-bottom:10px">ממצא הוא כיוון לבדיקה, לא מסקנה. ממצא שאומת אפשר לכלול בדוח כ״נכס חבוי משוער״. הוא יופיע בשורה תחתונה נפרדת.</p>
        ${findings.map(f => `<div class="fd ${f.severity} ${f.status === 'dismissed' ? 'ok' : ''}">
          <div class="h"><span class="sev ${f.severity}">${f.severity === 'high' ? 'גבוה' : 'בינוני'}</span><b>${esc(f.title)}</b><span class="amt">${fmt(f.amount)}</span></div>
          <div class="d">${esc(f.detail)}</div>
          <div class="row">
            <label class="chk"><input type="checkbox" data-fa="${f.id}" ${f.asAsset ? 'checked' : ''}>לכלול כנכס חבוי משוער</label>
            <input type="number" data-fv="${f.id}" value="${Math.round(f.assetValue || f.amount)}" style="max-width:150px">
            <span style="flex:1"></span>
            <button class="link" data-act="fdToggle" data-id="${f.id}">${f.status === 'dismissed' ? 'שחזור' : 'הוסבר / לא רלוונטי'}</button>
          </div></div>`).join('')}</div>` : (b.tx.length && res ? '<div class="card"><p class="note g">לא נמצאו ממצאים חריגים.</p></div>' : '')}
      ${nav('assets', 'report')}`;
  }
  function aiOpinionHtml(w) {
    const o = ui.aiOpinion[w];
    if (!o) return '';
    if (o.loading) return '<p><span class="spin"></span> מנתח…</p>';
    const L = { business_income: 'הכנסה עסקית', salary: 'משכורת', family: 'משפחה', internal: 'פנימי', refund: 'החזר', loan: 'הלוואה', benefit: 'קצבה', rental_income: 'שכירות', other: 'אחר' };
    return `<p style="margin:10px 0">${esc(o.summary || '')}</p>
      <div class="tbl-wrap"><table class="tbl"><thead><tr><th>גורם</th><th>הערכה</th><th class="num">חשד</th><th>נימוק</th></tr></thead><tbody>
      ${(o.assessments || []).filter(a => a.suspicion >= 0.3).sort((a, b) => b.suspicion - a.suspicion).slice(0, 20).map(a => `<tr><td>${esc(a.cp)}</td><td>${esc(L[a.likely] || a.likely)}</td><td class="num">${pct(a.suspicion)}</td><td class="faint">${esc(a.reason)}</td></tr>`).join('')}
      </tbody></table></div>
      ${(o.suggested_requests || []).length ? `<div style="margin-top:10px"><b>מסמכים לבקש:</b><ul style="margin:6px 20px 0">${o.suggested_requests.map(r => `<li>${esc(r)}</li>`).join('')}</ul></div>` : ''}`;
  }
  async function bankUpload(w, dropped) {
    const files = dropped || await pickFile('.csv,.xls,.xlsx,.txt', true);
    if (!files.length) return;
    let added = 0;
    for (const f of files) {
      try {
        let rows;
        if (extOf(f.name) === 'csv' || extOf(f.name) === 'txt') rows = BK.parseCSV(await readText(f));
        else {
          const wb = XLSX.read(new Uint8Array(await f.arrayBuffer()), { type: 'array', cellDates: false });
          rows = [];
          for (const sn of wb.SheetNames) rows.push(...XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, raw: true, defval: '' }));
        }
        let r = BK.rowsToTransactions(rows);
        if (r.error) {
          const map = await columnMapping(rows, f.name);
          if (!map) continue;
          r = BK.rowsToTransactions(rows, map);
        }
        if (!r.tx.length) { toast(`${f.name}: ${r.error || 'לא נמצאו תנועות'}`, true); continue; }
        mergeTx(w, r.tx);
        S.bank[w].files.push(f.name);
        added += r.tx.length;
      } catch (e) { toast(`${f.name}: ${e.message}`, true); }
    }
    if (added) { toast(`נטענו ${added} תנועות`); S.docs[w + ':bank'] = 'got'; runAnalysis(w); }
    render();
  }
  async function readText(f) {
    return BK.decodeText(await f.arrayBuffer());
  }

  let mapping = null;
  function columnMapping(rows, name) {
    return new Promise(resolve => {
      mapping = { rows, name, resolve, row: 0 };
      renderMapping();
      $('#dlg').showModal();
    });
  }
  function renderMapping() {
    const { rows, name, row } = mapping;
    const width = Math.max(0, ...rows.slice(0, 40).map(r => r.length));
    const options = '<option value="-1">לא נבחרה</option>' + Array.from({ length: width }, (_, i) => `<option value="${i}">${i + 1}: ${esc((rows[row] || [])[i] || '')}</option>`).join('');
    $('#dlgBody').innerHTML = `<h3>מיפוי עמודות ידני</h3><p>${esc(name)}: לא זוהה מבנה הקובץ. בחרו את שורת הכותרות ועמודות הנתונים.</p>
      <label class="f">מספר שורת כותרות (0 אם אין כותרות)<input id="mapRow" type="number" min="0" max="${rows.length}" value="${row + 1}"></label>
      <div class="grid2">${[['date', 'תאריך'], ['desc', 'תיאור'], ['amount', 'סכום יחיד'], ['credit', 'זכות'], ['debit', 'חובה'], ['balance', 'יתרה']].map(([key, label]) => `<label class="f">${label}<select id="map-${key}">${options}</select></label>`).join('')}</div>
      <label class="f">סימן עמודת סכום יחיד<select id="mapSign"><option value="1">חיובי = זכות, שלילי = חובה</option><option value="-1">חיובי = הוצאה (יצוא חברת אשראי)</option></select></label>
      <div class="tbl-wrap"><table class="tbl"><tbody>${rows.slice(row, row + 4).map(r => `<tr>${r.map(c => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
      <p id="mapError" class="note" role="alert" hidden></p><div class="row"><button class="btn pri" data-act="mapApply">יבוא לפי המיפוי</button><button class="btn ghost" data-act="mapCancel">ביטול</button></div>`;
  }
  function finishMapping(map) {
    if (!mapping) return;
    const resolve = mapping.resolve;
    mapping = null;
    $('#dlg').close();
    resolve(map);
  }
  function applyMapping() {
    if (!mapping) return;
    const map = { row: +$('#mapRow').value - 1, extra: -1, amountSign: +$('#mapSign').value };
    for (const key of ['date', 'desc', 'amount', 'credit', 'debit', 'balance']) map[key] = +$('#map-' + key).value;
    const used = [map.date, map.desc, ...(map.amount >= 0 ? [map.amount] : [map.credit, map.debit]), map.balance].filter(v => v >= 0);
    let error = '';
    if (!Number.isInteger(map.row) || map.row < -1 || map.row >= mapping.rows.length) error = 'מספר שורת הכותרות לא תקין';
    else if (map.date < 0 || map.desc < 0 || (map.amount < 0 && map.credit < 0 && map.debit < 0)) error = 'בחרו תאריך, תיאור וסכום או זכות/חובה';
    else if (new Set(used).size !== used.length) error = 'יש לבחור עמודה שונה לכל תפקיד';
    else if (!BK.rowsToTransactions(mapping.rows, map).tx.length) error = 'המיפוי לא הניב תנועות. בדקו תאריכים ועמודות סכום';
    if (error) { $('#mapError').hidden = false; $('#mapError').textContent = error; return; }
    finishMapping(map);
  }
  $('#dlg').addEventListener('cancel', () => finishMapping(null));
  function mergeTx(w, tx) {
    const seen = new Set(S.bank[w].tx.map(t => t.date + '|' + t.amount + '|' + t.desc));
    for (const t of tx) { const k = t.date + '|' + t.amount + '|' + t.desc; if (!seen.has(k)) { seen.add(k); S.bank[w].tx.push(t); } }
    S.bank[w].tx.sort((a, b) => a.date.localeCompare(b.date));
  }
  const splitList = s => String(s || '').split(/[,،;]/).map(x => x.trim()).filter(Boolean);
  function runAnalysis(w) {
    const inc = S.incomes[w];
    const res = BK.analyze(S.bank[w].tx, {
      employers: splitList(inc.employers), ownAccounts: splitList(inc.ownAccounts),
      declared: { salaryNet: +inc.salaryNet || 0, businessDeclared: +inc.businessDeclared || 0, otherDeclared: +inc.otherDeclared || 0 },
      vatTurnover: +inc.vatTurnover || 0, crisisDate: S.meta.crisisDate, largeTx: +S.settings.largeTx || 10000, lookbackMonths: +S.settings.lookbackMonths || 12
    });
    // Keep user decisions for findings that still exist
    const prev = new Map((S.bank[w].findings || []).map(f => [f.type + '|' + f.title, f]));
    res.findings.forEach(f => { const p = prev.get(f.type + '|' + f.title); if (p) Object.assign(f, { id: p.id, status: p.status, asAsset: p.asAsset, assetValue: p.assetValue }); });
    S.bank[w].findings = res.findings;
    S.bank[w].summary = { realMonthly: res.realMonthly, declaredMonthly: res.declaredMonthly, gap: res.gap, months: res.months, from: res.from, to: res.to };
    ui.bankResult[w] = res;
    syncHidden(w);
  }
  // Findings marked as hidden assets become 'hidden' items (used only in the "with findings" scenario)
  function syncHidden(w) {
    S.items = S.items.filter(i => !(i.cat === 'hidden' && i.owner === w));
    for (const f of S.bank[w].findings || []) {
      if (f.asAsset && f.status !== 'dismissed') S.items.push(E.newItem({ cat: 'hidden', owner: w, label: f.title, value: Math.round(f.assetValue || f.amount), source: 'bank', notes: f.detail, taxPct: 0 }));
    }
  }

  async function aiBank(w) {
    const res = ui.bankResult[w];
    if (!res) return;
    ui.aiOpinion[w] = { loading: true }; render();
    try {
      const r = await AI.call({ task: 'bankDigest', digest: res.aiDigest, context: { declared: res.declaredMonthly, employment: S.spouses[w].employment, months: res.months } });
      ui.aiOpinion[w] = r.data;
    } catch (e) { ui.aiOpinion[w] = null; toast(e.message, true); }
    render();
  }

  // =====================================================================
  //  AI document extraction + review
  // =====================================================================
  const DOC_TYPES = { payslip: 'תלוש שכר / 106', taxReturn: 'דוח שנתי / מע״מ', mislaka: 'דוח מסלקה / קופה', bank: 'דף חשבון', mortgage: 'אישור יתרת משכנתא', property: 'נסח / שומה / חוזה', securities: 'תיק השקעות / קריפטו', rsu: 'RSU / אופציות', business: 'דוחות כספיים', vehicle: 'רכב', loan: 'הלוואה', other: 'מסמך כללי' };
  async function aiDoc(w, type, docKey, dropped) {
    if (!AI.user()) {
      if (confirm('כדי לקרוא מסמכים עם AI צריך להתחבר עם Google. להתחבר עכשיו? הנתונים שהוזנו יישמרו זמנית בלשונית הזו ויחזרו אחרי ההתחברות.')) AI.signIn(snapshot());
      return;
    }
    const files = dropped || await pickFile('.pdf,.png,.jpg,.jpeg,.webp', true);
    if (!files.length) return;
    if (files.length > 4) { toast('עד 4 קבצים בכל פעם', true); return; }
    $('#dlgBody').innerHTML = `<h3>🤖 קורא ${esc(DOC_TYPES[type] || 'מסמך')}…</h3><p class="muted"><span class="spin"></span> ${files.map(f => esc(f.name)).join(', ')}</p><p class="faint" style="margin-top:8px">זה יכול לקחת עד דקה.</p>`;
    $('#dlg').showModal();
    try {
      const r = await AI.call({ task: 'extract', docType: type, files, context: { marriageDate: S.meta.marriageDate, crisisDate: S.meta.crisisDate } });
      reviewAI(w, type, r.data || {}, docKey, r.usage, files.map(f => f.name));
    } catch (e) {
      $('#dlg').close();
      toast(e.message, true);
    }
  }
  let pending = null;
  function reviewAI(w, type, d, docKey, usage, fileNames) {
    pending = { w, type, d, docKey, fileNames };
    const items = d.items || [], inc = d.income || {}, tx = d.transactions || [];
    const incRows = [['salaryNet', 'שכר נטו חודשי'], ['businessDeclared', 'הכנסה עסקית מדווחת לחודש'], ['otherDeclared', 'הכנסות אחרות לחודש'], ['vatTurnover', 'מחזור שנתי למע״מ']].filter(([k]) => inc[k] != null && inc[k] !== 0);
    $('#dlgBody').innerHTML = `<h3>בדיקת הנתונים שחולצו</h3>
      <p class="faint">${d.holder_name ? 'על שם: ' + esc(d.holder_name) + ' · ' : ''}${d.as_of_date ? 'נכון ל־' + esc(d.as_of_date) + ' · ' : ''}${usage ? `שימוש היום: ${usage.calls}/${usage.limit}` : ''}</p>
      ${(d.warnings || []).length ? `<div class="note" style="margin:10px 0">${d.warnings.map(esc).join('<br>')}</div>` : ''}
      <div style="margin:10px 0">שיוך ל: <select id="aiOwner">${['A', 'B', 'J'].map(x => `<option value="${x}" ${x === w ? 'selected' : ''}>${esc(nm(x))}</option>`).join('')}</select></div>
      ${items.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th></th><th>סוג</th><th>תיאור</th><th class="num">שווי</th><th class="num">ביטחון</th></tr></thead><tbody>
        ${items.map((it, i) => `<tr><td><input type="checkbox" data-ai="${i}" checked></td>
          <td><select data-aicat="${i}">${Object.keys(E.CATS).filter(c => c !== 'hidden').map(c => `<option value="${c}" ${c === it.cat ? 'selected' : ''}>${E.CATS[c].label}</option>`).join('')}</select></td>
          <td><input type="text" data-ailabel="${i}" value="${esc(it.label)}"></td><td><input type="number" data-aival="${i}" value="${Math.round(+it.value || 0)}" style="max-width:130px"></td>
          <td class="num">${it.confidence != null ? pct(it.confidence) : ''}</td></tr>`).join('')}</tbody></table></div>` : ''}
      ${incRows.length ? `<div style="margin-top:12px"><b>הכנסות</b>${incRows.map(([k, l]) => `<label class="chk" style="display:flex;margin-top:6px"><input type="checkbox" data-aiinc="${k}" checked>${l}: <b style="direction:ltr">${fmt(inc[k])}</b></label>`).join('')}
        ${inc.employer ? `<div class="faint" style="margin-top:4px">מעסיק: ${esc(inc.employer)}</div>` : ''}</div>` : ''}
      ${tx.length ? `<label class="chk" style="margin-top:12px;display:flex"><input type="checkbox" id="aiTx" checked>הוספת ${tx.length} תנועות לניתוח דפי הבנק</label>` : ''}
      ${!items.length && !incRows.length && !tx.length ? '<p class="note">לא נמצאו נתונים שאפשר להוסיף.</p>' : ''}
      ${(d.missing || []).length ? `<p class="faint" style="margin-top:10px">חסר במסמך: ${d.missing.map(esc).join(' · ')}</p>` : ''}
      <div class="row" style="margin-top:14px"><button class="btn pri" data-act="aiApply">הוספה</button><button class="btn ghost" data-act="closeDlg">ביטול</button></div>`;
  }
  function aiApply() {
    if (!pending) return;
    const { d, docKey, fileNames } = pending;
    const owner = $('#aiOwner').value;
    const incW = owner === 'J' ? pending.w : owner;
    let n = 0;
    (d.items || []).forEach((it, i) => {
      const cb = $(`[data-ai="${i}"]`); if (!cb || !cb.checked) return;
      const cat = $(`[data-aicat="${i}"]`).value;
      S.items.push(E.newItem({
        cat, owner, label: $(`[data-ailabel="${i}"]`).value, value: +$(`[data-aival="${i}"]`).value || 0,
        debt: +it.debt || 0, cost: +it.cost || 0, startDate: it.startDate || '', endDate: it.endDate || '',
        notes: it.notes || '', source: 'ai', confidence: it.confidence, taxPct: (E.CATS[cat] || E.CATS.other).tax
      }));
      n++;
    });
    $$('[data-aiinc]').forEach(cb => { if (cb.checked) S.incomes[incW][cb.dataset.aiinc] = Math.round(+d.income[cb.dataset.aiinc] || 0); });
    if (d.income && d.income.employer && !S.incomes[incW].employers) S.incomes[incW].employers = d.income.employer;
    const txCb = $('#aiTx');
    if (txCb && txCb.checked) {
      const tx = (d.transactions || []).map(t => ({ date: BK.parseDate(t.date) || t.date, desc: String(t.desc || ''), amount: +t.amount || 0, balance: null })).filter(t => /^\d{4}-\d{2}-\d{2}$/.test(t.date) && t.amount);
      mergeTx(incW, tx);
      S.bank[incW].files.push(...fileNames.map(f => f + ' (AI)'));
      runAnalysis(incW);
    }
    if (docKey) S.docs[docKey] = 'got';
    pending = null;
    $('#dlg').close();
    toast(`נוספו ${n} פריטים`);
    render();
  }

  // =====================================================================
  //  6. Report
  // =====================================================================
  function reportHtml() {
    const base = E.compute(S), withF = E.compute(S, { includeFindings: true });
    const t = base.transfer, A = base.perSpouse.A, B = base.perSpouse.B;
    const hasData = S.items.length > 0;
    const hasHidden = S.items.some(i => i.cat === 'hidden');
    const sentence = tr => tr.amount < 1 ? 'אין צורך באיזון' : `${esc(nm(tr.from))} מעביר/ה ל־${esc(nm(tr.to))}`;
    const max = Math.max(Math.abs(A.gross), Math.abs(B.gross), 1);
    const cats = Array.from(new Set([...Object.keys(A.byCat), ...Object.keys(B.byCat)]));
    const missing = ['A', 'B'].flatMap(w => checklist(w).filter(d => d.req && !S.docs[w + ':' + d.id]).map(d => ({ w, d })));
    const findings = ['A', 'B'].flatMap(w => (S.bank[w].findings || []).filter(f => f.status !== 'dismissed').map(f => ({ w, f })));
    const warn = [];
    if (S.meta.regime === 'sharing') warn.push('הלכת השיתוף אינה מיושמת. דוח זה מדגים איזון משאבים בלבד ואינו קובע זכויות לפי הלכת השיתוף.');
    for (const w of ['A', 'B']) {
      const overlap = BK.overlappingIncome(S.bank[w].findings);
      if (overlap.length) warn.push(`${nm(w)}: ממצא שסומן כנכס חבוי מבוסס על זיכויים הנכללים גם בפער ההכנסות (${overlap.map(f => f.title).join(', ')}). אין לחבר את פער ההכנסות ואת אותו מקור שוב כנכס. יש להבחין בין הכנסה שוטפת ליתרה שנותרה במועד הקרע; ייתכן כפל ספירה גם בין ממצאים חופפים.`);
    }
    if (!S.meta.marriageDate || !S.meta.crisisDate) warn.push('לא הוזנו תאריך נישואין ומועד קרע. החלוקה היחסית של קופות ו־RSU לא מחושבת.');
    if (S.items.some(i => i.source === 'ai')) warn.push('חלק מהנתונים חולצו אוטומטית מ־AI. מומלץ לאמת מול המסמך המקורי.');
    if (missing.length) warn.push(`חסרים ${missing.length} מסמכי חובה (פירוט בנספח).`);

    return `
      <div class="bl">
        <div class="k">השורה התחתונה · איזון משאבים${S.meta.crisisDate ? ' נכון ל־' + esc(S.meta.crisisDate) : ''}${S.meta.caseName ? ' · ' + esc(S.meta.caseName) : ''}</div>
        <div class="main">${hasData ? `${sentence(t.gross)}${t.gross.amount >= 1 ? ` <span class="amt">${fmt(t.gross.amount)}</span>` : ''}` : 'עדיין לא הוזנו נכסים'}</div>
        ${hasData ? `<div class="alts">
          <span>אחרי מס משוער: <b>${fmt(t.net.amount)}</b> (${esc(nm(t.net.from))} ← ${esc(nm(t.net.to))})</span>
          ${hasHidden ? `<span>כולל ממצאי דפי בנק: <b>${fmt(withF.transfer.gross.amount)}</b> (${esc(nm(withF.transfer.gross.from))} ← ${esc(nm(withF.transfer.gross.to))})</span>` : ''}
        </div>` : ''}
      </div>
      ${hasData ? `<div class="card"><h2>⚖️ סך המשאבים בני האיזון</h2><div class="bars">
        ${['A', 'B'].map(w => { const v = base.perSpouse[w].gross; return `<div class="bar"><span>${whoTag(w)}</span><span class="tr"><i style="width:${Math.max(0, v) / max * 100}%;background:var(--${w.toLowerCase()})"></i></span><b style="direction:ltr;text-align:left">${fmt(v)}</b></div>`; }).join('')}
        </div><p class="faint" style="margin-top:10px">ההפרש בין הצדדים ${fmt(Math.abs(A.gross - B.gross))}. מחצית ממנו היא סכום האיזון. נכסים משותפים מחולקים שווה בשווה ונכללים אצל שניהם.</p></div>

      ${t.pensionInSource.amount >= 1 ? `<div class="card"><h2>🧓 אפשרות: חלוקת פנסיה במקור</h2>
        <p>לפי החוק לחלוקת חיסכון פנסיוני, אפשר לבצע חלק מהאיזון בפיצול הקופות עצמן במקום תשלום במזומן:</p>
        <ul style="margin:8px 20px">
          <li>רכיב הפנסיה: ${esc(nm(t.pensionInSource.from))} מעביר/ה ${fmt(t.pensionInSource.amount)} מהקופות הפנסיוניות</li>
          <li>יתרת האיזון מנכסים אחרים: ${esc(nm(t.remainderAfterPension.from))} משלם/ת ${fmt(t.remainderAfterPension.amount)}</li>
        </ul><p class="faint">חלוקה במקור לא מקדימה תשלום. הכסף מגיע במועד הזכאות לקצבה, ואין מס בעת הפיצול. איזון בכסף נזיל היום שווה יותר מאותו סכום בפנסיה עתידית.</p></div>` : ''}

      <div class="card"><h2>📋 פירוט לפי סוג נכס</h2><div class="tbl-wrap"><table class="tbl">
        <thead><tr><th>סוג</th><th class="num">${esc(nm('A'))}</th><th class="num">${esc(nm('B'))}</th><th class="num">הפרש</th></tr></thead><tbody>
        ${cats.map(c => { const a = (A.byCat[c] || {}).gross || 0, b = (B.byCat[c] || {}).gross || 0; return `<tr><td>${E.CATS[c].icon} ${esc(E.CATS[c].label)}</td><td class="num">${fmt(a)}</td><td class="num">${fmt(b)}</td><td class="num">${fmt(a - b)}</td></tr>`; }).join('')}
        </tbody><tfoot><tr><td>סה״כ ברוטו</td><td class="num">${fmt(A.gross)}</td><td class="num">${fmt(B.gross)}</td><td class="num">${fmt(A.gross - B.gross)}</td></tr>
        <tr><td>סה״כ אחרי מס משוער</td><td class="num">${fmt(A.net)}</td><td class="num">${fmt(B.net)}</td><td class="num">${fmt(A.net - B.net)}</td></tr></tfoot></table></div></div>

      <div class="card"><h2>🧾 כל הפריטים</h2><div class="tbl-wrap"><table class="tbl"><thead><tr><th>פריט</th><th>בעלות</th><th class="num">שווי</th><th class="num">באיזון</th><th>הערה</th></tr></thead><tbody>
        ${base.rows.map(r => `<tr><td>${E.CATS[r.item.cat].icon} ${esc(r.item.label || E.CATS[r.item.cat].label)}</td><td>${whoTag(r.item.owner)}</td><td class="num">${fmt(r.item.cat === 'debt' ? -r.item.value : r.item.value)}</td><td class="num">${fmt(r.gross)}</td><td class="faint">${esc(r.note)}</td></tr>`).join('')}
        </tbody></table></div></div>

      ${base.excluded.length ? `<div class="card"><h2>🚫 הוחרגו מהאיזון</h2><table class="tbl"><tbody>
        ${base.excluded.map(r => `<tr><td>${esc(r.item.label || E.CATS[r.item.cat].label)}</td><td>${whoTag(r.item.owner)}</td><td class="num">${fmt(r.item.value)}</td><td class="faint">${esc(r.note)}</td></tr>`).join('')}</tbody></table></div>` : ''}` : ''}

      ${['A', 'B'].some(w => S.bank[w].summary) ? `<div class="card"><h2>💼 הכנסה בפועל מול מדווחת</h2><table class="tbl"><thead><tr><th></th><th>תקופה</th><th class="num">בפועל לחודש</th><th class="num">מדווח לחודש</th><th class="num">פער</th></tr></thead><tbody>
        ${['A', 'B'].filter(w => S.bank[w].summary).map(w => { const s = S.bank[w].summary; return `<tr><td>${whoTag(w)}</td><td>${esc(s.from)} – ${esc(s.to)}</td><td class="num">${fmt(s.realMonthly)}</td><td class="num">${fmt(s.declaredMonthly)}</td><td class="num">${fmt(s.gap)}</td></tr>`; }).join('')}
        </tbody></table><p class="faint" style="margin-top:8px">ישמש בשלב הבא לחישוב מזונות לפי ההכנסה האמיתית.</p></div>` : ''}

      ${findings.length ? `<div class="card"><h2>🔎 ממצאים מדפי הבנק</h2>${findings.map(({ w, f }) => `<div class="fd ${f.severity}"><div class="h">${whoTag(w)}<b>${esc(f.title)}</b><span class="amt">${fmt(f.amount)}</span></div><div class="d">${esc(f.detail)}${f.asAsset ? ' · <b>נכלל בתרחיש עם ממצאים</b>' : ''}</div></div>`).join('')}</div>` : ''}

      ${warn.length ? `<div class="card"><h2>⚠️ הסתייגויות</h2>${warn.map(x => `<p class="note" style="margin-bottom:6px">${esc(x)}</p>`).join('')}</div>` : ''}

      ${missing.length ? `<div class="card"><h2>📎 נספח: מסמכים חסרים</h2><ul style="margin:0 20px">${missing.map(({ w, d }) => `<li>${esc(nm(w))}: ${esc(d.title)}</li>`).join('')}</ul></div>` : ''}

      <div class="card"><h2>📐 הנחות החישוב</h2><ul style="margin:0 20px;font-size:14px" class="muted">
        <li>איזון משאבים: כל צד מקבל מחצית מההפרש בין סך המשאבים שנצברו בתקופת הנישואין ועד מועד הקרע.</li>
        <li>קופות פנסיה, גמל והשתלמות מחולקות באופן יחסי לפי הזמן, מתאריך ההצטרפות (או הנישואין) ועד מועד הקרע.</li>
        <li>RSU ואופציות לפי כלל הזמן: החלק מתקופת ההבשלה שחל בתוך הנישואין ולפני הקרע.</li>
        <li>נכסים מלפני הנישואין, ירושות ומתנות מוחרגים, למעט כוונת שיתוף ספציפית. חובות נכללים רק אם נלקחו לצורכי המשפחה.</li>
        <li>״אחרי מס״ הוא הערכה גסה לפי שיעורים שהוזנו, ולא תחליף לחישוב מס פרטני.</li>
        <li>לא נלקחו בחשבון: נכסי קריירה ומוניטין אישי, איזון לא שוויוני לפי סעיף 8, ומזונות.</li>
      </ul></div>
      <p class="faint">הופק ב־aRKtuar AI ${esc(CFG.version || '')} · ${new Date().toLocaleDateString('he-IL')} · אינו מהווה חוות דעת אקטוארית או ייעוץ משפטי.</p>`;
  }
  function renderReport() {
    return `<div class="row noprint" style="margin-bottom:14px"><h1 style="flex:1">דוח איזון משאבים</h1>
      <button class="btn" data-act="print">🖨️ הדפסה / PDF</button><button class="btn" data-act="dlReport">⬇️ הורדת הדוח (HTML)</button><button class="btn ghost" data-act="export">שמירת קובץ תיק</button></div>
      <div id="report">${reportHtml()}</div>${nav('bank', null)}`;
  }
  async function downloadReport() {
    let css = '';
    try { css = await (await fetch('assets/app.css')).text(); css = css.replace(/@font-face\{[^}]*\}/g, ''); } catch (e) { /* offline copy without styles */ }
    const html = `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>דוח איזון ${esc(S.meta.caseName || '')}</title><style>${css}body{padding:20px;max-width:1000px;margin:0 auto}</style></head><body>
      <div class="brand" style="margin-bottom:16px"><span class="wm" style="font-size:22px;font-weight:700;direction:ltr">a<b style="color:#22C983">RK</b>tuar AI</span></div>${reportHtml()}</body></html>`;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
    a.download = `arktuar_report_${(S.meta.caseName || 'case').replace(/[^\w֐-׿-]+/g, '_')}_${today()}.html`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  // =====================================================================
  //  Events
  // =====================================================================
  function setPath(path, val) {
    const parts = path.split('.'); let o = S;
    for (let i = 0; i < parts.length - 1; i++) o = o[parts[i]];
    o[parts[parts.length - 1]] = val;
  }
  const snapshot = () => JSON.parse(JSON.stringify(S));

  document.addEventListener('change', e => {
    const el = e.target;
    if (el.id === 'mapRow' && mapping) { mapping.row = Math.max(-1, Math.min(mapping.rows.length - 1, +el.value - 1)); renderMapping(); return; }
    if (el.dataset.bind) {
      setPath(el.dataset.bind, el.type === 'number' ? (el.value === '' ? 0 : +el.value) : el.value);
      if (/^incomes\.|^settings\./.test(el.dataset.bind)) { const w = ui.who.bank; if (S.bank[w].tx.length) runAnalysis(w); renderSoon(); return; }
      if (/^meta\.regime$|\.name$/.test(el.dataset.bind)) { renderSoon(); return; }
      renderRail(); save(); return;
    }
    if (el.dataset.flag) { const [w, k] = el.dataset.flag.split('.'); S.spouses[w].flags[k] = el.checked; save(); return; }
    if (el.dataset.doc && el.tagName === 'SELECT') { if (el.value) S.docs[el.dataset.doc] = el.value; else delete S.docs[el.dataset.doc]; renderSoon(); return; }
    if (el.dataset.kid) { const [i, k] = el.dataset.kid.split('.'); S.kids[+i][k] = el.value; save(); return; }
    if (el.dataset.fa || el.dataset.fv) {
      const w = ui.who.bank, id = el.dataset.fa || el.dataset.fv;
      const f = S.bank[w].findings.find(x => x.id === id); if (!f) return;
      if (el.dataset.fa) f.asAsset = el.checked; else f.assetValue = +el.value || 0;
      syncHidden(w); renderSoon(); return;
    }
    if (el.dataset.act === 'draft') {
      try {
        if (el.checked) { localStorage.setItem(DRAFT_FLAG, '1'); save(); toast('שמירת טיוטה הופעלה'); }
        else { localStorage.removeItem(DRAFT_FLAG); localStorage.removeItem(DRAFT_KEY); toast('הטיוטה נמחקה מהמכשיר'); }
      } catch (err) { toast('הדפדפן חוסם שמירה מקומית', true); }
    }
  });

  document.addEventListener('click', async e => {
    const el = e.target.closest('[data-step],[data-act]');
    if (!el) return;
    if (el.dataset.step && !el.dataset.act) { go(el.dataset.step); return; }
    const act = el.dataset.act, w = el.dataset.w;
    switch (act) {
      case 'emp': S.spouses[w].employment = el.dataset.v; render(); break;
      case 'who': ui.who[el.dataset.scope] = w; render(); break;
      case 'kidAdd': S.kids.push({ name: '', birth: '', lives: 'A' }); render(); break;
      case 'kidDel': S.kids.splice(+el.dataset.i, 1); render(); break;
      case 'signin': AI.signIn(snapshot()); break;
      case 'signout': await AI.signOut(); render(); break;
      case 'export': exportJson(); break;
      case 'import': {
        const [f] = await pickFile('.json');
        if (!f) break;
        try { load(JSON.parse(await f.text())); ['A', 'B'].forEach(x => { if (S.bank[x].tx.length) runAnalysis(x); }); toast('התיק נטען'); render(); }
        catch (err) { toast('קובץ תיק לא תקין', true); }
        break;
      }
      case 'reset': if (confirm('למחוק את כל הנתונים בתיק?')) { S = E.newState(); ui.bankResult = { A: null, B: null }; try { localStorage.removeItem(DRAFT_KEY); } catch (err) { /* ignore */ } render(); } break;
      case 'misUpload': misUpload(w); break;
      case 'misAdd': misAdd(w); break;
      case 'add': openItem(E.newItem({ cat: el.dataset.cat, owner: 'A' }), true); break;
      case 'edit': { const it = S.items.find(i => i.id === el.dataset.id); if (it) openItem(it, false); break; }
      case 'del': if (confirm('למחוק את הפריט?')) { S.items = S.items.filter(i => i.id !== el.dataset.id); render(); } break;
      case 'saveItem': saveItem(); break;
      case 'closeDlg': finishMapping(null); $('#dlg').close(); editing = null; pending = null; break;
      case 'mapApply': applyMapping(); break;
      case 'mapCancel': finishMapping(null); break;
      case 'bizCalc': { const p = +$('#bizProfit').value || 0, m = +$('#bizMult').value || 0; const v = $('#itemForm [name=value]'); if (v) v.value = Math.round(p * m); break; }
      case 'bankUpload': bankUpload(w); break;
      case 'bankClear': if (confirm('למחוק את כל התנועות שנטענו?')) { S.bank[w] = { tx: [], findings: [], files: [] }; ui.bankResult[w] = null; syncHidden(w); render(); } break;
      case 'analyze': runAnalysis(w); render(); break;
      case 'aiBank': aiBank(w); break;
      case 'aiDoc': aiDoc(w, el.dataset.type, el.dataset.doc); break;
      case 'aiApply': aiApply(); break;
      case 'fdToggle': { const bw = ui.who.bank; const f = S.bank[bw].findings.find(x => x.id === el.dataset.id); if (f) { f.status = f.status === 'dismissed' ? 'open' : 'dismissed'; syncHidden(bw); render(); } break; }
      case 'print': window.print(); break;
      case 'dlReport': downloadReport(); break;
    }
  });

  // Drag & drop onto drop zones
  document.addEventListener('dragover', e => { const d = e.target.closest('.drop'); if (d) { e.preventDefault(); d.classList.add('over'); } });
  document.addEventListener('dragleave', e => { const d = e.target.closest('.drop'); if (d) d.classList.remove('over'); });
  document.addEventListener('drop', async e => {
    const d = e.target.closest('.drop'); if (!d) return;
    e.preventDefault(); d.classList.remove('over');
    const files = Array.from((e.dataTransfer && e.dataTransfer.files) || []);
    if (!files.length) return;
    const act = d.dataset.act, w = d.dataset.w;
    if (act === 'misUpload') misUpload(w, files);
    else if (act === 'bankUpload') bankUpload(w, files);
    else if (act === 'aiDoc') aiDoc(w, d.dataset.type, d.dataset.doc, files);
  });

  // ---------- Boot ----------
  async function boot() {
    $('#ver').textContent = CFG.version || '';
    const stash = AI.takeStash();
    if (stash) load(stash);
    else if (draftOn()) { try { const d = localStorage.getItem(DRAFT_KEY); if (d) load(JSON.parse(d)); } catch (e) { /* ignore */ } }
    ['A', 'B'].forEach(x => { if (S.bank[x].tx.length) runAnalysis(x); });
    if (window.zip) zip.configure({ useWebWorkers: false });
    render();
    if (AI.available()) {
      try { await AI.init(); } catch (e) { console.error(e); }
      AI.onChange(() => renderAuth());
      render();
      if (stash && AI.user()) toast('התחברת. הנתונים שהוזנו נשמרו.');
    }
  }
  boot();
})();
