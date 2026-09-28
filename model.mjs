export function randomSource(seed) {
  let state = seed >>> 0;
  return () => { state = (state + 0x6D2B79F5) >>> 0; let t = state; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function probabilityTable(weights) {
  const total=weights.reduce((sum,p)=>sum+p,0), probabilities=weights.map(p=>p/total);
  const mean=probabilities.reduce((sum,p,n)=>sum+n*p,0);
  const variance=probabilities.reduce((sum,p,n)=>sum+p*(n-mean)**2,0);
  return {probabilities,mean,variance};
}
function underdispersedTable(alpha,beta) {
  // Normalized, naturally truncated Consul–Jain GP. For beta<0 the usual
  // infinite-support moment formulas do NOT hold (Scollnik, 1998).
  const logs=[-alpha];let logFactorial=0,maxLog=-alpha;
  for(let n=1;n<10000;n++) {
    const rate=alpha+beta*n;if(rate<=0)break;
    logFactorial+=Math.log(n);
    const value=Math.log(alpha)+(n-1)*Math.log(rate)-rate-logFactorial;
    logs.push(value);maxLog=Math.max(maxLog,value);
    if(n>3&&value<maxLog-45&&value<logs[n-1])break;
    if(n===9999)throw new Error('Generalized Poisson support is too large to calibrate reliably.');
  }
  return probabilityTable(logs.map(value=>Math.exp(value-maxLog)));
}
function calibrateUnderdispersion(mean,variance) {
  // Optimize log(alpha), log(-beta) to preserve the parameter signs.
  const initialBeta=1-Math.sqrt(mean/variance),initialAlpha=mean*(1-initialBeta);
  const residual=(a,b)=>{
    const table=underdispersedTable(Math.exp(a),-Math.exp(b));
    return {table,r:[(table.mean-mean)/Math.max(1,mean),(table.variance-variance)/Math.max(.1,variance)]};
  };
  for(const factor of [1,.5,2]) {
    // Away from the Bernoulli boundary, start with at least three support
    // points; a two-point support has a singular two-moment Jacobian.
    const startBeta=-initialBeta*factor,minSupport=Math.max(2,Math.floor(mean)+1);
    let a=Math.log(Math.max(initialAlpha,startBeta*(minSupport+.25))),b=Math.log(startBeta);
    for(let iteration=0;iteration<60;iteration++) {
      const current=residual(a,b),[r0,r1]=current.r,loss=r0*r0+r1*r1;
      if(Math.max(Math.abs(r0),Math.abs(r1))<1e-10)return {...current.table,alpha:Math.exp(a),beta:-Math.exp(b)};
      const h=1e-5,da=residual(a+h,b).r,db=residual(a,b+h).r;
      const j00=(da[0]-r0)/h,j10=(da[1]-r1)/h,j01=(db[0]-r0)/h,j11=(db[1]-r1)/h,det=j00*j11-j01*j10;
      if(!Number.isFinite(det)||Math.abs(det)<1e-15)break;
      let stepA=(j11*r0-j01*r1)/det,stepB=(-j10*r0+j00*r1)/det;
      const bound=Math.max(1,Math.abs(stepA)/2,Math.abs(stepB)/2);stepA/=bound;stepB/=bound;
      let improved=false;
      for(let scale=1;scale>=1/4096;scale/=2) {
        const nextA=a-scale*stepA,nextB=b-scale*stepB;
        if(Math.abs(nextA)>25||Math.abs(nextB)>25)continue;
        const next=residual(nextA,nextB).r;
        if(next[0]**2+next[1]**2<loss){a=nextA;b=nextB;improved=true;break;}
      }
      if(!improved)break;
    }
  }
  throw new Error('These mean and standard deviation values could not be matched reliably by the generalized Poisson model. Try a larger standard deviation.');
}
function overdispersedTable(mean,variance) {
  const beta=1-Math.sqrt(mean/variance),alpha=mean*(1-beta),secondMoment=variance+mean*mean;
  const probabilities=[Math.exp(-alpha)];let mass=probabilities[0],first=0,second=0,p=probabilities[0];
  // Stable PMF recurrence, retaining the tail until both its probability and
  // contributions to the first two moments are negligible.
  for(let n=1;n<=1000000;n++) {
    if(n===1)p*=alpha*Math.exp(-beta);
    else {const previous=alpha+beta*(n-1);p*=previous/n*Math.exp(-beta+(n-1)*Math.log1p(beta/previous));}
    probabilities.push(p);mass+=p;first+=n*p;second+=n*n*p;
    if(n>mean&&Math.abs(1-mass)<1e-11&&Math.abs(first-mean)<1e-9*Math.max(1,mean)&&Math.abs(second-secondMoment)<1e-9*Math.max(1,secondMoment))return {...probabilityTable(probabilities),alpha,beta};
  }
  throw new Error('This generalized Poisson tail is too long to simulate reliably. Increase the mean or reduce the standard deviation.');
}
function withSampler(table,description,name='Generalized Poisson count model') {
  const cdf=new Float64Array(table.probabilities.length);let cumulative=0;
  for(let n=0;n<cdf.length;n++){cumulative+=table.probabilities[n];cdf[n]=cumulative;}cdf[cdf.length-1]=1;
  return {...table,name,description,sample:rng=>{
    const u=rng();let lo=0,hi=cdf.length-1;
    while(lo<hi){const mid=(lo+hi)>>>1;if(u<cdf[mid])hi=mid;else lo=mid+1;}return lo;
  }};
}
export function countModel(mean, sd, label='Publication') {
  if (!Number.isFinite(mean) || !Number.isFinite(sd) || mean < 0 || sd < 0) throw new Error(`${label} mean and standard deviation must be nonnegative numbers.`);
  if (mean === 0 && sd > 0) throw new Error(`A ${label.toLowerCase()} mean of 0 requires a standard deviation of 0.`);
  const lower = Math.floor(mean), fraction = mean - lower, variance = sd * sd, minVariance = fraction * (1 - fraction);
  if (variance < minVariance - 1e-10) throw new Error(`Whole ${label.toLowerCase()} counts with mean ${mean} require a standard deviation of at least ${Math.sqrt(minVariance).toFixed(3)}. Increase the standard deviation or use a whole-number mean.`);
  if(sd===0){
    if(!Number.isInteger(mean))throw new Error(`${label}: zero standard deviation requires a whole-number mean.`);
    return {name:'Deterministic count model (zero SD)',description:`Annual ${label.toLowerCase()} counts are fixed at ${mean}.`,mean,variance:0,probabilities:Array.from({length:mean+1},(_,n)=>n===mean?1:0),sample:rng=>{rng();return mean;}};
  }
  if(variance<=minVariance+1e-12&&mean>=1)throw new Error(`${label}: this minimum variance requires a two-point distribution, which a finite-parameter generalized Poisson cannot match. Increase the standard deviation slightly.`);
  let table;
  if(mean<1&&Math.abs(variance-minVariance)<1e-12) {
    // A normalized GP with support {0,1} attains the Bernoulli boundary.
    let lo=0,hi=128;const logOdds=Math.log(mean/(1-mean));
    for(let i=0;i<80;i++){const mid=(lo+hi)/2;if(Math.log(mid)+.75*mid<logOdds)lo=mid;else hi=mid;}
    const alpha=(lo+hi)/2,beta=-.75*alpha;table={...underdispersedTable(alpha,beta),alpha,beta};
  } else table=variance<mean?calibrateUnderdispersion(mean,variance):overdispersedTable(mean,variance);
  return withSampler(table,`Annual ${label.toLowerCase()} counts follow a generalized Poisson distribution calibrated to the specified mean and standard deviation. Negative dispersion uses normalized finite-support probabilities.`,Math.abs(variance-mean)<1e-12?'Generalized Poisson count model (Poisson special case)':'Generalized Poisson count model');
}
export function reviewLevel(publications, revisions, rules) {
  let level=0;
  for(let i=0;i<4;i++) if((rules[i].metric==='publications'?publications:revisions)>=rules[i].minimum)level=i+1;
  return level;
}
export function evaluatePath(publications, revisions, goodYears, policy, raises, base) {
  if(publications.length!==revisions.length||publications.length-goodYears.length<policy.window-1)throw new Error('Each research history must include a complete opening review window.');
  const offset = publications.length - goodYears.length, prefix = new Float64Array(publications.length + 1), revisionPrefix=new Float64Array(revisions.length+1);
  for(let i=0;i<publications.length;i++) {prefix[i+1]=prefix[i]+publications[i];revisionPrefix[i+1]=revisionPrefix[i]+revisions[i];}
  let salary = base, totalEarnings = 0;
  for(let t=0;t<goodYears.length;t++) {
    const end = offset + t + 1, total = prefix[end] - prefix[end - policy.window], revisionTotal=revisionPrefix[end]-revisionPrefix[end-policy.window];
    const level = reviewLevel(total,revisionTotal,policy.rules);
    salary *= 1 + raises[goodYears[t] ? 'good' : 'bad'][level] / 100;
    totalEarnings += salary;
  }
  return {ending:100 * (salary / base - 1), cumulative:totalEarnings};
}
export function researcherTypes(config) {
  const {mean,sd,revisionMean,revisionSd}=config,meanMultiplier=config.meanMultiplier??2,sdMultiplier=config.sdMultiplier??2;
  return [
    {key:'low',label:'Average',mean,sd,revisionMean,revisionSd},
    {key:'high',label:'Alternative',mean:mean*meanMultiplier,sd:sd*sdMultiplier,revisionMean:revisionMean*meanMultiplier,revisionSd:revisionSd*sdMultiplier}
  ];
}
export function validate(config, policies) {
  const {years,base,mean,sd,revisionMean,revisionSd,goodProbability,trials,seed,raises} = config;
  if(!Number.isInteger(years)||years<1||years>40) throw new Error('Enter a time horizon from 1 to 40 whole years.');
  if(!Number.isFinite(base)||base<=0||base>10000000) throw new Error('Enter a starting salary greater than 0 and no more than 10,000,000.');
  if(mean>30||sd>30||revisionMean>30||revisionSd>30) throw new Error('Research output means and standard deviations must be no more than 30.');
  for(const [label,multiplier] of [['mean',config.meanMultiplier??2],['standard deviation',config.sdMultiplier??2]]) {
    if(!Number.isFinite(multiplier)||multiplier<1||multiplier>10)throw new Error(`Use an Alternative ${label} multiplier between 1 and 10.`);
  }
  for(const type of researcherTypes(config)) {
    try{countModel(type.mean,type.sd,`${type.label} publication`);countModel(type.revisionMean,type.revisionSd,`${type.label} R&R`);}
    catch(error){throw new Error(`${type.label} researcher: ${error.message}`);}
  }
  if(!Number.isFinite(goodProbability)||goodProbability<0||goodProbability>1) throw new Error('The good-year probability must be between 0% and 100%.');
  if(!Number.isInteger(trials)||trials<1||trials>100000) throw new Error('Use between 1 and 100,000 simulated histories.');
  if(!Number.isInteger(seed)||seed<1||seed>2147483647) throw new Error('Enter a random seed from 1 to 2,147,483,647.');
  for (const type of ['good','bad']) if(raises[type].length!==5||raises[type].some(r=>!Number.isFinite(r)||r<0||r>30||Math.abs(r*2-Math.round(r*2))>1e-9)) throw new Error('Each raise must be between 0% and 30%, in 0.5 percentage-point increments.');
  if(policies.length<1||policies.length>4) throw new Error('Compare between one and four policies.');
  for (const p of policies) {
    if(!p.name.trim()) throw new Error('Give each review policy a name.');
    if(!Number.isInteger(p.window)||p.window<1||p.window>40) throw new Error(`${p.name}: use a rolling window from 1 to 40 whole years.`);
    if(!Array.isArray(p.rules)||p.rules.length!==4||p.rules.some(rule=>!['publications','revisions'].includes(rule.metric)||!Number.isInteger(rule.minimum)||rule.minimum<1)) throw new Error(`${p.name}: every threshold must be a positive whole number, with either publications or R&Rs selected.`);
  }
}
export function quantile(sorted, q) { const position=(sorted.length-1)*q, lower=Math.floor(position), upper=Math.ceil(position); return sorted[lower]+(sorted[upper]-sorted[lower])*(position-lower); }
export function summarize(values) {
  const sorted=Float64Array.from(values).sort();
  let mean=0,squaredDeviations=0,count=0;
  // Welford's update avoids subtracting large squared salaries. Divide by N
  // to describe the complete simulated outcome distribution (population SD).
  for(const value of values){count++;const difference=value-mean;mean+=difference/count;squaredDeviations+=difference*(value-mean);}
  return {mean,sd:Math.sqrt(Math.max(0,squaredDeviations/count)),median:quantile(sorted,.5),p10:quantile(sorted,.1),p90:quantile(sorted,.9),min:sorted[0],max:sorted[sorted.length-1]};
}
export function summarizeClassifications(counts) {
  const total=counts.reduce((sum,count)=>sum+count,0);
  const mean=counts.reduce((sum,count,index)=>sum+count*(index+1),0)/total;
  const variance=counts.reduce((sum,count,index)=>sum+count*(index+1-mean)**2,0)/total;
  return {total,mean,sd:Math.sqrt(variance),shares:counts.map(count=>count/total)};
}
export function compareFinalSalaries(lowSalary,highSalary) {
  // Ignore only round-off from at most 40 years of compounding; do not round
  // salaries to dollars/cents before comparison.
  const tolerance=128*Number.EPSILON*Math.max(1,Math.abs(lowSalary),Math.abs(highSalary));
  return Math.abs(highSalary-lowSalary)<=tolerance?'tied':highSalary>lowSalary?'higher':'lower';
}
export function simulate(config, policies) {
  validate(config,policies);
  const {years,base,trials,seed,raises,goodProbability}=config;
  // Independent output streams across types; the low streams retain their
  // previous seeds. Both types share economic conditions. Neither policy order
  // nor the Alternative multipliers change the Average paths.
  const salts=[[0xA341316C,0xAD90777D,0x7E95761E,0x9E3779B9],[0x3C6EF372,0xBB67AE85,0x510E527F,0x1F83D9AB]];
  const warmup=39,goodYears=new Uint8Array(years),yearRng=randomSource(seed ^ 0xC8013EA4);
  const types=researcherTypes(config).map((type,i)=>({...type,model:countModel(type.mean,type.sd),revisionModel:countModel(type.revisionMean,type.revisionSd,'R&R'),rng:salts[i].map(salt=>randomSource(seed^salt)),prefix:new Float64Array(warmup+years+1),revisionPrefix:new Float64Array(warmup+years+1)}));
  const results=policies.map(p=>({...p,rules:p.rules.map(rule=>({...rule})),types:types.map(type=>({key:type.key,label:type.label,ending:new Float64Array(trials),cumulative:new Float64Array(trials),levelCounts:[0,0,0,0,0]})),comparison:{higher:0,tied:0,lower:0,total:trials*years},salaryComparison:{higher:0,tied:0,lower:0,total:trials}}));
  const lowLevels=new Uint8Array(years);
  for(let n=0;n<trials;n++) {
    for(let t=0;t<years;t++)goodYears[t]=yearRng()<goodProbability?1:0;
    for(const type of types) {
      const {prefix,revisionPrefix,model,revisionModel,rng}=type;
      prefix[0]=0;revisionPrefix[0]=0;
      for(let t=0;t<warmup;t++){prefix[t+1]=prefix[t]+model.sample(rng[1]);revisionPrefix[t+1]=revisionPrefix[t]+revisionModel.sample(rng[3]);}
      for(let t=0;t<years;t++){prefix[warmup+t+1]=prefix[warmup+t]+model.sample(rng[0]);revisionPrefix[warmup+t+1]=revisionPrefix[warmup+t]+revisionModel.sample(rng[2]);}
    }
    for(const result of results) {
      let lowFinalSalary;
      for(let i=0;i<types.length;i++) {
        const {prefix,revisionPrefix}=types[i],outcome=result.types[i];let salary=base,totalEarnings=0;
        for(let t=0;t<years;t++) {
          const end=warmup+t+1,total=prefix[end]-prefix[end-result.window],revisionTotal=revisionPrefix[end]-revisionPrefix[end-result.window];
          const level=reviewLevel(total,revisionTotal,result.rules);outcome.levelCounts[level]++;
          if(i===0)lowLevels[t]=level;
          else result.comparison[level>lowLevels[t]?'higher':level===lowLevels[t]?'tied':'lower']++;
          salary*=1+raises[goodYears[t]?'good':'bad'][level]/100;totalEarnings+=salary;
        }
        outcome.ending[n]=100*(salary/base-1);outcome.cumulative[n]=totalEarnings;
        if(i===0)lowFinalSalary=salary;
        else result.salaryComparison[compareFinalSalaries(lowFinalSalary,salary)]++;
      }
    }
  }
  for(const result of results){
    for(const type of result.types)type.stats={ending:summarize(type.ending),cumulative:summarize(type.cumulative),classification:summarizeClassifications(type.levelCounts)};
    for(const comparison of [result.comparison,result.salaryComparison])for(const key of ['higher','tied','lower'])comparison[`${key}Share`]=comparison[key]/comparison.total;
  }
  return {config,results,researchers:types.map(({key,label,mean,sd,revisionMean,revisionSd,model,revisionModel})=>({key,label,mean,sd,revisionMean,revisionSd,modelName:model.name,revisionModelName:revisionModel.name}))};
}
export function histogram(series, bins=24) {
  let min=Infinity,max=-Infinity;
  for(const values of series) for(const value of values) {if(value<min)min=value;if(value>max)max=value;}
  if(max-min<1e-8) {const pad=Math.max(1,Math.abs(min)*.05);min-=pad;max+=pad;}
  const width=(max-min)/bins;
  return {min,max,width,bins,counts:series.map(values=>{const counts=new Array(bins).fill(0);for(const value of values)counts[Math.max(0,Math.min(bins-1,Math.floor((value-min)/width)))]++;return counts;})};
}
