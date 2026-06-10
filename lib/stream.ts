// Heartbeat-streaming JSON response: emits a whitespace byte every few
// seconds while `work` runs, then the JSON payload. Keeps long LLM calls
// alive on mobile browsers (Safari aborts fetches that receive no bytes for
// ~60s). Errors are emitted as { "error": message } in the body — the
// response status is always 200 because headers are already sent.

const HEARTBEAT_MS = 8000;

export function heartbeatJson<T extends object>(
  work: () => Promise<T>
): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(" "));
        } catch {
          clearInterval(heartbeat);
        }
      }, HEARTBEAT_MS);

      work()
        .then((result) => {
          controller.enqueue(encoder.encode("\n" + JSON.stringify(result)));
        })
        .catch((err: unknown) => {
          const message =
            err instanceof Error ? err.message : "Request failed.";
          controller.enqueue(
            encoder.encode("\n" + JSON.stringify({ error: message }))
          );
        })
        .finally(() => {
          clearInterval(heartbeat);
          controller.close();
        });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
    },
  });
}
