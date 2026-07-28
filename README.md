# extraextra

A receive-only newsletter inbox that costs $0/month. Cloudflare Email Routing
delivers mail for a custom address to an Email Worker, which stores the raw
message in R2. A daily script pulls the last 24h, converts each newsletter to
clean markdown, and Claude groups and summarizes them into a digest.

```
newsletter → MX (Cloudflare) → Email Worker → R2 (raw/YYYY-MM-DD/*.eml)
                                                │
                              npm run fetch ────┘→ digest/YYYY-MM-DD/*.md → Claude summary
```

Free-tier headroom: Email Routing is free, Workers free plan allows 100k
invocations/day, R2 free tier is 10 GB storage + 1M writes/month. At <5,000
emails/month this rounds to zero.

## Architecture

- **Email Worker** ([src/index.ts](src/index.ts)) — bound to Email Routing.
  Buffers each incoming message and writes the raw MIME to R2 at
  `raw/YYYY-MM-DD/<time>-<id>.eml`, with from/to/subject/receivedAt as object
  metadata. No HTTP surface at all (`workers_dev: false`).
- **R2 bucket** — the mailbox. A lifecycle rule expires `raw/` after 30 days;
  storage manages itself.
- **Routing rules** — one literal address routes to the worker; the catch-all
  drops everything else, so the domain has exactly one live address and no
  spam surface.
- **Fetch script** ([scripts/fetch-digest.mjs](scripts/fetch-digest.mjs)) —
  uses read-only S3 credentials, lists only the date prefixes in the window,
  parses each .eml with postal-mime (HTML→text fallback), and writes one
  markdown file per newsletter with frontmatter.
- **Daily summarizer** — a scheduled Claude task runs the fetch, groups the
  markdown by topic, and delivers a digest (e.g. into an Obsidian vault). The
  repo has no opinion about this half — anything that reads markdown works.

The reason this is so simple: receiving is the easy half of email. All the
hard parts of self-hosting (IP reputation, deliverability, SPF/DKIM alignment)
only apply to *sending* — a receive-only inbox just needs MX records and
something listening, and Cloudflare provides both.

## One-time setup

1. **Domain on Cloudflare.** The domain you'll use must have its DNS on
   Cloudflare (free plan is fine).

2. **Deploy the worker.**

   ```bash
   npm install
   npx wrangler login
   npx wrangler r2 bucket create extraextra-mail
   npm run deploy
   ```

3. **Enable Email Routing.** Dashboard → your domain → *Email* → *Email
   Routing* → enable (it adds the MX + SPF records for you).

4. **Route an address to the worker.** *Email Routing → Routing rules →
   Create address*: e.g. `newsletters@yourdomain.com`, action **Send to
   Worker** → `extraextra`. Set the catch-all to *Drop* (or forward it wherever).

5. **Create read credentials for the digest script.** Dashboard → *R2* →
   *Manage API Tokens* → create a token with **Object Read** scoped to
   `extraextra-mail`. Then:

   ```bash
   cp .env.example .env   # fill in account ID + token credentials
   ```

6. **Subscribe.** Point your newsletters at the new address. Tip: if you want
   a per-category hint (`newsletters+tech@...`), first enable **Subaddressing**
   under *Email Routing → Settings* — without it, plus-addressed mail misses
   the literal rule and falls through to the drop catch-all. The full `to`
   address is preserved in the stored metadata.

## Confirming subscriptions

Double-opt-in confirmation emails land in the bucket like any other mail. To
grab the link without waiting for the next digest:

```bash
npm run fetch -- --since=1
grep -oE 'https?://[^ )>"]+' digest/*/*confirm*.md
```

The confirmation URL is usually the first link (often wrapped in the sender's
click-tracker). If Claude manages your digest, just ask it to "grab the
confirmation link" after subscribing.

## Retention

Raw newsletters don't need to live forever. An R2 lifecycle rule deletes them
automatically after 30 days (run once, after the bucket exists):

```bash
npx wrangler r2 bucket lifecycle add extraextra-mail expire-raw raw/ --expire-days 30
```

At that retention even heavy volume stays far below the 10 GB free tier. Local
`digest/` output is gitignored scratch — delete it whenever.

## Daily digest

```bash
npm run fetch              # last 24h → digest/YYYY-MM-DD/*.md
npm run fetch -- --since=48   # wider window
```

Each file has frontmatter (`from`, `subject`, `date`) plus the newsletter body
as plain text. The intended loop is a scheduled Claude task that runs
`npm run fetch`, reads `digest/<today>/`, groups the newsletters by topic, and
writes/delivers a summary.
