/** Pure local ranking shared by tools, Skills and catalogs; it never grants or executes. */
export interface SearchDocument {id:string;names?:readonly string[];text:readonly string[]}
export const normalizeSearch=(s:string)=>s.normalize('NFKC').toLowerCase().replace(/[–—−]/g,'-');
const concepts=[
 ['论文','文献','paper','papers','literature','publication','arxiv','bibliography','bibliographic','bibtex'],
 ['配方','水性涂料','涂料','formulation','recipe','recipes','coating','coatings','waterborne'],
 ['晶体','原子结构','结构','crystal','crystals','atomic','structure','structures'],
 ['能量','单点','energy','singlepoint','single-point'],['受力','forces','force'],
 ['势','机器学习势','potential','potentials','mlip'],['分子','molecule','molecular'],
 ['弛豫','优化结构','relax','relaxation'],['分子动力学','md','dynamics'],
 ['修复','调试','修','repair','fix','debug'],['代码','脚本','python','code','script'],
 ['搜索','检索','查找','查','找','search','find','lookup'],['读取','阅读','read','reading'],
 ['统计','平均','拟合','均值','statistic','statistics','mean','average','fit','regression'],
 ['拉伸','应力应变','tensile','stress-strain'],['实验设计','下一轮实验','design of experiments','doe','active learning','bayesian'],
 ['安装','install','installation'],['技能','skill','skills'],['长程','long-range','electrostatics'],
 ['离线','offline'],['数据','data','dataset'],['工艺','process','processing'],['图像','图片','image','images'],
 ['环境','依赖','environment','dependency','dependencies'],['文件','file','files'],['质量','quality','validation'],
];
const stop=new Set(['please','a','an','the','to','for','of','on','in','and','or','can','i','you','my','me','how','with','is','do','does','want','need','using','use','help','could','would','some','it']);
const has=(text:string,term:string)=>/[a-z]/.test(term)?new RegExp('(^|[^a-z0-9])'+term.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'([^a-z0-9]|$)').test(text):text.includes(term);
export function rankDocuments<T>(values:readonly T[],query:string,document:(value:T)=>SearchDocument){
 const q=normalizeSearch(query.trim().replace(/^@(?:skill:)?/,''));
 const groups=concepts.filter(g=>g.some(t=>has(q,t)));
 const aliasOnly=groups.some(g=>g.includes(q));
 const words=[...new Set(q.match(/[a-z0-9][a-z0-9_.:-]*|[\u3400-\u9fff]{2,}/g)??[])].filter(w=>!stop.has(w));
 return values.map((value,index)=>{
  const d=document(value),names=[d.id,...(d.names??[])].map(normalizeSearch),hay=normalizeSearch([...names,...d.text].join(' '));let score=0;
  if(!q)return {value,score:1,index};
  if(!aliasOnly&&/^[a-z][a-z0-9]+(?:[-_][a-z0-9]+)+$/.test(q)&&!hay.includes(q))return {value,score:0,index};
  if(names.includes(q))score+=10000;
  for(const n of names)if(n.length>2&&has(q,n))score+=1000;
  const matched=groups.filter(g=>g.some(t=>has(hay,t)));
  const specific=groups.filter(g=>!['搜索','读取','数据','文件'].includes(g[0]!));
  // Domain words in a reading request must not hide the approved generic reader.
  const sharedRead=matched.some(g=>g[0]==='读取');
  if(specific.length&&!matched.some(g=>specific.includes(g))&&!sharedRead&&!names.includes(q))return {value,score:0,index};
  score+=matched.length*24;
  for(const w of aliasOnly?[]:words)if(w.length>1&&hay.includes(w))score+=Math.min(100,w.length*4);
  // Chinese prose without spaces: preserve distinguishing local character pairs.
  for(const w of (aliasOnly?[]:words).filter(w=>/^[\u3400-\u9fff]+$/.test(w)&&w.length>2))for(let i=0;i<w.length-1;i++)if(hay.includes(w.slice(i,i+2)))score+=2;
  if(!aliasOnly&&hay.includes(q))score+=Math.min(180,q.length*6);
  return {value,score,index};
 }).filter(r=>r.score>0).sort((a,b)=>b.score-a.score||a.index-b.index);
}
