import axios from 'axios';
import { API_BASE } from './config';

const api = axios.create({ baseURL: API_BASE });

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

export const login = (email: string, password: string) =>
  api.post('/auth/login', { email, password });

export const getPendingEvents = (companyId: string) =>
  api.get('/domain/pending');

export const makeDecision = (eventId: string, action: string, reason: string, isGlobal: boolean) =>
  api.post(`/decision/${eventId}`, { action, reason, isGlobal });

export const getHistory = () =>
  api.get('/decision/history');

export default api;
