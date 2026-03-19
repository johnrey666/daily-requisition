import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [RouterLink],
  template: `
    <div class="home-container">
      <h1>Welcome to Daily Requisition</h1>
      <p>You have successfully signed in.</p>
      <a routerLink="/login" class="logout-link">Sign out</a>
    </div>
  `,
  styles: [`
    .home-container {
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 2rem;
      background: linear-gradient(135deg, hsl(var(--muted)) 0%, hsl(var(--background)) 100%);
      color: hsl(var(--foreground));
    }
    h1 { font-size: 2rem; color: hsl(var(--foreground)); margin: 0 0 0.5rem 0; }
    p { color: hsl(var(--muted-foreground)); margin: 0 0 1.5rem 0; }
    .logout-link {
      color: hsl(var(--primary));
      text-decoration: none;
      font-weight: 500;
    }
    .logout-link:hover { text-decoration: underline; }
  `]
})
export class HomeComponent {}
