import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { AppComponent } from './app/app.component';

// Ensure Firebase is initialized as early as possible to avoid race conditions
import { initializeApp, getApps } from 'firebase/app';
import { environment } from './environments/environment';

// Initialize Firebase app immediately (safe if already initialized)
if (!getApps().length) {
  initializeApp(environment.firebase as any);
}

bootstrapApplication(AppComponent, appConfig)
  .catch((err) => console.error(err));
