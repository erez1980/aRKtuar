# aRKtuar AI: איזון משאבים בין בני זוג

כלי עזר לאיזון משאבים לפני גירושין. הכלי בונה רשימת מסמכים מלאה לפי הפרופיל של כל אחד מבני הזוג, קורא קבצי מסלקה ודפי בנק, ומאפשר לחלץ נתונים ממסמכי PDF בעזרת AI. בסוף הוא מפיק דוח HTML שבראשו השורה התחתונה: מי מעביר למי וכמה.

## מה יש בו

- **פתיחת תיק**: מזינים תאריך נישואין, מועד קרע, משטר רכושי, ולכל אחד מבני הזוג סוג תעסוקה (שכיר / עצמאי) ופרופיל נכסים. אפשר לרשום גם ילדים, כהכנה לשלב המזונות.
- **רשימת מסמכים דינמית**: לכל אחד מבני הזוג, עם סטטוס לכל מסמך (חסר / התקבל / לא רלוונטי). מסמכי חובה שחסרים מופיעים בנספח הדוח.
- **פנסיה**: קובץ ה־ZIP של המסלקה נקרא מקומית, עם המפענח של RK-Mislaka. כל קופה נכנסת לאיזון באופן יחסי לתקופת הנישואין.
- **נכסים וחובות**: נדל״ן ומשכנתא, RSU (לפי כלל הזמן), עסק (כולל מחשבון מכפיל רווח), ני״ע, קריפטו, נכסים בחו״ל, רכב, הלוואות, החרגות ושווי מלפני הנישואין.
- **דפי בנק**: קובצי CSV ו־Excel נקראים מקומית, PDF נקרא דרך AI. הניתוח מזהה:
  - מקורות הכנסה חוזרים
  - זיכויים בביט ובפייבוקס ממשלמים רבים
  - הפקדות מזומן ושיקים
  - פער בין ההכנסה בפועל להכנסה המדווחת
  - פער מול המחזור שדווח למע״מ
  - יציאות חריגות ועלייה במשיכות מזומן לפני הקרע

  ממצא שאומת אפשר לכלול כ״נכס חבוי משוער״, והוא נכנס לשורה תחתונה נפרדת.
- **הדוח**: השורה התחתונה מוצגת בשלוש גרסאות: ברוטו, אחרי מס משוער, וכולל ממצאים. הדוח כולל גם חלוקת פנסיה במקור, פירוט לפי סוג נכס, החרגות והכנסה אמיתית. אפשר להדפיס אותו או להוריד כקובץ HTML.

## פרטיות ואבטחה

- הנתונים נשמרים בדפדפן בלבד. ייצוא וטעינה של תיק נעשים בקובץ JSON.
- שמירת טיוטה ב־localStorage כבויה כברירת מחדל.
- ה־CSP מאפשר חיבור רק ל־Supabase.
- מפתח Anthropic נשמר רק כ־secret ב־Edge Function `arktuar-ai`, ואף פעם לא בדפדפן.
- גישה ל־AI דורשת התחברות עם Google, וגם שהמשתמש יופיע בטבלה `arktuar_allowlist`. לכל משתמש יש מכסה יומית, שנספרת בטבלה `arktuar_usage`.
- תוכן המסמכים לא נשמר ולא נרשם בלוגים.
- בניתוח AI של דפי בנק נשלח רק סיכום מקובץ של מקורות הזיכוי, בלי התנועות עצמן.

## מבנה

```
index.html                         # page + CSP
assets/app.js                      # UI
assets/engine.js                   # balancing engine (pure, node-testable)
assets/bank.js                     # bank parsing + forensic heuristics (pure)
assets/ai.js                       # Supabase auth + AI proxy client
assets/config.js                   # public Supabase URL / publishable key
assets/mislaka-parsers.js          # from RK-Mislaka
assets/vendor/                     # supabase-js, SheetJS, zip.js (+ licenses)
supabase/functions/arktuar-ai/     # Edge Function (Deno)
supabase/migrations/               # allowlist + quota tables
```

## הוספת משתמש מורשה ל־AI

```sql
insert into public.arktuar_allowlist (email, daily_limit) values ('someone@gmail.com', 30);
```

## הגדרת Supabase ייעודי

הפרויקט המיועד הוא DriveCheck, מזהה `jggosolvobyfvablywzi`. נכון ל־10.10.2026 הוא לא פעיל; ניסיון השחזור נחסם במגבלת שני פרויקטים חינמיים פעילים. נדרשת פעולה של הבעלים במסלול או בקיבולת החשבון לפני הפעלתו. ה־AI כבוי במפורש ב־`assets/config.js` עד להשלמת ההגדרה. הכלים המקומיים ממשיכים לעבוד.

1. שחזרו את הפרויקט הייעודי. אין להשתמש בפרויקט של רוכבים קבוע לצורך aRKtuar.
2. הריצו בפרויקט הייעודי בלבד את `supabase/migrations/20261009_arktuar_ai.sql`.
3. הפעילו Google ב־Auth → Providers עם Client ID ו־Client Secret. ב־Google Console הגדירו callback: `https://jggosolvobyfvablywzi.supabase.co/auth/v1/callback`. ב־Supabase הגדירו Site URL ו־Redirect URL: `https://erez1980.github.io/aRKtuar/`.
4. הגדירו ב־Edge Function Secrets את `ANTHROPIC_API_KEY` ואת `ALLOWED_ORIGINS=https://erez1980.github.io`. אין לשמור את סודות Anthropic או OAuth בקוד או בקובץ ציבורי.
5. פרסו: `supabase functions deploy arktuar-ai --no-verify-jwt --project-ref jggosolvobyfvablywzi`. אימות ה־JWT בשער כבוי בכוונה; הפונקציה מאמתת את המשתמש בעצמה לפני בדיקת הרשאות ומכסה.
6. העתיקו publishable key פעיל ל־`supabaseKey` והגדירו `aiEnabled: true` ב־`assets/config.js`; כתובת הפרויקט ו־CSP כבר מצביעים לפרויקט הייעודי. בכל שחרור יש לעדכן `ARK_CONFIG.version`.
7. בדקו POST ללא התחברות (401), עם JWT של משתמש שאינו מורשה (403), ועם משתמש מורשה וקובץ תלוש PDF לדוגמה (200). אל תכניסו מסמכים אמיתיים או JWT ללוגים או למאגר.

## סטטוס ניקוי הפרויקט השגוי

ב־10.10.2026 נמחקו רק `public.arktuar_consume(uuid, int)`, `public.arktuar_usage` ו־`public.arktuar_allowlist` מהפרויקט `nsufrchdgyomgbqmvdlr`. בדיקת קטלוג אישרה שאין טבלאות או פונקציות בשם `arktuar*`. הפונקציה בענן `arktuar-ai` עדיין דורשת מחיקה על ידי הבעלים: `supabase functions delete arktuar-ai --project-ref nsufrchdgyomgbqmvdlr`. לאחר המחיקה יש לוודא ברשימת Edge Functions שלא נותרו פונקציות בשם `arktuar*`. אין לשנות שום אובייקט אחר בפרויקט זה.

## בדיקות ויבוא בנק

הריצו `node --test tests/*.test.js` ללא התקנת תלויות. GitHub Actions בודק תחביר של `assets/*.js` ומריץ את הבדיקות בכל push ובקשת שינוי.

יבוא CSV תומך בפסיק, נקודה־פסיק וטאב, שדות מצוטטים, שורות פתיחה וקידוד windows-1255. אם הכותרות אינן מזוהות, נפתח מיפוי עמודות ידני; ביצוא חברת אשראי אפשר להגדיר סכום חיובי כהוצאה. קיימות בדיקות תבניות מייצגות להפועלים, לאומי, דיסקונט, מזרחי־טפחות, Max, ישראכרט וכאל, אך לא סופקו יצואים אמיתיים לאימות. ראו `tests/fixtures/README.md`.

הלכת השיתוף אינה מיושמת במנוע: בחירתה מציגה הודעה ברורה גם בטופס וגם בדוח. הדוח מתריע על ממצאי הכנסה שסומנו כנכס חבוי ונכללים גם בפער ההכנסות, כדי להימנע מכפל ספירה.

---
הכלי אינו מחליף חוות דעת של אקטואר מוסמך, רואה חשבון או עורך דין.
