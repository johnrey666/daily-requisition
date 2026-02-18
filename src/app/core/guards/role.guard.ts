import { Injectable } from '@angular/core';
import { CanActivate, ActivatedRouteSnapshot, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { Firestore, doc, getDoc } from '@angular/fire/firestore';

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
      this.router.navigate(['/']);
      return false;
    }

    try {
      const userDoc = await getDoc(doc(this.firestore, 'users', user.uid));
      let userRole = 'user';
      
      if (userDoc.exists()) {
        const data = userDoc.data() as any;
        userRole = data['role'] || 'user';
      }

      const allowedRoles = route.data['roles'] as Array<string>;
      
      if (allowedRoles && allowedRoles.includes(userRole)) {
        return true;
      }

      // If user doesn't have required role, redirect to dashboard (not their specific page)
      // This prevents the redirect loop
      console.log('User role', userRole, 'not allowed for route:', route.url);
      this.router.navigate(['/dashboard']);
      return false;
    } catch (err) {
      console.error('Role guard error:', err);
      this.router.navigate(['/dashboard']);
      return false;
    }
  }
}