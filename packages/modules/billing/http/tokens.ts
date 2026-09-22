/**
 * The statement repository, as an injection token.
 *
 * A symbol rather than the class, because the controller depends on the port
 * and the composition root decides the adapter — and an interface cannot be a
 * Nest provider on its own.
 */
export const StatementRepositoryToken = Symbol('amc.billing.statements');

/**
 * What the firm puts on its own paper, as an injection token.
 *
 * A value rather than a service: it comes from configuration the composition
 * root already reads, and the controller only hands it to the browser.
 */
export const FirmProfileToken = Symbol('amc.billing.firm-profile');
