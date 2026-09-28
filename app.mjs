import {validate,histogram} from './model.mjs';
const $=id=>document.getElementById(id),palette=['#2853df','#c77a10','#14877c','#9b51b5'];
const defaultRules=multiplier=>[{metric:'revisions',minimum:multiplier},{metric:'revisions',minimum:2*multiplier},{metric:'publications',minimum:multiplier},{metric:'publications',minimum:2*multiplier}];
let policies=[{id:1,name:'Annual review',window:1,rules:defaultRules(1),color:palette[0]},{id:2,name:'Three-year rolling total',window:3,rules:defaultRules(3),color:palette[1]}];
let nextId=3,lastRun=null,busy=false,revision=0,previousSeed=0;
const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pct=n=>`${n.toLocaleString('en-US',{minimumFractionDigits:1,maximumFractionDigits:1})}%`;
const money=n=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}).format(n);
const shortMoney=n=>n<0?`−${shortMoney(-n)}`:n>=1e9?`$${(n/1e9).toFixed(1)}b`:n>=1e6?`$${(n/1e6).toFixed(2)}m`:n>=1000?`$${(n/1000).toFixed(0)}k`:money(n);
const compactPercent=n=>n>=1000?`${(n/1000).toFixed(1)}k%`:pct(n);
const defaults={bad:[0,1,2,3,4],good:[0,2,4,6,8]};
$('raise-rows').innerHTML=[4,3,2,1,0].map(i=>`<tr><td><span class="level-number">${i+1}</span></td>${['bad','good'].map(type=>`<td><input id="${type}-${i}" aria-label="Level ${i+1}, ${type} year raise percentage" type="number" min="0" max="30" step="0.5" value="${defaults[type][i]}" required></td>`).join('')}</tr>`).join('');
function windowDescription(p){return p.window===1?'Current-year totals. Reviewed every year.':`This year + the prior ${p.window-1} years. Rolling sum, reviewed every year.`;}
function renderPolicies(){
 $('policy-cards').innerHTML=policies.map((p,index)=>`<article class="policy-card" data-policy="${p.id}" style="--policy-color:${p.color}"><div class="policy-title-row"><span class="policy-letter">${String.fromCharCode(65+index)}</span><input class="policy-name" data-field="name" aria-label="Policy ${String.fromCharCode(65+index)} name" type="text" maxlength="50" value="${escape(p.name)}"><button type="button" class="delete-policy" data-delete="${p.id}" aria-label="Remove policy ${String.fromCharCode(65+index)}" ${policies.length===1?'disabled':''}>×</button></div><div class="window-row"><label for="window-${p.id}">Rolling window (years)</label><input id="window-${p.id}" data-field="window" aria-label="Policy ${String.fromCharCode(65+index)} rolling window years" type="number" min="1" max="40" step="1" value="${p.window}" required></div><p class="window-description">${windowDescription(p)}</p><table class="rules-table"><thead><tr><th scope="col">Level</th><th scope="col">At least</th><th scope="col">Output</th></tr></thead><tbody>${[3,2,1,0].map(i=>`<tr><td>${i+2}</td><td><input data-rule="${i}" data-rule-field="minimum" aria-label="Policy ${String.fromCharCode(65+index)} level ${i+2} threshold" type="number" min="1" step="1" value="${p.rules[i].minimum}" required></td><td><select data-rule="${i}" data-rule-field="metric" aria-label="Policy ${String.fromCharCode(65+index)} level ${i+2} output"><option value="publications" ${p.rules[i].metric==='publications'?'selected':''}>Publications</option><option value="revisions" ${p.rules[i].metric==='revisions'?'selected':''}>R&Rs</option></select></td></tr>`).join('')}<tr><td>1</td><td colspan="2" class="fallback">No higher rule met (including no output)</td></tr></tbody></table><p class="hint">Highest qualifying level wins. Counts are not added across output types.</p></article>`).join('');
 $('add-policy').disabled=policies.length>=4;
}
function markDirty(){revision++;if(lastRun){$('run-status').textContent='Inputs changed · run to update';$('run-status').classList.add('stale');$('run-caption').textContent='Results show the last completed simulation.';}}
$('policy-cards').addEventListener('input',event=>{const card=event.target.closest('[data-policy]');if(!card)return;const p=policies.find(x=>x.id===+card.dataset.policy),field=event.target.dataset.field;if(field)p[field]=field==='window'?(event.target.value===''?NaN:+event.target.value):event.target.value;if(event.target.dataset.rule!==undefined){const rule=p.rules[+event.target.dataset.rule],key=event.target.dataset.ruleField;rule[key]=key==='minimum'?(event.target.value===''?NaN:+event.target.value):event.target.value;}card.querySelector('.window-description').textContent=windowDescription(p);});
$('policy-cards').addEventListener('click',event=>{const button=event.target.closest('[data-delete]');if(!button||policies.length===1)return;policies=policies.filter(p=>p.id!==+button.dataset.delete);renderPolicies();markDirty();});
$('add-policy').addEventListener('click',()=>{if(policies.length>=4)return;const source=policies[policies.length-1],id=nextId++,color=palette.find(c=>!policies.some(p=>p.color===c));policies.push({...source,id,name:`Policy ${String.fromCharCode(64+id)}`,rules:structuredClone(source.rules),color});renderPolicies();markDirty();document.querySelector(`[data-policy="${id}"] .policy-name`).focus();});
$('scenario-form').addEventListener('input',event=>{updateAlternativeSummary();if(event.target.id==='good')$('good-output').textContent=`${event.target.value}%`;markDirty();});
const numeric=id=>$(id).value===''?NaN:Number($(id).value);
function readConfig(){return{meanMultiplier:numeric('mean-multiplier'),sdMultiplier:numeric('sd-multiplier'),years:numeric('years'),base:numeric('base'),goodProbability:numeric('good')/100,mean:numeric('mean'),sd:numeric('sd'),revisionMean:numeric('revision-mean'),revisionSd:numeric('revision-sd'),trials:numeric('trials'),raises:{bad:Array.from({length:5},(_,i)=>numeric(`bad-${i}`)),good:Array.from({length:5},(_,i)=>numeric(`good-${i}`))}};}
function freshSeed(){
 const draw=new Uint32Array(1);let seed;
 do{crypto.getRandomValues(draw);seed=draw[0]&0x7fffffff;}while(seed===0||seed===previousSeed);
 return seed;
}
function setError(message){$('input-error').textContent=message;$('input-error').hidden=!message;if(message)$('input-error').scrollIntoView({block:'nearest'});}
async function run(){
 if(busy)return;setError('');const config={...readConfig(),seed:freshSeed()},snapshot=structuredClone(policies),runRevision=revision;
 try{validate(config,snapshot);}catch(error){setError(error.message);return;}
 previousSeed=config.seed;$('seed').value=String(config.seed);
 busy=true;for(const id of ['run-button','run-top']){$(id).disabled=true;$(id).textContent='Simulating…';}$('run-status').textContent='Drawing research and salary histories…';$('run-status').classList.remove('stale');
 try{
  const data=await new Promise((resolve,reject)=>{const worker=new Worker(new URL('./worker.mjs',import.meta.url),{type:'module'});worker.onmessage=({data})=>{worker.terminate();data.ok?resolve(data.result):reject(new Error(data.error));};worker.onerror=()=>{worker.terminate();reject(new Error('The simulation could not load. Please reload the page and try again.'));};worker.postMessage({config,policies:snapshot});});
  lastRun=data;renderResults();$('run-status').textContent=`${config.trials.toLocaleString()} histories · ${config.years} years`;$('run-caption').textContent=`Results updated · seed ${config.seed}`;
  if(revision!==runRevision){$('run-status').textContent='Inputs changed · run to update';$('run-status').classList.add('stale');$('run-caption').textContent='Results show the last completed simulation.';}
 }catch(error){setError(error.message);$('run-status').textContent=lastRun?'Last completed simulation':'Simulation unavailable';}
 finally{busy=false;for(const id of ['run-button','run-top']){$(id).disabled=false;$(id).textContent='Run simulation';}}
}
$('scenario-form').addEventListener('submit',event=>{event.preventDefault();run();});
const typeColors=['#4263df','#138273'];
function updateAlternativeSummary(){
 const config=readConfig();
 const format=n=>Number.isFinite(n)?n.toLocaleString('en-US',{maximumFractionDigits:2}):'—';
 $('alternative-type-summary').innerHTML=`<strong>Alternative annual parameters</strong><span>Publications: mean ${format(config.mean*config.meanMultiplier)}, SD ${format(config.sd*config.sdMultiplier)}</span><span>R&Rs: mean ${format(config.revisionMean*config.meanMultiplier)}, SD ${format(config.revisionSd*config.sdMultiplier)}</span>`;
}
function statsTable(p,rows){
 return `<table class="type-stats" aria-label="${escape(p.name)} Average and Alternative researcher statistics"><thead><tr><th scope="col">Measure</th>${p.types.map((type,i)=>`<th scope="col" class="type-${type.key}"><span class="type-swatch" style="background:${typeColors[i]}"></span>${type.label}</th>`).join('')}</tr></thead><tbody>${rows.map((row,i)=>`<tr ${i===0?'class="primary-stat"':''}><th scope="row">${row.label}</th>${p.types.map(type=>`<td class="type-${type.key}" title="${escape(row.title?row.title(type):row.value(type))}">${row.value(type)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}
function classificationSection(p,index,config){
 const rows=[{label:'Mean level',value:t=>t.stats.classification.mean.toFixed(2)},{label:'Standard deviation',value:t=>t.stats.classification.sd.toFixed(2)},{label:'Assessments',value:t=>t.stats.classification.total.toLocaleString()}];
 return `<section class="outcome-section classification-section"><h4>Review classification · levels 1–5</h4>${statsTable(p,rows)}<div class="chart" data-metric="classification" data-policy-index="${index}"></div><p class="chart-note">${config.trials.toLocaleString()} histories × ${config.years} years per type. SD is in review levels.</p></section>`;
}
function comparisonSection(p,config,salary=false){
 const c=salary?p.salaryComparison:p.comparison,labels=['Alternative > Average','Tie','Average > Alternative'],keys=['higher','tied','lower'];
 const title=salary?'Alternative ends with a higher salary':'Alternative receives a higher evaluation over a year';
 const unit=salary?'researcher pairs':'annual review pairs';
 return `<section class="evaluation-comparison ${salary?'salary-comparison':''}" aria-label="${escape(p.name)} ${salary?'final salary':'evaluation'} comparison"><h4>${title}</h4><div class="comparison-value">${pct(c.higherShare*100)}</div><div class="comparison-bar" aria-hidden="true">${keys.map(key=>`<span class="comparison-${key}" style="width:${c[key+'Share']*100}%"></span>`).join('')}</div><dl class="comparison-breakdown">${keys.map((key,i)=>`<div><dt>${labels[i]}</dt><dd title="${c[key].toLocaleString()} ${unit}">${pct(c[key+'Share']*100)}</dd></div>`).join('')}</dl><p class="chart-note">${salary?`Final annual salary at year ${config.years} · `:''}${c.total.toLocaleString()} ${unit}. Ties do not count as higher.</p></section>`;
}
function salarySection(p,index,config,key){
 const growth=key==='ending',format=growth?pct:shortMoney,fullFormat=growth?pct:money;
 const rows=[{label:growth?'Mean growth':'Mean earnings',value:t=>format(t.stats[key].mean),title:t=>fullFormat(t.stats[key].mean)},{label:'Median',value:t=>format(t.stats[key].median),title:t=>fullFormat(t.stats[key].median)},{label:'Standard deviation',value:t=>growth?`${t.stats[key].sd.toFixed(1)} pp`:shortMoney(t.stats[key].sd),title:t=>growth?`${t.stats[key].sd.toFixed(1)} percentage points`:money(t.stats[key].sd)},{label:'10th percentile',value:t=>format(t.stats[key].p10),title:t=>fullFormat(t.stats[key].p10)},{label:'90th percentile',value:t=>format(t.stats[key].p90),title:t=>fullFormat(t.stats[key].p90)}];
 if(growth)rows.push({label:'Mean final salary',value:t=>shortMoney(config.base*(1+t.stats.ending.mean/100)),title:t=>money(config.base*(1+t.stats.ending.mean/100))});
 return `<section class="outcome-section"><h4>${growth?`Final salary growth · year ${config.years}`:`Total earnings - ${config.years} ${config.years===1?'year':'years'}`}</h4>${statsTable(p,rows)}<div class="chart" data-metric="${key}" data-policy-index="${index}"></div><p class="chart-note">${growth?'Growth from the same starting salary.':`Sum of all annual salaries over ${config.years} ${config.years===1?'year':'years'}, including base pay.`} Hover or tap bars for details.</p></section>`;
}
function renderResults(){
 const {results,config,researchers}=lastRun;$('policy-results').style.setProperty('--policy-count',results.length);
 $('policy-results').innerHTML=results.map((p,index)=>`<article class="result-column" style="--policy-color:${p.color}" aria-label="${escape(p.name)} results"><header class="result-heading"><h3><span class="result-letter">${String.fromCharCode(65+index)}</span>${escape(p.name)}</h3><p>${p.window===1?'Current-year totals':`${p.window}-year rolling totals`} · Annual salary review</p><div class="type-legend">${p.types.map((type,i)=>`<span><i class="type-swatch" style="background:${typeColors[i]}"></i>${type.label}${i?` · ${config.meanMultiplier}× mean · ${config.sdMultiplier}× SD`:''}</span>`).join('')}</div></header>${comparisonSection(p,config)}${classificationSection(p,index,config)}<section class="final-salary-group" aria-label="${escape(p.name)} final salary comparison and distribution">${comparisonSection(p,config,true)}${salarySection(p,index,config,'ending')}</section>${salarySection(p,index,config,'cumulative')}</article>`).join('');
 $('count-model-description').textContent=researchers.map(t=>`${t.label}: publications use the ${t.modelName.toLowerCase()}; R&Rs use the ${t.revisionModelName.toLowerCase()}.`).join(' ');
 renderCharts();
}
function renderCharts(){
 if(!lastRun)return;const{results,config}=lastRun;
 for(const metric of ['classification','ending','cumulative']) {
  const discrete=metric==='classification',series=results.flatMap(p=>p.types.map(t=>t[metric]));
  const distribution=discrete?{min:1,max:5,width:1,bins:5,counts:results.flatMap(p=>p.types.map(t=>t.levelCounts))}:histogram(series,18);
  const{min,max,width,bins,counts}=distribution,denominator=config.trials*(discrete?config.years:1);
  const maxShare=Math.max(...counts.flat())/denominator*100,yMax=Math.min(100,Math.max(5,Math.ceil(maxShare/5)*5));
  document.querySelectorAll(`[data-metric="${metric}"]`).forEach(container=>{
   const pi=+container.dataset.policyIndex,p=results[pi],format=metric==='ending'?pct:money;
   const chartWidth=Math.max(230,container.clientWidth),chartHeight=235,left=39,right=6,top=27,bottom=44,plotWidth=chartWidth-left-right,plotHeight=chartHeight-top-bottom,slot=plotWidth/bins;
   const y=value=>top+plotHeight*(1-value/yMax),svg=[],metricLabel=discrete?'review levels':metric==='ending'?'final salary growth':'total earnings';
   const description=discrete?p.types.map((t,i)=>`${t.label}: ${t.levelCounts.map((count,b)=>`level ${b+1} ${(count/denominator*100).toFixed(1)}%`).join(', ')}`).join('; '):'Average and Alternative researchers use the same bins and scales across policies.';
   svg.push(`<svg viewBox="0 0 ${chartWidth} ${chartHeight}" role="img" aria-label="${escape(p.name)}: ${metricLabel} histogram. ${escape(description)}"><text x="${left}" y="13" class="axis-caption">Share of ${discrete?'annual reviews':'histories'}</text>`);
   for(let i=0;i<=4;i++){const value=yMax*i/4,pos=y(value);svg.push(`<line x1="${left}" x2="${chartWidth-right}" y1="${pos}" y2="${pos}" stroke="#e7ecf3" ${i?'stroke-dasharray="3 4"':''}/><text x="${left-7}" y="${pos+4}" text-anchor="end">${value%1?value.toFixed(1):value}%</text>`);}
   for(let b=0;b<bins;b++)for(let type=0;type<2;type++){
    const count=counts[pi*2+type][b],share=count/denominator*100,yy=y(share),xx=left+slot*(b+.1+type*.4);
    const range=discrete?`Level ${b+1}`:`${format(min+b*width)} – ${format(min+(b+1)*width)}`,label=`${p.types[type].label} · ${range}: ${share.toFixed(2)}%, ${count.toLocaleString()} ${discrete?'assessments':'histories'}`;
    svg.push(`<rect class="bin-bar" data-bin="${b}" data-type="${type}" x="${xx}" y="${yy}" width="${slot*.37}" height="${top+plotHeight-yy}" fill="${typeColors[type]}" opacity=".85" rx="1" aria-label="${escape(label)}"><title>${escape(label)}</title></rect>`);
    if(discrete)svg.push(`<rect data-bin="${b}" data-type="${type}" x="${xx}" y="${top}" width="${slot*.4}" height="${plotHeight}" fill="transparent"/>`);
   }
   if(discrete)for(let b=0;b<bins;b++)svg.push(`<text x="${left+(b+.5)*slot}" y="${chartHeight-25}" text-anchor="middle">${b+1}</text>`);
   else {const ticks=chartWidth<330?2:3;for(let i=0;i<=ticks;i++){const value=min+(max-min)*i/ticks;svg.push(`<text x="${left+plotWidth*i/ticks}" y="${chartHeight-25}" text-anchor="${i===0?'start':i===ticks?'end':'middle'}">${metric==='ending'?compactPercent(value):shortMoney(value)}</text>`);}}
   svg.push(`<text x="${left+plotWidth/2}" y="${chartHeight-3}" text-anchor="middle" class="axis-caption">${discrete?'Review level':metric==='ending'?'Final salary growth (%)':'Total earnings ($)'}</text></svg><div class="chart-tooltip" hidden></div>`);container.innerHTML=svg.join('');
   const tooltip=container.querySelector('.chart-tooltip');
   function showTooltip(event){
    const bar=event.target.closest('[data-bin]');if(!bar){tooltip.hidden=true;return;}
    const b=+bar.dataset.bin,type=+bar.dataset.type,count=counts[pi*2+type][b],range=discrete?`Level ${b+1}`:`${format(min+b*width)} – ${format(min+(b+1)*width)}`;
    tooltip.innerHTML=`<strong>${p.types[type].label} · ${range}</strong><br>${(count/denominator*100).toFixed(2)}% · ${count.toLocaleString()} ${discrete?'assessments':'histories'}`;
    tooltip.hidden=false;const bounds=container.getBoundingClientRect();tooltip.style.left=`${Math.max(0,Math.min(event.clientX-bounds.left+8,bounds.width-tooltip.offsetWidth))}px`;tooltip.style.top=`${Math.max(0,event.clientY-bounds.top-tooltip.offsetHeight-8)}px`;
   }
   container.onpointermove=showTooltip;container.onclick=showTooltip;container.onpointerleave=()=>tooltip.hidden=true;
  });
 }
}
let resizeTimer;window.addEventListener('resize',()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(renderCharts,100);});
renderPolicies();updateAlternativeSummary();run();
