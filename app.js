import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, onAuthStateChanged, signOut, connectAuthEmulator } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import {
  initializeFirestore, getFirestore, persistentLocalCache, persistentMultipleTabManager, connectFirestoreEmulator,
  collection, doc, setDoc, deleteDoc, getDocs, onSnapshot, query, orderBy, limit,
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";

const cfg = window.ATTENDANCE_CONFIG || {};
const $ = (id) => document.getElementById(id);

// ---------- helpers ----------
const LS = (() => { try { return window.localStorage; } catch (e) { return null; } })();
const lsGet = (k) => { try { return LS ? LS.getItem(k) : null; } catch (e) { return null; } };
const lsSet = (k, v) => { try { LS && LS.setItem(k, v); } catch (e) {} };
const pad = (n) => String(n).padStart(2, "0");
const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const hourKey = () => pad(new Date().getHours());
const hourLabel = (h) => { h = +h; return (((h + 11) % 12) + 1) + (h < 12 ? "am" : "pm"); };
const hourRange = (h) => `${hourLabel(h)}–${hourLabel((+h + 1) % 24)}`;
const fmtDate = (s) => {
  if (!s) return "";
  const d = new Date(s + "T12:00:00");
  return isNaN(d) ? s : d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
};
const num = (n) => Number(n || 0).toLocaleString("en-GB");
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const newId = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const csvCell = (v) => { const s = String(v == null ? "" : v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
const slug = (s) => String(s || "event").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "event";
const loginDomain = String(cfg.loginDomain || "mandir.local").replace(/^@/, "");
const toEmail = (u) => { u = String(u || "").trim().toLowerCase(); return u.includes("@") ? u : `${u}@${loginDomain}`; };
const shortName = (email) => { const e = String(email || ""); return e.endsWith("@" + loginDomain) ? e.slice(0, -(loginDomain.length + 1)) : e; };
const adminEmails = (cfg.adminEmails || []).map((e) => String(e).toLowerCase());

// ---------- Firebase ----------
const fb = cfg.firebase || {};
const configured = !!(fb.apiKey && fb.projectId && !/^PASTE/.test(fb.apiKey) && !/^PASTE/.test(fb.projectId));
let auth = null, db = null;
if (configured) {
  const app = initializeApp(fb);
  auth = getAuth(app);
  try {
    // Keeps taps on the phone if the connection drops, and sends them when it comes back.
    db = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });
  } catch (e) {
    db = getFirestore(app);
  }
  // Local testing only: set `emulators` in config.js to use the Firebase emulators instead of the live project.
  if (cfg.emulators) {
    connectAuthEmulator(auth, cfg.emulators.auth, { disableWarnings: true });
    connectFirestoreEmulator(db, cfg.emulators.host || "127.0.0.1", cfg.emulators.firestorePort);
  }
}

// ---------- state ----------
const S = {
  authReady: false, user: null, isAdmin: false, blocked: false,
  events: [], eventsLoaded: false, eventsError: "",
  eventId: null, stations: new Map(), stationsLoaded: false,
  settings: {}, tab: "count", totals: new Map(),
  door: (lsGet("doorLabel") || "Main door").slice(0, 40),
  armed: null, spin: 0, pending: 0, savedOnce: false, notice: "",
  justCreated: null, justCreatedAt: 0,
};
let tally = null;
let unsubEvents = null, unsubSettings = null, unsubStations = null;

// ---------- sync indicator ----------
function updateSync() {
  let state = "idle", text = "Live";
  if (!configured) { text = "Not set up"; }
  else if (!S.authReady) { text = "Starting…"; }
  else if (!S.user) { text = "Signed out"; }
  else if (S.blocked) { state = "blocked"; text = "Can't save"; }
  else if (!navigator.onLine) { state = "offline"; text = S.pending ? "Offline · kept on this phone" : "Offline"; }
  else if (S.pending) { state = "saving"; text = "Saving…"; }
  else if (S.savedOnce) { state = "saved"; text = "Saved"; }
  $("sync").dataset.state = state;
  $("syncText").textContent = text;
}
window.addEventListener("online", updateSync);
window.addEventListener("offline", updateSync);

function writeError(e, where) {
  const code = e && e.code;
  if (code === "permission-denied") {
    S.blocked = true;
    S.notice = "The database refused to save. Check the rules from firestore.rules are published in Firebase.";
  } else if (code === "resource-exhausted") {
    S.notice = "The free daily limit for saving has been reached. Counting resumes tomorrow; tell the admin.";
  } else {
    S.notice = `Couldn't save ${where}. Check the connection and try again.`;
  }
  render();
}

// ---------- this phone's tally: one document per page load, so phones never overwrite each other ----------
class Tally {
  constructor(eventId) {
    this.id = newId("p");
    this.ref = doc(db, "events", eventId, "stations", this.id);
    this.count = 0; this.hours = {}; this.label = S.door;
    this.timer = null; this.startedAt = null; this.lastTap = 0;
    this.dirty = false; this.everWritten = false; this.dead = false;
  }
  add(n) {
    if (n > 0) {
      const h = hourKey();
      this.hours[h] = (this.hours[h] || 0) + n;
      this.count += n;
    } else {
      let k = hourKey();
      if (!(this.hours[k] > 0)) {
        const ks = Object.keys(this.hours).filter((x) => this.hours[x] > 0).sort();
        if (ks.length) k = ks[ks.length - 1];
      }
      this.hours[k] = (this.hours[k] || 0) - 1;
      if (this.hours[k] === 0) delete this.hours[k];
      this.count -= 1;
    }
    this.lastTap = Date.now();
    if (!this.startedAt) this.startedAt = this.lastTap;
    this.dirty = true; this.schedule();
  }
  setLabel(l) { this.label = l; if (this.count !== 0 || this.everWritten) { this.dirty = true; this.schedule(); } }
  body() { return { label: this.label, count: this.count, hours: { ...this.hours }, startedAt: this.startedAt || Date.now(), updatedAt: this.lastTap || Date.now() }; }
  schedule() { clearTimeout(this.timer); this.timer = setTimeout(() => this.flush(), 300); }
  flushNow() { clearTimeout(this.timer); this.flush(); }
  flush() {
    if (this.dead || !this.dirty || S.blocked) return;
    this.dirty = false; this.everWritten = true;
    S.pending++; updateSync();
    setDoc(this.ref, this.body()).then(
      () => { S.pending--; S.savedOnce = true; updateSync(); },
      (e) => { S.pending--; writeError(e, "the count"); updateSync(); },
    );
  }
}

// ---------- derived data ----------
function rows() {
  const out = [];
  S.stations.forEach((d, id) => {
    if (tally && id === tally.id) return;
    out.push({ id, label: d.label, count: +d.count || 0, hours: d.hours || {}, updatedAt: +d.updatedAt || 0 });
  });
  if (tally && (tally.count !== 0 || tally.everWritten)) {
    out.push({ id: tally.id, label: tally.label, count: tally.count, hours: tally.hours, updatedAt: tally.lastTap, mine: true });
  }
  return out;
}
function groupDoors(rs) {
  const m = new Map();
  for (const r of rs) {
    const name = String(r.label || "").trim() || "Unnamed door";
    const k = name.toLowerCase();
    const g = m.get(k) || { name, count: 0, hours: {}, mine: false };
    g.count += r.count;
    for (const [h, v] of Object.entries(r.hours || {})) g.hours[h] = (g.hours[h] || 0) + (+v || 0);
    if (r.mine) g.mine = true;
    m.set(k, g);
  }
  return [...m.values()].sort((a, b) => b.count - a.count);
}
function hourTotals(rs) {
  const h = {};
  for (const r of rs) for (const [k, v] of Object.entries(r.hours || {})) h[k] = (h[k] || 0) + (+v || 0);
  return h;
}
const currentEvent = () => S.events.find((e) => e.id === S.eventId) || null;
const totalOf = (rs) => Math.max(0, rs.reduce((a, r) => a + r.count, 0));

// ---------- rendering ----------
function render() {
  $("view-setup").hidden = configured;
  $("view-login").hidden = !configured || !S.authReady || !!S.user;
  $("signedIn").hidden = !S.user;
  $("templeName").textContent = String(S.settings.name || "").trim() || "Mandir Attendance";
  document.title = $("templeName").textContent === "Mandir Attendance" ? "Mandir Attendance" : $("templeName").textContent + " · Attendance";
  updateSync();
  if (!S.user) return;

  for (const b of document.querySelectorAll(".tabs button")) b.setAttribute("aria-selected", String(b.dataset.tab === S.tab));
  $("view-count").hidden = S.tab !== "count";
  $("view-report").hidden = S.tab !== "report";
  $("view-events").hidden = S.tab !== "events";
  const notice = S.notice || S.eventsError;
  $("notice").hidden = !notice;
  $("notice").textContent = notice;
  placeForm();
  if (S.tab === "count") renderCount();
  if (S.tab === "report") renderReport();
  if (S.tab === "events") renderEvents();
}

function placeForm() {
  const form = $("newEvent");
  const slot = S.tab === "count" ? $("countSlot") : $("eventsSlot");
  if (form.parentNode !== slot) slot.appendChild(form);
  form.hidden = S.blocked;
}

function renderCount() {
  const ev = currentEvent();
  $("countEmpty").hidden = !!ev;
  $("countMain").hidden = !ev;
  if (!ev) {
    const waiting = !S.eventsLoaded;
    $("startTitle").textContent = waiting ? "Loading today's count…" : "Start today's count";
    $("startText").hidden = waiting;
    return;
  }
  $("chipName").textContent = ev.name || "Untitled";
  $("chipDate").textContent = ev.date === todayStr() ? "Today" : fmtDate(ev.date);
  const rs = rows();
  const total = totalOf(rs);
  $("total").textContent = num(total);
  const doors = groupDoors(rs);
  const mineKey = S.door.trim().toLowerCase() || "unnamed door";
  const door = doors.find((g) => g.name.toLowerCase() === mineKey);
  $("doorCount").textContent = num(door ? Math.max(0, door.count) : 0);
  const recent = rs.filter((r) => r.updatedAt && Date.now() - r.updatedAt < 15 * 60000).length;
  const active = doors.filter((g) => g.count > 0).length;
  $("phones").textContent = !S.stationsLoaded ? "Loading the live count…"
    : total === 0 ? "Waiting for the first arrival"
    : `${active} door${active === 1 ? "" : "s"} · ${recent ? `${recent} phone${recent === 1 ? "" : "s"} active in the last 15 min` : "no taps in the last 15 min"}`;
  if (document.activeElement !== $("doorInput")) $("doorInput").value = S.door;
  const off = S.blocked || !tally;
  $("tap").disabled = off;
  $("plus2").disabled = off;
  $("plus5").disabled = off;
  $("minus").disabled = off || total <= 0 || !door || door.count <= 0;
  $("doorInput").disabled = off;
}

function renderReport() {
  const ev = currentEvent();
  $("reportEmpty").hidden = !!ev;
  $("reportMain").hidden = !ev;
  if (!ev) return;
  $("repDate").textContent = fmtDate(ev.date);
  $("repName").textContent = ev.name || "Untitled";
  const rs = rows();
  $("repTotal").textContent = num(totalOf(rs));
  const hrs = hourTotals(rs);
  const keys = Object.keys(hrs).filter((k) => hrs[k] > 0).map(Number).sort((a, b) => a - b);
  let peak = null;
  for (const k of keys) if (peak == null || hrs[pad(k)] > hrs[pad(peak)]) peak = k;
  $("repPeak").textContent = peak == null ? "—" : `${hourRange(peak)} · ${num(hrs[pad(peak)])}`;

  const doors = groupDoors(rs).filter((g) => g.count !== 0);
  const max = Math.max(1, ...doors.map((d) => d.count));
  $("repDoorsNote").textContent = doors.length ? `${doors.length} door${doors.length === 1 ? "" : "s"}` : "";
  $("repDoors").innerHTML = doors.length ? doors.map((d) => `
    <div class="drow">
      <span class="nm">${esc(d.name)}${d.mine ? '<span class="you">this phone</span>' : ""}</span>
      <span class="ct">${num(Math.max(0, d.count))}</span>
      <span class="track"><span class="fill" style="width:${Math.max(0, d.count) / max * 100}%"></span></span>
    </div>`).join("") : '<div class="empty">No one counted yet.</div>';

  if (!keys.length) {
    $("repChart").innerHTML = '<div class="empty">Arrivals will chart here by the hour as people are counted.</div>';
  } else {
    const from = keys[0], to = keys[keys.length - 1];
    const hmax = Math.max(1, ...keys.map((k) => hrs[pad(k)]));
    let html = '<div class="bars">';
    for (let h = from; h <= to; h++) {
      const v = Math.max(0, hrs[pad(h)] || 0);
      html += `<div class="bar" title="${hourRange(h)}: ${v}"><span class="v">${v ? num(v) : ""}</span><span class="b${h === peak ? " peak" : ""}" style="height:${v / hmax * 100}%"></span><span class="h">${hourLabel(h)}</span></div>`;
    }
    $("repChart").innerHTML = html + "</div>";
  }
}

function renderEvents() {
  $("namePanel").hidden = !S.isAdmin;
  if (document.activeElement !== $("templeInput")) $("templeInput").value = S.settings.name || "";
  if (!$("newDate").value) $("newDate").value = todayStr();
  $("whoami").textContent = shortName(S.user && S.user.email);
  $("csvAll").hidden = !S.events.length;
  $("eventsNote").textContent = S.events.length ? `${S.events.length} so far` : "";
  if (!S.eventsLoaded) { $("elist").innerHTML = '<div class="empty">Loading events…</div>'; return; }
  if (!S.events.length) { $("elist").innerHTML = '<div class="empty">No events yet. Start one above and it appears here.</div>'; return; }
  const liveTotal = totalOf(rows());
  $("elist").innerHTML = S.events.map((e) => {
    const sel = e.id === S.eventId;
    const t = sel ? liveTotal : (S.totals.get(e.id) || {}).total;
    const armed = S.armed === e.id;
    return `<div class="erow">
      <div class="meta"><span class="nm">${esc(e.name || "Untitled")}${sel ? '<span class="pill">Open</span>' : ""}</span><span class="dt">${esc(fmtDate(e.date))}</span></div>
      <span class="tt">${t == null ? "…" : num(t)}</span>
      <div class="acts">${sel ? "" : `<button class="small-btn" type="button" data-open="${esc(e.id)}">Open</button>`}${S.isAdmin ? `<button class="small-btn danger${armed ? " armed" : ""}" type="button" data-del="${esc(e.id)}">${armed ? "Tap again to delete" : "Delete"}</button>` : ""}</div>
    </div>`;
  }).join("");
}

// Totals for past events are read once on demand; the open event's total is live.
let totalsBusy = false, totalsQueued = false;
async function fetchTotals(all) {
  if (!db || !S.user) return;
  if (totalsBusy) {
    totalsQueued = true;
    if (!all) return;
    while (totalsBusy) await new Promise((r) => setTimeout(r, 200));
  }
  totalsBusy = true;
  try {
    const list = all ? S.events : S.events.slice(0, 40);
    for (const e of list) {
      if (e.id === S.eventId) continue;
      const c = S.totals.get(e.id);
      if (c && Date.now() - c.at < 60000) continue;
      try {
        const snap = await getDocs(collection(db, "events", e.id, "stations"));
        let t = 0; snap.forEach((d) => { t += +(d.data().count) || 0; });
        S.totals.set(e.id, { total: Math.max(0, t), at: Date.now() });
      } catch (err) { S.totals.set(e.id, { total: null, at: Date.now() }); }
      if (S.tab === "events") renderEvents();
      if (!all && S.tab !== "events") break;
    }
  } finally { totalsBusy = false; }
  if (totalsQueued) { totalsQueued = false; fetchTotals(); }
}

// ---------- session ----------
function readError(e) {
  const code = e && e.code;
  if (code === "permission-denied") return "The database refused access. Check the rules from firestore.rules are published in Firebase.";
  if (code === "not-found" || code === "failed-precondition") return "The database isn't ready. Check a Firestore database has been created in Firebase.";
  return "The event list didn't load. Check the connection and reload the page.";
}

function startSession(user) {
  S.user = user;
  S.isAdmin = adminEmails.includes(String(user.email || "").toLowerCase());
  S.blocked = false; S.notice = ""; S.eventsError = "";
  unsubEvents = onSnapshot(query(collection(db, "events"), orderBy("date", "desc"), limit(200)), (snap) => {
    S.events = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")) || (+b.createdAt || 0) - (+a.createdAt || 0));
    S.eventsLoaded = true; S.eventsError = "";
    autoSelect();
    render();
    if (S.tab === "events") fetchTotals();
  }, (e) => { S.eventsLoaded = true; S.eventsError = readError(e); render(); });
  unsubSettings = onSnapshot(doc(db, "settings", "app"), (snap) => { S.settings = snap.exists() ? snap.data() : {}; render(); }, () => {});
}

function endSession() {
  if (tally) { tally.flushNow(); tally = null; }
  for (const u of [unsubEvents, unsubSettings, unsubStations]) if (u) u();
  unsubEvents = unsubSettings = unsubStations = null;
  Object.assign(S, { user: null, isAdmin: false, events: [], eventsLoaded: false, eventId: null, stations: new Map(), stationsLoaded: false, settings: {}, totals: new Map(), notice: "", eventsError: "" });
}

function selectEvent(id) {
  if (S.eventId === id) return;
  if (unsubStations) { unsubStations(); unsubStations = null; }
  if (tally) tally.flushNow(); // the previous tally finishes saving on its own
  S.eventId = id;
  if (id) lsSet("eventId", id);
  S.stations = new Map(); S.stationsLoaded = false;
  tally = id ? new Tally(id) : null;
  if (id) {
    unsubStations = onSnapshot(collection(db, "events", id, "stations"), (snap) => {
      const m = new Map();
      snap.forEach((d) => m.set(d.id, d.data()));
      S.stations = m; S.stationsLoaded = true;
      render();
    }, (e) => { S.stationsLoaded = true; S.notice = readError(e); render(); });
  }
  render();
  keepAwake();
}

function autoSelect() {
  if (S.eventId && S.events.some((e) => e.id === S.eventId)) return;
  if (S.eventId && S.justCreated === S.eventId && Date.now() - S.justCreatedAt < 15000) return;
  if (S.eventId) { // the open event was deleted
    if (tally) tally.dead = true;
    if (unsubStations) { unsubStations(); unsubStations = null; }
    S.eventId = null; tally = null; S.stations = new Map();
  }
  const today = todayStr();
  const stored = lsGet("eventId");
  const todays = S.events.filter((e) => e.date === today);
  const pick = todays.find((e) => e.id === stored) || todays[0];
  if (pick) selectEvent(pick.id);
}

// ---------- actions ----------
$("loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const user = $("loginUser").value.trim();
  const pass = $("loginPass").value;
  $("loginMsg").textContent = "";
  if (!user || !pass) { $("loginMsg").textContent = "Enter the username and password."; return; }
  $("loginBtn").disabled = true;
  try {
    await signInWithEmailAndPassword(auth, toEmail(user), pass);
    $("loginPass").value = "";
  } catch (err) {
    const code = err && err.code;
    $("loginMsg").textContent =
      ["auth/invalid-credential", "auth/wrong-password", "auth/user-not-found", "auth/invalid-email", "auth/invalid-login-credentials"].includes(code) ? "That username or password isn't right."
      : code === "auth/too-many-requests" ? "Too many tries. Wait a few minutes, then try again."
      : code === "auth/network-request-failed" ? "No internet connection. Connect and try again."
      : code === "auth/operation-not-allowed" ? "Email/password sign-in isn't turned on in Firebase yet."
      : `Couldn't sign in (${code || "unknown error"}). Check the settings in config.js.`;
  } finally { $("loginBtn").disabled = false; }
});

$("signOut").addEventListener("click", async () => {
  if (tally) tally.flushNow();
  try { await signOut(auth); } catch (e) {}
});

async function createEvent(e) {
  e.preventDefault();
  const name = $("newName").value.trim().slice(0, 60);
  const date = $("newDate").value || todayStr();
  $("newMsg").textContent = "";
  if (!name) { $("newMsg").textContent = "Give the occasion a name, or tap one of the suggestions."; $("newName").focus(); return; }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { $("newMsg").textContent = "Pick a date for the event."; return; }
  const id = date + "-" + Math.random().toString(36).slice(2, 7);
  const body = { name, date, createdAt: Date.now() };
  S.justCreated = id; S.justCreatedAt = Date.now();
  // Applied locally straight away; Firestore sends it when it can.
  setDoc(doc(db, "events", id), body).catch((err) => {
    $("newMsg").textContent = err && err.code === "permission-denied" ? "The database refused to save the event. Check the rules are published." : "Couldn't save the event. Check the connection and try again.";
    S.tab = "events"; render();
  });
  $("newName").value = "";
  for (const c of document.querySelectorAll(".chip")) c.setAttribute("aria-pressed", "false");
  if (!S.events.some((x) => x.id === id)) S.events = [{ id, ...body }, ...S.events];
  selectEvent(id);
  switchTab("count");
}
$("newEvent").addEventListener("submit", createEvent);

async function deleteEvent(id) {
  $("evMsg").textContent = "";
  try {
    const snap = await getDocs(collection(db, "events", id, "stations"));
    await Promise.all(snap.docs.map((d) => deleteDoc(d.ref)));
    await deleteDoc(doc(db, "events", id));
    S.totals.delete(id);
  } catch (err) {
    $("evMsg").textContent = "Couldn't delete that event. Check the connection and try again.";
  }
}

$("templeSave").addEventListener("click", async () => {
  $("nameMsg").textContent = "";
  $("templeSave").disabled = true;
  try { await setDoc(doc(db, "settings", "app"), { name: $("templeInput").value.trim().slice(0, 60) }); $("templeInput").blur(); }
  catch (err) { $("nameMsg").textContent = "Couldn't save the name. Check the connection and try again."; }
  finally { $("templeSave").disabled = false; }
});

// ---------- CSV ----------
function download(filename, lines) {
  const text = "﻿" + lines.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}
$("csvEvent").addEventListener("click", () => {
  const ev = currentEvent(); if (!ev) return;
  const rs = rows();
  const doors = groupDoors(rs).filter((g) => g.count !== 0);
  const hrs = hourTotals(rs);
  const keys = Object.keys(hrs).map(Number).sort((a, b) => a - b);
  const lines = [["Event", ev.name], ["Date", ev.date], [], ["Hour", ...doors.map((d) => d.name), "Total"]];
  for (const h of keys) lines.push([hourRange(h), ...doors.map((d) => Math.max(0, d.hours[pad(h)] || 0)), Math.max(0, hrs[pad(h)] || 0)]);
  lines.push(["Total", ...doors.map((d) => Math.max(0, d.count)), totalOf(rs)]);
  download(`${slug(ev.name)}-${ev.date}.csv`, lines);
});
$("csvAll").addEventListener("click", async () => {
  $("csvAll").disabled = true;
  S.totals.forEach((v) => { v.at = 0; });
  await fetchTotals(true);
  $("csvAll").disabled = false;
  const live = totalOf(rows());
  const lines = [["Date", "Event", "Total"]];
  for (const e of S.events) {
    const t = e.id === S.eventId ? live : (S.totals.get(e.id) || {}).total;
    lines.push([e.date, e.name, t == null ? "" : t]);
  }
  download(`attendance-${todayStr()}.csv`, lines);
});

// ---------- keep the door phone awake on the Count tab ----------
let wake = null;
async function keepAwake() {
  try {
    if (S.user && S.tab === "count" && S.eventId && document.visibilityState === "visible" && "wakeLock" in navigator && !wake) {
      wake = await navigator.wakeLock.request("screen");
      wake.addEventListener("release", () => { wake = null; });
    }
  } catch (e) { wake = null; }
}
document.addEventListener("visibilitychange", () => {
  keepAwake();
  if (document.visibilityState === "hidden" && tally) tally.flushNow();
});

// ---------- counting ----------
function tap(n) {
  if (!tally || S.blocked) return;
  tally.add(n);
  if (n > 0) {
    S.spin = (S.spin + 12 * n) % 360;
    $("tap").style.setProperty("--spin", S.spin + "deg");
    const f = document.createElement("span");
    f.className = "float"; f.textContent = "+" + n;
    $("floaters").appendChild(f);
    setTimeout(() => f.remove(), 750);
  }
  try { navigator.vibrate && navigator.vibrate(n > 0 ? 12 : [10, 40, 10]); } catch (e) {}
  keepAwake();
  renderCount();
}
$("tap").addEventListener("click", () => tap(1));
$("plus2").addEventListener("click", () => tap(2));
$("plus5").addEventListener("click", () => tap(5));
$("minus").addEventListener("click", () => tap(-1));

let doorTimer = null;
$("doorInput").addEventListener("input", () => {
  clearTimeout(doorTimer);
  doorTimer = setTimeout(() => {
    const v = $("doorInput").value.trim().slice(0, 40) || "Main door";
    S.door = v; lsSet("doorLabel", v);
    if (tally) tally.setLabel(v);
    renderCount();
  }, 500);
});
$("doorInput").addEventListener("blur", () => { if (!$("doorInput").value.trim()) $("doorInput").value = S.door; });

function switchTab(t) {
  S.tab = t; lsSet("tab", t); S.armed = null;
  if (location.hash !== "#" + t) history.replaceState(null, "", "#" + t);
  render(); keepAwake();
  if (t === "events") fetchTotals();
}
for (const b of document.querySelectorAll(".tabs button")) b.addEventListener("click", () => switchTab(b.dataset.tab));
$("eventChip").addEventListener("click", () => switchTab("events"));

for (const c of document.querySelectorAll(".chip")) {
  c.setAttribute("aria-pressed", "false");
  c.addEventListener("click", () => {
    for (const o of document.querySelectorAll(".chip")) o.setAttribute("aria-pressed", String(o === c));
    $("newName").value = c.textContent;
    $("newMsg").textContent = "";
  });
}
$("newName").addEventListener("input", () => {
  for (const o of document.querySelectorAll(".chip")) o.setAttribute("aria-pressed", String(o.textContent === $("newName").value.trim()));
});

let armTimer = null;
$("elist").addEventListener("click", (e) => {
  const open = e.target.closest("[data-open]");
  if (open) { selectEvent(open.dataset.open); switchTab("count"); return; }
  const del = e.target.closest("[data-del]");
  if (del) {
    const id = del.dataset.del;
    clearTimeout(armTimer);
    if (S.armed === id) { S.armed = null; deleteEvent(id); renderEvents(); return; }
    S.armed = id; renderEvents();
    armTimer = setTimeout(() => { S.armed = null; if (S.tab === "events") renderEvents(); }, 4000);
  }
});

// ---------- boot ----------
const tabs = ["count", "report", "events"];
const hash = (location.hash || "").slice(1);
S.tab = tabs.includes(hash) ? hash : (tabs.includes(lsGet("tab")) ? lsGet("tab") : "count");
$("newDate").value = todayStr();
$("loginUser").placeholder = "door";
render();

if (configured) {
  onAuthStateChanged(auth, (user) => {
    S.authReady = true;
    if (user && (!S.user || S.user.uid !== user.uid)) { endSession(); startSession(user); }
    else if (!user && S.user) endSession();
    render();
    keepAwake();
  });
}
