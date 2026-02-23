// src/app/core/services/auth.service.ts
import { Injectable } from '@angular/core';
import { Auth, authState, signInWithEmailAndPassword, signOut, createUserWithEmailAndPassword, User } from '@angular/fire/auth';
import { BehaviorSubject, Observable, firstValueFrom, timeout, catchError, of } from 'rxjs';
import { map, take, filter } from 'rxjs/operators';

@Injectable({ providedIn: 'root' })
export class AuthService {
  user$: BehaviorSubject<User | null> = new BehaviorSubject<User | null>(null);

  constructor(private auth: Auth) {
    // Subscribe to auth state changes
    authState(this.auth).subscribe((user) => {
      console.log('Auth state changed:', user?.email);
      this.user$.next(user);
    });
  }

  // Get current user as observable
  getCurrentUserObservable(): Observable<User | null> {
    return authState(this.auth);
  }

  // Get current user as promise - waits for Firebase to restore session on reload
  async getCurrentUserPromise(): Promise<User | null> {
    // First check if we already have a user synchronously
    if (this.auth.currentUser) {
      console.log('Found current user synchronously:', this.auth.currentUser.email);
      return this.auth.currentUser;
    }
    
    // Otherwise wait for auth state to resolve (with timeout)
    try {
      const user = await firstValueFrom(
        authState(this.auth).pipe(
          // Wait for first emission (could be null or user)
          take(1),
          // Add timeout to prevent hanging forever
          timeout(3000),
          // Handle timeout gracefully
          catchError(() => of(null))
        )
      );
      console.log('Auth state resolved:', user?.email);
      return user;
    } catch (err) {
      console.log('Error getting current user:', err);
      return null;
    }
  }

  // Get current user synchronously
  getCurrentUser() {
    return this.auth.currentUser;
  }

  // Sign in with email and password
  signIn(email: string, password: string): Promise<any> {
    return signInWithEmailAndPassword(this.auth, email, password);
  }

  // Sign out
  signOut(): Promise<void> {
    // Clear stored admin password on logout
    sessionStorage.removeItem('adminPassword');
    return signOut(this.auth);
  }

  // Create new user (admin only) - This will be used by UserService
  createUser(email: string, password: string): Promise<any> {
    return createUserWithEmailAndPassword(this.auth, email, password);
  }

  // Check if user is authenticated
  isAuthenticated(): Observable<boolean> {
    return authState(this.auth).pipe(
      map(user => !!user)
    );
  }

  // Get user ID
  getUserId(): string | null {
    return this.user$.value?.uid || null;
  }

  // Get user email
  getUserEmail(): string | null {
    return this.user$.value?.email || null;
  }
}