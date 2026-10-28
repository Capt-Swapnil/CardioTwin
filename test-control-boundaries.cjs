const C=require('./control.js');
const assert=require('assert/strict');
for(const target of [40,120])for(const horizon of [.5,3])for(const effortWeight of [0,5]){
 const d={params:{duration:60},sourceBeats:[]};const r=C.compare(d,{target,horizon,effortWeight});
 for(const run of Object.values(r.runs)) {assert(run.hr.every(Number.isFinite));assert(Number.isFinite(run.metrics.rmse));for(let i=1;i<run.pulses.length;i++)assert(run.pulses[i].time-run.pulses[i-1].time>=.5-1e-8);}
}
console.log('60-second simulations, horizon/target/effort extremes: passed.');
