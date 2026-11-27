export const CAPTURE_STREAM_TYPE = "text/event-stream";

export function captureFrame(event: string, data: unknown): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

/** Read JSON events from a capture response. Chunk boundaries can split any UTF-8 character or line. */
export async function* readCaptureFrames(body: ReadableStream<Uint8Array>, signal?: AbortSignal) {
  const reader = body.getReader();
  const cancel = () => { void reader.cancel().catch(() => {}); };
  const decoder = new TextDecoder();
  let pending = "";
  let ended = false;
  try {
    if (signal?.aborted) return;
    signal?.addEventListener("abort", cancel, { once: true });
    while (!ended) {
      const { value, done } = await reader.read();
      ended = done;
      pending += decoder.decode(value, { stream: !done });
      const frames = pending.split(/\r?\n\r?\n/u);
      pending = frames.pop()!;
      if (pending.length > 256 * 1024) throw new Error("Capture event exceeds the response limit");
      for (const frame of frames) {
        if (frame.length > 256 * 1024) throw new Error("Capture event exceeds the response limit");
        let event = "";
        const data: string[] = [];
        for (const line of frame.split(/\r?\n/u)) {
          if (line.startsWith("event:")) event = line.slice(6).trimStart();
          if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
        }
        if (event && data.length) yield { event, data: JSON.parse(data.join("\n")) as unknown };
      }
    }
  } finally {
    signal?.removeEventListener("abort", cancel);
    if (!ended) cancel();
    reader.releaseLock();
  }
}
