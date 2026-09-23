/**
 * Where somebody's working hours are written.
 *
 * A symbol rather than a class, because the table belongs to the
 * time-tracking module and the composition root decides the adapter. An
 * interface cannot be a Nest provider on its own.
 */
export const WORKING_HOURS_WRITER = Symbol('amc.identity.working-hours');
