# Car Repair Helper

Tell it your car and the symptoms. It will:

1. Rank the most likely problems with odds, how to confirm each one, and rough costs.
2. Find YouTube videos for the fix and put them **in the order to watch them**.
3. Turn any video into **timestamped steps** with tools, parts and specs. A Gemini model watches the video.
4. **Take screenshots** for each step. This is desktop only: click "Auto-capture" and choose this tab when your browser asks.

It runs on Cloudflare Workers.

## Deploy (Cloudflare dashboard, no terminal)

1. Go to Cloudflare → **Workers & Pages** → **Create** → **Import a repository** → choose this repo and deploy.
2. Open the worker → **Settings → Variables and Secrets** → add:
   - `OPENROUTER_API_KEY` (secret, required)
   - `APP_PASSWORD` (secret, recommended so other people can't spend your credits)
   - `YOUTUBE_API_KEY` (optional backup if YouTube search ever gets blocked)
3. Open the `*.workers.dev` URL.

## Deploy (terminal)

```bash
npm install
npx wrangler secret put OPENROUTER_API_KEY
npx wrangler secret put APP_PASSWORD
npx wrangler deploy
```

## Models

You can change these in `wrangler.toml`:
- `MODEL`: diagnosis, ordering videos, Q&A (default `anthropic/claude-haiku-5.5`)
- `VIDEO_MODEL`: watches the YouTube videos (default `google/gemini-3.8-flash`)

## Local dev

Copy `.dev.vars.example` to `.dev.vars`, fill it in, then run `npm run dev`.
