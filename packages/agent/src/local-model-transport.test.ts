import { test } from "node:test";
import assert from 'node:assert/strict';
import {AgentError} from '../../contracts/src/agent.js';
import { modelConnectionSchema } from "../../contracts/src/engine-selection.js";
import { localModelConnection, localResponsesInvoker, probeLocalCodex, profileFor,defaultLocalProtocol } from "./local-model-transport.js";
import { localCodexRequest } from "./codex-local-protocol.js";
import { codexResponse } from "./codex-protocol.js";

const connection = modelConnectionSchema.parse({ id: "model-" + "a".repeat(32), source: "local", endpoint: "http://127.0.0.1:1234/v1", modelId: "test-model", protocol: "responses", contextWindow: 32768, maxOutputTokens: 4096, revision: "test-version" });
const sse = (events: unknown[], fragmented = false) => {
  const data = Buffer.from(events.map((e) => `data: ${JSON.stringify(e)}\r\n\r\n`).join(""));
  return new Response(new ReadableStream({ start(c) {
    for (let i = 0; i < data.length; i += fragmented ? 7 : data.length) c.enqueue(data.subarray(i, i + (fragmented ? 7 : data.length)));
    c.close();
  } }), { headers: { "Content-Type": "text/event-stream" } });
};
const completed = (output: unknown[], model = "test-model") => ({ type: "response.completed", response: { model, status: "completed", output, usage: null } });
const message = { id: "message", type: "message", role: "assistant", content: [{ type: "output_text", text: "硅 Si" }] };
const payload = { input: [{ type: "message", role: "user", content: "Si" }], tools: [], max_output_tokens: 500 };
test('fresh gpt-oss-20b tasks choose the qualified chat route before freezing, other native models retain Responses',()=>{
  assert.equal(defaultLocalProtocol('pi','any-model'),'chat-completions');
  assert.equal(defaultLocalProtocol('codex','openai/gpt-oss-20b'),'chat-completions');
  assert.equal(defaultLocalProtocol('codex','other-native-model'),'responses');
});

test("local route keeps real model identity, no auth/redirect/cloud and preserves UTF-8 streaming", async () => {
  let called = 0;
  const request: typeof fetch = async (url, init) => {
    called++;
    assert.equal(url, connection.endpoint + "/responses");
    assert.equal(init?.redirect, "error");
    assert(!new Headers(init?.headers).has("authorization"));
    const body = JSON.parse(String(init?.body));
    assert.equal(body.frequency_penalty,0);assert.equal(body.presence_penalty,0);assert.equal(body.top_p,1);assert.equal(body.parallel_tool_calls,false);
    assert.equal(body.model, "test-model"); assert.equal(body.store, false); assert.equal(body.truncation, "disabled");
    return sse([{ type: "response.output_item.done", item: message }, completed([message])], true);
  };
  const response = await localResponsesInvoker(connection, request)(payload, new AbortController().signal);
  assert.match(await response.text(), /硅 Si/); assert.equal(called, 1);
});
test('local native transport retains actual messages and paired receipts without replaying private reasoning',async()=>{
  const input=[{type:'message',role:'user',content:'original question'},
    {type:'function_call',name:'actual_tool',call_id:'actual-call',arguments:'{}'},
    {type:'function_call_output',call_id:'actual-call',output:'actual-report.json'},
    {type:'reasoning',id:'private-item',summary:[{type:'summary_text',text:'private nonportable reasoning'}],encrypted_content:'opaque'}];
  const response=await localResponsesInvoker(connection,async(_url,init)=>{
    const body=JSON.parse(String(init?.body));assert.deepEqual(body.input,input.slice(0,3));
    return sse([{type:'response.output_item.done',item:message},completed([message])]);
  })({input,tools:[{type:'function',name:'actual_tool',parameters:{type:'object',properties:{}}}],max_output_tokens:500},new AbortController().signal);
  assert.match(await response.text(),/硅 Si/);
});
test('static tool mapping precedes history; verified tool receipts and current host state keep their conversational order',async()=>{
  const history=[{type:'message',role:'user',content:'Read and export the actual paper'},
    {type:'function_call',name:'agent_exec',call_id:'owned-call',arguments:'{"input":"probe"}'},
    {type:'function_call_output',call_id:'owned-call',output:'actual-page-and-file-receipt'},
    {type:'message',role:'developer',content:'Authoritative current host state: export remains required'}];
  const response=await localResponsesInvoker(connection,async(_url,init)=>{
    const body=JSON.parse(String(init?.body));assert.deepEqual(body.input.slice(1),history);
    assert.match(body.input[0].content,/Local transport mapping/);assert.equal(body.input.at(-1).content,history.at(-1)!.content);
    return sse([{type:'response.output_item.done',item:message},completed([message])]);
  })({input:history,tools:[{type:'function',name:'agent_exec',parameters:{type:'object',properties:{input:{type:'string'}}}}],max_output_tokens:500},new AbortController().signal);
  await response.text();
});
test('gpt-oss chat keeps developer state after actual receipts; other local templates retain system compatibility',async()=>{
 for(const modelId of ['openai/gpt-oss-20b','other-model']){
  const c={...connection,modelId,protocol:'chat-completions' as const};
  const input=[{type:'message',role:'developer',content:'native instructions'}, {type:'message',role:'user',content:'actual request'},
   {type:'function_call',name:'read',call_id:'owned',arguments:'{}'}, {type:'function_call_output',call_id:'owned',output:'actual evidence'},
   {type:'message',role:'developer',content:'current grant and required files'}];
  const r=await localResponsesInvoker(c,async(_url,init)=>{
   const b=JSON.parse(String(init?.body)),role=modelId.includes('gpt-oss')?'developer':'system';
   assert.equal(b.messages[0].role,role);assert.equal(b.messages.at(-1).role,role);
   assert.equal(b.messages.at(-1).content,input.at(-1)!.content);assert.equal(b.messages[3].content,'actual evidence');
   assert.equal(b.messages[2].tool_calls[0].id,'owned');assert.equal(b.messages[2].tool_calls[0].function.arguments,'{}');
   return new Response('data: '+JSON.stringify({model:modelId,choices:[{index:0,delta:{role:'assistant',content:'verified'},finish_reason:null}]})+'\n\ndata: '+
    JSON.stringify({model:modelId,choices:[{index:0,delta:{},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n',{headers:{'Content-Type':'text/event-stream'}});
  })({input,tools:[{type:'function',name:'read',parameters:{type:'object'}}],max_output_tokens:500},new AbortController().signal);
  assert.match(await r.text(),/verified/);
 }
});
test("local connection rejects remote endpoints/credentials, absent or unloaded models and records actual window", async () => {
  await assert.rejects(localModelConnection("https://example.org/v1", "test-model"));
  await assert.rejects(localModelConnection("http://user:secret@localhost/v1", "test-model"));
  let loaded = true;
  const request: typeof fetch = async (url, init) => {
    assert.equal(init?.redirect, "error");
    return Response.json(String(url).includes("/api/") ? { models: [{ key: "test-model", max_context_length: 131072, loaded_instances: loaded ? [{ id: "test-model", config: { context_length: 16384 } }] : [] }] } : { data: [{ id: "test-model" }] });
  };
  const first = await localModelConnection(connection.endpoint!, "test-model", request);
  assert.equal(first.contextWindow, 16384);
  const pi = await localModelConnection(connection.endpoint!, "test-model", request, "chat-completions");
  assert.notEqual(pi.id, first.id);
  loaded = false;
  await assert.rejects(localModelConnection(connection.endpoint!, "test-model", request), /未加载/);
  await assert.rejects(localModelConnection(connection.endpoint!, "missing", request));
});
test("context overflow fails before dispatch; unknown usage stays unknown", async () => {
  let requests = 0, usage: unknown = "unset";
  const invoke = localResponsesInvoker(connection, async () => { requests++; return sse([{ type: "response.output_item.done", item: message }, completed([message])]); }, (v) => { usage = v; });
  await assert.rejects(invoke({ ...payload, input: [{ type: "message", role: "user", content: "a".repeat(40000) }] }, new AbortController().signal), /上下文/);
  assert.equal(requests, 0);
  await (await invoke(payload, new AbortController().signal)).text();
  assert.equal(usage, null);
});
test("empty, interrupted, truncated, foreign-model and unapproved-tool responses fail closed", async () => {
  const invalid = [
    [completed([])],
    [{ type: "response.output_item.done", item: message }],
    [{ type: "response.incomplete" }],
    [{ type: "response.output_item.done", item: message }, completed([message], "other-model")],
    [{ type: "response.output_item.done", item: { type: "function_call", name: "delete_all", call_id: "call", arguments: "{}" } }, completed([])],
    [{ type: "response.output_item.done", item: { ...message, content: [{ type: "output_text", text: "<|channel|>commentary to=functions?" }] } }, completed([message])],
  ];
  for (const events of invalid) {
    const response = await localResponsesInvoker(connection, async () => sse(events))(payload, new AbortController().signal);
    await assert.rejects(response.text());
  }
});
test("malformed JSON tool arguments and forbidden tools during interpretation are rejected", async () => {
  for (const argumentsText of ["{", "[]"]) {
    const item = { id: "item", type: "function_call", name: "exec_command", call_id: "call", arguments: argumentsText };
    const r = await localResponsesInvoker(connection, async () => sse([{ type: "response.output_item.done", item }, completed([item])]))({ ...payload, tools: [{ type: "function", name: "exec_command" }] }, new AbortController().signal);
    await assert.rejects(r.text());
  }
  const item = { id: "item", type: "function_call", name: "exec_command", call_id: "call", arguments: "{}" };
  const r = await localResponsesInvoker(connection, async () => sse([{ type: "response.output_item.done", item }, completed([item])]))({ ...payload, tool_choice: "none", tools: [{ type: "function", name: "exec_command" }] }, new AbortController().signal);
  await assert.rejects(r.text());
});
test("cancellation aborts the same upstream request and never falls back to another endpoint", async () => {
  const controller = new AbortController(); let requests = 0;
  const invoke = localResponsesInvoker(connection, async (_url, options) => {
    requests++; return new Promise((_resolve, reject) => options!.signal!.addEventListener("abort", () => reject(options!.signal!.reason), { once: true }));
  });
  const response = invoke(payload, controller.signal);
  const checked = assert.rejects(response); controller.abort(); await checked;
  assert.equal(requests, 1);
});
test("native functions, patch grammar and MCP namespaces round-trip without executing tools", async () => {
  const converted = localCodexRequest({ tools: [
    { type: "function", name: "exec_command", parameters: { type: "object" } },
    { type: "custom", name: "apply_patch", description: "Patch" },
    { type: "namespace", name: "mcp__materialsx", tools: [{ type: "function", name: "materials_science", parameters: { type: "object" } }] },
  ], input: [{ type: "function_call", name: "materials_science", namespace: "mcp__materialsx", call_id: "prev", arguments: "{}" }, { type: "custom_tool_call", name: "apply_patch", call_id: "patch", input: "patch-text" }] }, 1000, true);
  assert.equal(converted.payload.tools![2]!.name, "materials_science");
  assert.equal(converted.payload.input[0].name, "materials_science");
  const items = [
    { id: "exec", type: "function_call", name: "exec_command", call_id: "c1", arguments: '{"cmd":"pwd"}' },
    { id: "mcp", type: "function_call", name: "materials_science", call_id: "c2", arguments: '{"action":"inspect"}' },
    { id: "patch", type: "function_call", name: "apply_patch", call_id: "c3", arguments: '{"input":"patch-text"}' },
  ];
  const events = items.flatMap((item, output_index) => [
    { type: "response.output_item.added", output_index, item: { ...item, arguments: "" } },
    { type: "response.function_call_arguments.delta", output_index, item_id: item.id, delta: item.arguments },
    { type: "response.function_call_arguments.done", output_index, item_id: item.id, arguments: item.arguments },
    { type: "response.output_item.done", output_index, item },
  ]);
  const text = await codexResponse(sse([...events, completed(items)], true), true, converted.customCalls).text();
  const out = text.split("\n\n").filter(Boolean).map((b) => JSON.parse(b.slice(6)));
  const terminal = out.find((e) => e.type === "response.completed").response.output;
  assert.equal(terminal[0].arguments, '{"cmd":"pwd"}');
  assert.equal(terminal[1].namespace, "mcp__materialsx"); assert.equal(terminal[1].name, "materials_science");
  assert.equal(terminal[2].type, "custom_tool_call"); assert.equal(terminal[2].input, "patch-text");
  assert(out.some((e) => e.type === "response.function_call_arguments.delta" && e.item_id === "exec"));
});
test("capability identity changes with engine/version/protocol, and HTTP failure is not success", async () => {
  assert.notEqual(profileFor(connection, "pi", "unverified", { zh: "", en: "" }).id, profileFor(connection, "codex", "unverified", { zh: "", en: "" }).id);
  await assert.rejects(localResponsesInvoker(connection, async () => new Response("", { status: 404 }))(payload, new AbortController().signal), /404/);
  await assert.rejects(localResponsesInvoker(connection, async () => Response.json({ output: [] }))(payload, new AbortController().signal), /SSE/);
  const profile = await probeLocalCodex(connection, async () => new Response("", { status: 404 }));
  assert.equal(profile.status, "unsupported"); assert(!profile.checks.length);
});
test('protocol qualification accepts named SSE events, comments and CRLF instead of misclassifying a working service',async()=>{
  let count=0;
  const request:typeof fetch=async(_url,init)=>{
    count++;const body=JSON.parse(String(init?.body));
    const item=count===1?{id:'actual-item',type:'function_call',name:'agent_exec',call_id:'actual-call',arguments:'{"input":"probe"}'}:
      {...message,content:[{type:'output_text',text:body.input.find((i:any)=>i.type==='function_call_output')?.output}]};
    return new Response(': heartbeat\r\n\r\n'+[...count===1?[]:[{type:'response.output_item.done',item}],completed([item])].map(e=>`event: ${e.type}\r\ndata: ${JSON.stringify(e)}\r\n\r\n`).join(''),{headers:{'Content-Type':'text/event-stream'}});
  };
  const profile=await probeLocalCodex(connection,request,'pi');assert.equal(profile.status,'limited');assert.equal(count,2);
});

test("separate native base instructions survive protocol conversion and consume input budget", () => {
  const request = localCodexRequest({ instructions: "Preserve native execution instructions", tools: [], input: [{ type: "message", role: "user", content: "Si" }] }, 1024, false);
  assert.equal(request.payload.input[0].role, "developer");
  assert.equal(request.payload.input[0].content, "Preserve native execution instructions");
  assert.equal(request.payload.input[1].role, "user");
  assert.throws(() => localCodexRequest({ instructions: {}, tools: [], input: [] }, 1024, false), /指令格式/);
});

test("native MCP text arrays become plain tool output without dropping evidence; images fail explicitly", () => {
  const convert = (output: unknown) => localCodexRequest({ input: [{ type: "function_call_output", call_id: "actual-call", output }], tools: [] }, 1024, true);
  assert.equal(convert([{ type: "input_text", text: "actual-evidence" }, { type: "input_text", text: "actual-status" }]).payload.input[0].output, "actual-evidence\nactual-status");
  assert.throws(() => convert([{ type: "input_image", image_url: "data:image/png;base64,fixture" }]), /未支持/);
});


test("colliding MCP tool names retain their distinct namespaces in requests, history and receipts", async () => {
  const converted = localCodexRequest({ tools: ["mcp__materials", "mcp__papers"].map((name) => ({
    type: "namespace", name, tools: [{ type: "function", name: "search", parameters: { type: "object" } }],
  })), input: [{ type: "function_call", name: "search", namespace: "mcp__papers", call_id: "previous", arguments: "{}" }] }, 1024, true);
  assert.deepEqual(converted.payload.tools!.map((tool: any) => tool.name), ["mcp__materials__search", "mcp__papers__search"]);
  assert.equal(converted.payload.input[0].name, "mcp__papers__search");
  const item = { id: "search-call", type: "function_call", name: "mcp__papers__search", call_id: "actual", arguments: "{}" };
  const response = codexResponse(sse([{ type: "response.output_item.done", item }, completed([item])]), true, converted.customCalls);
  const done = (await response.text()).split("\n\n").filter(Boolean).map((b) => JSON.parse(b.slice(6))).find((e) => e.type === "response.completed");
  assert.equal(done.response.output[0].namespace, "mcp__papers");
  assert.equal(done.response.output[0].name, "search");
});

test('local native catalog advertises only supervised adapters without changing schemas, aliases or real history',()=>{
 const schema={type:'object',properties:{reason:{type:'string'}},required:['reason']};
 const raw={tools:[{type:'function',name:'create_goal',parameters:{type:'object'}},
  {type:'function',name:'exec_command',parameters:{type:'object'}},
  ...['mcp__materials','mcp__papers'].map(name=>({type:'namespace',name,tools:[{type:'function',name:'search',parameters:schema}]}))],
  input:[{type:'function_call',name:'search',namespace:'mcp__papers',call_id:'owned',arguments:'{"reason":"original"}'},
   {type:'function_call_output',call_id:'owned',output:'actual receipt'}]};
 const bounded=localCodexRequest(raw,1024,true,new Set(['exec_command','search']));
 assert.deepEqual(bounded.payload.tools!.map((t:any)=>t.name),['exec_command','mcp__materials__search','mcp__papers__search']);
 assert.deepEqual(bounded.payload.tools![1]!.parameters,schema);
 assert.equal(bounded.payload.input[0].name,'mcp__papers__search');assert.equal(bounded.payload.input[0].arguments,raw.input[0]!.arguments);
 assert.equal(bounded.payload.input[1].output,'actual receipt');assert.equal(raw.tools.length,4);
 assert.equal(localCodexRequest(raw,1024,true).payload.tools!.length,4,'Unscoped callers retain the native catalog');
 const narrowed=localCodexRequest(raw,1024,true,new Set(['exec_command']));
 assert.deepEqual(narrowed.payload.tools!.map((t:any)=>t.name),['exec_command']);
 assert.equal(narrowed.payload.input[0].name,'mcp__papers__search');
 assert.equal(narrowed.payload.input[1].output,'actual receipt');
 assert(!Object.hasOwn(narrowed.customCalls!,'mcp__papers__search'),'Historical evidence cannot enable a new dispatch');
 assert.throws(()=>localCodexRequest({...raw,input:[raw.input[0]]},1024,true,new Set(['exec_command'])),/配对回执/);
});

test('local schema rejection withholds all tool terminals; valid arguments remain byte-for-byte unchanged',async()=>{
 const tool={type:'function',name:'actual_tool',parameters:{type:'object',properties:{value:{type:'number'}},required:['value'],additionalProperties:false}};
 const first={id:'valid',type:'function_call',name:'actual_tool',call_id:'first',arguments:'{ "value": 7 }'},bad={...first,id:'invalid',call_id:'second',arguments:'{"value":7,"invented":true}'};
 const raw=await localResponsesInvoker(connection,async()=>sse([{type:'response.output_item.done',item:first},{type:'response.output_item.done',item:bad},completed([first,bad])]))({...payload,tools:[tool]},new AbortController().signal);
 const reader=raw.body!.getReader();let received='';await assert.rejects(async()=>{for(;;){const r=await reader.read();if(r.done)break;received+=new TextDecoder().decode(r.value);}},/Tool arguments do not match schema.*invented/);
 assert(!received.includes('response.output_item.done'));assert(!received.includes('response.completed'));
 const valid=await localResponsesInvoker(connection,async()=>sse([{type:'response.output_item.done',item:first},completed([first])]))({...payload,tools:[tool]},new AbortController().signal);const text=await valid.text();assert(text.includes(JSON.stringify(first.arguments)));
});

test('schema rejection gives the exact advertised shape without leaking arguments or accepting a value wrapper',async()=>{
 const tool={type:'function',name:'research_data',parameters:{type:'object',properties:{action:{type:'string',enum:['read_current_recipes']}},required:['action'],additionalProperties:false}};
 const bad={id:'bad',type:'function_call',name:'research_data',call_id:'rejected',arguments:JSON.stringify({action:'read_current_recipes',value:'private-test-value'})};
 const raw=await localResponsesInvoker(connection,async()=>sse([{type:'response.output_item.done',item:bad},completed([bad])]))({...payload,tools:[tool]},new AbortController().signal);
 await assert.rejects(raw.text(),error=>{assert(error instanceof AgentError);assert.match(error.message,/Unrecognized key.*value/);assert.deepEqual(error.recovery?.parameters,tool.parameters);assert.equal(error.recovery?.phase,'rejected');assert.equal(error.recovery?.issues?.[0]?.code,'unrecognized_keys');assert(!JSON.stringify(error.toJSON()).includes('private-test-value'));return true;});
});
