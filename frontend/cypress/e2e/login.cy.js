/* eslint-disable no-undef */

// cypress/e2e/login.cy.js

describe('Login Page E2E', () => {
  const baseUrl = 'http://localhost:5173';

  // shared valid user
  const email = 'loginuser@example.com';
  const mobile = '9999999999';
  const password = 'Test@1234';

  // Run ONCE before all tests in this file
  before(() => {
    // 1) clear entire test DB so we start clean
    cy.request('DELETE', 'http://localhost:4000/api/test/reset-all');

    // 2) create a user directly via backend API
    cy.request('POST', 'http://localhost:4000/api/auth/register', {
      userName: 'Login User',
      mobileNumber: mobile,
      email,
      password,
      confirmPassword: password,
    });
  });

  it('shows validation errors when fields are empty', () => {
    cy.visit(`${baseUrl}/login`);

    // click submit without typing anything
    cy.get('[data-testid="login-submit"]').click();

    // Zod + react-hook-form should show required messages
    cy.contains('Email or Phone is required').should('be.visible');
    cy.contains('Password is required').should('be.visible');
  });

  it('rejects invalid email or phone / password', () => {
    cy.visit(`${baseUrl}/login`);

    // use existing email but wrong password
    cy.get('[data-testid="identifier-input"]').type(email);
    cy.get('[data-testid="password-input"]').type('Wrong@1234');
    cy.get('[data-testid="login-submit"]').click();

    // Backend returns 401 "Invalid credentials"
    cy.contains('Invalid credentials').should('be.visible');

    // optional: wrong identifier
    cy.get('[data-testid="identifier-input"]').clear().type('unknown@example.com');
    cy.get('[data-testid="password-input"]').clear().type(password);
    cy.get('[data-testid="login-submit"]').click();

    cy.contains('User not found').should('be.visible');
  });

  it('logs in successfully and redirects to home, storing token cookie', () => {
    cy.visit(`${baseUrl}/login`);

    cy.get('[data-testid="identifier-input"]').type(email); // can also test mobile here
    cy.get('[data-testid="password-input"]').type(password);
    cy.get('[data-testid="login-submit"]').click();

    // 1) redirect: your code does navigate(ROUTES.home)
    cy.url({ timeout: 10000 }).should('include', '/'); // or whatever ROUTES.home is (e.g. '/dashboard')

    // 2) cookie: backend sets cookie "erp_v2"
    cy.getCookie('erp_v2').should('exist');
  });
});
