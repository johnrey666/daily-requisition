// src/app/dashboard/dashboard.component.ts
import { Component, signal, OnInit, ViewChild, ElementRef, HostListener, OnDestroy } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet, Router } from '@angular/router';
import { CommonModule, DatePipe } from '@angular/common';
import { ThemeService } from '../core/services/theme.service';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { AuthService } from '../core/services/auth.service';
import { UserService } from '../core/services/user.service';
import { NotificationService, Notification } from '../core/services/notification.service';
import { Observable, Subscription } from 'rxjs';
import { Firestore, collection, getDocs, doc, setDoc, query, orderBy, getDoc as getFirestoreDoc, serverTimestamp } from '@angular/fire/firestore';
import { User } from '@angular/fire/auth';

interface NavItem {
  label: string;
  route: string;
  icon: string;
  roles: string[];
}

interface UserData {
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
  @ViewChild('notificationsContainer') notificationsContainer!: ElementRef;
  
  collapsed = signal(false);
  mobileSidebarOpen = signal(false);

  navItems: NavItem[] = [
    { label: 'Dashboard', route: '/dashboard', icon: 'dashboard', roles: ['user', 'store', 'production', 'procurement', 'admin'] },
    { label: 'Production', route: '/dashboard/production', icon: 'factory', roles: ['user', 'store', 'production', 'procurement', 'admin'] },
    { label: 'Ordering', route: '/dashboard/procurement', icon: 'document', roles: ['user', 'store', 'production', 'procurement', 'admin'] },
    { label: 'Usage Report', route: '/dashboard/usage-report', icon: 'line-chart', roles: ['user', 'store', 'production', 'procurement', 'admin'] },
  ];

  filteredNavItems: NavItem[] = [];

  user$: Observable<User | null>;

  showSettings = false;
  showNotifications = false;
  showUserListModal = false;
  showCreateUserModal = false;
  showLogoutConfirm = false;
  logoutSource: 'header' | 'sidebar' | null = null;

  users: UserData[] = [];
  loadingUsers = false;
  userListError: string | null = null;

  createUserForm: any;

  userRole: string | null = null;
  isAdmin = false;

  isCreating = false;
  createError: string | null = null;
  createSuccess: string | null = null;

  notifications: Notification[] = [];
  unreadCount = 0;
  loadingNotifications = false;
  private notificationsUnsubscribe: (() => void) | null = null;

  private isCreatingUser = false;

  private authSubscription?: Subscription;
  private currentUser: User | null = null;

  constructor(
    public themeService: ThemeService,
    private fb: FormBuilder,
    private authService: AuthService,
    private userService: UserService,
    private firestore: Firestore,
    private router: Router,
    private notificationService: NotificationService
  ) {
    this.user$ = this.authService.getCurrentUserObservable();
    
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
    
    if (this.showNotifications && this.notificationsContainer && 
        !this.notificationsContainer.nativeElement.contains(event.target)) {
      this.showNotifications = false;
    }
  }

  async ngOnInit() {
    console.log('Dashboard ngOnInit - Starting');
    
    this.authSubscription = this.user$.subscribe(async (user) => {
      console.log('Dashboard - Auth state changed:', user?.email);
      this.currentUser = user;
      
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
        this.unsubscribeFromNotifications();
      }
    });
  }

  ngOnDestroy() {
    if (typeof document !== 'undefined') {
      document.body.classList.remove('sidebar-collapsed');
      document.body.style.overflow = '';
    }
    if (this.authSubscription) {
      this.authSubscription.unsubscribe();
    }
    this.unsubscribeFromNotifications();
  }

  private subscribeToNotifications() {
    this.unsubscribeFromNotifications();
    
    console.log('Subscribing to notifications for production user');
    
    this.notificationsUnsubscribe = this.notificationService.subscribeToNotifications(
      (notifications) => {
        console.log('Received notifications:', notifications.length);
        this.notifications = notifications;
        this.unreadCount = notifications.length;
      }
    );
  }

  private unsubscribeFromNotifications() {
    if (this.notificationsUnsubscribe) {
      this.notificationsUnsubscribe();
      this.notificationsUnsubscribe = null;
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
      const userDoc = await getFirestoreDoc(userDocRef);
      
      if (userDoc.exists()) {
        const data = userDoc.data();
        console.log('loadUserRole - User doc data:', data);
        this.userRole = data['role'] || 'user';
        this.isAdmin = this.userRole === 'admin';
        console.log('User role loaded:', this.userRole, 'isAdmin:', this.isAdmin);
        
        this.filterNavItems();
        console.log('Filtered nav items:', this.filteredNavItems);
        
        // Subscribe to notifications for production and procurement users
        if (this.userRole === 'production' || this.userRole === 'procurement') {
          this.subscribeToNotifications();
          await this.loadNotifications();
        }
      } else {
        console.log('loadUserRole - No user document found, creating one');
        if (this.currentUser) {
          const userRef = doc(this.firestore, 'users', this.currentUser.uid);
          await setDoc(userRef, {
            email: this.currentUser.email,
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

  getUserInitials(user: User | null): string {
    if (!user) return 'U';
    if (user.email) {
      return user.email.charAt(0).toUpperCase();
    }
    if (user.displayName) {
      return user.displayName.charAt(0).toUpperCase();
    }
    return 'U';
  }

  getUserDisplayName(user: User | null): string {
    if (!user) return 'User';
    if (user.displayName) return user.displayName;
    if (user.email) {
      return user.email.split('@')[0] || user.email;
    }
    return 'User';
  }

  toggleSidebar() {
    // Check if we're on mobile/tablet (1024px and below) using CSS media query
    const isMobile = window.matchMedia('(max-width: 1024px)').matches;

    if (isMobile) {
      this.mobileSidebarOpen.update((current) => !current);
      // Prevent body scrolling when sidebar is open on mobile
      if (typeof document !== 'undefined') {
        document.body.style.overflow = this.mobileSidebarOpen() ? 'hidden' : '';
      }
    } else {
      this.collapsed.update((c) => {
        const next = !c;
        if (typeof document !== 'undefined') {
          document.body.classList.toggle('sidebar-collapsed', next);
        }
        return next;
      });
    }
  }

  closeMobileSidebar() {
    this.mobileSidebarOpen.set(false);
    if (typeof document !== 'undefined') {
      document.body.style.overflow = '';
    }
  }

  @HostListener('window:resize', ['$event'])
  onResize(event: any) {
    // Close mobile sidebar if window is resized to desktop size
    if (window.innerWidth > 1024 && this.mobileSidebarOpen()) {
      this.closeMobileSidebar();
    }
  }

  toggleTheme() {
    this.themeService.toggleTheme();
  }

  toggleSettings() {
    this.showSettings = !this.showSettings;
    if (this.showSettings) {
      this.showNotifications = false;
    }
  }

  toggleNotifications() {
    this.showNotifications = !this.showNotifications;
    if (this.showNotifications) {
      this.showSettings = false;
      this.loadNotifications();
    }
  }

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

  openCreateUserFromList() {
    this.showCreateUserModal = true;
    this.createError = null;
    this.createSuccess = null;
    this.createUserForm.reset({ email: '', password: '', role: 'store' });
  }

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

  async loadUsers() {
    this.loadingUsers = true;
    this.userListError = null;

    try {
      if (!this.isAdmin) {
        throw new Error('You do not have permission to view users');
      }

      console.log('Loading users from Firestore...');
      
      const usersRef = collection(this.firestore, 'users');
      const q = query(usersRef, orderBy('createdAt', 'desc'));
      const querySnapshot = await getDocs(q);
      
      console.log('Found users count:', querySnapshot.size);
      
      const loadedUsers: UserData[] = [];
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
      if (!this.isAdmin) {
        throw new Error('You do not have permission to create users');
      }

      const currentUser = this.authService.getCurrentUser();
      if (!currentUser) {
        throw new Error('You must be logged in as admin');
      }
      const adminUid = currentUser.uid;

      console.log('Creating new user with email:', email, 'role:', role);
      
      await this.userService.createUserAccount(email, password, role);
      
      this.createSuccess = 'User created successfully!';
      this.createUserForm.reset({ email: '', password: '', role: 'store' });
      
      await this.loadUserRole(adminUid);
      
      if (this.showUserListModal) {
        await this.loadUsers();
      }
      
      setTimeout(() => {
        this.closeCreateUserModal();
      }, 1500);
    } catch (err: any) {
      console.error('Create user failed', err);
      
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
      this.userService.clearAdminPassword();
      await this.authService.signOut();
      await this.router.navigate(['/login']);
      this.showLogoutConfirm = false;
      this.logoutSource = null;
      
      // Reset body overflow
      if (typeof document !== 'undefined') {
        document.body.style.overflow = '';
      }
    } catch (err) {
      console.error('Logout failed', err);
    }
  }

  isRouteActive(route: string): boolean {
    return this.router.url === route;
  }

  async loadNotifications() {
    this.loadingNotifications = true;
    try {
      this.notifications = await this.notificationService.getAllNotifications();
      this.unreadCount = this.notifications.filter(n => !n.read).length;
    } catch (err) {
      console.error('Failed to load notifications:', err);
    } finally {
      this.loadingNotifications = false;
    }
  }

  async handleNotificationClick(notification: Notification) {
    if (!notification.read && notification.id) {
      await this.notificationService.markAsRead(notification.id);
    }
    
    if (notification.type === 'table_submitted') {
      this.router.navigate(['/dashboard/production'], { queryParams: { tableId: notification.tableId } });
    } else if (notification.type === 'table_reviewed_by_production') {
      this.router.navigate(['/dashboard/procurement'], { queryParams: { tableId: notification.tableId } });
    }
    
    this.showNotifications = false;
  }

  async dismissNotification(notification: Notification, event: Event) {
    event.stopPropagation();
    await this.notificationService.deleteNotification(notification.id!);
    this.notifications = this.notifications.filter(n => n.id !== notification.id);
    this.unreadCount = this.notifications.filter(n => !n.read).length;
  }

  async markAllNotificationsRead() {
    await this.notificationService.markAllAsRead();
    this.notifications.forEach(n => n.read = true);
    this.unreadCount = 0;
  }

  viewAllNotifications() {
    this.showNotifications = false;
    // Navigate to notifications page if you have one
    // this.router.navigate(['/dashboard/notifications']);
  }
}