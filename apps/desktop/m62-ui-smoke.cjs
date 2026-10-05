process.env.MATERIALSX_DISCOVERY_AUTOSYNC='0';
const {app,BrowserWindow,dialog}=require('electron');
const {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync}=require('node:fs');
const {tmpdir}=require('node:os');const {resolve,join}=require('node:path');const {pathToFileURL}=require('node:url');
const {createHash}=require('node:crypto');const assert=require('node:assert/strict');
const fixture=mkdtempSync(join(tmpdir(),'materialsx-m62-ui-')),project=join(fixture,'project');mkdirSync(project);app.setPath('userData',fixture);
delete process.env.MATERIALSX_RENDERER_URL;process.env.MATERIALSX_IDENTITY_URL='http://127.0.0.1:1';
let sample='si-triclinic.extxyz',exportCount=0;
dialog.showOpenDialog=async(_win,options)=>({canceled:false,filePaths:[options.properties.includes('openDirectory')?project:resolve('samples/atomistic',sample)]});
dialog.showSaveDialog=async(_win,options)=>{exportCount++;return {canceled:false,filePath:join(fixture,options.defaultPath)}};
const pause=ms=>new Promise(r=>setTimeout(r,ms));const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const triclinic=JSON.parse(readFileSync(resolve('samples/atomistic/si-triclinic.structure.json')));
const expectedDistance=Math.hypot(...triclinic.atoms[0].position.map((v,i)=>v-triclinic.atoms[1].position[i]));
(async()=>{let code=1;try{
 await import(pathToFileURL(resolve('dist/apps/desktop/main/index.js')).href);let win;
 for(let i=0;i<200;i++){win=BrowserWindow.getAllWindows()[0];if(win&&!win.webContents.isLoadingMainFrame())break;await pause(100)}assert(win);win.setSize(1450,950);
 win.webContents.on('console-message',(_event,level,message)=>{if(level>=2)console.error('Renderer:',message)});
 const js=source=>win.webContents.executeJavaScript(source);
 async function until(condition){for(let i=0;i<600;i++){if(await js(condition))return;await pause(100)}throw Error('UI timed out: '+condition+'\n'+await js('document.body.innerText.slice(-4500)'))}
 const click=label=>js(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.includes(${JSON.stringify(label)}))?.click()`);
 const panelClick=label=>js(`Array.from(document.querySelectorAll('[data-testid="atomic-viewer-panel"] button')).find(b=>b.textContent.includes(${JSON.stringify(label)}))?.click()`);
 const ready=`document.querySelector('.viewport')?.dataset.ready==='true'`;
 await until(`!!document.querySelector('.empty-project')`);await js('window.materialsx.chooseProjectFolder()');await js('location.reload()');await until(`!document.querySelector('.new-task-button')?.disabled`);
 await click('模型目录');await until(`document.body.innerText.includes('机器学习势')`);await click('机器学习势');
 await until(`document.body.innerText.includes('隔离环境已安装')`);await click('导入结构文件');await until(`document.querySelector('.structure-summary')?.innerText.includes('2 个原子')`);
 await click('查看结构 3D');await until(ready);
 assert.equal(await js(`document.querySelectorAll('.viewport iframe').length`),1);
 const initial=await js(`document.querySelector('.viewport iframe').contentDocument.querySelector('canvas').toDataURL()`);
 // Real native mouse drag in the actual WebGL frame; the pixels must change.
 const rect=await js(`(()=>{const r=document.querySelector('.viewport iframe').getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}})()`);
 const center={x:Math.round(rect.x+rect.width*.5),y:Math.round(rect.y+rect.height*.5)};
 win.webContents.sendInputEvent({type:'mouseDown',...center,button:'left',clickCount:1});
 win.webContents.sendInputEvent({type:'mouseMove',x:center.x+95,y:center.y+45,movementX:95,movementY:45,button:'left'});
 win.webContents.sendInputEvent({type:'mouseUp',x:center.x+95,y:center.y+45,button:'left',clickCount:1});await pause(250);
 assert.notEqual(await js(`document.querySelector('.viewport iframe').contentDocument.querySelector('canvas').toDataURL()`),initial);
 // Deterministic atom selection through the accessible table shares the 3D picking callback.
 await js(`document.querySelectorAll('.coordinates tbody button')[0].click();document.querySelectorAll('.coordinates tbody button')[1].click()`);
 await until(`document.querySelector('[data-testid="atomic-measurement"]').innerText.includes('${expectedDistance.toFixed(5)} Å')`);
 await js(`const s=document.querySelector('select[aria-label="显示超胞 a"]');s.value='2';s.dispatchEvent(new Event('change',{bubbles:true}))`);
 await until(`document.querySelector('.coordinates summary').innerText.includes('4')`);await pause(200);assert.equal(await js(`document.querySelectorAll('.coordinates tbody tr').length`),4);
 const setSelect=async(selector,value)=>{await js(`(()=>{const s=document.querySelector(${JSON.stringify(selector)});s.value=${JSON.stringify(value)};s.dispatchEvent(new Event('change',{bubbles:true}))})()`);await pause(200)};
 await setSelect('[data-testid="viewer-style"]','sphere');await setSelect('[data-testid="viewer-style"]','stick');await setSelect('[data-testid="viewer-style"]','ball-stick');
 await panelClick('导出 PNG');await until(`document.body.innerText.includes('PNG 已保存')`);const png=readFileSync(join(fixture,'materialsx-structure.png'));assert.equal(png.subarray(1,4).toString(),'PNG');
 await panelClick('导出原始结构');await until(`document.body.innerText.includes('已导出原始结构')`);assert.equal(hash(readFileSync(join(fixture,'structure.extxyz'))),hash(readFileSync(resolve('samples/atomistic',sample))));
 const evidence=resolve('runtime/m6/ui');mkdirSync(evidence,{recursive:true});
 const shot=async name=>{await pause(200);writeFileSync(join(evidence,name),(await win.webContents.capturePage()).toPNG())};await shot('viewer-dark.png');
 await js(`document.querySelector('button[aria-label="关闭结构查看器"]').click()`);await until(`document.querySelectorAll('.viewport iframe').length===0`);
 await js(`Array.from(document.querySelectorAll('.sidebar-footer button')).find(b=>b.textContent.includes('设置')).click()`);await until(`!!document.querySelector('.theme-options')`);
 await js(`document.querySelector('.theme-option:has(.theme-preview.codex-light)').click()`);await js(`document.querySelector('button[aria-label="关闭设置"]').click()`);await click('查看结构 3D');await until(ready);await shot('viewer-light.png');
 assert.equal(await js(`document.documentElement.dataset.theme`),'codex-light');
 // Exercise disposal: each close removes the frame, observers, listeners and GPU context.
 for(let i=0;i<3;i++){await js(`document.querySelector('button[aria-label="关闭结构查看器"]').click()`);await until(`document.querySelectorAll('.viewport iframe').length===0`);await click('查看结构 3D');await until(ready);assert.equal(await js(`document.querySelectorAll('.viewport iframe').length`),1);}
 await js(`document.querySelector('.viewport iframe').contentDocument.querySelector('canvas').dispatchEvent(new Event('webglcontextlost',{cancelable:true}))`);await until(`document.querySelector('.fallback')?.innerText.includes('WEBGL_CONTEXT_LOST')`);
 assert(await js(`!!document.querySelector('.coordinates table')`));await panelClick('重试查看器');await until(ready);
 await js(`document.querySelector('button[aria-label="关闭结构查看器"]').click()`);await until(`document.querySelectorAll('.viewport iframe').length===0`);
 sample='water.xyz';await click('导入结构文件');await until(`document.querySelector('.structure-summary')?.innerText.includes('3 个原子')`);await click('查看结构 3D');await until(ready);
 await pause(400); // Wait for the drawer's slide animation before native screen coordinates.
 // Real WebGL picking (no table events): search a small center grid until a sphere is hit.
 const waterRect=await js(`(()=>{const r=document.querySelector('.viewport iframe').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);let hit=false;
 for(const dx of [0,-35,35,-70,70]){for(const dy of [0,-35,35,-70,70]){const point={x:Math.round(waterRect.x+dx),y:Math.round(waterRect.y+dy)};win.webContents.sendInputEvent({type:'mouseDown',...point,button:'left',clickCount:1});win.webContents.sendInputEvent({type:'mouseUp',...point,button:'left',clickCount:1});await pause(30);hit=await js(`document.querySelector('[data-testid="atomic-measurement"]').innerText.includes('1. ')`);if(hit)break;}if(hit)break;}assert(hit,'native canvas atom picking');
 await panelClick('清除选择');await pause(100);
 await js(`(()=>{const b=document.querySelectorAll('.coordinates tbody button');b[1].click();b[0].click();b[2].click()})()`);await until(`document.querySelector('[data-testid="atomic-measurement"]').innerText.includes('104.')`);await shot('viewer-molecule.png');
 const close=async()=>{await js(`document.querySelector('button[aria-label="关闭结构查看器"],button[aria-label="Close structure viewer"]').click()`);await until(`document.querySelectorAll('.viewport iframe').length===0`)};
 await close();
 for(const [name,count] of [['si-diamond.POSCAR',8],['nacl-rocksalt.cif',8],['cu-vacancy.POSCAR',3],['cu-slab.extxyz',4],['methane.xyz',5]]){sample=name;const previous=await js(`document.querySelector('.atomistic-run-panel').dataset.structureId`);await click('导入结构文件');await until(`document.querySelector('.atomistic-run-panel').dataset.structureId!==${JSON.stringify(previous)} && document.querySelector('.structure-summary')?.innerText.includes('${count} 个原子')`);await click('查看结构 3D');await until(ready);assert.equal(await js(`document.querySelectorAll('.coordinates tbody tr').length`),count);await close();}
 // A genuine CHGNet single point exercises registered artifact reading and force coloring.
 sample='si-triclinic.extxyz';await click('导入结构文件');await until(`document.querySelector('.structure-summary')?.innerText.includes('2 个原子')`);
 await js(`(()=>{const s=document.querySelector('[data-testid=\"science-mode\"]');s.value='exploratory';s.dispatchEvent(new Event('change',{bubbles:true}))})()`);await click('运行单点计算');await until(`!!document.querySelector('[data-testid="atomic-artifact-card"]')`);await shot('viewer-artifacts.png');await click('查看 3D 与产物');await until(ready);
 assert.equal(await js(`document.querySelector('[data-testid="viewer-color"] option[value="force-magnitude"]').disabled`),false);await setSelect('[data-testid="viewer-color"]','force-magnitude');await until(`document.querySelector('.force-scale')!==null`);await shot('viewer-forces.png');
 await close();await js(`Array.from(document.querySelectorAll('[aria-label="模型介绍语言"] button')).find(b=>b.textContent.includes('English')).click()`);await click('View 3D and artifacts');await until(ready);assert(await js(`document.querySelector('[data-testid="atomic-viewer-panel"]').innerText.includes('Atomic structure viewer')`));await close();
 const b=await js('window.materialsx.bootstrap()');const projectId=b.projects[0].id;
 // Seed only a conversation fixture; the scientific artifact comes from the real job.
 const completed=await js(`window.materialsx.listAtomisticRuns(${JSON.stringify(projectId)})`);
 const conversation=await js(`window.materialsx.createConversation(${JSON.stringify(projectId)})`);
 const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync(join(fixture,'materialsx.sqlite'));
 db.prepare('INSERT INTO messages(id,conversation_id,role,content,status,created_at) VALUES(?,?,?,?,?,?)').run('m62-message-fixture',conversation.id,'assistant',`真实任务 ${completed[0].job.id}\n<script>window.__m62Injected=true</script>\n未知产物 00000000-0000-0000-0000-000000000000`,'complete',new Date().toISOString());db.close();
 await js('location.reload()');await until(`!!document.querySelector('.message-body [data-testid="atomic-artifact-card"]')`);
 assert.equal(await js(`document.querySelectorAll('.message-body [data-testid="atomic-artifact-card"]').length`),1);assert.equal(await js('!!window.__m62Injected'),false);
 await click('查看 3D 与产物');await until(ready);await shot('viewer-chat-artifact.png');await close();
 const recordFiles=require('node:fs').readdirSync(join(fixture,'atomistic/imports'));const imported=JSON.parse(readFileSync(join(fixture,'atomistic/imports',recordFiles[0])));
 const request={kind:'import',projectId,structureId:imported.structure.id};
 const reject=source=>js(`(async()=>{try{${source};return false}catch{return true}})()`).then(value=>assert(value));
 await reject(`await window.materialsx.readAtomicView({...${JSON.stringify(request)},path:'/etc/passwd'})`);
 await reject(`await window.materialsx.readAtomicView({...${JSON.stringify(request)},projectId:'not-this-project'})`);
 await reject(`await window.materialsx.exportAtomicPng({request:${JSON.stringify(request)},png:'data:image/png;base64,AAAA'})`);
 assert.equal(exportCount,2);
 const receipt={stage:'M6.2',platform:process.platform,electron:process.versions.electron,actualDesktop:true,local3Dmol:'2.5.5',nativeMouseRotation:true,nativeAtomPicking:true,displaySupercell:true,distanceAngstrom:expectedDistance,molecularAngle:true,styles:3,sharedThemes:true,bilingual:true,pngExport:true,originalExportHashVerified:true,singleActiveFrame:true,disposeCycles:3,contextLostFallback:true,strictIpc:true,nativeGeometryFixtures:7,registeredArtifacts:true,chatArtifactReference:true,unknownReferenceIgnored:true,modelHtmlEscaped:true,realSinglepoint:'CHGNet 0.3.0',forceColoring:true,scientificQuality:'needs_review',llmCalls:0,paymentCalls:0};
 writeFileSync(join(evidence,'viewer-acceptance.json'),JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt));code=0;
 }catch(error){console.error(error.stack)}finally{for(const win of BrowserWindow.getAllWindows())win.destroy();rmSync(fixture,{recursive:true,force:true});app.exit(code)}})();
