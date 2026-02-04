import { Injectable } from '@angular/core';
import { Firestore, collection, addDoc, getDocs, query, where, doc, getDoc, updateDoc, deleteDoc, writeBatch } from 'firebase/firestore';
import { AuthService } from './auth.service';
import { firstValueFrom } from 'rxjs';
import { User } from '../models/database.model';

@Injectable({ providedIn: 'root' })
export class DatabaseService {
  constructor(private firestore: Firestore, private auth: AuthService) {}

  async getCurrentUser(): Promise<User | null> {
    const authUser = await firstValueFrom(this.auth.user$);
    if (!authUser) return null;

    try {
      const uDoc = await getDoc(doc(this.firestore as any, 'users', authUser.uid));
      if (uDoc.exists()) {
        const data = uDoc.data() as any;
        return {
          id: authUser.uid,
          email: data.email || authUser.email || undefined,
          full_name: data.full_name || data.name || undefined,
          username: data.username || undefined,
          role: data.role || undefined
        };
      }

      // Fallback: return authenticated user info
      return { id: authUser.uid, email: authUser.email || undefined } as User;
    } catch (err) {
      console.error('getCurrentUser failed', err);
      return { id: authUser.uid, email: authUser.email || undefined } as User;
    }
  }

  async uploadMasterData(items: any[]): Promise<{ success: boolean; error?: any }> {
    try {
      const batch = writeBatch(this.firestore as any);
      const colRef = collection(this.firestore as any, 'masterData');

      // Add each item as a new doc. For simplicity we use addDoc (can't batch add with writeBatch + addDoc easily),
      // so do individual addDoc calls sequentially.
      for (const item of items) {
        await addDoc(colRef, {
          category: item['CATEGORY'] || '',
          sku_code: item['SKU CODE'] || '',
          sku_name: item['SKU'] || '',
          quantity_per_unit: item['QUANTITY PER UNIT'] || '',
          unit: item['UNIT'] || '',
          quantity_per_pack: item['QUANTITY PER PACK'] || '',
          pack_unit: item['UNIT2'] || '',
          raw_material: item['RAW MATERIAL'] || '',
          quantity_per_batch: item['QUANTITY/BATCH'] || '',
          batch_unit: item['UNIT4'] || '',
          type: item['TYPE'] || ''
        });
      }

      // (we didn't use batch.commit because we used addDoc in loop)
      return { success: true };
    } catch (err) {
      console.error('uploadMasterData failed', err);
      return { success: false, error: err };
    }
  }

  async getMasterData(): Promise<any[]> {
    try {
      const colRef = collection(this.firestore as any, 'masterData');
      const snap = await getDocs(colRef);
      return snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
    } catch (err) {
      console.error('getMasterData failed', err);
      return [];
    }
  }

  async getUserTables(userId: string): Promise<any[]> {
    try {
      const colRef = collection(this.firestore as any, 'tables');
      const q = query(colRef, where('user_id', '==', userId));
      const snap = await getDocs(q);
      return snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
    } catch (err) {
      console.error('getUserTables failed', err);
      return [];
    }
  }

  async createUserTable(data: any): Promise<{ success: boolean; tableId?: string; error?: any }> {
    try {
      const colRef = collection(this.firestore as any, 'tables');
      const res = await addDoc(colRef, data);
      return { success: true, tableId: res.id };
    } catch (err) {
      console.error('createUserTable failed', err);
      return { success: false, error: err };
    }
  }

  async updateTableName(tableId: string, name: string): Promise<{ success: boolean; error?: any }> {
    try {
      await updateDoc(doc(this.firestore as any, 'tables', tableId), { name, updated_at: new Date().toISOString() });
      return { success: true };
    } catch (err) {
      console.error('updateTableName failed', err);
      return { success: false, error: err };
    }
  }

  async deleteTable(tableId: string): Promise<{ success: boolean; error?: any }> {
    try {
      // delete all requisitions referencing this table
      const reqCol = collection(this.firestore as any, 'requisitions');
      const q = query(reqCol, where('table_id', '==', tableId));
      const snap = await getDocs(q);
      const batch = writeBatch(this.firestore as any);
      snap.docs.forEach(d => batch.delete(doc(this.firestore as any, 'requisitions', d.id)));
      batch.delete(doc(this.firestore as any, 'tables', tableId));
      await batch.commit();
      return { success: true };
    } catch (err) {
      console.error('deleteTable failed', err);
      return { success: false, error: err };
    }
  }

  async getTableRequisitions(tableId: string): Promise<any[]> {
    try {
      const colRef = collection(this.firestore as any, 'requisitions');
      const q = query(colRef, where('table_id', '==', tableId));
      const snap = await getDocs(q);
      return snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
    } catch (err) {
      console.error('getTableRequisitions failed', err);
      return [];
    }
  }

  async createRequisition(requisitionData: any, materials: any[]): Promise<{ success: boolean; requisitionId?: string; error?: any }> {
    try {
      const colRef = collection(this.firestore as any, 'requisitions');
      const payload = { ...requisitionData, materials, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
      const res = await addDoc(colRef, payload);
      return { success: true, requisitionId: res.id };
    } catch (err) {
      console.error('createRequisition failed', err);
      return { success: false, error: err };
    }
  }

  async updateRequisitionQty(requisitionId: string, qty: number): Promise<{ success: boolean; error?: any }> {
    try {
      await updateDoc(doc(this.firestore as any, 'requisitions', requisitionId), { qty_needed: qty, updated_at: new Date().toISOString() });
      return { success: true };
    } catch (err) {
      console.error('updateRequisitionQty failed', err);
      return { success: false, error: err };
    }
  }

  async updateRequisitionSupplier(requisitionId: string, supplier: string): Promise<{ success: boolean; error?: any }> {
    try {
      await updateDoc(doc(this.firestore as any, 'requisitions', requisitionId), { supplier, updated_at: new Date().toISOString() });
      return { success: true };
    } catch (err) {
      console.error('updateRequisitionSupplier failed', err);
      return { success: false, error: err };
    }
  }

  async deleteRequisition(requisitionId: string): Promise<{ success: boolean; error?: any }> {
    try {
      await deleteDoc(doc(this.firestore as any, 'requisitions', requisitionId));
      return { success: true };
    } catch (err) {
      console.error('deleteRequisition failed', err);
      return { success: false, error: err };
    }
  }

  async updateTableItemCount(tableId: string, count: number): Promise<{ success: boolean; error?: any }> {
    try {
      await updateDoc(doc(this.firestore as any, 'tables', tableId), { item_count: count, updated_at: new Date().toISOString() });
      return { success: true };
    } catch (err) {
      console.error('updateTableItemCount failed', err);
      return { success: false, error: err };
    }
  }
}
