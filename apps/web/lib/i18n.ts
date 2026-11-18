/**
 * Eligibility reasons and key student labels in English, Hindi and Marathi.
 * Each eligibility check carries a template key and values (see EligibilityCheck.t), so the same decision can be
 * read in the student's language without changing what was decided. English uses the stored message as is.
 * Hindi and Marathi strings are drafts and must be reviewed by native speakers before production use.
 */
export type Lang = 'en' | 'hi' | 'mr';
export const LANGS: { code: Lang; label: string }[] = [
  { code: 'en', label: 'English' },
  { code: 'hi', label: 'हिन्दी' },
  { code: 'mr', label: 'मराठी' },
];

type Table = Record<string, string>;

const REASONS: Record<'hi' | 'mr', Table> = {
  hi: {
    'cgpa.missing': 'आपका CGPA रिकॉर्ड में नहीं है, इसलिए अधिकारी समीक्षा करेंगे (आवश्यक {req})।',
    'cgpa.pass': 'CGPA {v} न्यूनतम {req} को पूरा करता है।',
    'cgpa.fail': 'CGPA {v} न्यूनतम {req} से कम है।',
    'tenth.missing': '10वीं के अंक रिकॉर्ड में नहीं हैं, इसलिए अधिकारी समीक्षा करेंगे।',
    'tenth.pass': '10वीं के अंक {v}% न्यूनतम {req}% को पूरा करते हैं।',
    'tenth.fail': '10वीं के अंक {v}% न्यूनतम {req}% से कम हैं।',
    'twelfth.missing': '12वीं / डिप्लोमा के अंक रिकॉर्ड में नहीं हैं, इसलिए अधिकारी समीक्षा करेंगे।',
    'twelfth.pass': '12वीं / डिप्लोमा के अंक {v}% न्यूनतम {req}% को पूरा करते हैं।',
    'twelfth.fail': '12वीं / डिप्लोमा के अंक {v}% न्यूनतम {req}% से कम हैं।',
    'gap.missing': 'पढ़ाई में अंतराल (gap) रिकॉर्ड में नहीं है, इसलिए अधिकारी समीक्षा करेंगे।',
    'gap.pass': 'पढ़ाई में {v} वर्ष का अंतराल {req} वर्ष की सीमा के भीतर है।',
    'gap.fail': 'पढ़ाई में {v} वर्ष का अंतराल {req} वर्ष की सीमा से अधिक है।',
    'active.missing': 'सक्रिय बैकलॉग रिकॉर्ड में नहीं हैं, इसलिए अधिकारी समीक्षा करेंगे।',
    'active.pass': '{v} सक्रिय बैकलॉग, {req} की सीमा के भीतर।',
    'active.fail': '{v} सक्रिय बैकलॉग; सीमा {req} है।',
    'history.missing': 'पिछले बैकलॉग का रिकॉर्ड नहीं है, इसलिए अधिकारी समीक्षा करेंगे।',
    'history.pass': '{v} पिछले बैकलॉग, {req} की सीमा के भीतर।',
    'history.fail': '{v} पिछले बैकलॉग; सीमा {req} है।',
    'branch.pass': 'ब्रांच {v} पात्र है।',
    'branch.fail': 'ब्रांच {v} पात्र सूची ({list}) में नहीं है।',
    'year.pass': 'स्नातक वर्ष {v} पात्र है।',
    'year.fail': 'स्नातक वर्ष {v}, {list} में नहीं है।',
    'skill.missing': '{skill} (स्तर {level}, प्रमाण ≥ {proof}) आवश्यक है; अभी यह {state} है।',
    'skill.level': '{skill} स्तर {have} पर सत्यापित है; इस ड्राइव के लिए स्तर {level} चाहिए।',
    'skill.proof': '{skill} {have} पर सत्यापित है; इस ड्राइव के लिए प्रमाण ≥ {proof} चाहिए।',
    'skill.expires': '{skill} का प्रमाण {date} को, ड्राइव से पहले, समाप्त हो रहा है। पात्र बने रहने के लिए दोबारा सत्यापन करें।',
    'skill.pass': '{skill} सत्यापित है ({have}) और आवश्यकता पूरी करता है।',
    'offers.pass': 'ऑफ़र नीति आपको आवेदन करने की अनुमति देती है।',
    'offers.fail': 'आपके पास पहले से {v} ऑफ़र हैं; नीति {req} की अनुमति देती है।',
    'ctc.pass': 'आपका वर्तमान ऑफ़र {req} की सीमा से कम है, इसलिए आप आवेदन कर सकते हैं।',
    'ctc.fail': 'आपका प्लेसमेंट {v} पर है; यह ड्राइव केवल {req} से कम वालों के लिए है।',
    'hold': 'रिकॉर्ड पर एक रोक (hold) है; आवेदन से पहले अधिकारी समीक्षा करेंगे।',
    'state.none': 'आपकी प्रोफ़ाइल पर नहीं',
    'state.claimed': 'केवल दावा किया गया',
    'state.observed': 'देखा गया, पर सत्यापित नहीं',
    'state.evidence_linked': 'प्रमाण जुड़ा है, सत्यापन बाकी',
    'state.expired': 'समाप्त',
    'state.verified': 'सत्यापित',
  },
  mr: {
    'cgpa.missing': 'तुमचा CGPA नोंदीत नाही, त्यामुळे अधिकारी पुनरावलोकन करतील (आवश्यक {req}).',
    'cgpa.pass': 'CGPA {v} किमान {req} पूर्ण करतो.',
    'cgpa.fail': 'CGPA {v} किमान {req} पेक्षा कमी आहे.',
    'tenth.missing': 'दहावीचे गुण नोंदीत नाहीत, त्यामुळे अधिकारी पुनरावलोकन करतील.',
    'tenth.pass': 'दहावीचे गुण {v}% किमान {req}% पूर्ण करतात.',
    'tenth.fail': 'दहावीचे गुण {v}% किमान {req}% पेक्षा कमी आहेत.',
    'twelfth.missing': 'बारावी / डिप्लोमाचे गुण नोंदीत नाहीत, त्यामुळे अधिकारी पुनरावलोकन करतील.',
    'twelfth.pass': 'बारावी / डिप्लोमाचे गुण {v}% किमान {req}% पूर्ण करतात.',
    'twelfth.fail': 'बारावी / डिप्लोमाचे गुण {v}% किमान {req}% पेक्षा कमी आहेत.',
    'gap.missing': 'शिक्षणातील खंड (gap) नोंदीत नाही, त्यामुळे अधिकारी पुनरावलोकन करतील.',
    'gap.pass': 'शिक्षणातील {v} वर्षांचा खंड {req} वर्षांच्या मर्यादेत आहे.',
    'gap.fail': 'शिक्षणातील {v} वर्षांचा खंड {req} वर्षांच्या मर्यादेपेक्षा जास्त आहे.',
    'active.missing': 'सक्रिय बॅकलॉग नोंदीत नाहीत, त्यामुळे अधिकारी पुनरावलोकन करतील.',
    'active.pass': '{v} सक्रिय बॅकलॉग, {req} च्या मर्यादेत.',
    'active.fail': '{v} सक्रिय बॅकलॉग; मर्यादा {req} आहे.',
    'history.missing': 'मागील बॅकलॉगची नोंद नाही, त्यामुळे अधिकारी पुनरावलोकन करतील.',
    'history.pass': '{v} मागील बॅकलॉग, {req} च्या मर्यादेत.',
    'history.fail': '{v} मागील बॅकलॉग; मर्यादा {req} आहे.',
    'branch.pass': 'शाखा {v} पात्र आहे.',
    'branch.fail': 'शाखा {v} पात्र यादीत ({list}) नाही.',
    'year.pass': 'पदवीचे वर्ष {v} पात्र आहे.',
    'year.fail': 'पदवीचे वर्ष {v} हे {list} मध्ये नाही.',
    'skill.missing': '{skill} (स्तर {level}, पुरावा ≥ {proof}) आवश्यक आहे; सध्या ते {state} आहे.',
    'skill.level': '{skill} स्तर {have} वर सत्यापित आहे; या ड्राइव्हसाठी स्तर {level} हवा.',
    'skill.proof': '{skill} {have} वर सत्यापित आहे; या ड्राइव्हसाठी पुरावा ≥ {proof} हवा.',
    'skill.expires': '{skill} चा पुरावा {date} रोजी, ड्राइव्हच्या आधी, संपतो. पात्र राहण्यासाठी पुन्हा सत्यापन करा.',
    'skill.pass': '{skill} सत्यापित आहे ({have}) आणि आवश्यकता पूर्ण करते.',
    'offers.pass': 'ऑफर धोरणानुसार तुम्ही अर्ज करू शकता.',
    'offers.fail': 'तुमच्याकडे आधीच {v} ऑफर आहेत; धोरण {req} ची परवानगी देते.',
    'ctc.pass': 'तुमची सध्याची ऑफर {req} च्या मर्यादेपेक्षा कमी आहे, त्यामुळे तुम्ही अर्ज करू शकता.',
    'ctc.fail': 'तुमचे प्लेसमेंट {v} वर झाले आहे; ही ड्राइव्ह फक्त {req} पेक्षा कमी असलेल्यांसाठी आहे.',
    'hold': 'नोंदीवर एक रोख (hold) आहे; अर्ज करण्यापूर्वी अधिकारी पुनरावलोकन करतील.',
    'state.none': 'तुमच्या प्रोफाइलवर नाही',
    'state.claimed': 'फक्त दावा केलेले',
    'state.observed': 'दिसले, पण सत्यापित नाही',
    'state.evidence_linked': 'पुरावा जोडला, सत्यापन बाकी',
    'state.expired': 'मुदत संपलेले',
    'state.verified': 'सत्यापित',
  },
};

const UI: Record<Lang, Table> = {
  en: {
    'drives.title': 'My Drives',
    'drives.intro': 'Each rule from your placement office, checked against your record and explained in simple words. If a result looks wrong, you can appeal.',
    'path.title': 'Your next step · you are eligible for {n} of {total} drives',
    'apply': 'Apply', 'appeal': 'Appeal', 'notPublished': 'Not published yet',
    'h.in_time': 'in time', 'h.tight': 'tight', 'h.next_drives': 'too late for this one, helps with later drives',
    'daysLeft': '{n} days left', 'lang': 'Language', 'draftNote': '',
    'path.action': 'Prove {skill} ({proof}{lvl}) to become eligible for {n} more drive(s): {drives}', 'path.lvl': ' (level {level})',
  },
  hi: {
    'drives.title': 'मेरी ड्राइव और पात्रता',
    'drives.intro': 'आपके प्लेसमेंट कार्यालय के हर नियम को आपके रिकॉर्ड से जाँचा गया है, सरल शब्दों में। यदि कोई नियम आपके लिए गलत है, तो अपील करें।',
    'path.title': 'प्रूफ़ पाथ · {total} में से {n} ड्राइव के लिए पात्र',
    'apply': 'आवेदन करें', 'appeal': 'अपील करें', 'notPublished': 'अभी प्रकाशित नहीं',
    'h.in_time': 'समय पर', 'h.tight': 'कम समय', 'h.next_drives': 'देर हो गई, अगली ड्राइव में काम आएगा',
    'daysLeft': '{n} दिन बाकी', 'lang': 'भाषा',
    'path.action': '{skill} को {proof}{lvl} तक ले जाएँ → {n} ड्राइव खुलेंगी: {drives}', 'path.lvl': ' (स्तर {level})',
    'path.all': 'लगभग {h} घंटे ({d} दिन, रोज़ {pace} घंटे): आप सभी ड्राइव से पहले पूरा कर सकते हैं।',
    'path.none': 'लगभग {h} घंटे ({d} दिन): इन ड्राइव के लिए देर हो गई, पर आगे की हर ड्राइव में यह काम आएगा।',
    'path.some': 'लगभग {h} घंटे ({d} दिन): {total} में से {k} ड्राइव के लिए समय पर।', 'draftNote': 'अनुवाद प्रारूप है; मूल वक्ताओं द्वारा समीक्षा बाकी है। निर्णय अंग्रेज़ी संस्करण के अनुसार ही है।',
  },
  mr: {
    'drives.title': 'माझ्या ड्राइव्ह आणि पात्रता',
    'drives.intro': 'तुमच्या प्लेसमेंट कार्यालयाचा प्रत्येक नियम तुमच्या नोंदींशी तपासला आहे, सोप्या शब्दांत. एखादा नियम तुमच्यासाठी चुकीचा असल्यास अपील करा.',
    'path.title': 'प्रूफ पाथ · {total} पैकी {n} ड्राइव्हसाठी पात्र',
    'apply': 'अर्ज करा', 'appeal': 'अपील करा', 'notPublished': 'अद्याप प्रकाशित नाही',
    'h.in_time': 'वेळेत', 'h.tight': 'कमी वेळ', 'h.next_drives': 'उशीर झाला, पुढील ड्राइव्हसाठी उपयोगी',
    'daysLeft': '{n} दिवस बाकी', 'lang': 'भाषा',
    'path.action': '{skill} {proof}{lvl} पर्यंत न्या → {n} ड्राइव्ह खुल्या होतील: {drives}', 'path.lvl': ' (स्तर {level})',
    'path.all': 'सुमारे {h} तास ({d} दिवस, दररोज {pace} तास): तुम्ही सर्व ड्राइव्हपूर्वी पूर्ण करू शकता.',
    'path.none': 'सुमारे {h} तास ({d} दिवस): या ड्राइव्हसाठी उशीर झाला, पण पुढील प्रत्येक ड्राइव्हसाठी उपयोगी.',
    'path.some': 'सुमारे {h} तास ({d} दिवस): {total} पैकी {k} ड्राइव्हसाठी वेळेत.', 'draftNote': 'भाषांतर मसुदा आहे; मूळ भाषकांकडून पुनरावलोकन बाकी आहे. निर्णय इंग्रजी आवृत्तीप्रमाणेच आहे.',
  },
};

const fill = (tpl: string, vars: Record<string, string | number>) => tpl.replace(/\{(\w+)\}/g, (m, k) => (vars[k] === undefined ? m : String(vars[k])));

export interface LocalisableCheck { message: string; t?: { key: string; vars: Record<string, string | number> } }

/** The reason line in the chosen language. Falls back to the stored English message when no template applies. */
const PROOF_WORDS: [RegExp, string][] = [
  [/L1_code_backed/g, 'Level 1'], [/L2_assessed/g, 'Level 2'], [/L3_defended/g, 'Level 3'], [/L3_attested/g, 'Level 3'],
  [/proof ≥ L(\d)/g, 'proof ≥ Level $1'], [/पुरावा ≥ L(\d)/g, 'पुरावा ≥ Level $1'], [/evidence_linked/g, 'evidence added'],
];
const plain = (s: string) => PROOF_WORDS.reduce((a, [re, w]) => a.replace(re, w), s);

export function reasonText(check: LocalisableCheck, lang: Lang): string {
  return plain(reasonTextRaw(check, lang));
}

function reasonTextRaw(check: LocalisableCheck, lang: Lang): string {
  if (lang === 'en' || !check.t) return check.message;
  const table = REASONS[lang];
  const tpl = table[check.t.key];
  if (!tpl) return check.message;
  const vars = { ...check.t.vars };
  if (typeof vars.state === 'string') vars.state = table[`state.${vars.state}`] ?? vars.state;
  return fill(tpl, vars);
}

export function ui(lang: Lang, key: string, vars: Record<string, string | number> = {}): string {
  return fill(UI[lang][key] ?? UI.en[key] ?? key, vars);
}

/** The Proof Path timing line: the server's English summary, or the same facts in Hindi / Marathi. */
export function timingText(t: { summary: string; estHours: number; daysNeeded: number; hoursPerDay?: number; inTimeCount?: number; drives: unknown[] }, lang: Lang): string {
  if (lang === 'en' || t.inTimeCount === undefined || t.drives.length === 0) return t.summary;
  const vars = { h: t.estHours, d: t.daysNeeded, pace: t.hoursPerDay ?? 2, k: t.inTimeCount, total: t.drives.length };
  const key = t.inTimeCount === t.drives.length ? 'path.all' : t.inTimeCount === 0 ? 'path.none' : 'path.some';
  return ui(lang, key, vars);
}

/** Every reason template key, for completeness checks. */
export const REASON_KEYS = Object.keys(REASONS.hi).filter(k => !k.startsWith('state.'));
export const hasTemplate = (lang: 'hi' | 'mr', key: string) => key in REASONS[lang];

const STORE = 'pramaan-lang';
export function loadLang(): Lang {
  try { const v = localStorage.getItem(STORE); return v === 'hi' || v === 'mr' ? v : 'en'; } catch { return 'en'; }
}
export function saveLang(lang: Lang) {
  try { localStorage.setItem(STORE, lang); } catch { /* storage unavailable: keep in memory only */ }
}
