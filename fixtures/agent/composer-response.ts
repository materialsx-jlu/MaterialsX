import { responseFixtureEvents } from "../../packages/pi-adapter/src/platform-probe-fixtures.js";
/** Transport fixture only. This does not test model intelligence or execute a tool. */
export function composerResponse(round: number, code: string | null) {
  const events: any[] = structuredClone(
    responseFixtureEvents(code ? "tool" : "text").filter((e) => !e.type.startsWith("response.function_call_arguments.")),
  );
  const item = {
    id: `item_${round}`,
    type: "function_call",
    name: "agent_exec",
    call_id: `call_${round}`,
    arguments: JSON.stringify({ input: code }),
  };
  if (code) {
    for (const event of events) {
      if (event.item)
        event.item = event.type.endsWith("added")
          ? { ...item, arguments: "" }
          : item;
      if (event.response) {
        event.response.id = `resp_${round}`;
        event.response.output =
          event.type === "response.completed" ? [item] : [];
      }
    }
    events.splice(
      2,
      0,
      {
        type: "response.function_call_arguments.delta",
        output_index: 0,
        item_id: item.id,
        delta: item.arguments,
      },
      {
        type: "response.function_call_arguments.done",
        output_index: 0,
        item_id: item.id,
        arguments: item.arguments,
      },
    );
  }
  return new Response(
    events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""),
    { headers: { "Content-Type": "text/event-stream" } },
  );
}
