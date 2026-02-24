# DailyRequisition

This project was generated using [Angular CLI](https://github.com/angular/angular-cli) version 19.2.14.

## Development server

To start a local development server, run:

```bash
ng serve
```

Once the server is running, open your browser and navigate to `http://localhost:4200/`. The application will automatically reload whenever you modify any of the source files.

## Code scaffolding

Angular CLI includes powerful code scaffolding tools. To generate a new component, run:

```bash
ng generate component component-name
```

For a complete list of available schematics (such as `components`, `directives`, or `pipes`), run:

```bash
ng generate --help
```

## Building

To build the project run:

```bash
ng build
```

This will compile your project and store the build artifacts in the `dist/` directory. By default, the production build optimizes your application for performance and speed.

## Running unit tests

To execute unit tests with the [Karma](https://karma-runner.github.io) test runner, use the following command:

```bash
ng test
```

## Running end-to-end tests

For end-to-end (e2e) testing, run:

```bash
ng e2e
```

Angular CLI does not come with an end-to-end testing framework by default. You can choose one that suits your needs.

## Additional Resources

For more information on using the Angular CLI, including detailed command references, visit the [Angular CLI Overview and Command Reference](https://angular.dev/tools/cli) page.

---

## Firebase integration (local setup) 🔧

1. Install dependencies:

```bash
npm install firebase @angular/fire
```

2. Create a Firebase project at https://console.firebase.google.com and enable **Email/Password** sign-in provider.

3. Copy your Firebase config into `src/environments/environment.ts` (replace the placeholder values).

4. (Optional) To create a single admin account quickly, use the Firebase Console > Authentication > Users or run a script with Firebase Admin SDK. For role-based access, this project stores a `role` field in Firestore under `users/{uid}`; for stronger security use Cloud Functions + Admin SDK to set custom claims.

5. Run the app:

```bash
ng serve
```

6. Next steps:
- Add an Admin UI (protected route) where the Admin can call `UserService.createUserAccount(...)` to create procurement users.
- Restrict admin-only routes using a guard that checks Firestore `users/{uid}.role === 'admin'` or use custom claims.

---

If you want, I can install the packages and wire anything else (admin UI, guards, Firestore rules) now. ✅
