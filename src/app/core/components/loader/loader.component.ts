import { Component, inject, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, NavigationStart, NavigationEnd } from '@angular/router';
import { LoaderService } from '../../services/loader.service';

@Component({
  selector: 'app-loader',
  standalone: true,
  imports: [CommonModule],
  template: `
    @if (loader.visible()) {
      <div class="loader-overlay" [class.content-only]="loader.contentOnly() && !loader.bootstrapping()" role="status" aria-live="polite" aria-label="Loading">
        <div class="loader-content">
          <div class="loader-skeleton" aria-hidden="true">
            <div class="skeleton title"></div>
            <div class="skeleton subtitle"></div>

            <div class="stats-grid">
              <div class="skeleton stat-card">
                <div class="skeleton stat-icon"></div>
                <div class="stat-text">
                  <div class="skeleton stat-line"></div>
                  <div class="skeleton stat-subline"></div>
                </div>
              </div>
              <div class="skeleton stat-card">
                <div class="skeleton stat-icon"></div>
                <div class="stat-text">
                  <div class="skeleton stat-line"></div>
                  <div class="skeleton stat-subline"></div>
                </div>
              </div>
              <div class="skeleton stat-card">
                <div class="skeleton stat-icon"></div>
                <div class="stat-text">
                  <div class="skeleton stat-line"></div>
                  <div class="skeleton stat-subline"></div>
                </div>
              </div>
              <div class="skeleton stat-card">
                <div class="skeleton stat-icon"></div>
                <div class="stat-text">
                  <div class="skeleton stat-line"></div>
                  <div class="skeleton stat-subline"></div>
                </div>
              </div>
            </div>

            <div class="skeleton chart">
              <div class="skeleton bar" style="--w: 84%"></div>
              <div class="skeleton bar" style="--w: 62%"></div>
              <div class="skeleton bar" style="--w: 74%"></div>
              <div class="skeleton bar" style="--w: 54%"></div>
              <div class="skeleton bar" style="--w: 90%"></div>
            </div>
          </div>

          @if (loader.message() && !loader.bootstrapping()) {
            <span class="loader-text">{{ loader.message() }}</span>
          }
        </div>
      </div>
    }
  `,
  styles: [`
    .loader-overlay {
      position: fixed;
      inset: 0;
      z-index: 9999;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 0.75rem;
      background: hsl(var(--background));
      pointer-events: auto;
    }

    .loader-overlay.content-only {
      /* Always cover full screen, but position content within main area */
    }

    :host-context(body.sidebar-collapsed) .loader-overlay.content-only,
    .loader-overlay.content-only {
      /* No position adjustments - always full screen */
    }

    .loader-content {
      position: relative;
      width: 100%;
      height: 100%;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 0.75rem;
    }

    .loader-overlay.content-only .loader-content {
      /* Position content within the main content area (excluding sidebar and header) */
      margin-left: 16rem;
      margin-top: 4rem;
      width: calc(100vw - 16rem);
      height: calc(100vh - 4rem);
    }

    :host-context(body.sidebar-collapsed) .loader-overlay.content-only .loader-content {
      margin-left: 4.5rem;
      width: calc(100vw - 4.5rem);
    }

    .loader-skeleton {
      display: flex;
      flex-direction: column;
      gap: 0.9rem;
      width: 300px;
      max-width: min(90vw, 340px);
      padding: 1.25rem;
      border-radius: 16px;
      background: rgba(255, 255, 255, 0.06);
      backdrop-filter: blur(12px);
    }

    .skeleton {
      position: relative;
      overflow: hidden;
      background: hsl(var(--muted));
      border-radius: 12px;
    }

    .skeleton::after {
      content: '';
      position: absolute;
      inset: 0;
      transform: translateX(-110%);
      background: linear-gradient(90deg, rgba(255,255,255,0), rgba(255,255,255,0.7), rgba(255,255,255,0));
      animation: skeleton-shimmer 1.2s infinite;
    }

    .skeleton.title {
      height: 20px;
      width: 60%;
    }

    .skeleton.subtitle {
      height: 12px;
      width: 45%;
    }

    .stats-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 0.75rem;
    }

    .stat-card {
      display: flex;
      gap: 0.75rem;
      align-items: center;
      padding: 0.6rem 0;
    }

    .stat-icon {
      height: 34px;
      width: 34px;
      border-radius: 0.75rem;
    }

    .stat-text {
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 0.35rem;
    }

    .stat-line {
      height: 10px;
      width: 75%;
    }

    .stat-subline {
      height: 10px;
      width: 45%;
    }

    .chart {
      display: flex;
      flex-direction: column;
      gap: 0.45rem;
      padding: 0.85rem;
      border-radius: 1rem;
      background: rgba(255, 255, 255, 0.4);
    }

    .bar {
      height: 10px;
      width: var(--w, 80%);
    }

    .loader-text {
      font-size: 0.75rem;
      color: hsl(var(--muted-foreground));
    }

    @keyframes skeleton-shimmer {
      to { transform: translateX(110%); }
    }
  `]
})
export class LoaderComponent implements OnInit, OnDestroy {
  loader = inject(LoaderService);
  private router = inject(Router);
  private bootstrapDone = false;
  private navSub: any;
  private navTimer: ReturnType<typeof setTimeout> | null = null;

  ngOnInit() {
    // Avoid showing the loader on fast navigations (prevents flicker and feels snappier).
    this.navSub = this.router.events.subscribe(e => {
      if (e instanceof NavigationStart) {
        if (this.bootstrapDone) {
          this.navTimer = setTimeout(() => {
            this.loader.show();
          }, 120);
        }
      } else if (e instanceof NavigationEnd) {
        if (!this.bootstrapDone) {
          this.bootstrapDone = true;
          this.loader.setBootstrapping(false);
        }
        this.loader.setContentOnly(e.urlAfterRedirects.startsWith('/dashboard'));
        if (this.navTimer) {
          clearTimeout(this.navTimer);
          this.navTimer = null;
        }
        if (this.bootstrapDone) {
          this.loader.hide();
        }
      }
    });
  }

  ngOnDestroy() {
    if (this.navTimer) {
      clearTimeout(this.navTimer);
      this.navTimer = null;
    }
    this.navSub?.unsubscribe();
  }
}
