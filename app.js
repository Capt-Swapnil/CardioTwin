/* ============================================================
   CardioTwin – Application Logic
   SA/AV Coupled Van der Pol Oscillator Simulation
   ============================================================ */

(() => {
    'use strict';

    // ─── Configuration ──────────────────────────────────────

    const BASELINE = {
        saFreq: 1.2,
        avFreq: 1.0,
        coupling: 0.50,
        mu: 1.50,
        duration: 10.0,
        scenario: 'sinus',
    };

    const SIM_DT = 0.0005;       // Integration step size (seconds)
    const PLOT_DECIMATION = 4;    // Plot every Nth point
    const SCENARIOS = {
        sinus: { label: 'Sinus rhythm', saFreq: 1.2, avFreq: 1.0, coupling: 0.5, mu: 1.5,
            description: 'Regular SA-driven beats with a fixed illustrative AV conduction delay.' },
        bradycardia: { label: 'Bradycardia', saFreq: 0.75, avFreq: 0.65, coupling: 0.5, mu: 1.5,
            description: 'Slow sinus rhythm: preset SA frequency 0.75 Hz (about 45 beats/min).' },
        tachycardia: { label: 'Tachycardia', saFreq: 2.2, avFreq: 1.8, coupling: 0.5, mu: 1.5,
            description: 'Fast sinus rhythm: preset SA frequency 2.2 Hz (about 132 beats/min).' },
        af: { label: 'Atrial fibrillation', saFreq: 1.8, avFreq: 1.3, coupling: 0.3, mu: 1.5,
            description: 'Illustrative AF: modulated atrial oscillator, reproducible irregular ventricular intervals, fibrillatory baseline, and no organised P waves. The SA trace is an atrial-drive proxy here.' },
        block: { label: 'Heart block (2:1)', saFreq: 1.4, avFreq: 0.65, coupling: 0.5, mu: 1.5,
            description: 'Illustrative second-degree 2:1 block: every other SA event is blocked; atrial activity continues while ventricular rate halves.' },
        pvc: { label: 'Premature ventricular beats', saFreq: 1.2, avFreq: 1.0, coupling: 0.5, mu: 1.5,
            description: 'An early, wider ventricular complex follows every fourth conducted beat. The next sinus ventricular response is suppressed, producing a compensatory pause.' },
    };

    const COLORS = {
        sa: '#2563eb',
        av: '#dc2626',
        ecg: '#059669',
        ref: '#94a3b8',
        grid: '#e2e8f0',
        gridMinor: '#f0f2f5',
        axis: '#4a5568',
        axisLabel: '#718096',
        title: '#1a1d23',
        bg: '#ffffff',
        playback: 'rgba(37, 99, 235, 0.25)',
    };

    // ─── State ──────────────────────────────────────────────

    let currentParams = { ...BASELINE };
    let simData = null;          // Oscillator traces, synthetic ECG, ventricular / blocked events, run parameters
    let refData = null;          // Reference waveform for comparison
    let refParams = null;        // Reference parameters
    let playbackAnim = null;     // Animation frame id
    let playbackIdx = 0;
    let isSimulating = false;

    // ─── DOM References ─────────────────────────────────────

    const dom = {};

    function cacheDom() {
        // Sliders
        dom.sliderSaFreq = document.getElementById('slider-sa-freq');
        dom.sliderAvFreq = document.getElementById('slider-av-freq');
        dom.sliderCoupling = document.getElementById('slider-coupling');
        dom.sliderMu = document.getElementById('slider-mu');
        dom.sliderDuration = document.getElementById('slider-duration');
        dom.scenario = document.getElementById('scenario-select');
        dom.scenarioDescription = document.getElementById('scenario-description');
        dom.statusScenario = document.getElementById('status-scenario');
        dom.statusRR = document.getElementById('status-rr');
        dom.statusEvents = document.getElementById('status-events');
        dom.eventSummary = document.getElementById('event-summary');
        dom.controlView = document.getElementById('control-view');

        // Slider value displays
        dom.valSaFreq = document.getElementById('val-sa-freq');
        dom.valAvFreq = document.getElementById('val-av-freq');
        dom.valCoupling = document.getElementById('val-coupling');
        dom.valMu = document.getElementById('val-mu');
        dom.valDuration = document.getElementById('val-duration');

        // Buttons
        dom.btnRun = document.getElementById('btn-run');
        dom.btnReset = document.getElementById('btn-reset');
        dom.btnBaseline = document.getElementById('btn-baseline');
        dom.btnSaveRef = document.getElementById('btn-save-ref');
        dom.btnClearRef = document.getElementById('btn-clear-ref');

        // Canvases
        dom.canvasSA = document.getElementById('canvas-sa');
        dom.canvasAV = document.getElementById('canvas-av');
        dom.canvasECG = document.getElementById('canvas-ecg');
        dom.canvasInteraction = document.getElementById('canvas-interaction');

        // Empty overlays
        dom.emptySA = document.getElementById('empty-sa');
        dom.emptyAV = document.getElementById('empty-av');
        dom.emptyECG = document.getElementById('empty-ecg');

        // Status
        dom.statusState = document.getElementById('status-state');
        dom.statusHR = document.getElementById('status-hr');
        dom.statusPhase = document.getElementById('status-phase');
        dom.statusSteps = document.getElementById('status-steps');

        // Readout
        dom.readoutTime = document.getElementById('readout-time');
        dom.readoutSA = document.getElementById('readout-sa');
        dom.readoutAV = document.getElementById('readout-av');

        // Demo
        dom.demoComparison = document.getElementById('demo-comparison');
        dom.comparisonTbody = document.getElementById('comparison-tbody');
    }

    // ─── Simulation Engine ──────────────────────────────────

    /**
     * Compute derivatives of the coupled Van der Pol system.
     * State vector: [x1, y1, x2, y2]
     *   x1,y1 = SA oscillator state
     *   x2,y2 = AV oscillator state
     */
    function derivatives(state, p, time = 0) {
        const [x1, y1, x2, y2] = state;
        const { omegaSA, omegaAV, mu, k } = p;

        // Deterministic, time-dependent modulation is evaluated at each RK4 stage.
        const atrialOmega = p.scenario === 'af'
            ? omegaSA * (1 + 0.24 * Math.sin(2.7 * time) + 0.13 * Math.sin(7.1 * time))
            : omegaSA;
        const dx1 = y1;
        const dy1 = mu * (1 - x1 * x1) * y1 - atrialOmega * atrialOmega * x1;
        const dx2 = y2;
        const dy2 = mu * (1 - x2 * x2) * y2 - omegaAV * omegaAV * x2 + k * (x1 - x2);

        return [dx1, dy1, dx2, dy2];
    }

    /**
     * Fourth-order Runge–Kutta step.
     */
    function rk4Step(state, p, dt, time = 0) {
        const k1 = derivatives(state, p, time);
        const s2 = state.map((s, i) => s + 0.5 * dt * k1[i]);
        const k2 = derivatives(s2, p, time + dt / 2);
        const s3 = state.map((s, i) => s + 0.5 * dt * k2[i]);
        const k3 = derivatives(s3, p, time + dt / 2);
        const s4 = state.map((s, i) => s + dt * k3[i]);
        const k4 = derivatives(s4, p, time + dt);

        return state.map((s, i) =>
            s + (dt / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i])
        );
    }

    // Hybrid teaching model: oscillator crossings drive an explicit conduction /
    // ventricular event layer. ECG is a morphology template, not an ODE voltage.
    function simulate(params) {
        if (!SCENARIOS[params.scenario]) throw new Error('Unknown scenario');
        const p = { omegaSA: 2 * Math.PI * params.saFreq,
            omegaAV: 2 * Math.PI * params.avFreq, mu: params.mu,
            k: params.coupling, scenario: params.scenario };
        const totalSteps = Math.round(params.duration / SIM_DT);
        const plotLen = Math.floor(totalSteps / PLOT_DECIMATION) + 1;
        const t = new Float64Array(plotLen);
        const xSA = new Float64Array(plotLen), ySA = new Float64Array(plotLen);
        const xAV = new Float64Array(plotLen), yAV = new Float64Array(plotLen);
        const ecg = new Float64Array(plotLen);
        const atrial = [];
        let state = [0.1, 0, 0, 0];
        // Burn-in removes amplitude startup artefacts; preserve pre-window beats
        // so waveforms and conduction remain continuous at the left boundary.
        const warmup = Math.round(10 / SIM_DT);
        const endStep = totalSteps + Math.ceil(3 / params.saFreq / SIM_DT);
        for (let i = -warmup; i <= endStep; i++) {
            const time = i * SIM_DT;
            if (i >= 0 && i <= totalSteps && i % PLOT_DECIMATION === 0) {
                const j = i / PLOT_DECIMATION;
                t[j] = time;
                [xSA[j], ySA[j], xAV[j], yAV[j]] = state;
            }
            if (i === endStep) break;
            const next = rk4Step(state, p, SIM_DT, time);
            if (state[0] < 0 && next[0] >= 0) {
                atrial.push(time + SIM_DT * (-state[0]) / (next[0] - state[0]));
            }
            state = next;
        }
        // k controls oscillator coupling and an explicit illustrative conduction
        // delay. At k=0 no atrial events conduct; no escape rhythm is modelled.
        const delay = 0.12 + 0.06 / (1 + params.coupling);
        const conducted = [], blocked = [];
        atrial.forEach((time, i) => {
            if (params.coupling === 0 || (params.scenario === 'block' && i % 2 === 1)) {
                blocked.push({ time: time + delay, atrialTime: time, type: 'blocked' });
            } else conducted.push({ time: time + delay, atrialTime: time, type: 'normal' });
        });
        let beats = conducted;
        if (params.scenario === 'af') {
            // Fixed seed: identical parameters always reproduce identical runs.
            let seed = 4271;
            const random = () => { seed = (1664525 * seed + 1013904223) >>> 0; return seed / 4294967296; };
            beats = [];
            let time = -2;
            while (time <= params.duration + 1) {
                if (params.coupling > 0) beats.push({ time, type: 'normal' });
                time += (1 / params.saFreq) * (0.55 + 0.9 * random());
            }
        } else if (params.scenario === 'pvc') {
            beats = [];
            for (let i = 0; i < conducted.length; i++) {
                beats.push(conducted[i]);
                if (i >= 3 && i % 4 === 3 && i + 2 < conducted.length) {
                    const rr = conducted[i + 1].time - conducted[i].time;
                    beats.push({ time: conducted[i].time + 0.6 * rr, type: 'pvc' });
                    i++; // Skip the next ventricular response, retaining its P wave.
                }
            }
        }
        ecg.set(synthesizeECG(t, atrial, beats, params.scenario));
        const visible = e => e.time >= 0 && e.time <= params.duration;
        return { t, xSA, ySA, xAV, yAV, ecg, steps: totalSteps,
            scenario: params.scenario, params: { ...params },
            sourceBeats: beats, atrial, beats: beats.filter(visible), blocked: params.scenario === 'af' ? [] : blocked.filter(visible) };
    }

    function synthesizeECG(t, atrial, beats, scenario) {
        const ecg = new Float64Array(t.length);
        const gaussian = (x, width) => Math.exp(-0.5 * (x / width) ** 2);
        // Add each template only within its finite visible support: O(samples + beats).
        function addWave(center, width, amplitude) {
            const step = t[1] - t[0];
            const first = Math.max(0, Math.ceil((center - 5 * width) / step));
            const last = Math.min(t.length - 1, Math.floor((center + 5 * width) / step));
            for (let i = first; i <= last; i++) ecg[i] += amplitude * gaussian(t[i] - center, width);
        }
        if (scenario !== 'af') atrial.forEach(time => addWave(time, 0.025, 0.12));
        else for (let i = 0; i < t.length; i++) {
            ecg[i] = 0.035 * Math.sin(2 * Math.PI * 6.7 * t[i]) +
                0.02 * Math.sin(2 * Math.PI * 9.3 * t[i] + 0.8);
        }
        beats.forEach(beat => {
            const c = beat.time;
            if (beat.type === 'pvc') {
                addWave(c - 0.035, 0.025, -0.25);
                addWave(c + 0.018, 0.045, 1.15);
                addWave(c + 0.095, 0.035, -0.6);
                addWave(c + 0.32, 0.07, -0.3);
            } else {
                addWave(c - 0.025, 0.009, -0.16);
                addWave(c, 0.012, 1.1);
                addWave(c + 0.025, 0.011, -0.25);
                addWave(c + 0.24, 0.05, 0.28);
            }
        });
        return ecg;
    }

    function selectedData() {
        if (!simData || !simData.control) return simData;
        const run = simData.control.runs[dom.controlView.value];
        return { ...simData, beats: run.beats, ecg: run.ecg };
    }

    function readControlConfig() {
        return CardioControl.configWithDefaults({
            target: Number(document.getElementById('control-target').value),
            enableTime: Number(document.getElementById('control-enable').value),
            horizon: Number(document.getElementById('control-horizon').value),
            effortWeight: Number(document.getElementById('control-effort').value),
        });
    }

    function renderControlComparison() {
        if (!simData || !simData.control) {
            document.getElementById('control-results').hidden = true;
            return;
        }
        const { config: c, runs } = simData.control;
        document.getElementById('control-results').hidden = false;
        const fmt = value => value === null ? '—' : value.toFixed(2);
        document.getElementById('controller-tbody').innerHTML = Object.values(runs).map(run => {
            const m = run.metrics;
            return `<tr><th scope="row" style="color:${CardioControl.MODES[run.mode].color}">${CardioControl.MODES[run.mode].label}</th><td>${fmt(m.rmse)}</td><td>${fmt(m.iae)}</td><td>${m.settling === null ? m.settlingStatus : m.settling.toFixed(2) + ' s'}</td><td>${m.pulseCount}</td><td>${fmt(m.effort)}</td></tr>`;
        }).join('');
        const window = simData.params.duration - c.enableTime;
        const warning = window <= 0 ? 'No post-enable window. Increase duration or reduce enable time.' :
            window < c.dwell ? 'Window too short to establish settling; increase duration.' :
            'A controller may remain outside the target band, particularly for fast intrinsic rhythms.';
        document.getElementById('control-run-summary').textContent = `Last run: target ${c.target} bpm; control enabled at ${c.enableTime.toFixed(2)} s; horizon ${c.horizon.toFixed(2)} s; effort weight ${c.effortWeight.toFixed(2)}. ${warning}`;
        const estimate = runs.mpc.estimatedRate.at(-1) * 60;
        document.getElementById('control-estimate').textContent = `MPC final intrinsic-drive estimate: ${estimate.toFixed(1)} cycles/min. ${runs.mpc.evaluated.toLocaleString()} candidate states evaluated; beam width ${c.beamWidth}.`;
        const series = Object.values(runs).map(run => ({ data: run.hr, color: CardioControl.MODES[run.mode].color }));
        drawPlot(document.getElementById('canvas-control-rate'), runs.mpc.t, series[0].data, {
            color: series[0].color, extraSeries: series.slice(1), target: c.target, tolerance: c.tolerance,
            enableTime: c.enableTime,
        });
        drawPulseTimeline(document.getElementById('canvas-control-pulses'), runs, c);
    }

    function drawPulseTimeline(canvas, runs, c) {
        const { ctx, cssWidth: width, cssHeight: height } = setupCanvas(canvas);
        const left = 100, right = width - 18, duration = simData.params.duration;
        ctx.clearRect(0, 0, width, height);
        ctx.font = '11px sans-serif';
        Object.values(runs).forEach((run, i) => {
            const y = 23 + i * 31;
            ctx.fillStyle = CardioControl.MODES[run.mode].color;
            ctx.textAlign = 'right'; ctx.fillText(CardioControl.MODES[run.mode].label, left - 8, y + 4);
            ctx.strokeStyle = '#e2e8f0'; ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(right, y); ctx.stroke();
            ctx.strokeStyle = CardioControl.MODES[run.mode].color; ctx.lineWidth = 2;
            run.pulses.forEach(p => { const x = left + p.time / duration * (right - left); ctx.beginPath(); ctx.moveTo(x, y - 10); ctx.lineTo(x, y + 3); ctx.stroke(); });
        });
        ctx.lineWidth = 1; ctx.strokeStyle = '#475569'; ctx.setLineDash([4, 3]);
        if (c.enableTime <= duration) { const x = left + c.enableTime / duration * (right - left); ctx.beginPath(); ctx.moveTo(x, 8); ctx.lineTo(x, 131); ctx.stroke(); }
        ctx.setLineDash([]); ctx.textAlign = 'center'; ctx.fillStyle = '#718096';
        ctx.fillText(`Time (s): 0 to ${duration} · each stem is one unit pulse`, (left + right) / 2, height - 6);
    }

    function rhythmMetrics(data) {
        const intervals = data.beats.slice(1).map((beat, i) => beat.time - data.beats[i].time);
        if (!intervals.length) return { hr: null, cv: null, delay: null };
        const mean = intervals.reduce((a, b) => a + b, 0) / intervals.length;
        const variance = intervals.reduce((sum, rr) => sum + (rr - mean) ** 2, 0) / intervals.length;
        const conducted = data.beats.filter(b => b.atrialTime !== undefined);
        const delay = conducted.length ? 1000 * conducted.reduce((sum, b) => sum + b.time - b.atrialTime, 0) / conducted.length : null;
        return { hr: 60 / mean, cv: 100 * Math.sqrt(variance) / mean, delay };
    }

    // ─── Canvas Plotting ────────────────────────────────────

    /**
     * Set up canvas for high-DPI rendering.
     * Returns { ctx, cssWidth, cssHeight }
     */
    function setupCanvas(canvas) {
        const dpr = window.devicePixelRatio || 1;
        const rect = canvas.getBoundingClientRect();
        canvas.width = rect.width * dpr;
        canvas.height = rect.height * dpr;
        const ctx = canvas.getContext('2d');
        ctx.scale(dpr, dpr);
        return { ctx, cssWidth: rect.width, cssHeight: rect.height };
    }

    /**
     * Draw a scientific waveform plot.
     */
    function drawPlot(canvas, timeData, valueData, options) {
        const { ctx, cssWidth, cssHeight } = setupCanvas(canvas);
        const margin = { top: 8, right: 16, bottom: 30, left: 52 };
        const w = cssWidth - margin.left - margin.right;
        const h = cssHeight - margin.top - margin.bottom;

        // Clear
        ctx.clearRect(0, 0, cssWidth, cssHeight);

        // Data range
        const xMin = timeData[0];
        const xMax = timeData[timeData.length - 1];
        let yMin = Infinity, yMax = -Infinity;
        for (let i = 0; i < valueData.length; i++) {
            if (valueData[i] < yMin) yMin = valueData[i];
            if (valueData[i] > yMax) yMax = valueData[i];
        }

        // Include reference data in range if present
        if (options.refData) {
            for (let i = 0; i < options.refData.length; i++) {
                if (options.refData[i] < yMin) yMin = options.refData[i];
                if (options.refData[i] > yMax) yMax = options.refData[i];
            }
        }

        (options.extraSeries || []).forEach(series => {
            for (const v of series.data) { yMin = Math.min(yMin, v); yMax = Math.max(yMax, v); }
        });
        if (options.target !== undefined) {
            yMin = Math.min(yMin, options.target - options.tolerance);
            yMax = Math.max(yMax, options.target + options.tolerance);
        }
        const yPad = (yMax - yMin) * 0.12 || 0.5;
        const yLow = yMin - yPad;
        const yHigh = yMax + yPad;

        const scaleX = (x) => margin.left + ((x - xMin) / (xMax - xMin)) * w;
        const scaleY = (y) => margin.top + h - ((y - yLow) / (yHigh - yLow)) * h;

        // ── Grid ──
        ctx.strokeStyle = COLORS.gridMinor;
        ctx.lineWidth = 0.5;

        // Y grid lines
        const yTicks = niceTicksLinear(yLow, yHigh, 5);
        yTicks.forEach((val) => {
            const y = scaleY(val);
            ctx.beginPath();
            ctx.moveTo(margin.left, y);
            ctx.lineTo(margin.left + w, y);
            ctx.stroke();
        });

        // X grid lines
        const xTicks = niceTicksLinear(xMin, xMax, 8);
        xTicks.forEach((val) => {
            const x = scaleX(val);
            ctx.beginPath();
            ctx.moveTo(x, margin.top);
            ctx.lineTo(x, margin.top + h);
            ctx.stroke();
        });

        // ── Axes ──
        ctx.strokeStyle = COLORS.grid;
        ctx.lineWidth = 1;

        // Left axis
        ctx.beginPath();
        ctx.moveTo(margin.left, margin.top);
        ctx.lineTo(margin.left, margin.top + h);
        ctx.stroke();

        // Bottom axis
        ctx.beginPath();
        ctx.moveTo(margin.left, margin.top + h);
        ctx.lineTo(margin.left + w, margin.top + h);
        ctx.stroke();

        // ── Axis labels ──
        ctx.fillStyle = COLORS.axisLabel;
        ctx.font = `400 10px ${getComputedStyle(document.documentElement).getPropertyValue('--font-mono').trim() || 'monospace'}`;
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';

        yTicks.forEach((val) => {
            const y = scaleY(val);
            ctx.fillText(formatAxisValue(val), margin.left - 6, y);
        });

        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';

        xTicks.forEach((val) => {
            const x = scaleX(val);
            ctx.fillText(val.toFixed(1), x, margin.top + h + 6);
        });

        // X axis label
        ctx.fillStyle = COLORS.axisLabel;
        ctx.font = `500 10px ${getComputedStyle(document.documentElement).getPropertyValue('--font-sans').trim() || 'sans-serif'}`;
        ctx.textAlign = 'center';
        ctx.fillText('Time (s)', margin.left + w / 2, margin.top + h + 18);

        if (options.target !== undefined) {
            ctx.fillStyle = 'rgba(5,150,105,.08)';
            ctx.fillRect(margin.left, scaleY(options.target + options.tolerance), w,
                scaleY(options.target - options.tolerance) - scaleY(options.target + options.tolerance));
            ctx.strokeStyle = '#0f172a'; ctx.setLineDash([5, 4]); ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(margin.left, scaleY(options.target)); ctx.lineTo(margin.left + w, scaleY(options.target)); ctx.stroke();
            if (options.enableTime <= xMax) {
                const x = scaleX(options.enableTime); ctx.beginPath(); ctx.moveTo(x, margin.top); ctx.lineTo(x, margin.top + h); ctx.stroke();
            }
            ctx.setLineDash([]);
        }

        // ── Reference trace (dashed) ──
        if (options.refData && options.refTime) {
            ctx.beginPath();
            ctx.strokeStyle = COLORS.ref;
            ctx.lineWidth = 1.5;
            ctx.setLineDash([6, 4]);

            for (let i = 0; i < options.refTime.length; i++) {
                const x = scaleX(options.refTime[i]);
                const y = scaleY(options.refData[i]);
                if (i === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            }
            ctx.stroke();
            ctx.setLineDash([]);
        }

        // ── Data trace ──
        ctx.beginPath();
        ctx.strokeStyle = options.color || COLORS.sa;
        ctx.lineWidth = 1.5;

        for (let i = 0; i < timeData.length; i++) {
            const x = scaleX(timeData[i]);
            const y = scaleY(valueData[i]);
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.stroke();

        (options.extraSeries || []).forEach(series => {
            ctx.beginPath(); ctx.strokeStyle = series.color; ctx.lineWidth = 1.5;
            series.data.forEach((v, i) => { const x = scaleX(timeData[i]), y = scaleY(v); if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); });
            ctx.stroke();
        });

        // Event markers refer to the generated ventricular event layer.
        if (options.events) {
            ctx.save();
            ctx.beginPath(); ctx.rect(margin.left, margin.top, w, h); ctx.clip();
            options.events.forEach(event => {
                const x = scaleX(event.time);
                const color = event.type === 'pvc' ? '#b45309' : event.type === 'paced' ? '#2563eb' : event.type === 'blocked' ? '#dc2626' : '#94a3b8';
                ctx.strokeStyle = color; ctx.lineWidth = 0.7; ctx.setLineDash([2, 4]);
                ctx.beginPath(); ctx.moveTo(x, margin.top); ctx.lineTo(x, margin.top + h); ctx.stroke();
                if (event.type !== 'normal') {
                    ctx.fillStyle = color; ctx.font = '10px sans-serif'; ctx.textAlign = 'center';
                    ctx.fillText(event.type === 'pvc' ? 'PVC' : event.type === 'paced' ? 'Pace' : 'Block', x, margin.top + 3);
                }
            });
            ctx.restore();
            ctx.setLineDash([]);
        }

        // ── Playback cursor ──
        if (options.cursorTime !== undefined && options.cursorTime !== null) {
            const cx = scaleX(options.cursorTime);
            ctx.beginPath();
            ctx.strokeStyle = COLORS.playback;
            ctx.lineWidth = 2;
            ctx.moveTo(cx, margin.top);
            ctx.lineTo(cx, margin.top + h);
            ctx.stroke();

            // Dot on trace at cursor
            const idx = Math.min(
                Math.floor(((options.cursorTime - xMin) / (xMax - xMin)) * (timeData.length - 1)),
                timeData.length - 1
            );
            if (idx >= 0) {
                const dotY = scaleY(valueData[idx]);
                ctx.beginPath();
                ctx.fillStyle = options.color || COLORS.sa;
                ctx.arc(cx, dotY, 4, 0, 2 * Math.PI);
                ctx.fill();
            }
        }

        return { scaleX, scaleY, margin, w, h, yLow, yHigh, xMin, xMax };
    }

    /**
     * Generate nice tick values for an axis.
     */
    function niceTicksLinear(min, max, approxCount) {
        const range = max - min;
        if (range === 0) return [min];
        const rawStep = range / approxCount;
        const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep)));
        const residual = rawStep / magnitude;

        let niceStep;
        if (residual <= 1.5) niceStep = magnitude;
        else if (residual <= 3.5) niceStep = 2 * magnitude;
        else if (residual <= 7.5) niceStep = 5 * magnitude;
        else niceStep = 10 * magnitude;

        const ticks = [];
        let tick = Math.ceil(min / niceStep) * niceStep;
        while (tick <= max + niceStep * 0.001) {
            ticks.push(tick);
            tick += niceStep;
        }
        return ticks;
    }

    function formatAxisValue(v) {
        if (Math.abs(v) >= 100) return v.toFixed(0);
        if (Math.abs(v) >= 1) return v.toFixed(1);
        return v.toFixed(2);
    }

    // ─── SA → AV Interaction Visualization ──────────────────

    function drawInteraction(cursorTime) {
        const canvas = dom.canvasInteraction;
        const { ctx, cssWidth, cssHeight } = setupCanvas(canvas);

        const centerY = cssHeight / 2;
        const saX = cssWidth * 0.2;
        const avX = cssWidth * 0.8;
        const nodeRadius = 28;

        // Clear
        ctx.clearRect(0, 0, cssWidth, cssHeight);

        // Background
        ctx.fillStyle = '#f8f9fb';
        ctx.fillRect(0, 0, cssWidth, cssHeight);

        // Get current state values
        let saVal = 0, avVal = 0, saVel = 0, avVel = 0;
        if (simData && cursorTime !== undefined) {
            const idx = Math.min(
                Math.floor(((cursorTime - simData.t[0]) / (simData.t[simData.t.length - 1] - simData.t[0])) * (simData.t.length - 1)),
                simData.t.length - 1
            );
            if (idx >= 0) {
                saVal = simData.xSA[idx];
                avVal = simData.xAV[idx];
                saVel = simData.ySA[idx];
                avVel = simData.yAV[idx];
            }
        }

        // Normalize values for visual intensity (0-1)
        const saIntensity = simData ? Math.min(Math.abs(saVal) / 2.5, 1) : 0;
        const avIntensity = simData ? Math.min(Math.abs(avVal) / 2.5, 1) : 0;

        // ── Connection arrow ──
        const arrowStartX = saX + nodeRadius + 8;
        const arrowEndX = avX - nodeRadius - 8;
        const arrowMidX = (arrowStartX + arrowEndX) / 2;

        // Arrow line
        ctx.beginPath();
        ctx.strokeStyle = simData ? `rgba(37, 99, 235, ${0.3 + saIntensity * 0.5})` : '#cbd5e1';
        ctx.lineWidth = 2;
        ctx.moveTo(arrowStartX, centerY);
        ctx.lineTo(arrowEndX - 8, centerY);
        ctx.stroke();

        // Arrowhead
        ctx.beginPath();
        ctx.fillStyle = simData ? `rgba(37, 99, 235, ${0.3 + saIntensity * 0.5})` : '#cbd5e1';
        ctx.moveTo(arrowEndX, centerY);
        ctx.lineTo(arrowEndX - 12, centerY - 5);
        ctx.lineTo(arrowEndX - 12, centerY + 5);
        ctx.closePath();
        ctx.fill();

        // Coupling label
        ctx.fillStyle = '#718096';
        ctx.font = `500 11px ${getComputedStyle(document.documentElement).getPropertyValue('--font-sans').trim() || 'sans-serif'}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillText('Coupling (k = ' + (simData ? simData.params.coupling : currentParams.coupling).toFixed(2) + ')', arrowMidX, centerY - 8);

        // Propagation dot (animated)
        if (simData && cursorTime !== undefined) {
            const phase = (cursorTime * simData.params.saFreq * 2) % 1;
            const dotX = arrowStartX + phase * (arrowEndX - arrowStartX);
            ctx.beginPath();
            ctx.fillStyle = `rgba(37, 99, 235, ${0.7})`;
            ctx.arc(dotX, centerY, 4, 0, 2 * Math.PI);
            ctx.fill();
        }

        // ── SA Node ──
        // Glow
        if (simData) {
            const gradient = ctx.createRadialGradient(saX, centerY, nodeRadius, saX, centerY, nodeRadius + 15);
            gradient.addColorStop(0, `rgba(37, 99, 235, ${saIntensity * 0.3})`);
            gradient.addColorStop(1, 'rgba(37, 99, 235, 0)');
            ctx.beginPath();
            ctx.fillStyle = gradient;
            ctx.arc(saX, centerY, nodeRadius + 15, 0, 2 * Math.PI);
            ctx.fill();
        }

        // Circle
        ctx.beginPath();
        const saFill = simData
            ? `rgba(37, 99, 235, ${0.1 + saIntensity * 0.25})`
            : '#eff6ff';
        ctx.fillStyle = saFill;
        ctx.strokeStyle = COLORS.sa;
        ctx.lineWidth = 2;
        ctx.arc(saX, centerY, nodeRadius, 0, 2 * Math.PI);
        ctx.fill();
        ctx.stroke();

        // Label
        ctx.fillStyle = COLORS.sa;
        ctx.font = `700 13px ${getComputedStyle(document.documentElement).getPropertyValue('--font-sans').trim() || 'sans-serif'}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('SA', saX, centerY);

        // Sublabel
        ctx.fillStyle = '#718096';
        ctx.font = `400 9px ${getComputedStyle(document.documentElement).getPropertyValue('--font-sans').trim() || 'sans-serif'}`;
        ctx.fillText('Primary', saX, centerY + nodeRadius + 14);

        // ── AV Node ──
        if (simData) {
            const gradient = ctx.createRadialGradient(avX, centerY, nodeRadius, avX, centerY, nodeRadius + 15);
            gradient.addColorStop(0, `rgba(220, 38, 38, ${avIntensity * 0.3})`);
            gradient.addColorStop(1, 'rgba(220, 38, 38, 0)');
            ctx.beginPath();
            ctx.fillStyle = gradient;
            ctx.arc(avX, centerY, nodeRadius + 15, 0, 2 * Math.PI);
            ctx.fill();
        }

        ctx.beginPath();
        const avFill = simData
            ? `rgba(220, 38, 38, ${0.1 + avIntensity * 0.25})`
            : '#fef2f2';
        ctx.fillStyle = avFill;
        ctx.strokeStyle = COLORS.av;
        ctx.lineWidth = 2;
        ctx.arc(avX, centerY, nodeRadius, 0, 2 * Math.PI);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = COLORS.av;
        ctx.font = `700 13px ${getComputedStyle(document.documentElement).getPropertyValue('--font-sans').trim() || 'sans-serif'}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('AV', avX, centerY);

        ctx.fillStyle = '#718096';
        ctx.font = `400 9px ${getComputedStyle(document.documentElement).getPropertyValue('--font-sans').trim() || 'sans-serif'}`;
        ctx.fillText('Coupled', avX, centerY + nodeRadius + 14);

        // Update readouts
        if (simData && cursorTime !== undefined) {
            dom.readoutTime.textContent = cursorTime.toFixed(3) + ' s';
            dom.readoutSA.textContent = `(${saVal.toFixed(3)}, ${saVel.toFixed(3)})`;
            dom.readoutAV.textContent = `(${avVal.toFixed(3)}, ${avVel.toFixed(3)})`;
        }
    }

    // ─── Playback Animation ─────────────────────────────────

    function startPlayback() {
        stopPlayback();
        if (!simData) return;

        playbackIdx = 0;
        const totalFrames = simData.t.length;
        const speed = Math.max(1, Math.floor(totalFrames / 600)); // ~10 seconds at 60fps

        function tick() {
            const cursorTime = simData.t[playbackIdx];

            // Redraw plots with cursor
            drawAllPlots(cursorTime);
            drawInteraction(cursorTime);

            playbackIdx += speed;
            if (playbackIdx >= totalFrames) {
                playbackIdx = 0; // Loop
            }

            playbackAnim = requestAnimationFrame(tick);
        }

        playbackAnim = requestAnimationFrame(tick);
    }

    function stopPlayback() {
        if (playbackAnim) {
            cancelAnimationFrame(playbackAnim);
            playbackAnim = null;
        }
    }

    // ─── Drawing ────────────────────────────────────────────

    function drawAllPlots(cursorTime) {
        if (!simData) return;

        const refT = refData ? refData.t : null;
        const displayed = selectedData();

        drawPlot(dom.canvasSA, simData.t, simData.xSA, {
            color: COLORS.sa,
            cursorTime,
            refData: refData ? refData.xSA : null,
            refTime: refT,
        });

        drawPlot(dom.canvasAV, simData.t, simData.xAV, {
            color: COLORS.av,
            cursorTime,
            refData: refData ? refData.xAV : null,
            refTime: refT,
        });

        drawPlot(dom.canvasECG, simData.t, displayed.ecg, {
            color: COLORS.ecg,
            events: [...displayed.beats, ...simData.blocked],
            cursorTime,
            refData: refData ? refData.ecg : null,
            refTime: refT,
        });
    }

    function clearPlots() {
        [dom.canvasSA, dom.canvasAV, dom.canvasECG, document.getElementById('canvas-control-rate'), document.getElementById('canvas-control-pulses')].forEach(canvas => {
            const { ctx, cssWidth, cssHeight } = setupCanvas(canvas);
            ctx.clearRect(0, 0, cssWidth, cssHeight);
        });
    }

    // ─── UI Updates ─────────────────────────────────────────

    function updateSliderDisplay(slider, display, decimals) {
        display.textContent = parseFloat(slider.value).toFixed(decimals);
    }

    function readParams() {
        currentParams.saFreq = parseFloat(dom.sliderSaFreq.value);
        currentParams.avFreq = parseFloat(dom.sliderAvFreq.value);
        currentParams.coupling = parseFloat(dom.sliderCoupling.value);
        currentParams.mu = parseFloat(dom.sliderMu.value);
        currentParams.duration = parseFloat(dom.sliderDuration.value);
        currentParams.scenario = dom.scenario.value;
    }

    function setParams(p) {
        dom.scenario.value = p.scenario;
        dom.scenarioDescription.textContent = SCENARIOS[p.scenario].description;
        dom.sliderSaFreq.value = p.saFreq;
        dom.sliderAvFreq.value = p.avFreq;
        dom.sliderCoupling.value = p.coupling;
        dom.sliderMu.value = p.mu;
        dom.sliderDuration.value = p.duration;

        updateSliderDisplay(dom.sliderSaFreq, dom.valSaFreq, 2);
        updateSliderDisplay(dom.sliderAvFreq, dom.valAvFreq, 2);
        updateSliderDisplay(dom.sliderCoupling, dom.valCoupling, 2);
        updateSliderDisplay(dom.sliderMu, dom.valMu, 2);
        updateSliderDisplay(dom.sliderDuration, dom.valDuration, 1);

        readParams();
    }

    function setStatus(state, label) {
        const dotEl = dom.statusState.querySelector('.status-dot');
        dotEl.className = 'status-dot ' + state;
        dom.statusState.innerHTML = '';
        dom.statusState.appendChild(dotEl);
        dom.statusState.appendChild(document.createTextNode(' ' + label));
    }

    function updateStatusMetrics() {
        if (!simData) {
            dom.statusHR.textContent = '—';
            dom.statusPhase.textContent = '—';
            dom.statusSteps.textContent = '—';
            dom.statusScenario.textContent = '—';
            dom.statusRR.textContent = '—';
            dom.statusEvents.textContent = '—';
            dom.eventSummary.textContent = 'Run a scenario to view generated beat events.';
            return;
        }

        const displayed = selectedData();
        const metrics = rhythmMetrics(displayed);
        dom.statusHR.textContent = metrics.hr === null ? 'Need ≥2 beats' : metrics.hr.toFixed(1) + ' bpm';
        dom.statusPhase.textContent = metrics.delay === null ? '—' : metrics.delay.toFixed(1) + ' ms';
        dom.statusScenario.textContent = SCENARIOS[simData.scenario].label;
        dom.statusRR.textContent = metrics.cv === null ? 'Need ≥2 beats' : metrics.cv.toFixed(1) + '%';
        const pvcCount = displayed.beats.filter(b => b.type === 'pvc').length;
        dom.statusEvents.textContent = `${displayed.beats.length} / ${simData.blocked.length} / ${pvcCount}`;
        dom.eventSummary.textContent = `${SCENARIOS[simData.scenario].label}: ${displayed.beats.length} ventricular beats, ${simData.blocked.length} blocked events, ${pvcCount} PVCs. ` +
            `ECG output: ${CardioControl.MODES[dom.controlView.value].label}. Grey: intrinsic; blue: paced; red: blocked native response; amber: PVC. SA/AV traces show the unchanged upstream model; pacing acts on the added ventricular phase plant.`;

        dom.statusSteps.textContent = simData.steps.toLocaleString();
    }

    function showEmptyOverlays(show) {
        dom.emptySA.className = 'plot-empty' + (show ? '' : ' hidden');
        dom.emptyAV.className = 'plot-empty' + (show ? '' : ' hidden');
        dom.emptyECG.className = 'plot-empty' + (show ? '' : ' hidden');
    }

    // ─── Comparison Table ───────────────────────────────────

    function updateComparisonTable() {
        if (!refParams) {
            dom.demoComparison.style.display = 'none';
            return;
        }

        dom.demoComparison.style.display = 'block';

        const rows = [
            { label: 'SA Frequency', ref: refParams.saFreq, cur: currentParams.saFreq, unit: ' Hz', dec: 2 },
            { label: 'AV Frequency', ref: refParams.avFreq, cur: currentParams.avFreq, unit: ' Hz', dec: 2 },
            { label: 'Coupling (k)', ref: refParams.coupling, cur: currentParams.coupling, unit: '', dec: 2 },
            { label: 'μ', ref: refParams.mu, cur: currentParams.mu, unit: '', dec: 2 },
            { label: 'Duration', ref: refParams.duration, cur: currentParams.duration, unit: ' s', dec: 1 },
        ];

        const controlRow = `<tr><td>ECG output</td><td>${refParams.controlLabel || 'Uncontrolled'}</td><td>${CardioControl.MODES[dom.controlView.value].label}</td><td>—</td></tr><tr><td>Control target</td><td>${refParams.target || '—'} bpm</td><td>${simData ? simData.control.config.target : '—'} bpm</td><td>—</td></tr>`;
        const scenarioRow = `<tr><td>Scenario</td><td>${SCENARIOS[refParams.scenario].label}</td><td>${SCENARIOS[currentParams.scenario].label}</td><td>${refParams.scenario === currentParams.scenario ? '—' : 'Changed'}</td></tr>`;
        dom.comparisonTbody.innerHTML = controlRow + scenarioRow + rows.map(r => {
            const changed = Math.abs(r.ref - r.cur) > 0.001;
            const delta = r.cur - r.ref;
            const changeStr = changed
                ? (delta > 0 ? '+' : '') + delta.toFixed(r.dec)
                : '—';
            return `<tr>
                <td>${r.label}</td>
                <td>${r.ref.toFixed(r.dec)}${r.unit}</td>
                <td class="${changed ? 'changed' : ''}">${r.cur.toFixed(r.dec)}${r.unit}</td>
                <td class="${changed ? 'changed' : ''}">${changeStr}</td>
            </tr>`;
        }).join('');
    }

    // ─── Event Handlers ─────────────────────────────────────

    function onRunSimulation() {
        if (isSimulating) return;
        isSimulating = true;

        stopPlayback();
        readParams();
        document.querySelectorAll('input, select, button').forEach(el => { el.dataset.wasDisabled = String(el.disabled); el.disabled = true; });

        setStatus('running', 'Simulating…');
        dom.btnRun.classList.add('running');
        dom.btnRun.querySelector('svg').style.display = 'none';

        // Use setTimeout to let the UI update
        setTimeout(() => {
            try {
                const nextData = simulate(currentParams);
                nextData.control = CardioControl.compare(nextData, readControlConfig());
                for (const run of Object.values(nextData.control.runs)) {
                    const prehistory = nextData.sourceBeats.filter(b => b.time < 0);
                    run.ecg = synthesizeECG(nextData.t, nextData.atrial, [...prehistory, ...run.beats], nextData.scenario);
                }
                simData = nextData;
                renderControlComparison();
                document.getElementById('ecg-title').textContent = SCENARIOS[simData.scenario].label;
                document.getElementById('sa-subtitle').textContent = simData.scenario === 'af' ? 'Modulated atrial-drive proxy' : 'Sinoatrial Node Oscillator';
                showEmptyOverlays(false);
                drawAllPlots(null);
                drawInteraction(simData.t[simData.t.length - 1]);
                updateStatusMetrics();
                setStatus('complete', 'Complete');

                dom.btnSaveRef.disabled = false;

                if (refParams) {
                    updateComparisonTable();
                }

                // Start playback
                startPlayback();
            } catch (e) {
                console.error('Simulation error:', e);
                setStatus('idle', 'Error: ' + e.message);
            } finally {
                document.querySelectorAll('input, select, button').forEach(el => { el.disabled = el.dataset.wasDisabled === 'true'; });
                dom.btnSaveRef.disabled = !simData;
                dom.btnClearRef.disabled = !refData;
                isSimulating = false;
                dom.btnRun.classList.remove('running');
                dom.btnRun.querySelector('svg').style.display = '';
            }
        }, 50);
    }

    function onReset() {
        stopPlayback();
        simData = null;
        setParams({ ...BASELINE });
        for (const [id, key] of [['control-target', 'target'], ['control-enable', 'enableTime'], ['control-horizon', 'horizon'], ['control-effort', 'effortWeight']]) document.getElementById(id).value = CardioControl.DEFAULTS[key];
        dom.controlView.value = 'mpc';
        clearPlots();
        showEmptyOverlays(true);
        setStatus('idle', 'Idle');
        updateStatusMetrics();
        renderControlComparison();
        drawInteraction(undefined);

        dom.readoutTime.textContent = '—';
        dom.readoutSA.textContent = '—';
        dom.readoutAV.textContent = '—';

        dom.btnSaveRef.disabled = true;
        document.getElementById('ecg-title').textContent = 'Synthetic ECG';
        document.getElementById('sa-subtitle').textContent = 'Sinoatrial Node Oscillator';
        updateComparisonTable();
    }

    function onBaseline() {
        stopPlayback();
        setParams({ ...BASELINE });
        onRunSimulation();
    }

    function onSaveRef() {
        if (!simData) return;
        const displayed = selectedData();
        refData = {
            t: new Float64Array(simData.t),
            xSA: new Float64Array(simData.xSA),
            ySA: new Float64Array(simData.ySA),
            xAV: new Float64Array(simData.xAV),
            yAV: new Float64Array(simData.yAV),
            ecg: new Float64Array(displayed.ecg),
        };
        refParams = { ...simData.params, controlLabel: CardioControl.MODES[dom.controlView.value].label, target: simData.control.config.target };
        dom.btnClearRef.disabled = false;
        updateComparisonTable();

        // Redraw to show reference
        drawAllPlots(null);
    }

    function onClearRef() {
        refData = null;
        refParams = null;
        dom.btnClearRef.disabled = true;
        dom.demoComparison.style.display = 'none';

        if (simData) {
            drawAllPlots(null);
        }
    }

    // ─── Initialization ─────────────────────────────────────

    function init() {
        cacheDom();

        // Slider events
        const sliderConfig = [
            { slider: dom.sliderSaFreq, display: dom.valSaFreq, dec: 2 },
            { slider: dom.sliderAvFreq, display: dom.valAvFreq, dec: 2 },
            { slider: dom.sliderCoupling, display: dom.valCoupling, dec: 2 },
            { slider: dom.sliderMu, display: dom.valMu, dec: 2 },
            { slider: dom.sliderDuration, display: dom.valDuration, dec: 1 },
        ];

        sliderConfig.forEach(({ slider, display, dec }) => {
            slider.addEventListener('input', () => updateSliderDisplay(slider, display, dec));
        });

        dom.scenario.addEventListener('change', () => {
            const scenario = dom.scenario.value;
            setParams({ ...BASELINE, ...SCENARIOS[scenario], scenario });
            onRunSimulation();
        });

        dom.controlView.addEventListener('change', () => {
            if (!simData) return;
            updateStatusMetrics(); updateComparisonTable(); drawAllPlots(null);
        });

        // Button events
        dom.btnRun.addEventListener('click', onRunSimulation);
        dom.btnReset.addEventListener('click', onReset);
        dom.btnBaseline.addEventListener('click', onBaseline);
        dom.btnSaveRef.addEventListener('click', onSaveRef);
        dom.btnClearRef.addEventListener('click', onClearRef);

        // Resize handler
        let resizeTimer;
        window.addEventListener('resize', () => {
            clearTimeout(resizeTimer);
            resizeTimer = setTimeout(() => {
                if (simData) {
                    stopPlayback();
                    drawAllPlots(null);
                    renderControlComparison();
                    drawInteraction(simData.t[simData.t.length - 1]);
                    startPlayback();
                } else {
                    drawInteraction(undefined);
                }
            }, 200);
        });

        // Initial draw
        setParams({ ...BASELINE });
        showEmptyOverlays(true);
        drawInteraction(undefined);
    }

    // ─── Boot ───────────────────────────────────────────────

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
