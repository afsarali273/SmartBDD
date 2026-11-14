import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type {
  Attachment,
  BddxEvent,
  ErrorInfo,
  HookFinished,
  Log,
  PlannedGroup,
  PlannedScenario,
  RunSummary,
  ScenarioFinished,
  ScenarioStarted,
  Status,
  StepAttemptFinished,
  StepFinished,
} from '@bddx/core';
import { attemptsNote, LogIndex, type ReportLogLevel } from './logs.js';
import type { Reporter, ReporterOptions } from './types.js';

/**
 * Self-contained HTML report (one file, no external assets).
 * Shows: run summary, groups, every scenario with steps, errors, logs (per step and per scenario), attachments
 * (images inline), skip reasons, hook failures and run-level logs. Filters: status, log level, framework logs, search.
 *
 * Options: outputFile (default reports/report.html), title, logLevel (lowest level embedded; default 'debug' so the
 * viewer can switch levels in the page).
 */
export function htmlReporter(raw: ReporterOptions = {}): Reporter {
  const outputFile = String(raw['outputFile'] ?? 'reports/report.html');
  const title = String(raw['title'] ?? 'bddx report');
  const logs = new LogIndex((raw['logLevel'] as ReportLogLevel | undefined) ?? 'debug', true);
  const data: ReportData = {
    title,
    plan: [],
    groups: [],
    workers: 1,
    started: new Map(),
    results: new Map(),
    steps: new Map(),
    attempts: new Map(),
    attachments: [],
    hookFailures: [],
    logs,
  };
  let html = '';
  return {
    name: 'html',
    onEvent(e: BddxEvent) {
      switch (e.type) {
        case 'runStarted':
          data.startedAt = e.ts;
          data.runId = e.runId;
          data.dryRun = e.dryRun;
          break;
        case 'planReady':
          data.plan.push(...e.scenarios);
          data.groups = e.groups ?? [];
          data.workers = e.workers ?? 1;
          break;
        case 'scenarioStarted':
          data.started.set(e.scenarioId, e);
          break;
        case 'stepFinished':
          data.steps.set(`${e.scenarioId}|${e.stepId}`, e);
          break;
        case 'stepAttemptFinished': {
          const k = `${e.scenarioId}|${e.stepId}`;
          data.attempts.set(k, [...(data.attempts.get(k) ?? []), e]);
          break;
        }
        case 'scenarioFinished':
          data.results.set(e.scenarioId, e);
          break;
        case 'attachment':
          data.attachments.push(e);
          break;
        case 'log':
          logs.add(e);
          break;
        case 'hookFinished':
          if (e.status === 'failed') data.hookFailures.push(e);
          break;
        case 'runFinished':
          data.summary = e.summary;
          data.success = e.success;
          if (e.error) data.runError = e.error;
          html = renderHtml(data);
          break;
        default:
          break;
      }
    },
    async close() {
      if (!html) return;
      mkdirSync(dirname(outputFile), { recursive: true });
      writeFileSync(outputFile, html, 'utf8');
    },
  };
}

interface ReportData {
  title: string;
  runId?: string;
  startedAt?: number;
  dryRun?: boolean;
  plan: PlannedScenario[];
  groups: PlannedGroup[];
  workers: number;
  started: Map<string, ScenarioStarted>;
  results: Map<string, ScenarioFinished>;
  steps: Map<string, StepFinished>;
  attempts: Map<string, StepAttemptFinished[]>;
  attachments: Attachment[];
  hookFailures: HookFinished[];
  logs: LogIndex;
  summary?: RunSummary;
  success?: boolean;
  runError?: ErrorInfo;
}

const ICON: Record<Status, string> = { passed: '✔', failed: '✘', skipped: '↷', pending: '…', undefined: '?', ambiguous: '‼' };
const ORDER: Status[] = ['passed', 'failed', 'pending', 'undefined', 'ambiguous', 'skipped'];

function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function ms(n: number | undefined): string {
  if (n === undefined) return '';
  return n >= 1000 ? `${(n / 1000).toFixed(2)} s` : `${Math.round(n)} ms`;
}

function renderLogs(list: Log[]): string {
  if (!list.length) return '';
  return `<div class="logs">${list
    .map((l) => {
      const level = l.level ?? 'info';
      const d =
        l.data === undefined ? '' : `<code class="data">${esc(JSON.stringify(l.data, null, 1)?.slice(0, 5000) ?? String(l.data))}</code>`;
      const a = l.attachment;
      const att = !a
        ? ''
        : a.mediaType.startsWith('image/')
          ? `<a class="logimg" href="data:${esc(a.mediaType)};base64,${a.body}" target="_blank" rel="noopener"><img loading="lazy" alt="${esc(a.name ?? l.message)}" src="data:${esc(a.mediaType)};base64,${a.body}"></a>`
          : `<a class="logfile" download="${esc(a.name ?? 'attachment')}" href="data:${esc(a.mediaType)};base64,${a.body}">📎 ${esc(a.name ?? a.mediaType)}</a>`;
      return `<div class="log lv-${level}${l.source === 'bddx' ? ' src-bddx' : ''}"><span class="lvl">${l.source === 'bddx' ? 'bddx:' : ''}${level}</span>${
        l.attempt ? `<span class="nth">#${l.attempt}</span>` : ''
      }<span class="msg">${esc(l.message)}</span>${d}${att}</div>`;
    })
    .join('')}</div>`;
}

function renderAttachments(list: Attachment[]): string {
  if (!list.length) return '';
  return `<div class="atts">${list
    .map((a) => {
      const name = esc(a.name ?? a.mediaType);
      if (a.encoding === 'base64' && a.mediaType.startsWith('image/')) {
        return `<figure><figcaption>${name}</figcaption><img loading="lazy" src="data:${esc(a.mediaType)};base64,${a.body}" alt="${name}"></figure>`;
      }
      if (a.encoding === 'identity') {
        let body = a.body;
        if (a.mediaType.includes('json')) {
          try {
            body = JSON.stringify(JSON.parse(a.body), null, 2);
          } catch {
            /* keep raw */
          }
        }
        return `<details class="att"><summary>📎 ${name}</summary><pre>${esc(body.slice(0, 100_000))}</pre></details>`;
      }
      return `<div class="att">📎 <a download="${name}" href="data:${esc(a.mediaType)};base64,${a.body}">${name}</a></div>`;
    })
    .join('')}</div>`;
}

function renderError(e: ErrorInfo | undefined): string {
  return e ? `<pre class="err">${esc(e.stack ?? e.message)}</pre>` : '';
}

export function renderHtml(d: ReportData): string {
  const s = d.summary;
  const attBy = new Map<string, Attachment[]>();
  for (const a of d.attachments) {
    const k = `${a.scenarioId ?? ''}|${a.stepId ?? ''}`;
    attBy.set(k, [...(attBy.get(k) ?? []), a]);
  }
  const byFeature = new Map<string, PlannedScenario[]>();
  for (const sc of d.plan) byFeature.set(sc.uri, [...(byFeature.get(sc.uri) ?? []), sc]);

  const features = [...byFeature.entries()]
    .map(([uri, scenarios]) => {
      const statuses = scenarios.map((x) => d.results.get(x.id)?.status ?? 'skipped');
      const counts = ORDER.filter((st) => statuses.includes(st))
        .map((st) => `<span class="pill st-${st}">${statuses.filter((x) => x === st).length} ${st}</span>`)
        .join('');
      const items = scenarios
        .map((sc) => {
          const r = d.results.get(sc.id);
          const status: Status = r?.status ?? 'skipped';
          const started = d.started.get(sc.id);
          const row = sc.example
            ? sc.example.source
              ? `${sc.example.source} row ${sc.example.sourceRow}`
              : `${sc.example.name ? `${sc.example.name} ` : ''}#${sc.example.index}`
            : '';
          const chips = [
            ...(sc.groups ?? []).map((g) => `<span class="chip grp">group:${esc(g)}</span>`),
            ...sc.tags.map((t) => `<span class="chip">${esc(t)}</span>`),
          ].join('');
          const deps = sc.dependsOn?.length
            ? `<div class="deps">waits for ${sc.dependsOn.map((x) => `<code>${esc(x.id)}</code>${x.soft ? ' (soft)' : ''}`).join(', ')}</div>`
            : '';
          const steps = sc.steps
            .map((st) => {
              const sf = d.steps.get(`${sc.id}|${st.id}`);
              const sst: Status = sf?.status ?? 'skipped';
              const snippet = sf?.snippet ? `<pre class="snippet">${esc(sf.snippet)}</pre>` : '';
              const tries = d.attempts.get(`${sc.id}|${st.id}`) ?? [];
              const note = sf ? attemptsNote(sf, tries[0]?.of) : '';
              const triesHtml = tries.length
                ? `<details class="tries"><summary>${esc(note || `${tries.length} attempt(s)`)}</summary><ol>${tries
                    .map(
                      (t) =>
                        `<li class="st-${t.status}"><span class="ico">${ICON[t.status]}</span> #${t.attempt} <span class="txt">${esc(t.text)}</span> <span class="dur">${ms(
                          t.durationMs,
                        )}</span>${t.error ? `<div class="terr">${esc(t.error.message)}</div>` : ''}</li>`,
                    )
                    .join('')}</ol></details>`
                : '';
              return `<li class="step st-${sst}"><div class="line"><span class="ico">${ICON[sst]}</span><span class="kw">${esc(
                st.keyword.trim(),
              )}</span> <span class="txt">${esc(st.text)}</span><span class="dur">${ms(sf?.durationMs)}</span></div>${renderError(
                sst === 'failed' || sst === 'ambiguous' ? sf?.error : undefined,
              )}${snippet}${triesHtml}${renderLogs(d.logs.forStep(sc.id, st.id))}${renderAttachments(attBy.get(`${sc.id}|${st.id}`) ?? [])}</li>`;
            })
            .join('');
          const text = esc(`${sc.name} ${sc.id} ${sc.uri} ${sc.tags.join(' ')} ${(sc.groups ?? []).join(' ')}`.toLowerCase());
          const open = status === 'failed' || status === 'ambiguous' || status === 'undefined' ? ' open' : '';
          return `<details class="scenario st-${status}" data-status="${status}" data-text="${text}"${open}>
<summary><span class="ico">${ICON[status]}</span><span class="name">${esc(sc.name)}</span>${
            sc.ruleName ? `<span class="rule">Rule: ${esc(sc.ruleName)}</span>` : ''
          }${row ? `<span class="row">${esc(row)}</span>` : ''}<span class="meta">${ms(r?.durationMs)}${started ? ` · ${esc(started.workerId)}` : ''}</span></summary>
<div class="body"><div class="where"><code>${esc(sc.id)}</code> · ${esc(sc.uri)}:${sc.line}</div>${chips ? `<div class="chips">${chips}</div>` : ''}${deps}${
            r?.reason ? `<div class="reason">Skipped: ${esc(r.reason)}</div>` : ''
          }${renderError(status === 'failed' && !sc.steps.some((st) => d.steps.get(`${sc.id}|${st.id}`)?.error) ? r?.error : undefined)}${renderLogs(
            d.logs.scenarioOnly(sc.id),
          )}${renderAttachments(attBy.get(`${sc.id}|`) ?? [])}<ol class="steps">${steps}</ol></div></details>`;
        })
        .join('\n');
      return `<section class="feature"><h2>${esc(scenarios[0]!.feature?.name ?? scenarios[0]!.featureName)} <span class="uri">${esc(uri)}</span> ${counts}</h2>${
        scenarios[0]!.feature?.description ? `<p class="desc">${esc(scenarios[0]!.feature.description)}</p>` : ''
      }${items}</section>`;
    })
    .join('\n');

  const totals = s
    ? ORDER.filter((st) => s.scenarios[st] > 0)
        .map((st) => `<label class="pill st-${st}"><input type="checkbox" data-filter="${st}" checked> ${s.scenarios[st]} ${st}</label>`)
        .join('')
    : '';
  const groups = d.groups.length
    ? `<div class="groups">${d.groups
        .map((g) => `<span class="chip grp">${esc(g.name)}: ${esc(g.mode)}${g.workers ? ` ×${g.workers}` : ''} (${g.members.length})${g.dependsOn.length ? ` after ${esc(g.dependsOn.join(', '))}` : ''}</span>`)
        .join('')}</div>`
    : '';
  const hookFailures = d.hookFailures.filter((h) => !h.scenarioId);
  const runSection =
    hookFailures.length || d.logs.run.length || d.runError
      ? `<section class="feature run"><h2>Run</h2>${renderError(d.runError)}${hookFailures
          .map((h) => `<div class="reason">${esc(h.kind)} ${esc(h.level)} hook "${esc(h.hookName)}"${h.uri ? ` (${esc(h.uri)})` : ''} failed</div>${renderError(h.error)}`)
          .join('')}${renderLogs(d.logs.run)}</section>`
      : '';
  const when = d.startedAt ? new Date(d.startedAt).toISOString().replace('T', ' ').slice(0, 19) + ' UTC' : '';

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(d.title)}</title>
<style>
:root{--bg:#fff;--fg:#1d2025;--muted:#6b7280;--line:#e5e7eb;--card:#f9fafb;--passed:#15803d;--failed:#b91c1c;--skipped:#0e7490;--pending:#a16207;--undefined:#a16207;--ambiguous:#7e22ce;--debug:#6b7280;--info:#0369a1;--warn:#a16207;--error:#b91c1c}
@media (prefers-color-scheme:dark){:root{--bg:#111318;--fg:#e5e7eb;--muted:#9ca3af;--line:#2a2f3a;--card:#181b22;--passed:#4ade80;--failed:#f87171;--skipped:#22d3ee;--pending:#facc15;--undefined:#facc15;--ambiguous:#c084fc;--debug:#9ca3af;--info:#38bdf8;--warn:#facc15;--error:#f87171}}
*{box-sizing:border-box}body{margin:0;font:14px/1.45 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:var(--bg);color:var(--fg)}
header{position:sticky;top:0;z-index:2;background:var(--bg);border-bottom:1px solid var(--line);padding:12px 20px}
h1{font-size:18px;margin:0 0 6px}h1 .badge{font-size:12px;padding:2px 8px;border-radius:10px;color:#fff;margin-left:8px;vertical-align:middle}
.ok{background:var(--passed)}.ko{background:var(--failed)}.sub{color:var(--muted);font-size:12px}
.bar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:8px}
.pill{display:inline-block;border:1px solid currentColor;border-radius:10px;padding:0 8px;font-size:12px;margin-left:4px;cursor:pointer}
.pill input{margin:0 2px 0 0;vertical-align:-1px}
input[type=search],select{background:var(--card);color:var(--fg);border:1px solid var(--line);border-radius:6px;padding:4px 8px}
button{background:var(--card);color:var(--fg);border:1px solid var(--line);border-radius:6px;padding:4px 10px;cursor:pointer}
main{padding:12px 20px 40px}.feature{margin:18px 0}.feature h2{font-size:15px;margin:0 0 6px}.uri{color:var(--muted);font-weight:normal;font-size:12px}
.desc{color:var(--muted);margin:0 0 8px;white-space:pre-wrap}
details.scenario{border:1px solid var(--line);border-left:4px solid var(--line);border-radius:6px;margin:6px 0;background:var(--card)}
details.scenario>summary{cursor:pointer;padding:6px 10px;display:flex;gap:8px;align-items:baseline;list-style:none}
details.scenario>summary::-webkit-details-marker{display:none}
.name{font-weight:600}.rule,.row,.meta{color:var(--muted);font-size:12px}.meta{margin-left:auto;white-space:nowrap}
.body{padding:0 12px 10px}.where{color:var(--muted);font-size:12px;margin-bottom:4px}
.chips{margin:4px 0}.chip{display:inline-block;font-size:11px;border:1px solid var(--line);border-radius:4px;padding:0 5px;margin:0 4px 2px 0;color:var(--muted)}
.grp{border-color:var(--info);color:var(--info)}.deps{font-size:12px;color:var(--muted);margin:2px 0}
.reason{color:var(--skipped);font-size:13px;margin:4px 0}
ol.steps{list-style:none;margin:6px 0 0;padding:0}.step{padding:3px 0;border-top:1px dashed var(--line)}
.line{display:flex;gap:6px;align-items:baseline}.kw{font-weight:600}.dur{margin-left:auto;color:var(--muted);font-size:12px}
.ico{width:1.1em;text-align:center}
${(['passed', 'failed', 'skipped', 'pending', 'undefined', 'ambiguous'] as const).map((st) => `.st-${st}>.ico,.st-${st}>.line>.ico,.pill.st-${st}{color:var(--${st})}details.st-${st}{border-left-color:var(--${st})}`).join('\n')}
pre{margin:4px 0 4px 22px;padding:6px 8px;background:var(--bg);border:1px solid var(--line);border-radius:4px;overflow:auto;font-size:12px;max-height:360px}
pre.err{border-color:var(--failed);color:var(--failed)}pre.snippet{border-style:dashed}
.logs{margin:2px 0 2px 22px;font:12px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace}
.log{display:flex;gap:6px;flex-wrap:wrap;padding:1px 0}.lvl{min-width:5.2em;font-weight:600;text-transform:uppercase;font-size:10.5px}
.lv-debug .lvl{color:var(--debug)}.lv-info .lvl{color:var(--info)}.lv-warn .lvl{color:var(--warn)}.lv-error .lvl{color:var(--error)}
.log .msg{white-space:pre-wrap}.log .data{color:var(--muted);white-space:pre-wrap;flex-basis:100%;margin-left:5.8em}
.logimg{flex-basis:100%;margin-left:5.8em}.logimg img{max-width:min(100%,640px);max-height:420px;border:1px solid var(--line);border-radius:4px;margin:3px 0}.logfile{margin-left:4px}
.tries{margin:2px 0 2px 22px;font-size:12px}.tries summary{cursor:pointer;color:var(--muted)}.tries ol{margin:2px 0;padding-left:18px;max-height:240px;overflow:auto}
.tries li{list-style:none}.tries .ico{display:inline-block}.terr{color:var(--failed);margin-left:1.6em;white-space:pre-wrap}.nth{color:var(--muted);font-size:11px}
.atts{margin:2px 0 2px 22px}figure{margin:6px 0}figcaption{font-size:12px;color:var(--muted)}figure img{max-width:min(100%,900px);border:1px solid var(--line);border-radius:4px}
.att summary{cursor:pointer;font-size:12px}
body.min-info .lv-debug,body.min-warn .lv-debug,body.min-warn .lv-info,body.min-error .lv-debug,body.min-error .lv-info,body.min-error .lv-warn{display:none}
body:not(.show-bddx) .src-bddx{display:none}.hidden{display:none!important}
</style></head>
<body class="min-info">
<header>
<h1>${esc(d.title)}<span class="badge ${d.success ? 'ok' : 'ko'}">${d.success ? 'PASSED' : 'FAILED'}</span>${d.dryRun ? '<span class="badge ko">DRY RUN</span>' : ''}</h1>
<div class="sub">${esc(when)} · ${ms(s?.durationMs)} · ${s?.scenarios.total ?? 0} scenarios, ${s?.steps.total ?? 0} steps · workers ${d.workers}${d.runId ? ` · run ${esc(d.runId.slice(0, 8))}` : ''}</div>
<div class="bar">${totals}
<input type="search" id="q" placeholder="Search name, tag, id, group…">
<label class="sub">logs <select id="lvl"><option value="debug">debug</option><option value="info" selected>info</option><option value="warn">warn</option><option value="error">error</option><option value="none">none</option></select></label>
<label class="sub"><input type="checkbox" id="bddx"> framework logs</label>
<button id="expand">expand all</button><button id="collapse">collapse all</button>
</div>${groups}
</header>
<main>
${features}
${runSection}
</main>
<script>
(function(){
  var body=document.body,q=document.getElementById('q');
  function apply(){
    var off={};document.querySelectorAll('[data-filter]').forEach(function(c){if(!c.checked)off[c.getAttribute('data-filter')]=1});
    var text=q.value.trim().toLowerCase();
    document.querySelectorAll('details.scenario').forEach(function(d){
      var hide=off[d.getAttribute('data-status')]||(text&&d.getAttribute('data-text').indexOf(text)<0);
      d.classList.toggle('hidden',!!hide);
    });
  }
  document.querySelectorAll('[data-filter]').forEach(function(c){c.addEventListener('change',apply)});
  q.addEventListener('input',apply);
  document.getElementById('lvl').addEventListener('change',function(e){
    body.classList.remove('min-info','min-warn','min-error');var v=e.target.value;
    document.querySelectorAll('.logs').forEach(function(l){l.classList.toggle('hidden',v==='none')});
    if(v!=='debug'&&v!=='none')body.classList.add('min-'+v);
  });
  document.getElementById('bddx').addEventListener('change',function(e){body.classList.toggle('show-bddx',e.target.checked)});
  document.getElementById('expand').addEventListener('click',function(){document.querySelectorAll('details.scenario:not(.hidden)').forEach(function(d){d.open=true})});
  document.getElementById('collapse').addEventListener('click',function(){document.querySelectorAll('details.scenario').forEach(function(d){d.open=false})});
})();
</script>
</body></html>
`;
}
