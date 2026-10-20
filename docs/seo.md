# Search and AI visibility

How MaskLab is made findable by search engines and AI assistants, what only the owner can do about it, and the rules an agent must follow when changing anything here. For the codebase rules, see [AGENTS.md](../AGENTS.md); for the rest of the build, [architecture.md](architecture.md).

The goal is for MaskLab to appear right after zucity.org when someone searches for ZuCity. **Code alone cannot make that happen.** The code below makes the page easy to find, read and describe correctly. Where it ranks next to zucity.org depends mostly on ZuCity itself linking to it, which is in the owner's hands (see [Off-site actions](#off-site-actions-owner-only)).

---

## What ships, and where

Everything uses the current host, `https://zucity-aesthetics.vercel.app/`.

| What | Where | Notes |
|---|---|---|
| Title | `<title>` in `index.html` | "MaskLab by ZuCity — free texture flag & yin-yang maker", 54 characters |
| Description | `<meta name="description">` in `index.html` | 159 characters. The same text is reused in `og:description`, `twitter:description` and the WebApplication JSON-LD |
| Canonical URL | `<link rel="canonical">` in `index.html` | The root URL |
| Open Graph | `og:*` tags in `index.html` | `og:type` website, site name, title, description, URL, image (1200 × 630, with alt text), locale `en_US` with `ja_JP` alternate |
| Twitter / X card | `twitter:*` tags in `index.html` | `summary_large_image`, `twitter:site` is `@zucity_japan` |
| Social preview image | `public/og.png` | 1200 × 630: a textured yin-yang beside the "MaskLab by ZuCity" wordmark, drawn from the bundled textures and fonts. No script in the repo generates it; it is a static asset. Regenerate it by hand when the brand or wordmark changes, keeping the size and file name |
| Structured data | `<script type="application/ld+json">` in `index.html` | One `@graph` with three nodes, described below |
| Crawlable HTML | Inside `<div id="root">` in `index.html` | Plain HTML describing the app, for crawlers that do not run JavaScript. React replaces it when the app mounts |
| In-app About | `src/components/About.tsx` | What people see: at the foot of the inspector on desktop, in the Export tab on a phone. Must match the crawlable HTML |
| robots.txt | `public/robots.txt` | `Allow: /` for every crawler, with explicit entries for GPTBot, OAI-SearchBot, ChatGPT-User, ClaudeBot, Claude-Web, PerplexityBot, Google-Extended, Applebot-Extended and Bingbot. Names the sitemap |
| Sitemap | `public/sitemap.xml` | One URL, the root, with a hand-written `lastmod` (currently `2026-10-20`) and `changefreq` weekly. Update `lastmod` when the page content changes |
| IndexNow key | `public/3e7a11ffb764d796ce88a0d7894582cf.txt` | The key, as the file's name and its contents. Must stay in `public/` and stay reachable, or IndexNow submissions fail |
| IndexNow ping | `scripts/indexnow.mjs` | Run after every production deploy (below) |
| Cache headers | `vercel.json` | `og.png`, `robots.txt`, `sitemap.xml` and the key file are cached for one day |

### The JSON-LD graph

| Node | `@id` | What it says |
|---|---|---|
| `Organization` | `https://zucity.org/#org` | ZuCity, its URL, a one-line description, and `sameAs` links to its X, Instagram and Substack |
| `WebSite` | `https://zucity-aesthetics.vercel.app/#website` | "MaskLab by ZuCity", published by the ZuCity organization, in English and Japanese |
| `WebApplication` | `https://zucity-aesthetics.vercel.app/#app` | MaskLab: description, free (`isAccessibleForFree`, a zero-price offer), created and published by ZuCity, part of the WebSite, the og.png as image and screenshot, a feature list and keywords |

Linking the nodes by `@id` is what tells a search engine that MaskLab is published by the same ZuCity that owns zucity.org and those social accounts.

### Crawlable HTML and About must match

AI crawlers such as GPTBot, ClaudeBot and PerplexityBot do not run JavaScript. Without the fallback inside `#root` they would see an empty `<div>`. React's `createRoot(...).render()` in `src/main.tsx` replaces that fallback on mount, so people never see it; they see `About.tsx` instead.

**Hard rule: the `#root` fallback in `index.html` and `src/components/About.tsx` must say the same thing.** What crawlers read must be what people see. Showing crawlers content that users do not get is cloaking, which search engines penalise. Change one, change the other, in the same commit.

Today the two say the same thing, sentence for sentence: the same two paragraphs, the same three-item feature list and the same four links. When you change one, change the other in the same commit.

### IndexNow after every production deploy

```bash
node scripts/indexnow.mjs
```

IndexNow tells Bing, Yandex, Seznam and Naver that the page changed. Bing's index feeds ChatGPT search, so this is the fastest route into AI answers. The script first fetches the key file from the live site and exits with an error ("Deploy first.") if it is missing or wrong, then submits the root URL to `api.indexnow.org`. HTTP 200 or 202 means accepted. It needs Node 18 or later for the built-in `fetch`.

---

## Off-site actions (owner only)

These cannot be done from the code. They are ranked by how much they help MaskLab appear right after zucity.org.

| Rank | Action | Who | Why it matters |
|---|---|---|---|
| 1 | **Link to the app from zucity.org** | ZuCity site owner | The strongest signal there is. A link from zucity.org tells search engines MaskLab belongs to ZuCity, which is what puts it next to zucity.org in results |
| 2 | **Serve it at a ZuCity subdomain**, such as `masklab.zucity.org` | ZuCity domain owner adds a CNAME to Vercel; then the app owner adds the domain in Vercel | A subdomain of zucity.org is read as part of ZuCity. After the move, update the files listed below and permanently redirect (301) the old `zucity-aesthetics.vercel.app` host to the new one |
| 3 | **Verify the site in Google Search Console and Bing Webmaster Tools**, and submit `sitemap.xml` in both | App owner | Confirms ownership, gets the page indexed sooner, and shows which searches find it |
| 4 | **Post on X, Instagram and Substack** with a link to the app | ZuCity | Links and mentions from ZuCity's own accounts. Substack matters most for AI answers: its posts are public, crawlable text that assistants cite |
| 5 | **Mention MaskLab on a ZuCity page**, such as a projects or tools page | ZuCity site owner | A second link from the ZuCity site, with text that says what the tool is |

### Files to update after a domain move

Every one of these names the old host. Change them all in one commit, then deploy, then run IndexNow.

| File | What to change |
|---|---|
| `index.html` | `<link rel="canonical">`, `og:url`, `og:image`, `twitter:image` |
| `index.html` (JSON-LD) | The WebSite `@id` and `url`; the WebApplication `@id`, `url`, `isPartOf`, `image` and `screenshot` |
| `public/sitemap.xml` | `<loc>`, and bump `<lastmod>` |
| `public/robots.txt` | The `Sitemap:` line |
| `scripts/indexnow.mjs` | `host` (the key file location is built from it) |

Then add the 301 redirect from the old host, and re-submit the sitemap in Search Console and Bing Webmaster Tools under the new domain.

---

## Rules for agents

- **When changing copy about MaskLab, update the `#root` fallback in `index.html` and `src/components/About.tsx` together.** They must say the same thing; never show crawlers text that users do not see.
- **Keep the title at 60 characters or fewer** and the description between 150 and 160 characters. Count after decoding entities (`&amp;` is one character). If you change the description, change the copies in `og:description`, `twitter:description` and the WebApplication JSON-LD to match.
- **Never add `llms.txt`.** [AGENTS.md](../AGENTS.md) explains why: nothing consumes it.
- **Do not delete or rename the IndexNow key file** in `public/`. If you change the key, change the file name, its contents and `key` in `scripts/indexnow.mjs` together.
- **Keep `public/og.png` at 1200 × 630** under the same name; `og:image:width` and `og:image:height` say so.
- **A new host means the whole file list above**, not just the canonical tag. A half-moved site points search engines at two hosts.
