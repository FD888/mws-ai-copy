import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AnalysisService } from '../../../core/services/analysis.service';
import { TaskStatusResponse, Finding, Stats } from '../../../core/models/api.models';

@Component({
  selector: 'app-results',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './results.component.html',
  styleUrls: ['./results.component.less']
})
export class ResultsComponent implements OnInit {
  private analysisService = inject(AnalysisService);

  // Signals for reactive state
  taskStatus = signal<TaskStatusResponse | null>(null);
  isLoading = signal<boolean>(false);
  error = signal<string | null>(null);

  // Computed values
  get findings(): Finding[] {
    return this.taskStatus()?.findings || [];
  }

  get stats(): Stats | undefined {
    return this.taskStatus()?.stats;
  }

  get truePositives(): Finding[] {
    return this.findings.filter(f => !f.is_false_positive);
  }

  get falsePositives(): Finding[] {
    return this.findings.filter(f => f.is_false_positive);
  }

  ngOnInit(): void {
    // Example: Load most recent report if available
    // In real app, this would come from route params or service
  }

  /**
   * Load report by ID
   */
  loadReport(reportId: string): void {
    this.isLoading.set(true);
    this.error.set(null);

    this.analysisService.getReport(reportId).subscribe({
      next: (response) => {
        this.taskStatus.set(response);
        this.isLoading.set(false);
      },
      error: (err) => {
        console.error('Failed to load report:', err);
        this.error.set('Failed to load report. Please try again.');
        this.isLoading.set(false);
      }
    });
  }

  /**
   * Poll for report completion
   */
  pollReport(reportId: string): void {
    this.isLoading.set(true);
    this.error.set(null);

    this.analysisService.pollReport(reportId).subscribe({
      next: (response) => {
        this.taskStatus.set(response);

        // Stop loading when task is completed or failed
        if (response.status === 'completed' || response.status === 'failed') {
          this.isLoading.set(false);
        }
      },
      error: (err) => {
        console.error('Polling error:', err);
        this.error.set('Error while polling for results.');
        this.isLoading.set(false);
      }
    });
  }

  /**
   * Get severity badge class
   */
  getSeverityClass(confidence: number): string {
    if (confidence >= 0.8) return 'severity-high';
    if (confidence >= 0.5) return 'severity-medium';
    return 'severity-low';
  }
}
