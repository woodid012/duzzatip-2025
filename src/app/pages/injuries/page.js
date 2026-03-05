'use client';

import { useState, useEffect, useMemo } from 'react';

const SEVERITY_ORDER = { SEASON: 0, MONTHS: 1, WEEKS: 2, DOUBT: 3, MANAGED: 4 };

const STATUS_CONFIG = {
  SEASON:  { dot: "bg-red-500",    badge: "bg-red-100 text-red-700 border-red-300",       label: "OUT SEASON" },
  MONTHS:  { dot: "bg-orange-500", badge: "bg-orange-100 text-orange-700 border-orange-300", label: "OUT MONTHS" },
  WEEKS:   { dot: "bg-yellow-500", badge: "bg-yellow-100 text-yellow-700 border-yellow-300", label: "OUT WEEKS" },
  DOUBT:   { dot: "bg-purple-500", badge: "bg-purple-100 text-purple-700 border-purple-300", label: "DOUBT" },
  MANAGED: { dot: "bg-blue-400",   badge: "bg-blue-100 text-blue-700 border-blue-300",       label: "MANAGED" },
};

export default function InjuriesPage() {
  const [injuries, setInjuries] = useState({});
  const [updated, setUpdated] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [teamFilter, setTeamFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');

  useEffect(() => {
    async function fetchInjuries() {
      try {
        const res = await fetch('/api/injuries');
        if (!res.ok) throw new Error('Failed to fetch injuries');
        const data = await res.json();
        setInjuries(data.players || {});
        setUpdated(data.updated);
      } catch (e) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    }
    fetchInjuries();
  }, []);

  // Build grouped + filtered list
  const { teams, filteredCount, totalCount } = useMemo(() => {
    const entries = Object.entries(injuries).map(([key, info]) => ({
      name: key.replace(/\s*\([^)]+\)\s*$/, ''),
      ...info,
    }));
    const totalCount = entries.length;

    const filtered = entries.filter(p => {
      if (teamFilter && p.team !== teamFilter) return false;
      if (statusFilter && p.status !== statusFilter) return false;
      if (search && !p.name.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });

    // Group by team
    const byTeam = {};
    for (const p of filtered) {
      const t = p.team || 'Unknown';
      if (!byTeam[t]) byTeam[t] = [];
      byTeam[t].push(p);
    }

    // Sort players within each team by severity
    for (const players of Object.values(byTeam)) {
      players.sort((a, b) => (SEVERITY_ORDER[a.status] ?? 5) - (SEVERITY_ORDER[b.status] ?? 5));
    }

    // Sort teams alphabetically
    const teams = Object.entries(byTeam).sort(([a], [b]) => a.localeCompare(b));

    return { teams, filteredCount: filtered.length, totalCount };
  }, [injuries, teamFilter, statusFilter, search]);

  // Unique teams for filter dropdown
  const allTeams = useMemo(() => {
    const t = new Set(Object.values(injuries).map(p => p.team).filter(Boolean));
    return [...t].sort();
  }, [injuries]);

  if (loading) {
    return (
      <div className="p-4 flex items-center justify-center min-h-[200px]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4">
        <div className="bg-red-100 border border-red-300 rounded p-3 text-red-700">{error}</div>
      </div>
    );
  }

  return (
    <div className="p-2 md:p-4 space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <h1 className="text-xl font-bold">AFL Injury List</h1>
        <div className="text-sm text-gray-500">
          {updated
            ? `Updated: ${new Date(updated).toLocaleString('en-AU', { timeZone: 'Australia/Melbourne', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true })}`
            : 'No data yet'}
          {' '} &middot; {filteredCount} of {totalCount} players
        </div>
      </div>

      {/* Status legend */}
      <div className="flex flex-wrap gap-2">
        {Object.entries(STATUS_CONFIG).map(([key, cfg]) => (
          <span
            key={key}
            onClick={() => setStatusFilter(statusFilter === key ? '' : key)}
            className={`inline-flex items-center gap-1 text-xs px-2 py-1 rounded border font-medium cursor-pointer transition-opacity ${cfg.badge} ${statusFilter && statusFilter !== key ? 'opacity-40' : ''}`}
          >
            <span className={`inline-block w-2 h-2 rounded-full ${cfg.dot}`} />
            {cfg.label}
          </span>
        ))}
        {statusFilter && (
          <button onClick={() => setStatusFilter('')} className="text-xs text-gray-500 underline">Clear</button>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-2">
        <input
          type="text"
          placeholder="Search player..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="border rounded px-3 py-1.5 text-sm flex-1 min-w-0"
        />
        <select
          value={teamFilter}
          onChange={e => setTeamFilter(e.target.value)}
          className="border rounded px-3 py-1.5 text-sm"
        >
          <option value="">All Teams</option>
          {allTeams.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>

      {/* Injury cards grouped by team */}
      {teams.length === 0 ? (
        <div className="text-center text-gray-500 py-8">No injuries match your filters</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {teams.map(([team, players]) => (
            <div key={team} className="border rounded-lg overflow-hidden">
              <div className="bg-gray-100 px-3 py-2 font-semibold text-sm border-b flex items-center justify-between">
                <span>{team}</span>
                <span className="text-xs text-gray-500 font-normal">{players.length}</span>
              </div>
              <div className="divide-y">
                {players.map(p => {
                  const cfg = STATUS_CONFIG[p.status] || STATUS_CONFIG.MANAGED;
                  return (
                    <div key={p.name} className="px-3 py-2 flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-medium text-sm truncate">{p.name}</div>
                        <div className="text-xs text-gray-500 truncate">{p.detail}</div>
                      </div>
                      <span className={`inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded border font-medium whitespace-nowrap shrink-0 ${cfg.badge}`}>
                        <span className={`inline-block w-2 h-2 rounded-full ${cfg.dot}`} />
                        {cfg.label}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
