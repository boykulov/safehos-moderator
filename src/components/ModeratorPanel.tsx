import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  getPendingEvents, getDeferredEvents, makeDecision, deferEvent,
  getHistory, getAllowlist, getBlocklist, addToAllowlist, addToBlocklist, removeFromList,
  updateAllowlistEntry, exportAllowlist
} from '../api';
import api from '../api';

interface Props { user: any; onLogout: () => void; }

function LiveTimer({ startTime }: { startTime: string }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const start = new Date(startTime).getTime();
    const tick = () => setElapsed(Math.floor((Date.now() - start) / 1000));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [startTime]);
  const m = Math.floor(elapsed / 60), s = elapsed % 60;
  const color = elapsed > 120 ? '#f85149' : elapsed > 60 ? '#f0a84a' : '#3fb950';
  return <span style={{ fontFamily: 'monospace', fontSize: 12, color, fontWeight: 700 }}>⏱ {m}:{s.toString().padStart(2,'0')}</span>;
}

type Tab = 'pending' | 'deferred' | 'history' | 'allowlist' | 'blocklist';

const CATEGORY_LABELS: Record<string, string> = {
  loadboard: '🚛 Load Board', factoring: '💰 Factoring', broker: '🏢 Broker',
  carrier: '🚚 Carrier', maps: '🗺 Maps', email: '📧 Email',
  eld: '📡 ELD', tms: '💻 TMS', document: '📄 Documents',
  support: '🎧 Support', auth: '🔐 Auth', cdn: '☁️ CDN', other: '🔧 Other',
};

const CATEGORIES = Object.keys(CATEGORY_LABELS);

export default function ModeratorPanel({ user, onLogout }: Props) {
  const [events, setEvents] = useState<any[]>([]);
  const [deferred, setDeferred] = useState<any[]>([]);
  const [history, setHistory] = useState<any[]>([]);
  const [allowlist, setAllowlist] = useState<any[]>([]);
  const [blocklist, setBlocklist] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState<Tab>('pending');
  const [deciding, setDeciding] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showDeferPicker, setShowDeferPicker] = useState<string | null>(null);
  const [notification, setNotification] = useState<{msg:string;type:string}|null>(null);
  const [allowlistFilter, setAllowlistFilter] = useState('');
  const [allowlistCategory, setAllowlistCategory] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [addForm, setAddForm] = useState({ domain:'', isGlobal:false, isWildcard:true, category:'other', notes:'' });
  const [editEntry, setEditEntry] = useState<any>(null);
  const [editForm, setEditForm] = useState({ category:'other', notes:'', isWildcard:false });
  const [allowlistSort, setAllowlistSort] = useState<'alpha'|'newest'|'oldest'>('alpha');
  const [allowlistTypeFilter, setAllowlistTypeFilter] = useState<''|'global'|'org'>('');
  const [recentlyApproved, setRecentlyApproved] = useState<any[]>([]);
  const [blocklistFilter, setBlocklistFilter] = useState('');
  const knownIds = useRef<Set<string>>(new Set());
  const notifTimer = useRef<any>(null);

  const showNotif = (msg: string, type = 'info') => {
    if (notifTimer.current) clearTimeout(notifTimer.current);
    setNotification({msg, type});
    notifTimer.current = setTimeout(() => setNotification(null), 4000);
  };

  const playSound = (freq = 880) => {
    try {
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.2, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
      osc.start(); osc.stop(ctx.currentTime + 0.3);
    } catch(e) {}
  };

  const fetchPending = useCallback(async () => {
    try {
      const res = await getPendingEvents(user.companyId);
      const newEvents: any[] = res.data;
      const trulyNew = newEvents.filter(e => !knownIds.current.has(e.id));
      if (trulyNew.length > 0) {
        trulyNew.forEach(e => knownIds.current.add(e.id));
        showNotif(`🚨 Новый запрос: ${trulyNew[0].domain}`, 'warning');
        playSound(660);
      }
      setEvents(newEvents);
    } catch(e) {}
  }, [user.companyId]);

  const fetchDeferred = useCallback(async () => {
    try { const res = await getDeferredEvents(); setDeferred(res.data); } catch(e) {}
  }, []);

  const fetchHistory = useCallback(async () => {
    try { const res = await getHistory(); setHistory(res.data); } catch(e) {}
  }, []);

  const fetchAllowlist = useCallback(async () => {
    try { const res = await getAllowlist(); setAllowlist(res.data); } catch(e) {}
  }, []);

  const fetchBlocklist = useCallback(async () => {
    try { const res = await getBlocklist(); setBlocklist(res.data); } catch(e) {}
  }, []);

  useEffect(() => {
    fetchPending(); fetchDeferred(); fetchHistory(); fetchAllowlist(); fetchBlocklist();
    const pendingInterval = setInterval(fetchPending, 3000);
    const deferredInterval = setInterval(fetchDeferred, 10000);
    return () => { clearInterval(pendingInterval); clearInterval(deferredInterval); };
  // eslint-disable-next-line
  }, []);

  const handleDecision = async (
    eventId: string, action: 'approved'|'blocked', isGlobal = false,
    options?: { isWildcard?: boolean; category?: string }
  ) => {
    setDeciding(eventId);
    knownIds.current.delete(eventId);
    try {
      const ev = events.find(e => e.id === eventId) || deferred.find(e => e.id === eventId);
      const rt = ev ? Math.floor((Date.now() - new Date(ev.createdAt).getTime()) / 1000) : 0;
      await makeDecision(eventId, action, `Response time: ${rt}s`, isGlobal, options);
      playSound(action === 'approved' ? 1047 : 440);
      showNotif(action === 'approved' ? `✅ Одобрен за ${rt}с` : `🚫 Заблокирован за ${rt}с`, action === 'approved' ? 'success' : 'error');
      // Трекинг недавно одобренных
      if (action === 'approved' && ev) {
        setRecentlyApproved(prev => [{
          domain: ev.domain, eventId, approvedAt: new Date().toISOString(),
          responseTime: rt, isGlobal, source: 'queue'
        }, ...prev].slice(0, 20));
      }
      fetchPending(); fetchDeferred(); fetchHistory(); fetchAllowlist(); fetchBlocklist();
    } catch(e) { showNotif('Ошибка', 'error'); }
    finally { setDeciding(null); }
  };

  const handleDefer = async (eventId: string, minutes: number) => {
    setDeciding(eventId);
    try {
      await deferEvent(eventId, minutes);
      setShowDeferPicker(null);
      showNotif(`⏸ Отложено на ${minutes} минут`, 'info');
      fetchPending(); fetchDeferred();
    } catch(e) { showNotif('Ошибка', 'error'); }
    finally { setDeciding(null); }
  };

  const handleAddToAllowlist = async () => {
    if (!addForm.domain) return;
    try {
      await addToAllowlist(addForm);
      showNotif(`✅ ${addForm.domain} добавлен в allowlist`, 'success');
      setAddForm({ domain:'', isGlobal:false, isWildcard:true, category:'other', notes:'' });
      setShowAddForm(false);
      fetchAllowlist();
    } catch(e: any) {
      const msg = e?.response?.data?.message || e?.message || 'Ошибка добавления';
      showNotif(`❌ ${msg}`, 'error');
    }
  };

  const handleRemoveFromAllowlist = async (domain: string) => {
    try {
      await removeFromList(domain);
      showNotif(`🗑 ${domain} удалён`, 'info');
      fetchAllowlist(); fetchBlocklist();
    } catch(e) { showNotif('Ошибка удаления', 'error'); }
  };

  const handleEditSave = async () => {
    if (!editEntry) return;
    try {
      await updateAllowlistEntry(editEntry.id, editForm);
      showNotif(`✏️ ${editEntry.domain} обновлён`, 'success');
      setEditEntry(null);
      fetchAllowlist();
    } catch(e) { showNotif('Ошибка редактирования', 'error'); }
  };

  const handleExport = async () => {
    try {
      const res = await exportAllowlist();
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement('a');
      a.href = url; a.download = 'safehos-allowlist.csv';
      a.click(); window.URL.revokeObjectURL(url);
      showNotif('📥 CSV экспортирован', 'success');
    } catch(e) { showNotif('Ошибка экспорта', 'error'); }
  };

  const rc = (s: number) => s >= 70 ? '#f85149' : s >= 40 ? '#f0a84a' : '#388bfd';
  const rl = (s: number) => s >= 70 ? '🔴 Высокий' : s >= 40 ? '🟡 Средний' : '🔵 Неизвестный';
  const fmtTime = (d: string) => new Date(d).toLocaleString('ru-RU', {day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});
  const parseUrl = (r: string) => { const m = r?.match(/URL: ([^\s|]+)/); return m?m[1]:null; };
  const parseFlags = (r: string) => { const m = r?.match(/Flags: (.+?)(\s*\|.*)?$/); return m?m[1].split(', ').filter(Boolean):[]; };
  const parseRt = (r: string) => { const m = r?.match(/Response time: (\d+)s/); return m?parseInt(m[1]):null; };

  const nc: Record<string,any> = {
    info: {bg:'rgba(56,139,253,0.1)',b:'rgba(56,139,253,0.3)',c:'#388bfd'},
    success: {bg:'rgba(63,185,80,0.1)',b:'rgba(63,185,80,0.3)',c:'#3fb950'},
    error: {bg:'rgba(248,81,73,0.1)',b:'rgba(248,81,73,0.3)',c:'#f85149'},
    warning: {bg:'rgba(240,168,74,0.1)',b:'rgba(240,168,74,0.3)',c:'#f0a84a'},
  };

  const uniqueDomains = Object.values(history.reduce((acc: Record<string,any>, item: any) => {
    if (!acc[item.domain] || new Date(item.createdAt) > new Date(acc[item.domain].createdAt)) acc[item.domain] = item;
    return acc;
  }, {})) as any[];
  const approved = uniqueDomains.filter((i:any) => i.action === 'approved').length;
  const blocked = uniqueDomains.filter((i:any) => i.action === 'blocked').length;

  const groupedHistory = history.reduce((acc: Record<string,any>, item: any) => {
    if (!acc[item.domain]) acc[item.domain] = { domain: item.domain, actions: [], latest: item };
    if (new Date(item.createdAt) > new Date(acc[item.domain].latest.createdAt)) acc[item.domain].latest = item;
    acc[item.domain].actions = [...acc[item.domain].actions, item].sort((a,b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return acc;
  }, {});
  const historyGroups = Object.values(groupedHistory) as any[];

  const filteredAllowlist = allowlist
    .filter(d =>
      (!allowlistFilter || d.domain.includes(allowlistFilter.toLowerCase())) &&
      (!allowlistCategory || d.category === allowlistCategory) &&
      (!allowlistTypeFilter || (allowlistTypeFilter === 'global' ? d.isGlobal : !d.isGlobal))
    )
    .sort((a, b) => {
      if (allowlistSort === 'alpha') return a.domain.localeCompare(b.domain);
      if (allowlistSort === 'newest') return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    });

  const filteredBlocklist = blocklist.filter(d =>
    !blocklistFilter || d.domain.toLowerCase().includes(blocklistFilter.toLowerCase())
  );

  const allowlistByCategory = filteredAllowlist.reduce((acc: Record<string,any[]>, d: any) => {
    const cat = d.category || 'other';
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(d);
    return acc;
  }, {});

  const tabs = [
    { id: 'pending', icon: '🔍', label: 'Очередь', count: events.length },
    { id: 'deferred', icon: '⏸', label: 'Отложенные', count: deferred.length },
    { id: 'allowlist', icon: '✅', label: 'Allowlist', count: allowlist.length },
    { id: 'blocklist', icon: '🚫', label: 'Blocklist', count: blocklist.length },
    { id: 'history', icon: '📋', label: 'История', count: null },
  ];

  const DEFER_OPTIONS = [15, 30, 60, 120, 240];

  return (
    <div style={{display:'flex',minHeight:'100vh',background:'#0d1117',fontFamily:'-apple-system,BlinkMacSystemFont,Inter,sans-serif',color:'#e6edf3'}}>
      {/* Sidebar */}
      <div style={{width:220,background:'#161b22',borderRight:'1px solid #21262d',display:'flex',flexDirection:'column',padding:'16px 0',position:'fixed',top:0,left:0,bottom:0,overflowY:'auto'}}>
        <div style={{display:'flex',alignItems:'center',gap:10,padding:'0 16px 16px',borderBottom:'1px solid #21262d'}}>
          <div style={{fontSize:24,background:'linear-gradient(135deg,#388bfd,#8957e5)',borderRadius:8,width:36,height:36,display:'flex',alignItems:'center',justifyContent:'center'}}>🛡️</div>
          <div>
            <div style={{fontSize:14,fontWeight:700,color:'#fff'}}>SafeHos</div>
            <div style={{fontSize:10,color:'#7d8590'}}>Moderator Panel</div>
          </div>
        </div>

        <div style={{padding:'12px 16px',borderBottom:'1px solid #21262d'}}>
          <div style={{fontSize:10,color:'#484f58',marginBottom:8,textTransform:'uppercase',letterSpacing:1}}>Статистика</div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:6}}>
            {[
              {label:'Всего',value:uniqueDomains.length,c:'#e6edf3'},
              {label:'Очередь',value:events.length,c:events.length>0?'#f85149':'#3fb950'},
              {label:'Одобрено',value:approved,c:'#3fb950'},
              {label:'Блок',value:blocked,c:'#f85149'},
            ].map(s=>(
              <div key={s.label} style={{background:'#0d1117',borderRadius:6,padding:'6px 8px',border:'1px solid #21262d'}}>
                <div style={{fontSize:18,fontWeight:700,color:s.c}}>{s.value}</div>
                <div style={{fontSize:9,color:'#484f58'}}>{s.label}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Zero Trust indicator */}
        <div style={{padding:'10px 16px',borderBottom:'1px solid #21262d'}}>
          <div style={{background:'rgba(248,81,73,0.08)',border:'1px solid rgba(248,81,73,0.2)',borderRadius:6,padding:'8px 10px'}}>
            <div style={{fontSize:10,fontWeight:700,color:'#f85149',marginBottom:2}}>🔒 DEFAULT DENY</div>
            <div style={{fontSize:9,color:'#7d8590'}}>Все неизвестные сайты заблокированы</div>
          </div>
        </div>

        <nav style={{padding:'10px',flex:1}}>
          {tabs.map(tab=>(
            <button key={tab.id}
              style={{display:'flex',alignItems:'center',gap:8,padding:'9px 10px',borderRadius:8,border:'none',background:activeTab===tab.id?'rgba(56,139,253,0.1)':'transparent',color:activeTab===tab.id?'#388bfd':'#7d8590',fontSize:13,cursor:'pointer',width:'100%',textAlign:'left',fontFamily:'inherit',marginBottom:2}}
              onClick={()=>{setActiveTab(tab.id as Tab);if(tab.id==='history')fetchHistory();}}>
              <span>{tab.icon}</span>
              <span style={{flex:1}}>{tab.label}</span>
              {tab.count!=null&&tab.count>0&&(
                <span style={{background:tab.id==='pending'?'#f85149':tab.id==='deferred'?'#f0a84a':'rgba(56,139,253,0.3)',color:'#fff',borderRadius:10,padding:'1px 6px',fontSize:10,fontWeight:700}}>{tab.count}</span>
              )}
            </button>
          ))}
        </nav>

        <div style={{padding:'12px 16px',borderTop:'1px solid #21262d'}}>
          <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:8}}>
            <div style={{width:28,height:28,background:'linear-gradient(135deg,#388bfd,#8957e5)',borderRadius:'50%',display:'flex',alignItems:'center',justifyContent:'center',fontSize:11,fontWeight:700,color:'#fff'}}>{user.email[0].toUpperCase()}</div>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontSize:11,color:'#e6edf3',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{user.email}</div>
              <div style={{fontSize:9,color:'#7d8590'}}>{user.role}</div>
            </div>
          </div>
          <button onClick={onLogout} style={{width:'100%',padding:'6px',background:'transparent',border:'1px solid #30363d',borderRadius:5,color:'#7d8590',fontSize:11,cursor:'pointer',fontFamily:'inherit'}}>Выйти</button>
        </div>
      </div>

      {/* Main content */}
      <div style={{marginLeft:220,flex:1,padding:'24px'}}>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:20}}>
          <div>
            <h1 style={{fontSize:18,fontWeight:700,color:'#fff',marginBottom:2}}>
              {tabs.find(t=>t.id===activeTab)?.icon} {tabs.find(t=>t.id===activeTab)?.label}
            </h1>
            <p style={{fontSize:12,color:'#7d8590'}}>
              {activeTab==='pending'&&`${events.length} запросов ожидают проверки · обновляется каждые 3с`}
              {activeTab==='deferred'&&`${deferred.length} отложенных`}
              {activeTab==='allowlist'&&`${allowlist.length} разрешённых доменов`}
              {activeTab==='blocklist'&&`${blocklist.length} заблокированных доменов`}
              {activeTab==='history'&&`${historyGroups.length} уникальных доменов в истории`}
            </p>
          </div>
          <div style={{display:'flex',alignItems:'center',gap:5,background:'rgba(63,185,80,0.1)',border:'1px solid rgba(63,185,80,0.2)',borderRadius:20,padding:'5px 10px'}}>
            <div style={{width:6,height:6,background:'#3fb950',borderRadius:'50%'}}/>
            <span style={{fontSize:11,color:'#3fb950'}}>Live</span>
          </div>
        </div>

        {notification&&(
          <div style={{background:nc[notification.type]?.bg,border:`1px solid ${nc[notification.type]?.b}`,borderRadius:8,padding:'10px 14px',color:nc[notification.type]?.c,fontSize:13,marginBottom:14,fontWeight:500}}>
            {notification.msg}
          </div>
        )}

        {/* ==================== PENDING ==================== */}
        {activeTab==='pending'&&(
          <div style={{display:'flex',flexDirection:'column',gap:10}}>
            {events.length===0?(
              <div style={{textAlign:'center',padding:'70px 20px'}}>
                <div style={{fontSize:48,marginBottom:12}}>✅</div>
                <h3 style={{color:'#3fb950',marginBottom:6}}>Очередь пуста</h3>
                <p style={{color:'#7d8590',fontSize:13}}>Все запросы обработаны</p>
              </div>
            ):events.map(event=>{
              const url=parseUrl(event.reason);
              const flags=parseFlags(event.reason);
              const color=rc(event.riskScore);
              return(
                <div key={event.id} style={{background:'#161b22',border:`1px solid ${event.riskScore>=70?'rgba(248,81,73,0.4)':event.riskScore>=40?'rgba(240,168,74,0.3)':'rgba(56,139,253,0.3)'}`,borderRadius:12,padding:'16px 18px'}}>
                  <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:10,gap:8}}>
                    <div style={{display:'flex',alignItems:'center',gap:8,flex:1,minWidth:0}}>
                      <span style={{fontSize:16}}>{event.riskScore>=70?'🚨':event.riskScore>=40?'⚠️':'❓'}</span>
                      <span style={{fontSize:15,fontWeight:700,fontFamily:'monospace',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{event.domain}</span>
                    </div>
                    <div style={{display:'flex',alignItems:'center',gap:8,flexShrink:0}}>
                      <LiveTimer startTime={event.createdAt}/>
                      <span style={{background:`${color}20`,border:`1px solid ${color}40`,color,padding:'2px 8px',borderRadius:20,fontSize:11,fontWeight:700}}>
                        {rl(event.riskScore)} {event.riskScore}%
                      </span>
                    </div>
                  </div>

                  {url&&(
                    <div style={{display:'flex',alignItems:'center',gap:7,background:'#0d1117',border:'1px solid #21262d',borderRadius:6,padding:'8px 10px',marginBottom:8}}>
                      <span style={{fontSize:12}}>🔗</span>
                      <span style={{fontSize:11,color:'#7d8590',flex:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{url}</span>
                      <a href={url} target="_blank" rel="noreferrer" style={{fontSize:10,color:'#fff',background:'#388bfd',padding:'2px 8px',borderRadius:4,textDecoration:'none',fontWeight:600,flexShrink:0}}>Открыть →</a>
                    </div>
                  )}

                  <div style={{display:'flex',gap:12,marginBottom:8,flexWrap:'wrap'}}>
                    <span style={{fontSize:11,color:'#7d8590'}}>🏢 {event.companyId}</span>
                    <span style={{fontSize:11,color:'#7d8590'}}>🕐 {fmtTime(event.createdAt)}</span>
                  </div>

                  {flags.length>0&&(
                    <div style={{display:'flex',flexWrap:'wrap',gap:4,marginBottom:12}}>
                      {flags.map((f:string,i:number)=>(
                        <span key={i} style={{background:'rgba(240,168,74,0.08)',border:'1px solid rgba(240,168,74,0.2)',borderRadius:4,padding:'2px 6px',fontSize:10,color:'#f0a84a'}}>{f}</span>
                      ))}
                    </div>
                  )}

                  <div style={{display:'flex',gap:7,flexWrap:'wrap'}}>
                    <button style={{flex:1,minWidth:80,padding:'9px',background:'rgba(63,185,80,0.08)',border:'1px solid rgba(63,185,80,0.3)',borderRadius:7,color:'#3fb950',fontSize:12,fontWeight:600,cursor:'pointer',fontFamily:'inherit'}}
                      onClick={()=>handleDecision(event.id,'approved',false,{isWildcard:false,category:'other'})}
                      disabled={deciding===event.id}>
                      {deciding===event.id?'...':'✅ Одобрить'}
                    </button>
                    <button style={{flex:1,minWidth:80,padding:'9px',background:'rgba(248,81,73,0.08)',border:'1px solid rgba(248,81,73,0.3)',borderRadius:7,color:'#f85149',fontSize:12,fontWeight:600,cursor:'pointer',fontFamily:'inherit'}}
                      onClick={()=>handleDecision(event.id,'blocked',false)}
                      disabled={deciding===event.id}>
                      {deciding===event.id?'...':'🚫 Заблокировать'}
                    </button>
                    <div style={{position:'relative'}}>
                      <button style={{padding:'9px 12px',background:'rgba(240,168,74,0.08)',border:'1px solid rgba(240,168,74,0.3)',borderRadius:7,color:'#f0a84a',fontSize:12,fontWeight:600,cursor:'pointer',fontFamily:'inherit'}}
                        onClick={()=>setShowDeferPicker(showDeferPicker===event.id?null:event.id)}
                        disabled={deciding===event.id}>⏸ Отложить</button>
                      {showDeferPicker===event.id&&(
                        <div style={{position:'absolute',bottom:'calc(100% + 6px)',right:0,background:'#1c2128',border:'1px solid #30363d',borderRadius:8,padding:'8px',zIndex:100,minWidth:160,boxShadow:'0 8px 24px rgba(0,0,0,0.4)'}}>
                          <div style={{fontSize:10,color:'#484f58',marginBottom:6,textTransform:'uppercase',letterSpacing:1}}>Отложить на:</div>
                          {DEFER_OPTIONS.map(min=>(
                            <button key={min}
                              style={{display:'block',width:'100%',padding:'7px 10px',background:'transparent',border:'none',borderRadius:5,color:'#e6edf3',fontSize:12,cursor:'pointer',textAlign:'left',fontFamily:'inherit'}}
                              onMouseEnter={e=>(e.target as HTMLElement).style.background='rgba(56,139,253,0.1)'}
                              onMouseLeave={e=>(e.target as HTMLElement).style.background='transparent'}
                              onClick={()=>handleDefer(event.id,min)}>
                              {min<60?`${min} минут`:`${min/60} час${min===60?'':min===120?'а':'ов'}`}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    <button style={{padding:'9px 10px',background:'rgba(137,87,229,0.08)',border:'1px solid rgba(137,87,229,0.3)',borderRadius:7,color:'#8957e5',fontSize:11,fontWeight:600,cursor:'pointer',fontFamily:'inherit'}}
                      onClick={()=>handleDecision(event.id,'approved',true,{isWildcard:true,category:'other'})}
                      disabled={deciding===event.id} title="Одобрить глобально (для всех компаний)">🌍 Глобально</button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* ==================== DEFERRED ==================== */}
        {activeTab==='deferred'&&(
          <div style={{display:'flex',flexDirection:'column',gap:10}}>
            {deferred.length===0?(
              <div style={{textAlign:'center',padding:'70px 20px'}}>
                <div style={{fontSize:48,marginBottom:12}}>⏸</div>
                <h3 style={{color:'#f0a84a',marginBottom:6}}>Нет отложенных</h3>
              </div>
            ):deferred.map(event=>{
              const url=parseUrl(event.reason);
              return(
                <div key={event.id} style={{background:'#161b22',border:'1px solid rgba(240,168,74,0.3)',borderRadius:12,padding:'16px 18px'}}>
                  <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:10}}>
                    <span>⏸</span>
                    <span style={{fontSize:15,fontWeight:700,fontFamily:'monospace'}}>{event.domain}</span>
                    <span style={{fontSize:11,color:'#f0a84a',marginLeft:'auto'}}>{fmtTime(event.createdAt)}</span>
                  </div>
                  {url&&<div style={{fontSize:11,color:'#484f58',marginBottom:10,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{url}</div>}
                  <div style={{display:'flex',gap:7}}>
                    <button style={{flex:1,padding:'8px',background:'rgba(63,185,80,0.08)',border:'1px solid rgba(63,185,80,0.3)',borderRadius:7,color:'#3fb950',fontSize:12,fontWeight:600,cursor:'pointer',fontFamily:'inherit'}}
                      onClick={()=>handleDecision(event.id,'approved')} disabled={deciding===event.id}>✅ Одобрить</button>
                    <button style={{flex:1,padding:'8px',background:'rgba(248,81,73,0.08)',border:'1px solid rgba(248,81,73,0.3)',borderRadius:7,color:'#f85149',fontSize:12,fontWeight:600,cursor:'pointer',fontFamily:'inherit'}}
                      onClick={()=>handleDecision(event.id,'blocked')} disabled={deciding===event.id}>🚫 Заблокировать</button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* ==================== ALLOWLIST ==================== */}
        {activeTab==='allowlist'&&(
          <div>
            {/* Toolbar */}
            <div style={{display:'flex',gap:10,marginBottom:16,flexWrap:'wrap'}}>
              <input
                placeholder="🔍 Поиск домена..."
                value={allowlistFilter}
                onChange={e=>setAllowlistFilter(e.target.value)}
                style={{flex:1,minWidth:200,padding:'8px 12px',background:'#161b22',border:'1px solid #30363d',borderRadius:7,color:'#e6edf3',fontSize:13,fontFamily:'inherit',outline:'none'}}
              />
              <select
                value={allowlistCategory}
                onChange={e=>setAllowlistCategory(e.target.value)}
                style={{padding:'8px 12px',background:'#161b22',border:'1px solid #30363d',borderRadius:7,color:'#e6edf3',fontSize:13,fontFamily:'inherit',outline:'none'}}>
                <option value="">Все категории</option>
                {CATEGORIES.map(c=><option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}
              </select>
              <button
                onClick={()=>setShowAddForm(!showAddForm)}
                style={{padding:'8px 16px',background:'rgba(63,185,80,0.1)',border:'1px solid rgba(63,185,80,0.3)',borderRadius:7,color:'#3fb950',fontSize:13,fontWeight:600,cursor:'pointer',fontFamily:'inherit'}}>
                + Добавить домен
              </button>
              <button
                onClick={handleExport}
                style={{padding:'8px 14px',background:'rgba(56,139,253,0.1)',border:'1px solid rgba(56,139,253,0.3)',borderRadius:7,color:'#388bfd',fontSize:13,fontWeight:600,cursor:'pointer',fontFamily:'inherit'}}>
                📥 CSV
              </button>
              <select value={allowlistSort} onChange={e=>setAllowlistSort(e.target.value as any)}
                style={{padding:'8px 10px',background:'#161b22',border:'1px solid #30363d',borderRadius:7,color:'#e6edf3',fontSize:12,fontFamily:'inherit',outline:'none'}}>
                <option value="alpha">A→Z</option>
                <option value="newest">Новые</option>
                <option value="oldest">Старые</option>
              </select>
              <select value={allowlistTypeFilter} onChange={e=>setAllowlistTypeFilter(e.target.value as any)}
                style={{padding:'8px 10px',background:'#161b22',border:'1px solid #30363d',borderRadius:7,color:'#e6edf3',fontSize:12,fontFamily:'inherit',outline:'none'}}>
                <option value="">Все типы</option>
                <option value="global">Global</option>
                <option value="org">Org</option>
              </select>
            </div>

            {/* Add form */}
            {showAddForm&&(
              <div style={{background:'#161b22',border:'1px solid rgba(63,185,80,0.3)',borderRadius:10,padding:'16px',marginBottom:16}}>
                <div style={{fontSize:13,fontWeight:600,color:'#3fb950',marginBottom:12}}>✅ Добавить домен в allowlist</div>
                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:10}}>
                  <input placeholder="domain.com" value={addForm.domain} onChange={e=>setAddForm({...addForm,domain:e.target.value})}
                    style={{padding:'8px 12px',background:'#0d1117',border:'1px solid #30363d',borderRadius:6,color:'#e6edf3',fontSize:13,fontFamily:'inherit',outline:'none'}}/>
                  <select value={addForm.category} onChange={e=>setAddForm({...addForm,category:e.target.value})}
                    style={{padding:'8px 12px',background:'#0d1117',border:'1px solid #30363d',borderRadius:6,color:'#e6edf3',fontSize:13,fontFamily:'inherit',outline:'none'}}>
                    {CATEGORIES.map(c=><option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}
                  </select>
                  <input placeholder="Заметка (необязательно)" value={addForm.notes} onChange={e=>setAddForm({...addForm,notes:e.target.value})}
                    style={{padding:'8px 12px',background:'#0d1117',border:'1px solid #30363d',borderRadius:6,color:'#e6edf3',fontSize:13,fontFamily:'inherit',outline:'none',gridColumn:'1/-1'}}/>
                </div>
                <div style={{display:'flex',gap:12,marginBottom:12}}>
                  <label style={{display:'flex',alignItems:'center',gap:6,fontSize:12,color:'#7d8590',cursor:'pointer'}}>
                    <input type="checkbox" checked={addForm.isWildcard} onChange={e=>setAddForm({...addForm,isWildcard:e.target.checked})}/>
                    Wildcard (*.domain.com)
                  </label>
                  <label style={{display:'flex',alignItems:'center',gap:6,fontSize:12,color:'#7d8590',cursor:'pointer'}}>
                    <input type="checkbox" checked={addForm.isGlobal} onChange={e=>setAddForm({...addForm,isGlobal:e.target.checked})}/>
                    Глобально (для всех компаний)
                  </label>
                </div>
                <div style={{display:'flex',gap:8}}>
                  <button onClick={handleAddToAllowlist}
                    style={{padding:'8px 20px',background:'rgba(63,185,80,0.1)',border:'1px solid rgba(63,185,80,0.3)',borderRadius:6,color:'#3fb950',fontSize:13,fontWeight:600,cursor:'pointer',fontFamily:'inherit'}}>
                    ✅ Добавить
                  </button>
                  <button onClick={()=>setShowAddForm(false)}
                    style={{padding:'8px 16px',background:'transparent',border:'1px solid #30363d',borderRadius:6,color:'#7d8590',fontSize:13,cursor:'pointer',fontFamily:'inherit'}}>
                    Отмена
                  </button>
                </div>
              </div>
            )}

            {/* Allowlist by category */}
            {Object.entries(allowlistByCategory).sort().map(([cat, domains]) => (
              <div key={cat} style={{marginBottom:16}}>
                <div style={{fontSize:12,fontWeight:600,color:'#484f58',marginBottom:8,textTransform:'uppercase',letterSpacing:1}}>
                  {CATEGORY_LABELS[cat] || cat} ({(domains as any[]).length})
                </div>
                <div style={{display:'flex',flexDirection:'column',gap:4}}>
                  {(domains as any[]).map((d:any)=>(
                    <div key={d.id} style={{display:'flex',alignItems:'center',gap:10,background:'#161b22',border:'1px solid #21262d',borderRadius:8,padding:'10px 14px'}}>
                      <span style={{fontSize:13,fontFamily:'monospace',color:'#e6edf3',flex:1}}>{d.domain}</span>
                      {d.isWildcard&&<span style={{fontSize:9,background:'rgba(137,87,229,0.1)',border:'1px solid rgba(137,87,229,0.2)',color:'#8957e5',padding:'1px 5px',borderRadius:3}}>wildcard</span>}
                      {d.isGlobal&&<span style={{fontSize:9,background:'rgba(56,139,253,0.1)',border:'1px solid rgba(56,139,253,0.2)',color:'#388bfd',padding:'1px 5px',borderRadius:3}}>global</span>}
                      {d.notes&&<span style={{fontSize:11,color:'#484f58'}}>{d.notes}</span>}
                      <button onClick={()=>{setEditEntry(d);setEditForm({category:d.category||'other',notes:d.notes||'',isWildcard:d.isWildcard||false});}}
                        style={{padding:'3px 8px',background:'rgba(56,139,253,0.06)',border:'1px solid rgba(56,139,253,0.2)',borderRadius:4,color:'#388bfd',fontSize:10,cursor:'pointer',fontFamily:'inherit',flexShrink:0}}>
                        ✏️
                      </button>
                    <button onClick={()=>handleRemoveFromAllowlist(d.domain)}
                        style={{padding:'3px 8px',background:'rgba(248,81,73,0.06)',border:'1px solid rgba(248,81,73,0.2)',borderRadius:4,color:'#f85149',fontSize:10,cursor:'pointer',fontFamily:'inherit',flexShrink:0}}>
                        🗑
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ))}

            {filteredAllowlist.length===0&&(
              <div style={{textAlign:'center',padding:'60px 20px'}}>
                <div style={{fontSize:44,marginBottom:12}}>✅</div>
                <p style={{color:'#7d8590',fontSize:13}}>Нет доменов по фильтру</p>
              </div>
            )}

            {/* Recently Approved */}
            {recentlyApproved.length>0&&(
              <div style={{marginTop:24}}>
                <div style={{fontSize:12,fontWeight:600,color:'#3fb950',marginBottom:8,textTransform:'uppercase',letterSpacing:1}}>
                  ✅ Недавно одобренные (в этой сессии)
                </div>
                {recentlyApproved.map((r:any,i:number)=>(
                  <div key={i} style={{display:'flex',alignItems:'center',gap:10,background:'rgba(63,185,80,0.05)',border:'1px solid rgba(63,185,80,0.15)',borderRadius:8,padding:'8px 14px',marginBottom:4}}>
                    <span style={{fontSize:13,fontFamily:'monospace',color:'#3fb950',flex:1}}>{r.domain}</span>
                    <span style={{fontSize:10,color:'#484f58'}}>⏱ {r.responseTime}с</span>
                    {r.isGlobal&&<span style={{fontSize:9,background:'rgba(56,139,253,0.1)',border:'1px solid rgba(56,139,253,0.2)',color:'#388bfd',padding:'1px 5px',borderRadius:3}}>global</span>}
                    <span style={{fontSize:10,color:'#484f58'}}>{new Date(r.approvedAt).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'})}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Edit Modal */}
            {editEntry&&(
              <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.7)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:1000}}>
                <div style={{background:'#161b22',border:'1px solid #30363d',borderRadius:12,padding:'24px',width:400,maxWidth:'90vw'}}>
                  <div style={{fontSize:15,fontWeight:700,color:'#e6edf3',marginBottom:4}}>✏️ Редактировать домен</div>
                  <div style={{fontSize:12,color:'#7d8590',marginBottom:16,fontFamily:'monospace'}}>{editEntry.domain}</div>
                  <select value={editForm.category} onChange={e=>setEditForm({...editForm,category:e.target.value})}
                    style={{width:'100%',padding:'8px 12px',background:'#0d1117',border:'1px solid #30363d',borderRadius:6,color:'#e6edf3',fontSize:13,fontFamily:'inherit',outline:'none',marginBottom:10}}>
                    {CATEGORIES.map(c=><option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}
                  </select>
                  <input placeholder="Заметка" value={editForm.notes} onChange={e=>setEditForm({...editForm,notes:e.target.value})}
                    style={{width:'100%',padding:'8px 12px',background:'#0d1117',border:'1px solid #30363d',borderRadius:6,color:'#e6edf3',fontSize:13,fontFamily:'inherit',outline:'none',marginBottom:10}}/>
                  <label style={{display:'flex',alignItems:'center',gap:8,fontSize:12,color:'#7d8590',marginBottom:16,cursor:'pointer'}}>
                    <input type="checkbox" checked={editForm.isWildcard} onChange={e=>setEditForm({...editForm,isWildcard:e.target.checked})}/>
                    Wildcard (*.{editEntry.domain})
                  </label>
                  <div style={{display:'flex',gap:8}}>
                    <button onClick={handleEditSave}
                      style={{flex:1,padding:'9px',background:'rgba(63,185,80,0.1)',border:'1px solid rgba(63,185,80,0.3)',borderRadius:6,color:'#3fb950',fontSize:13,fontWeight:600,cursor:'pointer',fontFamily:'inherit'}}>
                      💾 Сохранить
                    </button>
                    <button onClick={()=>setEditEntry(null)}
                      style={{padding:'9px 16px',background:'transparent',border:'1px solid #30363d',borderRadius:6,color:'#7d8590',fontSize:13,cursor:'pointer',fontFamily:'inherit'}}>
                      Отмена
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ==================== BLOCKLIST ==================== */}
        {activeTab==='blocklist'&&(
          <div>
            {/* Поиск */}
            <div style={{display:'flex',gap:10,marginBottom:16}}>
              <input
                placeholder="🔍 Поиск домена..."
                value={blocklistFilter}
                onChange={e=>setBlocklistFilter(e.target.value)}
                style={{flex:1,padding:'8px 12px',background:'#161b22',border:'1px solid #30363d',borderRadius:7,color:'#e6edf3',fontSize:13,fontFamily:'inherit',outline:'none'}}
              />
              {blocklistFilter&&(
                <button onClick={()=>setBlocklistFilter('')}
                  style={{padding:'8px 12px',background:'transparent',border:'1px solid #30363d',borderRadius:7,color:'#7d8590',fontSize:13,cursor:'pointer',fontFamily:'inherit'}}>
                  ✕ Сбросить
                </button>
              )}
            </div>

            {/* Список */}
            <div style={{display:'flex',flexDirection:'column',gap:6}}>
              {filteredBlocklist.length===0?(
                <div style={{textAlign:'center',padding:'60px 20px'}}>
                  <div style={{fontSize:44,marginBottom:12}}>🚫</div>
                  <p style={{color:'#7d8590',fontSize:13}}>
                    {blocklistFilter ? `Ничего не найдено по "${blocklistFilter}"` : 'Список блокировок пуст'}
                  </p>
                </div>
              ):filteredBlocklist.map((d:any)=>(
                <div key={d.id} style={{display:'flex',alignItems:'center',gap:10,background:'#161b22',border:'1px solid rgba(248,81,73,0.15)',borderRadius:8,padding:'10px 14px'}}>
                  <span style={{fontSize:14,flexShrink:0}}>🚫</span>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:13,fontFamily:'monospace',color:'#e6edf3',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{d.domain}</div>
                    {d.reason&&<div style={{fontSize:10,color:'#484f58',marginTop:2,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{d.reason}</div>}
                  </div>
                  {d.isGlobal&&(
                    <span style={{fontSize:9,background:'rgba(248,81,73,0.1)',border:'1px solid rgba(248,81,73,0.2)',color:'#f85149',padding:'1px 5px',borderRadius:3,flexShrink:0}}>global</span>
                  )}
                  <span style={{fontSize:10,color:'#484f58',flexShrink:0}}>{fmtTime(d.createdAt)}</span>
                  <button
                    onClick={()=>handleRemoveFromAllowlist(d.domain)}
                    title="Разблокировать домен"
                    style={{padding:'5px 10px',background:'rgba(63,185,80,0.06)',border:'1px solid rgba(63,185,80,0.2)',borderRadius:5,color:'#3fb950',fontSize:11,fontWeight:600,cursor:'pointer',fontFamily:'inherit',flexShrink:0,whiteSpace:'nowrap'}}>
                    ↩️ Разблокировать
                  </button>
                  <button
                    onClick={()=>{if(window.confirm(`Удалить ${d.domain} из blocklist?`))handleRemoveFromAllowlist(d.domain);}}
                    title="Удалить из blocklist"
                    style={{padding:'5px 8px',background:'rgba(248,81,73,0.06)',border:'1px solid rgba(248,81,73,0.2)',borderRadius:5,color:'#f85149',fontSize:11,cursor:'pointer',fontFamily:'inherit',flexShrink:0}}>
                    🗑
                  </button>
                </div>
              ))}
            </div>

            {/* Счётчик */}
            {blocklistFilter&&filteredBlocklist.length>0&&(
              <div style={{marginTop:10,fontSize:11,color:'#484f58',textAlign:'center'}}>
                Найдено: {filteredBlocklist.length} из {blocklist.length}
              </div>
            )}
          </div>
        )}

        {/* ==================== HISTORY ==================== */}
        {activeTab==='history'&&(
          <div style={{display:'flex',flexDirection:'column',gap:8}}>
            {historyGroups.length===0?(
              <div style={{textAlign:'center',padding:'60px 20px'}}>
                <div style={{fontSize:44,marginBottom:12}}>📋</div>
                <p style={{color:'#7d8590',fontSize:13}}>История пуста</p>
              </div>
            ):historyGroups.map((group:any)=>{
              const latest=group.latest;
              const isExp=expanded===group.domain;
              const rt=parseRt(latest.reason);
              return(
                <div key={group.domain} style={{background:'#161b22',border:'1px solid #21262d',borderRadius:10,overflow:'hidden'}}>
                  <div style={{display:'flex',alignItems:'center',gap:10,padding:'12px 16px',cursor:'pointer'}} onClick={()=>setExpanded(isExp?null:group.domain)}>
                    <div style={{fontSize:16,flexShrink:0}}>{latest.action==='approved'?'✅':'🚫'}</div>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:13,fontFamily:'monospace',color:'#e6edf3',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{group.domain}</div>
                      <div style={{fontSize:10,color:'#484f58',marginTop:1}}>{group.actions.length} действий · {fmtTime(latest.createdAt)}</div>
                    </div>
                    {rt!=null&&<div style={{fontSize:10,color:rt<30?'#3fb950':rt<120?'#f0a84a':'#f85149',fontFamily:'monospace',background:'#0d1117',padding:'2px 6px',borderRadius:4,border:'1px solid #21262d',flexShrink:0}}>⏱ {rt<60?`${rt}с`:`${Math.floor(rt/60)}м`}</div>}
                    <div style={{fontSize:11,fontWeight:600,color:latest.action==='approved'?'#3fb950':'#f85149',flexShrink:0}}>{latest.action==='approved'?'Одобрен':'Заблокирован'}</div>
                    <span style={{color:'#484f58',fontSize:11}}>{isExp?'▲':'▼'}</span>
                  </div>
                  {isExp&&(
                    <div style={{borderTop:'1px solid #21262d',padding:'10px 16px',background:'#0d1117'}}>
                      {group.actions.map((action:any,i:number)=>{
                        const art=parseRt(action.reason);
                        return(
                          <div key={action.id} style={{display:'flex',alignItems:'center',gap:8,padding:'6px 0',borderBottom:i<group.actions.length-1?'1px solid #21262d':'none'}}>
                            <span style={{fontSize:13}}>{action.action==='approved'?'✅':'🚫'}</span>
                            <span style={{fontSize:11,color:action.action==='approved'?'#3fb950':'#f85149',fontWeight:600}}>{action.action==='approved'?'Одобрен':'Заблокирован'}</span>
                            {art!=null&&<span style={{fontSize:10,color:'#7d8590',fontFamily:'monospace'}}>за {art<60?`${art}с`:`${Math.floor(art/60)}м ${art%60}с`}</span>}
                            <span style={{flex:1}}/>
                            <span style={{fontSize:10,color:'#484f58'}}>{fmtTime(action.createdAt)}</span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
