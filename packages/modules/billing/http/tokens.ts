/**
 * The statement repository, as an injection token.
 *
 * A symbol rather than the class, because the controller depends on the port
 * and the composition root decides the adapter — and an interface cannot be a
 * Nest provider on its own.
 */
export const StatementRepositoryToken = Symbol('amc.billing.statements');
