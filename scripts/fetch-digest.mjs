// Fetch newsletters received in the last 24h (or --since=<hours>) from R2,
// parse them, and write cleaned markdown files to digest/<date>/ for
// summarization. Run with: npm run fetch
import {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import PostalMime from "postal-mime";
import { convert } from "html-to-text";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const required = ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"];
for (const name of required) {
  if (!process.env[name]) {
    console.error(`Missing ${name} — copy .env.example to .env and fill it in.`);
    process.exit(1);
  }
}

const BUCKET = process.env.R2_BUCKET ?? "extraextra-mail";
const sinceArg = process.argv.find((a) => a.startsWith("--since="));
const sinceHours = sinceArg ? Number(sinceArg.split("=")[1]) : 24;
const cutoff = new Date(Date.now() - sinceHours * 60 * 60 * 1000);

const s3 = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

// Keys are date-prefixed (raw/YYYY-MM-DD/...), so listing the days that the
// cutoff window touches is enough — no full-bucket scan.
const days = new Set();
for (let t = cutoff.getTime(); t <= Date.now(); t += 60 * 60 * 1000) {
  days.add(new Date(t).toISOString().slice(0, 10));
}

const keys = [];
for (const day of days) {
  let continuationToken;
  do {
    const res = await s3.send(
      new ListObjectsV2Command({
        Bucket: BUCKET,
        Prefix: `raw/${day}/`,
        ContinuationToken: continuationToken,
      })
    );
    for (const obj of res.Contents ?? []) {
      if (obj.LastModified >= cutoff) keys.push(obj.Key);
    }
    continuationToken = res.NextContinuationToken;
  } while (continuationToken);
}

if (keys.length === 0) {
  console.log(`No newsletters received in the last ${sinceHours}h.`);
  process.exit(0);
}

const outDir = path.join("digest", new Date().toISOString().slice(0, 10));
await mkdir(outDir, { recursive: true });

const slug = (s) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60) || "untitled";

let n = 0;
for (const key of keys.sort()) {
  const res = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  const raw = await res.Body.transformToByteArray();
  const email = await PostalMime.parse(raw);

  const body =
    email.text?.trim() ||
    convert(email.html ?? "", {
      wordwrap: false,
      selectors: [
        { selector: "img", format: "skip" },
        { selector: "a", options: { ignoreHref: false } },
      ],
    });

  const sender = email.from?.name || email.from?.address || "unknown";
  const subject = email.subject ?? "(no subject)";
  n += 1;
  const file = path.join(
    outDir,
    `${String(n).padStart(3, "0")}-${slug(sender)}-${slug(subject)}.md`
  );

  const frontmatter = [
    "---",
    `from: "${sender.replaceAll('"', "'")} <${email.from?.address ?? ""}>"`,
    `to: "${(email.to ?? []).map((a) => a.address).join(", ")}"`,
    `subject: "${subject.replaceAll('"', "'")}"`,
    `date: "${email.date ?? ""}"`,
    `r2_key: "${key}"`,
    "---",
    "",
  ].join("\n");

  await writeFile(file, frontmatter + body.trim() + "\n");
  console.log(`${file}  (${sender}: ${subject})`);
}

console.log(`\nWrote ${n} newsletter(s) to ${outDir}/`);
