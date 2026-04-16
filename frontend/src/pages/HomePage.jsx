import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useToast } from '../context/ToastContext.jsx';
import { Skeleton } from '../components/ui/Skeleton.jsx';
import { api } from '../lib/api.js';

const card =
  'group block rounded-2xl border border-slate-700/80 bg-slate-900/50 p-5 shadow-[0_1px_3px_rgba(0,0,0,0.35)] ring-1 ring-white/4 transition duration-200 hover:border-violet-500/35 hover:bg-slate-900/70 hover:shadow-lg hover:ring-violet-500/15';

function statusClass(status) {
  if (!status) return 'bg-slate-800 text-slate-300 ring-slate-600/80';
  const s = String(status).toLowerCase();
  if (s === 'done') return 'bg-emerald-950/80 text-emerald-300 ring-emerald-700/60';
  if (s === 'compiling') return 'bg-amber-950/80 text-amber-200 ring-amber-700/50';
  if (s === 'error') return 'bg-red-950/80 text-red-300 ring-red-800/60';
  return 'bg-slate-800 text-slate-300 ring-slate-600/80';
}

export default function HomePage() {
  const toast = useToast();
  const [health, setHealth] = useState(null);
  const [books, setBooks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  const load = useCallback(async () => {
    try {
      const [h, list] = await Promise.all([api('/health'), api('/books')]);
      setHealth(h);
      setBooks(list.books ?? []);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleSync() {
    setSyncing(true);
    try {
      const result = await api('/sync-sheet', { method: 'POST' });
      await load();
      const ins = result?.inserted ?? 0;
      const upd = result?.updated ?? 0;
      toast.success(`Sheet synced · ${ins} new, ${upd} updated`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Sync failed');
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 sm:py-12">
      <header className="mb-10 flex flex-col gap-6 sm:mb-12 sm:flex-row sm:items-end sm:justify-between">
        <div className="max-w-xl">
          <h1 className="text-3xl font-semibold tracking-tight text-slate-50 sm:text-4xl">Your books</h1>
          <p className="mt-2 text-pretty text-base leading-relaxed text-slate-400">
            Titles come from Google Sheets. Open a book to review the outline, approve chapters, and run the pipeline.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {health && (
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-medium ring-1 ring-inset ${
                health.backgroundJobs
                  ? 'bg-violet-950/70 text-violet-200 ring-violet-500/35'
                  : 'bg-slate-800/90 text-slate-400 ring-slate-600/80'
              }`}
              title={health.backgroundJobs ? 'Workers and Redis are active' : 'Triggers disabled; list and sync still work'}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${health.backgroundJobs ? 'bg-emerald-400' : 'bg-slate-500'}`}
                aria-hidden
              />
              {health.backgroundJobs ? 'Pipeline online' : 'Pipeline offline'}
            </span>
          )}
          <button
            type="button"
            onClick={handleSync}
            disabled={syncing || loading}
            className="inline-flex items-center justify-center rounded-xl bg-violet-600 px-5 py-2.5 text-sm font-medium text-white shadow-lg shadow-violet-950/40 transition hover:bg-violet-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {syncing ? (
              <>
                <span className="mr-2 inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                Syncing…
              </>
            ) : (
              'Sync from sheet'
            )}
          </button>
        </div>
      </header>

      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="rounded-2xl border border-slate-700/80 bg-slate-900/40 p-5 ring-1 ring-white/3"
            >
              <Skeleton className="h-5 w-3/5" />
              <Skeleton className="mt-4 h-3 w-24" />
            </div>
          ))}
        </div>
      ) : books.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-600/80 bg-slate-900/30 px-8 py-16 text-center ring-1 ring-white/4">
          <p className="text-lg font-medium text-slate-200">No books yet</p>
          <p className="mx-auto mt-2 max-w-md text-pretty text-sm leading-relaxed text-slate-500">
            Add rows in your Google Sheet, then tap <strong className="font-medium text-slate-300">Sync from sheet</strong>{' '}
            to pull them in.
          </p>
        </div>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {books.map((b) => (
            <li key={b.id}>
              <Link to={`/books/${b.id}`} className={card}>
                <div className="flex items-start justify-between gap-3">
                  <h2 className="font-semibold leading-snug text-slate-100 group-hover:text-violet-100">{b.title}</h2>
                  <span
                    className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${statusClass(
                      b.book_output_status
                    )}`}
                  >
                    {b.book_output_status ?? '—'}
                  </span>
                </div>
                {b.created_at && (
                  <p className="mt-4 text-xs text-slate-500">
                    Added {new Date(b.created_at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
                  </p>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
