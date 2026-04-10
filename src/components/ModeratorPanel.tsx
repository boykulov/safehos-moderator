import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  getPendingEvents, getDeferredEvents, makeDecision, deferEvent,
  getHistory, getAllowlist, getBlocklist, addToAllowlist, removeFromList,
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
  return <span style={{ fontFamily: 'monospace', fontSize: 12, color, fontWeight: 700 }}>{m}:{s.toString().padStart(2,'0')}</span>;
}

type Tab = 'pending' | 'deferred' | 'history' | 'allowlist' | 'blocklist';

const CATEGORY_LABELS: Record<string, string> = {
  other: 'Other', loadboard: 'Load Board', factoring: 'Factoring', broker: 'Broker',
  carrier: 'Carrier', maps: 'Maps', email: 'Email',
  eld: 'ELD', tms: 'TMS', document: 'Documents',
  support: 'Support', auth: 'Auth', cdn: 'CDN',
};

const CATEGORY_ICONS: Record<string, string> = {
  other: '\u{1F527}', loadboard: '\u{1F69B}', factoring: '\u{1F4B0}', broker: '\u{1F3E2}',
  carrier: '\u{1F69A}', maps: '\u{1F5FA}', email: '\u{1F4E7}',
  eld: '\u{1F4E1}', tms: '\u{1F4BB}', document: '\u{1F4C4}',
  support: '\u{1F3A7}', auth: '\u{1F510}', cdn: '\u{2601}\u{FE0F}',
};

const CATEGORIES = Object.keys(CATEGORY_LABELS);

function getRootDomain(domain: string): string {
  const parts = domain.split('.');
  const twoPartTLDs = ['co.uk','com.ua','org.uk','net.uk','me.uk','com.au','net.au'];
  if (parts.length >= 3) {
    const possibleTLD = parts.slice(-2).join('.');
    if (twoPartTLDs.includes(possibleTLD)) {
      return parts.slice(-3).join('.');
    }
  }
  return parts.slice(-2).join('.');
}

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
  const [allowlistSort, setAllowlistSort] = useState<'alpha'|'newest'|'oldest'>('newest');
  const [allowlistRecent, setAllowlistRecent] = useState<''|'24h'|'7d'>('');
  const [allowlistTypeFilter, setAllowlistTypeFilter] = useState<''|'global'|'org'>('');
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [blocklistFilter, setBlocklistFilter] = useState('');
  const [importing, setImporting] = useState(false);
  const knownIds = useRef<Set<string>>(new Set());
  const notifTimer = useRef<any>(null);

  const toggleGroup = (key: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

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
        showNotif(`Новый запрос: ${trulyNew[0].domain}`, 'warning');
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

  const handleWildcardDecision = async (
    eventId: string, domain: string, action: 'approved'|'blocked', isGlobal: boolean
  ) => {
    const rootDomain = getRootDomain(domain);
    const isSubdomain = rootDomain !== domain;
    setDeciding(eventId);
    knownIds.current.delete(eventId);
    try {
      const ev = events.find(e => e.id === eventId) || deferred.find(e => e.id === eventId);
      const rt = ev ? Math.floor((Date.now() - new Date(ev.createdAt).getTime()) / 1000) : 0;

      if (isSubdomain) {
        try {
          await addToAllowlist({
            domain: rootDomain, isGlobal, isWildcard: true,
            category: 'other',
            notes: `Wildcard approved from queue (${domain})`
          });
        } catch(e: any) {
          console.log('addToAllowlist conflict:', e?.response?.data?.message);
        }

        const pending = await getPendingEvents('');
        const allSubEvents = pending.data.filter((e: any) =>
          getRootDomain(e.domain) === rootDomain
        );
        for (const sub of allSubEvents) {
          try {
            await makeDecision(sub.id, 'approved',
              `Auto wildcard *.${rootDomain}`, isGlobal,
              {isWildcard: false, category: 'other'}
            );
          } catch(e) {}
        }
        showNotif(`*.${rootDomain} — ${allSubEvents.length} доменов закрыто`, 'success');
      } else {
        await makeDecision(eventId, action,
          `Wildcard root response: ${rt}s`, isGlobal,
          {isWildcard: true, category: 'other'}
        );
        showNotif(`*.${rootDomain} одобрен (wildcard)`, 'success');
      }

      playSound(1047);
      fetchPending(); fetchDeferred(); fetchHistory(); fetchAllowlist();     } catch(e: any) {
      showNotif('Ошибка wildcard: ' + (e?.response?.data?.message || e?.message || ''), 'error');
    }
    finally { setDeciding(null); }
  };

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
      const wildcardInfo = options?.isWildcard ? ` (wildcard *.${ev?.domain})` : '';
      showNotif(action === 'approved' ? `Одобрен за ${rt}с${wildcardInfo}` : `Заблокирован за ${rt}с`, action === 'approved' ? 'success' : 'error');
      fetchPending(); fetchDeferred(); fetchHistory(); fetchAllowlist(); fetchBlocklist();     } catch(e) { showNotif('Ошибка', 'error'); }
    finally { setDeciding(null); }
  };

  const handleDefer = async (eventId: string, minutes: number) => {
    setDeciding(eventId);
    try {
      await deferEvent(eventId, minutes);
      setShowDeferPicker(null);
      showNotif(`Отложено на ${minutes} минут`, 'info');
      fetchPending(); fetchDeferred();
    } catch(e) { showNotif('Ошибка', 'error'); }
    finally { setDeciding(null); }
  };

  const handleImportCSV = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const resp = await api.post('/domain/allowlist/import', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      const { imported, skipped, errors, total } = resp.data;
      showNotif(`Импорт: ${imported} добавлено, ${skipped} пропущено из ${total}`, 'success');
      if (errors.length) console.warn('Import errors:', errors);
      fetchAllowlist();
    } catch(e: any) {
      showNotif('Ошибка импорта: ' + (e?.response?.data?.message || e.message), 'error');
    } finally {
      setImporting(false);
      e.target.value = '';
    }
  };

  const handleAddToAllowlist = async () => {
    if (!addForm.domain) return;
    try {
      await addToAllowlist(addForm);
      showNotif(`${addForm.domain} добавлен в allowlist`, 'success');
      setAddForm({ domain:'', isGlobal:false, isWildcard:true, category:'other', notes:'' });
      setShowAddForm(false);
      fetchAllowlist();
    } catch(e: any) {
      const msg = e?.response?.data?.message || e?.message || 'Ошибка добавления';
      showNotif(msg, 'error');
    }
  };

  const handleRemoveFromAllowlist = async (domain: string) => {
    try {
      await removeFromList(domain);
      showNotif(`${domain} удален`, 'info');
      fetchAllowlist(); fetchBlocklist();
    } catch(e) { showNotif('Ошибка удаления', 'error'); }
  };

  const handleUnblock = async (domain: string) => {
    try {
      await removeFromList(domain);
      await addToAllowlist({ domain, isGlobal: false, isWildcard: true, category: 'other', notes: 'Unblocked from blocklist' });
      showNotif(`${domain} разблокирован и добавлен в allowlist`, 'success');
      fetchAllowlist(); fetchBlocklist();
    } catch(e: any) {
      const msg = e?.response?.data?.message || e?.message || 'Ошибка';
      showNotif(msg, 'error');
    }
  };

  const handleEditSave = async () => {
    if (!editEntry) return;
    try {
      const res = await updateAllowlistEntry(editEntry.id, editForm);
      const closed = res.data?.closedSubdomains || 0;
      if (closed > 0) {
        showNotif(`${editEntry.domain} обновлен — ${closed} subdomain(s) auto-approved`, 'success');
        fetchPending(); fetchDeferred();
      } else {
        showNotif(`${editEntry.domain} обновлен`, 'success');
      }
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
      showNotif('CSV экспортирован', 'success');
    } catch(e) { showNotif('Ошибка экспорта', 'error'); }
  };

  const rc = (s: number) => s >= 70 ? '#f85149' : s >= 40 ? '#f0a84a' : '#388bfd';
  const rl = (s: number) => s >= 70 ? 'Высокий' : s >= 40 ? 'Средний' : 'Неизвестный';
  const riskClass = (s: number) => s >= 70 ? 'risk-high' : s >= 40 ? 'risk-medium' : 'risk-low';
  const fmtTime = (d: string) => new Date(d).toLocaleString('ru-RU', {day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});
  const parseUrl = (r: string) => { const m = r?.match(/URL: ([^\s|]+)/); return m?m[1]:null; };
  const parseFlags = (r: string) => { const m = r?.match(/Flags: (.+?)(\s*\|.*)?$/); return m?m[1].split(', ').filter(Boolean):[]; };
  const parseRt = (r: string) => { const m = r?.match(/Response time: (\d+)s/); return m?parseInt(m[1]):null; };

  const nc: Record<string,any> = {
    info: {bg:'rgba(56,139,253,0.15)',b:'rgba(56,139,253,0.4)',c:'#58a6ff'},
    success: {bg:'rgba(63,185,80,0.15)',b:'rgba(63,185,80,0.4)',c:'#3fb950'},
    error: {bg:'rgba(248,81,73,0.15)',b:'rgba(248,81,73,0.4)',c:'#f85149'},
    warning: {bg:'rgba(240,168,74,0.15)',b:'rgba(240,168,74,0.4)',c:'#f0a84a'},
  };

  const statsTotal = allowlist.length + blocklist.length;
  const statsApproved = allowlist.length;
  const statsBlocked = blocklist.length;

  const groupedHistory = history.reduce((acc: Record<string,any>, item: any) => {
    if (!acc[item.domain]) acc[item.domain] = { domain: item.domain, actions: [], latest: item };
    if (new Date(item.createdAt) > new Date(acc[item.domain].latest.createdAt)) acc[item.domain].latest = item;
    acc[item.domain].actions = [...acc[item.domain].actions, item].sort((a,b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return acc;
  }, {});
  const historyGroups = Object.values(groupedHistory) as any[];

  const filteredAllowlist = allowlist
    .filter(d => {
      const matchSearch = !allowlistFilter ||
        d.domain.toLowerCase().includes(allowlistFilter.toLowerCase()) ||
        (d.notes || '').toLowerCase().includes(allowlistFilter.toLowerCase());
      const matchCategory = !allowlistCategory || d.category === allowlistCategory;
      const matchType = !allowlistTypeFilter ||
        (allowlistTypeFilter === 'global' ? d.isGlobal === true : d.isGlobal === false);
      let matchRecent = true;
      if (allowlistRecent) {
        const age = Date.now() - new Date(d.createdAt).getTime();
        const limit = allowlistRecent === '24h' ? 24*60*60*1000 : 7*24*60*60*1000;
        matchRecent = age <= limit;
      }
      return matchSearch && matchCategory && matchType && matchRecent;
    })
    .sort((a, b) => {
      if (allowlistSort === 'alpha') return a.domain.localeCompare(b.domain);
      if (allowlistSort === 'newest') return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      if (allowlistSort === 'oldest') return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      return 0;
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
    { id: 'pending', icon: '\u{1F50D}', label: 'Очередь', count: events.length },
    { id: 'deferred', icon: '\u{23F8}', label: 'Отложенные', count: deferred.length },
    { id: 'allowlist', icon: '\u{2705}', label: 'Allowlist', count: allowlist.length },
    { id: 'blocklist', icon: '\u{1F6AB}', label: 'Blocklist', count: blocklist.length },
    { id: 'history', icon: '\u{1F4CB}', label: 'История', count: null },
  ];

  const DEFER_OPTIONS = [15, 30, 60, 120, 240];

  return (
    <div style={{display:'flex',minHeight:'100vh',background:'#0d1117',fontFamily:'-apple-system,BlinkMacSystemFont,Inter,sans-serif',color:'#e6edf3'}}>
      {/* Sidebar */}
      <div className="sidebar">
        <div style={{display:'flex',alignItems:'center',gap:12,padding:'0 18px 18px',borderBottom:'1px solid #21262d'}}>
          <div style={{fontSize:22,background:'linear-gradient(135deg,#388bfd,#8957e5)',borderRadius:10,width:40,height:40,display:'flex',alignItems:'center',justifyContent:'center',boxShadow:'0 4px 12px rgba(56,139,253,0.25)'}}>
            {'\u{1F6E1}\u{FE0F}'}
          </div>
          <div className="sidebar-logo-text">
            <div style={{fontSize:16,fontWeight:800,color:'#fff',letterSpacing:'-0.3px'}}>SafeHos</div>
            <div style={{fontSize:10,color:'#484f58',fontWeight:500}}>Moderator Panel</div>
          </div>
        </div>

        <div className="sidebar-stats" style={{padding:'14px 18px',borderBottom:'1px solid #21262d'}}>
          <div style={{fontSize:10,color:'#484f58',marginBottom:10,textTransform:'uppercase',letterSpacing:1.2,fontWeight:600}}>Статистика</div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
            {[
              {label:'Всего',value:statsTotal,c:'#e6edf3'},
              {label:'Очередь',value:events.length,c:events.length>0?'#f85149':'#3fb950'},
              {label:'Одобрено',value:statsApproved,c:'#3fb950'},
              {label:'Заблок.',value:statsBlocked,c:'#f85149'},
            ].map(s=>(
              <div key={s.label} className="stat-card">
                <div style={{fontSize:20,fontWeight:800,color:s.c,lineHeight:1.2}}>{s.value}</div>
                <div style={{fontSize:9,color:'#484f58',fontWeight:500,marginTop:2}}>{s.label}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="sidebar-zero-trust" style={{padding:'12px 18px',borderBottom:'1px solid #21262d'}}>
          <div className="zero-trust-badge">
            <div style={{fontSize:10,fontWeight:800,color:'#f85149',letterSpacing:0.5}}>DEFAULT DENY</div>
            <div style={{fontSize:9,color:'#7d8590',marginTop:2}}>Неизвестные сайты заблокированы</div>
          </div>
        </div>

        <nav style={{padding:'10px 12px',flex:1}}>
          {tabs.map(tab=>(
            <button key={tab.id}
              className={`sidebar-tab ${activeTab===tab.id?'active':''}`}
              onClick={()=>{setActiveTab(tab.id as Tab);if(tab.id==='history')fetchHistory();}}>
              <span style={{fontSize:15}}>{tab.icon}</span>
              <span className="sidebar-tab-label" style={{flex:1}}>{tab.label}</span>
              {tab.count!=null&&tab.count>0&&(
                <span className={`badge ${tab.id==='pending'?'badge-danger badge-pulse':tab.id==='deferred'?'badge-warning':'badge-info'}`}>
                  {tab.count}
                </span>
              )}
            </button>
          ))}
        </nav>

        <div style={{padding:'14px 18px',borderTop:'1px solid #21262d'}}>
          <div className="sidebar-user-info" style={{display:'flex',alignItems:'center',gap:10,marginBottom:10}}>
            <div style={{width:32,height:32,background:'linear-gradient(135deg,#388bfd,#8957e5)',borderRadius:'50%',display:'flex',alignItems:'center',justifyContent:'center',fontSize:12,fontWeight:700,color:'#fff',flexShrink:0}}>{user.email[0].toUpperCase()}</div>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontSize:12,color:'#e6edf3',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',fontWeight:500}}>{user.email}</div>
              <div style={{fontSize:10,color:'#7d8590'}}>{user.role}</div>
            </div>
          </div>
          <button className="btn btn-ghost sidebar-logout" onClick={onLogout} style={{width:'100%',padding:'7px',borderRadius:6,fontSize:11}}>
            Выйти
          </button>
        </div>
      </div>

      {/* Main content */}
      <div className="main-content" style={{marginLeft:240,flex:1,padding:'28px 32px'}}>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:24}}>
          <div>
            <h1 style={{fontSize:20,fontWeight:800,color:'#fff',marginBottom:4,letterSpacing:'-0.3px'}}>
              {tabs.find(t=>t.id===activeTab)?.icon} {tabs.find(t=>t.id===activeTab)?.label}
            </h1>
            <p style={{fontSize:13,color:'#7d8590'}}>
              {activeTab==='pending'&&`${events.length} запросов ожидают проверки`}
              {activeTab==='deferred'&&`${deferred.length} отложенных`}
              {activeTab==='allowlist'&&`${allowlist.length} разрешенных доменов`}
              {activeTab==='blocklist'&&`${blocklist.length} заблокированных доменов`}
              {activeTab==='history'&&`${historyGroups.length} уникальных доменов`}
            </p>
          </div>
          <div style={{display:'flex',alignItems:'center',gap:6,background:'rgba(63,185,80,0.1)',border:'1px solid rgba(63,185,80,0.2)',borderRadius:20,padding:'6px 12px'}}>
            <div className="live-dot"/>
            <span style={{fontSize:11,color:'#3fb950',fontWeight:600}}>Live</span>
          </div>
        </div>

        {/* Notification Toast */}
        {notification&&(
          <div className="notification-toast" style={{
            background: nc[notification.type]?.bg,
            border: `1px solid ${nc[notification.type]?.b}`,
            color: nc[notification.type]?.c,
          }}>
            {notification.msg}
          </div>
        )}

        {/* ==================== PENDING ==================== */}
        {activeTab==='pending'&&(
          <div style={{display:'flex',flexDirection:'column',gap:12}}>
            {events.length===0?(
              <div className="empty-state">
                <span className="empty-state-icon">{'\u{2705}'}</span>
                <h3 style={{color:'#3fb950',marginBottom:8,fontSize:18,fontWeight:700}}>Очередь пуста</h3>
                <p style={{color:'#7d8590',fontSize:13}}>Все запросы обработаны</p>
              </div>
            ):events.map(event=>{
              const url=parseUrl(event.reason);
              const flags=parseFlags(event.reason);
              const color=rc(event.riskScore);
              return(
                <div key={event.id} className={`card-pending ${riskClass(event.riskScore)}`}
                  style={{background:'#161b22',borderRadius:12,padding:'18px 20px'}}>
                  <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:12,gap:10}}>
                    <div style={{display:'flex',alignItems:'center',gap:10,flex:1,minWidth:0}}>
                      <span style={{fontSize:18}}>{event.riskScore>=70?'\u{1F6A8}':event.riskScore>=40?'\u{26A0}\u{FE0F}':'\u{2753}'}</span>
                      <span style={{fontSize:15,fontWeight:700,fontFamily:'monospace',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{event.domain}</span>
                    </div>
                    <div style={{display:'flex',alignItems:'center',gap:10,flexShrink:0}}>
                      <LiveTimer startTime={event.createdAt}/>
                      <span style={{background:`${color}18`,border:`1px solid ${color}40`,color,padding:'3px 10px',borderRadius:20,fontSize:11,fontWeight:700}}>
                        {rl(event.riskScore)} {event.riskScore}%
                      </span>
                    </div>
                  </div>

                  {url&&(
                    <div className="url-box" style={{marginBottom:10}}>
                      <span style={{fontSize:12,flexShrink:0}}>{'\u{1F517}'}</span>
                      <span style={{fontSize:11,color:'#7d8590',flex:1,minWidth:0,wordBreak:'break-all',lineHeight:1.4}}>{url}</span>
                      <a href={url} target="_blank" rel="noreferrer" className="url-link" style={{flexShrink:0}}>Открыть</a>
                    </div>
                  )}

                  <div style={{display:'flex',gap:14,marginBottom:10,flexWrap:'wrap'}}>
                    {event.requestedBy&&<span style={{fontSize:11,color:'#58a6ff',fontWeight:500}}>{'\u{1F464}'} {event.requestedBy}</span>}
                    <span style={{fontSize:11,color:'#7d8590'}}>{'\u{1F3E2}'} {event.companyId}</span>
                    <span style={{fontSize:11,color:'#7d8590'}}>{'\u{1F550}'} {fmtTime(event.createdAt)}</span>
                  </div>

                  {flags.length>0&&(
                    <div style={{display:'flex',flexWrap:'wrap',gap:5,marginBottom:14}}>
                      {flags.map((f:string,i:number)=>(
                        <span key={i} className="tag tag-flag">{f}</span>
                      ))}
                    </div>
                  )}

                  <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
                    <button className="btn btn-approve"
                      style={{flex:1,minWidth:80,padding:'10px',borderRadius:8,fontSize:12,fontWeight:600}}
                      onClick={()=>handleDecision(event.id,'approved',false,{isWildcard:false,category:'other'})}
                      disabled={deciding===event.id}>
                      {deciding===event.id?'...':'Одобрить'}
                    </button>

                    {(()=>{
                      const rootDomain = getRootDomain(event.domain);
                      const isSubdomain = rootDomain !== event.domain;
                      return (
                        <button className="btn btn-wildcard"
                          style={{flex:1,minWidth:80,padding:'10px',borderRadius:8,fontSize:12,fontWeight:600,display:'flex',alignItems:'center',justifyContent:'center',gap:4,flexDirection:'column'}}
                          onClick={()=>handleWildcardDecision(event.id, event.domain, 'approved', false)}
                          disabled={deciding===event.id}
                          title={`Одобрить *.${rootDomain} (все поддомены)`}>
                          {deciding===event.id?'...':<>
                            <span style={{fontSize:11}}>*.{rootDomain}</span>
                            {isSubdomain&&<span style={{fontSize:9,opacity:0.7}}>wildcard</span>}
                          </>}
                        </button>
                      );
                    })()}

                    <button className="btn btn-block"
                      style={{flex:1,minWidth:80,padding:'10px',borderRadius:8,fontSize:12,fontWeight:600}}
                      onClick={()=>handleDecision(event.id,'blocked',false)}
                      disabled={deciding===event.id}>
                      {deciding===event.id?'...':'Заблокировать'}
                    </button>

                    <div style={{position:'relative'}}>
                      <button className="btn btn-defer"
                        style={{padding:'10px 14px',borderRadius:8,fontSize:12,fontWeight:600}}
                        onClick={()=>setShowDeferPicker(showDeferPicker===event.id?null:event.id)}
                        disabled={deciding===event.id}>
                        Отложить
                      </button>
                      {showDeferPicker===event.id&&(
                        <div className="defer-dropdown">
                          <div style={{fontSize:10,color:'#484f58',marginBottom:6,textTransform:'uppercase',letterSpacing:1,fontWeight:600}}>Отложить на:</div>
                          {DEFER_OPTIONS.map(min=>(
                            <button key={min} className="defer-option" onClick={()=>handleDefer(event.id,min)}>
                              {min<60?`${min} минут`:`${min/60} час${min===60?'':min===120?'а':'ов'}`}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    <button className="btn btn-global"
                      style={{padding:'10px 12px',borderRadius:8,fontSize:11,fontWeight:600}}
                      onClick={()=>handleDecision(event.id,'approved',true,{isWildcard:true,category:'other'})}
                      disabled={deciding===event.id} title="Одобрить глобально (для всех компаний)">
                      {'\u{1F30D}'} Global
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* ==================== DEFERRED ==================== */}
        {activeTab==='deferred'&&(
          <div style={{display:'flex',flexDirection:'column',gap:12}}>
            {deferred.length===0?(
              <div className="empty-state">
                <span className="empty-state-icon">{'\u{23F8}'}</span>
                <h3 style={{color:'#f0a84a',marginBottom:8,fontSize:18,fontWeight:700}}>Нет отложенных</h3>
              </div>
            ):deferred.map(event=>{
              const url=parseUrl(event.reason);
              return(
                <div key={event.id} className="card" style={{border:'1px solid rgba(240,168,74,0.3)',padding:'18px 20px'}}>
                  <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:12}}>
                    <span style={{fontSize:16}}>{'\u{23F8}'}</span>
                    <span style={{fontSize:15,fontWeight:700,fontFamily:'monospace',flex:1}}>{event.domain}</span>
                    <span style={{fontSize:11,color:'#f0a84a'}}>{fmtTime(event.createdAt)}</span>
                  </div>
                  {url&&<div style={{fontSize:11,color:'#484f58',marginBottom:12,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{url}</div>}
                  <div style={{display:'flex',gap:8}}>
                    <button className="btn btn-approve"
                      style={{flex:1,padding:'10px',borderRadius:8,fontSize:12,fontWeight:600}}
                      onClick={()=>handleDecision(event.id,'approved')} disabled={deciding===event.id}>
                      Одобрить
                    </button>
                    <button className="btn btn-block"
                      style={{flex:1,padding:'10px',borderRadius:8,fontSize:12,fontWeight:600}}
                      onClick={()=>handleDecision(event.id,'blocked')} disabled={deciding===event.id}>
                      Заблокировать
                    </button>
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
            <div className="toolbar">
              <input className="input" placeholder="Поиск домена..." value={allowlistFilter} onChange={e=>setAllowlistFilter(e.target.value)}
                style={{flex:1,minWidth:200}} />
              <select className="select" value={allowlistCategory} onChange={e=>setAllowlistCategory(e.target.value)}>
                <option value="">Все категории</option>
                {CATEGORIES.map(c=><option key={c} value={c}>{CATEGORY_ICONS[c]} {CATEGORY_LABELS[c]}</option>)}
              </select>
              <button className="btn btn-approve" style={{padding:'9px 18px',borderRadius:8,fontSize:13,fontWeight:600}} onClick={()=>setShowAddForm(!showAddForm)}>
                + Добавить
              </button>
              <button className="btn btn-primary" style={{padding:'9px 16px',borderRadius:8,fontSize:13,fontWeight:600}} onClick={handleExport}>
                CSV
              </button>
              <label className="btn btn-approve" style={{padding:'9px 16px',borderRadius:8,fontSize:13,fontWeight:600,display:'inline-flex',alignItems:'center',gap:5}}>
                {importing ? '...' : 'Импорт'}
                <input type="file" accept=".csv" onChange={handleImportCSV} style={{display:'none'}} />
              </label>
              <select className="select" value={allowlistSort} onChange={e=>setAllowlistSort(e.target.value as any)} style={{fontSize:12}}>
                <option value="alpha">A{'\u{2192}'}Z</option>
                <option value="newest">Новые</option>
                <option value="oldest">Старые</option>
              </select>
              <select className="select" value={allowlistTypeFilter} onChange={e=>setAllowlistTypeFilter(e.target.value as any)} style={{fontSize:12}}>
                <option value="">Все ({allowlist.length})</option>
                <option value="global">Global ({allowlist.filter(d=>d.isGlobal).length})</option>
                <option value="org">Org ({allowlist.filter(d=>!d.isGlobal).length})</option>
              </select>
              <select className="select" value={allowlistRecent} onChange={e=>setAllowlistRecent(e.target.value as any)} style={{fontSize:12}}>
                <option value="">Все время</option>
                <option value="24h">За 24 часа</option>
                <option value="7d">За 7 дней</option>
              </select>
            </div>

            {/* Add form */}
            {showAddForm&&(
              <div className="add-form">
                <div style={{fontSize:14,fontWeight:700,color:'#3fb950',marginBottom:14}}>Добавить домен в allowlist</div>
                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:12}}>
                  <input className="input" placeholder="domain.com" value={addForm.domain} onChange={e=>setAddForm({...addForm,domain:e.target.value})} />
                  <select className="select" value={addForm.category} onChange={e=>setAddForm({...addForm,category:e.target.value})}>
                    {CATEGORIES.map(c=><option key={c} value={c}>{CATEGORY_ICONS[c]} {CATEGORY_LABELS[c]}</option>)}
                  </select>
                  <input className="input" placeholder="Заметка (необязательно)" value={addForm.notes} onChange={e=>setAddForm({...addForm,notes:e.target.value})}
                    style={{gridColumn:'1/-1'}} />
                </div>
                <div style={{display:'flex',gap:14,marginBottom:14}}>
                  <label style={{display:'flex',alignItems:'center',gap:6,fontSize:12,color:'#7d8590',cursor:'pointer'}}>
                    <input type="checkbox" checked={addForm.isWildcard} onChange={e=>setAddForm({...addForm,isWildcard:e.target.checked})}/>
                    Wildcard (*.domain.com)
                  </label>
                  <label style={{display:'flex',alignItems:'center',gap:6,fontSize:12,color:'#7d8590',cursor:'pointer'}}>
                    <input type="checkbox" checked={addForm.isGlobal} onChange={e=>setAddForm({...addForm,isGlobal:e.target.checked})}/>
                    Глобально
                  </label>
                </div>
                <div style={{display:'flex',gap:8}}>
                  <button className="btn btn-approve" style={{padding:'9px 22px',borderRadius:8,fontSize:13,fontWeight:600}} onClick={handleAddToAllowlist}>
                    Добавить
                  </button>
                  <button className="btn btn-ghost" style={{padding:'9px 18px',borderRadius:8,fontSize:13}} onClick={()=>setShowAddForm(false)}>
                    Отмена
                  </button>
                </div>
              </div>
            )}

            {/* Allowlist by category with subdomain grouping */}
            {Object.entries(allowlistByCategory).sort(([a],[b]) => a==='other'?-1:b==='other'?1:a.localeCompare(b)).map(([cat, domains]) => {
              // Group domains by root domain within this category
              const byRoot: Record<string, { root: any|null, subs: any[] }> = {};
              (domains as any[]).forEach((d: any) => {
                const rootDomain = getRootDomain(d.domain);
                if (!byRoot[rootDomain]) byRoot[rootDomain] = { root: null, subs: [] };
                if (d.domain === rootDomain) {
                  byRoot[rootDomain].root = d;
                } else {
                  byRoot[rootDomain].subs.push(d);
                }
              });
              // Sort root groups by the first item's sort key to preserve category-level sort order
              const rootKeys = Object.keys(byRoot).sort((a, b) => {
                const aFirst = byRoot[a].root || byRoot[a].subs[0];
                const bFirst = byRoot[b].root || byRoot[b].subs[0];
                if (!aFirst || !bFirst) return 0;
                if (allowlistSort === 'alpha') return a.localeCompare(b);
                if (allowlistSort === 'newest') return new Date(bFirst.createdAt).getTime() - new Date(aFirst.createdAt).getTime();
                if (allowlistSort === 'oldest') return new Date(aFirst.createdAt).getTime() - new Date(bFirst.createdAt).getTime();
                return 0;
              });

              return (
                <div key={cat} style={{marginBottom:20}}>
                  <div className="category-header">
                    {CATEGORY_ICONS[cat]} {CATEGORY_LABELS[cat] || cat} ({(domains as any[]).length})
                  </div>
                  <div style={{display:'flex',flexDirection:'column',gap:5}}>
                    {rootKeys.map(rootDomain => {
                      const group = byRoot[rootDomain];
                      const hasSubs = group.subs.length > 0;
                      const groupKey = `${cat}::${rootDomain}`;
                      const isExpanded = expandedGroups.has(groupKey);

                      // Single domain, is the root itself, no subs -> render as plain item
                      if (group.root && !hasSubs) {
                        const d = group.root;
                        return (
                          <div key={d.id} className="list-item">
                            <span style={{fontSize:13,fontFamily:'monospace',color:'#e6edf3',flex:1}}>{d.domain}</span>
                            {d.isWildcard&&<span className="tag tag-wildcard" style={{fontSize:9}}>wildcard</span>}
                            {d.isGlobal&&<span className="tag tag-global" style={{fontSize:9}}>global</span>}
                            {d.notes&&<span style={{fontSize:11,color:'#484f58',maxWidth:180,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{d.notes}</span>}
                            <button className="btn btn-edit-sm" style={{padding:'4px 9px',borderRadius:5,fontSize:10,flexShrink:0}}
                              onClick={()=>{setEditEntry(d);setEditForm({category:d.category||'other',notes:d.notes||'',isWildcard:d.isWildcard||false});}}>
                              Edit
                            </button>
                            <button className="btn btn-danger-sm" style={{padding:'4px 9px',borderRadius:5,fontSize:10,flexShrink:0}}
                              onClick={()=>handleRemoveFromAllowlist(d.domain)}>
                              Del
                            </button>
                          </div>
                        );
                      }

                      // Group with subdomains
                      return (
                        <div key={groupKey} style={{borderRadius:8,border:'1px solid #21262d',overflow:'hidden'}}>
                          {/* Group header */}
                          {group.root ? (
                            // Root domain exists - render as normal item + expand toggle
                            <div className="list-item" style={{borderBottom: isExpanded ? '1px solid #21262d' : 'none'}}>
                              <button onClick={()=>toggleGroup(groupKey)}
                                style={{background:'none',border:'none',cursor:'pointer',padding:0,color:'#484f58',fontSize:11,transition:'transform 0.2s',transform:isExpanded?'rotate(180deg)':'rotate(0deg)',display:'flex',alignItems:'center',flexShrink:0}}>
                                {'\u25BC'}
                              </button>
                              <span style={{fontSize:13,fontFamily:'monospace',color:'#e6edf3',flex:1}}>{group.root.domain}</span>
                              <span style={{fontSize:10,color:'#484f58',flexShrink:0}}>{group.subs.length} sub{group.subs.length!==1?'s':''}</span>
                              {group.root.isWildcard&&<span className="tag tag-wildcard" style={{fontSize:9}}>wildcard</span>}
                              {group.root.isGlobal&&<span className="tag tag-global" style={{fontSize:9}}>global</span>}
                              {group.root.notes&&<span style={{fontSize:11,color:'#484f58',maxWidth:140,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{group.root.notes}</span>}
                              <button className="btn btn-edit-sm" style={{padding:'4px 9px',borderRadius:5,fontSize:10,flexShrink:0}}
                                onClick={()=>{setEditEntry(group.root);setEditForm({category:group.root.category||'other',notes:group.root.notes||'',isWildcard:group.root.isWildcard||false});}}>
                                Edit
                              </button>
                              <button className="btn btn-danger-sm" style={{padding:'4px 9px',borderRadius:5,fontSize:10,flexShrink:0}}
                                onClick={()=>handleRemoveFromAllowlist(group.root.domain)}>
                                Del
                              </button>
                            </div>
                          ) : (
                            // Virtual container - root domain not in allowlist
                            <div className="list-item" onClick={()=>toggleGroup(groupKey)}
                              style={{cursor:'pointer',background:'rgba(139,148,158,0.04)',borderBottom: isExpanded ? '1px solid #21262d' : 'none'}}>
                              <span style={{color:'#484f58',fontSize:11,transition:'transform 0.2s',transform:isExpanded?'rotate(180deg)':'rotate(0deg)',display:'inline-block',flexShrink:0}}>{'\u25BC'}</span>
                              <span style={{fontSize:13,fontFamily:'monospace',color:'#7d8590',flex:1,fontStyle:'italic'}}>{rootDomain}</span>
                              <span style={{fontSize:10,color:'#484f58',background:'rgba(139,148,158,0.08)',border:'1px solid #21262d',padding:'2px 8px',borderRadius:10,flexShrink:0}}>
                                {group.subs.length} subdomain{group.subs.length!==1?'s':''}
                              </span>
                            </div>
                          )}

                          {/* Expanded subdomains */}
                          {isExpanded && (
                            <div style={{background:'rgba(13,17,23,0.5)'}}>
                              {group.subs.map((d: any) => (
                                <div key={d.id} className="list-item" style={{paddingLeft:32,borderBottom:'1px solid #161b22'}}>
                                  <span style={{fontSize:11,color:'#484f58',flexShrink:0,marginRight:2}}>{'\u21B3'}</span>
                                  <span style={{fontSize:13,fontFamily:'monospace',color:'#e6edf3',flex:1}}>{d.domain}</span>
                                  {d.isWildcard&&<span className="tag tag-wildcard" style={{fontSize:9}}>wildcard</span>}
                                  {d.isGlobal&&<span className="tag tag-global" style={{fontSize:9}}>global</span>}
                                  {d.notes&&<span style={{fontSize:11,color:'#484f58',maxWidth:140,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{d.notes}</span>}
                                  <button className="btn btn-edit-sm" style={{padding:'4px 9px',borderRadius:5,fontSize:10,flexShrink:0}}
                                    onClick={()=>{setEditEntry(d);setEditForm({category:d.category||'other',notes:d.notes||'',isWildcard:d.isWildcard||false});}}>
                                    Edit
                                  </button>
                                  <button className="btn btn-danger-sm" style={{padding:'4px 9px',borderRadius:5,fontSize:10,flexShrink:0}}
                                    onClick={()=>handleRemoveFromAllowlist(d.domain)}>
                                    Del
                                  </button>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}

            {filteredAllowlist.length===0&&(
              <div className="empty-state">
                <span className="empty-state-icon">{'\u{2705}'}</span>
                <p style={{color:'#7d8590',fontSize:13}}>Нет доменов по фильтру</p>
              </div>
            )}

            {/* Edit Modal */}
            {editEntry&&(
              <div className="modal-overlay" onClick={(e)=>{if(e.target===e.currentTarget)setEditEntry(null)}}>
                <div className="modal-card">
                  <div style={{fontSize:16,fontWeight:800,color:'#e6edf3',marginBottom:6}}>Редактировать домен</div>
                  <div style={{fontSize:13,color:'#7d8590',marginBottom:18,fontFamily:'monospace'}}>{editEntry.domain}</div>
                  <select className="select" value={editForm.category} onChange={e=>setEditForm({...editForm,category:e.target.value})}
                    style={{width:'100%',marginBottom:12}}>
                    {CATEGORIES.map(c=><option key={c} value={c}>{CATEGORY_ICONS[c]} {CATEGORY_LABELS[c]}</option>)}
                  </select>
                  <input className="input" placeholder="Заметка" value={editForm.notes} onChange={e=>setEditForm({...editForm,notes:e.target.value})}
                    style={{width:'100%',marginBottom:12}} />
                  <label style={{display:'flex',alignItems:'center',gap:8,fontSize:12,color:'#7d8590',marginBottom:20,cursor:'pointer'}}>
                    <input type="checkbox" checked={editForm.isWildcard} onChange={e=>setEditForm({...editForm,isWildcard:e.target.checked})}/>
                    Wildcard (*.{editEntry.domain})
                  </label>
                  <div style={{display:'flex',gap:8}}>
                    <button className="btn btn-approve" style={{flex:1,padding:'10px',borderRadius:8,fontSize:13,fontWeight:600}} onClick={handleEditSave}>
                      Сохранить
                    </button>
                    <button className="btn btn-ghost" style={{padding:'10px 18px',borderRadius:8,fontSize:13}} onClick={()=>setEditEntry(null)}>
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
            <div className="toolbar">
              <input className="input" placeholder="Поиск домена..." value={blocklistFilter} onChange={e=>setBlocklistFilter(e.target.value)}
                style={{flex:1}} />
              {blocklistFilter&&(
                <button className="btn btn-ghost" style={{padding:'9px 14px',borderRadius:8,fontSize:13}} onClick={()=>setBlocklistFilter('')}>
                  Сбросить
                </button>
              )}
            </div>

            <div style={{display:'flex',flexDirection:'column',gap:6}}>
              {filteredBlocklist.length===0?(
                <div className="empty-state">
                  <span className="empty-state-icon">{'\u{1F6AB}'}</span>
                  <p style={{color:'#7d8590',fontSize:13}}>
                    {blocklistFilter ? `Ничего не найдено` : 'Список блокировок пуст'}
                  </p>
                </div>
              ):filteredBlocklist.map((d:any)=>(
                <div key={d.id} className="list-item list-item-blocklist">
                  <span style={{fontSize:14,flexShrink:0}}>{'\u{1F6AB}'}</span>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:13,fontFamily:'monospace',color:'#e6edf3',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{d.domain}</div>
                    {d.reason&&<div style={{fontSize:10,color:'#484f58',marginTop:2,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{d.reason}</div>}
                  </div>
                  {d.isGlobal&&<span className="tag tag-global" style={{fontSize:9,color:'#f85149',background:'rgba(248,81,73,0.1)',borderColor:'rgba(248,81,73,0.2)'}}>global</span>}
                  <span style={{fontSize:10,color:'#484f58',flexShrink:0}}>{fmtTime(d.createdAt)}</span>
                  <button className="btn btn-unblock" style={{padding:'6px 12px',borderRadius:6,fontSize:11,fontWeight:600,flexShrink:0,whiteSpace:'nowrap'}}
                    onClick={()=>handleUnblock(d.domain)} title="Разблокировать и добавить в Allowlist">
                    Разблокировать
                  </button>
                </div>
              ))}
            </div>

            {blocklistFilter&&filteredBlocklist.length>0&&(
              <div style={{marginTop:12,fontSize:11,color:'#484f58',textAlign:'center'}}>
                Найдено: {filteredBlocklist.length} из {blocklist.length}
              </div>
            )}
          </div>
        )}

        {/* ==================== HISTORY ==================== */}
        {activeTab==='history'&&(
          <div style={{display:'flex',flexDirection:'column',gap:8}}>
            {historyGroups.length===0?(
              <div className="empty-state">
                <span className="empty-state-icon">{'\u{1F4CB}'}</span>
                <p style={{color:'#7d8590',fontSize:13}}>История пуста</p>
              </div>
            ):historyGroups.map((group:any)=>{
              const latest=group.latest;
              const isExp=expanded===group.domain;
              const rt=parseRt(latest.reason);
              return(
                <div key={group.domain} className="history-item">
                  <div className="history-item-header" onClick={()=>setExpanded(isExp?null:group.domain)}>
                    <div style={{fontSize:16,flexShrink:0}}>{latest.action==='approved'?'\u{2705}':'\u{1F6AB}'}</div>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:13,fontFamily:'monospace',color:'#e6edf3',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{group.domain}</div>
                      <div style={{fontSize:10,color:'#484f58',marginTop:2}}>
                        {group.actions.length} действий &middot; {fmtTime(latest.createdAt)}
                        {latest.moderatorEmail&&<span> &middot; {latest.moderatorEmail}</span>}
                      </div>
                    </div>
                    {latest.source&&<span className="tag" style={{fontSize:9,background:'rgba(56,139,253,0.1)',border:'1px solid rgba(56,139,253,0.2)',color:'#58a6ff',flexShrink:0}}>{latest.source}</span>}
                    {latest.category&&<span style={{fontSize:9,color:'#484f58',flexShrink:0}}>{CATEGORY_ICONS[latest.category]||''}</span>}
                    {rt!=null&&<div style={{fontSize:10,color:rt<30?'#3fb950':rt<120?'#f0a84a':'#f85149',fontFamily:'monospace',background:'#0d1117',padding:'3px 8px',borderRadius:5,border:'1px solid #21262d',flexShrink:0}}>{rt<60?`${rt}s`:`${Math.floor(rt/60)}m`}</div>}
                    <div style={{fontSize:11,fontWeight:700,color:latest.action==='approved'?'#3fb950':'#f85149',flexShrink:0}}>{latest.action==='approved'?'Одобрен':'Заблокирован'}</div>
                    <span style={{color:'#484f58',fontSize:11,transition:'transform 0.2s',transform:isExp?'rotate(180deg)':'rotate(0deg)',display:'inline-block'}}>{'\u{25BC}'}</span>
                  </div>
                  {isExp&&(
                    <div style={{borderTop:'1px solid #21262d',padding:'10px 16px',background:'#0d1117'}}>
                      {group.actions.map((action:any,i:number)=>{
                        const art=parseRt(action.reason);
                        return(
                          <div key={action.id} style={{display:'flex',alignItems:'center',gap:8,padding:'7px 0',borderBottom:i<group.actions.length-1?'1px solid #21262d':'none'}}>
                            <span style={{fontSize:13}}>{action.action==='approved'?'\u{2705}':'\u{1F6AB}'}</span>
                            <span style={{fontSize:11,color:action.action==='approved'?'#3fb950':'#f85149',fontWeight:600}}>{action.action==='approved'?'Одобрен':'Заблокирован'}</span>
                            {action.source&&<span className="tag" style={{fontSize:9,background:'rgba(56,139,253,0.1)',border:'1px solid rgba(56,139,253,0.2)',color:'#58a6ff'}}>{action.source}</span>}
                            {action.category&&<span style={{fontSize:9,color:'#7d8590'}}>{CATEGORY_ICONS[action.category]||''} {CATEGORY_LABELS[action.category]||action.category}</span>}
                            {art!=null&&<span style={{fontSize:10,color:'#7d8590',fontFamily:'monospace'}}>за {art<60?`${art}s`:`${Math.floor(art/60)}m ${art%60}s`}</span>}
                            <span style={{flex:1}}/>
                            {action.moderatorEmail&&<span style={{fontSize:10,color:'#58a6ff'}}>{action.moderatorEmail.split('@')[0]}</span>}
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
