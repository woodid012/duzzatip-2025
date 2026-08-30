'use client';

import { useEffect, useRef, useState } from 'react';

// Grouped, searchable player picker for team selection. `playersByTeam` is
// { ABBREV: [{ id, name, teamName }] } from GET /api/duzza-finals/players.
// `value` is { player, club } or null; onChange(player, club) fires on pick
// (both null when cleared).
export default function PlayerSelect({
  playersByTeam = {},
  value,
  onChange,
  disabled = false,
  placeholder = 'Select player',
  className = '',
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [clubFilter, setClubFilter] = useState(null); // abbrev | null = all clubs
  const containerRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    const handleClick = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setIsOpen(false);
        setSearch('');
        setClubFilter(null);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const clubs = Object.keys(playersByTeam).sort();
  const q = search.trim().toLowerCase();
  const selectedLabel = value?.player ? `${value.player} (${value.club})` : '';

  const groups = clubs
    .filter((club) => !clubFilter || club === clubFilter)
    .map((club) => ({
      club,
      players: (playersByTeam[club] || [])
        .filter((p) => !q || p.name.toLowerCase().includes(q) || club.toLowerCase().includes(q))
        .sort((a, b) => a.name.localeCompare(b.name)),
    }))
    .filter((g) => g.players.length > 0);

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => {
          if (disabled) return;
          setIsOpen((o) => !o);
          if (!isOpen) setTimeout(() => inputRef.current?.focus(), 0);
        }}
        disabled={disabled}
        className={`w-full p-2.5 text-sm border rounded-lg bg-white text-left truncate ${
          disabled ? 'opacity-50 cursor-not-allowed border-slate-200' : 'cursor-pointer border-slate-300 hover:border-blue-400'
        }`}
      >
        {selectedLabel
          ? <span className="text-slate-900">{selectedLabel}</span>
          : <span className="text-slate-400">{placeholder}</span>}
      </button>

      {isOpen && !disabled && (
        <div className="absolute z-50 mt-1 w-full bg-white border border-slate-200 rounded-lg shadow-lg max-h-72 flex flex-col">
          <div className="p-2 border-b border-slate-100 space-y-1.5">
            <input
              ref={inputRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search players or club…"
              className="w-full p-1.5 text-sm border border-slate-200 rounded text-slate-900 focus:outline-none focus:ring-1 focus:ring-blue-400"
            />
            {/* Club filter — tap a club to narrow the list to just its squad */}
            <div className="flex gap-1 overflow-x-auto pb-0.5">
              <button
                type="button"
                onClick={() => setClubFilter(null)}
                className={`shrink-0 px-2 py-1 rounded text-[11px] font-bold ${clubFilter === null ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
              >
                All
              </button>
              {clubs.map((club) => (
                <button
                  key={club}
                  type="button"
                  onClick={() => setClubFilter((c) => (c === club ? null : club))}
                  className={`shrink-0 px-2 py-1 rounded text-[11px] font-bold ${clubFilter === club ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                >
                  {club}
                </button>
              ))}
            </div>
          </div>
          <div className="overflow-y-auto flex-1">
            <button
              type="button"
              onClick={() => { onChange(null, null); setIsOpen(false); setSearch(''); setClubFilter(null); }}
              className="w-full px-3 py-2 text-left text-sm text-slate-500 hover:bg-slate-50"
            >
              Clear selection
            </button>
            {groups.map(({ club, players }) => (
              <div key={club}>
                <div className="sticky top-0 bg-slate-100 px-3 py-1 text-[10px] font-bold uppercase tracking-wide text-slate-500">
                  {club}
                </div>
                {players.map((p) => {
                  const selected = value?.player === p.name && value?.club === club;
                  return (
                    <button
                      key={p.id ?? `${club}-${p.name}`}
                      type="button"
                      onClick={() => { onChange(p.name, club); setIsOpen(false); setSearch(''); setClubFilter(null); }}
                      className={`w-full px-3 py-2 text-left text-sm hover:bg-blue-50 text-slate-900 ${selected ? 'bg-blue-100 font-medium' : ''}`}
                    >
                      {p.name} <span className="text-slate-400">({club})</span>
                    </button>
                  );
                })}
              </div>
            ))}
            {groups.length === 0 && (
              <div className="px-3 py-2 text-sm text-slate-500">No players found</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
