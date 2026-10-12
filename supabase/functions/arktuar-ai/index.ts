// aRKtuar AI - secure proxy to the Claude API.
// - The Anthropic key lives only here, as the ANTHROPIC_API_KEY secret.
// - Caller must be signed in (Supabase Auth JWT) AND on the arktuar_allowlist.
// - Per-user daily quota via arktuar_consume().
// - CORS restricted to ALLOWED_ORIGINS.
// - Document content is never logged or stored.
import { createClient } from "npm:@supabase/supabase-js@2.117.3";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const MODEL = Deno.env.get("ARKTUAR_MODEL") ?? "claude-sonnet-5-5";
const ALLOWED_ORIGINS = (Deno.env.get("ALLOWED_ORIGINS") ?? "https://erez1980.github.io")
  .split(",").map((s) => s.trim()).filter(Boolean);

const MAX_FILES = 4;
const MAX_TOTAL_B64 = 14 * 1024 * 1024; // ~10MB binary
const MEDIA = new Set(["application/pdf", "image/png", "image/jpeg", "image/webp"]);

const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

function cors(origin: string | null) {
  const allow = origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}
const json = (body: unknown, status: number, origin: string | null) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors(origin), "Content-Type": "application/json" } });

// ---------- Prompts ----------
const CATS = "realestate|pension|managers|gemel|gemelInv|hishtalmut|severance|bank|securities|crypto|rsu|business|vehicle|foreign|receivable|insurance|other|debt";

const BASE_RULES = `
You extract financial data from Israeli documents for a divorce asset-balancing calculator (איזון משאבים).
Return ONLY one JSON object, no prose, no markdown fences. Amounts are numbers in ILS (convert only if the document states the rate; otherwise keep the number and add a warning with the currency).
Dates are "YYYY-MM-DD" (use the 1st of the month when only month/year is known), or null.
Never invent values. If something is unreadable or missing, omit it and add a short Hebrew note to "warnings".
Write "label", "notes", "warnings" and "missing" in Hebrew.
JSON shape:
{
 "as_of_date": string|null,
 "holder_name": string|null,
 "items": [ { "cat": "${CATS}", "label": string, "value": number, "debt": number, "cost": number, "startDate": string|null, "endDate": string|null, "notes": string, "confidence": number } ],
 "income": { "salaryNet": number|null, "salaryGross": number|null, "businessDeclared": number|null, "otherDeclared": number|null, "employer": string|null, "vatTurnover": number|null },
 "transactions": [ { "date": string, "desc": string, "amount": number } ],
 "warnings": [string],
 "missing": [string]
}
"income" values are MONTHLY amounts (divide annual figures by 12). "vatTurnover" is ANNUAL.
"confidence" is 0..1 for each item.`;

const DOC_HINTS: Record<string, string> = {
  payslip: "Document: Israeli payslip (תלוש שכר) or Form 106. Fill income.salaryNet/salaryGross/employer. Add items only for balances shown (e.g. accrued severance, keren hishtalmut balance, accrued vacation value as cat 'other').",
  taxReturn: "Document: annual tax return (דוח שנתי 1301/0135) or tax assessment of a self-employed person. Fill income.businessDeclared (monthly = annual taxable business income / 12), income.vatTurnover if turnover appears, otherDeclared for rent/capital income.",
  mislaka: "Document: Mislaka / pension report (דוח מסלקה פנסיונית, דוח שנתי מקופה). One item per fund/policy: cat pension|managers|gemel|gemelInv|hishtalmut|severance|insurance, value = accumulated savings (צבירה), startDate = join date (תאריך הצטרפות), label = company + product + policy number last 4 digits.",
  bank: "Document: bank account statement (דף חשבון / תדפיס עו\"ש). Put EVERY transaction into 'transactions' (credit positive, debit negative), up to 600 rows, in date order. Add one item cat 'bank' with the closing balance (value) at as_of_date. Deposits/savings plans shown -> extra 'bank' items.",
  mortgage: "Document: mortgage balance letter (אישור יתרה לסילוק משכנתא). One item cat 'debt' with value = payoff balance, label with bank and property, notes with tracks. Also note the property address.",
  property: "Document: property deed/appraisal/purchase contract (נסח טאבו / שומה / חוזה רכישה). One item cat 'realestate': value = appraised or market value if stated, cost = purchase price, startDate = purchase date, notes = registered owners and shares, liens.",
  securities: "Document: investment portfolio / brokerage statement. One item per account (cat securities or crypto): value = market value, cost = cost basis if shown.",
  rsu: "Document: equity compensation statement (RSU / options, e.g. Morgan Stanley, Schwab, ESOP, Altshare). One item per grant (cat rsu): value = current value of unsold shares/grant, startDate = grant date, endDate = final vest date, notes = vested vs unvested and track (102 capital / ordinary).",
  business: "Document: financial statements of a business (דוחות כספיים / מאזן / רווח והפסד). One item cat 'business' with value = equity (הון עצמי) and notes with annual net profit; fill income.businessDeclared (monthly) and income.vatTurnover.",
  vehicle: "Document: vehicle license or valuation (רישיון רכב / מחירון). One item cat 'vehicle' with an estimated value only if a price appears.",
  loan: "Document: loan agreement/statement. Item cat 'debt' (money owed) or 'receivable' (money owed to the holder).",
  other: "Document: unknown financial document. Extract whatever balances, assets, debts and incomes it contains.",
};

const BANK_DIGEST_PROMPT = `
You are a forensic accountant assisting an Israeli family-law asset balancing.
You receive an anonymized digest of CREDIT counterparties from one spouse's bank account (counterparty text, local class, total ILS, count, distinct months).
Assess which groups are likely undeclared business income (e.g. many small payers via Bit/PayBox, recurring transfers from the same companies, cash/check deposits) versus salary, family support, internal transfers, refunds, loans.
Return ONLY JSON:
{ "assessments": [ { "cp": string, "likely": "business_income|salary|family|internal|refund|loan|benefit|rental_income|other", "suspicion": number, "reason": string } ],
  "summary": string, "suggested_requests": [string] }
"suspicion" 0..1 that it is income not reflected in declared figures. "reason", "summary" and "suggested_requests" in Hebrew. Be factual and cautious; this is a lead for verification, not a conclusion.`;

function extractJson(text: string) {
  const t = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  try { return JSON.parse(t); } catch { /* fall through */ }
  const s = t.indexOf("{"), e = t.lastIndexOf("}");
  if (s >= 0 && e > s) return JSON.parse(t.slice(s, e + 1));
  throw new Error("bad json");
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(origin) });
  if (req.method !== "POST") return json({ ok: false, error: "method" }, 405, origin);
  if (origin && !ALLOWED_ORIGINS.includes(origin)) return json({ ok: false, error: "מקור לא מורשה" }, 403, origin);

  // ---- Auth ----
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return json({ ok: false, error: "נדרשת התחברות" }, 401, origin);
  const { data: u, error: ue } = await admin.auth.getUser(token);
  if (ue || !u?.user) return json({ ok: false, error: "התחברות לא תקפה, התחברו מחדש" }, 401, origin);
  const email = (u.user.email ?? "").toLowerCase();

  // ---- Allowlist ----
  const { data: allow, error: ae } = await admin.from("arktuar_allowlist").select("daily_limit").eq("email", email).maybeSingle();
  if (ae) return json({ ok: false, error: "שגיאת בדיקת הרשאות" }, 500, origin);
  if (!allow) return json({ ok: false, error: "החשבון שלך עדיין לא מורשה לשימוש ב־AI. פנו למנהל המערכת." }, 403, origin);
  const limit = allow.daily_limit;
  if (!Number.isInteger(limit) || limit <= 0) return json({ ok: false, error: "המכסה לחשבון זה אינה פעילה" }, 403, origin);
  if (!ANTHROPIC_KEY) return json({ ok: false, error: "השרת לא הוגדר (חסר מפתח API)" }, 500, origin);

  // ---- Payload validation ----
  let body: any;
  try { body = await req.json(); } catch { return json({ ok: false, error: "בקשה לא תקינה" }, 400, origin); }
  const task = body?.task;
  if (task !== "extract" && task !== "bankDigest") return json({ ok: false, error: "משימה לא מוכרת" }, 400, origin);
  const files = Array.isArray(body.files) ? body.files : [];
  if (files.length > MAX_FILES) return json({ ok: false, error: `עד ${MAX_FILES} קבצים בבקשה` }, 400, origin);
  let total = 0;
  for (const f of files) {
    if (!MEDIA.has(f?.mediaType) || typeof f?.data !== "string") return json({ ok: false, error: "סוג קובץ לא נתמך" }, 400, origin);
    total += f.data.length;
  }
  if (total > MAX_TOTAL_B64) return json({ ok: false, error: "הקבצים גדולים מדי" }, 413, origin);
  if (task === "extract" && !files.length) return json({ ok: false, error: "לא צורף קובץ" }, 400, origin);
  if (task === "bankDigest" && (!Array.isArray(body.digest) || body.digest.length > 200)) return json({ ok: false, error: "סיכום לא תקין" }, 400, origin);

  // ---- Quota (consumed only after validation) ----
  const { data: used, error: qe } = await admin.rpc("arktuar_consume", { p_user: u.user.id, p_limit: limit });
  if (qe) return json({ ok: false, error: "שגיאת מכסה" }, 500, origin);
  if (used === -1) return json({ ok: false, error: `הגעתם למכסה היומית (${limit} בקשות). נסו שוב מחר.` }, 429, origin);

  // ---- Build Claude request ----
  let system: string, content: any[];
  if (task === "extract") {
    const hint = DOC_HINTS[body.docType] ?? DOC_HINTS.other;
    system = BASE_RULES + "\n" + hint;
    content = files.map((f: any) => f.mediaType === "application/pdf"
      ? { type: "document", source: { type: "base64", media_type: f.mediaType, data: f.data } }
      : { type: "image", source: { type: "base64", media_type: f.mediaType, data: f.data } });
    const ctx = body.context ?? {};
    content.push({ type: "text", text: `Marriage date: ${ctx.marriageDate ?? "unknown"}. Crisis date: ${ctx.crisisDate ?? "unknown"}. Extract now.` });
  } else {
    system = BANK_DIGEST_PROMPT;
    const ctx = body.context ?? {};
    content = [{ type: "text", text: JSON.stringify({ declaredMonthly: ctx.declared ?? null, employmentType: ctx.employment ?? null, months: ctx.months ?? null, digest: body.digest }) }];
  }

  let r: Response;
  try {
    r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: MODEL, max_tokens: task === "extract" ? 16000 : 4000, system, messages: [{ role: "user", content }] }),
      signal: AbortSignal.timeout(90000),
    });
  } catch {
    return json({ ok: false, error: "שירות ה־AI אינו זמין כרגע, נסו שוב" }, 502, origin);
  }
  if (!r.ok) {
    // Log status only, never the payload
    console.error("anthropic status", r.status);
    const msg = r.status === 429 ? "שירות ה־AI עמוס, נסו שוב בעוד דקה"
      : r.status === 400 ? "ה־AI לא הצליח לקרוא את הקובץ (ייתכן שהוא מוצפן או פגום)"
      : (r.status === 401 || r.status === 403) ? "מפתח ה־API בשרת לא תקין"
      : "שגיאה בשירות ה־AI";
    return json({ ok: false, error: msg }, 502, origin);
  }
  const out = await r.json();
  const text = (out.content ?? []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
  let data;
  try { data = extractJson(text); } catch { return json({ ok: false, error: "ה־AI החזיר תשובה לא קריאה, נסו שוב" }, 502, origin); }
  return json({ ok: true, data, usage: { calls: used, limit }, stop: out.stop_reason }, 200, origin);
});
