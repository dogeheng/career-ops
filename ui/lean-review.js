const el = (tag, text, parent) => { const e = document.createElement(tag); if (text != null) e.textContent = text; parent?.append(e); return e; };
const error = document.getElementById('error');
const drafts = new Map(); let pageIndex = 0, released = false, releaseTimer, refreshing = false, refreshAgain = false;
async function post(path, body) {
  const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await response.json(); if (!response.ok) throw Error(data.error); return data;
}
async function refresh() {
  if (released) return;
  if (refreshing) { refreshAgain = true; return; } refreshing = true;
  try {
    const response = await fetch('/api/state?page='+pageIndex); if (!response.ok) throw Error('会话失效，请重新运行 npm run apply:review');
    const data = await response.json(), pending = data.jobs.filter(j => j.status === 'waiting');
    if (released) return;
    document.getElementById('status').textContent = `${data.enabled ? '自动投递已启用' : '自动投递已关闭'} · ${data.waiting} 个申请待回答 · ${data.total_answers} 条已确认回答 · 不设置岗位数量上限`;
    if (data.attention) { clearTimeout(releaseTimer); releaseTimer = null; }
    else if (!releaseTimer && !document.querySelector('details').open) releaseTimer = setTimeout(()=>release(true),5000);
    const list = document.getElementById('questions');
    // Keep partially typed answers when another job updates the inbox.
    for (const f of list.querySelectorAll('form')) drafts.set(f.dataset.id, { value:f.querySelector('textarea').value,scope:f.querySelector('select').value,expires:f.querySelector('input[type=date]').value });
    list.replaceChildren();
    if (!pending.length) el('p', data.waiting ? '本页没有待答问题，请查看其他页。' : '当前没有待回答问题。没有待核查事项时，窗口将自动收起并释放后台。', list);
    for (const j of pending) {
      const card = el('article', null, list); el('h2', `${j.company} · ${j.title}`, card);
      el('p', j.url, card).className = 'muted';
      for (const q of j.questions || []) {
        const f = el('form', null, card); f.dataset.id = JSON.stringify([j.key, q.text]);
        el('label', q.text, f); if (q.context) el('p', q.context, f).className = 'notice';
        const answer = el('textarea', null, f); answer.required = true; answer.setAttribute('aria-label', q.text);
        el('label', '复用范围（默认仅此岗位）', f); const scope = el('select', null, f);
        for (const [value, text] of [['job','仅此岗位'],['employer','这家公司'],['country','该国家的相同问题'],['global','所有岗位的相同问题']]) { const o=el('option',text,scope);o.value=value; }
        el('label', '失效日期（offer 截止日期等时效信息必须填写）', f); const expires = el('input', null, f); expires.type = 'date';
        const d = drafts.get(f.dataset.id); if (d) { answer.value=d.value;scope.value=d.scope;expires.value=d.expires; }
        const button = el('button', '确认并记住，等待继续', f); button.type = 'submit';
        f.addEventListener('submit', async e => { e.preventDefault(); error.textContent=''; button.disabled=true;
          try { await post('/api/answer',{job:j.key,question:q.text,value:answer.value,scope:scope.value,expires:expires.value});drafts.delete(f.dataset.id);await refresh(); }
          catch(e){error.textContent=e.message;button.disabled=false;}
        });
      }
    }
    const pages=document.getElementById('pages');pages.replaceChildren();
    if(data.total_jobs>data.page_size){
      el('p',`第 ${pageIndex+1} 页 · 共 ${data.total_jobs} 个记录（分页只控制显示，不限制投递）`,pages);
      const prev=el('button','上一页',pages);prev.disabled=pageIndex===0;prev.onclick=()=>{pageIndex--;refresh();};
      const next=el('button','下一页',pages);next.disabled=(pageIndex+1)*data.page_size>=data.total_jobs;next.onclick=()=>{pageIndex++;refresh();};
    }
    const progress=document.getElementById('progress');progress.replaceChildren();
    for(const j of data.jobs.filter(j=>['working','submitting','uncertain','ready'].includes(j.status))){
      const card=el('article',null,progress);el('h2',`${j.company} · ${j.title}`,card);
      el('p',({working:'处理中；中断的任务不会自动重复申请',submitting:'已进入提交阶段，请先核实结果',uncertain:'提交结果不明确，需要核查',ready:'回答已保存，下一轮优先继续'})[j.status],card);
      if(['uncertain','submitting','working'].includes(j.status)){
        const label=el('label',null,card),check=el('input',null,label);check.type='checkbox';label.append(document.createTextNode(' 我已停止原任务，并核实此岗位没有提交成功'));
        const button=el('button','重新放回队列',card);button.className='secondary';button.onclick=async()=>{try{await post('/api/retry',{job:j.key,confirmedNotSubmitted:check.checked});await refresh();}catch(e){error.textContent=e.message;}};
      }
    }
    const saved=document.getElementById('answers');saved.replaceChildren();
    for(const a of [...data.answers].reverse()){const p=el('article',null,saved);el('strong',a.question,p);el('p',a.value,p);el('small',`${a.scope} · ${a.target}${a.expires?' · 有效至 '+a.expires:''}`,p);}
  } catch(e){if(!released)error.textContent=e.message;}
  finally { refreshing=false;if(refreshAgain){refreshAgain=false;refresh();} }
}
async function release(automatic=false){
  if(released)return;
  if(automatic){try{const data=await (await fetch('/api/state')).json();if(data.attention||document.querySelector('details').open){releaseTimer=null;return;}}catch{return;}}
  released=true;clearTimeout(releaseTimer);events.close();drafts.clear();
  try{await post('/api/release',{});}catch{/* The server may already be idle-closed. */}
  document.body.replaceChildren();el('h1','窗口已收起',document.body);el('p','后台服务将自动退出。问题和已确认答案均已保存，需要时运行 npm run apply:review。',document.body);
  if(window.webkit?.messageHandlers?.careerLifecycle)window.webkit.messageHandlers.careerLifecycle.postMessage('release');else window.close();
}
document.getElementById('release').onclick=()=>release(false);
const events=new EventSource('/events');events.onmessage=()=>refresh();events.onerror=()=>{if(!released)error.textContent='连接暂时中断，正在重连。已确认的回答保存在本机。';};
refresh();
