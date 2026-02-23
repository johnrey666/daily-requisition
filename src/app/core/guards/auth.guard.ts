// src/app/core/guards/auth.guard.ts
import { Injectable } from '@angular/core';
import { CanActivate, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';

@Injectable({
  providedIn: 'root'
})
export class AuthGuard implements CanActivate {
  constructor(
    private authService: AuthService,
    private router: Router
  ) {}

  async canActivate(): Promise<boolean> {
    const user = await this.authService.getCurrentUserPromise();
    
    if (user) {
      console.log('AuthGuard: User authenticated, allowing access');
      return true;
    }

    console.log('AuthGuard: No user found, redirecting to landing');
    // Not logged in, redirect to landing page
    this.router.navigate(['/']);
    return false;
  }
}