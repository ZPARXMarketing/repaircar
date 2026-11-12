// Car Repair Helper - frontend
const $ = (s) => document.querySelector(s);
const state = JSON.parse(localStorage.getItem("repairState") || "{}");
// state: { car, symptoms, history, diagnosis, problem, videos, breakdowns: {videoId: {video, data, problem}}, active, saved: [] }
// Photos live in IndexedDB (see photo storage below).
const save = () => {
  try {
    localStorage.setItem("repairState", JSON.stringify(state));
  } catch {
    toast("Storage full");
  }
};

const esc = (s = "") => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmtTime = (t) => { t = Math.max(0, Math.floor(t || 0)); const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60; return (h ? h + ":" + String(m).padStart(2, "0") : m) + ":" + String(s).padStart(2, "0"); };
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
function loadIntake() {
  const car = state.car || JSON.parse(localStorage.getItem("lastCar") || "{}");
  carFields.forEach((f) => ($("#" + f).value = car[f] || ""));
  $("#symptoms").value = state.symptoms || "";
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
    Object.assign(state, { car, symptoms, history: [], videos: null, problem: null });
    localStorage.setItem("lastCar", JSON.stringify(car));
    state.diagnosis = await api("/api/diagnose", { car, symptoms, history: [] });
    save();
    renderAll();
    $("#diagnosis").scrollIntoView({ behavior: "smooth" });
  });
};

$("#newBtn").onclick = () => {
  if (!confirm("Start a new problem? Clears the current videos and step photos. (Your car and ⭐ saved photos stay.)")) return;
  const keep = { car: state.car, saved: state.saved };
  for (const k of Object.keys(state)) delete state[k];
  Object.assign(state, keep);
  save();
  idb("readonly", (st) => st.getAllKeys()).then(async (keys = []) => {
    for (const k of keys) if (String(k).startsWith("shot:")) await photoDel(k);
    location.reload();
  });
};

/* ---------------- diagnosis ---------------- */
function renderDiagnosis() {
  const d = state.diagnosis;
  const el = $("#diagnosis");
  if (!d) return el.classList.add("hidden");
  el.classList.remove("hidden");
  el.className = "card";
  el.innerHTML = `
    <h2>Most likely problems</h2>
    <p>${esc(d.summary)}</p>
    ${d.safety_warning ? `<div class="warn">⚠️ ${esc(d.safety_warning)}</div>` : ""}
    ${(d.problems || []).map((p, i) => `
      <div class="problem">
        <div class="top"><h3>${i + 1}. ${esc(p.name)}</h3><span class="pct">${p.likelihood}%</span></div>
        <div class="bar"><div style="width:${Math.min(100, p.likelihood)}%"></div></div>
        <div>${esc(p.why)}</div>
        <div class="tags">
          <span class="tag">🛠 ${esc(p.difficulty)}</span>
          <span class="tag">⏱ ${esc(p.time)}</span>
          <span class="tag">🔩 Parts ${esc(p.parts_cost)}</span>
          <span class="tag">🏪 Shop ${esc(p.shop_cost)}</span>
        </div>
        ${p.how_to_confirm?.length ? `<b>How to confirm:</b><ol>${p.how_to_confirm.map((s) => `<li>${esc(s)}</li>`).join("")}</ol>` : ""}
        <div class="row">
          <button class="primary" data-videos="${i}">▶ Find repair videos (in order)</button>
          <button data-ask="${i}">Ask about this</button>
        </div>
        <div class="ask-box" id="ask-${i}"></div>
      </div>`).join("")}
    ${d.questions?.length ? `
      <h2>Help me narrow it down</h2>
      <p class="muted">Answer any of these (or add new info) and I'll re-rank.</p>
      <ul>${d.questions.map((q) => `<li>${esc(q)}</li>`).join("")}</ul>` : ""}
    <div class="qa">
      <input id="refineInput" placeholder="e.g. Battery tested fine, the light comes on when I turn on the AC…" />
      <button id="refineBtn">Update</button>
    </div>`;

  el.querySelectorAll("[data-videos]").forEach((b) => (b.onclick = () => getVideos(d.problems[b.dataset.videos], b)));
  el.querySelectorAll("[data-ask]").forEach((b) => (b.onclick = () => askBox($("#ask-" + b.dataset.ask), d.problems[b.dataset.ask].name)));
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

/* ---------------- videos ---------------- */
async function getVideos(problem, btn) {
  await busy(btn, "Searching YouTube & ordering…", async () => {
    const data = await api("/api/videos", { car: state.car, problem });
    state.problem = problem;
    state.videos = data.videos;
    save();
    if (data.note) toast(data.note, 6000);
    renderAll();
    $("#videos").scrollIntoView({ behavior: "smooth" });
  });
}

function renderVideos() {
  const el = $("#videos");
  if (!state.videos) return el.classList.add("hidden");
  el.className = "card";
  el.innerHTML = `
    <h2>Watch in this order: ${esc(state.problem?.name)}</h2>
    ${!state.videos.length ? `<p>No videos found. Try again or tweak the car details.</p>` : ""}
    ${state.videos.map((v, i) => `
      <div class="video">
        <a href="https://www.youtube.com/watch?v=${v.id}" target="_blank" rel="noopener"><img loading="lazy" src="https://i.ytimg.com/vi/${v.id}/mqdefault.jpg" alt="" /></a>
        <div>
          <div class="stage"><span class="num">${i + 1}</span>${esc(v.stage)}</div>
          <h3>${esc(v.title)}</h3>
          <div class="muted">${esc(v.channel)} · ${esc(v.length)} · ${esc(v.views)}</div>
          <p>${esc(v.why)}</p>
          <div class="row">
            <button class="primary" data-break="${i}">${state.breakdowns?.[v.id] ? "📋 Open steps ✔" : "📋 Step-by-step + screenshots"}</button>
            <a href="https://www.youtube.com/watch?v=${v.id}" target="_blank" rel="noopener"><button>Open on YouTube</button></a>
          </div>
        </div>
      </div>`).join("")}`;
  el.querySelectorAll("[data-break]").forEach((b) => (b.onclick = () => getBreakdown(state.videos[b.dataset.break], b)));
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
const photoPut = (k, v) => { photos[k] = v; return idb("readwrite", (st) => st.put(v, k)); };
const photoDel = (k) => { delete photos[k]; return idb("readwrite", (st) => st.delete(k)); };
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
  el.className = "card";
  const canCapture = !!navigator.mediaDevices?.getDisplayMedia && !/Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
  const haveAll = (b.steps || []).every((_, i) => photos[shotKey(v.id, i)]);
  const list = (title, arr) => (arr?.length ? `<div><b>${title}</b><ul>${arr.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>` : "");

  el.innerHTML = `
    <div class="tabs">${ids.map((id) => {
      const x = state.breakdowns[id].video;
      return `<div class="tab ${id === state.active ? "on" : ""}" data-tab="${id}"><img src="https://i.ytimg.com/vi/${id}/default.jpg" alt=""><span>${esc(x.title)}</span><b data-close-tab="${id}" title="Remove">✕</b></div>`;
    }).join("")}</div>
    <h2>${esc(v.title)}</h2>
    <p>${esc(b.overview)} <span class="muted">(${esc(b.source)})</span></p>
    ${canCapture && !haveAll ? `
      <div class="banner">
        <div><b>📸 This video has no step photos yet</b><br><span class="muted">Click, then pick <b>this tab</b> in the popup and hit Share. It jumps through the video and snaps each step (~1 min). Keep this tab open.</span></div>
        <button class="primary" id="captureAll">Make step photos</button>
      </div>` : ""}
    ${!canCapture ? `<p class="muted">On a phone: tap any step picture to play that exact moment. For real screenshots, open this on a computer once.</p>` : ""}
    <div class="player-wrap"><div class="player"><div id="yt"></div></div></div>
    <div class="row" style="margin:8px 0">
      ${canCapture ? `<button id="snapNow">📸 Snap current frame</button>${haveAll ? `<button id="captureAll">📸 Redo all photos</button>` : ""}` : ""}
      <button id="askVideo">Ask about this video</button>
    </div>
    <div id="askVideoBox"></div>
    <div class="cols">${list("🧰 Tools", b.tools)}${list("🔩 Parts", b.parts)}${list("📏 Specs", b.specs)}</div>
    <h2>Steps</h2>
    ${(b.steps || []).map((s, i) => `
      <div class="step" id="step-${i}">
        <div class="shot" data-i="${i}">${shotHtml(v.id, s, i)}</div>
        <div class="step-text">
          <div><span class="ts" data-seek="${s.t}">▶ ${fmtTime(s.t)}</span> &nbsp;<b>${i + 1}. ${esc(s.title)}</b></div>
          <div>${esc(s.detail)}</div>
          ${s.look_at ? `<div class="look">👀 ${esc(s.look_at)}</div>` : ""}
          ${s.warning ? `<div class="gotcha">⚠️ ${esc(s.warning)}</div>` : ""}
          <div class="row" style="margin-top:8px">
            <button data-save="${i}">⭐ Save</button>
            ${photos[shotKey(v.id, i)] ? `<button data-dl="${i}">⬇ Download</button>` : ""}
          </div>
        </div>
      </div>`).join("")}`;

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

const clipHtml = (vid, t) =>
  `<iframe src="https://www.youtube.com/embed/${vid}?start=${Math.max(0, t - 2)}&end=${t + 12}&autoplay=1&rel=0&playsinline=1" allow="autoplay; encrypted-media" allowfullscreen></iframe>`;

// Full-screen viewer. item = {vid, s, img, label, note}; actions = extra buttons html; onAction(e) handles them.
function viewer(item, { nav, actions = "", onAction } = {}) {
  const { vid, s, img } = item;
  const box = $("#lightbox");
  box.innerHTML = `
    <div class="lb-inner">
      <div class="lb-media">${img ? `<img src="${img}" alt="" />${boxHtml(s.box)}` : clipHtml(vid, s.t)}</div>
      <div class="lb-text"><b>${esc(item.label)}</b> <span class="ts">${fmtTime(s.t)}</span><br>${esc(s.detail || "")}
        ${s.look_at ? `<div class="look">👀 ${esc(s.look_at)}</div>` : ""}
        ${s.warning ? `<div class="gotcha">⚠️ ${esc(s.warning)}</div>` : ""}
        ${item.note ? `<div class="note">📝 ${esc(item.note)}</div>` : ""}
      </div>
      <div class="row">
        ${nav ? `<button data-nav="-1">◀ Prev</button><button data-nav="1">Next ▶</button>` : ""}
        ${img ? `<button data-clip>▶ Play this moment</button><button data-dl>⬇ Download</button>` : ""}
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
  el.className = "card";
  el.innerHTML = `
    <h2>⭐ Saved photos (${items.length})</h2>
    <div class="saved-grid">${items.map((x, k) => `
      <div class="saved-item" data-k="${k}">
        <div class="shot">${shotHtml(x.vid, x.step, 0, x.hasImg ? photos["saved:" + x.id] : null)}</div>
        <div class="muted">${esc(x.videoTitle)}</div>
        <b>${x.stepNo}. ${esc(x.step.title)}</b>
        ${x.note ? `<div class="note">📝 ${esc(x.note)}</div>` : ""}
      </div>`).join("")}</div>`;
  el.querySelectorAll(".saved-item").forEach((n) => (n.onclick = () => openSaved(+n.dataset.k)));
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

function makePlayer(id) {
  if (playerVid === id && document.querySelector("#yt")?.tagName === "IFRAME") return;
  playerReady = false;
  playerVid = id;
  const create = () => {
    player = new YT.Player("yt", {
      videoId: id,
      playerVars: { rel: 0, modestbranding: 1, playsinline: 1 },
      events: { onReady: () => (playerReady = true) },
    });
  };
  if (window.YT?.Player) create();
  else window.onYouTubeIframeAPIReady = create;
}

function seek(t) {
  if (!playerReady) return toast("Player still loading…");
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
    video: { displaySurface: "browser", frameRate: 10 },
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
  c.width = Math.min(1280, Math.round(rect.width * sx));
  c.height = Math.round((c.width * 9) / 16);
  c.getContext("2d").drawImage(capVideo, rect.left * sx, rect.top * sy, rect.width * sx, rect.height * sy, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", 0.85);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function captureAll(btn) {
  if (!playerReady) return toast("Player still loading…");
  const { video: v, data: b } = active();
  await busy(btn, "Capturing…", async () => {
    await ensureCapture();
    const steps = b.steps || [];
    player.mute();
    for (let i = 0; i < steps.length; i++) {
      btn.innerHTML = `<span class="spinner"></span>Step ${i + 1}/${steps.length}`;
      $(".player-wrap").scrollIntoView({ block: "start" });
      // start a moment early and let it play into the step, so the frame is sharp (not a seek blur)
      player.seekTo(Math.max(0, steps[i].t - 1), true);
      player.playVideo();
      await waitPlaying();
      const end = Date.now() + 5000;
      while (player.getCurrentTime() < steps[i].t && Date.now() < end) await sleep(80);
      await sleep(200);
      await photoPut(shotKey(v.id, i), grabPlayerFrame());
      player.pauseVideo();
      const n = document.querySelector(`#step-${i} .shot`);
      if (n) n.innerHTML = shotHtml(v.id, steps[i], i);
    }
    player.unMute();
    capStream.getTracks().forEach((t) => t.stop());
    renderBreakdown();
    toast("Step photos saved ✔ – tap any photo to see it big");
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
    await photoPut(shotKey(v.id, idx), grabPlayerFrame());
    renderBreakdown();
    toast(`Saved to step ${idx + 1}`);
  } catch (e) {
    toast("Capture cancelled: " + e.message);
  }
}

/* ---------------- boot ---------------- */
function renderAll() {
  renderSaved();
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
const oldShots = state.shots || {};
delete state.breakdown; delete state.video; delete state.shots;

loadIntake();
loadPhotos()
  .then(async () => {
    for (const [vid, m] of Object.entries(oldShots)) for (const [i, img] of Object.entries(m)) await photoPut(shotKey(vid, i), img);
    save();
  })
  .catch(() => toast("Photo storage unavailable in this browser"))
  .finally(renderAll);
fetch("/api/config").then((r) => r.json()).then((c) => {
  if (c.passwordRequired && !localStorage.getItem("appPassword")) {
    const pw = prompt("Password:");
    if (pw) localStorage.setItem("appPassword", pw);
  }
}).catch(() => {});
