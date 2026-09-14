/**
 * The schema registry.
 *
 * Each module owns its own tables and exports them from its infrastructure
 * layer; this file re-exports them so Drizzle Kit can diff the whole database
 * at once, and so foreign keys can span modules in SQL even though the code
 * never crosses that line.
 *
 * Identity arrives in P0-08 and the audit log in P0-11.
 */
export {};
