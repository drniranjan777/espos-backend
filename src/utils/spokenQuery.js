/**
 * Same parser as frontend/src/utils/voiceQuery.js (keep the two in sync); used here by
 * Ask Stock so typed and spoken questions are cleaned up on the server.
 *
 * Turns what shop staff say into a product search, e.g.
 *   "JCB 3DX ka hydraulic filter 10 piece chahiye"  →  { query: "jcb 3dx hydraulic filter", quantity: 10 }
 *   "जेसीबी का हाइड्रोलिक फ़िल्टर"                      →  { query: "jcb hydraulic filter" }
 *   "జెసిబి హైడ్రాలిక్ ఫిల్టర్ పది పీసులు"                →  { query: "jcb hydraulic filter", quantity: 10 }
 *   "part number 320 slash 04133"                    →  { query: "320/04133" }
 *
 * Rule-based and offline: removes English/Hinglish/Hindi/Telugu filler words, maps common
 * Hindi (Devanagari) and Telugu part words to the English names used in the catalogue, rebuilds
 * spoken part numbers and picks up a quantity only when a unit word follows the number
 * ("10 piece"), so numbers inside part numbers are never mistaken for quantities.
 */

const DEVANAGARI_DIGITS = '०१२३४५६७८९';
const TELUGU_DIGITS = '౦౧౨౩౪౫౬౭౮౯';

/** Hindi (Devanagari) words → catalogue English. Several spellings per word. */
const HINDI_TERMS = {
  जेसीबी: 'jcb',
  'जे सी बी': 'jcb',
  हाइड्रोलिक: 'hydraulic',
  हायड्रोलिक: 'hydraulic',
  हाईड्रोलिक: 'hydraulic',
  फ़िल्टर: 'filter',
  फिल्टर: 'filter',
  पंप: 'pump',
  पम्प: 'pump',
  ऑयल: 'oil',
  आयल: 'oil',
  तेल: 'oil',
  इंजन: 'engine',
  फ्यूल: 'fuel',
  डीजल: 'fuel',
  डीज़ल: 'fuel',
  एयर: 'air',
  हवा: 'air',
  बकेट: 'bucket',
  पिन: 'pin',
  सील: 'seal',
  किट: 'kit',
  बेयरिंग: 'bearing',
  बियरिंग: 'bearing',
  बुश: 'bush',
  बोल्ट: 'bolt',
  नट: 'nut',
  बेल्ट: 'belt',
  होज़: 'hose',
  होज: 'hose',
  पाइप: 'pipe',
  वाल्व: 'valve',
  सिलेंडर: 'cylinder',
  सिलिंडर: 'cylinder',
  टूथ: 'tooth',
  दांत: 'tooth',
  दाँत: 'tooth',
  रोलर: 'roller',
  आइडलर: 'idler',
  आईडलर: 'idler',
  ट्रैक: 'track',
  स्टार्टर: 'starter',
  मोटर: 'motor',
  अल्टरनेटर: 'alternator',
  पिस्टन: 'piston',
  रिंग: 'ring',
  ग्रीस: 'grease',
  वाटर: 'water',
  पानी: 'water',
  ब्रेक: 'brake',
  गियर: 'gear',
  क्लच: 'clutch',
  आउटर: 'outer',
  कैट: 'cat',
  कोमात्सु: 'komatsu',
  टाटा: 'tata',
  हिताची: 'hitachi',
  एस्कॉर्ट्स: 'escorts',
  डीएक्स: 'dx',
  'डी एक्स': 'dx',
  स्लैश: 'slash',
  डैश: 'dash',
};

/** Telugu words → catalogue English (part names are usually English words in Telugu script). */
const TELUGU_TERMS = {
  జెసిబి: 'jcb',
  జేసీబీ: 'jcb',
  జెసీబీ: 'jcb',
  జేసిబి: 'jcb',
  'జె సి బి': 'jcb',
  'జే సి బి': 'jcb',
  హైడ్రాలిక్: 'hydraulic',
  హైడ్రాలిక్స్: 'hydraulic',
  ఫిల్టర్: 'filter',
  ఫిల్టరు: 'filter',
  పంప్: 'pump',
  పంపు: 'pump',
  ఆయిల్: 'oil',
  నూనె: 'oil',
  ఇంజన్: 'engine',
  ఇంజిన్: 'engine',
  ఫ్యూయల్: 'fuel',
  డీజిల్: 'fuel',
  ఎయిర్: 'air',
  గాలి: 'air',
  బకెట్: 'bucket',
  పిన్: 'pin',
  సీల్: 'seal',
  కిట్: 'kit',
  బేరింగ్: 'bearing',
  బుష్: 'bush',
  బోల్ట్: 'bolt',
  నట్: 'nut',
  బెల్ట్: 'belt',
  హోస్: 'hose',
  పైప్: 'pipe',
  పైపు: 'pipe',
  వాల్వ్: 'valve',
  సిలిండర్: 'cylinder',
  టూత్: 'tooth',
  పన్ను: 'tooth',
  పళ్ళు: 'tooth',
  రోలర్: 'roller',
  ట్రాక్: 'track',
  ఐడ్లర్: 'idler',
  స్టార్టర్: 'starter',
  మోటార్: 'motor',
  మోటర్: 'motor',
  ఆల్టర్నేటర్: 'alternator',
  పిస్టన్: 'piston',
  రింగ్: 'ring',
  గ్రీస్: 'grease',
  వాటర్: 'water',
  నీటి: 'water',
  నీరు: 'water',
  బ్రేక్: 'brake',
  గేర్: 'gear',
  క్లచ్: 'clutch',
  ఔటర్: 'outer',
  క్యాట్: 'cat',
  కొమాట్సు: 'komatsu',
  కోమాట్సు: 'komatsu',
  టాటా: 'tata',
  హిటాచి: 'hitachi',
  ఎస్కార్ట్స్: 'escorts',
  డిఎక్స్: 'dx',
  'డి ఎక్స్': 'dx',
  పీసీ: 'pc',
  పిసి: 'pc',
  'పి సి': 'pc',
  స్లాష్: 'slash',
  డాష్: 'dash',
};

/** Endings Telugu adds to nouns ("ఫిల్టర్లు" filters, "బకెట్‌కి" for the bucket). */
const TELUGU_SUFFIXES = ['లు', 'ని', 'ను', 'కి', 'కు', 'లో', 'ది', 'తో', 'కీ'];

const SCRIPT_TERMS = { ...HINDI_TERMS, ...TELUGU_TERMS };

/** Number words (English, Hinglish, Hindi). Only used when a unit word follows. */
const NUMBER_WORDS = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  fifteen: 15,
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  hundred: 100,
  ek: 1,
  do: 2,
  teen: 3,
  tin: 3,
  char: 4,
  chaar: 4,
  paanch: 5,
  panch: 5,
  chhe: 6,
  che: 6,
  saat: 7,
  sat: 7,
  aath: 8,
  ath: 8,
  nau: 9,
  das: 10,
  gyarah: 11,
  barah: 12,
  pandrah: 15,
  bees: 20,
  bis: 20,
  pachees: 25,
  pachis: 25,
  tees: 30,
  chalees: 40,
  pachaas: 50,
  pachas: 50,
  sau: 100,
  एक: 1,
  दो: 2,
  तीन: 3,
  चार: 4,
  पांच: 5,
  पाँच: 5,
  छह: 6,
  छः: 6,
  सात: 7,
  आठ: 8,
  नौ: 9,
  दस: 10,
  ग्यारह: 11,
  बारह: 12,
  पंद्रह: 15,
  बीस: 20,
  पच्चीस: 25,
  तीस: 30,
  चालीस: 40,
  पचास: 50,
  सौ: 100,
  // Telugu, and Telugu written in Latin letters
  ఒకటి: 1,
  రెండు: 2,
  మూడు: 3,
  నాలుగు: 4,
  ఐదు: 5,
  అయిదు: 5,
  ఆరు: 6,
  ఏడు: 7,
  ఎనిమిది: 8,
  తొమ్మిది: 9,
  పది: 10,
  పదకొండు: 11,
  పన్నెండు: 12,
  పదిహేను: 15,
  ఇరవై: 20,
  ముప్పై: 30,
  నలభై: 40,
  యాభై: 50,
  వంద: 100,
  okati: 1,
  rendu: 2,
  moodu: 3,
  mudu: 3,
  nalugu: 4,
  aidu: 5,
  aaru: 6,
  edu: 7,
  enimidi: 8,
  tommidi: 9,
  padi: 10,
  iravai: 20,
  vanda: 100,
};

/** Words that mark the preceding number as a quantity. */
const UNIT_WORDS = new Set([
  'piece',
  'pieces',
  'pc',
  'pcs',
  'peace',
  'nos',
  'no',
  'number',
  'numbers',
  'unit',
  'units',
  'qty',
  'set',
  'sets',
  'kit',
  'kits',
  'box',
  'boxes',
  'pair',
  'pairs',
  'litre',
  'litres',
  'liter',
  'liters',
  'ltr',
  'kg',
  'kilo',
  'kilos',
  'meter',
  'meters',
  'metre',
  'metres',
  'mtr',
  'nag',
  'adad',
  'पीस',
  'नग',
  'अदद',
  'लीटर',
  'किलो',
  'मीटर',
  'सेट',
  'डिब्बा',
  'పీస్',
  'పీసు',
  'పీసులు',
  'peesulu',
  'లీటర్',
  'లీటర్లు',
  'కిలో',
  'కిలోలు',
  'సెట్',
  'సెట్లు',
  'మీటర్',
  'మీటర్లు',
  'డబ్బా',
]);

/** Words that carry no product information. */
const FILLER_WORDS = new Set([
  // Hinglish
  'ka',
  'ki',
  'ke',
  'ko',
  'mein',
  'me',
  'mai',
  'se',
  'hai',
  'hain',
  'kya',
  'chahiye',
  'chaiye',
  'chahie',
  'dikhao',
  'dikha',
  'dikhana',
  'dena',
  'de',
  'dijiye',
  'do',
  'karo',
  'kar',
  'kardo',
  'wala',
  'wali',
  'wale',
  'vala',
  'jo',
  'lagta',
  'lagti',
  'lagega',
  'liye',
  'lie',
  'bhai',
  'bhaiya',
  'zara',
  'jara',
  'ek',
  'aur',
  'kitna',
  'kitne',
  'hatao',
  'nikalo',
  'daalo',
  'dalo',
  'jodo',
  'add',
  'stock',
  'mujhe',
  'humko',
  'hume',
  'yeh',
  'ye',
  'woh',
  'wo',
  'koi',
  'available',
  // English
  'show',
  'find',
  'search',
  'need',
  'want',
  'give',
  'get',
  'please',
  'the',
  'a',
  'an',
  'of',
  'for',
  'in',
  'out',
  'to',
  'some',
  'any',
  'i',
  'we',
  'me',
  'my',
  'is',
  'are',
  'there',
  'part',
  'parts',
  'item',
  'items',
  'product',
  'products',
  'machine',
  'number',
  'no',
  // Hindi
  'का',
  'की',
  'के',
  'को',
  'में',
  'से',
  'है',
  'हैं',
  'क्या',
  'चाहिए',
  'चाहिये',
  'दिखाओ',
  'दिखा',
  'दो',
  'दीजिए',
  'दे',
  'करो',
  'कर',
  'वाला',
  'वाली',
  'वाले',
  'जो',
  'लगता',
  'लगेगा',
  'लिए',
  'भाई',
  'भैया',
  'ज़रा',
  'और',
  'कितना',
  'कितने',
  'हटाओ',
  'निकालो',
  'डालो',
  'जोड़ो',
  'ऐड',
  'स्टॉक',
  'मुझे',
  'यह',
  'ये',
  'वो',
  'कोई',
  'पार्ट',
  'नंबर',
  'मशीन',
  'प्लीज़',
  // Telugu, and Telugu written in Latin letters
  'కావాలి',
  'కావాలండి',
  'చూపించు',
  'చూపించండి',
  'చూపు',
  'ఇవ్వు',
  'ఇవ్వండి',
  'ఉందా',
  'ఉంది',
  'ఉన్నాయా',
  'ఉన్నాయి',
  'ఎంత',
  'ఎన్ని',
  'ఏమిటి',
  'ఏంటి',
  'యొక్క',
  'మరియు',
  'అండి',
  'అన్నా',
  'సార్',
  'ఆ',
  'ఈ',
  'ఒక',
  'లో',
  'కి',
  'కు',
  'ది',
  'పార్ట్',
  'పార్టు',
  'పార్ట్స్',
  'నంబర్',
  'నెంబర్',
  'మెషిన్',
  'స్టాక్',
  'ప్లీజ్',
  'కోసం',
  'kavali',
  'unda',
  'undha',
  'undi',
  'unnaya',
  'unnayi',
  'enta',
  'entha',
  'enni',
  'chupinchu',
  'ivvu',
  'andi',
]);

const SEPARATOR_WORDS = { slash: '/', by: '/', oblique: '/', dash: '-', hyphen: '-', minus: '-' };

const MAX_QUANTITY = 100000;

function toAsciiDigits(text) {
  return text
    .replace(/[०-९]/g, (d) => String(DEVANAGARI_DIGITS.indexOf(d)))
    .replace(/[౦-౯]/g, (d) => String(TELUGU_DIGITS.indexOf(d)));
}

// Multi-word phrases ("जे सी बी", "జె సి బి") are replaced in the text; single words are
// mapped whole-word only, so a short word like "नट" never changes a longer word containing it.
const SCRIPT_PHRASES = Object.keys(SCRIPT_TERMS).filter((term) => term.includes(' '));

function translatePhrases(text) {
  return SCRIPT_PHRASES.reduce(
    (result, phrase) => result.split(phrase).join(` ${SCRIPT_TERMS[phrase]} `),
    text,
  );
}

/** Catalogue word for a Hindi/Telugu word, also with a Telugu ending ("ఫిల్టర్లు"). */
function lookupTerm(word) {
  if (SCRIPT_TERMS[word]) return SCRIPT_TERMS[word];
  const suffix = TELUGU_SUFFIXES.find(
    (s) => word.endsWith(s) && SCRIPT_TERMS[word.slice(0, -s.length)],
  );
  return suffix ? SCRIPT_TERMS[word.slice(0, -suffix.length)] : null;
}

/** Maps a Hindi/Telugu word, also when spoken glued to a number ("3డిఎక్స్" → "3dx"). */
function translateWord(token) {
  const term = lookupTerm(token);
  if (term) return term;
  const glued = token.match(/^(\d+)(\D+)$/);
  const gluedTerm = glued && lookupTerm(glued[2]);
  return gluedTerm ? glued[1] + gluedTerm : token;
}

function numberValue(token) {
  if (/^\d+(\.\d+)?$/.test(token)) return Number(token);
  return NUMBER_WORDS[token] ?? null;
}

/**
 * @param {string} transcript  raw speech-to-text result
 * @returns {{ query: string, quantity: number|null }}
 */
export function parseVoiceQuery(transcript) {
  let text = toAsciiDigits(String(transcript ?? '').toLowerCase());
  text = translatePhrases(text);
  // Keep letters and combining marks (any script), digits, "/" "-" "."; the rest becomes a space.
  text = text
    .replace(/[^\p{L}\p{M}\p{N}/.\s-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  let tokens = text.split(' ').filter(Boolean).map(translateWord);

  // 1. Quantity: a number immediately followed by a unit word ("10 piece", "bees pcs").
  let quantity = null;
  for (let i = 0; i < tokens.length - 1; i += 1) {
    const value = numberValue(tokens[i]);
    if (value !== null && value > 0 && value <= MAX_QUANTITY && UNIT_WORDS.has(tokens[i + 1])) {
      quantity = value;
      tokens.splice(i, 2);
      break;
    }
  }
  // "quantity 5" / "qty 5"
  if (quantity === null) {
    const index = tokens.findIndex((t) => t === 'quantity' || t === 'qty');
    const value = index >= 0 ? numberValue(tokens[index + 1] ?? '') : null;
    if (value !== null && value > 0 && value <= MAX_QUANTITY) {
      quantity = value;
      tokens.splice(index, 2);
    }
  }

  // 2. Spoken separators inside codes: "320 slash 04133" → "320/04133".
  const rebuilt = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const separator = SEPARATOR_WORDS[tokens[i]];
    const prev = rebuilt[rebuilt.length - 1];
    const next = tokens[i + 1];
    if (separator && prev && next && /\d/.test(prev + next)) {
      rebuilt[rebuilt.length - 1] = `${prev}${separator}${next}`;
      i += 1;
    } else {
      rebuilt.push(tokens[i]);
    }
  }
  tokens = rebuilt;

  // 3. Digits spoken one by one ("3 2 0 0 4") → "32004".
  const joined = [];
  for (const token of tokens) {
    const prev = joined[joined.length - 1];
    if (/^\d$/.test(token) && prev && /^\d+$/.test(prev)) {
      joined[joined.length - 1] = prev + token;
    } else {
      joined.push(token);
    }
  }
  tokens = joined;

  // 4. Machine models said in two parts: "3 dx" → "3dx", "pc 200" → "pc200".
  const models = [];
  for (const token of tokens) {
    const prev = models[models.length - 1];
    const digitThenLetters = prev && /^\d{1,3}$/.test(prev) && /^[a-z]{1,3}$/.test(token);
    const lettersThenDigits = prev && /^[a-z]{1,3}$/.test(prev) && /^\d{2,4}$/.test(token);
    if (
      (digitThenLetters || lettersThenDigits) &&
      !FILLER_WORDS.has(token) &&
      !FILLER_WORDS.has(prev)
    ) {
      models[models.length - 1] = prev + token;
    } else {
      models.push(token);
    }
  }

  // 5. Drop filler words; keep everything else in spoken order.
  const query = models.filter((t) => !FILLER_WORDS.has(t) && !UNIT_WORDS.has(t)).join(' ');
  return { query, quantity };
}
