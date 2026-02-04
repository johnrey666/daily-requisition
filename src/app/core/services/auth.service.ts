import { Injectable } from '@angular/core';
import { Auth, authState } from '@angular/fire/auth';
import { signInWithEmailAndPassword, signOut, createUserWithEmailAndPassword } from 'firebase/auth';
import { BehaviorSubject, Observable } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class AuthService {
  user$ = new BehaviorSubject<any>(null);

  constructor(private auth: Auth) {
    authState(this.auth).subscribe((u) => this.user$.next(u));
  }

  signIn(email: string, password: string) {
    return signInWithEmailAndPassword(this.auth as any, email, password);
  }

  signOut() {
    return signOut(this.auth as any);
  }

  // Used by admin to create accounts (note: role metadata should be stored in Firestore)
  createUser(email: string, password: string) {
    return createUserWithEmailAndPassword(this.auth as any, email, password);
  }
}
