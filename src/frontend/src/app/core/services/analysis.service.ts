import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, interval, switchMap, takeWhile, map } from 'rxjs';
import { environment } from '../../../environments/environment';
import {
  AnalyzeRequest,
  AnalyzeResponse,
  TaskStatusResponse
} from '../models/api.models';

@Injectable({
  providedIn: 'root'
})
export class AnalysisService {
  private http = inject(HttpClient);

  /**
   * Submit a report for analysis
   */
  analyze(request: AnalyzeRequest): Observable<AnalyzeResponse> {
    return this.http.post<AnalyzeResponse>(
      `${environment.apiUrl}/api/analyze`,
      request
    );
  }

  /**
   * Get status and results of a report
   */
  getReport(reportId: string): Observable<TaskStatusResponse> {
    return this.http.get<TaskStatusResponse>(
      `${environment.apiUrl}/api/reports/${reportId}`
    );
  }

  /**
   * Poll for report completion
   * Returns Observable that emits updates until task is completed or failed
   */
  pollReport(reportId: string, intervalMs: number = 2000): Observable<TaskStatusResponse> {
    return interval(intervalMs).pipe(
      switchMap(() => this.getReport(reportId)),
      takeWhile((response) => {
        return response.status === 'pending' || response.status === 'in_progress';
      }, true), // inclusive: emit the final completed/failed status
      map(response => response)
    );
  }

  /**
   * Submit report and wait for completion
   * Convenient method that combines analyze + polling
   */
  analyzeAndWait(request: AnalyzeRequest): Observable<TaskStatusResponse> {
    return this.analyze(request).pipe(
      switchMap(response => this.pollReport(response.report_id))
    );
  }
}
