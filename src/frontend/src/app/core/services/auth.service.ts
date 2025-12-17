import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, tap } from 'rxjs';
import { environment } from '../../../environments/environment';
import { TokenResponse } from '../models/api.models';

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private http = inject(HttpClient);
  private readonly TOKEN_KEY = 'jwt_token';

  // Signal for authentication state
  isAuthenticated = signal<boolean>(this.hasToken());

  /**
   * Get JWT token from the API
   */
  getToken(): Observable<TokenResponse> {
    return this.http.post<TokenResponse>(
      `${environment.apiUrl}/api/token`,
      {}
    ).pipe(
      tap(response => {
        this.setToken(response.access_token);
      })
    );
  }

  /**
   * Store token in localStorage
   */
  setToken(token: string): void {
    localStorage.setItem(this.TOKEN_KEY, token);
    this.isAuthenticated.set(true);
  }

  /**
   * Get stored token
   */
  getStoredToken(): string | null {
    return localStorage.getItem(this.TOKEN_KEY);
  }

  /**
   * Check if token exists
   */
  hasToken(): boolean {
    return !!this.getStoredToken();
  }

  /**
   * Remove token (logout)
   */
  logout(): void {
    localStorage.removeItem(this.TOKEN_KEY);
    this.isAuthenticated.set(false);
  }

  /**
   * Initialize auth state (call on app init)
   */
  initAuth(): void {
    if (!this.hasToken()) {
      // Auto-fetch token if not present
      this.getToken().subscribe({
        error: (err) => console.error('Failed to get token:', err)
      });
    }
  }
}
