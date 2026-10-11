/**
 * Ask Stock answers in English, Hindi and Telugu. Every sentence the assistant says is a
 * template here, filled with figures read from the database — nothing is generated freely.
 * Part, customer and branch names stay as stored (usually English).
 *
 * To add a language: add its code to LANGUAGES and a block with the same keys below.
 */
export const LANGUAGES = ['en', 'hi', 'te'];
export const DEFAULT_LANGUAGE = 'en';

const plural = (n, one, many) => (Number(n) === 1 ? one : many);

const en = {
  denied: () => 'You don’t have access to that information. Ask an administrator if you need it.',
  partNotFound: ({ query }) =>
    `I couldn’t find a part matching “${query}”. Try the part number, or a shorter name like “hydraulic filter”.`,
  whichPart: () => 'Which part do you mean? Say its name or part number, e.g. “PC200 idler stock”.',
  closestParts: ({ query, branch }) =>
    `No exact match for “${query}”. These are the closest parts in ${branch}:`,
  manyParts: ({ count, query, branch }) =>
    `I found ${count} parts matching “${query}” in ${branch}. Which one?`,
  stockInBranchTitle: ({ branch }) => `Stock in ${branch}`,
  closestPrefix: ({ name }) => `Closest match: ${name}. `,
  price: ({ name, sku, price, unit, mrp }) =>
    `${name} (${sku}) sells at ₹${price} per ${unit}, MRP ₹${mrp}.`,
  purchasePrice: ({ price }) => ` Purchase price ₹${price}.`,
  whereInStock: ({ name, list }) => `${name} is in stock at ${list}.`,
  whereMost: ({ branch, qty, unit }) => ` ${branch} has the most (${qty} ${unit}).`,
  whereNone: ({ name }) => `${name} is out of stock in every branch you can see.`,
  stockAtBranch: ({ name, qty, unit, branch }) => `${name}: ${qty} ${unit} in ${branch}.`,
  branchDenied: () => 'You don’t have access to that branch.',
  stockHere: ({ name, sku, qty, unit, branch }) => `${name} (${sku}): ${qty} ${unit} in ${branch}.`,
  noteOut: () => ' It is out of stock here.',
  noteLow: ({ min }) => ` That is at or below the minimum level of ${min}.`,

  reorderNone: ({ branch }) =>
    `Nothing needs reordering in ${branch} this week: every part is expected to stay above its minimum level.`,
  reorderSome: ({ count, branch, horizon, cover }) =>
    `${count} ${plural(count, 'part', 'parts')} in ${branch} will reach the minimum level within ${horizon} days at the current usage. The suggested order is an estimate: ${cover} days of usage above the minimum.`,
  reorderTitle: () => 'Reorder this week',

  nonMovingNone: ({ branch, days }) => `No part in ${branch} has gone ${days} days without moving.`,
  nonMovingSome: ({ count, branch, days, byValue }) =>
    `${count} ${plural(count, 'part has', 'parts have')} not gone out of ${branch} in the last ${days} days${byValue ? ' (largest stock value first)' : ''}.`,
  nonMovingTitle: ({ days }) => `Not moved in ${days} days`,

  outNone: ({ branch }) => `Nothing is out of stock in ${branch}.`,
  lowNone: ({ branch }) => `Nothing is low on stock in ${branch}.`,
  outSome: ({ count, branch }) => `${count} parts are out of stock in ${branch}:`,
  lowSome: ({ count, branch }) => `${count} parts are low on stock in ${branch}:`,
  outTitle: () => 'Out of stock',
  lowTitle: () => 'Low stock',

  whichMachine: () => 'Which machine? For example “parts for PC200” or “3DX parts”.',
  machineNone: ({ model }) =>
    `No parts are listed for machine “${model}”. Try the model as written on the machine, e.g. “3DX” or “PC200”.`,
  machineSome: ({ model, branch }) => `Parts for ${model} in ${branch}:`,
  machineTitle: ({ model }) => `${model} parts`,

  whichCustomer: () =>
    'Which customer? Say the customer or company name, e.g. “What did Patil Earthmovers buy this month?”.',
  customerNone: ({ name, days }) =>
    `${name} took no parts from this branch in the last ${days} days.`,
  invoices: ({ count, total }) =>
    ` ${count} ${plural(count, 'invoice', 'invoices')} worth ₹${total}.`,
  customerSome: ({ name, days, count }) =>
    `In the last ${days} days ${name} took ${count} different ${plural(count, 'part', 'parts')}.`,
  customerTitle: ({ name, days }) => `${name} — last ${days} days`,

  today: ({ branch, out, outCount, in: stockIn, inCount }) =>
    `Today in ${branch}: ${out} units out (${outCount} entries), ${stockIn} units in (${inCount} entries).`,
  todaySales: ({ count, value }) =>
    ` ${count} ${plural(count, 'invoice', 'invoices')}, sales ₹${value}.`,
  todayLevels: ({ low, out }) => ` ${low} parts are low and ${out} are out of stock.`,
  todayIn: ({ branch, qty, count }) =>
    `Today ${qty} units came in to ${branch} (${count} entries).`,
  todayOut: ({ branch, qty, count }) =>
    `Today ${qty} units went out of ${branch} (${count} entries).`,
  todayInTitle: () => 'Stock in today',
  todayOutTitle: () => 'Stock out today',

  soldPart: ({ name, qty, unit, days, branch, entries }) =>
    `${qty} ${unit} of ${name} went out of ${branch} in the last ${days} days (${entries} ${plural(entries, 'entry', 'entries')}).`,
  soldNonePart: ({ name, days, branch }) =>
    `No ${name} went out of ${branch} in the last ${days} days.`,
  topNone: ({ days, branch }) => `No stock went out of ${branch} in the last ${days} days.`,
  topSome: ({ days, branch }) => `Fastest-moving parts in ${branch} over the last ${days} days:`,
  topTitle: ({ days }) => `Top movers — ${days} days`,

  compare: ({ count }) => `Stock across your ${count} ${plural(count, 'branch', 'branches')}:`,
  compareTitle: () => 'Branch comparison',
  categoryIntro: ({ branch }) => `Stock by category in ${branch}:`,
  categoryTitle: () => 'Stock by category',
  uncategorised: () => 'No category',
  transfers: ({ branch, awaiting, incoming }) =>
    `${branch}: ${awaiting} ${plural(awaiting, 'transfer is', 'transfers are')} waiting for approval and ${incoming} ${plural(incoming, 'is', 'are')} on the way here.`,

  help: () =>
    'I can tell you the stock of any part (by name, part number or machine), which branch has it, prices, what to reorder, which parts are not moving, what is low or out of stock, what sold, what a customer bought, how branches compare and today’s figures. Type, or tap the mic and speak in English, Hindi or Telugu.',
  unknown: () =>
    'Sorry, I didn’t understand that. Ask about a part’s stock or price, reorders, slow-moving parts, a customer or today’s figures.',
  never: () => 'Never',

  colPart: () => 'Part',
  colStock: () => 'Stock',
  colMin: () => 'Min',
  colUsed: ({ days }) => `Used ${days}d`,
  colOrder: () => 'Order',
  colLastOut: () => 'Last out',
  colValue: () => 'Value',
  colQty: () => 'Qty',
  colLast: () => 'Last',
  colBranch: () => 'Branch',
  colParts: () => 'Parts',
  colUnits: () => 'Units',
  colLow: () => 'Low',
  colOut: () => 'Out',
  colCategory: () => 'Category',
  colEntries: () => 'Entries',

  sPrice: ({ name }) => `Price of ${name}?`,
  sWhere: ({ name }) => `Which branch has ${name}?`,
  sStock: ({ name }) => `${name} stock`,
  sSold: () => 'How many were sold this month?',
  sExample: () => 'Hydraulic filter, how many in stock?',
  sReorder: () => 'What should I reorder this week?',
  sNonMoving: () => 'Which parts have not moved in two months?',
  sOut: () => 'What is out of stock?',
  sLow: () => 'What is low on stock?',
  sToday: () => 'Today’s sales and stock out?',
  sCompare: () => 'Compare stock across branches',
  sTop: () => 'Fast-moving parts this month?',
};

const hi = {
  denied: () => 'आपको यह जानकारी देखने की अनुमति नहीं है। ज़रूरत हो तो एडमिन से कहें।',
  partNotFound: ({ query }) =>
    `“${query}” से मिलता कोई पार्ट नहीं मिला। पार्ट नंबर या छोटा नाम बताकर देखें, जैसे “hydraulic filter”।`,
  whichPart: () => 'कौन सा पार्ट? उसका नाम या पार्ट नंबर बताएं, जैसे “PC200 idler”।',
  closestParts: ({ query, branch }) =>
    `“${query}” का सटीक मेल नहीं मिला। ${branch} में सबसे मिलते-जुलते पार्ट ये हैं:`,
  manyParts: ({ count, query, branch }) =>
    `${branch} में “${query}” से मिलते ${count} पार्ट मिले। कौन सा चाहिए?`,
  stockInBranchTitle: ({ branch }) => `${branch} में स्टॉक`,
  closestPrefix: ({ name }) => `सबसे नज़दीकी मेल: ${name}। `,
  price: ({ name, sku, price, unit, mrp }) =>
    `${name} (${sku}) का बिक्री मूल्य ₹${price} प्रति ${unit} है, MRP ₹${mrp}।`,
  purchasePrice: ({ price }) => ` खरीद मूल्य ₹${price}।`,
  whereInStock: ({ name, list }) => `${name} इन ब्रांच में स्टॉक में है: ${list}।`,
  whereMost: ({ branch, qty, unit }) => ` सबसे ज़्यादा स्टॉक ${branch} में है (${qty} ${unit})।`,
  whereNone: ({ name }) => `${name} आपकी किसी भी ब्रांच में स्टॉक में नहीं है।`,
  stockAtBranch: ({ name, qty, unit, branch }) => `${name}: ${branch} में ${qty} ${unit}।`,
  branchDenied: () => 'आपको उस ब्रांच की अनुमति नहीं है।',
  stockHere: ({ name, sku, qty, unit, branch }) =>
    `${name} (${sku}): ${branch} में ${qty} ${unit} स्टॉक में है।`,
  noteOut: () => ' यहाँ स्टॉक खत्म है।',
  noteLow: ({ min }) => ` यह न्यूनतम स्तर ${min} पर या उससे कम है।`,

  reorderNone: ({ branch }) =>
    `इस हफ्ते ${branch} में कुछ भी दोबारा मंगाने की ज़रूरत नहीं है: हर पार्ट न्यूनतम स्तर से ऊपर रहने की उम्मीद है।`,
  reorderSome: ({ count, branch, horizon, cover }) =>
    `${branch} में ${count} पार्ट मौजूदा खपत पर ${horizon} दिनों में न्यूनतम स्तर तक पहुँच जाएंगे। सुझाई गई मात्रा एक अनुमान है: न्यूनतम स्तर के ऊपर ${cover} दिनों की खपत।`,
  reorderTitle: () => 'इस हफ्ते मंगाएं',

  nonMovingNone: ({ branch, days }) =>
    `${branch} में कोई भी पार्ट ${days} दिनों से बिना निकले नहीं पड़ा है।`,
  nonMovingSome: ({ count, branch, days, byValue }) =>
    `${branch} में ${count} पार्ट पिछले ${days} दिनों से नहीं निकले हैं${byValue ? ' (सबसे ज़्यादा स्टॉक मूल्य पहले)' : ''}।`,
  nonMovingTitle: ({ days }) => `${days} दिनों से नहीं निकले`,

  outNone: ({ branch }) => `${branch} में किसी पार्ट का स्टॉक खत्म नहीं है।`,
  lowNone: ({ branch }) => `${branch} में किसी पार्ट का स्टॉक कम नहीं है।`,
  outSome: ({ count, branch }) => `${branch} में ${count} पार्ट का स्टॉक खत्म है:`,
  lowSome: ({ count, branch }) => `${branch} में ${count} पार्ट का स्टॉक कम है:`,
  outTitle: () => 'स्टॉक खत्म',
  lowTitle: () => 'कम स्टॉक',

  whichMachine: () => 'कौन सी मशीन? जैसे “PC200 के पार्ट्स” या “3DX parts”।',
  machineNone: ({ model }) =>
    `मशीन “${model}” के लिए कोई पार्ट दर्ज नहीं है। मॉडल वैसे बताएं जैसे मशीन पर लिखा है, जैसे “3DX” या “PC200”।`,
  machineSome: ({ model, branch }) => `${branch} में ${model} के पार्ट्स:`,
  machineTitle: ({ model }) => `${model} के पार्ट्स`,

  whichCustomer: () => 'कौन सा ग्राहक? ग्राहक या कंपनी का नाम बताएं।',
  customerNone: ({ name, days }) =>
    `${name} ने पिछले ${days} दिनों में इस ब्रांच से कोई पार्ट नहीं लिया।`,
  invoices: ({ count, total }) => ` ${count} बिल, कुल ₹${total}।`,
  customerSome: ({ name, days, count }) =>
    `पिछले ${days} दिनों में ${name} ने ${count} अलग-अलग पार्ट लिए।`,
  customerTitle: ({ name, days }) => `${name} — पिछले ${days} दिन`,

  today: ({ branch, out, outCount, in: stockIn, inCount }) =>
    `आज ${branch} में: ${out} यूनिट बाहर गए (${outCount} एंट्री), ${stockIn} यूनिट अंदर आए (${inCount} एंट्री)।`,
  todaySales: ({ count, value }) => ` ${count} बिल, बिक्री ₹${value}।`,
  todayLevels: ({ low, out }) => ` ${low} पार्ट का स्टॉक कम है और ${out} का खत्म है।`,
  todayIn: ({ branch, qty, count }) => `आज ${branch} में ${qty} यूनिट स्टॉक आया (${count} एंट्री)।`,
  todayOut: ({ branch, qty, count }) =>
    `आज ${branch} से ${qty} यूनिट स्टॉक निकला (${count} एंट्री)।`,
  todayInTitle: () => 'आज आया स्टॉक',
  todayOutTitle: () => 'आज निकला स्टॉक',

  soldPart: ({ name, qty, unit, days, branch, entries }) =>
    `पिछले ${days} दिनों में ${branch} से ${name} के ${qty} ${unit} निकले (${entries} एंट्री)।`,
  soldNonePart: ({ name, days, branch }) =>
    `पिछले ${days} दिनों में ${branch} से ${name} नहीं निकला।`,
  topNone: ({ days, branch }) => `पिछले ${days} दिनों में ${branch} से कोई स्टॉक नहीं निकला।`,
  topSome: ({ days, branch }) =>
    `पिछले ${days} दिनों में ${branch} में सबसे ज़्यादा निकलने वाले पार्ट:`,
  topTitle: ({ days }) => `सबसे ज़्यादा बिकने वाले — ${days} दिन`,

  compare: ({ count }) => `आपकी ${count} ब्रांच के स्टॉक की तुलना:`,
  compareTitle: () => 'ब्रांच तुलना',
  categoryIntro: ({ branch }) => `${branch} में कैटेगरी के अनुसार स्टॉक:`,
  categoryTitle: () => 'कैटेगरी के अनुसार स्टॉक',
  uncategorised: () => 'कोई कैटेगरी नहीं',
  transfers: ({ branch, awaiting, incoming }) =>
    `${branch}: ${awaiting} ट्रांसफर मंज़ूरी का इंतज़ार कर रहे हैं और ${incoming} रास्ते में हैं।`,

  help: () =>
    'मैं किसी भी पार्ट का स्टॉक (नाम, पार्ट नंबर या मशीन से), वह किस ब्रांच में है, दाम, क्या दोबारा मंगाना है, कौन से पार्ट नहीं निकल रहे, क्या कम या खत्म है, क्या बिका, ग्राहक ने क्या खरीदा, ब्रांच की तुलना और आज के आंकड़े बता सकता हूँ। टाइप करें या माइक दबाकर हिंदी, अंग्रेज़ी या तेलुगु में बोलें।',
  unknown: () =>
    'माफ़ कीजिए, मैं समझ नहीं पाया। किसी पार्ट का स्टॉक या दाम, दोबारा ऑर्डर, न निकलने वाले पार्ट, ग्राहक या आज के आंकड़े पूछें।',
  never: () => 'कभी नहीं',

  colPart: () => 'पार्ट',
  colStock: () => 'स्टॉक',
  colMin: () => 'न्यूनतम',
  colUsed: ({ days }) => `${days} दिन में खपत`,
  colOrder: () => 'ऑर्डर',
  colLastOut: () => 'आखिरी निकासी',
  colValue: () => 'मूल्य',
  colQty: () => 'मात्रा',
  colLast: () => 'आखिरी',
  colBranch: () => 'ब्रांच',
  colParts: () => 'पार्ट',
  colUnits: () => 'यूनिट',
  colLow: () => 'कम',
  colOut: () => 'खत्म',
  colCategory: () => 'कैटेगरी',
  colEntries: () => 'एंट्री',

  sPrice: ({ name }) => `${name} का दाम?`,
  sWhere: ({ name }) => `${name} किस ब्रांच में है?`,
  sStock: ({ name }) => `${name} का स्टॉक कितना है?`,
  sSold: () => 'इस महीने कितने बिके?',
  sExample: () => 'हाइड्रोलिक फ़िल्टर कितने स्टॉक में हैं?',
  sReorder: () => 'इस हफ्ते क्या ऑर्डर करना है?',
  sNonMoving: () => 'कौन से पार्ट दो महीने से नहीं बिके?',
  sOut: () => 'किन पार्ट का स्टॉक खत्म है?',
  sLow: () => 'किन पार्ट का स्टॉक कम है?',
  sToday: () => 'आज की बिक्री और स्टॉक?',
  sCompare: () => 'सभी ब्रांच के स्टॉक की तुलना करो',
  sTop: () => 'इस महीने सबसे ज़्यादा बिकने वाले पार्ट?',
};

const te = {
  denied: () => 'ఈ సమాచారం చూడటానికి మీకు అనుమతి లేదు. అవసరమైతే అడ్మిన్‌ను అడగండి.',
  partNotFound: ({ query }) =>
    `“${query}” కు సరిపోయే పార్ట్ దొరకలేదు. పార్ట్ నంబర్ లేదా చిన్న పేరుతో ప్రయత్నించండి, ఉదా. “hydraulic filter”.`,
  whichPart: () => 'ఏ పార్ట్? దాని పేరు లేదా పార్ట్ నంబర్ చెప్పండి, ఉదా. “PC200 idler”.',
  closestParts: ({ query, branch }) =>
    `“${query}” కు ఖచ్చితమైన పార్ట్ దొరకలేదు. ${branch}లో దగ్గరగా ఉన్న పార్ట్స్ ఇవి:`,
  manyParts: ({ count, query, branch }) =>
    `${branch}లో “${query}” కు సరిపోయే ${count} పార్ట్స్ దొరికాయి. ఏది కావాలి?`,
  stockInBranchTitle: ({ branch }) => `${branch}లో స్టాక్`,
  closestPrefix: ({ name }) => `దగ్గరి పార్ట్: ${name}. `,
  price: ({ name, sku, price, unit, mrp }) =>
    `${name} (${sku}) అమ్మకం ధర ఒక ${unit}కు ₹${price}, MRP ₹${mrp}.`,
  purchasePrice: ({ price }) => ` కొనుగోలు ధర ₹${price}.`,
  whereInStock: ({ name, list }) => `${name} ఈ బ్రాంచ్‌లలో స్టాక్‌లో ఉంది: ${list}.`,
  whereMost: ({ branch, qty, unit }) => ` అత్యధిక స్టాక్ ${branch}లో ఉంది (${qty} ${unit}).`,
  whereNone: ({ name }) => `${name} మీరు చూడగలిగే ఏ బ్రాంచ్‌లోనూ స్టాక్‌లో లేదు.`,
  stockAtBranch: ({ name, qty, unit, branch }) => `${name}: ${branch}లో ${qty} ${unit}.`,
  branchDenied: () => 'ఆ బ్రాంచ్‌కు మీకు అనుమతి లేదు.',
  stockHere: ({ name, sku, qty, unit, branch }) =>
    `${name} (${sku}): ${branch}లో ${qty} ${unit} స్టాక్‌లో ఉంది.`,
  noteOut: () => ' ఇక్కడ స్టాక్ అయిపోయింది.',
  noteLow: ({ min }) => ` ఇది కనీస స్థాయి ${min} వద్ద లేదా అంతకంటే తక్కువగా ఉంది.`,

  reorderNone: ({ branch }) =>
    `ఈ వారం ${branch}లో ఏదీ మళ్లీ ఆర్డర్ చేయాల్సిన అవసరం లేదు: ప్రతి పార్ట్ కనీస స్థాయి కంటే పైనే ఉంటుందని అంచనా.`,
  reorderSome: ({ count, branch, horizon, cover }) =>
    `${branch}లో ${count} పార్ట్స్ ప్రస్తుత వాడకం ప్రకారం ${horizon} రోజుల్లో కనీస స్థాయికి చేరుతాయి. సూచించిన ఆర్డర్ ఒక అంచనా: కనీస స్థాయికి పైన ${cover} రోజుల వాడకం.`,
  reorderTitle: () => 'ఈ వారం ఆర్డర్ చేయాల్సినవి',

  nonMovingNone: ({ branch, days }) => `${branch}లో ${days} రోజులుగా కదలని పార్ట్ ఏదీ లేదు.`,
  nonMovingSome: ({ count, branch, days, byValue }) =>
    `${branch}లో ${count} పార్ట్స్ గత ${days} రోజులుగా బయటకు వెళ్లలేదు${byValue ? ' (ఎక్కువ స్టాక్ విలువ ముందు)' : ''}.`,
  nonMovingTitle: ({ days }) => `${days} రోజులుగా కదలనివి`,

  outNone: ({ branch }) => `${branch}లో స్టాక్ అయిపోయిన పార్ట్ ఏదీ లేదు.`,
  lowNone: ({ branch }) => `${branch}లో స్టాక్ తక్కువగా ఉన్న పార్ట్ ఏదీ లేదు.`,
  outSome: ({ count, branch }) => `${branch}లో ${count} పార్ట్స్ స్టాక్ అయిపోయింది:`,
  lowSome: ({ count, branch }) => `${branch}లో ${count} పార్ట్స్ స్టాక్ తక్కువగా ఉంది:`,
  outTitle: () => 'స్టాక్ అయిపోయినవి',
  lowTitle: () => 'తక్కువ స్టాక్',

  whichMachine: () => 'ఏ మెషిన్? ఉదా. “PC200 కి పార్ట్స్” లేదా “3DX parts”.',
  machineNone: ({ model }) =>
    `“${model}” మెషిన్‌కు పార్ట్స్ ఏవీ నమోదు కాలేదు. మెషిన్‌పై రాసినట్లే మోడల్ చెప్పండి, ఉదా. “3DX” లేదా “PC200”.`,
  machineSome: ({ model, branch }) => `${branch}లో ${model} పార్ట్స్:`,
  machineTitle: ({ model }) => `${model} పార్ట్స్`,

  whichCustomer: () => 'ఏ కస్టమర్? కస్టమర్ లేదా కంపెనీ పేరు చెప్పండి.',
  customerNone: ({ name, days }) =>
    `${name} గత ${days} రోజుల్లో ఈ బ్రాంచ్ నుండి ఏ పార్ట్ తీసుకోలేదు.`,
  invoices: ({ count, total }) => ` ${count} బిల్లులు, మొత్తం ₹${total}.`,
  customerSome: ({ name, days, count }) =>
    `గత ${days} రోజుల్లో ${name} ${count} రకాల పార్ట్స్ తీసుకున్నారు.`,
  customerTitle: ({ name, days }) => `${name} — గత ${days} రోజులు`,

  today: ({ branch, out, outCount, in: stockIn, inCount }) =>
    `ఈరోజు ${branch}లో: ${out} యూనిట్లు బయటకు వెళ్లాయి (${outCount} ఎంట్రీలు), ${stockIn} యూనిట్లు లోపలికి వచ్చాయి (${inCount} ఎంట్రీలు).`,
  todaySales: ({ count, value }) => ` ${count} బిల్లులు, అమ్మకాలు ₹${value}.`,
  todayLevels: ({ low, out }) => ` ${low} పార్ట్స్ స్టాక్ తక్కువగా ఉంది, ${out} అయిపోయాయి.`,
  todayIn: ({ branch, qty, count }) =>
    `ఈరోజు ${branch}లో ${qty} యూనిట్ల స్టాక్ వచ్చింది (${count} ఎంట్రీలు).`,
  todayOut: ({ branch, qty, count }) =>
    `ఈరోజు ${branch} నుండి ${qty} యూనిట్ల స్టాక్ బయటకు వెళ్లింది (${count} ఎంట్రీలు).`,
  todayInTitle: () => 'ఈరోజు వచ్చిన స్టాక్',
  todayOutTitle: () => 'ఈరోజు వెళ్లిన స్టాక్',

  soldPart: ({ name, qty, unit, days, branch, entries }) =>
    `గత ${days} రోజుల్లో ${branch} నుండి ${name} ${qty} ${unit} బయటకు వెళ్లాయి (${entries} ఎంట్రీలు).`,
  soldNonePart: ({ name, days, branch }) =>
    `గత ${days} రోజుల్లో ${branch} నుండి ${name} బయటకు వెళ్లలేదు.`,
  topNone: ({ days, branch }) => `గత ${days} రోజుల్లో ${branch} నుండి స్టాక్ ఏదీ బయటకు వెళ్లలేదు.`,
  topSome: ({ days, branch }) => `గత ${days} రోజుల్లో ${branch}లో ఎక్కువగా వెళ్లిన పార్ట్స్:`,
  topTitle: ({ days }) => `ఎక్కువగా అమ్ముడైనవి — ${days} రోజులు`,

  compare: ({ count }) => `మీ ${count} బ్రాంచ్‌ల స్టాక్ పోలిక:`,
  compareTitle: () => 'బ్రాంచ్ పోలిక',
  categoryIntro: ({ branch }) => `${branch}లో కేటగిరీ వారీగా స్టాక్:`,
  categoryTitle: () => 'కేటగిరీ వారీ స్టాక్',
  uncategorised: () => 'కేటగిరీ లేదు',
  transfers: ({ branch, awaiting, incoming }) =>
    `${branch}: ${awaiting} బదిలీలు ఆమోదం కోసం వేచి ఉన్నాయి, ${incoming} దారిలో ఉన్నాయి.`,

  help: () =>
    'నేను ఏ పార్ట్ స్టాక్ అయినా (పేరు, పార్ట్ నంబర్ లేదా మెషిన్ ద్వారా), అది ఏ బ్రాంచ్‌లో ఉందో, ధరలు, ఏమి మళ్లీ ఆర్డర్ చేయాలో, కదలని పార్ట్స్, తక్కువ లేదా అయిపోయిన స్టాక్, ఏమి అమ్ముడైందో, కస్టమర్ ఏమి కొన్నారో, బ్రాంచ్ పోలిక, ఈరోజు లెక్కలు చెప్పగలను. టైప్ చేయండి లేదా మైక్ నొక్కి తెలుగు, హిందీ లేదా ఇంగ్లీష్‌లో మాట్లాడండి.',
  unknown: () =>
    'క్షమించండి, నాకు అర్థం కాలేదు. పార్ట్ స్టాక్ లేదా ధర, రీఆర్డర్, కదలని పార్ట్స్, కస్టమర్ లేదా ఈరోజు లెక్కల గురించి అడగండి.',
  never: () => 'ఎప్పుడూ లేదు',

  colPart: () => 'పార్ట్',
  colStock: () => 'స్టాక్',
  colMin: () => 'కనీసం',
  colUsed: ({ days }) => `${days} రోజుల్లో వాడకం`,
  colOrder: () => 'ఆర్డర్',
  colLastOut: () => 'చివరి అవుట్',
  colValue: () => 'విలువ',
  colQty: () => 'పరిమాణం',
  colLast: () => 'చివరిది',
  colBranch: () => 'బ్రాంచ్',
  colParts: () => 'పార్ట్స్',
  colUnits: () => 'యూనిట్లు',
  colLow: () => 'తక్కువ',
  colOut: () => 'అయిపోయినవి',
  colCategory: () => 'కేటగిరీ',
  colEntries: () => 'ఎంట్రీలు',

  sPrice: ({ name }) => `${name} ధర ఎంత?`,
  sWhere: ({ name }) => `${name} ఏ బ్రాంచ్‌లో ఉంది?`,
  sStock: ({ name }) => `${name} స్టాక్ ఎంత ఉంది?`,
  sSold: () => 'ఈ నెల ఎన్ని అమ్ముడయ్యాయి?',
  sExample: () => 'హైడ్రాలిక్ ఫిల్టర్ స్టాక్ ఎంత ఉంది?',
  sReorder: () => 'ఈ వారం ఏమి ఆర్డర్ చేయాలి?',
  sNonMoving: () => 'రెండు నెలలుగా ఏ పార్ట్స్ అమ్ముడుపోలేదు?',
  sOut: () => 'ఏ పార్ట్స్ స్టాక్ అయిపోయాయి?',
  sLow: () => 'ఏ పార్ట్స్ స్టాక్ తక్కువగా ఉంది?',
  sToday: () => 'ఈరోజు అమ్మకాలు, స్టాక్ ఎంత?',
  sCompare: () => 'అన్ని బ్రాంచ్‌ల స్టాక్ పోల్చండి',
  sTop: () => 'ఈ నెల ఎక్కువగా అమ్ముడైన పార్ట్స్?',
};

export const MESSAGES = { en, hi, te };

/** Returns `t(key, params)` for a language; unknown languages and keys fall back to English. */
export function translator(language) {
  const catalogue = MESSAGES[language] ?? MESSAGES[DEFAULT_LANGUAGE];
  return (key, params = {}) => (catalogue[key] ?? MESSAGES[DEFAULT_LANGUAGE][key])(params);
}
