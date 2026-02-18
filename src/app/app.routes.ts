import { Routes } from '@angular/router';
import { AuthGuard } from './core/guards/auth.guard';
import { RoleGuard } from './core/guards/role.guard';

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
        loadComponent: () => import('./dashboard/pages/page1/page1.component').then(m => m.Page1Component),
        canActivate: [RoleGuard],
        data: { roles: ['user', 'store', 'production', 'procurement', 'admin'] }
      },
      { 
        path: 'store', 
        loadComponent: () => import('./dashboard/pages/page2/page2.component').then(m => m.Page2Component),
        canActivate: [RoleGuard],
        data: { roles: ['store', 'admin'] }
      },
      { 
        path: 'production', 
        loadComponent: () => import('./dashboard/pages/page2/page2.component').then(m => m.Page2Component),
        canActivate: [RoleGuard],
        data: { roles: ['production', 'admin'] }
      },
      { 
        path: 'procurement', 
        loadComponent: () => import('./dashboard/pages/page3/page3.component').then(m => m.Page3Component),
        canActivate: [RoleGuard],
        data: { roles: ['procurement', 'admin'] }
      },
      { 
        path: 'users', 
        loadComponent: () => import('./dashboard/pages/users/users.component').then(m => m.UsersComponent),
        canActivate: [RoleGuard],
        data: { roles: ['admin'] }
      },
      { 
        path: 'usage-report', 
        loadComponent: () => import('./dashboard/pages/page4/page4.component').then(m => m.Page4Component),
        canActivate: [RoleGuard],
        data: { roles: ['store', 'production', 'procurement', 'admin'] }
      },
      // Keep old routes for backward compatibility
      { 
        path: 'daily-production', 
        loadComponent: () => import('./dashboard/pages/page2/page2.component').then(m => m.Page2Component),
        canActivate: [RoleGuard],
        data: { roles: ['store', 'production', 'admin'] }
      },
      { 
        path: 'material-requisition', 
        loadComponent: () => import('./dashboard/pages/page3/page3.component').then(m => m.Page3Component),
        canActivate: [RoleGuard],
        data: { roles: ['procurement', 'admin', 'user'] }
      },
    ],
  },
  { path: 'home', redirectTo: 'dashboard', pathMatch: 'full' },
  { path: '**', redirectTo: '' },
];