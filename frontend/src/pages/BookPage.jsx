import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useToast } from '../context/ToastContext.jsx';
import { Skeleton } from '../components/ui/Skeleton.jsx';
import { api } from '../lib/api.js';
import { parseChaptersFromOutline } from '../lib/outline.js';

const section =
  'mb-8 rounded-2xl border border-slate-700/80 bg-slate-900/45 p-5 shadow-[0_1px_3px_rgba(0,0,0,0.4)] ring-1 ring-white/4 sm:p-6';
const btnSecondary =
  'rounded-xl border border-slate-600 bg-slate-800/80 px-4 py-2.5 text-sm font-medium text-slate-100 shadow-sm transition hover:bg-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/40 disabled:cursor-not-allowed disabled:opacity-45';
const btnPrimary =
  'rounded-xl bg-violet-600 px-5 py-2.5 text-sm font-medium text-white shadow-lg shadow-violet-950/40 transition hover:bg-violet-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/50 disabled:opacity-50';
const inputClass =
  'mt-1 block w-full rounded-xl border border-slate-600 bg-slate-800/80 px-3 py-2.5 text-sm text-slate-100 shadow-inner transition placeholder:text-slate-500 focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-500/25';

/** Poll interval while book page is open (ms). */
const LIVE_POLL_MS = 5000;

function chapterStatusClass(status) {
  const s = String(status || '').toLowerCase();
  if (s === 'approved') return 'bg-emerald-950/80 text-emerald-300 ring-emerald-700/50';
  if (s === 'draft') return 'bg-sky-950/80 text-sky-300 ring-sky-700/50';
  return 'bg-slate-800 text-slate-400 ring-slate-600/80';
}

function BookDetailSkeleton() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
      <Skeleton className="h-4 w-32" />
      <Skeleton className="mt-6 h-10 w-4/5 max-w-lg" />
      <Skeleton className="mt-3 h-4 w-40" />
      <div className="mt-10 space-y-8">
        <div className={`${section} space-y-3`}>
          <Skeleton className="h-5 w-full max-w-md" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
        </div>
        <div className={`${section}`}>
          <Skeleton className="h-5 w-28" />
          <Skeleton className="mt-4 h-10 w-40" />
        </div>
      </div>
    </div>
  );
}

export default function BookPage() {
  const toast = useToast();
  const { bookId } = useParams();
  const [health, setHealth] = useState(null);
  const [book, setBook] = useState(null);
  const [chapters, setChapters] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null);
  const [finalStatus, setFinalStatus] = useState('no');
  const [finalNotes, setFinalNotes] = useState('');
  /** Selected chapter # for single-chapter queue (string for select value). */
  const [singleChapterPick, setSingleChapterPick] = useState('');
  const [lastSyncedAt, setLastSyncedAt] = useState(null);
  /** Avoid overwriting final review fields while user is editing (async poll). */
  const finalFormFocusedRef = useRef(false);

  const load = useCallback(
    async (opts = {}) => {
      const silent = opts.silent === true;
      if (!bookId) return;
      if (!silent) {
        setError(null);
        setLoading(true);
      }
      try {
        const [h, detail] = await Promise.all([api('/health'), api(`/books/${bookId}`)]);
        setHealth(h);
        setBook(detail.book);
        setChapters(detail.chapters ?? []);
        if (!finalFormFocusedRef.current) {
          setFinalStatus(detail.book?.final_review_notes_status ?? 'no');
          setFinalNotes(detail.book?.final_review_notes ?? '');
        }
        setLastSyncedAt(new Date());
      } catch (e) {
        if (!silent) {
          const msg = e instanceof Error ? e.message : 'Failed to load book';
          setError(msg);
          toast.error(msg);
        }
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [bookId, toast]
  );

  useEffect(() => {
    load({ silent: false });
  }, [load]);

  useEffect(() => {
    if (!bookId) return;
    const id = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      load({ silent: true });
    }, LIVE_POLL_MS);
    return () => window.clearInterval(id);
  }, [bookId, load]);

  useEffect(() => {
    if (!bookId) return;
    const onVis = () => {
      if (document.visibilityState === 'visible') load({ silent: true });
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [bookId, load]);

  async function approveChapter(chapterId) {
    if (!bookId) return;
    setBusy(`approve-${chapterId}`);
    try {
      await api(`/books/${bookId}/chapters/${chapterId}/approve`, { method: 'POST' });
      await load({ silent: true });
      toast.success('Chapter approved');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Approve failed');
    } finally {
      setBusy(null);
    }
  }

  async function submitFinalReview(e) {
    e.preventDefault();
    if (!bookId) return;
    setBusy('final');
    try {
      await api(`/books/${bookId}/final-review`, {
        method: 'POST',
        body: {
          status: finalStatus,
          notes: finalNotes.trim() ? finalNotes.trim() : null,
        },
      });
      await load({ silent: true });
      toast.success('Final review saved');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setBusy(null);
    }
  }

  async function trigger(kind) {
    if (!bookId) return;
    setBusy(`trigger-${kind}`);
    try {
      const data = await api(`/trigger/${kind}`, { method: 'POST', body: { bookId } });
      await load({ silent: true });
      toast.success(data?.message ?? 'Job queued');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Trigger failed');
    } finally {
      setBusy(null);
    }
  }

  async function triggerSingleChapter(chapterNumber) {
    if (!bookId || !Number.isFinite(chapterNumber)) return;
    setBusy(`chapter-${chapterNumber}`);
    try {
      const data = await api('/trigger/chapter', {
        method: 'POST',
        body: { bookId, chapterNumber },
      });
      await load({ silent: true });
      toast.success(data?.message ?? `Chapter ${chapterNumber} queued`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to queue chapter');
    } finally {
      setBusy(null);
    }
  }

  const jobsOn = health?.backgroundJobs;

  const outlineChapters = useMemo(() => parseChaptersFromOutline(book?.outline), [book?.outline]);
  const existingChapterNumbers = useMemo(() => new Set(chapters.map((c) => c.chapter_number)), [chapters]);
  const missingFromDb = useMemo(
    () => outlineChapters.filter((p) => !existingChapterNumbers.has(p.number)),
    [outlineChapters, existingChapterNumbers]
  );

  useEffect(() => {
    if (!outlineChapters.length) {
      setSingleChapterPick('');
      return;
    }
    setSingleChapterPick((prev) => {
      if (prev && outlineChapters.some((c) => String(c.number) === prev)) return prev;
      return String(outlineChapters[0].number);
    });
  }, [outlineChapters]);

  if (loading && !book) {
    return <BookDetailSkeleton />;
  }

  if (!book) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16 sm:px-6">
        <div className="rounded-2xl border border-slate-700/80 bg-slate-900/50 p-8 text-center ring-1 ring-white/4">
          <p className="text-lg font-medium text-slate-100">{error || 'Book not found'}</p>
          <p className="mt-2 text-sm text-slate-500">Check the link or sync from your sheet again.</p>
          <Link
            to="/"
            className="mt-6 inline-flex rounded-xl bg-violet-600 px-5 py-2.5 text-sm font-medium text-white shadow-lg shadow-violet-950/40 transition hover:bg-violet-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/50"
          >
            Back to books
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6 sm:py-12">
      <div className="mb-10">
        <Link
          to="/"
          className="inline-flex items-center gap-1 text-sm font-medium text-violet-400 transition hover:text-violet-300 focus-visible:rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/40"
        >
          <span aria-hidden className="text-base leading-none">
            ←
          </span>
          All books
        </Link>
        <h1 className="mt-4 text-pretty text-3xl font-semibold tracking-tight text-slate-50 sm:text-4xl">{book.title}</h1>
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-slate-400">
          <span>
            Output:{' '}
            <span className="font-semibold text-slate-100">{book.book_output_status ?? '—'}</span>
          </span>
          <span className="inline-flex items-center gap-2 text-xs text-slate-500">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-800/80 px-2 py-0.5 ring-1 ring-slate-600/80">
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(52,211,153,0.6)]" aria-hidden />
              Live refresh
            </span>
            {lastSyncedAt && (
              <time dateTime={lastSyncedAt.toISOString()} title={lastSyncedAt.toISOString()}>
                {lastSyncedAt.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </time>
            )}
          </span>
        </div>
      </div>

      <div className={`${section} text-sm leading-relaxed text-slate-400`}>
        <p className="font-semibold text-slate-100">How this pipeline works</p>
        <ul className="mt-3 list-inside list-disc space-y-2 marker:text-violet-500/80">
          <li>
            <strong className="font-medium text-slate-200">Queue outline</strong> — generates or regenerates the outline
            from your notes.
          </li>
          <li>
            <strong className="font-medium text-slate-200">Queue chapters</strong> — runs only when{' '}
            <strong className="font-medium text-slate-200">Outline notes status</strong> is{' '}
            <code className="rounded-md bg-slate-800 px-1.5 py-0.5 text-xs text-violet-200 ring-1 ring-slate-600/80">
              no_notes_needed
            </code>{' '}
            (set in Sheets, then sync).
          </li>
          <li>
            <strong className="font-medium text-slate-200">Queue compile</strong> — builds files when chapters are
            approved and final review rules pass.
          </li>
          <li>
            <strong className="font-medium text-slate-200">One chapter</strong> — queue a single chapter by number
            (matches lines in your outline like <code className="text-xs">1. Chapter title</code>).
          </li>
        </ul>
      </div>

      {book.status_outline_notes !== 'no_notes_needed' && (
        <div className="mb-8 rounded-2xl border border-amber-600/40 bg-amber-950/40 px-5 py-4 text-sm leading-relaxed text-amber-100 ring-1 ring-amber-500/20">
          Chapters wait until <strong>Outline notes status</strong> is{' '}
          <code className="rounded-md bg-amber-950/80 px-1.5 py-0.5 text-xs text-amber-200 ring-1 ring-amber-700/50">
            no_notes_needed
          </code>
          . Update the sheet, sync from the home page, then queue chapters again.
        </div>
      )}

      {(book.output_url_docx || book.output_url_pdf || book.output_url_txt) && (
        <section className={section}>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">Downloads</h2>
          <ul className="mt-4 flex flex-wrap gap-3">
            {book.output_url_docx && (
              <li>
                <a
                  href={book.output_url_docx}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex rounded-xl border border-violet-500/35 bg-violet-950/50 px-4 py-2 text-sm font-medium text-violet-200 transition hover:bg-violet-900/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/40"
                >
                  Open DOCX
                </a>
              </li>
            )}
            {book.output_url_pdf && (
              <li>
                <a
                  href={book.output_url_pdf}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex rounded-xl border border-violet-500/35 bg-violet-950/50 px-4 py-2 text-sm font-medium text-violet-200 transition hover:bg-violet-900/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/40"
                >
                  Open PDF
                </a>
              </li>
            )}
            {book.output_url_txt && (
              <li>
                <a
                  href={book.output_url_txt}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex rounded-xl border border-violet-500/35 bg-violet-950/50 px-4 py-2 text-sm font-medium text-violet-200 transition hover:bg-violet-900/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/40"
                >
                  Open TXT
                </a>
              </li>
            )}
          </ul>
        </section>
      )}

      <section className={section}>
        <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">Pipeline</h2>
        <p className="mt-2 text-sm leading-relaxed text-slate-400">
          Manual jobs need Redis and{' '}
          <code className="rounded bg-slate-800 px-1.5 py-0.5 text-xs text-slate-300 ring-1 ring-slate-600/80">
            ENABLE_BACKGROUND_JOBS=true
          </code>
          .
        </p>
        <div className="mt-5 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={!jobsOn || busy}
            onClick={() => trigger('outline')}
            className={btnSecondary}
          >
            {busy === 'trigger-outline' ? 'Queuing…' : 'Queue outline'}
          </button>
          <button
            type="button"
            disabled={!jobsOn || busy}
            onClick={() => trigger('chapters')}
            className={btnSecondary}
          >
            {busy === 'trigger-chapters' ? 'Queuing…' : 'Queue chapters'}
          </button>
          <button
            type="button"
            disabled={!jobsOn || busy}
            onClick={() => trigger('compile')}
            className={btnSecondary}
          >
            {busy === 'trigger-compile' ? 'Queuing…' : 'Queue compile'}
          </button>
        </div>
        {!jobsOn && (
          <p className="mt-4 text-xs leading-relaxed text-amber-200/90">
            Pipeline triggers are off. Enable background jobs and Redis to use these buttons.
          </p>
        )}
      </section>

      <section className={section}>
        <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">Outline workflow</h2>
        <dl className="mt-4 grid gap-4 text-sm">
          <div>
            <dt className="text-slate-500">Outline notes status</dt>
            <dd className="mt-1 font-semibold text-slate-100">{book.status_outline_notes ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Notes before outline</dt>
            <dd className="mt-2 whitespace-pre-wrap rounded-xl bg-slate-950/50 p-4 text-slate-300 ring-1 ring-slate-700/80">
              {book.notes_on_outline_before || '—'}
            </dd>
          </div>
          <div>
            <dt className="text-slate-500">Notes after outline</dt>
            <dd className="mt-2 whitespace-pre-wrap rounded-xl bg-slate-950/50 p-4 text-slate-300 ring-1 ring-slate-700/80">
              {book.notes_on_outline_after || '—'}
            </dd>
          </div>
        </dl>
        {book.outline && (
          <div className="mt-6">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">Current outline</h3>
            <pre className="mt-3 max-h-80 overflow-auto rounded-xl bg-black/30 p-4 text-xs leading-relaxed text-slate-300 ring-1 ring-slate-700/80">
              {book.outline}
            </pre>
          </div>
        )}
      </section>

      <section className={section}>
        <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">Chapters</h2>
        <p className="mt-2 text-sm leading-relaxed text-slate-500">
          Generate one chapter at a time, or approve drafts when you are ready. Outline must list each chapter (e.g.{' '}
          <code className="rounded bg-slate-800 px-1 text-xs text-slate-300">1. Introduction</code>).
        </p>

        {outlineChapters.length > 0 && jobsOn && (
          <div className="mt-5 flex flex-col gap-3 rounded-xl bg-slate-950/50 p-4 ring-1 ring-slate-700/80 sm:flex-row sm:items-end sm:gap-4">
            <div className="min-w-0 flex-1">
              <label htmlFor="single-chapter" className="block text-xs font-medium uppercase tracking-wide text-slate-500">
                Generate one chapter
              </label>
              <select
                id="single-chapter"
                value={singleChapterPick}
                onChange={(e) => setSingleChapterPick(e.target.value)}
                className={`${inputClass} mt-1.5 max-w-full sm:max-w-md`}
              >
                {outlineChapters.map((c) => (
                  <option key={c.number} value={String(c.number)}>
                    {c.number}. {c.title}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="button"
              disabled={!singleChapterPick || !!busy}
              onClick={() => triggerSingleChapter(Number(singleChapterPick))}
              className="shrink-0 rounded-xl border border-violet-500/40 bg-violet-950/50 px-4 py-2.5 text-sm font-medium text-violet-200 transition hover:bg-violet-900/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/40 disabled:cursor-not-allowed disabled:opacity-45"
            >
              {busy === `chapter-${singleChapterPick}` ? 'Queuing…' : 'Queue this chapter'}
            </button>
          </div>
        )}

        {outlineChapters.length > 0 && !jobsOn && (
          <p className="mt-4 text-xs leading-relaxed text-slate-500">
            Turn on background jobs and Redis to use single-chapter generation.
          </p>
        )}

        {outlineChapters.length === 0 && book?.outline && (
          <p className="mt-4 rounded-lg bg-amber-950/30 px-3 py-2 text-xs text-amber-200/90 ring-1 ring-amber-800/40">
            No chapters parsed from the outline. Use lines like <code className="text-amber-100">1. Your title</code> or{' '}
            <code className="text-amber-100">Chapter 1: Your title</code>.
          </p>
        )}

        {missingFromDb.length > 0 && (
          <div className="mt-5 rounded-xl border border-slate-700/80 bg-slate-950/40 p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">In outline, not generated yet</p>
            <ul className="mt-3 space-y-2">
              {missingFromDb.map((m) => (
                <li
                  key={m.number}
                  className="flex flex-wrap items-center justify-between gap-2 gap-y-2 text-sm text-slate-300"
                >
                  <span>
                    <span className="font-medium text-slate-100">{m.number}.</span> {m.title}
                  </span>
                  <button
                    type="button"
                    disabled={!jobsOn || !!busy}
                    onClick={() => triggerSingleChapter(m.number)}
                    className="rounded-lg border border-slate-600 bg-slate-800/90 px-3 py-1 text-xs font-medium text-slate-100 transition hover:bg-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/40 disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    {busy === `chapter-${m.number}` ? 'Queuing…' : 'Queue'}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {chapters.length === 0 ? (
          <p className="mt-6 text-sm text-slate-500">
            No chapter rows in the database yet — use the controls above or <strong className="text-slate-400">Queue chapters</strong> in the pipeline to fill them in order.
          </p>
        ) : (
          <div className="mt-6 overflow-x-auto rounded-xl ring-1 ring-slate-700/80">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-slate-800/90 text-slate-400">
                <tr>
                  <th className="px-4 py-3 font-medium">#</th>
                  <th className="px-4 py-3 font-medium">Title</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Notes</th>
                  <th className="px-4 py-3 font-medium">Queue</th>
                  <th className="px-4 py-3 font-medium">Approve</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/90 bg-slate-900/30">
                {chapters.map((c) => {
                  const canQueueSingle = jobsOn && c.status !== 'approved';
                  return (
                    <tr key={c.id} className="transition hover:bg-slate-800/50">
                      <td className="px-4 py-3 align-middle text-slate-500">{c.chapter_number}</td>
                      <td className="px-4 py-3 align-middle font-medium text-slate-100">{c.title}</td>
                      <td className="px-4 py-3 align-middle">
                        <span
                          className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${chapterStatusClass(
                            c.status
                          )}`}
                        >
                          {c.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 align-middle text-slate-400">{c.chapter_notes_status ?? '—'}</td>
                      <td className="px-4 py-3 align-middle">
                        <button
                          type="button"
                          disabled={!canQueueSingle || !!busy}
                          title={!jobsOn ? 'Enable background jobs' : c.status === 'approved' ? 'Already approved' : 'Queue this chapter only'}
                          onClick={() => triggerSingleChapter(c.chapter_number)}
                          className="rounded-lg border border-slate-600 bg-slate-800/90 px-2.5 py-1 text-xs font-medium text-slate-100 transition hover:bg-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/40 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          {busy === `chapter-${c.chapter_number}` ? '…' : 'Queue'}
                        </button>
                      </td>
                      <td className="px-4 py-3 align-middle">
                        {c.status !== 'approved' ? (
                          <button
                            type="button"
                            disabled={!!busy}
                            onClick={() => approveChapter(c.id)}
                            className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white shadow-sm transition hover:bg-emerald-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/50 disabled:opacity-50"
                          >
                            {busy === `approve-${c.id}` ? '…' : 'Approve'}
                          </button>
                        ) : (
                          <span className="text-xs text-slate-500">Done</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section
        className={`${section} mb-0`}
        onFocusCapture={() => {
          finalFormFocusedRef.current = true;
        }}
        onBlurCapture={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget)) finalFormFocusedRef.current = false;
        }}
      >
        <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">Final review</h2>
        <p className="mt-1 text-xs text-slate-500">Refreshes every {LIVE_POLL_MS / 1000}s while this page is open. Editing here pauses overwriting your draft from the server.</p>
        <form onSubmit={submitFinalReview} className="mt-5 space-y-5">
          <div>
            <label htmlFor="final-status" className="block text-sm font-medium text-slate-300">
              Status
            </label>
            <select
              id="final-status"
              value={finalStatus}
              onChange={(e) => setFinalStatus(e.target.value)}
              className={`${inputClass} max-w-xs`}
            >
              <option value="no">no</option>
              <option value="yes">yes</option>
              <option value="no_notes_needed">no_notes_needed</option>
            </select>
          </div>
          <div>
            <label htmlFor="final-notes" className="block text-sm font-medium text-slate-300">
              Notes (optional)
            </label>
            <textarea id="final-notes" rows={4} value={finalNotes} onChange={(e) => setFinalNotes(e.target.value)} className={inputClass} />
          </div>
          <button type="submit" disabled={busy === 'final'} className={btnPrimary}>
            {busy === 'final' ? 'Saving…' : 'Save final review'}
          </button>
        </form>
      </section>
    </div>
  );
}
