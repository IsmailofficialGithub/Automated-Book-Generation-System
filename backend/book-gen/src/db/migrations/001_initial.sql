CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE books (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title TEXT NOT NULL,
  notes_on_outline_before TEXT,
  outline TEXT,
  notes_on_outline_after TEXT,
  status_outline_notes TEXT DEFAULT 'no'
    CHECK (status_outline_notes IN ('yes', 'no', 'no_notes_needed')),
  final_review_notes_status TEXT DEFAULT 'no'
    CHECK (final_review_notes_status IN ('yes', 'no', 'no_notes_needed')),
  final_review_notes TEXT,
  book_output_status TEXT DEFAULT 'pending'
    CHECK (book_output_status IN ('pending', 'compiling', 'done', 'error')),
  output_url_docx TEXT,
  output_url_pdf TEXT,
  output_url_txt TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE chapters (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  book_id UUID NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  chapter_number INTEGER NOT NULL,
  title TEXT,
  content TEXT,
  summary TEXT,
  chapter_notes TEXT,
  chapter_notes_status TEXT DEFAULT 'no'
    CHECK (chapter_notes_status IN ('yes', 'no', 'no_notes_needed')),
  status TEXT DEFAULT 'pending'
    CHECK (status IN ('pending', 'draft', 'approved', 'error')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(book_id, chapter_number)
);

CREATE TABLE outline_drafts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  book_id UUID NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE notes_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  book_id UUID NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  chapter_id UUID REFERENCES chapters(id) ON DELETE SET NULL,
  stage TEXT NOT NULL,
  note_text TEXT NOT NULL,
  added_at TIMESTAMPTZ DEFAULT NOW()
);

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

CREATE INDEX idx_chapters_book_id ON chapters(book_id);
CREATE INDEX idx_chapters_status ON chapters(status);
CREATE INDEX idx_notes_log_book_id ON notes_log(book_id);
CREATE INDEX idx_outline_drafts_book_id ON outline_drafts(book_id);
