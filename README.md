# Car Repair Helper

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/ZPARXMarketing/repair)

Open source (MIT). Bring your own [OpenRouter](https://openrouter.ai) key. Each person who deploys it runs their own copy on their own free Cloudflare account, with their own data.

Tell it your car and the symptoms. It will:

1. Rank the most likely problems with odds, how to confirm each one, and rough costs.
2. Find YouTube videos for the fix and put them **in the order to watch them**.
3. Turn any video into **timestamped steps** with tools, parts and specs. A Gemini model watches the video.
4. **Take screenshots** for each step. This is desktop only: click "Make step photos" and share this tab when your browser asks.

It runs on Cloudflare Workers.

## Design

The app uses the [Legible design system](https://github.com/ZPARXMarketing/Legible-DesignSystem). Its tokens, component styles and the `<legible-reader>` "Aa" panel are copied into `public/legible/`; the MIT license is included there. To update them, copy `dist/tokens.css`, `dist/legible-reader.js` and `packages/components/bundle.css` from that repo.

Every section folds up (▸). The app remembers which sections are open, and "⇕ Collapse all" folds everything.

## Sync, Library & share links

- **Sync:** your Library, saved photos and step photos sync across devices. You need `APP_PASSWORD` set. Storage is a free Workers KV namespace (`STORE`), which Cloudflare creates automatically on deploy.
- **Library:** save a repair, add notes, and mark it ✅ fixed. Open it again on any device.
- **🔗 Share link:** creates a view-only page of one repair (steps, photos, notes) that anyone with the link can open. No password is needed for that page.

If sync shows "This device only", check that the worker has a **KV namespace binding** named `STORE`. You can find it under Settings → Bindings. If it's missing, create a KV namespace and bind it as `STORE`.

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
- `MODEL`: diagnosis, ordering videos, Q&A (default `deepseek/deepseek-v4.1-flash`, falls back to `FALLBACK_MODEL` = Claude Haiku 5.5 on errors)
- `VIDEO_MODEL`: watches the YouTube videos (default `google/gemini-3.8-flash`)

## Local dev

Copy `.dev.vars.example` to `.dev.vars`, fill it in, then run `npm run dev`.

## Safety note

This is an AI helper, not a mechanic. Diagnoses, torque specs and steps can be wrong. Check critical specs in a service manual, and use jack stands. Get brakes, steering, airbags and fuel-system work checked by a professional if you're unsure.

## Contributing

Issues and pull requests are welcome. The app has no build step. The Worker is `src/index.js` and the frontend is plain HTML/CSS/JS in `public/`. Run it locally with `npm install` and `npm run dev`.

## License

MIT. See [LICENSE](LICENSE). The bundled Legible design system files in `public/legible/` are MIT-licensed too.
