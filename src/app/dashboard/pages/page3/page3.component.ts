import { Component, OnInit, HostListener, Injector, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClientModule } from '@angular/common/http';
import { runInInjectionContext } from '@angular/core';
import { DatabaseService } from '../../../core/services/database.service';
import { AuthService } from '../../../core/services/auth.service';
import { LoaderService } from '../../../core/services/loader.service';
import { NotificationService } from '../../../core/services/notification.service';
import { EmailNotificationService } from '../../../core/services/email-notification.service';
import {
  Firestore, doc, collection, query, where, getDocs,
  writeBatch, getDoc, updateDoc, orderBy
} from '@angular/fire/firestore';
import { Storage, ref, uploadBytes, getDownloadURL, deleteObject } from '@angular/fire/storage';
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
  po_file_url?: string;
  po_file_name?: string;
  po_file_size?: number;
  po_file_type?: string;
  production_reviewed?: boolean;
  production_reviewed_at?: string;
  production_reviewed_by?: string;
}

interface SkuOption {
  sku_code: string;
  sku_name: string;
}

@Component({
  selector: 'app-page3',
  standalone: true,
  imports: [CommonModule, FormsModule, HttpClientModule],
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
  tomorrow: string = '';

  // P.O File Upload Properties
  poFile: File | null = null;
  poFileName: string = '';
  isUploadingPo: boolean = false;

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
    private storage: Storage,
    private router: Router,
    private route: ActivatedRoute,
    private injector: Injector,
    private cdr: ChangeDetectorRef,
    private notificationService: NotificationService,
    private loader: LoaderService,
    private emailNotificationService: EmailNotificationService
  ) {}

  private run<T>(fn: () => Promise<T>): Promise<T> {
    return runInInjectionContext(this.injector, fn);
  }

  async ngOnInit() {
    const todayDate = new Date();
    const tomorrowDate = new Date(todayDate);
    tomorrowDate.setDate(todayDate.getDate() + 1);
    this.tomorrow = tomorrowDate.toISOString().split('T')[0];
    
    const user = await this.auth.getCurrentUserPromise();

    if (user) {
      this.userId = user.uid;
      await this.loadUserRole();
      await this.loadCategories();
      this.setViewModeByRole();

      if (this.userRole === 'production') {
        await this.loadTablesDirectly();
        await this.loadProductionSubmissions();
        this.filteredRequisitions = [...this.productionSubmissions];
      } else if (this.userRole === 'procurement') {
        await this.loadTablesDirectly();
      } else {
        await this.loadTablesDirectly();
        
        if (this.tables.length > 0 && !this.selectedTable) {
          const lastTableId = localStorage.getItem(`lastSelectedRequisitionTable_${this.userId}`);
          if (lastTableId && this.tables.some(t => t.id === lastTableId)) {
            this.selectedTable = this.tables.find(t => t.id === lastTableId) || null;
          } else {
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
      this.loader.show('Loading tables...');
      const tablesRef = collection(this.firestore, 'tables');

      let querySnapshot;

      if (this.userRole === 'production') {
        querySnapshot = await this.run(() => {
          const q = query(
            tablesRef,
            where('type', '==', 'requisition'),
            where('submitted', '==', true)
          );
          return getDocs(q);
        });
      } else if (this.userRole === 'procurement') {
        querySnapshot = await this.run(() => {
          const q = query(
            tablesRef,
            where('type', '==', 'requisition'),
            where('submitted', '==', true)
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
          updated_at: data['updated_at'],
          po_file_url: data['po_file_url'],
          po_file_name: data['po_file_name'],
          po_file_size: data['po_file_size'],
          po_file_type: data['po_file_type'],
          production_reviewed: data['production_reviewed'] || false,
          production_reviewed_at: data['production_reviewed_at'],
          production_reviewed_by: data['production_reviewed_by']
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
          if (a.submitted && b.submitted) {
            return (b.submitted_at || '').localeCompare(a.submitted_at || '');
          }
          return (b.created_at || '').localeCompare(a.created_at || '');
        });
      } else if (this.userRole === 'procurement') {
        loadedTables.sort((a, b) => {
          return (b.created_at || '').localeCompare(a.created_at || '');
        });
      }

      this.tables = loadedTables;

      if (this.userRole === 'production') {
        if (this.tables.length > 0 && !this.selectedTable) {
          this.selectedTable = this.tables[0];
          this.selectedTableId = this.tables[0].id;

          if (this.selectedTable.production_reviewed) {
            this.selectedProductionView = 'reviewed';
            if (this.productionReviewed.length === 0) {
              await this.loadProductionReviewed();
            }
            this.filteredRequisitions = this.productionReviewed.filter(r => r.table_id === this.selectedTableId);
          } else {
            this.selectedProductionView = 'submissions';
            this.filteredRequisitions = this.productionSubmissions.filter(r => r.table_id === this.selectedTableId);
          }

          this.updatePagination();
        }
      } else if (this.userRole === 'procurement') {
        if (this.tables.length > 0) {
          this.selectedTable = this.tables[0];
          this.selectedTableId = this.tables[0].id;
        } else {
          this.selectedTable = null;
          this.selectedTableId = '';
        }

        await this.loadProcurementReviewed();

        if (this.selectedTableId) {
          this.filteredRequisitions = this.procurementReviewed.filter(r => r.table_id === this.selectedTableId);
        } else {
          this.filteredRequisitions = [...this.procurementReviewed];
        }
        this.updatePagination();
      } else if (this.tables.length > 0) {
        const lastTableId = localStorage.getItem(`lastSelectedRequisitionTable_${this.userId}`);

        if (lastTableId && this.tables.some(t => t.id === lastTableId)) {
          this.selectedTableId = lastTableId;
          this.selectedTable = this.tables.find(t => t.id === this.selectedTableId) || null;
        } else {
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
      this.loader.hide();
    }
  }

  async loadRequisitionsDirectly() {
    if (!this.selectedTableId) return;

    try {
      this.isLoading = true;
      this.loader.show('Loading requisitions...');

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
      this.loader.hide();
    }
  }

  async loadProductionSubmissions() {
    this.isLoading = true;
    this.loader.show('Loading submissions...');
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
      this.loader.hide();
    }
  }

  async loadProductionReviewed() {
    this.isLoading = true;
    this.loader.show('Loading reviewed items...');
    try {
      const requisitionsRef = collection(this.firestore, 'requisitions');

      const reviewed: Requisition[] = [];
      const queries: Array<Promise<any>> = [];

      const addQuery = (q: any) => {
        queries.push(this.run(() => getDocs(q)));
      };

      addQuery(query(
        requisitionsRef,
        where('production_action', '==', 'confirmed')
      ));
      addQuery(query(
        requisitionsRef,
        where('production_action', '==', 'removed')
      ));

      const seen = new Set<string>();

      for (const queryPromise of queries) {
        try {
          const snapshot = await queryPromise;
          snapshot.forEach((doc: { data: () => any; id: any; }) => {
            const data = doc.data();
            const id = doc.id;
            if (!seen.has(id)) {
              seen.add(id);
              reviewed.push({ id, ...data } as Requisition);
            }
          });
        } catch (queryErr) {
          console.error('loadProductionReviewed query failed, skipping:', queryErr);
        }
      }

      await this.loadUserEmailsForRequisitions(reviewed);
      await this.loadTableNamesForRequisitions(reviewed);

      this.productionReviewed = reviewed;

    } catch (err) {
      console.error('loadProductionReviewed failed', err);
      this.showToast('Failed to load reviewed items', 'error');
    } finally {
      this.isLoading = false;
      this.loader.hide();
    }
  }

  async loadProcurementReviewed() {
    this.isLoading = true;
    this.loader.show('Loading requisitions...');
    try {
      const requisitionsRef = collection(this.firestore, 'requisitions');

      let reviewed: Requisition[] = [];

      const queries: Array<Promise<any>> = [];

      const addQuery = (q: any) => {
        queries.push(this.run(() => getDocs(q)));
      };

      try {
        addQuery(query(
          requisitionsRef,
          where('production_action', '==', 'confirmed')
        ));
        addQuery(query(
          requisitionsRef,
          where('status', '==', 'Partially_Delivered')
        ));
        addQuery(query(
          requisitionsRef,
          where('status', '==', 'Delivered')
        ));
        addQuery(query(
          requisitionsRef,
          where('status', '==', 'Scheduled')
        ));

        const snapshots = await Promise.all(queries);
        const seen = new Set<string>();

        snapshots.forEach(snapshot => {
          snapshot.forEach((doc: { data: () => any; id: any; }) => {
            const data = doc.data();
            const id = doc.id;
            if (!seen.has(id)) {
              seen.add(id);
              reviewed.push({ id, ...data } as Requisition);
            }
          });
        });
      } catch (err) {
        console.error('loadProcurementReviewed fallback failed', err);
      }

      await this.loadUserEmailsForRequisitions(reviewed);
      await this.loadTableNamesForRequisitions(reviewed);

      this.procurementReviewed = reviewed;
      this.filteredRequisitions = [...this.procurementReviewed];
      this.updatePagination();

    } catch (err) {
      console.error('loadProcurementReviewed failed', err);
      this.showToast('Failed to load reviewed requisitions', 'error');
    } finally {
      this.isLoading = false;
      this.loader.hide();
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

      if (table.production_reviewed) {
        this.selectedProductionView = 'reviewed';
        if (this.productionReviewed.length === 0) {
          await this.loadProductionReviewed();
        }
        this.filteredRequisitions = this.productionReviewed.filter(r => r.table_id === table.id);
        this.showToast(`Showing reviewed items from table: ${table.name}`, 'info');
      } else {
        this.selectedProductionView = 'submissions';
        this.filteredRequisitions = this.productionSubmissions.filter(r => r.table_id === table.id);
        this.showToast(`Showing submissions from table: ${table.name}`, 'info');
      }

      this.currentPage = 1;
      this.updatePagination();

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
            submitted_at: data['submitted_at'],
            po_file_url: data['po_file_url'],
            po_file_name: data['po_file_name']
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
      this.isSubmitting = true;
      this.loader.show('Submitting table...');

      const snapshot = await this.run(() => {
        const requisitionsRef = collection(this.firestore, 'requisitions');
        const q = query(
          requisitionsRef,
          where('table_id', '==', table.id),
          where('user_id', '==', this.userId)
        );
        return getDocs(q);
      });

      const items: Array<{skuName: string; skuCode: string; quantity: number; unit: string}> = [];
      
      await this.run(async () => {
        const batch = writeBatch(this.firestore);

        snapshot.forEach(d => {
          const data = d.data();
          items.push({
            skuName: data['skuName'] || data['sku_name'] || 'Unknown',
            skuCode: data['skuCode'] || data['sku_code'] || 'Unknown',
            quantity: data['quantity'] || data['qty_needed'] || 0,
            unit: data['unit'] || data['batch_unit'] || 'pcs'
          });
          
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

      const currentUser = await this.auth.getCurrentUserPromise();
      const userEmail = currentUser?.email || 'unknown@example.com';

      try {
        await this.emailNotificationService.sendTableSubmittedNotification({
          tableName: table.name,
          userEmail: userEmail,
          submittedAt: new Date().toISOString(),
          items: items,
          tableId: table.id,
          itemCount: items.length,
          reviewLink: `${window.location.origin}/requisitions?tableId=${table.id}&role=production`
        });
        console.log('Email notification sent to Production team');
        this.showToast(`Table "${table.name}" submitted and Production team has been notified`, 'success');
      } catch (emailError) {
        console.error('Failed to send email notification:', emailError);
        this.showToast(`Table "${table.name}" submitted successfully (email notification failed)`, 'info');
      }

      await this.notificationService.sendTableSubmittedNotification(
        table.id,
        table.name,
        this.userId
      );

      await this.loadRequisitionsDirectly();

    } catch (err) {
      console.error('Failed to submit table:', err);
      this.showToast('Failed to submit table', 'error');
    } finally {
      this.isSubmitting = false;
      this.loader.hide();
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
        req.status,
        this.userId,
        req.table_id || '',
        updateData
      );

      if (success) {
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
        this.selectedRequisition.status,
        this.userId,
        this.selectedRequisition.table_id || '',
        updateData
      );

      if (success) {
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
        req.status = 'Delivered';
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
        this.selectedRequisition.status = 'Partially_Delivered';
        this.selectedRequisition.procurement_notes = this.missingMaterialsNotes;
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

  async submitReviewedTable() {
    if (!this.canSubmitReviewedTable() || !this.selectedTable) return;

    if (!confirm(`Submit reviewed table "${this.selectedTable.name}" to procurement?`)) return;

    try {
      this.isSubmitting = true;
      this.loader.show('Submitting to procurement...');

      const tableSubmissions = this.productionSubmissions.filter(r => r.table_id === this.selectedTable!.id);
      
      const confirmedItems = tableSubmissions.filter(r => r.production_action === 'confirmed').length;
      const removedItems = tableSubmissions.filter(r => r.production_action === 'removed').length;
      
      const updatePromises = tableSubmissions.map(async (req) => {
        const action = req.production_action === 'removed' ? 'removed' : 'confirmed';
        const newStatus = action === 'removed' ? 'Removed' : 'Production_Confirmed';

        const updateData: any = {
          production_action: action,
          production_action_at: req.production_action_at || new Date().toISOString(),
          production_action_by: req.production_action_by || this.userId
        };

        if (action === 'removed') {
          updateData.production_action_notes = req.production_action_notes || '';
        }

        const needsUpdate = req.status !== newStatus || req.production_action !== action;
        if (!needsUpdate) return true;

        const tableId = req.table_id || this.selectedTableId || '';
        return this.db.updateRequisitionStatus(
          req.id,
          newStatus,
          this.userId,
          tableId,
          updateData
        );
      });

      await Promise.all(updatePromises);

      const tableRef = doc(this.firestore, 'tables', this.selectedTable.id);
      await this.run(() =>
        updateDoc(tableRef, {
          production_reviewed: true,
          production_reviewed_at: new Date().toISOString(),
          production_reviewed_by: this.userId,
          updated_at: new Date().toISOString(),
          submitted: true
        })
      );

      const currentUser = await this.auth.getCurrentUserPromise();
      const reviewerEmail = currentUser?.email || 'unknown@example.com';

      try {
        await this.emailNotificationService.sendTableReviewedNotification({
          tableName: this.selectedTable.name,
          reviewerEmail: reviewerEmail,
          reviewedAt: new Date().toISOString(),
          totalItems: tableSubmissions.length,
          confirmedItems: confirmedItems,
          removedItems: removedItems,
          tableId: this.selectedTable.id,
          reviewLink: `${window.location.origin}/requisitions?tableId=${this.selectedTable.id}&role=procurement`
        });
        console.log('Email notification sent to Procurement team');
        this.showToast(`Table "${this.selectedTable.name}" submitted to procurement – they have been notified`, 'success');
      } catch (emailError) {
        console.error('Failed to send email notification:', emailError);
        this.showToast(`Table "${this.selectedTable.name}" submitted to procurement (email notification failed)`, 'info');
      }

      await this.notificationService.sendTableReviewedByProductionNotification(
        this.selectedTable.id,
        this.selectedTable.name,
        this.userId
      );

      if (this.selectedTable) {
        this.selectedTable.production_reviewed = true;
      }

      await this.loadProductionSubmissions();
      await this.loadProductionReviewed();

      this.selectedProductionView = 'reviewed';
      this.filteredRequisitions = this.productionReviewed.filter(r => r.table_id === this.selectedTable!.id);
      this.updatePagination();
      
    } catch (err) {
      console.error('Failed to submit reviewed table:', err);
      this.showToast('Failed to submit table', 'error');
    } finally {
      this.isSubmitting = false;
      this.loader.hide();
    }
  }

  async toggleRow(req: Requisition) {
    if (!req.id) return;

    this.expandedRows[req.id] = !this.expandedRows[req.id];

    if (this.expandedRows[req.id] && !req.materials) {
      this.loadingMaterials[req.id] = true;
      try {
        const skuCode = String(req.skuCode ?? req['sku_code'] ?? '').trim();
        const materials = await this.db.getMaterialsForSku(skuCode);
        req.materials = materials || [];
      } catch (err) {
        console.error('Failed to load materials', err);
        req.materials = [];
        this.showToast('Failed to load materials', 'error');
      } finally {
        this.loadingMaterials[req.id] = false;
        this.cdr.detectChanges();
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

  // P.O File Upload Methods
  triggerPoFileInput() {
    const fileInput = document.getElementById('poFileInput') as HTMLInputElement;
    if (fileInput) {
      fileInput.click();
    }
  }

  onPoFileSelected(event: any) {
    const file = event.target.files?.[0];
    if (file) {
      // Validate file size (max 5MB)
      if (file.size > 5 * 1024 * 1024) {
        this.showToast('File size must be less than 5MB', 'error');
        this.poFile = null;
        this.poFileName = '';
        return;
      }
      
      // Validate file type
      const allowedTypes = ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.jpg', '.jpeg', '.png'];
      const fileExt = '.' + file.name.split('.').pop()?.toLowerCase();
      if (!allowedTypes.includes(fileExt)) {
        this.showToast('Please upload PDF, Word, Excel, or image files only', 'error');
        this.poFile = null;
        this.poFileName = '';
        return;
      }
      
      this.poFile = file;
      this.poFileName = file.name;
    } else {
      this.poFile = null;
      this.poFileName = '';
    }
  }

 async uploadPoFile() {
  if (!this.selectedTable) {
    this.showToast('Please select a table first', 'error');
    return;
  }

  if (!this.poFile) {
    this.showToast('Please select a file first', 'error');
    return;
  }

  try {
    this.isUploadingPo = true;
    this.showToast('Uploading file...', 'info');

    // Create a unique filename
    const timestamp = new Date().getTime();
    const fileExt = this.poFile.name.split('.').pop();
    const fileName = `po_${this.selectedTable.id}_${timestamp}.${fileExt}`;
    
    // Create a reference to Firebase Storage
    const storageRef = ref(this.storage, `po_documents/${fileName}`);
    
    // Upload the file - ensure we're passing the File object, not null
    const uploadResult = await this.run(() => uploadBytes(storageRef, this.poFile as Blob));
    
    // Get the download URL
    const downloadUrl = await this.run(() => getDownloadURL(uploadResult.ref));
    
    // Save the URL to Firestore
    const tableRef = doc(this.firestore, 'tables', this.selectedTable.id);
    await this.run(() => 
      updateDoc(tableRef, {
        po_file_url: downloadUrl,
        po_file_name: this.poFile?.name || '',
        po_file_size: this.poFile?.size || 0,
        po_file_type: this.poFile?.type || '',
        po_uploaded_at: new Date().toISOString(),
        po_uploaded_by: this.userId,
        updated_at: new Date().toISOString()
      })
    );

    // Update local state
    if (this.selectedTable) {
      this.selectedTable.po_file_url = downloadUrl;
      this.selectedTable.po_file_name = this.poFile?.name || '';
      this.selectedTable.po_file_size = this.poFile?.size;
      this.selectedTable.po_file_type = this.poFile?.type;

      const tableIndex = this.tables.findIndex(t => t.id === this.selectedTable!.id);
      if (tableIndex !== -1) {
        this.tables[tableIndex].po_file_url = downloadUrl;
        this.tables[tableIndex].po_file_name = this.poFile?.name || '';
        this.tables[tableIndex].po_file_size = this.poFile?.size;
        this.tables[tableIndex].po_file_type = this.poFile?.type;
      }
    }

    // Reset the file input
    this.poFile = null;
    this.poFileName = '';
    const fileInput = document.getElementById('poFileInput') as HTMLInputElement;
    if (fileInput) {
      fileInput.value = '';
    }
    
    this.showToast('P.O document uploaded and saved successfully', 'success');

  } catch (err) {
    console.error('Failed to upload P.O file:', err);
    this.showToast('Failed to upload file. Please try again.', 'error');
  } finally {
    this.isUploadingPo = false;
  }
}

async removePoLink() {
  if (!this.selectedTable) return;

  if (!confirm('Remove this P.O document? This will also delete the file from storage.')) return;

  try {
    this.isSubmitting = true;
    this.showToast('Removing P.O document...', 'info');

    // If there's a URL, try to delete the file from storage
    if (this.selectedTable.po_file_url) {
      try {
        // Extract the storage path from the URL
        const urlParts = this.selectedTable.po_file_url.split('/');
        const fileName = urlParts[urlParts.length - 1].split('?')[0];
        const storagePath = `po_documents/${fileName}`;
        const storageRef = ref(this.storage, storagePath);
        
        // Attempt to delete the file
        await this.run(() => deleteObject(storageRef));
      } catch (storageErr) {
        console.warn('Could not delete file from storage:', storageErr);
        // Continue even if storage deletion fails
      }
    }

    // Remove the URL from Firestore
    const tableRef = doc(this.firestore, 'tables', this.selectedTable.id);
    await this.run(() => 
      updateDoc(tableRef, {
        po_file_url: null,
        po_file_name: null,
        po_file_size: null,
        po_file_type: null,
        po_removed_at: new Date().toISOString(),
        po_removed_by: this.userId,
        updated_at: new Date().toISOString()
      })
    );

    // Update local state
    if (this.selectedTable) {
      this.selectedTable.po_file_url = undefined;
      this.selectedTable.po_file_name = undefined;
      this.selectedTable.po_file_size = undefined;
      this.selectedTable.po_file_type = undefined;

      const tableIndex = this.tables.findIndex(t => t.id === this.selectedTable!.id);
      if (tableIndex !== -1) {
        this.tables[tableIndex].po_file_url = undefined;
        this.tables[tableIndex].po_file_name = undefined;
        this.tables[tableIndex].po_file_size = undefined;
        this.tables[tableIndex].po_file_type = undefined;
      }
    }

    this.showToast('P.O document removed successfully', 'success');

  } catch (err) {
    console.error('Failed to remove P.O document:', err);
    this.showToast('Failed to remove P.O document', 'error');
  } finally {
    this.isSubmitting = false;
  }
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

    if (this.selectedTable.production_reviewed) {
      return false;
    }

    const tableSubmissions = this.productionSubmissions.filter(r => r.table_id === this.selectedTable!.id);
    if (tableSubmissions.length === 0) return false;

    return tableSubmissions.every(r => r.production_action === 'confirmed' || r.production_action === 'removed');
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
      (req.status === 'Production_Confirmed' || req.status === 'Partially_Delivered')
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
        (r.skuCode || r['sku_code'] || '').toLowerCase().includes(q) ||
        (r.skuName || r['sku_name'] || '').toLowerCase().includes(q) ||
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