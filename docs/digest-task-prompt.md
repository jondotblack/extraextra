# Daily digest task prompt

The summarization half of this project is a scheduled LLM task — in the
original setup, a [Claude Code scheduled task](https://claude.com/claude-code)
that runs every morning at 7 AM. Any agent that can run shell commands and
read/write files works; so does a plain cron job piping the markdown to an
LLM API.

Adapt the placeholders (`<project-path>`, `<inbox-address>`, `<vault-path>`)
and use this as the task prompt:

---

Produce the daily newsletter digest for `<inbox-address>`.

Context: Newsletters sent to `<inbox-address>` are stored as raw .eml objects
in an R2 bucket by a Cloudflare Email Worker. The project at `<project-path>`
contains the fetch script.

Steps:

1. cd into the project directory and run `npm run fetch` — this pulls exactly
   the last 24 hours of mail from R2 and writes one markdown file per
   newsletter to digest/YYYY-MM-DD/ (frontmatter: from, to, subject, date;
   body: plain text with links preserved inline). Always use the default
   24-hour window; do not widen it.
2. If the script reports no newsletters, stop quietly — do not create an
   empty digest note.
3. Read every file in today's digest/ output folder.
4. Build the digest around STORIES, not newsletters. Identify each distinct
   story/item across all newsletters; when multiple newsletters cover the
   same story, merge them into ONE entry. Each entry is:
   - A bold, skimmable headline in your own words
   - A 1–2 sentence description — just enough to decide whether it's worth
     clicking through
   - Source links on the next line: the article URL(s) taken from the
     newsletter bodies, each labeled with the newsletter that carried it,
     e.g. `Sources: [TLDR](url) · [The Batch](url)`. Multi-source stories
     list every source.
5. Order entries by importance/notability. When there are enough entries,
   group them under a few topical headings (derive topics from the content —
   don't force categories). Minor items get a compact "Quick hits" section of
   one-liners with links.
6. Check each file's `to:` frontmatter. Any newsletter whose `to` is NOT
   `<inbox-address>` arrived via forwarding from an old address — add a
   "⚠️ Still via forwarding" footer section listing each such newsletter's
   name and sender, as a reminder to migrate that subscription. Omit the
   section when there are none.
7. End the note with a small "Received" footer listing every newsletter
   fetched (sender — subject), so it's easy to verify nothing was silently
   dropped.
8. Write the note to `<vault-path>/YYYY-MM-DD Newsletter Digest.md`
   (create the folder if missing). YAML frontmatter: date and
   tags: [newsletter-digest].

Tone: plain and informative, built for skimming headlines. No marketing
copy, no filler.

Success criteria: the note exists, every distinct story across the fetched
newsletters appears exactly once with all its sources linked, forwarded-path
newsletters are called out, and the Received footer accounts for every
fetched newsletter.
