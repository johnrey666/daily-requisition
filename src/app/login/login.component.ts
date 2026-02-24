// src/app/login/login.component.ts
import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../core/services/auth.service';
import { UserService } from '../core/services/user.service';
import { Firestore, doc, getDoc } from '@angular/fire/firestore';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './login.component.html',
  styleUrl: './login.component.css',
})
export class LoginComponent {
  loginForm: FormGroup;
  isSubmitting = false;
  showPassword = false;
  authError: string | null = null;

  constructor(
    private fb: FormBuilder,
    private router: Router,
    private authService: AuthService,
    private userService: UserService,
    private firestore: Firestore
  ) {
    this.loginForm = this.fb.nonNullable.group({
      email: ['', [Validators.required, Validators.email]],
      password: ['', [Validators.required, Validators.minLength(6)]],
      rememberMe: [false],
    });
  }

  get email() {
    return this.loginForm.get('email');
  }

  get password() {
    return this.loginForm.get('password');
  }

  togglePassword(): void {
    this.showPassword = !this.showPassword;
  }

  async onSubmit(): Promise<void> {
    if (this.loginForm.invalid) {
      this.loginForm.markAllAsTouched();
      return;
    }

    this.isSubmitting = true;
    this.authError = null;

    const { email, password } = this.loginForm.getRawValue();

    try {
      const res = await this.authService.signIn(email, password);
      
      // Get user role to redirect to appropriate dashboard
      const user = res.user;
      if (user) {
        const userDoc = await getDoc(doc(this.firestore, 'users', user.uid));
        let role = 'user';
        
        if (userDoc.exists()) {
          const data = userDoc.data() as any;
          role = data['role'] || 'user';
        }
        
        console.log('User role:', role);
        
        // If admin, store password temporarily for user creation
        if (role === 'admin') {
          this.userService.storeAdminPassword(password);
        }
        
        this.isSubmitting = false;
        
        // Redirect based on role
        switch(role) {
          case 'store':
            await this.router.navigate(['/dashboard/store']);
            break;
          case 'production':
            await this.router.navigate(['/dashboard/production']);
            break;
          case 'procurement':
            await this.router.navigate(['/dashboard/procurement']);
            break;
          case 'admin':
            await this.router.navigate(['/dashboard/users']);
            break;
          default:
            await this.router.navigate(['/dashboard']);
        }
      }
    } catch (err: any) {
      console.error('Sign in error', err);
      this.isSubmitting = false;
      
      if (err.code === 'auth/user-not-found') {
        this.authError = 'No account found with this email';
      } else if (err.code === 'auth/wrong-password') {
        this.authError = 'Incorrect password';
      } else if (err.code === 'auth/invalid-email') {
        this.authError = 'Invalid email format';
      } else if (err.code === 'auth/too-many-requests') {
        this.authError = 'Too many failed attempts. Please try again later';
      } else {
        this.authError = err?.message || 'Sign in failed';
      }
    }
  }
}