import React, { useState, useEffect, useRef, useCallback } from 'react';
import { getPendingEvents, getDeferredEvents, getInfoEvents, makeDecision, deferEvent, getHistory } from '../api';
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

type Tab = 'pending' | 'deferred' | 'info' | 'history';

export default function ModeratorPanel({ user, onLogout }: Props) {
  const [events, setEvents] = useState<any[]>([]);
  const [deferred, setDeferred] = useState<any[]>([]);
  const [infoEvents, setInfoEvents] = useState<any[]>([]);
  const [history, setHistory] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState<Tab>('pending');
  const [deciding, setDeciding] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [deferMinutes, setDeferMinutes] = useState<Record<string, number>>({});
  const [showDeferPicker, setShowDeferPicker] = useState<string | null>(null);
  const [notification, setNotification] = useState<{msg:string;type:string}|null>(null);
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

  const fetchAll = useCallback(async () => {
    try {
      const [pendingRes, deferredRes, infoRes] = await Promise.all([
        getPendingEvents(user.companyId),
        getDeferredEvents(),
        getInfoEvents(),
      ]);
      const newEvents: any[] = pendingRes.data;
      const trulyNew = newEvents.filter(e => !knownIds.current.has(e.id));
      if (trulyNew.length > 0) {
        trulyNew.forEach(e => knownIds.current.add(e.id));
        showNotif(`🚨 Новое событие: ${trulyNew[0].domain}`, 'warning');
        playSound(660);
      }
      setEvents(newEvents);
      setDeferred(deferredRes.data);
      setInfoEvents(infoRes.data);
    } catch(e) {}
  }, [user.companyId]);

  const fetchHistory = useCallback(async () => {
    try { const res = await getHistory(); setHistory(res.data); } catch(e) {}
  }, []);

  useEffect(() => {
    fetchAll(); fetchHistory();
    const id = setInterval(fetchAll, 3000);
    return () => clearInterval(id);
    // eslint-disable-next-line
  }, []);

  const handleDecision = async (eventId: string, action: 'approved'|'blocked', isGlobal = false) => {
    setDeciding(eventId);
    knownIds.current.delete(eventId);
    try {
      const ev = events.find(e => e.id === eventId);
      const rt = ev ? Math.floor((Date.now() - new Date(ev.createdAt).getTime()) / 1000) : 0;
      await makeDecision(eventId, action, `Response time: ${rt}s`, isGlobal);
      playSound(action === 'approved' ? 1047 : 440);
      showNotif(action === 'approved' ? `✅ Одобрен за ${rt}с` : `🚫 Заблокирован за ${rt}с`, action === 'approved' ? 'success' : 'error');
      await fetchAll(); await fetchHistory();
    } catch(e) { showNotif('Ошибка', 'error'); }
    finally { setDeciding(null); }
  };

  const handleDefer = async (eventId: string, minutes: number) => {
    setDeciding(eventId);
    try {
      await deferEvent(eventId, minutes);
      setShowDeferPicker(null);
      showNotif(`⏸ Отложено на ${minutes} минут`, 'info');
      await fetchAll();
    } catch(e) { showNotif('Ошибка', 'error'); }
    finally { setDeciding(null); }
  };

  const handleRestoreDeferred = async (eventId: string) => {
    setDeciding(eventId);
    try {
      // Восстанавливаем как pending
      await api.post(`/decision/restore/${eventId}`);
      showNotif('↩️ Событие восстановлено в очередь', 'info');
      await fetchAll();
    } catch(e) {
      // Если endpoint не существует, просто обновляем
      showNotif('Обновлено', 'info');
      await fetchAll();
    }
    finally { setDeciding(null); }
  };

  const handleChangeDecision = async (domain: string, newAction: 'approved'|'blocked') => {
    setDeciding(domain);
    try {
      await api.delete(`/domain/decision/${encodeURIComponent(domain)}`);
      const res = await api.post('/domain/check', { url: `https://${domain}`, tabId: 'moderator-override' });
      if (res.data.eventId) await makeDecision(res.data.eventId, newAction, 'Решение изменено модератором', false);
      playSound(newAction === 'approved' ? 1047 : 440);
      showNotif(newAction === 'approved' ? `✅ ${domain} — открыт` : `🚫 ${domain} — заблокирован`, newAction === 'approved' ? 'success' : 'error');
      await fetchHistory();
    } catch(e) { showNotif('Ошибка', 'error'); }
    finally { setDeciding(null); }
  };

  const rc = (s: number) => s >= 70 ? '#f85149' : s >= 40 ? '#f0a84a' : '#3fb950';
  const rl = (s: number) => s >= 70 ? 'Высокий' : s >= 40 ? 'Средний' : 'Низкий';
  const fmtTime = (d: string) => new Date(d).toLocaleString('ru-RU', {day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});
  const parseUrl = (r: string) => { const m = r?.match(/URL: ([^\s|]+)/); return m?m[1]:null; };
  const parseFlags = (r: string) => { const m = r?.match(/Flags: (.+?)(\s*\|.*)?$/); return m?m[1].split(', ').filter(Boolean):[]; };
  const parseRt = (r: string) => { const m = r?.match(/Response time: (\d+)s/); return m?parseInt(m[1]):null; };
  const parseDeferTime = (r: string) => { const m = r?.match(/Deferred until: ([^\s|]+)/); return m?new Date(m[1]):null; };

  const nc: Record<string,any> = {
    info: {bg:'rgba(56,139,253,0.1)',b:'rgba(56,139,253,0.3)',c:'#388bfd'},
    success: {bg:'rgba(63,185,80,0.1)',b:'rgba(63,185,80,0.3)',c:'#3fb950'},
    error: {bg:'rgba(248,81,73,0.1)',b:'rgba(248,81,73,0.3)',c:'#f85149'},
    warning: {bg:'rgba(240,168,74,0.1)',b:'rgba(240,168,74,0.3)',c:'#f0a84a'},
  };

  const approved = history.filter((i:any) => i.action === 'approved').length;
  const blocked = history.filter((i:any) => i.action === 'blocked').length;

  const groupedHistory = history.reduce((acc: Record<string,any>, item: any) => {
    if (!acc[item.domain]) acc[item.domain] = { domain: item.domain, actions: [], latest: item };
    if (new Date(item.createdAt) > new Date(acc[item.domain].latest.createdAt)) acc[item.domain].latest = item;
    acc[item.domain].actions = [...acc[item.domain].actions, item].sort((a,b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return acc;
  }, {});
  const historyGroups = Object.values(groupedHistory) as any[];

  const tabs = [
    { id: 'pending', icon: '🔍', label: 'Очередь', count: events.length },
    { id: 'deferred', icon: '⏸', label: 'Отложенные', count: deferred.length },
    { id: 'info', icon: 'ℹ️', label: 'Мониторинг', count: infoEvents.length },
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
              {label:'Всего',value:history.length,c:'#e6edf3'},
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

        <nav style={{padding:'10px',flex:1}}>
          {tabs.map(tab=>(
            <button key={tab.id}
              style={{display:'flex',alignItems:'center',gap:8,padding:'9px 10px',borderRadius:8,border:'none',background:activeTab===tab.id?'rgba(56,139,253,0.1)':'transparent',color:activeTab===tab.id?'#388bfd':'#7d8590',fontSize:13,cursor:'pointer',width:'100%',textAlign:'left',fontFamily:'inherit',marginBottom:2}}
              onClick={()=>{setActiveTab(tab.id as Tab);if(tab.id==='history')fetchHistory();}}>
              <span>{tab.icon}</span>
              <span style={{flex:1}}>{tab.label}</span>
              {tab.count!=null&&tab.count>0&&(
                <span style={{background:tab.id==='pending'?'#f85149':tab.id==='deferred'?'#f0a84a':'#388bfd',color:'#fff',borderRadius:10,padding:'1px 6px',fontSize:10,fontWeight:700}}>{tab.count}</span>
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

      {/* Main */}
      <div style={{marginLeft:220,flex:1,padding:'24px'}}>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:20}}>
          <div>
            <h1 style={{fontSize:18,fontWeight:700,color:'#fff',marginBottom:2}}>
              {tabs.find(t=>t.id===activeTab)?.icon} {tabs.find(t=>t.id===activeTab)?.label}
            </h1>
            <p style={{fontSize:12,color:'#7d8590'}}>
              {activeTab==='pending'&&`${events.length} событий ожидают · каждые 3с`}
              {activeTab==='deferred'&&`${deferred.length} отложенных событий`}
              {activeTab==='info'&&`${infoEvents.length} сайтов с низким риском (мониторинг)`}
              {activeTab==='history'&&`${historyGroups.length} уникальных доменов`}
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

        {/* PENDING */}
        {activeTab==='pending'&&(
          <div style={{display:'flex',flexDirection:'column',gap:10}}>
            {events.length===0?(
              <div style={{textAlign:'center',padding:'70px 20px'}}>
                <div style={{fontSize:48,marginBottom:12}}>✅</div>
                <h3 style={{color:'#3fb950',marginBottom:6}}>Всё чисто!</h3>
                <p style={{color:'#7d8590',fontSize:13}}>Нет событий в очереди</p>
              </div>
            ):events.map(event=>{
              const url=parseUrl(event.reason);
              const flags=parseFlags(event.reason);
              const color=rc(event.riskScore);
              return(
                <div key={event.id} style={{background:'#161b22',border:`1px solid ${event.riskScore>=70?'rgba(248,81,73,0.4)':event.riskScore>=40?'rgba(240,168,74,0.3)':'#30363d'}`,borderRadius:12,padding:'16px 18px',position:'relative'}}>
                  <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:10,gap:8}}>
                    <div style={{display:'flex',alignItems:'center',gap:8,flex:1,minWidth:0}}>
                      <span style={{fontSize:16}}>{event.riskScore>=70?'🚨':event.riskScore>=40?'⚠️':'ℹ️'}</span>
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
                      onClick={()=>handleDecision(event.id,'approved')} disabled={deciding===event.id}>
                      {deciding===event.id?'...':'✅ Одобрить'}
                    </button>
                    <button style={{flex:1,minWidth:80,padding:'9px',background:'rgba(248,81,73,0.08)',border:'1px solid rgba(248,81,73,0.3)',borderRadius:7,color:'#f85149',fontSize:12,fontWeight:600,cursor:'pointer',fontFamily:'inherit'}}
                      onClick={()=>handleDecision(event.id,'blocked')} disabled={deciding===event.id}>
                      {deciding===event.id?'...':'🚫 Заблокировать'}
                    </button>

                    {/* Кнопка Отложить */}
                    <div style={{position:'relative'}}>
                      <button style={{padding:'9px 12px',background:'rgba(240,168,74,0.08)',border:'1px solid rgba(240,168,74,0.3)',borderRadius:7,color:'#f0a84a',fontSize:12,fontWeight:600,cursor:'pointer',fontFamily:'inherit'}}
                        onClick={()=>setShowDeferPicker(showDeferPicker===event.id?null:event.id)}
                        disabled={deciding===event.id}>
                        ⏸ Отложить
                      </button>
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
                      onClick={()=>handleDecision(event.id,'blocked',true)} disabled={deciding===event.id}
                      title="Заблокировать глобально">
                      🌍
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* DEFERRED */}
        {activeTab==='deferred'&&(
          <div style={{display:'flex',flexDirection:'column',gap:10}}>
            {deferred.length===0?(
              <div style={{textAlign:'center',padding:'70px 20px'}}>
                <div style={{fontSize:48,marginBottom:12}}>⏸</div>
                <h3 style={{color:'#f0a84a',marginBottom:6}}>Нет отложенных событий</h3>
                <p style={{color:'#7d8590',fontSize:13}}>Отложенные события появятся здесь</p>
              </div>
            ):deferred.map(event=>{
              const url=parseUrl(event.reason);
              const deferUntil=parseDeferTime(event.reason);
              const timeLeft=deferUntil?Math.max(0,Math.floor((deferUntil.getTime()-Date.now())/1000)):0;
              const tlm=Math.floor(timeLeft/60),tls=timeLeft%60;
              return(
                <div key={event.id} style={{background:'#161b22',border:'1px solid rgba(240,168,74,0.3)',borderRadius:12,padding:'16px 18px'}}>
                  <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:10}}>
                    <div style={{display:'flex',alignItems:'center',gap:8}}>
                      <span>⏸</span>
                      <span style={{fontSize:15,fontWeight:700,fontFamily:'monospace'}}>{event.domain}</span>
                    </div>
                    <div style={{display:'flex',alignItems:'center',gap:8}}>
                      {deferUntil&&(
                        <span style={{fontFamily:'monospace',fontSize:12,color:timeLeft<300?'#f85149':'#f0a84a',fontWeight:700}}>
                          ⏰ {tlm}:{tls.toString().padStart(2,'0')} осталось
                        </span>
                      )}
                      <span style={{background:'rgba(240,168,74,0.1)',border:'1px solid rgba(240,168,74,0.3)',color:'#f0a84a',padding:'2px 8px',borderRadius:20,fontSize:11,fontWeight:700}}>
                        {rl(event.riskScore)} {event.riskScore}%
                      </span>
                    </div>
                  </div>

                  {url&&(
                    <div style={{display:'flex',alignItems:'center',gap:7,background:'#0d1117',border:'1px solid #21262d',borderRadius:6,padding:'7px 10px',marginBottom:8}}>
                      <span style={{fontSize:12}}>🔗</span>
                      <span style={{fontSize:11,color:'#7d8590',flex:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{url}</span>
                      <a href={url} target="_blank" rel="noreferrer" style={{fontSize:10,color:'#fff',background:'#388bfd',padding:'2px 8px',borderRadius:4,textDecoration:'none',fontWeight:600}}>Открыть →</a>
                    </div>
                  )}

                  <div style={{fontSize:11,color:'#7d8590',marginBottom:12}}>
                    🕐 Отложено: {fmtTime(event.createdAt)}
                    {deferUntil&&` · до ${fmtTime(deferUntil.toISOString())}`}
                  </div>

                  <div style={{display:'flex',gap:7}}>
                    <button style={{flex:1,padding:'8px',background:'rgba(63,185,80,0.08)',border:'1px solid rgba(63,185,80,0.3)',borderRadius:7,color:'#3fb950',fontSize:12,fontWeight:600,cursor:'pointer',fontFamily:'inherit'}}
                      onClick={()=>handleDecision(event.id,'approved')} disabled={deciding===event.id}>
                      ✅ Одобрить
                    </button>
                    <button style={{flex:1,padding:'8px',background:'rgba(248,81,73,0.08)',border:'1px solid rgba(248,81,73,0.3)',borderRadius:7,color:'#f85149',fontSize:12,fontWeight:600,cursor:'pointer',fontFamily:'inherit'}}
                      onClick={()=>handleDecision(event.id,'blocked')} disabled={deciding===event.id}>
                      🚫 Заблокировать
                    </button>
                    <button style={{padding:'8px 12px',background:'rgba(56,139,253,0.08)',border:'1px solid rgba(56,139,253,0.3)',borderRadius:7,color:'#388bfd',fontSize:12,fontWeight:600,cursor:'pointer',fontFamily:'inherit'}}
                      onClick={()=>handleRestoreDeferred(event.id)} disabled={deciding===event.id}>
                      ↩️ В очередь
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* INFO / MONITORING */}
        {activeTab==='info'&&(
          <div style={{display:'flex',flexDirection:'column',gap:8}}>
            <div style={{background:'rgba(56,139,253,0.05)',border:'1px solid rgba(56,139,253,0.15)',borderRadius:10,padding:'12px 16px',marginBottom:8,fontSize:13,color:'#7d8590'}}>
              ℹ️ Эти сайты были открыты диспетчерами. Они имеют <strong style={{color:'#388bfd'}}>низкий риск (1-40%)</strong> и были пропущены автоматически. Мониторинг для информации.
            </div>
            {infoEvents.length===0?(
              <div style={{textAlign:'center',padding:'60px 20px'}}>
                <div style={{fontSize:44,marginBottom:12}}>📊</div>
                <p style={{color:'#7d8590',fontSize:13}}>Нет данных мониторинга</p>
              </div>
            ):infoEvents.map(event=>{
              const url=parseUrl(event.reason);
              const flags=parseFlags(event.reason);
              return(
                <div key={event.id} style={{background:'#161b22',border:'1px solid #21262d',borderRadius:10,padding:'14px 16px',display:'flex',alignItems:'center',gap:12}}>
                  <span style={{fontSize:18,flexShrink:0}}>ℹ️</span>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:13,fontFamily:'monospace',color:'#e6edf3',marginBottom:3}}>{event.domain}</div>
                    {url&&<div style={{fontSize:11,color:'#484f58',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{url}</div>}
                    {flags.length>0&&(
                      <div style={{display:'flex',flexWrap:'wrap',gap:3,marginTop:4}}>
                        {flags.map((f:string,i:number)=>(
                          <span key={i} style={{background:'rgba(56,139,253,0.08)',border:'1px solid rgba(56,139,253,0.15)',borderRadius:3,padding:'1px 5px',fontSize:9,color:'#388bfd'}}>{f}</span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div style={{textAlign:'right',flexShrink:0}}>
                    <div style={{fontSize:13,fontWeight:700,color:'#3fb950'}}>{event.riskScore}%</div>
                    <div style={{fontSize:10,color:'#484f58'}}>{fmtTime(event.createdAt)}</div>
                  </div>
                  {url&&<a href={url} target="_blank" rel="noreferrer" style={{fontSize:10,color:'#fff',background:'#388bfd',padding:'4px 8px',borderRadius:4,textDecoration:'none',fontWeight:600,flexShrink:0}}>→</a>}
                </div>
              );
            })}
          </div>
        )}

        {/* HISTORY */}
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
                    <button style={{padding:'4px 9px',background:latest.action==='approved'?'rgba(248,81,73,0.08)':'rgba(63,185,80,0.08)',border:`1px solid ${latest.action==='approved'?'rgba(248,81,73,0.3)':'rgba(63,185,80,0.3)'}`,borderRadius:5,color:latest.action==='approved'?'#f85149':'#3fb950',fontSize:10,fontWeight:600,cursor:'pointer',fontFamily:'inherit',flexShrink:0,opacity:deciding===group.domain?0.5:1}}
                      onClick={e=>{e.stopPropagation();handleChangeDecision(group.domain,latest.action==='approved'?'blocked':'approved');}}
                      disabled={deciding===group.domain}>
                      {deciding===group.domain?'...':latest.action==='approved'?'🚫 Блок':'✅ Открыть'}
                    </button>
                    <span style={{color:'#484f58',fontSize:11}}>{isExp?'▲':'▼'}</span>
                  </div>
                  {isExp&&(
                    <div style={{borderTop:'1px solid #21262d',padding:'10px 16px',background:'#0d1117'}}>
                      <div style={{fontSize:10,color:'#484f58',marginBottom:6,textTransform:'uppercase',letterSpacing:1}}>История действий</div>
                      {group.actions.map((action:any,i:number)=>{
                        const art=parseRt(action.reason);
                        return(
                          <div key={action.id} style={{display:'flex',alignItems:'center',gap:8,padding:'6px 0',borderBottom:i<group.actions.length-1?'1px solid #21262d':'none'}}>
                            <span style={{fontSize:13}}>{action.action==='approved'?'✅':'🚫'}</span>
                            <span style={{fontSize:11,color:action.action==='approved'?'#3fb950':'#f85149',fontWeight:600,flexShrink:0}}>{action.action==='approved'?'Одобрен':'Заблокирован'}</span>
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
