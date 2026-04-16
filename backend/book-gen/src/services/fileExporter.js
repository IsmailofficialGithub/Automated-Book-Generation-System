import { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType } from 'docx';
import { supabase } from '../db/supabaseClient.js';
import { logger } from '../config/logger.js';

function buildDocxDocument(book, chapters) {
  const children = [
    new Paragraph({
      heading: HeadingLevel.TITLE,
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: book.title, bold: true, size: 56 })],
    }),
    new Paragraph({ children: [new TextRun('')] }),
  ];

  for (const chapter of chapters) {
    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        children: [new TextRun({ text: `Chapter ${chapter.chapter_number}: ${chapter.title}`, bold: true })],
        pageBreakBefore: chapter.chapter_number > 1,
      })
    );

    const paragraphs = (chapter.content ?? '').split('\n\n');
    for (const para of paragraphs) {
      const trimmed = para.trim();
      if (!trimmed) continue;
      children.push(new Paragraph({ children: [new TextRun({ text: trimmed })] }));
    }
  }

  return new Document({ sections: [{ children }] });
}

function buildTxtContent(book, chapters) {
  const lines = [`${book.title.toUpperCase()}\n${'='.repeat(book.title.length)}\n`];
  for (const chapter of chapters) {
    lines.push(`\n\nCHAPTER ${chapter.chapter_number}: ${chapter.title}`);
    lines.push('-'.repeat(60));
    lines.push(chapter.content ?? '');
  }
  return lines.join('\n');
}

async function uploadToStorage(buffer, fileName, contentType) {
  const { data, error } = await supabase.storage.from('book-outputs').upload(fileName, buffer, {
    contentType,
    upsert: true,
  });
  if (error) throw new Error(`Storage upload failed: ${error.message}`);

  const { data: urlData } = supabase.storage.from('book-outputs').getPublicUrl(data.path);
  return urlData.publicUrl;
}

export async function exportBook(book, chapters) {
  const safeTitle = book.title.replace(/[^a-z0-9]/gi, '_').toLowerCase();
  const timestamp = Date.now();

  logger.info({ bookId: book.id }, 'Generating export files');

  const docxBuffer = await Packer.toBuffer(buildDocxDocument(book, chapters));
  const docx = await uploadToStorage(
    docxBuffer,
    `${safeTitle}_${timestamp}.docx`,
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  );

  const txtBuffer = Buffer.from(buildTxtContent(book, chapters), 'utf-8');
  const txt = await uploadToStorage(txtBuffer, `${safeTitle}_${timestamp}.txt`, 'text/plain');

  return { docx, txt };
}
