import { Component, OnInit, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DatabaseService } from '../../../core/services/database.service';
import { AuthService } from '../../../core/services/auth.service';
import { Firestore, doc, collection, query, where, getDocs } from '@angular/fire/firestore';
import { getDoc } from 'firebase/firestore';
import { Router } from '@angular/router';

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
  table_id?: string;
  submitted_at?: string;
  scheduled_date?: string;
  scheduled_by?: string;
  approved_at?: string;
  approved_by?: string;
  rejection_reason?: string;
  [key: string]: any;
}

interface Table {
  id: string;
  name: string;
  user_id: string;
  type: 'inventory' | 'requisition';
  item_count?: number;
  created_at?: string;
  updated_at?: string;
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

  // Tables - Only requisition type
  tables: Table[] = [];
  selectedTableId: string = '';
  selectedTable: Table | null = null;
  showTableDropdown = false;

  // Requisitions
  requisitions: Requisition[] = [];
  filteredRequisitions: Requisition[] = [];
  paginatedRequisitions: Requisition[] = [];

  // UI State
  showModal = false;
  showTableModal = false;
  showScheduleModal = false;
  showApproveModal = false;
  showRejectModal = false;
  showDeliveryModal = false;
  showMissingNotesModal = false;
  // View modes: store/user see their tables; production sees store submissions; procurement sees for-delivery
  viewMode: 'my_tables' | 'store_submissions' | 'for_delivery' = 'my_tables';
  showAllPending = false; // Legacy procurement view
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

  // Editing
  editingRequisition: Requisition | null = null;
  editingTable: Table | null = null;
  newTableName: string = '';
  editTableName: string = '';

  // Selected SKU Code (auto-generated from SKU name)
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

  // Table names for cross-user views (production/procurement)
  tableNameMap: { [tableId: string]: string } = {};

  Math = Math;

  constructor(
    private db: DatabaseService,
    private auth: AuthService,
    private firestore: Firestore,
    private router: Router
  ) {}

  async ngOnInit() {
    const user = await this.auth.getCurrentUserPromise();
    if (user) {
      this.userId = user.uid;
      await this.loadUserRole();
      
      // Check if user has procurement access
      if (this.userRole !== 'procurement' && this.userRole !== 'admin' && this.userRole !== 'user') {
        this.showToast('You do not have access to Requisitions', 'error');
        this.router.navigate(['/dashboard']);
        return;
      }
      
      await this.loadCategories();
      await this.loadUserTables();
    } else {
      this.showToast('Please log in to continue', 'error');
      this.router.navigate(['/login']);
    }
  }

  async loadUserRole() {
    try {
      const userDoc = await getDoc(doc(this.firestore, 'users', this.userId));
      if (userDoc.exists()) {
        const data = userDoc.data() as any;
        this.userRole = data['role'] || 'user';
      } else {
        this.userRole = 'user';
      }
      console.log('User role:', this.userRole);
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

  async loadUserTables() {
    if (!this.userId) {
      console.error('No user ID available');
      return;
    }

    try {
      // Production: only sees store submissions (no own tables)
      if (this.userRole === 'production') {
        this.viewMode = 'store_submissions';
        await this.loadStoreSubmissions();
        return;
      }

      // Procurement: can toggle for_delivery view
      if (this.userRole === 'procurement' || this.userRole === 'admin') {
        this.viewMode = 'for_delivery';
        await this.loadForDelivery();
        return;
      }

      // Store/User: load their tables
      this.viewMode = 'my_tables';
      this.tables = await this.db.getUserTablesByType(this.userId, 'requisition');
      
      const lastTableId = localStorage.getItem(`lastSelectedRequisitionTable_${this.userId}`);
      if (lastTableId && this.tables.some(t => t.id === lastTableId)) {
        this.selectedTableId = lastTableId;
      } else if (this.tables.length > 0) {
        this.selectedTableId = this.tables[0].id;
      }
      
      if (this.selectedTableId) {
        await this.onTableChange();
      }
    } catch (err) {
      console.error('Failed to load tables:', err);
      this.showToast('Failed to load tables', 'error');
    }
  }

  async loadStoreSubmissions() {
    this.isLoading = true;
    try {
      this.requisitions = await this.db.getAllRequisitionsByStatus('Submitted');
      await this.loadTableNamesForRequisitions(this.requisitions);
      this.applyFilter();
    } catch (err) {
      console.error('Failed to load store submissions', err);
      this.showToast('Failed to load store submissions', 'error');
    } finally {
      this.isLoading = false;
    }
  }

  async loadForDelivery() {
    this.isLoading = true;
    try {
      this.requisitions = await this.db.getAllRequisitionsByStatus('Production_Accepted');
      await this.loadTableNamesForRequisitions(this.requisitions);
      this.applyFilter();
    } catch (err) {
      console.error('Failed to load for delivery', err);
      this.showToast('Failed to load for delivery', 'error');
    } finally {
      this.isLoading = false;
    }
  }

  private async loadTableNamesForRequisitions(reqs: Requisition[]) {
    const tableIds = [...new Set(reqs.map(r => r.table_id).filter(Boolean))] as string[];
    for (const tid of tableIds) {
      if (!this.tableNameMap[tid]) {
        const t = await this.db.getTableById(tid);
        this.tableNameMap[tid] = t?.name || 'Untitled';
      }
    }
  }

  async onTableChange() {
    if (!this.selectedTableId) {
      console.log('No table selected');
      this.requisitions = [];
      this.filteredRequisitions = [];
      this.selectedTable = null;
      return;
    }

    console.log('Table changed to:', this.selectedTableId);
    
    // Save selection with user-specific key
    localStorage.setItem(`lastSelectedRequisitionTable_${this.userId}`, this.selectedTableId);
    
    // Update selected table
    this.selectedTable = this.tables.find(t => t.id === this.selectedTableId) || null;
    console.log('Selected table:', this.selectedTable);
    
    // Load requisitions for selected table
    await this.loadRequisitions();
  }

  async loadRequisitions() {
    if (!this.selectedTableId || !this.userId) {
      console.log('Missing tableId or userId for loading requisitions');
      return;
    }

    this.isLoading = true;
    try {
      console.log('Loading requisitions for table:', this.selectedTableId);
      
      // DIRECT QUERY to Firebase to see what's happening
      const requisitionsRef = collection(this.firestore, 'requisitions');
      const q = query(
        requisitionsRef,
        where('table_id', '==', this.selectedTableId),
        where('user_id', '==', this.userId)
      );
      
      const querySnapshot = await getDocs(q);
      console.log('Query snapshot size:', querySnapshot.size);
      
      // Map the data
      const data = querySnapshot.docs.map(doc => {
        const docData = doc.data();
        return {
          id: doc.id,
          ...docData
        } as Requisition;
      });
      
      console.log('Mapped requisitions:', data);
      
      this.requisitions = data;
      this.applyFilter();
    } catch (err) {
      console.error('Failed to load requisitions:', err);
      this.showToast('Failed to load requisitions', 'error');
    } finally {
      this.isLoading = false;
    }
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
      console.log('Available SKUs:', this.availableSkus);
      this.formData.skuName = '';
      this.selectedSkuCode = '';
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
        this.showToast('Master data imported', 'success');
      } else {
        this.importStatus = 'error';
        this.importMessage = result.error || 'Upload failed';
        this.showToast('Upload failed', 'error');
      }
    } catch (err) {
      this.importStatus = 'error';
      this.importMessage = 'Upload error';
      this.showToast('Upload error', 'error');
    }
  }

  async onSubmit() {
    if (!this.selectedTableId) {
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
      // Get SKU name and code
      const skuName = this.formData.skuName;
      const selectedItem = this.availableSkus.find(item => item.sku_name === skuName);
      const skuCode = selectedItem ? selectedItem.sku_code : '';

      // Process supplier and brand
      const finalSupplier = this.formData.supplier === '__other__'
        ? this.formData.customSupplier?.trim()
        : this.formData.supplier;

      const finalBrand = this.formData.brand === '__other__'
        ? this.formData.customBrand?.trim()
        : this.formData.brand || '';

      // Generate requisition number
      let reqNumber = '';
      if (this.editingRequisition) {
        reqNumber = this.editingRequisition.reqNumber;
      } else {
        const year = new Date().getFullYear();
        const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
        reqNumber = `MR-${year}-${random}`;
      }

      const requisitionData = {
        reqNumber,
        type: this.formData.type,
        dateNeeded: this.formData.dateNeeded || 'ASAP',
        skuCode,
        skuName,
        quantity: Number(this.formData.quantity),
        unit: this.formData.unit,
        supplier: finalSupplier,
        brand: finalBrand,
        status: 'Pending',
        category: this.formData.category,
        remarks: this.formData.remarks?.trim() || '',
        user_id: this.userId,
        table_id: this.selectedTableId,
        materials: [] // Add empty materials array
      };

      console.log('Submitting requisition data:', requisitionData);

      let result;
      
      if (this.editingRequisition) {
        // Update existing requisition
        result = await this.db.updateRequisition(
          this.editingRequisition.id,
          requisitionData,
          this.userId,
          this.selectedTableId
        );
        
        if (result) {
          this.showToast('Requisition updated successfully', 'success');
        }
      } else {
        // Create new requisition
        result = await this.db.createRequisition(requisitionData, []);
        
        if (result.success) {
          console.log('Requisition created with ID:', result.id);
          this.showToast('Requisition created successfully', 'success');
        }
      }
      
      if (result && (result === true || result.success)) {
        await this.loadRequisitions(); // Reload to show the new requisition
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

  // Submit requisition for approval (Store/User action)
  async submitRequisition(req: Requisition) {
    if (this.userRole !== 'user' && this.userRole !== 'store') {
      this.showToast('Only store/user can submit requisitions', 'error');
      return;
    }

    if (!confirm(`Submit requisition ${req.reqNumber || req.id} for approval?`)) return;

    try {
      const success = await this.db.updateRequisitionStatus(
        req.id,
        'Submitted',
        this.userId,
        req.table_id || this.selectedTableId || '',
        { submitted_at: new Date().toISOString() }
      );

      if (success) {
        await this.loadRequisitions();
        this.showToast('Requisition submitted for approval', 'success');
      } else {
        this.showToast('Failed to submit requisition', 'error');
      }
    } catch (err) {
      console.error('Submit error:', err);
      this.showToast('Failed to submit requisition', 'error');
    }
  }

  // Production: Accept store/user submission
  async acceptByProduction(req: Requisition) {
    if (this.userRole !== 'production' && this.userRole !== 'admin') {
      this.showToast('Only production can accept requisitions', 'error');
      return;
    }
    if (!confirm(`Accept requisition ${req.reqNumber || req.id} and send to procurement?`)) return;

    try {
      const success = await this.db.updateRequisitionStatus(
        req.id,
        'Production_Accepted',
        this.userId,
        req.table_id || '',
        {}
      );
      if (success) {
        await this.loadStoreSubmissions();
        this.showToast('Requisition accepted and sent to procurement', 'success');
      } else {
        this.showToast('Failed to accept requisition', 'error');
      }
    } catch (err) {
      console.error('Accept error:', err);
      this.showToast('Failed to accept requisition', 'error');
    }
  }

  // Production: Decline store/user submission
  openRejectModalProduction(req: Requisition) {
    this.selectedRequisition = req;
    this.rejectionReason = '';
    this.showRejectModal = true;
  }

  async rejectByProduction() {
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
        { rejected_by: this.userId, rejection_reason: this.rejectionReason }
      );
      if (success) {
        await this.loadStoreSubmissions();
        this.closeRejectModal();
        this.showToast('Requisition declined', 'success');
      } else {
        this.showToast('Failed to decline requisition', 'error');
      }
    } catch (err) {
      console.error('Reject error:', err);
      this.showToast('Failed to decline requisition', 'error');
    }
  }

  // Procurement: Mark as fully delivered
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
        await this.loadForDelivery();
        this.showToast('Requisition marked as delivered', 'success');
      } else {
        this.showToast('Failed to update', 'error');
      }
    } catch (err) {
      console.error('Deliver error:', err);
      this.showToast('Failed to update', 'error');
    }
  }

  // Procurement: Add notes for missing materials
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
        await this.loadForDelivery();
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

  // Open schedule modal (Procurement action)
  openScheduleModal(req: Requisition) {
    if (this.userRole !== 'procurement' && this.userRole !== 'admin') {
      this.showToast('Only procurement can schedule requisitions', 'error');
      return;
    }

    if (req.status !== 'Submitted') {
      this.showToast('Only submitted requisitions can be scheduled', 'error');
      return;
    }

    this.selectedRequisition = req;
    this.scheduledDate = '';
    this.scheduledTime = '';
    this.showScheduleModal = true;
  }

  // Schedule requisition (Procurement action)
  async scheduleRequisition() {
    if (!this.selectedRequisition || !this.scheduledDate) {
      this.showToast('Please select a date', 'error');
      return;
    }

    try {
      const scheduledDateTime = this.scheduledTime 
        ? `${this.scheduledDate}T${this.scheduledTime}`
        : this.scheduledDate;

      const success = await this.db.updateRequisitionStatus(
        this.selectedRequisition.id,
        'Scheduled',
        this.userId,
        this.selectedTableId || '',
        {
          scheduled_date: scheduledDateTime,
          scheduled_by: this.userId
        }
      );

      if (success) {
        await this.loadRequisitions();
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

  // Open approve modal (Admin action)
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

  // Approve requisition (Admin action)
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
          approval_notes: this.approvalNotes || null
        }
      );

      if (success) {
        await this.loadRequisitions();
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

  // Open reject modal (Production accept/decline, Admin/Procurement)
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

  // Reject modal confirm - dispatches to correct handler
  async confirmReject() {
    if (this.viewMode === 'store_submissions' && (this.userRole === 'production' || this.userRole === 'admin')) {
      await this.rejectByProduction();
    } else {
      await this.rejectRequisition();
    }
  }

  // Reject requisition (Admin/Procurement action)
  async rejectRequisition() {
    if (!this.selectedRequisition) return;

    if (!this.rejectionReason.trim()) {
      this.showToast('Please provide a rejection reason', 'error');
      return;
    }

    try {
      const success = await this.db.updateRequisitionStatus(
        this.selectedRequisition.id,
        'Rejected',
        this.userId,
        this.selectedTableId || '',
        {
          rejected_by: this.userId,
          rejection_reason: this.rejectionReason
        }
      );

      if (success) {
        await this.loadRequisitions();
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

  async deleteRequisition(req: Requisition) {
    if (!this.selectedTableId || !this.userId) return;
    
    // Check permissions
    if (this.userRole !== 'admin' && req.user_id !== this.userId) {
      this.showToast('You can only delete your own requisitions', 'error');
      return;
    }

    // Prevent deletion of approved requisitions
    if (req.status === 'Approved') {
      this.showToast('Approved requisitions cannot be deleted', 'error');
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

  validateForm(): boolean {
    if (!this.formData.type || 
        !this.formData.category || 
        !this.formData.skuName ||
        !this.formData.quantity || 
        this.formData.quantity <= 0 ||
        !this.formData.unit || 
        !this.formData.supplier) {
      return false;
    }
    
    if (this.formData.supplier === '__other__' && !this.formData.customSupplier?.trim()) {
      return false;
    }
    
    return true;
  }

  openModal() {
    if (!this.selectedTableId) {
      this.showToast('Please select a table first', 'error');
      this.openTableModal();
      return;
    }
    
    this.showModal = true;
    this.submitted = false;
    this.editingRequisition = null;
    this.resetForm();
  }

  closeModal() {
    this.showModal = false;
    this.editingRequisition = null;
  }

  closeScheduleModal() {
    this.showScheduleModal = false;
    this.selectedRequisition = null;
    this.scheduledDate = '';
    this.scheduledTime = '';
  }

  closeApproveModal() {
    this.showApproveModal = false;
    this.selectedRequisition = null;
    this.approvalNotes = '';
  }

  closeRejectModal() {
    this.showRejectModal = false;
    this.selectedRequisition = null;
    this.rejectionReason = '';
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

  // Table Management Methods
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
    if (!this.newTableName.trim()) return;
    
    if (!this.userId) {
      this.showToast('You must be logged in', 'error');
      return;
    }

    try {
      // Create table with type 'requisition'
      const result = await this.db.createUserTable({
        name: this.newTableName.trim(),
        user_id: this.userId
      }, 'requisition');

      if (result.success && result.tableId) {
        // Add new table to list
        const newTable: Table = {
          id: result.tableId,
          name: this.newTableName.trim(),
          user_id: this.userId,
          type: 'requisition',
          item_count: 0,
          created_at: new Date().toISOString()
        };
        
        this.tables.push(newTable);
        this.selectedTableId = result.tableId;
        await this.onTableChange();
        
        this.newTableName = '';
        this.closeTableModal();
        this.showToast('Table created successfully', 'success');
      } else {
        this.showToast('Failed to create table', 'error');
      }
    } catch (err) {
      console.error('Create table error:', err);
      this.showToast('Failed to create table', 'error');
    }
  }

  editTable(table: Table) {
    // Verify ownership before allowing edit
    if (table.user_id !== this.userId) {
      this.showToast('You can only edit your own tables', 'error');
      return;
    }
    // Verify table type
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
        // Update table in list
        const index = this.tables.findIndex(t => t.id === this.editingTable!.id);
        if (index !== -1) {
          this.tables[index].name = this.editTableName.trim();
        }
        
        // Update selected table if it's the current one
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

  async selectTable(table: Table) {
    // Verify ownership before selecting
    if (table.user_id !== this.userId) {
      this.showToast('You can only access your own tables', 'error');
      return;
    }
    
    // Verify table type
    if (table.type !== 'requisition') {
      this.showToast('Invalid table type', 'error');
      return;
    }
    
    this.selectedTableId = table.id;
    this.selectedTable = table;
    this.showTableDropdown = false;
    this.showAllPending = false; // Reset all pending view
    
    // Reset filters
    this.searchQuery = '';
    this.filterStatus = '';
    
    // Save selection with user-specific key
    localStorage.setItem(`lastSelectedRequisitionTable_${this.userId}`, this.selectedTableId);
    
    // Load requisitions for selected table
    await this.loadRequisitions();
    
    this.showToast(`Switched to table: ${table.name}`, 'success');
  }

  async deleteTable(table: Table) {
    if (this.tables.length <= 1) {
      this.showToast('Cannot delete the last table', 'error');
      return;
    }

    // Verify ownership before deleting
    if (table.user_id !== this.userId) {
      this.showToast('You can only delete your own tables', 'error');
      return;
    }

    // Verify table type
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
        // Remove from list
        this.tables = this.tables.filter(t => t.id !== table.id);
        
        // Select another table if current was deleted
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

  async updateTableItemCount() {
    if (!this.selectedTableId || !this.userId) return;
    
    try {
      await this.db.updateTableItemCount(
        this.selectedTableId,
        this.requisitions.length,
        this.userId
      );
      
      // Update local table object
      if (this.selectedTable) {
        this.selectedTable.item_count = this.requisitions.length;
      }
      
      // Update in tables list
      const tableIndex = this.tables.findIndex(t => t.id === this.selectedTableId);
      if (tableIndex !== -1) {
        this.tables[tableIndex].item_count = this.requisitions.length;
      }
    } catch (err) {
      console.error('Failed to update table item count:', err);
    }
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
    console.log('Filtered requisitions:', this.filteredRequisitions);
    this.currentPage = 1;
    this.updatePagination();
  }

  updatePagination() {
    this.totalPages = Math.max(1, Math.ceil(this.filteredRequisitions.length / this.pageSize));
    const start = (this.currentPage - 1) * this.pageSize;
    this.paginatedRequisitions = this.filteredRequisitions.slice(start, start + this.pageSize);
    console.log('Paginated requisitions:', this.paginatedRequisitions);
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

  // Helper methods for role-based UI
  canCreateRequisition(): boolean {
    return (this.userRole === 'user' || this.userRole === 'store') && this.viewMode === 'my_tables';
  }

  canSubmitRequisition(req: Requisition): boolean {
    return (this.userRole === 'user' || this.userRole === 'store') && req.status === 'Pending' && req.user_id === this.userId;
  }

  canAcceptByProduction(req: Requisition): boolean {
    return (this.userRole === 'production' || this.userRole === 'admin') && req.status === 'Submitted';
  }

  canDeclineByProduction(req: Requisition): boolean {
    return (this.userRole === 'production' || this.userRole === 'admin') && req.status === 'Submitted';
  }

  canMarkDelivered(req: Requisition): boolean {
    return (this.userRole === 'procurement' || this.userRole === 'admin') && req.status === 'Production_Accepted';
  }

  canAddMissingNotes(req: Requisition): boolean {
    return (this.userRole === 'procurement' || this.userRole === 'admin') && req.status === 'Production_Accepted';
  }

  canScheduleRequisition(req: Requisition): boolean {
    return (this.userRole === 'procurement' || this.userRole === 'admin') && req.status === 'Submitted';
  }

  canApproveRequisition(req: Requisition): boolean {
    return this.userRole === 'admin' && req.status === 'Scheduled';
  }

  canRejectRequisition(req: Requisition): boolean {
    return (this.userRole === 'production' || this.userRole === 'admin') && req.status === 'Submitted' ||
           (this.userRole === 'admin' || this.userRole === 'procurement') && 
           (req.status === 'Submitted' || req.status === 'Scheduled');
  }

  canEditRequisition(req: Requisition): boolean {
    return this.viewMode === 'my_tables' && (this.userRole === 'admin' || req.user_id === this.userId) && 
           req.status !== 'Approved' && req.status !== 'Rejected' && req.status !== 'Delivered' && req.status !== 'Partially_Delivered';
  }

  canDeleteRequisition(req: Requisition): boolean {
    return this.viewMode === 'my_tables' && (this.userRole === 'admin' || ((this.userRole === 'user' || this.userRole === 'store') && req.user_id === this.userId)) && 
           req.status !== 'Approved' && req.status !== 'Delivered';
  }

  getStatusBadgeClass(status: string): string {
    switch(status) {
      case 'Pending': return 'status-pending';
      case 'Submitted': return 'status-submitted';
      case 'Scheduled': return 'status-scheduled';
      case 'Approved': return 'status-approved';
      case 'Rejected': return 'status-rejected';
      case 'Production_Accepted': return 'status-scheduled';
      case 'Delivered': return 'status-approved';
      case 'Partially_Delivered': return 'status-pending';
      default: return 'status-pending';
    }
  }
}