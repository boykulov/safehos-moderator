import React, { useState, useEffect, useRef, useCallback } from 'react';
import { getPendingEvents, makeDecision, getHistory } from '../api';
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
  return <span style={{ fontFamily: 'monospace', fontSize: 13, color, fontWeight: 700 }}>⏱ {m}:{s.toString().padStart(2,'0')}</span>;
}

export default function ModeratorPanel({ user, onLogout }: Props) {
  const [events, setEvents] = useState<any[]>([]);
  const [history, setHistory] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState<'pending' | 'history'>('pending');
  const [deciding, setDeciding] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
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

  const fetchEvents = useCallback(async () => {
    try {
      const res = await getPendingEvents(user.companyId);
      const newEvents: any[] = res.data;
      const trulyNew = newEvents.filter(e => !knownIds.current.has(e.id));
      if (trulyNew.length > 0) {
        trulyNew.forEach(e => knownIds.current.add(e.id));
        showNotif(`🚨 Новое событие: ${trulyNew[0].domain}`, 'warning');
        playSound(660);
      }
      setEvents(newEvents);
    } catch(e) {}
  }, [user.companyId]);

  const fetchHistory = useCallback(async () => {
    try {
      const res = await getHistory();
      setHistory(res.data);
    } catch(e) {}
  }, []);

  useEffect(() => {
    fetchEvents(); fetchHistory();
    const id = setInterval(fetchEvents, 3000);
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
      await fetchEvents(); await fetchHistory();
    } catch(e) { showNotif('Ошибка', 'error'); }
    finally { setDeciding(null); }
  };

  const handleChangeDecision = async (domain: string, newAction: 'approved'|'blocked') => {
    setDeciding(domain);
    try {
      await api.delete(`/domain/decision/${encodeURIComponent(domain)}`);
      const res = await api.post('/domain/check', { url: `https://${domain}`, tabId: 'moderator-override' });
      if (res.data.eventId) {
        await makeDecision(res.data.eventId, newAction, 'Решение изменено модератором', false);
      }
      playSound(newAction === 'approved' ? 1047 : 440);
      showNotif(newAction === 'approved' ? `✅ ${domain} — открыт` : `🚫 ${domain} — заблокирован`, newAction === 'approved' ? 'success' : 'error');
      await fetchHistory();
    } catch(e) { showNotif('Ошибка', 'error'); }
    finally { setDeciding(null); }
  };

  const getRiskColor = (s: number) => s >= 70 ? '#f85149' : s >= 40 ? '#f0a84a' : '#3fb950';
  const getRiskLabel = (s: number) => s >= 70 ? 'Высокий' : s >= 40 ? 'Средний' : 'Низкий';
  const fmtTime = (d: string) => new Date(d).toLocaleString('ru-RU', {day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});
  const parseUrl = (r: string) => { const m = r?.match(/URL: ([^\s|]+)/); return m?m[1]:null; };
  const parseFlags = (r: string) => { const m = r?.match(/Flags: (.+)/); return m?m[1].split(', ').filter(Boolean):[]; };
  const parseRt = (r: string) => { const m = r?.match(/Response time: (\d+)s/); return m?parseInt(m[1]):null; };

  // Группируем историю по домену — показываем только уникальные домены с последним решением
  const groupedHistory = history.reduce((acc: Record<string, any>, item: any) => {
    if (!acc[item.domain] || new Date(item.createdAt) > new Date(acc[item.domain].latest.createdAt)) {
      if (!acc[item.domain]) acc[item.domain] = { domain: item.domain, actions: [], latest: item };
      acc[item.domain].latest = item;
    }
    if (!acc[item.domain]) acc[item.domain] = { domain: item.domain, actions: [], latest: item };
    acc[item.domain].actions = [...(acc[item.domain]?.actions || []), item].sort((a,b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return acc;
  }, {});
  const historyGroups = Object.values(groupedHistory) as any[];

  const nc: Record<string,any> = {
    info: {bg:'rgba(56,139,253,0.1)',b:'rgba(56,139,253,0.3)',c:'#388bfd'},
    success: {bg:'rgba(63,185,80,0.1)',b:'rgba(63,185,80,0.3)',c:'#3fb950'},
    error: {bg:'rgba(248,81,73,0.1)',b:'rgba(248,81,73,0.3)',c:'#f85149'},
    warning: {bg:'rgba(240,168,74,0.1)',b:'rgba(240,168,74,0.3)',c:'#f0a84a'},
  };

  const approved = history.filter((i:any) => i.action === 'approved').length;
  const blocked = history.filter((i:any) => i.action === 'blocked').length;

  return (
    <div style={{display:'flex',minHeight:'100vh',background:'#0d1117',fontFamily:'-apple-system,BlinkMacSystemFont,Inter,sans-serif',color:'#e6edf3'}}>
      {/* Sidebar */}
      <div style={{width:220,background:'#161b22',borderRight:'1px solid #21262d',display:'flex',flexDirection:'column',padding:'16px 0',position:'fixed',top:0,left:0,bottom:0}}>
        <div style={{display:'flex',alignItems:'center',gap:10,padding:'0 16px 16px',borderBottom:'1px solid #21262d'}}>
          <div style={{fontSize:24,background:'linear-gradient(135deg,#388bfd,#8957e5)',borderRadius:8,width:36,height:36,display:'flex',alignItems:'center',justifyContent:'center'}}>🛡️</div>
          <div>
            <div style={{fontSize:14,fontWeight:700,color:'#fff'}}>SafeHos</div>
            <div style={{fontSize:10,color:'#7d8590'}}>Moderator Panel</div>
          </div>
        </div>

        {/* Stats */}
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
          {[
            {id:'pending',icon:'🔍',label:'Очередь',count:events.length},
            {id:'history',icon:'📋',label:'История',count:null},
          ].map(item=>(
            <button key={item.id}
              style={{display:'flex',alignItems:'center',gap:8,padding:'9px 10px',borderRadius:8,border:'none',background:activeTab===item.id?'rgba(56,139,253,0.1)':'transparent',color:activeTab===item.id?'#388bfd':'#7d8590',fontSize:13,cursor:'pointer',width:'100%',textAlign:'left',fontFamily:'inherit',marginBottom:2}}
              onClick={()=>{setActiveTab(item.id as any);if(item.id==='history')fetchHistory();}}>
              <span>{item.icon}</span>
              <span style={{flex:1}}>{item.label}</span>
              {item.count!=null&&item.count>0&&<span style={{background:'#f85149',color:'#fff',borderRadius:10,padding:'1px 6px',fontSize:10,fontWeight:700}}>{item.count}</span>}
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
              {activeTab==='pending'?'🔍 Очередь проверки':'📋 История решений'}
            </h1>
            <p style={{fontSize:12,color:'#7d8590'}}>
              {activeTab==='pending'?`${events.length} событий · каждые 3с`:`${historyGroups.length} уникальных доменов`}
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

        {/* Pending Events */}
        {activeTab==='pending'&&(
          <div style={{display:'flex',flexDirection:'column',gap:10}}>
            {events.length===0?(
              <div style={{textAlign:'center',padding:'70px 20px'}}>
                <div style={{fontSize:48,marginBottom:12}}>✅</div>
                <h3 style={{color:'#3fb950',marginBottom:6}}>Всё чисто!</h3>
                <p style={{color:'#7d8590',fontSize:13}}>Нет подозрительных событий</p>
              </div>
            ):events.map(event=>{
              const url=parseUrl(event.reason);
              const flags=parseFlags(event.reason);
              const rc=getRiskColor(event.riskScore);
              return(
                <div key={event.id} style={{background:'#161b22',border:`1px solid ${event.riskScore>=70?'rgba(248,81,73,0.4)':'#30363d'}`,borderRadius:12,padding:'16px 18px'}}>
                  {/* Header */}
                  <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:10,gap:8}}>
                    <div style={{display:'flex',alignItems:'center',gap:8,flex:1,minWidth:0}}>
                      <span>⚠️</span>
                      <span style={{fontSize:15,fontWeight:700,fontFamily:'monospace',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{event.domain}</span>
                    </div>
                    <div style={{display:'flex',alignItems:'center',gap:8,flexShrink:0}}>
                      <LiveTimer startTime={event.createdAt}/>
                      <span style={{background:`${rc}20`,border:`1px solid ${rc}40`,color:rc,padding:'2px 8px',borderRadius:20,fontSize:11,fontWeight:700}}>
                        {getRiskLabel(event.riskScore)} {event.riskScore}%
                      </span>
                    </div>
                  </div>

                  {/* URL */}
                  {url&&(
                    <div style={{display:'flex',alignItems:'center',gap:7,background:'#0d1117',border:'1px solid #21262d',borderRadius:6,padding:'8px 10px',marginBottom:8}}>
                      <span style={{fontSize:12}}>🔗</span>
                      <span style={{fontSize:11,color:'#7d8590',flex:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{url}</span>
                      <a href={url} target="_blank" rel="noreferrer" style={{fontSize:10,color:'#fff',background:'#388bfd',padding:'2px 8px',borderRadius:4,textDecoration:'none',fontWeight:600,flexShrink:0}}>Открыть →</a>
                    </div>
                  )}

                  {/* Meta + Flags */}
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

                  {/* Actions */}
                  <div style={{display:'flex',gap:7}}>
                    <button style={{flex:1,padding:'9px',background:'rgba(63,185,80,0.08)',border:'1px solid rgba(63,185,80,0.3)',borderRadius:7,color:'#3fb950',fontSize:13,fontWeight:600,cursor:'pointer',fontFamily:'inherit'}}
                      onClick={()=>handleDecision(event.id,'approved')} disabled={deciding===event.id}>
                      {deciding===event.id?'...':'✅ Одобрить'}
                    </button>
                    <button style={{flex:1,padding:'9px',background:'rgba(248,81,73,0.08)',border:'1px solid rgba(248,81,73,0.3)',borderRadius:7,color:'#f85149',fontSize:13,fontWeight:600,cursor:'pointer',fontFamily:'inherit'}}
                      onClick={()=>handleDecision(event.id,'blocked')} disabled={deciding===event.id}>
                      {deciding===event.id?'...':'🚫 Заблокировать'}
                    </button>
                    <button style={{padding:'9px 12px',background:'rgba(137,87,229,0.08)',border:'1px solid rgba(137,87,229,0.3)',borderRadius:7,color:'#8957e5',fontSize:11,fontWeight:600,cursor:'pointer',fontFamily:'inherit'}}
                      onClick={()=>handleDecision(event.id,'blocked',true)} disabled={deciding===event.id}
                      title="Заблокировать глобально для всех компаний">
                      🌍 Глобально
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* History — grouped by domain */}
        {activeTab==='history'&&(
          <div style={{display:'flex',flexDirection:'column',gap:8}}>
            {historyGroups.length===0?(
              <div style={{textAlign:'center',padding:'60px 20px'}}>
                <div style={{fontSize:44,marginBottom:12}}>📋</div>
                <p style={{color:'#7d8590',fontSize:13}}>История пуста</p>
              </div>
            ):historyGroups.map((group:any)=>{
              const latest = group.latest;
              const isExpanded = expanded === group.domain;
              const rt = parseRt(latest.reason);
              return(
                <div key={group.domain} style={{background:'#161b22',border:'1px solid #21262d',borderRadius:10,overflow:'hidden'}}>
                  {/* Main row */}
                  <div style={{display:'flex',alignItems:'center',gap:10,padding:'13px 16px',cursor:'pointer'}} onClick={()=>setExpanded(isExpanded?null:group.domain)}>
                    <div style={{fontSize:18,flexShrink:0}}>{latest.action==='approved'?'✅':'🚫'}</div>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:13,fontFamily:'monospace',color:'#e6edf3',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{group.domain}</div>
                      <div style={{fontSize:10,color:'#484f58',marginTop:2}}>{group.actions.length} действий · последнее {fmtTime(latest.createdAt)}</div>
                    </div>
                    {rt!=null&&(
                      <div style={{fontSize:11,color:rt<30?'#3fb950':rt<120?'#f0a84a':'#f85149',fontFamily:'monospace',background:'#0d1117',padding:'2px 7px',borderRadius:4,border:'1px solid #21262d',flexShrink:0}}>
                        ⏱ {rt<60?`${rt}с`:`${Math.floor(rt/60)}м ${rt%60}с`}
                      </div>
                    )}
                    <div style={{fontSize:12,fontWeight:600,color:latest.action==='approved'?'#3fb950':'#f85149',flexShrink:0}}>
                      {latest.action==='approved'?'Одобрен':'Заблокирован'}
                    </div>
                    {latest.isGlobal&&<span style={{background:'rgba(137,87,229,0.1)',border:'1px solid rgba(137,87,229,0.25)',borderRadius:3,padding:'0 5px',fontSize:9,color:'#8957e5',flexShrink:0}}>Глобально</span>}
                    <div style={{display:'flex',gap:5,flexShrink:0}}>
                      <button
                        style={{padding:'5px 10px',background:latest.action==='approved'?'rgba(248,81,73,0.08)':'rgba(63,185,80,0.08)',border:`1px solid ${latest.action==='approved'?'rgba(248,81,73,0.3)':'rgba(63,185,80,0.3)'}`,borderRadius:6,color:latest.action==='approved'?'#f85149':'#3fb950',fontSize:11,fontWeight:600,cursor:'pointer',fontFamily:'inherit',opacity:deciding===group.domain?0.5:1}}
                        onClick={(e)=>{e.stopPropagation();handleChangeDecision(group.domain,latest.action==='approved'?'blocked':'approved');}}
                        disabled={deciding===group.domain}>
                        {deciding===group.domain?'...':latest.action==='approved'?'🚫 Заблокировать':'✅ Открыть'}
                      </button>
                      <span style={{color:'#484f58',fontSize:12,display:'flex',alignItems:'center'}}>{isExpanded?'▲':'▼'}</span>
                    </div>
                  </div>

                  {/* Expanded — history of actions for this domain */}
                  {isExpanded&&(
                    <div style={{borderTop:'1px solid #21262d',padding:'10px 16px',background:'#0d1117'}}>
                      <div style={{fontSize:10,color:'#484f58',marginBottom:8,textTransform:'uppercase',letterSpacing:1}}>История действий по домену</div>
                      {group.actions.map((action:any, i:number)=>{
                        const art = parseRt(action.reason);
                        return(
                          <div key={action.id} style={{display:'flex',alignItems:'center',gap:10,padding:'7px 0',borderBottom:i<group.actions.length-1?'1px solid #21262d':'none'}}>
                            <span style={{fontSize:14}}>{action.action==='approved'?'✅':'🚫'}</span>
                            <span style={{fontSize:12,color:action.action==='approved'?'#3fb950':'#f85149',fontWeight:600,flexShrink:0}}>
                              {action.action==='approved'?'Одобрен':'Заблокирован'}
                            </span>
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
