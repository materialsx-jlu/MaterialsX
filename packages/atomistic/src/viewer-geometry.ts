import type { AtomicStructure } from "../../contracts/src/atomistic.js";
export type Point = [number,number,number];
export interface DisplayAtom {sourceIndex:number;id:string;element:string;position:Point;replica:Point;occupancy:number;forceMagnitude:number|null}
export const DISPLAY_ATOM_LIMIT=4096;
// Approximate common-element radii in Å; unsupported elements are left unbonded.
// Visual adjacency only: neither oxidation states nor chemical bond orders are inferred.
const radii:Record<string,number>={H:.31,He:.28,Li:1.28,Be:.96,B:.84,C:.76,N:.71,O:.66,F:.57,Ne:.58,Na:1.66,Mg:1.41,Al:1.21,Si:1.11,P:1.07,S:1.05,Cl:1.02,Ar:1.06,K:2.03,Ca:1.76,Sc:1.7,Ti:1.6,V:1.53,Cr:1.39,Mn:1.39,Fe:1.32,Co:1.26,Ni:1.24,Cu:1.32,Zn:1.22,Ga:1.22,Ge:1.2,As:1.19,Se:1.2,Br:1.2,Kr:1.16,Zr:1.75,Nb:1.64,Mo:1.54,Ru:1.46,Rh:1.42,Pd:1.39,Ag:1.45,Cd:1.44,In:1.42,Sn:1.39,Sb:1.39,Te:1.38,I:1.39,W:1.62,Pt:1.36,Au:1.36,Hg:1.32,Pb:1.46};
export function displayAtoms(structure:AtomicStructure,repeats:Point,forces:Point[]|null=null):DisplayAtom[] {
  if(repeats.some(n=>!Number.isInteger(n)||n<1||n>3))throw Error("INVALID_SUPERCELL");
  if(repeats.some((n,i)=>n!==1&&!structure.pbc[i]))throw Error("NONPERIODIC_AXIS");
  if(structure.atoms.length*repeats[0]*repeats[1]*repeats[2]>DISPLAY_ATOM_LIMIT)throw Error("DISPLAY_ATOM_LIMIT_4096");
  if(forces&&forces.length!==structure.atoms.length)throw Error("FORCE_COUNT_MISMATCH");
  const atoms:DisplayAtom[]=[];
  for(let x=0;x<repeats[0];x++)for(let y=0;y<repeats[1];y++)for(let z=0;z<repeats[2];z++) {
    const replica:Point=[x,y,z];
    structure.atoms.forEach((atom,sourceIndex)=>{
      const position=atom.position.map((v,j)=>v+replica.reduce((sum,n,i)=>sum+n*(structure.cell?.[i]?.[j]??0),0)) as Point;
      if(position.some(v=>!Number.isFinite(v)||Math.abs(v)>1e6))throw Error("DISPLAY_COORDINATE_LIMIT");
      const force=forces?.[sourceIndex];const magnitude=force?Math.hypot(...force):null;
      if(magnitude!==null&&!Number.isFinite(magnitude))throw Error("DISPLAY_FORCE_LIMIT");
      atoms.push({sourceIndex,id:atom.id,element:atom.element,position,replica,occupancy:atom.occupancy,forceMagnitude:magnitude});
    });
  }return atoms;
}
export function cellEdges(cell:AtomicStructure["cell"],repeats:Point):Array<[Point,Point]> {
  if(!cell)return [];
  const vertices:Point[]=Array.from({length:8},(_,i)=>[0,1,2].map(j=>cell.reduce((sum,v,k)=>sum+(((i>>k)&1)*repeats[k]!)*v[j]!,0)) as Point);
  if(vertices.some(p=>p.some(v=>!Number.isFinite(v)||Math.abs(v)>1e6)))throw Error("DISPLAY_CELL_LIMIT");
  const edges:Array<[Point,Point]>=[];for(let i=0;i<8;i++)for(let k=0;k<3;k++)if(!(i&(1<<k)))edges.push([vertices[i]!,vertices[i|(1<<k)]!]);return edges;
}
export const distance=(a:Point,b:Point)=>Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2]);
/** Cartesian distance of selected display replicas; never mislabeled minimum-image. */
export function angle(a:Point,b:Point,c:Point):number|null {
  const ab=a.map((v,i)=>v-b[i]!) as Point,cb=c.map((v,i)=>v-b[i]!) as Point;
  const denominator=Math.hypot(...ab)*Math.hypot(...cb);if(denominator<1e-12)return null;
  return Math.acos(Math.max(-1,Math.min(1,ab.reduce((s,v,i)=>s+v*cb[i]!,0)/denominator)))*180/Math.PI;
}
export function inferredBonds(atoms:DisplayAtom[]):{pairs:Array<[number,number]>;limited:boolean;unsupported:string[]} {
  const pairs:Array<[number,number]>=[],grid=new Map<string,number[]>(),degrees=new Uint8Array(atoms.length);
  const width=5,key=(x:number,y:number,z:number)=>`${x},${y},${z}`;
  atoms.forEach((a,i)=>{const p=a.position.map(v=>Math.floor(v/width));const k=key(p[0]!,p[1]!,p[2]!);const bucket=grid.get(k)??[];bucket.push(i);grid.set(k,bucket);});
  const unsupported=[...new Set(atoms.filter(a=>!radii[a.element]).map(a=>a.element))];let checks=0;
  for(let i=0;i<atoms.length;i++) {
    const a=atoms[i]!,r=radii[a.element];if(!r)continue;const p=a.position.map(v=>Math.floor(v/width));
    for(let x=-1;x<=1;x++)for(let y=-1;y<=1;y++)for(let z=-1;z<=1;z++)for(const j of grid.get(key(p[0]!+x,p[1]!+y,p[2]!+z))??[]) {
      if(j<=i)continue;if(++checks>200_000)return {pairs:[],limited:true,unsupported};
      const b=atoms[j]!,s=radii[b.element];if(!s)continue;const d=distance(a.position,b.position);
      if(d>.35&&d<1.2*(r+s)) {
        if(pairs.length>=12000||degrees[i]!>=24||degrees[j]!>=24)return {pairs:[],limited:true,unsupported};
        pairs.push([i,j]);degrees[i]=degrees[i]!+1;degrees[j]=degrees[j]!+1;
      }
    }
  }return {pairs,limited:false,unsupported};
}
