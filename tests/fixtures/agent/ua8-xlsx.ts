import {crc32} from 'node:zlib';
import type {ExperimentTable} from '../../../experiments/tensile.mjs';
/** Minimal standards-shaped stored ZIP for testing the restricted XLSX reader. */
export function zipFixture(parts:Record<string,string>){
  const blocks:Buffer[]=[],central:Buffer[]=[];let offset=0;
  for(const [name,body]of Object.entries(parts)){
    const n=Buffer.from(name),b=Buffer.from(body),crc=crc32(b),local=Buffer.alloc(30),entry=Buffer.alloc(46);
    local.writeUInt32LE(0x04034b50);local.writeUInt16LE(20,4);local.writeUInt32LE(crc,14);local.writeUInt32LE(b.length,18);local.writeUInt32LE(b.length,22);local.writeUInt16LE(n.length,26);
    entry.writeUInt32LE(0x02014b50);entry.writeUInt16LE(20,4);entry.writeUInt16LE(20,6);entry.writeUInt32LE(crc,16);entry.writeUInt32LE(b.length,20);entry.writeUInt32LE(b.length,24);entry.writeUInt16LE(n.length,28);entry.writeUInt32LE(offset,42);
    blocks.push(local,n,b);central.push(entry,n);offset+=local.length+n.length+b.length;
  }
  const directory=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(central.length/2,8);end.writeUInt16LE(central.length/2,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);
  return Buffer.concat([...blocks,directory,end]);
}
export function xlsxParts(table:ExperimentTable){
  const escape=(s:string)=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
  return {'xl/workbook.xml':'<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Tensile" sheetId="1" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels':'<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml" Type="worksheet"/></Relationships>',
    'xl/worksheets/sheet1.xml':'<worksheet><sheetData><row r="1">'+table.columns.map((c,i)=>`<c r="${String.fromCharCode(65+i)}1" t="inlineStr"><is><t>${escape(c)}</t></is></c>`).join('')+'</row>'+table.rows.map(r=>`<row r="${r.row}">${table.columns.map((c,i)=>`<c r="${String.fromCharCode(65+i)}${r.row}"><v>${escape(r.values[c]!)}</v></c>`).join('')}</row>`).join('')+'</sheetData></worksheet>'};
}
