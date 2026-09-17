import { HttpClient, HttpInterceptorFn } from '@angular/common/http';
import { inject, Injectable, signal } from '@angular/core';
import { Observable, tap } from 'rxjs';
import { API_URL } from './api-url';
import { AiModel, AuthResponse, Dashboard, Project, Upload, UsageEvent, User } from './types';

const TOKEN_KEY = 'ai-usage-token';
const USER_KEY = 'ai-usage-user';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  readonly user = signal<User | null>(this.readUser());
  get token() { return sessionStorage.getItem(TOKEN_KEY); }

  login(email: string, password: string) {
    return this.http.post<AuthResponse>(`${API_URL}/auth/login`, { email, password }).pipe(tap((value) => this.store(value)));
  }

  register(email: string, password: string, displayName: string) {
    return this.http.post<AuthResponse>(`${API_URL}/auth/register`, { email, password, displayName }).pipe(tap((value) => this.store(value)));
  }

  logout() {
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(USER_KEY);
    this.user.set(null);
  }

  private store(value: AuthResponse) {
    sessionStorage.setItem(TOKEN_KEY, value.accessToken);
    sessionStorage.setItem(USER_KEY, JSON.stringify(value.user));
    this.user.set(value.user);
  }

  private readUser(): User | null {
    try { return JSON.parse(sessionStorage.getItem(USER_KEY) ?? 'null') as User | null; }
    catch { return null; }
  }
}

export const authInterceptor: HttpInterceptorFn = (request, next) => {
  const token = inject(AuthService).token;
  return next(token ? request.clone({ setHeaders: { Authorization: `Bearer ${token}` } }) : request);
};

@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly http = inject(HttpClient);
  dashboard() { return this.http.get<Dashboard>(`${API_URL}/dashboard`); }
  projects() { return this.http.get<Project[]>(`${API_URL}/projects`); }
  createProject(payload: { name: string; color: string }) { return this.http.post<Project>(`${API_URL}/projects`, payload); }
  events() { return this.http.get<UsageEvent[]>(`${API_URL}/events`); }
  createEvent(payload: object) { return this.http.post<UsageEvent>(`${API_URL}/events`, payload); }
  deleteEvent(id: string) { return this.http.delete(`${API_URL}/events/${id}`); }
  uploads() { return this.http.get<Upload[]>(`${API_URL}/uploads`); }
  upload(body: FormData) { return this.http.post<Upload>(`${API_URL}/uploads`, body); }
  models() { return this.http.get<AiModel[]>(`${API_URL}/models`); }
  createModel(payload: object) { return this.http.post<AiModel>(`${API_URL}/models`, payload); }
  createRule(modelId: string, payload: object) { return this.http.post(`${API_URL}/models/${modelId}/rules`, payload); }
  addCalibration(modelId: string, payload: object) { return this.http.post(`${API_URL}/models/${modelId}/calibrations`, payload); }
  addCredits(payload: object) { return this.http.post(`${API_URL}/extra-credits`, payload); }
}
