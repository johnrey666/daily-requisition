import { Component, OnInit, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import * as ExcelJS from 'exceljs';
import { DatabaseService } from '../../../core/services/database.service';
import { AuthService } from '../../../core/services/auth.service';

interface Material {
  raw_material: string;
  quantity_per_batch: number | null;
  unit: string;
  type: string;
}

interface InventoryItem {
  id: string;
  sku_code: string;
  sku_name: string;
  category: string;
  supplier: string;
  qty: number;
  table_id: string;
  user_id: string;
  materials?: Material[];
  materialCount?: number;
  totalRequired?: number;
}

interface UserTable {
  id: string;
  name: string;
  user_id: string;
  type: 'inventory' | 'requisition';
  item_count?: number;
  created_at?: string;
  updated_at?: string;
}

@Component({
  selector: 'app-page2',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './page2.component.html',
  styleUrls: ['./page2.component.css']
})
export class Page2Component implements OnInit {
  newItem = {
    category: '',
    sku_code: '',
    sku_name: '',
    supplier: '',
    qty: null as number | null
  };

  categories: string[] = [];
  availableSkus: { sku_code: string; sku_name: string }[] = [];
  inventoryItems: InventoryItem[] = [];
  filteredItems: InventoryItem[] = [];
  paginatedItems: InventoryItem[] = [];
  
  // Table Management - Only inventory type
  userTables: UserTable[] = [];
  currentTable: UserTable | null = null;
  showTableDropdown = false;

  uploadingMaster = false;
  uploadStatus = '';
  addingItem = false;
  expandedRows: { [id: string]: boolean } = {};
  loadingMaterials: { [id: string]: boolean } = {};

  searchQuery = '';
  filterCategory = '';
  
  // Pagination
  currentPage = 1;
  pageSize = 10;
  totalPages = 1;
  
  // Snackbar
  showSnackbar = false;
  snackbarMessage = '';
  snackbarType: 'success' | 'error' | 'info' = 'info';
  snackbarTimeout: any;

  // Expose Math to template
  Math = Math;

  constructor(
    private db: DatabaseService,
    private auth: AuthService
  ) {}

  async ngOnInit() {
    const user = await this.auth.getCurrentUserPromise();
    if (user) {
      await this.loadCategories();
      await this.loadUserTables();
    } else {
      this.showToast('Please log in to continue', 'error');
    }
  }

  async loadCategories() {
    try {
      this.categories = await this.db.getUniqueCategories();
    } catch (err) {
      console.error('Failed to load categories', err);
      this.categories = [];
      this.showToast('Failed to load categories', 'error');
    }
  }

  async loadUserTables() {
    try {
      const userId = this.auth.getUserId();
      if (!userId) {
        this.showToast('You must be logged in', 'error');
        return;
      }
      
      // Only load inventory type tables
      this.userTables = await this.db.getUserTablesByType(userId, 'inventory');
      
      // Load last selected table from localStorage or use first table
      const lastTableId = localStorage.getItem(`lastSelectedInventoryTable_${userId}`);
      if (lastTableId && this.userTables.some(t => t.id === lastTableId)) {
        this.currentTable = this.userTables.find(t => t.id === lastTableId) || null;
      } else if (this.userTables.length > 0) {
        this.currentTable = this.userTables[0];
      }
      
      if (this.currentTable) {
        await this.loadInventory();
      } else {
        this.inventoryItems = [];
        this.filteredItems = [];
        this.updatePagination();
      }
    } catch (err) {
      console.error('Failed to load user tables', err);
      this.userTables = [];
      this.currentTable = null;
      this.showToast('Failed to load tables', 'error');
    }
  }

  async loadInventory() {
    if (!this.currentTable) {
      this.inventoryItems = [];
      this.filteredItems = [];
      this.updatePagination();
      return;
    }

    try {
      const userId = this.auth.getUserId();
      if (!userId) {
        this.showToast('You must be logged in', 'error');
        return;
      }

      const items = await this.db.getInventoryItemsByTable(this.currentTable.id, userId);
      this.inventoryItems = items.map((item: any) => ({
        ...item,
        materialCount: 0,
        totalRequired: 0
      }));
      this.applyFilter();
    } catch (err) {
      console.error('Failed to load inventory', err);
      this.inventoryItems = [];
      this.filteredItems = [];
      this.updatePagination();
      this.showToast('Failed to load inventory', 'error');
    }
  }

  async onCategoryChange() {
    this.newItem.sku_code = '';
    this.newItem.sku_name = '';

    if (!this.newItem.category) {
      this.availableSkus = [];
      return;
    }

    try {
      this.availableSkus = await this.db.getSkusByCategory(this.newItem.category);
    } catch (err) {
      console.error('Failed to load SKUs', err);
      this.availableSkus = [];
      this.showToast('Failed to load SKUs for selected category', 'error');
    }
  }

  onSkuChange() {
    const found = this.availableSkus.find(s => s.sku_code === this.newItem.sku_code);
    this.newItem.sku_name = found?.sku_name || '';
  }

  onQuantityChange() {
    // This will be calculated when materials are loaded
  }

  async onFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    this.uploadingMaster = true;
    this.uploadStatus = 'Uploading master data...';

    try {
      const result = await this.db.uploadMasterData(file);
      if (result.success) {
        this.uploadStatus = `Successfully imported ${result.count || 0} rows`;
        await this.loadCategories();
        this.showToast(`Successfully imported ${result.count || 0} rows`, 'success');
      } else {
        this.uploadStatus = `Upload failed: ${result.error || 'Unknown error'}`;
        this.showToast('Upload failed', 'error');
      }
    } catch (err: any) {
      this.uploadStatus = `Error: ${err.message || 'Failed to process file'}`;
      this.showToast('Error uploading file', 'error');
    } finally {
      this.uploadingMaster = false;
      input.value = '';
    }
  }

  canAddItem(): boolean {
    return !!this.currentTable &&
           !!this.newItem.category &&
           !!this.newItem.sku_code &&
           !!this.newItem.supplier?.trim() &&
           this.newItem.qty != null && this.newItem.qty > 0;
  }

  async addItem() {
    if (!this.canAddItem()) {
      this.showToast('Please fill all required fields and select a table', 'error');
      return;
    }

    this.addingItem = true;
    
    const userId = this.auth.getUserId();
    if (!userId) {
      this.showToast('You must be logged in', 'error');
      this.addingItem = false;
      return;
    }

    if (!this.currentTable) {
      this.showToast('No table selected', 'error');
      this.addingItem = false;
      return;
    }

    const entry = {
      sku_code: this.newItem.sku_code,
      sku_name: this.newItem.sku_name,
      category: this.newItem.category,
      supplier: this.newItem.supplier.trim(),
      qty: this.newItem.qty!,
      table_id: this.currentTable.id,
      user_id: userId
    };

    try {
      const res = await this.db.addInventoryItem(entry);
      if (res.success && res.id) {
        await this.addItemToTable(entry, res.id);
        
        const newItem: InventoryItem = { 
          id: res.id, 
          ...entry, 
          materialCount: 0,
          totalRequired: 0
        };
        
        this.inventoryItems.unshift(newItem);
        this.applyFilter();
        
        this.newItem = { category: '', sku_code: '', sku_name: '', supplier: '', qty: null };
        this.availableSkus = [];
        
        this.showToast('Item added successfully', 'success');
      } else {
        this.showToast('Failed to save item', 'error');
      }
    } catch (err) {
      console.error('Add item error', err);
      this.showToast('Error adding item', 'error');
    } finally {
      this.addingItem = false;
    }
  }

  async addItemToTable(itemData: any, itemId: string) {
    if (!this.currentTable) return;
    
    try {
      const userId = this.auth.getUserId();
      if (!userId) {
        this.showToast('You must be logged in', 'error');
        return;
      }
      
      const requisitionData = {
        table_id: this.currentTable.id,
        user_id: userId,
        sku_code: itemData.sku_code,
        sku_name: itemData.sku_name,
        category: itemData.category,
        supplier: itemData.supplier,
        qty_needed: itemData.qty,
        inventory_item_id: itemId
      };
      
      await this.db.createRequisition(requisitionData, []);
      
      const newCount = (this.currentTable.item_count || 0) + 1;
      await this.db.updateTableItemCount(this.currentTable.id, newCount, userId);
      this.currentTable.item_count = newCount;
      
      await this.loadUserTables();
    } catch (err) {
      console.error('Failed to add item to table', err);
      this.showToast('Failed to add item to table', 'error');
    }
  }

  async toggleRow(item: InventoryItem) {
    if (!item.id) return;
    
    this.expandedRows[item.id] = !this.expandedRows[item.id];

    if (this.expandedRows[item.id] && !item.materials) {
      this.loadingMaterials[item.id] = true;
      try {
        const materials = await this.db.getMaterialsForSku(item.sku_code);
        item.materials = materials || [];
        item.materialCount = item.materials?.length || 0;
      } catch (err) {
        console.error('Failed to load materials', err);
        item.materials = [];
        item.materialCount = 0;
        this.showToast('Failed to load materials', 'error');
      } finally {
        this.loadingMaterials[item.id] = false;
      }
    }
  }

  applyFilter() {
    let list = [...this.inventoryItems];

    if (this.filterCategory) {
      list = list.filter(i => i.category === this.filterCategory);
    }

    if (this.searchQuery.trim()) {
      const q = this.searchQuery.toLowerCase();
      list = list.filter(i =>
        i.sku_code.toLowerCase().includes(q) ||
        (i.sku_name || '').toLowerCase().includes(q) ||
        (i.supplier || '').toLowerCase().includes(q)
      );
    }

    this.filteredItems = list;
    this.currentPage = 1;
    this.updatePagination();
  }

  clearFilters() {
    this.searchQuery = '';
    this.filterCategory = '';
    this.applyFilter();
    this.showToast('Filters cleared', 'info');
  }

  get totalQuantity(): number {
    return this.filteredItems.reduce((sum, i) => sum + (i.qty || 0), 0);
  }

  calculateMaterialTotal(itemQty: number | null, qtyPerBatch: number | null): number {
    const qty = itemQty || 0;
    const batchQty = qtyPerBatch || 0;
    return batchQty * qty;
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

  async selectTable(table: UserTable) {
    // Verify table type
    if (table.type !== 'inventory') {
      this.showToast('Invalid table type', 'error');
      return;
    }

    this.currentTable = table;
    this.showTableDropdown = false;
    
    // Save selection with user-specific key
    const userId = this.auth.getUserId();
    if (userId) {
      localStorage.setItem(`lastSelectedInventoryTable_${userId}`, table.id);
    }
    
    this.searchQuery = '';
    this.filterCategory = '';
    
    await this.loadInventory();
    this.showToast(`Switched to table: ${table.name}`, 'info');
  }

  async createNewTable() {
    const tableName = prompt('Enter table name:');
    if (!tableName?.trim()) return;

    try {
      const userId = this.auth.getUserId();
      if (!userId) {
        this.showToast('You must be logged in to create tables', 'error');
        return;
      }

      const tableData = {
        user_id: userId,
        name: tableName.trim(),
        item_count: 0
      };

      // Create table with type 'inventory'
      const result = await this.db.createUserTable(tableData, 'inventory');
      if (result.success && result.tableId) {
        await this.loadUserTables();
        this.showToast(`Table "${tableName}" created successfully`, 'success');
      } else {
        this.showToast('Failed to create table', 'error');
      }
    } catch (err) {
      console.error('Failed to create table', err);
      this.showToast('Error creating table', 'error');
    }
  }

  async renameTable(table: UserTable) {
    // Verify table type
    if (table.type !== 'inventory') {
      this.showToast('Invalid table type', 'error');
      return;
    }

    const newName = prompt('Enter new table name:', table.name);
    if (!newName?.trim() || newName === table.name) return;

    try {
      const userId = this.auth.getUserId();
      if (!userId) {
        this.showToast('You must be logged in', 'error');
        return;
      }

      const success = await this.db.updateTableName(table.id, newName.trim(), userId);
      if (success) {
        table.name = newName.trim();
        await this.loadUserTables();
        this.showToast('Table renamed successfully', 'success');
      } else {
        this.showToast('Failed to rename table', 'error');
      }
    } catch (err) {
      console.error('Failed to rename table', err);
      this.showToast('Error renaming table', 'error');
    }
  }

  async deleteTable(table: UserTable) {
    // Verify table type
    if (table.type !== 'inventory') {
      this.showToast('Invalid table type', 'error');
      return;
    }

    if (!confirm(`Are you sure you want to delete table "${table.name}"? This will also delete all items in this table. This action cannot be undone.`)) {
      return;
    }

    try {
      const userId = this.auth.getUserId();
      if (!userId) {
        this.showToast('You must be logged in', 'error');
        return;
      }

      const success = await this.db.deleteTable(table.id, userId);
      if (success) {
        this.userTables = this.userTables.filter(t => t.id !== table.id);
        
        if (this.currentTable?.id === table.id) {
          if (this.userTables.length > 0) {
            await this.selectTable(this.userTables[0]);
          } else {
            this.currentTable = null;
            this.inventoryItems = [];
            this.filteredItems = [];
            this.updatePagination();
          }
        }
        
        this.showToast(`Table "${table.name}" deleted successfully`, 'success');
      } else {
        this.showToast('Failed to delete table', 'error');
      }
    } catch (err) {
      console.error('Failed to delete table', err);
      this.showToast('Error deleting table', 'error');
    }
  }

  // Updated Export Method
  async exportData() {
    if (!this.currentTable) {
      this.showToast('No table selected', 'info');
      return;
    }

    if (this.filteredItems.length === 0) {
      this.showToast('No data to export', 'info');
      return;
    }

    try {
      this.showToast('Preparing export with raw materials...', 'info');
      
      const fileName = `${this.currentTable.name.replace(/\s+/g, '_')}_inventory_with_materials_${new Date().toISOString().split('T')[0]}.xlsx`;
      
      // Create a new workbook
      const workbook = new ExcelJS.Workbook();
      workbook.creator = 'Inventory Management System';
      workbook.lastModifiedBy = 'Inventory Management System';
      workbook.created = new Date();
      workbook.modified = new Date();
      
      // Create worksheet
      const worksheet = workbook.addWorksheet('Inventory with Materials', {
        properties: {
          defaultColWidth: 15,
          showGridLines: true
        }
      });

      // Title
      worksheet.mergeCells('A1:J1');
      const titleRow = worksheet.getRow(1);
      titleRow.getCell(1).value = `INVENTORY WITH RAW MATERIALS - ${this.currentTable.name}`;
      titleRow.getCell(1).font = { name: 'Arial', size: 16, bold: true, color: { argb: 'FFFFFFFF' } };
      titleRow.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2C3E50' } };
      titleRow.getCell(1).alignment = { vertical: 'middle', horizontal: 'center' };
      titleRow.height = 30;

      // Generation info
      worksheet.mergeCells('A2:J2');
      const infoRow = worksheet.getRow(2);
      infoRow.getCell(1).value = `Generated on: ${new Date().toLocaleString()} | Total Items: ${this.filteredItems.length}`;
      infoRow.getCell(1).font = { name: 'Arial', size: 11, italic: true };
      infoRow.getCell(1).alignment = { vertical: 'middle', horizontal: 'center' };
      infoRow.height = 25;

      // Headers
      const headers = [
        'SKU Code',
        'Item Name',
        'Category',
        'Qty',
        'Supplier',
        'Materials',
        'Qty/Batch',
        'Unit',
        'Type',
        'Total'
      ];
      
      const headerRow = worksheet.addRow(headers);
      headerRow.eachCell((cell) => {
        cell.font = { name: 'Arial', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2980B9' } };
        cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
        cell.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' }
        };
      });
      headerRow.height = 30;

      // Add data rows with materials
      for (const item of this.filteredItems) {
        // Load materials if not already loaded
        if (!item.materials) {
          try {
            const materials = await this.db.getMaterialsForSku(item.sku_code);
            item.materials = materials || [];
            item.materialCount = item.materials?.length || 0;
          } catch (err) {
            console.error('Failed to load materials for export', err);
            item.materials = [];
          }
        }

        const materials = item.materials || [];

        if (materials.length === 0) {
          // SKU with no materials - single row
          const row = worksheet.addRow([
            item.sku_code,
            item.sku_name || item.sku_code,
            item.category,
            item.qty,
            item.supplier || '',
            'No materials',
            '',
            '',
            '',
            ''
          ]);
          styleDataRow(row);
          row.getCell(4).numFmt = '#,##0'; // Quantity
        } else {
          // SKU with materials - multiple rows
          for (let i = 0; i < materials.length; i++) {
            const mat = materials[i];
            const row = worksheet.addRow([
              i === 0 ? item.sku_code : '', // Only show SKU on first row of the group
              i === 0 ? (item.sku_name || item.sku_code) : '',
              i === 0 ? item.category : '',
              i === 0 ? item.qty : '',
              i === 0 ? (item.supplier || '') : '',
              mat.raw_material || '',
              mat.quantity_per_batch || '',
              mat.unit || '',
              mat.type || '',
              this.calculateMaterialTotal(item.qty, mat.quantity_per_batch)
            ]);
            styleDataRow(row);
            
            // Format number cells
            if (i === 0) {
              row.getCell(4).numFmt = '#,##0'; // Quantity
            }
            row.getCell(7).numFmt = '#,##0.00'; // Qty per batch
            row.getCell(10).numFmt = '#,##0.00'; // Total
          }
        }
        
        // Add empty row between SKUs for better readability
        worksheet.addRow([]);
      }

      // Helper function for styling data rows
      function styleDataRow(row: any) {
        row.eachCell((cell: any) => {
          cell.font = { name: 'Arial', size: 10 };
          cell.border = {
            top: { style: 'thin', color: { argb: 'FFBDC3C7' } },
            left: { style: 'thin', color: { argb: 'FFBDC3C7' } },
            bottom: { style: 'thin', color: { argb: 'FFBDC3C7' } },
            right: { style: 'thin', color: { argb: 'FFBDC3C7' } }
          };
        });
        
        // Center align certain columns
        [4, 7, 8, 9, 10].forEach(colIndex => {
          const cell = row.getCell(colIndex);
          if (cell.value) {
            cell.alignment = { vertical: 'middle', horizontal: 'center' };
          }
        });
        
        // Left align text columns
        [1, 2, 3, 5, 6].forEach(colIndex => {
          const cell = row.getCell(colIndex);
          if (cell.value) {
            cell.alignment = { vertical: 'middle', horizontal: 'left' };
          }
        });
      }

      // Auto-fit columns
      worksheet.columns.forEach((column, index) => {
        const widths = [18, 25, 15, 12, 20, 30, 15, 10, 15, 15];
        column.width = widths[index] || 15;
      });

      // Freeze header row
      worksheet.views = [
        { state: 'frozen', xSplit: 0, ySplit: 3, activeCell: 'A4' }
      ];

      // Generate Excel file
      const buffer = await workbook.xlsx.writeBuffer();
      
      // Create blob and download
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const link = document.createElement('a');
      const url = URL.createObjectURL(blob);
      
      link.setAttribute('href', url);
      link.setAttribute('download', fileName);
      link.style.visibility = 'hidden';
      
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      
      setTimeout(() => {
        URL.revokeObjectURL(url);
      }, 100);
      
      this.showToast(`Exported ${this.filteredItems.length} items with raw materials successfully`, 'success');
    } catch (err) {
      console.error('Export failed', err);
      this.showToast('Error exporting data: ' + (err instanceof Error ? err.message : 'Unknown error'), 'error');
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
    }, 5000);
  }

  hideSnackbar() {
    this.showSnackbar = false;
    if (this.snackbarTimeout) {
      clearTimeout(this.snackbarTimeout);
      this.snackbarTimeout = null;
    }
  }

  updatePagination() {
    this.totalPages = Math.max(1, Math.ceil(this.filteredItems.length / this.pageSize));
    this.paginatedItems = this.filteredItems.slice(
      (this.currentPage - 1) * this.pageSize,
      this.currentPage * this.pageSize
    );
  }

  nextPage() {
    if (this.currentPage < this.totalPages) {
      this.currentPage++;
      this.updatePagination();
    }
  }

  prevPage() {
    if (this.currentPage > 1) {
      this.currentPage--;
      this.updatePagination();
    }
  }

  onPageSizeChange() {
    this.currentPage = 1;
    this.updatePagination();
  }

  getPageNumbers(): number[] {
    const pages: number[] = [];
    const total = this.totalPages;
    const current = this.currentPage;
    const delta = 2;
    
    if (total <= 7) {
      for (let i = 1; i <= total; i++) {
        pages.push(i);
      }
    } else {
      pages.push(1);
      
      let start = Math.max(2, current - delta);
      let end = Math.min(total - 1, current + delta);
      
      if (start > 2) {
        pages.push(-1);
      }
      
      for (let i = start; i <= end; i++) {
        pages.push(i);
      }
      
      if (end < total - 1) {
        pages.push(-1);
      }
      
      pages.push(total);
    }
    
    return pages;
  }

  goToPage(page: number) {
    if (page >= 1 && page <= this.totalPages && page !== this.currentPage) {
      this.currentPage = page;
      this.updatePagination();
    }
  }

  getTypeClass(type: string): string {
    if (!type) return '';
    const typeMap: { [key: string]: string } = {
      'conductor': 'type-conductor',
      'housing': 'type-housing',
      'electronics': 'type-electronics',
      'textile': 'type-textile',
      'sewing': 'type-sewing',
      'base-material': 'type-base',
      'printing': 'type-printing',
      'chemical': 'type-chemical',
      'binder': 'type-binder'
    };
    return typeMap[type.toLowerCase()] || '';
  }

  async deleteItem(item: InventoryItem, event: Event) {
    event.stopPropagation();
    
    if (!this.currentTable) {
      this.showToast('No table selected', 'error');
      return;
    }

    if (confirm('Are you sure you want to delete this item?')) {
      try {
        const userId = this.auth.getUserId();
        if (!userId) {
          this.showToast('You must be logged in', 'error');
          return;
        }

        const success = await this.db.deleteInventoryItem(item.id, userId, this.currentTable.id);
        
        if (success) {
          this.inventoryItems = this.inventoryItems.filter(i => i.id !== item.id);
          this.applyFilter();
          
          const newCount = Math.max(0, (this.currentTable.item_count || 0) - 1);
          await this.db.updateTableItemCount(this.currentTable.id, newCount, userId);
          this.currentTable.item_count = newCount;
          
          await this.loadUserTables();
          
          this.showToast('Item deleted successfully', 'success');
        } else {
          this.showToast('Failed to delete item', 'error');
        }
      } catch (err) {
        console.error('Failed to delete item', err);
        this.showToast('Error deleting item', 'error');
      }
    }
  }
}