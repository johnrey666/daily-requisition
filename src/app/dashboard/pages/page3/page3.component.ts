import { Component } from '@angular/core';

@Component({
  selector: 'app-page3',
  standalone: true,
  templateUrl: './page3.component.html',
  styleUrls: ['./page3.component.css']
})
export class Page3Component {
  showModal = false;
  selectedPriority: string = 'medium';

  openModal() {
    this.showModal = true;
    document.body.style.overflow = 'hidden'; // Prevent scrolling
  }

  closeModal() {
    this.showModal = false;
    document.body.style.overflow = ''; // Re-enable scrolling
  }

  selectPriority(priority: string) {
    this.selectedPriority = priority;
  }
}