import * as mol from "3dmol";
import { comparisonCommandSchema, type comparisonSceneSchema } from "../../../../packages/contracts/src/atomistic-relaxation.js";
import { displayAtoms, cellEdges, inferredBonds } from "../../../../packages/atomistic/src/viewer-geometry.js";
import type { z } from "zod";
import "./comparison-frame.css";
const containers=[document.getElementById("left")!,document.getElementById("right")!];
let viewers:mol.GLViewer[]=[],initial:number[][]=[],sync=true,updating=false,disposed=false;
const resize=new ResizeObserver(()=>{for(const v of viewers){v.resize();v.render();}});
containers.forEach(c=>resize.observe(c));
const send=(value:unknown)=>parent.postMessage(value,"*");
function dispose(){disposed=true;resize.disconnect();for(const v of viewers){v.setViewChangeCallback(null);v.clear();}viewers=[];for(const c of document.querySelectorAll("canvas"))c.getContext("webgl")?.getExtension("WEBGL_lose_context")?.loseContext();}
function draw(scene:z.infer<typeof comparisonSceneSchema>){
 const light=scene.theme==="codex-light";sync=scene.sync;updating=true;
 const preserved=viewers.map(v=>v.getView());
 const displacement=scene.payload.summary.displacementsAngstrom.map(v=>Math.hypot(...v));const forces=scene.payload.forcesEvPerAngstrom.map(v=>Math.hypot(...v));
 const magnitudes=scene.colorBy==="force"?forces:displacement;const max=Math.max(...magnitudes,0);
 const gradient=(v:number)=>{const t=max?v/max:0;return `#${[Math.round(45+200*t),Math.round(125-45*t),Math.round(225-165*t)].map(n=>n.toString(16).padStart(2,"0")).join("")}`;};
 for(const [i,structure] of [scene.payload.before,scene.payload.after].entries()){
  let v=viewers[i];if(!v){v=mol.createViewer(containers[i]!,{backgroundColor:light?"#fafaf9":"#111417",antialias:true});viewers.push(v);
   containers[i]!.querySelector("canvas")?.addEventListener("webglcontextlost",event=>{event.preventDefault();if(!disposed)send({type:"error",message:"WEBGL_CONTEXT_LOST"});});
   v.setViewChangeCallback((view:number[])=>{if(sync&&!updating){updating=true;viewers[1-i]?.setView(view,true);updating=false;}});
  }
  v.clear();v.setBackgroundColor(light?"#fafaf9":"#111417",1);
  const atoms=displayAtoms(structure,[1,1,1]);const bonds=inferredBonds(atoms);const neighbors:number[][]=atoms.map(()=>[]);
  for(const [a,b] of bonds.pairs){neighbors[a]!.push(b);neighbors[b]!.push(a);}
  const model=v.addModel();model.addAtoms(atoms.map((a,j)=>({elem:a.element,x:a.position[0],y:a.position[1],z:a.position[2],serial:j,bonds:neighbors[j]!,bondOrder:neighbors[j]!.map(()=>1),properties:{sourceIndex:j}})));
  model.setStyle({},scene.style==="sphere"?{sphere:{scale:.6}}:scene.style==="stick"?{sphere:{radius:.18},stick:{radius:.16}}:{sphere:{scale:.26},stick:{radius:.12}});
  model.setColorByFunction({},(a:mol.AtomSpec)=>{const j=Number(a.properties?.sourceIndex);return i===1&&scene.colorBy!=="element"?gradient(magnitudes[j]!):`#${((mol.elementColors.Jmol[a.elem!]??0x969eaa) as number).toString(16).padStart(6,"0")}`;});
  if(scene.showCell)for(const [a,b] of cellEdges(structure.cell,[1,1,1]))v.addLine({start:{x:a[0],y:a[1],z:a[2]},end:{x:b[0],y:b[1],z:b[2]},color:light?"#585c62":"#8fa9ad",linewidth:1.5});
  if(preserved[i])v.setView(preserved[i],true);else{v.zoomTo();v.rotate(18,"y");v.rotate(12,"x");initial[i]=v.getView();}
  v.resize();v.render();
 }
 if(sync)viewers[1]!.setView(viewers[0]!.getView(),true);
 updating=false;send({type:"rendered"});
}
window.addEventListener("message",event=>{
 if(disposed||event.source!==parent||!(event.origin===location.origin||(location.protocol==="file:"&&event.origin==="null")))return;
 const parsed=comparisonCommandSchema.safeParse(event.data);if(!parsed.success)return;
 try{const command=parsed.data;if(command.type==="comparison")draw(command);else if(command.type==="dispose")dispose();else{updating=true;viewers.forEach((v,i)=>v.setView(initial[sync?0:i]!,true));updating=false;}}catch(e){send({type:"error",message:e instanceof Error?e.message:"COMPARISON_FAILED"});}
});
window.addEventListener("pagehide",dispose);send({type:"ready"});
