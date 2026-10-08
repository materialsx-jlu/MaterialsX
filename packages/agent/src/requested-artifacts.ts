/** Quoted commands are reference data; quoted literal filenames remain output arguments. */
export function artifactRequestText(request:string):string {
 const filename=/^(?:[A-Za-z]:[\\/])?[\w\u3400-\u9fff./\\-]+\.(?:jsonl?|md|txt|csv|svg|pdf|png|jpe?g|html|ya?ml|xyz|cif)$/i;
 const keepFilename=(quoted:string,body:string)=>filename.test(body.trim())?quoted:'';
 return request.replace(/```[\s\S]*?```/g,'').replace(/^>.*$/gm,'')
  .replace(/(`+)([^\n]*?)\1/g,(quoted,_ticks:string,body:string)=>keepFilename(quoted,body))
  .replace(/[“"]([^”"\n]+)[”"]/g,keepFilename);
}
/** Literal named outputs only; this is neither task classification nor execution authorization. */
export function requestedArtifacts(request:string):string[]{
 const verbs=/(?:输出|生成|保存|写入|写到|创建|导出|\b(?:write|create|save|generate|export|output)\b)/gi;
 const files=/(?:[A-Za-z]:[\\/])?[\w\u3400-\u9fff./\\-]+\.(?:jsonl?|md|txt|csv|svg|pdf|png|jpe?g|html|ya?ml|xyz|cif)\b/gi;
 const text=artifactRequestText(request);
 const result=new Set<string>();
 for(const clause of text.split(/[\n，,。；;!?！？]|\s+but\s+|但是/)){
  const literals=[...clause.matchAll(/`+[^`\n]+`+|“[^”\n]+”|"[^"\n]+"/g)];
  for(const match of clause.matchAll(verbs)){
   if(literals.some(literal=>match.index!>=literal.index!&&match.index!<literal.index!+literal[0].length))continue;
   const prefix=clause.slice(0,match.index);
   if(/如何|怎样|怎么|\bhow\b|解释|\bexplain\b/i.test(prefix))continue;
   if(/(?:不要|不必|无需|禁止|不能|未|已|do not|don't|never|not|how to|如何|怎样|示例|例如)\s*$/i.test(prefix))continue;
   const tail=clause.slice(match.index!+match[0].length).split(/\b(?:based on|from|using)\b|根据|基于|输入/i)[0]!;
   for(const file of tail.matchAll(files))result.add(file[0]);
  }
 }
 return [...result];
}
