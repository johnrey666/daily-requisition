import { Injectable, Injector, runInInjectionContext } from '@angular/core';
import {
  Firestore,
  collection,
  addDoc,
  query,
  where,
  doc,
  getDoc,
  updateDoc,
  deleteDoc,
  writeBatch,
  orderBy,
  getDocs
} from '@angular/fire/firestore';
import { AuthService } from './auth.service';
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
  uploaded_by?: string;
  uploaded_at?: Date;
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
  type: 'inventory' | 'requisition' | 'production';
  item_count?: number;
  created_at?: string;
  updated_at?: string;
}

@Injectable({ providedIn: 'root' })
export class DatabaseService {

  constructor(
    private firestore: Firestore,
    private auth: AuthService,
    private injector: Injector
  ) {}

  private run<T>(fn: () => Promise<T>): Promise<T> {
    return runInInjectionContext(this.injector, fn);
  }

  normalizeSkuCode(sku: any): string {
    if (!sku && sku !== 0) return '';

    let s = String(sku).trim();
    
    // Log the original for debugging
    console.log('Normalizing SKU:', { original: s });

    // Remove ONLY leading/trailing whitespace, keep internal spaces if they exist
    s = s.trim();

    // If it's a number-like string, keep it as is
    if (/^\d+$/.test(s)) {
      console.log('SKU is numeric, keeping as:', s);
      return s;
    }

    // For non-numeric SKUs, normalize to uppercase but keep original format
    s = s.toUpperCase();
    
    console.log('Normalized SKU result:', s);
    return s;
  }

  async getCurrentUser(): Promise<any | null> {
    try {
      const authUser = await this.auth.getCurrentUserPromise();
      if (!authUser) return null;

      const userDoc = await this.run(() =>
        getDoc(doc(this.firestore, 'users', authUser.uid))
      );

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

      return {
        id: authUser.uid,
        email: authUser.email || undefined
      };
    } catch (err) {
      console.error('getCurrentUser failed', err);
      return null;
    }
  }

  async uploadMasterData(file: File): Promise<{ success: boolean; count?: number; error?: string }> {
    try {
      const currentUser = await this.auth.getCurrentUserPromise();
      if (!currentUser) {
        return { success: false, error: 'You must be logged in to upload master data' };
      }

      const arrayBuffer = await file.arrayBuffer();
      const workbook = XLSX.read(arrayBuffer, { type: 'array' });
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];

      const json: any[][] = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '', blankrows: false });
      const dataRows = json.slice(1);

      const colRef = collection(this.firestore, 'masterData');
      let savedCount = 0;

      await this.run(async () => {
        const batch = writeBatch(this.firestore);

        for (const row of dataRows) {
          if (!Array.isArray(row) || row.length < 5 || !row[0]) {
            continue;
          }

          const skuCode = this.normalizeSkuCode(row[0]);

          if (!skuCode) continue;

          const docData: MasterData = {
            sku_code: skuCode,
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
            updated_at: new Date(),
            uploaded_by: currentUser.uid,
            uploaded_at: new Date()
          };

          const rawMaterial = (docData.raw_material || 'no-material').trim();
          const docId = `${skuCode}_${rawMaterial}`
            .replace(/[^a-zA-Z0-9_-]/g, '_')
            .substring(0, 1500);

          const docRef = doc(colRef, docId);
          batch.set(docRef, docData, { merge: true });
          savedCount++;
        }

        await batch.commit();
      });

      return { success: true, count: savedCount };
    } catch (err: any) {
      console.error('Master data upload failed', err);

      if (err.code === 'permission-denied' || err.message?.includes('permission')) {
        return {
          success: false,
          error: 'Missing or insufficient permissions. Please check your Firestore security rules.'
        };
      }

      return { success: false, error: err.message || 'Unknown error' };
    }
  }

  async getUniqueCategories(): Promise<string[]> {
    try {
      const snapshot = await this.run(() =>
        getDocs(collection(this.firestore, 'masterData'))
      );

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
      const snapshot = await this.run(() => {
        const masterDataRef = collection(this.firestore, 'masterData');
        const q = query(masterDataRef, where('category', '==', category));
        return getDocs(q);
      });

      const map = new Map<string, string>();
      snapshot.forEach(doc => {
        const data = doc.data() as MasterData;
        const code = (data.sku_code || '').trim();
        const name = (data.sku_name || '').trim();
        if (code && name) {
          map.set(code, name);
        }
      });

      return Array.from(map, ([sku_code, sku_name]) => ({ sku_code, sku_name }));
    } catch (err) {
      console.error('getSkusByCategory failed', err);
      return [];
    }
  }

  async getMaterialsForSku(skuCode: string): Promise<any[]> {
    const raw = skuCode != null ? String(skuCode).trim() : '';
    if (!raw) {
      return [];
    }

    const cleanSku = this.normalizeSkuCode(raw);

    const collectMaterials = (snap: { forEach: (fn: (d: any) => void) => void }): any[] => {
      const mats: any[] = [];
      snap.forEach((d: any) => {
        const data = d.data() as MasterData;
        if (data.raw_material?.trim()) {
          mats.push({
            raw_material: data.raw_material.trim(),
            quantity_per_batch: data.qty_per_batch ?? null,
            unit: (data.batch_unit || '').trim(),
            type: (data.type || '').trim()
          });
        }
      });
      return mats;
    };

    try {
      const masterRef = collection(this.firestore, 'masterData');
      const variants: (string | number)[] = [cleanSku];
      if (raw !== cleanSku) variants.push(raw);
      if (/^\d+$/.test(raw)) variants.push(Number(raw));

      for (const val of variants) {
        const q = query(masterRef, where('sku_code', '==', val));
        const snapshot = await getDocs(q);
        const materials = collectMaterials(snapshot);
        if (materials.length > 0) {
          return materials;
        }
      }
      return [];
    } catch (err) {
      console.error('getMaterialsForSku failed', raw, err);
      return [];
    }
  }

  async addInventoryItem(item: InventoryItem): Promise<{ success: boolean; id?: string }> {
    try {
      const docRef = await this.run(() =>
        addDoc(collection(this.firestore, 'inventory'), {
          ...item,
          created_at: new Date(),
          updated_at: new Date()
        })
      );
      return { success: true, id: docRef.id };
    } catch (err) {
      console.error('addInventoryItem failed', err);
      return { success: false };
    }
  }

  async getInventoryItemsByTable(tableId: string, userId: string): Promise<any[]> {
    try {
      if (!tableId || !userId) return [];

      const snapshot = await this.run(() => {
        const q = query(
          collection(this.firestore, 'inventory'),
          where('table_id', '==', tableId),
          where('user_id', '==', userId)
        );
        return getDocs(q);
      });

      return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    } catch (err) {
      console.error('getInventoryItemsByTable failed', err);
      return [];
    }
  }

  async deleteInventoryItem(itemId: string, userId: string, tableId: string): Promise<boolean> {
    try {
      const itemRef = doc(this.firestore, 'inventory', itemId);

      const itemDoc = await this.run(() => getDoc(itemRef));
      if (!itemDoc.exists()) return false;

      const itemData = itemDoc.data() as InventoryItem;
      if (itemData.user_id !== userId || itemData.table_id !== tableId) {
        return false;
      }

      await this.run(() => deleteDoc(itemRef));

      const requisitionsSnapshot = await this.run(() => {
        const q = query(
          collection(this.firestore, 'requisitions'),
          where('inventory_item_id', '==', itemId),
          where('user_id', '==', userId),
          where('table_id', '==', tableId)
        );
        return getDocs(q);
      });

      await this.run(async () => {
        const batch = writeBatch(this.firestore);
        requisitionsSnapshot.forEach(doc => batch.delete(doc.ref));
        await batch.commit();
      });

      return true;
    } catch (err) {
      console.error('deleteInventoryItem failed', err);
      return false;
    }
  }

  async getUserTables(userId: string): Promise<any[]> {
    try {
      if (!userId) return [];

      const snapshot = await this.run(() => {
        const q = query(
          collection(this.firestore, 'tables'),
          where('user_id', '==', userId)
        );
        return getDocs(q);
      });

      return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    } catch (err) {
      console.error('getUserTables failed', err);
      return [];
    }
  }

  async getUserTablesByType(userId: string, type: 'inventory' | 'requisition' | 'production'): Promise<any[]> {
    try {
      if (!userId) return [];

      const snapshot = await this.run(() => {
        const q = query(
          collection(this.firestore, 'tables'),
          where('user_id', '==', userId),
          where('type', '==', type)
        );
        return getDocs(q);
      });

      return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    } catch (err) {
      console.error('getUserTablesByType failed', err);
      return [];
    }
  }

  async createUserTable(
    data: any,
    type: 'inventory' | 'requisition' | 'production'
  ): Promise<{ success: boolean; tableId?: string }> {
    try {
      const currentUser = await this.auth.getCurrentUserPromise();
      if (!currentUser) {
        return { success: false };
      }

      if (data.user_id !== currentUser.uid) {
        return { success: false };
      }

      const tableData = {
        name: data.name,
        user_id: data.user_id,
        type: type,
        item_count: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };

      const docRef = await this.run(() =>
        addDoc(collection(this.firestore, 'tables'), tableData)
      );

      return { success: true, tableId: docRef.id };
    } catch (err) {
      console.error('createUserTable failed', err);
      return { success: false };
    }
  }

  async getTableById(tableId: string): Promise<{ id: string; name: string } | null> {
    try {
      const tableDoc = await this.run(() =>
        getDoc(doc(this.firestore, 'tables', tableId))
      );

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
      const tableRef = doc(this.firestore, 'tables', tableId);

      const tableDoc = await this.run(() => getDoc(tableRef));
      if (!tableDoc.exists()) return false;

      const tableData = tableDoc.data();
      if (tableData['user_id'] !== userId) {
        return false;
      }

      await this.run(() =>
        updateDoc(tableRef, {
          name,
          updated_at: new Date().toISOString()
        })
      );
      return true;
    } catch (err) {
      console.error('updateTableName failed', err);
      return false;
    }
  }

  async deleteTable(tableId: string, userId: string): Promise<boolean> {
    try {
      const tableRef = doc(this.firestore, 'tables', tableId);

      const tableDoc = await this.run(() => getDoc(tableRef));
      if (!tableDoc.exists()) return false;

      const tableData = tableDoc.data();
      if (tableData['user_id'] !== userId) {
        return false;
      }

      await this.run(async () => {
        const batch = writeBatch(this.firestore);

        const requisitionsSnapshot = await getDocs(
          query(
            collection(this.firestore, 'requisitions'),
            where('table_id', '==', tableId),
            where('user_id', '==', userId)
          )
        );
        requisitionsSnapshot.forEach(doc => batch.delete(doc.ref));

        const inventorySnapshot = await getDocs(
          query(
            collection(this.firestore, 'inventory'),
            where('table_id', '==', tableId),
            where('user_id', '==', userId)
          )
        );
        inventorySnapshot.forEach(doc => batch.delete(doc.ref));

        batch.delete(tableRef);
        await batch.commit();
      });

      return true;
    } catch (err) {
      console.error('deleteTable failed', err);
      return false;
    }
  }

  async getTableRequisitions(tableId: string, userId: string): Promise<any[]> {
    try {
      if (!tableId || !userId) return [];

      const snapshot = await this.run(() => {
        const q = query(
          collection(this.firestore, 'requisitions'),
          where('table_id', '==', tableId),
          where('user_id', '==', userId),
          orderBy('created_at', 'desc')
        );
        return getDocs(q);
      });

      return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    } catch (err) {
      console.error('getTableRequisitions failed', err);
      return [];
    }
  }

  async getUserRequisitions(userId: string): Promise<any[]> {
    try {
      if (!userId) return [];

      const snapshot = await this.run(() => {
        const q = query(
          collection(this.firestore, 'requisitions'),
          where('user_id', '==', userId),
          orderBy('created_at', 'desc')
        );
        return getDocs(q);
      });

      return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    } catch (err) {
      console.error('getUserRequisitions failed', err);
      return [];
    }
  }

  async createRequisition(data: any, materials: any[]): Promise<{ success: boolean; id?: string }> {
    try {
      const requisitionData = {
        ...data,
        materials: materials || [],
        status: data.status || 'Pending',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };

      const docRef = await this.run(() =>
        addDoc(collection(this.firestore, 'requisitions'), requisitionData)
      );

      return { success: true, id: docRef.id };
    } catch (err) {
      console.error('createRequisition failed', err);
      return { success: false };
    }
  }

  async updateRequisition(id: string, data: any, userId: string, tableId: string): Promise<boolean> {
    try {
      const reqRef = doc(this.firestore, 'requisitions', id);

      const reqDoc = await this.run(() => getDoc(reqRef));
      if (!reqDoc.exists()) return false;

      const reqData = reqDoc.data();
      if (reqData['user_id'] !== userId || reqData['table_id'] !== tableId) {
        return false;
      }

      const { reqNumber, ...updateData } = data;

      await this.run(() =>
        updateDoc(reqRef, {
          ...updateData,
          updated_at: new Date().toISOString()
        })
      );

      return true;
    } catch (err) {
      console.error('updateRequisition failed', err);
      return false;
    }
  }

  async updateRequisitionStatus(
    id: string,
    status: string,
    userId: string,
    tableId: string,
    additionalData: any = {}
  ): Promise<boolean> {
    try {
      const reqRef = doc(this.firestore, 'requisitions', id);

      const reqDoc = await this.run(() => getDoc(reqRef));
      if (!reqDoc.exists()) return false;

      const reqData = reqDoc.data();

      if (reqData['user_id'] !== userId && reqData['table_id'] !== tableId) {
        return false;
      }

      const updateData: any = {
        status,
        updated_at: new Date().toISOString(),
        ...additionalData
      };

      switch (status) {
        case 'Submitted':
          updateData.submitted_at = new Date().toISOString();
          break;
        case 'Scheduled':
          updateData.scheduled_at = new Date().toISOString();
          updateData.scheduled_by = userId;
          if (additionalData.scheduled_date) {
            updateData.scheduled_date = additionalData.scheduled_date;
          }
          break;
        case 'Approved':
          updateData.approved_at = new Date().toISOString();
          updateData.approved_by = userId;
          break;
        case 'Rejected':
          updateData.rejected_at = new Date().toISOString();
          updateData.rejected_by = userId;
          break;
        case 'Production_Confirmed':
          updateData.production_confirmed_at = new Date().toISOString();
          updateData.production_confirmed_by = userId;
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

      await this.run(() => updateDoc(reqRef, updateData));
      return true;
    } catch (err) {
      console.error('updateRequisitionStatus failed', err);
      return false;
    }
  }

  async updateRequisitionQty(id: string, qty: number, userId: string, tableId: string): Promise<boolean> {
    try {
      const reqRef = doc(this.firestore, 'requisitions', id);

      const reqDoc = await this.run(() => getDoc(reqRef));
      if (!reqDoc.exists()) return false;

      const reqData = reqDoc.data();
      if (reqData['user_id'] !== userId || reqData['table_id'] !== tableId) {
        return false;
      }

      await this.run(() =>
        updateDoc(reqRef, {
          qty_needed: qty,
          updated_at: new Date().toISOString()
        })
      );
      return true;
    } catch (err) {
      console.error('updateRequisitionQty failed', err);
      return false;
    }
  }

  async updateRequisitionSupplier(id: string, supplier: string, userId: string, tableId: string): Promise<boolean> {
    try {
      const reqRef = doc(this.firestore, 'requisitions', id);

      const reqDoc = await this.run(() => getDoc(reqRef));
      if (!reqDoc.exists()) return false;

      const reqData = reqDoc.data();
      if (reqData['user_id'] !== userId || reqData['table_id'] !== tableId) {
        return false;
      }

      await this.run(() =>
        updateDoc(reqRef, {
          supplier,
          updated_at: new Date().toISOString()
        })
      );
      return true;
    } catch (err) {
      console.error('updateRequisitionSupplier failed', err);
      return false;
    }
  }

  async deleteRequisition(id: string, userId: string, tableId: string): Promise<boolean> {
    try {
      const reqRef = doc(this.firestore, 'requisitions', id);

      const reqDoc = await this.run(() => getDoc(reqRef));
      if (!reqDoc.exists()) return false;

      const reqData = reqDoc.data();
      if (reqData['user_id'] !== userId || reqData['table_id'] !== tableId) {
        return false;
      }

      await this.run(() => deleteDoc(reqRef));
      return true;
    } catch (err) {
      console.error('deleteRequisition failed', err);
      return false;
    }
  }

  async updateTableItemCount(tableId: string, count: number, userId: string): Promise<boolean> {
    try {
      const tableRef = doc(this.firestore, 'tables', tableId);

      const tableDoc = await this.run(() => getDoc(tableRef));
      if (!tableDoc.exists()) return false;

      const tableData = tableDoc.data();
      if (tableData['user_id'] !== userId) {
        return false;
      }

      await this.run(() =>
        updateDoc(tableRef, {
          item_count: count,
          updated_at: new Date().toISOString()
        })
      );
      return true;
    } catch (err) {
      console.error('updateTableItemCount failed', err);
      return false;
    }
  }

  async getRequisitionsByStatus(tableId: string, userId: string, status?: string): Promise<any[]> {
    try {
      if (!tableId || !userId) return [];

      const snapshot = await this.run(() => {
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
        return getDocs(q);
      });

      return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    } catch (err) {
      console.error('getRequisitionsByStatus failed', err);
      return [];
    }
  }

  async getPendingRequisitions(tableId: string, userId: string): Promise<any[]> {
    return this.getRequisitionsByStatus(tableId, userId, 'Pending');
  }

  async getSubmittedRequisitions(tableId: string, userId: string): Promise<any[]> {
    return this.getRequisitionsByStatus(tableId, userId, 'Submitted');
  }

  async getScheduledRequisitions(tableId: string, userId: string): Promise<any[]> {
    return this.getRequisitionsByStatus(tableId, userId, 'Scheduled');
  }

  async getApprovedRequisitions(tableId: string, userId: string): Promise<any[]> {
    return this.getRequisitionsByStatus(tableId, userId, 'Approved');
  }

  async getRejectedRequisitions(tableId: string, userId: string): Promise<any[]> {
    return this.getRequisitionsByStatus(tableId, userId, 'Rejected');
  }

  async getAllRequisitionsByStatus(status: string): Promise<any[]> {
    try {
      const snapshot = await this.run(() => {
        const q = query(
          collection(this.firestore, 'requisitions'),
          where('status', '==', status),
          orderBy('created_at', 'desc')
        );
        return getDocs(q);
      });

      return snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch (err) {
      console.error('getAllRequisitionsByStatus failed', err);
      return [];
    }
  }

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

  async getRequisitionsNeedingAction(userId: string, role: string): Promise<any[]> {
    try {
      if (!userId) return [];

      const tables = await this.getUserTables(userId);
      let allRequisitions: any[] = [];

      for (const table of tables) {
        let q: any;

        if (role === 'user') {
          q = query(
            collection(this.firestore, 'requisitions'),
            where('user_id', '==', userId),
            where('table_id', '==', table.id),
            where('status', '==', 'Pending')
          );
        } else if (role === 'procurement') {
          q = query(
            collection(this.firestore, 'requisitions'),
            where('table_id', '==', table.id),
            where('status', '==', 'Submitted')
          );
        } else if (role === 'admin') {
          q = query(
            collection(this.firestore, 'requisitions'),
            where('table_id', '==', table.id),
            where('status', '==', 'Scheduled')
          );
        } else {
          continue;
        }

        const snapshot = await this.run(() => getDocs(q));
        allRequisitions = [...allRequisitions, ...snapshot.docs.map(doc => ({ id: doc.id, ...(doc.data() as any) }))];
      }

      return allRequisitions;
    } catch (err) {
      console.error('getRequisitionsNeedingAction failed', err);
      return [];
    }
  }

  async getTableSummary(tableId: string, userId: string): Promise<any> {
    try {
      if (!tableId || !userId) return null;

      const inventoryItems = await this.getInventoryItemsByTable(tableId, userId);
      const totalItems = inventoryItems.length;
      const totalQuantity = inventoryItems.reduce((sum, item) => sum + (item.qty || 0), 0);

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

      const tables = await this.getUserTables(userId);
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