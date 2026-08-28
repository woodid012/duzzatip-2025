'use client';

// Shared loading-skeleton / error-with-retry / empty-state cards so every
// /finals page renders consistent placeholders.

export function LoadingSkeleton({ rows = 4 }) {
  return (
    <div className="space-y-3">
      {[...Array(rows)].map((_, i) => (
        <div key={i} className="dz-surface p-4 h-16 animate-pulse bg-slate-100" />
      ))}
    </div>
  );
}

export function ErrorCard({ message, onRetry }) {
  return (
    <div className="dz-surface p-6 text-center">
      <p className="text-red-600 mb-3 text-sm font-medium">{message || 'Something went wrong.'}</p>
      {onRetry && (
        <button onClick={onRetry} className="dz-btn-primary">Retry</button>
      )}
    </div>
  );
}

export function EmptyCard({ title, children }) {
  return (
    <div className="dz-surface p-8 text-center">
      {title && <h3 className="dz-title mb-1">{title}</h3>}
      {children && <p className="dz-subtitle">{children}</p>}
    </div>
  );
}
