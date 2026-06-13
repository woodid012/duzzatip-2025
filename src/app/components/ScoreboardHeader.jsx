'use client';

// Shared dark "broadcast scoreboard" header used across all pages so the app
// has one consistent theme. `eyebrow` is the small amber kicker, `title` the
// big display heading, and any `children` render as right-aligned controls
// (e.g. a round/user <select> styled with `dz-select-dark`).
export default function ScoreboardHeader({ eyebrow, title, children, className = '' }) {
  return (
    <div
      className={`mb-6 rounded-[22px] bg-gradient-to-br from-slate-900 via-slate-800 to-[#0b1120] px-5 py-5 text-white shadow-[0_18px_40px_-22px_rgba(15,23,42,0.55)] sm:px-[30px] sm:py-[26px] ${className}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-4 sm:gap-6">
        <div className="min-w-0">
          {eyebrow && (
            <div className="mb-2 text-[11px] font-bold uppercase tracking-[0.18em] text-amber-400">
              {eyebrow}
            </div>
          )}
          <h1 className="text-[28px] font-black leading-none tracking-[-0.03em] sm:text-[40px]">
            {title}
          </h1>
        </div>
        {children && (
          <div className="flex flex-shrink-0 flex-col items-end gap-3">{children}</div>
        )}
      </div>
    </div>
  );
}
