/**
 * What the firm puts on its own paper, as an injection token.
 *
 * A value rather than a service: it comes from configuration the composition
 * root already reads, and the controller only hands it to the browser.
 */
export const FirmProfileToken = Symbol('amc.billing.firm-profile');
