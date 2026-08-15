import { db, auth } from "./firebase-config.js";
import {
  collection, onSnapshot, query, orderBy, doc, setDoc, deleteDoc, addDoc,
  updateDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import {
  signInWithEmailAndPassword, onAuthStateChanged, signOut
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  ROUND_LABEL, avatarHtml, escapeHtml, toast, ICONS, computeGoldenBoot
} from "./utils.js";

// -------------------------------------------------------------------------
// Demo data — lets the admin preview a fully populated tournament instantly.
// All IDs are prefixed "demo_" so they can be cleanly seeded/cleared without
// touching any real data.
// -------------------------------------------------------------------------
const DEMO_SEASON_ID = "demo_season_1";
const DEMO_PLAYERS = [
  { id: "demo_p1", name: "Nayem" }, { id: "demo_p2", name: "Rafiq" },
  { id: "demo_p3", name: "Sabbir" }, { id: "demo_p4", name: "Tanvir" },
  { id: "demo_p5", name: "Arif" }, { id: "demo_p6", name: "Fahim" },
  { id: "demo_p7", name: "Rakib" }, { id: "demo_p8", name: "Shanto" },
];
const DEMO_MATCHES = [
  { round: "QF", position: 0, p1: "demo_p1", p2: "demo_p2", s1: 3, s2: 1, date: "2026-07-01",
    st1: { possession: 58, shots: 11, shotsOnTarget: 7, passes: 210, successfulPasses: 178, saves: 3 },
    st2: { possession: 42, shots: 6, shotsOnTarget: 3, passes: 150, successfulPasses: 112, saves: 4 } },
  { round: "QF", position: 1, p1: "demo_p3", p2: "demo_p4", s1: 2, s2: 2, pk: true, pk1: 4, pk2: 3, date: "2026-07-01",
    st1: { possession: 51, shots: 9, shotsOnTarget: 5, passes: 188, successfulPasses: 151, saves: 4 },
    st2: { possession: 49, shots: 8, shotsOnTarget: 5, passes: 176, successfulPasses: 140, saves: 3 } },
  { round: "QF", position: 2, p1: "demo_p5", p2: "demo_p6", s1: 1, s2: 0, date: "2026-07-02",
    st1: { possession: 55, shots: 7, shotsOnTarget: 4, passes: 164, successfulPasses: 130, saves: 2 },
    st2: { possession: 45, shots: 5, shotsOnTarget: 2, passes: 140, successfulPasses: 101, saves: 3 } },
  { round: "QF", position: 3, p1: "demo_p7", p2: "demo_p8", s1: 4, s2: 2, date: "2026-07-02",
    st1: { possession: 60, shots: 13, shotsOnTarget: 8, passes: 221, successfulPasses: 190, saves: 1 },
    st2: { possession: 40, shots: 7, shotsOnTarget: 4, passes: 132, successfulPasses: 95, saves: 4 } },
  { round: "SF", position: 0, p1: "demo_p1", p2: "demo_p3", s1: 2, s2: 1, date: "2026-07-08",
    st1: { possession: 53, shots: 9, shotsOnTarget: 5, passes: 195, successfulPasses: 160, saves: 3 },
    st2: { possession: 47, shots: 7, shotsOnTarget: 4, passes: 168, successfulPasses: 128, saves: 3 } },
  { round: "SF", position: 1, p1: "demo_p5", p2: "demo_p7", s1: 0, s2: 0, pk: true, pk1: 5, pk2: 4, date: "2026-07-08",
    st1: { possession: 49, shots: 6, shotsOnTarget: 3, passes: 172, successfulPasses: 138, saves: 5 },
    st2: { possession: 51, shots: 8, shotsOnTarget: 4, passes: 180, successfulPasses: 145, saves: 3 } },
  { round: "3RD", position: 0, p1: "demo_p3", p2: "demo_p7", s1: 3, s2: 2, date: "2026-07-15",
    st1: { possession: 52, shots: 10, shotsOnTarget: 6, passes: 190, successfulPasses: 155, saves: 2 },
    st2: { possession: 48, shots: 9, shotsOnTarget: 5, passes: 175, successfulPasses: 133, saves: 3 } },
  { round: "F", position: 0, p1: "demo_p1", p2: "demo_p5", s1: 2, s2: 0, date: "2026-07-15",
    st1: { possession: 57, shots: 12, shotsOnTarget: 7, passes: 232, successfulPasses: 201, saves: 4 },
    st2: { possession: 43, shots: 5, shotsOnTarget: 2, passes: 149, successfulPasses: 108, saves: 5 } },
];

async function seedDemoData() {
  const btn = document.getElementById("seedDemoBtn");
  btn.disabled = true; btn.textContent = "Loading...";
  try {
    await setDoc(doc(db, "seasons", DEMO_SEASON_ID), { name: "Demo Season", status: "completed", createdAt: serverTimestamp() }, { merge: true });
    for (const p of DEMO_PLAYERS) {
      await setDoc(doc(db, "players", p.id), { name: p.name, photoUrl: "", createdAt: serverTimestamp() }, { merge: true });
    }
    for (const m of DEMO_MATCHES) {
      const id = `${DEMO_SEASON_ID}__${m.round}__${m.position}`;
      await setDoc(doc(db, "matches", id), {
        seasonId: DEMO_SEASON_ID, round: m.round, bracketPosition: m.position,
        player1Id: m.p1, player2Id: m.p2, score1: m.s1, score2: m.s2,
        wentToPenalty: !!m.pk, penaltyScore1: m.pk ? m.pk1 : null, penaltyScore2: m.pk ? m.pk2 : null,
        date: m.date, stats1: m.st1, stats2: m.st2, updatedAt: serverTimestamp(),
      }, { merge: true });
    }
    toast("Demo data loaded — check the public site!");
  } catch (e) {
    toast("Couldn't load demo data.", "error");
  } finally {
    btn.disabled = false; btn.innerHTML = `${ICONS.wand} <span>Load Demo Data</span>`;
  }
}

async function clearDemoData() {
  const btn = document.getElementById("clearDemoBtn");
  btn.disabled = true; btn.textContent = "Clearing...";
  try {
    await deleteDoc(doc(db, "seasons", DEMO_SEASON_ID));
    for (const p of DEMO_PLAYERS) await deleteDoc(doc(db, "players", p.id));
    for (const m of DEMO_MATCHES) await deleteDoc(doc(db, "matches", `${DEMO_SEASON_ID}__${m.round}__${m.position}`));
    toast("Demo data cleared.");
  } catch (e) {
    toast("Couldn't clear demo data.", "error");
  } finally {
    btn.disabled = false; btn.innerHTML = `${ICONS.trash} <span>Clear Demo Data</span>`;
  }
}

// -------------------------------------------------------------------------
// Static bracket layout for an 8-player single-elimination knockout
// -------------------------------------------------------------------------
const BRACKET_SLOTS = [
  { round: "QF", position: 0 }, { round: "QF", position: 1 },
  { round: "QF", position: 2 }, { round: "QF", position: 3 },
  { round: "SF", position: 0 }, { round: "SF", position: 1 },
  { round: "3RD", position: 0 },
  { round: "F", position: 0 },
];

let players = [];
let seasons = [];
let matches = [];
let activeTab = "players";
let matchSeasonId = null;

// -------------------------------------------------------------------------
// Icons
// -------------------------------------------------------------------------
document.getElementById("logoutBtn").innerHTML = ICONS.logout;
document.getElementById("modalCloseBtn").innerHTML = ICONS.close;
document.getElementById("addPlayerBtn").innerHTML = `${ICONS.plus} <span>Add Player</span>`;
document.getElementById("addSeasonBtn").innerHTML = `${ICONS.plus} <span>Add Season</span>`;
document.getElementById("seedDemoBtn").innerHTML = `${ICONS.wand} <span>Load Demo Data</span>`;
document.getElementById("clearDemoBtn").innerHTML = `${ICONS.trash} <span>Clear Demo Data</span>`;
document.getElementById("seedDemoBtn").addEventListener("click", seedDemoData);
document.getElementById("clearDemoBtn").addEventListener("click", clearDemoData);

// -------------------------------------------------------------------------
// Auth
// -------------------------------------------------------------------------
document.getElementById("loginBtn").addEventListener("click", doLogin);
document.getElementById("loginPassword").addEventListener("keydown", (e) => { if (e.key === "Enter") doLogin(); });

async function doLogin() {
  const email = document.getElementById("loginEmail").value.trim();
  const password = document.getElementById("loginPassword").value;
  const errEl = document.getElementById("loginError");
  errEl.textContent = "";
  if (!email || !password) { errEl.textContent = "Enter email and password."; return; }
  const btn = document.getElementById("loginBtn");
  btn.disabled = true; btn.textContent = "Signing in...";
  try {
    await signInWithEmailAndPassword(auth, email, password);
  } catch (err) {
    errEl.textContent = "Incorrect email or password.";
  } finally {
    btn.disabled = false; btn.textContent = "Sign In";
  }
}

document.getElementById("logoutBtn").addEventListener("click", () => signOut(auth));

onAuthStateChanged(auth, (user) => {
  document.getElementById("loginWrap").style.display = user ? "none" : "flex";
  document.getElementById("adminShell").style.display = user ? "block" : "none";
});

// -------------------------------------------------------------------------
// Live data
// -------------------------------------------------------------------------
onSnapshot(collection(db, "players"), (snap) => {
  players = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  renderPlayers();
  renderBracketBuilder();
  renderAwardsTab();
});
onSnapshot(query(collection(db, "seasons"), orderBy("createdAt", "desc")), (snap) => {
  seasons = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  renderSeasons();
  populateMatchSeasonSelect();
  populateAwardsSeasonSelect();
});
onSnapshot(collection(db, "matches"), (snap) => {
  matches = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  renderBracketBuilder();
  renderAwardsTab();
});

// -------------------------------------------------------------------------
// Tabs
// -------------------------------------------------------------------------
document.querySelectorAll(".admin-tab").forEach((btn) => {
  btn.addEventListener("click", () => {
    activeTab = btn.dataset.tab;
    document.querySelectorAll(".admin-tab").forEach((b) => b.classList.toggle("active", b === btn));
    ["players", "seasons", "matches", "awards"].forEach((t) => {
      document.getElementById(`panel-${t}`).style.display = t === activeTab ? "block" : "none";
    });
  });
});

// -------------------------------------------------------------------------
// Modal helper
// -------------------------------------------------------------------------
const overlay = document.getElementById("modalOverlay");
document.getElementById("modalCloseBtn").addEventListener("click", closeModal);
overlay.addEventListener("click", (e) => { if (e.target === overlay) closeModal(); });

function openModal(title, bodyHtml) {
  document.getElementById("modalTitle").textContent = title;
  document.getElementById("modalBody").innerHTML = bodyHtml;
  overlay.classList.add("open");
}
function closeModal() { overlay.classList.remove("open"); }

// -------------------------------------------------------------------------
// PLAYERS
// -------------------------------------------------------------------------
function renderPlayers() {
  const host = document.getElementById("playersList");
  if (!players.length) {
    host.innerHTML = `<div class="empty-state"><h3>No players yet</h3><p>Add your first player to get started.</p></div>`;
    return;
  }
  const sorted = [...players].sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  host.innerHTML = sorted.map((p) => `
    <div class="glass list-row">
      ${avatarHtml(p, 42)}
      <div class="li-main">
        <div class="li-title">${escapeHtml(p.name)}</div>
        <div class="li-sub">${p.photoUrl ? "Photo linked" : "No photo"}</div>
      </div>
      <div class="row-actions">
        <button class="icon-btn" data-edit-player="${p.id}">${ICONS.edit}</button>
        <button class="icon-btn danger" data-del-player="${p.id}">${ICONS.trash}</button>
      </div>
    </div>`).join("");

  host.querySelectorAll("[data-edit-player]").forEach((b) => b.addEventListener("click", () => openPlayerModal(b.dataset.editPlayer)));
  host.querySelectorAll("[data-del-player]").forEach((b) => b.addEventListener("click", () => confirmDeletePlayer(b.dataset.delPlayer)));
}

document.getElementById("addPlayerBtn").addEventListener("click", () => openPlayerModal(null));

function openPlayerModal(playerId) {
  const p = playerId ? players.find((x) => x.id === playerId) : null;
  openModal(p ? "Edit Player" : "Add Player", `
    <div class="field"><label>Name</label><input id="pfName" value="${p ? escapeHtml(p.name) : ""}" placeholder="Player name"></div>
    <div class="field"><label>Photo Link (optional)</label><input id="pfPhoto" value="${p?.photoUrl ? escapeHtml(p.photoUrl) : ""}" placeholder="https://i.postimg.cc/..."></div>
    <button class="btn btn-primary btn-block" id="pfSaveBtn">${p ? "Save Changes" : "Add Player"}</button>
  `);
  document.getElementById("pfSaveBtn").addEventListener("click", async () => {
    const name = document.getElementById("pfName").value.trim();
    const photoUrl = document.getElementById("pfPhoto").value.trim();
    if (!name) { toast("Enter a player name.", "error"); return; }
    try {
      if (p) {
        await updateDoc(doc(db, "players", p.id), { name, photoUrl });
        toast("Player updated.");
      } else {
        await addDoc(collection(db, "players"), { name, photoUrl, createdAt: serverTimestamp() });
        toast("Player added.");
      }
      closeModal();
    } catch (e) { toast("Something went wrong.", "error"); }
  });
}

function confirmDeletePlayer(playerId) {
  const p = players.find((x) => x.id === playerId);
  openModal("Delete Player", `
    <p style="margin-bottom:18px;">Remove <strong style="color:var(--ink)">${escapeHtml(p?.name || "")}</strong>? Their past match records will stay but will show as an unlinked player.</p>
    <div style="display:flex;gap:10px;">
      <button class="btn btn-ghost" style="flex:1" id="cancelDel">Cancel</button>
      <button class="btn btn-danger" style="flex:1" id="confirmDel">Delete</button>
    </div>
  `);
  document.getElementById("cancelDel").addEventListener("click", closeModal);
  document.getElementById("confirmDel").addEventListener("click", async () => {
    await deleteDoc(doc(db, "players", playerId));
    toast("Player deleted.");
    closeModal();
  });
}

// -------------------------------------------------------------------------
// SEASONS
// -------------------------------------------------------------------------
function renderSeasons() {
  const host = document.getElementById("seasonsList");
  if (!seasons.length) {
    host.innerHTML = `<div class="empty-state"><h3>No seasons yet</h3><p>Create a season before building its bracket.</p></div>`;
    return;
  }
  host.innerHTML = seasons.map((s) => `
    <div class="glass list-row">
      <div class="li-main">
        <div class="li-title">${escapeHtml(s.name)}</div>
        <div class="li-sub">${(s.status || "ongoing") === "completed" ? "Completed" : "Ongoing"}</div>
      </div>
      <div class="row-actions">
        <button class="icon-btn" data-edit-season="${s.id}">${ICONS.edit}</button>
        <button class="icon-btn danger" data-del-season="${s.id}">${ICONS.trash}</button>
      </div>
    </div>`).join("");
  host.querySelectorAll("[data-edit-season]").forEach((b) => b.addEventListener("click", () => openSeasonModal(b.dataset.editSeason)));
  host.querySelectorAll("[data-del-season]").forEach((b) => b.addEventListener("click", () => confirmDeleteSeason(b.dataset.delSeason)));
}

document.getElementById("addSeasonBtn").addEventListener("click", () => openSeasonModal(null));

function openSeasonModal(seasonId) {
  const s = seasonId ? seasons.find((x) => x.id === seasonId) : null;
  openModal(s ? "Edit Season" : "Add Season", `
    <div class="field"><label>Season Name</label><input id="sfName" value="${s ? escapeHtml(s.name) : ""}" placeholder="Season 1"></div>
    <div class="field"><label>Status</label>
      <select id="sfStatus">
        <option value="ongoing" ${s?.status !== "completed" ? "selected" : ""}>Ongoing</option>
        <option value="completed" ${s?.status === "completed" ? "selected" : ""}>Completed</option>
      </select>
    </div>
    <button class="btn btn-primary btn-block" id="sfSaveBtn">${s ? "Save Changes" : "Create Season"}</button>
  `);
  document.getElementById("sfSaveBtn").addEventListener("click", async () => {
    const name = document.getElementById("sfName").value.trim();
    const status = document.getElementById("sfStatus").value;
    if (!name) { toast("Enter a season name.", "error"); return; }
    try {
      if (s) {
        await updateDoc(doc(db, "seasons", s.id), { name, status });
        toast("Season updated.");
      } else {
        await addDoc(collection(db, "seasons"), { name, status, createdAt: serverTimestamp() });
        toast("Season created.");
      }
      closeModal();
    } catch (e) { toast("Something went wrong.", "error"); }
  });
}

function confirmDeleteSeason(seasonId) {
  const s = seasons.find((x) => x.id === seasonId);
  openModal("Delete Season", `
    <p style="margin-bottom:18px;">Delete <strong style="color:var(--ink)">${escapeHtml(s?.name || "")}</strong>? Its matches will remain but won't be linked to a valid season.</p>
    <div style="display:flex;gap:10px;">
      <button class="btn btn-ghost" style="flex:1" id="cancelDelS">Cancel</button>
      <button class="btn btn-danger" style="flex:1" id="confirmDelS">Delete</button>
    </div>
  `);
  document.getElementById("cancelDelS").addEventListener("click", closeModal);
  document.getElementById("confirmDelS").addEventListener("click", async () => {
    await deleteDoc(doc(db, "seasons", seasonId));
    toast("Season deleted.");
    closeModal();
  });
}

// -------------------------------------------------------------------------
// MATCHES / BRACKET BUILDER
// -------------------------------------------------------------------------
function populateMatchSeasonSelect() {
  const sel = document.getElementById("matchSeasonSelect");
  const prev = matchSeasonId;
  sel.innerHTML = seasons.map((s) => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join("");
  matchSeasonId = (prev && seasons.some((s) => s.id === prev)) ? prev : (seasons[0]?.id || null);
  if (matchSeasonId) sel.value = matchSeasonId;
  renderBracketBuilder();
}
document.getElementById("matchSeasonSelect").addEventListener("change", (e) => {
  matchSeasonId = e.target.value;
  renderBracketBuilder();
});

function playerOptions(selectedId) {
  return `<option value="">Select player</option>` + players
    .slice().sort((a, b) => (a.name || "").localeCompare(b.name || ""))
    .map((p) => `<option value="${p.id}" ${p.id === selectedId ? "selected" : ""}>${escapeHtml(p.name)}</option>`).join("");
}

function renderBracketBuilder() {
  const host = document.getElementById("bracketBuilder");
  if (!matchSeasonId) {
    host.innerHTML = `<div class="empty-state"><h3>No season selected</h3><p>Create a season first in the Seasons tab.</p></div>`;
    return;
  }
  if (!players.length) {
    host.innerHTML = `<div class="empty-state"><h3>No players yet</h3><p>Add players first in the Players tab.</p></div>`;
    return;
  }
  host.innerHTML = BRACKET_SLOTS.map((slot) => slotCardHtml(slot)).join("");
  BRACKET_SLOTS.forEach((slot) => wireSlot(slot));
}

function slotId(slot) { return `${matchSeasonId}__${slot.round}__${slot.position}`; }

const STAT_FIELDS = [
  ["possession", "Possession %"], ["shots", "Shots"], ["shotsOnTarget", "Shots on Target"],
  ["passes", "Passes"], ["successfulPasses", "Successful Passes"], ["saves", "Saves"],
];

function slotCardHtml(slot) {
  const id = slotId(slot);
  const m = matches.find((x) => x.id === id) || {};
  const label = `${ROUND_LABEL[slot.round]}${slot.round === "QF" || slot.round === "SF" ? ` #${slot.position + 1}` : ""}`;
  return `
  <div class="glass" style="padding:16px;margin-bottom:12px;">
    <div class="eyebrow" style="margin-bottom:12px;">${label}</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px;">
      <div class="field" style="margin-bottom:0;"><label>Player 1</label><select id="p1_${id}">${playerOptions(m.player1Id)}</select></div>
      <div class="field" style="margin-bottom:0;"><label>Player 2</label><select id="p2_${id}">${playerOptions(m.player2Id)}</select></div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px;">
      <div class="field" style="margin-bottom:0;"><label>Score 1</label><input type="number" min="0" id="s1_${id}" value="${m.score1 ?? ""}"></div>
      <div class="field" style="margin-bottom:0;"><label>Score 2</label><input type="number" min="0" id="s2_${id}" value="${m.score2 ?? ""}"></div>
    </div>
    <label style="display:flex;align-items:center;gap:8px;font-size:12.5px;color:var(--ink-dim);margin-bottom:10px;">
      <input type="checkbox" id="pk_${id}" ${m.wentToPenalty ? "checked" : ""}> Went to penalties
    </label>
    <div id="pkFields_${id}" style="display:${m.wentToPenalty ? "grid" : "none"};grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px;">
      <div class="field" style="margin-bottom:0;"><label>Penalty Score 1</label><input type="number" min="0" id="pk1_${id}" value="${m.penaltyScore1 ?? ""}"></div>
      <div class="field" style="margin-bottom:0;"><label>Penalty Score 2</label><input type="number" min="0" id="pk2_${id}" value="${m.penaltyScore2 ?? ""}"></div>
    </div>
    <div class="field"><label>Date</label><input type="date" id="dt_${id}" value="${m.date ? String(m.date).slice(0, 10) : ""}"></div>

    <div class="eyebrow" style="margin:14px 0 8px;">Match Stats — from the in-game screenshot</div>
    <div class="mstat-head"><span>P1</span><span></span><span>P2</span></div>
    ${STAT_FIELDS.map(([key, sLabel]) => `
      <div class="mstat-row">
        <input type="number" min="0" class="mstat-input" id="st1_${key}_${id}" value="${m.stats1?.[key] ?? ""}" placeholder="0">
        <span class="mstat-label">${sLabel}</span>
        <input type="number" min="0" class="mstat-input" id="st2_${key}_${id}" value="${m.stats2?.[key] ?? ""}" placeholder="0">
      </div>`).join("")}

    <div class="field" style="margin-top:12px;"><label>Match Highlights / Preview Note (optional)</label><textarea id="nt_${id}" rows="2" placeholder="e.g. Nail-biting finish, decided in the final minute..." style="width:100%;padding:12px 14px;border-radius:12px;border:1px solid var(--glass-border);background:rgba(255,255,255,0.04);color:var(--ink);font-family:var(--font-body);font-size:13.5px;resize:vertical;">${escapeHtml(m.note || "")}</textarea></div>
    <div style="display:flex;gap:8px;">
      <button class="btn btn-primary btn-sm" style="flex:1" id="save_${id}">Save</button>
      <button class="btn btn-ghost btn-sm" id="clear_${id}">Clear</button>
    </div>
  </div>`;
}

function wireSlot(slot) {
  const id = slotId(slot);
  const pkCheckbox = document.getElementById(`pk_${id}`);
  pkCheckbox.addEventListener("change", () => {
    document.getElementById(`pkFields_${id}`).style.display = pkCheckbox.checked ? "grid" : "none";
  });

  document.getElementById(`save_${id}`).addEventListener("click", async () => {
    const player1Id = document.getElementById(`p1_${id}`).value || null;
    const player2Id = document.getElementById(`p2_${id}`).value || null;
    if (player1Id && player2Id && player1Id === player2Id) {
      toast("Player 1 and Player 2 must be different.", "error"); return;
    }
    const s1raw = document.getElementById(`s1_${id}`).value;
    const s2raw = document.getElementById(`s2_${id}`).value;
    const wentToPenalty = pkCheckbox.checked;
    const pk1raw = document.getElementById(`pk1_${id}`).value;
    const pk2raw = document.getElementById(`pk2_${id}`).value;
    const dateVal = document.getElementById(`dt_${id}`).value;
    const note = document.getElementById(`nt_${id}`).value.trim();

    const stats1 = {}, stats2 = {};
    STAT_FIELDS.forEach(([key]) => {
      const v1 = document.getElementById(`st1_${key}_${id}`).value;
      const v2 = document.getElementById(`st2_${key}_${id}`).value;
      stats1[key] = v1 === "" ? null : Number(v1);
      stats2[key] = v2 === "" ? null : Number(v2);
    });

    const data = {
      seasonId: matchSeasonId,
      round: slot.round,
      bracketPosition: slot.position,
      player1Id, player2Id,
      score1: s1raw === "" ? null : Number(s1raw),
      score2: s2raw === "" ? null : Number(s2raw),
      wentToPenalty,
      penaltyScore1: wentToPenalty && pk1raw !== "" ? Number(pk1raw) : null,
      penaltyScore2: wentToPenalty && pk2raw !== "" ? Number(pk2raw) : null,
      date: dateVal || null,
      note: note || null,
      stats1, stats2,
      updatedAt: serverTimestamp(),
    };
    const missingStats = STAT_FIELDS.some(([key]) => stats1[key] == null || stats2[key] == null);
    try {
      await setDoc(doc(db, "matches", id), data, { merge: true });
      if (s1raw !== "" && s2raw !== "" && missingStats) toast("Saved — but some match stats are still empty.", "error");
      else toast("Match saved.");
    } catch (e) { toast("Something went wrong.", "error"); }
  });

  document.getElementById(`clear_${id}`).addEventListener("click", async () => {
    try {
      await deleteDoc(doc(db, "matches", id));
      toast("Slot cleared.");
    } catch (e) { /* doc may not exist yet, ignore */ }
  });
}

// -------------------------------------------------------------------------
// AWARDS TAB
// -------------------------------------------------------------------------
let awardsSeasonId = null;

function populateAwardsSeasonSelect() {
  const sel = document.getElementById("awardsSeasonSelect");
  const prev = awardsSeasonId;
  sel.innerHTML = seasons.map((s) => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join("");
  awardsSeasonId = (prev && seasons.some((s) => s.id === prev)) ? prev : (seasons[0]?.id || null);
  if (awardsSeasonId) sel.value = awardsSeasonId;
  renderAwardsTab();
}
document.getElementById("awardsSeasonSelect").addEventListener("change", (e) => {
  awardsSeasonId = e.target.value;
  renderAwardsTab();
});

function renderAwardsTab() {
  const gbHost = document.getElementById("goldenBootPreview");
  const mvpSelect = document.getElementById("mvpPlayerSelect");
  if (!awardsSeasonId) { gbHost.textContent = "Create a season first."; mvpSelect.innerHTML = ""; return; }

  const gb = computeGoldenBoot(players, matches, awardsSeasonId);
  gbHost.innerHTML = gb
    ? `<strong style="color:var(--turf)">${escapeHtml(gb.player.name)}</strong> — ${gb.goals} goal${gb.goals === 1 ? "" : "s"} this season`
    : "No goals scored yet this season.";

  const season = seasons.find((s) => s.id === awardsSeasonId);
  mvpSelect.innerHTML = `<option value="">No MVP set</option>` + players
    .slice().sort((a, b) => (a.name || "").localeCompare(b.name || ""))
    .map((p) => `<option value="${p.id}" ${season?.mvpPlayerId === p.id ? "selected" : ""}>${escapeHtml(p.name)}</option>`).join("");
}

document.getElementById("saveMvpBtn").addEventListener("click", async () => {
  if (!awardsSeasonId) return;
  const mvpPlayerId = document.getElementById("mvpPlayerSelect").value || null;
  try {
    await updateDoc(doc(db, "seasons", awardsSeasonId), { mvpPlayerId });
    toast("MVP saved.");
  } catch (e) { toast("Something went wrong.", "error"); }
});


