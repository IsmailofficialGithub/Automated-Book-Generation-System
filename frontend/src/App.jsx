import { NavLink, Outlet } from 'react-router-dom';
import { apiBase } from './lib/api.js';

export default function App() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-slate-100/80">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded focus:bg-white focus:px-3 focus:py-2 focus:shadow"
      >
        Skip to content
      </a>
      <header className="border-b border-slate-200/80 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <NavLink
            to="/"
            className="text-lg font-semibold tracking-tight text-slate-900 hover:text-violet-800"
            end
          >
            Book Studio
          </NavLink>
          <span className="hidden truncate text-xs text-slate-400 sm:inline" title={apiBase}>
            API: {apiBase}
          </span>
        </div>
      </header>
      <main id="main">
        <Outlet />
      </main>
    </div>
  );
}
