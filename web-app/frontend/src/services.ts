import { HttpClient, HttpInterceptorFn } from '@angular/common/http';
import { inject, Injectable, signal } from '@angular/core';
import { tap } from 'rxjs';
import { API_URL } from './api-url';
import { AiModel, AuthResponse, CostAnalysis, Dashboard, GalleryUpload, Project, UsageRecord, User, OcrFailureNotification } from './types';

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
  logout() { sessionStorage.removeItem(TOKEN_KEY); sessionStorage.removeItem(USER_KEY); this.user.set(null); }
  private store(value: AuthResponse) {
    sessionStorage.setItem(TOKEN_KEY, value.accessToken); sessionStorage.setItem(USER_KEY, JSON.stringify(value.user)); this.user.set(value.user);
  }
  private readUser(): User | null {
    try { return JSON.parse(sessionStorage.getItem(USER_KEY) ?? 'null') as User | null; } catch { return null; }
  }
}

export const authInterceptor: HttpInterceptorFn = (request, next) => {
  const token = inject(AuthService).token;
  return next(token ? request.clone({ setHeaders: { Authorization: `Bearer ${token}` } }) : request);
};

@Injectable({ providedIn: 'root' })
export class ApiService {
  ocrFailures() { return this.http.get<OcrFailureNotification[]>(`${API_URL}/notifications/ocr-failures`); }
  private readonly http = inject(HttpClient);
  dashboard() { return this.http.get<Dashboard>(`${API_URL}/dashboard`); }
  projects() { return this.http.get<Project[]>(`${API_URL}/projects`); }
  projectInbox(id: string) { return this.http.get<{ folder: string; files: string[] }>(`${API_URL}/projects/${id}/inbox`); }
  scanInbox(id: string) { return this.http.post<{ imported: number; pending: Array<{ number: string; reason: string }>; ignored: string[] }>(`${API_URL}/projects/${id}/inbox/scan`, {}); }
  selectProjectImages(id: string) {
    return this.http.post<{ copied: number; cancelled: boolean }>(`http://127.0.0.1:4410/projects/${id}/select-images`, {});
  }
  createProject(payload: { name: string; color: string }) { return this.http.post<Project>(`${API_URL}/projects`, payload); }
  updateProject(id: string, payload: { name: string; color: string }) { return this.http.patch<Project>(`${API_URL}/projects/${id}`, payload); }
  deleteProject(id: string) { return this.http.delete(`${API_URL}/projects/${id}`); }
  records() { return this.http.get<UsageRecord[]>(`${API_URL}/records`); }
  gallery(projectId: string) { return this.http.get<GalleryUpload[]>(`${API_URL}/records/uploads/gallery`, { params: { projectId } }); }
  uploadImage(uploadId: string) { return this.http.get(`${API_URL}/records/uploads/${uploadId}/content`, { responseType: 'blob' }); }
  createRecord(body: FormData) { return this.http.post<UsageRecord>(`${API_URL}/records`, body); }
  createRecordBatch(body: FormData) { return this.http.post<UsageRecord[]>(`${API_URL}/records/batch`, body); }
  validateRecord(id: string) {
    return this.http.post<{ id: string; status: 'VALIDATING'; queuedUploads: number }>(`${API_URL}/records/${id}/validate`, {});
  }
  correctReading(recordId: string, uploadId: string, payload: object) {
    return this.http.patch(`${API_URL}/records/${recordId}/snapshots/${uploadId}`, payload);
  }
  deleteRecord(id: string) { return this.http.delete(`${API_URL}/records/${id}`); }
  models() { return this.http.get<AiModel[]>(`${API_URL}/models`); }
  windowPricing() { return this.http.get<{ currency: 'EUR'; fiveHourWindowCost: number }>(`${API_URL}/models/window-pricing`); }
  costAnalysis(projectId?: string, modelId?: string) {
    return this.http.get<CostAnalysis>(`${API_URL}/cost-analysis`, {
      params: { ...(projectId ? { projectId } : {}), ...(modelId ? { explore: 'true', modelId } : {}) },
    });
  }
  addCredits(payload: object) { return this.http.post(`${API_URL}/extra-credits`, payload); }
}
