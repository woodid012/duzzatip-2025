'use client';

import { useState, useRef, useEffect } from 'react';

// Grouped, searchable player picker for Duzza Finals team selection.
// `playersByTeam` is { ABBREV: [{ id, name, teamName }] } from the players API.
// `value` is { player, club } or null; `onChange(player, club)` fires on pick
// (both null when cleared). Modeled on SearchableSelect but grouped by club.
export default function PlayerSelect({
  playersByTeam = {},
  value,
  onChange,
  disabled = false,
  placeholder = 'Select Player',
  className = '',
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const containerRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    const handleClick = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setIsOpen(false);
        setSearch('');
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const clubs = Object.keys(playersByTeam).sort();
  const q = search.trim().toLowerCase();
  const selectedLabel = value?.player ? `${value.player} (${value.club})` : '';

  const groups = clubs
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
        className={`w-full p-2 text-sm border rounded bg-white text-black text-left truncate ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:border-blue-400'}`}
      >
        {selectedLabel || <span className="text-red-600">{placeholder}</span>}
      </button>

      {isOpen && !disabled && (
        <div className="absolute z-50 mt-1 w-full bg-white border rounded-lg shadow-lg max-h-72 flex flex-col">
          <div className="p-2 border-b">
            <input
              ref={inputRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search players or club..."
              className="w-full p-1.5 text-sm border rounded text-black focus:outline-none focus:ring-1 focus:ring-blue-400"
            />
          </div>
          <div className="overflow-y-auto flex-1">
            <button
              type="button"
              onClick={() => { onChange(null, null); setIsOpen(false); setSearch(''); }}
              className="w-full px-3 py-2 text-left text-sm text-red-600 hover:bg-gray-100"
            >
              {placeholder}
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
                      onClick={() => { onChange(p.name, club); setIsOpen(false); setSearch(''); }}
                      className={`w-full px-3 py-2 text-left text-sm hover:bg-blue-50 text-black ${selected ? 'bg-blue-100 font-medium' : ''}`}
                    >
                      {p.name} <span className="text-slate-400">({club})</span>
                    </button>
                  );
                })}
              </div>
            ))}
            {groups.length === 0 && (
              <div className="px-3 py-2 text-sm text-gray-500">No players found</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
