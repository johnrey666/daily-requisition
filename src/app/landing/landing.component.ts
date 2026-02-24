import { Component, ElementRef, ViewChildren, QueryList, AfterViewInit, Inject, PLATFORM_ID } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-landing',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './landing.component.html',
  styleUrls: ['./landing.component.css']
})
export class LandingComponent implements AfterViewInit {
  @ViewChildren('animateOnScroll') animatedElements!: QueryList<ElementRef>;
  currentYear = new Date().getFullYear();
  
  // Add platform ID injection for SSR detection
  constructor(@Inject(PLATFORM_ID) private platformId: Object) {}

  ngAfterViewInit(): void {
    this.setupScrollAnimations();
  }

  private setupScrollAnimations(): void {
    // Only run in browser environment
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }

    // Check if IntersectionObserver is available
    if (typeof IntersectionObserver === 'undefined') {
      console.warn('IntersectionObserver not supported - showing all elements');
      this.showAllElements();
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('visible');
            // Unobserve after becoming visible for better performance
            observer.unobserve(entry.target);
          }
        });
      },
      { 
        threshold: 0.1, 
        rootMargin: '0px 0px -50px 0px' 
      }
    );

    // Use setTimeout to ensure DOM is fully rendered
    setTimeout(() => {
      if (this.animatedElements) {
        this.animatedElements.forEach((el) => {
          if (el?.nativeElement) {
            observer.observe(el.nativeElement);
          }
        });
      } else {
        // Fallback: query all elements with animate-on-scroll class
        const elements = document.querySelectorAll('.animate-on-scroll, [animateOnScroll]');
        elements.forEach((el) => observer.observe(el));
      }
    }, 100);
  }

  private showAllElements(): void {
    // Fallback for browsers without IntersectionObserver or SSR
    setTimeout(() => {
      if (this.animatedElements) {
        this.animatedElements.forEach((el) => {
          if (el?.nativeElement) {
            el.nativeElement.classList.add('visible');
          }
        });
      } else {
        const elements = document.querySelectorAll('.animate-on-scroll, [animateOnScroll]');
        elements.forEach((el) => el.classList.add('visible'));
      }
    }, 100);
  }

  // Helper method to check if we're in browser
  isBrowser(): boolean {
    return isPlatformBrowser(this.platformId);
  }
}