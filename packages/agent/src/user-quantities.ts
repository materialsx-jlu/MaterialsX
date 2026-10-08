const numberWords=['zero','one','two','three','four','five','six','seven','eight','nine','ten','eleven','twelve','thirteen','fourteen','fifteen','sixteen','seventeen','eighteen','nineteen','twenty'];
/** Recognize explicitly written numbers; never supply a default scientific threshold. */
export function userNumbers(text:string):number[]{
  const result=Array.from(text.matchAll(/[-+]?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?/g),m=>Number(m[0]));
  for(const match of text.toLowerCase().matchAll(new RegExp('\\b('+numberWords.join('|')+')\\b','g')))result.push(numberWords.indexOf(match[1]!));
  for(const match of text.matchAll(/[零〇一二两三四五六七八九十百]+/g)){
    const digits:Record<string,number>={'零':0,'〇':0,'一':1,'二':2,'两':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9};
    const word=match[0];let value=0,number=0;
    for(const char of word){if(char==='十'||char==='百'){value+=(number||1)*(char==='十'?10:100);number=0;}else number=digits[char]!;}
    result.push(value+number);
  }
  return result;
}
export function userUnitPresent(text:string,unit:string,value:number|null=null):boolean{
  if(unit==='count'){
    if(value!==null&&(!Number.isSafeInteger(value)||value<0))return false;
    const words=numberWords.join('|');
    const english=new RegExp('(?<![\\w.])(\\d+|'+words+')\\s+(?:recipes?|formulations?|samples?|experiments?|papers?|repeats?|replicates?|candidates?|batches?|groups?)\\b','gi');
    const chinese=/(?<![\d.])(\d+|[零〇一二两三四五六七八九十百]+)\s*(?:个|组|份|篇|次|种)/g;
    const counts=[...text.matchAll(english),...text.matchAll(chinese)];
    // Unknown result may keep the explicit count unit; never invent its value.
    return value===null?counts.length>0:counts.some(m=>userNumbers(m[1]!).includes(value));
  }
  const normalize=(s:string)=>s.replace(/\bdegC\b|℃/g,'°C').replace(/\bdegF\b|℉/g,'°F');
  // Case remains significant for SI prefixes (meV and MeV are different).
  const token=normalize(unit).replace(/\s+/g,'');if(!token)return false;
  const pattern=Array.from(token,c=>c.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('\\s*');
  return new RegExp('(?<![A-Za-zµμ])'+pattern+'(?![A-Za-zµμ])','u').test(normalize(text));
}
