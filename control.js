/* CardioTwin: constrained binary-input adaptive MPC on a ventricular phase plant.
 * Educational reduced-order control experiment; no clinical device interface. */
(function (root) {
    'use strict';
    const DT = 0.05;
    const MODES = {
        uncontrolled: { label: 'Uncontrolled', color: '#64748b' },
        fixed: { label: 'Fixed pacing', color: '#b45309' },
        reactive: { label: 'Reactive pacing', color: '#9333ea' },
        mpc: { label: 'Adaptive MPC', color: '#059669' },
    };
    const DEFAULTS = { target: 72, enableTime: 3, horizon: 1.5, effortWeight: 0.03,
        tolerance: 5, dwell: 3, refractory: 0.25, minPulseInterval: 0.5, beamWidth: 16 };

    function configWithDefaults(input = {}) {
        const c = { ...DEFAULTS, ...input };
        for (const key of Object.keys(DEFAULTS)) if (!Number.isFinite(c[key])) throw new Error('Invalid control setting: ' + key);
        if (c.target < 40 || c.target > 120 || c.enableTime < 0 || c.horizon < 0.5 || c.horizon > 3 ||
            c.effortWeight < 0 || c.tolerance <= 0 || c.dwell <= 0 || c.refractory < DT ||
            c.minPulseInterval < c.refractory || c.beamWidth < 1 || c.beamWidth > 64) throw new Error('Control settings out of range');
        return c;
    }

    function rate(s) {
        // Beat-derived sample-and-hold rate, with an elapsed-time timeout so a
        // prolonged pause cannot retain the previous normal rate indefinitely.
        return s.rr === null ? 0 : 60 / Math.max(s.rr, s.age);
    }

    function registerBeat(s, type) {
        const interval = s.hasBeat ? s.age : null;
        s.rr = interval;
        s.age = 0;
        s.hasBeat = true;
        return { type, interval };
    }

    function advance(s, increment, c) {
        s.age += DT;
        s.pulseAge += DT;
        s.phase += increment;
        let event = null;
        if (s.phase >= 1 - 1e-10) {
            s.phase = Math.max(0, s.phase - 1);
            if (s.age + 1e-10 >= c.refractory) event = registerBeat(s, 'intrinsic');
        }
        return event;
    }

    function canPulse(s, c) {
        return s.age + 1e-10 >= c.refractory && s.pulseAge + 1e-10 >= c.minPulseInterval;
    }

    function applyPulse(s) {
        // u=1 captures and resets ventricular phase. There is no negative input
        // and no direct SA/AV suppression or anti-tachycardia therapy.
        s.phase = 0;
        s.pulseAge = 0;
        return registerBeat(s, 'paced');
    }

    function beatCost(event, period) {
        return event && event.interval !== null ? 2 * (event.interval / period - 1) ** 2 : 0;
    }

    function chooseMPC(state, estimate, c) {
        const period = 60 / c.target;
        const steps = Math.round(c.horizon / DT);
        let beam = [{ state: { ...state }, cost: 0, first: 0 }];
        let evaluated = 0;
        // Discrete finite-horizon search over binary pulse sequences. Beam
        // pruning is an approximate solver, not a global optimality guarantee.
        for (let h = 0; h < steps; h++) {
            const candidates = [];
            for (const node of beam) {
                for (const action of [0, 1]) {
                    const s = { ...node.state };
                    let cost = node.cost;
                    if (h > 0) cost += beatCost(advance(s, estimate * DT, c), period);
                    if (action && !canPulse(s, c)) continue;
                    if (action) cost += beatCost(applyPulse(s), period) + c.effortWeight;
                    cost += DT * ((rate(s) / c.target - 1) ** 2 +
                        0.5 * Math.max(0, s.age / period - 1) ** 2);
                    candidates.push({ state: s, cost, first: h === 0 ? action : node.first });
                    evaluated++;
                }
            }
            candidates.sort((a, b) => a.cost - b.cost || a.first - b.first);
            // Keep representatives of different physical states; otherwise
            // duplicate paths consume the beam and prematurely erase alternatives.
            const seen = new Set();
            beam = [];
            for (const node of candidates) {
                const s = node.state;
                const key = [s.phase.toFixed(3), s.age.toFixed(3), s.rr === null ? '-' : s.rr.toFixed(3), s.pulseAge.toFixed(2)].join(':');
                if (seen.has(key)) continue;
                seen.add(key); beam.push(node);
                if (beam.length >= c.beamWidth) break;
            }
        }
        return { action: beam[0].first, cost: beam[0].cost, evaluated };
    }

    function measure(t, hr, pulses, c) {
        const start = t.findIndex(time => time + 1e-9 >= c.enableTime);
        if (start < 0 || t[t.length - 1] <= c.enableTime) {
            return { rmse: null, iae: null, settling: null, settlingStatus: 'No control window', effort: 0, pulseCount: 0 };
        }
        let integral = 0, squared = 0, length = 0;
        // Left-rectangle quadrature of the displayed causal held output.
        for (let i = start; i < t.length - 1; i++) {
            const dt = t[i + 1] - t[i], error = hr[i] - c.target;
            integral += Math.abs(error) * dt; squared += error ** 2 * dt; length += dt;
        }
        let lastOutside = start - 1;
        for (let i = start; i < t.length; i++) if (Math.abs(hr[i] - c.target) > c.tolerance) lastOutside = i;
        const firstStable = lastOutside + 1;
        const settling = firstStable < t.length && t[t.length - 1] - t[firstStable] + 1e-9 >= c.dwell
            ? t[firstStable] - c.enableTime : null;
        const pulseCount = pulses.filter(p => p.time + 1e-9 >= c.enableTime).length;
        return { rmse: Math.sqrt(squared / length), iae: integral, settling,
            settlingStatus: settling !== null ? 'Settled' : length < c.dwell ? 'Window too short' : 'Not settled',
            effort: pulses.reduce((sum, p) => sum + p.amplitude ** 2, 0), pulseCount };
    }

    function makeDrive(source, duration) {
        const events = source.slice().sort((a, b) => a.time - b.time);
        const t = Float64Array.from({ length: Math.round(duration / DT) + 1 }, (_, i) => i * DT);
        const phase = new Float64Array(t.length);
        const kinds = Array(t.length).fill('normal');
        let cursor = 0;
        if (events.length >= 2) {
            for (let i = 0; i < t.length; i++) {
                while (cursor + 1 < events.length - 1 && events[cursor + 1].time <= t[i]) cursor++;
                phase[i] = cursor + (t[i] - events[cursor].time) / (events[cursor + 1].time - events[cursor].time);
                kinds[i] = events[cursor + 1].type === 'pvc' ? 'pvc' : 'normal';
            }
        }
        const past = events.filter(e => e.time < 0);
        const last = past.at(-1), previous = past.at(-2);
        return { t, phase, kinds, past, initial: { phase: events.length ? phase[0] - Math.floor(phase[0]) : 0,
            age: last ? -last.time : 0, rr: last && previous ? last.time - previous.time : null,
            hasBeat: Boolean(last), pulseAge: 1e6 } };
    }

    function runMode(drive, mode, c) {
        const s = { ...drive.initial };
        const hr = new Float64Array(drive.t.length), input = new Float64Array(drive.t.length);
        const estimatedRate = new Float64Array(drive.t.length);
        const beats = [], pulses = [];
        let estimate = 1.2, nextFixed = c.enableTime, evaluated = 0;
        for (let i = 0; i < drive.t.length; i++) {
            const time = drive.t[i];
            if (i > 0) {
                const before = s.phase;
                const event = advance(s, drive.phase[i] - drive.phase[i - 1], c);
                if (event) beats.push({ time, type: drive.kinds[Math.max(0, i - 1)], source: 'intrinsic' });
                // Online EWMA from observed phase motion, after accounting for
                // phase wrapping. No future disturbance, scenario label, or
                // source beat schedule is passed into the optimiser.
                let delta = s.phase - before;
                if (delta < -1e-9) delta += 1;
                estimate = Math.max(0, Math.min(6, 0.8 * estimate + 0.2 * delta / DT));
            }
            let action = 0;
            if (time + 1e-9 >= c.enableTime && mode !== 'uncontrolled') {
                if (mode === 'fixed' && time + 1e-9 >= nextFixed) {
                    action = Number(canPulse(s, c));
                    do { nextFixed += 60 / c.target; } while (nextFixed <= time + 1e-9);
                } else if (mode === 'reactive') {
                    action = Number(s.age + 1e-9 >= 60 / c.target && canPulse(s, c));
                } else if (mode === 'mpc') {
                    const decision = chooseMPC(s, estimate, c);
                    action = decision.action; evaluated += decision.evaluated;
                }
            }
            if (action) {
                applyPulse(s);
                beats.push({ time, type: 'paced', source: 'pulse' });
                pulses.push({ time, amplitude: 1 });
                input[i] = 1;
            }
            hr[i] = rate(s); estimatedRate[i] = estimate;
        }
        return { mode, t: drive.t, hr, input, estimatedRate, beats, pulses, evaluated,
            metrics: measure(drive.t, hr, pulses, c) };
    }

    function compare(data, options = {}) {
        const config = configWithDefaults(options);
        const drive = makeDrive(data.sourceBeats || data.beats, data.params.duration);
        const runs = {};
        for (const mode of Object.keys(MODES)) runs[mode] = runMode(drive, mode, config);
        return { config, runs };
    }
    const api = { compare, chooseMPC, measure, configWithDefaults, MODES, DEFAULTS, DT };
    root.CardioControl = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
