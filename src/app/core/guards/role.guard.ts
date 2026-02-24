// src/app/core/guards/role.guard.ts
import { Injectable } from '@angular/core';
import { CanActivate, ActivatedRouteSnapshot, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { Firestore, doc, getDoc } from '@angular/fire/firestore'; // Import getDoc from @angular/fire/firestore

@Injectable({
  providedIn: 'root'
})
export class RoleGuard implements CanActivate {
  constructor(
    private authService: AuthService,
    private firestore: Firestore,
    private router: Router
  ) {}

  async canActivate(route: ActivatedRouteSnapshot): Promise<boolean> {
    const user = await this.authService.getCurrentUserPromise();
    
    if (!user) {
      console.log('RoleGuard: No user found, redirecting to landing');
      this.router.navigate(['/']);
      return false;
    }

    try {
      console.log('RoleGuard: Checking role for user:', user.uid);
      const userDocRef = doc(this.firestore, 'users', user.uid);
      const userDoc = await getDoc(userDocRef);
      
      let userRole = 'user';
      
      if (userDoc.exists()) {
        const data = userDoc.data();
        userRole = data['role'] || 'user';
        console.log('RoleGuard: User role found:', userRole);
      } else {
        console.log('RoleGuard: No user document found, using default role');
      }

      const allowedRoles = route.data['roles'] as Array<string>;
      
      if (allowedRoles && allowedRoles.includes(userRole)) {
        console.log('RoleGuard: Access granted for role:', userRole);
        return true;
      }

      // If user doesn't have required role, redirect to dashboard
      console.log('RoleGuard: User role', userRole, 'not allowed for route:', route.url);
      this.router.navigate(['/dashboard']);
      return false;
    } catch (err) {
      console.error('RoleGuard: Error checking role:', err);
      // Redirect to landing (NOT /dashboard) to avoid loop - /dashboard children also use RoleGuard
      this.router.navigate(['/']);
      return false;
    }
  }
}