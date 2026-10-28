const {Plugin, ItemView, Notice, Modal, Setting, PluginSettingTab, MarkdownRenderChild, parseYaml, stringifyYaml} = require('obsidian');
const TYPE = 'ucit-home-view';
const LABELS = {planned:'P 待计划', active:'A 推进中', waiting:'W 等待', suspended:'S 暂停', closed:'C 已关闭'};
const DEFAULTS = {openOnStartup:true, timezone:'Asia/Shanghai', dailyHours:8, hideClosed:false, calendarIntegration:true, calendarMarkers:true, dailyFolder:'areas/periodicNotes/daily', weeklyFolder:'areas/periodicNotes/weekly', monthlyFolder:'areas/periodicNotes/gc-monthly', homeNote:'areas/things/UCIT 今日主页', counters:{}};
const GUIDE = 'utilities/ucit/UCIT 插件使用指南';
const array = v => Array.isArray(v) ? v : [];
const day = v => v instanceof Date ? v.toISOString().slice(0,10) : String(v || '').slice(0,10);
const required = (v, message) => { if (!String(v ?? '').trim()) throw new Error(message); };
function today(zone='Asia/Shanghai', date=new Date()) {
 const parts = new Intl.DateTimeFormat('en-US',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date);
 return ['year','month','day'].map(t=>parts.find(p=>p.type===t).value).join('-');
}
function validDate(value) {
 return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value+'T12:00:00Z').toISOString().slice(0,10)===value;
}
function addDays(value,n) { const d=new Date(value+'T12:00:00Z'); d.setUTCDate(d.getUTCDate()+n); return day(d); }
function period(value,mode) {
 const d=new Date(value+'T12:00:00Z');
 if(mode==='week') {
  const start=addDays(value,-((d.getUTCDay()+6)%7));
  const thu=new Date(addDays(start,3)+'T12:00:00Z');
  const year=thu.getUTCFullYear();
  const jan4=new Date(year+'-01-04T12:00:00Z');
  const first=addDays(year+'-01-04',-((jan4.getUTCDay()+6)%7));
  const num=1+Math.round((Date.parse(start)-Date.parse(first))/604800000);
  return {start,end:addDays(start,6),key:year+'-W'+String(num).padStart(2,'0')};
 }
 if(mode==='month') {
  const end=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0,12));
  return {start:value.slice(0,7)+'-01',end:day(end),key:value.slice(0,7)};
 }
 return {start:value,end:value,key:value};
}
function parseNote(text) {
 const m=/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
 if(!m) return null;
 const data=parseYaml(m[1]);
 if(!data || typeof data!=='object' || Array.isArray(data)) return null;
 return {data,body:text.slice(m[0].length)};
}
function noteText(data,body) { return '---\n'+stringifyYaml(data).trimEnd()+'\n---\n'+body; }
function managed(d) { return d?.ucit_version===2 && ['project','task'].includes(d.kind); }
function target(value) { return String(value||'').replace(/^\[\[/,'').replace(/\]\]$/,'').split('|')[0].split('#')[0].replace(/\.md$/,''); }
function parentOf(item,records) { return records.find(x=>x.kind==='project' && target(item.parent)===x.file.path.replace(/\.md$/,'')); }
function childrenOf(item,records) { return records.filter(x=>x.kind==='task' && target(x.parent)===item.file.path.replace(/\.md$/,'')); }
function blockers(item,records) {
 return array(item.depends_on).filter(id=>{ const matches=records.filter(x=>x.ucit===id); return matches.length!==1 || matches[0].status!=='closed' || matches[0].resolution!=='done'; });
}
function collect(app) {
 return app.vault.getMarkdownFiles().filter(f=>f.path.startsWith('projects/')).flatMap(file=>{
  const d=app.metadataCache.getFileCache(file)?.frontmatter;
  return managed(d) ? [{...d,file}] : [];
 }).sort((a,b)=>(day(a.due)||'9999').localeCompare(day(b.due)||'9999') || String(a.ucit).localeCompare(String(b.ucit)));
}
// Writes use fresh file contents, not the eventually consistent metadata index.
async function readRecords(app) {
 const result=[];
 for(const file of app.vault.getMarkdownFiles().filter(f=>f.path.startsWith('projects/'))) {
  const raw=await app.vault.read(file);
  let parsed;
  try { parsed=parseNote(raw); }
  catch(e) { if(/^ucit_version:\s*2\s*$/m.test(raw)) throw new Error('无法解析受管笔记：'+file.path); continue; }
  if(managed(parsed?.data)) result.push({...parsed.data,file,raw});
 }
 const ids=new Set();
 for(const item of result) {
  required(item.ucit,'缺少 UCIT 编号：'+item.file.path);
  if(ids.has(item.ucit)) throw new Error('重复 UCIT 编号：'+item.ucit);
  ids.add(item.ucit);
 }
 return result;
}
function validateRecord(d,records) {
 if(!LABELS[d.status]) throw new Error('无效 PAWSC 状态');
 required(d.area,'请填写主责 area');
 if(d.kind==='task') {
  if(!parentOf(d,records)) throw new Error('任务必须链接到唯一父项目');
  required(d.acceptance,'请填写验收条件');
 }
 for(const key of ['due','review_on','scheduled_on']) if(d[key] && !validDate(day(d[key]))) throw new Error(key+' 日期无效');
 if(d.estimate_hours!=null && (!Number.isFinite(Number(d.estimate_hours)) || Number(d.estimate_hours)<=0)) throw new Error('预计时长须大于 0');
 if(d.depends_on!=null && !Array.isArray(d.depends_on)) throw new Error('depends_on 必须是编号列表');
 for(const id of array(d.depends_on)) if(!records.some(x=>x.ucit===id)) throw new Error('找不到依赖 '+id);
 const visit=(item,trail)=>{
  if(trail.includes(item.ucit)) throw new Error('存在依赖循环：'+[...trail,item.ucit].join(' → '));
  for(const id of array(item.depends_on)) { const dep=records.find(x=>x.ucit===id); if(dep) visit(dep,[...trail,item.ucit]); }
 };
 visit(d,[]);
 if(['active','waiting'].includes(d.status)) {
  required(d.next_action,'推进或等待状态需填写下一步'); required(d.review_on,'推进或等待状态需填写复查日期');
 }
 if(d.status==='waiting') required(d.waiting_for,'请说明等待对象或解除条件');
 if(d.status==='suspended') required(d.resume_when,'请填写恢复条件');
 if(d.status==='active') {
  if(blockers(d,records).length) throw new Error('依赖尚未成功完成，不能启动');
  if(d.kind==='task' && parentOf(d,records)?.status!=='active') throw new Error('父项目必须处于 A');
  if(d.kind==='project') for(const k of ['goal','outcome','budget','task_source']) required(d[k],'项目缺少 '+k);
 }
 if(d.kind==='project' && d.status!=='active' && childrenOf(d,records).some(x=>x.status==='active')) throw new Error('请先处理仍处于 A 的子任务');
 if(d.status==='closed') {
  if(!['done','cancelled','merged'].includes(d.resolution)) throw new Error('请选择关闭结论');
  if(!array(d.evidence).some(x=>String(x).trim())) throw new Error('关闭必须提供证据链接或取消/合并决定记录');
  if(!validDate(day(d.closed_on))) throw new Error('关闭日期无效');
  if(d.kind==='project' && childrenOf(d,records).some(x=>x.status!=='closed')) throw new Error('项目仍有未关闭子任务');
 }
 // Reopening/cancelling a successful dependency must not invalidate active successors.
 if(!(d.status==='closed' && d.resolution==='done') && records.some(x=>x.status==='active' && array(x.depends_on).includes(d.ucit))) throw new Error('有推进中的任务依赖此成果；请先调整后续任务');
}
function buildUpdate(item,input,records,now) {
 required(input.reason,'请写明本次决定或调整原因');
 const {file,raw,...d}=item;
 for(const key of ['status','next_action','acceptance','due','review_on','scheduled_on','waiting_for','resume_when']) {
  if(Object.prototype.hasOwnProperty.call(input,key)) { if(input[key]) d[key]=input[key]; else delete d[key]; }
 }
 if(Object.prototype.hasOwnProperty.call(input,'estimate_hours')) { if(input.estimate_hours==='') delete d.estimate_hours; else d.estimate_hours=Number(input.estimate_hours); }
 if(input.evidence!==undefined) d.evidence=array(input.evidence).map(x=>String(x).trim()).filter(Boolean);
 if(input.depends_on!==undefined) d.depends_on=String(input.depends_on).split(/[\s,，]+/).filter(Boolean);
 if(d.status!=='waiting') delete d.waiting_for;
 if(d.status!=='suspended') delete d.resume_when;
 if(d.status==='closed') { d.resolution=input.resolution; d.closed_on=d.closed_on || now; }
 else { delete d.closed_on; delete d.resolution; }
 d.updated=now;
 const updated={...d,file};
 validateRecord(updated,records.map(x=>x.ucit===d.ucit ? updated : x));
 const body=parseNote(raw).body;
 const changes=['next_action','acceptance','depends_on','due','review_on','scheduled_on','estimate_hours','waiting_for','resume_when','resolution','evidence']
  .filter(k=>JSON.stringify(item[k])!==JSON.stringify(d[k]))
  .map(k=>'- '+k+'：'+JSON.stringify(item[k]??null)+' → '+JSON.stringify(d[k]??null)).join('\n');
 const log='\n\n### UCIT 决定 '+new Date().toISOString()+'\n\n'+item.status+' → '+d.status+'：'+input.reason.trim()+'\n'+(changes?'\n'+changes+'\n':'')+(array(d.evidence).length?'\n证据或决定记录：'+d.evidence.join('；')+'\n':'');
 return noteText(d,body+log);
}
function inPeriod(item,p) { return ['scheduled_on','due','review_on'].some(k=>day(item[k])>=p.start && day(item[k])<=p.end); }
function filteredTasks(records,filters,now) {
 const p=filters.range || period(now,filters.horizon);
 return records.filter(x=>x.kind==='task').filter(x=>{
  const parent=parentOf(x,records);
  if(filters.project && parent?.ucit!==filters.project) return false;
  if(filters.area && x.area!==filters.area) return false;
  if(filters.status && x.status!==filters.status) return false;
  if(filters.hideClosed && x.status==='closed') return false;
  const q=String(filters.query||'').trim().toLowerCase();
  if(q && ![x.ucit,x.file.basename,x.next_action,x.acceptance,x.waiting_for].some(v=>String(v||'').toLowerCase().includes(q))) return false;
  if(filters.horizon==='all') return true;
  if(x.status==='closed') return inPeriod(x,p);
  return inPeriod(x,p) || ['active','waiting'].includes(x.status) || ['scheduled_on','due','review_on'].some(k=>x[k] && day(x[k])<p.start);
 });
}
function button(parent,label,callback,cls) {
 const b=parent.createEl('button',{text:label,cls});
 b.addEventListener('click',()=>Promise.resolve().then(callback).catch(e=>new Notice(e.message)));
 return b;
}
// New Calendar Suite bridge. Dates in UCIT notes stay Gregorian YYYY-MM-DD.
// The bridge uses the v1.4.5 calendar:open source contract and feature-detected view methods.
const CALENDAR_ID = 'new-calendar-suite';
const NC_MODES = ['nc-phase','nc-month','nc-season','nc-year'];
const CALENDAR_KEYS = {day:'daily',week:'weekly',month:'monthly','nc-phase':'ncPhase','nc-month':'ncMonth','nc-season':'ncSeason','nc-year':'ncYear'};
function calendarPlugin(app) { return app.plugins?.getPlugin?.(CALENDAR_ID) || null; }
function calendarGlobals() { return typeof window==='undefined' ? {} : {moment:window.moment,dates:window.NCDates,notes:window.NCNotes}; }
function suiteRange(app,anchor,mode,enabled=true) {
 const suite=enabled && calendarPlugin(app);const {moment,dates}=calendarGlobals();
 if(!suite || !moment) {
  if(NC_MODES.includes(mode)) throw new Error('NC 范围需要启用 New Calendar Suite');
  return period(anchor,mode);
 }
 const date=moment(anchor,'YYYY-MM-DD',true);
 if(mode==='week')return {start:date.clone().startOf('week').format('YYYY-MM-DD'),end:date.clone().endOf('week').format('YYYY-MM-DD'),key:date.format((suite.options||suite.settings)?.weekly?.format||'gggg-[W]ww')};
 if(NC_MODES.includes(mode)) {
  if(!dates?.get || !dates?.getPeriodRange)throw new Error('New Calendar Suite 日期 API 尚未就绪');
  const nc=dates.get(date);const arg=mode==='nc-phase'?nc.phase:mode==='nc-season'?nc.season:undefined;
  const [start,end]=dates.getPeriodRange(mode,nc.ny,nc.nm,arg);
  // NCS v1.4.5 returns inclusive last calendar dates for NC ranges.
  return {start:start.format('YYYY-MM-DD'),end:end.format('YYYY-MM-DD'),key:mode+' '+dates.toDateString(nc)};
 }
 return period(anchor,mode);
}
function workloadIndex(records,now) {
 const index=new Map();
 const ensure=date=>{if(!index.has(date))index.set(date,{scheduled:0,due:0,review:0,done:0,overdue:0,hours:0});return index.get(date);};
 for(const t of records.filter(x=>x.kind==='task')) {
  if(t.status==='closed') {if(t.resolution==='done' && validDate(day(t.closed_on)))ensure(day(t.closed_on)).done++;continue;}
  for(const [field,key] of [['scheduled_on','scheduled'],['due','due'],['review_on','review']]) {
   const date=day(t[field]);if(!validDate(date))continue;ensure(date)[key]++;
   if(key==='scheduled')ensure(date).hours+=Number(t.estimate_hours)||0;
   if(key==='due' && date<now)ensure(now).overdue++;
  }
 }
 return index;
}
function workloadMetadata(index,start,end=start) {
 const count={scheduled:0,due:0,review:0,done:0,overdue:0,hours:0};
 for(const [date,values] of index)if(date>=start && date<=end)for(const key of Object.keys(count))count[key]+=values[key];
 const dots=[];
 if(count.due || count.overdue)dots.push({className:'ucit-dot-due',color:'#e05252',isFilled:true});
 if(count.scheduled)dots.push({className:'ucit-dot-scheduled',color:'#568be8',isFilled:true});
 if(count.review)dots.push({className:'ucit-dot-review',color:'#d6a23e',isFilled:false});
 if(count.done)dots.push({className:'ucit-dot-done',color:'#46a675',isFilled:true});
 return {dots,dataAttributes:{'data-ucit-tasks':String(count.scheduled),'data-ucit-hours':String(count.hours)},counts:count};
}
function detectPeriod(app,file,config={}) {
 const fm=app.metadataCache.getFileCache(file)?.frontmatter||{};
 const suite=calendarPlugin(app);const options=suite?.options||suite?.settings||{};
 const {moment,dates}=calendarGlobals();
 const aliases={daily:'day',weekly:'week',monthly:'month',day:'day',week:'week',month:'month'};
 let mode=config.period==='auto'?null:config.period;
 mode=mode || aliases[fm['gc-type']] || (fm['nc-type'] ? String(fm['nc-type']).startsWith('nc-') ? fm['nc-type'] : 'nc-'+fm['nc-type'] : null);
 let anchor=day(config.date || fm['gc-date'] || fm.date);
 if(validDate(anchor) && mode)return {mode,anchor};
 // Parse configured NC filenames through NCS's own calendar engine.
 if(mode && NC_MODES.includes(mode) && dates?.parseFilename) {
  const key=CALENDAR_KEYS[mode];const formats={'nc-phase':'NC-YY-MM-[P]P','nc-month':'NC-YY-MM','nc-season':'NC-YY-[S]S','nc-year':'NC-YY'};
  const parsed=dates.parseFilename(file.basename,options[key]?.format||formats[mode],mode,fm);
  if(parsed) {const [start]=dates.getPeriodRange(mode,parsed.ny,parsed.nm,mode==='nc-phase'?parsed.phase:mode==='nc-season'?parsed.season:undefined);return {mode,anchor:start.format('YYYY-MM-DD')};}
 }
 const formats={day:options.daily?.format||'YYYY-MM-DD',week:options.weekly?.format||'gggg-[W]ww',month:options.monthly?.format||'YYYY-MM'};
 if(moment)for(const kind of mode?[mode]:['day','week','month']) {
  if(!formats[kind])continue;
  const parsed=moment(file.basename,formats[kind],true);
  if(parsed.isValid())return {mode:kind,anchor:parsed.format('YYYY-MM-DD')};
 }
 // Standalone default filenames, without needing Moment or the calendar plugin.
 if((!mode || mode==='day') && validDate(file.basename))return {mode:'day',anchor:file.basename};
 if((!mode || mode==='month') && /^\d{4}-\d{2}$/.test(file.basename) && validDate(file.basename+'-01'))return {mode:'month',anchor:file.basename+'-01'};
 if((!mode || mode==='week') && /^\d{4}-W\d{2}$/.test(file.basename)) {
  const [year,week]=file.basename.split('-W');const start=period(year+'-01-04','week').start;
  const date=addDays(start,(Number(week)-1)*7);if(period(date,'week').key===file.basename)return {mode:'week',anchor:date};
 }
 throw new Error('无法识别计划日期；请在 ucit 代码块中指定 period 与 date: YYYY-MM-DD');
}
class UCITPlanBlock extends MarkdownRenderChild {
 constructor(el,plugin,file,config){super(el);this.plugin=plugin;this.app=plugin.app;this.file=file;this.config=config;}
 onload(){
  this.render();let timer;
  const refresh=()=>{clearTimeout(timer);timer=setTimeout(()=>this.render(),250);};
  this.register(()=>clearTimeout(timer));
  for(const event of ['changed','resolved'])this.registerEvent(this.app.metadataCache.on(event,refresh));
  for(const event of ['delete','rename'])this.registerEvent(this.app.vault.on(event,refresh));
  this.registerEvent(this.app.workspace.on('ucit:changed',refresh));
 }
 render(){
  const el=this.containerEl;el.empty();el.addClass('ucit-plan-block');
  try {
   const {mode,anchor}=detectPeriod(this.app,this.file,this.config);
   if(!['day','week','month',...NC_MODES].includes(mode))throw new Error('不支持的 period');
   const range=this.plugin.range(anchor,mode);const records=collect(this.app);
   const tasks=filteredTasks(records,{horizon:mode,range,hideClosed:this.config.show_closed!==true,project:this.config.project||''},anchor);
   el.createEl('h3',{text:'UCIT · '+range.start+' — '+range.end});
   el.createEl('p',{text:'实时任务状态 · 含期内日期、此前未解决的承诺及 A/W 任务',cls:'ucit-meta'});
   const nav=el.createDiv({cls:'ucit-nav'});
   button(nav,'打开此期看板',()=>this.plugin.openHomeFor(anchor,mode));
   button(nav,'＋ 安排任务',()=>new WorkModal(this.plugin,null,this.config.project||'',anchor).open());
   if(!tasks.length)el.createEl('p',{text:'暂无匹配任务'});
   for(const t of tasks){const row=el.createDiv({cls:'ucit-plan-row'});button(row,t.file.basename,()=>this.app.workspace.openLinkText(t.file.path,'',false));row.createEl('span',{text:LABELS[t.status]+' · '+(t.next_action||''),cls:'ucit-meta'});button(row,'调整 / 闭环',()=>new WorkModal(this.plugin,t).open());}
  }catch(e){el.createEl('p',{text:e.message,cls:'ucit-warning'});}
 }
}

class WorkModal extends Modal {
 constructor(plugin,item=null,projectId='',scheduled='') { super(plugin.app); this.plugin=plugin; this.item=item; this.projectId=projectId; this.scheduled=scheduled; }
 async onOpen() {
  const el=this.contentEl; el.empty(); el.addClass('ucit-form');
  el.createEl('h2',{text:this.item?'更新 '+this.item.ucit:'新建 UCIT 任务'});
  this.error=el.createEl('p',{cls:'ucit-warning',attr:{role:'alert'}});
  try {
   const records=await readRecords(this.app);
   let item=this.item;
   if(item) { item=records.find(x=>x.file.path===item.file.path); if(!item) throw new Error('记录已移除，请刷新'); this.item=item; }
   this.values=item ? {
    status:item.status,next_action:item.next_action||'',acceptance:item.acceptance||'',due:day(item.due),review_on:day(item.review_on),
    scheduled_on:day(item.scheduled_on),estimate_hours:item.estimate_hours??'',waiting_for:item.waiting_for||'',resume_when:item.resume_when||'',
    resolution:item.resolution||'done',evidence:array(item.evidence).join('\n'),depends_on:array(item.depends_on).join('\n'),reason:''
   } : {project:this.projectId,title:'',next_action:'',acceptance:'',due:'',review_on:this.scheduled||this.plugin.now(),scheduled_on:this.scheduled,estimate_hours:'',depends_on:''};
   const v=this.values;
   if(!item) {
    const ps=records.filter(x=>x.kind==='project' && x.status!=='closed');
    if(!ps.length) throw new Error('先建立一个 UCIT v2 项目，再添加任务');
    if(!ps.some(x=>x.ucit===v.project)) v.project=ps[0].ucit;
    new Setting(el).setName('归属项目').addDropdown(c=>{for(const p of ps)c.addOption(p.ucit,p.file.basename);c.setValue(v.project).onChange(x=>v.project=x);});
    this.field('title','任务名称');
   } else {
    new Setting(el).setName('PAWSC 状态').addDropdown(c=>{for(const [k,label] of Object.entries(LABELS))c.addOption(k,label);c.setValue(v.status).onChange(x=>{v.status=x;this.showConditions();});});
   }
   this.field('next_action','下一步',true);
   if(!item || item.kind==='task') this.field('acceptance','验收条件',true);
   this.field('depends_on','依赖编号（换行或逗号分隔，可空）',true);
   this.field('scheduled_on','安排在哪天（可空）',false,'date');
   this.field('estimate_hours','该日预计投入小时（可空）',false,'number');
   this.field('due','目标日期（可空）',false,'date');
   this.field('review_on','复查日期',false,'date');
   if(item) {
    this.waitRow=this.field('waiting_for','等待对象 / 解除条件',true);
    this.resumeRow=this.field('resume_when','暂停原因 / 恢复条件',true);
    this.closeRow=new Setting(el).setName('关闭结论').addDropdown(c=>c.addOptions({done:'完成并验收',cancelled:'取消',merged:'合并'}).setValue(v.resolution).onChange(x=>v.resolution=x));
    this.field('evidence','证据 / 决定记录（每行一条，保留既有条目）',true);
    this.field('reason','本次决定或调整原因（必填）',true);
    this.showConditions();
   }
   el.createEl('p',{text:item?'保存将更新原笔记并追加决定记录。':'新任务以 P 创建，自动分配编号及独立文件夹。',cls:'ucit-subtitle'});
   const save=button(el,item?'保存调整':'创建任务',async()=>{
    save.disabled=true;this.error.setText('');
    try {
     if(item) await this.plugin.updateItem(item,{...v,evidence:v.evidence.split('\n')});
     else { const file=await this.plugin.createTask(v); await this.app.workspace.openLinkText(file.path,'',false); }
     this.close();this.plugin.refresh();new Notice('UCIT 已保存');
    } catch(e) { this.error.setText(e.message); } finally {save.disabled=false;}
   },'mod-cta');
   button(el,'取消',()=>this.close());
  } catch(e) {this.error.setText(e.message);}
 }
 field(key,label,multiline=false,type='text') {
  const row=new Setting(this.contentEl).setName(label);
  const init=c=>{c.setValue(String(this.values[key]??'')).onChange(x=>this.values[key]=x); if(!multiline) {c.inputEl.type=type;if(type==='number'){c.inputEl.min='0.1';c.inputEl.step='0.25';}}};
  if(multiline) row.addTextArea(init); else row.addText(init);
  return row;
 }
 showConditions() {
  if(!this.waitRow)return;
  this.waitRow.settingEl.hidden=this.values.status!=='waiting';
  this.resumeRow.settingEl.hidden=this.values.status!=='suspended';
  this.closeRow.settingEl.hidden=this.values.status!=='closed';
 }
}
class UCITSettings extends PluginSettingTab {
 constructor(app,plugin){super(app,plugin);this.plugin=plugin;}
 display(){
  const el=this.containerEl;el.empty();el.createEl('h2',{text:'UCIT Home'});
  new Setting(el).setName('启动时打开主页').addToggle(c=>c.setValue(this.plugin.settings.openOnStartup).onChange(async v=>{this.plugin.settings.openOnStartup=v;await this.plugin.saveSettings();}));
  new Setting(el).setName('默认隐藏已关闭任务').addToggle(c=>c.setValue(this.plugin.settings.hideClosed).onChange(async v=>{this.plugin.settings.hideClosed=v;await this.plugin.saveSettings();this.plugin.refresh();}));
  new Setting(el).setName('每日可用小时').setDesc('容量比较基于 scheduled_on 与 estimate_hours，不代表实际工时。').addText(c=>c.setValue(String(this.plugin.settings.dailyHours)).onChange(async v=>{if(Number(v)>0 && Number(v)<=24){this.plugin.settings.dailyHours=Number(v);await this.plugin.saveSettings();this.plugin.refresh();}}));
  new Setting(el).setName('时区').setDesc('例如 Asia/Shanghai；离开输入框后保存有效时区。').addText(c=>{c.setValue(this.plugin.settings.timezone);c.inputEl.addEventListener('change',async()=>{try{today(c.getValue());this.plugin.settings.timezone=c.getValue();await this.plugin.saveSettings();this.plugin.refresh();}catch{new Notice('无效时区');}});});
  new Setting(el).setName('连接 New Calendar Suite').setDesc('使用日历的模板、路径与周界；NC 日期仍映射到公历任务日期。').addToggle(c=>c.setValue(this.plugin.settings.calendarIntegration).onChange(async v=>{this.plugin.settings.calendarIntegration=v;await this.plugin.saveSettings();this.plugin.refresh();}));
  new Setting(el).setName('日历显示 UCIT 标记').addToggle(c=>c.setValue(this.plugin.settings.calendarMarkers).onChange(async v=>{this.plugin.settings.calendarMarkers=v;await this.plugin.saveSettings();this.plugin.refresh();}));
  for(const [key,label] of [['dailyFolder','独立模式日计划文件夹'],['weeklyFolder','独立模式周计划文件夹'],['monthlyFolder','独立模式月计划文件夹'],['homeNote','文字主页路径']])new Setting(el).setName(label).addText(c=>c.setValue(this.plugin.settings[key]).onChange(async v=>{this.plugin.settings[key]=v;await this.plugin.saveSettings();}));
  button(el,'重新连接日历标记',()=>this.plugin.reconnectCalendars());
  button(el,'打开使用指南',()=>this.plugin.openGuide());
 }
}
class UCITView extends ItemView {
 constructor(leaf,plugin){super(leaf);this.plugin=plugin;this.filters={query:'',project:'',area:'',status:'',horizon:'all'};}
 getViewType(){return TYPE;}
 getDisplayText(){return 'UCIT 今日主页';}
 getIcon(){return 'layout-dashboard';}
 async onOpen(){this.render();}
 render(){
  const el=this.contentEl;el.empty();el.addClass('ucit-dashboard');
  const now=this.anchor||this.plugin.now();const data=collect(this.app);
  el.createEl('h1',{text:'UCIT · '+now});
  el.createEl('p',{text:'任务笔记是主账 · 计划 → 推进 → 证据 → 验收 → 复用',cls:'ucit-subtitle'});
  const nav=el.createDiv({cls:'ucit-nav'});
  button(nav,'＋ 新任务',()=>new WorkModal(this.plugin,null,this.filters.project,now).open(),'mod-cta');
  for(const [mode,name] of [['day','今日计划'],['week','本周计划'],['month','本月计划']]) button(nav,name,()=>this.plugin.openPeriod(mode,now));
  button(nav,'文字主页',()=>this.app.workspace.openLinkText(this.plugin.settings.homeNote,'',false));
  button(nav,'使用指南',()=>this.plugin.openGuide());
  button(nav,'刷新',()=>this.render());
  if(this.plugin.calendarEnabled()) {
   button(nav,'GC / NC 日历',()=>this.plugin.showCalendars());
   for(const [mode,label] of [['nc-phase','NC 阶段'],['nc-month','NC 月'],['nc-season','NC 季'],['nc-year','NC 年']])button(nav,label,()=>this.plugin.openPeriod(mode,now));
   const dates=calendarGlobals().dates;
   if(dates?.get) {try{el.createEl('p',{text:'NC '+dates.toDateString(dates.get(calendarGlobals().moment(now)))+' · 日历标记：红 截止/逾期，蓝 安排，黄 复查，绿 验收完成',cls:'ucit-meta'});}catch{}}
  }
  const controls=el.createDiv({cls:'ucit-filters'});
  const dateInput=controls.createEl('input',{attr:{type:'date','aria-label':'查看日期'}});dateInput.value=now;
  dateInput.addEventListener('change',()=>{if(validDate(dateInput.value)){this.anchor=dateInput.value;this.render();}});
  button(controls,'回到今天',()=>{this.anchor=null;this.render();});
  const search=controls.createEl('input',{attr:{type:'search',placeholder:'搜索编号、任务或下一步','aria-label':'搜索任务'}});search.value=this.filters.query;
  const select=(label,key,options)=>{
   const wrap=controls.createEl('label');wrap.createEl('span',{text:label});
   const input=wrap.createEl('select');for(const [value,text] of options)input.createEl('option',{value,text});input.value=this.filters[key];
   input.addEventListener('change',()=>{this.filters[key]=input.value;this.renderBody(data,now);});
  };
  select('范围','horizon',[['all','全部'],['day','今日'],['week','本周'],['month','本月'],...(this.plugin.calendarEnabled()?[["nc-phase","NC 阶段"],["nc-month","NC 月"],["nc-season","NC 季"],["nc-year","NC 年"]]:[])]);
  select('项目','project',[['','全部项目'],...data.filter(x=>x.kind==='project').map(x=>[x.ucit,x.ucit+' '+x.file.basename.replace(x.ucit,'').trim()])]);
  select('主责','area',[['','全部主责'],...[...new Set(data.map(x=>x.area).filter(Boolean))].map(x=>[x,target(x)])]);
  select('状态','status',[['','全部状态'],...Object.entries(LABELS)]);
  const closed=controls.createEl('label');const box=closed.createEl('input',{attr:{type:'checkbox'}});box.checked=this.filters.hideClosed??this.plugin.settings.hideClosed;closed.createEl('span',{text:'隐藏 C'});
  box.addEventListener('change',()=>{this.filters.hideClosed=box.checked;this.renderBody(data,now);});
  button(controls,'清除筛选',()=>{this.filters={query:'',project:'',area:'',status:'',horizon:'all'};this.render();});
  this.results=el.createDiv();
  search.addEventListener('input',()=>{this.filters.query=search.value;this.renderBody(data,now);});
  this.renderBody(data,now);
 }
 renderBody(data,now){
  const el=this.results;el.empty();
  let range;
  try {range=this.plugin.range(now,this.filters.horizon);}catch(e){el.createEl('p',{text:e.message,cls:'ucit-warning'});return;}
  const tasks=filteredTasks(data,{...this.filters,range,hideClosed:this.filters.hideClosed??this.plugin.settings.hideClosed},now);
  const allTasks=data.filter(x=>x.kind==='task');
  const scheduled=allTasks.filter(x=>day(x.scheduled_on)===now && x.status!=='closed');
  const hours=scheduled.reduce((s,x)=>s+(Number(x.estimate_hours)||0),0);
  const unknown=scheduled.filter(x=>!x.estimate_hours).length;
  const capacity=el.createDiv({cls:'ucit-capacity'});
  capacity.createEl('strong',{text:`${now} 全库安排 ${hours}h / ${this.plugin.settings.dailyHours}h`});
  const meter=capacity.createEl('progress');meter.max=this.plugin.settings.dailyHours;meter.value=hours;
  capacity.createEl('span',{text:`${scheduled.length} 项${unknown?' · '+unknown+' 项未估时':''}${hours>this.plugin.settings.dailyHours?' · 超出容量，请缩减':''} · 计划投入，不是已完成工时`,cls:hours>this.plugin.settings.dailyHours?'ucit-warning':'ucit-meta'});
  const counts=el.createDiv({cls:'ucit-counts'});
  for(const [status,label] of Object.entries(LABELS))counts.createEl('span',{text:label+' '+tasks.filter(x=>x.status===status).length,cls:'ucit-count ucit-'+status});
  el.createEl('p',{text:`当前筛选 ${tasks.length} / ${allTasks.length} 项任务。日/周/月范围包含期内安排、截止、复查，以及未解决的逾期和 A/W 承诺。`,cls:'ucit-subtitle'});
  el.createEl('h2',{text:'项目承诺'});
  const projects=el.createDiv({cls:'ucit-projects'});
  for(const p of data.filter(x=>x.kind==='project' && (!this.filters.project || x.ucit===this.filters.project) && (!this.filters.area || x.area===this.filters.area)))this.card(projects,p,data,now);
  if(this.filters.horizon!=='all')this.agenda(el,tasks,range,now);
  const lanes=el.createDiv({cls:'ucit-lanes'});
  for(const [status,label] of Object.entries(LABELS)) {
   if((this.filters.hideClosed??this.plugin.settings.hideClosed) && status==='closed')continue;
   const lane=lanes.createDiv({cls:'ucit-lane'});const items=tasks.filter(x=>x.status===status);lane.createEl('h2',{text:label+' · '+items.length});
   if(!items.length)lane.createEl('p',{text:'暂无',cls:'ucit-empty'});
   for(const t of items)this.card(lane,t,data,now);
  }
  const issues=[];const ids=new Set();
  for(const x of data){if(ids.has(x.ucit))issues.push('重复编号 '+x.ucit);ids.add(x.ucit);try{validateRecord(x,data);}catch(e){issues.push(x.ucit+'：'+e.message);}}
  if(issues.length){const panel=el.createEl('details');panel.createEl('summary',{text:'需修正 · '+issues.length});for(const msg of issues)panel.createEl('p',{text:msg});}
  el.createEl('p',{text:'状态表示承诺，不代表后台进程。保存调整会记录原因；成功关闭需要证据。历史 PALXOS 不自动计入。',cls:'ucit-subtitle'});
 }
 agenda(el,tasks,p,now){
  el.createEl('h2',{text:p.start+' — '+p.end+' · 日期视图'});
  const grid=el.createDiv({cls:'ucit-agenda'});
  for(let date=p.start;date<=p.end;date=addDays(date,1)) {
   const cell=grid.createDiv({cls:'ucit-agenda-day'+(date===now?' is-today':'')});cell.createEl('strong',{text:date.slice(5)});
   button(cell,'日计划',()=>this.plugin.openPeriod('day',date));
   button(cell,'＋ 任务',()=>new WorkModal(this.plugin,null,this.filters.project,date).open());
   const items=tasks.filter(x=>['scheduled_on','due','review_on'].some(k=>day(x[k])===date));
   if(!items.length)cell.createEl('div',{text:'—',cls:'ucit-meta'});
   for(const x of items){const labels=[['scheduled_on','安排'],['due','截止'],['review_on','复查']].filter(([k])=>day(x[k])===date).map(([,s])=>s).join('/');button(cell,`${x.ucit} · ${labels}`,()=>this.app.workspace.openLinkText(x.file.path,'',false));}
  }
 }
 card(parent,item,records,now){
  const c=parent.createDiv({cls:'ucit-card ucit-'+item.status});
  const a=c.createEl('a',{text:item.file.basename,href:'#'});a.addEventListener('click',e=>{e.preventDefault();this.app.workspace.openLinkText(item.file.path,'',false);});
  c.createDiv({text:(LABELS[item.status]||item.status)+' · '+target(item.area),cls:'ucit-meta'});
  const dates=[['scheduled_on','安排'],['due','目标'],['review_on','复查']].filter(([k])=>item[k]);
  for(const [k,label] of dates)c.createDiv({text:label+'：'+day(item[k])+(item.status!=='closed' && day(item[k])<now?' · 已过日期':''),cls:'ucit-meta'});
  if(item.estimate_hours)c.createDiv({text:'计划投入：'+item.estimate_hours+'h',cls:'ucit-meta'});
  if(item.next_action)c.createEl('p',{text:item.next_action});
  if(item.status==='waiting')c.createEl('p',{text:'等待：'+(item.waiting_for||'待说明'),cls:'ucit-warning'});
  if(item.status==='suspended')c.createEl('p',{text:'恢复：'+(item.resume_when||'待说明'),cls:'ucit-warning'});
  const deps=blockers(item,records);if(deps.length)c.createEl('p',{text:'依赖未满足：'+deps.join('、'),cls:'ucit-warning'});
  if(item.status==='closed')c.createDiv({text:'结论：'+(item.resolution||'待补'),cls:'ucit-meta'});
  if(item.kind==='project') {
   const children=childrenOf(item,records);const done=children.filter(x=>x.status==='closed' && x.resolution==='done').length;
   const other=children.filter(x=>x.status==='closed' && x.resolution!=='done').length;
   c.createDiv({text:`验收完成 ${done}/${children.length} · 其他关闭 ${other}`,cls:'ucit-meta'});
   const progress=c.createEl('progress');progress.max=children.length||1;progress.value=done;
  }
  const actions=c.createDiv({cls:'ucit-card-actions'});
  button(actions,'调整 / 闭环',()=>new WorkModal(this.plugin,item).open());
  if(item.kind==='project')button(actions,'＋ 子任务',()=>new WorkModal(this.plugin,null,item.ucit).open());
  button(actions,'复制链接',async()=>{await navigator.clipboard.writeText('[['+item.file.path.replace(/\.md$/,'')+']]');new Notice('已复制任务链接');});
 }
}
class UCITHome extends Plugin {
 async onload(){
  this.settings={...DEFAULTS,...await this.loadData()};this.settings.counters={...this.settings.counters};
  try{today(this.settings.timezone);}catch{this.settings.timezone=DEFAULTS.timezone;}
  if(!(this.settings.dailyHours>0 && this.settings.dailyHours<=24))this.settings.dailyHours=8;
  this.queue=Promise.resolve();this.calendarSources=new Set();this.calendarIndex=new Map();this.disposed=false;
  this.registerView(TYPE,leaf=>new UCITView(leaf,this));
  this.registerMarkdownCodeBlockProcessor('ucit',(source,el,ctx)=>{
   try {const config=parseYaml(source)||{};const file=this.app.vault.getAbstractFileByPath(ctx.sourcePath);if(!file)throw new Error('找不到笔记');ctx.addChild(new UCITPlanBlock(el,this,file,config));}
   catch(e){el.createEl('p',{text:e.message,cls:'ucit-warning'});}
  });
  this.calendarSource={ucitSource:true,getDailyMetadata:async date=>this.calendarMetadata(date),getWeeklyMetadata:async date=>this.calendarMetadata(date,true)};
  this.registerEvent(this.app.workspace.on('calendar:open',sources=>{if(!sources.some(s=>s.ucitSource))sources.push(this.calendarSource);this.calendarSources.add(sources);}));
  this.registerEvent(this.app.workspace.on('periodic-notes:settings-updated',()=>this.refresh()));
  this.addCommand({id:'connect-calendars',name:'连接 GC / NC 日历标记',callback:()=>this.reconnectCalendars().catch(e=>new Notice(e.message))});
  this.addCommand({id:'view-active-period',name:'查看当前周期笔记的任务',callback:()=>{try{const file=this.app.workspace.getActiveFile();if(!file)throw new Error('先打开周期笔记');const p=detectPeriod(this.app,file);this.openHomeFor(p.anchor,p.mode);}catch(e){new Notice(e.message);}}});
  this.addCommand({id:'new-task-active-period',name:'在当前周期安排新任务',callback:()=>{try{const file=this.app.workspace.getActiveFile();if(!file)throw new Error('先打开周期笔记');const p=detectPeriod(this.app,file);new WorkModal(this,null,'',p.anchor).open();}catch(e){new Notice(e.message);}}});
  for(const mode of NC_MODES)this.addCommand({id:'open-'+mode,name:'打开 '+mode+' 计划',callback:()=>this.openPeriod(mode).catch(e=>new Notice(e.message))});
  this.addSettingTab(new UCITSettings(this.app,this));
  this.addRibbonIcon('layout-dashboard','UCIT 今日主页',()=>this.openHome());
  this.addCommand({id:'open-home',name:'打开今日主页',callback:()=>this.openHome()});
  for(const [mode,id,label] of [['day','open-today','打开今日计划'],['week','open-week','打开本周计划'],['month','open-month','打开本月计划']])this.addCommand({id,name:label,callback:()=>this.openPeriod(mode).catch(e=>new Notice(e.message))});
  this.addCommand({id:'new-task',name:'新建任务',callback:()=>new WorkModal(this).open()});
  this.addCommand({id:'edit-current',name:'调整当前任务或项目',checkCallback:checking=>{
   const file=this.app.workspace.getActiveFile();const item=collect(this.app).find(x=>x.file.path===file?.path);if(!item)return false;if(!checking)new WorkModal(this,item).open();return true;
  }});
  this.addCommand({id:'open-guide',name:'打开使用指南',callback:()=>this.plugin.openGuide()});
  let timer;
  const refresh=()=>{clearTimeout(timer);timer=setTimeout(()=>this.refresh(),300);};
  this.register(()=>clearTimeout(timer));
  for(const event of ['changed','resolved'])this.registerEvent(this.app.metadataCache.on(event,refresh));
  for(const event of ['create','delete','rename'])this.registerEvent(this.app.vault.on(event,refresh));
  this.registerInterval(window.setInterval(()=>{
   // Avoid replacing a focused filter control while the user is typing.
   for(const leaf of this.app.workspace.getLeavesOfType(TYPE))if(!leaf.view.contentEl.contains(document.activeElement))leaf.view.render();
  },60000));
  this.app.workspace.onLayoutReady(async()=>{
   this.refresh();if(this.settings.openOnStartup)await this.openHome();
   if(this.calendarEnabled())this.reconnectCalendars().catch(e=>new Notice(e.message));
  });
 }
 calendarEnabled(){return this.settings.calendarIntegration && !!calendarPlugin(this.app);}
 range(anchor,mode){return suiteRange(this.app,anchor,mode,this.settings.calendarIntegration);}
 calendarMetadata(date,weekly=false){
  if(this.disposed || !this.calendarEnabled() || !this.settings.calendarMarkers)return {dots:[]};
  const start=(weekly?date.clone().startOf('week'):date).format('YYYY-MM-DD');
  const end=(weekly?date.clone().endOf('week'):date).format('YYYY-MM-DD');
  return workloadMetadata(this.calendarIndex||new Map(),start,end);
 }
 async calendarView(type){
  let leaf=this.app.workspace.getLeavesOfType(type)[0];
  if(!leaf){leaf=this.app.workspace.getRightLeaf(true);if(!leaf)throw new Error('无法创建日历面板');await leaf.setViewState({type,active:false});}
  return leaf.view;
 }
 async showCalendars(){
  if(!this.calendarEnabled())throw new Error('请先启用 New Calendar Suite 及 UCIT 日历连接');
  await this.calendarView('gc-calendar');await this.calendarView('nc-calendar');
 }
 async reconnectCalendars(){
  if(!this.calendarEnabled() || this.reconnecting)return;
  this.reconnecting=true;
  try {
   // Recreate views through Obsidian's leaf lifecycle so already-open calendars
   // emit calendar:open again. No Svelte internals or monkey patches are used.
   for(const type of ['gc-calendar','nc-calendar'])for(const leaf of [...this.app.workspace.getLeavesOfType(type)]) {
    if(this.disposed)return;
    const state=leaf.getViewState();await leaf.setViewState({type:'empty',active:false});
    await leaf.setViewState({...state,active:false});
   }
   this.refresh();
  }finally{this.reconnecting=false;}
 }
 async openCalendarNote(mode,anchor){
  const suite=calendarPlugin(this.app);const {moment,notes}=calendarGlobals();
  if(!moment)throw new Error('New Calendar Suite 的 Moment 尚未就绪');
  const key=CALENDAR_KEYS[mode];if(!key)throw new Error('不支持的周期');
  const options=suite.options||suite.settings||{};
  if(options[key]?.enabled===false)throw new Error('请先在 New Calendar Suite 中启用 '+key);
  const date=moment(anchor,'YYYY-MM-DD',true);
  if(NC_MODES.includes(mode)) {
   if(!notes?.createNCNote)throw new Error('New Calendar Suite NCNotes API 不可用');
   const file=await notes.createNCNote(date,mode);
   if(!file)throw new Error('日历未能创建笔记，请检查模板与文件夹设置');
   return this.app.workspace.openLinkText(file.path,'',false);
  }
  const view=await this.calendarView('gc-calendar');
  const method={day:'openOrCreateDailyNote',week:'openOrCreateWeeklyNote',month:'openOrCreateGCMonth'}[mode];
  if(typeof view?.[method]!=='function')throw new Error('当前 New Calendar Suite 版本不支持该入口；请更新日历插件');
  return view[method](date,false);
 }
 async openHomeFor(anchor,mode='day'){
  await this.openHome();const view=this.app.workspace.getLeavesOfType(TYPE)[0]?.view;
  if(view){view.anchor=anchor;view.filters.horizon=mode;view.render();}
 }
 async openGuide(){
  if(this.app.vault.getAbstractFileByPath(GUIDE+'.md'))return this.app.workspace.openLinkText(GUIDE,'',false);
  const modal=new Modal(this.app);modal.contentEl.createEl('h2',{text:'UCIT Home'});
  modal.contentEl.createEl('p',{text:'新建任务 → 安排日期与预计小时 → 更新 PAWSC → 记录证据并验收。New Calendar Suite 启用时，计划入口使用其模板和文件夹。'});
  modal.contentEl.createEl('p',{text:'在周期笔记插入 ucit 代码块，内容为 period: auto，即可嵌入实时任务面板。也可指定 period: day 和 date: YYYY-MM-DD。'});
  modal.contentEl.createEl('a',{text:'Documentation / 使用指南',href:'https://github.com/jasonshelter0/obsidian-ucit-home#readme'});modal.open();
 }
 now(){return today(this.settings.timezone);}
 saveSettings(){return this.saveData(this.settings);}
 refresh(){
  this.calendarIndex=workloadIndex(collect(this.app),this.now());
  for(const leaf of this.app.workspace.getLeavesOfType(TYPE))leaf.view.render();
  for(const type of ['gc-calendar','nc-calendar'])for(const leaf of this.app.workspace.getLeavesOfType(type))leaf.view.calendar?.tick?.();
  this.app.workspace.trigger?.('ucit:changed');
 }
 exclusive(fn){const next=this.queue.then(fn);this.queue=next.catch(()=>{});return next;}
 async openHome(){let leaf=this.app.workspace.getLeavesOfType(TYPE)[0];if(!leaf){leaf=this.app.workspace.getLeaf('tab');await leaf.setViewState({type:TYPE,active:true});}this.app.workspace.revealLeaf(leaf);}
 async ensureFolder(path){let part='';for(const p of path.split('/')){part=part?part+'/'+p:p;if(!this.app.vault.getAbstractFileByPath(part))await this.app.vault.createFolder(part);}}
 async updateItem(snapshot,input){return this.exclusive(async()=>{
  const records=await readRecords(this.app);const current=records.find(x=>x.file.path===snapshot.file.path);
  if(!current || current.raw!==snapshot.raw)throw new Error('笔记已变化，请关闭表单并重新打开后保存');
  const updated=buildUpdate(current,input,records,this.now());
  await this.app.vault.process(current.file,raw=>{if(raw!==snapshot.raw)throw new Error('保存前笔记已变化，请重新打开表单');return updated;});
 });}
 async createTask(input){return this.exclusive(async()=>{
  const records=await readRecords(this.app);const parent=records.find(x=>x.ucit===input.project && x.kind==='project');
  if(!parent || parent.status==='closed')throw new Error('请选择未关闭的父项目');
  if(!/^[A-Z]+-\d+$/.test(parent.ucit))throw new Error('父项目编号格式无效');
  required(input.title,'请填写任务名称');required(input.next_action,'请填写下一步');required(input.acceptance,'请填写验收条件');
  const title=input.title.trim();if(title.length>100 || /[\x00-\x1f\\/:*?"<>|#\[\]]/.test(title) || /[. ]$/.test(title))throw new Error('名称最长 100 字，不能含路径、链接或系统保留符号');
  let max=Number(this.settings.counters[parent.ucit])||0;
  const re=new RegExp('^'+parent.ucit+'-T(\\d+)$');
  for(const item of records){const m=re.exec(String(item.ucit));if(m)max=Math.max(max,Number(m[1]));}
  // Existing ID folders also reserve a number, even if the task note was removed.
  for(const f of this.app.vault.getAllLoadedFiles())for(const segment of f.path.split('/')){const m=re.exec(segment);if(m)max=Math.max(max,Number(m[1]));}
  const num=max+1;const id=parent.ucit+'-T'+String(num).padStart(3,'0');
  const folder=parent.file.path.slice(0,parent.file.path.lastIndexOf('/'))+'/tasks/'+id;
  const path=folder+'/'+id+' '+title+'.md';const now=this.now();
  const data={ucit_version:2,kind:'task',ucit:id,parent:'[['+parent.file.path.replace(/\.md$/,'')+']]',area:parent.area,status:'planned',created:now,updated:now,next_action:input.next_action.trim(),acceptance:input.acceptance.trim(),depends_on:[],evidence:[]};
  data.depends_on=String(input.depends_on||'').split(/[\s,，]+/).filter(Boolean);
  for(const key of ['due','review_on','scheduled_on'])if(input[key])data[key]=input[key];
  if(input.due)data.due_type='internal_checkpoint';
  if(input.estimate_hours)data.estimate_hours=Number(input.estimate_hours);
  validateRecord({...data,file:{path}},[...records,{...data,file:{path}}]);
  this.settings.counters[parent.ucit]=num;await this.saveSettings(); // Reserve before creating; skipped IDs are intentional.
  await this.ensureFolder(folder);
  return this.app.vault.create(path,noteText(data,'# '+id+' '+title+'\n\n所属项目：'+data.parent+'\n\n下一步和验收条件以顶部属性为准。\n\n## 工作记录\n\n## 证据与验收\n\n## 复用与后续\n'));
 });}
 async openToday(){return this.openPeriod('day');}
 async openPeriod(mode,anchor=this.now()){
  if(!validDate(anchor))throw new Error('日期无效');
  if(this.calendarEnabled())return this.openCalendarNote(mode,anchor);
  if(NC_MODES.includes(mode))throw new Error('NC 计划需要启用 New Calendar Suite');
  const p=period(anchor,mode);const folders={day:this.settings.dailyFolder,week:this.settings.weeklyFolder,month:this.settings.monthlyFolder};
  const folder=String(folders[mode]||'').trim().replace(/\\/g,'/').replace(/\/$/,'');
  if(!folder || folder.startsWith('/') || folder.split('/').some(x=>x==='..' || x==='.' || x.startsWith('.')))throw new Error('请在设置中填写有效的独立计划文件夹');
  const path=folder+'/'+p.key+'.md';
  if(this.app.vault.getAbstractFileByPath(path))return this.app.workspace.openLinkText(path,'',false);
  const modal=new Modal(this.app);modal.contentEl.createEl('h2',{text:'创建 '+p.key+' 计划'});
  modal.contentEl.createEl('p',{text:'该计划尚不存在。可创建简洁 UCIT 计划，或取消后使用现有日历模板。简洁版不会运行 Templater / NC 模板。'});
  const create=button(modal.contentEl,'创建简洁计划',async()=>{
   create.disabled=true;
   try {
    await this.exclusive(async()=>{
     if(this.app.vault.getAbstractFileByPath(path))return;
     const records=await readRecords(this.app);const items=filteredTasks(records,{horizon:mode,hideClosed:true},anchor);
     const links=items.map(x=>'- [['+x.file.path.replace(/\.md$/,'')+']]').join('\n')||'尚无关联任务；从 UCIT 主页创建。';
     const data={'gc-type':{day:'daily',week:'weekly',month:'monthly'}[mode],date:p.start,created:this.now(),ucit_plan:true};
     const body='# '+p.key+'\n\n[[UCIT 今日主页]] · [[UCIT 插件使用指南]]\n\n## 本期成果（最多三项）\n\n明确交付与验收，不以收集资料数量代替成果。\n\n## 时间安排\n\n| 日期 / 时间块 | 任务链接 | 预期产物 | 实际证据 |\n|---|---|---|---|\n\n## 创建时的任务入口\n\n这是链接快照；实时状态以任务属性与主页为准。\n\n'+links+'\n\n## 闭环复盘\n\n- 实际成果与证据：\n- 偏差及阻塞：\n- 决定与下一步（回写任务）：\n- 可复用的方法 / 技能：\n';
     await this.ensureFolder(path.slice(0,path.lastIndexOf('/')));await this.app.vault.create(path,noteText(data,body));
    });
    modal.close();await this.app.workspace.openLinkText(path,'',false);
   } finally {create.disabled=false;}
  },'mod-cta');
  button(modal.contentEl,'取消',()=>modal.close());modal.open();
 }
 onunload(){
  this.disposed=true;
  for(const sources of this.calendarSources||[]) {const index=sources.indexOf(this.calendarSource);if(index>=0)sources.splice(index,1);}
  for(const type of ['gc-calendar','nc-calendar'])for(const leaf of this.app.workspace.getLeavesOfType(type))leaf.view.calendar?.tick?.();
  this.app.workspace.detachLeavesOfType(TYPE);
 }
}
module.exports=UCITHome;
module.exports._test={day,today,validDate,period,parseNote,noteText,collect,readRecords,validateRecord,buildUpdate,filteredTasks,blockers,LABELS,UCITView,WorkModal,DEFAULTS,suiteRange,workloadIndex,workloadMetadata,detectPeriod,UCITPlanBlock};
