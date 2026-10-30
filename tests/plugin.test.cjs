// Run: npm test (optional UCIT_TEST_FIXTURES enables read-only vault validation)
// Obsidian APIs are mocked; YAML fixtures are exported separately with PyYAML.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const yaml=require('js-yaml');
const moment=require('moment');
require('moment/locale/en-gb');
moment.locale('en-gb');
class Element {
 constructor(tag='div',opts={}){this.tag=tag;this.children=[];this.events={};this.text=opts.text||'';this.cls=opts.cls||'';this.value=opts.value||'';this.attr=opts.attr||{};this.hidden=false;}
 createEl(tag,opts){const el=new Element(tag,opts);this.children.push(el);return el;}
 createDiv(opts){return this.createEl('div',typeof opts==='string'?{cls:opts}:opts);}
 empty(){this.children=[];} addClass(c){this.cls+=' '+c;} setText(v){this.text=v;}
 addEventListener(name,fn){this.events[name]=fn;} contains(){return false;}
 all(){return [this,...this.children.flatMap(c=>c.all())];}
}
class Component {
 constructor(el=new Element()){this.inputEl=el;this.options={};}
 setValue(v){this.inputEl.value=v;return this;}getValue(){return this.inputEl.value;}
 onChange(fn){this.change=fn;return this;}addOption(k,v){this.options[k]=v;return this;}addOptions(o){Object.assign(this.options,o);return this;}
}
class Setting {
 constructor(el){this.settingEl=el.createDiv();this.controls=[];}
 setName(v){this.settingEl.createEl('label',{text:v});return this;}setDesc(v){return this;}
 addText(fn){const c=new Component(this.settingEl.createEl('input'));fn(c);this.controls.push(c);return this;}
 addTextArea(fn){const c=new Component(this.settingEl.createEl('textarea'));fn(c);this.controls.push(c);return this;}
 addDropdown(fn){const c=new Component(this.settingEl.createEl('select'));fn(c);this.controls.push(c);return this;}
 addToggle(fn){return this.addText(fn);}
}
class Modal{static instances=[];constructor(app){this.app=app;this.contentEl=new Element();Modal.instances.push(this);}open(){return this.onOpen?.();}close(){}}
class Plugin{async loadData(){return {};}async saveData(data){this.saved=JSON.parse(JSON.stringify(data));}}
const fixture=process.env.UCIT_TEST_FIXTURES ? JSON.parse(fs.readFileSync(process.env.UCIT_TEST_FIXTURES,'utf8')) : [];
function parseYaml(text){return yaml.load(text);}

const api={Plugin,ItemView:class{constructor(leaf){this.app=leaf.app;this.contentEl=new Element();}},Modal,Setting,MarkdownRenderChild:class{constructor(el){this.containerEl=el;}},PluginSettingTab:class{},Notice:class{},parseYaml,stringifyYaml:d=>yaml.dump(d)};
const browserWindow={moment};
const sandbox={window:browserWindow,require:name=>{assert.equal(name,'obsidian');return api;},module:{exports:{}},console,Intl,Date,Set,Map,setTimeout,clearTimeout,navigator:{clipboard:{writeText:async()=>{}}}};
vm.runInNewContext(fs.readFileSync(path.join(root,'main.js'),'utf8'),sandbox);
const UCIT=sandbox.module.exports;const h=UCIT._test;
function file(p){return {path:p,basename:path.basename(p,'.md')};}
function record(d,p,body='Original body.\n'){const raw=h.noteText(d,body);return {...d,file:file(p),raw};}
function project(status='active'){return record({ucit_version:2,kind:'project',ucit:'ABC-001',status,area:'[[MiniEnter]]',goal:'goal',outcome:'outcome',budget:'8h',task_source:'projects/A/tasks',review_on:'2026-10-29',next_action:'go'},'projects/A/HOME.md');}
function task(n,status='planned',extra={}){return record({ucit_version:2,kind:'task',ucit:'ABC-001-T'+String(n).padStart(3,'0'),parent:'[[projects/A/HOME]]',area:'[[MiniEnter]]',status,acceptance:'observable output',next_action:'go',review_on:'2026-10-29',depends_on:[],evidence:[],...extra},`projects/A/tasks/ABC-001-T${String(n).padStart(3,'0')}/task.md`);}
function fakeApp(records){
 const files=new Map(records.map(x=>[x.file.path,x.file]));const texts=new Map(records.map(x=>[x.file.path,x.raw]));
 const vault={
  getMarkdownFiles:()=>[...files.values()].filter(x=>x.path.endsWith('.md')),
  getAllLoadedFiles:()=>[...files.values()],getAbstractFileByPath:p=>files.get(p),
  read:async f=>texts.get(f.path),
  createFolder:async p=>{if(files.has(p))throw new Error('exists');files.set(p,{path:p});},
  create:async(p,raw)=>{if(files.has(p))throw new Error('exists');const f=file(p);files.set(p,f);texts.set(p,raw);return f;},
  process:async(f,fn)=>{const next=fn(texts.get(f.path));texts.set(f.path,next);return next;}
 };
 const app={vault,metadataCache:{getFileCache:f=>({frontmatter:h.parseNote(texts.get(f.path))?.data})},workspace:{getLeavesOfType:()=>[],openLinkText:async()=>{}}};
 return {app,files,texts};
}
function plugin(records){const env=fakeApp(records);const p=new UCIT();p.app=env.app;p.settings={...h.DEFAULTS,counters:{}};p.queue=Promise.resolve();p.now=()=> '2026-10-28';return {p,...env};}
const input={status:'active',reason:'Start now',review_on:'2026-10-29'};
test('ISO week year boundaries, leap months and Shanghai date',()=>{
 assert.equal(h.period('2027-01-01','week').key,'2026-W53');
 assert.equal(h.period('2024-12-30','week').key,'2025-W01');
 assert.equal(h.period('2028-02-10','month').end,'2028-02-29');
 assert.equal(h.validDate('2026-02-30'),false);
 assert.equal(h.today('Asia/Shanghai',new Date('2026-10-28T18:00:00Z')),'2026-10-29');
});
test('activation requires successful dependency and active parent',()=>{
 const dep=task(1,'closed',{resolution:'cancelled',closed_on:'2026-10-28',evidence:['decision']});const t=task(2,'planned',{depends_on:[dep.ucit]});
 assert.throws(()=>h.buildUpdate(t,input,[project(),dep,t],'2026-10-28'),/依赖/);
 dep.resolution='done';assert.doesNotThrow(()=>h.buildUpdate(t,input,[project(),dep,t],'2026-10-28'));
 assert.throws(()=>h.buildUpdate(t,input,[project('planned'),dep,t],'2026-10-28'),/父项目/);
});
test('closure needs evidence; project must finish child commitments',()=>{
 const t=task(1);const p=project();
 assert.throws(()=>h.buildUpdate(t,{status:'closed',resolution:'done',reason:'done',evidence:[]},[p,t],'2026-10-28'),/证据/);
 assert.throws(()=>h.buildUpdate(p,{status:'closed',resolution:'done',reason:'done',evidence:['artifact']},[p,t],'2026-10-28'),/子任务/);
 const updated=h.parseNote(h.buildUpdate(t,{status:'closed',resolution:'done',reason:'verified',evidence:['[[artifact]]']},[p,t],'2026-10-28'));
 assert.equal(updated.data.closed_on,'2026-10-28');assert.equal(updated.data.resolution,'done');assert.match(updated.body,/Original body/);assert.match(updated.body,/verified/);
});
test('waiting and suspension require explicit conditions; transitions clear stale fields',()=>{
 const t=task(1);const records=[project(),t];
 assert.throws(()=>h.buildUpdate(t,{status:'waiting',reason:'wait'},records,'2026-10-28'),/等待对象/);
 assert.throws(()=>h.buildUpdate(t,{status:'suspended',reason:'pause'},records,'2026-10-28'),/恢复条件/);
 const w=task(1,'waiting',{waiting_for:'server'});
 assert.equal(h.parseNote(h.buildUpdate(w,input,[project(),w],'2026-10-28')).data.waiting_for,undefined);
});
test('cannot reopen a dependency used by an active successor',()=>{
 const dep=task(1,'closed',{resolution:'done',closed_on:'2026-10-28',evidence:['artifact']});const t=task(2,'active',{depends_on:[dep.ucit]});
 assert.throws(()=>h.buildUpdate(dep,{status:'planned',reason:'reopen'},[project(),dep,t],'2026-10-28'),/后续任务/);
});
test('cannot pause a project with active child tasks',()=>{
 const p=project();const t=task(1,'active');
 assert.throws(()=>h.buildUpdate(p,{status:'suspended',resume_when:'next week',reason:'pause'},[p,t],'2026-10-28'),/子任务/);
});
test('cycles, invalid dates and hours are rejected',()=>{
 const a=task(1,'planned',{depends_on:['ABC-001-T002']});const b=task(2,'planned',{depends_on:[a.ucit]});
 assert.throws(()=>h.validateRecord(a,[project(),a,b]),/循环/);
 for(const patch of [{due:'2026-02-30'},{estimate_hours:-1}])assert.throws(()=>h.buildUpdate(task(3),{...patch,reason:'edit'},[project(),task(3)],'2026-10-28'));
});
test('editor detects changes since opening, and a final write race',async()=>{
 const t=task(1);const {p,texts}=plugin([project(),t]);texts.set(t.file.path,t.raw+'external edit');
 await assert.rejects(p.updateItem(t,input),/已变化/);assert.match(texts.get(t.file.path),/external edit/);
 texts.set(t.file.path,t.raw);const process=p.app.vault.process;
 p.app.vault.process=async(f,fn)=>{texts.set(f.path,t.raw+'race');return process(f,fn);};
 await assert.rejects(p.updateItem(t,input),/已变化/);assert.match(texts.get(t.file.path),/race/);
});
test('save preserves body and unknown properties, appends audit and clears optional date',async()=>{
 const t=task(1,'planned',{custom_field:'keep',due:'2026-10-30'});const {p,texts}=plugin([project(),t]);
 await p.updateItem(t,{...input,due:'',scheduled_on:'2026-10-28',estimate_hours:'2'});
 const parsed=h.parseNote(texts.get(t.file.path));assert.equal(parsed.data.custom_field,'keep');assert.equal(parsed.data.due,undefined);assert.equal(parsed.data.estimate_hours,2);assert.match(parsed.body,/Original body/);assert.match(parsed.body,/Start now/);
});
test('quick capture serializes allocation and reserves deleted folder numbers',async()=>{
 const {p,files,texts}=plugin([project(),task(1)]);files.set('projects/A/tasks/ABC-001-T004',{path:'projects/A/tasks/ABC-001-T004'});
 const v={project:'ABC-001',title:'new task',next_action:'run',acceptance:'result',review_on:'2026-10-29'};
 const [a,b]=await Promise.all([p.createTask(v),p.createTask(v)]);
 assert.match(a.path,/T005/);assert.match(b.path,/T006/);
 const parsed=h.parseNote(texts.get(a.path));assert.equal(parsed.data.status,'planned');assert.equal(parsed.data.parent,'[[projects/A/HOME]]');assert.equal(p.saved.counters['ABC-001'],6);
 // Even removal of the full folder and note does not recycle the persisted high-water mark.
 files.delete(b.path);files.delete('projects/A/tasks/ABC-001-T006');
 assert.match((await p.createTask(v)).path,/T007/);
});
test('invalid capture cannot create files or consume an ID',async()=>{
 const {p,files}=plugin([project()]);const size=files.size;
 await assert.rejects(p.createTask({project:'ABC-001',title:'../escape',next_action:'x',acceptance:'y'}),/名称/);
 await assert.rejects(p.createTask({project:'ABC-001',title:'okay',next_action:'x',acceptance:'y',due:'2026-02-30'}),/日期/);
 assert.equal(files.size,size);assert.equal(p.settings.counters['ABC-001'],undefined);
});
test('duplicate IDs block writes instead of silently selecting one',async()=>{
 const t=task(1);const dup={...t,file:file('projects/A/duplicate.md')};const {p}=plugin([project(),t,dup]);
 await assert.rejects(p.updateItem(t,input),/重复/);
});
test('period filters retain open overdue work, exclude unrelated closed work, support project/search',()=>{
 const p=project();const old=task(1,'planned',{due:'2026-10-01'});const closed=task(2,'closed',{due:'2026-10-01'});const scheduled=task(3,'planned',{scheduled_on:'2026-10-28'});const future=task(4,'planned',{due:'2026-12-01',review_on:'2026-12-01'});
 const records=[p,old,closed,scheduled,future];const list=h.filteredTasks(records,{horizon:'day'},'2026-10-28');
 assert.equal(list.length,2);assert.ok(list.includes(old));assert.ok(list.includes(scheduled));
 assert.equal(h.filteredTasks(records,{horizon:'all',query:'T004',project:'ABC-001'},'2026-10-28').length,1);
});
test('dashboard renders lanes, capacity, monthly dates, progress and action buttons',()=>{
 const {p,app}=plugin([project(),task(1,'active',{scheduled_on:'2026-10-28',estimate_hours:9})]);
 const view=new h.UCITView({app},p);view.filters.horizon='month';view.render();
 const els=view.contentEl.all();assert.equal(els.filter(e=>e.cls==='ucit-lane').length,5);assert.equal(els.filter(e=>e.cls.startsWith('ucit-agenda-day')).length,31);
 assert.ok(els.some(e=>e.text.includes('9h / 8h')));assert.ok(els.some(e=>e.text.includes('超出容量')));assert.ok(els.some(e=>e.text==='调整 / 闭环'));assert.ok(els.some(e=>e.text==='＋ 新任务'));
});
test('task editor loads fresh data and presents closure/creation fields',async()=>{
 const t=task(1);const {p}=plugin([project(),t]);
 const edit=new h.WorkModal(p,t);await edit.onOpen();assert.equal(edit.values.status,'planned');assert.ok(edit.item.raw);assert.equal(edit.closeRow.settingEl.hidden,true);
 edit.values.status='closed';edit.showConditions();assert.equal(edit.closeRow.settingEl.hidden,false);
 const create=new h.WorkModal(p,null,'ABC-001');await create.onOpen();assert.equal(create.values.project,'ABC-001');assert.ok(create.contentEl.all().some(e=>e.text==='创建任务'));
});
test('existing day/week/month plans are opened without being rewritten',async()=>{
 const {p,files,texts}=plugin([]);const opened=[];p.app.workspace.openLinkText=async s=>opened.push(s);
 for(const [mode,folder,key] of [['day','daily','2026-10-28'],['week','weekly','2026-W44'],['month','gc-monthly','2026-10']]){
  const path=`areas/periodicNotes/${folder}/${key}.md`;files.set(path,file(path));texts.set(path,'keep exactly');await p.openPeriod(mode);assert.equal(texts.get(path),'keep exactly');
 }
 assert.equal(opened.length,3);
});
test('dependency edits reject missing IDs and cycles while preserving valid references',()=>{
 const dep=task(1);const t=task(2);
 assert.throws(()=>h.buildUpdate(t,{reason:'link',depends_on:'MISSING-T001'},[project(),dep,t],'2026-10-28'),/找不到/);
 assert.throws(()=>h.buildUpdate(t,{reason:'link',depends_on:t.ucit},[project(),dep,t],'2026-10-28'),/循环/);
 const result=h.parseNote(h.buildUpdate(t,{reason:'link',depends_on:dep.ucit},[project(),dep,t],'2026-10-28'));
 assert.equal(result.data.depends_on[0],dep.ucit);assert.match(result.body,/depends_on/);
});
test('missing period plan creates only on explicit button click, with links and no template tokens',async()=>{
 const {p,files,texts}=plugin([project(),task(1,'active')]);
 const path='areas/periodicNotes/weekly/2026-W44.md';
 await p.openPeriod('week');assert.equal(files.has(path),false);
 const modal=Modal.instances.at(-1);
 await modal.contentEl.all().find(x=>x.text==='创建简洁计划').events.click();
 assert.equal(files.has(path),true);const text=texts.get(path);
 assert.match(text,/创建时的任务入口/);assert.match(text,/\[\[projects\/A\/tasks/);assert.doesNotMatch(text,/<%|{{date/);
 assert.equal(h.parseNote(text).data['gc-type'],'weekly');
});
function enableCalendar(p,options={}) {
 const suite={options:{daily:{enabled:true},weekly:{enabled:true},monthly:{enabled:true},...options}};
 p.app.plugins={getPlugin:id=>id==='new-calendar-suite'?suite:null};return suite;
}
test('calendar weekly range follows Sunday locale and configured week filename',()=>{
 const {p}=plugin([]);enableCalendar(p,{weekly:{enabled:true,format:'gggg-[WK]ww'}});
 moment.updateLocale('en-gb',{week:{dow:0,doy:4}});
 try {const r=p.range('2026-10-28','week');assert.equal(r.start,'2026-10-25');assert.equal(r.end,'2026-10-31');assert.equal(r.key,moment('2026-10-28').format('gggg-[WK]ww'));}
 finally {moment.updateLocale('en-gb',{week:{dow:1,doy:4}});}
});
test('GC note navigation delegates supplied dates; disabled periods never create fallback files',async()=>{
 const {p,files}=plugin([]);const suite=enableCalendar(p);const calls=[];
 p.app.workspace.getLeavesOfType=type=>type==='gc-calendar'?[{view:{openOrCreateDailyNote:async date=>calls.push(date.format('YYYY-MM-DD')),openOrCreateWeeklyNote:async date=>calls.push('week:'+date.format('YYYY-MM-DD')),openOrCreateGCMonth:async date=>calls.push('month:'+date.format('YYYY-MM-DD'))}}]:[];
 await p.openPeriod('day','2026-11-03');await p.openPeriod('week','2026-11-03');await p.openPeriod('month','2026-11-03');
 assert.equal(calls.join(','),'2026-11-03,week:2026-11-03,month:2026-11-03');assert.equal(files.size,0);
 suite.options.weekly.enabled=false;await assert.rejects(p.openPeriod('week','2026-11-03'),/启用/);assert.equal(files.size,0);
});
test('calendar bridge fails explicitly on unsupported view API without duplicate fallback notes',async()=>{
 const {p,files}=plugin([]);enableCalendar(p);p.app.workspace.getLeavesOfType=()=>[{view:{}}];
 await assert.rejects(p.openPeriod('day'),/版本/);assert.equal(files.size,0);
});
test('NC note navigation uses public creation API and inclusive range semantics',async()=>{
 const {p}=plugin([]);enableCalendar(p);const calls=[];
 browserWindow.NCDates={get:()=>({ny:7,nm:2,phase:3,season:1}),toDateString:()=> '07-02-10',getPeriodRange:(mode,y,m,arg)=>{calls.push([mode,y,m,arg]);return [moment('2026-10-20'),moment('2026-11-10')];}};
 browserWindow.NCNotes={createNCNote:async(date,mode)=>{calls.push([mode,date.format('YYYY-MM-DD')]);return {path:'custom/NC-month.md'};}};
 const opened=[];p.app.workspace.openLinkText=async p=>opened.push(p);
 try {
  assert.equal(p.range('2026-10-28','nc-phase').end,'2026-11-10');assert.equal(calls[0][3],3);
  await p.openPeriod('nc-month','2026-10-28');assert.equal(opened[0],'custom/NC-month.md');assert.equal(calls[1][1],'2026-10-28');
 } finally {delete browserWindow.NCDates;delete browserWindow.NCNotes;}
});
test('workload markers distinguish scheduling, deadlines, reviews, done and cancelled',()=>{
 const records=[task(1,'planned',{scheduled_on:'2026-10-28',estimate_hours:2,due:'2026-10-20',review_on:'2026-10-28'}),task(2,'closed',{resolution:'done',closed_on:'2026-10-28'}),task(3,'closed',{resolution:'cancelled',closed_on:'2026-10-28'})];
 const index=h.workloadIndex(records,'2026-10-28');const m=h.workloadMetadata(index,'2026-10-28');
 assert.equal(m.dots.length,4);assert.equal(m.counts.done,1);assert.equal(m.counts.hours,2);assert.equal(m.counts.overdue,1);
 assert.equal(h.workloadMetadata(index,'2026-10-29').dots.length,0);
});
test('period detection handles GC/NC frontmatter, configured names and invalid contexts',()=>{
 const {p,app}=plugin([]);enableCalendar(p,{daily:{format:'YYYY.MM.DD'}});
 app.metadataCache.getFileCache=()=>({frontmatter:{'nc-type':'phase','gc-date':'2026-10-28'}});
 assert.equal(h.detectPeriod(app,file('notes/anything.md')).mode,'nc-phase');
 app.metadataCache.getFileCache=()=>({frontmatter:{}});
 assert.equal(h.detectPeriod(app,file('notes/2026.10.28.md')).anchor,'2026-10-28');
 assert.throws(()=>h.detectPeriod(app,file('notes/random.md')),/识别/);
 assert.equal(h.detectPeriod(app,file('notes/random.md'),{period:'day',date:'2026-10-28'}).anchor,'2026-10-28');
});
test('live block reads the period note and offers linked tasks without writing a second ledger',()=>{
 const t=task(1,'active');const {p,app,files}=plugin([project(),t]);const el=new Element();
 const panel=new h.UCITPlanBlock(el,p,file('plans/2026-10-28.md'),{period:'day',date:'2026-10-28'});
 const count=files.size;panel.render();assert.ok(el.all().some(x=>x.text===t.file.basename));assert.equal(files.size,count);
});
test('new task from selected period defaults its scheduled date without activating it',async()=>{
 const {p}=plugin([project()]);const modal=new h.WorkModal(p,null,'ABC-001','2026-11-02');await modal.onOpen();
 assert.equal(modal.values.scheduled_on,'2026-11-02');assert.equal(modal.values.review_on,'2026-11-02');
});
test('reconnecting calendar leaves uses host lifecycle and preserves their pane state',async()=>{
 const {p}=plugin([]);enableCalendar(p);const states=[];
 const leaf={getViewState:()=>({type:'gc-calendar',state:{example:true}}),setViewState:async x=>states.push(x),view:{calendar:{tick(){}}}};
 p.app.workspace.getLeavesOfType=type=>type==='gc-calendar'?[leaf]:[];
 await p.reconnectCalendars();assert.equal(states[0].type,'empty');assert.equal(states[1].type,'gc-calendar');assert.equal(states[1].state.example,true);
});

test('current managed vault data satisfies plugin invariants (read only)',{skip:!fixture.length},()=>{
 const records=fixture.map(x=>({...x.data,file:file(x.path),raw:x.raw}));
 assert.ok(records.length>0);
 for(const item of records)assert.doesNotThrow(()=>h.validateRecord(item,records),item.ucit);
 const {app,p,texts}=plugin(records);
 const view=new h.UCITView({app},p);view.render();
 assert.equal(h.collect(app).length,records.length);
 for(const item of records)assert.deepEqual(h.parseNote(texts.get(item.file.path)).data,item.kind?fixture.find(x=>x.data.ucit===item.ucit).data:{});
});

test('one-line project capture validates title, owner and deadline before any write',async()=>{
 const {p,files}=plugin([]);
 for(const line of ['', '../escape | MiniEnter','Title | due:2026-02-30','Title | MiniEnter | RefCom','Title | unknown:value','Title || due:2026-11-30'])await assert.rejects(p.createProject(line));
 assert.equal(files.size,0);assert.equal(p.saved,undefined);
 const d=h.parseProjectLine('整理计划 | RefCom | due:2026-11-30');
 assert.equal(d.area,'[[RefCom]]');assert.equal(d.due,'2026-11-30');
 assert.equal(h.parseProjectLine('Title','MiniHome').area,'[[MiniHome]]');
});
test('project creation serializes IDs, reserves old folders and keeps captured projects planned',async()=>{
 const {p,files,texts}=plugin([]);files.set('projects/PRJ-009 old',{path:'projects/PRJ-009 old'});
 const created=await Promise.all([p.createProject('First | MiniEnter'),p.createProject('Second | RefCom | due:2026-11-30')]);
 assert.match(created[0].path,/PRJ-010 First\/HOME.md$/);assert.match(created[1].path,/PRJ-011 Second\/HOME.md$/);
 const d=h.parseNote(texts.get(created[1].path)).data;assert.equal(d.status,'planned');assert.equal(d.review_on,p.now());assert.equal(d.outcome,'');assert.equal(d.due,'2026-11-30');assert.equal(d.due_type,'internal_checkpoint');
 assert.ok(files.has(d.task_source));assert.equal(p.saved.counters.__projects,11);
 const records=await h.readRecords(p.app),item=records.find(r=>r.ucit===d.ucit);
 assert.throws(()=>h.buildUpdate(item,{status:'active',reason:'start',next_action:'Make prototype'},records,p.now()),/goal/);
 const raw=h.buildUpdate(item,{status:'active',reason:'defined scope',next_action:'Make prototype',goal:'Useful demo',outcome:'Accepted demo',budget:'4h'},records,p.now());
 assert.equal(h.parseNote(raw).data.status,'active');assert.match(raw,/defined scope/);
});
test('failed project creation retains reservation and a retry never reuses its ID',async()=>{
 const {p}=plugin([]);const create=p.app.vault.create;p.app.vault.create=async()=>{throw Error('disk failure');};
 await assert.rejects(p.createProject('First'),/disk failure/);assert.equal(p.saved.counters.__projects,1);
 p.app.vault.create=create;assert.match((await p.createProject('First')).path,/PRJ-002/);
});
test('project modal supports Enter, ignores IME composition and offers owner before creation',async()=>{
 const {p}=plugin([]);let calls=0;p.createProject=async()=>{calls++;return {path:'projects/PRJ-001/HOME.md'};};
 const modal=new h.ProjectModal(p);modal.onOpen();const input=modal.contentEl.all().find(e=>e.placeholder?.startsWith('Build my portfolio'));
 assert.ok(input);input.events.keydown({key:'Enter',isComposing:true});assert.equal(calls,0);
 input.events.keydown({key:'Enter',isComposing:false,preventDefault(){}});await new Promise(r=>setTimeout(r,0));assert.equal(calls,1);
});
test('GC quarter/year periods handle leap years and legacy filename date fallback',()=>{
 assert.equal(h.period('2028-02-29','quarter').end,'2028-03-31');assert.equal(h.period('2026-11-10','year').start,'2026-01-01');
 const {app}=fakeApp([]);app.metadataCache.getFileCache=()=>({frontmatter:{'gc-type':'quarterly',date:'2026-Season'}});
 assert.equal(h.detectPeriod(app,file('areas/periodicNotes/gc-quarterly/2026-Q4.md')).anchor,'2026-10-01');
 app.metadataCache.getFileCache=()=>({frontmatter:{'gc-type':'yearly',date:'{{nc-year}}'}});
 assert.equal(h.detectPeriod(app,file('areas/periodicNotes/gc-yearly/2026.md')).anchor,'2026-01-01');
});
test('GC quarter/year navigation delegates to NCS and respects disabled periods',async()=>{
 const {p}=plugin([]),seen=[];p.app.plugins={getPlugin:()=>({options:{quarterly:{enabled:true},yearly:{enabled:true}}})};
 p.calendarView=async()=>({openOrCreateGCQuarter:async d=>seen.push('Q'+d.format('YYYY-MM-DD')),openOrCreateGCYear:async d=>seen.push('Y'+d.format('YYYY-MM-DD'))});
 await p.openCalendarNote('quarter','2026-11-10');await p.openCalendarNote('year','2026-11-10');assert.equal(seen.join(','),'Q2026-11-10,Y2026-11-10');
 p.app.plugins.getPlugin=()=>({options:{quarterly:{enabled:false}}});await assert.rejects(p.openCalendarNote('quarter','2026-11-10'),/启用/);
});
test('rescheduling changes daily capacity but preserves deadline, identity and closure state',()=>{
 const p=project(),t=task(1,'planned',{due:'2026-11-10',scheduled_on:'2026-10-30',estimate_hours:2});
 const data=h.parseNote(h.buildUpdate(t,{scheduled_on:'2026-11-01',reason:'capacity moved'},[p,t],'2026-10-30')).data;
 assert.equal(data.ucit,t.ucit);assert.equal(data.status,t.status);assert.equal(data.due,t.due);
 const idx=h.workloadIndex([{...data,file:t.file}],'2026-10-30');assert.equal(idx.get('2026-11-01').hours,2);assert.equal(idx.has('2026-10-30'),false);
});
