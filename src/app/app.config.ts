// src/app/app.config.ts
import { ApplicationConfig, provideZoneChangeDetection } from '@angular/core';
import { provideRouter, PreloadAllModules, withPreloading } from '@angular/router';
import { provideClientHydration, withEventReplay, withIncrementalHydration } from '@angular/platform-browser';
import { provideHttpClient } from '@angular/common/http'; // Add this import
import { routes } from './app.routes';

// AngularFire imports
import { initializeApp, provideFirebaseApp } from '@angular/fire/app';
import { getAuth, provideAuth } from '@angular/fire/auth';
import { getFirestore, provideFirestore } from '@angular/fire/firestore';
import { getStorage, provideStorage } from '@angular/fire/storage';
import { environment } from '../environments/environment';

export const appConfig: ApplicationConfig = {
  providers: [
    // Zone.js for change detection
    provideZoneChangeDetection({ eventCoalescing: true }),
    
    // Router (preload all lazy components for snappier navigation)
    provideRouter(routes, withPreloading(PreloadAllModules)),
    
    // Client hydration with SSR - properly configured
    provideClientHydration(
      withEventReplay(),
      withIncrementalHydration() // Better for components with browser APIs
    ),
    
    // HTTP Client for API calls
    provideHttpClient(), // Add this line
    
    // Firebase setup
    provideFirebaseApp(() => initializeApp(environment.firebase)),
    provideAuth(() => getAuth()),
    provideFirestore(() => getFirestore()),
    provideStorage(() => getStorage()),
  ]
};