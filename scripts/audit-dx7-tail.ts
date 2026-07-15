// Layer 1 report: 哪些 seed 的 DX7/EP(program 4/5)lead/comp 被命中 + tail 怎么处理(lead 连接到下一音+CC72 release·comp 无 blanket pedal)。
import { generateMusicSync } from '../src/core/generation/musicGeneration/MusicGenerationService';
const CASES: [number,string][] = [[4,'pop'],[1,'pop'],[3,'rnb'],[7,'rnb'],[1,'lofi'],[7,'lofi'],[42,'lofi'],[0,'jazz'],[7,'jazz'],[11,'pop']];
const L: string[] = ['# DX7 / Electric-Key Tail Report (Layer 1)','','program 4/5=电钢(EP1 Rhodes / EP2 DX7)。lead tail=音符门限延到下一音前 + CC72 release 增强；comp 不再使用 blanket pedal，避免和声层糊成一片。',''];
L.push('| seed/style | lead prog | lead CC72 | lead CC64(应0) | comp prog | comp CC64/pedal |');
L.push('|---|---|---|---|---|---|');
let hitLead=0, hitComp=0;
for(const [seed,style] of CASES){
  const r=generateMusicSync({seed,styleHint:style,mood:'build',targetDuration:90});
  const lead=r.ir!.tracks.find(t=>t.role==='lead'); const comp=r.ir!.tracks.find(t=>t.role==='comp');
  const ccOf=(t:any,c:number)=>(t?.ccEvents??[]).filter((e:any)=>(e.controller??e.data1)===c).length;
  const pedOf=(t:any)=>(t?.pedalEvents??[]).length;
  const lp=lead?.program, cp=comp?.program;
  const leadCC72=ccOf(lead,72), leadCC64=ccOf(lead,64)+pedOf(lead), compCC64=ccOf(comp,64)+pedOf(comp);
  const leadEP=lp===4||lp===5, compEP=cp===4||cp===5;
  if(leadEP)hitLead++; if(compEP)hitComp++;
  L.push(`| ${seed}/${style} | ${lp}${leadEP?'★EP':''} | ${leadCC72} | ${leadCC64} | ${cp}${compEP?'★EP':''} | ${compCC64} |`);
}
L.push(''); L.push(`## 命中:EP lead ${hitLead} · EP comp ${hitComp}(共 ${CASES.length} 例)`);
console.log(L.join('\n'));
import {writeFileSync,mkdirSync} from 'fs'; mkdirSync('docs/generated',{recursive:true}); writeFileSync('docs/generated/dx7_tail_report.md',L.join('\n'));
