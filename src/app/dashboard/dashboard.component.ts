import { Component, signal } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { CommonModule } from '@angular/common';
import { ThemeService } from '../core/services/theme.service';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { AuthService } from '../core/services/auth.service';
import { UserService } from '../core/services/user.service';
import { Observable } from 'rxjs';
import { Firestore } from '@angular/fire/firestore';
import { doc, getDoc } from 'firebase/firestore';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, RouterLink, RouterLinkActive, RouterOutlet, ReactiveFormsModule],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.css',
})
export class DashboardComponent {
  collapsed = signal(false);

  navItems = [
    { label: 'Dashboard', route: '/dashboard', icon: 'dashboard' },
    { label: 'Daily Production', route: '/dashboard/daily-production', icon: 'factory' },
    { label: 'Material Requisition', route: '/dashboard/material-requisition', icon: 'document' },
    { label: 'Usage Report', route: '/dashboard/usage-report', icon: 'line-chart' },
  ] as const;

  public user$: Observable<any>;

  // Settings & modal state
  showSettings = false;
  showCreateUserModal = false;

  // Create user form
  createUserForm: any;

  // Role info
  userRole: string | null = null;
  isAdmin = false;

  isCreating = false;
  createError: string | null = null;
  createSuccess: string | null = null;

  constructor(
    public themeService: ThemeService,
    private fb: FormBuilder,
    private authService: AuthService,
    private userService: UserService,
    private firestore: Firestore
  ) {
    this.user$ = this.authService.user$;
    this.createUserForm = this.fb.nonNullable.group({
      email: ['', [Validators.required, Validators.email]],
      password: ['', [Validators.required, Validators.minLength(6)]],
      role: ['user', Validators.required],
    });

    // Watch auth user and load role from Firestore
    this.user$.subscribe(async (u) => {
      if (u && u.uid) {
        try {
          const snap = await getDoc(doc(this.firestore, 'users', u.uid));
          const data = snap.exists() ? (snap.data() as any) : null;
          this.userRole = data?.role ?? null;
          this.isAdmin = this.userRole === 'admin';
        } catch (err) {
          console.error('Failed to load user role', err);
          this.userRole = null;
          this.isAdmin = false;
        }
      } else {
        this.userRole = null;
        this.isAdmin = false;
      }
    });
  }

  toggleSidebar() {
    this.collapsed.update((c) => !c);
  }

  toggleTheme() {
    this.themeService.toggleTheme();
  }

  toggleSettings() {
    this.showSettings = !this.showSettings;
  }

  openCreateUserModal() {
    this.showCreateUserModal = true;
    this.showSettings = false;
    this.createError = null;
    this.createSuccess = null;
    this.createUserForm.reset({ email: '', password: '', role: 'user' });
  }

  closeCreateUserModal() {
    this.showCreateUserModal = false;
  }

  async createUser() {
    if (this.createUserForm.invalid) {
      this.createUserForm.markAllAsTouched();
      return;
    }

    this.isCreating = true;
    this.createError = null;
    this.createSuccess = null;

    const { email, password, role } = this.createUserForm.getRawValue();

    try {
      await this.userService.createUserAccount(email, password, role);
      this.createSuccess = 'User created successfully';
      this.createUserForm.reset({ email: '', password: '', role: 'user' });
      setTimeout(() => this.closeCreateUserModal(), 1000);
    } catch (err: any) {
      console.error('Create user failed', err);
      this.createError = err?.message || 'Create user failed';
    } finally {
      this.isCreating = false;
    }
  }
}
