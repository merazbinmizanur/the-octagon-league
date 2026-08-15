import { db } from "./firebase-config.js";
import {
  collection, onSnapshot, query, orderBy
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import {
  ROUND_ORDER, ROUND_LABEL, ROUND_SHORT, sortByRound, avatarHtml, escapeHtml,
  formatDate, matchWinnerId, computePlayerStats, buildLeaderboard, ICONS, winRingSvg,
  computeHeadToHead, computeGoldenBoot, iconSize, getInitials, buildPassingLeaderboard
} from "./utils.js";

// -------------------------------------------------------------------------
// State
// -------------------------------------------------------------------------
let seasons = [];
let players = [];
let matches = [];
let currentView = "home";
let currentSeasonId = null;
let lbSortKey = "goals";
let profilePlayerId = null;
let profileTab = "all";
let playerSearchTerm = "";
let compareModeActive = false;
let compareSelection = [];
let compareState = { a: null, b: null };
let mnSyncTo = () => {}; // reassigned once the Meniscus nav engine initializes below

const loaded = { seasons: false, players: false, matches: false };
function markLoaded(key) {
  loaded[key] = true;
  if (loaded.seasons && loaded.players && loaded.matches) finishTunnelLoader();
}

// -------------------------------------------------------------------------
// Light / dark theme toggle — persisted, applied instantly on tap.
// -------------------------------------------------------------------------
const themeToggleBtn = document.getElementById("themeToggleBtn");
function currentTheme() { return document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark"; }
function renderThemeToggleIcon() { themeToggleBtn.innerHTML = currentTheme() === "light" ? ICONS.moon : ICONS.sun; }
themeToggleBtn.addEventListener("click", () => {
  const next = currentTheme() === "light" ? "dark" : "light";
  if (next === "light") document.documentElement.setAttribute("data-theme", "light");
  else document.documentElement.removeAttribute("data-theme");
  try { localStorage.setItem("octagon-theme", next); } catch (e) {}
  renderThemeToggleIcon();
});
renderThemeToggleIcon();

// -------------------------------------------------------------------------
// Stadium-tunnel loading screen — simulated progress (real Firestore load is
// usually near-instant, so a purely real progress bar would flash and be
// gone) plus a rotating status line, then an exit transition.
// -------------------------------------------------------------------------
const bgVideoLayerEl = document.getElementById("bgVideoLayer");
const loaderEl = document.getElementById("fullLoader");
const loaderFill = document.getElementById("loaderProgressFill");
const loaderPctEl = document.getElementById("loaderProgressPct");
const loaderStatusEl = document.getElementById("loaderStatus");
const TUNNEL_STATUS_LINES = ["ENTERING THE ARENA...", "SYNCING BRACKET DATA...", "LOADING PLAYER STATS...", "WARMING UP..."];
let loaderPctVal = 0, loaderFinished = false, tunnelStatusIdx = 0;

bgVideoLayerEl?.classList.add("tunnel");

function setLoaderPct(p) {
  loaderPctVal = p;
  if (loaderFill) loaderFill.style.width = `${p}%`;
  if (loaderPctEl) loaderPctEl.textContent = `${Math.round(p)}%`;
}
function loaderTick() {
  if (loaderFinished) return;
  if (loaderPctVal < 90) {
    setLoaderPct(Math.min(90, loaderPctVal + (90 - loaderPctVal) * 0.06 + 0.35));
    requestAnimationFrame(loaderTick);
  }
}
requestAnimationFrame(loaderTick);

const tunnelStatusTimer = setInterval(() => {
  if (loaderFinished || !loaderStatusEl) { clearInterval(tunnelStatusTimer); return; }
  tunnelStatusIdx = (tunnelStatusIdx + 1) % TUNNEL_STATUS_LINES.length;
  loaderStatusEl.style.opacity = "0";
  setTimeout(() => {
    loaderStatusEl.textContent = TUNNEL_STATUS_LINES[tunnelStatusIdx];
    loaderStatusEl.style.opacity = "1";
  }, 220);
}, 850);

function finishTunnelLoader() {
  if (loaderFinished || !loaderEl) return;
  loaderFinished = true;
  setLoaderPct(100);
  bgVideoLayerEl?.classList.remove("tunnel");
  setTimeout(() => {
    loaderEl.classList.add("exiting");
    document.body.classList.add("app-ready"); // app crossfades in as the loader fades out
    setTimeout(() => { loaderEl.style.display = "none"; }, 450);
  }, 260);
}

// -------------------------------------------------------------------------
// Icons
// -------------------------------------------------------------------------
document.querySelector(".search-icon").innerHTML = ICONS.search;
document.getElementById("matchModalCloseBtn").innerHTML = ICONS.close;
setCompareModeBtnLabel();

function setCompareModeBtnLabel() {
  document.getElementById("compareModeBtn").innerHTML = compareModeActive
    ? `${ICONS.close} <span>Cancel</span>` : `${ICONS.compare} <span>Compare</span>`;
}

// -------------------------------------------------------------------------
// Live Firestore listeners
// -------------------------------------------------------------------------
onSnapshot(query(collection(db, "seasons"), orderBy("createdAt", "desc")), (snap) => {
  seasons = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  populateSeasonSelect();
  markLoaded("seasons");
  renderCurrentView();
});
onSnapshot(collection(db, "players"), (snap) => {
  players = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  markLoaded("players");
  renderCurrentView();
});
onSnapshot(collection(db, "matches"), (snap) => {
  matches = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  markLoaded("matches");
  renderCurrentView();
});

// -------------------------------------------------------------------------
// Season selector — custom dropdown (replaces the native <select> so it can
// be fully themed instead of falling back to the OS's own picker sheet)
// -------------------------------------------------------------------------
const seasonPicker = document.getElementById("seasonPicker");
const seasonPickerBtn = document.getElementById("seasonPickerBtn");
const seasonPickerLabel = document.getElementById("seasonPickerLabel");
const seasonPickerMenu = document.getElementById("seasonPickerMenu");

function populateSeasonSelect() {
  const prev = currentSeasonId;
  currentSeasonId = (prev && (prev === "all" || seasons.some((s) => s.id === prev))) ? prev : (seasons[0]?.id || "all");
  renderSeasonPickerMenu();
  updateSeasonPickerLabel();
}
function updateSeasonPickerLabel() {
  const active = seasons.find((s) => s.id === currentSeasonId);
  seasonPickerLabel.textContent = currentSeasonId === "all" ? "All Seasons" : (active?.name || "All Seasons");
}
function renderSeasonPickerMenu() {
  const options = [{ id: "all", name: "All Seasons" }, ...seasons];
  seasonPickerMenu.innerHTML = options.map((o) => `
    <button type="button" class="season-picker-item ${o.id === currentSeasonId ? "active" : ""}" data-season-id="${o.id}">
      <span>${escapeHtml(o.name)}</span>
      <svg class="check" viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5"/></svg>
    </button>`).join("");
  seasonPickerMenu.querySelectorAll(".season-picker-item").forEach((btn) => {
    btn.addEventListener("click", () => {
      currentSeasonId = btn.dataset.seasonId;
      updateSeasonPickerLabel();
      renderSeasonPickerMenu();
      closeSeasonPicker();
      renderCurrentView();
    });
  });
}
function openSeasonPicker() { seasonPicker.classList.add("open"); }
function closeSeasonPicker() { seasonPicker.classList.remove("open"); }
seasonPickerBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  seasonPicker.classList.contains("open") ? closeSeasonPicker() : openSeasonPicker();
});
document.addEventListener("click", (e) => {
  if (!seasonPicker.contains(e.target)) closeSeasonPicker();
});

// -------------------------------------------------------------------------
// Navigation — MENISCUS liquid dock (adapted from the open-source
// hasib41/meniscus-liquid-nav component). Tapping or dragging the bead
// calls goToView(); goToView() calls mnSyncTo() to keep the bead in sync
// when navigation happens from elsewhere (e.g. the season selector never
// touches it, but this keeps the pattern extensible).
// -------------------------------------------------------------------------
document.getElementById("profileBackBtn").addEventListener("click", () => goToView("players"));
document.getElementById("compareBackBtn").addEventListener("click", () => goToView("players"));

function goToView(view) {
  currentView = view;
  document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
  document.getElementById(`view-${view}`).classList.add("active");
  mnSyncTo(view);
  window.scrollTo({ top: 0, behavior: "smooth" });
  renderCurrentView();
}

// -------------------------------------------------------------------------
// Ambient background video — plays continuously across every page. Uses two
// stacked <video> elements and crossfades between them just before the loop
// point, so the restart cut is invisible instead of a hard jump.
// -------------------------------------------------------------------------
const videoA = document.getElementById("bgVideoA");
const videoB = document.getElementById("bgVideoB");
let activeVideo = videoA, standbyVideo = videoB, crossfading = false;
const CROSSFADE_SECS = 0.9;

function armLoopWatcher(v) {
  v.addEventListener("timeupdate", () => {
    if (v !== activeVideo || crossfading) return;
    if (v.duration && v.duration - v.currentTime <= CROSSFADE_SECS) crossfadeLoop();
  });
}
function crossfadeLoop() {
  crossfading = true;
  standbyVideo.currentTime = 0;
  standbyVideo.play().catch(() => {});
  standbyVideo.classList.add("active");
  activeVideo.classList.remove("active");
  const prevActive = activeVideo;
  activeVideo = standbyVideo;
  standbyVideo = prevActive;
  setTimeout(() => { standbyVideo.pause(); crossfading = false; }, CROSSFADE_SECS * 1000 + 150);
}
if (videoA && videoB) {
  armLoopWatcher(videoA);
  armLoopWatcher(videoB);

  // Stay fully invisible (revealing just the dark background) until the
  // video is genuinely playing real frames — this is what keeps any native
  // "loading"/"play" glyph from ever being visible: an opacity:0 element
  // hides its browser-native overlay chrome along with its content.
  videoA.addEventListener("playing", () => videoA.classList.add("active"), { once: true });
  videoA.play().catch(() => {}); // may be deferred until a user gesture on some browsers

  // If the video file is missing, the wrong path, or fails to decode for any
  // reason, hide the whole video layer instead of leaving a broken-media
  // placeholder on screen — the plain dark background already looks fine
  // on its own.
  const hideBgVideoOnError = () => { bgVideoLayerEl?.style.setProperty("display", "none"); };
  videoA.addEventListener("error", hideBgVideoOnError);
  videoB.addEventListener("error", hideBgVideoOnError);

  // Some embedded/preview contexts block autoplay even with muted+playsinline
  // (e.g. no autoplay permission on the surrounding iframe) — the very first
  // tap/click anywhere on the page retries playback so it starts (and reveals
  // itself via the "playing" listener above) as soon as it's allowed to.
  const retryVideoPlayOnce = () => {
    videoA.play().catch(() => {});
    document.removeEventListener("pointerdown", retryVideoPlayOnce);
  };
  document.addEventListener("pointerdown", retryVideoPlayOnce, { once: true });
}

function openProfile(playerId) {
  profilePlayerId = playerId;
  profileTab = "all";
  currentView = "profile";
  document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
  document.getElementById("view-profile").classList.add("active");
  window.scrollTo({ top: 0, behavior: "smooth" });
  renderProfile();
}
window.openProfile = openProfile;

function renderCurrentView() {
  if (!loaded.seasons || !loaded.players || !loaded.matches) return;
  if (currentView === "home") renderHome();
  else if (currentView === "bracket") renderBracket();
  else if (currentView === "leaderboard") renderLeaderboard();
  else if (currentView === "players") renderPlayers();
  else if (currentView === "profile") renderProfile();
  else if (currentView === "compare") renderCompare();
  else if (currentView === "hof") renderHOF();
}

function playerById(id) { return players.find((p) => p.id === id); }
function matchById(id) { return matches.find((m) => m.id === id); }
function seasonMatches(seasonId) { return seasonId === "all" ? matches : matches.filter((m) => m.seasonId === seasonId); }
function playedMatches(list) { return list.filter((m) => m.score1 != null && m.score2 != null); }

function emptyState(icon, title, sub) {
  return `<div class="glass empty-state"><div class="ill">${icon}</div><h3>${escapeHtml(title)}</h3><p>${escapeHtml(sub)}</p></div>`;
}

function awardBadgeHtml(type, small) {
  if (type === "mvp") return `<span class="award-badge mvp">${ICONS.star}${small ? "" : "<span>MVP</span>"}</span>`;
  return `<span class="award-badge boot">${ICONS.boot}${small ? "" : "<span>Golden Boot</span>"}</span>`;
}

// -------------------------------------------------------------------------
// HOME
// -------------------------------------------------------------------------
function renderHome() {
  const activeSeason = seasons.find((s) => s.id === currentSeasonId);
  document.getElementById("homeRoundLabel").textContent =
    currentSeasonId === "all" ? "ALL-TIME OVERVIEW" : (activeSeason ? `${activeSeason.name} · ${(activeSeason.status || "ongoing").toUpperCase()}` : "TOURNAMENT STATUS");

  const scoped = playedMatches(seasonMatches(currentSeasonId));
  const scopedAll = seasonMatches(currentSeasonId);

  const stepperHost = document.getElementById("homeStepper");
  const champHost = document.getElementById("homeChampionCallout");
  if (currentSeasonId === "all") {
    stepperHost.innerHTML = "";
  } else {
    const rounds = ["QF", "SF", "3RD", "F"];
    const roundDone = (r) => scopedAll.filter((m) => m.round === r).length > 0 && scopedAll.filter((m) => m.round === r).every((m) => matchWinnerId(m));
    const currentRoundIdx = rounds.findIndex((r) => scopedAll.some((m) => m.round === r) && !roundDone(r));
    stepperHost.innerHTML = rounds.map((r, i) => {
      const done = roundDone(r);
      const isCurrent = !done && i === currentRoundIdx;
      const cls = done ? "done" : isCurrent ? "current" : "";
      const line = i < rounds.length - 1 ? `<div class="step-line ${done ? "done" : ""}"></div>` : "";
      return `<div class="step ${cls}"><div class="step-dot">${done ? "✓" : ROUND_SHORT[r][0]}</div><span class="step-label">${ROUND_SHORT[r]}</span></div>${line}`;
    }).join("");
  }

  const finalMatch = scopedAll.find((m) => m.round === "F" && matchWinnerId(m));
  const champion = finalMatch ? playerById(matchWinnerId(finalMatch)) : null;
  champHost.innerHTML = champion ? `
    <div class="champion-spotlight">
      <div class="champ-banner-photo">
        ${champion.photoUrl
          ? `<img src="${escapeHtml(champion.photoUrl)}" alt="${escapeHtml(champion.name)}" onerror="this.outerHTML='<div class=\\'avatar-fallback\\'>${escapeHtml(getInitials(champion.name))}</div>'">`
          : `<div class="avatar-fallback">${escapeHtml(getInitials(champion.name))}</div>`}
        <div class="champ-crown-badge">${iconSize(ICONS.trophy, 19)}</div>
      </div>
      <div class="champ-banner-body">
        <div class="champ-name">${escapeHtml(champion.name)}</div>
        <div class="champ-kicker">${iconSize(ICONS.star, 11)}<span>CHAMPION</span></div>
        <div class="champ-sub">${escapeHtml(currentSeasonId === "all" ? "All-Time" : (activeSeason?.name || ""))}</div>
      </div>
    </div>` : "";

  const lb = buildLeaderboard(players, matches, currentSeasonId === "all" ? null : currentSeasonId, "goals");
  const lbWins = buildLeaderboard(players, matches, currentSeasonId === "all" ? null : currentSeasonId, "wins");
  const topScorer = lb.find((r) => r.goals > 0);
  const topWinner = lbWins.find((r) => r.wins > 0);
  const gb = computeGoldenBoot(players, matches, currentSeasonId === "all" ? null : currentSeasonId);
  const mvpId = activeSeason?.mvpPlayerId || null;
  const mvpPlayer = mvpId ? playerById(mvpId) : null;

  const tiles = [];
  tiles.push(`<div class="glass stat-tile glass-hover" style="--accent:77,140,255"><div class="stat-accent-bar"></div><div class="stat-tile-wm">${ICONS.activity}</div><div class="stat-icon-badge">${ICONS.activity}</div><div><div class="stat-value">${scoped.length}</div><div class="stat-label">Matches Played</div></div></div>`);
  if (topScorer) tiles.push(`<div class="glass stat-tile glass-hover" style="--accent:53,226,122" onclick="openProfile('${topScorer.player.id}')"><div class="stat-accent-bar"></div><div class="stat-tile-wm">${ICONS.goal}</div><div class="stat-icon-badge">${ICONS.goal}</div><div><div class="stat-value">${topScorer.goals}</div><div class="stat-label">Top Scorer · ${escapeHtml(topScorer.player.name)}</div></div></div>`);
  if (topWinner) tiles.push(`<div class="glass stat-tile glass-hover" style="--accent:255,179,71" onclick="openProfile('${topWinner.player.id}')"><div class="stat-accent-bar"></div><div class="stat-tile-wm">${ICONS.flag}</div><div class="stat-icon-badge">${ICONS.flag}</div><div><div class="stat-value">${topWinner.wins}</div><div class="stat-label">Most Wins · ${escapeHtml(topWinner.player.name)}</div></div></div>`);
  if (gb) tiles.push(`<div class="glass stat-tile glass-hover" style="--accent:53,226,122" onclick="openProfile('${gb.player.id}')"><div class="stat-accent-bar"></div><div class="stat-tile-wm">${ICONS.boot}</div><div class="stat-icon-badge">${ICONS.boot}</div><div><div class="stat-value" style="font-size:16px">${escapeHtml(gb.player.name)}</div><div class="stat-label">Golden Boot · ${gb.goals} goals</div></div></div>`);
  if (mvpPlayer) tiles.push(`<div class="glass stat-tile glass-hover award-tile-full" style="--accent:255,179,71" onclick="openProfile('${mvpPlayer.id}')"><div class="stat-accent-bar"></div><div class="stat-tile-wm">${ICONS.star}</div><div class="stat-icon-badge">${ICONS.star}</div><div><div class="stat-value" style="font-size:16px">${escapeHtml(mvpPlayer.name)}</div><div class="stat-label">Season MVP</div></div></div>`);
  document.getElementById("homeQuickStats").innerHTML = tiles.join("");

  // Next match
  const nextHost = document.getElementById("homeNextMatch");
  const upcoming = scopedAll.find((m) => m.score1 == null && m.score2 == null && m.player1Id && m.player2Id);
  if (upcoming) {
    const p1 = playerById(upcoming.player1Id), p2 = playerById(upcoming.player2Id);
    nextHost.innerHTML = `<div class="glass next-match-card">
      <div class="nm-tag">${ICONS.clock}<span>NEXT MATCH · ${ROUND_LABEL[upcoming.round] || upcoming.round}${upcoming.date ? " · " + formatDate(upcoming.date) : ""}</span></div>
      <div class="scoreboard-body">
        <div class="sb-player left">${avatarHtml(p1, 42)}<div class="sb-name">${escapeHtml(p1?.name || "TBD")}</div></div>
        <div class="sb-score" style="font-size:18px;color:var(--ink-faint);">VS</div>
        <div class="sb-player right">${avatarHtml(p2, 42)}<div class="sb-name">${escapeHtml(p2?.name || "TBD")}</div></div>
      </div>
    </div>`;
  } else nextHost.innerHTML = "";

  const recent = [...scoped].sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0)).slice(0, 6);
  document.getElementById("homeRecentMatches").innerHTML = recent.length
    ? recent.map(matchScoreboardHtml).join("")
    : emptyState(ICONS.goal, "No matches yet", "Once the admin enters results, they'll show up here in real time.");
}

function matchScoreboardHtml(m) {
  const p1 = playerById(m.player1Id), p2 = playerById(m.player2Id);
  const winnerId = matchWinnerId(m);
  return `
  <div class="glass scoreboard glass-hover ${winnerId ? "decided" : ""}" onclick="openMatchModal('${m.id}')">
    <div class="scoreboard-round">
      <span class="round-chip ${m.round === "F" ? "final" : ""}">${ROUND_LABEL[m.round] || m.round}</span>
      <span class="ft-tag">${formatDate(m.date)} · FT</span>
    </div>
    <div class="scoreboard-body">
      <div class="sb-player left">${avatarHtml(p1, 42)}<div class="sb-name ${winnerId === m.player1Id ? "winner" : ""}">${escapeHtml(p1?.name || "TBD")}</div></div>
      <div><div class="sb-score">${m.score1 ?? "-"}<span class="dash">:</span>${m.score2 ?? "-"}</div>${m.wentToPenalty ? `<div class="sb-pk">PK ${m.penaltyScore1 ?? 0}-${m.penaltyScore2 ?? 0}</div>` : ""}</div>
      <div class="sb-player right">${avatarHtml(p2, 42)}<div class="sb-name ${winnerId === m.player2Id ? "winner" : ""}">${escapeHtml(p2?.name || "TBD")}</div></div>
    </div>
  </div>`;
}

// -------------------------------------------------------------------------
// MATCH DETAIL MODAL
// -------------------------------------------------------------------------
function openMatchModal(matchId) {
  const m = matchById(matchId);
  if (!m) return;
  const p1 = playerById(m.player1Id), p2 = playerById(m.player2Id);
  const winnerId = matchWinnerId(m);
  const s1 = m.stats1 || {}, s2 = m.stats2 || {};
  const hasStats = ["possession", "shots", "shotsOnTarget", "passes", "successfulPasses", "saves"].some((k) => s1[k] != null || s2[k] != null);
  document.getElementById("matchModalBody").innerHTML = `
    <div class="eyebrow" style="justify-content:center;margin-bottom:6px;">${ROUND_LABEL[m.round] || m.round}</div>
    <div class="mm-vs">
      <div class="mm-side">${avatarHtml(p1, 56)}<div style="font-weight:700;font-size:13px;${winnerId === m.player1Id ? "color:var(--turf)" : ""}">${escapeHtml(p1?.name || "TBD")}</div></div>
      <div class="mm-vs-score">${m.score1 ?? "-"} : ${m.score2 ?? "-"}</div>
      <div class="mm-side">${avatarHtml(p2, 56)}<div style="font-weight:700;font-size:13px;${winnerId === m.player2Id ? "color:var(--turf)" : ""}">${escapeHtml(p2?.name || "TBD")}</div></div>
    </div>
    ${m.wentToPenalty ? `<div style="text-align:center;color:var(--gold);font-family:var(--font-mono);font-size:12px;margin-bottom:10px;">Won on penalties ${m.penaltyScore1}-${m.penaltyScore2}</div>` : ""}
    <div class="mm-meta-row"><span>Date</span><span>${formatDate(m.date) || "TBD"}</span></div>
    <div class="mm-meta-row"><span>Round</span><span>${ROUND_LABEL[m.round] || m.round}</span></div>
    ${hasStats ? `
      <div class="eyebrow" style="justify-content:center;margin:18px 0 10px;">Match Stats</div>
      ${statBarRow("Possession %", s1.possession ?? 0, s2.possession ?? 0)}
      ${statBarRow("Shots", s1.shots ?? 0, s2.shots ?? 0)}
      ${statBarRow("Shots on Target", s1.shotsOnTarget ?? 0, s2.shotsOnTarget ?? 0)}
      ${statBarRow("Passes", s1.passes ?? 0, s2.passes ?? 0)}
      ${statBarRow("Successful Passes", s1.successfulPasses ?? 0, s2.successfulPasses ?? 0)}
      ${statBarRow("Saves", s1.saves ?? 0, s2.saves ?? 0)}
    ` : ""}
    ${m.note ? `<div class="mm-note"><div class="mm-note-label">${ICONS.note}Match Highlights</div>${escapeHtml(m.note)}</div>` : ""}
    ${p1 && p2 ? `<button class="btn btn-ghost btn-block" style="margin-top:16px;" onclick="document.getElementById('matchModalOverlay').classList.remove('open'); openCompareView('${p1.id}','${p2.id}')">${ICONS.compare}<span>Compare These Players</span></button>` : ""}
  `;
  document.getElementById("matchModalOverlay").classList.add("open");
}
window.openMatchModal = openMatchModal;
document.getElementById("matchModalCloseBtn").addEventListener("click", () => document.getElementById("matchModalOverlay").classList.remove("open"));
document.getElementById("matchModalOverlay").addEventListener("click", (e) => { if (e.target.id === "matchModalOverlay") e.currentTarget.classList.remove("open"); });

// -------------------------------------------------------------------------
// BRACKET
// -------------------------------------------------------------------------
function renderBracket() {
  const wrap = document.getElementById("bracketTree");
  if (currentSeasonId === "all") { wrap.innerHTML = emptyState(ICONS.bracket, "Pick a season", "Select a specific season above to view its bracket tree."); return; }
  const list = sortByRound(seasonMatches(currentSeasonId));
  if (!list.length) { wrap.innerHTML = emptyState(ICONS.bracket, "Bracket not set yet", "The admin hasn't built this season's bracket yet — check back soon."); return; }

  function roundColumn(roundKey, matchList) {
    if (!matchList.length) return "";
    // Pair matches 2-at-a-time so a connector line can visually feed them into the next round.
    if (matchList.length >= 2) {
      const pairs = [];
      for (let i = 0; i < matchList.length; i += 2) pairs.push(matchList.slice(i, i + 2));
      return `<div class="bracket-col"><div class="bracket-col-title">${ROUND_SHORT[roundKey]}</div>
        ${pairs.map((pair) => `<div class="bracket-pair">${pair.map(bracketMatchHtml).join("")}</div>`).join("")}
      </div>`;
    }
    return `<div class="bracket-col"><div class="bracket-col-title">${ROUND_SHORT[roundKey]}</div>${matchList.map(bracketMatchHtml).join("")}</div>`;
  }

  const rounds = ["QF", "SF", "3RD", "F"];
  const cols = rounds.filter((r) => list.some((m) => m.round === r))
    .map((r) => roundColumn(r, list.filter((m) => m.round === r))).join("");

  const finalMatch = list.find((m) => m.round === "F");
  const champion = finalMatch && matchWinnerId(finalMatch) ? playerById(matchWinnerId(finalMatch)) : null;
  const champCol = champion ? `<div class="bracket-col" style="justify-content:center;">
      <div class="bracket-col-title">CHAMPION</div>
      <div class="glass champion-card">${avatarHtml(champion, 52)}<div style="color:var(--gold)">${iconSize(ICONS.trophy, 20)}</div><div style="font-weight:700;font-size:13px;">${escapeHtml(champion.name)}</div></div>
    </div>` : "";
  wrap.innerHTML = cols + champCol;
}

function bracketMatchHtml(m) {
  const p1 = playerById(m.player1Id), p2 = playerById(m.player2Id);
  const winnerId = matchWinnerId(m);
  return `<div class="glass b-match glass-hover ${m.round === "F" ? "final" : ""}" onclick="openMatchModal('${m.id}')">
    <div class="b-match-row ${winnerId === m.player1Id ? "win" : ""}">${avatarHtml(p1, 22).replace('class="sb-avatar"', 'class="mini-avatar"')}<span class="name">${escapeHtml(p1?.name || "TBD")}</span><span class="sc">${m.score1 ?? "-"}</span></div>
    <div class="b-match-vs"></div>
    <div class="b-match-row ${winnerId === m.player2Id ? "win" : ""}">${avatarHtml(p2, 22).replace('class="sb-avatar"', 'class="mini-avatar"')}<span class="name">${escapeHtml(p2?.name || "TBD")}</span><span class="sc">${m.score2 ?? "-"}</span></div>
  </div>`;
}

// -------------------------------------------------------------------------
// LEADERBOARD
// -------------------------------------------------------------------------
document.getElementById("lbTabs").addEventListener("click", (e) => {
  const btn = e.target.closest(".lb-tab");
  if (!btn) return;
  lbSortKey = btn.dataset.key;
  document.querySelectorAll("#lbTabs .lb-tab").forEach((b) => b.classList.toggle("active", b === btn));
  renderLeaderboard();
});

function renderLeaderboard() {
  const seasonId = currentSeasonId === "all" ? null : currentSeasonId;
  const isPassing = lbSortKey === "passing";
  const rows = isPassing
    ? buildPassingLeaderboard(players, matches, seasonId).filter((r) => r.played > 0)
    : buildLeaderboard(players, matches, seasonId, lbSortKey).filter((r) => r.played > 0);
  const podiumHost = document.getElementById("leaderboardPodium");
  const host = document.getElementById("leaderboardList");
  const metricLabel = lbSortKey === "goals" ? "Goals" : lbSortKey === "wins" ? "Wins" : "Passes";
  const gb = computeGoldenBoot(players, matches, seasonId);
  const activeSeason = seasons.find((s) => s.id === currentSeasonId);
  const mvpId = activeSeason?.mvpPlayerId || null;

  if (!rows.length) {
    podiumHost.innerHTML = "";
    host.innerHTML = isPassing
      ? emptyState(ICONS.activity, "No passing stats yet", "Passing numbers come from the match stats admins enter after each match.")
      : emptyState(ICONS.trophy, "No stats yet", "Once matches are played, rankings will appear here.");
    return;
  }

  const rowMetric = (r) => (lbSortKey === "goals" ? r.goals : lbSortKey === "wins" ? r.wins : r.passes);

  const top3 = rows.slice(0, 3);
  const medalCls = ["g", "s", "b"];
  const accents = ["255,179,71", "201,210,227", "201,137,90"];
  const platformH = [64, 46, 32];
  podiumHost.innerHTML = top3.length === 3 ? `<div class="podium">
    ${top3.map((r, i) => `
      <div class="glass podium-card glass-hover rank${i + 1}" onclick="openProfile('${r.player.id}')">
        <div class="podium-avatar-wrap">${avatarHtml(r.player, 100).replace('class="sb-avatar"', 'class="sb-avatar" style="width:100%;height:100%"')}<div class="podium-medal ${medalCls[i]}">${i + 1}</div></div>
        <div class="podium-name">${escapeHtml(r.player.name)}</div>
        <div class="podium-metric">${rowMetric(r)}</div>
        <div class="podium-metric-label">${metricLabel}</div>
        ${isPassing ? `<div class="podium-sub-metric">${r.successfulPasses} successful</div>` : ""}
        <div class="podium-platform" style="height:${platformH[i]}px;--accent:${accents[i]}">${i + 1}</div>
      </div>`).join("")}
  </div>` : "";

  const rest = top3.length === 3 ? rows.slice(3) : rows;
  const leaderMetric = Math.max(1, rowMetric(rows[0]) || 1);
  host.innerHTML = rest.map((r, idx) => {
    const i = top3.length === 3 ? idx + 3 : idx;
    const metric = rowMetric(r);
    const badges = !isPassing ? [gb && gb.player.id === r.player.id ? awardBadgeHtml("boot", true) : "", mvpId === r.player.id ? awardBadgeHtml("mvp", true) : ""].join(" ") : "";
    const subLine = isPassing ? `${r.played} played · ${r.successfulPasses} successful passes` : `${r.played} played · ${r.wins}W ${r.losses}L`;
    return `<div class="glass lb-row glass-hover" onclick="openProfile('${r.player.id}')">
      <div class="lb-rank">${i + 1}</div>
      ${avatarHtml(r.player, 40)}
      <div class="lb-info">
        <div class="lb-name">${escapeHtml(r.player.name)} ${badges}</div>
        <div class="lb-sub">${subLine}</div>
        <div class="lb-bar-track"><div class="lb-bar-fill" style="width:${Math.round((metric / leaderMetric) * 100)}%"></div></div>
      </div>
      <div><div class="lb-metric">${metric}</div><div class="lb-metric-label">${metricLabel}</div></div>
    </div>`;
  }).join("");
}

// -------------------------------------------------------------------------
// PLAYERS + COMPARE MODE
// -------------------------------------------------------------------------
document.getElementById("playerSearchInput").addEventListener("input", (e) => { playerSearchTerm = e.target.value.trim().toLowerCase(); renderPlayers(); });

document.getElementById("compareModeBtn").addEventListener("click", () => {
  compareModeActive = !compareModeActive;
  compareSelection = [];
  setCompareModeBtnLabel();
  document.getElementById("playersGrid").classList.toggle("compare-mode", compareModeActive);
  document.getElementById("compareHint").style.display = compareModeActive ? "inline-flex" : "none";
  document.getElementById("compareBar").style.display = compareModeActive ? "flex" : "none";
  updateCompareBar();
  renderPlayers();
});
document.getElementById("compareCancelBtn").addEventListener("click", () => document.getElementById("compareModeBtn").click());
document.getElementById("compareGoBtn").addEventListener("click", () => {
  if (compareSelection.length === 2) {
    const [a, b] = compareSelection;
    document.getElementById("compareModeBtn").click(); // exit compare-select mode
    openCompareView(a, b);
  }
});
function updateCompareBar() {
  document.getElementById("compareBarLabel").textContent = compareSelection.length === 2
    ? `${playerById(compareSelection[0])?.name || ""} vs ${playerById(compareSelection[1])?.name || ""}`
    : `Select 2 players (${compareSelection.length}/2)`;
  document.getElementById("compareGoBtn").disabled = compareSelection.length !== 2;
}

function renderPlayers() {
  const host = document.getElementById("playersGrid");
  let list = [...players];
  if (playerSearchTerm) list = list.filter((p) => (p.name || "").toLowerCase().includes(playerSearchTerm));
  if (!players.length) { host.innerHTML = emptyState(ICONS.players, "No players yet", "The admin hasn't added any players yet."); return; }
  if (!list.length) { host.innerHTML = emptyState(ICONS.search, "No matches found", "Try a different search term."); return; }
  list.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  const gb = computeGoldenBoot(players, matches, null);
  host.innerHTML = list.map((p, i) => {
    const stats = computePlayerStats(matches, p.id, null);
    const picked = compareSelection.includes(p.id);
    const isGb = gb && gb.player.id === p.id;
    return `<div class="glass player-card glass-hover selectable ${picked ? "picked" : ""}" onclick="onPlayerCardTap('${p.id}')">
      <div class="jersey-no">#${String(i + 1).padStart(2, "0")}</div>
      <div class="compare-check">${ICONS.check}</div>
      ${isGb ? `<div class="player-card-award" style="background:rgba(53,226,122,0.18);color:var(--turf)">${ICONS.boot}</div>` : ""}
      <div class="p-avatar-ring">${avatarHtml(p, 58)}</div>
      <div class="p-name">${escapeHtml(p.name)}</div>
      <div class="p-sub-badges">
        <span class="p-mini-badge goal">${iconSize(ICONS.goal, 10)}${stats.goals}</span>
        <span class="p-mini-badge win">${iconSize(ICONS.flag, 10)}${stats.wins}</span>
      </div>
    </div>`;
  }).join("");
}

// -------------------------------------------------------------------------
// HALL OF FAME — one "season spotlight" card per completed season, newest
// first (the seasons array is already ordered that way from Firestore).
// -------------------------------------------------------------------------
function renderHOF() {
  const scroller = document.getElementById("hofScroller");
  const dotsHost = document.getElementById("hofDots");

  const entries = seasons.map((s) => {
    const seasonMatchList = matches.filter((m) => m.seasonId === s.id);
    const finalMatch = seasonMatchList.find((m) => m.round === "F");
    const winnerId = finalMatch ? matchWinnerId(finalMatch) : null;
    if (!winnerId) return null; // only induct seasons whose Final is decided
    const runnerUpId = finalMatch.player1Id === winnerId ? finalMatch.player2Id : finalMatch.player1Id;
    const thirdMatch = seasonMatchList.find((m) => m.round === "3RD");
    const thirdWinnerId = thirdMatch ? matchWinnerId(thirdMatch) : null;
    return {
      season: s,
      champion: playerById(winnerId),
      runnerUp: playerById(runnerUpId),
      third: thirdWinnerId ? playerById(thirdWinnerId) : null,
      goldenBoot: computeGoldenBoot(players, matches, s.id),
      mvp: s.mvpPlayerId ? playerById(s.mvpPlayerId) : null,
    };
  }).filter(Boolean);

  if (!entries.length) {
    scroller.innerHTML = emptyState(ICONS.trophy, "No champions yet", "Once a season's Final is decided, it'll be inducted here.");
    dotsHost.innerHTML = "";
    scroller.onscroll = null;
    return;
  }

  scroller.innerHTML = entries.map(hofCardHtml).join("");
  dotsHost.innerHTML = entries.map((_, i) => `<div class="hof-dot ${i === 0 ? "active" : ""}"></div>`).join("");

  const dots = Array.from(dotsHost.children);
  scroller.onscroll = () => {
    const idx = Math.round(scroller.scrollLeft / Math.max(1, scroller.clientWidth));
    dots.forEach((d, i) => d.classList.toggle("active", i === idx));
  };
}

function hofCardHtml(e) {
  const champ = e.champion;
  const champPhoto = champ?.photoUrl
    ? `<img src="${escapeHtml(champ.photoUrl)}" alt="${escapeHtml(champ.name)}" onerror="this.outerHTML='<div class=\\'avatar-fallback\\'>${escapeHtml(getInitials(champ?.name))}</div>'">`
    : `<div class="avatar-fallback">${escapeHtml(getInitials(champ?.name))}</div>`;
  return `<div class="glass hof-card">
    <div class="hof-card-head">
      <div class="hof-season-name">${escapeHtml(e.season.name)}</div>
      <div class="pill pill-gold">Completed</div>
    </div>
    <div class="hof-champ-photo" ${champ ? `onclick="openProfile('${champ.id}')"` : ""}>
      ${champPhoto}
      <div class="hof-champ-crown">${iconSize(ICONS.trophy, 17)}</div>
    </div>
    <div class="hof-champ-body">
      <div class="champ-name">${escapeHtml(champ?.name || "TBD")}</div>
      <div class="champ-kicker">${iconSize(ICONS.star, 11)}<span>CHAMPION</span></div>
    </div>
    <div class="hof-runners">
      <div class="glass hof-runner glass-hover silver" ${e.runnerUp ? `onclick="openProfile('${e.runnerUp.id}')"` : ""}>
        <div class="hof-runner-ring">${avatarHtml(e.runnerUp, 46)}</div>
        <div class="hof-runner-name">${escapeHtml(e.runnerUp?.name || "TBD")}</div>
        <div class="hof-runner-label">Runner-Up</div>
      </div>
      <div class="glass hof-runner glass-hover bronze" ${e.third ? `onclick="openProfile('${e.third.id}')"` : ""}>
        <div class="hof-runner-ring">${avatarHtml(e.third, 46)}</div>
        <div class="hof-runner-name">${escapeHtml(e.third?.name || "TBD")}</div>
        <div class="hof-runner-label">3rd Place</div>
      </div>
    </div>
    <div class="hof-awards">
      ${e.goldenBoot ? `<div class="glass award-chip glass-hover" style="--accent:53,226,122" onclick="openProfile('${e.goldenBoot.player.id}')">
          <div class="aw-icon">${ICONS.boot}</div>
          <div><div class="aw-label">Golden Boot</div><div class="aw-name">${escapeHtml(e.goldenBoot.player.name)} · ${e.goldenBoot.goals}</div></div>
        </div>` : `<div class="glass hof-empty-award">No Golden Boot data</div>`}
      ${e.mvp ? `<div class="glass award-chip glass-hover" style="--accent:255,179,71" onclick="openProfile('${e.mvp.id}')">
          <div class="aw-icon">${ICONS.star}</div>
          <div><div class="aw-label">Season MVP</div><div class="aw-name">${escapeHtml(e.mvp.name)}</div></div>
        </div>` : `<div class="glass hof-empty-award">No MVP set</div>`}
    </div>
  </div>`;
}

function onPlayerCardTap(playerId) {
  if (!compareModeActive) { openProfile(playerId); return; }
  const idx = compareSelection.indexOf(playerId);
  if (idx > -1) compareSelection.splice(idx, 1);
  else if (compareSelection.length < 2) compareSelection.push(playerId);
  updateCompareBar();
  renderPlayers();
}
window.onPlayerCardTap = onPlayerCardTap;

// -------------------------------------------------------------------------
// COMPARE VIEW
// -------------------------------------------------------------------------
function openCompareView(aId, bId) {
  compareState = { a: aId, b: bId || null };
  currentView = "compare";
  document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
  document.getElementById("view-compare").classList.add("active");
  window.scrollTo({ top: 0, behavior: "smooth" });
  renderCompare();
}
window.openCompareView = openCompareView;

function pickCompareOpponent(playerId) { compareState.b = playerId; renderCompare(); }
window.pickCompareOpponent = pickCompareOpponent;

function statBarRow(label, aVal, bVal) {
  const max = Math.max(aVal, bVal, 1);
  return `<div class="glass cmp-stat-row">
    <div class="cmp-stat-label">${label}</div>
    <div class="cmp-stat-bars">
      <div class="cmp-bar-val">${aVal}</div>
      <div style="display:flex;gap:8px;width:120px;">
        <div class="cmp-bar-track left" style="flex:1;"><div class="cmp-bar-fill a" style="width:${(aVal/max)*100}%"></div></div>
        <div class="cmp-bar-track" style="flex:1;"><div class="cmp-bar-fill b" style="width:${(bVal/max)*100}%"></div></div>
      </div>
      <div class="cmp-bar-val">${bVal}</div>
    </div>
  </div>`;
}

function renderCompare() {
  const host = document.getElementById("compareContent");
  const a = playerById(compareState.a);
  if (!a) { host.innerHTML = emptyState(ICONS.compare, "Pick players to compare", "Go back and select two players."); return; }

  if (!compareState.b) {
    const others = players.filter((p) => p.id !== a.id).sort((x, y) => (x.name || "").localeCompare(y.name || ""));
    host.innerHTML = `
      <div class="cmp-header"><div class="cmp-player">${avatarHtml(a, 64)}<div style="font-weight:700;">${escapeHtml(a.name)}</div></div>
      <div class="cmp-vs-badge">VS</div>
      <div class="cmp-player" style="opacity:.4;"><div class="sb-avatar" style="width:64px;height:64px;border-radius:18px;"></div><div>?</div></div></div>
      <h3 style="margin-bottom:12px;">Choose an opponent</h3>
      <div class="player-grid stagger">${others.map((p) => `<div class="glass player-card glass-hover" onclick="pickCompareOpponent('${p.id}')">${avatarHtml(p, 58)}<div class="p-name">${escapeHtml(p.name)}</div></div>`).join("")}</div>
    `;
    return;
  }

  const b = playerById(compareState.b);
  const sa = computePlayerStats(matches, a.id, null);
  const sb = computePlayerStats(matches, b.id, null);
  const wrA = sa.played ? Math.round((sa.wins / sa.played) * 100) : 0;
  const wrB = sb.played ? Math.round((sb.wins / sb.played) * 100) : 0;
  const h2h = computeHeadToHead(matches, a.id, b.id);

  host.innerHTML = `
    <div class="cmp-header">
      <div class="cmp-player">${avatarHtml(a, 64)}<div style="font-weight:700;">${escapeHtml(a.name)}</div></div>
      <div class="cmp-vs-badge">VS</div>
      <div class="cmp-player">${avatarHtml(b, 64)}<div style="font-weight:700;">${escapeHtml(b.name)}</div></div>
    </div>
    ${statBarRow("Goals", sa.goals, sb.goals)}
    ${statBarRow("Wins", sa.wins, sb.wins)}
    ${statBarRow("Losses", sa.losses, sb.losses)}
    ${statBarRow("Win Rate %", wrA, wrB)}

    <h3 class="cmp-h2h-title">Head-to-Head</h3>
    ${h2h.list.length ? `
      <div class="glass card" style="text-align:center;display:flex;justify-content:space-around;margin-bottom:14px;">
        <div><div class="mono" style="font-size:20px;font-weight:700;color:var(--turf)">${h2h.aWins}</div><div style="font-size:10.5px;color:var(--ink-faint)">${escapeHtml(a.name)} wins</div></div>
        <div><div class="mono" style="font-size:20px;font-weight:700;">${h2h.list.length}</div><div style="font-size:10.5px;color:var(--ink-faint)">Meetings</div></div>
        <div><div class="mono" style="font-size:20px;font-weight:700;color:var(--electric)">${h2h.bWins}</div><div style="font-size:10.5px;color:var(--ink-faint)">${escapeHtml(b.name)} wins</div></div>
      </div>
      <div class="stagger">${h2h.list.map((m) => matchScoreboardHtml(m)).join("")}</div>
    ` : emptyState(ICONS.activity, "Haven't played yet", `${a.name} and ${b.name} haven't faced each other.`)}
    <button class="btn btn-ghost btn-block" style="margin-top:16px;" onclick="openCompareView('${b.id}', null)">${ICONS.compare}<span>Compare Someone Else</span></button>
  `;
}

// -------------------------------------------------------------------------
// PLAYER PROFILE
// -------------------------------------------------------------------------
function renderProfile() {
  const p = playerById(profilePlayerId);
  const host = document.getElementById("profileContent");
  if (!p) { host.innerHTML = emptyState(ICONS.players, "Player not found", ""); return; }

  const seasonId = profileTab === "all" ? null : profileTab;
  const stats = computePlayerStats(matches, p.id, seasonId);
  const winRate = stats.played ? Math.round((stats.wins / stats.played) * 100) : 0;
  const playerMatches = sortByRound(matches.filter((m) => (m.player1Id === p.id || m.player2Id === p.id) && (seasonId ? m.seasonId === seasonId : true) && m.score1 != null))
    .sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));

  const mvpSeasons = seasons.filter((s) => s.mvpPlayerId === p.id);
  const gbSeasons = seasons.filter((s) => { const gb = computeGoldenBoot(players, matches, s.id); return gb && gb.player.id === p.id; });
  const allTimeGb = computeGoldenBoot(players, matches, null);
  const awardsHtml = [
    ...(allTimeGb && allTimeGb.player.id === p.id ? [`${awardBadgeHtml("boot")}`] : []),
    ...mvpSeasons.map((s) => `<span class="award-badge mvp">${ICONS.star}<span>MVP · ${escapeHtml(s.name)}</span></span>`),
    ...gbSeasons.map((s) => `<span class="award-badge boot">${ICONS.boot}<span>Boot · ${escapeHtml(s.name)}</span></span>`),
  ].join(" ");

  const tabsHtml = `<div class="lb-tabs" id="profileTabs">
    <button class="lb-tab ${profileTab === "all" ? "active" : ""}" data-tab="all">All-Time</button>
    ${seasons.map((s) => `<button class="lb-tab ${profileTab === s.id ? "active" : ""}" data-tab="${s.id}">${escapeHtml(s.name)}</button>`).join("")}
  </div>`;

  host.innerHTML = `
    <div class="glass profile-hero">
      <div class="profile-avatar-ring">${avatarHtml(p, 200).replace('class="sb-avatar"', 'class="sb-avatar" style="width:100%;height:100%"')}</div>
      <h1>${escapeHtml(p.name)}</h1>
      <p>${stats.played} matches played</p>
      ${awardsHtml ? `<div style="display:flex;gap:6px;justify-content:center;flex-wrap:wrap;margin-top:10px;position:relative;z-index:1;">${awardsHtml}</div>` : ""}
      <div class="win-ring-wrap">
        <div style="position:relative;width:96px;height:96px;display:flex;align-items:center;justify-content:center;">
          ${winRingSvg(winRate, 96)}
          <div style="position:absolute;text-align:center;"><div class="mono" style="font-size:20px;font-weight:700;">${winRate}%</div><div style="font-size:9px;color:var(--ink-faint);letter-spacing:.06em;">WIN RATE</div></div>
        </div>
      </div>
      <div class="profile-stats">
        <div class="glass stat-tile" style="text-align:center;align-items:center;"><div class="stat-value">${stats.goals}</div><div class="stat-label">Goals</div></div>
        <div class="glass stat-tile" style="text-align:center;align-items:center;"><div class="stat-value">${stats.wins}</div><div class="stat-label">Wins</div></div>
        <div class="glass stat-tile" style="text-align:center;align-items:center;"><div class="stat-value">${stats.losses}</div><div class="stat-label">Losses</div></div>
      </div>
      <button class="btn btn-ghost btn-block" style="margin-top:16px;position:relative;z-index:1;" onclick="openCompareView('${p.id}', null)">${ICONS.compare}<span>Compare with another player</span></button>
    </div>
    ${tabsHtml}
    <h3 style="margin:18px 0 10px;">Match History</h3>
    <div class="stagger" id="profileMatchList">${playerMatches.length ? playerMatches.map((m) => profileMatchRowHtml(m, p.id)).join("") : emptyState(ICONS.activity, "No matches yet", "")}</div>
  `;

  document.getElementById("profileTabs").addEventListener("click", (e) => {
    const btn = e.target.closest(".lb-tab");
    if (!btn) return;
    profileTab = btn.dataset.tab;
    renderProfile();
  });
}

function profileMatchRowHtml(m, playerId) {
  const isP1 = m.player1Id === playerId;
  const opponent = playerById(isP1 ? m.player2Id : m.player1Id);
  const myScore = isP1 ? m.score1 : m.score2;
  const oppScore = isP1 ? m.score2 : m.score1;
  const winnerId = matchWinnerId(m);
  const result = winnerId === playerId ? "W" : winnerId ? "L" : "-";
  return `<div class="glass match-history-row glass-hover" onclick="openMatchModal('${m.id}')">
    <div class="mh-result ${result}">${result}</div>
    ${avatarHtml(opponent, 32)}
    <div class="mh-opponent"><div class="op-name">${escapeHtml(opponent?.name || "TBD")}</div><div class="mh-meta">${ROUND_LABEL[m.round] || m.round} · ${formatDate(m.date)}${m.note ? " · " + iconSize(ICONS.note, 10) : ""}</div></div>
    <div class="mh-score">${myScore}-${oppScore}${m.wentToPenalty ? " (PK)" : ""}</div>
  </div>`;
}

// ===========================================================================
// MENISCUS liquid bottom nav engine — adapted from the open-source
// hasib41/meniscus-liquid-nav component (zero dependencies, MIT-style demo).
// Ported in as-is for the physics/geometry; the only real change is that
// select() calls this app's goToView() instead of swapping local panels,
// and a `silent` flag lets goToView() sync the bead back without looping.
// ===========================================================================
(function initMeniscusNav() {
  const mnRoot  = document.documentElement;
  const mnDock  = document.getElementById("dock");
  const mnSvg   = document.getElementById("skin");
  const mnFillP = document.getElementById("skinFill");
  const mnBead  = document.getElementById("bead");
  const mnTabs  = [...document.querySelectorAll('#tabs [role="tab"]')];
  if (!mnDock || !mnTabs.length) return;

  const mnReduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
  const mnClamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const mnSmooth = (t) => t * t * (3 - 2 * t);

  const mnHex = (s) => {
    const h = s.trim().replace("#", "");
    const n = parseInt(h.length === 3 ? h.replace(/./g, "$&$&") : h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };
  const MN_ACC = mnTabs.map((t) => mnHex(getComputedStyle(t).getPropertyValue("--acc") || "#35E27A"));
  const mnMixRGB = (a, b, t) =>
    `${Math.round(a[0] + (b[0] - a[0]) * t)} ${Math.round(a[1] + (b[1] - a[1]) * t)} ${Math.round(a[2] + (b[2] - a[2]) * t)}`;

  const G = { W: 0, H: 0, R: 17, D: 56, RB: 35, S: 17, CY: 0, slots: [], span: 80 };
  const reach = (s, rb, by) => Math.sqrt(Math.max((s + rb) ** 2 - (s - by) ** 2, 1));

  function measure() {
    const r = mnDock.getBoundingClientRect();
    const W = Math.round(r.width), H = Math.round(r.height);
    if (W < 40 || H < 30) return false;

    G.slots = mnTabs.map((t) => {
      const b = t.getBoundingClientRect();
      return b.left - r.left + b.width / 2;
    });
    G.span = G.slots.length > 1 ? G.slots[1] - G.slots[0] : W;
    G.W = W; G.H = H;
    G.R = mnClamp(H * 0.2, 13, 20);
    G.CY = 0;

    let D = Math.min(H * 0.68, G.span * 0.78);
    const room = G.slots[0] - G.R - 6;
    for (let i = 0; i < 3; i++) {
      const hw = reach(D * 0.22, D / 2 + 6, G.CY);
      if (hw <= room) break;
      D *= room / hw;
    }
    G.D = Math.max(Math.round(D), 30);
    G.S = G.D * 0.22;
    G.RB = G.D / 2 + 6;

    mnSvg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    mnDock.style.setProperty("--mn-dock-r", `${G.R.toFixed(1)}px`);
    mnDock.style.setProperty("--mn-bead-d", `${G.D}px`);
    mnDock.style.setProperty("--mn-bead-cy", `${G.CY}px`);
    mnDock.style.setProperty("--mn-rise", `${(H / 2 - G.CY).toFixed(1)}px`);
    return true;
  }

  function trough(bx, by, rb, sL, sR) {
    const { W, H, R } = G;
    const wing = (s, side) => {
      const L = s + rb;
      const half = reach(s, rb, by);
      const sx = bx + side * half;
      return { sx, s, tx: sx + ((bx - sx) / L) * s, ty: s + ((by - s) / L) * s };
    };
    const A = wing(sL, -1), B = wing(sR, +1);
    const a0 = Math.atan2(A.ty - by, A.tx - bx);
    const a1 = Math.atan2(B.ty - by, B.tx - bx);
    let sweep = ((a0 - a1) * 180) / Math.PI;
    while (sweep < 0) sweep += 360;
    const large = sweep > 180 ? 1 : 0;
    const n = (v) => v.toFixed(2);
    return (
      `M0 ${n(R)}` +
      `A${n(R)} ${n(R)} 0 0 1 ${n(R)} 0` +
      `L${n(mnClamp(A.sx, R, W - R))} 0` +
      `A${n(sL)} ${n(sL)} 0 0 1 ${n(A.tx)} ${n(A.ty)}` +
      `A${n(rb)} ${n(rb)} 0 ${large} 0 ${n(B.tx)} ${n(B.ty)}` +
      `A${n(sR)} ${n(sR)} 0 0 1 ${n(mnClamp(B.sx, R, W - R))} 0` +
      `L${n(W - R)} 0` +
      `A${n(R)} ${n(R)} 0 0 1 ${n(W)} ${n(R)}` +
      `L${n(W)} ${n(H - R)}` +
      `A${n(R)} ${n(R)} 0 0 1 ${n(W - R)} ${n(H)}` +
      `L${n(R)} ${n(H)}` +
      `A${n(R)} ${n(R)} 0 0 1 0 ${n(H - R)}` +
      `Z`
    );
  }

  let mx = 0, mv = 0, mTarget = 0, mDragging = false, mRaf = 0, mLast = 0;

  function paint() {
    const q = mnClamp(mv / 1100, -1, 1) * (mDragging ? 0.5 : 1);
    const mag = Math.abs(q);
    const sL = mnClamp(G.S * (1 + 0.06 * mag + 0.4 * q), G.S * 0.55, G.S * 2.1);
    const sR = mnClamp(G.S * (1 + 0.06 * mag - 0.4 * q), G.S * 0.55, G.S * 2.1);
    mFillPSet(trough(mx, G.CY, G.RB, sL, sR));

    const sx = 1 + 0.07 * mag;
    mnBead.style.transform = `translate3d(${mx.toFixed(2)}px,0,0) scale(${sx.toFixed(3)},${(1 / sx).toFixed(3)})`;

    let near = 0, nd = Infinity;
    for (let i = 0; i < mnTabs.length; i++) {
      const dx = Math.abs(mx - G.slots[i]);
      if (dx < nd) { nd = dx; near = i; }
      mnTabs[i].style.setProperty("--t", mnSmooth(mnClamp(1 - dx / (G.span * 0.55), 0, 1)).toFixed(3));
    }
    const side = mx >= G.slots[near] ? 1 : -1;
    const other = mnClamp(near + side, 0, mnTabs.length - 1);
    const t = other === near ? 0 : mnClamp(Math.abs(mx - G.slots[near]) / G.span, 0, 1);
    mnRoot.style.setProperty("--glow-rgb", mnMixRGB(MN_ACC[near], MN_ACC[other], t));
  }
  function mFillPSet(d) { mnFillP.setAttribute("d", d); }

  function loop(now) {
    mRaf = 0;
    const dt = Math.min((now - mLast) / 1000, 1 / 30);
    mLast = now;
    // Stiffened from the original tuning to shorten how long each tap keeps
    // recalculating the SVG path — same damping ratio (ζ≈.81), just quicker
    // to settle, since that per-frame path math is the nav's real perf cost.
    const K = mDragging ? 900 : 250;
    const C = mDragging ? 52 : 25.6;
    let step = dt;
    while (step > 0) {
      const h = Math.min(step, 1 / 240);
      mv += (-K * (mx - mTarget) - C * mv) * h;
      mx += mv * h;
      step -= h;
    }
    paint();
    if (Math.abs(mx - mTarget) > 0.05 || Math.abs(mv) > 0.6 || mDragging) run();
    else { mx = mTarget; mv = 0; paint(); }
  }
  function run() {
    if (mRaf) return;
    mLast = performance.now();
    mRaf = requestAnimationFrame(loop);
  }
  function jump(to) {
    mTarget = to;
    if (mnReduced() && !mDragging) { mx = to; mv = 0; paint(); return; }
    run();
  }

  let mCurrent = Math.max(0, mnTabs.findIndex((t) => t.getAttribute("aria-selected") === "true"));

  function select(i, { focus = false, animate = true, silent = false } = {}) {
    mCurrent = (i + mnTabs.length) % mnTabs.length;
    mnTabs.forEach((t, n) => {
      t.setAttribute("aria-selected", String(n === mCurrent));
      t.tabIndex = n === mCurrent ? 0 : -1;
    });
    if (focus) mnTabs[mCurrent].focus();
    if (animate) jump(G.slots[mCurrent]); else { mx = mTarget = G.slots[mCurrent]; mv = 0; paint(); }
    if (!silent) goToView(mnTabs[mCurrent].dataset.view);
  }

  let mnSuppressClick = false;
  mnTabs.forEach((t, i) => t.addEventListener("click", () => { if (!mnSuppressClick) select(i); }));

  document.getElementById("tabs").addEventListener("keydown", (e) => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    let next = null;
    if (step) next = mCurrent + step;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = mnTabs.length - 1;
    if (next === null) return;
    e.preventDefault();
    select(next, { focus: true });
  });

  let mStartX = 0, mPid = null;
  mnDock.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    mPid = e.pointerId; mStartX = e.clientX; mnSuppressClick = false;
  });
  mnDock.addEventListener("pointermove", (e) => {
    if (e.pointerId !== mPid) return;
    if (!mDragging && Math.abs(e.clientX - mStartX) < 7) return;
    if (!mDragging) { mDragging = true; mnSuppressClick = true; mnDock.classList.add("is-dragging"); mnDock.setPointerCapture(mPid); }
    e.preventDefault();
    const left = mnDock.getBoundingClientRect().left;
    mTarget = mnClamp(e.clientX - left, G.slots[0], G.slots[G.slots.length - 1]);
    run();
  });
  function release(e) {
    if (e.pointerId !== mPid) return;
    mPid = null;
    if (!mDragging) return;
    mDragging = false;
    mnDock.classList.remove("is-dragging");
    let near = 0, nd = Infinity;
    G.slots.forEach((s, i) => { const d = Math.abs(mTarget - s); if (d < nd) { nd = d; near = i; } });
    select(near);
    setTimeout(() => { mnSuppressClick = false; }, 0);
  }
  mnDock.addEventListener("pointerup", release);
  mnDock.addEventListener("pointercancel", release);

  function layout(animate) {
    if (!measure()) return;
    if (animate) jump(G.slots[mCurrent]); else { mx = mTarget = G.slots[mCurrent]; mv = 0; paint(); }
    mnDock.classList.add("is-ready");
  }
  layout(false);
  new ResizeObserver(() => layout(false)).observe(mnDock);
  document.fonts?.ready.then(() => layout(false));
  select(mCurrent, { animate: false, silent: true });

  // Exposed so goToView() can move the bead without re-triggering navigation.
  mnSyncTo = (view) => {
    const i = mnTabs.findIndex((t) => t.dataset.view === view);
    if (i > -1) select(i, { animate: true, silent: true });
  };
})();
