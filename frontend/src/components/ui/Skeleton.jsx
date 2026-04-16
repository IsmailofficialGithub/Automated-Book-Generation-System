/** @param {{ className?: string }} props */
export function Skeleton({ className = '' }) {
  return <div className={`animate-pulse rounded-xl bg-slate-700/60 ${className}`} aria-hidden />;
}
