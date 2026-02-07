import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

interface Material {
  name: string;
  qtyPerBatch: number;
  unit: string;
  type: string;
  totalRequired: string;
}

interface InventoryItem {
  id: number;
  code: string;
  sku: string;
  category: string;
  qty: number;
  supplier: string;
  qtyPerUnit: number;
  unit: string;
  qtyPerPack: number;
  packUnit: string;
  materials?: Material[];
}

interface SkuData {
  sku: string;
  category: string;
  code: string;
}

interface NewItemForm {
  category: string;
  sku: string;
  code: string;
  supplier: string;
  qty: number;
  qtyPerUnit: number;
  unit: string;
  qtyPerPack: number;
  packUnit: string;
}

@Component({
  selector: 'app-page2',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './page2.component.html',
  styleUrl: './page2.component.css',
})
export class Page2Component {
  // Form data for new item
  newItem: NewItemForm = {
    category: '',
    sku: '',
    code: '',
    supplier: '',
    qty: 0,
    qtyPerUnit: 1,
    unit: 'Piece',
    qtyPerPack: 1,
    packUnit: 'Pack'
  };

  // Available categories and SKUs
  categories = ['Electronics', 'Textiles', 'Packaging', 'Chemicals', 'Food', 'Automotive'];
  
  // Sample SKU data with category mapping
  skuData: SkuData[] = [
    { sku: 'SKU-1001', category: 'Electronics', code: 'PRD-001' },
    { sku: 'SKU-1002', category: 'Textiles', code: 'PRD-002' },
    { sku: 'SKU-1003', category: 'Packaging', code: 'PRD-003' },
    { sku: 'SKU-1004', category: 'Chemicals', code: 'PRD-004' },
    { sku: 'SKU-1005', category: 'Electronics', code: 'PRD-005' },
    { sku: 'SKU-1006', category: 'Food', code: 'PRD-006' },
    { sku: 'SKU-1007', category: 'Automotive', code: 'PRD-007' },
    { sku: 'SKU-1008', category: 'Textiles', code: 'PRD-008' }
  ];

  // Sample materials data for demonstration
  sampleMaterials: { [key: string]: Material[] } = {
    'SKU-1001': [
      { name: 'Copper Wire', qtyPerBatch: 5.2, unit: 'Meters', type: 'Conductor', totalRequired: '6,500 m' },
      { name: 'Plastic Casing', qtyPerBatch: 1, unit: 'Piece', type: 'Housing', totalRequired: '1,250 pcs' },
      { name: 'Circuit Board', qtyPerBatch: 0.5, unit: 'Piece', type: 'Electronics', totalRequired: '625 pcs' }
    ],
    'SKU-1002': [
      { name: 'Cotton Fabric', qtyPerBatch: 2.5, unit: 'Yards', type: 'Textile', totalRequired: '8,500 yds' },
      { name: 'Polyester Thread', qtyPerBatch: 0.1, unit: 'Spools', type: 'Sewing', totalRequired: '340 spools' }
    ],
    'SKU-1003': [
      { name: 'Cardboard', qtyPerBatch: 0.8, unit: 'Sheets', type: 'Base Material', totalRequired: '680 sheets' },
      { name: 'Ink', qtyPerBatch: 0.05, unit: 'Liters', type: 'Printing', totalRequired: '42.5 L' }
    ],
    'SKU-1004': [
      { name: 'Solvent Base', qtyPerBatch: 3.5, unit: 'Liters', type: 'Chemical', totalRequired: '1,820 L' },
      { name: 'Resin', qtyPerBatch: 1.2, unit: 'Kilograms', type: 'Binder', totalRequired: '624 kg' }
    ]
  };

  // Inventory items
  items: InventoryItem[] = [
    {
      id: 1,
      code: 'PRD-001',
      sku: 'SKU-1001',
      category: 'Electronics',
      qty: 1250,
      supplier: 'TechSupplies Inc.',
      qtyPerUnit: 10,
      unit: 'Pieces',
      qtyPerPack: 50,
      packUnit: 'Box',
      materials: this.sampleMaterials['SKU-1001']
    },
    {
      id: 2,
      code: 'PRD-002',
      sku: 'SKU-1002',
      category: 'Textiles',
      qty: 3400,
      supplier: 'FabricWorld Ltd.',
      qtyPerUnit: 25,
      unit: 'Yards',
      qtyPerPack: 100,
      packUnit: 'Roll',
      materials: this.sampleMaterials['SKU-1002']
    },
    {
      id: 3,
      code: 'PRD-003',
      sku: 'SKU-1003',
      category: 'Packaging',
      qty: 850,
      supplier: 'PackMasters Co.',
      qtyPerUnit: 100,
      unit: 'Pieces',
      qtyPerPack: 500,
      packUnit: 'Carton',
      materials: this.sampleMaterials['SKU-1003']
    },
    {
      id: 4,
      code: 'PRD-004',
      sku: 'SKU-1004',
      category: 'Chemicals',
      qty: 520,
      supplier: 'ChemSupply Corp.',
      qtyPerUnit: 5,
      unit: 'Liters',
      qtyPerPack: 20,
      packUnit: 'Drum',
      materials: this.sampleMaterials['SKU-1004']
    }
  ];

  // Filtered SKUs based on selected category
  filteredSkus: string[] = [];

  // Search and filter
  searchQuery = '';
  filterCategory = '';
  filteredItems: InventoryItem[] = [...this.items];

  // Expanded rows state
  expandedRows: { [key: number]: boolean } = {};

  constructor() {
    // Initialize with first category selected for demo
    this.newItem.category = this.categories[0];
    this.onCategoryChange();
  }

  // When category changes, update SKU dropdown
  onCategoryChange(): void {
    if (this.newItem.category) {
      this.filteredSkus = this.skuData
        .filter(item => item.category === this.newItem.category)
        .map(item => item.sku);
      
      // Auto-select first SKU if available
      if (this.filteredSkus.length > 0 && !this.newItem.sku) {
        this.newItem.sku = this.filteredSkus[0];
        this.onSkuChange();
      } else {
        this.newItem.sku = '';
        this.newItem.code = '';
      }
    } else {
      this.filteredSkus = [];
      this.newItem.sku = '';
      this.newItem.code = '';
    }
  }

  // When SKU changes, auto-generate code
  onSkuChange(): void {
    if (this.newItem.sku) {
      const skuInfo = this.skuData.find(item => item.sku === this.newItem.sku);
      if (skuInfo) {
        this.newItem.code = skuInfo.code;
      }
    } else {
      this.newItem.code = '';
    }
  }

  // Add new item to inventory
  addItem(): void {
    if (!this.canAddItem()) return;

    const newId = Math.max(...this.items.map(item => item.id), 0) + 1;
    const materials = this.sampleMaterials[this.newItem.sku] || [];

    const newItem: InventoryItem = {
      id: newId,
      code: this.newItem.code,
      sku: this.newItem.sku,
      category: this.newItem.category,
      qty: Math.floor(Math.random() * 5000) + 100, // Random quantity for demo
      supplier: this.newItem.supplier || 'Unknown Supplier',
      qtyPerUnit: Math.floor(Math.random() * 20) + 1,
      unit: ['Piece', 'Liter', 'Kilogram', 'Meter', 'Yard'][Math.floor(Math.random() * 5)],
      qtyPerPack: Math.floor(Math.random() * 100) + 1,
      packUnit: ['Box', 'Carton', 'Pack', 'Bundle', 'Pallet'][Math.floor(Math.random() * 5)],
      materials: materials
    };

    this.items.unshift(newItem);
    
    // Reset form
    this.newItem = {
      category: this.categories[0],
      sku: '',
      code: '',
      supplier: '',
      qty: 0,
      qtyPerUnit: 1,
      unit: 'Piece',
      qtyPerPack: 1,
      packUnit: 'Pack'
    };
    
    this.onCategoryChange();
    this.onSearch(); // Refresh filtered items
  }

  // Delete item from inventory
  deleteItem(id: number, event: Event): void {
    event.stopPropagation(); // Prevent row expansion when clicking delete
    
    if (confirm('Are you sure you want to delete this item?')) {
      this.items = this.items.filter(item => item.id !== id);
      delete this.expandedRows[id];
      this.onSearch(); // Refresh filtered items
    }
  }

  // Check if item can be added
  canAddItem(): boolean {
    return !!this.newItem.category && !!this.newItem.sku && !!this.newItem.supplier.trim();
  }

  // Search functionality
  onSearch(): void {
    let filtered = [...this.items];
    
    // Apply category filter
    if (this.filterCategory) {
      filtered = filtered.filter(item => 
        item.category.toLowerCase().includes(this.filterCategory.toLowerCase())
      );
    }
    
    // Apply search query filter
    if (this.searchQuery.trim()) {
      const query = this.searchQuery.toLowerCase().trim();
      filtered = filtered.filter(item =>
        item.code.toLowerCase().includes(query) ||
        item.sku.toLowerCase().includes(query) ||
        item.category.toLowerCase().includes(query) ||
        item.supplier.toLowerCase().includes(query) ||
        (item.materials && item.materials.some(material => 
          material.name.toLowerCase().includes(query) ||
          material.type.toLowerCase().includes(query)
        ))
      );
    }
    
    this.filteredItems = filtered;
  }

  // When filter changes
  onFilterChange(): void {
    this.onSearch();
  }

  // Clear all filters
  clearFilters(): void {
    this.searchQuery = '';
    this.filterCategory = '';
    this.filteredItems = [...this.items];
  }

  // Toggle row expansion
  toggleRow(id: number): void {
    this.expandedRows[id] = !this.expandedRows[id];
  }

  // Calculate total required from materials
  calculateTotalRequired(materials: Material[]): string {
    if (!materials || materials.length === 0) return '0';
    
    const total = materials.reduce((sum, material) => {
      const value = parseFloat(material.totalRequired.replace(/[^\d.]/g, ''));
      return sum + (isNaN(value) ? 0 : value);
    }, 0);
    
    return `${total.toLocaleString()}`;
  }

  // Get total quantity for stats
  get totalQuantity(): number {
    return this.filteredItems.reduce((sum, item) => sum + item.qty, 0);
  }
  // Add this method to calculate quantity percentage for visual bar
getQuantityPercentage(quantity: number): number {
  const maxQty = Math.max(...this.items.map(item => item.qty), 5000);
  return Math.min((quantity / maxQty) * 100, 100);
}

// Update getCategoryColor to return CSS variable-friendly value
getCategoryColor(category: string): string {
  const colors: { [key: string]: string } = {
    'Electronics': '217, 91.2%, 59.8%',
    'Textiles': '142, 76%, 36%',
    'Packaging': '38, 92%, 50%',
    'Chemicals': '0, 84%, 60%',
    'Food': '299, 84%, 60%',
    'Automotive': '262, 83%, 60%'
  };
  return `hsla(${colors[category] || 'var(--muted)'}, 0.2)`;
}
// Add this method for material progress bar
getMaterialProgress(totalRequired: string): number {
  // Extract numeric value from string like "6,500 m"
  const numericValue = parseFloat(totalRequired.replace(/[^\d.]/g, ''));
  if (isNaN(numericValue)) return 0;
  
  // Calculate percentage (max assumed as 10000 for demo)
  const maxValue = 10000;
  return Math.min((numericValue / maxValue) * 100, 100);
}

// Add this method for average calculation
calculateAverageRequired(materials: Material[]): string {
  if (!materials || materials.length === 0) return '0';
  
  const total = materials.reduce((sum, material) => {
    const value = parseFloat(material.totalRequired.replace(/[^\d.]/g, ''));
    return sum + (isNaN(value) ? 0 : value);
  }, 0);
  
  const average = total / materials.length;
  
  // Format based on the unit from first material
  if (materials[0]?.totalRequired.includes('m')) {
    return `${average.toFixed(0)} m`;
  } else if (materials[0]?.totalRequired.includes('kg')) {
    return `${average.toFixed(0)} kg`;
  } else if (materials[0]?.totalRequired.includes('L')) {
    return `${average.toFixed(1)} L`;
  }
  
  return `${average.toFixed(0)}`;
}
}