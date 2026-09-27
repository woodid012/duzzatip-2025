'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

// Look and copy per UI: 'finals' is the standalone /finals app, 'classic' the
// core-session /pages/duzza-finals page. Behaviour is identical.
const VARIANTS = {
  finals: {
    placeholder: 'Select player',
    trigger: 'p-2.5 rounded-lg',
    triggerDisabled: 'opacity-50 cursor-not-allowed border-slate-200',
    triggerEnabled: 'cursor-pointer border-slate-300 hover:border-blue-400',
    selectedText: 'text-slate-900',
    placeholderText: 'text-slate-400',
    menuBorder: 'border-slate-200',
    headerBorder: 'border-slate-100',
    searchPlaceholder: 'Search players or club…',
    search: 'border-slate-200 text-slate-900',
    clear: 'text-slate-500 hover:bg-slate-50',
    clearLabel: () => 'Clear selection',
    option: 'text-slate-900',
    empty: 'text-slate-500',
  },
  classic: {
    placeholder: 'Select Player',
    trigger: 'p-2 rounded text-black',
    triggerDisabled: 'opacity-50 cursor-not-allowed',
    triggerEnabled: 'cursor-pointer hover:border-blue-400',
    selectedText: undefined,
    placeholderText: 'text-red-600',
    menuBorder: '',
    headerBorder: '',
    searchPlaceholder: 'Search players or club...',
    search: 'text-black',
    clear: 'text-red-600 hover:bg-gray-100',
    clearLabel: (placeholder) => placeholder,
    option: 'text-black',
    empty: 'text-gray-500',
  },
};

// Grouped, searchable player picker for Duzza Finals team selection.
// `playersByTeam` is { ABBREV: [{ id, name, teamName }] } from GET
// /api/duzza-finals/players. `value` is { player, club } or null;
// `onChange(player, club)` fires on pick (both null when cleared).
export default function PlayerSelect({
  playersByTeam = {},
  value,
  onChange,
  // Where each player already sits in this team, and which slot this picker
  // is. A pick from a player held elsewhere swaps the two slots, so the list
  // says so up front.
  heldPositions = {},
  position = null,
  disabled = false,
  placeholder,
  className = '',
  variant = 'finals',
}) {
  const v = VARIANTS[variant];
  const placeholderText = placeholder ?? v.placeholder;
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

  const selectedLabel = value?.player ? `${value.player} (${value.club})` : '';

  // Both derived only from the dropdown's own state, and only ever rendered
  // while it's open — skip the filter/sort work entirely while closed.
  const clubs = useMemo(
    () => (isOpen ? Object.keys(playersByTeam).sort() : []),
    [isOpen, playersByTeam]
  );

  const groups = useMemo(() => {
    if (!isOpen) return [];
    const q = search.trim().toLowerCase();
    return clubs
      .filter((club) => !clubFilter || club === clubFilter)
      .map((club) => ({
        club,
        players: (playersByTeam[club] || [])
          .filter((p) => !q || p.name.toLowerCase().includes(q) || club.toLowerCase().includes(q))
          .sort((a, b) => a.name.localeCompare(b.name)),
      }))
      .filter((g) => g.players.length > 0);
  }, [isOpen, clubs, playersByTeam, search, clubFilter]);

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
        className={`w-full ${v.trigger} text-sm border bg-white text-left truncate ${
          disabled ? v.triggerDisabled : v.triggerEnabled
        }`}
      >
        {selectedLabel
          ? <span className={v.selectedText}>{selectedLabel}</span>
          : <span className={v.placeholderText}>{placeholderText}</span>}
      </button>

      {isOpen && !disabled && (
        <div className={`absolute z-50 mt-1 w-full bg-white border ${v.menuBorder} rounded-lg shadow-lg max-h-72 flex flex-col`}>
          <div className={`p-2 border-b ${v.headerBorder} space-y-1.5`}>
            <input
              ref={inputRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={v.searchPlaceholder}
              className={`w-full p-1.5 text-sm border rounded ${v.search} focus:outline-none focus:ring-1 focus:ring-blue-400`}
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
              className={`w-full px-3 py-2 text-left text-sm ${v.clear}`}
            >
              {v.clearLabel(placeholderText)}
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
                      className={`w-full px-3 py-2 text-left text-sm hover:bg-blue-50 ${v.option} ${selected ? 'bg-blue-100 font-medium' : ''}`}
                    >
                      {p.name} <span className="text-slate-400">({club})</span>
                      {heldPositions[p.name] && heldPositions[p.name] !== position && (
                        <span className="ml-1 text-[11px] font-medium text-amber-600">in {heldPositions[p.name]}</span>
                      )}
                    </button>
                  );
                })}
              </div>
            ))}
            {groups.length === 0 && (
              <div className={`px-3 py-2 text-sm ${v.empty}`}>No players found</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
