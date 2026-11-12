// Car Repair Helper - frontend
const $ = (s) => document.querySelector(s);
const state = JSON.parse(localStorage.getItem("repairState") || "{}");
// state: { car, symptoms, history, diagnosis, problem, videos, breakdowns: {videoId: {video, data, problem}}, active, notes,
//          currentId (library id of the current repair), library: [...], saved: [], updatedAt }
// Photos live in IndexedDB (see photo storage below) and, with sync on, in the cloud.
const SHARE = new URLSearchParams(location.search).get("share"); // read-only share link mode
let SYNC = false;
const PROJECT_FIELDS = ["car", "symptoms", "history", "diagnosis", "problem", "videoSets", "breakdowns", "active", "notes"];

const save = () => {
  if (SHARE) return;
  state.updatedAt = Date.now();
  const item = state.currentId && state.library?.find((p) => p.id === state.currentId);
  if (item) { // keep the library copy of the current repair up to date
    item.snapshot = snapshot();
    item.notes = state.notes || "";
    item.updated = Date.now();
  }
  try {
    localStorage.setItem("repairState", JSON.stringify(state));
  } catch {
    toast("Storage full");
  }
  pushSoon();
};

const snapshot = () => JSON.parse(JSON.stringify(Object.fromEntries(PROJECT_FIELDS.map((k) => [k, state[k]]))));
const projectTitle = () =>
  state.library?.find((p) => p.id === state.currentId)?.title || state.problem?.name || state.diagnosis?.problems?.[0]?.name || (state.symptoms || "Repair").slice(0, 60);

/* ---------------- cloud sync ---------------- */
async function req(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: { "content-type": "application/json", "x-app-password": localStorage.getItem("appPassword") || "" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || res.statusText), { status: res.status });
  return data;
}

let pushTimer;
function pushSoon() {
  if (!SYNC) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(pushState, 1500);
}
async function pushState() {
  try {
    await req("PUT", "/api/sync", { state });
    setSyncBadge("☁️ Synced");
  } catch (e) {
    setSyncBadge("⚠️ Not synced");
  }
}
function setSyncBadge(t) {
  const b = $("#syncBadge");
  if (b) b.textContent = t;
}

// Photo uploads: retried on next load if they fail (e.g. no signal in the garage).
const pending = new Set(JSON.parse(localStorage.getItem("pendingUploads") || "[]"));
const savePending = () => localStorage.setItem("pendingUploads", JSON.stringify([...pending]));
async function uploadPhoto(k) {
  if (!SYNC || !photos[k]) return;
  try {
    await req("PUT", "/api/photo?k=" + encodeURIComponent(k), { data: photos[k] });
    pending.delete(k);
  } catch {
    pending.add(k);
  }
  savePending();
}

// Download photos this device doesn't have yet (from sync, or from a share link).
const fetching = new Set();
async function fetchMissing(keys, rerender) {
  const missing = keys.filter((k) => !photos[k] && !fetching.has(k));
  if (!missing.length || !(SYNC || SHARE)) return;
  missing.forEach((k) => fetching.add(k));
  let got = 0;
  await Promise.all(
    missing.map(async (k) => {
      try {
        const url = SHARE ? `/api/shared/${SHARE}/photo?k=${encodeURIComponent(k)}` : "/api/photo?k=" + encodeURIComponent(k);
        const { data } = await req("GET", url);
        if (SHARE) photos[k] = data;
        else await photoPut(k, data, false);
        got++;
      } catch {}
    })
  );
  if (got) rerender();
}

const esc = (s = "") => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmtTime = (t) => { t = Math.max(0, Math.floor(t || 0)); const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60; return (h ? h + ":" + String(m).padStart(2, "0") : m) + ":" + String(s).padStart(2, "0"); };
/* ---------------- collapsible sections (open/closed is remembered) ---------------- */
const secOpen = JSON.parse(localStorage.getItem("secOpen") || "{}");
const isOpen = (k, def) => ((k in secOpen ? secOpen[k] : def) ? "open" : "");
document.addEventListener("toggle", (e) => {
  const k = e.target.dataset?.sec;
  if (!k) return;
  secOpen[k] = e.target.open;
  localStorage.setItem("secOpen", JSON.stringify(secOpen));
}, true);
// Whole section as a collapsible card.
function sec(el, key, title, meta, body, def = true) {
  el.className = "";
  el.innerHTML = `<details class="card sec" data-sec="${esc(key)}" ${isOpen(key, def)}>
    <summary><h2 class="grow">${title}</h2>${meta ? `<span class="meta">${meta}</span>` : ""}</summary>
    <div class="sec-body">${body}</div></details>`;
}
// Collapsible block inside a section.
const sub = (key, head, body, def = false) =>
  `<details class="sub" data-sec="${esc(key)}" ${isOpen(key, def)}><summary><span class="grow">${head}</span></summary><div class="sub-body">${body}</div></details>`;
const openSec = (id) => { const d = $(`#${id} > details.sec`); if (d) d.open = true; };

$("#collapseAll").onclick = () => {
  document.querySelectorAll("details.sec, details.sub, #intake").forEach((d) => (d.open = false));
  scrollTo({ top: 0, behavior: "smooth" });
};

const md = (s = "") =>
  esc(s)
    .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
    .replace(/^#+ (.*)$/gm, "<b>$1</b>")
    .replace(/^\s*[-*] (.*)$/gm, "• $1")
    .replace(/\n/g, "<br>");

function toast(msg, ms = 3500) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.remove("hidden");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.add("hidden"), ms);
}

async function api(path, body) {
  const res = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json", "x-app-password": localStorage.getItem("appPassword") || "" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({ error: "Bad response" }));
  if (res.status === 401) {
    const pw = prompt("Password:");
    if (pw) { localStorage.setItem("appPassword", pw); return api(path, body); }
  }
  if (!res.ok || data.error) throw new Error(data.error || res.statusText);
  return data;
}

async function busy(btn, label, fn) {
  const old = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = `<span class="spinner"></span>${label}`;
  try { return await fn(); }
  catch (e) { toast("Error: " + e.message, 6000); }
  finally { btn.disabled = false; btn.innerHTML = old; }
}

/* ---------------- intake ---------------- */
const carFields = ["year", "make", "model", "engine", "mileage"];
function intakeMeta() {
  const c = state.car || {};
  $("#intakeMeta").textContent = [c.year, c.make, c.model].filter(Boolean).join(" ");
}
function loadIntake() {
  const car = state.car || JSON.parse(localStorage.getItem("lastCar") || "{}");
  carFields.forEach((f) => ($("#" + f).value = car[f] || ""));
  $("#symptoms").value = state.symptoms || "";
  $("#intake").open = !state.diagnosis; // collapse once there's a diagnosis
  intakeMeta();
}
function readCar() {
  const car = {};
  carFields.forEach((f) => (car[f] = $("#" + f).value.trim()));
  return car;
}

$("#diagnoseBtn").onclick = (e) => {
  const car = readCar();
  const symptoms = $("#symptoms").value.trim();
  if (!car.make || !car.model || !symptoms) return toast("Fill in at least make, model and symptoms");
  busy(e.currentTarget, "Thinking like a mechanic…", async () => {
    Object.assign(state, { car, symptoms, history: [], problem: null });
    localStorage.setItem("lastCar", JSON.stringify(car));
    state.diagnosis = await api("/api/diagnose", { car, symptoms, history: [] });
    save();
    $("#intake").open = false;
    intakeMeta();
    renderAll();
    $("#diagnosis").scrollIntoView({ behavior: "smooth" });
  });
};

$("#newBtn").onclick = () => {
  const inLib = !!state.currentId;
  if (!confirm(inLib ? "Start a new repair? This one stays in your Library." : "Start a new repair? The current one isn't in your Library yet and will be cleared.")) return;
  clearCurrent();
  save();
  renderAll();
  scrollTo({ top: 0, behavior: "smooth" });
};

function clearCurrent() {
  const car = state.car;
  for (const k of [...PROJECT_FIELDS, "currentId"]) delete state[k];
  state.car = car;
  state.breakdowns = {};
  loadIntake();
}

/* ---------------- diagnosis ---------------- */
function renderDiagnosis() {
  const d = state.diagnosis;
  const el = $("#diagnosis");
  if (!d) return el.classList.add("hidden");
  const probs = d.problems || [];
  sec(el, "diagnosis", "Likely problems", `${probs.length} found`, `
    <div class="summary">${esc(d.summary)}</div>
    ${d.safety_warning ? `<div class="alert" role="alert"><b>⚠ Warning</b><span>${esc(d.safety_warning)}</span></div>` : ""}
    ${probs.map((p, i) => sub(`prob:${p.name}`, `
        <span class="row" style="justify-content:space-between;width:100%">
          <b>${i + 1}. ${esc(p.name)}</b>
          <span class="row"><span class="bar"><div style="width:${Math.min(100, p.likelihood)}%"></div></span><span class="pct">${p.likelihood}%</span></span>
        </span>`, `
        <div>${esc(p.why)}</div>
        <div class="tags">
          <span class="tag">🛠 ${esc(p.difficulty)}</span><span class="tag">⏱ ${esc(p.time)}</span>
          <span class="tag">🔩 Parts ${esc(p.parts_cost)}</span><span class="tag">🏪 Shop ${esc(p.shop_cost)}</span>
        </div>
        ${p.how_to_confirm?.length ? `<div><b>How to confirm</b><ol>${p.how_to_confirm.map((x) => `<li>${esc(x)}</li>`).join("")}</ol></div>` : ""}
        <div class="row">
          <button class="primary" data-videos="${i}">▶ ${videoSetFor(p.name) ? "Search videos again" : "Find repair videos"}</button>
          <button data-ask="${i}">Ask about this</button>
        </div>
        <div id="ask-${i}"></div>`, i === 0)).join("")}
    ${sub("refine", `<b>Narrow it down</b> <span class="muted">${d.questions?.length ? `· ${d.questions.length} questions` : ""}</span>`, `
      ${d.questions?.length ? `<ul>${d.questions.map((q) => `<li>${esc(q)}</li>`).join("")}</ul>` : ""}
      <div class="qa">
        <input id="refineInput" placeholder="Answer a question or add info – e.g. battery tested fine…" />
        <button id="refineBtn">Update</button>
      </div>`, false)}`);

  el.querySelectorAll("[data-videos]").forEach((b) => (b.onclick = () => getVideos(probs[b.dataset.videos], b)));
  el.querySelectorAll("[data-ask]").forEach((b) => (b.onclick = () => askBox($("#ask-" + b.dataset.ask), probs[b.dataset.ask].name)));
  $("#refineBtn").onclick = (e) => {
    const info = $("#refineInput").value.trim();
    if (!info) return;
    busy(e.currentTarget, "Re-ranking…", async () => {
      state.history.push({ role: "assistant", content: JSON.stringify(state.diagnosis) }, { role: "user", content: info });
      state.diagnosis = await api("/api/diagnose", { car: state.car, symptoms: state.symptoms, history: state.history });
      save();
      renderDiagnosis();
    });
  };
}

function askBox(container, problem, context = "") {
  if (container.dataset.open) return container.querySelector("input").focus();
  container.dataset.open = 1;
  container.innerHTML = `<div class="qa"><input placeholder="Ask anything – torque specs, part numbers, which side is the bolt on…" /><button>Ask</button></div><div class="answers"></div>`;
  const input = container.querySelector("input");
  const btn = container.querySelector("button");
  const go = () => {
    const q = input.value.trim();
    if (!q) return;
    busy(btn, "…", async () => {
      const { answer } = await api("/api/ask", { car: state.car, problem, question: q, context });
      container.querySelector(".answers").insertAdjacentHTML("afterbegin", `<div class="answer"><b>Q: ${esc(q)}</b><br>${md(answer)}</div>`);
      input.value = "";
    });
  };
  btn.onclick = go;
  input.onkeydown = (e) => e.key === "Enter" && go();
  input.focus();
}

/* ---------------- videos (one list per problem – older lists are kept) ---------------- */
const videoSetFor = (name) => (state.videoSets || []).find((x) => x.problem === name);

async function getVideos(problem, btn) {
  await busy(btn, "Searching YouTube & ordering…", async () => {
    const data = await api("/api/videos", { car: state.car, problem });
    state.problem = problem;
    state.videoSets = (state.videoSets || []).filter((x) => x.problem !== problem.name);
    state.videoSets.unshift({ problem: problem.name, videos: data.videos, at: Date.now() });
    secOpen["vids:" + problem.name] = true; // newest list opens
    secOpen.videos = true;
    save();
    if (data.note) toast(data.note, 6000);
    renderAll();
    $("#videos").scrollIntoView({ behavior: "smooth" });
  });
}

function renderVideos() {
  const el = $("#videos");
  const sets = state.videoSets || [];
  if (!sets.length) return el.classList.add("hidden");
  const total = sets.reduce((n, x) => n + x.videos.length, 0);
  sec(el, "videos", "Repair videos", `${total} videos · ${sets.length} list${sets.length === 1 ? "" : "s"}`,
    sets.map((set, si) => sub(`vids:${set.problem}`, `<b>${esc(set.problem)}</b> <span class="muted">· ${set.videos.length} videos, watch in order</span>`, `
      ${!set.videos.length ? `<p>No videos found. Try again or tweak the car details.</p>` : ""}
      ${set.videos.map((v, i) => `
        <div class="video">
          <a href="https://www.youtube.com/watch?v=${v.id}" target="_blank" rel="noopener"><img loading="lazy" src="https://i.ytimg.com/vi/${v.id}/mqdefault.jpg" alt="" /></a>
          <div>
            <div class="stage"><span class="num">${i + 1}</span>${esc(v.stage)}</div>
            <h3>${esc(v.title)}</h3>
            <div class="muted">${esc(v.channel)} · ${esc(v.length)} · ${esc(v.views)}</div>
            <div class="muted why">${esc(v.why)}</div>
            <div class="row" style="margin-top:var(--space-2)">
              <button class="${state.breakdowns?.[v.id] ? "" : "primary"}" data-break="${si}:${i}">${state.breakdowns?.[v.id] ? "📋 Open steps ✔" : "📋 Steps + photos"}</button>
              <a href="https://www.youtube.com/watch?v=${v.id}" target="_blank" rel="noopener">YouTube ↗</a>
            </div>
          </div>
        </div>`).join("")}
      <div><button class="quiet" data-delset="${si}">Remove this list</button></div>`, si === 0)).join(""));
  el.querySelectorAll("[data-break]").forEach((b) => (b.onclick = () => {
    const [si, i] = b.dataset.break.split(":").map(Number);
    state.problem = (state.diagnosis?.problems || []).find((p) => p.name === sets[si].problem) || { name: sets[si].problem };
    getBreakdown(sets[si].videos[i], b);
  }));
  el.querySelectorAll("[data-delset]").forEach((b) => (b.onclick = () => {
    if (!confirm("Remove this video list? (Videos you opened steps for stay.)")) return;
    sets.splice(+b.dataset.delset, 1);
    save();
    renderVideos();
    renderDiagnosis();
  }));
}

/* ---------------- photo storage (IndexedDB – much bigger than localStorage) ---------------- */
const photos = {}; // in-memory cache: key -> dataURL
const db = new Promise((res, rej) => {
  const r = indexedDB.open("repairPhotos", 1);
  r.onupgradeneeded = () => r.result.createObjectStore("p");
  r.onsuccess = () => res(r.result);
  r.onerror = () => rej(r.error);
});
async function idb(mode, fn) {
  const d = await db;
  return new Promise((res, rej) => {
    const tx = d.transaction("p", mode);
    const req = fn(tx.objectStore("p"));
    tx.oncomplete = () => res(req?.result);
    tx.onerror = () => rej(tx.error);
  });
}
async function photoPut(k, v, upload = true) {
  photos[k] = v;
  await idb("readwrite", (st) => st.put(v, k));
  if (upload) uploadPhoto(k);
}
async function photoDel(k) {
  delete photos[k];
  await idb("readwrite", (st) => st.delete(k));
  if (SYNC) req("DELETE", "/api/photo?k=" + encodeURIComponent(k)).catch(() => {});
}
async function loadPhotos() {
  const keys = (await idb("readonly", (st) => st.getAllKeys())) || [];
  const vals = (await idb("readonly", (st) => st.getAll())) || [];
  keys.forEach((k, i) => (photos[k] = vals[i]));
}
const shotKey = (vid, i) => `shot:${vid}:${i}`;

/* ---------------- breakdown (one tab per video) ---------------- */
const active = () => state.breakdowns?.[state.active];

async function getBreakdown(video, btn) {
  if (state.breakdowns?.[video.id]) { // already done – just open it, no extra cost
    state.active = video.id; save(); renderBreakdown();
    return $("#breakdown").scrollIntoView({ behavior: "smooth" });
  }
  await busy(btn, "Watching the video (can take ~30-60s)…", async () => {
    const data = await api("/api/breakdown", { videoId: video.id, car: state.car, problem: state.problem, length: video.length });
    state.breakdowns[video.id] = { video, data, problem: state.problem?.name };
    state.active = video.id;
    save();
    secOpen.breakdown = true;
    renderVideos();
    renderBreakdown();
    ($(".banner") || $("#breakdown")).scrollIntoView({ behavior: "smooth", block: "center" });
    if ($(".banner")) toast("Steps ready ✔ – now click “Make step photos” to get the screenshots", 6000);
  });
}

let player, playerReady = false, playerVid = null;
function renderBreakdown() {
  const el = $("#breakdown");
  const ids = Object.keys(state.breakdowns || {});
  if (!ids.length) return el.classList.add("hidden");
  if (!active()) state.active = ids[ids.length - 1];
  const { video: v, data: b } = active();
  const canCapture = !!navigator.mediaDevices?.getDisplayMedia && !/Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
  const haveAll = (b.steps || []).every((_, i) => photos[shotKey(v.id, i)]);
  const list = (title, arr) => (arr?.length ? `<div><b>${title}</b><ul>${arr.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>` : "");
  const extras = (b.tools?.length || 0) + (b.parts?.length || 0) + (b.specs?.length || 0);
  const nPhotos = (b.steps || []).filter((_, i) => photos[shotKey(v.id, i)]).length;

  sec(el, "breakdown", "Step-by-step", `${ids.length} video${ids.length === 1 ? "" : "s"}`, `
    <div class="tabs">${ids.map((id) => {
      const x = state.breakdowns[id].video;
      return `<div class="tab ${id === state.active ? "on" : ""}" data-tab="${id}"><img src="https://i.ytimg.com/vi/${id}/default.jpg" alt=""><span>${esc(x.title)}</span><b data-close-tab="${id}" title="Remove">✕</b></div>`;
    }).join("")}</div>
    <div><h3>${esc(v.title)}</h3><div class="muted">${esc(b.overview)} (${esc(b.source)})</div></div>
    ${canCapture && !haveAll ? `
      <div class="banner">
        <div><b>📸 This video has no step photos yet</b><br><span class="muted">Click, then pick <b>this tab</b> in the popup and hit Share. It jumps through the video and snaps each step (~1 min). Keep this tab open.</span></div>
        <button class="primary" id="captureAll">Make step photos</button>
      </div>` : ""}
    ${!canCapture ? `<p class="muted">On a phone: tap any step picture to play that exact moment. For real screenshots, open this on a computer once.</p>` : ""}
    <div class="player-wrap"><div class="player"><div id="yt"></div></div></div>
    <div class="row">
      ${canCapture ? `<button id="snapNow">📸 Snap frame</button>${haveAll ? `<button id="captureAll">📸 Redo photos</button>` : ""}` : ""}
      <button id="askVideo">Ask about this video</button>
    </div>
    <div id="askVideoBox"></div>
    ${extras ? sub("extras", `<b>🧰 Tools, parts &amp; specs</b> <span class="muted">· ${extras}</span>`, `<div class="cols">${list("🧰 Tools", b.tools)}${list("🔩 Parts", b.parts)}${list("📏 Specs", b.specs)}</div>`, false) : ""}
    ${sub("steps", `<b>Steps</b> <span class="muted">· ${(b.steps || []).length} steps, ${nPhotos} photos</span>`, `<div>
    ${(b.steps || []).map((s, i) => `
      <div class="step" id="step-${i}">
        <div class="shot" data-i="${i}">${shotHtml(v.id, s, i)}</div>
        <div class="step-text">
          <div><span class="ts" data-seek="${s.t}">▶ ${fmtTime(s.t)}</span> &nbsp;<b>${i + 1}. ${esc(s.title)}</b></div>
          <div>${esc(s.detail)}</div>
          ${s.look_at ? `<div class="look">👀 ${esc(s.look_at)}</div>` : ""}
          ${s.warning ? `<div class="gotcha">⚠️ ${esc(s.warning)}</div>` : ""}
          <div class="row" style="margin-top:var(--space-2)">
            <button data-seek="${s.t}">▶ Play from here</button>
            <button data-save="${i}">⭐ Save</button>
            ${photos[shotKey(v.id, i)] ? `<button data-dl="${i}">⬇ Download</button>` : ""}
          </div>
        </div>
      </div>`).join("")}</div>`, true)}`);

  el.querySelectorAll("[data-tab]").forEach((n) => (n.onclick = (e) => {
    if (e.target.dataset.closeTab) return;
    state.active = n.dataset.tab; save(); renderBreakdown();
  }));
  el.querySelectorAll("[data-close-tab]").forEach((n) => (n.onclick = () => removeVideo(n.dataset.closeTab)));
  el.querySelectorAll("[data-seek]").forEach((n) => (n.onclick = () => seek(+n.dataset.seek)));
  el.querySelectorAll(".shot").forEach((n) => (n.onclick = () => openStep(+n.dataset.i)));
  el.querySelectorAll("[data-save]").forEach((n) => (n.onclick = () => saveStep(v.id, +n.dataset.save)));
  el.querySelectorAll("[data-dl]").forEach((n) => (n.onclick = () => download(photos[shotKey(v.id, +n.dataset.dl)], `${v.title} - step ${+n.dataset.dl + 1}`)));
  $("#askVideo").onclick = () => askBox($("#askVideoBox"), active().problem, `Watching video "${v.title}". Steps: ${(b.steps || []).map((s) => s.title).join("; ")}`);
  if ($("#captureAll")) $("#captureAll").onclick = (e) => captureAll(e.currentTarget);
  if ($("#snapNow")) $("#snapNow").onclick = snapNow;
  makePlayer(v.id);
  // photos made on another device: download them, then just swap the pictures in (keeps the player running)
  fetchMissing((b.steps || []).map((_, i) => shotKey(v.id, i)), () => {
    if (state.active !== v.id) return;
    (b.steps || []).forEach((s, i) => { const n = $(`#step-${i} .shot`); if (n) n.innerHTML = shotHtml(v.id, s, i); });
  });
}

async function removeVideo(id) {
  if (!confirm("Remove this video and its step photos? (Saved ⭐ photos stay.)")) return;
  const n = state.breakdowns[id].data.steps?.length || 0;
  for (let i = 0; i < n; i++) await photoDel(shotKey(id, i));
  delete state.breakdowns[id];
  if (state.active === id) state.active = null;
  save();
  renderVideos();
  renderBreakdown();
}

// Orange box over the part the step is about (position comes from the video model; approximate).
function boxHtml(box) {
  if (!Array.isArray(box) || box.length !== 4) return "";
  let [y1, x1, y2, x2] = box.map((n) => Math.max(0, Math.min(1000, +n)) / 10);
  const pad = 3;
  y1 = Math.max(0, y1 - pad); x1 = Math.max(0, x1 - pad); y2 = Math.min(100, y2 + pad); x2 = Math.min(100, x2 + pad);
  return `<div class="hl" style="top:${y1}%;left:${x1}%;height:${y2 - y1}%;width:${x2 - x1}%"></div>`;
}

function shotHtml(vid, s, i, img = photos[shotKey(vid, i)]) {
  if (img) return `<img src="${img}" alt="" />${boxHtml(s.box)}`;
  const desktop = !/Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
  return `<img src="https://i.ytimg.com/vi/${vid}/hqdefault.jpg" alt="" class="dim" /><span class="play">${desktop ? "📸 No photo yet · " : "▶ "}${fmtTime(s.t)}</span>`;
}

// Plays from just before the frame and keeps going (pause/scrub with YouTube's own controls).
const clipHtml = (vid, t) =>
  `<iframe src="https://www.youtube.com/embed/${vid}?start=${Math.max(0, Math.floor(t) - 1)}&autoplay=1&rel=0&playsinline=1" allow="autoplay; encrypted-media; fullscreen" allowfullscreen></iframe>`;

// Full-screen viewer. item = {vid, s, img, label, note}; actions = extra buttons html; onAction(e) handles them.
function viewer(item, { nav, actions = "", onAction } = {}) {
  const { vid, s, img } = item;
  const box = $("#lightbox");
  box.innerHTML = `
    <div class="lb-inner">
      <div class="lb-media">${img ? `<img src="${img}" alt="" data-clip title="Tap to play from here" />${boxHtml(s.box)}<span class="lb-play" data-clip>▶ Play from here</span>` : clipHtml(vid, s.t)}</div>
      <div class="lb-text"><b>${esc(item.label)}</b> <span class="ts">${fmtTime(s.t)}</span><br>${esc(s.detail || "")}
        ${s.look_at ? `<div class="look">👀 ${esc(s.look_at)}</div>` : ""}
        ${s.warning ? `<div class="gotcha">⚠️ ${esc(s.warning)}</div>` : ""}
        ${item.note ? `<div class="note">📝 ${esc(item.note)}</div>` : ""}
      </div>
      <div class="row">
        ${nav ? `<button data-nav="-1">◀ Prev</button><button data-nav="1">Next ▶</button>` : ""}
        ${img ? `<button data-clip>▶ Play from here</button><button data-show>🖼 Photo</button><button data-dl>⬇ Download</button>` : ""}
        ${actions}
        <button data-close>Close</button>
      </div>
    </div>`;
  box.classList.remove("hidden");
  box.onclick = (e) => {
    const d = e.target.dataset;
    if (e.target === box || d.close !== undefined) { box.classList.add("hidden"); box.innerHTML = ""; }
    else if (d.nav) nav(+d.nav);
    else if (d.clip !== undefined) box.querySelector(".lb-media").innerHTML = clipHtml(vid, s.t);
    else if (d.show !== undefined) box.querySelector(".lb-media").innerHTML = `<img src="${img}" alt="" data-clip />${boxHtml(s.box)}<span class="lb-play" data-clip>▶ Play from here</span>`;
    else if (d.dl !== undefined) download(img, item.label);
    else if (onAction) onAction(e);
  };
}

function openStep(i) {
  const { video: v, data: b } = active();
  const s = b.steps[i];
  viewer(
    { vid: v.id, s, img: photos[shotKey(v.id, i)], label: `${i + 1}. ${s.title}` },
    {
      nav: (d) => { const n = i + d; if (n >= 0 && n < b.steps.length) openStep(n); },
      actions: `<button data-star>⭐ Save</button>`,
      onAction: (e) => e.target.dataset.star !== undefined && saveStep(v.id, i),
    }
  );
}

function download(dataUrl, name) {
  if (!dataUrl) return;
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = name.replace(/[^\w\- .]/g, "") + ".jpg";
  a.click();
}

/* ---------------- saved photos ⭐ ---------------- */
async function saveStep(vid, i) {
  const { video, data } = state.breakdowns[vid];
  const s = data.steps[i];
  const note = prompt(`Save "${s.title}"\nAdd a note (optional), e.g. "this bolt is a pain, use extension":`, "");
  if (note === null) return;
  const id = Date.now().toString(36);
  const img = photos[shotKey(vid, i)];
  if (img) await photoPut("saved:" + id, img); // own copy, so redoing photos doesn't change it
  (state.saved ||= []).unshift({ id, vid, videoTitle: video.title, step: { ...s }, stepNo: i + 1, note, hasImg: !!img, at: Date.now() });
  save();
  renderSaved();
  toast("⭐ Saved – see “Saved photos” at the top");
}

function renderSaved() {
  const el = $("#saved");
  const items = state.saved || [];
  if (!items.length) return el.classList.add("hidden");
  sec(el, "saved", "⭐ Saved photos", `${items.length}`, `
    <div class="saved-grid">${items.map((x, k) => `
      <div class="saved-item" data-k="${k}">
        <div class="shot">${shotHtml(x.vid, x.step, 0, x.hasImg ? photos["saved:" + x.id] : null)}</div>
        <div class="muted">${esc(x.videoTitle)}</div>
        <b>${x.stepNo}. ${esc(x.step.title)}</b>
        ${x.note ? `<div class="note">📝 ${esc(x.note)}</div>` : ""}
      </div>`).join("")}</div>`, true);
  el.querySelectorAll(".saved-item").forEach((n) => (n.onclick = () => openSaved(+n.dataset.k)));
  fetchMissing(items.filter((x) => x.hasImg).map((x) => "saved:" + x.id), renderSaved);
}

/* ---------------- current repair bar + library ---------------- */
function renderProject() {
  const el = $("#project");
  if (!state.diagnosis) return el.classList.add("hidden");
  const item = state.library?.find((p) => p.id === state.currentId);
  el.className = "card project";
  el.innerHTML = `
    <div class="project-head">
      <div><span class="muted">Current repair</span><h2>${esc(projectTitle())}</h2>
        ${item ? `<span class="badge ${item.status}">${item.status === "fixed" ? "✅ Fixed" : "🔧 In progress"}</span> <span class="muted">· saved in Library</span>` : `<span class="muted">Not in your Library yet</span>`}
      </div>
      <div class="row">
        ${item ? "" : `<button class="primary" id="addLib">📚 Save to Library</button>`}
        ${item?.status === "fixed" ? `<button id="markOpen">Reopen</button>` : `<button id="markFixed">✅ Mark fixed</button>`}
      </div>
    </div>
    <textarea id="notes" rows="2" placeholder="Notes – what you did, parts used, part numbers, cost, what was a pain…">${esc(state.notes || "")}</textarea>`;
  $("#notes").oninput = (e) => { state.notes = e.target.value; save(); };
  if ($("#addLib")) $("#addLib").onclick = () => addToLibrary("in_progress");
  if ($("#markFixed")) $("#markFixed").onclick = () => { if (!item) addToLibrary("fixed"); else setStatus(item, "fixed"); };
  if ($("#markOpen")) $("#markOpen").onclick = () => setStatus(item, "in_progress");
}

function addToLibrary(status) {
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  (state.library ||= []).unshift({ id, title: projectTitle(), status, created: Date.now(), updated: Date.now(), fixedAt: status === "fixed" ? Date.now() : null, notes: state.notes || "", snapshot: snapshot() });
  state.currentId = id;
  save();
  renderProject();
  renderLibrary();
  toast(status === "fixed" ? "✅ Marked fixed and saved to your Library" : "📚 Saved to your Library");
}

function setStatus(item, status) {
  item.status = status;
  item.fixedAt = status === "fixed" ? Date.now() : null;
  save();
  renderProject();
  renderLibrary();
  if (status === "fixed") toast("✅ Nice work! Saved as fixed");
}

const carName = (c = {}) => [c.year, c.make, c.model].filter(Boolean).join(" ");
const fmtDate = (t) => (t ? new Date(t).toLocaleDateString() : "");

function renderLibrary() {
  const el = $("#library");
  const items = state.library || [];
  if (!items.length) return el.classList.add("hidden");
  sec(el, "library", `📚 My Library <span class="muted">(${items.length})</span>`, `<span id="syncBadge">${SYNC ? "☁️ Synced" : "This device only"}</span>`, `
    <div class="lib-grid">${items.map((p, k) => {
      const vids = Object.keys(p.snapshot?.breakdowns || {});
      return `
      <div class="lib-item ${p.id === state.currentId ? "on" : ""}">
        <div class="lib-thumb">${vids.length ? `<img src="${photos[shotKey(vids[0], 0)] || `https://i.ytimg.com/vi/${vids[0]}/mqdefault.jpg`}" alt="">` : "🔧"}</div>
        <div class="lib-body">
          <span class="badge ${p.status}">${p.status === "fixed" ? "✅ Fixed" : "🔧 In progress"}</span>
          <b>${esc(p.title)}</b>
          <div class="muted">${esc(carName(p.snapshot?.car))} · ${p.status === "fixed" ? "fixed " + fmtDate(p.fixedAt) : "started " + fmtDate(p.created)} · ${vids.length} video${vids.length === 1 ? "" : "s"}</div>
          ${p.notes ? `<div class="note">📝 ${esc(p.notes.slice(0, 140))}${p.notes.length > 140 ? "…" : ""}</div>` : ""}
          <div class="row" style="margin-top:var(--space-1)">
            <button data-open="${k}">${p.id === state.currentId ? "Open ✔" : "Open"}</button>
            ${SYNC ? `<button data-share="${k}">🔗 Share link</button>` : ""}
            <button data-del="${k}">🗑</button>
          </div>
        </div>
      </div>`;
    }).join("")}</div>`, true);
  el.querySelectorAll("[data-open]").forEach((b) => (b.onclick = () => openProject(items[b.dataset.open])));
  el.querySelectorAll("[data-share]").forEach((b) => (b.onclick = () => shareProject(items[b.dataset.share], b)));
  el.querySelectorAll("[data-del]").forEach((b) => (b.onclick = () => {
    const p = items[b.dataset.del];
    if (!confirm(`Delete “${p.title}” from your Library?`)) return;
    items.splice(b.dataset.del, 1);
    if (state.currentId === p.id) delete state.currentId;
    save();
    renderLibrary();
    renderProject();
  }));
}

function openProject(p) {
  if (p.id === state.currentId) return $("#project").scrollIntoView({ behavior: "smooth" });
  if (!state.currentId && state.diagnosis && !confirm("Your current repair isn't in the Library and will be replaced. Continue?")) return;
  clearCurrent();
  Object.assign(state, JSON.parse(JSON.stringify(p.snapshot || {})));
  state.breakdowns ||= {};
  if (state.videos && !state.videoSets) state.videoSets = [{ problem: state.problem?.name || "Videos", videos: state.videos, at: Date.now() }];
  delete state.videos;
  state.currentId = p.id;
  save();
  loadIntake();
  renderAll();
  $("#project").scrollIntoView({ behavior: "smooth" });
}

async function shareProject(p, btn) {
  await busy(btn, "…", async () => {
    await pushState(); // make sure the cloud copy is current
    p.shareToken ||= (await req("POST", "/api/share", { projectId: p.id })).token;
    save();
    const link = `${location.origin}/?share=${p.shareToken}`;
    try { await navigator.clipboard.writeText(link); toast("🔗 Link copied – anyone with it can view (not edit) this repair", 6000); }
    catch { prompt("Copy this link:", link); }
  });
}

/* ---------------- read-only share page ---------------- */
async function renderShare() {
  document.body.classList.add("readonly");
  $("main").innerHTML = `<section class="card"><span class="spinner"></span>Loading…</section>`;
  let data;
  try { data = await req("GET", "/api/shared/" + SHARE); }
  catch (e) { $("main").innerHTML = `<section class="card">${esc(e.message)}</section>`; return; }
  const { project: p, saved } = data;
  const snap = p.snapshot || {};
  const bds = Object.values(snap.breakdowns || {});
  const list = (title, arr) => (arr?.length ? `<div><b>${title}</b><ul>${arr.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>` : "");
  const keys = [];
  $("main").innerHTML = `
    <section class="card">
      <span class="badge ${p.status}">${p.status === "fixed" ? "✅ Fixed" : "🔧 In progress"}</span>
      <h2>${esc(p.title)}</h2>
      <div class="muted">${esc(carName(snap.car))} ${snap.car?.engine ? "· " + esc(snap.car.engine) : ""}</div>
      ${snap.symptoms ? `<p><b>Symptoms:</b> ${esc(snap.symptoms)}</p>` : ""}
      ${p.notes ? `<div class="note">📝 ${esc(p.notes)}</div>` : ""}
    </section>
    ${saved.length ? `<section class="card"><h2>⭐ Key photos</h2><div class="saved-grid">${saved.map((x) => { keys.push("saved:" + x.id); return `
      <div class="saved-item" data-sk="saved:${x.id}"><div class="shot" data-key="saved:${x.id}">${shotHtml(x.vid, x.step, 0, photos["saved:" + x.id])}</div>
      <b>${x.stepNo}. ${esc(x.step.title)}</b>${x.note ? `<div class="note">📝 ${esc(x.note)}</div>` : ""}</div>`; }).join("")}</div></section>` : ""}
    ${bds.map(({ video: v, data: b }) => `
      <section class="card">
        <h2>${esc(v.title)}</h2>
        <a href="https://www.youtube.com/watch?v=${v.id}" target="_blank" rel="noopener">Watch on YouTube</a>
        <div class="cols">${list("🧰 Tools", b.tools)}${list("🔩 Parts", b.parts)}${list("📏 Specs", b.specs)}</div>
        ${(b.steps || []).map((s, i) => { keys.push(shotKey(v.id, i)); return `
          <div class="step">
            <div class="shot" data-key="${shotKey(v.id, i)}" data-vid="${v.id}" data-i="${i}">${shotHtml(v.id, s, i)}</div>
            <div class="step-text"><div><span class="ts">${fmtTime(s.t)}</span> &nbsp;<b>${i + 1}. ${esc(s.title)}</b></div><div>${esc(s.detail)}</div>
              ${s.look_at ? `<div class="look">👀 ${esc(s.look_at)}</div>` : ""}${s.warning ? `<div class="gotcha">⚠️ ${esc(s.warning)}</div>` : ""}</div>
          </div>`; }).join("")}
      </section>`).join("")}`;
  const stepOf = (vid, i) => snap.breakdowns[vid].data.steps[i];
  const refresh = () => document.querySelectorAll(".shot[data-vid]").forEach((n) => (n.innerHTML = shotHtml(n.dataset.vid, stepOf(n.dataset.vid, +n.dataset.i), +n.dataset.i)));
  document.querySelectorAll(".shot[data-vid]").forEach((n) => (n.onclick = () => {
    const s = stepOf(n.dataset.vid, +n.dataset.i);
    viewer({ vid: n.dataset.vid, s, img: photos[n.dataset.key], label: `${+n.dataset.i + 1}. ${s.title}` });
  }));
  document.querySelectorAll(".saved-item[data-sk]").forEach((n) => (n.onclick = () => {
    const x = saved.find((y) => "saved:" + y.id === n.dataset.sk);
    viewer({ vid: x.vid, s: x.step, img: photos[n.dataset.sk], label: `${x.stepNo}. ${x.step.title}`, note: x.note });
  }));
  fetchMissing(keys, () => {
    refresh();
    document.querySelectorAll(".saved-item[data-sk] .shot").forEach((n) => {
      const x = saved.find((y) => "saved:" + y.id === n.dataset.key);
      n.innerHTML = shotHtml(x.vid, x.step, 0, photos[n.dataset.key]);
    });
  });
}

function openSaved(k) {
  const items = state.saved;
  const x = items[k];
  viewer(
    { vid: x.vid, s: x.step, img: x.hasImg ? photos["saved:" + x.id] : null, label: `${x.stepNo}. ${x.step.title} — ${x.videoTitle}`, note: x.note },
    {
      nav: (d) => { const n = k + d; if (n >= 0 && n < items.length) openSaved(n); },
      actions: `<button data-note>📝 Edit note</button><button data-del>🗑 Delete</button>`,
      onAction: async (e) => {
        if (e.target.dataset.note !== undefined) {
          const n = prompt("Note:", x.note || "");
          if (n === null) return;
          x.note = n; save(); renderSaved(); openSaved(k);
        } else if (e.target.dataset.del !== undefined && confirm("Delete this saved photo?")) {
          items.splice(k, 1); await photoDel("saved:" + x.id); save(); renderSaved();
          $("#lightbox").classList.add("hidden");
        }
      },
    }
  );
}

// clean = no controls/overlays at all (used while taking step photos). Resolves when the player is ready.
function makePlayer(id, { force = false, clean = false } = {}) {
  if (!force && playerVid === id && document.querySelector("#yt")?.tagName === "IFRAME") return Promise.resolve();
  if (force) $(".player").innerHTML = `<div id="yt"></div>`;
  playerReady = false;
  playerVid = id;
  return new Promise((resolve) => {
    const create = () => {
      player = new YT.Player("yt", {
        videoId: id,
        playerVars: clean
          ? { controls: 0, disablekb: 1, fs: 0, rel: 0, iv_load_policy: 3, playsinline: 1, mute: 1, cc_load_policy: 0 }
          : { rel: 0, modestbranding: 1, playsinline: 1, iv_load_policy: 3 },
        events: { onReady: () => { playerReady = true; resolve(); } },
      });
    };
    if (window.YT?.Player) create();
    else window.onYouTubeIframeAPIReady = create;
  });
}

function seek(t) {
  if (!playerReady) return toast("Player still loading…");
  openSec("breakdown");
  player.seekTo(t, true);
  player.playVideo();
  $(".player-wrap").scrollIntoView({ behavior: "smooth", block: "start" });
}

/* ---------------- screenshots (browser tab capture) ---------------- */
let capStream, capVideo;
async function ensureCapture() {
  if (capStream?.active) return true;
  toast("Pick THIS tab in the share popup so I can grab frames from the video", 6000);
  capStream = await navigator.mediaDevices.getDisplayMedia({
    video: { displaySurface: "browser", frameRate: 30, width: { ideal: 3840 }, height: { ideal: 2160 } },
    audio: false,
    preferCurrentTab: true,
    selfBrowserSurface: "include",
  });
  capVideo = document.createElement("video");
  capVideo.muted = true;
  capVideo.srcObject = capStream;
  await capVideo.play();
  await sleep(500);
  return true;
}

function grabPlayerFrame() {
  const rect = $(".player").getBoundingClientRect();
  const sx = capVideo.videoWidth / window.innerWidth;
  const sy = capVideo.videoHeight / window.innerHeight;
  const c = document.createElement("canvas");
  c.width = Math.min(1920, Math.round(rect.width * sx));
  c.height = Math.round((c.width * 9) / 16);
  c.getContext("2d").drawImage(capVideo, rect.left * sx, rect.top * sy, rect.width * sx, rect.height * sy, 0, 0, c.width, c.height);
  return c;
}

// True if the frame is (almost) all black – video still loading after a jump.
function isBlank(c) {
  const t = document.createElement("canvas");
  t.width = 32; t.height = 18;
  const x = t.getContext("2d");
  x.drawImage(c, 0, 0, 32, 18);
  const d = x.getImageData(0, 0, 32, 18).data;
  let sum = 0, bright = 0;
  for (let i = 0; i < d.length; i += 4) {
    const l = 0.3 * d[i] + 0.59 * d[i + 1] + 0.11 * d[i + 2];
    sum += l;
    if (l > 40) bright++;
  }
  return sum / (d.length / 4) < 18 || bright < 20;
}

// Jump to t, let it actually play, then grab a non-black frame. Returns dataURL or null.
// The video keeps playing the whole time and we only jump around in it – pausing/resuming is what
// makes YouTube flash its play/pause icons. We only take the photo once the video is really playing
// (time moving forward, not ended/buffering) and any icon has had time to fade.
async function captureAt(t) {
  const dur = player.getDuration?.() || 0;
  if (dur && t >= dur - 2) return { skip: "past the end of the video" };
  player.seekTo(Math.max(0, t - 1.5), true);
  const deadline = Date.now() + 15000; // give up on this step after 15s
  let first = true;
  while (Date.now() < deadline) {
    const st = player.getPlayerState();
    if (st === YT.PlayerState.ENDED) return { skip: "video ended" };
    if (st !== YT.PlayerState.PLAYING && st !== YT.PlayerState.BUFFERING) player.playVideo();
    while (player.getCurrentTime() < t && Date.now() < deadline) await sleep(80);
    await sleep(first ? 1200 : 500);
    first = false;
    // only shoot when the video is really playing (time moving), so no play/pause/loading icons
    const a = player.getCurrentTime();
    await sleep(250);
    if (!(player.getCurrentTime() > a && player.getPlayerState() === YT.PlayerState.PLAYING)) continue;
    const c = grabPlayerFrame();
    if (!isBlank(c)) return { img: c.toDataURL("image/jpeg", 0.9) };
  }
  return { skip: "couldn't get a clear frame" };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function captureAll(btn) {
  if (!playerReady) return toast("Player still loading…");
  const { video: v, data: b } = active();
  openSec("breakdown");
  await busy(btn, "Capturing…", async () => {
   try {
    await ensureCapture();
    const steps = b.steps || [];
    let failed = 0;
    // fill the screen with the video: bigger player = YouTube sends HD = sharper photos
    const wrap = $(".player-wrap");
    wrap.classList.add("capturing");
    const label = document.createElement("div");
    label.className = "cap-label";
    label.textContent = "📸 Getting the video ready…";
    wrap.appendChild(label);
    // swap in a bare player (no controls, title or icons) just for the photos
    await makePlayer(v.id, { force: true, clean: true });
    player.mute();
    player.seekTo(Math.max(0, (steps[0]?.t || 0) - 1.5), true);
    player.playVideo();
    await waitPlaying(10000);
    // cover the player so the mouse can't bring up any YouTube overlays
    const shield = document.createElement("div");
    shield.className = "shield";
    $(".player").appendChild(shield);
    for (let i = 0; i < steps.length; i++) {
      btn.innerHTML = label.textContent = `📸 Taking step photos… ${i + 1}/${steps.length}`;
      const r = await captureAt(steps[i].t);
      if (r.img) await photoPut(shotKey(v.id, i), r.img);
      else { failed++; if (photos[shotKey(v.id, i)]) await photoDel(shotKey(v.id, i)); } // drop a bad old photo
      const n = document.querySelector(`#step-${i} .shot`);
      if (n) n.innerHTML = shotHtml(v.id, steps[i], i);
    }
    shield.remove();
    label.remove();
    wrap.classList.remove("capturing");
    capStream.getTracks().forEach((t) => t.stop());
    await makePlayer(v.id, { force: true }); // back to the normal player
    renderBreakdown();
    toast(failed ? `Photos saved ✔ – ${failed} step(s) skipped (bad timestamp or video wouldn't play) – they keep a ▶ button to watch instead` : "Step photos saved ✔ – tap any photo to see it big", 6000);
   } finally {
    document.querySelector(".player-wrap.capturing")?.classList.remove("capturing");
    document.querySelectorAll(".cap-label, .shield").forEach((n) => n.remove());
   }
  });
}

async function waitPlaying(timeout = 6000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (player.getPlayerState() === YT.PlayerState.PLAYING) return;
    await sleep(150);
  }
}

async function snapNow() {
  try {
    await ensureCapture();
    const { video: v, data: b } = active();
    const t = player.getCurrentTime();
    let idx = 0;
    (b.steps || []).forEach((s, i) => { if (s.t <= t) idx = i; });
    const c = grabPlayerFrame();
    if (isBlank(c)) return toast("That frame is black – let the video play a second and try again");
    await photoPut(shotKey(v.id, idx), c.toDataURL("image/jpeg", 0.9));
    renderBreakdown();
    toast(`Saved to step ${idx + 1}`);
  } catch (e) {
    toast("Capture cancelled: " + e.message);
  }
}

/* ---------------- boot ---------------- */
function renderAll() {
  renderLibrary();
  renderSaved();
  renderProject();
  renderDiagnosis();
  renderVideos();
  renderBreakdown();
}

// migrate older saves (one video, photos in localStorage)
state.breakdowns ||= {};
if (state.breakdown && state.video) {
  state.breakdowns[state.video.id] = { video: state.video, data: state.breakdown, problem: state.problem?.name };
  state.active = state.video.id;
}
if (state.videos && !state.videoSets) state.videoSets = [{ problem: state.problem?.name || "Videos", videos: state.videos, at: Date.now() }];
delete state.videos;
const oldShots = state.shots || {};
delete state.breakdown; delete state.video; delete state.shots;

async function boot() {
  if (SHARE) return renderShare();
  loadIntake();
  try {
    await loadPhotos();
    for (const [vid, m] of Object.entries(oldShots)) for (const [i, img] of Object.entries(m)) await photoPut(shotKey(vid, i), img);
  } catch {
    toast("Photo storage unavailable in this browser");
  }
  renderAll();

  const cfg = await fetch("/api/config").then((r) => r.json()).catch(() => ({}));
  if (cfg.passwordRequired && !localStorage.getItem("appPassword")) {
    const pw = prompt("Password:");
    if (pw) localStorage.setItem("appPassword", pw);
  }
  if (!cfg.sync) return;
  try {
    const remote = await req("GET", "/api/sync");
    SYNC = true;
    if (remote.state && (remote.state.updatedAt || 0) > (state.updatedAt || 0)) {
      // the cloud copy is newer (made on another device) – use it
      for (const k of Object.keys(state)) delete state[k];
      Object.assign(state, remote.state);
      state.breakdowns ||= {};
      if (state.videos && !state.videoSets) state.videoSets = [{ problem: state.problem?.name || "Videos", videos: state.videos, at: Date.now() }];
      delete state.videos;
      localStorage.setItem("repairState", JSON.stringify(state));
      loadIntake();
    } else if (state.updatedAt) {
      await pushState();
    }
    // first time on this device: upload any photos made before sync existed
    if (!localStorage.getItem("photosUploaded")) {
      Object.keys(photos).forEach((k) => pending.add(k));
      localStorage.setItem("photosUploaded", "1");
    }
    for (const k of pending) uploadPhoto(k);
    renderAll();
  } catch (e) {
    if (e.status === 401) {
      localStorage.removeItem("appPassword");
      toast("Wrong password – reload the page to try again", 6000);
    }
  }
}
boot();

// coming back to the tab (e.g. after using another device): pull newer cloud data
document.addEventListener("visibilitychange", async () => {
  if (document.hidden || !SYNC || SHARE) return;
  try {
    const remote = await req("GET", "/api/sync");
    if (remote.state && (remote.state.updatedAt || 0) > (state.updatedAt || 0)) {
      const activeEl = document.activeElement?.id;
      if (activeEl === "notes" || activeEl === "symptoms") return; // don't yank the page while typing
      for (const k of Object.keys(state)) delete state[k];
      Object.assign(state, remote.state);
      state.breakdowns ||= {};
      localStorage.setItem("repairState", JSON.stringify(state));
      loadIntake();
      renderAll();
      toast("☁️ Updated from your other device");
    }
  } catch {}
});
