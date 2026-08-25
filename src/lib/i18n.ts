/**
 * Hand-rolled EN/HE dictionary — no i18n library.
 *
 * `getLang()` is the single place that turns the `lang` cookie into a `Lang`. The
 * predecessor project re-wrote `cookie === 'he' ? 'he' : 'en'` in ~10 files; import
 * this instead so there is exactly one place that decision lives.
 *
 * ⚠ `getLang()` is server-only, but `next/headers` is imported LAZILY inside it rather
 * than at module scope. A top-level import would poison the whole module for client
 * bundles: a Client Component importing so much as `dirFor` would pull `next/headers`
 * in with it and fail the build. With the lazy import, the rest of this module (`Lang`,
 * `dict`, `getT`, `dirFor`, `parseLangCookie`) is safe to import from Client Components
 * too — see `src/app/error.tsx`, which does exactly that. The one file that still can't
 * is `src/app/global-error.tsx`: it replaces the root layout itself when it activates,
 * so it has no `getLang()`-resolved value to receive and reads the cookie itself via
 * `document.cookie`, routing the raw value through the shared `parseLangCookie` so the
 * he/en decision still lives in exactly one place.
 */

export type Lang = 'en' | 'he';

type Dictionary = Record<string, string>;

const LANG_COOKIE = 'lang';

const en: Dictionary = {
  'nav.home': 'Home',
  'nav.privacy': 'Privacy',
  'nav.accessibility': 'Accessibility',
  'nav.main': 'Main navigation',

  'brand.name': 'Torim',

  'common.goHome': 'Back to home',
  'common.tryAgain': 'Try again',

  'home.badge': 'Coming soon',
  'home.heading': 'Simple, bilingual appointment booking',
  'home.tagline':
    'Torim gives small businesses a clean way to manage bookings in Hebrew and English.',
  'home.description':
    'The booking page for this business isn’t live yet. Once it is, customers will be able to pick a time here in their own language.',

  'notFound.title': 'Page not found',
  'notFound.description': 'This page doesn’t exist, or it may have moved.',

  'error.title': 'Something went wrong',
  'error.description':
    'An unexpected error occurred. You can try again or go back home.',
  'error.badge': 'Error',

  'globalError.title': 'The app hit a snag',
  'globalError.description':
    'Something went wrong while loading the page. Reloading usually fixes it.',
  'globalError.reload': 'Reload page',

  'footer.tagline': 'Built with Torim.',

  'privacy.title': 'Privacy Policy',
  'privacy.intro':
    'This page explains what information this booking system collects and how it is used.',
  'privacy.collect.title': 'What we collect',
  'privacy.collect.body':
    'When you book an appointment, we collect the details you enter — your name and phone number, and an email address if this business asks for one — along with the date, time, and service you selected.',
  'privacy.why.title': 'Why we collect it',
  'privacy.why.body':
    'This information is used only to schedule, confirm, and manage your booking, and to contact you about it if needed.',
  'privacy.storage.title': 'Where it is stored',
  'privacy.storage.body':
    'Your information is stored securely in this business’s database. Each business using Torim has its own separate, isolated data — no other business can see it.',
  'privacy.access.title': 'Who can access it',
  'privacy.access.body':
    'Only the business you booked with, and the staff it authorizes, can access your booking details. This information is never sold or shared with third parties.',
  'privacy.rights.title': 'Your rights',
  'privacy.rights.body':
    'You can ask to see, correct, or delete the information held about you. Contact the business directly — their contact details are on their booking page — to make a request.',
  'privacy.cookies.title': 'Cookies',
  'privacy.cookies.body':
    'This site uses only essential cookies, such as one that remembers your chosen language and one that keeps a staff member signed in. There are no advertising or tracking cookies.',

  'accessibility.title': 'Accessibility Statement',
  'accessibility.intro':
    'This business is committed to making its booking system usable by everyone, including people with disabilities.',
  'accessibility.standard.title': 'Standard',
  'accessibility.standard.body':
    'This site aims to conform to Israeli Standard 5568 and the international WCAG 2.0 Level AA guidelines, covering areas such as keyboard navigation, color contrast, text alternatives, and screen-reader support.',
  'accessibility.contact.title': 'Contact us',
  'accessibility.contact.body':
    'If you encounter a barrier while using this site, contact the business — their contact details are on their booking page. Please describe the problem and the page where it happened.',
  'accessibility.response.body':
    'We aim to respond to accessibility feedback within 5 business days.',
};

const he: Dictionary = {
  'nav.home': 'בית',
  'nav.privacy': 'פרטיות',
  'nav.accessibility': 'נגישות',
  'nav.main': 'ניווט ראשי',

  'brand.name': 'טורים',

  'common.goHome': 'חזרה לדף הבית',
  'common.tryAgain': 'נסה שוב',

  'home.badge': 'בקרוב',
  'home.heading':
    'קביעת תורים דו-לשונית ופשוטה',
  'home.tagline':
    'טורים נותן לעסקים קטנים דרך נקייה לנהל תורים בעברית ובאנגלית.',
  'home.description':
    'דף קביעת התורים של העסק הזה עוד לא פעיל. כשהוא יעלה, לקוחות יוכלו לבחור כאן זמן פנוי בשפה שלהם.',

  'notFound.title': 'הדף לא נמצא',
  'notFound.description':
    'הדף הזה לא קיים, או שהוא הועבר למקום אחר.',

  'error.title': 'משהו השתבש',
  'error.description':
    'אירעה שגיאה בלתי צפויה. אפשר לנסות שוב או לחזור לדף הבית.',
  'error.badge': 'שגיאה',

  'globalError.title': 'האפליקציה נתקלה בתקלה',
  'globalError.description':
    'משהו השתבש בטעינת הדף. ריענון הדף בדרך כלל פותר את זה.',
  'globalError.reload': 'רענון הדף',

  'footer.tagline': 'נבנה עם טורים.',

  'privacy.title': 'מדיניות פרטיות',
  'privacy.intro':
    'העמוד הזה מסביר אילו פרטים מערכת קביעת התורים אוספת וכיצד הם משמשים.',
  'privacy.collect.title': 'מה אנחנו אוספים',
  'privacy.collect.body':
    'בעת קביעת תור, אנחנו אוספים את הפרטים שהזנת — שם ומספר טלפון, וגם כתובת אימייל אם העסק מבקש אותה — יחד עם התאריך, השעה והשירות שבחרת.',
  'privacy.why.title': 'למה אנחנו אוספים את זה',
  'privacy.why.body':
    'המידע הזה משמש רק לתיאום, אישור וניהול התור שלך, וליצירת קשר איתך בנוגע אליו במידת הצורך.',
  'privacy.storage.title': 'איפה המידע נשמר',
  'privacy.storage.body':
    'המידע שלך נשמר באופן מאובטח במסד הנתונים של העסק. לכל עסק שמשתמש בטורים יש מידע נפרד ומבודד משלו — עסקים אחרים לא יכולים לראות אותו.',
  'privacy.access.title': 'מי יכול לגשת אליו',
  'privacy.access.body':
    'רק העסק שאצלו קבעת את התור, ואנשי הצוות שהוא הרשה, יכולים לגשת לפרטי התור שלך. המידע הזה לעולם לא נמכר ולא משותף עם צדדים שלישיים.',
  'privacy.rights.title': 'הזכויות שלך',
  'privacy.rights.body':
    'אפשר לבקש לראות, לתקן או למחוק את המידע שנשמר עליך. לשם כך יש לפנות ישירות לעסק — פרטי הקשר שלו מופיעים בדף קביעת התורים.',
  'privacy.cookies.title': 'עוגיות',
  'privacy.cookies.body':
    'האתר משתמש רק בעוגיות חיוניות, כמו עוגייה שזוכרת את השפה שבחרת ועוגייה ששומרת על התחברות של איש צוות. אין עוגיות פרסום או מעקב.',

  'accessibility.title': 'הצהרת נגישות',
  'accessibility.intro':
    'העסק מחויב להנגיש את מערכת קביעת התורים שלו לשימוש כל אדם, כולל אנשים עם מוגבלויות.',
  'accessibility.standard.title': 'תקן',
  'accessibility.standard.body':
    'האתר שואף לעמוד בתקן הישראלי 5568 ובהנחיות הבינלאומיות WCAG 2.0 ברמה AA, הכוללות בין היתר ניווט מקלדת, ניגודיות צבעים, טקסט חלופי לתמונות ותמיכה בקוראי מסך.',
  'accessibility.contact.title': 'צור קשר',
  'accessibility.contact.body':
    'אם נתקלת בבעיית נגישות באתר, פנה לעסק — פרטי הקשר שלו מופיעים בדף קביעת התורים. נשמח שתתאר את הבעיה ואת העמוד שבו היא התרחשה.',
  'accessibility.response.body':
    'אנו שואפים להגיב לפניות בנושא נגישות תוך 5 ימי עסקים.',
};

export const dict: Record<Lang, Dictionary> = { en, he };

/**
 * A dictionary contributed by one feature area, merged over the core one.
 *
 * Each feature keeps its own strings beside its routes rather than everything piling
 * into this file. It also means two features being built at once cannot collide in the
 * same dictionary literal.
 */
export type FeatureDictionary = {
  readonly [L in Lang]: Readonly<Record<string, string>>;
};

/**
 * Returns a lookup that resolves, in order: the feature dictionary in the active
 * language, the core dictionary in the active language, then the same two in English,
 * and finally the key itself.
 *
 * Falling back to the key rather than to an empty string means a missing translation
 * shows up as `booking.confirm` on screen — visibly wrong, rather than an invisible
 * blank that reads as a layout bug.
 */
export function getT(lang: Lang, feature?: FeatureDictionary): (key: string) => string {
  const featurePrimary = feature?.[lang];
  const featureEnglish = feature?.en;
  const primary = dict[lang];

  return (key: string) =>
    featurePrimary?.[key] ?? primary[key] ?? featureEnglish?.[key] ?? dict.en[key] ?? key;
}

export function dirFor(lang: Lang): 'rtl' | 'ltr' {
  return lang === 'he' ? 'rtl' : 'ltr';
}

/** The one place that decides whether a raw cookie value means Hebrew. */
export function parseLangCookie(value: string | undefined | null): Lang {
  return value === 'he' ? 'he' : 'en';
}

/**
 * Server-only. Reads the `lang` cookie and resolves the active language, falling
 * back to English. Call this from Server Components / layouts, not Client Components.
 */
export async function getLang(): Promise<Lang> {
  // Lazy, so importing the pure half of this module from a Client Component is safe.
  const { cookies } = await import('next/headers');
  const store = await cookies();
  return parseLangCookie(store.get(LANG_COOKIE)?.value);
}
