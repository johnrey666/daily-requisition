import { Component, signal, OnInit, ViewChild, ElementRef, HostListener } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet, Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { ThemeService } from '../core/services/theme.service';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { AuthService } from '../core/services/auth.service';
import { UserService } from '../core/services/user.service';
import { Observable, firstValueFrom } from 'rxjs';
import { Firestore, doc, getDoc, setDoc } from '@angular/fire/firestore';
import { serverTimestamp } from 'firebase/firestore';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, RouterLink, RouterLinkActive, RouterOutlet, ReactiveFormsModule],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.css',
})
export class DashboardComponent implements OnInit {
  @ViewChild('settingsContainer') settingsContainer!: ElementRef;
  
  collapsed = signal(false);

  navItems = [
    { label: 'Dashboard', route: '/dashboard', icon: 'dashboard' },
    { label: 'Daily Production', route: '/dashboard/daily-production', icon: 'factory' },
    { label: 'Material Requisition', route: '/dashboard/material-requisition', icon: 'document' },
    { label: 'Usage Report', route: '/dashboard/usage-report', icon: 'line-chart' },
  ] as const;

  user$: Observable<any>;

  // Settings & modal state
  showSettings = false;
  showCreateUserModal = false;
  showLogoutConfirm = false;
  logoutSource: 'header' | 'sidebar' | null = null;

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
    private firestore: Firestore,
    private router: Router
  ) {
    this.user$ = this.authService.user$;
    
    // Initialize form
    this.createUserForm = this.fb.nonNullable.group({
      email: ['', [Validators.required, Validators.email]],
      password: ['', [Validators.required, Validators.minLength(6)]],
      role: ['user', Validators.required],
    });
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent) {
    if (this.showSettings && this.settingsContainer && 
        !this.settingsContainer.nativeElement.contains(event.target)) {
      this.showSettings = false;
    }
  }

  async ngOnInit() {
    // Load user role immediately
    await this.loadUserRole();
    
    // Subscribe to auth state changes
    this.user$.subscribe(async (user) => {
      if (user?.uid) {
        await this.loadUserRole(user.uid);
      } else {
        this.userRole = null;
        this.isAdmin = false;
      }
    });
  }

  private async loadUserRole(uid?: string) {
    try {
      const userId = uid || this.authService.getUserId();
      if (!userId) {
        this.userRole = null;
        this.isAdmin = false;
        return;
      }

      const userDoc = await getDoc(doc(this.firestore, 'users', userId));
      if (userDoc.exists()) {
        const data = userDoc.data() as any;
        this.userRole = data['role'] || 'user';
        this.isAdmin = this.userRole === 'admin';
        console.log('User role loaded:', this.userRole, 'isAdmin:', this.isAdmin);
      } else {
        // Create user document if it doesn't exist using setDoc directly
        const currentUser = await firstValueFrom(this.user$);
        if (currentUser) {
          const userRef = doc(this.firestore, 'users', currentUser.uid);
          await setDoc(userRef, {
            email: currentUser.email,
            role: 'user',
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
          });
          this.userRole = 'user';
          this.isAdmin = false;
        }
      }
    } catch (err) {
      console.error('Failed to load user role', err);
      this.userRole = null;
      this.isAdmin = false;
    }
  }

  getUserInitials(user: any): string {
    if (!user) return 'U';
    if (user.email) {
      return user.email.charAt(0).toUpperCase();
    }
    if (user.displayName) {
      return user.displayName.charAt(0).toUpperCase();
    }
    return 'U';
  }

  getUserDisplayName(user: any): string {
    if (!user) return 'User';
    if (user.displayName) return user.displayName;
    if (user.email) {
      return user.email.split('@')[0] || user.email;
    }
    return 'User';
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

  confirmLogoutFromHeader() {
    this.showSettings = false;
    this.logoutSource = 'header';
    this.showLogoutConfirm = true;
  }

  confirmLogoutFromSidebar() {
    this.logoutSource = 'sidebar';
    this.showLogoutConfirm = true;
  }

  cancelLogout() {
    this.showLogoutConfirm = false;
    this.logoutSource = null;
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
      // Check admin status again
      if (!this.isAdmin) {
        throw new Error('You do not have permission to create users');
      }

      // Use the existing createUserAccount method from UserService
      await this.userService.createUserAccount(email, password, role);
      this.createSuccess = 'User created successfully!';
      this.createUserForm.reset({ email: '', password: '', role: 'user' });
      
      // Auto close after success
      setTimeout(() => this.closeCreateUserModal(), 1500);
    } catch (err: any) {
      console.error('Create user failed', err);
      
      // Handle specific Firebase Auth errors
      if (err.code === 'auth/email-already-in-use') {
        this.createError = 'This email is already registered.';
      } else if (err.code === 'auth/operation-not-allowed') {
        this.createError = 'Email/password accounts are not enabled. Please enable them in Firebase Console.';
      } else if (err.code === 'auth/weak-password') {
        this.createError = 'Password is too weak. Please use at least 6 characters.';
      } else if (err.message?.includes('Only administrators')) {
        this.createError = 'You do not have permission to create users.';
      } else if (err.message?.includes('must be done through Firebase Console')) {
        this.createError = 'Due to security restrictions, please create users directly in Firebase Console.';
      } else {
        this.createError = err?.message || 'Failed to create user. Please try again.';
      }
    } finally {
      this.isCreating = false;
    }
  }

  async logout() {
    try {
      await this.authService.signOut();
      this.router.navigate(['/login']);
      this.showLogoutConfirm = false;
      this.logoutSource = null;
    } catch (err) {
      console.error('Logout failed', err);
    }
  }
}