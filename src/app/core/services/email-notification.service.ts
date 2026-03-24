// src/app/core/services/email-notification.service.ts

import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

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
}

@Injectable({
  providedIn: 'root'
})
export class EmailNotificationService {
  // Your Google Apps Script Web App URL
  private readonly SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbzLvCnFI-xbisFLQNj4nIfRjRrLEnyjv-u144oPEv5OWH7tvR6kD-_ECEJliTfCgjJvLg/exec';

  constructor(private http: HttpClient) {}

  async sendTableSubmittedNotification(data: TableSubmittedData): Promise<any> {
    try {
      const response = await firstValueFrom(
        this.http.post(this.SCRIPT_URL, {
          type: 'table_submitted',
          payload: data
        })
      );
      console.log('Email notification sent:', response);
      return response;
    } catch (error: any) {
      console.error('Failed to send email notification:', error);
      return { success: false, error: error?.message || 'Unknown error' };
    }
  }

  async sendTableReviewedNotification(data: TableReviewedData): Promise<any> {
    try {
      const response = await firstValueFrom(
        this.http.post(this.SCRIPT_URL, {
          type: 'table_reviewed',
          payload: data
        })
      );
      console.log('Email notification sent:', response);
      return response;
    } catch (error: any) {
      console.error('Failed to send email notification:', error);
      return { success: false, error: error?.message || 'Unknown error' };
    }
  }
}