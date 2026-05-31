#!/usr/bin/env node

import 'dotenv/config';
import { existsSync } from 'fs';
import { extname } from 'path';
import { parseWhatsAppExport } from '../src/style/parser.js';
import { analyzeStyle } from '../src/style/analyzer.js';
import { createStore } from '../src/state/store.js';

/**
 * Main CLI script to import a WhatsApp export, analyze style, and save profile.
 * Usage: node scripts/import-chat.js <path-to-export.txt> <your-name-in-export> [contact-jid]
 */
async function main() {
  const args = process.argv.slice(2);

  // Validate arguments
  if (args.length < 2) {
    console.error('Usage: node scripts/import-chat.js <path-to-export.txt> <your-name-in-export> [contact-jid]');
    process.exit(1);
  }

  const filePath = args[0];
  const myName = args[1];
  const contactJid = args[2] || null;

  // Validate file exists
  if (!existsSync(filePath)) {
    console.error(`Error: File not found: ${filePath}`);
    process.exit(1);
  }

  // Validate file is .txt
  if (extname(filePath).toLowerCase() !== '.txt') {
    console.error(`Error: File must be a .txt file, got: ${extname(filePath)}`);
    process.exit(1);
  }

  // Parse the export
  const parsedExport = parseWhatsAppExport(filePath, myName);

  if (parsedExport.messages.length === 0) {
    console.error('Error: No messages found in export file. Check file format and your name.');
    process.exit(1);
  }

  const { messages, contactName } = parsedExport;
  const myMessages = messages.filter(m => m.isMe);

  // Print summary
  const dateRange = messages.length > 0
    ? `${messages[0].timestamp.toLocaleDateString()} → ${messages[messages.length - 1].timestamp.toLocaleDateString()}`
    : 'N/A';

  console.log(`📊 Parsed ${messages.length} messages from ${contactName}`);
  console.log(`   Your messages: ${myMessages.length}`);
  console.log(`   Date range: ${dateRange}`);

  // Analyze style
  const profile = analyzeStyle(parsedExport);

  // Print profile preview
  const commonPhrasesStr = profile.commonPhrases.slice(0, 5).join(', ') || 'none detected';
  console.log('✅ Style profile generated:');
  console.log(`   Language: ${profile.language}`);
  console.log(`   Avg message length: ${profile.lengthCategory} (~${profile.avgWordCount} words)`);
  console.log(`   Emoji usage: ${profile.emojiFrequency}`);
  console.log(`   Common phrases: ${commonPhrasesStr}`);
  console.log(`   Style notes: ${profile.styleNotes}`);

  // Save profile to store
  const store = createStore();
  const key = contactJid || contactName;
  store.saveProfile(key, profile);

  console.log(`💾 Profile saved for ${contactName}`);
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
