/**
 * Same parser as frontend/src/utils/voiceQuery.js (keep the two in sync); used here by
 * Ask Stock so typed and spoken questions are cleaned up on the server.
 *
 * Turns what shop staff say into a product search, e.g.
 *   "JCB 3DX ka hydraulic filter 10 piece chahiye"  →  { query: "jcb 3dx hydraulic filter", quantity: 10 }
 *   "जेसीबी का हाइड्रोलिक फ़िल्टर"                      →  { query: "jcb hydraulic filter" }
 *   "part number 320 slash 04133"                    →  { query: "320/04133" }
 *
 * Rule-based and offline: removes Hindi/Hinglish/English filler words, maps common
 * Hindi (Devanagari) part words to the English names used in the catalogue, rebuilds
 * spoken part numbers and picks up a quantity only when a unit word follows the number
 * ("10 piece"), so numbers inside part numbers are never mistaken for quantities.
 */

const DEVANAGARI_DIGITS = '०१२३४५६७८९';

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
]);

const SEPARATOR_WORDS = { slash: '/', by: '/', oblique: '/', dash: '-', hyphen: '-', minus: '-' };

const MAX_QUANTITY = 100000;

function toAsciiDigits(text) {
  return text.replace(/[०-९]/g, (d) => String(DEVANAGARI_DIGITS.indexOf(d)));
}

// Multi-word Hindi phrases ("जे सी बी") are replaced in the text; single words are mapped
// whole-word only, so a short word like "नट" never changes a longer word containing it.
const HINDI_PHRASES = Object.keys(HINDI_TERMS).filter((term) => term.includes(' '));

function translateHindiPhrases(text) {
  return HINDI_PHRASES.reduce(
    (result, phrase) => result.split(phrase).join(` ${HINDI_TERMS[phrase]} `),
    text,
  );
}

/** Maps a Hindi word, also when spoken glued to a number ("3डीएक्स" → "3dx"). */
function translateHindiWord(token) {
  if (HINDI_TERMS[token]) return HINDI_TERMS[token];
  const glued = token.match(/^(\d+)(\D+)$/);
  return glued && HINDI_TERMS[glued[2]] ? glued[1] + HINDI_TERMS[glued[2]] : token;
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
  text = translateHindiPhrases(text);
  // Keep letters and combining marks (any script), digits, "/" "-" "."; the rest becomes a space.
  text = text
    .replace(/[^\p{L}\p{M}\p{N}/.\s-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  let tokens = text.split(' ').filter(Boolean).map(translateHindiWord);

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
