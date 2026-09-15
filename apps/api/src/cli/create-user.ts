import { createDatabase } from '@amc/database';
import { RegisterUser } from '@amc/identity';
import { ROLES, type Role } from '@amc/identity/domain';
import { Argon2PasswordHasher, DrizzleUserRepository } from '@amc/identity/infrastructure';
import { SystemClock } from '@amc/kernel';
import { ulid } from 'ulid';
import { readEnvironment } from '../config/env.js';

/**
 * Creates a user from the command line. Without this there is no way into a
 * fresh installation, since the only screen that can create users is behind
 * the sign-in that needs one to exist.
 *
 *   pnpm --filter @amc/api create-user wael@activemanagement.ae "Wael Ajam" manager
 *
 * The password is read from AMC_PASSWORD rather than an argument, because an
 * argument is visible in the process list and is kept in shell history.
 */
async function main(): Promise<void> {
  const [email, displayName, ...roleArguments] = process.argv.slice(2);
  const password = process.env.AMC_PASSWORD;

  if (!email || !displayName || roleArguments.length === 0) {
    process.stderr.write(
      `Usage: AMC_PASSWORD=... create-user <email> <display name> <role...>\nRoles: ${ROLES.join(', ')}\n`,
    );
    process.exit(1);
  }
  if (!password) {
    process.stderr.write(
      'Set AMC_PASSWORD. Passing a password as an argument leaks it into the process list and your shell history.\n',
    );
    process.exit(1);
  }

  const unknown = roleArguments.filter((role) => !ROLES.includes(role as Role));
  if (unknown.length > 0) {
    process.stderr.write(`Unknown role(s): ${unknown.join(', ')}. Known: ${ROLES.join(', ')}\n`);
    process.exit(1);
  }

  const environment = readEnvironment();
  const { db, close } = createDatabase({ url: environment.DATABASE_URL, maxConnections: 1 });

  try {
    const register = new RegisterUser(
      new DrizzleUserRepository(db),
      new Argon2PasswordHasher(),
      new SystemClock(),
      { next: () => ulid() },
    );
    const outcome = await register.execute({
      email,
      displayName,
      password,
      roles: roleArguments as Role[],
    });

    if (!outcome.ok) {
      process.stderr.write(`${outcome.error.message}\n`);
      process.exit(1);
    }
    process.stdout.write(
      `Created ${email} as ${roleArguments.join(', ')} (${outcome.value.userId})\n`,
    );
  } finally {
    await close();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`Failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
