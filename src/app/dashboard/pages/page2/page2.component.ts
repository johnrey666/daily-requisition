import { Component, OnInit, ElementRef, ViewChild, HostListener, ChangeDetectorRef } from '@angular/core';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule, FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { Observable } from 'rxjs';
import * as XLSX from 'xlsx';
import { DatabaseService } from '../../../core/services/database.service';
import { User } from '../../../core/models/database.model';
import { AuthService } from '../../../core/services/auth.service';

@Component({
  selector: 'app-page2',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, FormsModule],
  templateUrl: './page2.component.html',
  styleUrls: ['./page2.component.css']
})
export class Page2Component implements OnInit {
  @ViewChild('masterFileInput') masterFileInput!: ElementRef;

  requisitionForm: FormGroup;

  masterData: any[] = [];
  requisitionItems: any[] = [];
  filteredItems: any[] = [];
  categories: string[] = [];
  skus: { name: string; code: string }[] = [];

  uploadedFileName: string = '';
  searchQuery: string = '';
  currentPage: number = 1;
  itemsPerPage: number = 8;
  totalPages: number = 1;
  expandedRows: Set<string> = new Set();
  isExportDropdownOpen: boolean = false;

  sortField: string = '';
  sortAsc: boolean = true;

  typeMapping = {
    'meat-veg': ['raw', 'meat', 'chicken', 'pork', 'beef', 'fish', 'veggies', 'vegetables', 'vegetable', 'veg'],
    'pre-mix': ['pre-mix', 'premix'],
    'packaging': ['packaging']
  };

  filteredMaterials: Map<string, any[]> = new Map();

  userTables: any[] = [];
  selectedTableId: string = '';
  currentTable: any = null;

  showSnackbar: boolean = false;
  snackbarMessage: string = '';
  snackbarType: 'success' | 'error' | 'info' | 'warning' = 'info';
  snackbarDuration: number = 4000;
  private snackbarTimeout: any;

  currentUser$: Observable<any>;
  private currentUser: User | null = null;

  constructor(
    private fb: FormBuilder,
    private router: Router,
    private cdRef: ChangeDetectorRef,
    private dbService: DatabaseService,
    private authService: AuthService
  ) {
    this.requisitionForm = this.fb.group({
      category: ['', Validators.required],
      sku: ['', Validators.required],
      skuCode: [{ value: '', disabled: true }],
      qtyNeeded: [1, [Validators.required, Validators.min(1), Validators.max(99)]],
      supplier: ['', Validators.required]
    });

    this.currentUser$ = this.authService.user$;
  }

  async ngOnInit(): Promise<void> {
    // Get current user
    await this.initializeUser();
    
    if (!this.currentUser) {
      this.router.navigate(['/login']);
      return;
    }

    // Load master data from localStorage (user-specific)
    await this.loadFromLocalStorage();
    
    // Load master data from Firebase
    await this.loadMasterDataFromDatabase();
    
    // Load user tables from Firebase
    await this.loadUserTables();
    
    // Load requisitions for all tables
    await this.loadAllRequisitionsForUser();
    
    // Initialize UI
    this.filterAndPaginate();
    
    setTimeout(() => {
      this.cdRef.detectChanges();
    }, 0);
  }

  private async initializeUser(): Promise<void> {
    try {
      this.currentUser = await this.dbService.getCurrentUser();
      if (!this.currentUser) {
        console.error('No authenticated user found');
        this.showSnackbarMessage('Please log in to continue', 'error');
      }
    } catch (error) {
      console.error('Error initializing user:', error);
      this.showSnackbarMessage('Authentication error', 'error');
    }
  }

  @HostListener('document:click', ['$event'])
  clickOutside(event: Event): void {
    if (!(event.target as HTMLElement).closest('.dropdown')) {
      this.isExportDropdownOpen = false;
    }
  }

  async onFileUpload(event: any): Promise<void> {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();

    reader.onload = async (e: any) => {
      try {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' }) as any[][];

        if (rows.length < 2) {
          this.showSnackbarMessage('File has no data rows.', 'error');
          return;
        }

        const headerRow = rows[0].map((h: any) => h.toString().trim().toLowerCase());
        const col = this.mapColumns(headerRow);

        let currentSku = { code: '', name: '', category: '', quantity_per_unit: '', unit: '', quantity_per_pack: '', pack_unit: '' };
        const formattedData = [];

        for (let i = 1; i < rows.length; i++) {
          const r = rows[i];

          const rawMaterial = (r[col.raw] || '').toString().trim();

          if (rawMaterial) {
            const category = currentSku.category || (r[col.category] || '').toString().trim() || null;
            
            formattedData.push({
              'CATEGORY': category,
              'SKU CODE': currentSku.code || (r[col.skuCode] || '').toString().trim(),
              'SKU': currentSku.name || (r[col.skuName] || '').toString().trim(),
              'QUANTITY PER UNIT': currentSku.quantity_per_unit || (r[col.qtyPerUnit] || '').toString().trim(),
              'UNIT': currentSku.unit || (r[col.unit] || '').toString().trim(),
              'QUANTITY PER PACK': currentSku.quantity_per_pack || (r[col.qtyPerPack] || '').toString().trim(),
              'UNIT2': currentSku.pack_unit || (r[col.unit2] || '').toString().trim(),
              'RAW MATERIAL': rawMaterial,
              'QUANTITY/BATCH': (r[col.qtyBatch] || '').toString().trim(),
              'UNIT4': (r[col.unit4] || '').toString().trim(),
              'TYPE': (r[col.type] || '').toString().trim() || 'Other'
            });
          } else {
            currentSku = {
              code: (r[col.skuCode] || '').toString().trim(),
              name: (r[col.skuName] || '').toString().trim(),
              category: (r[col.category] || '').toString().trim(),
              quantity_per_unit: (r[col.qtyPerUnit] || '').toString().trim(),
              unit: (r[col.unit] || '').toString().trim(),
              quantity_per_pack: (r[col.qtyPerPack] || '').toString().trim(),
              pack_unit: (r[col.unit2] || '').toString().trim()
            };
          }
        }

        const validData = formattedData.filter(item => 
          item['SKU CODE'] && 
          item['SKU'] && 
          item['RAW MATERIAL'] && 
          item['QUANTITY/BATCH'] && 
          item['UNIT4']
        );

        if (validData.length === 0) {
          this.showSnackbarMessage('No valid data found in the file.', 'error');
          return;
        }

        // Save to Firebase
        await this.uploadMasterDataToDatabase(validData);
        
        // Update local master data
        this.masterData = [...this.masterData, ...validData];
        this.uploadedFileName = file.name;
        
        await this.saveToLocalStorage();
        this.populateCategories();
        
        this.showSnackbarMessage(`Master file loaded! (${validData.length} items)`, 'success');

      } catch (error: any) {
        this.showSnackbarMessage(`Upload failed: ${error.message}`, 'error');
      }
    };

    reader.onerror = () => {
      this.showSnackbarMessage('Failed to read file.', 'error');
    };

    reader.readAsArrayBuffer(file);
  }

  private async uploadMasterDataToDatabase(data: any[]): Promise<void> {
    try {
      const result = await this.dbService.uploadMasterData(data);
      if (!result.success) {
        console.error('Failed to upload master data to Firebase:', result.error);
        this.showSnackbarMessage('Failed to save master data to database', 'warning');
      }
    } catch (error) {
      console.error('Error uploading master data to Firebase:', error);
    }
  }

  private async loadMasterDataFromDatabase(): Promise<void> {
    try {
      const dbMasterData = await this.dbService.getMasterData();
      
      if (dbMasterData && dbMasterData.length > 0) {
        const convertedData = dbMasterData.map(item => ({
          'CATEGORY': item.category,
          'SKU CODE': item.sku_code,
          'SKU': item.sku_name,
          'QUANTITY PER UNIT': item.quantity_per_unit,
          'UNIT': item.unit,
          'QUANTITY PER PACK': item.quantity_per_pack,
          'UNIT2': item.pack_unit,
          'RAW MATERIAL': item.raw_material,
          'QUANTITY/BATCH': item.quantity_per_batch,
          'UNIT4': item.batch_unit,
          'TYPE': item.type
        }));
        
        const existingKeys = new Set(this.masterData.map(item => 
          `${item['SKU CODE']}|${item['RAW MATERIAL']}`
        ));
        
        const newItems = convertedData.filter(item => {
          const key = `${item['SKU CODE']}|${item['RAW MATERIAL']}`;
          return !existingKeys.has(key);
        });
        
        if (newItems.length > 0) {
          this.masterData = [...this.masterData, ...newItems];
          this.populateCategories();
          this.showSnackbarMessage(`Loaded ${newItems.length} items from database`, 'info');
        }
      }
    } catch (error) {
      console.error('Error loading master data from Firebase:', error);
    }
  }

  private mapColumns(headerRow: string[]): any {
    const headers = headerRow.map(h => h.toLowerCase());

    return {
      category: headers.findIndex(h => h === 'category'),
      skuCode: headers.findIndex(h => h === 'sku code'),
      skuName: headers.findIndex(h => h === 'sku'),
      qtyPerUnit: headers.findIndex(h => h === 'quantity per unit'),
      unit: headers.findIndex(h => h === 'unit'),
      qtyPerPack: headers.findIndex(h => h === 'quantity per pack'),
      unit2: headers.findIndex(h => h === 'unit2'),
      raw: headers.findIndex(h => h === 'raw material'),
      qtyBatch: headers.findIndex(h => h === 'quantity/batch'),
      unit4: headers.findIndex(h => h === 'unit4'),
      type: headers.findIndex(h => h === 'type')
    };
  }

  populateCategories(): void {
    const categoriesWithValues = this.masterData
      .map(r => r['CATEGORY'])
      .filter(category => category && typeof category === 'string' && category.trim())
      .map(category => category as string);

    const hasUncategorizedSkus = this.masterData.some(r => 
      !r['CATEGORY'] || r['CATEGORY'].trim() === ''
    );

    this.categories = [...new Set(categoriesWithValues)].sort();
    
    if (hasUncategorizedSkus) {
      this.categories.push('Uncategorized');
    }
    
    this.cdRef.detectChanges();
  }

  onCategoryChange(): void {
    const category = this.requisitionForm.get('category')?.value;

    this.skus = [];
    this.requisitionForm.get('sku')?.setValue('');
    this.requisitionForm.get('skuCode')?.setValue('');

    if (!category) return;

    const uniqueSkusMap = new Map<string, { name: string; code: string }>();
    
    this.masterData.forEach(item => {
      const matchesCategory = category === 'Uncategorized' 
        ? (!item['CATEGORY'] || item['CATEGORY'].trim() === '')
        : item['CATEGORY'] === category;
      
      if (matchesCategory && item['SKU']) {
        const code = (item['SKU CODE'] || '').toString().trim();
        const name = item['SKU'].trim();
        if (name && !uniqueSkusMap.has(name)) {
          uniqueSkusMap.set(name, { name, code });
        }
      }
    });
    
    this.skus = Array.from(uniqueSkusMap.values())
      .sort((a, b) => a.name.localeCompare(b.name));
    
    this.cdRef.detectChanges();
  }

  onSkuChange(): void {
    const skuName = this.requisitionForm.get('sku')?.value;
    
    const selected = this.skus.find(s => s.name === skuName);
    if (selected) {
      this.requisitionForm.get('skuCode')?.enable();
      this.requisitionForm.get('skuCode')?.setValue(selected.code);
      this.requisitionForm.get('skuCode')?.disable();
    } else {
      this.requisitionForm.get('skuCode')?.enable();
      this.requisitionForm.get('skuCode')?.setValue('');
      this.requisitionForm.get('skuCode')?.disable();
    }
  }

  async addRequisition(): Promise<void> {
    if (!this.currentUser) {
      this.showSnackbarMessage('Please log in to add requisitions', 'error');
      return;
    }
    
    if (!this.selectedTableId) {
      this.showSnackbarMessage('Please select or create a table first', 'error');
      return;
    }
    
    if (this.requisitionForm.invalid) {
      this.showSnackbarMessage('Please fill all required fields', 'error');
      return;
    }

    const formValue = this.requisitionForm.value;
    const skuCodeToUse = formValue.skuCode;

    let skuRecords: any[] = [];
    
    if (skuCodeToUse) {
      skuRecords = this.masterData.filter(r => 
        (r['SKU CODE'] || '').toString().trim() === skuCodeToUse.toString().trim()
      );
    }

    if (skuRecords.length === 0 && formValue.sku) {
      skuRecords = this.masterData.filter(r => 
        (r['SKU'] || '').toString().trim().toLowerCase() === 
        (formValue.sku || '').toString().trim().toLowerCase()
      );
    }

    if (skuRecords.length === 0) {
      this.showSnackbarMessage('SKU not found in master data.', 'error');
      return;
    }

    const skuInfo = skuRecords[0];

    const materials = skuRecords
      .filter(r => r['RAW MATERIAL']?.trim() && r['QUANTITY/BATCH'])
      .map(r => ({
        name: r['RAW MATERIAL'].trim(),
        qty: parseFloat(r['QUANTITY/BATCH']) || 0,
        unit: r['UNIT4'] || '',
        type: r['TYPE'] || '',
        requiredQty: (parseFloat(r['QUANTITY/BATCH']) || 0) * formValue.qtyNeeded
      }));

    if (materials.length === 0) {
      this.showSnackbarMessage('No raw materials found for this SKU.', 'error');
      return;
    }

    const newItem = {
      id: this.generateId(),
      skuCode: skuInfo['SKU CODE']?.trim() || skuCodeToUse,
      skuName: formValue.sku || skuInfo['SKU'],
      category: formValue.category,
      qtyNeeded: formValue.qtyNeeded,
      supplier: formValue.supplier,
      qtyPerUnit: skuInfo['QUANTITY PER UNIT'] || '',
      unit: skuInfo['UNIT'] || '',
      qtyPerPack: skuInfo['QUANTITY PER PACK'] || '',
      unit2: skuInfo['UNIT2'] || '',
      materials: materials,
      tableId: this.selectedTableId,
      userId: this.currentUser.id,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    console.log('Adding new requisition item:', newItem);

    // Add to local array FIRST
    this.requisitionItems.push(newItem);
    
    // Save to Firebase
    const dbResult = await this.saveRequisitionToDatabase(newItem);
    
    if (dbResult.success && dbResult.requisitionId) {
      const itemIndex = this.requisitionItems.findIndex(i => i.id === newItem.id);
      if (itemIndex !== -1) {
        this.requisitionItems[itemIndex].dbId = dbResult.requisitionId;
        this.requisitionItems[itemIndex].id = dbResult.requisitionId;
      }
    } else {
      this.showSnackbarMessage('Failed to save to Firebase: ' + (dbResult.error?.message || 'Unknown error'), 'error');
      this.requisitionItems.pop();
      return;
    }
    
    await this.updateTableItemCount();
    await this.saveToLocalStorage();
    
    this.showSnackbarMessage(`${newItem.skuName} (${newItem.skuCode}) added!`, 'success');

    this.requisitionForm.reset({
      category: '',
      sku: '',
      skuCode: '',
      qtyNeeded: 1,
      supplier: ''
    });

    this.currentPage = Math.ceil(this.requisitionItems.length / this.itemsPerPage);
    this.filterAndPaginate();
    this.cdRef.detectChanges();
  }

  private async saveRequisitionToDatabase(item: any): Promise<{ success: boolean; requisitionId?: string; error?: any }> {
    try {
      if (!this.currentUser || !this.selectedTableId) {
        return { success: false, error: { message: 'No user or table selected' } };
      }

      console.log('Saving requisition to Firebase for user:', this.currentUser.id);

      const requisitionData = {
        user_id: this.currentUser.id,
        table_id: this.selectedTableId,
        sku_code: item.skuCode || '',
        sku_name: item.skuName || '',
        category: item.category || '',
        qty_needed: item.qtyNeeded || 1,
        supplier: item.supplier || '',
        qty_per_unit: item.qtyPerUnit || '',
        unit: item.unit || '',
        qty_per_pack: item.qtyPerPack || '',
        pack_unit: item.unit2 || '',
        status: 'draft',
        type: this.determineRequisitionType(item.category, item.skuName)
      };

      // Filter out materials with empty or missing names
      const validMaterials = item.materials.filter((m: any) => 
        m.name && m.name.toString().trim() !== ''
      );

      if (validMaterials.length === 0) {
        this.showSnackbarMessage('No valid raw materials found for this SKU.', 'error');
        return { success: false, error: { message: 'No valid materials' } };
      }

      const formattedMaterials = validMaterials.map((material: any) => ({
        name: material.name.toString().trim(),
        qty: Number(material.qty) || 0,
        unit: (material.unit || '').toString().trim() || 'kg',
        type: material.type || 'raw-material',
        required_qty: Number(material.requiredQty) || 0
      }));

      const result = await this.dbService.createRequisition(requisitionData, formattedMaterials);
      
      if (result.success) {
        console.log('Successfully saved to Firebase with ID:', result.requisitionId);
        return { success: true, requisitionId: result.requisitionId };
      } else {
        console.error('Failed to save requisition to Firebase:', result.error);
        this.showSnackbarMessage('Save failed: ' + (result.error?.message || 'Unknown error'), 'error');
        return { success: false, error: result.error };
      }
    } catch (error: any) {
      console.error('Error saving requisition to Firebase:', error);
      this.showSnackbarMessage('Database error: ' + (error.message || 'Unknown'), 'error');
      return { success: false, error };
    }
  }

  private determineRequisitionType(category: string, skuName: string): string {
    let type = 'raw-material';
    
    const categoryLower = (category || '').toLowerCase();
    const skuNameLower = (skuName || '').toLowerCase();
    
    if (categoryLower.includes('pre-mix') || categoryLower.includes('premix') || 
        skuNameLower.includes('pre-mix') || skuNameLower.includes('premix')) {
      type = 'pre-mix';
    } else if (categoryLower.includes('packaging') || skuNameLower.includes('packaging')) {
      type = 'packaging';
    } else if (categoryLower.includes('meat') || categoryLower.includes('chicken') || 
               categoryLower.includes('pork') || categoryLower.includes('beef') || 
               categoryLower.includes('fish') || skuNameLower.includes('meat') || 
               skuNameLower.includes('chicken') || skuNameLower.includes('pork') || 
               skuNameLower.includes('beef') || skuNameLower.includes('fish')) {
      type = 'meat';
    } else if (categoryLower.includes('veg') || categoryLower.includes('vegetable') || 
               skuNameLower.includes('veg') || skuNameLower.includes('vegetable')) {
      type = 'veg';
    } else if (categoryLower.includes('raw') || skuNameLower.includes('raw')) {
      type = 'raw-material';
    }
    
    return type;
  }

  async updateQty(itemId: string, qty: number): Promise<void> {
    if (qty < 1 || qty > 99) return;

    const item = this.requisitionItems.find(i => i.id === itemId);
    if (item) {
      item.qtyNeeded = qty;
      item.materials.forEach((m: any) => m.requiredQty = m.qty * qty);
      item.updatedAt = new Date().toISOString();

      if (item.dbId || item.id) {
        const requisitionId = item.dbId || item.id;
        const result = await this.dbService.updateRequisitionQty(requisitionId, qty);
        if (!result.success) {
          console.error('Failed to update requisition quantity in Firebase:', result.error);
        }
      }
      
      await this.saveToLocalStorage();
      this.filterAndPaginate();
    }
  }

  async updateSupplier(itemId: string, supplier: string): Promise<void> {
    const item = this.requisitionItems.find(i => i.id === itemId);
    if (item) {
      item.supplier = supplier;
      item.updatedAt = new Date().toISOString();

      if (item.dbId || item.id) {
        const requisitionId = item.dbId || item.id;
        const result = await this.dbService.updateRequisitionSupplier(requisitionId, supplier);
        if (!result.success) {
          console.error('Failed to update supplier in Firebase:', result.error);
        }
      }
      
      await this.saveToLocalStorage();
    }
  }

  async deleteItem(itemId: string): Promise<void> {
    if (confirm('Are you sure you want to delete this item?')) {
      const index = this.requisitionItems.findIndex(i => i.id === itemId);
      if (index !== -1) {
        const removedItem = this.requisitionItems[index];
        const removedName = removedItem.skuName;
        
        if (removedItem.dbId || removedItem.id) {
          const requisitionId = removedItem.dbId || removedItem.id;
          const result = await this.dbService.deleteRequisition(requisitionId);
          if (!result.success) {
            console.error('Failed to delete requisition from Firebase:', result.error);
            this.showSnackbarMessage('Failed to delete from database: ' + (result.error?.message || 'Unknown error'), 'error');
            return;
          }
        }
        
        this.requisitionItems.splice(index, 1);
        await this.updateTableItemCount();
        await this.saveToLocalStorage();
        this.filterAndPaginate();
        this.showSnackbarMessage(`${removedName} removed`, 'success');
      }
    }
  }

  toggleRow(itemId: string): void {
    if (this.expandedRows.has(itemId)) {
      this.expandedRows.delete(itemId);
      this.filteredMaterials.delete(itemId);
    } else {
      this.expandedRows.add(itemId);
      const item = this.requisitionItems.find(i => i.id === itemId);
      if (item) {
        this.filteredMaterials.set(itemId, [...item.materials]);
      }
    }
  }

  filterMaterials(itemId: string, filterType: string): void {
    const item = this.requisitionItems.find(i => i.id === itemId);
    if (!item) return;

    if (!filterType) {
      this.filteredMaterials.set(itemId, [...item.materials]);
    } else {
      const filtered = item.materials.filter((m: any) => {
        const type = (m.type || '').toLowerCase().trim();
        return this.typeMapping[filterType as keyof typeof this.typeMapping]?.some(k => type.includes(k)) || false;
      });
      this.filteredMaterials.set(itemId, filtered);
    }
    this.cdRef.detectChanges();
  }

  getFilteredMaterials(itemId: string, allMaterials: any[]): any[] {
    return this.filteredMaterials.get(itemId) || allMaterials;
  }

  filterAndPaginate(): void {
    if (!this.currentUser) {
      this.filteredItems = [];
      return;
    }

    let filtered = [...this.requisitionItems];

    filtered = filtered.filter(i => i.userId === this.currentUser?.id);

    if (this.selectedTableId) {
      filtered = filtered.filter(i => i.tableId === this.selectedTableId);
    }

    if (this.searchQuery) {
      const q = this.searchQuery.toLowerCase();
      filtered = filtered.filter(i =>
        i.skuCode.toLowerCase().includes(q) ||
        i.skuName.toLowerCase().includes(q) ||
        (i.category && i.category.toLowerCase().includes(q))
      );
    }

    if (this.sortField) {
      filtered.sort((a: any, b: any) => {
        const aVal = a[this.sortField] || '';
        const bVal = b[this.sortField] || '';
        return aVal.toString().localeCompare(bVal.toString()) * (this.sortAsc ? 1 : -1);
      });
    }

    this.totalPages = Math.ceil(filtered.length / this.itemsPerPage);
    this.currentPage = Math.min(this.currentPage, this.totalPages || 1);

    const start = (this.currentPage - 1) * this.itemsPerPage;
    this.filteredItems = filtered.slice(start, start + this.itemsPerPage);
    this.cdRef.detectChanges();
  }

  onSearch(): void {
    this.currentPage = 1;
    this.filterAndPaginate();
  }

  sortBy(field: string): void {
    if (this.sortField === field) this.sortAsc = !this.sortAsc;
    else { this.sortField = field; this.sortAsc = true; }
    this.filterAndPaginate();
  }

  changePage(dir: number): void {
    const newPage = this.currentPage + dir;
    if (newPage >= 1 && newPage <= this.totalPages) {
      this.currentPage = newPage;
      this.filterAndPaginate();
    }
  }

  toggleExportDropdown(): void {
    this.isExportDropdownOpen = !this.isExportDropdownOpen;
  }

  printTable(): void {
    if (!this.currentUser) {
      this.showSnackbarMessage('Please log in to print', 'error');
      return;
    }

    const userItems = this.requisitionItems.filter(i => i.userId === this.currentUser?.id);
    
    if (userItems.length === 0) {
      this.showSnackbarMessage('No data to print.', 'error');
      return;
    }

    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      this.showSnackbarMessage('Please allow popups to print', 'error');
      return;
    }

    const title = this.currentTable?.name || 'Requisition Items';
    const date = new Date().toLocaleString('en-PH');
    const userName = this.currentUser?.full_name || this.currentUser?.username || this.currentUser?.email || 'User';
    
    let printContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Print: ${title}</title>
        <style>
          body { font-family: Arial, sans-serif; font-size: 12px; margin: 20px; }
          .print-header { margin-bottom: 20px; }
          .print-title { font-size: 18px; font-weight: bold; margin-bottom: 5px; }
          .print-info { color: #666; margin-bottom: 10px; }
          .user-info { margin-bottom: 10px; }
          table { width: 100%; border-collapse: collapse; margin-top: 10px; }
          th { background: #f5f5f5; font-weight: bold; padding: 8px; border: 1px solid #ddd; text-align: left; }
          td { padding: 8px; border: 1px solid #ddd; }
          .badge { background: #e9ecef; padding: 2px 6px; border-radius: 10px; font-size: 10px; }
          @media print {
            @page { margin: 0.5cm; }
            body { margin: 0; }
          }
        </style>
      </head>
      <body>
        <div class="print-header">
          <div class="print-title">${title}</div>
          <div class="user-info">
            <strong>User:</strong> ${userName}
          </div>
          <div class="print-info">
            Generated: ${date} | 
            Items: ${userItems.length} | 
            File: ${this.uploadedFileName || 'No file'}
          </div>
        </div>
        <table>
          <thead>
            <tr>
              <th>SKU Code</th>
              <th>SKU</th>
              <th>Category</th>
              <th>Qty</th>
              <th>Supplier</th>
              <th>Raw Material</th>
              <th>Qty/Batch</th>
              <th>Unit</th>
              <th>Type</th>
              <th>Total Required</th>
            </tr>
          </thead>
          <tbody>
    `;

    userItems.forEach(item => {
      if (!item.materials?.length) return;

      item.materials.forEach((m: any, index: number) => {
        printContent += `
          <tr>
            <td>${index === 0 ? item.skuCode : ''}</td>
            <td>${index === 0 ? item.skuName : ''}</td>
            <td>${index === 0 ? (item.category || '') : ''}</td>
            <td>${index === 0 ? item.qtyNeeded : ''}</td>
            <td>${index === 0 ? (item.supplier || '') : ''}</td>
            <td>${m.name}</td>
            <td>${m.qty}</td>
            <td>${m.unit || '-'}</td>
            <td><span class="badge">${m.type || 'N/A'}</span></td>
            <td><strong>${m.requiredQty} ${m.unit || ''}</strong></td>
          </tr>
        `;
      });
    });

    printContent += `
          </tbody>
        </table>
      </body>
      </html>
    `;

    printWindow.document.write(printContent);
    printWindow.document.close();
    
    setTimeout(() => {
      printWindow.print();
      printWindow.close();
    }, 500);
  }

  exportData(type: string = 'all'): void {
    if (!this.currentUser) {
      this.showSnackbarMessage('Please log in to export', 'error');
      return;
    }
    
    this.isExportDropdownOpen = false;

    const userItems = this.requisitionItems.filter(i => i.userId === this.currentUser?.id);
    
    if (userItems.length === 0) {
      this.showSnackbarMessage('No data to export.', 'error');
      return;
    }

    const userName = this.currentUser?.full_name || this.currentUser?.username || this.currentUser?.email || 'User';
    
    const data = [
      ['RAW MATERIAL REQUISITION'],
      ['Generated', new Date().toLocaleString('en-PH')],
      ['User', userName],
      ['Master File', this.uploadedFileName || 'None'],
      ['Table', this.currentTable?.name || 'No table'],
      ['Export Type', this.getExportTypeDisplayName(type)],
      [''],
      ['SKU Code', 'SKU', 'Category', 'Qty Needed', 'Supplier', 'Raw Material', 'Qty/Batch', 'Unit', 'Type', 'Total Required']
    ];

    userItems.forEach(item => {
      if (!item.materials?.length) return;

      let materialsToExport = item.materials;
      if (type !== 'all') {
        materialsToExport = item.materials.filter((m: any) =>
          this.mapTypeToFilter(m.type) === type
        );
      }

      if (materialsToExport.length === 0) return;

      materialsToExport.forEach((m: any, index: number) => {
        const row: string[] = [
          index === 0 ? item.skuCode : '',
          index === 0 ? item.skuName : '',
          index === 0 ? (item.category || '') : '',
          index === 0 ? item.qtyNeeded.toString() : '',
          index === 0 ? item.supplier || '' : '',
          m.name,
          m.qty.toString(),
          m.unit || '',
          m.type || '',
          m.requiredQty.toString()
        ];

        data.push(row);
      });
    });

    const ws = XLSX.utils.aoa_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Requisition');

    const fileName = `${userName}_Requisition_${this.currentTable?.name?.replace(/\s+/g, '_') || 'Table'}_${
      type === 'all' ? 'All' :
      this.getExportTypeDisplayName(type).replace(/&/g, 'and').replace(/\s+/g, '')
    }_${new Date().toISOString().slice(0, 10).replace(/-/g, '')}.xlsx`;

    XLSX.writeFile(wb, fileName);
    this.showSnackbarMessage(`Exported ${this.getExportTypeDisplayName(type).toLowerCase()} successfully!`, 'success');
  }

  private mapTypeToFilter(type: string): string {
    if (!type) return '';
    const lowerType = type.toLowerCase().trim();

    for (const [filterType, keywords] of Object.entries(this.typeMapping)) {
      if (keywords.some(keyword => lowerType.includes(keyword))) {
        return filterType;
      }
    }
    return '';
  }

  private getExportTypeDisplayName(exportType: string): string {
    switch (exportType) {
      case 'all': return 'All Data';
      case 'pre-mix': return 'Pre-mix Only';
      case 'packaging': return 'Packaging Only';
      case 'meat-veg': return 'Meat & Vegetables Only';
      default: return exportType;
    }
  }

  getCurrentPageEnd(): number {
    return Math.min(this.currentPage * this.itemsPerPage, this.requisitionItems.length);
  }

  async clearAll(): Promise<void> {
    if (!this.currentUser) {
      this.showSnackbarMessage('Please log in to clear table', 'error');
      return;
    }
    
    if (!this.selectedTableId) {
      this.showSnackbarMessage('Please select a table first', 'error');
      return;
    }
    
    if (confirm('Clear all items from this table? This action cannot be undone.')) {
      const itemsToDelete = this.requisitionItems.filter(i => 
        i.tableId === this.selectedTableId && i.userId === this.currentUser?.id
      );
      
      for (const item of itemsToDelete) {
        if (item.dbId || item.id) {
          const requisitionId = item.dbId || item.id;
          await this.dbService.deleteRequisition(requisitionId);
        }
      }
      
      this.requisitionItems = this.requisitionItems.filter(i => 
        i.tableId !== this.selectedTableId || i.userId !== this.currentUser?.id
      );
      
      this.searchQuery = '';
      this.currentPage = 1;
      
      await this.updateTableItemCount();
      await this.saveToLocalStorage();
      this.filterAndPaginate();
      this.showSnackbarMessage('Table cleared successfully!', 'success');
    }
  }

  clearFile(): void {
    if (confirm('Clear uploaded master file?')) {
      this.masterData = [];
      this.uploadedFileName = '';
      this.categories = [];
      this.skus = [];
      this.requisitionForm.reset({
        qtyNeeded: 1,
        supplier: ''
      });
      
      this.saveToLocalStorage();
      this.showSnackbarMessage('Master file cleared', 'info');
    }
  }

  private generateId(): string {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
  }

  private showSnackbarMessage(message: string, type: 'success' | 'error' | 'info' | 'warning' = 'info', duration?: number): void {
    if (this.snackbarTimeout) clearTimeout(this.snackbarTimeout);
    this.snackbarMessage = message;
    this.snackbarType = type;
    this.snackbarDuration = duration || 4000;
    this.showSnackbar = true;
    this.snackbarTimeout = setTimeout(() => this.hideSnackbar(), this.snackbarDuration);
    this.cdRef.detectChanges();
  }

  hideSnackbar(): void {
    this.showSnackbar = false;
    if (this.snackbarTimeout) clearTimeout(this.snackbarTimeout);
    this.cdRef.detectChanges();
  }

  private async loadFromLocalStorage(): Promise<void> {
    try {
      if (!this.currentUser) return;
      
      const storageKey = `productionDashboardData_${this.currentUser.id}`;
      const savedData = localStorage.getItem(storageKey);
      
      if (savedData) {
        const data = JSON.parse(savedData);
        this.masterData = data.masterData || [];
        this.requisitionItems = data.requisitionItems || [];
        this.uploadedFileName = data.uploadedFileName || '';
        
        this.requisitionItems = this.requisitionItems.filter(i => i.userId === this.currentUser?.id);
        
        if (this.masterData.length > 0) {
          this.populateCategories();
        }
      }
    } catch (error) {
      console.error('Error loading from localStorage:', error);
    }
  }

  private async saveToLocalStorage(): Promise<void> {
    try {
      if (!this.currentUser) return;
      
      const storageKey = `productionDashboardData_${this.currentUser.id}`;
      
      const data = {
        masterData: this.masterData,
        requisitionItems: this.requisitionItems.filter(i => i.userId === this.currentUser?.id),
        uploadedFileName: this.uploadedFileName,
        selectedTableId: this.selectedTableId,
        lastSaved: new Date().toISOString()
      };
      
      localStorage.setItem(storageKey, JSON.stringify(data));
    } catch (error) {
      console.error('Error saving to localStorage:', error);
    }
  }

  private async loadUserTables(): Promise<void> {
    try {
      if (!this.currentUser) return;
      
      this.userTables = await this.dbService.getUserTables(this.currentUser.id);
      this.cdRef.detectChanges();
    } catch (error) {
      console.error('Error loading user tables:', error);
      this.showSnackbarMessage('Failed to load tables', 'error');
    }
  }

  private async loadAllRequisitionsForUser(): Promise<void> {
    try {
      if (!this.currentUser) return;
      
      console.log('Loading all requisitions for user:', this.currentUser.id);
      
      this.requisitionItems = [];
      
      for (const table of this.userTables) {
        console.log('Loading requisitions for table:', table.name);
        const requisitions = await this.dbService.getTableRequisitions(table.id);
        console.log(`Found ${requisitions.length} requisitions for table ${table.name}`);
        
        const userRequisitions = requisitions.filter((req: any) => 
          req.user_id === this.currentUser?.id
        );
        
        userRequisitions.forEach((req: any) => {
          const materials = req.materials?.map((m: any) => ({
            name: m.name || m.material_name || '',
            qty: m.qty || m.qty_per_batch || 0,
            unit: m.unit || '',
            type: m.type || '',
            requiredQty: m.required_qty || m.requiredQty || 0
          })) || [];
          
          this.requisitionItems.push({
            id: req.id,
            dbId: req.id,
            skuCode: req.sku_code || '',
            skuName: req.sku_name || '',
            category: req.category || '',
            qtyNeeded: req.qty_needed || 1,
            supplier: req.supplier || '',
            qtyPerUnit: req.qty_per_unit || '',
            unit: req.unit || '',
            qtyPerPack: req.qty_per_pack || '',
            pack_unit: req.pack_unit || '',
            materials: materials,
            tableId: req.table_id,
            userId: req.user_id,
            createdAt: req.created_at || new Date().toISOString(),
            updatedAt: req.updated_at || new Date().toISOString()
          });
        });
      }
      
      console.log(`Total loaded ${this.requisitionItems.length} requisitions from database`);
      await this.saveToLocalStorage();
    } catch (error) {
      console.error('Error loading requisitions from Firebase:', error);
    }
  }

  async createNewTable(): Promise<void> {
    if (!this.currentUser) {
      this.showSnackbarMessage('Please log in to create tables', 'error');
      return;
    }
    
    const tableName = prompt('Enter table name:');
    if (!tableName?.trim()) {
      this.showSnackbarMessage('Table name is required', 'error');
      return;
    }

    const trimmedName = tableName.trim();
    
    try {
      const result = await this.dbService.createUserTable({
        user_id: this.currentUser.id,
        name: trimmedName,
        status: 'draft',
        item_count: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });

      if (result.success && result.tableId) {
        const newTable = {
          id: result.tableId,
          name: trimmedName,
          status: 'draft',
          itemCount: 0,
          createdAt: new Date(),
          updatedAt: new Date()
        };

        this.userTables.push(newTable);
        this.selectedTableId = result.tableId;
        this.currentTable = newTable;
        
        this.requisitionItems = this.requisitionItems.filter(i => 
          i.tableId !== this.selectedTableId || i.userId !== this.currentUser?.id
        );
        
        await this.saveToLocalStorage();
        this.filterAndPaginate();
        this.showSnackbarMessage('Table created successfully', 'success');
      } else {
        this.showSnackbarMessage('Failed to create table', 'error');
      }
    } catch (error) {
      console.error('Error creating table:', error);
      this.showSnackbarMessage('Failed to create table', 'error');
    }
  }

  async loadTableData(): Promise<void> {
    if (!this.selectedTableId) {
      this.currentTable = null;
      this.filterAndPaginate();
      return;
    }

    this.currentTable = this.userTables.find(t => t.id === this.selectedTableId) || null;
    
    if (this.currentUser) {
      const requisitions = await this.dbService.getTableRequisitions(this.selectedTableId);
      const userRequisitions = requisitions.filter((req: any) => 
        req.user_id === this.currentUser?.id
      );
      
      const otherTableItems = this.requisitionItems.filter(i => 
        i.tableId !== this.selectedTableId
      );
      
      const currentTableItems = userRequisitions.map((req: any) => {
        const materials = req.materials?.map((m: any) => ({
          name: m.name || m.material_name || '',
          qty: m.qty || m.qty_per_batch || 0,
          unit: m.unit || '',
          type: m.type || '',
          requiredQty: m.required_qty || m.requiredQty || 0
        })) || [];
        
        return {
          id: req.id,
          dbId: req.id,
          skuCode: req.sku_code || '',
          skuName: req.sku_name || '',
          category: req.category || '',
          qtyNeeded: req.qty_needed || 1,
          supplier: req.supplier || '',
          qtyPerUnit: req.qty_per_unit || '',
          unit: req.unit || '',
          qtyPerPack: req.qty_per_pack || '',
          pack_unit: req.pack_unit || '',
          materials: materials,
          tableId: req.table_id,
          userId: req.user_id,
          createdAt: req.created_at || new Date().toISOString(),
          updatedAt: req.updated_at || new Date().toISOString()
        };
      });
      
      this.requisitionItems = [...otherTableItems, ...currentTableItems];
    }
    
    await this.saveToLocalStorage();
    this.filterAndPaginate();
  }

  async renameTable(): Promise<void> {
    if (!this.currentUser || !this.selectedTableId || !this.currentTable) return;

    const newName = prompt('Enter new table name:', this.currentTable.name);
    if (!newName?.trim() || newName.trim() === this.currentTable.name) {
      if (!newName?.trim()) this.showSnackbarMessage('Table name is required', 'error');
      return;
    }

    const trimmedName = newName.trim();
    
    try {
      const result = await this.dbService.updateTableName(this.selectedTableId, trimmedName);
      
      if (result.success) {
        this.currentTable.name = trimmedName;
        this.currentTable.updatedAt = new Date();
        
        const tableIndex = this.userTables.findIndex(t => t.id === this.selectedTableId);
        if (tableIndex !== -1) {
          this.userTables[tableIndex].name = trimmedName;
          this.userTables[tableIndex].updatedAt = new Date();
        }
        
        await this.saveToLocalStorage();
        this.showSnackbarMessage('Table renamed successfully', 'success');
      } else {
        this.showSnackbarMessage('Failed to rename table', 'error');
      }
    } catch (error) {
      console.error('Error renaming table:', error);
      this.showSnackbarMessage('Failed to rename table', 'error');
    }
  }

  async deleteTable(): Promise<void> {
    if (!this.currentUser || !this.selectedTableId) return;
    
    if (confirm('Are you sure you want to delete this table? All data will be lost.')) {
      try {
        const result = await this.dbService.deleteTable(this.selectedTableId);
        
        if (result.success) {
          this.userTables = this.userTables.filter(t => t.id !== this.selectedTableId);
          this.requisitionItems = this.requisitionItems.filter(i => 
            i.tableId !== this.selectedTableId || i.userId !== this.currentUser?.id
          );
          
          this.selectedTableId = '';
          this.currentTable = null;
          
          await this.saveToLocalStorage();
          this.filterAndPaginate();
          this.showSnackbarMessage('Table deleted successfully', 'success');
        } else {
          this.showSnackbarMessage('Failed to delete table', 'error');
        }
      } catch (error) {
        console.error('Error deleting table:', error);
        this.showSnackbarMessage('Failed to delete table', 'error');
      }
    }
  }

  private async updateTableItemCount(): Promise<void> {
    if (!this.selectedTableId || !this.currentUser) return;
    
    try {
      const itemCount = this.requisitionItems.filter(i => 
        i.tableId === this.selectedTableId && i.userId === this.currentUser?.id
      ).length;
      
      const result = await this.dbService.updateTableItemCount(this.selectedTableId, itemCount);
      
      if (result.success && this.currentTable) {
        this.currentTable.itemCount = itemCount;
        
        const tableIndex = this.userTables.findIndex(t => t.id === this.selectedTableId);
        if (tableIndex !== -1) {
          this.userTables[tableIndex].itemCount = itemCount;
          this.userTables[tableIndex].updatedAt = new Date();
        }
      }
    } catch (error) {
      console.error('Error updating table item count:', error);
    }
  }

  getSnackbarIcon(): string {
    switch (this.snackbarType) {
      case 'success': return 'fa-check-circle';
      case 'error': return 'fa-exclamation-circle';
      case 'warning': return 'fa-exclamation-triangle';
      case 'info': 
      default: return 'fa-info-circle';
    }
  }
}