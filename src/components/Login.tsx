import React, { useState } from 'react';
import { login } from '../api';

interface Props {
  onLogin: (token: string, user: any) => void;
}

export default function Login({ onLogin }: Props) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await login(email, password);
      onLogin(res.data.access_token, res.data.user);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Ошибка входа');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={styles.page}>
      <div style={styles.glow} />
      <div style={styles.card}>
        <div style={styles.logo}>
          <div style={styles.shield}>🛡️</div>
          <div>
            <h1 style={styles.title}>SafeHos</h1>
            <p style={styles.subtitle}>Панель модератора</p>
          </div>
        </div>

        {error && <div style={styles.error}>{error}</div>}

        <form onSubmit={handleSubmit} style={styles.form}>
          <div style={styles.field}>
            <label style={styles.label}>Email</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              style={styles.input}
              placeholder="moderator@company.com"
              required
            />
          </div>
          <div style={styles.field}>
            <label style={styles.label}>Пароль</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              style={styles.input}
              placeholder="••••••••"
              required
            />
          </div>
          <button type="submit" style={styles.btn} disabled={loading}>
            {loading ? 'Входим...' : 'Войти в панель'}
          </button>
        </form>

        <p style={styles.footer}>SafeHos Security Platform</p>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: '#0d1117',
    position: 'relative',
    overflow: 'hidden',
  },
  glow: {
    position: 'fixed',
    top: -100,
    left: '50%',
    transform: 'translateX(-50%)',
    width: 600,
    height: 600,
    background: 'radial-gradient(circle, rgba(56,139,253,0.1) 0%, transparent 70%)',
    pointerEvents: 'none',
  },
  card: {
    background: '#161b22',
    border: '1px solid #30363d',
    borderRadius: 16,
    padding: '40px 36px',
    width: '100%',
    maxWidth: 400,
    position: 'relative',
    zIndex: 1,
  },
  logo: {
    display: 'flex',
    alignItems: 'center',
    gap: 14,
    marginBottom: 32,
  },
  shield: {
    fontSize: 40,
    background: 'linear-gradient(135deg, #388bfd, #1f6feb)',
    borderRadius: 12,
    width: 56,
    height: 56,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '0 0 20px rgba(56,139,253,0.3)',
  },
  title: {
    fontSize: 22,
    fontWeight: 700,
    color: '#fff',
  },
  subtitle: {
    fontSize: 13,
    color: '#7d8590',
    marginTop: 2,
  },
  error: {
    background: 'rgba(248,81,73,0.1)',
    border: '1px solid rgba(248,81,73,0.3)',
    borderRadius: 8,
    padding: '10px 14px',
    color: '#f85149',
    fontSize: 13,
    marginBottom: 16,
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
  },
  field: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  label: {
    fontSize: 13,
    color: '#7d8590',
    fontWeight: 500,
  },
  input: {
    padding: '10px 14px',
    background: '#0d1117',
    border: '1px solid #30363d',
    borderRadius: 8,
    color: '#e6edf3',
    fontSize: 14,
    outline: 'none',
    fontFamily: 'inherit',
  },
  btn: {
    padding: '12px',
    background: 'linear-gradient(135deg, #388bfd, #1f6feb)',
    color: '#fff',
    border: 'none',
    borderRadius: 8,
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
    marginTop: 4,
    boxShadow: '0 4px 12px rgba(56,139,253,0.3)',
    fontFamily: 'inherit',
  },
  footer: {
    textAlign: 'center',
    fontSize: 11,
    color: '#484f58',
    marginTop: 24,
  },
};
