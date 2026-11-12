// Car Repair Helper - Cloudflare Worker backend
// Routes:
//   POST /api/diagnose   -> likely problems for a car + symptoms (chat style)
//   POST /api/videos     -> ordered YouTube playlist for one problem
//   POST /api/breakdown  -> timestamped repair steps for one video
//   POST /api/ask        -> free-form follow-up question
//   GET  /api/config     -> whether a password is required

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);

    try {
      if (url.pathname === "/api/config") {
        return json({ passwordRequired: !!env.APP_PASSWORD, model: env.MODEL, videoModel: env.VIDEO_MODEL });
      }
      if (env.APP_PASSWORD && request.headers.get("x-app-password") !== env.APP_PASSWORD) {
        return json({ error: "Wrong or missing password" }, 401);
      }
      if (!env.OPENROUTER_API_KEY) return json({ error: "OPENROUTER_API_KEY is not set on the server" }, 500);
      if (request.method !== "POST") return json({ error: "POST only" }, 405);

      const body = await request.json();
      switch (url.pathname) {
        case "/api/diagnose":
          return json(await diagnose(env, body));
        case "/api/videos":
          return json(await findVideos(env, body));
        case "/api/breakdown":
          return json(await breakdown(env, body));
        case "/api/ask":
          return json(await ask(env, body));
        default:
          return json({ error: "Not found" }, 404);
      }
    } catch (err) {
      return json({ error: err.message || String(err) }, 500);
    }
  },
};

/* ----------------------------- helpers ----------------------------- */

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function carString(car = {}) {
  return [car.year, car.make, car.model, car.engine, car.trim, car.mileage ? `${car.mileage} miles` : ""]
    .filter(Boolean)
    .join(" ");
}

// Calls the main model; if it errors or returns broken JSON, retries once on FALLBACK_MODEL.
async function llm(env, messages, opts = {}) {
  try {
    return await llmOnce(env, messages, opts);
  } catch (e) {
    if (opts.model || !env.FALLBACK_MODEL) throw e;
    return llmOnce(env, messages, { ...opts, model: env.FALLBACK_MODEL });
  }
}

async function llmOnce(env, messages, { model, jsonMode = true, maxTokens = 4000 } = {}) {
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
      "content-type": "application/json",
      "X-Title": "Car Repair Helper",
    },
    body: JSON.stringify({
      model: model || env.MODEL,
      messages,
      max_tokens: maxTokens,
      ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) {
    throw new Error(`OpenRouter: ${data.error?.message || res.status}`);
  }
  const text = data.choices?.[0]?.message?.content || "";
  return jsonMode ? parseJson(text) : text;
}

// Gemini (via OpenRouter Responses API) can watch YouTube links directly.
async function videoLlm(env, prompt, videoUrl, attempt = 1) {
  const res = await fetch("https://openrouter.ai/api/v1/responses", {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
      "content-type": "application/json",
      "X-Title": "Car Repair Helper",
    },
    body: JSON.stringify({
      model: env.VIDEO_MODEL,
      provider: { order: ["google-ai-studio"] },
      max_output_tokens: 8000,
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: prompt },
            { type: "input_video", video_url: videoUrl },
          ],
        },
      ],
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) {
    if (attempt < 2) return videoLlm(env, prompt, videoUrl, attempt + 1);
    throw new Error(`OpenRouter video: ${data.error?.message || res.status}`);
  }
  // Only read the final answer, not the model's "reasoning" items.
  const text = (data.output || [])
    .filter((o) => o.type === "message")
    .flatMap((o) => o.content || [])
    .filter((c) => c.type === "output_text")
    .map((c) => c.text)
    .join("");
  return parseJson(text);
}

function parseJson(text) {
  text = text.replace(/```(?:json)?/g, "").trim();
  try {
    return JSON.parse(text);
  } catch {
    const m = text.match(/\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]);
    throw new Error("Model did not return valid JSON");
  }
}

/* ----------------------------- diagnose ----------------------------- */

async function diagnose(env, { car, symptoms, history = [] }) {
  const system = `You are a master ASE-certified auto technician helping a DIY owner diagnose their car.
Be specific to the exact vehicle (known common failures, TSBs, recalls for that model/engine).
Return ONLY JSON in this shape:
{
  "summary": "1-2 sentence plain-English read of the situation",
  "safety_warning": "string or empty — e.g. don't drive it if brakes/steering/fuel leak",
  "questions": ["up to 4 short questions whose answers would most narrow it down"],
  "problems": [
    {
      "name": "short problem name, e.g. 'Failing alternator'",
      "likelihood": 0-100,
      "why": "why this fits the symptoms on THIS car",
      "how_to_confirm": ["cheap/simple tests to confirm, in order"],
      "difficulty": "Easy | Moderate | Hard | Shop recommended",
      "time": "rough DIY time",
      "parts_cost": "rough parts cost USD",
      "shop_cost": "rough shop cost USD",
      "search_hint": "best short YouTube search phrase for fixing this on this car"
    }
  ]
}
Give 3-6 problems sorted by likelihood (most likely first). Likelihoods should roughly reflect real-world odds.`;

  const messages = [
    { role: "system", content: system },
    { role: "user", content: `Vehicle: ${carString(car)}\nSymptoms: ${symptoms}` },
    ...history.map((h) => ({ role: h.role, content: h.content })),
  ];
  return llm(env, messages);
}

/* ----------------------------- ask ----------------------------- */

async function ask(env, { car, problem, question, context = "" }) {
  const answer = await llm(
    env,
    [
      {
        role: "system",
        content:
          "You are a master auto technician helping a DIY owner. Answer concisely and practically, specific to their exact vehicle. Include torque specs, part numbers, socket sizes, or safety notes when relevant. Use short markdown lists.",
      },
      {
        role: "user",
        content: `Vehicle: ${carString(car)}\n${problem ? `Working on: ${problem}\n` : ""}${context ? `Context: ${context}\n` : ""}\nQuestion: ${question}`,
      },
    ],
    { jsonMode: false, maxTokens: 2000 }
  );
  return { answer };
}

/* ----------------------------- YouTube search ----------------------------- */

async function searchYouTube(env, query, limit = 8) {
  try {
    const vids = await scrapeSearch(query);
    if (vids.length) return vids.slice(0, limit);
  } catch (e) {
    // fall through to API
  }
  if (env.YOUTUBE_API_KEY) return apiSearch(env, query, limit);
  return [];
}

async function scrapeSearch(query) {
  const res = await fetch(
    `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}&hl=en&gl=US`,
    { headers: { "user-agent": UA, "accept-language": "en-US,en;q=0.9" } }
  );
  const html = await res.text();
  const m = html.match(/var ytInitialData = (\{.*?\});<\/script>/s);
  if (!m) return [];
  const data = JSON.parse(m[1]);
  const out = [];
  walk(data, (k, v) => {
    if (k === "videoRenderer" && v?.videoId) {
      out.push({
        id: v.videoId,
        title: v.title?.runs?.map((r) => r.text).join("") || "",
        channel: v.ownerText?.runs?.[0]?.text || "",
        length: v.lengthText?.simpleText || "",
        views: v.viewCountText?.simpleText || "",
        published: v.publishedTimeText?.simpleText || "",
        snippet: v.detailedMetadataSnippets?.[0]?.snippetText?.runs?.map((r) => r.text).join("") || "",
      });
    }
  });
  return out;
}

function walk(obj, fn) {
  if (!obj || typeof obj !== "object") return;
  for (const [k, v] of Object.entries(obj)) {
    fn(k, v);
    walk(v, fn);
  }
}

async function apiSearch(env, query, limit) {
  const s = await fetch(
    `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=${limit}&q=${encodeURIComponent(query)}&key=${env.YOUTUBE_API_KEY}`
  ).then((r) => r.json());
  const ids = (s.items || []).map((i) => i.id.videoId).join(",");
  if (!ids) return [];
  const d = await fetch(
    `https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails,statistics&id=${ids}&key=${env.YOUTUBE_API_KEY}`
  ).then((r) => r.json());
  return (d.items || []).map((v) => ({
    id: v.id,
    title: v.snippet.title,
    channel: v.snippet.channelTitle,
    length: isoDuration(v.contentDetails.duration),
    views: `${Number(v.statistics.viewCount || 0).toLocaleString()} views`,
    published: v.snippet.publishedAt?.slice(0, 10),
    snippet: v.snippet.description?.slice(0, 200) || "",
  }));
}

function isoDuration(d = "") {
  const m = d.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/) || [];
  const [h, mi, s] = [m[1] || 0, m[2] || 0, m[3] || 0].map(Number);
  return h ? `${h}:${String(mi).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${mi}:${String(s).padStart(2, "0")}`;
}

/* ----------------------------- videos (ordered playlist) ----------------------------- */

async function findVideos(env, { car, problem }) {
  const carStr = carString(car);
  const plan = await llm(env, [
    {
      role: "system",
      content: `Create YouTube search queries to help a DIYer fix a car problem from start to finish.
Return JSON: {"queries":[{"stage":"stage name","query":"youtube search"}]}
Use 3-5 stages in the order the owner would need them, e.g.:
"Confirm the diagnosis" (testing), "Parts & tools", "Removal / replacement", "Reassembly & final checks".
Queries must include year, make, model (and engine if relevant). Keep queries short like a real person types.`,
    },
    { role: "user", content: `Vehicle: ${carStr}\nProblem: ${problem.name || problem}\nHint: ${problem.search_hint || ""}` },
  ]);

  const queries = (plan.queries || []).slice(0, 5);
  const results = await Promise.all(queries.map((q) => searchYouTube(env, q.query, 8)));

  const seen = new Set();
  const candidates = [];
  queries.forEach((q, i) => {
    for (const v of results[i]) {
      if (seen.has(v.id)) continue;
      seen.add(v.id);
      candidates.push({ ...v, foundFor: q.stage });
    }
  });
  if (!candidates.length) {
    return { videos: [], note: "YouTube search returned nothing. If this keeps happening, add a YOUTUBE_API_KEY secret." };
  }

  const ranked = await llm(env, [
    {
      role: "system",
      content: `You pick and ORDER the best YouTube videos to walk a DIYer through a repair from start to finish.
Strongly prefer videos for the exact same vehicle generation/engine. Prefer clear, well-viewed how-to videos from real mechanics. Skip shorts, ads, unrelated models, clickbait.
Return JSON: {"playlist":[{"id":"videoId","stage":"stage name","why":"one line on what this video gives them / what to watch for"}]}
Order by the sequence they should be watched (diagnose first, then the fix). 4-8 videos total. Only use ids from the list.`,
    },
    {
      role: "user",
      content: `Vehicle: ${carStr}\nProblem: ${problem.name || problem}\n\nCandidates:\n${candidates
        .map((v) => `- id=${v.id} | ${v.title} | ${v.channel} | ${v.length} | ${v.views} | found for: ${v.foundFor}`)
        .join("\n")}`,
    },
  ]);

  const byId = Object.fromEntries(candidates.map((v) => [v.id, v]));
  const videos = (ranked.playlist || [])
    .filter((p) => byId[p.id])
    .map((p) => ({ ...byId[p.id], stage: p.stage, why: p.why }));
  return { videos };
}

/* ----------------------------- breakdown (timestamped steps) ----------------------------- */

const STEPS_SCHEMA = `Return ONLY JSON:
{
  "overview": "1-2 sentences on what this video covers and whether it matches the user's car",
  "tools": ["tools / socket sizes shown or mentioned"],
  "parts": ["parts / fluids needed"],
  "specs": ["torque specs, fluid capacities, gaps etc. mentioned"],
  "steps": [
    {
      "t": seconds_into_video_as_integer,
      "title": "short step title",
      "detail": "what to do",
      "look_at": "exactly what is on screen at t: which bolt/clip/connector, its size, where it is relative to other parts",
      "box": [ymin, xmin, ymax, xmax] of that bolt/part in the frame at t, each 0-1000, or null if not clearly visible,
      "warning": "optional gotcha or empty"
    }
  ]
}
Think like someone pausing the video to take a screenshot of each important moment: every bolt location, connector, clip, part orientation, and before/after view.
Make 8-25 steps in order. Pick t where the key part is clearly in frame (hands not covering it), not when the narrator just talks.`;

async function breakdown(env, { videoId, car, problem, length = "", deep = true }) {
  if (!/^[\w-]{11}$/.test(videoId || "")) throw new Error("Bad video id");
  const meta = await videoMeta(videoId);
  const context = `Vehicle: ${carString(car)}\nRepair: ${problem?.name || problem || ""}`;

  let result;
  let source;

  // 1) Best: let a video-capable model actually watch the video.
  if (deep) {
    try {
      result = await videoLlm(
        env,
        `You are a master mechanic turning a repair video into a step-by-step guide.\n${STEPS_SCHEMA}\n\n${context}\nWatch this video and break it into steps with accurate timestamps.`,
        `https://www.youtube.com/watch?v=${videoId}`
      );
      source = "watched the video";
    } catch (e) {
      source = `video model failed (${e.message}); used text`;
    }
  }

  // 2) Fallback: description/chapters only.
  if (!result) {
    result = await llm(
      env,
      [
        { role: "system", content: `You are a master mechanic turning a repair video into a step-by-step guide.\n${STEPS_SCHEMA}\nYou cannot see the video: estimate from chapters/description and the video length, set every box to null, and say timestamps are estimates in overview.` },
        {
          role: "user",
          content: `${context}\nVideo title: ${meta.title}\nLength: ${length || meta.lengthSeconds || "?"}\nChapters:\n${meta.chapters.join("\n") || "(none)"}\nDescription:\n${meta.description}`,
        },
      ],
      { maxTokens: 6000 }
    );
    source = source || "used description only (estimates)";
  }

  return { ...result, source, meta };
}

async function videoMeta(videoId) {
  const meta = { title: "", description: "", chapters: [], lengthSeconds: 0 };
  try {
    const html = await fetch(`https://www.youtube.com/watch?v=${videoId}&hl=en`, {
      headers: { "user-agent": UA, "accept-language": "en-US,en;q=0.9" },
    }).then((r) => r.text());
    const m = html.match(/var ytInitialData = (\{.*?\});<\/script>/s);
    if (m) {
      walk(JSON.parse(m[1]), (k, v) => {
        if (k === "videoPrimaryInfoRenderer" && !meta.title) meta.title = v.title?.runs?.map((r) => r.text).join("") || "";
        if (k === "videoSecondaryInfoRenderer" && !meta.description) meta.description = v.attributedDescription?.content || "";
        if (k === "chapterRenderer") meta.chapters.push(`${Math.floor(v.timeRangeStartMillis / 1000)}s: ${v.title?.simpleText}`);
        if (k === "macroMarkersListItemRenderer" && v.timeDescription?.simpleText)
          meta.chapters.push(`${v.timeDescription.simpleText}: ${v.title?.simpleText || ""}`);
      });
    }
    meta.description = meta.description.slice(0, 5000);
    meta.chapters = [...new Set(meta.chapters)].slice(0, 60);
    meta.lengthSeconds = Number((html.match(/"lengthSeconds":"(\d+)"/) || [])[1] || 0);
  } catch {}
  return meta;
}
