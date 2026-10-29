# CardioTwin: cardiac digital twin and adaptive pacemaker control

CardioTwin is an educational control-systems project for exploring simulated heart rhythms and comparing fixed pacing, reactive pacing and adaptive model predictive control (MPC).

## Live website

**Open the deployed dashboard: [CardioTwin on AWS Amplify](https://main.dl4xlqlk86r7m.amplifyapp.com/).**

Use this public HTTPS link for the project demonstration. Visitors can use the dashboard in a modern browser without installing the source code or signing in to AWS.

## Where the website is hosted

| Item | Deployment details |
|---|---|
| Cloud provider | Amazon Web Services (AWS) |
| Hosting service | AWS Amplify Hosting |
| AWS Region | US East (N. Virginia), `us-east-1` |
| Application name | `CardioTwin` |
| Amplify application ID | `dl4xlqlk86r7m` |
| Deployment branch / environment | `main` |
| Hosting platform | `WEB` — static hosting |
| Website address | https://main.dl4xlqlk86r7m.amplifyapp.com/ |
| Deployment method | Manual ZIP upload using the AWS CLI; no Git repository connection |

To locate it in the AWS Console, sign in to the deployment account, select **US East (N. Virginia)**, then open **Amplify → CardioTwin → main**. The branch page shows the deployment history and website link.

The deployed ZIP contains `index.html`, `style.css`, `app.js` and `control.js` directly at its root. Amplify delivers these files through its managed hosting infrastructure. Tests, documentation and local AWS deployment files are excluded from the published website.

## Where the simulation and MPC run

**AWS hosts the website files. The heart simulation and controller calculations execute in the visitor's browser.**

```text
Visitor opens the public HTTPS link
                  |
                  v
AWS Amplify delivers HTML, CSS and JavaScript
                  |
                  v
The browser runs the heart model and pacing controllers
                  |
                  v
The browser displays ECG plots, pulses and comparison metrics
```

| Component | Responsibility | Execution location |
|---|---|---|
| AWS Amplify Hosting | Deliver the dashboard files over HTTPS | AWS |
| `index.html` | Dashboard structure, controls and chart containers | Browser |
| `style.css` | Responsive layout and visual styling | Browser |
| `app.js` | Oscillator simulation, rhythm scenarios, synthetic ECG and interactions | Browser |
| `control.js` | Ventricular phase plant, pacing controllers and performance calculations | Browser |

The current application has no simulation backend API, EC2 application server, Lambda computation backend or database. It does not upload ECG signals or experiment results to AWS for processing. Settings and saved reference waveforms are held in page memory and are cleared when the page is reloaded.

This architecture demonstrates a **cloud-hosted interactive dashboard with browser-based computation**. It does not demonstrate execution of the heart model or MPC on AWS servers. Cloud computation would require a separate backend extension.

## How the project is used

The dashboard supports academic demonstrations and control-system experiments. Users select a simulated rhythm, adjust settings, run the comparison and inspect the response. Scenarios include sinus rhythm, bradycardia, tachycardia, illustrative atrial fibrillation, 2:1 heart block and premature ventricular beats.

Each run compares uncontrolled behaviour, fixed pacing, reactive pacing and adaptive MPC under identical intrinsic disturbances and initial conditions. Results include tracking error, integrated absolute error, settling time, pulse count and normalised pacing effort. Signals are synthetic; the application is not connected to a patient or physical pacemaker and is not clinically validated.

## Run locally instead

Extract the source package and open `index.html` in a modern browser. Keep `control.js`, `app.js` and `style.css` beside it. No local backend server or build step is required. The hosted website needs internet access; a downloaded copy can run its calculations locally. Google Fonts are optional, with system-font fallbacks.

## Hosting configuration and updates

The app uses manual deployments. Automatic builds, automatic branch creation, pull-request previews and performance mode are disabled. No custom domain or WAF was added. Hosting is usage-based and should not be described as guaranteed zero-cost.

To publish later code changes, package the four website files at the ZIP root, create an Amplify deployment for the existing `main` branch, upload the ZIP and start that deployment. Updating the same branch retains the website address.

## Interface update

The workspace now uses a light clinical layout: an ECG-first display, live summary cards for the selected output, quick rhythm presets, and a compact experiment setup panel. MPC tuning and oscillator parameters expand when needed. Reference comparison and model documentation remain available through the workspace navigation. A genuine baseline simulation runs on first load. Reset clears its results; Run comparison or Restore baseline rhythm starts a new run. The simulation and controller equations are unchanged by this visual update.

## Run an experiment

1. Choose a rhythm scenario; its preset runs automatically.
2. For a useful control comparison, use Bradycardia or Heart block and set Simulation Duration to 20 seconds.
3. Set the target rate, control enable time, MPC horizon and pulse penalty, then press Run Comparison.
4. The comparison panel shows uncontrolled, fixed, reactive and adaptive MPC results for identical initial conditions and intrinsic phase disturbances. Use ECG output to view each method's captured-beat waveform. Reference saving retains the selected ECG output and target.
5. Other setting changes apply only on the next run. Reset restores default controller settings and clears the result panel.

## What was implemented

The SA/AV Van der Pol oscillator and scenario generator now drive a separate ventricular phase plant. A unit pacing pulse resets ventricular phase and creates a captured ventricular beat. It can therefore alter later output timing rather than just drawing pulse markers over an unchanged ECG. Upstream SA/AV traces remain unchanged. This is a reduced-order hybrid control experiment, not electrical-current injection into the SA/AV differential equations.

The intrinsic phase increment sequence is reconstructed from the original native beat intervals and replayed identically across methods. Uncontrolled phase crossings are sampled at 50 ms; their timing can differ from the original native generator by up to one sample. PVC morphology is associated with the active intrinsic disturbance interval; it is an illustrative template, not a tissue model. The native scenario's blocked-event markers continue to indicate blocked atrial responses even when pacing supplies ventricular activation.

- Fixed pacing attempts a pulse on an external target-period clock and inhibits attempts that violate actuator constraints.
- Reactive pacing waits for one target RR interval without a sensed ventricular beat.
- Adaptive MPC uses observed phase motion to update an intrinsic-rate estimate online (EWMA gain 0.2, initial estimate 1.2 cycles/s). Every 50 ms it searches a finite horizon of binary pulse sequences, applies the first action, then re-estimates and re-optimises. The estimated rate is held fixed within that horizon.
- MPC is solved approximately by a width-16 beam search. There is no claim of global optimality, formal stability, clinical validation, or universal superiority over reactive pacing.

All methods share a 250 ms refractory constraint and a 500 ms minimum interval between delivered pulses. Intrinsic activation is processed before a coincident pacing decision. The optimiser receives current measured state and its online estimate, not a future native beat schedule or arrhythmia label. The experiment assumes ideal twin phase sensing and guaranteed capture by each allowed unit pulse.

## Objective and metrics

Let r be the target in bpm, R = 60/r the target interval, age the time since the last output beat and rho the selected pulse penalty.

MPC objective over its horizon:

    sum dt*((predicted_rate/r - 1)^2 + 0.5*max(age/R - 1, 0)^2)
    + 2*sum_over_predicted_beats((RR/R - 1)^2)
    + rho*sum(u^2)

The beat penalty applies only when the predicted beat has a preceding beat. Binary u is 0 or 1; prediction horizon counts samples beginning with the current decision. Beam pruning approximates the constrained sequence search.

The causal rate is 60/max(last completed RR, time since last beat). It holds the latest completed-interval estimate but decays during prolonged pauses. If no completed RR is available, the display uses zero to indicate no rate estimate. Available pre-window simulated beat history initialises every method identically.

Metrics include only the post-enable interval:

- RMSE: sqrt(integral((rate-target)^2)/window length), in bpm.
- IAE: integral(abs(rate-target)), in bpm seconds.
- Settling: time after enable at which rate enters +/-5 bpm and remains in that band for the rest of the record, with at least 3 seconds of confirmation. A short tail or later violation cannot count as settled.
- Pacing effort: sum(u^2) over delivered pulses. Unit pulses make this equal to pulse count. It is normalised stimulation effort, not physical battery energy.

RMSE and IAE use left-rectangle integration of the 50 ms held output. A record ending before or at controller enable has no control-window metrics. Controls remain visible alongside a last-run summary, so changed settings do not relabel earlier results.

## Example verification result

Bradycardia preset, 20-second duration, target 72 bpm, enable at 3 s, 1.5 s horizon, pulse penalty 0.03:

| Method | RMSE (bpm) | IAE (bpm s) | Settling | Pulses / effort |
|---|---:|---:|---|---:|
| Uncontrolled | 27.29 | 463.83 | Not settled | 0 |
| Fixed | 4.39 | 45.74 | 0.85 s | 21 |
| Reactive | 4.14 | 37.64 | 0.85 s | 21 |
| Adaptive MPC | 4.14 | 37.64 | 0.85 s | 21 |

MPC and reactive control coincide for this simple steady disturbance at the default tuning. Tests also confirm that changing MPC's effort penalty changes its actions and that it updates its estimate when the intrinsic rate changes. Results are not constructed to make MPC always win.

Fast intrinsic rhythms remain a limitation: this actuator adds captured beats and phase resets; it does not supply negative stimulation, SA suppression or AF termination. Tachycardia can remain outside the band, and fixed pacing can worsen error. Interpret these as control-authority limits within the stated model. This experiment does not yet implement AI arrhythmia prediction or validated hardware pacing.

## Validation

Run with Node.js:

    node test-scenarios.cjs
    node test-control.cjs
    node test-control-boundaries.cjs

The checks cover all six rhythms, finite signals, reproducibility, conduction and ectopy, pre-control trajectory equality, pulse constraints, known-value metric integration, settling edge cases, future-disturbance independence of earlier decisions, online rate adaptation, effort-weight sensitivity, zero native conduction with paced capture, and the 60-second duration / horizon / target / effort extremes.

Browser checks passed in headless Microsoft Edge on desktop and a 390-pixel mobile viewport: scenario selection, all four result rows, output switching, reference labels, settings tied to the correct run, reset, no-control-window handling, and no JavaScript errors or page-level horizontal overflow.

## Model background

- [MathWorks: adaptive and time-varying MPC](https://www.mathworks.com/help/mpc/ug/adaptive-mpc.html) describes online prediction-model updates. It does not validate this custom beam-search implementation or ventricular plant.
- [NHLBI: arrhythmia types](https://www.nhlbi.nih.gov/health/arrhythmias/types) and [conduction disorders](https://www.nhlbi.nih.gov/health/conduction-disorders) supply general rhythm descriptions, not validation of the synthetic waveforms.
