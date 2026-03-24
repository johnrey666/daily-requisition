// src/app/core/services/email-notification.service.ts

import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { AuthService } from './auth.service';
import { Firestore, collection, query, where, getDocs, doc, getDoc } from '@angular/fire/firestore';

export interface TableSubmittedData {
  tableName: string;
  userEmail: string;
  submittedAt: string;
  items: Array<{
    skuName: string;
    skuCode: string;
    quantity: number;
    unit: string;
  }>;
  tableId: string;
  itemCount: number;
  reviewLink: string;
  recipientEmail?: string; // Optional - will be fetched from user roles if not provided
}

export interface TableReviewedData {
  tableName: string;
  reviewerEmail: string;
  reviewedAt: string;
  totalItems: number;
  confirmedItems: number;
  removedItems: number;
  tableId: string;
  reviewLink: string;
  recipientEmail?: string; // Optional - will be fetched from user roles if not provided
}

export interface EmailResponse {
  success: boolean;
  message: string;
  type?: string;
  recipient?: string;
  timestamp?: string;
  error?: string;
}

@Injectable({
  providedIn: 'root'
})
export class EmailNotificationService {
  private readonly SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbwVjWji1fgz3SZwPVJGWPCkYXct-nK9Ldbe1ZFwO8jHbBbGq9Lox7T0J_v1Ubwv3ONt/exec';
  
  // Cache for user emails to avoid repeated Firestore calls
  private userEmailCache: Map<string, string[]> = new Map();

  constructor(
    private http: HttpClient,
    private auth: AuthService,
    private firestore: Firestore
  ) {}

  /**
   * Get all users with a specific role
   */
  async getUsersByRole(role: string): Promise<string[]> {
    // Check cache first
    if (this.userEmailCache.has(role)) {
      return this.userEmailCache.get(role) || [];
    }
    
    try {
      // Query users collection for users with the specified role
      const usersRef = collection(this.firestore, 'users');
      const q = query(usersRef, where('role', '==', role));
      const querySnapshot = await getDocs(q);
      
      const emails: string[] = [];
      querySnapshot.forEach((doc: any) => {
        const data = doc.data();
        if (data['email']) {
          emails.push(data['email']);
        }
      });
      
      // Cache the result
      this.userEmailCache.set(role, emails);
      
      return emails;
    } catch (error) {
      console.error(`Error fetching users with role ${role}:`, error);
      return [];
    }
  }

  /**
   * Get production team emails
   */
  async getProductionEmails(): Promise<string[]> {
    return this.getUsersByRole('production');
  }

  /**
   * Get procurement team emails
   */
  async getProcurementEmails(): Promise<string[]> {
    return this.getUsersByRole('procurement');
  }

  /**
   * Send table submitted notification to ALL Production team members
   */
  async sendTableSubmittedNotification(data: TableSubmittedData): Promise<EmailResponse[]> {
    try {
      console.log('Sending table submitted notification:', data.tableName);
      
      // Get all production team emails
      let productionEmails = await this.getProductionEmails();
      
      // If no production users found, use fallback or provided email
      if (productionEmails.length === 0) {
        console.warn('No production users found, using fallback email');
        productionEmails = [data.recipientEmail || 'production@yourdomain.com'];
      }
      
      // Create items list HTML and plain text for the email
      const itemsListHtml = this.createItemsListHtml(data.items);
      const itemsListPlain = this.createItemsListPlain(data.items);
      
      // Send to each production team member
      const results: EmailResponse[] = [];
      
      for (const productionEmail of productionEmails) {
        try {
          // Prepare request payload
          const payload: any = {
            emailType: 'table_submitted',
            to: productionEmail,
            tableName: data.tableName,
            userEmail: data.userEmail,
            submittedAt: data.submittedAt,
            itemCount: data.itemCount,
            reviewLink: data.reviewLink,
            items: data.items,
            itemsListHtml: itemsListHtml,
            itemsListPlain: itemsListPlain
          };
          
          // Convert to plain object for HttpParams
          const params = this.buildHttpParams(payload);
          
          const response = await firstValueFrom(
            this.http.get<EmailResponse>(this.SCRIPT_URL, { params })
          );
          
          results.push(response);
          console.log(`Email sent to ${productionEmail}:`, response);
          
        } catch (error: any) {
          console.error(`Failed to send email to ${productionEmail}:`, error);
          results.push({
            success: false,
            error: `Failed to send to ${productionEmail}: ${error?.message || 'Unknown error'}`,
            message: 'Partial failure'
          });
        }
      }
      
      return results;
      
    } catch (error: any) {
      console.error('Failed to send email notifications:', error);
      return [{
        success: false,
        error: error?.message || 'Unknown error occurred',
        message: 'Failed to send email notifications'
      }];
    }
  }

  /**
   * Send table reviewed notification to ALL Procurement team members
   */
  async sendTableReviewedNotification(data: TableReviewedData): Promise<EmailResponse[]> {
    try {
      console.log('Sending table reviewed notification:', data.tableName);
      
      // Get all procurement team emails
      let procurementEmails = await this.getProcurementEmails();
      
      // If no procurement users found, use fallback or provided email
      if (procurementEmails.length === 0) {
        console.warn('No procurement users found, using fallback email');
        procurementEmails = [data.recipientEmail || 'procurement@yourdomain.com'];
      }
      
      // Prepare request payload (same for all recipients)
      const payload: any = {
        emailType: 'table_reviewed',
        tableName: data.tableName,
        reviewerEmail: data.reviewerEmail,
        reviewedAt: data.reviewedAt,
        totalItems: data.totalItems,
        confirmedItems: data.confirmedItems,
        removedItems: data.removedItems,
        reviewLink: data.reviewLink
      };
      
      // Send to each procurement team member
      const results: EmailResponse[] = [];
      
      for (const procurementEmail of procurementEmails) {
        try {
          // Add recipient to payload
          const emailPayload = { ...payload, to: procurementEmail };
          
          // Convert to plain object for HttpParams
          const params = this.buildHttpParams(emailPayload);
          
          const response = await firstValueFrom(
            this.http.get<EmailResponse>(this.SCRIPT_URL, { params })
          );
          
          results.push(response);
          console.log(`Email sent to ${procurementEmail}:`, response);
          
        } catch (error: any) {
          console.error(`Failed to send email to ${procurementEmail}:`, error);
          results.push({
            success: false,
            error: `Failed to send to ${procurementEmail}: ${error?.message || 'Unknown error'}`,
            message: 'Partial failure'
          });
        }
      }
      
      return results;
      
    } catch (error: any) {
      console.error('Failed to send email notifications:', error);
      return [{
        success: false,
        error: error?.message || 'Unknown error occurred',
        message: 'Failed to send email notifications'
      }];
    }
  }

  /**
   * Build HttpParams from an object, handling nested objects
   */
  private buildHttpParams(obj: any): HttpParams {
    let params = new HttpParams();
    
    for (const key in obj) {
      if (obj.hasOwnProperty(key) && obj[key] !== undefined && obj[key] !== null) {
        const value = obj[key];
        
        if (typeof value === 'object') {
          // Convert objects to JSON strings
          params = params.set(key, JSON.stringify(value));
        } else {
          params = params.set(key, String(value));
        }
      }
    }
    
    return params;
  }

  /**
   * Create HTML list of items for email
   */
  private createItemsListHtml(items: any[]): string {
    if (!items || items.length === 0) {
      return '<div class="items-list-item">No items to display</div>';
    }
    
    let html = '';
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      html += `
        <div class="items-list-item">
          <div style="flex: 3;">${this.escapeHtml(item.skuName)} (${this.escapeHtml(item.skuCode)})</div>
          <div style="flex: 1;">${item.quantity || 0}</div>
          <div style="flex: 1;">${this.escapeHtml(item.unit || 'units')}</div>
        </div>
      `;
    }
    return html;
  }

  /**
   * Create plain text list of items for email
   */
  private createItemsListPlain(items: any[]): string {
    if (!items || items.length === 0) {
      return '• No items to display';
    }
    
    let text = '';
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      text += `${i + 1}. ${item.skuName} (${item.skuCode}): ${item.quantity || 0} ${item.unit || 'units'}\n`;
    }
    return text;
  }

  /**
   * Escape HTML special characters
   */
  private escapeHtml(text: string): string {
    if (!text) return '';
    const map: { [key: string]: string } = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    };
    return text.replace(/[&<>"']/g, (m) => map[m]);
  }

  /**
   * Clear the user email cache (useful after user role updates)
   */
  clearCache(): void {
    this.userEmailCache.clear();
  }
}