// src/app/core/services/database.service.ts
import { Injectable } from '@angular/core';
import { Firestore, collection, addDoc, query, where, doc, getDoc, updateDoc, deleteDoc, writeBatch, orderBy } from '@angular/fire/firestore';
import { getDocs } from 'firebase/firestore';
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
    try {
      // Use getCurrentUserPromise instead of getCurrentUserObservable
      const authUser = await this.auth.getCurrentUserPromise();
      if (!authUser) return null;

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
      
      // Return basic user if no document exists
      return { 
        id: authUser.uid, 
        email: authUser.email || undefined 
      } as User;
    } catch (err) {
      console.error('getCurrentUser failed', err);
      return null;
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
        type,
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

  async getTableById(tableId: string): Promise<{ id: string; name: string } | null> {
    try {
      const tableRef = doc(this.firestore, 'tables', tableId);
      const tableDoc = await getDoc(tableRef);
      if (tableDoc.exists()) {
        const d = tableDoc.data();
        return { id: tableDoc.id, name: d['name'] || 'Untitled' };
      }
      return null;
    } catch (err) {
      console.error('getTableById failed', err);
      return null;
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
      if (!tableId || !userId) {
        console.log('Missing tableId or userId:', { tableId, userId });
        return [];
      }
      
      console.log('Fetching requisitions for table:', tableId, 'user:', userId);
      
      const q = query(
        collection(this.firestore, 'requisitions'),
        where('table_id', '==', tableId),
        where('user_id', '==', userId),
        orderBy('created_at', 'desc')
      );
      
      const snapshot = await getDocs(q);
      console.log('Found requisitions count:', snapshot.size);
      
      const requisitions = snapshot.docs.map(doc => {
        const data = doc.data();
        console.log('Requisition data:', { id: doc.id, ...data });
        return { id: doc.id, ...data };
      });
      
      return requisitions;
    } catch (err) {
      console.error('getTableRequisitions failed:', err);
      return [];
    }
  }

  async createRequisition(data: any, materials: any[]): Promise<{ success: boolean; id?: string }> {
    try {
      console.log('Creating requisition with data:', data);
      
      // Ensure all required fields are present
      const requisitionData = {
        ...data,
        materials: materials || [],
        status: data.status || 'Pending',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      
      const docRef = await addDoc(collection(this.firestore, 'requisitions'), requisitionData);
      console.log('Requisition created with ID:', docRef.id);
      
      return { success: true, id: docRef.id };
    } catch (err) {
      console.error('createRequisition failed:', err);
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
  //  Requisition Status Management
  // ────────────────────────────────────────────────

  /**
   * Update requisition status with additional workflow data
   * @param id - Requisition ID
   * @param status - New status (Pending, Submitted, Scheduled, Approved, Rejected)
   * @param userId - User ID making the change
   * @param tableId - Table ID
   * @param additionalData - Additional data like scheduled_date, approved_by, etc.
   */
  async updateRequisitionStatus(
    id: string, 
    status: string, 
    userId: string, 
    tableId: string,
    additionalData: any = {}
  ): Promise<boolean> {
    try {
      // Verify the requisition exists and belongs to the user/table
      const reqRef = doc(this.firestore, 'requisitions', id);
      const reqDoc = await getDoc(reqRef);
      
      if (!reqDoc.exists()) return false;
      
      const reqData = reqDoc.data();
      
      // Check ownership - users can only update their own requisitions
      // But procurement and admin can update any (checked at component level)
      if (reqData['user_id'] !== userId && reqData['table_id'] !== tableId) {
        console.error('Unauthorized status update attempt');
        return false;
      }
      
      // Prepare update data based on status
      const updateData: any = {
        status,
        updated_at: new Date().toISOString(),
        ...additionalData
      };

      // Add specific timestamps based on status
      switch(status) {
        case 'Submitted':
          updateData.submitted_at = new Date().toISOString();
          break;
        case 'Scheduled':
          updateData.scheduled_at = new Date().toISOString();
          updateData.scheduled_by = userId;
          break;
        case 'Approved':
          updateData.approved_at = new Date().toISOString();
          updateData.approved_by = userId;
          break;
        case 'Rejected':
          updateData.rejected_at = new Date().toISOString();
          updateData.rejected_by = userId;
          break;
        case 'Production_Accepted':
          updateData.production_accepted_at = new Date().toISOString();
          updateData.production_accepted_by = userId;
          break;
        case 'Delivered':
          updateData.delivered_at = new Date().toISOString();
          updateData.delivered_by = userId;
          break;
        case 'Partially_Delivered':
          updateData.partially_delivered_at = new Date().toISOString();
          updateData.partially_delivered_by = userId;
          break;
      }
      
      await updateDoc(reqRef, updateData);
      
      return true;
    } catch (err) {
      console.error('updateRequisitionStatus failed', err);
      return false;
    }
  }

  /**
   * Get requisitions by status for a specific table
   * @param tableId - Table ID
   * @param userId - User ID
   * @param status - Status to filter by (optional)
   */
  async getRequisitionsByStatus(tableId: string, userId: string, status?: string): Promise<any[]> {
    try {
      if (!tableId || !userId) return [];
      
      let q;
      if (status) {
        q = query(
          collection(this.firestore, 'requisitions'),
          where('table_id', '==', tableId),
          where('user_id', '==', userId),
          where('status', '==', status),
          orderBy('created_at', 'desc')
        );
      } else {
        q = query(
          collection(this.firestore, 'requisitions'),
          where('table_id', '==', tableId),
          where('user_id', '==', userId),
          orderBy('created_at', 'desc')
        );
      }
      
      const snapshot = await getDocs(q);
      return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    } catch (err) {
      console.error('getRequisitionsByStatus failed', err);
      return [];
    }
  }

  /**
   * Get pending requisitions that need submission
   * @param tableId - Table ID
   * @param userId - User ID
   */
  async getPendingRequisitions(tableId: string, userId: string): Promise<any[]> {
    return this.getRequisitionsByStatus(tableId, userId, 'Pending');
  }

  /**
   * Get submitted requisitions that need scheduling (for procurement)
   * @param tableId - Table ID
   * @param userId - User ID
   */
  async getSubmittedRequisitions(tableId: string, userId: string): Promise<any[]> {
    return this.getRequisitionsByStatus(tableId, userId, 'Submitted');
  }

  /**
   * Get scheduled requisitions that need approval (for admin)
   * @param tableId - Table ID
   * @param userId - User ID
   */
  async getScheduledRequisitions(tableId: string, userId: string): Promise<any[]> {
    return this.getRequisitionsByStatus(tableId, userId, 'Scheduled');
  }

  /**
   * Get approved requisitions
   * @param tableId - Table ID
   * @param userId - User ID
   */
  async getApprovedRequisitions(tableId: string, userId: string): Promise<any[]> {
    return this.getRequisitionsByStatus(tableId, userId, 'Approved');
  }

  /**
   * Get rejected requisitions
   * @param tableId - Table ID
   * @param userId - User ID
   */
  async getRejectedRequisitions(tableId: string, userId: string): Promise<any[]> {
    return this.getRequisitionsByStatus(tableId, userId, 'Rejected');
  }

  /**
   * Get all requisitions by status across all tables (for production/procurement workflow)
   * Used when production needs to see all Submitted from store/users, or procurement sees all Production_Accepted
   */
  async getAllRequisitionsByStatus(status: string): Promise<any[]> {
    try {
      const q = query(
        collection(this.firestore, 'requisitions'),
        where('status', '==', status),
        orderBy('created_at', 'desc')
      );
      const snapshot = await getDocs(q);
      return snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch (err) {
      console.error('getAllRequisitionsByStatus failed:', err);
      return [];
    }
  }

  // ────────────────────────────────────────────────
  //  Workflow Statistics
  // ────────────────────────────────────────────────

  /**
   * Get workflow statistics for a table
   * @param tableId - Table ID
   * @param userId - User ID
   */
  async getWorkflowStats(tableId: string, userId: string): Promise<any> {
    try {
      if (!tableId || !userId) return null;
      
      const allRequisitions = await this.getTableRequisitions(tableId, userId);
      
      const stats = {
        total: allRequisitions.length,
        pending: allRequisitions.filter(r => r.status === 'Pending').length,
        submitted: allRequisitions.filter(r => r.status === 'Submitted').length,
        scheduled: allRequisitions.filter(r => r.status === 'Scheduled').length,
        approved: allRequisitions.filter(r => r.status === 'Approved').length,
        rejected: allRequisitions.filter(r => r.status === 'Rejected').length,
        approvalRate: 0
      };
      
      // Calculate approval rate
      const totalProcessed = stats.approved + stats.rejected;
      stats.approvalRate = totalProcessed > 0 
        ? Math.round((stats.approved / totalProcessed) * 100) 
        : 0;
      
      return stats;
    } catch (err) {
      console.error('getWorkflowStats failed', err);
      return null;
    }
  }

  /**
   * Get requisitions that need action based on user role
   * @param userId - User ID
   * @param role - User role
   */
  async getRequisitionsNeedingAction(userId: string, role: string): Promise<any[]> {
    try {
      if (!userId) return [];
      
      // Get all tables for the user
      const tables = await this.getUserTables(userId);
      
      let allRequisitions: any[] = [];
      
      for (const table of tables) {
        let q;
        
        // Different queries based on role
        if (role === 'user') {
          // Users need to submit their pending requisitions
          q = query(
            collection(this.firestore, 'requisitions'),
            where('user_id', '==', userId),
            where('table_id', '==', table.id),
            where('status', '==', 'Pending'),
            where('submitted_at', '==', null)
          );
        } else if (role === 'procurement') {
          // Procurement needs to schedule submitted requisitions
          q = query(
            collection(this.firestore, 'requisitions'),
            where('table_id', '==', table.id),
            where('status', '==', 'Submitted')
          );
        } else if (role === 'admin') {
          // Admin needs to approve scheduled requisitions
          q = query(
            collection(this.firestore, 'requisitions'),
            where('table_id', '==', table.id),
            where('status', '==', 'Scheduled')
          );
        } else {
          continue;
        }
        
        const snapshot = await getDocs(q);
        allRequisitions = [...allRequisitions, ...snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }))];
      }
      
      return allRequisitions;
    } catch (err) {
      console.error('getRequisitionsNeedingAction failed', err);
      return [];
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