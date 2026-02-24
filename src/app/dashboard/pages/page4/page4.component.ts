import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DatabaseService } from '../../../core/services/database.service';
import { AuthService } from '../../../core/services/auth.service';
import { Firestore, doc, getDoc } from '@angular/fire/firestore';
import { Router } from '@angular/router';
import * as XLSX from 'xlsx';

interface UserTable {
  id: string;
  name: string;
  user_id: string;
  type: 'inventory' | 'requisition';
  item_count?: number;
  created_at?: string;
  updated_at?: string;
}

interface MaterialConsumption {
  material_name: string;
  material_type: string;
  unit: string;
  total_quantity: number;
  table_count: number;
  sku_count: number;
  tables: string[];
  skus: string[];
}

interface TypeBreakdown {
  type: string;
  material_count: number;
  total_quantity: number;
  percentage: number;
}

@Component({
  selector: 'app-page4',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './page4.component.html',
  styleUrls: ['./page4.component.css']
})
export class Page4Component implements OnInit {
  userTables: UserTable[] = [];
  selectedTableId: string = 'all';
  
  usageData: MaterialConsumption[] = [];
  filteredData: MaterialConsumption[] = [];
  paginatedData: MaterialConsumption[] = [];
  typeBreakdown: TypeBreakdown[] = [];
  
  isLoading: boolean = false;
  
  currentPage: number = 1;
  itemsPerPage: number = 10;
  totalPages: number = 1;
  
  sortField: string = 'total_quantity';
  sortAsc: boolean = false;
  
  totalMaterials: number = 0;
  totalQuantity: number = 0;
  totalTables: number = 0;
  
  showNotification: boolean = false;
  notificationMessage: string = '';
  notificationType: 'success' | 'error' | 'info' = 'info';
  private notificationTimeout: any;

  // User Role
  userRole: string = '';
  userId: string = '';

  constructor(
    private db: DatabaseService,
    private auth: AuthService,
    private firestore: Firestore,
    private router: Router
  ) {}

  get Math() {
    return Math;
  }

  async ngOnInit(): Promise<void> {
    const user = await this.auth.getCurrentUserPromise();
    if (user) {
      this.userId = user.uid;
      await this.loadUserRole();
      
      // Check if user has access to usage reports
      if (this.userRole !== 'production' && this.userRole !== 'admin') {
        this.showMessage('You do not have access to Usage Reports', 'error');
        this.router.navigate(['/dashboard']);
        return;
      }
      
      await this.loadUserTables();
      await this.loadUsageData();
    } else {
      this.showMessage('Please login to view usage reports', 'error');
      this.router.navigate(['/login']);
    }
  }

  async loadUserRole() {
    try {
      const userDoc = await getDoc(doc(this.firestore, 'users', this.userId));
      if (userDoc.exists()) {
        const data = userDoc.data() as any;
        this.userRole = data['role'] || 'user';
      }
    } catch (error) {
      console.error('Error loading user role:', error);
    }
  }

  async loadUserTables(): Promise<void> {
    try {
      const allTables = await this.db.getUserTables(this.userId);
      
      // For production role, filter to show only production-relevant tables
      // This assumes tables might have production in name or you have a convention
      if (this.userRole === 'production') {
        this.userTables = allTables.filter(table => 
          table.name?.toLowerCase().includes('production') || 
          table.name?.toLowerCase().includes('prod') ||
          table.name?.toLowerCase().includes('line') ||
          table.name?.toLowerCase().includes('batch')
        );
        
        // If no production-specific tables found, show all tables
        if (this.userTables.length === 0) {
          this.userTables = allTables;
        }
      } else {
        this.userTables = allTables;
      }
      
      console.log('Loaded user tables:', this.userTables);
    } catch (error) {
      console.error('Error loading user tables:', error);
      this.showMessage('Failed to load tables', 'error');
    }
  }

  async loadUsageData(): Promise<void> {
    this.isLoading = true;
    try {
      if (!this.userId) {
        this.showMessage('Please login to view usage reports', 'error');
        this.isLoading = false;
        return;
      }

      if (this.userTables.length === 0) {
        await this.loadUserTables();
      }

      console.log('Loading usage data for user:', this.userId, 'table:', this.selectedTableId);
      
      const materialMap = new Map<string, {
        material_name: string;
        material_type: string;
        unit: string;
        total_quantity: number;
        tables: Set<string>;
        skus: Set<string>;
      }>();

      // Process each table that belongs to the current user
      for (const table of this.userTables) {
        if (this.selectedTableId !== 'all' && table.id !== this.selectedTableId) {
          continue;
        }

        // Verify table belongs to current user
        if (table.user_id !== this.userId) {
          console.warn(`Table ${table.id} does not belong to user ${this.userId}, skipping`);
          continue;
        }

        // Get requisitions for this table with user verification
        const requisitions = await this.db.getTableRequisitions(table.id, this.userId);
        console.log(`Found ${requisitions.length} requisitions for table:`, table.name);
        
        for (const req of requisitions) {
          if (!req.sku_code) continue;
          
          // Verify requisition belongs to correct user
          if (req.user_id !== this.userId) continue;
          
          // Get materials for this SKU
          const materials = await this.db.getMaterialsForSku(req.sku_code);
          
          for (const material of materials) {
            if (!material.raw_material) continue;
            
            const quantityPerBatch = material.quantity_per_batch || 0;
            const totalRequired = quantityPerBatch * (req.qty_needed || 0);
            
            const key = `${material.raw_material}_${material.type || ''}_${material.unit || ''}`;
            const tableName = table.name || `Table ${table.id.substring(0, 8)}`;
            const skuInfo = `${req.sku_code} (Qty: ${req.qty_needed || 0})`;
            
            if (!materialMap.has(key)) {
              materialMap.set(key, {
                material_name: material.raw_material,
                material_type: material.type || this.determineMaterialType(material.raw_material),
                unit: material.unit || '',
                total_quantity: 0,
                tables: new Set<string>(),
                skus: new Set<string>()
              });
            }
            
            const materialData = materialMap.get(key)!;
            materialData.total_quantity += totalRequired;
            materialData.tables.add(tableName);
            materialData.skus.add(skuInfo);
          }
        }
      }

      console.log(`Created ${materialMap.size} unique material entries`);

      // Convert to array
      this.usageData = Array.from(materialMap.values()).map(item => ({
        material_name: item.material_name,
        material_type: item.material_type,
        unit: item.unit,
        total_quantity: item.total_quantity,
        table_count: item.tables.size,
        sku_count: item.skus.size,
        tables: Array.from(item.tables),
        skus: Array.from(item.skus)
      }));

      console.log('Processed usage data:', this.usageData);

      // Calculate totals
      this.totalMaterials = this.usageData.length;
      this.totalQuantity = this.usageData.reduce((sum, item) => sum + item.total_quantity, 0);
      this.totalTables = this.usageData.length > 0 
        ? new Set(this.usageData.flatMap(item => item.tables)).size 
        : 0;

      // Generate breakdown
      this.generateTypeBreakdown();
      
      // Apply sorting and pagination
      this.applySorting();
      this.updatePagination();
      
      this.showMessage(
        `Loaded ${this.usageData.length} materials from ${this.totalTables} tables`,
        'success'
      );
      
    } catch (error) {
      console.error('Error loading usage data:', error);
      this.showMessage('Failed to load usage data', 'error');
      this.filteredData = [];
      this.paginatedData = [];
    } finally {
      this.isLoading = false;
    }
  }

  private determineMaterialType(materialName: string): string {
    if (!materialName) return 'Other';
    
    const name = materialName.toLowerCase();
    
    if (name.includes('conductor') || name.includes('wire') || name.includes('cable')) {
      return 'Conductor';
    } else if (name.includes('housing') || name.includes('case') || name.includes('enclosure')) {
      return 'Housing';
    } else if (name.includes('electronic') || name.includes('pcb') || name.includes('circuit')) {
      return 'Electronics';
    } else if (name.includes('textile') || name.includes('fabric') || name.includes('cloth')) {
      return 'Textile';
    } else if (name.includes('sewing') || name.includes('thread') || name.includes('needle')) {
      return 'Sewing';
    } else if (name.includes('base') || name.includes('substrate') || name.includes('core')) {
      return 'Base Material';
    } else if (name.includes('printing') || name.includes('ink') || name.includes('print')) {
      return 'Printing';
    } else if (name.includes('chemical') || name.includes('adhesive') || name.includes('glue')) {
      return 'Chemical';
    } else if (name.includes('binder') || name.includes('binding')) {
      return 'Binder';
    }
    
    return 'Other';
  }

  private generateTypeBreakdown(): void {
    const typeMap = new Map<string, { material_count: number; total_quantity: number }>();

    for (const item of this.usageData) {
      const type = item.material_type || 'Other';
      
      if (!typeMap.has(type)) {
        typeMap.set(type, { material_count: 0, total_quantity: 0 });
      }
      
      const typeData = typeMap.get(type)!;
      typeData.material_count += 1;
      typeData.total_quantity += item.total_quantity;
    }

    this.typeBreakdown = Array.from(typeMap.entries()).map(([type, data]) => ({
      type,
      material_count: data.material_count,
      total_quantity: data.total_quantity,
      percentage: this.totalQuantity > 0 ? (data.total_quantity / this.totalQuantity) * 100 : 0
    })).sort((a, b) => b.total_quantity - a.total_quantity);
  }

  sortData(field: string): void {
    if (this.sortField === field) {
      this.sortAsc = !this.sortAsc;
    } else {
      this.sortField = field;
      this.sortAsc = true;
    }
    
    this.applySorting();
    this.updatePagination();
  }

  private applySorting(): void {
    this.filteredData = [...this.usageData].sort((a: any, b: any) => {
      let aVal = a[this.sortField];
      let bVal = b[this.sortField];
      
      if (typeof aVal === 'string' && typeof bVal === 'string') {
        aVal = aVal.toLowerCase();
        bVal = bVal.toLowerCase();
      }
      
      if (aVal < bVal) return this.sortAsc ? -1 : 1;
      if (aVal > bVal) return this.sortAsc ? 1 : -1;
      return 0;
    });
  }

  private updatePagination(): void {
    if (!this.filteredData) {
      this.filteredData = [];
    }
    
    this.totalPages = Math.ceil(this.filteredData.length / this.itemsPerPage) || 1;
    this.currentPage = Math.min(this.currentPage, this.totalPages) || 1;
    
    const start = (this.currentPage - 1) * this.itemsPerPage;
    const end = start + this.itemsPerPage;
    this.paginatedData = this.filteredData.slice(start, end);
  }

  /**
   * Generate page numbers for pagination display
   * Shows: 1, 2, ..., current-1, current, current+1, ..., last-1, last
   * With ellipsis (...) for gaps
   */
  getPageNumbers(): number[] {
    const pages: number[] = [];
    const total = this.totalPages || 1;
    const current = this.currentPage || 1;
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

  /**
   * Navigate to specific page
   */
  goToPage(page: number): void {
    if (page >= 1 && page <= this.totalPages && page !== this.currentPage) {
      this.currentPage = page;
      this.updatePagination();
    }
  }

  previousPage(): void {
    if (this.currentPage > 1) {
      this.currentPage--;
      this.updatePagination();
    }
  }

  nextPage(): void {
    if (this.currentPage < this.totalPages) {
      this.currentPage++;
      this.updatePagination();
    }
  }

  onPageSizeChange(): void {
    this.currentPage = 1;
    this.updatePagination();
  }

  getTypeClass(type: string): string {
    const lowerType = (type || '').toLowerCase();
    
    if (lowerType.includes('conductor')) {
      return 'meat-veg';
    } else if (lowerType.includes('housing')) {
      return 'spice';
    } else if (lowerType.includes('electronic')) {
      return 'packaging';
    } else if (lowerType.includes('textile')) {
      return 'liquid';
    } else if (lowerType.includes('sewing')) {
      return 'meat-veg';
    } else if (lowerType.includes('base')) {
      return 'spice';
    } else if (lowerType.includes('printing')) {
      return 'packaging';
    } else if (lowerType.includes('chemical')) {
      return 'liquid';
    } else if (lowerType.includes('binder')) {
      return 'spice';
    }
    return 'other';
  }

  // Production-specific export
  async exportProductionPlan(): Promise<void> {
    if (this.usageData.length === 0) {
      this.showMessage('No data to export', 'error');
      return;
    }

    try {
      this.showMessage('Generating production plan...', 'info');
      
      // Create a production-focused report
      const workbook = XLSX.utils.book_new();
      
      // Production Requirements Sheet
      const mainData: any[][] = [
        ['PRODUCTION MATERIAL REQUIREMENTS'],
        ['Generated', new Date().toLocaleString()],
        ['Plant/Line', this.selectedTableId === 'all' ? 'All Production Lines' : 
          this.userTables.find(t => t.id === this.selectedTableId)?.name || 'Selected Line'],
        ['Production Manager', this.userRole],
        ['Date Range', 'Current Requirements'],
        ['Total Materials', this.totalMaterials.toString()],
        ['Total Required', this.totalQuantity.toFixed(2)],
        [],
        ['Material', 'Type', 'Unit', 'Required Qty', 'Production Lines', 'SKUs']
      ];

      this.usageData.forEach(item => {
        mainData.push([
          item.material_name,
          item.material_type,
          item.unit,
          item.total_quantity.toFixed(2),
          item.tables.join(', '),
          item.skus.join('; ')
        ]);
      });

      const mainSheet = XLSX.utils.aoa_to_sheet(mainData);
      
      // Set column widths
      mainSheet['!cols'] = [
        { wch: 30 }, // Material
        { wch: 20 }, // Type
        { wch: 10 }, // Unit
        { wch: 15 }, // Required Qty
        { wch: 40 }, // Production Lines
        { wch: 50 }  // SKUs
      ];
      
      XLSX.utils.book_append_sheet(workbook, mainSheet, 'Production Requirements');

      // Production Schedule Summary
      const scheduleData: any[][] = [
        ['PRODUCTION SCHEDULE SUMMARY'],
        ['Generated', new Date().toLocaleString()],
        [],
        ['Line/Table', 'Materials Count', 'Total Quantity']
      ];

      // Group by table/line
      const tableMap = new Map<string, { materials: Set<string>, totalQty: number }>();
      this.usageData.forEach(item => {
        item.tables.forEach(table => {
          if (!tableMap.has(table)) {
            tableMap.set(table, { materials: new Set(), totalQty: 0 });
          }
          const tableData = tableMap.get(table)!;
          tableData.materials.add(item.material_name);
          tableData.totalQty += item.total_quantity;
        });
      });

      tableMap.forEach((data, table) => {
        scheduleData.push([
          table,
          data.materials.size.toString(),
          data.totalQty.toFixed(2)
        ]);
      });

      const scheduleSheet = XLSX.utils.aoa_to_sheet(scheduleData);
      scheduleSheet['!cols'] = [
        { wch: 30 },
        { wch: 15 },
        { wch: 15 }
      ];
      
      XLSX.utils.book_append_sheet(workbook, scheduleSheet, 'Production Schedule');

      // Generate filename and save
      const tableName = this.selectedTableId === 'all' ? 'AllLines' : 
        (this.userTables.find(t => t.id === this.selectedTableId)?.name?.replace(/\s+/g, '_') || 'Production');
      const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      const fileName = `Production_Plan_${tableName}_${dateStr}.xlsx`;

      XLSX.writeFile(workbook, fileName);
      this.showMessage('Production plan exported successfully!', 'success');
    } catch (error) {
      console.error('Error exporting production plan:', error);
      this.showMessage('Failed to export production plan', 'error');
    }
  }

  async exportToExcel(): Promise<void> {
    if (this.usageData.length === 0) {
      this.showMessage('No data to export', 'error');
      return;
    }

    try {
      const workbook = XLSX.utils.book_new();
      
      // Main data sheet
      const mainData: any[][] = [
        ['Raw Material Usage Report'],
        ['Generated', new Date().toLocaleString()],
        ['User', this.auth.getUserEmail() || this.userId],
        ['Role', this.userRole],
        ['Table Filter', this.selectedTableId === 'all' ? 'All Tables' : 
          this.userTables.find(t => t.id === this.selectedTableId)?.name || this.selectedTableId],
        ['Total Materials', this.totalMaterials.toString()],
        ['Total Quantity', this.totalQuantity.toFixed(2)],
        ['Total Tables', this.totalTables.toString()],
        [],
        ['Raw Material', 'Type', 'Unit', 'Total Required', 'Tables Used', 'SKUs Used In']
      ];

      this.usageData.forEach(item => {
        mainData.push([
          item.material_name,
          item.material_type,
          item.unit,
          item.total_quantity.toFixed(2),
          item.table_count.toString(),
          item.sku_count.toString()
        ]);
      });

      const mainSheet = XLSX.utils.aoa_to_sheet(mainData);
      
      const colWidths = [
        { wch: 30 },
        { wch: 20 },
        { wch: 10 },
        { wch: 15 },
        { wch: 12 },
        { wch: 12 }
      ];
      mainSheet['!cols'] = colWidths;
      
      XLSX.utils.book_append_sheet(workbook, mainSheet, 'Usage Report');

      // Type breakdown sheet
      const breakdownData: any[][] = [
        ['Material Type Breakdown'],
        ['Generated', new Date().toLocaleString()],
        ['User', this.auth.getUserEmail() || this.userId],
        [],
        ['Type', 'Material Count', 'Total Quantity', 'Percentage']
      ];

      this.typeBreakdown.forEach(item => {
        breakdownData.push([
          item.type,
          item.material_count.toString(),
          item.total_quantity.toFixed(2),
          `${item.percentage.toFixed(1)}%`
        ]);
      });

      const breakdownSheet = XLSX.utils.aoa_to_sheet(breakdownData);
      
      breakdownSheet['!cols'] = [
        { wch: 25 },
        { wch: 15 },
        { wch: 15 },
        { wch: 15 }
      ];
      
      XLSX.utils.book_append_sheet(workbook, breakdownSheet, 'Type Breakdown');

      // Generate filename and save
      const tableName = this.selectedTableId === 'all' ? 'AllTables' : 
        (this.userTables.find(t => t.id === this.selectedTableId)?.name?.replace(/\s+/g, '_') || this.selectedTableId);
      const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      const fileName = `Material_Usage_${tableName}_${dateStr}.xlsx`;

      XLSX.writeFile(workbook, fileName);
      this.showMessage('Report exported successfully!', 'success');
    } catch (error) {
      console.error('Error exporting to Excel:', error);
      this.showMessage('Failed to export report', 'error');
    }
  }

  private showMessage(message: string, type: 'success' | 'error' | 'info' = 'info'): void {
    if (this.notificationTimeout) clearTimeout(this.notificationTimeout);
    this.notificationMessage = message;
    this.notificationType = type;
    this.showNotification = true;
    
    this.notificationTimeout = setTimeout(() => {
      this.hideNotification();
    }, 3000);
  }

  hideNotification(): void {
    this.showNotification = false;
    if (this.notificationTimeout) clearTimeout(this.notificationTimeout);
  }

  getNotificationIcon(): string {
    switch (this.notificationType) {
      case 'success': return '✓';
      case 'error': return '✕';
      case 'info': 
      default: return 'ⓘ';
    }
  }
}