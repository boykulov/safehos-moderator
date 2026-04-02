export interface User {
  id: string;
  email: string;
  role: string;
  companyId: string;
}

export interface SuspiciousEvent {
  id: string;
  domain: string;
  companyId: string;
  decision: string;
  riskScore: number;
  reason: string;
  createdAt: string;
}

export interface AuthState {
  token: string | null;
  user: User | null;
}
