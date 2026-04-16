import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useToast } from '../context/ToastContext.jsx';
import { api } from '../lib/api.js';

function statusClass(status) {
  if (!status) return 'bg-slate-100 text-slate-700 ring-slate-200';
  const s = String(status).toLowerCase();
  if (s === 'done') return 'bg-emerald-50 text-emerald-800 ring-emerald-200';
  if (s === 'compiling') return 'bg-amber-50 text-amber-900 ring-amber-200';
  if (s === 'error') return 'bg-red-50 text-red-800 ring-red-200';
  return 'bg-slate-100 text-slate-700 ring-slate-200';
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
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      <header className="mb-10 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">Books</h1>
          <p className="mt-1 text-sm text-slate-600">
            Synced from Google Sheets · approvals and pipeline actions use the API
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {health && (
            <span
              className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium ring-1 ring-inset ${
                health.backgroundJobs
                  ? 'bg-violet-50 text-violet-800 ring-violet-200'
                  : 'bg-slate-100 text-slate-600 ring-slate-200'
              }`}
            >
              {health.backgroundJobs ? 'Background jobs on' : 'API only (no queue)'}
            </span>
          )}
          <button
            type="button"
            onClick={handleSync}
            disabled={syncing}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {syncing ? 'Syncing…' : 'Sync from sheet'}
          </button>
        </div>
      </header>

      {loading ? (
        <p className="text-slate-500">Loading…</p>
      ) : books.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/80 px-6 py-12 text-center">
          <p className="text-slate-600">No books yet.</p>
          <p className="mt-2 text-sm text-slate-500">Add rows in your Google Sheet, then use “Sync from sheet”.</p>
        </div>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {books.map((b) => (
            <li key={b.id}>
              <Link
                to={`/books/${b.id}`}
                className="block rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-violet-300 hover:shadow-md"
              >
                <div className="flex items-start justify-between gap-3">
                  <h2 className="font-medium text-slate-900">{b.title}</h2>
                  <span
                    className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${statusClass(
                      b.book_output_status
                    )}`}
                  >
                    {b.book_output_status ?? '—'}
                  </span>
                </div>
                {b.created_at && (
                  <p className="mt-3 text-xs text-slate-500">
                    Created {new Date(b.created_at).toLocaleString()}
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
