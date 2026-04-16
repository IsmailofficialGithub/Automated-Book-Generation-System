import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../lib/api.js';

function chapterStatusClass(status) {
  const s = String(status || '').toLowerCase();
  if (s === 'approved') return 'bg-emerald-50 text-emerald-800 ring-emerald-200';
  if (s === 'draft') return 'bg-sky-50 text-sky-900 ring-sky-200';
  return 'bg-slate-100 text-slate-600 ring-slate-200';
}

export default function BookPage() {
  const { bookId } = useParams();
  const [health, setHealth] = useState(null);
  const [book, setBook] = useState(null);
  const [chapters, setChapters] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null);
  const [finalStatus, setFinalStatus] = useState('no');
  const [finalNotes, setFinalNotes] = useState('');

  const load = useCallback(async () => {
    if (!bookId) return;
    setError(null);
    try {
      const [h, detail] = await Promise.all([api('/health'), api(`/books/${bookId}`)]);
      setHealth(h);
      setBook(detail.book);
      setChapters(detail.chapters ?? []);
      setFinalStatus(detail.book?.final_review_notes_status ?? 'no');
      setFinalNotes(detail.book?.final_review_notes ?? '');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load book');
    } finally {
      setLoading(false);
    }
  }, [bookId]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  async function approveChapter(chapterId) {
    if (!bookId) return;
    setBusy(`approve-${chapterId}`);
    setError(null);
    try {
      await api(`/books/${bookId}/chapters/${chapterId}/approve`, { method: 'POST' });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Approve failed');
    } finally {
      setBusy(null);
    }
  }

  async function submitFinalReview(e) {
    e.preventDefault();
    if (!bookId) return;
    setBusy('final');
    setError(null);
    try {
      await api(`/books/${bookId}/final-review`, {
        method: 'POST',
        body: {
          status: finalStatus,
          notes: finalNotes.trim() ? finalNotes.trim() : null,
        },
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setBusy(null);
    }
  }

  async function trigger(kind) {
    if (!bookId) return;
    setBusy(`trigger-${kind}`);
    setError(null);
    try {
      await api(`/trigger/${kind}`, { method: 'POST', body: { bookId } });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Trigger failed');
    } finally {
      setBusy(null);
    }
  }

  const jobsOn = health?.backgroundJobs;

  if (loading && !book) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-10 text-slate-500">
        <p>Loading…</p>
      </div>
    );
  }

  if (!book) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-10">
        <p className="text-red-700">{error || 'Book not found.'}</p>
        <Link to="/" className="mt-4 inline-block text-sm font-medium text-violet-700 hover:text-violet-900">
          ← Back to books
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
      <div className="mb-6">
        <Link to="/" className="text-sm font-medium text-violet-700 hover:text-violet-900">
          ← All books
        </Link>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">{book.title}</h1>
        <p className="mt-1 text-sm text-slate-500">
          Output: <span className="font-medium text-slate-700">{book.book_output_status ?? '—'}</span>
        </p>
      </div>

      {error && (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">
          {error}
        </div>
      )}

      {(book.output_url_docx || book.output_url_pdf || book.output_url_txt) && (
        <section className="mb-8 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Downloads</h2>
          <ul className="mt-3 flex flex-wrap gap-3">
            {book.output_url_docx && (
              <li>
                <a
                  href={book.output_url_docx}
                  target="_blank"
                  rel="noreferrer"
                  className="text-sm font-medium text-violet-700 underline-offset-2 hover:underline"
                >
                  DOCX
                </a>
              </li>
            )}
            {book.output_url_pdf && (
              <li>
                <a
                  href={book.output_url_pdf}
                  target="_blank"
                  rel="noreferrer"
                  className="text-sm font-medium text-violet-700 underline-offset-2 hover:underline"
                >
                  PDF
                </a>
              </li>
            )}
            {book.output_url_txt && (
              <li>
                <a
                  href={book.output_url_txt}
                  target="_blank"
                  rel="noreferrer"
                  className="text-sm font-medium text-violet-700 underline-offset-2 hover:underline"
                >
                  TXT
                </a>
              </li>
            )}
          </ul>
        </section>
      )}

      <section className="mb-8 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Pipeline</h2>
        <p className="mt-2 text-sm text-slate-600">
          Manual triggers enqueue work in Redis. They are only available when the server runs with background jobs.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={!jobsOn || busy}
            onClick={() => trigger('outline')}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-800 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy === 'trigger-outline' ? 'Queuing…' : 'Queue outline'}
          </button>
          <button
            type="button"
            disabled={!jobsOn || busy}
            onClick={() => trigger('chapters')}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-800 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy === 'trigger-chapters' ? 'Queuing…' : 'Queue chapters'}
          </button>
          <button
            type="button"
            disabled={!jobsOn || busy}
            onClick={() => trigger('compile')}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-800 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy === 'trigger-compile' ? 'Queuing…' : 'Queue compile'}
          </button>
        </div>
        {!jobsOn && (
          <p className="mt-3 text-xs text-amber-800">
            Set <code className="rounded bg-amber-100 px-1">ENABLE_BACKGROUND_JOBS=true</code> and run Redis to
            enable triggers.
          </p>
        )}
      </section>

      <section className="mb-8 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Outline workflow</h2>
        <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-slate-500">Outline notes status</dt>
            <dd className="font-medium text-slate-900">{book.status_outline_notes ?? '—'}</dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-slate-500">Notes before outline</dt>
            <dd className="mt-1 whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-slate-800">
              {book.notes_on_outline_before || '—'}
            </dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-slate-500">Notes after outline</dt>
            <dd className="mt-1 whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-slate-800">
              {book.notes_on_outline_after || '—'}
            </dd>
          </div>
        </dl>
        {book.outline && (
          <div className="mt-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Current outline</h3>
            <pre className="mt-2 max-h-80 overflow-auto rounded-lg bg-slate-900/5 p-4 text-xs leading-relaxed text-slate-800">
              {book.outline}
            </pre>
          </div>
        )}
      </section>

      <section className="mb-8 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Chapters</h2>
        {chapters.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">No chapters yet.</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500">
                  <th className="pb-2 pr-4 font-medium">#</th>
                  <th className="pb-2 pr-4 font-medium">Title</th>
                  <th className="pb-2 pr-4 font-medium">Status</th>
                  <th className="pb-2 pr-4 font-medium">Notes</th>
                  <th className="pb-2 font-medium">Action</th>
                </tr>
              </thead>
              <tbody>
                {chapters.map((c) => (
                  <tr key={c.id} className="border-b border-slate-100">
                    <td className="py-3 pr-4 align-top">{c.chapter_number}</td>
                    <td className="py-3 pr-4 align-top font-medium text-slate-900">{c.title}</td>
                    <td className="py-3 pr-4 align-top">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${chapterStatusClass(
                          c.status
                        )}`}
                      >
                        {c.status}
                      </span>
                    </td>
                    <td className="py-3 pr-4 align-top text-slate-600">{c.chapter_notes_status ?? '—'}</td>
                    <td className="py-3 align-top">
                      {c.status !== 'approved' ? (
                        <button
                          type="button"
                          disabled={!!busy}
                          onClick={() => approveChapter(c.id)}
                          className="rounded-md bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                        >
                          {busy === `approve-${c.id}` ? '…' : 'Approve'}
                        </button>
                      ) : (
                        <span className="text-xs text-slate-400">Done</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Final review</h2>
        <form onSubmit={submitFinalReview} className="mt-4 space-y-4">
          <div>
            <label htmlFor="final-status" className="block text-sm font-medium text-slate-700">
              Status
            </label>
            <select
              id="final-status"
              value={finalStatus}
              onChange={(e) => setFinalStatus(e.target.value)}
              className="mt-1 block w-full max-w-xs rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
            >
              <option value="no">no</option>
              <option value="yes">yes</option>
              <option value="no_notes_needed">no_notes_needed</option>
            </select>
          </div>
          <div>
            <label htmlFor="final-notes" className="block text-sm font-medium text-slate-700">
              Notes (optional)
            </label>
            <textarea
              id="final-notes"
              rows={4}
              value={finalNotes}
              onChange={(e) => setFinalNotes(e.target.value)}
              className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
            />
          </div>
          <button
            type="submit"
            disabled={busy === 'final'}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-slate-800 disabled:opacity-50"
          >
            {busy === 'final' ? 'Saving…' : 'Save final review'}
          </button>
        </form>
      </section>
    </div>
  );
}
