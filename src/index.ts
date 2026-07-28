interface Env {
  NEWSLETTERS: R2Bucket;
}

export default {
  async email(message: ForwardableEmailMessage, env: Env): Promise<void> {
    // Buffer the raw MIME message; R2 needs a known length for streamed puts
    // and newsletters are small enough that this is fine.
    const raw = await new Response(message.raw).arrayBuffer();

    const now = new Date().toISOString();
    const day = now.slice(0, 10);
    const time = now.slice(11, 19).replaceAll(":", "");
    const key = `raw/${day}/${time}-${crypto.randomUUID().slice(0, 8)}.eml`;

    await env.NEWSLETTERS.put(key, raw, {
      customMetadata: {
        from: message.from,
        to: message.to,
        subject: message.headers.get("subject") ?? "",
        receivedAt: now,
      },
    });
  },
} satisfies ExportedHandler<Env>;
