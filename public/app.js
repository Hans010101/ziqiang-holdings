const app = document.querySelector('#app');
const money = (n) => n >= 1e12 ? `$${(n/1e12).toFixed(2)}万亿` : n >= 1e8 ? `$${(n/1e8).toFixed(2)}亿` : n >= 1e4 ? `$${(n/1e4).toFixed(1)}万` : `$${Number(n||0).toLocaleString()}`;
const number = (n) => Number(n||0).toLocaleString('zh-CN',{maximumFractionDigits:2});
const pct = (n) => `${Number(n||0).toFixed(2)}%`;
const esc = (v) => String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const api = async (path) => { const r=await fetch(path); if(!r.ok) throw new Error((await r.json()).error||`请求失败 ${r.status}`); return r.json(); };
const label = {new:'新出现',increase:'增加',decrease:'减少',sold:'不再披露',unchanged:'未变'};
const source = (v) => v==='ARK'?'ARK 日频':'SEC 13F';

function set(html){app.innerHTML=html;app.focus({preventScroll:true});window.scrollTo({top:0,behavior:'smooth'});}
function fail(err){set(`<div class="error"><h2>数据暂时无法读取</h2><p>${esc(err.message)}</p><button class="button" data-retry>重试</button></div>`);}
function table(rows, cols, empty='暂无数据'){
  if(!rows.length)return `<div class="empty">${empty}</div>`;
  return `<div class="table-wrap"><table><thead><tr>${cols.map(c=>`<th class="${c.num?'num':''}">${c.name}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr>${cols.map(c=>`<td class="${c.num?'num':''}">${c.render?c.render(r):esc(r[c.key])}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}
const managerCols=[
  {name:'机构',render:r=>`<a class="manager-link" href="#/manager/${esc(r.id)}">${esc(r.display_name)}</a><div class="source">${esc(r.category)} · ${source(r.source)}</div>`},
  {name:'最新报告期',key:'report_date'},{name:'披露日',key:'filed_date'},
  {name:'组合规模',num:1,render:r=>money(r.total_value)},{name:'持仓数',num:1,render:r=>number(r.positions_count)}
];

async function home(){
  const data=await api('/api/summary'),s=data.stats;
  set(`<section class="hero"><div><div class="eyebrow">Public holdings intelligence</div><h1>看清高手与机构<br>公开持仓的真实变化</h1><p>统一追踪段永平、巴菲特、ARK 与知名基金，以股数变化为核心，不用市值涨跌冒充买卖。</p></div><div class="hero-note"><strong>数据边界</strong><br>13F 是滞后披露且范围有限；当公司行动影响无法排除时，本站只称“披露持股变化”。</div></section>
    <div class="stats"><div class="stat"><span>追踪机构</span><strong>${number(s.managers)}</strong></div><div class="stat"><span>已有数据</span><strong>${number(s.synced)}</strong></div><div class="stat"><span>最新组合合计</span><strong>${money(s.total_value)}</strong></div><div class="stat"><span>持仓记录</span><strong>${number(s.positions)}</strong></div></div>
    <section class="section"><div class="section-head"><div><div class="eyebrow">Latest filings</div><h2>最新公开披露</h2></div><a href="#/managers">查看全部机构 →</a></div>${table(data.latest,managerCols,'数据正在首次同步，请稍后刷新')}</section>
    <section class="section two-col"><div class="card"><h3>主动投资人</h3><p class="muted">段永平、巴菲特、李录、Michael Burry、Pershing Square、Bridgewater 等。</p><a class="button secondary" href="#/managers">查看组合</a></div><div class="card"><h3>机构共识</h3><p class="muted">从各机构最新披露中聚合同一 CUSIP，查看被共同持有的证券。</p><a class="button secondary" href="#/stocks">查看股票</a></div></section>`);
}

async function managersPage(){
  const rows=await api('/api/managers');
  set(`<div class="page-head"><div><div class="eyebrow">Managers</div><h1>投资人与机构</h1><p>知名投资人、主动基金、大型机构及 ARK 日频持仓。</p></div></div><div class="toolbar"><div class="tabs" id="category-tabs"><button class="active" data-category="">全部</button>${[...new Set(rows.map(r=>r.category))].map(x=>`<button data-category="${esc(x)}">${esc(x)}</button>`).join('')}</div><input id="manager-search" type="search" placeholder="搜索机构" aria-label="搜索机构"></div><div id="manager-list">${managerCards(rows)}</div>`);
  const render=()=>{const q=document.querySelector('#manager-search').value.toLowerCase(),cat=document.querySelector('#category-tabs .active').dataset.category;document.querySelector('#manager-list').innerHTML=managerCards(rows.filter(r=>(!cat||r.category===cat)&&r.display_name.toLowerCase().includes(q)));};
  document.querySelector('#manager-search').addEventListener('input',render);document.querySelector('#category-tabs').addEventListener('click',e=>{if(e.target.matches('button')){document.querySelectorAll('#category-tabs button').forEach(x=>x.classList.remove('active'));e.target.classList.add('active');render();}});
}
function managerCards(rows){return `<div class="grid">${rows.map(r=>`<a class="card manager-card" href="#/manager/${esc(r.id)}"><span class="badge ${r.category==='知名投资人'?'red':''}">${esc(r.category)}</span><h3>${esc(r.display_name)}</h3><div class="metric">${r.total_value?money(r.total_value):'待同步'}</div><div class="muted">${r.report_date?`${esc(r.report_date)} · ${number(r.positions_count)} 项`:'尚无数据'}</div><div class="source">${source(r.source)}</div></a>`).join('')}</div>`;}

async function managerPage(id){
  const d=await api(`/api/managers/${encodeURIComponent(id)}`),m=d.manager;
  if(!d.current){set(`<div class="page-head"><div><div class="eyebrow">${source(m.source)}</div><h1>${esc(m.display_name)}</h1><p>${esc(m.name)}</p></div></div><div class="empty">首次数据同步中，请稍后刷新。</div>`);return;}
  const top=d.positions.filter(x=>x.change_type!=='sold'),concentration=top.slice(0,10).reduce((a,x)=>a+Number(x.weight),0),max=Math.max(...d.filings.map(x=>Number(x.total_value)),1);
  set(`<div class="page-head"><div><div class="eyebrow">${source(m.source)} · ${esc(m.category)}</div><h1>${esc(m.display_name)}</h1><p>${esc(m.name)} · 报告期 ${esc(d.current.report_date)} · 申报/披露 ${esc(d.current.filed_date)}</p></div><a class="button secondary" href="/api/export.csv?manager=${encodeURIComponent(id)}">导出 CSV</a></div>
  <div class="stats"><div class="stat"><span>组合规模</span><strong>${money(d.current.total_value)}</strong></div><div class="stat"><span>持仓数量</span><strong>${number(d.current.positions_count)}</strong></div><div class="stat"><span>前十大集中度</span><strong>${pct(concentration)}</strong></div><div class="stat"><span>数据来源</span><strong>${source(m.source)}</strong></div></div>
  <div class="notice">变化依据相邻报告期的<strong>披露股数</strong>计算。拆股、合并、换股和代码变更可能造成非交易变化。</div>
  <section class="section"><div class="section-head"><div><div class="eyebrow">Portfolio changes</div><h2>持仓与变化</h2></div><select id="change-filter" aria-label="筛选变化"><option value="">全部变化</option>${Object.entries(label).map(([k,v])=>`<option value="${k}">${v}</option>`).join('')}</select></div><div id="positions">${positionsTable(d.positions)}</div></section>
  <section class="section"><div class="section-head"><div><div class="eyebrow">History</div><h2>历史规模</h2></div><a href="${esc(d.current.source_url)}" target="_blank" rel="noreferrer">查看原始披露 ↗</a></div><div class="card timeline">${d.filings.filter((x,i,a)=>i===a.findIndex(y=>y.report_date===x.report_date)).map(f=>`<div class="bar-row"><span>${esc(f.report_date)}</span><div class="bar"><i style="width:${Math.max(1,Number(f.total_value)/max*100)}%"></i></div><strong>${money(f.total_value)}</strong></div>`).join('')}</div></section>`);
  document.querySelector('#change-filter').addEventListener('change',e=>document.querySelector('#positions').innerHTML=positionsTable(d.positions.filter(x=>!e.target.value||x.change_type===e.target.value)));
}
function positionsTable(rows){return table(rows,[
  {name:'证券',render:r=>`<a class="security" href="#/stock/${esc(r.cusip)}">${esc(r.issuer)}</a><div class="source">${esc(r.ticker||r.cusip)} ${r.put_call?`· ${esc(r.put_call)}`:''}</div>`},
  {name:'披露变化',render:r=>`<span class="change ${esc(r.change_type)}">${label[r.change_type]}</span>`},
  {name:'本期股数',num:1,render:r=>number(r.shares)},{name:'上期股数',num:1,render:r=>r.previous_shares==null?'—':number(r.previous_shares)},
  {name:'股数变化',num:1,render:r=>r.previous_shares?`${((r.shares-r.previous_shares)/Math.abs(r.previous_shares)*100).toFixed(1)}%`:'—'},
  {name:'市值',num:1,render:r=>money(r.value)},{name:'权重',num:1,render:r=>pct(r.weight)}
]);}

async function stocksPage(){
  const initial=await api('/api/stocks');
  set(`<div class="page-head"><div><div class="eyebrow">Consensus</div><h1>股票与机构共识</h1><p>按 CUSIP 聚合各机构最新报告期；不同机构的报告期可能不同。</p></div></div><div class="toolbar"><form id="stock-form"><input id="stock-q" type="search" placeholder="公司、Ticker 或 CUSIP" aria-label="搜索股票"><button class="button">搜索</button></form></div><div id="stock-results">${stocksTable(initial)}</div>`);
  document.querySelector('#stock-form').addEventListener('submit',async e=>{e.preventDefault();document.querySelector('#stock-results').innerHTML='<div class="loading">搜索中…</div>';document.querySelector('#stock-results').innerHTML=stocksTable(await api(`/api/stocks?q=${encodeURIComponent(document.querySelector('#stock-q').value)}`));});
}
function stocksTable(rows){return table(rows,[{name:'证券',render:r=>`<a class="security" href="#/stock/${esc(r.cusip)}">${esc(r.issuer)}</a><div class="source">${esc(r.ticker||r.cusip)}</div>`},{name:'持有机构',num:1,key:'managers'},{name:'合计披露市值',num:1,render:r=>money(r.total_value)},{name:'合计股数',num:1,render:r=>number(r.total_shares)}]);}
async function stockPage(cusip){const d=await api(`/api/stocks/${encodeURIComponent(cusip)}`),s=d.security;set(`<div class="page-head"><div><div class="eyebrow">Security · ${esc(s.cusip)}</div><h1>${esc(s.issuer)}</h1><p>${esc(s.ticker||s.title)} · ${d.holders.length} 家追踪机构的最新披露</p></div></div>${table(d.holders,[{name:'机构',render:r=>`<a class="manager-link" href="#/manager/${esc(r.manager_id)}">${esc(r.display_name)}</a><div class="source">${esc(r.category)}</div>`},{name:'报告期',key:'report_date'},{name:'股数',num:1,render:r=>number(r.shares)},{name:'市值',num:1,render:r=>money(r.value)},{name:'组合权重',num:1,render:r=>pct(r.weight)}])}`);}

async function comparePage(){
  const ms=await api('/api/managers'),options=ms.map(m=>`<option value="${esc(m.id)}">${esc(m.display_name)}</option>`).join('');
  set(`<div class="page-head"><div><div class="eyebrow">Compare</div><h1>机构对比</h1><p>选择 2–5 家机构，比较各自最新报告期的规模、集中度与重合持仓。</p></div></div><form id="compare-form"><div class="compare-picks">${[0,1,2,3,4].map((_,i)=>`<label>机构 ${i+1}<select name="manager"><option value="">${i>1?'可选':'请选择'}</option>${options}</select></label>`).join('')}</div><p><button class="button">开始对比</button></p></form><div id="compare-result"></div>`);
  document.querySelector('#compare-form').addEventListener('submit',async e=>{e.preventDefault();const ids=[...new FormData(e.target).getAll('manager')].filter((x,i,a)=>x&&a.indexOf(x)===i);if(ids.length<2){document.querySelector('#compare-result').innerHTML='<div class="error">请选择至少两家不同机构</div>';return;}const rows=await api(`/api/compare?ids=${ids.join(',')}`);renderCompare(rows,ids,ms);});
}
function renderCompare(rows,ids,ms){
  const group=(items,key)=>items.reduce((all,item)=>((all[item[key]]??=[]).push(item),all),{}),by=group(rows,'id'),summary=ids.map(id=>{const holdings=by[id]||[],meta=holdings[0]||ms.find(x=>x.id===id);return {...meta,top10:holdings.slice(0,10).reduce((a,x)=>a+Number(x.weight),0)}});
  const overlap=Object.values(group(rows,'cusip')).filter(group=>new Set(group.map(x=>x.id)).size>1).sort((a,b)=>b.length-a.length||b.reduce((s,x)=>s+x.value,0)-a.reduce((s,x)=>s+x.value,0));
  document.querySelector('#compare-result').innerHTML=`<div class="stats">${summary.map(x=>`<div class="stat"><span>${esc(x.display_name)}</span><strong>${money(x.total_value)}</strong><small>${esc(x.report_date||'无数据')} · 前十 ${pct(x.top10)}</small></div>`).join('')}</div><section class="section"><h2>重合持仓</h2>${table(overlap,[{name:'证券',render:g=>`<a class="security" href="#/stock/${esc(g[0].cusip)}">${esc(g[0].issuer)}</a>`},{name:'共同持有',render:g=>g.map(x=>esc(x.display_name)).join('、')},{name:'合计市值',num:1,render:g=>money(g.reduce((s,x)=>s+x.value,0))}],'未发现重合持仓')}</section>`;
}

async function alertsPage(){const d=await api('/api/summary');set(`<div class="page-head"><div><div class="eyebrow">Alerts</div><h1>披露提醒</h1><p>订阅最新申报、新出现、不再披露与显著股数变化。</p></div></div><div class="two-col"><div class="card alert-card"><div class="alert-icon">◉</div><div><h3>RSS 实时订阅</h3><p class="muted">适用于 Feedly、Inoreader、NetNewsWire 等阅读器。选择股数变化提醒阈值：</p><div class="tabs"><a class="button secondary" href="/api/feed.xml?threshold=10">10%</a><a class="button" href="/api/feed.xml?threshold=20">20%</a><a class="button secondary" href="/api/feed.xml?threshold=50">50%</a></div></div></div><div class="card alert-card"><div class="alert-icon">↻</div><div><h3>自动刷新</h3><p class="muted">ARK 与 SEC 每小时检查；源站未更新时不会生成重复记录。所有变化均指披露股数变化。</p></div></div></div><section class="section"><div class="section-head"><h2>最近披露</h2></div>${table(d.latest,managerCols)}</section>`);}

const routes={managers:managersPage,stocks:stocksPage,compare:comparePage,alerts:alertsPage};
async function route(){try{const parts=location.hash.replace(/^#\/?/,'').split('/').filter(Boolean),name=parts[0];document.querySelectorAll('nav a').forEach(a=>a.classList.toggle('active',a.hash===`#/${name||''}`));if(name==='manager')await managerPage(parts[1]);else if(name==='stock')await stockPage(parts[1]);else await (routes[name]||home)();}catch(err){fail(err);}}
document.querySelector('.nav-toggle').addEventListener('click',e=>{const nav=document.querySelector('nav'),open=nav.classList.toggle('open');e.target.setAttribute('aria-expanded',open)});document.querySelector('nav').addEventListener('click',()=>document.querySelector('nav').classList.remove('open'));app.addEventListener('click',e=>{if(e.target.matches('[data-retry]'))route();});addEventListener('hashchange',route);route();
