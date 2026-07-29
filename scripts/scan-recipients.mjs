// List every message in the bucket and show which arrived via forwarding
// (original To: != read@extraextra.email) vs. direct subscription.
import {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import PostalMime from "postal-mime";

const BUCKET = process.env.R2_BUCKET ?? "extraextra-mail";
const INBOX = process.env.INBOX_ADDRESS;
if (!INBOX) {
  console.error("Missing INBOX_ADDRESS — set it in .env (e.g. read@yourdomain.com).");
  process.exit(1);
}
const s3 = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

const keys = [];
let continuationToken;
do {
  const res = await s3.send(
    new ListObjectsV2Command({
      Bucket: BUCKET,
      Prefix: "raw/",
      ContinuationToken: continuationToken,
    })
  );
  keys.push(...(res.Contents ?? []).map((o) => o.Key));
  continuationToken = res.NextContinuationToken;
} while (continuationToken);

for (const key of keys.sort()) {
  const res = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  const email = await PostalMime.parse(await res.Body.transformToByteArray());
  const to = (email.to ?? []).map((a) => a.address).join(", ");
  const headers = Object.fromEntries(
    email.headers.map((h) => [h.key.toLowerCase(), h.value])
  );
  const fwd =
    headers["x-forwarded-to"] || headers["x-forwarded-for"] || headers["delivered-to"] || "";
  const viaForwarding = !to.toLowerCase().includes(INBOX.toLowerCase());
  console.log(
    `${viaForwarding ? "FORWARDED" : "direct   "}  ${email.from?.address ?? "?"}  |  ${
      email.subject ?? ""
    }  |  To: ${to || "?"}${fwd ? `  |  fwd-trace: ${fwd}` : ""}`
  );
}
console.log(`\n${keys.length} message(s) scanned`);
