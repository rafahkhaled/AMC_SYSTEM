import { createDatabase } from '@amc/database';
import { EmailAddress, checkPassword } from '@amc/identity/domain';
import {
  Argon2PasswordHasher,
  DrizzleSessionRepository,
  DrizzleUserRepository,
} from '@amc/identity/infrastructure';
import { readEnvironment } from '../config/env.js';

/**
 * Sets a new password for somebody who cannot sign in, from the command line.
 *
 *   AMC_PASSWORD=... node dist/cli/reset-password.js wael@activemanagement.ae
 *
 * For the person who has locked themselves out of a fresh installation, where
 * there is no other administrator to do it from Staff and no mail transport to
 * send a link. It runs on the server, so it is as trusted as whoever can reach
 * the server: that is the point. It also clears any lockout and signs the
 * account out everywhere, so a password that was guessed or shared stops
 * working the moment it is replaced.
 *
 * The password comes from AMC_PASSWORD rather than an argument, because an
 * argument is visible in the process list and is kept in shell history.
 */
async function main(): Promise<void> {
  const [rawEmail] = process.argv.slice(2);
  const password = process.env.AMC_PASSWORD;

  if (!rawEmail) {
    process.stderr.write('Usage: AMC_PASSWORD=... reset-password <email>\n');
    process.exit(1);
  }
  if (!password) {
    process.stderr.write(
      'Set AMC_PASSWORD. Passing a password as an argument leaks it into the process list and your shell history.\n',
    );
    process.exit(1);
  }

  const email = EmailAddress.of(rawEmail);
  if (!email.ok) {
    process.stderr.write(`${email.error.message}\n`);
    process.exit(1);
  }
  const acceptable = checkPassword(password, { email: email.value.value });
  if (!acceptable.ok) {
    process.stderr.write(`${acceptable.error.message}\n`);
    process.exit(1);
  }

  const environment = readEnvironment();
  const { db, close } = createDatabase({ url: environment.DATABASE_URL, maxConnections: 1 });

  try {
    const users = new DrizzleUserRepository(db);
    const user = await users.findByEmail(email.value);
    if (!user) {
      process.stderr.write('No account uses that email address.\n');
      process.exit(1);
    }

    const now = new Date();
    user.changePassword(await new Argon2PasswordHasher().hash(password), now);
    await users.save(user);
    const signedOut = await new DrizzleSessionRepository(db).revokeAllForUser(user.id, now);

    process.stdout.write(
      `Password changed for ${email.value.value}. Signed out of ${signedOut} session(s).\n`,
    );
  } finally {
    await close();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`Failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
