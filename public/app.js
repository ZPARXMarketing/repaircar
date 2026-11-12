// Car Repair Helper - frontend
const $ = (s) => document.querySelector(s);
const state = JSON.parse(localStorage.getItem("repairState") || "{}");
// state: { car, symptoms, history, diagnosis, problem, videos, video, breakdown, shots: {videoId: {stepIndex: dataUrl}} }
state.shots ||= {};
const save = () => {
  try {
    localStorage.setItem("repairState", JSON.stringify(state));
  } catch {
    toast("Storage full – older screenshots won't be saved");
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
    Object.assign(state, { car, symptoms, history: [], videos: null, breakdown: null, problem: null });
    localStorage.setItem("lastCar", JSON.stringify(car));
    state.diagnosis = await api("/api/diagnose", { car, symptoms, history: [] });
    save();
    renderAll();
    $("#diagnosis").scrollIntoView({ behavior: "smooth" });
  });
};

$("#newBtn").onclick = () => {
  if (!confirm("Start a new problem? (Your car stays filled in.)")) return;
  const car = state.car;
  for (const k of Object.keys(state)) delete state[k];
  state.shots = {};
  state.car = car;
  save();
  location.reload();
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
    state.breakdown = null;
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
            <button class="primary" data-break="${i}">📋 Step-by-step + screenshots</button>
            <a href="https://www.youtube.com/watch?v=${v.id}" target="_blank" rel="noopener"><button>Open on YouTube</button></a>
          </div>
        </div>
      </div>`).join("")}`;
  el.querySelectorAll("[data-break]").forEach((b) => (b.onclick = () => getBreakdown(state.videos[b.dataset.break], b)));
}

/* ---------------- breakdown ---------------- */
async function getBreakdown(video, btn) {
  await busy(btn, "Watching the video (can take ~30-60s)…", async () => {
    const data = await api("/api/breakdown", { videoId: video.id, car: state.car, problem: state.problem, length: video.length });
    state.video = video;
    state.breakdown = data;
    save();
    renderBreakdown();
    $("#breakdown").scrollIntoView({ behavior: "smooth" });
  });
}

let player, playerReady = false;
function renderBreakdown() {
  const el = $("#breakdown");
  const b = state.breakdown, v = state.video;
  if (!b || !v) return el.classList.add("hidden");
  el.className = "card";
  const shots = (state.shots[v.id] ||= {});
  const canCapture = !!navigator.mediaDevices?.getDisplayMedia && !/Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
  const haveAll = (b.steps || []).every((_, i) => shots[i]);
  const list = (title, arr) => (arr?.length ? `<div><b>${title}</b><ul>${arr.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>` : "");

  el.innerHTML = `
    <h2>${esc(v.title)}</h2>
    <p>${esc(b.overview)} <span class="muted">(${esc(b.source)})</span></p>
    ${canCapture && !haveAll ? `
      <div class="banner">
        <div><b>📸 Turn every step into a photo</b><br><span class="muted">Click, then pick <b>this tab</b> in the popup and hit Share. It jumps through the video and snaps each step (~1 min). Keep this tab open.</span></div>
        <button class="primary" id="captureAll">Make step photos</button>
      </div>` : ""}
    ${!canCapture ? `<p class="muted">On a phone: tap any step photo to play that exact moment. For real screenshots, open this on a computer once – they'll be saved.</p>` : ""}
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
        <div class="shot" data-i="${i}">${shotHtml(i)}</div>
        <div>
          <div><span class="ts" data-seek="${s.t}">▶ ${fmtTime(s.t)}</span> &nbsp;<b>${i + 1}. ${esc(s.title)}</b></div>
          <div>${esc(s.detail)}</div>
          ${s.look_at ? `<div class="look">👀 ${esc(s.look_at)}</div>` : ""}
          ${s.warning ? `<div class="gotcha">⚠️ ${esc(s.warning)}</div>` : ""}
        </div>
      </div>`).join("")}`;

  el.querySelectorAll("[data-seek]").forEach((n) => (n.onclick = () => seek(+n.dataset.seek)));
  el.querySelectorAll(".shot").forEach((n) => (n.onclick = () => openShot(+n.dataset.i)));
  $("#askVideo").onclick = () => askBox($("#askVideoBox"), state.problem?.name, `Watching video "${v.title}". Steps: ${(b.steps || []).map((s) => s.title).join("; ")}`);
  if ($("#captureAll")) $("#captureAll").onclick = (e) => captureAll(e.currentTarget);
  if ($("#snapNow")) $("#snapNow").onclick = snapNow;
  makePlayer(v.id);
}

// Orange box over the part the step is about (position comes from the video model; approximate).
function boxHtml(box) {
  if (!Array.isArray(box) || box.length !== 4) return "";
  let [y1, x1, y2, x2] = box.map((n) => Math.max(0, Math.min(1000, +n)) / 10);
  const pad = 3; // a bit of margin so the part isn't hidden under the outline
  y1 = Math.max(0, y1 - pad); x1 = Math.max(0, x1 - pad); y2 = Math.min(100, y2 + pad); x2 = Math.min(100, x2 + pad);
  return `<div class="hl" style="top:${y1}%;left:${x1}%;height:${y2 - y1}%;width:${x2 - x1}%"></div>`;
}

function shotHtml(i) {
  const v = state.video, s = state.breakdown.steps[i];
  const img = state.shots[v.id]?.[i];
  if (img) return `<img src="${img}" alt="" />${boxHtml(s.box)}`;
  return `<img src="https://i.ytimg.com/vi/${v.id}/mqdefault.jpg" alt="" class="dim" /><span class="play">▶ ${fmtTime(s.t)}</span>`;
}

// Tap a step photo: show the screenshot big, or play that moment inline if there's no screenshot yet.
function openShot(i) {
  const v = state.video, s = state.breakdown.steps[i];
  const img = state.shots[v.id]?.[i];
  const box = $("#lightbox");
  box.innerHTML = `
    <div class="lb-inner">
      <div class="lb-media">${
        img
          ? `<img src="${img}" alt="" />${boxHtml(s.box)}`
          : `<iframe src="https://www.youtube.com/embed/${v.id}?start=${Math.max(0, s.t - 2)}&end=${s.t + 12}&autoplay=1&rel=0&playsinline=1" allow="autoplay; encrypted-media" allowfullscreen></iframe>`
      }</div>
      <div class="lb-text"><b>${i + 1}. ${esc(s.title)}</b> <span class="ts">${fmtTime(s.t)}</span><br>${esc(s.detail)}
        ${s.look_at ? `<div class="look">👀 ${esc(s.look_at)}</div>` : ""}
        ${s.warning ? `<div class="gotcha">⚠️ ${esc(s.warning)}</div>` : ""}
      </div>
      <div class="row">
        <button data-nav="-1">◀ Prev</button><button data-nav="1">Next ▶</button>
        ${img ? `<button data-clip>▶ Play this moment</button>` : ""}
        <button data-close>Close</button>
      </div>
    </div>`;
  box.classList.remove("hidden");
  box.onclick = (e) => {
    if (e.target === box || e.target.dataset.close !== undefined) { box.classList.add("hidden"); box.innerHTML = ""; }
    else if (e.target.dataset.nav) {
      const n = i + +e.target.dataset.nav;
      if (n >= 0 && n < state.breakdown.steps.length) openShot(n);
    } else if (e.target.dataset.clip !== undefined) {
      box.querySelector(".lb-media").innerHTML = `<iframe src="https://www.youtube.com/embed/${v.id}?start=${Math.max(0, s.t - 2)}&end=${s.t + 12}&autoplay=1&rel=0&playsinline=1" allow="autoplay; encrypted-media" allowfullscreen></iframe>`;
    }
  };
}

function makePlayer(id) {
  playerReady = false;
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
  c.width = 640;
  c.height = 360;
  c.getContext("2d").drawImage(capVideo, rect.left * sx, rect.top * sy, rect.width * sx, rect.height * sy, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", 0.75);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function captureAll(btn) {
  if (!playerReady) return toast("Player still loading…");
  await busy(btn, "Capturing…", async () => {
    await ensureCapture();
    const steps = state.breakdown.steps || [];
    const shots = state.shots[state.video.id];
    player.mute();
    for (let i = 0; i < steps.length; i++) {
      btn.innerHTML = `<span class="spinner"></span>Step ${i + 1}/${steps.length}`;
      window.scrollTo({ top: 0 });
      $(".player-wrap").scrollIntoView({ block: "start" });
      // start a moment early and let it play into the step, so the frame is sharp (not a seek blur)
      player.seekTo(Math.max(0, steps[i].t - 1), true);
      player.playVideo();
      await waitPlaying();
      const end = Date.now() + 5000;
      while (player.getCurrentTime() < steps[i].t && Date.now() < end) await sleep(80);
      await sleep(200);
      shots[i] = grabPlayerFrame();
      player.pauseVideo();
      const n = document.querySelector(`#step-${i} .shot`);
      if (n) n.innerHTML = shotHtml(i);
    }
    player.unMute();
    save();
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
    const t = player.getCurrentTime();
    const steps = state.breakdown.steps || [];
    // attach to the step closest before the current time
    let idx = 0;
    steps.forEach((s, i) => { if (s.t <= t) idx = i; });
    state.shots[state.video.id][idx] = grabPlayerFrame();
    save();
    document.querySelector(`#step-${idx} .shot`).innerHTML = shotHtml(idx);
    toast(`Saved to step ${idx + 1}`);
  } catch (e) {
    toast("Capture cancelled: " + e.message);
  }
}

/* ---------------- boot ---------------- */
function renderAll() {
  renderDiagnosis();
  renderVideos();
  renderBreakdown();
}

loadIntake();
renderAll();
fetch("/api/config").then((r) => r.json()).then((c) => {
  if (c.passwordRequired && !localStorage.getItem("appPassword")) {
    const pw = prompt("Password:");
    if (pw) localStorage.setItem("appPassword", pw);
  }
}).catch(() => {});
