const fs = require('fs');
const vm = require('vm');
let source = fs.readFileSync(require('path').join(__dirname,'app.js'), 'utf8');
source = source.replace('    // ─── Boot', '    globalThis.model = { simulate, rhythmMetrics, SCENARIOS, BASELINE };\n    // ─── Boot');
const sandbox = { document: { readyState: 'loading', addEventListener() {} } };
vm.runInNewContext(source, sandbox);
const {simulate, rhythmMetrics, SCENARIOS, BASELINE} = sandbox.model;
const assert = require('assert/strict');
const runs = {};
for (const scenario of Object.keys(SCENARIOS)) {
 const params = {...BASELINE, ...SCENARIOS[scenario], scenario};
 const data = simulate(params);
 const m = rhythmMetrics(data);
 runs[scenario] = {data, m};
 for (const key of ['t','xSA','ySA','xAV','yAV','ecg']) assert(data[key].every(Number.isFinite), `${scenario}: nonfinite ${key}`);
 assert.equal(data.t.length, 5001);
 assert.equal(data.t.at(-1), 10);
 assert(data.beats.every((b,i) => !i || b.time > data.beats[i-1].time));
 assert.equal(data.ecg.join(','), simulate(params).ecg.join(','), 'reproducibility');
 console.log(scenario, JSON.stringify({rate:m.hr, cv:m.cv, beats:data.beats.length, blocked:data.blocked.length, pvc:data.beats.filter(b=>b.type==='pvc').length}));
}
assert(runs.bradycardia.m.hr < 60);
assert(runs.tachycardia.m.hr > 100);
assert(runs.sinus.m.cv < 1);
assert(runs.af.m.cv > 10);
assert(runs.block.data.blocked.length >= 5);
assert(Math.abs(runs.block.data.beats.length-runs.block.data.blocked.length)<=1);
assert(runs.pvc.data.beats.some(b=>b.type==='pvc'));
for (let i=1; i<runs.pvc.data.beats.length-1; i++) {
 const b=runs.pvc.data.beats;
 if(b[i].type==='pvc') assert(b[i].time-b[i-1].time < b[i+1].time-b[i].time);
}
for(const scenario of Object.keys(SCENARIOS)) {
 for (const duration of [1,20]) for(const edge of [{saFreq:.4,avFreq:.3,mu:5,coupling:0}, {saFreq:3,avFreq:2.5,mu:.1,coupling:3}]) {
  const d=simulate({...BASELINE,...SCENARIOS[scenario],...edge,scenario,duration});
  assert(d.ecg.every(Number.isFinite));
  if(edge.coupling===0) assert.equal(d.beats.length,0);
 }
}
console.log('All scenario, boundary, determinism and rhythm checks passed.');
