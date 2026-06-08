/**
 * Style Analyzer — TASK-09
 * Analyzes a parsed WhatsApp export and produces a StyleProfile describing
 * how the user communicates with a specific contact.
 */

// ---------------------------------------------------------------------------
// Stopwords
// ---------------------------------------------------------------------------

const STOPWORDS = new Set([
  'i', 'me', 'my', 'myself', 'we', 'our', 'ours', 'ourselves', 'you', 'your',
  'yours', 'yourself', 'yourselves', 'he', 'him', 'his', 'himself', 'she',
  'her', 'hers', 'herself', 'it', 'its', 'itself', 'they', 'them', 'their',
  'theirs', 'themselves', 'what', 'which', 'who', 'whom', 'this', 'that',
  'these', 'those', 'am', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'having', 'do', 'does', 'did', 'doing', 'a', 'an',
  'the', 'and', 'but', 'if', 'or', 'because', 'as', 'until', 'while', 'of',
  'at', 'by', 'for', 'with', 'about', 'against', 'between', 'into', 'through',
  'during', 'before', 'after', 'above', 'below', 'to', 'from', 'up', 'down',
  'in', 'out', 'on', 'off', 'over', 'under', 'again', 'further', 'then',
  'once', 'here', 'there', 'when', 'where', 'why', 'how', 'all', 'both',
  'each', 'few', 'more', 'most', 'other', 'some', 'such', 'no', 'nor', 'not',
  'only', 'own', 'same', 'so', 'than', 'too', 'very', 's', 't', 'can', 'will',
  'just', 'don', 'should', 'now', 'd', 'll', 'm', 'o', 're', 've', 'y', 'ain',
  'aren', 'couldn', 'didn', 'doesn', 'hadn', 'hasn', 'haven', 'isn', 'ma',
  'mightn', 'mustn', 'needn', 'shan', 'shouldn', 'wasn', 'weren', 'won',
  'wouldn', 'yeah', 'ok', 'okay', 'yes', 'no', 'hi', 'hey', 'hm', 'hmm',
  'oh', 'ah', 'uh', 'um', 'like', 'get', 'got', 'go', 'going', 'went',
  'come', 'came', 'also', 'still', 'even', 'much', 'many', 'well', 'know',
  'think', 'see', 'one', 'two', 'would', 'could', 'want', 'need', 'said',
  'say', 'make', 'made', 'let', 'way', 'thing', 'things', 'time', 'day',
]);

// ---------------------------------------------------------------------------
// Unicode helpers
// ---------------------------------------------------------------------------

const TELUGU_RE = /[ఀ-౿]/;
const DEVANAGARI_RE = /[ऀ-ॿ]/;
const NON_ASCII_WORD_RE = /[^\x00-\x7F]/;

/**
 * Returns true if the word contains Telugu characters.
 * @param {string} w
 */
function isTeluguWord(w) {
  return TELUGU_RE.test(w);
}

/**
 * Returns true if the word contains Devanagari (Hindi) characters.
 * @param {string} w
 */
function isDevanagariWord(w) {
  return DEVANAGARI_RE.test(w);
}

/**
 * Returns true if the word contains any non-ASCII character.
 * @param {string} w
 */
function isNonAsciiWord(w) {
  return NON_ASCII_WORD_RE.test(w);
}

// ---------------------------------------------------------------------------
// Emoji helpers
// ---------------------------------------------------------------------------

// Matches a single emoji grapheme cluster (handles skin-tone / ZWJ sequences).
const EMOJI_RE = /\p{Emoji_Presentation}|\p{Extended_Pictographic}/gu;
// Non-global version for .test() — avoids the stateful lastIndex bug with /g flag.
const EMOJI_TEST_RE = /\p{Emoji_Presentation}|\p{Extended_Pictographic}/u;

/**
 * Extract all emoji characters from a string, one per match.
 * Returns an array of individual emoji strings.
 * @param {string} text
 * @returns {string[]}
 */
function extractEmojis(text) {
  return text.match(EMOJI_RE) ?? [];
}

// ---------------------------------------------------------------------------
// Tokenizer
// ---------------------------------------------------------------------------

/**
 * Split text into word tokens (preserves non-ASCII for language detection).
 * Removes punctuation from purely ASCII words, keeps non-ASCII words intact.
 * @param {string} text
 * @returns {string[]}
 */
function tokenize(text) {
  // Split on whitespace, then strip leading/trailing punctuation from ASCII tokens
  return text
    .split(/\s+/)
    .map(t => t.replace(/^[^\wऀ-ॿఀ-౿]+|[^\wऀ-ॿఀ-౿]+$/g, ''))
    .filter(t => t.length > 0);
}

// ---------------------------------------------------------------------------
// Language detection
// ---------------------------------------------------------------------------

/**
 * Detect the primary language mix in a set of word tokens.
 * @param {string[]} allTokens   All word tokens from user messages (lowercase)
 * @returns {{ language: string, detectedNonEnglishWords: string[] }}
 */
function detectLanguage(allTokens) {
  const uniqueWords = [...new Set(allTokens.filter(w => w.length > 1))];

  const teluguWords = uniqueWords.filter(isTeluguWord);
  const devanagariWords = uniqueWords.filter(isDevanagariWord);
  const otherNonAscii = uniqueWords.filter(
    w => isNonAsciiWord(w) && !isTeluguWord(w) && !isDevanagariWord(w),
  );

  const nonEnglishWords = [...teluguWords, ...devanagariWords, ...otherNonAscii];
  const nonEnglishRatio = uniqueWords.length > 0
    ? nonEnglishWords.length / uniqueWords.length
    : 0;

  const hasTelugu = teluguWords.length > 0;
  const hasDevanagari = devanagariWords.length > 0;
  const hasOtherNonAscii = otherNonAscii.length > 0;

  let language;
  if (nonEnglishRatio < 0.05) {
    language = 'English';
  } else if (hasTelugu && hasDevanagari) {
    language = 'English-Telugu-Hindi mix';
  } else if (hasTelugu && nonEnglishRatio >= 0.5) {
    language = 'Telugu';
  } else if (hasTelugu) {
    language = 'English-Telugu mix';
  } else if (hasDevanagari && nonEnglishRatio >= 0.5) {
    language = 'Hindi';
  } else if (hasDevanagari) {
    language = 'English-Hindi mix';
  } else if (hasOtherNonAscii) {
    language = 'English with non-Latin script';
  } else {
    language = 'English';
  }

  return {
    language,
    detectedNonEnglishWords: nonEnglishWords.slice(0, 20),
  };
}

// ---------------------------------------------------------------------------
// ALL CAPS frequency
// ---------------------------------------------------------------------------

/**
 * Classify how often the user uses ALL-CAPS words (3+ chars).
 * @param {string[][]} tokenizedMessages  Array of token arrays per message
 * @param {number} totalMessages
 * @returns {'none' | 'occasional' | 'frequent'}
 */
function computeCapsFrequency(tokenizedMessages, totalMessages) {
  if (totalMessages === 0) return 'none';

  let capsWordCount = 0;
  let totalWords = 0;

  for (const tokens of tokenizedMessages) {
    for (const t of tokens) {
      if (/^[A-Z]/.test(t)) {
        totalWords++;
        if (t.length >= 3 && t === t.toUpperCase() && /[A-Z]{3}/.test(t)) {
          capsWordCount++;
        }
      } else if (/[a-z]/.test(t)) {
        totalWords++;
      }
    }
  }

  if (totalWords === 0) return 'none';
  const ratio = capsWordCount / totalWords;
  if (ratio >= 0.05) return 'frequent';
  if (ratio >= 0.01) return 'occasional';
  return 'none';
}

// ---------------------------------------------------------------------------
// Common phrases (unigrams + bigrams)
// ---------------------------------------------------------------------------

/**
 * Compute the top N most-frequent unigrams and bigrams from tokenized messages,
 * after removing stopwords.
 * @param {string[][]} tokenizedMessages
 * @param {number} topN
 * @returns {string[]}
 */
function computeCommonPhrases(tokenizedMessages, topN = 15) {
  /** @type {Map<string, number>} */
  const freq = new Map();

  for (const tokens of tokenizedMessages) {
    const filtered = tokens
      .map(t => t.toLowerCase())
      .filter(t => t.length > 1 && !STOPWORDS.has(t) && /[a-zA-Zऀ-ॿఀ-౿]/.test(t));

    // Unigrams
    for (const t of filtered) {
      freq.set(t, (freq.get(t) ?? 0) + 1);
    }

    // Bigrams
    for (let i = 0; i < filtered.length - 1; i++) {
      const bigram = `${filtered[i]} ${filtered[i + 1]}`;
      freq.set(bigram, (freq.get(bigram) ?? 0) + 1);
    }
  }

  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([phrase]) => phrase);
}

// ---------------------------------------------------------------------------
// Average messages per exchange
// ---------------------------------------------------------------------------

/**
 * Estimate how many messages the user sends before the contact replies.
 * An "exchange" is a consecutive run of user messages.
 * @param {Array<{isMe: boolean}>} messages  All messages (not just user's)
 * @returns {number}
 */
function computeAvgMessagesPerExchange(messages) {
  if (messages.length === 0) return 0;

  const runs = [];
  let currentRun = 0;

  for (const msg of messages) {
    if (msg.isMe) {
      currentRun++;
    } else {
      if (currentRun > 0) {
        runs.push(currentRun);
        currentRun = 0;
      }
    }
  }
  if (currentRun > 0) runs.push(currentRun);

  if (runs.length === 0) return 0;
  const total = runs.reduce((sum, n) => sum + n, 0);
  return Math.round((total / runs.length) * 10) / 10;
}

// ---------------------------------------------------------------------------
// Style notes generator
// ---------------------------------------------------------------------------

/**
 * Generate a concise human-readable summary of the style profile for the LLM.
 * @param {object} profile  Partially-built StyleProfile
 * @returns {string}
 */
function generateStyleNotes(profile) {
  const parts = [];

  // Length
  const lengthMap = {
    'very short': `very short messages (avg ${profile.avgWordCount} words)`,
    short: `short messages (avg ${profile.avgWordCount} words)`,
    medium: `medium-length messages (avg ${profile.avgWordCount} words)`,
    long: `long messages (avg ${profile.avgWordCount} words)`,
  };
  parts.push(`Writes in ${lengthMap[profile.lengthCategory] ?? 'messages'}`);

  // Language
  if (profile.language !== 'English') {
    parts.push(`mixes ${profile.language} naturally`);
  }

  // Emoji
  if (profile.emojiFrequency === 'frequent') {
    parts.push('uses emojis frequently');
  } else if (profile.emojiFrequency === 'occasional') {
    parts.push('uses emojis occasionally');
  }

  // Tone
  const toneDetails = [];
  if (profile.usesQuestionMarks) toneDetails.push('asks questions often');
  if (profile.usesExclamations) toneDetails.push('uses exclamations');
  if (profile.usesEllipsis) toneDetails.push('trails off with ellipsis');
  if (profile.capsFrequency === 'frequent') toneDetails.push('capitalises words for emphasis');
  if (toneDetails.length > 0) parts.push(toneDetails.join(', '));

  // If very few details, add generic tone descriptor
  if (parts.length < 2) parts.push('casual and direct tone');

  return parts.join('. ') + '.';
}

// ---------------------------------------------------------------------------
// Capitalization style
// ---------------------------------------------------------------------------

function detectCapitalizationStyle(myMessages) {
  if (myMessages.length === 0) return 'unknown';
  const lowercaseStarts = myMessages.filter(m => {
    const first = m.text.trim()[0];
    return first && first === first.toLowerCase() && /[a-z]/.test(first);
  }).length;
  const ratio = lowercaseStarts / myMessages.length;
  if (ratio >= 0.65) return 'mostly lowercase';
  if (ratio >= 0.35) return 'mixed case';
  return 'normally capitalized';
}

// ---------------------------------------------------------------------------
// Punctuation style
// ---------------------------------------------------------------------------

function detectPunctuationStyle(myMessages) {
  if (myMessages.length === 0) return 'unknown';
  const noPunct = myMessages.filter(m => {
    const text = m.text.trim();
    if (!text) return false;
    const last = text[text.length - 1];
    return !/[.?!…]/.test(last) && !EMOJI_TEST_RE.test(last);
  }).length;
  const ratio = noPunct / myMessages.length;
  if (ratio >= 0.65) return 'rarely uses end punctuation';
  if (ratio >= 0.35) return 'sometimes omits end punctuation';
  return 'normally punctuated';
}

// ---------------------------------------------------------------------------
// Abbreviation / informal word detection
// ---------------------------------------------------------------------------

const KNOWN_ABBREVIATIONS = [
  'u', 'ur', 'r', 'k', 'ya', 'yep', 'nope', 'bro', 'da', 'ra', 'na', 'le',
  'lol', 'lmao', 'lmfao', 'haha', 'hehe', 'omg', 'wtf', 'smh',
  'btw', 'tbh', 'ngl', 'idk', 'idc', 'imo', 'nvm', 'ikr',
  'ty', 'np', 'rn', 'tmr', 'tmrw', 'pls', 'plz', 'tho', 'tfw',
  'msg', 'dm', 'gg', 'fr', 'frfr',
];

function detectAbbreviations(tokenizedMessages) {
  const counts = new Map();
  for (const tokens of tokenizedMessages) {
    for (const t of tokens) {
      const lower = t.toLowerCase();
      if (KNOWN_ABBREVIATIONS.includes(lower)) {
        counts.set(lower, (counts.get(lower) ?? 0) + 1);
      }
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([abbr]) => abbr);
}

// ---------------------------------------------------------------------------
// Sample messages (representative short examples of the user's actual writing)
// ---------------------------------------------------------------------------

function getSampleMessages(myMessages, count = 6) {
  const candidates = myMessages.filter(m => {
    const words = m.text.trim().split(/\s+/).length;
    return words >= 1 && words <= 15 && m.text.trim().length > 1;
  });
  if (candidates.length === 0) return [];
  const step = Math.max(1, Math.floor(candidates.length / count));
  const samples = [];
  for (let i = 0; i < count && i * step < candidates.length; i++) {
    samples.push(candidates[i * step].text.trim());
  }
  return samples;
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Analyse a parsed WhatsApp export and return a StyleProfile.
 *
 * @param {{ messages: Array<{timestamp:Date, sender:string, text:string, isMe:boolean}>, contactName: string, myName: string }} parsedExport
 * @returns {object} StyleProfile
 */
export function analyzeStyle(parsedExport) {
  const { messages = [], contactName = '', myName = '' } = parsedExport ?? {};

  const myMessages = messages.filter(m => m.isMe);
  const sampleSize = myMessages.length;

  if (sampleSize < 10) {
    return {
      contactName, sampleSize,
      avgWordCount: 0, lengthCategory: 'unknown', language: 'unknown',
      detectedNonEnglishWords: [], usesQuestionMarks: false, usesExclamations: false,
      usesEllipsis: false, capsFrequency: 'none', emojiFrequency: 'none',
      commonEmojis: [], commonPhrases: [], avgMessagesPerExchange: 0,
      capitalizationStyle: 'unknown', punctuationStyle: 'unknown',
      abbreviations: [], sampleMessages: [],
      styleNotes: 'Insufficient data (fewer than 10 messages). Style analysis is unreliable.',
    };
  }

  // ------------------------------------------------------------------
  // Tokenize all user messages
  // ------------------------------------------------------------------
  const tokenizedMessages = myMessages.map(m => tokenize(m.text));

  // ------------------------------------------------------------------
  // 1. Message length
  // ------------------------------------------------------------------
  const wordCounts = tokenizedMessages.map(t => t.length);
  const totalWords = wordCounts.reduce((s, n) => s + n, 0);
  const avgWordCount = Math.round((totalWords / sampleSize) * 10) / 10;

  let lengthCategory;
  if (avgWordCount < 5) lengthCategory = 'very short';
  else if (avgWordCount <= 15) lengthCategory = 'short';
  else if (avgWordCount <= 30) lengthCategory = 'medium';
  else lengthCategory = 'long';

  // ------------------------------------------------------------------
  // 2. Language detection
  // ------------------------------------------------------------------
  const allTokens = tokenizedMessages.flat();
  const { language, detectedNonEnglishWords } = detectLanguage(allTokens);

  // ------------------------------------------------------------------
  // 3. Tone markers
  // ------------------------------------------------------------------
  let questionCount = 0;
  let exclamationCount = 0;
  let ellipsisCount = 0;

  for (const m of myMessages) {
    if (m.text.includes('?')) questionCount++;
    if (m.text.includes('!')) exclamationCount++;
    if (m.text.includes('...')) ellipsisCount++;
  }

  const usesQuestionMarks = questionCount / sampleSize > 0.20;
  const usesExclamations = exclamationCount / sampleSize > 0.15;
  const usesEllipsis = ellipsisCount / sampleSize > 0.10;
  const capsFrequency = computeCapsFrequency(tokenizedMessages, sampleSize);

  // ------------------------------------------------------------------
  // 4. Emoji analysis
  // ------------------------------------------------------------------
  /** @type {Map<string, number>} */
  const emojiFreqMap = new Map();
  let messagesWithEmoji = 0;

  for (const m of myMessages) {
    const emojis = extractEmojis(m.text);
    if (emojis.length > 0) {
      messagesWithEmoji++;
      for (const e of emojis) {
        emojiFreqMap.set(e, (emojiFreqMap.get(e) ?? 0) + 1);
      }
    }
  }

  const emojiRatio = messagesWithEmoji / sampleSize;
  let emojiFrequency;
  if (emojiRatio >= 0.4) emojiFrequency = 'frequent';
  else if (emojiRatio >= 0.1) emojiFrequency = 'occasional';
  else emojiFrequency = 'none';

  const commonEmojis = [...emojiFreqMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([emoji]) => emoji);

  // ------------------------------------------------------------------
  // 5. Common phrases
  // ------------------------------------------------------------------
  const commonPhrases = computeCommonPhrases(tokenizedMessages, 15);

  // ------------------------------------------------------------------
  // 6. Avg messages per exchange
  // ------------------------------------------------------------------
  const avgMessagesPerExchange = computeAvgMessagesPerExchange(messages);

  // ------------------------------------------------------------------
  // 7. Capitalization & punctuation style
  // ------------------------------------------------------------------
  const capitalizationStyle = detectCapitalizationStyle(myMessages);
  const punctuationStyle = detectPunctuationStyle(myMessages);

  // ------------------------------------------------------------------
  // 8. Abbreviations & sample messages
  // ------------------------------------------------------------------
  const abbreviations = detectAbbreviations(tokenizedMessages);
  const sampleMessages = getSampleMessages(myMessages, 6);

  // ------------------------------------------------------------------
  // 9. Style notes
  // ------------------------------------------------------------------
  const partialProfile = {
    avgWordCount,
    lengthCategory,
    language,
    emojiFrequency,
    usesQuestionMarks,
    usesExclamations,
    usesEllipsis,
    capsFrequency,
  };
  const styleNotes = generateStyleNotes(partialProfile);

  // ------------------------------------------------------------------
  // Assemble and return
  // ------------------------------------------------------------------
  return {
    contactName, sampleSize,
    avgWordCount, lengthCategory,
    language, detectedNonEnglishWords,
    usesQuestionMarks, usesExclamations, usesEllipsis, capsFrequency,
    emojiFrequency, commonEmojis,
    commonPhrases,
    avgMessagesPerExchange,
    capitalizationStyle, punctuationStyle,
    abbreviations, sampleMessages,
    styleNotes,
  };
}
