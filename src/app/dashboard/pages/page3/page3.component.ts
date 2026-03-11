// src/app/dashboard/pages/page3/page3.component.ts
import { Component, OnInit, HostListener, Injector } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { runInInjectionContext } from '@angular/core';
import { DatabaseService } from '../../../core/services/database.service';
import { AuthService } from '../../../core/services/auth.service';
import { NotificationService } from '../../../core/services/notification.service';
import {
  Firestore, doc, collection, query, where, getDocs,
  orderBy, writeBatch, getDoc
} from '@angular/fire/firestore';
import { Router, ActivatedRoute } from '@angular/router';

interface Material {
  raw_material: string;
  quantity_per_batch: number | null;
  unit: string;
  type: string;
}

interface Requisition {
  id: string;
  reqNumber: string;
  type: string;
  dateNeeded?: string;
  skuCode: string;
  skuName: string;
  quantity: number;
  unit: string;
  supplier: string;
  brand?: string;
  status: string;
  category: string;
  remarks?: string;
  created_at?: string;
  user_id?: string;
  user_email?: string;
  table_id?: string;
  table_name?: string;
  submitted_at?: string;
  scheduled_date?: string;
  scheduled_at?: string;
  scheduled_by?: string;
  approved_at?: string;
  approved_by?: string;
  rejection_reason?: string;
  production_action?: 'confirmed' | 'removed';
  production_action_at?: string;
  production_action_by?: string;
  production_action_notes?: string;
  procurement_action?: 'reviewed' | 'pending';
  procurement_action_at?: string;
  procurement_action_by?: string;
  procurement_notes?: string;
  materials?: Material[];
  [key: string]: any;
}

interface Table {
  id: string;
  name: string;
  user_id: string;
  user_email?: string;
  type: 'inventory' | 'requisition' | 'production';
  item_count?: number;
  created_at?: string;
  updated_at?: string;
  submitted?: boolean;
  submitted_at?: string;
}

interface SkuOption {
  sku_code: string;
  sku_name: string;
}

@Component({
  selector: 'app-page3',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './page3.component.html',
  styleUrls: ['./page3.component.css']
})
export class Page3Component implements OnInit {

  // Master Data
  categories: string[] = [];
  availableSkus: SkuOption[] = [];

  // Tables
  tables: Table[] = [];
  selectedTableId: string = '';
  selectedTable: Table | null = null;
  showTableDropdown = false;

  // Requisitions
  requisitions: Requisition[] = [];
  filteredRequisitions: Requisition[] = [];
  paginatedRequisitions: Requisition[] = [];

  // Production views
  productionSubmissions: Requisition[] = [];
  productionReviewed: Requisition[] = [];
  selectedProductionView: 'submissions' | 'reviewed' = 'submissions';

  // Procurement view
  procurementReviewed: Requisition[] = [];

  // Expanded rows for materials
  expandedRows: { [id: string]: boolean } = {};
  loadingMaterials: { [id: string]: boolean } = {};

  // UI State
  showModal = false;
  showTableModal = false;
  showScheduleModal = false;
  showApproveModal = false;
  showRejectModal = false;
  showDeliveryModal = false;
  showMissingNotesModal = false;
  showProductionActionModal = false;
  viewMode: 'my_tables' | 'store_submissions' | 'for_delivery' | 'production_reviewed' | 'procurement_reviewed' = 'my_tables';
  showAllPending = false;
  submitted = false;
  isLoading = false;
  isSubmitting = false;
  today = new Date().toISOString().split('T')[0];

  // Form Data
  formData: any = {
    type: '',
    category: '',
    skuName: '',
    quantity: null,
    unit: '',
    dateNeeded: '',
    supplier: '',
    customSupplier: '',
    brand: '',
    customBrand: '',
    remarks: ''
  };

  // Schedule Data
  selectedRequisition: Requisition | null = null;
  scheduledDate: string = '';
  scheduledTime: string = '';

  // Approval Data
  approvalNotes: string = '';
  rejectionReason: string = '';
  missingMaterialsNotes: string = '';

  // Production Action Data
  productionActionType: 'confirm' | 'remove' = 'confirm';
  productionActionNotes: string = '';

  // Editing
  editingRequisition: Requisition | null = null;
  editingTable: Table | null = null;
  newTableName: string = '';
  editTableName: string = '';

  // Selected SKU Code
  selectedSkuCode: string = '';

  // Filter & Pagination
  searchQuery = '';
  filterStatus = '';
  currentPage = 1;
  pageSize = 10;
  totalPages = 1;

  // Snackbar
  showSnackbar = false;
  snackbarMessage = '';
  snackbarType: 'success' | 'error' | 'info' = 'info';
  snackbarTimeout: any;

  // Import
  importStatus: 'idle' | 'loading' | 'success' | 'error' = 'idle';
  importMessage = '';
  selectedFileName = '';

  // User Role
  userRole: string = '';
  userId: string = '';

  // Table names for cross-user views
  tableNameMap: { [tableId: string]: string } = {};

  Math = Math;

  constructor(
    private db: DatabaseService,
    private auth: AuthService,
    private firestore: Firestore,
    private router: Router,
    private route: ActivatedRoute,
    private injector: Injector,
    private notificationService: NotificationService
  ) {}

  private run<T>(fn: () => Promise<T>): Promise<T> {
    return runInInjectionContext(this.injector, fn);
  }

  async ngOnInit() {
    console.log('Page3Component initialized');
    const user = await this.auth.getCurrentUserPromise();
    console.log('Current user:', user);

    if (user) {
      this.userId = user.uid;
      console.log('User ID set:', this.userId);

      await this.loadUserRole();
      console.log('User role loaded:', this.userRole);

      await this.loadCategories();
      console.log('Categories loaded:', this.categories);

      this.setViewModeByRole();

      if (this.userRole === 'production') {
        await this.loadProductionSubmissions();
        await this.loadProductionReviewed();
        this.filteredRequisitions = [...this.productionSubmissions];
        console.log('Production submissions loaded:', this.productionSubmissions.length);
      } else if (this.userRole === 'procurement') {
        await this.loadProcurementReviewed();
        this.filteredRequisitions = [...this.procurementReviewed];
        console.log('Procurement items loaded:', this.procurementReviewed.length);
      } else {
        await this.loadTablesDirectly();
      }

      this.route.queryParams.subscribe(async params => {
        if (params['tableId']) {
          console.log('Opening table from notification:', params['tableId']);
          setTimeout(async () => {
            const tableToSelect = this.tables.find(t => t.id === params['tableId']);
            if (tableToSelect) {
              await this.selectTable(tableToSelect);
            }
          }, 1000);
        }
      });
    } else {
      console.log('No user found, redirecting to login');
      this.showToast('Please log in to continue', 'error');
      this.router.navigate(['/login']);
    }
  }

  async loadUserRole() {
    try {
      const userDocRef = doc(this.firestore, 'users', this.userId);
      const userDoc = await this.run(() => getDoc(userDocRef));

      if (userDoc.exists()) {
        const data = userDoc.data() as any;
        this.userRole = data['role'] || 'user';
      } else {
        this.userRole = 'user';
      }
      console.log('User role loaded:', this.userRole);
    } catch (err) {
      console.error('Failed to load user role:', err);
      this.userRole = 'user';
    }
  }

  async loadCategories() {
    try {
      this.categories = await this.db.getUniqueCategories();
      console.log('Loaded categories:', this.categories);
    } catch (err) {
      console.error('Failed to load categories:', err);
    }
  }

  setViewModeByRole() {
    if (this.userRole === 'production') {
      this.viewMode = 'store_submissions';
    } else if (this.userRole === 'procurement') {
      this.viewMode = 'for_delivery';
    } else {
      this.viewMode = 'my_tables';
    }
  }

  async loadTablesDirectly() {
    console.log('Loading tables directly from Firestore for user:', this.userId);

    try {
      this.isLoading = true;
      const tablesRef = collection(this.firestore, 'tables');

      let querySnapshot;

      if (this.userRole === 'production' || this.userRole === 'procurement') {
        querySnapshot = await this.run(() => {
          const q = query(
            tablesRef,
            where('type', '==', 'requisition'),
            orderBy('created_at', 'desc')
          );
          return getDocs(q);
        });
      } else {
        querySnapshot = await this.run(() => {
          const q = query(
            tablesRef,
            where('user_id', '==', this.userId),
            where('type', '==', 'requisition')
          );
          return getDocs(q);
        });
      }

      console.log('Found', querySnapshot.size, 'tables');

      const loadedTables: Table[] = [];
      const userEmailPromises: Promise<void>[] = [];

      querySnapshot.forEach(doc => {
        const data = doc.data();
        const table: Table = {
          id: doc.id,
          name: data['name'] || 'Untitled',
          user_id: data['user_id'] || '',
          type: data['type'] || 'requisition',
          item_count: data['item_count'] || 0,
          submitted: data['submitted'] || false,
          submitted_at: data['submitted_at'],
          created_at: data['created_at'],
          updated_at: data['updated_at']
        };

        if (table.user_id) {
          const emailPromise = this.getUserEmail(table.user_id).then(email => {
            table.user_email = email;
          });
          userEmailPromises.push(emailPromise);
        }

        loadedTables.push(table);
      });

      await Promise.all(userEmailPromises);

      if (this.userRole === 'production') {
        loadedTables.sort((a, b) => {
          if (a.submitted && !b.submitted) return -1;
          if (!a.submitted && b.submitted) return 1;
          if (a.submitted && b.submitted) {
            return (b.submitted_at || '').localeCompare(a.submitted_at || '');
          }
          return (b.created_at || '').localeCompare(a.created_at || '');
        });
      }

      this.tables = loadedTables;

      if (this.userRole === 'production' || this.userRole === 'procurement') {
        this.selectedTableId = '';
        this.selectedTable = null;

        if (this.userRole === 'production') {
          await this.loadProductionSubmissions();
          await this.loadProductionReviewed();
          this.filteredRequisitions = [...this.productionSubmissions];
        } else if (this.userRole === 'procurement') {
          await this.loadProcurementReviewed();
          this.filteredRequisitions = [...this.procurementReviewed];
        }
      } else if (this.tables.length > 0) {
        const lastTableId = localStorage.getItem(`lastSelectedRequisitionTable_${this.userId}`);

        if (lastTableId && this.tables.some(t => t.id === lastTableId)) {
          this.selectedTableId = lastTableId;
        } else {
          this.selectedTableId = this.tables[0].id;
        }

        this.selectedTable = this.tables.find(t => t.id === this.selectedTableId) || null;
        await this.loadRequisitionsDirectly();
      }

    } catch (err) {
      console.error('Error loading tables directly:', err);
      this.showToast('Failed to load tables', 'error');
    } finally {
      this.isLoading = false;
    }
  }

  async loadRequisitionsDirectly() {
    if (!this.selectedTableId) {
      console.log('Missing tableId for loading requisitions');
      return;
    }

    console.log('Loading requisitions directly for table:', this.selectedTableId);

    try {
      this.isLoading = true;

      const querySnapshot = await this.run(() => {
        const requisitionsRef = collection(this.firestore, 'requisitions');
        const q = query(
          requisitionsRef,
          where('table_id', '==', this.selectedTableId),
          where('user_id', '==', this.userId),
          orderBy('created_at', 'desc')
        );
        return getDocs(q);
      });

      console.log('Found', querySnapshot.size, 'requisitions');

      const loadedRequisitions: Requisition[] = [];
      querySnapshot.forEach(doc => {
        const data = doc.data();

        let scheduledDate = null;
        if (data['scheduled_date']) {
          scheduledDate = data['scheduled_date'];
        } else if (data['scheduled_at']) {
          scheduledDate = data['scheduled_at'];
        }

        if (scheduledDate && typeof scheduledDate === 'object' && scheduledDate.toDate) {
          scheduledDate = scheduledDate.toDate().toISOString();
        }

        loadedRequisitions.push({
          id: doc.id,
          ...data,
          scheduled_date: scheduledDate
        } as Requisition);
      });

      this.requisitions = loadedRequisitions;
      this.applyFilter();

    } catch (err) {
      console.error('Error loading requisitions:', err);
      this.showToast('Failed to load requisitions', 'error');
    } finally {
      this.isLoading = false;
    }
  }

  async loadProductionSubmissions() {
    this.isLoading = true;
    try {
      const requisitionsRef = collection(this.firestore, 'requisitions');

      const submissionsSnapshot = await this.run(() => {
        const q = query(
          requisitionsRef,
          where('status', '==', 'Submitted'),
          orderBy('submitted_at', 'desc')
        );
        return getDocs(q);
      });

      const submissions: Requisition[] = [];
      submissionsSnapshot.forEach(doc => {
        const data = doc.data();
        submissions.push({ id: doc.id, ...data } as Requisition);
      });

      await this.loadUserEmailsForRequisitions(submissions);
      await this.loadTableNamesForRequisitions(submissions);

      this.productionSubmissions = submissions;

      if (this.selectedProductionView === 'submissions') {
        this.filteredRequisitions = [...this.productionSubmissions];
        this.updatePagination();
      }

    } catch (err) {
      console.error('Failed to load production submissions', err);
      this.showToast('Failed to load submissions', 'error');
    } finally {
      this.isLoading = false;
    }
  }

  async loadProductionReviewed() {
    this.isLoading = true;
    try {
      const requisitionsRef = collection(this.firestore, 'requisitions');

      const reviewedSnapshot = await this.run(() => {
        const q = query(
          requisitionsRef,
          where('production_action', 'in', ['confirmed', 'removed']),
          orderBy('production_action_at', 'desc')
        );
        return getDocs(q);
      });

      const reviewed: Requisition[] = [];
      reviewedSnapshot.forEach(doc => {
        const data = doc.data();
        reviewed.push({ id: doc.id, ...data } as Requisition);
      });

      await this.loadUserEmailsForRequisitions(reviewed);
      await this.loadTableNamesForRequisitions(reviewed);

      this.productionReviewed = reviewed;

      if (this.selectedProductionView === 'reviewed') {
        this.filteredRequisitions = [...this.productionReviewed];
        this.updatePagination();
      }

    } catch (err) {
      console.error('Failed to load production reviewed', err);
      this.showToast('Failed to load reviewed items', 'error');
    } finally {
      this.isLoading = false;
    }
  }

  async loadProcurementReviewed() {
    this.isLoading = true;
    try {
      const requisitionsRef = collection(this.firestore, 'requisitions');

      const snapshot = await this.run(() => {
        const q = query(
          requisitionsRef,
          where('production_action', '==', 'confirmed'),
          orderBy('production_action_at', 'desc')
        );
        return getDocs(q);
      });

      const reviewed: Requisition[] = [];
      snapshot.forEach(doc => {
        const data = doc.data();
        reviewed.push({ id: doc.id, ...data } as Requisition);
      });

      await this.loadUserEmailsForRequisitions(reviewed);
      await this.loadTableNamesForRequisitions(reviewed);

      this.procurementReviewed = reviewed;
      this.filteredRequisitions = [...this.procurementReviewed];
      this.updatePagination();

    } catch (err) {
      console.error('Failed to load procurement reviewed', err);
      this.showToast('Failed to load reviewed requisitions', 'error');
    } finally {
      this.isLoading = false;
    }
  }

  private async loadTableNamesForRequisitions(reqs: Requisition[]) {
    const tableIds: string[] = [];
    reqs.forEach(r => {
      if (r.table_id) tableIds.push(r.table_id);
    });
    const uniqueTableIds = [...new Set(tableIds)];

    const promises = uniqueTableIds.map(async (tid) => {
      if (!this.tableNameMap[tid]) {
        const t = await this.db.getTableById(tid);
        if (t) this.tableNameMap[tid] = t.name || 'Untitled';
      }
    });

    await Promise.all(promises);
  }

  private async loadUserEmailsForRequisitions(reqs: Requisition[]) {
    const userIds: string[] = [];
    reqs.forEach(r => {
      if (r.user_id) userIds.push(r.user_id);
    });
    const uniqueUserIds = [...new Set(userIds)];

    const emailPromises = uniqueUserIds.map(async (uid) => {
      try {
        const userDocRef = doc(this.firestore, 'users', uid);
        const userDoc = await this.run(() => getDoc(userDocRef));
        if (userDoc.exists()) {
          const data = userDoc.data();
          const email = data['email'] || 'Unknown';
          reqs.forEach(r => {
            if (r.user_id === uid) r.user_email = email;
          });
        }
      } catch (err) {
        console.error('Failed to load user email for:', uid, err);
      }
    });

    await Promise.all(emailPromises);
  }

  private async getUserEmail(userId: string): Promise<string> {
    try {
      const userDocRef = doc(this.firestore, 'users', userId);
      const userDoc = await this.run(() => getDoc(userDocRef));
      if (userDoc.exists()) {
        const data = userDoc.data();
        return data['email'] || 'Unknown';
      }
    } catch (err) {
      console.error('Failed to load user email:', err);
    }
    return 'Unknown';
  }

  getColspan(): number {
    let baseCols = 13;
    if (this.userRole === 'production') {
      baseCols = 14;
    }
    return baseCols;
  }

  async onTableChange() {
    if (!this.selectedTableId) {
      this.requisitions = [];
      this.filteredRequisitions = [];
      this.selectedTable = null;
      return;
    }

    console.log('Table changed to:', this.selectedTableId);

    if (this.userRole !== 'production' && this.userRole !== 'procurement') {
      localStorage.setItem(`lastSelectedRequisitionTable_${this.userId}`, this.selectedTableId);
    }

    this.selectedTable = this.tables.find(t => t.id === this.selectedTableId) || null;
    console.log('Selected table:', this.selectedTable);

    if (this.userRole !== 'production' && this.userRole !== 'procurement') {
      await this.loadRequisitionsDirectly();
    }
  }

  async selectTable(table: Table) {
    if (this.userRole === 'production') {
      this.selectedTableId = table.id;
      this.selectedTable = table;
      this.showTableDropdown = false;

      if (this.selectedProductionView === 'submissions') {
        this.filteredRequisitions = this.productionSubmissions.filter(r => r.table_id === table.id);
      } else {
        this.filteredRequisitions = this.productionReviewed.filter(r => r.table_id === table.id);
      }

      console.log(`Filtered to ${this.filteredRequisitions.length} items for table:`, table.name);
      this.currentPage = 1;
      this.updatePagination();

      this.showToast(`Showing items from table: ${table.name}`, 'info');

    } else if (this.userRole === 'procurement') {
      this.selectedTableId = table.id;
      this.selectedTable = table;
      this.showTableDropdown = false;

      this.filteredRequisitions = this.procurementReviewed.filter(r => r.table_id === table.id);
      console.log(`Filtered to ${this.filteredRequisitions.length} items for table:`, table.name);
      this.currentPage = 1;
      this.updatePagination();

    } else {
      if (table.user_id !== this.userId) {
        this.showToast('You can only access your own tables', 'error');
        return;
      }

      if (table.type !== 'requisition') {
        this.showToast('Invalid table type', 'error');
        return;
      }

      this.selectedTableId = table.id;
      this.selectedTable = table;
      this.showTableDropdown = false;
      this.showAllPending = false;
      this.searchQuery = '';
      this.filterStatus = '';

      localStorage.setItem(`lastSelectedRequisitionTable_${this.userId}`, this.selectedTableId);
      await this.loadRequisitionsDirectly();
    }
  }

  showAllTables() {
    this.selectedTableId = '';
    this.selectedTable = null;

    if (this.userRole === 'production') {
      if (this.selectedProductionView === 'submissions') {
        this.filteredRequisitions = [...this.productionSubmissions];
        console.log('Showing all submissions:', this.filteredRequisitions.length);
      } else {
        this.filteredRequisitions = [...this.productionReviewed];
        console.log('Showing all reviewed:', this.filteredRequisitions.length);
      }
    } else if (this.userRole === 'procurement') {
      this.filteredRequisitions = [...this.procurementReviewed];
      console.log('Showing all procurement items:', this.filteredRequisitions.length);
    }

    this.currentPage = 1;
    this.updatePagination();
    this.showToast('Showing all tables', 'info');
  }

  filterByTable(tableId: string) {
    const table = this.tables.find(t => t.id === tableId);
    if (table) {
      this.selectTable(table);
    } else {
      this.selectedTableId = tableId;
      this.selectedTable = null;

      if (this.userRole === 'production') {
        if (this.selectedProductionView === 'submissions') {
          this.filteredRequisitions = this.productionSubmissions.filter(r => r.table_id === tableId);
        } else {
          this.filteredRequisitions = this.productionReviewed.filter(r => r.table_id === tableId);
        }
      } else if (this.userRole === 'procurement') {
        this.filteredRequisitions = this.procurementReviewed.filter(r => r.table_id === tableId);
      }

      this.currentPage = 1;
      this.updatePagination();

      this.loadTableDetails(tableId);
    }
  }

  private async loadTableDetails(tableId: string) {
    try {
      const tableData = await this.db.getTableById(tableId);
      if (tableData) {
        const tableDoc = await this.run(() =>
          getDoc(doc(this.firestore, 'tables', tableId))
        );

        if (tableDoc.exists()) {
          const data = tableDoc.data();
          this.selectedTable = {
            id: tableDoc.id,
            name: data['name'] || 'Unknown',
            user_id: data['user_id'] || '',
            type: (data['type'] as 'inventory' | 'requisition' | 'production') || 'requisition',
            item_count: data['item_count'] || 0,
            submitted: data['submitted'] || false,
            submitted_at: data['submitted_at']
          };
        }
      }
    } catch (err) {
      console.error('Failed to load table details:', err);
    }
  }

  openTableModal() {
    this.showTableModal = true;
    this.newTableName = '';
    this.editingTable = null;
    this.editTableName = '';
    this.showTableDropdown = false;
  }

  closeTableModal() {
    this.showTableModal = false;
    this.editingTable = null;
  }

  async createTable() {
    if (!this.newTableName.trim()) {
      this.showToast('Please enter a table name', 'error');
      return;
    }

    if (!this.userId) {
      this.showToast('You must be logged in', 'error');
      return;
    }

    this.isSubmitting = true;

    try {
      const result = await this.db.createUserTable({
        name: this.newTableName.trim(),
        user_id: this.userId
      }, 'requisition');

      if (result.success && result.tableId) {
        const newTable: Table = {
          id: result.tableId,
          name: this.newTableName.trim(),
          user_id: this.userId,
          type: 'requisition',
          item_count: 0,
          submitted: false,
          created_at: new Date().toISOString()
        };

        this.tables.push(newTable);
        this.selectedTableId = result.tableId;
        this.selectedTable = newTable;

        localStorage.setItem(`lastSelectedRequisitionTable_${this.userId}`, this.selectedTableId);

        this.newTableName = '';
        this.closeTableModal();
        this.showToast('Table created successfully', 'success');

        await this.loadRequisitionsDirectly();
      } else {
        this.showToast('Failed to create table', 'error');
      }
    } catch (err) {
      console.error('Create table error:', err);
      this.showToast('Failed to create table: ' + (err as Error).message, 'error');
    } finally {
      this.isSubmitting = false;
    }
  }

  editTable(table: Table) {
    if (table.user_id !== this.userId) {
      this.showToast('You can only edit your own tables', 'error');
      return;
    }
    if (table.type !== 'requisition') {
      this.showToast('Invalid table type', 'error');
      return;
    }
    this.editingTable = table;
    this.editTableName = table.name;
    this.openTableModal();
  }

  async updateTableName() {
    if (!this.editingTable || !this.editTableName.trim()) return;

    try {
      const success = await this.db.updateTableName(
        this.editingTable.id,
        this.editTableName.trim(),
        this.userId
      );

      if (success) {
        const index = this.tables.findIndex(t => t.id === this.editingTable!.id);
        if (index !== -1) {
          this.tables[index].name = this.editTableName.trim();
        }

        if (this.selectedTable?.id === this.editingTable.id) {
          this.selectedTable.name = this.editTableName.trim();
        }

        this.closeTableModal();
        this.showToast('Table renamed successfully', 'success');
      } else {
        this.showToast('Failed to rename table', 'error');
      }
    } catch (err) {
      console.error('Rename table error:', err);
      this.showToast('Failed to rename table', 'error');
    }
  }

  async deleteTable(table: Table) {
    if (this.tables.length <= 1) {
      this.showToast('Cannot delete the last table', 'error');
      return;
    }

    if (table.user_id !== this.userId) {
      this.showToast('You can only delete your own tables', 'error');
      return;
    }

    if (table.type !== 'requisition') {
      this.showToast('Invalid table type', 'error');
      return;
    }

    if (!confirm(`Delete table "${table.name}" and all its requisitions? This cannot be undone.`)) {
      return;
    }

    try {
      const success = await this.db.deleteTable(table.id, this.userId);

      if (success) {
        this.tables = this.tables.filter(t => t.id !== table.id);

        if (this.selectedTableId === table.id) {
          this.selectedTableId = this.tables[0]?.id || '';
          await this.onTableChange();
        }

        this.showToast('Table deleted successfully', 'success');

        if (this.showTableModal) {
          this.closeTableModal();
        }
      } else {
        this.showToast('Failed to delete table', 'error');
      }
    } catch (err) {
      console.error('Delete table error:', err);
      this.showToast('Failed to delete table', 'error');
    }
  }

  openModal() {
    if (!this.selectedTableId && this.viewMode === 'my_tables') {
      this.showToast('Please select a table first', 'error');
      this.openTableModal();
      return;
    }

    this.showModal = true;
    this.submitted = false;
    this.editingRequisition = null;
    this.resetForm();
  }

  openEditModal(req: Requisition) {
    console.log('Opening edit modal for requisition:', req);

    if (!this.selectedTableId && this.viewMode === 'my_tables') {
      this.showToast('Please select a table first', 'error');
      return;
    }

    this.editingRequisition = req;
    this.showModal = true;
    this.submitted = false;

    this.resetForm();

    this.formData = {
      type: req.type || '',
      category: req.category || '',
      skuName: req.skuName || '',
      quantity: req.quantity || null,
      unit: req.unit || '',
      dateNeeded: req.dateNeeded || '',
      supplier: req.supplier || '',
      customSupplier: '',
      brand: req.brand || '',
      customBrand: '',
      remarks: req.remarks || ''
    };

    const predefinedSuppliers = ['Supplier A', 'Supplier B', 'Supplier C'];
    if (this.formData.supplier && !predefinedSuppliers.includes(this.formData.supplier)) {
      this.formData.customSupplier = this.formData.supplier;
      this.formData.supplier = '__other__';
    }

    const predefinedBrands = ['Brand X', 'Brand Y', 'Brand Z'];
    if (this.formData.brand && !predefinedBrands.includes(this.formData.brand)) {
      this.formData.customBrand = this.formData.brand;
      this.formData.brand = '__other__';
    }

    this.selectedSkuCode = req.skuCode || '';

    if (this.formData.category) {
      this.onCategoryChange();
    }
  }

  async onSubmit() {
    if (!this.selectedTableId && this.viewMode === 'my_tables') {
      this.showToast('Please select a table first', 'error');
      return;
    }

    if (!this.userId) {
      this.showToast('You must be logged in', 'error');
      return;
    }

    this.submitted = true;

    if (!this.validateForm()) {
      this.showToast('Please complete all required fields', 'error');
      return;
    }

    this.isSubmitting = true;

    try {
      const skuName = this.formData.skuName;
      const selectedItem = this.availableSkus.find(item => item.sku_name === skuName);
      const skuCode = selectedItem ? selectedItem.sku_code : this.selectedSkuCode;

      const finalSupplier = this.formData.supplier === '__other__'
        ? this.formData.customSupplier?.trim()
        : this.formData.supplier;

      const finalBrand = this.formData.brand === '__other__'
        ? this.formData.customBrand?.trim()
        : this.formData.brand || '';

      let reqNumber = '';
      if (this.editingRequisition) {
        reqNumber = this.editingRequisition.reqNumber;
      } else {
        const year = new Date().getFullYear();
        const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
        reqNumber = `MR-${year}-${random}`;
      }

      const requisitionData: any = {
        reqNumber,
        type: this.formData.type,
        dateNeeded: this.formData.dateNeeded || 'ASAP',
        skuCode,
        skuName,
        quantity: Number(this.formData.quantity),
        unit: this.formData.unit,
        supplier: finalSupplier,
        brand: finalBrand,
        status: this.editingRequisition ? this.editingRequisition.status : 'Pending',
        category: this.formData.category,
        remarks: this.formData.remarks?.trim() || '',
        user_id: this.userId,
        table_id: this.selectedTableId || this.editingRequisition?.table_id || '',
        updated_at: new Date().toISOString()
      };

      if (this.editingRequisition && this.editingRequisition.created_at) {
        requisitionData.created_at = this.editingRequisition.created_at;
      }

      console.log('Submitting requisition data:', requisitionData);

      let result;

      if (this.editingRequisition) {
        result = await this.db.updateRequisition(
          this.editingRequisition.id,
          requisitionData,
          this.userId,
          this.selectedTableId || this.editingRequisition.table_id || ''
        );

        if (result) {
          this.showToast('Requisition updated successfully', 'success');
        }
      } else {
        result = await this.db.createRequisition(requisitionData, []);

        if (result.success) {
          console.log('Requisition created with ID:', result.id);
          this.showToast('Requisition created successfully', 'success');
        }
      }

      if (result && (result === true || result.success)) {
        await this.loadRequisitionsDirectly();
        await this.updateTableItemCount();
        this.closeModal();
      } else {
        this.showToast('Failed to save requisition', 'error');
      }
    } catch (err) {
      console.error('Submit error:', err);
      this.showToast('Failed to save requisition: ' + (err as Error).message, 'error');
    } finally {
      this.isSubmitting = false;
    }
  }

  async deleteRequisition(req: Requisition) {
    if (!this.selectedTableId || !this.userId) return;

    if (this.userRole !== 'admin' && req.user_id !== this.userId) {
      this.showToast('You can only delete your own requisitions', 'error');
      return;
    }

    if (req.status === 'Approved' || req.status === 'Delivered' || req.status === 'Production_Confirmed') {
      this.showToast('Approved or confirmed requisitions cannot be deleted', 'error');
      return;
    }

    if (!confirm(`Delete requisition ${req.reqNumber || 'Unknown'}?`)) return;

    try {
      const success = await this.db.deleteRequisition(req.id, this.userId, this.selectedTableId);
      if (success) {
        this.requisitions = this.requisitions.filter(r => r.id !== req.id);
        this.applyFilter();
        await this.updateTableItemCount();
        this.showToast('Requisition deleted', 'success');
      } else {
        this.showToast('Could not delete requisition', 'error');
      }
    } catch (err) {
      console.error('Delete error:', err);
      this.showToast('Delete failed', 'error');
    }
  }

  async submitTable(table: Table) {
    if (this.userRole !== 'user' && this.userRole !== 'store' && this.userRole !== 'admin') {
      this.showToast('Only store/user can submit tables', 'error');
      return;
    }

    if (!confirm(`Submit table "${table.name}" and all its requisitions for approval?`)) return;

    try {
      const snapshot = await this.run(() => {
        const requisitionsRef = collection(this.firestore, 'requisitions');
        const q = query(
          requisitionsRef,
          where('table_id', '==', table.id),
          where('user_id', '==', this.userId)
        );
        return getDocs(q);
      });

      await this.run(async () => {
        const batch = writeBatch(this.firestore);

        snapshot.forEach(d => {
          batch.update(d.ref, {
            status: 'Submitted',
            submitted_at: new Date().toISOString()
          });
        });

        const tableRef = doc(this.firestore, 'tables', table.id);
        batch.update(tableRef, {
          submitted: true,
          submitted_at: new Date().toISOString()
        });

        await batch.commit();
      });

      table.submitted = true;
      table.submitted_at = new Date().toISOString();

      await this.notificationService.sendTableSubmittedNotification(
        table.id,
        table.name,
        this.userId
      );

      this.showToast(`Table "${table.name}" submitted successfully and production has been notified`, 'success');
      await this.loadRequisitionsDirectly();

    } catch (err) {
      console.error('Submit table error:', err);
      this.showToast('Failed to submit table', 'error');
    }
  }

  openProductionActionModal(req: Requisition, action: 'confirm' | 'remove') {
    this.selectedRequisition = req;
    this.productionActionType = action;
    this.productionActionNotes = '';
    this.showProductionActionModal = true;
  }

  async confirmProductionAction() {
    if (!this.selectedRequisition) return;

    try {
      const updateData: any = {
        production_action: this.productionActionType,
        production_action_at: new Date().toISOString(),
        production_action_by: this.userId
      };

      if (this.productionActionNotes) {
        updateData.production_action_notes = this.productionActionNotes;
      }

      if (this.productionActionType === 'confirm') {
        updateData.status = 'Production_Confirmed';
      } else {
        updateData.status = 'Removed';
      }

      const success = await this.db.updateRequisitionStatus(
        this.selectedRequisition.id,
        updateData.status,
        this.userId,
        this.selectedRequisition.table_id || '',
        updateData
      );

      if (success) {
        await this.loadProductionSubmissions();
        await this.loadProductionReviewed();

        if (this.selectedTable) {
          if (this.selectedProductionView === 'submissions') {
            this.filteredRequisitions = this.productionSubmissions.filter(r => r.table_id === this.selectedTable!.id);
          } else {
            this.filteredRequisitions = this.productionReviewed.filter(r => r.table_id === this.selectedTable!.id);
          }
        } else {
          if (this.selectedProductionView === 'submissions') {
            this.filteredRequisitions = [...this.productionSubmissions];
          } else {
            this.filteredRequisitions = [...this.productionReviewed];
          }
        }

        this.closeProductionActionModal();
        this.showToast(
          `Requisition ${this.productionActionType === 'confirm' ? 'confirmed' : 'removed'} successfully`,
          'success'
        );
      } else {
        this.showToast('Failed to update requisition', 'error');
      }
    } catch (err) {
      console.error('Production action error:', err);
      this.showToast('Failed to update requisition', 'error');
    }
  }

  closeProductionActionModal() {
    this.showProductionActionModal = false;
    this.selectedRequisition = null;
    this.productionActionNotes = '';
  }

  async markDelivered(req: Requisition) {
    if (this.userRole !== 'procurement' && this.userRole !== 'admin') {
      this.showToast('Only procurement can mark as delivered', 'error');
      return;
    }
    if (!confirm(`Mark requisition ${req.reqNumber || req.id} as fully delivered?`)) return;

    try {
      const success = await this.db.updateRequisitionStatus(
        req.id,
        'Delivered',
        this.userId,
        req.table_id || '',
        {}
      );
      if (success) {
        await this.loadProcurementReviewed();
        if (this.selectedTable) {
          this.filteredRequisitions = this.procurementReviewed.filter(r => r.table_id === this.selectedTable!.id);
        } else {
          this.filteredRequisitions = [...this.procurementReviewed];
        }
        this.showToast('Requisition marked as delivered', 'success');
      } else {
        this.showToast('Failed to update', 'error');
      }
    } catch (err) {
      console.error('Deliver error:', err);
      this.showToast('Failed to update', 'error');
    }
  }

  openMissingNotesModal(req: Requisition) {
    this.selectedRequisition = req;
    this.missingMaterialsNotes = '';
    this.showMissingNotesModal = true;
  }

  async saveMissingNotes() {
    if (!this.selectedRequisition || !this.missingMaterialsNotes.trim()) {
      this.showToast('Please add notes for missing materials', 'error');
      return;
    }
    try {
      const success = await this.db.updateRequisitionStatus(
        this.selectedRequisition.id,
        'Partially_Delivered',
        this.userId,
        this.selectedRequisition.table_id || '',
        { missing_materials_notes: this.missingMaterialsNotes }
      );
      if (success) {
        await this.loadProcurementReviewed();
        if (this.selectedTable) {
          this.filteredRequisitions = this.procurementReviewed.filter(r => r.table_id === this.selectedTable!.id);
        } else {
          this.filteredRequisitions = [...this.procurementReviewed];
        }
        this.closeMissingNotesModal();
        this.showToast('Notes saved - requisition marked as partially delivered', 'success');
      } else {
        this.showToast('Failed to save notes', 'error');
      }
    } catch (err) {
      console.error('Save notes error:', err);
      this.showToast('Failed to save notes', 'error');
    }
  }

  closeMissingNotesModal() {
    this.showMissingNotesModal = false;
    this.selectedRequisition = null;
    this.missingMaterialsNotes = '';
  }

  openScheduleModal(req: Requisition) {
    if (this.userRole !== 'procurement' && this.userRole !== 'admin') {
      this.showToast('Only procurement can schedule requisitions', 'error');
      return;
    }

    if (req.status !== 'Production_Confirmed') {
      this.showToast('Only confirmed requisitions can be scheduled', 'error');
      return;
    }

    this.selectedRequisition = req;

    if (req.scheduled_date) {
      try {
        const date = new Date(req.scheduled_date);
        this.scheduledDate = date.toISOString().split('T')[0];
        this.scheduledTime = date.toTimeString().split(' ')[0].substring(0, 5);
      } catch (e) {
        this.scheduledDate = '';
        this.scheduledTime = '';
      }
    } else {
      this.scheduledDate = '';
      this.scheduledTime = '';
    }

    this.showScheduleModal = true;
  }

  async scheduleRequisition() {
    if (!this.selectedRequisition || !this.scheduledDate) {
      this.showToast('Please select a date', 'error');
      return;
    }

    try {
      const scheduledDateTime = this.scheduledTime
        ? `${this.scheduledDate}T${this.scheduledTime}`
        : `${this.scheduledDate}T00:00:00`;

      console.log('Scheduling requisition with date:', scheduledDateTime);

      const success = await this.db.updateRequisitionStatus(
        this.selectedRequisition.id,
        'Scheduled',
        this.userId,
        this.selectedRequisition.table_id || this.selectedTableId || '',
        {
          scheduled_date: scheduledDateTime,
          scheduled_by: this.userId
        }
      );

      if (success) {
        await this.loadProcurementReviewed();
        if (this.selectedTable) {
          this.filteredRequisitions = this.procurementReviewed.filter(r => r.table_id === this.selectedTable!.id);
        } else {
          this.filteredRequisitions = [...this.procurementReviewed];
        }
        this.closeScheduleModal();
        this.showToast('Requisition scheduled successfully', 'success');
      } else {
        this.showToast('Failed to schedule requisition', 'error');
      }
    } catch (err) {
      console.error('Schedule error:', err);
      this.showToast('Failed to schedule requisition', 'error');
    }
  }

  closeScheduleModal() {
    this.showScheduleModal = false;
    this.selectedRequisition = null;
    this.scheduledDate = '';
    this.scheduledTime = '';
  }

  openApproveModal(req: Requisition) {
    if (this.userRole !== 'admin') {
      this.showToast('Only admins can approve requisitions', 'error');
      return;
    }

    if (req.status !== 'Scheduled') {
      this.showToast('Only scheduled requisitions can be approved', 'error');
      return;
    }

    this.selectedRequisition = req;
    this.approvalNotes = '';
    this.showApproveModal = true;
  }

  async approveRequisition() {
    if (!this.selectedRequisition) return;

    try {
      const success = await this.db.updateRequisitionStatus(
        this.selectedRequisition.id,
        'Approved',
        this.userId,
        this.selectedTableId || '',
        {
          approved_by: this.userId,
          approval_notes: this.approvalNotes || null,
          approved_at: new Date().toISOString()
        }
      );

      if (success) {
        await this.loadRequisitionsDirectly();
        this.closeApproveModal();
        this.showToast('Requisition approved successfully', 'success');
      } else {
        this.showToast('Failed to approve requisition', 'error');
      }
    } catch (err) {
      console.error('Approve error:', err);
      this.showToast('Failed to approve requisition', 'error');
    }
  }

  closeApproveModal() {
    this.showApproveModal = false;
    this.selectedRequisition = null;
    this.approvalNotes = '';
  }

  openRejectModal(req: Requisition) {
    const canReject = this.userRole === 'production' || this.userRole === 'admin' || this.userRole === 'procurement';
    if (!canReject) {
      this.showToast('You do not have permission to reject requisitions', 'error');
      return;
    }

    this.selectedRequisition = req;
    this.rejectionReason = '';
    this.showRejectModal = true;
  }

  async confirmReject() {
    if (!this.selectedRequisition || !this.rejectionReason.trim()) {
      this.showToast('Please provide a rejection reason', 'error');
      return;
    }

    try {
      const success = await this.db.updateRequisitionStatus(
        this.selectedRequisition.id,
        'Rejected',
        this.userId,
        this.selectedRequisition.table_id || '',
        {
          rejected_by: this.userId,
          rejection_reason: this.rejectionReason,
          rejected_at: new Date().toISOString()
        }
      );

      if (success) {
        if (this.userRole === 'production') {
          await this.loadProductionSubmissions();
          if (this.selectedTable) {
            this.filteredRequisitions = this.productionSubmissions.filter(r => r.table_id === this.selectedTable!.id);
          } else {
            this.filteredRequisitions = [...this.productionSubmissions];
          }
        } else {
          await this.loadRequisitionsDirectly();
        }
        this.closeRejectModal();
        this.showToast('Requisition rejected', 'success');
      } else {
        this.showToast('Failed to reject requisition', 'error');
      }
    } catch (err) {
      console.error('Reject error:', err);
      this.showToast('Failed to reject requisition', 'error');
    }
  }

  closeRejectModal() {
    this.showRejectModal = false;
    this.selectedRequisition = null;
    this.rejectionReason = '';
  }

  async toggleRow(req: Requisition) {
    if (!req.id) return;

    this.expandedRows[req.id] = !this.expandedRows[req.id];

    if (this.expandedRows[req.id] && !req.materials) {
      this.loadingMaterials[req.id] = true;

      const rawSkuCode    = req.skuCode || req['sku_code'] || req['SKU CODE'] || '';
      const finalSkuCode  = (rawSkuCode || '').toString().trim();

      console.log('╔═══════════════════════════════════════════════');
      console.log('║ REQ ID          :', req.id);
      console.log('║ RAW skuCode     :', req.skuCode);
      console.log('║ RAW sku_code    :', req['sku_code']);
      console.log('║ RAW SKU CODE    :', req['SKU CODE']);
      console.log('║ Final cleaned   : "' + finalSkuCode + '"');
      console.log('╚═══════════════════════════════════════════════');

      try {
        const materials = await this.db.getMaterialsForSku(finalSkuCode);

        console.log(`[MATERIALS] Loaded ${materials.length} materials for "${finalSkuCode}"`);

        req.materials = materials.length > 0 ? materials : [];
      } catch (err) {
        console.error('[MATERIALS] Failed to load for SKU:', finalSkuCode, err);
        req.materials = [];
        this.showToast('Could not load raw materials list', 'error');
      } finally {
        this.loadingMaterials[req.id] = false;
      }
    }
  }

  calculateMaterialTotal(quantity: number, qtyPerBatch: number | null): number {
    const qty = quantity || 0;
    const batchQty = qtyPerBatch || 0;
    return batchQty * qty;
  }

  async onCategoryChange() {
    if (!this.formData.category) {
      this.availableSkus = [];
      this.formData.skuName = '';
      this.selectedSkuCode = '';
      return;
    }

    try {
      this.availableSkus = await this.db.getSkusByCategory(this.formData.category);

      if (this.editingRequisition && this.formData.skuName) {
        const skuExists = this.availableSkus.some(s => s.sku_name === this.formData.skuName);
        if (!skuExists) {
          this.formData.skuName = '';
          this.selectedSkuCode = '';
        } else {
          const selectedItem = this.availableSkus.find(s => s.sku_name === this.formData.skuName);
          this.selectedSkuCode = selectedItem ? selectedItem.sku_code : '';
        }
      } else {
        this.formData.skuName = '';
        this.selectedSkuCode = '';
      }
    } catch (err) {
      console.error('Failed to load SKUs:', err);
      this.showToast('Could not load SKUs', 'error');
    }
  }

  onSkuNameSelect() {
    if (!this.formData.skuName) {
      this.selectedSkuCode = '';
      return;
    }

    const selectedItem = this.availableSkus.find(item => item.sku_name === this.formData.skuName);
    this.selectedSkuCode = selectedItem ? selectedItem.sku_code : '';
    console.log('Selected SKU code:', this.selectedSkuCode);
  }

  async onFileSelected(event: any) {
    const file = event.target.files?.[0];
    if (!file) return;

    this.selectedFileName = file.name;
    this.importStatus = 'loading';
    this.importMessage = 'Uploading...';

    try {
      const result = await this.db.uploadMasterData(file);
      if (result.success) {
        this.importStatus = 'success';
        this.importMessage = `Imported ${result.count} rows`;
        await this.loadCategories();
        this.showToast('Master data imported successfully', 'success');
      } else {
        this.importStatus = 'error';
        this.importMessage = result.error || 'Upload failed';
        this.showToast(result.error || 'Upload failed', 'error');
      }
    } catch (err) {
      this.importStatus = 'error';
      this.importMessage = 'Upload error';
      this.showToast('Upload error: ' + (err as Error).message, 'error');
    }
  }

  switchProductionView(view: 'submissions' | 'reviewed') {
    this.selectedProductionView = view;

    this.selectedTableId = '';
    this.selectedTable = null;

    if (view === 'submissions') {
      this.filteredRequisitions = [...this.productionSubmissions];
      console.log('Switched to submissions view, items:', this.filteredRequisitions.length);
    } else {
      this.filteredRequisitions = [...this.productionReviewed];
      console.log('Switched to reviewed view, items:', this.filteredRequisitions.length);
    }

    this.currentPage = 1;
    this.updatePagination();
  }

  async updateTableItemCount() {
    if (!this.selectedTableId || !this.userId) return;

    try {
      await this.db.updateTableItemCount(
        this.selectedTableId,
        this.requisitions.length,
        this.userId
      );

      if (this.selectedTable) {
        this.selectedTable.item_count = this.requisitions.length;
      }

      const tableIndex = this.tables.findIndex(t => t.id === this.selectedTableId);
      if (tableIndex !== -1) {
        this.tables[tableIndex].item_count = this.requisitions.length;
      }
    } catch (err) {
      console.error('Failed to update table item count:', err);
    }
  }

  validateForm(): boolean {
    if (
      !this.formData.type ||
      !this.formData.category ||
      !this.formData.skuName ||
      !this.formData.quantity ||
      this.formData.quantity <= 0 ||
      !this.formData.unit ||
      !this.formData.supplier
    ) {
      return false;
    }

    if (this.formData.supplier === '__other__' && !this.formData.customSupplier?.trim()) {
      return false;
    }

    return true;
  }

  closeModal() {
    this.showModal = false;
    this.editingRequisition = null;
  }

  resetForm() {
    this.formData = {
      type: '',
      category: '',
      skuName: '',
      quantity: null,
      unit: '',
      dateNeeded: '',
      supplier: '',
      customSupplier: '',
      brand: '',
      customBrand: '',
      remarks: ''
    };
    this.selectedSkuCode = '';
  }

  onSupplierChange() {
    if (this.formData.supplier !== '__other__') {
      this.formData.customSupplier = '';
    }
  }

  onBrandChange() {
    if (this.formData.brand !== '__other__') {
      this.formData.customBrand = '';
    }
  }

  toggleTableDropdown() {
    this.showTableDropdown = !this.showTableDropdown;
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent) {
    const target = event.target as HTMLElement;
    if (!target.closest('.dropdown')) {
      this.showTableDropdown = false;
    }
  }

  canCreateRequisition(): boolean {
    return (
      (this.userRole === 'user' || this.userRole === 'store' || this.userRole === 'admin') &&
      this.viewMode === 'my_tables' &&
      (!this.selectedTable || !this.selectedTable.submitted)
    );
  }

  canSubmitTable(): boolean {
    return (
      (this.userRole === 'user' || this.userRole === 'store' || this.userRole === 'admin') &&
      this.viewMode === 'my_tables' &&
      this.selectedTable !== null &&
      !this.selectedTable.submitted &&
      this.requisitions.length > 0
    );
  }

  canSubmitRequisition(req: Requisition): boolean {
    return (
      (this.userRole === 'user' || this.userRole === 'store' || this.userRole === 'admin') &&
      req.status === 'Pending' &&
      req.user_id === this.userId &&
      this.selectedTable !== null &&
      !this.selectedTable.submitted
    );
  }

  canProductionAction(req: Requisition): boolean {
    return this.userRole === 'production' && req.status === 'Submitted';
  }

  canMarkDelivered(req: Requisition): boolean {
    return (
      (this.userRole === 'procurement' || this.userRole === 'admin') &&
      req.status === 'Production_Confirmed'
    );
  }

  canAddMissingNotes(req: Requisition): boolean {
    return (
      (this.userRole === 'procurement' || this.userRole === 'admin') &&
      req.status === 'Production_Confirmed'
    );
  }

  canScheduleRequisition(req: Requisition): boolean {
    return (
      (this.userRole === 'procurement' || this.userRole === 'admin') &&
      req.status === 'Production_Confirmed'
    );
  }

  canApproveRequisition(req: Requisition): boolean {
    return this.userRole === 'admin' && req.status === 'Scheduled';
  }

  canRejectRequisition(req: Requisition): boolean {
    return (
      (this.userRole === 'production' || this.userRole === 'admin') &&
      (req.status === 'Submitted' || req.status === 'Production_Confirmed')
    ) || (
      this.userRole === 'procurement' && req.status === 'Production_Confirmed'
    );
  }

  canEditRequisition(req: Requisition): boolean {
    return (
      this.viewMode === 'my_tables' &&
      (this.userRole === 'admin' || req.user_id === this.userId) &&
      req.status !== 'Submitted' &&
      req.status !== 'Approved' &&
      req.status !== 'Rejected' &&
      req.status !== 'Delivered' &&
      req.status !== 'Partially_Delivered' &&
      this.selectedTable !== null &&
      !this.selectedTable.submitted
    );
  }

  canDeleteRequisition(req: Requisition): boolean {
    return (
      this.viewMode === 'my_tables' &&
      (
        this.userRole === 'admin' ||
        ((this.userRole === 'user' || this.userRole === 'store') && req.user_id === this.userId)
      ) &&
      req.status !== 'Submitted' &&
      req.status !== 'Approved' &&
      req.status !== 'Delivered' &&
      this.selectedTable !== null &&
      !this.selectedTable.submitted
    );
  }

  getStatusBadgeClass(status: string): string {
    switch (status) {
      case 'Pending': return 'status-pending';
      case 'Submitted': return 'status-submitted';
      case 'Scheduled': return 'status-scheduled';
      case 'Approved': return 'status-approved';
      case 'Rejected': return 'status-rejected';
      case 'Production_Confirmed': return 'status-scheduled';
      case 'Removed': return 'status-rejected';
      case 'Delivered': return 'status-approved';
      case 'Partially_Delivered': return 'status-pending';
      default: return 'status-pending';
    }
  }

  applyFilter() {
    let filtered = [...this.requisitions];

    if (this.searchQuery.trim()) {
      const q = this.searchQuery.toLowerCase();
      filtered = filtered.filter(r =>
        (r.reqNumber || '').toLowerCase().includes(q) ||
        (r.skuCode || '').toLowerCase().includes(q) ||
        (r.skuName || '').toLowerCase().includes(q) ||
        (r.supplier || '').toLowerCase().includes(q)
      );
    }

    if (this.filterStatus) {
      filtered = filtered.filter(r => r.status === this.filterStatus);
    }

    this.filteredRequisitions = filtered;
    this.currentPage = 1;
    this.updatePagination();
  }

  updatePagination() {
    this.totalPages = Math.max(1, Math.ceil(this.filteredRequisitions.length / this.pageSize));
    const start = (this.currentPage - 1) * this.pageSize;
    this.paginatedRequisitions = this.filteredRequisitions.slice(start, start + this.pageSize);
  }

  goToPage(page: number) {
    if (page >= 1 && page <= this.totalPages) {
      this.currentPage = page;
      this.updatePagination();
    }
  }

  onPageSizeChange() {
    this.currentPage = 1;
    this.updatePagination();
  }

  showToast(message: string, type: 'success' | 'error' | 'info' = 'info') {
    this.snackbarMessage = message;
    this.snackbarType = type;
    this.showSnackbar = true;

    if (this.snackbarTimeout) {
      clearTimeout(this.snackbarTimeout);
    }

    this.snackbarTimeout = setTimeout(() => {
      this.hideSnackbar();
    }, 3000);
  }

  hideSnackbar() {
    this.showSnackbar = false;
    if (this.snackbarTimeout) {
      clearTimeout(this.snackbarTimeout);
      this.snackbarTimeout = null;
    }
  }
}