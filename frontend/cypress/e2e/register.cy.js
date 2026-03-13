/* eslint-disable no-undef */
// cypress/e2e/register.cy.js

describe('Register Page E2E', () => {
  const baseUrl = 'http://localhost:5173';

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

    // After success, your code does navigate(ROUTES.login)
    cy.url().should('include', '/login');
  });
});
