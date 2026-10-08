import { trajectorySceneSchema } from "../../../../packages/contracts/src/atomistic-dynamics.js";
import * as mol from "3dmol";
import { atomicFrameCommandSchema, type AtomicViewPayload } from "../../../../packages/contracts/src/atomic-viewer.js";
import type { z } from "zod";
import { atomicSceneSchema } from "../../../../packages/contracts/src/atomic-viewer.js";
import { displayAtoms, cellEdges, inferredBonds, type DisplayAtom } from "../../../../packages/atomistic/src/viewer-geometry.js";
import "./atomic-frame.css";

// A disposable local frame confines 3Dmol's window/body listeners and observers.
// No download/get/addModel file parsers, remote data, script strings or user HTML.
let viewer:mol.GLViewer|null=null,atoms:DisplayAtom[]=[],selected:number[]=[],disposed=false;
let signature="",light=false;
let initialView:ReturnType<mol.GLViewer["getView"]>|null=null;
const container=document.getElementById("scene")!;
const send=(value:unknown)=>parent.postMessage(value,"*");
function release(){disposed=true;if(viewer){viewer.clear();viewer=null;}for(const canvas of container.querySelectorAll("canvas"))canvas.getContext("webgl")?.getExtension("WEBGL_lose_context")?.loseContext();}
function labels(){if(!viewer)return;viewer.removeAllLabels();for(const [n,index] of selected.entries()){const a=atoms[index];if(!a)continue;viewer.addLabel(`${a.element} #${a.sourceIndex+1} [${a.replica.join(",")}]`,{position:{x:a.position[0],y:a.position[1],z:a.position[2]},screenOffset:new mol.Vector2(12,n%2?-24:12),fontColor:light?"#17212b":"#ffffff",backgroundColor:light?"#ffffff":"#17212b",backgroundOpacity:.85,fontSize:13,inFront:true});}viewer.render();send({type:"selected",indices:selected});}
function select(index:number|null){if(index===null)selected=[];else if(atoms[index])selected=selected.includes(index)?selected.filter(i=>i!==index):selected.length===3?[index]:[...selected,index];labels();}
function draw(scene:z.infer<typeof atomicSceneSchema>){
  const {payload,config,theme}=scene;light=theme==="codex-light";
  const source:AtomicViewPayload=payload;
  if(config.artifactId!==(payload.request.kind==="import"?payload.structure.source.artifactId:payload.request.artifactId))throw Error("VIEW_ARTIFACT_IDENTITY");
  if(config.colorBy==="force-magnitude"&&!source.forcesEvPerAngstrom)throw Error("FORCE_DATA_UNAVAILABLE");
  const next=displayAtoms(source.structure,config.supercell,source.forcesEvPerAngstrom);
  const nextSignature=`${source.structure.id}:${config.supercell.join(",")}`;
  const same=signature===nextSignature;const view=same?viewer?.getView():null;
  if(!same)selected=[];signature=nextSignature;atoms=next;
  if(!viewer){viewer=mol.createViewer(container,{backgroundColor:light?"#f5f7fa":"#17212b",antialias:true});
    container.querySelector("canvas")?.addEventListener("webglcontextlost",event=>{event.preventDefault();if(!disposed)send({type:"error",message:"WEBGL_CONTEXT_LOST"});});}
  viewer.clear();viewer.setBackgroundColor(light?"#f5f7fa":"#17212b",1);
  const bonds=config.showInferredBonds?inferredBonds(atoms):{pairs:[],limited:false,unsupported:[]};
  const neighbors:number[][]=atoms.map(()=>[]);for(const [a,b] of bonds.pairs){neighbors[a]!.push(b);neighbors[b]!.push(a);}
  const maxForce=Math.max(0,...atoms.map(a=>a.forceMagnitude??0));
  const colors:Record<string,string>={};
  const model=viewer.addModel();model.addAtoms(atoms.map((a,i)=>({elem:a.element,x:a.position[0],y:a.position[1],z:a.position[2],serial:i,
    bonds:neighbors[i]!,bondOrder:neighbors[i]!.map(()=>1),properties:{displayIndex:i}})));
  const elementColor=(element:string)=>{const n=(mol.elementColors.Jmol[element]??0x969eaa) as number;return `#${n.toString(16).padStart(6,"0")}`;};
  const forceColor=(magnitude:number)=>{const p=maxForce===0?0:magnitude/maxForce;return `#${[Math.round(45+200*p),Math.round(125-45*p),Math.round(225-165*p)].map(n=>n.toString(16).padStart(2,"0")).join("")}`;};
  for(const atom of atoms)colors[atom.element]=elementColor(atom.element);
  model.setStyle({},config.style==="sphere"?{sphere:{scale:.6}}:config.style==="stick"?{sphere:{radius:.18},stick:{radius:.16}}:{sphere:{scale:.26},stick:{radius:.12}});
  model.setColorByFunction({},(atom:mol.AtomSpec)=>{const i=Number(atom.properties?.displayIndex);const data=atoms[i]!;return config.colorBy==="force-magnitude"?forceColor(data.forceMagnitude!):colors[data.element]!;});
  model.setClickable({},true,(atom:mol.AtomSpec)=>select(Number(atom.properties?.displayIndex)));
  if(config.showCell)for(const [a,b] of cellEdges(source.structure.cell,config.supercell))viewer.addLine({start:{x:a[0],y:a[1],z:a[2]},end:{x:b[0],y:b[1],z:b[2]},color:light?"#647587":"#b2c0cc",linewidth:1.5});
  if(view)viewer.setView(view);else {viewer.zoomTo();if(!source.structure.pbc.some(Boolean)&&atoms.length<20)viewer.zoom(3);viewer.rotate(18,"y");viewer.rotate(12,"x");initialView=viewer.getView();}labels();viewer.resize();viewer.render();
  container.dataset.rendered="true";
  send({type:"rendered",count:atoms.length,bonds:bonds.pairs.length,limited:bonds.limited,unsupported:bonds.unsupported,colors});
}
window.addEventListener("message",event=>{
  if(event.source!==parent||!(event.origin===location.origin||(location.protocol==="file:"&&event.origin==="null"))||disposed)return;
  const md=trajectorySceneSchema.safeParse(event.data);
  if(md.success){try{const v=md.data,structure=structuredClone(v.structure);structure.atoms.forEach((a,i)=>a.position=v.frame.positionsAngstrom[i]!);draw({type:"scene",payload:{version:"m6.2-v1",request:{kind:"import",projectId:v.projectId,structureId:structure.id},structure,forcesEvPerAngstrom:null,quality:"needs_review"},config:{artifactId:structure.source.artifactId,style:v.style,showCell:v.showCell,showInferredBonds:v.showBonds,supercell:[1,1,1],frame:0,colorBy:"element"},theme:v.theme});}catch(e){send({type:"error",message:e instanceof Error?e.message:"TRAJECTORY_RENDER_FAILED"});}return;}
  const parsed=atomicFrameCommandSchema.safeParse(event.data);if(!parsed.success)return;
  try{const command=parsed.data;
    if(command.type==="scene")draw(command);
    else if(command.type==="reset"){if(initialView)viewer?.setView(initialView);else viewer?.zoomTo();viewer?.render();}
    else if(command.type==="select")select(command.index);
    else if(command.type==="png"){if(!viewer)throw Error("VIEWER_NOT_READY");viewer.render();send({type:"png",png:viewer.pngURI()});}
    else release();
  }catch(error){send({type:"error",message:error instanceof Error?error.message:"VIEWER_FAILED"});}
});
window.addEventListener("pagehide",release);
send({type:"ready"});
