# TASK-09 — Style Analyzer
**Recommended model:** Sonnet  
**Dependencies:** TASK-08 (chat export parser)

---

## Goal
Take the parsed messages from a WhatsApp export and extract a style profile that describes how the user communicates with this specific contact. This profile will be injected into the LLM system prompt to generate authentic replies.

## File to Create: `src/style/analyzer.js`

## Interface This Module Must Export

```js
export function analyzeStyle(parsedExport)
// parsedExport: return value of parseWhatsAppExport() from TASK-08
// Returns: StyleProfile object
```

## StyleProfile Schema

```js
{
  contactName: string,         // who this profile is for
  sampleSize: number,          // how many of YOUR messages were analyzed

  // Message length
  avgWordCount: number,        // average words per message
  lengthCategory: string,      // 'very short' | 'short' | 'medium' | 'long'
  // very short: <5 words, short: 5-15, medium: 15-30, long: >30

  // Language
  language: string,            // 'English' | 'Telugu' | 'Hindi' | 'English-Telugu mix' | etc.
  detectedNonEnglishWords: string[],  // up to 20 sample non-English words found

  // Tone markers
  usesQuestionMarks: boolean,
  usesExclamations: boolean,
  usesEllipsis: boolean,       // "..." usage
  capsFrequency: string,       // 'none' | 'occasional' | 'frequent' (ALL CAPS words)

  // Emoji
  emojiFrequency: string,      // 'none' | 'occasional' | 'frequent'
  commonEmojis: string[],      // top 5 emojis used

  // Vocabulary
  commonPhrases: string[],     // top 10-15 phrases/words (excluding stopwords)
  avgMessagesPerExchange: number,  // how many messages user sends per "turn"

  // Style notes (generated summary string for LLM)
  styleNotes: string,
}
```

## Analysis Steps

### 1. Filter to user's messages only
```js
const myMessages = parsedExport.messages.filter(m => m.isMe)
```

### 2. Message length
- Compute average word count across all user messages
- Assign `lengthCategory` based on thresholds

### 3. Language detection
- Count words that are not in a basic English stopword list and not common English words
- If >10% of unique words appear to be non-ASCII or match Telugu/Hindi character ranges (Unicode ranges: Telugu U+0C00–U+0C7F, Devanagari U+0900–U+097F), flag the language mix
- Collect sample non-English words

### 4. Tone markers
- Count `?` usage: if >20% of messages have a `?` → `usesQuestionMarks: true`
- Count `!` usage: if >15% → `usesExclamations: true`
- Count `...` usage: if >10% → `usesEllipsis: true`
- ALL CAPS words: count words that are 3+ chars and all uppercase

### 5. Emoji analysis
- Use a simple regex to detect emoji characters: `/\p{Emoji}/gu`
- Count messages with at least one emoji
- If >40% of messages have emoji → 'frequent', 10-40% → 'occasional', <10% → 'none'
- Find top 5 by frequency

### 6. Common phrases
- Tokenize all messages, lowercase, remove stopwords
- Count unigrams and bigrams
- Return top 15 by frequency

### 7. Style notes string (for LLM system prompt)
Generate a human-readable summary:
```
"Writes in short bursts (avg 8 words). Mixes English with Telugu naturally. 
Uses emojis occasionally. Rarely uses punctuation. Casual and direct tone."
```

## Acceptance Criteria
- Correctly identifies language mixing (especially English + Telugu)
- `lengthCategory` matches actual message lengths
- `commonEmojis` is populated only when emojis are present
- `styleNotes` is a coherent English sentence (not a list of raw stats)
- Handles edge case: <10 user messages → returns profile with `sampleSize` noted as low, marks all fields as uncertain
- Does not crash on empty message arrays
