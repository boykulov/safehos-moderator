import React, { useState, useEffect, useRef, useCallback } from 'react';
import { getPendingEvents, makeDecision, getHistory } from '../api';
import api from '../api';

interface Props {
  user: any;
  onLogout: () => void;
}

export default function ModeratorPanel({ user, onLogout }: Props) {
  const [events, setEvents] = useState<any[]>([]);
  const [history, setHistory] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState<'pending' | 'history'>('pending');
  const [deciding, setDeciding] = useState<string | null>(null);
  const [notification, setNotification] = useState<{ msg: string; type: 'info' | 'success' | 'error' } | null>(null);
  const knownEventIds = useRef<Set<string>>(new Set());
  const notifTimer = useRef<any>(null);

  const showNotification = (msg: string, type: 'info' | 'success' | 'error' = 'info') => {
    if (notifTimer.current) clearTimeout(notifTimer.current);
    setNotification({ msg, type });
    notifTimer.current = setTimeout(() => setNotification(null), 4000);
  };

  const playSound = () => {
    try {
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.3, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
      osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.4);
    } catch(e) {}
  };

  const fetchEvents = useCallback(async () => {
    try {
      const res = await getPendingEvents(user.companyId);
      const newEvents: any[] = res.data;
      const trulyNew = newEvents.filter(e => !knownEventIds.current.has(e.id));
      if (trulyNew.length > 0) {
        trulyNew.forEach(e => knownEventIds.current.add(e.id));
        showNotification(`🚨 Новое событие: ${trulyNew[0].domain}`, 'info');
        playSound();
      }
      setEvents(newEvents);
    } catch (err) {}
  }, [user.companyId]);

  const fetchHistory = useCallback(async () => {
    try {
      const res = await getHistory();
      setHistory(res.data);
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
      await makeDecision(eventId, action, '', isGlobal);
      showNotification(action === 'approved' ? '✅ Домен одобрен' : '🚫 Домен заблокирован', action === 'approved' ? 'success' : 'error');
      await fetchEvents(); await fetchHistory();
    } catch (err) {
      showNotification('Ошибка при принятии решения', 'error');
    } finally { setDeciding(null); }
  };

  // Изменить решение из истории — создаём новое pending событие и сразу решаем
  const handleChangeDecision = async (item: any, newAction: 'approved' | 'blocked') => {
    setDeciding(item.id);
    try {
      // Создаём новое событие через domain check
      const checkRes = await api.post('/domain/check', {
        url: `https://${item.domain}`,
        tabId: 'moderator-override',
      });
      if (checkRes.data.eventId) {
        await makeDecision(checkRes.data.eventId, newAction, 'Решение изменено модератором', false);
        showNotification(
          newAction === 'approved' ? `✅ ${item.domain} — доступ открыт` : `🚫 ${item.domain} — заблокирован`,
          newAction === 'approved' ? 'success' : 'error'
        );
        await fetchHistory();
      }
    } catch (err) {
      showNotification('Ошибка при изменении решения', 'error');
    } finally { setDeciding(null); }
  };

  const getRiskColor = (score: number) => score >= 70 ? '#f85149' : score >= 40 ? '#f0a84a' : '#3fb950';
  const getRiskLabel = (score: number) => score >= 70 ? 'Высокий' : score >= 40 ? 'Средний' : 'Низкий';
  const formatTime = (d: string) => new Date(d).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  const parseEventUrl = (r: string) => { const m = r?.match(/URL: ([^\s|]+)/); return m ? m[1] : null; };
  const parseFlags = (r: string) => { const m = r?.match(/Flags: (.+)/); return m ? m[1].split(', ').filter((f: string) => f.trim()) : []; };

  const notifColors = {
    info: { bg: 'rgba(56,139,253,0.1)', border: 'rgba(56,139,253,0.3)', color: '#388bfd' },
    success: { bg: 'rgba(63,185,80,0.1)', border: 'rgba(63,185,80,0.3)', color: '#3fb950' },
    error: { bg: 'rgba(248,81,73,0.1)', border: 'rgba(248,81,73,0.3)', color: '#f85149' },
  };

  return (
    <div style={styles.layout}>
      <div style={styles.sidebar}>
        <div style={styles.sidebarLogo}>
          <span style={{ fontSize: 28 }}>🛡️</span>
          <div>
            <div style={styles.brandName}>SafeHos</div>
            <div style={styles.brandSub}>Moderator Panel</div>
          </div>
        </div>
        <nav style={styles.nav}>
          <button style={{ ...styles.navItem, ...(activeTab === 'pending' ? styles.navActive : {}) }} onClick={() => setActiveTab('pending')}>
            <span>🔍</span><span>Очередь</span>
            {events.length > 0 && <span style={styles.badge}>{events.length}</span>}
          </button>
          <button style={{ ...styles.navItem, ...(activeTab === 'history' ? styles.navActive : {}) }} onClick={() => { setActiveTab('history'); fetchHistory(); }}>
            <span>📋</span><span>История</span>
          </button>
        </nav>
        <div style={styles.sidebarFooter}>
          <div style={styles.userInfo}>
            <div style={styles.avatar}>{user.email[0].toUpperCase()}</div>
            <div>
              <div style={styles.userEmail}>{user.email}</div>
              <div style={styles.userRole}>{user.role}</div>
            </div>
          </div>
          <button style={styles.logoutBtn} onClick={onLogout}>Выйти</button>
        </div>
      </div>

      <div style={styles.main}>
        <div style={styles.header}>
          <div>
            <h1 style={styles.pageTitle}>{activeTab === 'pending' ? '🔍 Очередь проверки' : '📋 История решений'}</h1>
            <p style={styles.pageSubtitle}>
              {activeTab === 'pending' ? `${events.length} событий ожидают · каждые 3 сек` : `${history.length} решений принято`}
            </p>
          </div>
          <div style={styles.liveIndicator}>
            <div style={styles.dot} /><span style={{ fontSize: 13, color: '#3fb950' }}>Live</span>
          </div>
        </div>

        {notification && (
          <div style={{ ...styles.notification, background: notifColors[notification.type].bg, border: `1px solid ${notifColors[notification.type].border}`, color: notifColors[notification.type].color }}>
            {notification.msg}
          </div>
        )}

        {activeTab === 'pending' && (
          <div style={styles.content}>
            {events.length === 0 ? (
              <div style={styles.empty}>
                <div style={{ fontSize: 56, marginBottom: 16 }}>✅</div>
                <h3 style={{ color: '#3fb950', marginBottom: 8 }}>Всё чисто!</h3>
                <p style={{ color: '#7d8590', fontSize: 14 }}>Нет подозрительных событий</p>
              </div>
            ) : events.map(event => {
              const eventUrl = parseEventUrl(event.reason);
              const flags = parseFlags(event.reason);
              return (
                <div key={event.id} style={{ ...styles.eventCard, borderColor: event.riskScore >= 70 ? 'rgba(248,81,73,0.4)' : '#30363d' }}>
                  <div style={styles.eventHeader}>
                    <div style={styles.domainRow}>
                      <span style={{ fontSize: 20 }}>⚠️</span>
                      <span style={styles.domainName}>{event.domain}</span>
                    </div>
                    <div style={{ ...styles.riskBadge, background: `${getRiskColor(event.riskScore)}22`, border: `1px solid ${getRiskColor(event.riskScore)}44`, color: getRiskColor(event.riskScore) }}>
                      {getRiskLabel(event.riskScore)} · {event.riskScore}%
                    </div>
                  </div>

                  {eventUrl && (
                    <div style={styles.urlRow}>
                      <span>🔗</span>
                      <span style={styles.urlText}>{eventUrl}</span>
                      <a href={eventUrl} target="_blank" rel="noreferrer" style={styles.btnOpenUrl}>Открыть →</a>
                    </div>
                  )}

                  <div style={styles.eventMeta}>
                    <span style={styles.metaItem}>🏢 {event.companyId}</span>
                    <span style={styles.metaItem}>🕐 {formatTime(event.createdAt)}</span>
                    <span style={styles.metaItem}>📊 {event.riskScore}/100</span>
                  </div>

                  {flags.length > 0 && (
                    <div style={styles.flags}>
                      {flags.map((flag: string, i: number) => <span key={i} style={styles.flag}>{flag}</span>)}
                    </div>
                  )}

                  <div style={styles.actions}>
                    <button style={styles.btnApprove} onClick={() => handleDecision(event.id, 'approved')} disabled={deciding === event.id}>
                      {deciding === event.id ? '...' : '✅ Одобрить'}
                    </button>
                    <button style={styles.btnBlock} onClick={() => handleDecision(event.id, 'blocked')} disabled={deciding === event.id}>
                      {deciding === event.id ? '...' : '🚫 Заблокировать'}
                    </button>
                    <button style={styles.btnGlobal} onClick={() => handleDecision(event.id, 'blocked', true)} disabled={deciding === event.id}>
                      🌍 Глобально
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {activeTab === 'history' && (
          <div style={styles.content}>
            {history.length === 0 ? (
              <div style={styles.empty}>
                <div style={{ fontSize: 48, marginBottom: 16 }}>📋</div>
                <p style={{ color: '#7d8590' }}>История пуста</p>
              </div>
            ) : history.map((item: any) => (
              <div key={item.id} style={styles.historyItem}>
                <div style={{ fontSize: 20, flexShrink: 0 }}>{item.action === 'approved' ? '✅' : '🚫'}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={styles.historyDomain}>{item.domain}</div>
                  {item.isGlobal && <span style={styles.globalBadge}>Глобально</span>}
                </div>
                <div style={{ color: item.action === 'approved' ? '#3fb950' : '#f85149', fontSize: 13, fontWeight: 600, flexShrink: 0 }}>
                  {item.action === 'approved' ? 'Одобрен' : 'Заблокирован'}
                </div>
                <div style={{ fontSize: 12, color: '#484f58', margin: '0 12px', flexShrink: 0 }}>{formatTime(item.createdAt)}</div>
                
                {/* Кнопка изменить решение */}
                <button
                  style={{
                    ...( item.action === 'approved' ? styles.btnChangeBlock : styles.btnChangeApprove ),
                    opacity: deciding === item.id ? 0.5 : 1,
                  }}
                  onClick={() => handleChangeDecision(item, item.action === 'approved' ? 'blocked' : 'approved')}
                  disabled={deciding === item.id}
                  title={item.action === 'approved' ? 'Заблокировать этот домен' : 'Открыть доступ к домену'}
                >
                  {deciding === item.id ? '...' : item.action === 'approved' ? '🚫 Заблокировать' : '✅ Открыть доступ'}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  layout: { display: 'flex', minHeight: '100vh', background: '#0d1117' },
  sidebar: { width: 240, background: '#161b22', borderRight: '1px solid #21262d', display: 'flex', flexDirection: 'column', padding: '20px 0', position: 'fixed', top: 0, left: 0, bottom: 0 },
  sidebarLogo: { display: 'flex', alignItems: 'center', gap: 10, padding: '0 20px 24px', borderBottom: '1px solid #21262d' },
  brandName: { fontSize: 16, fontWeight: 700, color: '#fff' },
  brandSub: { fontSize: 11, color: '#7d8590' },
  nav: { padding: '16px 12px', display: 'flex', flexDirection: 'column', gap: 4, flex: 1 },
  navItem: { display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 8, border: 'none', background: 'transparent', color: '#7d8590', fontSize: 14, cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit' },
  navActive: { background: 'rgba(56,139,253,0.1)', color: '#388bfd' },
  badge: { marginLeft: 'auto', background: '#f85149', color: '#fff', borderRadius: 10, padding: '1px 7px', fontSize: 11, fontWeight: 700 },
  sidebarFooter: { padding: '16px', borderTop: '1px solid #21262d' },
  userInfo: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 },
  avatar: { width: 32, height: 32, background: 'linear-gradient(135deg, #388bfd, #8957e5)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, color: '#fff' },
  userEmail: { fontSize: 12, color: '#e6edf3', fontWeight: 500 },
  userRole: { fontSize: 11, color: '#7d8590' },
  logoutBtn: { width: '100%', padding: '8px', background: 'transparent', border: '1px solid #30363d', borderRadius: 6, color: '#7d8590', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' },
  main: { marginLeft: 240, flex: 1, padding: '28px 32px' },
  header: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 24 },
  pageTitle: { fontSize: 22, fontWeight: 700, color: '#fff', marginBottom: 4 },
  pageSubtitle: { fontSize: 13, color: '#7d8590' },
  liveIndicator: { display: 'flex', alignItems: 'center', gap: 6, background: 'rgba(63,185,80,0.1)', border: '1px solid rgba(63,185,80,0.2)', borderRadius: 20, padding: '6px 12px' },
  dot: { width: 8, height: 8, background: '#3fb950', borderRadius: '50%' },
  notification: { borderRadius: 10, padding: '12px 16px', fontSize: 14, marginBottom: 20 },
  content: { display: 'flex', flexDirection: 'column', gap: 16 },
  empty: { textAlign: 'center', padding: '80px 20px' },
  eventCard: { background: '#161b22', border: '1px solid #30363d', borderRadius: 12, padding: '20px' },
  eventHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  domainRow: { display: 'flex', alignItems: 'center', gap: 8 },
  domainName: { fontSize: 17, fontWeight: 600, color: '#e6edf3', fontFamily: 'monospace' },
  riskBadge: { padding: '4px 10px', borderRadius: 20, fontSize: 12, fontWeight: 600 },
  urlRow: { display: 'flex', alignItems: 'center', gap: 8, background: '#0d1117', border: '1px solid #21262d', borderRadius: 8, padding: '10px 12px', marginBottom: 12 },
  urlText: { fontSize: 12, color: '#7d8590', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  btnOpenUrl: { fontSize: 11, color: '#fff', background: '#388bfd', padding: '4px 10px', borderRadius: 6, textDecoration: 'none', flexShrink: 0, fontWeight: 600 },
  eventMeta: { display: 'flex', gap: 16, marginBottom: 12 },
  metaItem: { fontSize: 12, color: '#7d8590' },
  flags: { display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 16 },
  flag: { background: 'rgba(240,168,74,0.1)', border: '1px solid rgba(240,168,74,0.2)', borderRadius: 4, padding: '2px 8px', fontSize: 11, color: '#f0a84a' },
  actions: { display: 'flex', gap: 8 },
  btnApprove: { flex: 1, padding: '10px', background: 'rgba(63,185,80,0.1)', border: '1px solid rgba(63,185,80,0.3)', borderRadius: 8, color: '#3fb950', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' },
  btnBlock: { flex: 1, padding: '10px', background: 'rgba(248,81,73,0.1)', border: '1px solid rgba(248,81,73,0.3)', borderRadius: 8, color: '#f85149', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' },
  btnGlobal: { padding: '10px 14px', background: 'rgba(137,87,229,0.1)', border: '1px solid rgba(137,87,229,0.3)', borderRadius: 8, color: '#8957e5', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' },
  historyItem: { display: 'flex', alignItems: 'center', gap: 12, background: '#161b22', border: '1px solid #21262d', borderRadius: 8, padding: '12px 16px' },
  historyDomain: { fontSize: 14, color: '#e6edf3', fontFamily: 'monospace' },
  globalBadge: { marginLeft: 8, background: 'rgba(137,87,229,0.1)', border: '1px solid rgba(137,87,229,0.3)', borderRadius: 4, padding: '1px 6px', fontSize: 10, color: '#8957e5' },
  btnChangeApprove: { padding: '6px 12px', background: 'rgba(63,185,80,0.1)', border: '1px solid rgba(63,185,80,0.3)', borderRadius: 6, color: '#3fb950', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0 },
  btnChangeBlock: { padding: '6px 12px', background: 'rgba(248,81,73,0.1)', border: '1px solid rgba(248,81,73,0.3)', borderRadius: 6, color: '#f85149', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0 },
};
