import { Component, OnInit, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DatabaseService } from '../../../core/services/database.service';
import { AuthService } from '../../../core/services/auth.service';

interface Requisition {
  id: string;
  reqNumber: string;
  type: string;
  dateNeeded: string;
  skuCode: string;
  skuName: string;
  quantity: number;
  unit: string;
  supplier: string;
  brand: string;
  status: string;
  category: string;
  remarks: string;
  created_at?: string;
  user_id?: string;
  table_id?: string;
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

  // Import
  importStatus: 'idle' | 'loading' | 'success' | 'error' = 'idle';
  importMessage = '';
  selectedFileName = '';

  Math = Math;

  // User ID - will be set from auth service
  private userId: string = '';

  constructor(
    private db: DatabaseService,
    private auth: AuthService
  ) {}

  async ngOnInit() {
    // Get the current user ID from auth service
    const user = await this.auth.getCurrentUserPromise();
    if (user) {
      this.userId = user.uid;
      await this.loadCategories();
      await this.loadUserTables();
    } else {
      this.showToast('Please log in to continue', 'error');
      // Redirect to login or handle unauthenticated state
    }
  }

  async loadCategories() {
    try {
      this.categories = await this.db.getUniqueCategories();
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
      // Only load requisition type tables
      this.tables = await this.db.getUserTablesByType(this.userId, 'requisition');
      
      // Load last selected table from localStorage or use first table
      const lastTableId = localStorage.getItem(`lastSelectedRequisitionTable_${this.userId}`);
      if (lastTableId && this.tables.some(t => t.id === lastTableId)) {
        this.selectedTableId = lastTableId;
      } else if (this.tables.length > 0) {
        this.selectedTableId = this.tables[0].id;
      }
      
      await this.onTableChange();
    } catch (err) {
      console.error('Failed to load tables:', err);
      this.showToast('Failed to load tables', 'error');
    }
  }

  async onTableChange() {
    if (!this.selectedTableId) {
      this.requisitions = [];
      this.filteredRequisitions = [];
      this.selectedTable = null;
      return;
    }

    // Save selection with user-specific key
    localStorage.setItem(`lastSelectedRequisitionTable_${this.userId}`, this.selectedTableId);
    
    // Update selected table
    this.selectedTable = this.tables.find(t => t.id === this.selectedTableId) || null;
    
    // Load requisitions for selected table
    await this.loadRequisitions();
  }

  async loadRequisitions() {
    if (!this.selectedTableId || !this.userId) return;

    this.isLoading = true;
    try {
      const data = await this.db.getTableRequisitions(this.selectedTableId, this.userId);
      
      // Ensure each requisition has a reqNumber (generate one if missing)
      this.requisitions = data.map((req: any, index: number) => {
        if (!req.reqNumber) {
          // Generate a reqNumber if it doesn't exist
          req.reqNumber = `MR-${new Date().getFullYear()}-${String(index + 1).padStart(3, '0')}`;
        }
        return req as Requisition;
      });
      
      console.log('Loaded requisitions:', this.requisitions);
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

      const requisitionData: any = {
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
        table_id: this.selectedTableId
      };

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
        // Generate requisition number for new requisitions
        let nextNumber = 1;
        if (this.requisitions.length > 0) {
          const lastReq = this.requisitions[this.requisitions.length - 1];
          // Safely extract the number from reqNumber
          let lastNum = 0;
          if (lastReq && lastReq.reqNumber) {
            const parts = lastReq.reqNumber.split('-');
            lastNum = parseInt(parts[parts.length - 1] || '0');
          }
          nextNumber = lastNum + 1;
        }
        const reqNumber = `MR-${new Date().getFullYear()}-${String(nextNumber).padStart(3, '0')}`;
        
        // Add reqNumber to the data
        requisitionData.reqNumber = reqNumber;
        
        result = await this.db.createRequisition(requisitionData, []);
        
        if (result.success) {
          this.showToast('Requisition submitted successfully', 'success');
        }
      }
      
      if (result) {
        await this.loadRequisitions();
        await this.updateTableItemCount();
        this.closeModal();
      } else {
        this.showToast('Failed to save requisition', 'error');
      }
    } catch (err) {
      console.error('Submit error:', err);
      this.showToast('Failed to save requisition', 'error');
    } finally {
      this.isSubmitting = false;
    }
  }

  async deleteRequisition(req: Requisition) {
    if (!this.selectedTableId || !this.userId) return;
    
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
      }, 'requisition');  // Pass the type here

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

  cancelEdit() {
    this.editingTable = null;
    this.editTableName = '';
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
        this.cancelEdit();
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
    setTimeout(() => this.hideSnackbar(), 3000);
  }

  hideSnackbar() {
    this.showSnackbar = false;
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
}