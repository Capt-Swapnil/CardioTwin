const fs=require('fs'), vm=require('vm'), assert=require('assert/strict');
const path=__dirname+require('path').sep;
const C=require(path+'control.js');
let code=fs.readFileSync(path+'app.js','utf8').replace('    // ─── Boot','    globalThis.model={simulate, synthesizeECG, SCENARIOS, BASELINE};\n    // ─── Boot');
const ctx={document:{readyState:'loading',addEventListener(){}}}; vm.runInNewContext(code,ctx);
const {simulate,SCENARIOS,BASELINE}=ctx.model;
const records={};
for(const scenario of Object.keys(SCENARIOS)) {
 const data=simulate({...BASELINE,...SCENARIOS[scenario],scenario,duration:20});
 const result=C.compare(data); records[scenario]=result;
 for(const run of Object.values(result.runs)) {
  assert(run.hr.every(Number.isFinite)); assert(run.estimatedRate.every(Number.isFinite));
  assert.equal(run.metrics.effort,run.pulses.length);
  for(let i=0;i<run.pulses.length;i++) {
   const p=run.pulses[i]; assert(p.time>=3);
   if(i) assert(p.time-run.pulses[i-1].time>=.5-1e-9,'pulse rate constraint');
   const previous=run.beats.filter(b=>b.time<p.time-1e-9).at(-1);
   if(previous) assert(p.time-previous.time>=.25-1e-9,'refractory constraint');
  }
 }
 const a=result.runs.uncontrolled,b=result.runs.mpc;
 for(let i=0;i<60;i++) assert.equal(a.hr[i],b.hr[i],'identical pre-control plant');
 console.log(scenario, Object.fromEntries(Object.entries(result.runs).map(([mode,r])=>[mode,{rmse:r.metrics.rmse,pulses:r.metrics.pulseCount,settling:r.metrics.settling}])));
}
assert(records.bradycardia.runs.mpc.metrics.rmse<records.bradycardia.runs.uncontrolled.metrics.rmse);
assert(records.block.runs.mpc.metrics.rmse<records.block.runs.uncontrolled.metrics.rmse);
assert.equal(records.tachycardia.runs.mpc.metrics.settling,null);
assert.equal(records.sinus.runs.mpc.pulses.length,0,'no unnecessary baseline pulses');
// Metrics: known constant error integrates exactly and short records never settle.
const t=Float64Array.from({length:101},(_,i)=>i*.05);
let m=C.measure(t,new Float64Array(101).fill(62),[],C.configWithDefaults({enableTime:1}));
assert(Math.abs(m.rmse-10)<1e-10);assert(Math.abs(m.iae-40)<1e-10);assert.equal(m.settling,null);
m=C.measure(t,new Float64Array(101).fill(72),[],C.configWithDefaults({enableTime:3}));
assert.equal(m.settling,null);assert.equal(m.settlingStatus,'Window too short');
const late=new Float64Array(101).fill(72);late[99]=90;
assert.equal(C.measure(t,late,[],C.configWithDefaults({enableTime:0})).settling,null);
assert.equal(C.measure(t,new Float64Array(101).fill(72),[],C.configWithDefaults({enableTime:0})).settling,0);
// Timing changes in the future cannot alter earlier control actions.
function synthetic(period,duration=12){const beats=[];for(let time=-3;time<=duration+3;time+=period)beats.push({time,type:'normal'});return{params:{duration},sourceBeats:beats};}
const first=synthetic(.9), second=structuredClone(first);
for(const b of second.sourceBeats) if(b.time>6) b.time=6+(b.time-6)*1.3;
const x=C.compare(first),y=C.compare(second);
for(let i=0;i<100;i++) assert.equal(x.runs.mpc.input[i],y.runs.mpc.input[i]);
// Adaptation follows a new intrinsic rate without being handed its value.
const changing=synthetic(1); const changeTime=6;
for(const b of changing.sourceBeats) if(b.time>changeTime) b.time=changeTime+(b.time-changeTime)*1.5;
const adapted=C.compare(changing);
assert(Math.abs(adapted.runs.mpc.estimatedRate.at(-1)-2/3)<.02);
// Tuning must influence decisions; MPC is not an alias for the reactive timer.
const low=C.compare(first,{effortWeight:0}); const high=C.compare(first,{effortWeight:2});
assert(low.runs.mpc.pulses.length>high.runs.mpc.pulses.length,'effort tradeoff');
assert.notDeepEqual(high.runs.mpc.input,high.runs.reactive.input);
assert.deepEqual(C.compare(first).runs.mpc.input,x.runs.mpc.input,'repeatability');
// Zero native conduction: paced beats still capture; uncontrolled rate is absent.
const stopped={params:{duration:12},sourceBeats:[]}; const z=C.compare(stopped);
assert(z.runs.uncontrolled.hr.every(v=>v===0));assert(z.runs.mpc.pulses.length>0);
assert(C.compare(stopped,{enableTime:20}).runs.mpc.metrics.rmse===null);
assert.throws(()=>C.compare(first,{target:NaN}));assert.throws(()=>C.compare(first,{horizon:0}));
console.log('Control constraints, shared plant, metrics, causality, online adaptation, tuning, capture and repeatability: passed.');
