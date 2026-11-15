/**
 * HTML report: layout polish and responsive rules. Loaded last so it overrides the base styles.
 * Breakpoints: <= 900px (tablet: no sticky filter bar, tighter spacing), <= 720px (phone: stacked data rows,
 * scrolling action row, two-column KPIs), <= 520px (small phones: compact tab bar).
 */
export const RESPONSIVE_CSS = `
:focus-visible{outline:2px solid var(--accent);outline-offset:2px;border-radius:4px}
.badge{font-size:11px;padding:1px 9px;border-radius:10px;color:#fff;letter-spacing:.03em;font-weight:600}
header.top{position:static;padding:12px 0 6px}
.tabbar{position:sticky;top:0;z-index:6;background:var(--card);border-bottom:1px solid var(--line);box-shadow:var(--shadow)}
.tabbar .wrap{display:flex;align-items:center;gap:12px}
.tabbar .tabs{margin:0;flex:1;min-width:0}
.tb-status{display:flex;gap:8px;align-items:center;font-size:12px;color:var(--muted);white-space:nowrap}
.toolbar{position:sticky;top:44px;z-index:4}
.tb-count{margin-left:auto;font-size:12px;color:var(--muted)}
#nomatch{display:none;text-align:center;color:var(--muted);padding:36px 0}#nomatch.show{display:block}
details.scenario,.dataset,.feature{scroll-margin-top:150px}
#totop{position:fixed;right:16px;bottom:16px;width:40px;height:40px;border-radius:50%;padding:0;font-size:18px;box-shadow:0 2px 8px rgba(0,0,0,.25);opacity:0;pointer-events:none;transition:opacity .2s;z-index:7}
#totop.show{opacity:.92;pointer-events:auto}
.view{overflow-x:auto}
pre.err{padding-right:56px}
.grid{grid-template-columns:repeat(auto-fit,minmax(min(340px,100%),1fr))}.grid.wide3{grid-template-columns:repeat(auto-fit,minmax(min(440px,100%),1fr))}
@media (hover:none){.perma{opacity:1}}

@media (max-width:900px){
  .toolbar{position:static}
  details.scenario,.dataset,.feature{scroll-margin-top:60px}
  .view svg.timeline{min-width:680px}
}

@media (max-width:720px){
  body{font-size:15px}
  .wrap{padding:0 12px}main{padding:12px 10px 70px}
  h1{font-size:17px}
  .actions{flex-wrap:nowrap;overflow-x:auto;width:100%;padding-bottom:4px;-webkit-overflow-scrolling:touch}.actions button{white-space:nowrap;flex:none}
  button,select,input[type=search]{min-height:38px}
  .kpis{grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.kpi{padding:10px 12px}.k-val{font-size:22px}.k-sub{font-size:11px}
  .grid,.grid.wide3{grid-template-columns:minmax(0,1fr);gap:10px}
  .card{padding:10px 12px}.dstats{gap:6px 14px}.donut{width:120px;height:120px}
  .stable .w,.stable thead th:nth-child(2){display:none}
  .toolbar{padding:8px 10px}
  .tb-row{gap:6px}.tb-row:nth-of-type(2)>*{flex:1 1 auto}.tb-row:nth-of-type(2)>button{flex:1 1 40%}.pill{margin-left:0}
  input[type=search]{min-width:0;width:100%;max-width:none;flex:1 1 100%}
  .presets{margin-left:0}
  .feature h2{font-size:14px}.feature h2 .uri{display:block;margin:2px 0}
  details.scenario>summary{flex-wrap:wrap;gap:2px 8px;padding:8px 10px}.name{flex:1 1 0;min-width:45%}.rule,.row{flex-basis:100%}
  .body{padding:0 10px 10px}.where{overflow-wrap:anywhere}
  .line{flex-wrap:wrap}.line .txt{flex:1 1 60%;min-width:0;overflow-wrap:anywhere}
  pre,.logs,.tries,.atts,.argwrap,.docstring{margin-left:6px}.log .data,.logimg{margin-left:0}.lvl{min-width:4em}
  pre{max-height:300px}
  /* data-driven rows: one labelled card per row instead of a wide table */
  .dgrid:not(.wide)>.dhead{display:none}
  .dset-head{padding:9px 10px;gap:6px 10px}.dset-time{margin-left:0}.dset-bar{width:100%;order:9}
  .dgrid{padding:0 6px 6px}.dgrid:not(.wide){overflow-x:visible}
  .dgrid:not(.wide)>details.scenario{min-width:0}
  .dgrid:not(.wide)>details.scenario>summary{display:flex;flex-wrap:wrap;gap:4px 14px;align-items:baseline}
  .dgrid:not(.wide) summary .dc{white-space:normal;overflow:visible;overflow-wrap:anywhere}
  .dgrid:not(.wide) summary .dc[data-label]::before{content:attr(data-label);color:var(--muted);font-size:10.5px;text-transform:uppercase;letter-spacing:.03em;margin-right:5px}
  .dgrid:not(.wide) summary .dc-flags:empty{display:none}
  .dgrid:not(.wide) .pin{gap:8px}
  .dgrid:not(.wide) summary .meta{margin-left:auto}
  .dgrid:not(.wide) .dc-err{flex-basis:100%;margin-top:0}
  .dtemplate ol{margin-left:6px}.dtemplate li{overflow-wrap:anywhere}
  .view{padding:4px 8px}
  .hl{font-size:9px}
}

@media (max-width:520px){
  .tb-status{display:none}
  .tabs a{padding:9px 12px}
}
@media print{.tabbar,#totop{display:none}.toolbar{position:static}}
`;
