import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../core/services/auth.service';

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

  constructor(
    private fb: FormBuilder,
    private router: Router,
    private authService: AuthService
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

  authError: string | null = null;

  onSubmit(): void {
    if (this.loginForm.invalid) {
      this.loginForm.markAllAsTouched();
      return;
    }

    this.isSubmitting = true;
    this.authError = null;

    const { email, password } = this.loginForm.getRawValue();

    console.log('Login submit', { email });

    this.authService.signIn(email, password)
      .then((res) => {
        console.log('Sign in success', res);
        this.isSubmitting = false;
        this.router.navigate(['/dashboard']).catch((navErr) => {
          console.error('Navigate to dashboard failed', navErr);
          this.authError = 'Navigation failed';
        });
      })
      .catch((err: any) => {
        console.error('Sign in error', err);
        this.isSubmitting = false;
        this.authError = err?.message || 'Sign in failed';
      });
  }
}
