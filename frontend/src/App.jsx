import { NavLink, Outlet } from 'react-router-dom';

export default function App() {
  return (
    <div className="min-h-screen bg-slate-950 bg-[radial-gradient(ellipse_100%_70%_at_50%_-15%,rgba(139,92,246,0.18),transparent_55%)] font-sans text-slate-100 antialiased">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-slate-800 focus:px-3 focus:py-2 focus:text-slate-100 focus:shadow-lg focus:ring-2 focus:ring-violet-500/40"
      >
        Skip to content
      </a>
      <header className="sticky top-0 z-40 border-b border-slate-800/90 bg-slate-950/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3.5 sm:px-6">
          <NavLink
            to="/"
            className={({ isActive }) =>
              `rounded-lg px-1 text-lg font-semibold tracking-tight transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/50 ${
                isActive ? 'text-violet-300' : 'text-slate-100 hover:text-violet-200'
              }`
            }
            end
          >
            Book Studio
          </NavLink>
        </div>
      </header>
      <main id="main" className="min-h-[calc(100vh-3.5rem)]">
        <Outlet />
      </main>
    </div>
  );
}
