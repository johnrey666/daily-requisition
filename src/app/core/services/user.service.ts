import { Injectable } from '@angular/core';
import { Firestore } from '@angular/fire/firestore';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { AuthService } from './auth.service';

@Injectable({ providedIn: 'root' })
export class UserService {
  constructor(private firestore: Firestore, private authService: AuthService) {}

  /**
   * Create a user account (to be called from Admin UI). This will create the Auth account
   * and then add a user document to Firestore with a `role` field. For production, consider
   * using Cloud Functions + Admin SDK to set secure custom claims instead of storing roles in Firestore.
   */
  async createUserAccount(email: string, password: string, role: string = 'procurement') {
    const cred = await this.authService.createUser(email, password);
    const uid = cred.user.uid;

    try {
      // Use path segments to avoid the "Expected first argument to collection()" error
      const userRef = doc(this.firestore as any, 'users', uid);
      await setDoc(userRef, {
        email,
        role,
        createdAt: serverTimestamp(),
      });
    } catch (err) {
      console.error('createUserAccount failed', err);
      throw err;
    }

    return cred;
  }
}
