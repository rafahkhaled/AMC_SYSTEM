import {
  type Clock,
  Conflict,
  type IdGenerator,
  type Result,
  ValidationFailed,
  err,
  ok,
} from '@amc/kernel';
import { EmailAddress, type Role, User, checkPassword } from '../domain/index.js';
import type { PasswordHasher, UserRepository } from './ports.js';

export interface RegisterUserCommand {
  readonly email: string;
  readonly displayName: string;
  readonly password: string;
  readonly roles: readonly Role[];
}

export class RegisterUser {
  constructor(
    private readonly users: UserRepository,
    private readonly hasher: PasswordHasher,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async execute(
    command: RegisterUserCommand,
  ): Promise<Result<{ userId: string }, Conflict | ValidationFailed>> {
    const email = EmailAddress.of(command.email);
    if (!email.ok) return err(new ValidationFailed(email.error.message));

    const acceptable = checkPassword(command.password, { email: email.value.value });
    if (!acceptable.ok) return err(acceptable.error);

    const existing = await this.users.findByEmail(email.value);
    if (existing) return err(new Conflict('Someone already uses that email address'));

    const created = User.register({
      id: this.ids.next(),
      email: email.value,
      displayName: command.displayName,
      passwordHash: await this.hasher.hash(command.password),
      roles: command.roles,
      now: this.clock.now(),
    });
    if (!created.ok) return err(created.error);

    await this.users.save(created.value);
    return ok({ userId: created.value.id });
  }
}
