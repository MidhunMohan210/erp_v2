/* eslint-disable no-undef */
// cypress/e2e/register.cy.js

// cypress/e2e/register.cy.js

describe('Register Page E2E', () => {
  const baseUrl = 'http://localhost:5173';

  // Clear test DB before each test
  beforeEach(() => {
    cy.request('DELETE', 'http://localhost:4000/api/test/reset-all');
  });


  it('registers a new user successfully', () => {
    const unique = Date.now();
    const email = `testuser+${unique}@example.com`;

    cy.visit(`${baseUrl}/register`);

    cy.get('[data-testid="userName-input"]').type('Test User');
    cy.get('[data-testid="mobile-input"]').type('9876543210');
    cy.get('[data-testid="email-input"]').type(email);
    cy.get('[data-testid="password-input"]').type('Test@1234');
    cy.get('[data-testid="confirmPassword-input"]').type('Test@1234');
    cy.get('[data-testid="terms-checkbox"]').check();

    cy.get('[data-testid="register-submit"]').click();

    // After success, your code should navigate to login
    cy.url({ timeout: 10000 }).should('include', '/login');
  });

  it('shows error when email already exists', () => {
    const email = 'duplicateemail@example.com';

    // 1st register: create user with this email
    cy.visit(`${baseUrl}/register`);

    cy.get('[data-testid="userName-input"]').type('Dup Email User 1');
    cy.get('[data-testid="mobile-input"]').type('9999999999');
    cy.get('[data-testid="email-input"]').type(email);
    cy.get('[data-testid="password-input"]').type('Test@1234');
    cy.get('[data-testid="confirmPassword-input"]').type('Test@1234');
    cy.get('[data-testid="terms-checkbox"]').check();

    cy.get('[data-testid="register-submit"]').click();
    cy.url({ timeout: 10000 }).should('include', '/login');

    // 2nd register: same email, different mobile
    cy.visit(`${baseUrl}/register`);

    cy.get('[data-testid="userName-input"]').type('Dup Email User 2');
    cy.get('[data-testid="mobile-input"]').type('8888888888');
    cy.get('[data-testid="email-input"]').type(email); // same email
    cy.get('[data-testid="password-input"]').type('Test@1234');
    cy.get('[data-testid="confirmPassword-input"]').type('Test@1234');
    cy.get('[data-testid="terms-checkbox"]').check();

    cy.get('[data-testid="register-submit"]').click();

    cy.contains('Email or mobile already registered').should('be.visible');
  });

  it('shows error when mobile number already exists', () => {
    const mobile = '7777777777';

    // 1st register: create user with this mobile
    cy.visit(`${baseUrl}/register`);

    cy.get('[data-testid="userName-input"]').type('Dup Mobile User 1');
    cy.get('[data-testid="mobile-input"]').type(mobile);
    cy.get('[data-testid="email-input"]').type('mobileuser1@example.com');
    cy.get('[data-testid="password-input"]').type('Test@1234');
    cy.get('[data-testid="confirmPassword-input"]').type('Test@1234');
    cy.get('[data-testid="terms-checkbox"]').check();

    cy.get('[data-testid="register-submit"]').click();
    cy.url({ timeout: 10000 }).should('include', '/login');

    // 2nd register: same mobile, different email
    cy.visit(`${baseUrl}/register`);

    cy.get('[data-testid="userName-input"]').type('Dup Mobile User 2');
    cy.get('[data-testid="mobile-input"]').type(mobile); // same mobile
    cy.get('[data-testid="email-input"]').type('mobileuser2@example.com'); // different email
    cy.get('[data-testid="password-input"]').type('Test@1234');
    cy.get('[data-testid="confirmPassword-input"]').type('Test@1234');
    cy.get('[data-testid="terms-checkbox"]').check();

    cy.get('[data-testid="register-submit"]').click();

    cy.contains('Email or mobile already registered').should('be.visible');
  });
});

