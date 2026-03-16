import { Routes } from '@angular/router';
import { AuthGuard } from './core/guards/auth.guard';

export const routes: Routes = [
  { path: '', loadComponent: () => import('./landing/landing.component').then(m => m.LandingComponent) },
  { path: 'login', loadComponent: () => import('./login/login.component').then(m => m.LoginComponent) },
  {
    path: 'dashboard',
    loadComponent: () => import('./dashboard/dashboard.component').then(m => m.DashboardComponent),
    canActivate: [AuthGuard],
    children: [
      { 
        path: '', 
        loadComponent: () => import('./dashboard/pages/page1/page1.component').then(m => m.Page1Component)
      },
      { 
        path: 'production', 
        loadComponent: () => import('./dashboard/pages/page2/page2.component').then(m => m.Page2Component)
      },
      { 
        path: 'procurement', 
        loadComponent: () => import('./dashboard/pages/page3/page3.component').then(m => m.Page3Component)
      },
      { 
        path: 'usage-report', 
        loadComponent: () => import('./dashboard/pages/page4/page4.component').then(m => m.Page4Component)
      },
      // Redirect old routes to new ones
      { 
        path: 'store', 
        redirectTo: '/dashboard', 
        pathMatch: 'full' 
      },
      { 
        path: 'daily-production', 
        redirectTo: '/dashboard/production', 
        pathMatch: 'full' 
      },
      { 
        path: 'material-requisition', 
        redirectTo: '/dashboard/procurement', 
        pathMatch: 'full' 
      },
      // Legacy users route - redirect to dashboard
      { 
        path: 'users', 
        redirectTo: '/dashboard', 
        pathMatch: 'full' 
      },
    ],
  },
  { path: 'home', redirectTo: '/dashboard', pathMatch: 'full' },
  { path: '**', redirectTo: '' },
];