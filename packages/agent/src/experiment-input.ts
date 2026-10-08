import {inflateRawSync,crc32} from 'node:zlib';
import {DOMParser} from '@xmldom/xmldom';
import type {ExperimentTable} from '../../../experiments/tensile.mjs';
const MAX=16*1024*1024;
function table(matrix:Array<{row:number;cells:string[]}>,sheet:string|null):ExperimentTable{
  if(matrix.length<4||matrix.length>10001)throw Error('EXPERIMENT_ROWS_LIMIT / 需要 3–10000 行数据');
  const columns=matrix[0]!.cells.map(v=>v.trim());
  if(columns.length<2||columns.length>64||columns.some(v=>!v||v.length>2000)||new Set(columns).size!==columns.length)throw Error('EXPERIMENT_HEADERS_INVALID');
  const rows=matrix.slice(1).map(r=>{if(r.cells.length!==columns.length||r.cells.some(s=>s.length>2000))throw Error('EXPERIMENT_ROW_WIDTH:'+r.row);
    return {row:r.row,values:Object.fromEntries(columns.map((c,i)=>[c,r.cells[i]!]))};});
  return {columns,rows,sheet};
}
export function parseExperimentCsv(bytes:Buffer):ExperimentTable{
  if(bytes.length>8*1024*1024)throw Error('EXPERIMENT_INPUT_LIMIT');
  const raw=new TextDecoder('utf-8',{fatal:true}).decode(bytes).replace(/^\uFEFF/,'');
  if(raw.includes('\0'))throw Error('EXPERIMENT_ENCODING_INVALID');
  const first=raw.split(/\r?\n/).find(line=>line.trim().length>0)??'';let inside=false;const counts:Record<string,number>={',':0,';':0,'\t':0};
  for(let i=0;i<first.length;i++){const ch=first[i]!;if(ch==='"'){if(inside&&first[i+1]==='"')i++;else inside=!inside;}else if(!inside&&ch in counts)counts[ch]!++;}
  const delimiter=Object.keys(counts).sort((a,b)=>counts[b]!-counts[a]!)[0]!;
  const rows:Array<{row:number;cells:string[]}>=[];let cell='',cells:string[]=[],quoted=false,closed=false,line=1,rowStart=1;
  for(let i=0;i<raw.length;i++){
    const c=raw[i]!;
    if(quoted){if(c==='"'){if(raw[i+1]==='"'){cell+='"';i++;}else{quoted=false;closed=true;}}else{cell+=c;if(c==='\n')line++;}continue;}
    if(c==='"'){if(cell||closed)throw Error('CSV_QUOTE_INVALID');quoted=true;}
    else if(c===delimiter){cells.push(cell);cell='';closed=false;}
    else if(c==='\n'||c==='\r'){if(c==='\r'&&raw[i+1]==='\n')i++;cells.push(cell);if(cells.some(v=>v!==''))rows.push({row:rowStart,cells});cell='';cells=[];closed=false;line++;rowStart=line;}
    else{if(closed)throw Error('CSV_TRAILING_QUOTE_TEXT');cell+=c;}
    if(rows.length>10001||cells.length>64||cell.length>2000)throw Error('CSV_LIMIT');
  }
  if(quoted)throw Error('CSV_QUOTE_UNCLOSED');
  if(cell||cells.length){cells.push(cell);rows.push({row:rowStart,cells});}
  return table(rows,null);
}
/** Restricted XLSX reader: central-directory sizes bound inflation; no formulas/macros/external links. */
function unzip(bytes:Buffer){
  let end=-1;for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--)if(bytes.readUInt32LE(i)===0x06054b50){end=i;break;}
  if(end<0||bytes.readUInt16LE(end+4)||bytes.readUInt16LE(end+6))throw Error('XLSX_ZIP_INVALID');
  const count=bytes.readUInt16LE(end+10),offset=bytes.readUInt32LE(end+16),size=bytes.readUInt32LE(end+12);
  if(count>256||offset+size>end)throw Error('XLSX_ZIP_LIMIT');
  const files=new Map<string,Buffer>();let cursor=offset,total=0;
  for(let i=0;i<count;i++){
    if(cursor+46>offset+size||bytes.readUInt32LE(cursor)!==0x02014b50)throw Error('XLSX_ZIP_INVALID');
    const flags=bytes.readUInt16LE(cursor+8),method=bytes.readUInt16LE(cursor+10),packed=bytes.readUInt32LE(cursor+20),expanded=bytes.readUInt32LE(cursor+24),
      n=bytes.readUInt16LE(cursor+28),extra=bytes.readUInt16LE(cursor+30),comment=bytes.readUInt16LE(cursor+32),local=bytes.readUInt32LE(cursor+42),crc=bytes.readUInt32LE(cursor+16);
    const name=bytes.subarray(cursor+46,cursor+46+n).toString('utf8');cursor+=46+n+extra+comment;total+=expanded;
    if(cursor>offset+size)throw Error('XLSX_ZIP_INVALID');
    if(flags&1||![0,8].includes(method)||total>MAX||expanded>MAX||files.has(name)||name.includes('..')||name.startsWith('/')||name.includes('\\'))throw Error('XLSX_ZIP_LIMIT');
    if(/vbaProject|externalLinks|\.bin$/i.test(name))throw Error('XLSX_ACTIVE_CONTENT_UNSUPPORTED');
    if(local+30>offset||bytes.readUInt32LE(local)!==0x04034b50)throw Error('XLSX_ZIP_INVALID');
    const start=local+30+bytes.readUInt16LE(local+26)+bytes.readUInt16LE(local+28);if(start+packed>offset)throw Error('XLSX_ZIP_INVALID');
    const chunk=bytes.subarray(start,start+packed),data=method===0?chunk:inflateRawSync(chunk,{maxOutputLength:Math.max(1,expanded)});
    if(data.length!==expanded||crc32(data)!==crc)throw Error('XLSX_ZIP_SIZE_OR_CRC_MISMATCH');files.set(name,data);
  }
  if(cursor!==offset+size)throw Error('XLSX_ZIP_INVALID');return files;
}
function xml(files:Map<string,Buffer>,name:string){
  const bytes=files.get(name);if(!bytes)throw Error('XLSX_PART_MISSING:'+name);
  const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);if(/<!DOCTYPE|<!ENTITY/i.test(text))throw Error('XLSX_XML_ENTITY');
  let error=false;const doc=new DOMParser({errorHandler:{warning:()=>{error=true;},error:()=>{error=true;},fatalError:()=>{error=true;}}}).parseFromString(text,'application/xml');
  if(error||!doc.documentElement)throw Error('XLSX_XML_INVALID');return doc;
}
export function parseExperimentXlsx(bytes:Buffer):ExperimentTable{
  if(bytes.length>8*1024*1024)throw Error('EXPERIMENT_INPUT_LIMIT');
  const files=unzip(bytes),workbook=xml(files,'xl/workbook.xml'),sheets=Array.from(workbook.getElementsByTagName('sheet'));
  if(sheets.length!==1||/hidden/i.test(sheets[0]!.getAttribute('state')??''))throw Error('XLSX_SINGLE_VISIBLE_SHEET_REQUIRED');
  for(const [name]of files)if(name.endsWith('.rels')){const relationships=xml(files,name);if(Array.from(relationships.getElementsByTagName('Relationship')).some(r=>r.getAttribute('TargetMode')==='External'))throw Error('XLSX_EXTERNAL_LINK_UNSUPPORTED');}
  const id=sheets[0]!.getAttribute('r:id'),relations=xml(files,'xl/_rels/workbook.xml.rels'),rel=Array.from(relations.getElementsByTagName('Relationship')).find(r=>r.getAttribute('Id')===id);
  const target=rel?.getAttribute('Target')?.replace(/^\/?xl\//,'');if(!target||!/^worksheets\/[^/]+\.xml$/.test(target))throw Error('XLSX_SHEET_TARGET_INVALID');
  const shared=files.has('xl/sharedStrings.xml')?Array.from(xml(files,'xl/sharedStrings.xml').getElementsByTagName('si')).map(si=>si.textContent??''):[];
  if(shared.length>100000)throw Error('XLSX_SHARED_STRINGS_LIMIT');
  const sheet=xml(files,'xl/'+target),matrix:Array<{row:number;cells:string[]}>=[];
  for(const r of Array.from(sheet.getElementsByTagName('row'))){
    const row=Number(r.getAttribute('r'));if(!Number.isInteger(row)||row<1||row>100002||(matrix.at(-1)?.row??0)>=row)throw Error('XLSX_ROW_ID_INVALID');
    const cells:string[]=[];
    for(const c of Array.from(r.getElementsByTagName('c'))){
      if(c.getElementsByTagName('f').length)throw Error('XLSX_FORMULA_UNSUPPORTED');
      const ref=c.getAttribute('r')??'',m=/^([A-Z]{1,2})(\d+)$/.exec(ref);if(!m||Number(m[2])!==row)throw Error('XLSX_CELL_REF_INVALID');
      let col=0;for(const ch of m[1]!)col=col*26+ch.charCodeAt(0)-64;col--;
      if(col>=64||cells[col]!==undefined)throw Error('XLSX_COLUMN_LIMIT');
      const type=c.getAttribute('t'),v=c.getElementsByTagName('v')[0]?.textContent??'';
      if(type==='s'){if(!/^\d+$/.test(v)||shared[Number(v)]===undefined)throw Error('XLSX_STRING_INVALID');cells[col]=shared[Number(v)]!;}
      else if(type==='inlineStr')cells[col]=c.getElementsByTagName('is')[0]?.textContent??'';
      else if(!type||type==='n'||type==='str')cells[col]=v;
      else throw Error('XLSX_CELL_TYPE_UNSUPPORTED');
    }
    if(cells.some(v=>v!=='')){for(let i=0;i<cells.length;i++)cells[i]??='';matrix.push({row,cells});}
    if(matrix.length>10001)throw Error('XLSX_ROW_LIMIT');
  }
  const width=matrix[0]?.cells.length??0;for(const r of matrix)while(r.cells.length<width)r.cells.push('');
  return table(matrix,sheets[0]!.getAttribute('name'));
}
