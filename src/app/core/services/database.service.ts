// src/core/services/database.service.ts
import { Injectable } from '@angular/core';
import { Firestore, collection, addDoc, getDocs, query, where, doc, getDoc, updateDoc, deleteDoc, writeBatch } from '@angular/fire/firestore';
import { AuthService } from './auth.service';
import { firstValueFrom } from 'rxjs';
import { User } from '../models/database.model';
import * as XLSX from 'xlsx';

interface MasterData {
  sku_code: string;
  sku_name: string;
  qty_per_unit?: number | null;
  unit?: string;
  qty_per_pack?: number | null;
  pack_unit?: string;
  projected_yield_per_batch?: number | null;
  yield_unit?: string;
  category: string;
  raw_material: string;
  qty_per_batch?: number | null;
  batch_unit?: string;
  type?: string;
  supplier?: string | null;
  created_at?: Date;
  updated_at?: Date;
}

interface InventoryItem {
  id?: string;
  sku_code: string;
  sku_name: string;
  category: string;
  supplier: string;
  qty: number;
  table_id: string;
  user_id: string;
  created_at?: Date;
  updated_at?: Date;
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

@Injectable({ providedIn: 'root' })
export class DatabaseService {
  constructor(
    private firestore: Firestore,
    private auth: AuthService
  ) {}

  // ────────────────────────────────────────────────
  //  User
  // ────────────────────────────────────────────────

  async getCurrentUser(): Promise<User | null> {
    const authUser = await firstValueFrom(this.auth.getCurrentUser());
    if (!authUser) return null;

    try {
      const userDoc = await getDoc(doc(this.firestore, 'users', authUser.uid));
      if (userDoc.exists()) {
        const data = userDoc.data() as any;
        return {
          id: authUser.uid,
          email: data.email || authUser.email || undefined,
          full_name: data.full_name || data.name || undefined,
          username: data.username || undefined,
          role: data.role || undefined
        };
      }
      return { id: authUser.uid, email: authUser.email || undefined } as User;
    } catch (err) {
      console.error('getCurrentUser failed', err);
      return { id: authUser?.uid, email: authUser?.email } as User;
    }
  }

  // ────────────────────────────────────────────────
  //  Master Data Upload & Queries
  // ────────────────────────────────────────────────

  async uploadMasterData(file: File): Promise<{ success: boolean; count?: number; error?: string }> {
    try {
      const arrayBuffer = await file.arrayBuffer();
      const workbook = XLSX.read(arrayBuffer, { type: 'array' });
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];

      // Get raw rows (array of arrays)
      const json: any[][] = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '', blankrows: false });

      // Skip header row
      const dataRows = json.slice(1);

      const batch = writeBatch(this.firestore);
      const colRef = collection(this.firestore, 'masterData');

      let savedCount = 0;

      for (const row of dataRows) {
        // Skip empty or invalid rows
        if (!Array.isArray(row) || row.length < 5 || !row[0]?.toString().trim()) {
          continue;
        }

        const docData: MasterData = {
          sku_code: String(row[0] || '').trim(),
          sku_name: String(row[1] || '').trim(),
          qty_per_unit: row[2] ? Number(row[2]) : null,
          unit: String(row[3] || '').trim(),
          qty_per_pack: row[4] ? Number(row[4]) : null,
          pack_unit: String(row[5] || '').trim(),
          projected_yield_per_batch: row[6] ? Number(row[6]) : null,
          yield_unit: String(row[7] || '').trim(),
          category: String(row[8] || '').trim(),
          raw_material: String(row[9] || '').trim(),
          qty_per_batch: row[10] ? Number(row[10]) : null,
          batch_unit: String(row[11] || '').trim(),
          type: String(row[12] || '').trim(),
          supplier: row[13] ? String(row[13]).trim() : null,
          created_at: new Date(),
          updated_at: new Date()
        };

        const skuCode = docData.sku_code as string;
        const rawMaterial = docData.raw_material || 'no-material';

        const docId = `${skuCode}_${rawMaterial}`
          .replace(/[^a-zA-Z0-9_-]/g, '_')
          .substring(0, 1500);

        const docRef = doc(colRef, docId);
        batch.set(docRef, docData, { merge: true });
        savedCount++;
      }

      await batch.commit();
      return { success: true, count: savedCount };
    } catch (err: any) {
      console.error('Master data upload failed', err);
      return { success: false, error: err.message || 'Unknown error' };
    }
  }

  async getUniqueCategories(): Promise<string[]> {
    try {
      const snapshot = await getDocs(collection(this.firestore, 'masterData'));
      const cats = new Set<string>();
      
      snapshot.forEach(doc => {
        const data = doc.data() as MasterData;
        const category = (data?.category || '').trim();
        if (category) cats.add(category);
      });
      
      return Array.from(cats).sort();
    } catch (err) {
      console.error('getUniqueCategories failed', err);
      return [];
    }
  }

  async getSkusByCategory(category: string): Promise<{ sku_code: string; sku_name: string }[]> {
    if (!category?.trim()) return [];

    try {
      const q = query(
        collection(this.firestore, 'masterData'),
        where('category', '==', category)
      );
      
      const snapshot = await getDocs(q);
      const map = new Map<string, string>();
      
      snapshot.forEach(doc => {
        const data = doc.data() as MasterData;
        const code = (data.sku_code || '').trim();
        const name = (data.sku_name || '').trim();
        if (code && name) map.set(code, name);
      });

      return Array.from(map, ([sku_code, sku_name]) => ({ sku_code, sku_name }));
    } catch (err) {
      console.error('getSkusByCategory failed', err);
      return [];
    }
  }

  async getMaterialsForSku(skuCode: string): Promise<any[]> {
    if (!skuCode?.trim()) return [];

    try {
      const q = query(
        collection(this.firestore, 'masterData'),
        where('sku_code', '==', skuCode)
      );
      
      const snapshot = await getDocs(q);
      const materials: any[] = [];
      
      snapshot.forEach(doc => {
        const data = doc.data() as MasterData;
        const material = {
          raw_material: data.raw_material || '',
          quantity_per_batch: data.qty_per_batch ?? null,
          unit: data.batch_unit || '',
          type: data.type || ''
        };
        
        if (material.raw_material.trim() !== '') {
          materials.push(material);
        }
      });

      return materials;
    } catch (err) {
      console.error('getMaterialsForSku failed', err);
      return [];
    }
  }

  // ────────────────────────────────────────────────
  //  Inventory (user-managed stock with table & user isolation)
  // ────────────────────────────────────────────────

  async addInventoryItem(item: InventoryItem): Promise<{ success: boolean; id?: string }> {
    try {
      const docRef = await addDoc(collection(this.firestore, 'inventory'), {
        ...item,
        created_at: new Date(),
        updated_at: new Date()
      });
      return { success: true, id: docRef.id };
    } catch (err) {
      console.error('addInventoryItem failed', err);
      return { success: false };
    }
  }

  async getInventoryItemsByTable(tableId: string, userId: string): Promise<any[]> {
    try {
      if (!tableId || !userId) return [];
      
      const q = query(
        collection(this.firestore, 'inventory'),
        where('table_id', '==', tableId),
        where('user_id', '==', userId)
      );
      
      const snapshot = await getDocs(q);
      return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    } catch (err) {
      console.error('getInventoryItemsByTable failed', err);
      return [];
    }
  }

  async deleteInventoryItem(itemId: string, userId: string, tableId: string): Promise<boolean> {
    try {
      // First verify the item belongs to the user and table
      const itemRef = doc(this.firestore, 'inventory', itemId);
      const itemDoc = await getDoc(itemRef);
      
      if (!itemDoc.exists()) return false;
      
      const itemData = itemDoc.data() as InventoryItem;
      if (itemData.user_id !== userId || itemData.table_id !== tableId) {
        console.error('Unauthorized delete attempt');
        return false;
      }
      
      // Delete the inventory item
      await deleteDoc(itemRef);
      
      // Also delete associated requisition
      const requisitionsQuery = query(
        collection(this.firestore, 'requisitions'),
        where('inventory_item_id', '==', itemId),
        where('user_id', '==', userId),
        where('table_id', '==', tableId)
      );
      
      const requisitionsSnapshot = await getDocs(requisitionsQuery);
      const batch = writeBatch(this.firestore);
      
      requisitionsSnapshot.forEach(doc => {
        batch.delete(doc.ref);
      });
      
      await batch.commit();
      
      return true;
    } catch (err) {
      console.error('deleteInventoryItem failed', err);
      return false;
    }
  }

  // ────────────────────────────────────────────────
  //  Tables + Requisitions (with user isolation and type)
  // ────────────────────────────────────────────────

  /**
   * Get all tables for a user (legacy method - returns all tables regardless of type)
   * @deprecated Use getUserTablesByType instead
   */
  async getUserTables(userId: string): Promise<any[]> {
    try {
      if (!userId) return [];
      
      const q = query(
        collection(this.firestore, 'tables'),
        where('user_id', '==', userId)
      );
      const snapshot = await getDocs(q);
      return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    } catch (err) {
      console.error('getUserTables failed', err);
      return [];
    }
  }

  /**
   * Get tables by type for a user
   * @param userId - The user ID
   * @param type - The table type ('inventory' or 'requisition')
   */
  async getUserTablesByType(userId: string, type: 'inventory' | 'requisition'): Promise<any[]> {
    try {
      if (!userId) return [];
      
      const q = query(
        collection(this.firestore, 'tables'),
        where('user_id', '==', userId),
        where('type', '==', type)
      );
      const snapshot = await getDocs(q);
      return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    } catch (err) {
      console.error('getUserTablesByType failed', err);
      return [];
    }
  }

  /**
   * Create a new user table with type
   * @param data - Table data (name, user_id)
   * @param type - Table type ('inventory' or 'requisition')
   */
  async createUserTable(data: any, type: 'inventory' | 'requisition'): Promise<{ success: boolean; tableId?: string }> {
    try {
      const docRef = await addDoc(collection(this.firestore, 'tables'), {
        ...data,
        type,  // Add the type field
        item_count: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });
      return { success: true, tableId: docRef.id };
    } catch (err) {
      console.error('createUserTable failed', err);
      return { success: false };
    }
  }

  async updateTableName(tableId: string, name: string, userId: string): Promise<boolean> {
    try {
      // Verify ownership
      const tableRef = doc(this.firestore, 'tables', tableId);
      const tableDoc = await getDoc(tableRef);
      
      if (!tableDoc.exists()) return false;
      
      const tableData = tableDoc.data();
      if (tableData['user_id'] !== userId) {
        console.error('Unauthorized rename attempt');
        return false;
      }
      
      await updateDoc(tableRef, {
        name,
        updated_at: new Date().toISOString()
      });
      return true;
    } catch (err) {
      console.error('updateTableName failed', err);
      return false;
    }
  }

  async deleteTable(tableId: string, userId: string): Promise<boolean> {
    try {
      // Verify ownership
      const tableRef = doc(this.firestore, 'tables', tableId);
      const tableDoc = await getDoc(tableRef);
      
      if (!tableDoc.exists()) return false;
      
      const tableData = tableDoc.data();
      if (tableData['user_id'] !== userId) {
        console.error('Unauthorized delete attempt');
        return false;
      }

      const batch = writeBatch(this.firestore);
      
      // Delete all requisitions for this table (verify user ownership)
      const requisitionsQuery = query(
        collection(this.firestore, 'requisitions'),
        where('table_id', '==', tableId),
        where('user_id', '==', userId)
      );
      const requisitionsSnapshot = await getDocs(requisitionsQuery);
      
      requisitionsSnapshot.forEach(doc => {
        batch.delete(doc.ref);
      });
      
      // Delete all inventory items for this table
      const inventoryQuery = query(
        collection(this.firestore, 'inventory'),
        where('table_id', '==', tableId),
        where('user_id', '==', userId)
      );
      const inventorySnapshot = await getDocs(inventoryQuery);
      
      inventorySnapshot.forEach(doc => {
        batch.delete(doc.ref);
      });
      
      // Delete the table itself
      batch.delete(tableRef);
      
      await batch.commit();
      return true;
    } catch (err) {
      console.error('deleteTable failed', err);
      return false;
    }
  }

  async getTableRequisitions(tableId: string, userId: string): Promise<any[]> {
    try {
      if (!tableId || !userId) return [];
      
      const q = query(
        collection(this.firestore, 'requisitions'),
        where('table_id', '==', tableId),
        where('user_id', '==', userId)
      );
      const snapshot = await getDocs(q);
      return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    } catch (err) {
      console.error('getTableRequisitions failed', err);
      return [];
    }
  }

  async createRequisition(data: any, materials: any[]): Promise<{ success: boolean; id?: string }> {
    try {
      const docRef = await addDoc(collection(this.firestore, 'requisitions'), {
        ...data,
        materials,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });
      return { success: true, id: docRef.id };
    } catch (err) {
      console.error('createRequisition failed', err);
      return { success: false };
    }
  }

  async updateRequisitionQty(id: string, qty: number, userId: string, tableId: string): Promise<boolean> {
    try {
      // Verify ownership
      const reqRef = doc(this.firestore, 'requisitions', id);
      const reqDoc = await getDoc(reqRef);
      
      if (!reqDoc.exists()) return false;
      
      const reqData = reqDoc.data();
      if (reqData['user_id'] !== userId || reqData['table_id'] !== tableId) {
        console.error('Unauthorized update attempt');
        return false;
      }
      
      await updateDoc(reqRef, {
        qty_needed: qty,
        updated_at: new Date().toISOString()
      });
      return true;
    } catch (err) {
      console.error('updateRequisitionQty failed', err);
      return false;
    }
  }

  async updateRequisitionSupplier(id: string, supplier: string, userId: string, tableId: string): Promise<boolean> {
    try {
      // Verify ownership
      const reqRef = doc(this.firestore, 'requisitions', id);
      const reqDoc = await getDoc(reqRef);
      
      if (!reqDoc.exists()) return false;
      
      const reqData = reqDoc.data();
      if (reqData['user_id'] !== userId || reqData['table_id'] !== tableId) {
        console.error('Unauthorized update attempt');
        return false;
      }
      
      await updateDoc(reqRef, {
        supplier,
        updated_at: new Date().toISOString()
      });
      return true;
    } catch (err) {
      console.error('updateRequisitionSupplier failed', err);
      return false;
    }
  }

  async deleteRequisition(id: string, userId: string, tableId: string): Promise<boolean> {
    try {
      // Verify ownership
      const reqRef = doc(this.firestore, 'requisitions', id);
      const reqDoc = await getDoc(reqRef);
      
      if (!reqDoc.exists()) return false;
      
      const reqData = reqDoc.data();
      if (reqData['user_id'] !== userId || reqData['table_id'] !== tableId) {
        console.error('Unauthorized delete attempt');
        return false;
      }
      
      await deleteDoc(reqRef);
      return true;
    } catch (err) {
      console.error('deleteRequisition failed', err);
      return false;
    }
  }

  async updateTableItemCount(tableId: string, count: number, userId: string): Promise<boolean> {
    try {
      // Verify ownership
      const tableRef = doc(this.firestore, 'tables', tableId);
      const tableDoc = await getDoc(tableRef);
      
      if (!tableDoc.exists()) return false;
      
      const tableData = tableDoc.data();
      if (tableData['user_id'] !== userId) {
        console.error('Unauthorized update attempt');
        return false;
      }
      
      await updateDoc(tableRef, {
        item_count: count,
        updated_at: new Date().toISOString()
      });
      return true;
    } catch (err) {
      console.error('updateTableItemCount failed', err);
      return false;
    }
  }

  async updateRequisition(id: string, data: any, userId: string, tableId: string): Promise<boolean> {
    try {
      // Verify ownership
      const reqRef = doc(this.firestore, 'requisitions', id);
      const reqDoc = await getDoc(reqRef);
      
      if (!reqDoc.exists()) return false;
      
      const reqData = reqDoc.data();
      if (reqData['user_id'] !== userId || reqData['table_id'] !== tableId) {
        console.error('Unauthorized update attempt');
        return false;
      }
      
      // Don't update reqNumber for existing requisitions
      const { reqNumber, ...updateData } = data;
      
      await updateDoc(reqRef, {
        ...updateData,
        updated_at: new Date().toISOString()
      });
      
      return true;
    } catch (err) {
      console.error('updateRequisition failed', err);
      return false;
    }
  }

  // ────────────────────────────────────────────────
  //  Analytics & Reports (with user isolation)
  // ────────────────────────────────────────────────

  async getTableSummary(tableId: string, userId: string): Promise<any> {
    try {
      if (!tableId || !userId) return null;
      
      // Get all inventory items for this table
      const inventoryItems = await this.getInventoryItemsByTable(tableId, userId);
      
      // Calculate summary statistics
      const totalItems = inventoryItems.length;
      const totalQuantity = inventoryItems.reduce((sum, item) => sum + (item.qty || 0), 0);
      
      // Get category breakdown
      const categoryBreakdown: { [key: string]: number } = {};
      inventoryItems.forEach(item => {
        categoryBreakdown[item.category] = (categoryBreakdown[item.category] || 0) + 1;
      });
      
      return {
        totalItems,
        totalQuantity,
        categoryBreakdown,
        categoryCount: Object.keys(categoryBreakdown).length
      };
    } catch (err) {
      console.error('getTableSummary failed', err);
      return null;
    }
  }

  async getUserSummary(userId: string): Promise<any> {
    try {
      if (!userId) return null;
      
      // Get all tables for user
      const tables = await this.getUserTables(userId);
      
      // Get all inventory items for user
      const tablesPromises = tables.map(table => 
        this.getInventoryItemsByTable(table.id, userId)
      );
      
      const allItemsArrays = await Promise.all(tablesPromises);
      const allItems = allItemsArrays.flat();
      
      return {
        totalTables: tables.length,
        totalItems: allItems.length,
        totalQuantity: allItems.reduce((sum, item) => sum + (item.qty || 0), 0),
        tables: tables.map(table => ({
          id: table.id,
          name: table.name,
          itemCount: table.item_count || 0
        }))
      };
    } catch (err) {
      console.error('getUserSummary failed', err);
      return null;
    }
  }
}