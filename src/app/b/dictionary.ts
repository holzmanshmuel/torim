/**
 * Strings for the public booking flow and the customer's manage page.
 *
 * A feature dictionary (see `FeatureDictionary` in `@/lib/i18n`) rather than an addition
 * to the core one: it keeps this lane's copy beside its routes, and means two features
 * being built at the same time cannot collide inside one dictionary literal.
 *
 * `{placeholder}` slots are filled by `fill()` from `./lib/format`. Values substituted
 * into a Hebrew sentence — dates, times, prices, durations, phone numbers — must already
 * be bidi-isolated by the formatter that produced them, or they render reversed.
 */
import type { FeatureDictionary } from '@/lib/i18n';

const en = {
  // ── Page shell ────────────────────────────────────────────────────────────────
  'booking.meta.title': 'Book an appointment',
  'booking.meta.description': 'Choose a service and a time. No account needed.',
  'booking.heading': 'Book an appointment',
  'booking.tagline': 'Choose a service, pick a time. No account, no app.',
  'booking.close': 'Close',

  // ── Stepper ───────────────────────────────────────────────────────────────────
  'booking.step.service': 'Service',
  'booking.step.time': 'Day & time',
  'booking.step.details': 'Your details',
  'booking.step.progress': 'Step {n} of {total}',
  'booking.back': 'Back',
  'booking.change': 'Change',

  // ── Step 1: service ───────────────────────────────────────────────────────────
  'booking.service.heading': 'What would you like to book?',
  'booking.service.empty.title': 'Nothing to book yet',
  'booking.service.empty.message':
    'This business has not published any services yet. Get in touch and they will help you directly.',
  'booking.service.empty.action': 'Back to home',

  // ── Step 2: day ───────────────────────────────────────────────────────────────
  'booking.day.heading': 'Pick a day',
  'booking.day.prevMonth': 'Previous month',
  'booking.day.nextMonth': 'Next month',
  'booking.day.loading': 'Loading available days',
  'booking.day.legendOpen': 'Available',
  'booking.day.legendFull': 'Fully booked',
  'booking.day.legendClosed': 'Closed',
  'booking.day.legendOther': 'Not open for booking',
  'booking.day.today': 'Today',
  'booking.day.inPast': 'in the past',
  'booking.day.countAvailable': '{n} times available',
  'booking.day.oneAvailable': '1 time available',

  // ── Day states. Every one of these leads somewhere: a day is never a dead tap. ─
  'booking.state.full.title': 'Fully booked',
  'booking.state.full.body': 'Every appointment on {date} is already taken.',
  'booking.state.closed.title': 'Closed that day',
  'booking.state.closed.body': '{business} is closed on {date}.',
  'booking.state.tooSoon.title': 'Too soon to book',
  'booking.state.tooSoon.body':
    '{business} needs at least {notice} notice, so the remaining times on {date} have passed.',
  'booking.state.beyond.title': 'Not open for booking yet',
  'booking.state.beyond.body':
    '{business} takes bookings up to {advance} ahead. The last bookable day is {horizon}.',
  'booking.state.past.title': 'That day has passed',
  'booking.state.past.body': 'Pick today or any later day.',
  'booking.state.nextOpen': 'Go to the next day with openings',
  'booking.state.searching': 'Looking for the next opening…',
  'booking.state.noneAhead': 'No openings between now and {horizon}.',
  'booking.state.noneThisMonth': 'Nothing available in {month}.',
  'booking.state.goToHorizon': 'Go to the last bookable day',

  // ── Step 2: slots ─────────────────────────────────────────────────────────────
  'booking.slot.heading': 'Pick a time',
  'booking.slot.loading': 'Loading times',
  'booking.slot.timezoneNote': 'All times are {business} local time ({timezone}).',
  'booking.slot.none': 'No times left on this day.',
  'booking.slot.morning': 'Morning',
  'booking.slot.afternoon': 'Afternoon',
  'booking.slot.evening': 'Evening',

  // ── Step 3: details ───────────────────────────────────────────────────────────
  'booking.details.heading': 'Who is it for?',
  'booking.details.name': 'Full name',
  'booking.details.namePlaceholder': 'Dana Cohen',
  'booking.details.nameRequired': 'Please tell us your name.',
  'booking.details.nameTooLong': 'That name is too long.',
  'booking.details.phone': 'Mobile number',
  'booking.details.phoneHintLocal': 'However you normally write it — 050-123-4567 is fine.',
  'booking.details.phoneHintInternational':
    'Include your country code, for example +972 50 123 4567.',
  'booking.details.phoneInvalid': 'That does not look like a number we can reach you on.',
  'booking.details.phoneNeedsCountry':
    'Please include your country code, for example +972 50 123 4567.',
  'booking.details.note': 'Anything they should know?',
  'booking.details.noteOptional': 'Optional',
  'booking.details.notePlaceholder': 'Allergies, preferences, anything useful…',
  'booking.details.noteTooLong': 'Please keep this shorter.',
  'booking.details.submit': 'Confirm booking',
  'booking.details.privacy':
    'We collect your name and phone number only to make and manage this appointment.',
  'booking.details.privacyLink': 'How your details are used',

  // ── Summary ───────────────────────────────────────────────────────────────────
  'booking.summary.heading': 'Your appointment',
  'booking.summary.service': 'Service',
  'booking.summary.when': 'When',
  'booking.summary.duration': 'Takes',
  'booking.summary.price': 'Price',
  'booking.summary.name': 'Name',
  'booking.summary.phone': 'Phone',

  // ── Errors ────────────────────────────────────────────────────────────────────
  'booking.error.slotTaken': 'That time was taken while you were filling this in. Please pick another.',
  'booking.error.generic': 'Something went wrong. Please try again.',
  'booking.error.rateLimited':
    'Too many attempts from this device. Please try again in {wait} — the business is open, this is just a limit on repeated tries.',
  'booking.error.invalidRequest': 'Something in that request did not look right. Please reload the page.',
  'booking.error.unavailable': 'This booking page is not available.',
  'booking.error.retry': 'Try again',

  // ── Confirmation ──────────────────────────────────────────────────────────────
  'booking.done.confirmedTitle': 'You are booked',
  'booking.done.confirmedBody': 'Your appointment is saved. See you then.',
  'booking.done.pendingTitle': 'Request sent',
  'booking.done.pendingBody':
    '{business} confirms first-time customers personally. This time is held for you, but it is not final until they confirm — you will hear from them shortly.',
  'booking.done.addToCalendar': 'Add to calendar',
  'booking.done.manageTitle': 'Need to change it?',
  'booking.done.manageBody':
    'This private link reschedules or cancels your appointment. Keep it — it is the only way back in.',
  'booking.done.manageOpen': 'Open my booking',
  'booking.done.copyLink': 'Copy link',
  'booking.done.copied': 'Link copied',
  'booking.done.copyFailed': 'Could not copy automatically — select the link and copy it.',
  'booking.done.whatsapp': 'Message {business}',
  'booking.done.whatsappMessage': 'Hi! I have just booked {service} for {when}.',
  'booking.done.bookAnother': 'Book another appointment',

  // ── Statuses ──────────────────────────────────────────────────────────────────
  'booking.status.confirmed': 'Confirmed',
  'booking.status.pending': 'Awaiting confirmation',
  'booking.status.cancelled': 'Cancelled',
  'booking.status.no_show': 'Missed',

  // ── Manage page ───────────────────────────────────────────────────────────────
  'manage.meta.title': 'Your appointment',
  'manage.heading': 'Your appointment',
  'manage.bookedFor': 'Booked for {name}',
  'manage.pending.note':
    '{business} has not confirmed this appointment yet. They will be in touch.',
  'manage.actions.reschedule': 'Reschedule',
  'manage.actions.cancel': 'Cancel appointment',
  'manage.actions.addToCalendar': 'Add to calendar',
  'manage.actions.keep': 'Keep it',
  'manage.cancel.title': 'Cancel this appointment?',
  'manage.cancel.message': 'Cancel {service} on {when}? The time goes back to other customers.',
  'manage.cancel.confirm': 'Yes, cancel it',
  'manage.cancel.done': 'Your appointment was cancelled.',
  'manage.cancel.tooLate.title': 'Too late to cancel online',
  'manage.cancel.tooLate.body':
    '{business} asks for {window} notice for an online cancellation. Message them directly and they will sort it out.',
  'manage.reschedule.title': 'Pick a new time',
  'manage.reschedule.current': 'Currently {when}',
  'manage.reschedule.confirm': 'Move to {when}',
  'manage.reschedule.pickFirst': 'Choose a new time to continue.',
  'manage.reschedule.done': 'Your appointment was moved.',
  'manage.cancelled.title': 'This appointment was cancelled',
  'manage.cancelled.body': 'Nothing is booked. You can book a new time whenever you like.',
  'manage.noShow.title': 'Marked as missed',
  'manage.noShow.body': 'The business marked this appointment as missed.',
  'manage.past.title': 'This appointment has passed',
  'manage.past.body': 'There is nothing left to change here.',
  'manage.whatsapp': 'Message {business}',
  'manage.whatsappMessage': 'Hi! About my appointment on {when}…',
  'manage.bookAnother': 'Book another appointment',
} as const;

const he = {
  // ── Page shell ────────────────────────────────────────────────────────────────
  'booking.meta.title': 'קביעת תור',
  'booking.meta.description': 'בוחרים שירות ושעה. בלי הרשמה.',
  'booking.heading': 'קביעת תור',
  'booking.tagline': 'בוחרים שירות, בוחרים שעה. בלי חשבון ובלי אפליקציה.',
  'booking.close': 'סגירה',

  // ── Stepper ───────────────────────────────────────────────────────────────────
  'booking.step.service': 'שירות',
  'booking.step.time': 'יום ושעה',
  'booking.step.details': 'הפרטים שלך',
  'booking.step.progress': 'שלב {n} מתוך {total}',
  'booking.back': 'חזרה',
  'booking.change': 'שינוי',

  // ── Step 1: service ───────────────────────────────────────────────────────────
  'booking.service.heading': 'מה תרצו לקבוע?',
  'booking.service.empty.title': 'אין עדיין מה לקבוע',
  'booking.service.empty.message':
    'העסק עוד לא פרסם שירותים. אפשר ליצור איתם קשר והם יעזרו ישירות.',
  'booking.service.empty.action': 'חזרה לדף הבית',

  // ── Step 2: day ───────────────────────────────────────────────────────────────
  'booking.day.heading': 'בחירת יום',
  'booking.day.prevMonth': 'לחודש הקודם',
  'booking.day.nextMonth': 'לחודש הבא',
  'booking.day.loading': 'טוענים את הימים הפנויים',
  'booking.day.legendOpen': 'יש תורים',
  'booking.day.legendFull': 'הכול תפוס',
  'booking.day.legendClosed': 'סגור',
  'booking.day.legendOther': 'לא ניתן לקביעה',
  'booking.day.today': 'היום',
  'booking.day.inPast': 'תאריך שעבר',
  'booking.day.countAvailable': '{n} שעות פנויות',
  'booking.day.oneAvailable': 'שעה פנויה אחת',

  // ── Day states ────────────────────────────────────────────────────────────────
  'booking.state.full.title': 'הכול תפוס',
  'booking.state.full.body': 'כל התורים בתאריך {date} כבר נתפסו.',
  'booking.state.closed.title': 'סגור באותו יום',
  'booking.state.closed.body': '{business} סגור בתאריך {date}.',
  'booking.state.tooSoon.title': 'מוקדם מדי לקבוע',
  'booking.state.tooSoon.body':
    '{business} מבקש התראה של {notice} לפחות, ולכן השעות שנותרו בתאריך {date} כבר לא זמינות.',
  'booking.state.beyond.title': 'עדיין לא נפתח לקביעה',
  'booking.state.beyond.body':
    '{business} מקבל תורים עד {advance} מראש. היום האחרון שאפשר לקבוע בו הוא {horizon}.',
  'booking.state.past.title': 'התאריך הזה כבר עבר',
  'booking.state.past.body': 'אפשר לבחור את היום או כל יום שאחריו.',
  'booking.state.nextOpen': 'מעבר ליום הפנוי הבא',
  'booking.state.searching': 'מחפשים את התור הפנוי הבא…',
  'booking.state.noneAhead': 'אין תורים פנויים מהיום ועד {horizon}.',
  'booking.state.noneThisMonth': 'אין תורים פנויים ב{month}.',
  'booking.state.goToHorizon': 'מעבר ליום האחרון שאפשר לקבוע בו',

  // ── Step 2: slots ─────────────────────────────────────────────────────────────
  'booking.slot.heading': 'בחירת שעה',
  'booking.slot.loading': 'טוענים שעות',
  'booking.slot.timezoneNote': 'כל השעות לפי השעון המקומי של {business} ({timezone}).',
  'booking.slot.none': 'לא נותרו שעות ביום הזה.',
  'booking.slot.morning': 'בוקר',
  'booking.slot.afternoon': 'צהריים',
  'booking.slot.evening': 'ערב',

  // ── Step 3: details ───────────────────────────────────────────────────────────
  'booking.details.heading': 'עבור מי התור?',
  'booking.details.name': 'שם מלא',
  'booking.details.namePlaceholder': 'דנה כהן',
  'booking.details.nameRequired': 'צריך למלא שם.',
  'booking.details.nameTooLong': 'השם ארוך מדי.',
  'booking.details.phone': 'טלפון נייד',
  'booking.details.phoneHintLocal': 'אפשר לכתוב כרגיל — למשל 050-123-4567.',
  'booking.details.phoneHintInternational': 'יש לכלול קידומת מדינה, למשל \u200E+972 50 123 4567.',
  'booking.details.phoneInvalid': 'זה לא נראה כמו מספר שאפשר להשיג אותך בו.',
  'booking.details.phoneNeedsCountry': 'יש לכלול קידומת מדינה, למשל \u200E+972 50 123 4567.',
  'booking.details.note': 'משהו שכדאי שידעו?',
  'booking.details.noteOptional': 'לא חובה',
  'booking.details.notePlaceholder': 'אלרגיות, העדפות, כל דבר שיעזור…',
  'booking.details.noteTooLong': 'צריך לקצר קצת.',
  'booking.details.submit': 'אישור התור',
  'booking.details.privacy': 'אנחנו אוספים שם וטלפון רק כדי לקבוע ולנהל את התור הזה.',
  'booking.details.privacyLink': 'איך משתמשים בפרטים שלך',

  // ── Summary ───────────────────────────────────────────────────────────────────
  'booking.summary.heading': 'התור שלך',
  'booking.summary.service': 'שירות',
  'booking.summary.when': 'מתי',
  'booking.summary.duration': 'משך',
  'booking.summary.price': 'מחיר',
  'booking.summary.name': 'שם',
  'booking.summary.phone': 'טלפון',

  // ── Errors ────────────────────────────────────────────────────────────────────
  'booking.error.slotTaken': 'השעה הזו נתפסה בזמן שמילאת את הפרטים. אפשר לבחור שעה אחרת.',
  'booking.error.generic': 'משהו השתבש. אפשר לנסות שוב.',
  'booking.error.rateLimited':
    'יותר מדי ניסיונות מהמכשיר הזה. אפשר לנסות שוב בעוד {wait} — העסק פתוח, זו רק הגבלה על ניסיונות חוזרים.',
  'booking.error.invalidRequest': 'משהו בבקשה לא נראה תקין. כדאי לרענן את הדף.',
  'booking.error.unavailable': 'דף קביעת התורים הזה אינו זמין.',
  'booking.error.retry': 'ניסיון נוסף',

  // ── Confirmation ──────────────────────────────────────────────────────────────
  'booking.done.confirmedTitle': 'התור נקבע',
  'booking.done.confirmedBody': 'התור שמור. נתראה.',
  'booking.done.pendingTitle': 'הבקשה נשלחה',
  'booking.done.pendingBody':
    '{business} מאשר לקוחות חדשים באופן אישי. השעה שמורה עבורך, אבל היא תיסגר סופית רק אחרי האישור — הם יחזרו אליך בקרוב.',
  'booking.done.addToCalendar': 'הוספה ליומן',
  'booking.done.manageTitle': 'צריך לשנות?',
  'booking.done.manageBody':
    'הקישור הפרטי הזה משנה או מבטל את התור. כדאי לשמור אותו — זו הדרך היחידה לחזור אליו.',
  'booking.done.manageOpen': 'פתיחת התור שלי',
  'booking.done.copyLink': 'העתקת הקישור',
  'booking.done.copied': 'הקישור הועתק',
  'booking.done.copyFailed': 'לא הצלחנו להעתיק — אפשר לסמן את הקישור ולהעתיק ידנית.',
  'booking.done.whatsapp': 'שליחת הודעה ל{business}',
  'booking.done.whatsappMessage': 'שלום! קבעתי עכשיו {service} לתאריך {when}.',
  'booking.done.bookAnother': 'קביעת תור נוסף',

  // ── Statuses ──────────────────────────────────────────────────────────────────
  'booking.status.confirmed': 'מאושר',
  'booking.status.pending': 'ממתין לאישור',
  'booking.status.cancelled': 'בוטל',
  'booking.status.no_show': 'לא הגיע',

  // ── Manage page ───────────────────────────────────────────────────────────────
  'manage.meta.title': 'התור שלך',
  'manage.heading': 'התור שלך',
  'manage.bookedFor': 'נקבע עבור {name}',
  'manage.pending.note': '{business} עוד לא אישר את התור. הם יחזרו אליך.',
  'manage.actions.reschedule': 'שינוי מועד',
  'manage.actions.cancel': 'ביטול התור',
  'manage.actions.addToCalendar': 'הוספה ליומן',
  'manage.actions.keep': 'להשאיר',
  'manage.cancel.title': 'לבטל את התור?',
  'manage.cancel.message': 'לבטל {service} בתאריך {when}? השעה תשוחרר ללקוחות אחרים.',
  'manage.cancel.confirm': 'כן, לבטל',
  'manage.cancel.done': 'התור בוטל.',
  'manage.cancel.tooLate.title': 'מאוחר מדי לבטל אונליין',
  'manage.cancel.tooLate.body':
    '{business} מבקש התראה של {window} לביטול אונליין. אפשר לשלוח להם הודעה והם יטפלו בזה.',
  'manage.reschedule.title': 'בחירת מועד חדש',
  'manage.reschedule.current': 'כרגע {when}',
  'manage.reschedule.confirm': 'העברה ל{when}',
  'manage.reschedule.pickFirst': 'צריך לבחור שעה חדשה כדי להמשיך.',
  'manage.reschedule.done': 'התור הועבר.',
  'manage.cancelled.title': 'התור הזה בוטל',
  'manage.cancelled.body': 'לא קבוע כלום. אפשר לקבוע מועד חדש מתי שתרצו.',
  'manage.noShow.title': 'סומן כאי-הגעה',
  'manage.noShow.body': 'העסק סימן שהתור הזה לא נוצל.',
  'manage.past.title': 'התור הזה כבר עבר',
  'manage.past.body': 'אין כאן יותר מה לשנות.',
  'manage.whatsapp': 'שליחת הודעה ל{business}',
  'manage.whatsappMessage': 'שלום! בנוגע לתור שלי בתאריך {when}…',
  'manage.bookAnother': 'קביעת תור נוסף',
} as const;

/**
 * Both languages are typed against the English key set, so a key added to one and
 * forgotten in the other is a compile error rather than an English string leaking into
 * a Hebrew screen at runtime.
 */
export const bookingDictionary: FeatureDictionary & {
  en: Record<keyof typeof en, string>;
  he: Record<keyof typeof en, string>;
} = { en, he };

export type BookingStringKey = keyof typeof en;
