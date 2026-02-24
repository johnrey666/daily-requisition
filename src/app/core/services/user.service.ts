// src/app/core/services/user.service.ts
import { Injectable } from '@angular/core';
import { Firestore, doc, setDoc, serverTimestamp } from '@angular/fire/firestore';
import { Auth, createUserWithEmailAndPassword, signInWithEmailAndPassword } from '@angular/fire/auth';

@Injectable({ providedIn: 'root' })
export class UserService {
  constructor(
    private firestore: Firestore,
    private auth: Auth
  ) {}

  /**
   * Create a user account (to be called from Admin UI). This will create the Auth account
   * and then add a user document to Firestore with a `role` field.
   * After creating, it signs back in as the admin.
   */
  async createUserAccount(email: string, password: string, role: string = 'user') {
    // Get current user before creating new one
    const currentUser = this.auth.currentUser;
    if (!currentUser) {
      throw new Error('No authenticated user');
    }

    // Store current user's email
    const adminEmail = currentUser.email;
    
    // Get admin password from sessionStorage (stored during login)
    const adminPassword = sessionStorage.getItem('adminPassword');
    
    if (!adminEmail || !adminPassword) {
      throw new Error('Admin credentials not available. Please log in again.');
    }

    try {
      console.log('Creating new user:', email);
      
      // Create new user (this will temporarily sign out the admin)
      const cred = await createUserWithEmailAndPassword(this.auth, email, password);
      const uid = cred.user.uid;
      console.log('New user created with UID:', uid);

      // Create user document in Firestore
      const userRef = doc(this.firestore, 'users', uid);
      await setDoc(userRef, {
        email,
        role,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
      console.log('User document created in Firestore');

      // Sign back in as admin
      console.log('Signing back in as admin:', adminEmail);
      await signInWithEmailAndPassword(this.auth, adminEmail, adminPassword);
      console.log('Successfully signed back in as admin');

      return cred;
    } catch (err) {
      console.error('createUserAccount failed', err);
      throw err;
    }
  }

  // Call this after admin login to store password temporarily
  storeAdminPassword(password: string) {
    sessionStorage.setItem('adminPassword', password);
  }

  // Call this on logout to clear stored password
  clearAdminPassword() {
    sessionStorage.removeItem('adminPassword');
  }
}