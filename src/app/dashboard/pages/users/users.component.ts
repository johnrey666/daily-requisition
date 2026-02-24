// src/app/dashboard/pages/users/users.component.ts
import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AuthService } from '../../../core/services/auth.service';
import { Firestore, collection, query, getDocs, doc, deleteDoc, updateDoc, getDoc } from '@angular/fire/firestore';
import { Timestamp } from 'firebase/firestore';
import { FormsModule } from '@angular/forms';

interface User {
  id: string;
  email: string;
  role: string;
  createdAt?: Timestamp | any;
}

@Component({
  selector: 'app-users',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="users-container">
      <!-- Header -->
      <div class="page-header">
        <div class="header-left">
          <h1>User Management</h1>
          <p class="subtitle">Manage system users and their roles</p>
        </div>
        <div class="role-badge" *ngIf="currentUserRole === 'admin'">
          <span class="badge admin">Admin Access</span>
        </div>
      </div>

      <!-- Stats Cards -->
      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-icon">👥</div>
          <div class="stat-content">
            <span class="stat-value">{{ users.length }}</span>
            <span class="stat-label">Total Users</span>
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-icon">🛡️</div>
          <div class="stat-content">
            <span class="stat-value">{{ getRoleCount('admin') }}</span>
            <span class="stat-label">Admins</span>
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-icon">📦</div>
          <div class="stat-content">
            <span class="stat-value">{{ getRoleCount('store') }}</span>
            <span class="stat-label">Store</span>
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-icon">🏭</div>
          <div class="stat-content">
            <span class="stat-value">{{ getRoleCount('production') }}</span>
            <span class="stat-label">Production</span>
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-icon">📋</div>
          <div class="stat-content">
            <span class="stat-value">{{ getRoleCount('procurement') }}</span>
            <span class="stat-label">Procurement</span>
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-icon">👤</div>
          <div class="stat-content">
            <span class="stat-value">{{ getRoleCount('user') }}</span>
            <span class="stat-label">Regular Users</span>
          </div>
        </div>
      </div>

      <!-- Notification -->
      <div class="snackbar" [class.show]="showNotification" [class]="'snackbar-' + notificationType">
        <span>{{ notificationMessage }}</span>
        <button class="snackbar-close" (click)="hideNotification()">✕</button>
      </div>
      
      <!-- Users Table -->
      <div class="card" *ngIf="!isLoading">
        <div class="card-header">
          <div class="card-title">
            <h3>System Users</h3>
            <span class="user-count">{{ users.length }} total</span>
          </div>
          <div class="search-box">
            <svg class="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="11" cy="11" r="8"/>
              <path d="M21 21l-4.35-4.35"/>
            </svg>
            <input 
              type="text" 
              placeholder="Search users..." 
              [(ngModel)]="searchTerm"
              (ngModelChange)="filterUsers()"
            />
          </div>
        </div>
        <div class="table-responsive">
          <table class="users-table">
            <thead>
              <tr>
                <th>User</th>
                <th>Email</th>
                <th>Role</th>
                <th>Created</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              <tr *ngFor="let user of filteredUsers">
                <td>
                  <div class="user-avatar">
                    {{ getUserInitials(user.email) }}
                  </div>
                </td>
                <td>{{ user.email }}</td>
                <td>
                  <span class="role-badge" [class]="'role-' + user.role">
                    {{ user.role | titlecase }}
                  </span>
                </td>
                <td>{{ formatDate(user.createdAt) }}</td>
                <td>
                  <div class="action-buttons">
                    <button 
                      class="btn-icon edit" 
                      title="Edit Role" 
                      (click)="openEditRoleModal(user)"
                      *ngIf="user.email !== 'admin@gmail.com' && currentUserRole === 'admin'">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                        <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/>
                      </svg>
                    </button>
                    <button 
                      class="btn-icon delete" 
                      title="Delete User" 
                      (click)="deleteUser(user)" 
                      *ngIf="user.email !== 'admin@gmail.com' && currentUserRole === 'admin'">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                        <polyline points="3 6 5 6 21 6"/>
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/>
                        <line x1="10" y1="11" x2="10" y2="17"/>
                        <line x1="14" y1="11" x2="14" y2="17"/>
                      </svg>
                    </button>
                  </div>
                </td>
              </tr>
              <tr *ngIf="filteredUsers.length === 0">
                <td colspan="5" class="no-results">
                  No users found matching your search
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Loading State -->
      <div *ngIf="isLoading" class="loading-state">
        <div class="spinner"></div>
        <p>Loading users...</p>
      </div>

      <!-- Edit Role Modal -->
      <div class="modal-overlay" *ngIf="showEditModal" (click)="closeEditRoleModal()">
        <div class="modal" (click)="$event.stopPropagation()">
          <div class="modal-header">
            <h3>Edit User Role</h3>
            <button class="modal-close" (click)="closeEditRoleModal()">✕</button>
          </div>
          
          <div class="modal-body" *ngIf="selectedUser">
            <div class="user-info">
              <div class="user-avatar large">{{ getUserInitials(selectedUser.email) }}</div>
              <div class="user-details">
                <span class="user-email">{{ selectedUser.email }}</span>
                <span class="current-role">Current: {{ selectedUser.role | titlecase }}</span>
              </div>
            </div>

            <div class="form-group">
              <label>Select New Role</label>
              <select [(ngModel)]="editRole" class="role-select">
                <option value="user">User</option>
                <option value="store">Store</option>
                <option value="production">Production</option>
                <option value="procurement">Procurement</option>
                <option value="admin">Admin</option>
              </select>
            </div>

            <div class="form-group" *ngIf="editError || editSuccess">
              <div class="alert error" *ngIf="editError">{{ editError }}</div>
              <div class="alert success" *ngIf="editSuccess">{{ editSuccess }}</div>
            </div>
          </div>

          <div class="modal-footer">
            <button class="btn btn-secondary" (click)="closeEditRoleModal()">Cancel</button>
            <button 
              class="btn btn-primary" 
              (click)="updateUserRole()" 
              [disabled]="isUpdating || editRole === selectedUser?.role">
              <span *ngIf="isUpdating" class="spinner-small"></span>
              {{ isUpdating ? 'Updating...' : 'Update Role' }}
            </button>
          </div>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .users-container {
      padding: 24px;
      max-width: 1400px;
      margin: 0 auto;
    }

    /* Header Styles */
    .page-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 24px;
    }

    .header-left h1 {
      margin: 0 0 4px 0;
      font-size: 28px;
      font-weight: 600;
      background: linear-gradient(135deg, #3b82f6, #8b5cf6);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
    }

    .subtitle {
      margin: 0;
      color: var(--text-secondary);
      font-size: 14px;
    }

    .role-badge .badge {
      padding: 6px 12px;
      border-radius: 20px;
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
      background: linear-gradient(135deg, #ef4444, #dc2626);
      color: white;
      box-shadow: 0 2px 4px rgba(239, 68, 68, 0.2);
    }

    /* Stats Grid */
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: 16px;
      margin-bottom: 24px;
    }

    .stat-card {
      background: var(--surface-color);
      border: 1px solid var(--border-color);
      border-radius: 12px;
      padding: 16px;
      display: flex;
      align-items: center;
      gap: 12px;
      transition: all 0.2s;
    }

    .stat-card:hover {
      transform: translateY(-2px);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
    }

    .stat-icon {
      font-size: 32px;
      line-height: 1;
    }

    .stat-content {
      display: flex;
      flex-direction: column;
    }

    .stat-value {
      font-size: 24px;
      font-weight: 600;
      color: var(--text-primary);
    }

    .stat-label {
      font-size: 12px;
      color: var(--text-secondary);
    }

    /* Card Styles */
    .card {
      background: var(--surface-color);
      border: 1px solid var(--border-color);
      border-radius: 12px;
      overflow: hidden;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
    }

    .card-header {
      padding: 20px;
      border-bottom: 1px solid var(--border-color);
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 16px;
    }

    .card-title {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .card-title h3 {
      margin: 0;
      font-size: 18px;
      font-weight: 600;
    }

    .user-count {
      padding: 4px 8px;
      background: var(--background-color);
      border-radius: 12px;
      font-size: 12px;
      color: var(--text-secondary);
    }

    /* Search Box */
    .search-box {
      position: relative;
      min-width: 300px;
    }

    .search-icon {
      position: absolute;
      left: 12px;
      top: 50%;
      transform: translateY(-50%);
      width: 18px;
      height: 18px;
      color: var(--text-secondary);
    }

    .search-box input {
      width: 100%;
      padding: 10px 12px 10px 40px;
      border: 1px solid var(--border-color);
      border-radius: 8px;
      background: var(--background-color);
      font-size: 14px;
      transition: all 0.2s;
    }

    .search-box input:focus {
      outline: none;
      border-color: #3b82f6;
      box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
    }

    /* Table Styles */
    .table-responsive {
      overflow-x: auto;
    }

    .users-table {
      width: 100%;
      border-collapse: collapse;
    }

    .users-table th {
      text-align: left;
      padding: 16px 20px;
      background: var(--background-color);
      font-weight: 500;
      color: var(--text-secondary);
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      border-bottom: 2px solid var(--border-color);
    }

    .users-table td {
      padding: 16px 20px;
      border-bottom: 1px solid var(--border-color);
      vertical-align: middle;
    }

    .users-table tr:hover {
      background: var(--background-color);
    }

    /* User Avatar */
    .user-avatar {
      width: 36px;
      height: 36px;
      border-radius: 50%;
      background: linear-gradient(135deg, #3b82f6, #8b5cf6);
      color: white;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 600;
      font-size: 14px;
      text-transform: uppercase;
    }

    .user-avatar.large {
      width: 48px;
      height: 48px;
      font-size: 18px;
    }

    /* Role Badges */
    .role-badge {
      padding: 6px 12px;
      border-radius: 20px;
      font-size: 12px;
      font-weight: 500;
      display: inline-block;
    }

    .role-admin {
      background: linear-gradient(135deg, #ef4444, #dc2626);
      color: white;
    }

    .role-store {
      background: linear-gradient(135deg, #22c55e, #16a34a);
      color: white;
    }

    .role-production {
      background: linear-gradient(135deg, #a855f7, #9333ea);
      color: white;
    }

    .role-procurement {
      background: linear-gradient(135deg, #f59e0b, #d97706);
      color: white;
    }

    .role-user {
      background: linear-gradient(135deg, #6b7280, #4b5563);
      color: white;
    }

    /* Action Buttons */
    .action-buttons {
      display: flex;
      gap: 8px;
    }

    .btn-icon {
      width: 32px;
      height: 32px;
      border-radius: 6px;
      border: none;
      background: var(--background-color);
      color: var(--text-secondary);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.2s;
    }

    .btn-icon:hover {
      transform: translateY(-2px);
    }

    .btn-icon.edit:hover {
      background: #3b82f6;
      color: white;
    }

    .btn-icon.delete:hover {
      background: #ef4444;
      color: white;
    }

    /* No Results */
    .no-results {
      text-align: center;
      padding: 48px !important;
      color: var(--text-secondary);
      font-style: italic;
    }

    /* Loading State */
    .loading-state {
      text-align: center;
      padding: 48px;
      background: var(--surface-color);
      border-radius: 12px;
      border: 1px solid var(--border-color);
    }

    .spinner {
      width: 40px;
      height: 40px;
      border: 3px solid var(--border-color);
      border-top-color: #3b82f6;
      border-radius: 50%;
      animation: spin 1s linear infinite;
      margin: 0 auto 16px;
    }

    .spinner-small {
      width: 16px;
      height: 16px;
      border: 2px solid rgba(255,255,255,0.3);
      border-top-color: white;
      border-radius: 50%;
      animation: spin 1s linear infinite;
      display: inline-block;
      margin-right: 8px;
    }

    @keyframes spin {
      to { transform: rotate(360deg); }
    }

    /* Modal Styles */
    .modal-overlay {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.5);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 1000;
      backdrop-filter: blur(4px);
    }

    .modal {
      background: var(--surface-color);
      border-radius: 12px;
      width: 90%;
      max-width: 500px;
      max-height: 90vh;
      overflow-y: auto;
      box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.2);
    }

    .modal-header {
      padding: 20px 24px;
      border-bottom: 1px solid var(--border-color);
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .modal-header h3 {
      margin: 0;
      font-size: 18px;
      font-weight: 600;
    }

    .modal-close {
      background: none;
      border: none;
      font-size: 20px;
      cursor: pointer;
      color: var(--text-secondary);
      padding: 4px;
    }

    .modal-close:hover {
      color: var(--text-primary);
    }

    .modal-body {
      padding: 24px;
    }

    .modal-footer {
      padding: 20px 24px;
      border-top: 1px solid var(--border-color);
      display: flex;
      justify-content: flex-end;
      gap: 12px;
    }

    /* User Info in Modal */
    .user-info {
      display: flex;
      align-items: center;
      gap: 16px;
      padding: 16px;
      background: var(--background-color);
      border-radius: 8px;
      margin-bottom: 20px;
    }

    .user-details {
      display: flex;
      flex-direction: column;
    }

    .user-email {
      font-weight: 500;
      margin-bottom: 4px;
    }

    .current-role {
      font-size: 12px;
      color: var(--text-secondary);
    }

    /* Form Styles */
    .form-group {
      margin-bottom: 20px;
    }

    .form-group label {
      display: block;
      margin-bottom: 8px;
      font-weight: 500;
      font-size: 14px;
    }

    .role-select {
      width: 100%;
      padding: 10px 12px;
      border: 1px solid var(--border-color);
      border-radius: 6px;
      background: var(--surface-color);
      font-size: 14px;
      transition: all 0.2s;
    }

    .role-select:focus {
      outline: none;
      border-color: #3b82f6;
      box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
    }

    /* Button Styles */
    .btn {
      padding: 10px 16px;
      border-radius: 6px;
      border: none;
      font-size: 14px;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.2s;
    }

    .btn-primary {
      background: #3b82f6;
      color: white;
    }

    .btn-primary:hover:not(:disabled) {
      background: #2563eb;
      transform: translateY(-2px);
      box-shadow: 0 4px 12px rgba(59, 130, 246, 0.3);
    }

    .btn-secondary {
      background: var(--background-color);
      border: 1px solid var(--border-color);
      color: var(--text-primary);
    }

    .btn-secondary:hover {
      background: var(--surface-color);
    }

    .btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    /* Alert Styles */
    .alert {
      padding: 12px;
      border-radius: 6px;
      font-size: 14px;
    }

    .alert.error {
      background: #fee2e2;
      color: #991b1b;
      border: 1px solid #fecaca;
    }

    .alert.success {
      background: #dcfce7;
      color: #166534;
      border: 1px solid #bbf7d0;
    }

    /* Snackbar */
    .snackbar {
      position: fixed;
      bottom: 24px;
      right: 24px;
      background: var(--surface-color);
      border: 1px solid var(--border-color);
      border-radius: 8px;
      padding: 12px 16px;
      display: flex;
      align-items: center;
      gap: 12px;
      box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
      transform: translateY(100px);
      opacity: 0;
      transition: all 0.3s ease;
      z-index: 1100;
    }

    .snackbar.show {
      transform: translateY(0);
      opacity: 1;
    }

    .snackbar.snackbar-success {
      background: #22c55e;
      color: white;
      border-color: #16a34a;
    }

    .snackbar.snackbar-error {
      background: #ef4444;
      color: white;
      border-color: #dc2626;
    }

    .snackbar.snackbar-info {
      background: #3b82f6;
      color: white;
      border-color: #2563eb;
    }

    .snackbar-close {
      background: none;
      border: none;
      color: currentColor;
      cursor: pointer;
      opacity: 0.7;
      padding: 4px;
    }

    .snackbar-close:hover {
      opacity: 1;
    }

    /* Responsive */
    @media (max-width: 768px) {
      .users-container {
        padding: 16px;
      }

      .stats-grid {
        grid-template-columns: repeat(2, 1fr);
      }

      .card-header {
        flex-direction: column;
        align-items: stretch;
      }

      .search-box {
        min-width: auto;
      }

      .users-table td {
        padding: 12px;
      }

      .action-buttons {
        flex-direction: column;
      }
    }
  `]
})
export class UsersComponent implements OnInit {
  users: User[] = [];
  filteredUsers: User[] = [];
  isLoading = true;
  currentUserRole: string | null = null;
  searchTerm: string = '';
  
  // Edit role modal
  showEditModal = false;
  selectedUser: User | null = null;
  editRole: string = '';
  isUpdating = false;
  editError: string | null = null;
  editSuccess: string | null = null;

  // Notification
  showNotification = false;
  notificationMessage = '';
  notificationType: 'success' | 'error' | 'info' = 'info';
  notificationTimeout: any;

  constructor(
    private authService: AuthService,
    private firestore: Firestore
  ) {}

  async ngOnInit() {
    await this.loadCurrentUserRole();
    await this.loadUsers();
  }

  async loadCurrentUserRole() {
    try {
      const user = this.authService.getCurrentUser();
      if (user) {
        const userDoc = await getDoc(doc(this.firestore, 'users', user.uid));
        if (userDoc.exists()) {
          const data = userDoc.data() as any;
          this.currentUserRole = data['role'] || 'user';
        }
      }
    } catch (err) {
      console.error('Failed to load current user role', err);
    }
  }

  async loadUsers() {
    try {
      const usersRef = collection(this.firestore, 'users');
      const snapshot = await getDocs(usersRef);
      
      this.users = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as User[];
      
      // Sort users by email
      this.users.sort((a, b) => a.email.localeCompare(b.email));
      this.filteredUsers = [...this.users];
      
      console.log('Loaded users:', this.users);
    } catch (err) {
      console.error('Failed to load users:', err);
      this.showMessage('Failed to load users', 'error');
    } finally {
      this.isLoading = false;
    }
  }

  filterUsers() {
    if (!this.searchTerm.trim()) {
      this.filteredUsers = [...this.users];
      return;
    }

    const term = this.searchTerm.toLowerCase().trim();
    this.filteredUsers = this.users.filter(user => 
      user.email.toLowerCase().includes(term) ||
      user.role.toLowerCase().includes(term)
    );
  }

  getUserInitials(email: string): string {
    return email ? email.charAt(0).toUpperCase() : 'U';
  }

  getRoleCount(role: string): number {
    return this.users.filter(user => user.role === role).length;
  }

  formatDate(date: any): string {
    if (!date) return 'N/A';
    
    // Handle Firestore Timestamp
    if (date && typeof date.toDate === 'function') {
      return date.toDate().toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
      });
    }
    
    // Handle Date object
    if (date instanceof Date) {
      return date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
      });
    }
    
    // Handle string date
    if (typeof date === 'string') {
      return new Date(date).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
      });
    }
    
    return 'N/A';
  }

  openEditRoleModal(user: User) {
    this.selectedUser = user;
    this.editRole = user.role;
    this.showEditModal = true;
    this.editError = null;
    this.editSuccess = null;
  }

  closeEditRoleModal() {
    this.showEditModal = false;
    this.selectedUser = null;
    this.editRole = '';
  }

  async updateUserRole() {
    if (!this.selectedUser || this.editRole === this.selectedUser.role) return;

    this.isUpdating = true;
    this.editError = null;
    this.editSuccess = null;

    try {
      const userRef = doc(this.firestore, 'users', this.selectedUser.id);
      await updateDoc(userRef, {
        role: this.editRole,
        updatedAt: new Date()
      });
      
      // Update local array
      const index = this.users.findIndex(u => u.id === this.selectedUser?.id);
      if (index !== -1) {
        this.users[index].role = this.editRole;
        this.filterUsers();
      }
      
      this.editSuccess = `Role updated to ${this.editRole}`;
      this.showMessage(`Role updated for ${this.selectedUser.email}`, 'success');
      
      // Close modal after success
      setTimeout(() => {
        this.closeEditRoleModal();
      }, 1500);
      
    } catch (err) {
      console.error('Failed to update role:', err);
      this.editError = 'Failed to update role. Please try again.';
      this.showMessage('Failed to update role', 'error');
    } finally {
      this.isUpdating = false;
    }
  }

  async deleteUser(user: User) {
    if (user.email === 'admin@gmail.com') {
      this.showMessage('Cannot delete the main admin account', 'error');
      return;
    }

    if (!confirm(`Are you sure you want to delete user ${user.email}? This action cannot be undone.`)) {
      return;
    }

    try {
      const userRef = doc(this.firestore, 'users', user.id);
      await deleteDoc(userRef);
      
      // Note: Deleting from Firestore doesn't delete from Auth
      // You'll need a Cloud Function to also delete from Auth
      
      this.users = this.users.filter(u => u.id !== user.id);
      this.filterUsers();
      this.showMessage(`User ${user.email} deleted`, 'success');
    } catch (err) {
      console.error('Failed to delete user:', err);
      this.showMessage('Failed to delete user', 'error');
    }
  }

  showMessage(message: string, type: 'success' | 'error' | 'info' = 'info') {
    if (this.notificationTimeout) {
      clearTimeout(this.notificationTimeout);
    }
    
    this.notificationMessage = message;
    this.notificationType = type;
    this.showNotification = true;
    
    this.notificationTimeout = setTimeout(() => {
      this.showNotification = false;
    }, 3000);
  }

  hideNotification() {
    this.showNotification = false;
    if (this.notificationTimeout) {
      clearTimeout(this.notificationTimeout);
    }
  }
}