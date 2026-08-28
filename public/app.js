const app = document.querySelector('#app');
const money = (n) => n >= 1e12 ? `$${(n/1e12).toFixed(2)}万亿` : n >= 1e8 ? `$${(n/1e8).toFixed(2)}亿` : n >= 1e4 ? `$${(n/1e4).toFixed(1)}万` : `$${Number(n||0).toLocaleString()}`;
const number = (n) => Number(n||0).toLocaleString('zh-CN',{maximumFractionDigits:2});
const pct = (n) => `${Number(n||0).toFixed(2)}%`;
const esc = (v) => String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const api = async (path) => { const r=await fetch(path); if(!r.ok) throw new Error((await r.json()).error||`请求失败 ${r.status}`); return r.json(); };
const label = {new:'新出现',increase:'增持披露',decrease:'减持披露',sold:'不再披露',unchanged:'未变'};
const source = (v) => v==='ARK'?'ARK 日频':'SEC 13F';

function set(html){app.innerHTML=html;app.focus({preventScroll:true});window.scrollTo({top:0,behavior:'smooth'});}
function fail(err){set(`<div class="error"><span class="error-code">DATA / OFFLINE</span><h2>数据暂时无法读取</h2><p>${esc(err.message)}</p><button class="button" data-retry>重新连接</button></div>`);}
function table(rows,cols,empty='暂无数据'){
  if(!rows.length)return `<div class="empty">${empty}</div>`;
  return `<div class="table-wrap"><table><thead><tr>${cols.map(c=>`<th class="${c.num?'num':''}">${c.name}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr>${cols.map(c=>`<td class="${c.num?'num':''}">${c.render?c.render(r):esc(r[c.key])}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}
const managerCols=[
  {name:'投资人与机构',render:r=>`<a class="manager-link" href="#/manager/${esc(r.id)}">${esc(r.display_name)}</a><div class="source">${esc(r.category)} · ${source(r.source)}</div>`},
  {name:'报告期',key:'report_date'},{name:'披露日',key:'filed_date'},
  {name:'组合规模',num:1,render:r=>money(r.total_value)},{name:'持仓',num:1,render:r=>number(r.positions_count)}
];
const currentRows = (d) => d.positions.filter(x=>x.change_type!=='sold');
const concentration = (d) => currentRows(d).slice(0,10).reduce((a,x)=>a+Number(x.weight),0);
const changeRate = (r) => r.previous_shares ? (r.shares-r.previous_shares)/Math.abs(r.previous_shares)*100 : r.change_type==='new' ? 100 : r.change_type==='sold' ? -100 : 0;
const initials = (name) => name.replace(/\s*\/.*$/,'').slice(0,2).toUpperCase();

function portrait(id,name){
  const kind=id==='hh'?'duan':id==='berkshire'?'buffett':id.startsWith('ark')?'cathie':'';
  return kind?`<div class="portrait-window ${kind}" aria-hidden="true"><img src="/assets/investor-trio.png" alt=""></div>`:`<div class="portrait-fallback" aria-hidden="true">${esc(initials(name))}</div>`;
}

function donut(rows){
  const top=rows.slice(0,6),rest=Math.max(0,100-top.reduce((s,r)=>s+Number(r.weight),0));let offset=0;
  const circles=[...top.map((r,i)=>({value:Number(r.weight),tone:i})),{value:rest,tone:6}].map(x=>{const out=`<circle class="tone-${x.tone}" cx="64" cy="64" r="47" pathLength="100" stroke-dasharray="${x.value} ${100-x.value}" stroke-dashoffset="${-offset}"/>`;offset+=x.value;return out;}).join('');
  return `<div class="donut-wrap"><svg class="donut" viewBox="0 0 128 128" aria-label="前六大持仓权重">${circles}<circle class="donut-hole" cx="64" cy="64" r="35"/><text x="64" y="60">TOP 6</text><text class="donut-value" x="64" y="77">${pct(100-rest)}</text></svg><div class="legend">${top.map((r,i)=>`<a href="#/stock/${esc(r.cusip)}"><i class="tone-bg-${i}"></i><span>${esc(r.ticker||r.issuer)}</span><b>${pct(r.weight)}</b></a>`).join('')}</div></div>`;
}

function movementChart(rows){
  const movers=rows.filter(r=>r.change_type!=='unchanged').sort((a,b)=>Math.abs(changeRate(b))-Math.abs(changeRate(a))).slice(0,7);
  if(!movers.length)return '<div class="empty compact">相邻报告期披露股数未发生变化</div>';
  const max=Math.max(...movers.map(r=>Math.abs(changeRate(r))),1);
  return `<div class="movement-chart">${movers.map(r=>{const rate=changeRate(r),width=Math.max(5,Math.abs(rate)/max*46),x=rate<0?50-width:50;return `<a href="#/stock/${esc(r.cusip)}" class="movement-row"><span>${esc(r.ticker||r.issuer)}</span><svg viewBox="0 0 100 12" preserveAspectRatio="none" aria-hidden="true"><line x1="50" y1="0" x2="50" y2="12"/><rect class="${rate>=0?'positive':'negative'}" x="${x}" y="2" width="${width}" height="8" rx="1"/></svg><b class="${rate>=0?'up':'down'}">${rate>0?'+':''}${rate.toFixed(1)}%</b></a>`;}).join('')}<div class="axis"><span>减少</span><span>0</span><span>增加</span></div></div>`;
}

async function home(){
  const [data,berkshire,duan,ark,consensus]=await Promise.all([api('/api/summary'),api('/api/managers/berkshire'),api('/api/managers/hh'),api('/api/managers/arkk'),api('/api/stocks')]);
  const featured=berkshire,rows=currentRows(featured),news=featured.positions.filter(x=>x.change_type==='new').length,sells=featured.positions.filter(x=>x.change_type==='sold').length,s=data.stats;
  set(`<section class="cinema-hero">
    <div class="hero-copy"><div class="eyebrow"><i></i> PUBLIC HOLDINGS INTELLIGENCE</div><h1>看懂高手的<br><em>真实持仓变化</em></h1><p>聚合知名投资人、主动基金与大型机构公开披露。比较股数，不用市值涨跌冒充买卖。</p><div class="hero-actions"><a class="button" href="#/managers">探索机构 <span>→</span></a><a class="text-link" href="#/sources">查看数据边界</a></div></div>
    <div class="hero-visual"><div class="glow"></div><img src="/assets/investor-trio.png" alt="段永平、沃伦·巴菲特与凯茜·伍德的编辑风格人物图"><div class="person-tags"><a href="#/manager/hh">段永平</a><a href="#/manager/berkshire">巴菲特</a><a href="#/manager/arkk">木头姐</a></div></div>
    <aside class="hero-terminal"><div class="terminal-head"><span>本期聚焦</span><i>LIVE</i></div><strong>巴菲特</strong><p>Berkshire Hathaway</p><div class="terminal-meta"><span>报告期 <b>${esc(featured.current.report_date)}</b></span><span>披露日 <b>${esc(featured.current.filed_date)}</b></span></div><div class="terminal-total"><span>组合市值</span><b>${money(featured.current.total_value)}</b></div></aside>
  </section>
  <div class="ticker-strip"><span><i></i> 已接通 ${number(s.synced)}/${number(s.managers)} 家</span><span>公开组合 ${money(s.total_value)}</span><span>持仓记录 ${number(s.positions)}</span><span>最近同步 ${esc(data.sync?.finished_at||'进行中')}</span></div>
  <section class="section"><div class="section-head"><div><div class="eyebrow">FEATURED PORTFOLIO</div><h2>巴菲特最新持仓驾驶舱</h2></div><a href="#/manager/berkshire">进入完整组合 →</a></div>
    <div class="kpi-grid"><div class="kpi featured"><span>前十大集中度</span><strong>${pct(concentration(featured))}</strong><small>按本期披露市值计算</small></div><div class="kpi"><span>持仓数量</span><strong>${number(featured.current.positions_count)}</strong><small>${esc(featured.current.report_date)}</small></div><div class="kpi positive"><span>新出现</span><strong>${news}</strong><small>相邻报告期对比</small></div><div class="kpi negative"><span>不再披露</span><strong>${sells}</strong><small>不等同实时卖出</small></div></div>
    <div class="cockpit-grid"><article class="panel"><div class="panel-head"><div><span>PORTFOLIO STRUCTURE</span><h3>核心持仓分布</h3></div><b>${rows.length} POSITIONS</b></div>${donut(rows)}</article><article class="panel"><div class="panel-head"><div><span>DISCLOSED SHARE CHANGE</span><h3>季度持股变化</h3></div><b>VS ${esc(featured.previous?.report_date||'—')}</b></div>${movementChart(featured.positions)}</article></div>
  </section>
  <section class="section dual-section"><article><div class="section-head"><div><div class="eyebrow">INSTITUTIONAL CONSENSUS</div><h2>机构共识</h2></div><a href="#/stocks">全部证券 →</a></div><div class="consensus-list">${consensus.slice(0,6).map((r,i)=>`<a href="#/stock/${esc(r.cusip)}"><em>${String(i+1).padStart(2,'0')}</em><div><strong>${esc(r.ticker||r.issuer)}</strong><span>${esc(r.issuer)}</span></div><b>${r.managers} 家</b></a>`).join('')}</div></article><article><div class="section-head"><div><div class="eyebrow">LATEST DISCLOSURES</div><h2>最新申报</h2></div><a href="#/managers">全部机构 →</a></div><div class="filing-feed">${data.latest.slice(0,6).map(r=>`<a href="#/manager/${esc(r.id)}"><i></i><div><strong>${esc(r.display_name)}</strong><span>${esc(r.filed_date)} · ${source(r.source)}</span></div><b>${money(r.total_value)}</b></a>`).join('')}</div></article></section>
  <section class="section trio-proof"><div><span>段永平关联</span><strong>${duan.current?money(duan.current.total_value):'待同步'}</strong></div><div><span>巴菲特 / Berkshire</span><strong>${money(berkshire.current.total_value)}</strong></div><div><span>木头姐 / ARKK</span><strong>${money(ark.current.total_value)}</strong></div></section>`);
}

async function managersPage(){
  const rows=await api('/api/managers');
  set(`<div class="page-head"><div><div class="eyebrow">TRACKED MANAGERS</div><h1>投资人与机构</h1><p>${rows.length} 家公开披露主体，覆盖知名投资人、主动基金、大型机构、量化与 ARK 日频。</p></div><div class="page-counter"><b>${rows.length}</b><span>MANAGERS</span></div></div><div class="toolbar"><div class="tabs" id="category-tabs"><button class="active" data-category="">全部</button>${[...new Set(rows.map(r=>r.category))].map(x=>`<button data-category="${esc(x)}">${esc(x)}</button>`).join('')}</div><input id="manager-search" type="search" placeholder="搜索机构 / 投资人" aria-label="搜索机构"></div><div id="manager-list">${managerCards(rows)}</div>`);
  const render=()=>{const q=document.querySelector('#manager-search').value.toLowerCase(),cat=document.querySelector('#category-tabs .active').dataset.category;document.querySelector('#manager-list').innerHTML=managerCards(rows.filter(r=>(!cat||r.category===cat)&&`${r.display_name} ${r.name}`.toLowerCase().includes(q)));};
  document.querySelector('#manager-search').addEventListener('input',render);document.querySelector('#category-tabs').addEventListener('click',e=>{if(e.target.matches('button')){document.querySelectorAll('#category-tabs button').forEach(x=>x.classList.remove('active'));e.target.classList.add('active');render();}});
}
function managerCards(rows){return rows.length?`<div class="manager-list">${rows.map((r,i)=>`<a href="#/manager/${esc(r.id)}" class="manager-row"><em>${String(i+1).padStart(2,'0')}</em><div class="manager-avatar">${esc(initials(r.display_name))}</div><div class="manager-name"><span class="badge">${esc(r.category)}</span><h3>${esc(r.display_name)}</h3><small>${source(r.source)} · ${esc(r.report_date||'待同步')}</small></div><div class="manager-value"><span>组合规模</span><strong>${r.total_value?money(r.total_value):'待同步'}</strong></div><div class="manager-value"><span>持仓数</span><strong>${number(r.positions_count)}</strong></div><b class="row-arrow">↗</b></a>`).join('')}</div>`:'<div class="empty">没有匹配的机构</div>';}

async function managerPage(id){
  const d=await api(`/api/managers/${encodeURIComponent(id)}`),m=d.manager;
  if(!d.current){set(`<div class="page-head"><div><div class="eyebrow">${source(m.source)}</div><h1>${esc(m.display_name)}</h1></div></div><div class="empty">首次数据同步中，请稍后刷新。</div>`);return;}
  const top=currentRows(d),newCount=d.positions.filter(x=>x.change_type==='new').length,soldCount=d.positions.filter(x=>x.change_type==='sold').length,max=Math.max(...d.filings.map(x=>Number(x.total_value)),1);
  set(`<section class="manager-hero"><div class="manager-portrait">${portrait(id,m.display_name)}</div><div class="manager-intro"><div class="eyebrow">${source(m.source)} · ${esc(m.category)}</div><h1>${esc(m.display_name)}</h1><p>${esc(m.name)}</p><div class="manager-tags"><span>报告期 ${esc(d.current.report_date)}</span><span>披露 ${esc(d.current.filed_date)}</span><a href="${esc(d.current.source_url)}" target="_blank" rel="noreferrer">原始披露 ↗</a></div></div><div class="manager-hero-value"><span>披露组合市值</span><strong>${money(d.current.total_value)}</strong><small>${number(d.current.positions_count)} 项持仓</small></div></section>
  <div class="kpi-grid manager-kpis"><div class="kpi featured"><span>前十大集中度</span><strong>${pct(concentration(d))}</strong><small>按披露市值计算</small></div><div class="kpi positive"><span>新出现</span><strong>${newCount}</strong><small>相邻报告期</small></div><div class="kpi negative"><span>不再披露</span><strong>${soldCount}</strong><small>不等同实时卖出</small></div><div class="kpi"><span>数据口径</span><strong>股数</strong><small>排除市值涨跌干扰</small></div></div>
  <div class="notice"><b>口径说明</b> 变化依据相邻报告期的披露股数计算。拆股、合并、换股和代码变更可能造成非交易变化，因此统一称“披露持股变化”。</div>
  <section class="section cockpit-grid"><article class="panel"><div class="panel-head"><div><span>PORTFOLIO STRUCTURE</span><h3>核心持仓</h3></div><b>${esc(d.current.report_date)}</b></div>${donut(top)}</article><article class="panel"><div class="panel-head"><div><span>QUARTERLY MOVERS</span><h3>持股变化对比</h3></div><b>VS ${esc(d.previous?.report_date||'—')}</b></div>${movementChart(d.positions)}</article></section>
  <section class="section"><div class="section-head"><div><div class="eyebrow">ALL POSITIONS</div><h2>完整持仓与变化</h2></div><div class="section-tools"><select id="change-filter" aria-label="筛选变化"><option value="">全部变化</option>${Object.entries(label).map(([k,v])=>`<option value="${k}">${v}</option>`).join('')}</select><a class="button secondary" href="/api/export.csv?manager=${encodeURIComponent(id)}">导出 CSV</a></div></div><div id="positions">${positionsTable(d.positions)}</div></section>
  <section class="section"><div class="section-head"><div><div class="eyebrow">HISTORY</div><h2>历史披露规模</h2></div></div><div class="panel timeline">${d.filings.filter((x,i,a)=>i===a.findIndex(y=>y.report_date===x.report_date)).map(f=>`<div class="bar-row"><span>${esc(f.report_date)}</span><progress value="${Number(f.total_value)}" max="${max}"></progress><strong>${money(f.total_value)}</strong></div>`).join('')}</div></section>`);
  document.querySelector('#change-filter').addEventListener('change',e=>document.querySelector('#positions').innerHTML=positionsTable(d.positions.filter(x=>!e.target.value||x.change_type===e.target.value)));
}
function positionsTable(rows){return table(rows,[
  {name:'证券',render:r=>`<a class="security" href="#/stock/${esc(r.cusip)}">${esc(r.ticker||r.issuer)}</a><div class="source">${esc(r.issuer)} · ${esc(r.cusip)}</div>`},
  {name:'行业',render:r=>r.sector?`<span class="sector">${esc(r.sector)}</span>`:'—'},
  {name:'披露变化',render:r=>`<span class="change ${esc(r.change_type)}">${label[r.change_type]}</span>`},
  {name:'本期股数',num:1,render:r=>number(r.shares)},{name:'上期股数',num:1,render:r=>r.previous_shares==null?'—':number(r.previous_shares)},
  {name:'股数变化',num:1,render:r=>r.previous_shares?`${changeRate(r)>0?'+':''}${changeRate(r).toFixed(1)}%`:'—'},
  {name:'市值',num:1,render:r=>money(r.value)},{name:'权重',num:1,render:r=>pct(r.weight)}
]);}

async function stocksPage(){
  const [initial,sectors]=await Promise.all([api('/api/stocks'),api('/api/sectors')]);
  set(`<div class="page-head"><div><div class="eyebrow">INSTITUTIONAL CONSENSUS</div><h1>证券与机构共识</h1><p>按 CUSIP 聚合各机构最新报告期；不同机构的报告期可能不同。</p></div></div><form id="stock-form" class="search-console"><input id="stock-q" type="search" placeholder="公司、Ticker 或 CUSIP" aria-label="搜索股票"><select id="sector-filter" aria-label="筛选板块"><option value="">全部板块</option>${sectors.map(x=>`<option>${esc(x.sector)}</option>`).join('')}</select><button class="button">搜索</button></form><div id="stock-results">${stocksTable(initial)}</div>`);
  document.querySelector('#stock-form').addEventListener('submit',async e=>{e.preventDefault();const q=document.querySelector('#stock-q').value,sector=document.querySelector('#sector-filter').value;document.querySelector('#stock-results').innerHTML='<div class="loading">正在聚合机构持仓…</div>';document.querySelector('#stock-results').innerHTML=stocksTable(await api(`/api/stocks?q=${encodeURIComponent(q)}&sector=${encodeURIComponent(sector)}`));});
}
function stocksTable(rows){return table(rows,[{name:'证券',render:r=>`<a class="security" href="#/stock/${esc(r.cusip)}">${esc(r.ticker||r.issuer)}</a><div class="source">${esc(r.issuer)} · ${esc(r.cusip)}</div>`},{name:'板块 / 行业',render:r=>r.sector?`<span class="sector">${esc(r.sector)}</span><div class="source industry">${esc(r.industry)}</div>`:'—'},{name:'持有机构',num:1,render:r=>`${number(r.managers)} 家`},{name:'合计披露市值',num:1,render:r=>money(r.total_value)},{name:'合计股数',num:1,render:r=>number(r.total_shares)}]);}
async function stockPage(cusip){const d=await api(`/api/stocks/${encodeURIComponent(cusip)}`),s=d.security;set(`<div class="security-hero"><div><div class="eyebrow">SECURITY · ${esc(s.cusip)}</div><h1>${esc(s.ticker||s.issuer)}</h1><p>${esc(s.issuer)} · ${d.holders.length} 家追踪机构最新披露</p></div><div class="security-meta"><span>${esc(s.sector||'板块待匹配')}</span><b>${esc(s.industry||'公开目录暂无可靠行业')}</b></div></div>${table(d.holders,[{name:'机构',render:r=>`<a class="manager-link" href="#/manager/${esc(r.manager_id)}">${esc(r.display_name)}</a><div class="source">${esc(r.category)}</div>`},{name:'报告期',key:'report_date'},{name:'股数',num:1,render:r=>number(r.shares)},{name:'市值',num:1,render:r=>money(r.value)},{name:'组合权重',num:1,render:r=>pct(r.weight)}])}`);}

async function comparePage(){
  const ms=await api('/api/managers'),options=ms.map(m=>`<option value="${esc(m.id)}">${esc(m.display_name)}</option>`).join('');
  set(`<div class="page-head"><div><div class="eyebrow">COMPARE MANAGERS</div><h1>机构横向对比</h1><p>选择 2–5 家机构，比较最新报告期规模、集中度与重合持仓。</p></div></div><form id="compare-form" class="panel compare-panel"><div class="compare-picks">${[0,1,2,3,4].map((_,i)=>`<label><span>机构 ${i+1}</span><select name="manager"><option value="">${i>1?'可选':'请选择'}</option>${options}</select></label>`).join('')}</div><button class="button">生成对比</button></form><div id="compare-result"></div>`);
  document.querySelector('#compare-form').addEventListener('submit',async e=>{e.preventDefault();const ids=[...new FormData(e.target).getAll('manager')].filter((x,i,a)=>x&&a.indexOf(x)===i);if(ids.length<2){document.querySelector('#compare-result').innerHTML='<div class="error compact">请选择至少两家不同机构</div>';return;}document.querySelector('#compare-result').innerHTML='<div class="loading">正在比对持仓…</div>';renderCompare(await api(`/api/compare?ids=${ids.join(',')}`),ids,ms);});
}
function renderCompare(rows,ids,ms){
  const group=(items,key)=>items.reduce((all,item)=>((all[item[key]]??=[]).push(item),all),{}),by=group(rows,'id'),summary=ids.map(id=>{const holdings=by[id]||[],meta=holdings[0]||ms.find(x=>x.id===id);return {...meta,top10:holdings.slice(0,10).reduce((a,x)=>a+Number(x.weight),0)}}),overlap=Object.values(group(rows,'cusip')).filter(g=>new Set(g.map(x=>x.id)).size>1).sort((a,b)=>b.length-a.length||b.reduce((s,x)=>s+x.value,0)-a.reduce((s,x)=>s+x.value,0));
  document.querySelector('#compare-result').innerHTML=`<div class="compare-summary">${summary.map(x=>`<article><span>${esc(x.display_name)}</span><strong>${money(x.total_value)}</strong><small>${esc(x.report_date||'无数据')} · 前十 ${pct(x.top10)}</small></article>`).join('')}</div><section class="section"><div class="section-head"><h2>重合持仓</h2></div>${table(overlap,[{name:'证券',render:g=>`<a class="security" href="#/stock/${esc(g[0].cusip)}">${esc(g[0].ticker||g[0].issuer)}</a>`},{name:'共同持有',render:g=>g.map(x=>esc(x.display_name)).join('、')},{name:'合计市值',num:1,render:g=>money(g.reduce((s,x)=>s+x.value,0))}],'未发现重合持仓')}</section>`;
}

async function alertsPage(){const d=await api('/api/summary');set(`<div class="page-head"><div><div class="eyebrow">DISCLOSURE ALERTS</div><h1>披露变化提醒</h1><p>订阅最新申报、新出现、不再披露与显著股数变化。</p></div></div><div class="alert-grid"><article class="panel alert-card"><span class="alert-icon">RSS</span><div><h3>订阅披露变化</h3><p>适用于 Feedly、Inoreader、NetNewsWire。选择披露股数变化阈值：</p><div class="alert-actions"><a class="button secondary" href="/api/feed.xml?threshold=10">10%</a><a class="button" href="/api/feed.xml?threshold=20">20%</a><a class="button secondary" href="/api/feed.xml?threshold=50">50%</a></div></div></article><article class="panel alert-card"><span class="alert-icon pulse">↻</span><div><h3>每小时自动检查</h3><p>源站未更新时不会生成重复记录。提醒描述的是公开披露变化，不等同实时交易。</p><div class="sync-status"><i></i>${esc(d.sync?.status||'running')} · ${esc(d.sync?.finished_at||'同步中')}</div></div></article></div><section class="section"><div class="section-head"><div><div class="eyebrow">RECENT FILINGS</div><h2>最近披露</h2></div></div>${table(d.latest,managerCols)}</section>`);}

async function sourcesPage(){const d=await api('/api/sources');set(`<div class="page-head"><div><div class="eyebrow">DATA PROVENANCE</div><h1>数据源与覆盖</h1><p>每一项持仓回到原始披露；补全字段仅在可可靠匹配时写入。</p></div><div class="sync-badge"><i></i>${esc(d.sync?.status||'未知')}</div></div><div class="source-stack">${d.sources.map((s,i)=>`<article><em>0${i+1}</em><div><span>${esc(s.cadence)}</span><h2>${esc(s.name)}</h2><p>${esc(s.detail)}</p><a href="${esc(s.official_url)}" target="_blank" rel="noreferrer">访问公开源 ↗</a></div><div class="source-count">${s.managers!=null?`<strong>${number(s.synced)}/${number(s.managers)}</strong><span>主体已接通</span>`:`<strong>${number(s.securities)}</strong><span>证券已匹配</span>`}<small>${esc(s.updated_at||'等待更新')}</small></div></article>`).join('')}</div><div class="data-boundary"><div class="eyebrow">READ BEFORE USE</div><h2>公开披露的边界</h2><div><p><b>13F 有滞后。</b>季末后最长 45 天才披露，不能当作实时仓位。</p><p><b>覆盖并不完整。</b>通常不含空头、现金、非 13(f) 证券和多数境外上市资产。</p><p><b>股数变化不必然是交易。</b>拆股、合并、换股与代码变更会影响披露股数。</p></div></div>`);}

const routes={managers:managersPage,stocks:stocksPage,compare:comparePage,alerts:alertsPage,sources:sourcesPage};
async function route(){try{const parts=location.hash.replace(/^#\/?/,'').split('/').filter(Boolean),name=parts[0];document.querySelectorAll('nav a').forEach(a=>a.classList.toggle('active',a.hash===`#/${name||''}`));if(name==='manager')await managerPage(parts[1]);else if(name==='stock')await stockPage(parts[1]);else await (routes[name]||home)();}catch(err){fail(err);}}
document.querySelector('.nav-toggle').addEventListener('click',e=>{const nav=document.querySelector('nav'),open=nav.classList.toggle('open');e.target.setAttribute('aria-expanded',open)});document.querySelector('nav').addEventListener('click',()=>document.querySelector('nav').classList.remove('open'));app.addEventListener('click',e=>{if(e.target.matches('[data-retry]'))route();});addEventListener('hashchange',route);route();
