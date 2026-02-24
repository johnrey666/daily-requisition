// src/app/app.config.ts
import { ApplicationConfig, provideZoneChangeDetection } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideClientHydration, withEventReplay, withIncrementalHydration } from '@angular/platform-browser';
import { routes } from './app.routes';

// AngularFire imports
import { initializeApp, provideFirebaseApp } from '@angular/fire/app';
import { getAuth, provideAuth } from '@angular/fire/auth';
import { getFirestore, provideFirestore } from '@angular/fire/firestore';
import { environment } from '../environments/environment';

export const appConfig: ApplicationConfig = {
  providers: [
    // Zone.js for change detection
    provideZoneChangeDetection({ eventCoalescing: true }),
    
    // Router
    provideRouter(routes),
    
    // Client hydration with SSR - properly configured
    provideClientHydration(
      withEventReplay(),
      withIncrementalHydration() // Better for components with browser APIs
    ),
    
    // Firebase setup
    provideFirebaseApp(() => initializeApp(environment.firebase)),
    provideAuth(() => getAuth()),
    provideFirestore(() => getFirestore()),
  ]
};

