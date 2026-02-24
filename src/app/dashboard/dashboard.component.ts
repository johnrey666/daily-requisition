// src/app/dashboard/dashboard.component.ts
import { Component, signal, OnInit, ViewChild, ElementRef, HostListener, OnDestroy } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet, Router } from '@angular/router';
import { CommonModule, DatePipe } from '@angular/common';
import { ThemeService } from '../core/services/theme.service';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { AuthService } from '../core/services/auth.service';
import { UserService } from '../core/services/user.service';
import { Observable, firstValueFrom, Subscription } from 'rxjs';
import { Firestore, collection, getDocs, doc, setDoc, query, orderBy, getDoc, serverTimestamp } from '@angular/fire/firestore';

interface NavItem {
  label: string;
  route: string;
  icon: string;
  roles: string[];
}

interface User {
  uid?: string;
  email: string;
  role: string;
  createdAt?: any;
  updatedAt?: any;
}

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, RouterLink, RouterLinkActive, RouterOutlet, ReactiveFormsModule, DatePipe],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.css',
})
export class DashboardComponent implements OnInit, OnDestroy {
  @ViewChild('settingsContainer') settingsContainer!: ElementRef;
  
  collapsed = signal(false);

  navItems: NavItem[] = [
    { label: 'Dashboard', route: '/dashboard', icon: 'dashboard', roles: ['user', 'store', 'production', 'procurement', 'admin'] },
    { label: 'Store', route: '/dashboard/store', icon: 'store', roles: ['user', 'store', 'production', 'procurement', 'admin'] },
    { label: 'Production', route: '/dashboard/production', icon: 'factory', roles: ['user', 'store', 'production', 'procurement', 'admin'] },
    { label: 'Procurement', route: '/dashboard/procurement', icon: 'document', roles: ['user', 'store', 'production', 'procurement', 'admin'] },
    { label: 'Usage Report', route: '/dashboard/usage-report', icon: 'line-chart', roles: ['user', 'store', 'production', 'procurement', 'admin'] },
    { label: 'Users', route: '/dashboard/users', icon: 'users', roles: ['admin'] },
  ];

  filteredNavItems: NavItem[] = [];

  user$: Observable<any>;

  // Settings & modal state
  showSettings = false;
  showUserListModal = false;
  showCreateUserModal = false;
  showLogoutConfirm = false;
  logoutSource: 'header' | 'sidebar' | null = null;

  // User list state
  users: User[] = [];
  loadingUsers = false;
  userListError: string | null = null;

  // Create user form
  createUserForm: any;

  // Role info
  userRole: string | null = null;
  isAdmin = false;

  isCreating = false;
  createError: string | null = null;
  createSuccess: string | null = null;

  // During user creation, auth temporarily switches to new user - ignore that to stay as admin
  private isCreatingUser = false;

  // Subscriptions
  private userSubscription?: Subscription;

  constructor(
    public themeService: ThemeService,
    private fb: FormBuilder,
    private authService: AuthService,
    private userService: UserService,
    private firestore: Firestore,
    private router: Router
  ) {
    this.user$ = this.authService.user$;
    
    // Initialize form with updated roles
    this.createUserForm = this.fb.nonNullable.group({
      email: ['', [Validators.required, Validators.email]],
      password: ['', [Validators.required, Validators.minLength(6)]],
      role: ['store', Validators.required],
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
    console.log('Dashboard ngOnInit - Starting');
    // Load user role immediately
    await this.loadUserRole();
    
    // Subscribe to auth state changes (skip during user creation - auth temporarily switches)
    this.userSubscription = this.user$.subscribe(async (user) => {
      console.log('Dashboard - Auth state changed:', user?.email);
      if (this.isCreatingUser) {
        console.log('Dashboard - Skipping role load during user creation');
        return;
      }
      if (user?.uid) {
        console.log('Dashboard - User authenticated, loading role for:', user.uid);
        await this.loadUserRole(user.uid);
      } else {
        console.log('Dashboard - No user, clearing role');
        this.userRole = null;
        this.isAdmin = false;
        this.filteredNavItems = [];
      }
    });
  }

  ngOnDestroy() {
    // Clean up subscription
    if (this.userSubscription) {
      this.userSubscription.unsubscribe();
    }
  }

  private async loadUserRole(uid?: string) {
    try {
      const userId = uid || this.authService.getUserId();
      console.log('loadUserRole - userId:', userId);
      
      if (!userId) {
        console.log('loadUserRole - No userId found');
        this.userRole = null;
        this.isAdmin = false;
        this.filteredNavItems = [];
        return;
      }

      console.log('loadUserRole - Fetching user doc for:', userId);
      const userDocRef = doc(this.firestore, 'users', userId);
      const userDoc = await getDoc(userDocRef);
      
      if (userDoc.exists()) {
        const data = userDoc.data();
        console.log('loadUserRole - User doc data:', data);
        this.userRole = data['role'] || 'user';
        this.isAdmin = this.userRole === 'admin';
        console.log('User role loaded:', this.userRole, 'isAdmin:', this.isAdmin);
        
        // Filter nav items based on user role
        this.filterNavItems();
        console.log('Filtered nav items:', this.filteredNavItems);
      } else {
        console.log('loadUserRole - No user document found, creating one');
        // Create user document if it doesn't exist
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
          this.filterNavItems();
          console.log('Created default user document, filtered nav items:', this.filteredNavItems);
        }
      }
    } catch (err) {
      console.error('Failed to load user role', err);
      this.userRole = null;
      this.isAdmin = false;
      this.filteredNavItems = [];
    }
  }

  private filterNavItems() {
    console.log('filterNavItems - Current userRole:', this.userRole);
    
    if (!this.userRole) {
      console.log('filterNavItems - No user role, setting empty array');
      this.filteredNavItems = [];
      return;
    }

    this.filteredNavItems = this.navItems.filter(item => {
      const hasRole = item.roles.includes(this.userRole as string);
      console.log(`filterNavItems - Item ${item.label} (${item.route}) - hasRole: ${hasRole}, item.roles:`, item.roles);
      return hasRole;
    });
    
    console.log('filterNavItems - Final filtered items:', this.filteredNavItems);
  }

  shouldShowNavItem(item: NavItem): boolean {
    return this.filteredNavItems.includes(item);
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

  // Open user list modal first
  openUserListModal() {
    this.showUserListModal = true;
    this.showSettings = false;
    this.loadUsers();
  }

  closeUserListModal() {
    this.showUserListModal = false;
    this.users = [];
    this.userListError = null;
  }

  // Open create user modal from the user list
  openCreateUserFromList() {
    this.showCreateUserModal = true;
    // Don't close the user list modal yet - we'll handle it in create user flow
    this.createError = null;
    this.createSuccess = null;
    this.createUserForm.reset({ email: '', password: '', role: 'store' });
  }

  // Original open create user modal (kept for backward compatibility)
  openCreateUserModal() {
    this.showCreateUserModal = true;
    this.showSettings = false;
    this.createError = null;
    this.createSuccess = null;
    this.createUserForm.reset({ email: '', password: '', role: 'store' });
  }

  closeCreateUserModal() {
    this.showCreateUserModal = false;
  }

  // Load all users from Firestore
  async loadUsers() {
    this.loadingUsers = true;
    this.userListError = null;

    try {
      // Check if user is admin
      if (!this.isAdmin) {
        throw new Error('You do not have permission to view users');
      }

      console.log('Loading users from Firestore...');
      
      // Get reference to users collection
      const usersRef = collection(this.firestore, 'users');
      
      // Create query ordered by createdAt descending
      const q = query(usersRef, orderBy('createdAt', 'desc'));
      
      // Get documents using getDocs
      const querySnapshot = await getDocs(q);
      
      console.log('Found users count:', querySnapshot.size);
      
      // Map documents to User objects
      const loadedUsers: User[] = [];
      querySnapshot.forEach((doc) => {
        const data = doc.data();
        loadedUsers.push({
          uid: doc.id,
          email: data['email'] || '',
          role: data['role'] || 'user',
          createdAt: data['createdAt'] || null,
          updatedAt: data['updatedAt'] || null
        });
      });
      
      this.users = loadedUsers;
      console.log('Users loaded successfully:', this.users);
      
    } catch (err: any) {
      console.error('Error loading users:', err);
      
      // Handle specific error cases
      if (err.code === 'permission-denied') {
        this.userListError = 'You do not have permission to view users. Please check your Firebase security rules.';
      } else if (err.code === 'failed-precondition') {
        this.userListError = 'The required index is not created. Please check the Firebase Console to create the index.';
      } else {
        this.userListError = err?.message || 'Failed to load users. Please try again.';
      }
    } finally {
      this.loadingUsers = false;
    }
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
    this.isCreatingUser = true;
    this.createError = null;
    this.createSuccess = null;

    const { email, password, role } = this.createUserForm.getRawValue();

    try {
      // Check admin status again - only admin can create users
      if (!this.isAdmin) {
        throw new Error('You do not have permission to create users');
      }

      // Get current admin user (auth will switch to new user during create, then back)
      const currentUser = this.authService.getCurrentUser();
      if (!currentUser) {
        throw new Error('You must be logged in as admin');
      }
      const adminUid = currentUser.uid;

      console.log('Creating new user with email:', email, 'role:', role);
      
      // createUserAccount signs in as new user, then signs back in as admin
      await this.userService.createUserAccount(email, password, role);
      
      this.createSuccess = 'User created successfully!';
      this.createUserForm.reset({ email: '', password: '', role: 'store' });
      
      // Reload admin role (auth is back to admin, but we ignored the auth change)
      await this.loadUserRole(adminUid);
      
      // Refresh the user list if it's open
      if (this.showUserListModal) {
        await this.loadUsers();
      }
      
      // Auto close create modal after success
      setTimeout(() => {
        this.closeCreateUserModal();
      }, 1500);
    } catch (err: any) {
      console.error('Create user failed', err);
      
      // Handle specific Firebase Auth errors
      if (err.code === 'auth/email-already-in-use') {
        this.createError = 'This email is already registered.';
      } else if (err.code === 'auth/operation-not-allowed') {
        this.createError = 'Email/password accounts are not enabled. Please enable them in Firebase Console.';
      } else if (err.code === 'auth/weak-password') {
        this.createError = 'Password is too weak. Please use at least 6 characters.';
      } else if (err.message?.includes('Admin credentials not available')) {
        this.createError = 'Admin session expired. Please log out and log in again.';
      } else if (err.message?.includes('permission-denied') || err.message?.includes('Permission denied')) {
        this.createError = 'You do not have permission to create users.';
      } else {
        this.createError = err?.message || 'Failed to create user. Please try again.';
      }
    } finally {
      this.isCreating = false;
      this.isCreatingUser = false;
    }
  }

  async logout() {
    try {
      // Clear stored admin password
      this.userService.clearAdminPassword();
      
      await this.authService.signOut();
      this.router.navigate(['/login']);
      this.showLogoutConfirm = false;
      this.logoutSource = null;
    } catch (err) {
      console.error('Logout failed', err);
    }
  }

  // Helper method to check if current route is active
  isRouteActive(route: string): boolean {
    return this.router.url === route;
  }
}