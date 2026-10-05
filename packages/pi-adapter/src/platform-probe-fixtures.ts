export function responseFixtureEvents(kind: "tool" | "text") {
  const usage = {
    input_tokens: 10,
    input_tokens_details: { cached_tokens: 2 },
    output_tokens: 4,
    output_tokens_details: { reasoning_tokens: 1 },
    total_tokens: 14,
  };
  const item =
    kind === "tool"
      ? {
          id: "fc_fixture",
          type: "function_call",
          call_id: "call_fixture",
          name: "read_probe_material",
          arguments: '{"symbol":"Si"}',
          status: "completed",
        }
      : {
          id: "msg_fixture",
          type: "message",
          role: "assistant",
          status: "completed",
          content: [
            {
              type: "output_text",
              text: "硅的原子序数是 14。",
              annotations: [],
            },
          ],
        };
  const response = {
    id: `resp_${kind}`,
    model: "gpt-5.6",
    status: "completed",
    output: [item],
    usage,
  };
  return [
    {
      type: "response.created",
      response: { ...response, status: "in_progress", output: [], usage: null },
    },
    {
      type: "response.output_item.added",
      output_index: 0,
      item: {
        ...item,
        status: "in_progress",
        ...(kind === "tool" ? { arguments: "" } : { content: [] }),
      },
    },
    ...(kind === "tool"
      ? [
          {
            type: "response.function_call_arguments.delta",
            output_index: 0,
            delta: '{"symbol":',
          },
          {
            type: "response.function_call_arguments.delta",
            output_index: 0,
            delta: '"Si"}',
          },
          {
            type: "response.function_call_arguments.done",
            output_index: 0,
            arguments: '{"symbol":"Si"}',
          },
        ]
      : [
          {
            type: "response.output_text.delta",
            output_index: 0,
            content_index: 0,
            delta: "硅的原子序数是 ",
          },
          {
            type: "response.output_text.delta",
            output_index: 0,
            content_index: 0,
            delta: "14。",
          },
        ]),
    { type: "response.output_item.done", output_index: 0, item },
    { type: "response.completed", response },
  ];
}
