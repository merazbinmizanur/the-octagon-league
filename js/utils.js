// THE OCTAGON LEAGUE — shared utilities

export const ROUND_ORDER = { QF: 0, SF: 1, "3RD": 2, F: 3 };
export const ROUND_LABEL = { QF: "Quarter Final", SF: "Semi Final", "3RD": "3rd Place Playoff", F: "Final" };
export const ROUND_SHORT = { QF: "QF", SF: "SF", "3RD": "3RD", F: "FINAL" };

export function sortByRound(matches) {
  return [...matches].sort((a, b) => (ROUND_ORDER[a.round] - ROUND_ORDER[b.round]) || (a.bracketPosition - b.bracketPosition));
}

export function getInitials(name) {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  return (parts[0]?.[0] || "").toUpperCase() + (parts[1]?.[0] || "").toUpperCase();
}

export function avatarHtml(player, size) {
  if (player?.photoUrl) {
    return `<img class="sb-avatar" style="width:${size}px;height:${size}px" src="${escapeHtml(player.photoUrl)}" alt="${escapeHtml(player.name || "")}" loading="lazy" decoding="async" onerror="this.style.display='none'">`;
  }
  return `<div class="sb-avatar" style="width:${size}px;height:${size}px;display:flex;align-items:center;justify-content:center;font-family:var(--font-mono);font-weight:700;color:var(--ink-dim);font-size:${Math.round(size*0.35)}px">${escapeHtml(getInitials(player?.name))}</div>`;
}

export function escapeHtml(str) {
  if (str == null) return "";
  return String(str).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// Wrap any ICONS.x svg string with an explicit pixel size — our base icon
// strings intentionally omit width/height so they inherit context via CSS,
// but ad-hoc inline usages (outside a sized wrapper class) need this.
export function iconSize(svgStr, px) {
  return svgStr.replace("<svg ", `<svg style="width:${px}px;height:${px}px;flex-shrink:0;" `);
}

export function formatDate(value) {
  if (!value) return "";
  const d = value?.toDate ? value.toDate() : new Date(value);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" });
}

// Determine the winner of a match given regulation + optional penalty scores.
export function matchWinnerId(match) {
  if (match.winnerId) return match.winnerId;
  if (match.score1 > match.score2) return match.player1Id;
  if (match.score2 > match.score1) return match.player2Id;
  if (match.wentToPenalty) {
    if (match.penaltyScore1 > match.penaltyScore2) return match.player1Id;
    if (match.penaltyScore2 > match.penaltyScore1) return match.player2Id;
  }
  return null;
}

// Compute aggregate stats for one player from a list of completed matches.
// Pass seasonId to scope to one season, or null for all-time.
export function computePlayerStats(matches, playerId, seasonId) {
  let goals = 0, wins = 0, losses = 0, played = 0, wonOnPenalties = 0;
  for (const m of matches) {
    if (seasonId && m.seasonId !== seasonId) continue;
    const isP1 = m.player1Id === playerId;
    const isP2 = m.player2Id === playerId;
    if (!isP1 && !isP2) continue;
    if (m.score1 == null || m.score2 == null) continue; // not yet played
    played++;
    goals += isP1 ? Number(m.score1 || 0) : Number(m.score2 || 0);
    const winnerId = matchWinnerId(m);
    if (winnerId === playerId) {
      wins++;
      if (m.wentToPenalty) wonOnPenalties++;
    } else if (winnerId) {
      losses++;
    }
  }
  return { goals, wins, losses, played, wonOnPenalties };
}

// Build a full leaderboard array for all players, sorted by goals desc.
export function buildLeaderboard(players, matches, seasonId, sortKey = "goals") {
  const rows = players.map((p) => ({
    player: p,
    ...computePlayerStats(matches, p.id, seasonId),
  }));
  rows.sort((a, b) => b[sortKey] - a[sortKey] || b.wins - a.wins);
  return rows;
}

// Sums the "Passes" / "Successful Passes" match-stat fields (entered by the
// admin from in-game screenshots) across every match a player has played,
// for the "Top Passer" ranking.
export function computePassingStats(matches, playerId, seasonId) {
  let passes = 0, successfulPasses = 0, played = 0;
  for (const m of matches) {
    if (seasonId && m.seasonId !== seasonId) continue;
    const isP1 = m.player1Id === playerId;
    const isP2 = m.player2Id === playerId;
    if (!isP1 && !isP2) continue;
    if (m.score1 == null || m.score2 == null) continue;
    const stats = isP1 ? m.stats1 : m.stats2;
    if (!stats) continue;
    if (stats.passes == null && stats.successfulPasses == null) continue;
    played++;
    passes += Number(stats.passes || 0);
    successfulPasses += Number(stats.successfulPasses || 0);
  }
  return { passes, successfulPasses, played };
}

export function buildPassingLeaderboard(players, matches, seasonId) {
  const rows = players.map((p) => ({ player: p, ...computePassingStats(matches, p.id, seasonId) }));
  rows.sort((a, b) => b.passes - a.passes || b.successfulPasses - a.successfulPasses);
  return rows;
}

let toastHost = null;
export function toast(message, type = "success") {
  if (!toastHost) {
    toastHost = document.createElement("div");
    toastHost.className = "toast-host";
    document.body.appendChild(toastHost);
  }
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.textContent = message;
  toastHost.appendChild(el);
  setTimeout(() => el.remove(), 2800);
}

// Circular win-rate ring (SVG stroke-dasharray progress ring)
export function winRingSvg(percent, size = 96, strokeColor = "var(--turf)") {
  const r = (size - 12) / 2;
  const c = 2 * Math.PI * r;
  const offset = c - (Math.min(100, Math.max(0, percent)) / 100) * c;
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" style="transform:rotate(-90deg)">
    <circle cx="${size/2}" cy="${size/2}" r="${r}" fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="8"/>
    <circle cx="${size/2}" cy="${size/2}" r="${r}" fill="none" stroke="${strokeColor}" stroke-width="8" stroke-linecap="round"
      stroke-dasharray="${c}" stroke-dashoffset="${offset}" style="transition: stroke-dashoffset 1s cubic-bezier(.2,.85,.3,1); filter: drop-shadow(0 0 6px rgba(53,226,122,0.5));"/>
  </svg>`;
}

// Head-to-head record between two players from a list of completed matches.
export function computeHeadToHead(matches, aId, bId) {
  const list = matches.filter((m) =>
    m.score1 != null && m.score2 != null &&
    ((m.player1Id === aId && m.player2Id === bId) || (m.player1Id === bId && m.player2Id === aId))
  ).sort((x, y) => new Date(y.date || 0) - new Date(x.date || 0));
  let aWins = 0, bWins = 0, aGoals = 0, bGoals = 0;
  for (const m of list) {
    const winnerId = matchWinnerId(m);
    const isAP1 = m.player1Id === aId;
    aGoals += isAP1 ? Number(m.score1 || 0) : Number(m.score2 || 0);
    bGoals += isAP1 ? Number(m.score2 || 0) : Number(m.score1 || 0);
    if (winnerId === aId) aWins++; else if (winnerId === bId) bWins++;
  }
  return { list, aWins, bWins, aGoals, bGoals };
}

// Golden Boot = top scorer for a given season (ties broken by fewest matches played).
export function computeGoldenBoot(players, matches, seasonId) {
  const rows = buildLeaderboard(players, matches, seasonId, "goals").filter((r) => r.goals > 0);
  return rows[0] || null;
}

export const ICONS = {
  home: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/></svg>`,
  goal: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="0.6" fill="currentColor"/></svg>`,
  flag: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 3v18"/><path d="M5 4h13l-3 4 3 4H5"/></svg>`,
  activity: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12h4l3 8 4-16 3 8h4"/></svg>`,
  compare: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3 4 7l4 4"/><path d="M4 7h16"/><path d="M16 21l4-4-4-4"/><path d="M20 17H4"/></svg>`,
  search: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>`,
  boot: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 3v9l-2 4v5h18v-3c0-2-2-3-4-3.5L9 13V3z"/><path d="M5 8h4"/></svg>`,
  star: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 2 3.1 6.6 7.2.9-5.3 5 1.5 7.1-6.5-3.6-6.5 3.6 1.5-7.1-5.3-5 7.2-.9z"/></svg>`,
  note: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16v12H8l-4 4z"/><path d="M8 9h8M8 12h5"/></svg>`,
  chevronRight: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6"/></svg>`,
  clock: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg>`,
  sparkle: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6"/></svg>`,
  wand: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 4 1.5 1.5M4 20l10-10M18 8l2 2M11 4h.01M4 11h.01M20 15h.01"/></svg>`,
  seasons: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="17" rx="3"/><path d="M3 9h18M8 2v4M16 2v4"/></svg>`,
  sun: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4.5"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/></svg>`,
  moon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a6.8 6.8 0 0 0 10.5 10.5z"/></svg>`,
  crown: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m3 18 1.5-9.5L9 13l3-8 3 8 4.5-4.5L21 18z"/><path d="M4 21h16"/></svg>`,
  bracket: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5h5v5H4z"/><path d="M4 14h5v5H4z"/><path d="M9 7.5h4M9 16.5h4M13 7.5v9M13 12h4v0"/><path d="M17 12h3"/></svg>`,
  trophy: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 21h8M12 17v4M7 4h10v4a5 5 0 0 1-10 0V4z"/><path d="M7 5H4a3 3 0 0 0 3 5M17 5h3a3 3 0 0 1-3 5"/></svg>`,
  players: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3.2"/><path d="M2.5 20c.6-3.6 3.3-6 6.5-6s5.9 2.4 6.5 6"/><circle cx="17.5" cy="9" r="2.3"/><path d="M15.8 14.2c2.5.3 4.4 2.5 4.9 5.3"/></svg>`,
  edit: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>`,
  trash: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0-1 14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2L4 6"/></svg>`,
  plus: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>`,
  logout: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/></svg>`,
  close: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>`,
  check: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>`,
};
