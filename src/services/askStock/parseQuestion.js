import { parseVoiceQuery } from '../../utils/spokenQuery.js';

/**
 * Rule-based understanding of Ask Stock questions (English, Hinglish, Hindi).
 * Returns the intent plus the part search text, branch and period it mentions.
 */
export const INTENT = Object.freeze({
  HELP: 'HELP',
  STOCK_CHECK: 'STOCK_CHECK',
  WHERE_STOCK: 'WHERE_STOCK',
  PRICE: 'PRICE',
  REORDER: 'REORDER',
  NON_MOVING: 'NON_MOVING',
  LOW_STOCK: 'LOW_STOCK',
  OUT_OF_STOCK: 'OUT_OF_STOCK',
  MACHINE_PARTS: 'MACHINE_PARTS',
  CUSTOMER: 'CUSTOMER',
  TODAY: 'TODAY',
  UNKNOWN: 'UNKNOWN',
});

// Checked in order; the first match wins. The matched words are removed before the rest
// of the question is used as a part search. Devanagari alternatives sit outside \b groups
// because \b only understands Latin letters.
const INTENT_RULES = [
  {
    intent: INTENT.REORDER,
    pattern:
      /\b(re-?order\w*|what (should|do) (i|we) (order|buy)|order (karna|karu|karen|kare)|kya order|mang(a|w)a(na|ni|o|u)?|kharid(na|ni|e)?)\b|ऑर्डर|मंगवा|मंगा|खरीदना/,
  },
  {
    intent: INTENT.NON_MOVING,
    pattern:
      /\b(not (been )?(moved|sold|used)|have ?n['o]?t moved|non[- ]?moving|dead stock|slow[- ]?moving|idle|nahi?n? (bika|bike|biki|nikla|nikle|chala|chale)|(bika|bike|nikla|nikle) nahi?n?)\b|नहीं बिका|बिका नहीं|नहीं निकला/,
  },
  {
    intent: INTENT.TODAY,
    pattern:
      /\b(today|todays|today's|aaj|aj)\b.*\b(sale|sales|sold|out|in|summary|becha|bika|bikri|units?)\b|\b(sale|sales|summary)\b.*\b(today|aaj)\b|आज/,
  },
  {
    intent: INTENT.OUT_OF_STOCK,
    pattern: /\b(out of stock|khatam|finished|zero stock|no stock|stock nahi?n? hai)\b|ख़त्म|खत्म/,
  },
  {
    intent: INTENT.LOW_STOCK,
    pattern:
      /\b(low stock|running low|stock kam|kam stock|kam (hai|bacha|bache)|shortage)\b|कम स्टॉक|स्टॉक कम/,
  },
  {
    intent: INTENT.WHERE_STOCK,
    pattern:
      /\b(which branch|what branch|where|kahan|kaha|kis branch|kaun si branch|kaunsi branch)\b|कहाँ|कहां|किस ब्रांच/,
  },
  {
    intent: INTENT.PRICE,
    pattern: /\b(price|prices|rate|rates|cost|mrp|kimat|keemat|daam|bhav)\b|कीमत|दाम|रेट|भाव/,
  },
  {
    intent: INTENT.MACHINE_PARTS,
    pattern: /\b(parts? for|all parts|ke parts|ka parts|ke liye parts|kaun se parts|parts of)\b/,
  },
  {
    intent: INTENT.CUSTOMER,
    pattern:
      /\b(customer|bought|buy|buys|purchased|kharida|kharide|liya|le gaya|invoices?|bills?|sold to)\b|ग्राहक|खरीदा|लिया/,
  },
  {
    intent: INTENT.HELP,
    pattern: /^(hi|hello|hey|namaste|help|madad|what can you do|kya kar sakte)\b|^नमस्ते|^मदद/,
  },
];

/** Question words removed before the remaining words are used as the part search. */
const QUESTION_WORDS = new Set([
  'how',
  'many',
  'much',
  'what',
  'whats',
  'which',
  'where',
  'when',
  'tell',
  'check',
  'stock',
  'stocks',
  'available',
  'availability',
  'qty',
  'quantity',
  'left',
  'remaining',
  'have',
  'has',
  'do',
  'does',
  'did',
  'we',
  'our',
  'us',
  'there',
  'price',
  'prices',
  'rate',
  'rates',
  'cost',
  'mrp',
  'branch',
  'branches',
  'kitna',
  'kitne',
  'kitni',
  'batao',
  'bataiye',
  'bata',
  'dekho',
  'dekh',
  'kahan',
  'kaha',
  'kis',
  'kaun',
  'kaunsa',
  'kaunsi',
  'si',
  'sa',
  'se',
  'kimat',
  'keemat',
  'daam',
  'bhav',
  'and',
  'aur',
  'about',
  'its',
  'it',
  'iska',
  'iski',
  'iske',
  'uska',
  'uski',
  'this',
  'that',
  'same',
  'also',
  'bhi',
  'in',
  'at',
  'hain',
  'hai',
  'ka',
  'ki',
  'ke',
  'mein',
  'me',
  'should',
  'would',
  'could',
  'can',
  'last',
  'past',
  'week',
  'month',
  'since',
  'कितना',
  'कितने',
  'कितनी',
  'बताओ',
  'बताइए',
  'कहाँ',
  'कहां',
  'किस',
  'कौन',
  'सा',
  'से',
  'कीमत',
  'दाम',
  'रेट',
  'भाव',
  'स्टॉक',
  'ब्रांच',
  'इसका',
  'इसकी',
  'और',
  'भी',
]);

// "Iska price?", "its stock in Vijayawada" refer to the last part discussed.
const FOLLOW_UP =
  /\b(it|its|same|iska|iski|iske|isme|uska|uski|wahi|wohi)\b|\bthis (part|one|item)\b|इसका|इसकी|इसके|उसका/;

const NUMBER_WORDS = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  twelve: 12,
  ek: 1,
  do: 2,
  teen: 3,
  char: 4,
  chaar: 4,
  paanch: 5,
  chhe: 6,
  che: 6,
  एक: 1,
  दो: 2,
  तीन: 3,
  चार: 4,
  पांच: 5,
  पाँच: 5,
  छह: 6,
};
const UNIT_DAYS = {
  day: 1,
  days: 1,
  din: 1,
  दिन: 1,
  week: 7,
  weeks: 7,
  hafta: 7,
  hafte: 7,
  हफ्ते: 7,
  हफ़्ते: 7,
  सप्ताह: 7,
  month: 30,
  months: 30,
  mahina: 30,
  mahine: 30,
  mahino: 30,
  महीने: 30,
  महीना: 30,
  year: 365,
  years: 365,
  saal: 365,
  साल: 365,
};

const MAX_PERIOD_DAYS = 730;

/** "two months", "3 hafte", "60 days", "दो महीने" → number of days (null if none). */
export function parsePeriodDays(text) {
  const words = text.toLowerCase().split(/\s+/).filter(Boolean);
  for (let i = 0; i < words.length - 1; i += 1) {
    const n = /^\d+$/.test(words[i]) ? Number(words[i]) : NUMBER_WORDS[words[i]];
    const unitDays = UNIT_DAYS[words[i + 1]];
    if (n && unitDays) return Math.min(n * unitDays, MAX_PERIOD_DAYS);
  }
  if (/\b(this month|is mahine)\b|इस महीने/.test(text)) return new Date().getDate();
  if (/\b(last month|pichhle mahine|pichle mahine)\b|पिछले महीने/.test(text)) return 30;
  if (/\b(this week|is hafte)\b|इस हफ्ते/.test(text)) return 7;
  return null;
}

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const wordPattern = (value) => new RegExp(`\\b${escapeRegExp(value.toLowerCase())}\\b`, 'g');

/** Removes "<number> <unit>" period phrases so they don't become part search words. */
function removePeriods(text) {
  const words = text.split(/\s+/).filter(Boolean);
  const kept = [];
  for (let i = 0; i < words.length; i += 1) {
    const isNumber = /^\d+$/.test(words[i]) || NUMBER_WORDS[words[i]];
    if (isNumber && UNIT_DAYS[words[i + 1]]) {
      i += 1;
    } else if (!UNIT_DAYS[words[i]]) {
      kept.push(words[i]);
    }
  }
  return kept.join(' ');
}

function stripWords(text, words) {
  return text
    .split(/\s+/)
    .filter((w) => w && !words.has(w))
    .join(' ');
}

/**
 * @param {string} message
 * @param {{ branches?: {id:number, name:string, code:string}[] }} [options]
 * @returns {{ intent: string, query: string, branchId: number|null, periodDays: number|null, followUp: boolean }}
 */
export function parseQuestion(message, { branches = [] } = {}) {
  const text = String(message ?? '')
    .toLowerCase()
    .replace(/[?!,।]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const rule = INTENT_RULES.find((r) => r.pattern.test(text));
  let intent = rule?.intent ?? INTENT.UNKNOWN;

  // A branch named in the question ("in Vijayawada") is a filter, not part of the search.
  const branch = branches.find(
    (b) => wordPattern(b.name).test(text) || wordPattern(b.code).test(text),
  );
  let remaining = text;
  if (branch) {
    remaining = remaining
      .replace(wordPattern(branch.name), ' ')
      .replace(wordPattern(branch.code), ' ');
  }

  const periodDays = parsePeriodDays(text);
  if (rule) remaining = remaining.replace(new RegExp(rule.pattern.source, 'g'), ' ');
  remaining = removePeriods(remaining);

  const query = parseVoiceQuery(stripWords(remaining, QUESTION_WORDS)).query;
  const followUp = FOLLOW_UP.test(text) || (!query && Boolean(branch));

  // A plain part name ("PC200 idler") is a stock question.
  if (intent === INTENT.UNKNOWN && query) intent = INTENT.STOCK_CHECK;
  // "Is the fuel filter out of stock?" is a stock check of that part, not a list.
  if ((intent === INTENT.OUT_OF_STOCK || intent === INTENT.LOW_STOCK) && query) {
    intent = INTENT.STOCK_CHECK;
  }
  // "and in Vijayawada?" after a part was discussed.
  if (intent === INTENT.UNKNOWN && followUp) intent = INTENT.STOCK_CHECK;

  return { intent, query, branchId: branch?.id ?? null, periodDays, followUp };
}
