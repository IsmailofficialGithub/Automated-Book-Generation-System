import nodemailer from 'nodemailer';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

const transporter = nodemailer.createTransport({
  host: env.SMTP_HOST,
  port: env.SMTP_PORT,
  secure: env.SMTP_PORT === 465,
  auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
});

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
        sections: [{ activityTitle: title, activityText: message }],
      }),
    });
    logger.info({ title }, 'Teams notification sent');
  } catch (err) {
    logger.error({ err, title }, 'Failed to send Teams notification');
  }
}

export async function notifyOutlineReady(bookTitle, bookId) {
  const subject = `[Book Gen] Outline ready for review - "${bookTitle}"`;
  const body = `The outline for "${bookTitle}" has been generated and is ready for your review.\n\nBook ID: ${bookId}`;
  await Promise.all([sendEmail(subject, body), sendTeamsNotification(subject, body)]);
}

export async function notifyChapterReady(bookTitle, chapterNumber, chapterId) {
  const subject = `[Book Gen] Chapter ${chapterNumber} ready for review - "${bookTitle}"`;
  const body = `Chapter ${chapterNumber} of "${bookTitle}" has been generated.\n\nChapter ID: ${chapterId}\n\nPlease review and update chapter_notes_status:\n- "no_notes_needed" to approve\n- "yes" to add notes and regenerate`;
  await Promise.all([sendEmail(subject, body), sendTeamsNotification(subject, body)]);
}

export async function notifyPaused(bookTitle, stage, reason) {
  const subject = `[Book Gen] Paused at "${stage}" - "${bookTitle}"`;
  const body = `The book generation pipeline is paused.\n\nBook: "${bookTitle}"\nStage: ${stage}\nReason: ${reason}`;
  await Promise.all([sendEmail(subject, body), sendTeamsNotification(subject, body)]);
}

export async function notifyBookComplete(bookTitle, outputUrls) {
  const subject = `[Book Gen] Final draft complete - "${bookTitle}"`;
  const urlLines = Object.entries(outputUrls)
    .filter(([, url]) => url)
    .map(([fmt, url]) => `${fmt.toUpperCase()}: ${url}`)
    .join('\n');
  const body = `The final draft of "${bookTitle}" is ready!\n\nDownload links:\n${urlLines}`;
  await Promise.all([sendEmail(subject, body), sendTeamsNotification(subject, body)]);
}

export async function notifyError(bookTitle, stage, error) {
  const subject = `[Book Gen] ERROR at "${stage}" - "${bookTitle}"`;
  const body = `An error occurred during book generation.\n\nBook: "${bookTitle}"\nStage: ${stage}\nError: ${error.message}`;
  await Promise.all([sendEmail(subject, body), sendTeamsNotification(subject, body)]);
}
