import axios from 'axios';

const API_BASE = process.env.REACT_APP_API_URL || 'https://api.safehos.com/api/v1';

const api = axios.create({ baseURL: API_BASE });

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Auth
export const login = (email: string, password: string) =>
  api.post('/auth/login', { email, password });

// Domain checks
export const getPendingEvents = (_: string) => api.get('/domain/pending');
export const getDeferredEvents = () => api.get('/domain/deferred');


// Decisions
export const makeDecision = (
  eventId: string, action: string, reason: string, isGlobal: boolean,
  options?: { isWildcard?: boolean; category?: string }
) => api.post(`/decision/${eventId}`, { action, reason, isGlobal, ...options });

export const deferEvent = (eventId: string, minutes: number) =>
  api.post(`/domain/defer/${eventId}`, { minutes });

export const getHistory = () => api.get('/decision/history');

// Allowlist / Blocklist
export const getAllowlist = (globalOnly?: boolean) =>
  api.get('/domain/allowlist', { params: globalOnly !== undefined ? { global: globalOnly } : {} });

export const getBlocklist = () => api.get('/domain/blocklist');

export const addToAllowlist = (data: {
  domain: string; isGlobal?: boolean; isWildcard?: boolean;
  category?: string; notes?: string;
}) => api.post('/domain/allowlist', data);



export const removeFromList = (domain: string) =>
  api.delete(`/domain/decision/${encodeURIComponent(domain)}`);

export default api;

export const updateAllowlistEntry = (id: string, data: { category?: string; notes?: string; isWildcard?: boolean }) =>
  api.patch(`/domain/allowlist/${id}`, data);

export const exportAllowlist = () =>
  api.get('/domain/allowlist/export', { responseType: 'blob' });

export const getRecentlyApproved = () =>
  api.get('/decision/recent-approved');
