# 🔧 Car Repair Helper

**Tell it your car and what's wrong. It tells you the likely problems, finds the YouTube videos to fix it in the right order, and turns each video into step-by-step photos.**

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/ZPARXMarketing/repaircar)

---

## ⚡ The 30-second version

> **This is not a website you sign up for. It's an app you run yourself, for free, on your own Cloudflare account.**
>
> - **You** set it up (about 5 minutes, no coding).
> - **You** pay the AI costs, about **1–3 cents per repair**, on your own OpenRouter key.
> - **Your** data (repairs, photos, notes) stays in **your** Cloudflare account. Nobody else can see it.
> - Each person who wants it sets up **their own copy**. Copies don't share anything.

---

## 🛠️ What it does

**Start:** save your car(s) once under **My cars**, then tap one. Every job is saved under that car.

Then pick one of two paths:

| 🔧 **Replace a part** (you already know what's broken) | 🩺 **Diagnose a problem** (you don't know yet) |
| --- | --- |
| Type the part, e.g. "alternator" | Describe what it's doing |
| Get YouTube videos for that part on **your** car, **in the order to watch them** | Get the **most likely problems** with odds, how to confirm each, and DIY vs. shop cost |
| Tap **Steps + photos**: an AI watches the video and writes every step with tools, parts and torque specs | Tap **🔧 Fix it** on a problem to jump into Replace-a-part with the part filled in |
| On a computer, **Make step photos** screenshots every step, with the part boxed in orange | If a problem is hard to check by yourself, **🎥 Show me how to check** finds testing videos |

Every job is **auto-saved** to that car's list. Add notes, mark it **✅ fixed**, **⭐ save** key photos, and send a **🔗 share link**. It all syncs to your other devices.

---

## 🚀 Set it up (5 minutes, no terminal)

You need two free accounts: **[Cloudflare](https://dash.cloudflare.com/sign-up)** and **[OpenRouter](https://openrouter.ai)**.

**1. Get an AI key**
- In OpenRouter, go to **Keys → Create Key** and copy it.
- Add about $5 of credit. That covers hundreds of repairs.

**2. Deploy it**
- Click the **Deploy to Cloudflare** button at the top of this page and follow the prompts.
- *Or:* in Cloudflare go to **Workers & Pages → Create → Import a repository** and pick this repo.

**3. Add your key and a password**
- In Cloudflare, open your new worker and go to **Settings → Variables and Secrets → Add**.
- Add both of these. **Set the Type to "Secret", not "Text"**, or they get wiped on the next update.

| Name | Value | Required? |
| --- | --- | --- |
| `OPENROUTER_API_KEY` | the key from step 1 | ✅ **Yes**, nothing works without it |
| `APP_PASSWORD` | any password you make up | ✅ **Yes**, it locks your site and turns on sync and the Library |
| `YOUTUBE_API_KEY` | a YouTube Data API key | Optional, only if video search ever stops working |

**4. Open it**
- Go to the `https://car-repair-helper.<your-name>.workers.dev` link shown on the worker page.
- Enter your password once on each device.

✅ **You know it worked when** the Library section, which appears after you save your first repair, says **"☁️ Synced"** in its corner.

---

## 🔒 Who can see what? Who pays?

| | Who can see it / use it | Who pays |
| --- | --- | --- |
| **This GitHub repo** (the code) | Everyone. It's open source. | Free |
| **Your website** (`…workers.dev`) | Only people **you give the password to** | **You**, via your OpenRouter key |
| **Your repairs, photos, notes** | Only you, plus anyone you give the password to | Free (Cloudflare free tier) |
| **A 🔗 Share link** for one repair | **Anyone with that link**, view-only, no password | Free, no AI is used |

### Sharing: what's safe?

| You want to… | Do this | Safe? |
| --- | --- | --- |
| Show a friend how you fixed something | Open the repair in your **📚 Library → 🔗 Share link** and send that link | ✅ Yes. They see only that repair and can't change anything. |
| Let a friend use the app for their car | Send them **this GitHub page** so they click **Deploy** and get their own copy | ✅ Yes. Their copy, their key, their data. |
| Give someone your site **and** password | Only for people you fully trust, like family | ⚠️ They spend **your** AI credit and can see and edit **your** Library |
| Post your site link publicly | Fine **if** `APP_PASSWORD` is set | ⚠️ Without a password, anyone can spend your credit |

---

## 💸 What it costs

| Action | Roughly |
| --- | --- |
| Diagnose symptoms | < 1¢ |
| Find and order videos | < 1¢ |
| AI watches one video and writes the steps | ~2¢ |
| Step photos, Library, sync, share links | Free |
| Cloudflare hosting | Free for personal use |

---

## ❓ Common problems

| You see | Fix |
| --- | --- |
| "OPENROUTER_API_KEY is not set" | Step 3: add the key as a **Secret**, then redeploy |
| Your key/password disappeared after an update | You added it as **Text**. Add it again as **Secret**. |
| Library says **"This device only"** | `APP_PASSWORD` is missing, **or** the worker has no **KV binding** named `STORE`. Check under **Settings → Bindings**, then add a KV namespace named `STORE`. |
| No **"Make step photos"** button | You're on a phone. Screenshots need a computer browser (Chrome or Edge works best). On a phone, tap any step to play that moment. |
| Black or blank step photos | Click **📸 Redo photos** and keep the tab open and on screen while it runs |
| "No videos found" | Try again. If it keeps happening, add a `YOUTUBE_API_KEY`. |

---

## ⚠️ Safety

This is an AI helper, **not a mechanic**. It can be wrong about diagnoses, torque specs and steps.
- Check critical specs in a service manual.
- Always use jack stands.
- Get **brakes, steering, airbags and fuel** work checked by a pro if you're unsure.

---

## For developers

- **Stack:** one Cloudflare Worker (`src/index.js`) plus plain HTML/CSS/JS in `public/`. There's no build step.
- **AI:** OpenRouter. `MODEL` (default `deepseek/deepseek-v4.1-flash`, falls back to `FALLBACK_MODEL` = Claude Haiku 5.5) handles diagnosis, video ordering and Q&A. `VIDEO_MODEL` (default `google/gemini-3.8-flash`) watches the YouTube videos. Change both in `wrangler.toml`.
- **Storage:** Workers KV (`STORE`, created automatically on deploy) for sync and share links. IndexedDB in the browser keeps a local copy of photos.
- **Design:** the [Legible design system](https://github.com/ZPARXMarketing/Legible-DesignSystem) is copied into `public/legible/`. That includes its tokens, component CSS and the **Aa** reader panel (themes, text size, contrast).
- **Run locally:** copy `.dev.vars.example` to `.dev.vars`, fill it in, then run `npm install` and `npm run dev`.
- **Deploy from a terminal:**

```bash
npm install
npx wrangler secret put OPENROUTER_API_KEY
npx wrangler secret put APP_PASSWORD
npx wrangler deploy
```

Issues and pull requests are welcome.

## License

MIT. See [LICENSE](LICENSE). The bundled Legible files in `public/legible/` are MIT-licensed too.
