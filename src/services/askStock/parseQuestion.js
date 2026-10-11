import { parseVoiceQuery } from '../../utils/spokenQuery.js';

/**
 * Rule-based understanding of Ask Stock questions (English, Hinglish, Hindi, Telugu).
 * Returns the intent plus the part search text, branch, period and direction it mentions.
 * Nothing here touches the database: the service maps each intent to a fixed query.
 */
export const INTENT = Object.freeze({
  HELP: 'HELP',
  STOCK_CHECK: 'STOCK_CHECK',
  WHERE_STOCK: 'WHERE_STOCK',
  PRICE: 'PRICE',
  REORDER: 'REORDER',
  NON_MOVING: 'NON_MOVING',
  FAST_MOVING: 'FAST_MOVING',
  SOLD: 'SOLD',
  LOW_STOCK: 'LOW_STOCK',
  OUT_OF_STOCK: 'OUT_OF_STOCK',
  MACHINE_PARTS: 'MACHINE_PARTS',
  CUSTOMER: 'CUSTOMER',
  TODAY: 'TODAY',
  BRANCH_COMPARE: 'BRANCH_COMPARE',
  CATEGORY: 'CATEGORY',
  TRANSFERS: 'TRANSFERS',
  UNKNOWN: 'UNKNOWN',
});

// \b only understands Latin letters, so Hindi and Telugu words are matched as stems: they
// must start a word and may carry any ending ("ఆర్డర్" also matches "ఆర్డర్లు").
const SCRIPT = '\\u0900-\\u097F\\u0C00-\\u0C7F';
const stems = (...words) => words.map((w) => `(?<![${SCRIPT}])${w}[${SCRIPT}]*`).join('|');
const latin = (...words) => `\\b(${words.join('|')})\\b`;
const rule = (...sources) => new RegExp(sources.join('|'));

const TODAY_WORDS = "today|todays|today's|aaj|aj|eeroju|ivala";
const TODAY_TOPICS =
  'sale|sales|sold|out|in|summary|becha|bika|bikri|units?|received|receipts?|purchases?|came|figures|movement';

// Checked in order; the first match wins. The matched words are removed before the rest
// of the question is used as a part search.
const INTENT_RULES = [
  {
    intent: INTENT.FAST_MOVING,
    pattern: rule(
      latin(
        'fast[- ]?moving',
        'top[- ]?selling',
        'top sellers?',
        'top movers?',
        'best[- ]?sell\\w*',
        'most sold',
        'sell(s|ing)? (the )?most',
        'sabse (zyada|jyada) (bik|nikal)\\w*',
      ),
      stems(
        'सबसे ज़्यादा बिक',
        'सबसे ज्यादा बिक',
        'सबसे ज़्यादा निकल',
        'सबसे ज्यादा निकल',
        'ఎక్కువగా అమ్ముడ',
        'ఎక్కువగా వెళ్ల',
        'ఫాస్ట్ మూవింగ్',
      ),
    ),
  },
  {
    intent: INTENT.REORDER,
    pattern: rule(
      latin(
        're-?order\\w*',
        'what (should|do) (i|we) (order|buy)',
        'order (karna|karu|karen|kare)',
        'kya order',
        'mang(a|w)a(na|ni|o|u)?',
        'kharid(na|ni|e)?',
        'teppinchali',
      ),
      stems('ऑर्डर', 'मंगवा', 'मंगा', 'खरीदना', 'ఆర్డర్', 'తెప్పించ', 'కొనాలి'),
    ),
  },
  {
    intent: INTENT.NON_MOVING,
    pattern: rule(
      latin(
        'not (been )?(moved|sold|used|moving)',
        "have ?n['o]?t moved",
        'no movement',
        'non[- ]?moving',
        'dead stock',
        'slow[- ]?moving',
        'idle',
        'nahi?n? (bika|bike|biki|nikla|nikle|chala|chale)',
        '(bika|bike|nikla|nikle) nahi?n?',
        'ammudu poledu',
        'kadalaledu',
      ),
      stems(
        'नहीं बिक',
        'बिका नहीं',
        'बिके नहीं',
        'नहीं निकल',
        'అమ్ముడుపోలేదు',
        'అమ్ముడు పోలేదు',
        'అమ్ముడు కాలేదు',
        'అమ్మలేదు',
        'కదలలేదు',
        'కదల్లేదు',
        'కదలని',
      ),
    ),
  },
  {
    intent: INTENT.BRANCH_COMPARE,
    pattern: rule(
      latin(
        'compare',
        'comparison',
        'tulna',
        'all branches',
        'every branch',
        'each branch',
        'across branches',
        'branch[- ]?wise',
      ),
      stems('तुलना', 'सभी ब्रांच', 'हर ब्रांच', 'పోల్చ', 'పోలిక', 'అన్ని బ్రాంచ్'),
    ),
  },
  {
    intent: INTENT.CATEGORY,
    pattern: rule(
      latin('by category', 'category[- ]?wise', 'categories', 'each category', 'per category'),
      stems('कैटेगरी', 'श्रेणी', 'కేటగిరీ', 'వర్గ'),
    ),
  },
  {
    intent: INTENT.TRANSFERS,
    pattern: rule(latin('transfers?', 'in transit'), stems('ट्रांसफर', 'ట్రాన్స్ఫర్', 'బదిలీ')),
  },
  {
    intent: INTENT.TODAY,
    pattern: rule(
      `\\b(${TODAY_WORDS})\\b.*\\b(${TODAY_TOPICS})\\b`,
      `\\b(${TODAY_TOPICS})\\b.*\\b(${TODAY_WORDS})\\b`,
      stems('आज', 'ఈరోజు', 'ఈ రోజు', 'ఇవాళ'),
    ),
  },
  {
    intent: INTENT.OUT_OF_STOCK,
    pattern: rule(
      latin(
        'out of stock',
        'khatam',
        'finished',
        'zero stock',
        'no stock',
        'stock nahi?n? hai',
        'aipoyindi',
      ),
      stems('ख़त्म', 'खत्म', 'అయిపోయ', 'స్టాక్ లేదు', 'స్టాక్ లేని'),
    ),
  },
  {
    intent: INTENT.LOW_STOCK,
    pattern: rule(
      latin(
        'low stock',
        'low on stock',
        'running low',
        'stock kam',
        'kam stock',
        'kam (hai|bacha|bache)',
        'shortage',
        'takkuva',
      ),
      stems('कम स्टॉक', 'स्टॉक कम', 'తక్కువ'),
    ),
  },
  {
    intent: INTENT.WHERE_STOCK,
    pattern: rule(
      latin(
        'which branch',
        'what branch',
        'where',
        'kahan',
        'kaha',
        'kis branch',
        'kaun si branch',
        'kaunsi branch',
        'ekkada',
      ),
      stems('कहाँ', 'कहां', 'किस ब्रांच', 'कौन सी ब्रांच', 'ఎక్కడ', 'ఏ బ్రాంచ్'),
    ),
  },
  {
    intent: INTENT.PRICE,
    pattern: rule(
      latin(
        'price',
        'prices',
        'rate',
        'rates',
        'cost',
        'mrp',
        'kimat',
        'keemat',
        'daam',
        'bhav',
        'dhara',
      ),
      stems('कीमत', 'दाम', 'रेट', 'भाव', 'ధర', 'రేటు', 'రేట్', 'ఖరీదు', 'ఎమ్మార్పీ'),
    ),
  },
  {
    intent: INTENT.MACHINE_PARTS,
    pattern: rule(
      latin(
        'parts? for',
        'all parts',
        'ke parts',
        'ka parts',
        'ke liye parts',
        'kaun se parts',
        'parts of',
      ),
      stems('के पार्ट', 'సంబంధించిన పార్ట్', 'కి పార్ట్స్', 'కు పార్ట్స్', 'అన్ని పార్ట్స్'),
    ),
  },
  {
    intent: INTENT.CUSTOMER,
    pattern: rule(
      latin(
        'customer',
        'bought',
        'buy',
        'buys',
        'purchased',
        'kharida',
        'kharide',
        'liya',
        'le gaya',
        'invoices?',
        'bills?',
        'sold to',
        'konnaru',
      ),
      stems('ग्राहक', 'खरीदा', 'लिया', 'కస్టమర్', 'కొన్నారు', 'కొన్నాడు', 'కొనుగోలు', 'బిల్లు'),
    ),
  },
  {
    intent: INTENT.SOLD,
    pattern: rule(
      latin(
        'sold',
        'sales?( of)?',
        'sell',
        'selling',
        'bika',
        'bike',
        'biki',
        'becha',
        'beche',
        'ammudu\\w*',
      ),
      stems('बिक', 'बेच', 'అమ్ముడ', 'అమ్మక'),
    ),
  },
  {
    intent: INTENT.HELP,
    pattern: rule(
      '^(hi|hello|hey|namaste|help|madad|what can you do|kya kar sakte)\\b',
      '^नमस्ते',
      '^मदद',
      '^నమస్కారం',
      '^నమస్తే',
      '^సహాయం',
      '^హలో',
    ),
  },
];

// "Today's stock received" asks about stock coming in; "today's sales" about stock going out.
const DIRECTION_IN = rule(
  latin('received', 'receipts?', 'stock in', 'came in', 'purchases?', 'inward'),
  stems('आए', 'आया', 'आई', 'వచ్చ'),
);
const DIRECTION_OUT = rule(
  latin('sold', 'sales?', 'stock out', 'went out', 'outward', 'becha', 'bika', 'bikri'),
  stems('बिक', 'निकल', 'అమ్ముడ', 'అమ్మక', 'వెళ్ల'),
);

/** Question words removed before the remaining words are used as the part search. */
const QUESTION_WORDS = new Set(
  `how many much what whats which where when tell check show stock stocks available
   availability qty quantity left remaining have has do does did were was been we our us
   there price prices rate rates cost mrp branch branches between other others most highest
   kitna kitne kitni batao bataiye bata dekho dekh kahan kaha kis kaun kaunsa kaunsi si sa se
   kimat keemat daam bhav and aur about its it iska iski iske uska uski this that same also
   bhi in at hain hai ka ki ke mein me should would could can last past week month since
   कितना कितने कितनी बताओ बताइए कहाँ कहां किस किन कौन कौन-कौन सा सी से कीमत दाम रेट भाव
   स्टॉक ब्रांच इस उस पार्ट्स इसका इसकी इसके उसका और भी पिछले आइटम दूसरी दूसरे करो
   ఎంత ఎంతకు ఎన్ని ఉంది ఉందా ఉన్నాయి ఉన్నాయా ఉన్న ఉన్నవి స్టాక్ బ్రాంచ్ లో మరి మరియు కూడా
   చెప్పు చెప్పండి ఏ ఏది ఏమి ఏవి ఏంటి ఈ దీని దాని దీనికి దానికి అదే ఇది చేయాలి పార్ట్స్ పార్ట్
   గత ఇతర వస్తువు వస్తువులు మళ్లీ
   enta enni cheppu deeni daani`
    .split(/\s+/)
    .filter(Boolean),
);

// Endings Telugu glues onto words ("స్టాక్‌లో" in stock, "బ్రాంచ్‌ల" of the branches).
const TELUGU_ENDINGS = [
  'లోని',
  'నుండి',
  'లను',
  'లకు',
  'లో',
  'లు',
  'ల',
  'కి',
  'కు',
  'ని',
  'ను',
  'తో',
  'గా',
];

function isQuestionWord(word) {
  if (QUESTION_WORDS.has(word)) return true;
  if (!/\p{Script=Telugu}/u.test(word)) return false;
  return TELUGU_ENDINGS.some(
    (e) => word.endsWith(e) && QUESTION_WORDS.has(word.slice(0, -e.length)),
  );
}

// "Iska price?", "its stock in Vijayawada" refer to the last part discussed.
const FOLLOW_UP = rule(
  latin(
    'it',
    'its',
    'same',
    'iska',
    'iski',
    'iske',
    'isme',
    'uska',
    'uski',
    'wahi',
    'wohi',
    'deeni',
    'daani',
  ),
  '\\bthis (part|one|item)\\b',
  stems('इसक', 'उसक', 'దీని', 'దాని', 'అదే'),
);

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
  rendu: 2,
  moodu: 3,
  एक: 1,
  दो: 2,
  तीन: 3,
  चार: 4,
  पांच: 5,
  पाँच: 5,
  छह: 6,
  ఒకటి: 1,
  ఒక: 1,
  రెండు: 2,
  మూడు: 3,
  నాలుగు: 4,
  ఐదు: 5,
  ఆరు: 6,
  పన్నెండు: 12,
};
const UNIT_DAYS = {
  day: 1,
  days: 1,
  din: 1,
  rojulu: 1,
  दिन: 1,
  दिनों: 1,
  రోజు: 1,
  రోజులు: 1,
  రోజుల: 1,
  రోజులుగా: 1,
  week: 7,
  weeks: 7,
  hafta: 7,
  hafte: 7,
  vaaram: 7,
  हफ्ते: 7,
  हफ़्ते: 7,
  हफ्तों: 7,
  सप्ताह: 7,
  వారం: 7,
  వారాలు: 7,
  వారాల: 7,
  వారాలుగా: 7,
  month: 30,
  months: 30,
  mahina: 30,
  mahine: 30,
  mahino: 30,
  nela: 30,
  nelalu: 30,
  महीने: 30,
  महीना: 30,
  महीनों: 30,
  నెల: 30,
  నెలలు: 30,
  నెలల: 30,
  నెలలుగా: 30,
  year: 365,
  years: 365,
  saal: 365,
  साल: 365,
  సంవత్సరం: 365,
  సంవత్సరాలు: 365,
};

const MAX_PERIOD_DAYS = 730;

/** "two months", "3 hafte", "60 days", "दो महीने", "రెండు నెలలు" → number of days (null if none). */
export function parsePeriodDays(text) {
  const words = text.toLowerCase().split(/\s+/).filter(Boolean);
  for (let i = 0; i < words.length - 1; i += 1) {
    const n = /^\d+$/.test(words[i]) ? Number(words[i]) : NUMBER_WORDS[words[i]];
    const unitDays = UNIT_DAYS[words[i + 1]];
    if (n && unitDays) return Math.min(n * unitDays, MAX_PERIOD_DAYS);
  }
  if (/\b(this month|is mahine)\b|इस महीने|ఈ నెల/.test(text)) return new Date().getDate();
  if (/\b(last month|pichhle mahine|pichle mahine)\b|पिछले महीने|గత నెల|పోయిన నెల/.test(text)) {
    return 30;
  }
  if (/\b(this week|is hafte)\b|इस हफ्ते|ఈ వారం/.test(text)) return 7;
  return null;
}

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const wordPattern = (value) => new RegExp(`\\b${escapeRegExp(value.toLowerCase())}\\b`, 'g');

// Consonant sounds of Hindi and Telugu letters, for recognising a branch name said in those
// scripts ("हैदराबाद", "హైదరాబాద్" → Hyderabad). Vowels are ignored on both sides.
const SOUNDS = {
  क: 'k',
  ख: 'k',
  ग: 'g',
  घ: 'g',
  च: 'c',
  छ: 'c',
  ज: 'j',
  झ: 'j',
  ट: 't',
  ठ: 't',
  ड: 'd',
  ढ: 'd',
  ण: 'n',
  त: 't',
  थ: 't',
  द: 'd',
  ध: 'd',
  न: 'n',
  प: 'p',
  फ: 'p',
  ब: 'b',
  भ: 'b',
  म: 'n',
  र: 'r',
  ल: 'l',
  व: 'v',
  श: 's',
  ष: 's',
  स: 's',
  ह: 'h',
  'ं': 'n',
  క: 'k',
  ఖ: 'k',
  గ: 'g',
  ఘ: 'g',
  చ: 'c',
  ఛ: 'c',
  జ: 'j',
  ఝ: 'j',
  ట: 't',
  ఠ: 't',
  డ: 'd',
  ఢ: 'd',
  ణ: 'n',
  త: 't',
  థ: 't',
  ద: 'd',
  ధ: 'd',
  న: 'n',
  ప: 'p',
  ఫ: 'p',
  బ: 'b',
  భ: 'b',
  మ: 'n',
  ర: 'r',
  ఱ: 'r',
  ల: 'l',
  ళ: 'l',
  వ: 'v',
  శ: 's',
  ష: 's',
  స: 's',
  హ: 'h',
  'ం': 'n',
};

const collapse = (text) => text.replace(/(.)\1+/g, '$1');

function latinSkeleton(name) {
  return collapse(
    name
      .toLowerCase()
      .replace(/ch/g, 'c')
      .replace(/sh/g, 's')
      .replace(/([kgcjtdpb])h/g, '$1')
      .replace(/[aeiouy\W\d_]/g, '')
      .replace(/w/g, 'v')
      .replace(/z/g, 'j')
      .replace(/f/g, 'p')
      .replace(/q/g, 'k')
      .replace(/m/g, 'n'),
  );
}

function scriptSkeleton(word) {
  return collapse([...word].map((ch) => SOUNDS[ch] ?? '').join(''));
}

/** Finds a branch named in Hindi or Telugu script; returns it with the word that named it. */
function branchInScript(text, branches) {
  const words = text.split(/\s+/).filter((w) => /\p{Script=Devanagari}|\p{Script=Telugu}/u.test(w));
  for (const branch of branches) {
    const target = latinSkeleton(branch.name);
    if (target.length < 3) continue;
    const word = words.find((w) => {
      const sound = scriptSkeleton(w);
      // Allow a short ending such as "లో" (in) after the name.
      return sound.startsWith(target) && sound.length - target.length <= 1;
    });
    if (word) return { branch, word };
  }
  return null;
}

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

function stripQuestionWords(text) {
  return text
    .split(/\s+/)
    .filter((w) => w && !isQuestionWord(w))
    .join(' ');
}

/**
 * @param {string} message
 * @param {{ branches?: {id:number, name:string, code:string}[] }} [options]
 * @returns {{ intent: string, query: string, branchId: number|null, periodDays: number|null,
 *            followUp: boolean, direction: 'in'|'out'|null }}
 */
export function parseQuestion(message, { branches = [] } = {}) {
  const text = String(message ?? '')
    .toLowerCase()
    // Zero-width joiners inside Telugu/Hindi words ("బ్రాంచ్‌లో") carry no meaning here.
    .replace(/[‌‍]/g, '')
    .replace(/[?!,।]/g, ' ')
    .replace(/\.(?=\s|$)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const matched = INTENT_RULES.find((r) => r.pattern.test(text));
  let intent = matched?.intent ?? INTENT.UNKNOWN;

  // A branch named in the question ("in Vijayawada") is a filter, not part of the search.
  let branch = branches.find(
    (b) => wordPattern(b.name).test(text) || wordPattern(b.code).test(text),
  );
  let remaining = text;
  if (branch) {
    remaining = remaining
      .replace(wordPattern(branch.name), ' ')
      .replace(wordPattern(branch.code), ' ');
  } else {
    const spoken = branchInScript(text, branches);
    if (spoken) {
      branch = spoken.branch;
      remaining = remaining.split(spoken.word).join(' ');
    }
  }

  const periodDays = parsePeriodDays(text);
  if (matched) remaining = remaining.replace(new RegExp(matched.pattern.source, 'g'), ' ');
  remaining = removePeriods(remaining);

  const query = parseVoiceQuery(stripQuestionWords(remaining)).query;
  const followUp = FOLLOW_UP.test(text) || (!query && Boolean(branch));

  // A plain part name ("PC200 idler") is a stock question.
  if (intent === INTENT.UNKNOWN && query) intent = INTENT.STOCK_CHECK;
  // "Is the fuel filter out of stock?" is a stock check of that part, not a list.
  if ((intent === INTENT.OUT_OF_STOCK || intent === INTENT.LOW_STOCK) && query) {
    intent = INTENT.STOCK_CHECK;
  }
  // "and in Vijayawada?" after a part was discussed.
  if (intent === INTENT.UNKNOWN && followUp) intent = INTENT.STOCK_CHECK;

  let direction = null;
  if (DIRECTION_IN.test(text)) direction = 'in';
  else if (DIRECTION_OUT.test(text)) direction = 'out';

  return { intent, query, branchId: branch?.id ?? null, periodDays, followUp, direction };
}
