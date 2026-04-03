import React, { useState, useEffect, useRef, useCallback } from 'react';
import { getPendingEvents, makeDecision, getHistory } from '../api';
import api from '../api';

interface Props {
  user: any;
  onLogout: () => void;
}

function useTimer(startTime: string) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const start = new Date(startTime).getTime();
    const tick = () => setElapsed(Math.floor((Date.now() - start) / 1000));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [startTime]);
  const m = Math.floor(elapsed / 60);
  const s = elapsed % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function EventTimer({ startTime, riskScore }: { startTime: string; riskScore: number }) {
  const time = useTimer(startTime);
  const elapsed = Math.floor((Date.now() - new Date(startTime).getTime()) / 1000);
  const color = elapsed > 120 ? '#f85149' : elapsed > 60 ? '#f0a84a' : '#3fb950';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontFamily: 'monospace', fontSize: 13, color, fontWeight: 700 }}>
      <span>⏱</span><span>{time}</span>
    </div>
  );
}

export default function ModeratorPanel({ user, onLogout }: Props) {
  const [events, setEvents] = useState<any[]>([]);
  const [history, setHistory] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState<'pending' | 'history'>('pending');
  const [deciding, setDeciding] = useState<string | null>(null);
  const [notification, setNotification] = useState<{ msg: string; type: string } | null>(null);
  const knownEventIds = useRef<Set<string>>(new Set());
  const notifTimer = useRef<any>(null);
  const [stats, setStats] = useState({ total: 0, approved: 0, blocked: 0, avgTime: 0 });

  const showNotification = (msg: string, type = 'info') => {
    if (notifTimer.current) clearTimeout(notifTimer.current);
    setNotification({ msg, type });
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
      const trulyNew = newEvents.filter(e => !knownEventIds.current.has(e.id));
      if (trulyNew.length > 0) {
        trulyNew.forEach(e => knownEventIds.current.add(e.id));
        showNotification(`🚨 Новое событие: ${trulyNew[0].domain}`, 'warning');
        playSound(660);
      }
      setEvents(newEvents);
    } catch (err) {}
  }, [user.companyId]);

  const fetchHistory = useCallback(async () => {
    try {
      const res = await getHistory();
      const h = res.data;
      setHistory(h);
      // Считаем статистику
      const approved = h.filter((i: any) => i.action === 'approved').length;
      const blocked = h.filter((i: any) => i.action === 'blocked').length;
      setStats({ total: h.length, approved, blocked, avgTime: 0 });
    } catch (err) {}
  }, []);

  useEffect(() => {
    fetchEvents(); fetchHistory();
    const interval = setInterval(fetchEvents, 3000);
    return () => clearInterval(interval);
    // eslint-disable-next-line
  }, []);

  const handleDecision = async (eventId: string, action: 'approved' | 'blocked', isGlobal = false) => {
    setDeciding(eventId);
    knownEventIds.current.delete(eventId);
    try {
      const startTime = events.find(e => e.id === eventId)?.createdAt;
      const responseTime = startTime ? Math.floor((Date.now() - new Date(startTime).getTime()) / 1000) : 0;
      await makeDecision(eventId, action, `Response time: ${responseTime}s`, isGlobal);
      playSound(action === 'approved' ? 1047 : 440);
      showNotification(
        action === 'approved' ? `✅ Одобрен за ${responseTime}с` : `🚫 Заблокирован за ${responseTime}с`,
        action === 'approved' ? 'success' : 'error'
      );
      await fetchEvents(); await fetchHistory();
    } catch (err) {
      showNotification('Ошибка при принятии решения', 'error');
    } finally { setDeciding(null); }
  };

  const handleChangeDecision = async (item: any, newAction: 'approved' | 'blocked') => {
    setDeciding(item.id);
    try {
      await api.delete(`/domain/decision/${encodeURIComponent(item.domain)}`);
      const checkRes = await api.post('/domain/check', {
        url: `https://${item.domain}`, tabId: 'moderator-override',
      });
      if (checkRes.data.eventId) {
        await makeDecision(checkRes.data.eventId, newAction, 'Решение изменено модератором', false);
      }
      playSound(newAction === 'approved' ? 1047 : 440);
      showNotification(
        newAction === 'approved' ? `✅ ${item.domain} — доступ открыт` : `🚫 ${item.domain} — заблокирован`,
        newAction === 'approved' ? 'success' : 'error'
      );
      await fetchHistory();
    } catch (err) {
      showNotification('Ошибка', 'error');
    } finally { setDeciding(null); }
  };

  const getRiskColor = (s: number) => s >= 70 ? '#f85149' : s >= 40 ? '#f0a84a' : '#3fb950';
  const getRiskLabel = (s: number) => s >= 70 ? 'Высокий' : s >= 40 ? 'Средний' : 'Низкий';
  const formatDateTime = (d: string) => new Date(d).toLocaleString('ru-RU', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  const parseUrl = (r: string) => { const m = r?.match(/URL: ([^\s|]+)/); return m ? m[1] : null; };
  const parseFlags = (r: string) => { const m = r?.match(/Flags: (.+)/); return m ? m[1].split(', ').filter((f: string) => f) : []; };

  const nc: Record<string, any> = {
    info: { bg: 'rgba(56,139,253,0.12)', b: 'rgba(56,139,253,0.3)', c: '#388bfd' },
    success: { bg: 'rgba(63,185,80,0.12)', b: 'rgba(63,185,80,0.3)', c: '#3fb950' },
    error: { bg: 'rgba(248,81,73,0.12)', b: 'rgba(248,81,73,0.3)', c: '#f85149' },
    warning: { bg: 'rgba(240,168,74,0.12)', b: 'rgba(240,168,74,0.3)', c: '#f0a84a' },
  };

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: '#0d1117', fontFamily: '-apple-system, BlinkMacSystemFont, Inter, sans-serif' }}>
      {/* Sidebar */}
      <div style={{ width: 240, background: '#161b22', borderRight: '1px solid #21262d', display: 'flex', flexDirection: 'column', padding: '20px 0', position: 'fixed', top: 0, left: 0, bottom: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0 20px 20px', borderBottom: '1px solid #21262d' }}>
          <div style={{ fontSize: 28, background: 'linear-gradient(135deg,#388bfd,#8957e5)', borderRadius: 10, width: 40, height: 40, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>🛡️</div>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#fff' }}>SafeHos</div>
            <div style={{ fontSize: 10, color: '#7d8590' }}>Moderator Panel</div>
          </div>
        </div>

        {/* Stats */}
        <div style={{ padding: '12px 16px', borderBottom: '1px solid #21262d' }}>
          <div style={{ fontSize: 10, color: '#484f58', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 1 }}>Статистика</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
            {[
              { label: 'Всего', value: stats.total, color: '#e6edf3' },
              { label: 'В очереди', value: events.length, color: events.length > 0 ? '#f85149' : '#3fb950' },
              { label: 'Одобрено', value: stats.approved, color: '#3fb950' },
              { label: 'Блокировано', value: stats.blocked, color: '#f85149' },
            ].map(s => (
              <div key={s.label} style={{ background: '#0d1117', borderRadius: 6, padding: '6px 8px', border: '1px solid #21262d' }}>
                <div style={{ fontSize: 16, fontWeight: 700, color: s.color }}>{s.value}</div>
                <div style={{ fontSize: 10, color: '#484f58' }}>{s.label}</div>
              </div>
            ))}
          </div>
        </div>

        <nav style={{ padding: '12px', flex: 1 }}>
          {[
            { id: 'pending', icon: '🔍', label: 'Очередь', count: events.length },
            { id: 'history', icon: '📋', label: 'История', count: null },
          ].map(item => (
            <button key={item.id}
              style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 8, border: 'none', background: activeTab === item.id ? 'rgba(56,139,253,0.1)' : 'transparent', color: activeTab === item.id ? '#388bfd' : '#7d8590', fontSize: 14, cursor: 'pointer', width: '100%', textAlign: 'left', fontFamily: 'inherit', marginBottom: 2 }}
              onClick={() => { setActiveTab(item.id as any); if (item.id === 'history') fetchHistory(); }}
            >
              <span>{item.icon}</span><span style={{ flex: 1 }}>{item.label}</span>
              {item.count != null && item.count > 0 && <span style={{ background: '#f85149', color: '#fff', borderRadius: 10, padding: '1px 7px', fontSize: 11, fontWeight: 700 }}>{item.count}</span>}
            </button>
          ))}
        </nav>

        <div style={{ padding: '12px 16px', borderTop: '1px solid #21262d' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <div style={{ width: 30, height: 30, background: 'linear-gradient(135deg,#388bfd,#8957e5)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, color: '#fff' }}>{user.email[0].toUpperCase()}</div>
            <div>
              <div style={{ fontSize: 11, color: '#e6edf3', fontWeight: 500, maxWidth: 130, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user.email}</div>
              <div style={{ fontSize: 10, color: '#7d8590' }}>{user.role}</div>
            </div>
          </div>
          <button onClick={onLogout} style={{ width: '100%', padding: '7px', background: 'transparent', border: '1px solid #30363d', borderRadius: 6, color: '#7d8590', fontSize: 11, cursor: 'pointer', fontFamily: 'inherit' }}>Выйти</button>
        </div>
      </div>

      {/* Main */}
      <div style={{ marginLeft: 240, flex: 1, padding: '24px 28px', maxWidth: 'calc(100vw - 240px)' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <div>
            <h1 style={{ fontSize: 20, fontWeight: 700, color: '#fff', marginBottom: 3 }}>
              {activeTab === 'pending' ? '🔍 Очередь проверки' : '📋 История решений'}
            </h1>
            <p style={{ fontSize: 12, color: '#7d8590' }}>
              {activeTab === 'pending' ? `${events.length} событий · обновление каждые 3 сек` : `${history.length} решений принято`}
            </p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, background: 'rgba(63,185,80,0.1)', border: '1px solid rgba(63,185,80,0.2)', borderRadius: 20, padding: '5px 10px' }}>
              <div style={{ width: 6, height: 6, background: '#3fb950', borderRadius: '50%' }} />
              <span style={{ fontSize: 12, color: '#3fb950' }}>Live</span>
            </div>
          </div>
        </div>

        {/* Notification */}
        {notification && (
          <div style={{ background: nc[notification.type]?.bg, border: `1px solid ${nc[notification.type]?.b}`, borderRadius: 10, padding: '11px 16px', color: nc[notification.type]?.c, fontSize: 13, marginBottom: 16, fontWeight: 500 }}>
            {notification.msg}
          </div>
        )}

        {/* Pending */}
        {activeTab === 'pending' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {events.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '80px 20px' }}>
                <div style={{ fontSize: 52, marginBottom: 14 }}>✅</div>
                <h3 style={{ color: '#3fb950', marginBottom: 6, fontSize: 17 }}>Всё чисто!</h3>
                <p style={{ color: '#7d8590', fontSize: 13 }}>Нет подозрительных событий</p>
              </div>
            ) : events.map(event => {
              const url = parseUrl(event.reason);
              const flags = parseFlags(event.reason);
              const rc = getRiskColor(event.riskScore);
              return (
                <div key={event.id} style={{ background: '#161b22', border: `1px solid ${event.riskScore >= 70 ? 'rgba(248,81,73,0.35)' : '#30363d'}`, borderRadius: 12, padding: '18px 20px', position: 'relative' }}>
                  {/* Top row */}
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 12, gap: 12 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
                      <span style={{ fontSize: 18 }}>⚠️</span>
                      <span style={{ fontSize: 16, fontWeight: 700, color: '#e6edf3', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{event.domain}</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                      <EventTimer startTime={event.createdAt} riskScore={event.riskScore} />
                      <div style={{ background: `${rc}20`, border: `1px solid ${rc}40`, color: rc, padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700 }}>
                        {getRiskLabel(event.riskScore)} {event.riskScore}%
                      </div>
                    </div>
                  </div>

                  {/* URL */}
                  {url && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#0d1117', border: '1px solid #21262d', borderRadius: 7, padding: '9px 12px', marginBottom: 10 }}>
                      <span style={{ fontSize: 13 }}>🔗</span>
                      <span style={{ fontSize: 12, color: '#7d8590', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{url}</span>
                      <a href={url} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: '#fff', background: '#388bfd', padding: '3px 9px', borderRadius: 5, textDecoration: 'none', fontWeight: 600, flexShrink: 0 }}>Открыть →</a>
                    </div>
                  )}

                  {/* Meta */}
                  <div style={{ display: 'flex', gap: 14, marginBottom: 10, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 11, color: '#7d8590' }}>🏢 {event.companyId}</span>
                    <span style={{ fontSize: 11, color: '#7d8590' }}>🕐 {formatDateTime(event.createdAt)}</span>
                    <span style={{ fontSize: 11, color: '#7d8590' }}>📊 Score: {event.riskScore}/100</span>
                  </div>

                  {/* Flags */}
                  {flags.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 14 }}>
                      {flags.map((f: string, i: number) => (
                        <span key={i} style={{ background: 'rgba(240,168,74,0.1)', border: '1px solid rgba(240,168,74,0.25)', borderRadius: 4, padding: '2px 7px', fontSize: 10, color: '#f0a84a' }}>{f}</span>
                      ))}
                    </div>
                  )}

                  {/* Actions */}
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button style={{ flex: 1, padding: '10px', background: 'rgba(63,185,80,0.08)', border: '1px solid rgba(63,185,80,0.3)', borderRadius: 8, color: '#3fb950', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
                      onClick={() => handleDecision(event.id, 'approved')} disabled={deciding === event.id}>
                      {deciding === event.id ? '...' : '✅ Одобрить'}
                    </button>
                    <button style={{ flex: 1, padding: '10px', background: 'rgba(248,81,73,0.08)', border: '1px solid rgba(248,81,73,0.3)', borderRadius: 8, color: '#f85149', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
                      onClick={() => handleDecision(event.id, 'blocked')} disabled={deciding === event.id}>
                      {deciding === event.id ? '...' : '🚫 Заблокировать'}
                    </button>
                    <button style={{ padding: '10px 12px', background: 'rgba(137,87,229,0.08)', border: '1px solid rgba(137,87,229,0.3)', borderRadius: 8, color: '#8957e5', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
                      onClick={() => handleDecision(event.id, 'blocked', true)} disabled={deciding === event.id}>
                      🌍
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* History */}
        {activeTab === 'history' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {history.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '60px 20px' }}>
                <div style={{ fontSize: 44, marginBottom: 12 }}>📋</div>
                <p style={{ color: '#7d8590', fontSize: 13 }}>История пуста</p>
              </div>
            ) : history.map((item: any) => {
              const responseMatch = item.reason?.match(/Response time: (\d+)s/);
              const responseTime = responseMatch ? parseInt(responseMatch[1]) : null;
              return (
                <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 10, background: '#161b22', border: '1px solid #21262d', borderRadius: 8, padding: '11px 16px' }}>
                  <div style={{ fontSize: 18, flexShrink: 0 }}>{item.action === 'approved' ? '✅' : '🚫'}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, color: '#e6edf3', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.domain}</div>
                    {item.isGlobal && <span style={{ background: 'rgba(137,87,229,0.1)', border: '1px solid rgba(137,87,229,0.25)', borderRadius: 3, padding: '0 5px', fontSize: 9, color: '#8957e5' }}>Глобально</span>}
                  </div>
                  {responseTime != null && (
                    <div style={{ fontSize: 11, color: responseTime < 30 ? '#3fb950' : responseTime < 120 ? '#f0a84a' : '#f85149', fontFamily: 'monospace', flexShrink: 0, background: '#0d1117', padding: '2px 8px', borderRadius: 4, border: '1px solid #21262d' }}>
                      ⏱ {responseTime < 60 ? `${responseTime}с` : `${Math.floor(responseTime/60)}м ${responseTime%60}с`}
                    </div>
                  )}
                  <div style={{ fontSize: 12, fontWeight: 600, color: item.action === 'approved' ? '#3fb950' : '#f85149', flexShrink: 0 }}>
                    {item.action === 'approved' ? 'Одобрен' : 'Заблокирован'}
                  </div>
                  <div style={{ fontSize: 11, color: '#484f58', flexShrink: 0, margin: '0 4px' }}>
                    {formatDateTime(item.createdAt)}
                  </div>
                  <button
                    style={{ padding: '5px 10px', background: item.action === 'approved' ? 'rgba(248,81,73,0.08)' : 'rgba(63,185,80,0.08)', border: `1px solid ${item.action === 'approved' ? 'rgba(248,81,73,0.3)' : 'rgba(63,185,80,0.3)'}`, borderRadius: 6, color: item.action === 'approved' ? '#f85149' : '#3fb950', fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0, opacity: deciding === item.id ? 0.5 : 1 }}
                    onClick={() => handleChangeDecision(item, item.action === 'approved' ? 'blocked' : 'approved')}
                    disabled={deciding === item.id}
                  >
                    {deciding === item.id ? '...' : item.action === 'approved' ? '🚫 Блок' : '✅ Открыть'}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
