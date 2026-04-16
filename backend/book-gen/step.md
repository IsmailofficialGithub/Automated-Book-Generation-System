# Book Generation System — Full Build Guide (Node.js)

> **Stack:** Node.js (ESM) · Supabase · Anthropic Claude API · BullMQ · Redis · Google Sheets API · Nodemailer · docx · pdf-lib · Fastify · Zod · Pino · Vitest

---

## Table of Contents

1. [Project Setup](#1-project-setup)
2. [Environment Config](#2-environment-config)
3. [Supabase Database Schema](#3-supabase-database-schema)
4. [Database Layer](#4-database-layer)
5. [Core — State Machine](#5-core--state-machine)
6. [Core — LLM Service](#6-core--llm-service)
7. [Core — Prompt Templates](#7-core--prompt-templates)
8. [Core — Context Builder](#8-core--context-builder)
9. [Services — Sheets Reader](#9-services--sheets-reader)
10. [Services — Notification Service](#10-services--notification-service)
11. [Services — File Exporter](#11-services--file-exporter)
12. [Workers — Outline Worker](#12-workers--outline-worker)
13. [Workers — Chapter Worker](#13-workers--chapter-worker)
14. [Workers — Compile Worker](#14-workers--compile-worker)
15. [API — Webhook Server](#15-api--webhook-server)
16. [Entry Point](#16-entry-point)
17. [Docker Setup](#17-docker-setup)
18. [Tests](#18-tests)
19. [File Tree Reference](#19-file-tree-reference)

---

## 1. Project Setup

### Task 1.1 — Initialize the project

Run the following commands in your terminal:

```bash
mkdir book-gen
cd book-gen
npm init -y
```

### Task 1.2 — Set module type to ESM

Open `package.json` and add `"type": "module"` and update scripts:

```json
{
  "name": "book-gen",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "start": "node src/index.js",
    "dev": "node --watch src/index.js",
    "test": "vitest run",
    "test:watch": "vitest"
  }
}
```

### Task 1.3 — Install all dependencies

```bash
npm install @anthropic-ai/sdk @supabase/supabase-js bullmq dotenv fastify googleapis handlebars ioredis nodemailer pino pino-pretty zod docx pdf-lib

npm install --save-dev vitest
```

### Task 1.4 — Create the folder structure

```bash
mkdir -p src/core/prompts
mkdir -p src/services
mkdir -p src/db/migrations
mkdir -p src/workers
mkdir -p src/api
mkdir -p src/config
mkdir -p tests
```

---

## 2. Environment Config

### Task 2.1 — Create `.env` file in the project root

```env
# Supabase
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# Anthropic
ANTHROPIC_API_KEY=sk-ant-...

# Redis (local dev)
REDIS_HOST=localhost
REDIS_PORT=6379

# Google Sheets
GOOGLE_SERVICE_ACCOUNT_EMAIL=your-sa@project.iam.gserviceaccount.com
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"
GOOGLE_SPREADSHEET_ID=your-spreadsheet-id

# Notifications — Email
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=you@gmail.com
SMTP_PASS=your-app-password
NOTIFY_EMAIL=editor@yourcompany.com

# Notifications — MS Teams
TEAMS_WEBHOOK_URL=https://outlook.office.com/webhook/...

# App
NODE_ENV=development
PORT=3000
POLL_INTERVAL_MS=15000
```

### Task 2.2 — Create `src/config/env.js`

This file validates all environment variables at startup using Zod. If anything is missing, the app crashes immediately with a clear message.

```javascript
// src/config/env.js
import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const schema = z.object({
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  ANTHROPIC_API_KEY: z.string().min(1),
  REDIS_HOST: z.string().default('localhost'),
  REDIS_PORT: z.coerce.number().default(6379),
  GOOGLE_SERVICE_ACCOUNT_EMAIL: z.string().email(),
  GOOGLE_PRIVATE_KEY: z.string().min(1),
  GOOGLE_SPREADSHEET_ID: z.string().min(1),
  SMTP_HOST: z.string().min(1),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_USER: z.string().min(1),
  SMTP_PASS: z.string().min(1),
  NOTIFY_EMAIL: z.string().email(),
  TEAMS_WEBHOOK_URL: z.string().url().optional(),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3000),
  POLL_INTERVAL_MS: z.coerce.number().default(15000),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Invalid environment variables:');
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
```

---

## 3. Supabase Database Schema

### Task 3.1 — Create migration file `src/db/migrations/001_initial.sql`

Copy this SQL and run it in the Supabase SQL editor (Dashboard → SQL Editor → New Query):

```sql
-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ─────────────────────────────────────────
-- BOOKS table — one row per book project
-- ─────────────────────────────────────────
CREATE TABLE books (
  id                          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title                       TEXT NOT NULL,
  notes_on_outline_before     TEXT,                  -- editor notes BEFORE outline is generated
  outline                     TEXT,                  -- LLM-generated outline (latest version)
  notes_on_outline_after      TEXT,                  -- editor notes AFTER seeing outline
  status_outline_notes        TEXT DEFAULT 'no'      -- 'yes' | 'no' | 'no_notes_needed'
                              CHECK (status_outline_notes IN ('yes', 'no', 'no_notes_needed')),
  final_review_notes_status   TEXT DEFAULT 'no'
                              CHECK (final_review_notes_status IN ('yes', 'no', 'no_notes_needed')),
  final_review_notes          TEXT,
  book_output_status          TEXT DEFAULT 'pending'
                              CHECK (book_output_status IN ('pending', 'compiling', 'done', 'error')),
  output_url_docx             TEXT,
  output_url_pdf              TEXT,
  output_url_txt              TEXT,
  created_at                  TIMESTAMPTZ DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────
-- CHAPTERS table — one row per chapter
-- ─────────────────────────────────────────
CREATE TABLE chapters (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  book_id               UUID NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  chapter_number        INTEGER NOT NULL,
  title                 TEXT,
  content               TEXT,
  summary               TEXT,                   -- 150-word LLM summary for context chaining
  chapter_notes         TEXT,                   -- editor notes for this chapter
  chapter_notes_status  TEXT DEFAULT 'no'
                        CHECK (chapter_notes_status IN ('yes', 'no', 'no_notes_needed')),
  status                TEXT DEFAULT 'pending'
                        CHECK (status IN ('pending', 'draft', 'approved', 'error')),
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(book_id, chapter_number)
);

-- ─────────────────────────────────────────
-- OUTLINE_DRAFTS — version history of outlines
-- ─────────────────────────────────────────
CREATE TABLE outline_drafts (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  book_id     UUID NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  version     INTEGER NOT NULL,
  content     TEXT NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────
-- NOTES_LOG — append-only audit log
-- ─────────────────────────────────────────
CREATE TABLE notes_log (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  book_id     UUID NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  chapter_id  UUID REFERENCES chapters(id) ON DELETE SET NULL,
  stage       TEXT NOT NULL,  -- 'outline_before' | 'outline_after' | 'chapter' | 'final'
  note_text   TEXT NOT NULL,
  added_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────
-- Auto-update updated_at on books and chapters
-- ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER books_updated_at
  BEFORE UPDATE ON books
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER chapters_updated_at
  BEFORE UPDATE ON chapters
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ─────────────────────────────────────────
-- Indexes
-- ─────────────────────────────────────────
CREATE INDEX idx_chapters_book_id ON chapters(book_id);
CREATE INDEX idx_chapters_status ON chapters(status);
CREATE INDEX idx_notes_log_book_id ON notes_log(book_id);
CREATE INDEX idx_outline_drafts_book_id ON outline_drafts(book_id);
```

### Task 3.2 — Enable Supabase Storage bucket

Run this in the Supabase SQL editor:

```sql
-- Creates a public storage bucket for final output files
INSERT INTO storage.buckets (id, name, public)
VALUES ('book-outputs', 'book-outputs', true);
```

---

## 4. Database Layer

### Task 4.1 — Create `src/db/supabaseClient.js`

Single shared Supabase client instance used across the whole app.

```javascript
// src/db/supabaseClient.js
import { createClient } from '@supabase/supabase-js';
import { env } from '../config/env.js';

export const supabase = createClient(
  env.SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: { persistSession: false },
  }
);
```

### Task 4.2 — Create `src/db/booksRepo.js`

Add these functions. Each function has a single responsibility.

```javascript
// src/db/booksRepo.js
import { supabase } from './supabaseClient.js';

/**
 * Fetch a single book by ID.
 * @param {string} bookId
 * @returns {Promise<object>} book row
 */
export async function getBookById(bookId) {
  const { data, error } = await supabase
    .from('books')
    .select('*')
    .eq('id', bookId)
    .single();
  if (error) throw new Error(`getBookById failed: ${error.message}`);
  return data;
}

/**
 * Fetch all books where outline generation should start.
 * Condition: notes_on_outline_before is set AND outline is null.
 * @returns {Promise<object[]>}
 */
export async function getBooksReadyForOutline() {
  const { data, error } = await supabase
    .from('books')
    .select('*')
    .not('notes_on_outline_before', 'is', null)
    .is('outline', null);
  if (error) throw new Error(`getBooksReadyForOutline failed: ${error.message}`);
  return data ?? [];
}

/**
 * Fetch all books where outline is done and status allows proceeding.
 * @returns {Promise<object[]>}
 */
export async function getBooksReadyForChapters() {
  const { data, error } = await supabase
    .from('books')
    .select('*')
    .not('outline', 'is', null)
    .eq('status_outline_notes', 'no_notes_needed');
  if (error) throw new Error(`getBooksReadyForChapters failed: ${error.message}`);
  return data ?? [];
}

/**
 * Save the generated outline to a book row and save a draft version.
 * @param {string} bookId
 * @param {string} outline
 * @param {number} version
 */
export async function saveOutline(bookId, outline, version) {
  const { error: bookErr } = await supabase
    .from('books')
    .update({ outline })
    .eq('id', bookId);
  if (bookErr) throw new Error(`saveOutline (books) failed: ${bookErr.message}`);

  const { error: draftErr } = await supabase
    .from('outline_drafts')
    .insert({ book_id: bookId, version, content: outline });
  if (draftErr) throw new Error(`saveOutline (drafts) failed: ${draftErr.message}`);
}

/**
 * Update a book's outline notes status.
 * @param {string} bookId
 * @param {'yes'|'no'|'no_notes_needed'} status
 */
export async function updateOutlineStatus(bookId, status) {
  const { error } = await supabase
    .from('books')
    .update({ status_outline_notes: status })
    .eq('id', bookId);
  if (error) throw new Error(`updateOutlineStatus failed: ${error.message}`);
}

/**
 * Update final review notes status.
 * @param {string} bookId
 * @param {'yes'|'no'|'no_notes_needed'} status
 */
export async function updateFinalReviewStatus(bookId, status) {
  const { error } = await supabase
    .from('books')
    .update({ final_review_notes_status: status })
    .eq('id', bookId);
  if (error) throw new Error(`updateFinalReviewStatus failed: ${error.message}`);
}

/**
 * Save output file URLs to the book row.
 * @param {string} bookId
 * @param {{ docx?: string, pdf?: string, txt?: string }} urls
 */
export async function saveOutputUrls(bookId, urls) {
  const { error } = await supabase
    .from('books')
    .update({
      output_url_docx: urls.docx ?? null,
      output_url_pdf: urls.pdf ?? null,
      output_url_txt: urls.txt ?? null,
      book_output_status: 'done',
    })
    .eq('id', bookId);
  if (error) throw new Error(`saveOutputUrls failed: ${error.message}`);
}

/**
 * Append an entry to the notes_log table.
 * @param {string} bookId
 * @param {string} stage
 * @param {string} noteText
 * @param {string|null} chapterId
 */
export async function logNote(bookId, stage, noteText, chapterId = null) {
  const { error } = await supabase
    .from('notes_log')
    .insert({ book_id: bookId, chapter_id: chapterId, stage, note_text: noteText });
  if (error) throw new Error(`logNote failed: ${error.message}`);
}
```

### Task 4.3 — Create `src/db/chaptersRepo.js`

```javascript
// src/db/chaptersRepo.js
import { supabase } from './supabaseClient.js';

/**
 * Get all chapters for a book, ordered by chapter_number ascending.
 * @param {string} bookId
 * @returns {Promise<object[]>}
 */
export async function getChaptersByBookId(bookId) {
  const { data, error } = await supabase
    .from('chapters')
    .select('*')
    .eq('book_id', bookId)
    .order('chapter_number', { ascending: true });
  if (error) throw new Error(`getChaptersByBookId failed: ${error.message}`);
  return data ?? [];
}

/**
 * Get all approved chapters before a given chapter number (for context chaining).
 * @param {string} bookId
 * @param {number} beforeChapterNumber
 * @returns {Promise<object[]>}
 */
export async function getPreviousChapterSummaries(bookId, beforeChapterNumber) {
  const { data, error } = await supabase
    .from('chapters')
    .select('chapter_number, title, summary')
    .eq('book_id', bookId)
    .eq('status', 'approved')
    .lt('chapter_number', beforeChapterNumber)
    .order('chapter_number', { ascending: true });
  if (error) throw new Error(`getPreviousChapterSummaries failed: ${error.message}`);
  return data ?? [];
}

/**
 * Create a new chapter record (pending state).
 * @param {string} bookId
 * @param {number} chapterNumber
 * @param {string} title
 * @returns {Promise<object>} created chapter row
 */
export async function createChapter(bookId, chapterNumber, title) {
  const { data, error } = await supabase
    .from('chapters')
    .insert({
      book_id: bookId,
      chapter_number: chapterNumber,
      title,
      status: 'pending',
      chapter_notes_status: 'no',
    })
    .select()
    .single();
  if (error) throw new Error(`createChapter failed: ${error.message}`);
  return data;
}

/**
 * Save generated content and auto-summary for a chapter.
 * @param {string} chapterId
 * @param {string} content
 * @param {string} summary
 */
export async function saveChapterContent(chapterId, content, summary) {
  const { error } = await supabase
    .from('chapters')
    .update({ content, summary, status: 'draft' })
    .eq('id', chapterId);
  if (error) throw new Error(`saveChapterContent failed: ${error.message}`);
}

/**
 * Update a chapter's notes status.
 * @param {string} chapterId
 * @param {'yes'|'no'|'no_notes_needed'} status
 */
export async function updateChapterNotesStatus(chapterId, status) {
  const { error } = await supabase
    .from('chapters')
    .update({ chapter_notes_status: status })
    .eq('id', chapterId);
  if (error) throw new Error(`updateChapterNotesStatus failed: ${error.message}`);
}

/**
 * Mark a chapter as approved.
 * @param {string} chapterId
 */
export async function approveChapter(chapterId) {
  const { error } = await supabase
    .from('chapters')
    .update({ status: 'approved' })
    .eq('id', chapterId);
  if (error) throw new Error(`approveChapter failed: ${error.message}`);
}

/**
 * Get the latest chapter number for a book.
 * Returns 0 if no chapters exist yet.
 * @param {string} bookId
 * @returns {Promise<number>}
 */
export async function getLastChapterNumber(bookId) {
  const { data, error } = await supabase
    .from('chapters')
    .select('chapter_number')
    .eq('book_id', bookId)
    .order('chapter_number', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`getLastChapterNumber failed: ${error.message}`);
  return data?.chapter_number ?? 0;
}
```

---

## 5. Core — State Machine

### Task 5.1 — Create `src/core/stateMachine.js`

This is the brain of the system. Every gate decision goes through these functions.

```javascript
// src/core/stateMachine.js

/**
 * All valid status values across the system.
 */
export const STATUS = {
  YES: 'yes',
  NO: 'no',
  NO_NOTES_NEEDED: 'no_notes_needed',
};

/**
 * All pipeline stages.
 */
export const STAGE = {
  OUTLINE: 'outline',
  CHAPTER: 'chapter',
  COMPILE: 'compile',
};

/**
 * Determine if the outline stage can START generating.
 * Condition: notes_on_outline_before must be present.
 *
 * @param {object} book - book row from DB
 * @returns {{ canProceed: boolean, reason: string }}
 */
export function canStartOutline(book) {
  if (!book.notes_on_outline_before?.trim()) {
    return { canProceed: false, reason: 'notes_on_outline_before is empty — waiting for editor input' };
  }
  return { canProceed: true, reason: 'Ready to generate outline' };
}

/**
 * Determine if the outline stage can PROCEED to chapters
 * after the outline has been generated and reviewed.
 *
 * Status logic:
 *   yes            → wait for notes_on_outline_after, then regenerate
 *   no_notes_needed → proceed to chapter generation
 *   no / empty     → pause, send notification
 *
 * @param {object} book - book row from DB
 * @returns {{ canProceed: boolean, needsRegeneration: boolean, reason: string }}
 */
export function evaluateOutlineGate(book) {
  const status = book.status_outline_notes;

  if (status === STATUS.NO_NOTES_NEEDED) {
    return { canProceed: true, needsRegeneration: false, reason: 'Outline approved — proceeding to chapters' };
  }

  if (status === STATUS.YES) {
    const hasNotes = book.notes_on_outline_after?.trim();
    if (hasNotes) {
      return { canProceed: false, needsRegeneration: true, reason: 'Notes received — regenerating outline' };
    }
    return { canProceed: false, needsRegeneration: false, reason: 'Waiting for notes_on_outline_after' };
  }

  // status === 'no' or empty
  return { canProceed: false, needsRegeneration: false, reason: 'Outline review status is "no" — paused' };
}

/**
 * Determine if a specific chapter can proceed or needs notes.
 *
 * @param {object} chapter - chapter row from DB
 * @returns {{ canProceed: boolean, needsRegeneration: boolean, reason: string }}
 */
export function evaluateChapterGate(chapter) {
  const status = chapter.chapter_notes_status;

  if (status === STATUS.NO_NOTES_NEEDED) {
    return { canProceed: true, needsRegeneration: false, reason: `Chapter ${chapter.chapter_number} approved` };
  }

  if (status === STATUS.YES) {
    const hasNotes = chapter.chapter_notes?.trim();
    if (hasNotes) {
      return { canProceed: false, needsRegeneration: true, reason: `Regenerating chapter ${chapter.chapter_number} with notes` };
    }
    return { canProceed: false, needsRegeneration: false, reason: `Waiting for notes on chapter ${chapter.chapter_number}` };
  }

  return { canProceed: false, needsRegeneration: false, reason: `Chapter ${chapter.chapter_number} gate is "no" — paused` };
}

/**
 * Determine if the final compilation can start.
 *
 * @param {object} book - book row from DB
 * @param {object[]} chapters - all chapters for this book
 * @returns {{ canProceed: boolean, reason: string }}
 */
export function evaluateCompileGate(book, chapters) {
  const allApproved = chapters.length > 0 && chapters.every(c => c.status === 'approved');

  if (!allApproved) {
    const pending = chapters.filter(c => c.status !== 'approved').map(c => c.chapter_number);
    return { canProceed: false, reason: `Chapters not yet approved: ${pending.join(', ')}` };
  }

  const status = book.final_review_notes_status;

  if (status === STATUS.NO_NOTES_NEEDED) {
    return { canProceed: true, reason: 'All chapters approved, no final notes needed — compiling' };
  }

  if (status === STATUS.YES && book.final_review_notes?.trim()) {
    return { canProceed: true, reason: 'Final review notes present — compiling with notes applied' };
  }

  return { canProceed: false, reason: `Final review status is "${status}" — paused` };
}
```

---

## 6. Core — LLM Service

### Task 6.1 — Create `src/core/llmService.js`

This is the ONLY file in the project that touches the Anthropic API. All prompt execution happens here.

```javascript
// src/core/llmService.js
import Anthropic from '@anthropic-ai/sdk';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

const MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS = 4096;

/**
 * Internal helper — sends a single-turn prompt and returns the text response.
 * @param {string} systemPrompt
 * @param {string} userPrompt
 * @param {number} maxTokens
 * @returns {Promise<string>}
 */
async function complete(systemPrompt, userPrompt, maxTokens = MAX_TOKENS) {
  logger.info({ model: MODEL, promptLength: userPrompt.length }, 'LLM call starting');

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  });

  const text = response.content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('');

  logger.info({ outputLength: text.length, stopReason: response.stop_reason }, 'LLM call complete');
  return text;
}

/**
 * Generate a book outline.
 * @param {string} title
 * @param {string} notesBefore - editor notes before outline generation
 * @param {string|null} notesAfter - editor notes after seeing first outline (for regeneration)
 * @param {string|null} previousOutline - previous outline version (for regeneration context)
 * @returns {Promise<string>} generated outline text
 */
export async function generateOutline(title, notesBefore, notesAfter = null, previousOutline = null) {
  const system = `You are an expert book editor and author. Generate detailed, well-structured book outlines. 
Format the outline with numbered chapters and 3-5 bullet points per chapter describing what will be covered.
Be specific and ensure logical progression between chapters.`;

  let user = `Generate a detailed chapter-by-chapter outline for a book titled: "${title}"\n\n`;
  user += `Editor notes (use these as primary guidance):\n${notesBefore}\n\n`;

  if (previousOutline && notesAfter) {
    user += `Previous outline version:\n${previousOutline}\n\n`;
    user += `Editor feedback on the previous outline:\n${notesAfter}\n\n`;
    user += `Please revise the outline based on the editor feedback above.`;
  } else {
    user += `Generate the outline now. Return only the outline, no preamble.`;
  }

  return complete(system, user);
}

/**
 * Generate a single chapter.
 * @param {string} bookTitle
 * @param {string} outline - full book outline for context
 * @param {number} chapterNumber
 * @param {string} chapterTitle
 * @param {string} previousSummariesContext - formatted string of prior chapter summaries
 * @param {string|null} chapterNotes - editor notes for this chapter (for regeneration)
 * @param {string|null} previousContent - previous content (for regeneration)
 * @returns {Promise<string>} generated chapter content
 */
export async function generateChapter(
  bookTitle,
  outline,
  chapterNumber,
  chapterTitle,
  previousSummariesContext,
  chapterNotes = null,
  previousContent = null
) {
  const system = `You are a professional author writing a full-length non-fiction book. 
Write in an engaging, clear, and authoritative voice. 
Each chapter should be 1500-2500 words unless instructed otherwise.
Do not include chapter number prefixes in your output — just the chapter title and content.`;

  let user = `Book title: "${bookTitle}"\n\n`;
  user += `Full book outline:\n${outline}\n\n`;

  if (previousSummariesContext) {
    user += `Context from previous chapters:\n${previousSummariesContext}\n\n`;
  }

  user += `Now write Chapter ${chapterNumber}: "${chapterTitle}"\n\n`;

  if (previousContent && chapterNotes) {
    user += `Previous version of this chapter:\n${previousContent}\n\n`;
    user += `Editor notes for revision:\n${chapterNotes}\n\n`;
    user += `Please rewrite the chapter incorporating the editor's feedback.`;
  } else {
    user += `Write the full chapter now.`;
  }

  return complete(system, user, 8192);
}

/**
 * Summarize a chapter in ~150 words for use as context in subsequent chapters.
 * @param {number} chapterNumber
 * @param {string} chapterTitle
 * @param {string} chapterContent
 * @returns {Promise<string>} summary text
 */
export async function summarizeChapter(chapterNumber, chapterTitle, chapterContent) {
  const system = `You summarize book chapters concisely. Focus on key events, arguments, and information introduced. 
Write in past tense. Keep summaries to 100-150 words. Return only the summary, no labels or preamble.`;

  const user = `Summarize Chapter ${chapterNumber}: "${chapterTitle}"\n\n${chapterContent}`;

  return complete(system, user, 300);
}
```

### Task 6.2 — Create `src/config/logger.js`

```javascript
// src/config/logger.js
import pino from 'pino';
import { env } from './env.js';

export const logger = pino({
  level: env.NODE_ENV === 'production' ? 'info' : 'debug',
  transport: env.NODE_ENV !== 'production'
    ? { target: 'pino-pretty', options: { colorize: true } }
    : undefined,
});
```

---

## 7. Core — Prompt Templates

> Note: The LLM Service builds prompts directly as template literals. However, if you prefer to manage prompts as separate files (recommended for teams), create these Handlebars templates and update `llmService.js` to load them.

### Task 7.1 — Create `src/core/prompts/outline.hbs`

```handlebars
Generate a detailed chapter-by-chapter outline for a book titled: "{{title}}"

Editor notes (use these as primary guidance):
{{notesBefore}}

{{#if notesAfter}}
Previous outline version:
{{previousOutline}}

Editor feedback on the previous outline:
{{notesAfter}}

Please revise the outline based on the editor feedback above.
{{else}}
Generate the outline now. Return only the outline, no preamble.
{{/if}}
```

### Task 7.2 — Create `src/core/prompts/chapter.hbs`

```handlebars
Book title: "{{bookTitle}}"

Full book outline:
{{outline}}

{{#if previousSummaries}}
Context from previous chapters:
{{previousSummaries}}

{{/if}}
Now write Chapter {{chapterNumber}}: "{{chapterTitle}}"

{{#if chapterNotes}}
Previous version of this chapter:
{{previousContent}}

Editor notes for revision:
{{chapterNotes}}

Please rewrite the chapter incorporating the editor's feedback.
{{else}}
Write the full chapter now.
{{/if}}
```

### Task 7.3 — Create `src/core/prompts/summary.hbs`

```handlebars
Summarize Chapter {{chapterNumber}}: "{{chapterTitle}}"

{{content}}
```

---

## 8. Core — Context Builder

### Task 8.1 — Create `src/core/contextBuilder.js`

This module builds the "previous chapter summaries" string that gets injected before each new chapter generation.

```javascript
// src/core/contextBuilder.js
import { getPreviousChapterSummaries } from '../db/chaptersRepo.js';

/**
 * Build a formatted context string from all previous chapter summaries.
 * This string is passed to the LLM before generating the next chapter.
 *
 * @param {string} bookId
 * @param {number} nextChapterNumber - the chapter about to be written
 * @returns {Promise<string>} formatted context string (empty string if no previous chapters)
 */
export async function buildChapterContext(bookId, nextChapterNumber) {
  if (nextChapterNumber <= 1) return '';

  const summaries = await getPreviousChapterSummaries(bookId, nextChapterNumber);

  if (!summaries.length) return '';

  const lines = summaries.map(ch =>
    `Chapter ${ch.chapter_number} — "${ch.title}":\n${ch.summary}`
  );

  return lines.join('\n\n');
}

/**
 * Parse a plain-text outline into an array of chapter objects.
 * Supports formats like:
 *   "Chapter 1: Title" or "1. Title" or "1: Title"
 *
 * @param {string} outlineText
 * @returns {{ number: number, title: string }[]}
 */
export function parseChaptersFromOutline(outlineText) {
  const lines = outlineText.split('\n');
  const chapters = [];

  for (const line of lines) {
    // Match: "Chapter 1: Title" or "Chapter 1 - Title" or "1. Title" or "1: Title"
    const match = line.match(
      /^(?:chapter\s+)?(\d+)[.:\-–]\s*(.+)/i
    );
    if (match) {
      chapters.push({
        number: parseInt(match[1], 10),
        title: match[2].trim(),
      });
    }
  }

  return chapters;
}
```

---

## 9. Services — Sheets Reader

### Task 9.1 — Create `src/services/sheetsReader.js`

Reads book data from a Google Sheet. The sheet must have these columns in row 1 (headers):
`id | title | notes_on_outline_before | status_outline_notes | notes_on_outline_after | final_review_notes_status | final_review_notes`

```javascript
// src/services/sheetsReader.js
import { google } from 'googleapis';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

/**
 * Create an authenticated Google Sheets client using service account credentials.
 * @returns {import('googleapis').sheets_v4.Sheets}
 */
function getSheetsClient() {
  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      private_key: env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    },
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });

  return google.sheets({ version: 'v4', auth });
}

/**
 * Fetch all rows from the Google Sheet and return as an array of book objects.
 * Skips rows where title is empty.
 *
 * @returns {Promise<object[]>} array of book data objects
 */
export async function readBooksFromSheet() {
  const sheets = getSheetsClient();

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: env.GOOGLE_SPREADSHEET_ID,
    range: 'Sheet1!A1:G200',
  });

  const rows = response.data.values ?? [];
  if (rows.length < 2) return [];

  const headers = rows[0].map(h => h.trim().toLowerCase().replace(/\s+/g, '_'));

  const books = rows.slice(1).map(row => {
    const obj = {};
    headers.forEach((header, i) => {
      obj[header] = row[i]?.trim() ?? null;
    });
    return obj;
  });

  const valid = books.filter(b => b.title);
  logger.info({ count: valid.length }, 'Books read from Google Sheets');
  return valid;
}

/**
 * Sync Google Sheet data with the Supabase books table.
 * Inserts new books (by title match) and updates status fields.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @returns {Promise<{ inserted: number, updated: number }>}
 */
export async function syncSheetToDatabase(supabase) {
  const sheetBooks = await readBooksFromSheet();
  let inserted = 0;
  let updated = 0;

  for (const sheetBook of sheetBooks) {
    // Check if book already exists by title
    const { data: existing } = await supabase
      .from('books')
      .select('id, status_outline_notes, final_review_notes_status')
      .eq('title', sheetBook.title)
      .maybeSingle();

    if (!existing) {
      // Insert new book
      await supabase.from('books').insert({
        title: sheetBook.title,
        notes_on_outline_before: sheetBook.notes_on_outline_before,
        status_outline_notes: sheetBook.status_outline_notes ?? 'no',
        notes_on_outline_after: sheetBook.notes_on_outline_after,
        final_review_notes_status: sheetBook.final_review_notes_status ?? 'no',
        final_review_notes: sheetBook.final_review_notes,
      });
      inserted++;
    } else {
      // Update mutable fields from sheet (editor may have changed statuses)
      await supabase.from('books').update({
        notes_on_outline_before: sheetBook.notes_on_outline_before,
        notes_on_outline_after: sheetBook.notes_on_outline_after,
        status_outline_notes: sheetBook.status_outline_notes ?? existing.status_outline_notes,
        final_review_notes_status: sheetBook.final_review_notes_status ?? existing.final_review_notes_status,
        final_review_notes: sheetBook.final_review_notes,
      }).eq('id', existing.id);
      updated++;
    }
  }

  logger.info({ inserted, updated }, 'Sheet sync complete');
  return { inserted, updated };
}
```

---

## 10. Services — Notification Service

### Task 10.1 — Create `src/services/notificationService.js`

```javascript
// src/services/notificationService.js
import nodemailer from 'nodemailer';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

/**
 * Create a reusable Nodemailer transport.
 */
const transporter = nodemailer.createTransport({
  host: env.SMTP_HOST,
  port: env.SMTP_PORT,
  secure: env.SMTP_PORT === 465,
  auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
});

/**
 * Send an email notification.
 * @param {string} subject
 * @param {string} body - plain text body
 */
async function sendEmail(subject, body) {
  try {
    await transporter.sendMail({
      from: `"Book Gen System" <${env.SMTP_USER}>`,
      to: env.NOTIFY_EMAIL,
      subject,
      text: body,
    });
    logger.info({ subject, to: env.NOTIFY_EMAIL }, 'Email notification sent');
  } catch (err) {
    logger.error({ err, subject }, 'Failed to send email notification');
  }
}

/**
 * Send a Microsoft Teams webhook notification.
 * @param {string} title
 * @param {string} message
 */
async function sendTeamsNotification(title, message) {
  if (!env.TEAMS_WEBHOOK_URL) return;

  try {
    await fetch(env.TEAMS_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        '@type': 'MessageCard',
        '@context': 'http://schema.org/extensions',
        summary: title,
        themeColor: '0076D7',
        sections: [{
          activityTitle: title,
          activityText: message,
        }],
      }),
    });
    logger.info({ title }, 'Teams notification sent');
  } catch (err) {
    logger.error({ err, title }, 'Failed to send Teams notification');
  }
}

/**
 * Notify that an outline is ready for review.
 * @param {string} bookTitle
 * @param {string} bookId
 */
export async function notifyOutlineReady(bookTitle, bookId) {
  const subject = `[Book Gen] Outline ready for review — "${bookTitle}"`;
  const body = `The outline for "${bookTitle}" has been generated and is ready for your review.\n\nBook ID: ${bookId}\n\nPlease review the outline and update status_outline_notes in the spreadsheet:\n- "no_notes_needed" to proceed to chapter generation\n- "yes" to add notes and regenerate`;
  await Promise.all([sendEmail(subject, body), sendTeamsNotification(subject, body)]);
}

/**
 * Notify that a chapter is ready for review.
 * @param {string} bookTitle
 * @param {number} chapterNumber
 * @param {string} chapterId
 */
export async function notifyChapterReady(bookTitle, chapterNumber, chapterId) {
  const subject = `[Book Gen] Chapter ${chapterNumber} ready for review — "${bookTitle}"`;
  const body = `Chapter ${chapterNumber} of "${bookTitle}" has been generated.\n\nChapter ID: ${chapterId}\n\nPlease review and update chapter_notes_status:\n- "no_notes_needed" to approve\n- "yes" to add notes and regenerate`;
  await Promise.all([sendEmail(subject, body), sendTeamsNotification(subject, body)]);
}

/**
 * Notify that the system is paused waiting for input.
 * @param {string} bookTitle
 * @param {string} stage
 * @param {string} reason
 */
export async function notifyPaused(bookTitle, stage, reason) {
  const subject = `[Book Gen] Paused at "${stage}" — "${bookTitle}"`;
  const body = `The book generation pipeline is paused.\n\nBook: "${bookTitle}"\nStage: ${stage}\nReason: ${reason}`;
  await Promise.all([sendEmail(subject, body), sendTeamsNotification(subject, body)]);
}

/**
 * Notify that the final draft is compiled and ready.
 * @param {string} bookTitle
 * @param {{ docx?: string, pdf?: string, txt?: string }} outputUrls
 */
export async function notifyBookComplete(bookTitle, outputUrls) {
  const subject = `[Book Gen] Final draft complete — "${bookTitle}"`;
  const urlLines = Object.entries(outputUrls)
    .filter(([, url]) => url)
    .map(([fmt, url]) => `${fmt.toUpperCase()}: ${url}`)
    .join('\n');
  const body = `The final draft of "${bookTitle}" is ready!\n\nDownload links:\n${urlLines}`;
  await Promise.all([sendEmail(subject, body), sendTeamsNotification(subject, body)]);
}

/**
 * Notify that an error occurred.
 * @param {string} bookTitle
 * @param {string} stage
 * @param {Error} error
 */
export async function notifyError(bookTitle, stage, error) {
  const subject = `[Book Gen] ERROR at "${stage}" — "${bookTitle}"`;
  const body = `An error occurred during book generation.\n\nBook: "${bookTitle}"\nStage: ${stage}\nError: ${error.message}\n\nStack:\n${error.stack}`;
  await Promise.all([sendEmail(subject, body), sendTeamsNotification(subject, body)]);
}
```

---

## 11. Services — File Exporter

### Task 11.1 — Create `src/services/fileExporter.js`

Generates .docx, .txt and uploads both to Supabase Storage.

```javascript
// src/services/fileExporter.js
import {
  Document, Packer, Paragraph, TextRun, HeadingLevel,
  AlignmentType, LevelFormat
} from 'docx';
import { supabase } from '../db/supabaseClient.js';
import { logger } from '../config/logger.js';

/**
 * Build a docx Document object from book data.
 * @param {object} book - book row
 * @param {object[]} chapters - chapter rows ordered by chapter_number
 * @returns {Document}
 */
function buildDocxDocument(book, chapters) {
  const children = [];

  // Title page
  children.push(
    new Paragraph({
      heading: HeadingLevel.TITLE,
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: book.title, bold: true, size: 56 })],
    }),
    new Paragraph({ children: [new TextRun('')] }), // spacer
    new Paragraph({ children: [new TextRun('')] }), // spacer
  );

  // Chapters
  for (const chapter of chapters) {
    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        children: [
          new TextRun({
            text: `Chapter ${chapter.chapter_number}: ${chapter.title}`,
            bold: true,
          }),
        ],
        pageBreakBefore: chapter.chapter_number > 1,
      })
    );

    const paragraphs = (chapter.content ?? '').split('\n\n');
    for (const para of paragraphs) {
      const trimmed = para.trim();
      if (!trimmed) continue;

      // Detect subheadings (lines ending with nothing, surrounded by blank lines, short)
      if (trimmed.length < 80 && !trimmed.includes('.') && trimmed === trimmed.toUpperCase()) {
        children.push(new Paragraph({
          heading: HeadingLevel.HEADING_2,
          children: [new TextRun({ text: trimmed })],
        }));
      } else {
        children.push(new Paragraph({
          children: [new TextRun({ text: trimmed })],
          spacing: { after: 200 },
        }));
      }
    }
  }

  return new Document({
    styles: {
      default: {
        document: { run: { font: 'Georgia', size: 24 } },
      },
      paragraphStyles: [
        {
          id: 'Heading1',
          name: 'Heading 1',
          basedOn: 'Normal',
          next: 'Normal',
          run: { size: 36, bold: true, font: 'Arial' },
          paragraph: { spacing: { before: 480, after: 240 }, outlineLevel: 0 },
        },
        {
          id: 'Heading2',
          name: 'Heading 2',
          basedOn: 'Normal',
          next: 'Normal',
          run: { size: 28, bold: true, font: 'Arial' },
          paragraph: { spacing: { before: 300, after: 120 }, outlineLevel: 1 },
        },
      ],
    },
    sections: [{
      properties: {
        page: {
          size: { width: 12240, height: 15840 },
          margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
        },
      },
      children,
    }],
  });
}

/**
 * Build a plain text version of the book.
 * @param {object} book
 * @param {object[]} chapters
 * @returns {string}
 */
function buildTxtContent(book, chapters) {
  const lines = [`${book.title.toUpperCase()}\n${'='.repeat(book.title.length)}\n`];

  for (const chapter of chapters) {
    lines.push(`\n\nCHAPTER ${chapter.chapter_number}: ${chapter.title}`);
    lines.push('-'.repeat(60));
    lines.push(chapter.content ?? '');
  }

  return lines.join('\n');
}

/**
 * Upload a buffer to Supabase Storage and return the public URL.
 * @param {Buffer|Uint8Array} buffer
 * @param {string} fileName
 * @param {string} contentType
 * @returns {Promise<string>} public URL
 */
async function uploadToStorage(buffer, fileName, contentType) {
  const { data, error } = await supabase.storage
    .from('book-outputs')
    .upload(fileName, buffer, {
      contentType,
      upsert: true,
    });

  if (error) throw new Error(`Storage upload failed: ${error.message}`);

  const { data: urlData } = supabase.storage
    .from('book-outputs')
    .getPublicUrl(data.path);

  return urlData.publicUrl;
}

/**
 * Generate and upload all output formats for a book.
 * Returns an object with URLs for each format.
 *
 * @param {object} book - book row
 * @param {object[]} chapters - approved chapters ordered by number
 * @returns {Promise<{ docx: string, txt: string }>}
 */
export async function exportBook(book, chapters) {
  const safeTitle = book.title.replace(/[^a-z0-9]/gi, '_').toLowerCase();
  const timestamp = Date.now();
  const urls = {};

  // Generate and upload .docx
  logger.info({ bookId: book.id }, 'Generating .docx');
  const docxDoc = buildDocxDocument(book, chapters);
  const docxBuffer = await Packer.toBuffer(docxDoc);
  urls.docx = await uploadToStorage(
    docxBuffer,
    `${safeTitle}_${timestamp}.docx`,
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  );

  // Generate and upload .txt
  logger.info({ bookId: book.id }, 'Generating .txt');
  const txtContent = buildTxtContent(book, chapters);
  const txtBuffer = Buffer.from(txtContent, 'utf-8');
  urls.txt = await uploadToStorage(
    txtBuffer,
    `${safeTitle}_${timestamp}.txt`,
    'text/plain'
  );

  logger.info({ bookId: book.id, urls }, 'Book export complete');
  return urls;
}
```

---

## 12. Workers — Outline Worker

### Task 12.1 — Create `src/workers/outlineWorker.js`

```javascript
// src/workers/outlineWorker.js
import { Worker, Queue } from 'bullmq';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { generateOutline } from '../core/llmService.js';
import { canStartOutline, evaluateOutlineGate } from '../core/stateMachine.js';
import { getBooksReadyForOutline, saveOutline, updateOutlineStatus, logNote } from '../db/booksRepo.js';
import { notifyOutlineReady, notifyPaused, notifyError } from '../services/notificationService.js';

const connection = { host: env.REDIS_HOST, port: env.REDIS_PORT };

export const outlineQueue = new Queue('outline', { connection });

/**
 * Process a single book through the outline stage.
 * @param {object} book
 */
async function processBook(book) {
  const { canProceed, reason } = canStartOutline(book);

  if (!canProceed) {
    logger.info({ bookId: book.id, reason }, 'Outline stage: skipping');
    return;
  }

  // Check if outline already exists (regeneration path)
  if (book.outline) {
    const gate = evaluateOutlineGate(book);
    if (gate.needsRegeneration) {
      logger.info({ bookId: book.id }, 'Regenerating outline with editor notes');
      // Get draft count to set version number
      const newOutline = await generateOutline(
        book.title,
        book.notes_on_outline_before,
        book.notes_on_outline_after,
        book.outline
      );
      await saveOutline(book.id, newOutline, Date.now());
      await logNote(book.id, 'outline_after', book.notes_on_outline_after);
      await notifyOutlineReady(book.title, book.id);
    }
    return;
  }

  // First-time outline generation
  logger.info({ bookId: book.id, title: book.title }, 'Generating outline');
  try {
    const outline = await generateOutline(book.title, book.notes_on_outline_before);
    await saveOutline(book.id, outline, 1);
    await notifyOutlineReady(book.title, book.id);
    logger.info({ bookId: book.id }, 'Outline saved and notification sent');
  } catch (err) {
    logger.error({ err, bookId: book.id }, 'Outline generation failed');
    await notifyError(book.title, 'outline', err);
  }
}

/**
 * Poll Supabase for books that need outline generation and enqueue them.
 */
export async function pollAndEnqueueOutlineJobs() {
  const books = await getBooksReadyForOutline();
  for (const book of books) {
    await outlineQueue.add('generate-outline', { bookId: book.id }, {
      jobId: `outline-${book.id}`,
      removeOnComplete: true,
      removeOnFail: false,
    });
  }
  if (books.length) logger.info({ count: books.length }, 'Outline jobs enqueued');
}

/**
 * Start the outline BullMQ worker.
 */
export function startOutlineWorker() {
  const worker = new Worker(
    'outline',
    async (job) => {
      const { bookId } = job.data;
      const { getBookById } = await import('../db/booksRepo.js');
      const book = await getBookById(bookId);
      await processBook(book);
    },
    { connection, concurrency: 2 }
  );

  worker.on('completed', job => logger.info({ jobId: job.id }, 'Outline job completed'));
  worker.on('failed', (job, err) => logger.error({ jobId: job?.id, err }, 'Outline job failed'));

  return worker;
}
```

---

## 13. Workers — Chapter Worker

### Task 13.1 — Create `src/workers/chapterWorker.js`

```javascript
// src/workers/chapterWorker.js
import { Worker, Queue } from 'bullmq';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { generateChapter, summarizeChapter } from '../core/llmService.js';
import { evaluateOutlineGate, evaluateChapterGate } from '../core/stateMachine.js';
import { buildChapterContext, parseChaptersFromOutline } from '../core/contextBuilder.js';
import {
  getBooksReadyForChapters,
  getBookById,
  logNote,
} from '../db/booksRepo.js';
import {
  getChaptersByBookId,
  createChapter,
  saveChapterContent,
  updateChapterNotesStatus,
  approveChapter,
  getLastChapterNumber,
} from '../db/chaptersRepo.js';
import {
  notifyChapterReady,
  notifyPaused,
  notifyError,
} from '../services/notificationService.js';

const connection = { host: env.REDIS_HOST, port: env.REDIS_PORT };

export const chapterQueue = new Queue('chapter', { connection });

/**
 * Process all chapters for a single book.
 * @param {string} bookId
 */
async function processBookChapters(bookId) {
  const book = await getBookById(bookId);

  // Verify outline gate is open
  const gate = evaluateOutlineGate(book);
  if (!gate.canProceed) {
    logger.info({ bookId, reason: gate.reason }, 'Chapter stage blocked by outline gate');
    return;
  }

  const parsedChapters = parseChaptersFromOutline(book.outline);
  if (!parsedChapters.length) {
    logger.warn({ bookId }, 'No chapters parsed from outline — check outline format');
    return;
  }

  const existingChapters = await getChaptersByBookId(bookId);

  for (const parsed of parsedChapters) {
    const existing = existingChapters.find(c => c.chapter_number === parsed.number);

    if (!existing) {
      // Create the chapter record and generate content
      const chapter = await createChapter(bookId, parsed.number, parsed.title);
      await generateAndSaveChapter(book, chapter);
    } else {
      // Check gate for existing chapter
      const chapterGate = evaluateChapterGate(existing);

      if (chapterGate.needsRegeneration) {
        logger.info({ chapterId: existing.id, chapterNumber: existing.chapter_number }, 'Regenerating chapter with notes');
        await generateAndSaveChapter(book, existing, existing.chapter_notes, existing.content);
        if (existing.chapter_notes) {
          await logNote(bookId, 'chapter', existing.chapter_notes, existing.id);
        }
      } else if (!chapterGate.canProceed) {
        logger.info({ chapterNumber: existing.chapter_number, reason: chapterGate.reason }, 'Chapter paused');
        await notifyPaused(book.title, `Chapter ${existing.chapter_number}`, chapterGate.reason);
        break; // Don't proceed to next chapters until this one is resolved
      }
    }
  }
}

/**
 * Generate content for a chapter, save it, and notify.
 * @param {object} book
 * @param {object} chapter
 * @param {string|null} chapterNotes
 * @param {string|null} previousContent
 */
async function generateAndSaveChapter(book, chapter, chapterNotes = null, previousContent = null) {
  try {
    const contextInput = await buildChapterContext(book.id, chapter.chapter_number);

    const content = await generateChapter(
      book.title,
      book.outline,
      chapter.chapter_number,
      chapter.title,
      contextInput,
      chapterNotes,
      previousContent
    );

    const summary = await summarizeChapter(chapter.chapter_number, chapter.title, content);
    await saveChapterContent(chapter.id, content, summary);

    logger.info({ chapterId: chapter.id, chapterNumber: chapter.chapter_number }, 'Chapter generated and saved');
    await notifyChapterReady(book.title, chapter.chapter_number, chapter.id);
  } catch (err) {
    logger.error({ err, chapterId: chapter.id }, 'Chapter generation failed');
    await notifyError(book.title, `Chapter ${chapter.chapter_number}`, err);
  }
}

/**
 * Poll for books ready for chapter generation.
 */
export async function pollAndEnqueueChapterJobs() {
  const books = await getBooksReadyForChapters();
  for (const book of books) {
    await chapterQueue.add('generate-chapters', { bookId: book.id }, {
      jobId: `chapters-${book.id}`,
      removeOnComplete: true,
      removeOnFail: false,
    });
  }
  if (books.length) logger.info({ count: books.length }, 'Chapter jobs enqueued');
}

/**
 * Start the chapter BullMQ worker.
 */
export function startChapterWorker() {
  const worker = new Worker(
    'chapter',
    async (job) => {
      await processBookChapters(job.data.bookId);
    },
    { connection, concurrency: 1 } // Keep at 1 to respect chapter ordering
  );

  worker.on('completed', job => logger.info({ jobId: job.id }, 'Chapter job completed'));
  worker.on('failed', (job, err) => logger.error({ jobId: job?.id, err }, 'Chapter job failed'));

  return worker;
}
```

---

## 14. Workers — Compile Worker

### Task 14.1 — Create `src/workers/compileWorker.js`

```javascript
// src/workers/compileWorker.js
import { Worker, Queue } from 'bullmq';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { evaluateCompileGate } from '../core/stateMachine.js';
import { getBookById, saveOutputUrls } from '../db/booksRepo.js';
import { getChaptersByBookId } from '../db/chaptersRepo.js';
import { exportBook } from '../services/fileExporter.js';
import { notifyBookComplete, notifyPaused, notifyError } from '../services/notificationService.js';
import { supabase } from '../db/supabaseClient.js';

const connection = { host: env.REDIS_HOST, port: env.REDIS_PORT };

export const compileQueue = new Queue('compile', { connection });

/**
 * Process final compilation for a book.
 * @param {string} bookId
 */
async function compileBook(bookId) {
  const book = await getBookById(bookId);
  const chapters = await getChaptersByBookId(bookId);

  const gate = evaluateCompileGate(book, chapters);

  if (!gate.canProceed) {
    logger.info({ bookId, reason: gate.reason }, 'Compile gate blocked');
    await notifyPaused(book.title, 'compilation', gate.reason);
    return;
  }

  // Mark as compiling
  await supabase.from('books').update({ book_output_status: 'compiling' }).eq('id', bookId);

  try {
    const approvedChapters = chapters.filter(c => c.status === 'approved');
    const urls = await exportBook(book, approvedChapters);
    await saveOutputUrls(bookId, urls);
    await notifyBookComplete(book.title, urls);
    logger.info({ bookId, urls }, 'Book compiled and uploaded');
  } catch (err) {
    await supabase.from('books').update({ book_output_status: 'error' }).eq('id', bookId);
    logger.error({ err, bookId }, 'Compilation failed');
    await notifyError(book.title, 'compile', err);
  }
}

/**
 * Poll for books where all chapters are approved and final status allows compile.
 */
export async function pollAndEnqueueCompileJobs() {
  const { data: books } = await supabase
    .from('books')
    .select('id, title, final_review_notes_status, book_output_status')
    .neq('book_output_status', 'done')
    .neq('book_output_status', 'compiling')
    .in('final_review_notes_status', ['no_notes_needed', 'yes']);

  for (const book of books ?? []) {
    const chapters = await getChaptersByBookId(book.id);
    const allApproved = chapters.length > 0 && chapters.every(c => c.status === 'approved');
    if (!allApproved) continue;

    await compileQueue.add('compile-book', { bookId: book.id }, {
      jobId: `compile-${book.id}`,
      removeOnComplete: true,
      removeOnFail: false,
    });
  }
}

/**
 * Start the compile BullMQ worker.
 */
export function startCompileWorker() {
  const worker = new Worker(
    'compile',
    async (job) => {
      await compileBook(job.data.bookId);
    },
    { connection, concurrency: 1 }
  );

  worker.on('completed', job => logger.info({ jobId: job.id }, 'Compile job completed'));
  worker.on('failed', (job, err) => logger.error({ jobId: job?.id, err }, 'Compile job failed'));

  return worker;
}
```

---

## 15. API — Webhook Server

### Task 15.1 — Create `src/api/webhook.js`

Optional Fastify server. Allows triggering pipeline stages via HTTP instead of polling.

```javascript
// src/api/webhook.js
import Fastify from 'fastify';
import { z } from 'zod';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { outlineQueue } from '../workers/outlineWorker.js';
import { chapterQueue } from '../workers/chapterWorker.js';
import { compileQueue } from '../workers/compileWorker.js';
import { syncSheetToDatabase } from '../services/sheetsReader.js';
import { supabase } from '../db/supabaseClient.js';

const app = Fastify({ logger: false });

/**
 * Health check
 */
app.get('/health', async () => ({ status: 'ok', timestamp: new Date().toISOString() }));

/**
 * Manually trigger a sync from Google Sheets to Supabase.
 */
app.post('/sync-sheet', async (req, reply) => {
  try {
    const result = await syncSheetToDatabase(supabase);
    return reply.send({ success: true, ...result });
  } catch (err) {
    logger.error({ err }, '/sync-sheet failed');
    return reply.status(500).send({ success: false, error: err.message });
  }
});

/**
 * Manually trigger outline generation for a specific book.
 * Body: { bookId: string }
 */
app.post('/trigger/outline', async (req, reply) => {
  const schema = z.object({ bookId: z.string().uuid() });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return reply.status(400).send({ error: 'Invalid bookId' });

  await outlineQueue.add('generate-outline', { bookId: parsed.data.bookId }, {
    removeOnComplete: true,
  });
  return reply.send({ success: true, message: 'Outline job queued' });
});

/**
 * Manually trigger chapter generation for a specific book.
 * Body: { bookId: string }
 */
app.post('/trigger/chapters', async (req, reply) => {
  const schema = z.object({ bookId: z.string().uuid() });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return reply.status(400).send({ error: 'Invalid bookId' });

  await chapterQueue.add('generate-chapters', { bookId: parsed.data.bookId }, {
    removeOnComplete: true,
  });
  return reply.send({ success: true, message: 'Chapter job queued' });
});

/**
 * Manually trigger compilation for a specific book.
 * Body: { bookId: string }
 */
app.post('/trigger/compile', async (req, reply) => {
  const schema = z.object({ bookId: z.string().uuid() });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return reply.status(400).send({ error: 'Invalid bookId' });

  await compileQueue.add('compile-book', { bookId: parsed.data.bookId }, {
    removeOnComplete: true,
  });
  return reply.send({ success: true, message: 'Compile job queued' });
});

/**
 * Start the Fastify server.
 */
export async function startApiServer() {
  await app.listen({ port: env.PORT, host: '0.0.0.0' });
  logger.info({ port: env.PORT }, 'API server started');
}
```

---

## 16. Entry Point

### Task 16.1 — Create `src/index.js`

```javascript
// src/index.js
import { logger } from './config/logger.js';
import { env } from './config/env.js';
import { startOutlineWorker, pollAndEnqueueOutlineJobs } from './workers/outlineWorker.js';
import { startChapterWorker, pollAndEnqueueChapterJobs } from './workers/chapterWorker.js';
import { startCompileWorker, pollAndEnqueueCompileJobs } from './workers/compileWorker.js';
import { syncSheetToDatabase } from './services/sheetsReader.js';
import { supabase } from './db/supabaseClient.js';
import { startApiServer } from './api/webhook.js';

/**
 * Main polling loop — runs every POLL_INTERVAL_MS milliseconds.
 * Order matters: outline → chapters → compile
 */
async function runPollingLoop() {
  logger.info('Polling cycle starting');
  try {
    // Step 1: Sync Google Sheets → Supabase
    await syncSheetToDatabase(supabase);

    // Step 2: Enqueue outline jobs for eligible books
    await pollAndEnqueueOutlineJobs();

    // Step 3: Enqueue chapter jobs for books with approved outlines
    await pollAndEnqueueChapterJobs();

    // Step 4: Enqueue compile jobs for books with all chapters approved
    await pollAndEnqueueCompileJobs();
  } catch (err) {
    logger.error({ err }, 'Polling cycle error');
  }
}

/**
 * Bootstrap the entire application.
 */
async function main() {
  logger.info({ env: env.NODE_ENV }, 'Book Generation System starting');

  // Start BullMQ workers (they listen for jobs from queues)
  startOutlineWorker();
  startChapterWorker();
  startCompileWorker();

  // Start optional API server
  await startApiServer();

  // Initial poll immediately
  await runPollingLoop();

  // Then poll on interval
  setInterval(runPollingLoop, env.POLL_INTERVAL_MS);

  logger.info({ intervalMs: env.POLL_INTERVAL_MS }, 'Polling loop started');
}

// Handle graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received — shutting down');
  process.exit(0);
});

process.on('SIGINT', () => {
  logger.info('SIGINT received — shutting down');
  process.exit(0);
});

main().catch(err => {
  logger.error({ err }, 'Fatal startup error');
  process.exit(1);
});
```

---

## 17. Docker Setup

### Task 17.1 — Create `docker-compose.yml`

```yaml
version: '3.9'

services:
  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5

  app:
    build: .
    env_file: .env
    depends_on:
      redis:
        condition: service_healthy
    ports:
      - "${PORT:-3000}:3000"
    restart: unless-stopped

volumes:
  redis_data:
```

### Task 17.2 — Create `Dockerfile`

```dockerfile
FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY src/ ./src/

EXPOSE 3000

CMD ["node", "src/index.js"]
```

### Task 17.3 — Create `.dockerignore`

```
node_modules
.env
*.log
tests
```

---

## 18. Tests

### Task 18.1 — Create `tests/stateMachine.test.js`

```javascript
// tests/stateMachine.test.js
import { describe, it, expect } from 'vitest';
import {
  canStartOutline,
  evaluateOutlineGate,
  evaluateChapterGate,
  evaluateCompileGate,
} from '../src/core/stateMachine.js';

describe('canStartOutline', () => {
  it('returns false when notes_on_outline_before is empty', () => {
    const result = canStartOutline({ notes_on_outline_before: '' });
    expect(result.canProceed).toBe(false);
  });

  it('returns false when notes_on_outline_before is null', () => {
    const result = canStartOutline({ notes_on_outline_before: null });
    expect(result.canProceed).toBe(false);
  });

  it('returns true when notes_on_outline_before has content', () => {
    const result = canStartOutline({ notes_on_outline_before: 'Focus on history' });
    expect(result.canProceed).toBe(true);
  });
});

describe('evaluateOutlineGate', () => {
  it('proceeds when status is no_notes_needed', () => {
    const result = evaluateOutlineGate({ status_outline_notes: 'no_notes_needed' });
    expect(result.canProceed).toBe(true);
    expect(result.needsRegeneration).toBe(false);
  });

  it('flags regeneration when status is yes and notes exist', () => {
    const result = evaluateOutlineGate({
      status_outline_notes: 'yes',
      notes_on_outline_after: 'Make chapter 3 longer',
    });
    expect(result.canProceed).toBe(false);
    expect(result.needsRegeneration).toBe(true);
  });

  it('pauses when status is yes but no notes yet', () => {
    const result = evaluateOutlineGate({
      status_outline_notes: 'yes',
      notes_on_outline_after: null,
    });
    expect(result.canProceed).toBe(false);
    expect(result.needsRegeneration).toBe(false);
  });

  it('pauses when status is no', () => {
    const result = evaluateOutlineGate({ status_outline_notes: 'no' });
    expect(result.canProceed).toBe(false);
  });
});

describe('evaluateChapterGate', () => {
  it('proceeds when chapter_notes_status is no_notes_needed', () => {
    const result = evaluateChapterGate({ chapter_number: 1, chapter_notes_status: 'no_notes_needed' });
    expect(result.canProceed).toBe(true);
  });

  it('flags regeneration when status is yes and notes exist', () => {
    const result = evaluateChapterGate({
      chapter_number: 2,
      chapter_notes_status: 'yes',
      chapter_notes: 'Add more examples',
    });
    expect(result.needsRegeneration).toBe(true);
  });
});

describe('evaluateCompileGate', () => {
  it('blocks when not all chapters are approved', () => {
    const chapters = [
      { chapter_number: 1, status: 'approved' },
      { chapter_number: 2, status: 'draft' },
    ];
    const result = evaluateCompileGate({ final_review_notes_status: 'no_notes_needed' }, chapters);
    expect(result.canProceed).toBe(false);
  });

  it('proceeds when all chapters approved and no_notes_needed', () => {
    const chapters = [
      { chapter_number: 1, status: 'approved' },
      { chapter_number: 2, status: 'approved' },
    ];
    const result = evaluateCompileGate({ final_review_notes_status: 'no_notes_needed' }, chapters);
    expect(result.canProceed).toBe(true);
  });

  it('blocks when no chapters exist', () => {
    const result = evaluateCompileGate({ final_review_notes_status: 'no_notes_needed' }, []);
    expect(result.canProceed).toBe(false);
  });
});
```

### Task 18.2 — Create `tests/contextBuilder.test.js`

```javascript
// tests/contextBuilder.test.js
import { describe, it, expect } from 'vitest';
import { parseChaptersFromOutline } from '../src/core/contextBuilder.js';

describe('parseChaptersFromOutline', () => {
  it('parses "Chapter 1: Title" format', () => {
    const outline = `Chapter 1: Introduction\n- Point one\nChapter 2: The Beginning\n- Point one`;
    const chapters = parseChaptersFromOutline(outline);
    expect(chapters).toHaveLength(2);
    expect(chapters[0]).toEqual({ number: 1, title: 'Introduction' });
    expect(chapters[1]).toEqual({ number: 2, title: 'The Beginning' });
  });

  it('parses "1. Title" format', () => {
    const outline = `1. Introduction\n2. History`;
    const chapters = parseChaptersFromOutline(outline);
    expect(chapters).toHaveLength(2);
    expect(chapters[0].number).toBe(1);
  });

  it('returns empty array for outline with no chapters', () => {
    const result = parseChaptersFromOutline('This is just a description with no chapters.');
    expect(result).toHaveLength(0);
  });
});
```

### Task 18.3 — Create `vitest.config.js`

```javascript
// vitest.config.js
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['tests/**/*.test.js'],
  },
});
```

---

## 19. File Tree Reference

After completing all tasks your project should look exactly like this:

```
book-gen/
├── src/
│   ├── config/
│   │   ├── env.js                    ← Task 2.2
│   │   └── logger.js                 ← Task 6.2
│   ├── core/
│   │   ├── contextBuilder.js         ← Task 8.1
│   │   ├── llmService.js             ← Task 6.1
│   │   ├── stateMachine.js           ← Task 5.1
│   │   └── prompts/
│   │       ├── chapter.hbs           ← Task 7.2
│   │       ├── outline.hbs           ← Task 7.1
│   │       └── summary.hbs           ← Task 7.3
│   ├── db/
│   │   ├── booksRepo.js              ← Task 4.2
│   │   ├── chaptersRepo.js           ← Task 4.3
│   │   ├── supabaseClient.js         ← Task 4.1
│   │   └── migrations/
│   │       └── 001_initial.sql       ← Task 3.1
│   ├── services/
│   │   ├── fileExporter.js           ← Task 11.1
│   │   ├── notificationService.js    ← Task 10.1
│   │   └── sheetsReader.js           ← Task 9.1
│   ├── workers/
│   │   ├── chapterWorker.js          ← Task 13.1
│   │   ├── compileWorker.js          ← Task 14.1
│   │   └── outlineWorker.js          ← Task 12.1
│   ├── api/
│   │   └── webhook.js                ← Task 15.1
│   └── index.js                      ← Task 16.1
├── tests/
│   ├── contextBuilder.test.js        ← Task 18.2
│   └── stateMachine.test.js          ← Task 18.1
├── .dockerignore                     ← Task 17.3
├── .env                              ← Task 2.1
├── Dockerfile                        ← Task 17.2
├── docker-compose.yml                ← Task 17.1
├── package.json                      ← Task 1.2
└── vitest.config.js                  ← Task 18.3
```

---

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Copy and fill in your .env
cp .env.example .env

# 3. Run the Supabase migration (paste 001_initial.sql into Supabase SQL editor)

# 4. Start Redis locally
docker compose up redis -d

# 5. Run the app
npm run dev

# 6. Run tests
npm test
```

---

## Key Decisions Summary

| Decision | Choice | Why |
|---|---|---|
| ESM modules | `"type": "module"` | Cleaner imports, future-proof |
| Task queue | BullMQ + Redis | Persistent jobs, retries, concurrency control |
| Env validation | Zod | Fails fast at startup, not mid-run |
| Concurrency | 1 for chapters/compile | Preserves ordering |
| LLM calls | Single `llmService.js` | Swap models in one place |
| Context chaining | Summaries only | Avoids context window limits |
| State source of truth | Supabase columns | Crash-safe, resumable |