/** Keep the upstream terminal event until M5 verifies its real usage/settlement receipt. */
export function gatePlatformResponse(
  response: Response,
  verify: () => Promise<void>,
): Response {
  if (!response.body) throw Error("平台未返回流式数据");
  const decoder = new TextDecoder(),
    encoder = new TextEncoder();
  let buffer = "",
    terminal = "",toolTerminals="";
  const stream = response.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, c) {
        buffer += decoder.decode(chunk, { stream: true }).replace(/\r/g, "");
        let end: number;
        while ((end = buffer.indexOf("\n\n")) !== -1) {
          const block = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          const data = block
            .split("\n")
            .filter((line) => line.startsWith("data:"))
            .map((line) => line.slice(5).trim())
            .join("\n");
          if (data && data !== "[DONE]") {
            const event = JSON.parse(data);
            if(event.type==="response.function_call_arguments.done"||event.type==="response.output_item.done"){toolTerminals+=block+"\n\n";continue;}
            if (
              [
                "response.completed",
                "response.failed",
                "response.incomplete",
              ].includes(event.type)
            ) {
              terminal = block + "\n\n";
              continue;
            }
          }
          c.enqueue(encoder.encode(block + "\n\n"));
        }
      },
      async flush(c) {
        if (buffer.trim() || !terminal) throw Error("平台响应缺少完整终态");
        await verify();
        c.enqueue(encoder.encode(toolTerminals+terminal));
      },
    }),
  );
  return new Response(stream, {
    status: response.status,
    headers: response.headers,
  });
}
