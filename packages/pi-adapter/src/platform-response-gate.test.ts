import { test } from "node:test";
import assert from "node:assert/strict";
import { gatePlatformResponse } from "./platform-response-gate.js";
test("terminal event waits for authoritative M5 receipt; earlier deltas still stream", async () => {
  let verified = false;
  const body =
    'data: {"type":"response.output_text.delta","delta":"Si"}\n\ndata: {"type":"response.completed"}\n\n';
  const response = gatePlatformResponse(new Response(body), async () => {
    verified = true;
  });
  const reader = response.body!.getReader();
  const first = await reader.read();
  assert(!verified);
  assert.match(new TextDecoder().decode(first.value), /delta/);
  const terminal = await reader.read();
  assert(verified);
  assert.match(new TextDecoder().decode(terminal.value), /response.completed/);
  await reader.read();
});
test("unconfirmed receipt or missing terminal never releases completion", async () => {
  await assert.rejects(
    gatePlatformResponse(
      new Response('data: {"type":"response.completed"}\n\n'),
      async () => {
        throw Error("usage_pending");
      },
    ).text(),
  );
  await assert.rejects(
    gatePlatformResponse(
      new Response(
        'data: {"type":"response.output_text.delta","delta":"x"}\n\n',
      ),
      async () => {},
    ).text(),
  );
});

test('tool commit events are held with the terminal until actual paid receipts are verified',async()=>{
 let checked=false;
 const body='data: {"type":"response.output_item.added","item":{"id":"fc","type":"function_call"}}\n\ndata: {"type":"response.function_call_arguments.delta","delta":"{}"}\n\ndata: {"type":"response.function_call_arguments.done","arguments":"{}"}\n\ndata: {"type":"response.output_item.done","item":{"id":"fc","type":"function_call"}}\n\ndata: {"type":"response.completed"}\n\n';
 const response=gatePlatformResponse(new Response(body),async()=>{checked=true;});const reader=response.body!.getReader();
 for(let i=0;i<2;i++){const r=await reader.read();assert(!checked);assert.doesNotMatch(new TextDecoder().decode(r.value),/arguments.done|output_item.done|response.completed/);}
 const committed=await reader.read();assert(checked);assert.match(new TextDecoder().decode(committed.value),/arguments.done/);assert.match(new TextDecoder().decode(committed.value),/output_item.done/);assert.match(new TextDecoder().decode(committed.value),/response.completed/);
});
