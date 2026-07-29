# extraextra

A receive-only newsletter inbox that costs $0/month. Cloudflare Email Routing
delivers mail for a custom address to an Email Worker, which stores the raw
message in R2. A daily script pulls the last 24h, converts each newsletter to
clean markdown, and an LLM groups and summarizes them into a digest.

Born the day Google locked an account for connecting an AI assistant to Gmail.
Receiving email turns out to be the easy half of the problem — this repo is
the whole solution.

```
newsletter → MX (Cloudflare) → Email Worker → R2 (raw/YYYY-MM-DD/*.eml)
                                                │
                              npm run fetch ────┘→ digest/YYYY-MM-DD/*.md → daily LLM summary
```

Free-tier headroom: Email Routing is free, Workers free plan allows 100k
invocations/day, R2 free tier is 10 GB storage + 1M writes/month. At <5,000
emails/month this rounds to zero. The only real cost is the domain
(~$12/yr for a .email on Cloudflare Registrar — or reuse one you own).

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
- **Daily summarizer** — a scheduled LLM task (the author uses a Claude Code
  scheduled task) runs the fetch, groups the markdown by story, and delivers
  a digest. The prompt is in
  [docs/digest-task-prompt.md](docs/digest-task-prompt.md).

The reason this is so simple: receiving is the easy half of email. All the
hard parts of self-hosting (IP reputation, deliverability, SPF/DKIM alignment)
only apply to *sending* — a receive-only inbox just needs MX records and
something listening, and Cloudflare provides both.

## Quick start

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/jondotblack/extraextra)

The button forks this repo into your GitHub, deploys the worker to your
Cloudflare account, and auto-provisions the R2 bucket from
[wrangler.jsonc](wrangler.jsonc). Prefer the CLI? Clone and run:

```bash
npm install
npx wrangler login
npm run deploy   # creates the bucket on first deploy if it doesn't exist
```

Either way, the email half is per-domain and stays manual — steps below.

## Connect your domain

1. **Domain on Cloudflare.** The domain must have its DNS on Cloudflare
   (free plan is fine). Buying it on Cloudflare Registrar skips the
   nameserver dance entirely.

2. **Enable Email Routing.** Dashboard → your domain → *Email* → *Email
   Routing* → enable. **Gotcha:** if the zone was imported with existing MX
   records (registrar parking, old forwarding), the wizard will refuse with
   "existing non-Cloudflare MX records conflict" and will *not* delete them
   for you — remove the old MX rows and any old SPF TXT in *DNS → Records*
   first, then click *Add missing records*.

3. **Route an address to the worker.** *Email Routing → Routing rules →
   Create address*: e.g. `read@yourdomain.com`, action **Send to Worker** →
   `extraextra`. Set the catch-all rule to **Drop**, so the rest of the
   domain stays dark.

4. **Optional — plus-addressing.** If you want per-category hints
   (`read+tech@...`), enable **Subaddressing** under *Email Routing →
   Settings* — without it, plus-addressed mail misses the literal rule and
   falls through to the drop catch-all. The full `to` address is preserved in
   the stored metadata.

5. **Create read credentials for the digest script.** Dashboard → *R2* →
   *API tokens* (the R2-specific page, not the account-wide one) → create a
   token with **Object Read Only** scoped to the bucket. Then:

   ```bash
   cp .env.example .env   # fill in account ID, token credentials, inbox address
   ```

6. **Set retention.** Raw newsletters don't need to live forever:

   ```bash
   npx wrangler r2 bucket lifecycle add extraextra-mail expire-raw raw/ --expire-days 30
   ```

7. **Subscribe.** Point your newsletters at the new address.

## Confirming subscriptions

Double-opt-in confirmation emails land in the bucket like any other mail. To
grab the link without waiting for the next digest:

```bash
npm run fetch -- --since=1
grep -oE 'https?://[^ )>"]+' digest/*/*confirm*.md
```

The confirmation URL is usually the first link (often wrapped in the sender's
click-tracker). If an agent manages your digest, just ask it to "grab the
confirmation link" after subscribing.

## Daily digest

```bash
npm run fetch                 # last 24h → digest/YYYY-MM-DD/*.md
npm run fetch -- --since=48   # wider window
```

Each file has frontmatter (`from`, `to`, `subject`, `date`) plus the
newsletter body as plain text with links preserved. Wire the prompt in
[docs/digest-task-prompt.md](docs/digest-task-prompt.md) into a scheduled
Claude Code task (or any LLM on a cron) to get a story-centric morning
briefing — overlapping coverage merged, every story linked to its sources.

Migrating from an old address? Forward the old mail here and run
`node --env-file=.env scripts/scan-recipients.mjs` to see which subscriptions
still arrive via the forwarding path; the digest prompt also flags them daily
until the list is empty.

## Odds and ends

- Deleting an object by hand? `wrangler r2 object delete` targets a *local
  simulation* unless you pass `--remote`. It will happily report success
  either way.
- Local `digest/` output is gitignored scratch — delete it whenever.
- The stored `.eml` files are the source of truth; everything downstream can
  be regenerated from them until the 30-day expiry.

## License

[MIT](LICENSE)
