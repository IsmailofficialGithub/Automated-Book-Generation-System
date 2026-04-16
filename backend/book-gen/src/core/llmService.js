import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

const anthropicClient = env.ANTHROPIC_API_KEY ? new Anthropic({ apiKey: env.ANTHROPIC_API_KEY }) : null;
const openaiClient = env.OPENAI_API_KEY ? new OpenAI({ apiKey: env.OPENAI_API_KEY }) : null;

const ANTHROPIC_MODEL = 'claude-sonnet-4-5';
const OPENAI_MODEL = env.OPENAI_MODEL;
const MAX_TOKENS = 4096;

async function complete(systemPrompt, userPrompt, maxTokens = MAX_TOKENS) {
  if (env.LLM_PROVIDER === 'openai') {
    if (!openaiClient) throw new Error('OPENAI_API_KEY is not configured for OpenAI provider');

    logger.info({ provider: 'openai', model: OPENAI_MODEL, promptLength: userPrompt.length }, 'LLM call starting');

    const response = await openaiClient.responses.create({
      model: OPENAI_MODEL,
      max_output_tokens: maxTokens,
      input: [
        { role: 'system', content: [{ type: 'input_text', text: systemPrompt }] },
        { role: 'user', content: [{ type: 'input_text', text: userPrompt }] },
      ],
    });

    const text = (response.output_text ?? '').trim();
    logger.info({ provider: 'openai', outputLength: text.length }, 'LLM call complete');
    return text;
  }

  if (!anthropicClient) throw new Error('ANTHROPIC_API_KEY is not configured for Anthropic provider');

  logger.info({ provider: 'anthropic', model: ANTHROPIC_MODEL, promptLength: userPrompt.length }, 'LLM call starting');

  const response = await anthropicClient.messages.create({
    model: ANTHROPIC_MODEL,
    max_tokens: maxTokens,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  });

  const text = response.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('');

  logger.info({ provider: 'anthropic', outputLength: text.length, stopReason: response.stop_reason }, 'LLM call complete');
  return text;
}

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
    user += 'Generate the outline now. Return only the outline, no preamble.';
  }

  return complete(system, user);
}

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
Do not include chapter number prefixes in your output - just the chapter title and content.`;

  let user = `Book title: "${bookTitle}"\n\n`;
  user += `Full book outline:\n${outline}\n\n`;

  if (previousSummariesContext) {
    user += `Context from previous chapters:\n${previousSummariesContext}\n\n`;
  }

  user += `Now write Chapter ${chapterNumber}: "${chapterTitle}"\n\n`;

  if (previousContent && chapterNotes) {
    user += `Previous version of this chapter:\n${previousContent}\n\n`;
    user += `Editor notes for revision:\n${chapterNotes}\n\n`;
    user += "Please rewrite the chapter incorporating the editor's feedback.";
  } else {
    user += 'Write the full chapter now.';
  }

  return complete(system, user, 8192);
}

export async function summarizeChapter(chapterNumber, chapterTitle, chapterContent) {
  const system = `You summarize book chapters concisely. Focus on key events, arguments, and information introduced.
Write in past tense. Keep summaries to 100-150 words. Return only the summary, no labels or preamble.`;

  const user = `Summarize Chapter ${chapterNumber}: "${chapterTitle}"\n\n${chapterContent}`;

  return complete(system, user, 300);
}
