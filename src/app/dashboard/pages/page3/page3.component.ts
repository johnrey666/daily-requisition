import { Component, OnInit, HostListener, Injector } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { runInInjectionContext } from '@angular/core';
import { DatabaseService } from '../../../core/services/database.service';
import { AuthService } from '../../../core/services/auth.service';
import { NotificationService } from '../../../core/services/notification.service';
import {
  Firestore, doc, collection, query, where, getDocs,
  orderBy, writeBatch, getDoc, updateDoc
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

  categories: string[] = [];
  availableSkus: SkuOption[] = [];

  tables: Table[] = [];
  selectedTableId: string = '';
  selectedTable: Table | null = null;
  showTableDropdown = false;

  requisitions: Requisition[] = [];
  filteredRequisitions: Requisition[] = [];
  paginatedRequisitions: Requisition[] = [];

  productionSubmissions: Requisition[] = [];
  productionReviewed: Requisition[] = [];

  procurementReviewed: Requisition[] = [];

  expandedRows: { [id: string]: boolean } = {};
  loadingMaterials: { [id: string]: boolean } = {};

  showModal = false;
  showTableModal = false;
  showScheduleModal = false;
  showApproveModal = false;
  showDeliveryModal = false;
  showMissingNotesModal = false;
  showProductionActionModal = false;
  viewMode: 'my_tables' | 'store_submissions' | 'for_delivery' | 'production_reviewed' | 'procurement_reviewed' = 'my_tables';
  selectedProductionView: 'submissions' | 'reviewed' = 'submissions';
  showAllPending = false;
  submitted = false;
  isLoading = false;
  isSubmitting = false;
  today = new Date().toISOString().split('T')[0];

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

  selectedRequisition: Requisition | null = null;
  scheduledDate: string = '';
  scheduledTime: string = '';

  approvalNotes: string = '';
  missingMaterialsNotes: string = '';

  productionActionType: 'confirmed' | 'removed' = 'confirmed';
  productionActionNotes: string = '';

  editingRequisition: Requisition | null = null;
  editingTable: Table | null = null;
  newTableName: string = '';
  editTableName: string = '';

  selectedSkuCode: string = '';

  searchQuery = '';
  filterStatus = '';
  currentPage = 1;
  pageSize = 10;
  totalPages = 1;

  showSnackbar = false;
  snackbarMessage = '';
  snackbarType: 'success' | 'error' | 'info' = 'info';
  snackbarTimeout: any;

  importStatus: 'idle' | 'loading' | 'success' | 'error' = 'idle';
  importMessage = '';
  selectedFileName = '';

  userRole: string = '';
  userId: string = '';

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
    const user = await this.auth.getCurrentUserPromise();

    if (user) {
      this.userId = user.uid;
      await this.loadUserRole();
      await this.loadCategories();
      this.setViewModeByRole();

      if (this.userRole === 'production') {
        await this.loadTablesDirectly();
        // For production, load submissions but don't filter yet
        await this.loadProductionSubmissions();
        this.filteredRequisitions = [...this.productionSubmissions];
      } else if (this.userRole === 'procurement') {
        await this.loadProcurementReviewed();
        this.filteredRequisitions = [...this.procurementReviewed];
      } else {
        // For user/store/admin roles
        await this.loadTablesDirectly();
        
        // Important: After loading tables, we need to make sure a table is selected
        if (this.tables.length > 0 && !this.selectedTable) {
          // Try to get last selected table from localStorage
          const lastTableId = localStorage.getItem(`lastSelectedRequisitionTable_${this.userId}`);
          if (lastTableId && this.tables.some(t => t.id === lastTableId)) {
            this.selectedTable = this.tables.find(t => t.id === lastTableId) || null;
          } else {
            // Default to first table
            this.selectedTable = this.tables[0];
          }
          
          if (this.selectedTable) {
            this.selectedTableId = this.selectedTable.id;
            await this.loadRequisitionsDirectly();
          }
        }
      }

      this.route.queryParams.subscribe(async params => {
        if (params['tableId']) {
          setTimeout(async () => {
            const tableToSelect = this.tables.find(t => t.id === params['tableId']);
            if (tableToSelect) {
              await this.selectTable(tableToSelect);
            }
          }, 1000);
        }
      });
    } else {
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
    } catch (err) {
      this.userRole = 'user';
    }
  }

  async loadCategories() {
    try {
      this.categories = await this.db.getUniqueCategories();
    } catch (err) {
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
    try {
      console.log('Loading tables for user:', this.userId, 'role:', this.userRole);
      this.isLoading = true;
      const tablesRef = collection(this.firestore, 'tables');

      let querySnapshot;

      if (this.userRole === 'production') {
        // For production, load all submitted requisition tables
        querySnapshot = await this.run(() => {
          const q = query(
            tablesRef,
            where('type', '==', 'requisition'),
            where('submitted', '==', true)
          );
          return getDocs(q);
        });
      } else if (this.userRole === 'procurement') {
        // For procurement, load all requisition tables (submitted or not)
        querySnapshot = await this.run(() => {
          const q = query(tablesRef, where('type', '==', 'requisition'));
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
        // Sort by submission date for production
        loadedTables.sort((a, b) => {
          if (a.submitted && b.submitted) {
            return (b.submitted_at || '').localeCompare(a.submitted_at || '');
          }
          return (b.created_at || '').localeCompare(a.created_at || '');
        });
      } else if (this.userRole === 'procurement') {
        // Sort by creation date for procurement
        loadedTables.sort((a, b) => {
          return (b.created_at || '').localeCompare(a.created_at || '');
        });
      }

      this.tables = loadedTables;

      if (this.userRole === 'production') {
        // For production, select first table by default if available
        if (this.tables.length > 0 && !this.selectedTable) {
          this.selectedTable = this.tables[0];
          this.selectedTableId = this.tables[0].id;
          // Filter submissions by selected table
          this.filteredRequisitions = this.productionSubmissions.filter(r => r.table_id === this.selectedTableId);
          this.updatePagination();
        }
      } else if (this.userRole === 'procurement') {
        this.selectedTableId = '';
        this.selectedTable = null;

        await this.loadProcurementReviewed();
        this.filteredRequisitions = [...this.procurementReviewed];
        this.updatePagination();
      } else if (this.tables.length > 0) {
        const lastTableId = localStorage.getItem(`lastSelectedRequisitionTable_${this.userId}`);

        if (lastTableId && this.tables.some(t => t.id === lastTableId)) {
          this.selectedTableId = lastTableId;
          this.selectedTable = this.tables.find(t => t.id === this.selectedTableId) || null;
        } else {
          // Select the first table by default
          this.selectedTableId = this.tables[0].id;
          this.selectedTable = this.tables[0];
        }

        if (this.selectedTable) {
          await this.loadRequisitionsDirectly();
        }
      }

    } catch (err) {
      console.error('Error loading tables:', err);
      this.showToast('Failed to load tables', 'error');
    } finally {
      this.isLoading = false;
    }
  }

  async loadRequisitionsDirectly() {
    if (!this.selectedTableId) return;

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

    } catch (err) {
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

    } catch (err) {
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

    if (this.userRole !== 'production' && this.userRole !== 'procurement') {
      localStorage.setItem(`lastSelectedRequisitionTable_${this.userId}`, this.selectedTableId);
    }

    this.selectedTable = this.tables.find(t => t.id === this.selectedTableId) || null;

    if (this.userRole !== 'production' && this.userRole !== 'procurement') {
      await this.loadRequisitionsDirectly();
    }
  }

  async selectTable(table: Table) {
    if (this.userRole === 'production') {
      this.selectedTableId = table.id;
      this.selectedTable = table;
      this.showTableDropdown = false;

      // Filter submissions by selected table
      this.filteredRequisitions = this.productionSubmissions.filter(r => r.table_id === table.id);
      this.currentPage = 1;
      this.updatePagination();

      this.showToast(`Showing submissions from table: ${table.name}`, 'info');

    } else if (this.userRole === 'procurement') {
      this.selectedTableId = table.id;
      this.selectedTable = table;
      this.showTableDropdown = false;

      this.filteredRequisitions = this.procurementReviewed.filter(r => r.table_id === table.id);
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
      this.filteredRequisitions = [...this.productionSubmissions];
    } else if (this.userRole === 'procurement') {
      this.filteredRequisitions = [...this.procurementReviewed];
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
      this.showToast('Failed to create table', 'error');
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
      this.showToast('Failed to save requisition', 'error');
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
      this.showToast('Failed to submit table', 'error');
    }
  }

  openProductionActionModal(req: Requisition, action: 'confirmed' | 'removed') {
    this.selectedRequisition = req;
    this.productionActionType = action;
    this.productionActionNotes = '';
    this.showProductionActionModal = true;
  }

  async markProductionAction(req: Requisition, action: 'confirmed') {
    try {
      const updateData: any = {
        production_action: action,
        production_action_at: new Date().toISOString(),
        production_action_by: this.userId
      };

      const success = await this.db.updateRequisitionStatus(
        req.id,
        req.status, // Keep current status
        this.userId,
        req.table_id || '',
        updateData
      );

      if (success) {
        // Update the local object
        req.production_action = action;
        req.production_action_at = updateData.production_action_at;
        req.production_action_by = updateData.production_action_by;

        this.showToast(`Requisition ${action === 'confirmed' ? 'confirmed' : 'marked for removal'}`, 'success');
      } else {
        this.showToast('Failed to update requisition', 'error');
      }
    } catch (err) {
      this.showToast('Failed to update requisition', 'error');
    }
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

      const success = await this.db.updateRequisitionStatus(
        this.selectedRequisition.id,
        this.selectedRequisition.status, // Keep current status
        this.userId,
        this.selectedRequisition.table_id || '',
        updateData
      );

      if (success) {
        // Update the local object
        this.selectedRequisition.production_action = this.productionActionType;
        this.selectedRequisition.production_action_at = updateData.production_action_at;
        this.selectedRequisition.production_action_by = updateData.production_action_by;
        if (this.productionActionNotes) {
          this.selectedRequisition.production_action_notes = this.productionActionNotes;
        }

        this.closeProductionActionModal();
        this.showToast(`Requisition marked for ${this.productionActionType === 'confirmed' ? 'confirmation' : 'removal'}`, 'success');
      } else {
        this.showToast('Failed to update requisition', 'error');
      }
    } catch (err) {
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
      this.showToast('Failed to approve requisition', 'error');
    }
  }

  closeApproveModal() {
    this.showApproveModal = false;
    this.selectedRequisition = null;
    this.approvalNotes = '';
  }

  // FIXED: Enhanced toggleRow method with comprehensive debugging
  async toggleRow(req: Requisition) {
    if (!req.id) return;

    this.expandedRows[req.id] = !this.expandedRows[req.id];

    if (this.expandedRows[req.id] && !req.materials) {
      this.loadingMaterials[req.id] = true;
      try {
        const materials = await this.db.getMaterialsForSku(req.skuCode);
        req.materials = materials || [];
      } catch (err) {
        console.error('Failed to load materials', err);
        req.materials = [];
        this.showToast('Failed to load materials', 'error');
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
      this.showToast('Upload error', 'error');
    }
  }

  switchProductionView(view: 'submissions' | 'reviewed') {
    this.selectedProductionView = view;

    this.selectedTableId = '';
    this.selectedTable = null;

    if (view === 'submissions') {
      this.filteredRequisitions = [...this.productionSubmissions];
    } else {
      this.filteredRequisitions = [...this.productionReviewed];
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

  canSubmitReviewedTable(): boolean {
    if (this.userRole !== 'production' || !this.selectedTable) return false;
    
    const tableSubmissions = this.productionSubmissions.filter(r => r.table_id === this.selectedTable!.id);
    if (tableSubmissions.length === 0) return false;
    
    // Check if all submissions in this table have been marked (confirmed or removed)
    return tableSubmissions.every(r => r.production_action === 'confirmed' || r.production_action === 'removed');
  }

  async submitReviewedTable() {
    if (!this.canSubmitReviewedTable() || !this.selectedTable) return;

    if (!confirm(`Submit reviewed table "${this.selectedTable.name}" to procurement?`)) return;

    try {
      // Get all submissions for this table
      const tableSubmissions = this.productionSubmissions.filter(r => r.table_id === this.selectedTable!.id);
      
      // Update each submission's status based on production_action
      const updatePromises = tableSubmissions.map(async (req) => {
        let newStatus = req.status;
        if (req.production_action === 'confirmed') {
          newStatus = 'Production_Confirmed';
        } else if (req.production_action === 'removed') {
          newStatus = 'Removed';
        }
        
        if (newStatus !== req.status) {
          return this.db.updateRequisitionStatus(
            req.id,
            newStatus,
            this.userId,
            req.table_id || '',
            {} // No additional data needed
          );
        }
        return Promise.resolve(true);
      });

      await Promise.all(updatePromises);

      // Update the table status to indicate it's been reviewed by production
      const tableRef = doc(this.firestore, 'tables', this.selectedTable.id);
      await this.run(() => 
        updateDoc(tableRef, {
          production_reviewed: true,
          production_reviewed_at: new Date().toISOString(),
          production_reviewed_by: this.userId,
          updated_at: new Date().toISOString()
        })
      );

      // Remove the reviewed items from productionSubmissions
      this.productionSubmissions = this.productionSubmissions.filter(r => r.table_id !== this.selectedTable!.id);
      this.filteredRequisitions = this.productionSubmissions.filter(r => !this.selectedTableId || r.table_id === this.selectedTableId);
      
      // Remove from tables list
      this.tables = this.tables.filter(t => t.id !== this.selectedTable!.id);
      
      // Reset selection
      const tableName = this.selectedTable.name;
      this.selectedTable = null;
      this.selectedTableId = '';
      
      this.updatePagination();
      this.showToast(`Table "${tableName}" submitted to procurement`, 'success');
      
    } catch (err) {
      this.showToast('Failed to submit table', 'error');
    }
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