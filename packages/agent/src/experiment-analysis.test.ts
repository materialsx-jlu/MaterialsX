import {test} from 'node:test';
import assert from 'node:assert/strict';
import {analyzeTensile} from '../../../experiments/tensile.mjs';
import {tensileFixture,fixtureCsv} from '../../../tests/fixtures/agent/ua8-tensile.js';
import {parseExperimentCsv,parseExperimentXlsx} from './experiment-input.js';
import {experimentConfigInput} from '../../contracts/src/experiments.js';
import {tensileSvg,tensileCsv} from './experiment-report.js';
import {xlsxParts,zipFixture} from '../../../tests/fixtures/agent/ua8-xlsx.js';
import {initialResearchTools,sourceDeliveryRequested} from './research-tools.js';
test('twelve fixed engineering-tensile cases, three independent invocations, match predeclared analytic references',()=>{
  for(let run=0;run<3;run++)for(let i=0;i<12;i++){
    const s=tensileFixture(i),r=analyzeTensile([s]),c=r.curves[0]!;
    assert(Math.abs(c.fit.slopeMPa-s.expectedSlope)<1e-8);assert(Math.abs(c.fit.interceptMPa-s.expectedIntercept)<1e-10);
    assert.equal(c.fit.rows,6);assert.equal(c.points.length,12);assert.equal(r.statistics.fitSlopeMPa.sampleSd,null);
    assert.equal(c.fit.youngsModulusMPa,s.config.strainSource==='crosshead'?null:c.fit.slopeMPa);
    assert.deepEqual(parseExperimentCsv(Buffer.from(fixtureCsv(s.table))).rows,s.table.rows);
    assert.equal(r.productionApproved,false);assert.equal(r.scientificStatus,'needs_review');
  }
});
test('explicit independent specimen statistics differ from within-curve scatter; aliases and incompatible conditions rejected',()=>{
  const a=tensileFixture(0),b=tensileFixture(4);const r=analyzeTensile([a,b],true);
  assert.equal(r.statistics.fitSlopeMPa.independentReplicates,2);assert(Math.abs(r.statistics.fitSlopeMPa.sampleSd!-2800/Math.sqrt(2))<1e-8);
  assert.equal(analyzeTensile([a,b],false).statistics.fitSlopeMPa.sampleSd,null);
  assert.throws(()=>analyzeTensile([a],true),/REQUIRE_TWO/);
  assert.throws(()=>analyzeTensile([a,{...a,config:{...a.config,specimenId:'alias'}}],true),/DUPLICATE_CURVE/);
  assert.throws(()=>analyzeTensile([a,{...b,config:{...b.config,conditions:'different temperature'}}],true),/INCOMPARABLE/);
});
test('bad rows must be explicitly excluded, interval changes recompute, original tables are unchanged',()=>{
  const a=tensileFixture(),before=JSON.stringify(a.table);a.table.rows[2]!.values.stress='NaN';
  assert.throws(()=>analyzeTensile([a]),/NON_NUMERIC/);a.config.exclusions=[{row:4,reason:'Synthetic invalid instrument output'}];
  assert.equal(analyzeTensile([a]).curves[0]!.fit.rows,5);a.config.fitRange=[.007,.011];assert(analyzeTensile([a]).curves[0]!.fit.slopeMPa>1000);
  assert.equal(a.table.rows[2]!.values.stress,'NaN');assert.notEqual(JSON.stringify(a.table),before);
  a.config.exclusions=[{row:99,reason:'Unknown row'}];assert.throws(()=>analyzeTensile([a]),/ROW_NOT_FOUND/);
  a.config.exclusions=[];a.table=tensileFixture().table;a.table.rows[5]!.values.strain='0';assert.throws(()=>analyzeTensile([a]),/NON_MONOTONIC/);
});
test('unit/geometry/range gates and digitized identity cannot become qualified measurements',()=>{
  const s=tensileFixture();
  for(const patch of [{areaMm2:0},{conditions:''},{fitRange:[.01,0]},{xUnit:'unknown'},{exclusions:[{row:2,reason:''}]},{mode:'force-displacement',gaugeLengthMm:null},{acquisition:'digitized'}])assert(!experimentConfigInput.safeParse({...s.config,...patch}).success);
  s.config.acquisition='digitized';s.config.digitizationUncertainty='Synthetic declared uncertainty ±0.002 strain, ±2 MPa';
  assert.equal(analyzeTensile([s]).curves[0]!.fit.youngsModulusMPa,null);
  assert.throws(()=>analyzeTensile([s,tensileFixture(4)],true),/DIGITIZED/);
  s.config.strainSource='reported';assert.equal(analyzeTensile([s]).curves[0]!.fit.youngsModulusMPa,null);
});
test('CSV preserves quoted headers and multiline raw cells; malformed shapes and encodings fail',()=>{
  const csv='"strain","stress, MPa"\r\n0,0\r\n.001,1\r\n.002,2\r\n';assert.equal(parseExperimentCsv(Buffer.from(csv)).columns[1],'stress, MPa');
  for(const raw of ['a,a\n0,0\n1,1\n2,2','a,b\n0,0\n1\n2,2','a,b\n0,0\n1,1\n"2,2','a,b\n0,0\n1,1\n2,"2"oops'])assert.throws(()=>parseExperimentCsv(Buffer.from(raw)));
  assert.throws(()=>parseExperimentCsv(Buffer.from([0xff])));assert.throws(()=>parseExperimentXlsx(Buffer.from('not XLSX')));
});
test('charts escape specimen labels and the plot contains actual calculated points and fixed fit interval',()=>{
  const s=tensileFixture();s.config.specimenId='<script>alert(1)</script>';const r=analyzeTensile([s]);
  assert(!tensileSvg(r).includes('<script>'));assert(tensileSvg(r).includes('&lt;script&gt;'));
  assert(tensileCsv(r).includes('original_row,strain_dimensionless,stress_MPa,in_fit'));
});
test('XLSX numeric and shared-string cells preserve source row IDs; active content, CRC corruption and inflation limits reject',()=>{
  const s=tensileFixture();const parts=xlsxParts(s.table);
  assert.deepEqual(parseExperimentXlsx(zipFixture(parts)).rows,s.table.rows);
  const shared={...parts,'xl/sharedStrings.xml':'<sst><si><t>strain</t></si><si><t>stress</t></si></sst>'};
  shared['xl/worksheets/sheet1.xml']=shared['xl/worksheets/sheet1.xml'].replace('<c r="A1" t="inlineStr"><is><t>strain</t></is></c>','<c r="A1" t="s"><v>0</v></c>').replace('<c r="B1" t="inlineStr"><is><t>stress</t></is></c>','<c r="B1" t="s"><v>1</v></c>');
  assert.deepEqual(parseExperimentXlsx(zipFixture(shared)).columns,s.table.columns);
  const formula={...parts,'xl/worksheets/sheet1.xml':parts['xl/worksheets/sheet1.xml'].replace('<v>1</v>','<f>1+1</f><v>1</v>')};assert.throws(()=>parseExperimentXlsx(zipFixture(formula)),/FORMULA/);
  assert.throws(()=>parseExperimentXlsx(zipFixture({...parts,'xl/vbaProject.bin':'macro'})),/ACTIVE_CONTENT/);
  assert.throws(()=>parseExperimentXlsx(zipFixture({...parts,'xl/_rels/workbook.xml.rels':'<Relationships><Relationship Id="rId1" TargetMode="External" Target="https://example.com"/></Relationships>'})),/EXTERNAL/);
  assert.throws(()=>parseExperimentXlsx(zipFixture({...parts,'xl/workbook.xml':'<!DOCTYPE x [<!ENTITY a "bad">]><workbook/>'})),/ENTITY/);
  const corrupted=zipFixture(parts);corrupted[70]=corrupted[70]!^1;assert.throws(()=>parseExperimentXlsx(corrupted),/CRC/);
  const bomb=zipFixture(parts),end=bomb.length-22,offset=bomb.readUInt32LE(end+16);bomb.writeUInt32LE(32*1024*1024,offset+24);assert.throws(()=>parseExperimentXlsx(bomb),/LIMIT/);
});
test('raw tensile routing advertises the experiment backend without unrelated atomistic or MOOS comparison dispatch',()=>{
  const request='@materials-tensile-analysis 分析应力应变 CSV，生成报告';
  const tools=initialResearchTools(request);assert(tools.has('experiment_analyze'));assert(tools.has('experiment_data'));assert(!tools.has('materials_science'));
  assert.equal(sourceDeliveryRequested(request,true),false);assert(initialResearchTools('计算晶体的原子应力应变，使用机器学习势').has('materials_science'));
});
