import { readFileSync } from 'fs';

/**
 * Regex to match WhatsApp message start lines.
 * Handles formats:
 *   [DD/MM/YYYY, HH:MM:SS] Sender: text
 *   [M/D/YY, H:MM AM/PM] Sender: text
 *   DD/MM/YYYY, HH:MM - Sender: text  (some Android exports use dash instead of brackets)
 */
const MESSAGE_LINE_RE = /^\[?(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}),?\s+(\d{1,2}:\d{2}(?::\d{2})?(?:\s?[AP]M)?)\]?\s*-?\s*([^:]+):\s(.+)/i;

/** Texts that should be filtered from the message list. */
const FILTERED_TEXTS = new Set([
  '<media omitted>',
  'this message was deleted',
  'null',
  'image omitted',
  'video omitted',
  'audio omitted',
  'document omitted',
  'sticker omitted',
  'gif omitted',
  'contact card omitted',
]);

/**
 * Try to parse a date string given a date part and time part.
 * Attempts DD/MM/YYYY first, then MM/DD/YYYY.
 *
 * @param {string} datePart  e.g. "31/05/2026" or "5/31/26"
 * @param {string} timePart  e.g. "14:30:00" or "2:30 PM"
 * @returns {Date}
 */
function parseTimestamp(datePart, timePart) {
  const sep = datePart.match(/[\/\-.]/)?.[0] ?? '/';
  const parts = datePart.split(sep);
  if (parts.length !== 3) return new Date(NaN);

  const [a, b, rawYear] = parts;
  const year = rawYear.length === 2 ? 2000 + parseInt(rawYear, 10) : parseInt(rawYear, 10);
  const aNum = parseInt(a, 10);
  const bNum = parseInt(b, 10);

  // Normalise time part (handle AM/PM)
  const timeNorm = timePart.trim().toUpperCase();
  let hours, minutes, seconds = 0;

  const ampmMatch = timeNorm.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s?(AM|PM)$/);
  const h24Match = timeNorm.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);

  if (ampmMatch) {
    hours = parseInt(ampmMatch[1], 10);
    minutes = parseInt(ampmMatch[2], 10);
    seconds = ampmMatch[3] ? parseInt(ampmMatch[3], 10) : 0;
    if (ampmMatch[4] === 'PM' && hours !== 12) hours += 12;
    if (ampmMatch[4] === 'AM' && hours === 12) hours = 0;
  } else if (h24Match) {
    hours = parseInt(h24Match[1], 10);
    minutes = parseInt(h24Match[2], 10);
    seconds = h24Match[3] ? parseInt(h24Match[3], 10) : 0;
  } else {
    return new Date(NaN);
  }

  // Try DD/MM/YYYY (a=day, b=month)
  if (aNum >= 1 && aNum <= 31 && bNum >= 1 && bNum <= 12) {
    const d = new Date(year, bNum - 1, aNum, hours, minutes, seconds);
    if (!isNaN(d.getTime())) return d;
  }

  // Fallback: MM/DD/YYYY (a=month, b=day)
  if (aNum >= 1 && aNum <= 12 && bNum >= 1 && bNum <= 31) {
    const d = new Date(year, aNum - 1, bNum, hours, minutes, seconds);
    if (!isNaN(d.getTime())) return d;
  }

  return new Date(NaN);
}

/**
 * Determine whether a message text should be filtered out.
 *
 * @param {string} text
 * @returns {boolean}
 */
function shouldFilter(text) {
  return FILTERED_TEXTS.has(text.trim().toLowerCase());
}

/**
 * Parse a WhatsApp chat export .txt file.
 *
 * @param {string} filePath  Absolute (or relative) path to the exported .txt file.
 * @param {string} myName    The name you appear as in the export (e.g. "Bhargav").
 * @returns {{ messages: Array<{timestamp:Date, sender:string, text:string, isMe:boolean}>, contactName: string, myName: string }}
 */
export function parseWhatsAppExport(filePath, myName) {
  const empty = { messages: [], contactName: '', myName };

  let raw;
  try {
    raw = readFileSync(filePath, 'utf8');
  } catch {
    return empty;
  }

  if (!raw) return empty;

  // Strip UTF-8 BOM if present
  const content = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;

  const lines = content.split(/\r?\n/);

  /** @type {Array<{timestamp:Date, sender:string, text:string, isMe:boolean}>} */
  const messages = [];

  /** The message currently being built (may span multiple lines). */
  let current = null;

  for (const line of lines) {
    const match = line.match(MESSAGE_LINE_RE);

    if (match) {
      // Flush the previous message before starting a new one
      if (current !== null) {
        if (!shouldFilter(current.text)) {
          messages.push(current);
        }
        current = null;
      }

      const [, datePart, timePart, sender, text] = match;
      const timestamp = parseTimestamp(datePart, timePart);
      const senderTrimmed = sender.trim();

      // System messages have no real sender colon — but the regex requires one,
      // so those are already excluded. Nothing more to do here.
      current = {
        timestamp,
        sender: senderTrimmed,
        text: text.trim(),
        isMe: senderTrimmed === myName,
      };
    } else {
      // Continuation line — append to current message
      if (current !== null && line.trim() !== '') {
        current.text += '\n' + line;
      }
    }
  }

  // Flush the last message
  if (current !== null && !shouldFilter(current.text)) {
    messages.push(current);
  }

  // Determine contactName: most frequent non-myName sender
  /** @type {Map<string, number>} */
  const senderCounts = new Map();
  for (const msg of messages) {
    if (msg.sender !== myName) {
      senderCounts.set(msg.sender, (senderCounts.get(msg.sender) ?? 0) + 1);
    }
  }

  let contactName = '';
  let maxCount = 0;
  for (const [sender, count] of senderCounts) {
    if (count > maxCount) {
      maxCount = count;
      contactName = sender;
    }
  }

  return { messages, contactName, myName };
}
