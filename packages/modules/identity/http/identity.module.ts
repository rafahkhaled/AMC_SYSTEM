import type { Clock, IdGenerator, UnitOfWork } from '@amc/kernel';
import {
  type DynamicModule,
  type InjectionToken,
  Module,
  type OptionalFactoryDependency,
} from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthenticateSession } from '../application/authenticate-session.js';
import { IdentityOperations, type RepositoryFactory } from '../application/identity-operations.js';
import type {
  PasswordHasher,
  SessionRepository,
  SessionTokenService,
  TwoFactorService,
  UserRepository,
} from '../application/ports.js';
import { RegisterUser } from '../application/register-user.js';
import { SignIn } from '../application/sign-in.js';
import { SignOut } from '../application/sign-out.js';
import {
  ConfirmTwoFactorEnrolment,
  StartTwoFactorEnrolment,
  VerifyTwoFactor,
} from '../application/two-factor.js';
import type { SessionLimits } from '../domain/index.js';
import { AuthController } from './auth.controller.js';
import { PermissionsGuard } from './permissions.guard.js';
import { COOKIE_SETTINGS, type CookieSettings } from './session-cookie.js';
import { SessionGuard } from './session.guard.js';
import { SignInThrottle } from './sign-in-throttle.js';
import { TwoFactorController } from './two-factor.controller.js';

export interface IdentityModuleOptions {
  /** Used for reads only: authenticating a session on every request. */
  readonly users: UserRepository;
  readonly sessions: SessionRepository;
  /** Everything that changes something goes through these two instead. */
  readonly unitOfWork: UnitOfWork;
  readonly repositories: RepositoryFactory;
  readonly hasher: PasswordHasher;
  readonly tokens: SessionTokenService;
  readonly twoFactor: TwoFactorService;
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly limits: SessionLimits;
  readonly cookies: CookieSettings;
}

/**
 * The module takes its adapters rather than constructing them, so the
 * application layer stays unaware of which database or hashing library is in
 * use, and a test can hand it fakes without touching a container.
 *
 * Both guards are registered globally: every route needs a session unless it
 * says otherwise, and permission checks apply wherever a route declares them.
 */
@Module({})
// biome-ignore lint/complexity/noStaticOnlyClass: Nest identifies a dynamic module by its class
export class IdentityModule {
  /** For tests and anywhere the adapters are already in hand. */
  static withAdapters(options: IdentityModuleOptions): DynamicModule {
    return IdentityModule.forRootAsync({ useFactory: () => options });
  }

  /**
   * For the application, where the adapters need the database pool and the
   * validated configuration, both of which only exist once Nest has built
   * them.
   */
  static forRootAsync(options: {
    inject?: (InjectionToken | OptionalFactoryDependency)[];
    useFactory: (
      ...dependencies: never[]
    ) => IdentityModuleOptions | Promise<IdentityModuleOptions>;
  }): DynamicModule {
    const OPTIONS = Symbol('IDENTITY_OPTIONS');
    const from = <T>(pick: (o: IdentityModuleOptions) => T) => ({
      inject: [OPTIONS],
      useFactory: (resolved: IdentityModuleOptions): T => pick(resolved),
    });

    return {
      module: IdentityModule,
      controllers: [AuthController, TwoFactorController],
      providers: [
        SignInThrottle,
        {
          provide: OPTIONS,
          inject: options.inject ?? [],
          useFactory: options.useFactory as (...args: unknown[]) => IdentityModuleOptions,
        },
        { provide: COOKIE_SETTINGS, ...from((o) => o.cookies) },
        {
          provide: SignIn,
          ...from(
            (o) => new SignIn(o.users, o.sessions, o.hasher, o.tokens, o.clock, o.ids, o.limits),
          ),
        },
        {
          provide: AuthenticateSession,
          ...from((o) => new AuthenticateSession(o.sessions, o.users, o.tokens, o.clock)),
        },
        { provide: SignOut, ...from((o) => new SignOut(o.sessions, o.clock)) },
        {
          provide: RegisterUser,
          ...from((o) => new RegisterUser(o.users, o.hasher, o.clock, o.ids)),
        },
        {
          provide: StartTwoFactorEnrolment,
          ...from((o) => new StartTwoFactorEnrolment(o.users, o.twoFactor, o.clock)),
        },
        {
          provide: ConfirmTwoFactorEnrolment,
          ...from((o) => new ConfirmTwoFactorEnrolment(o.users, o.sessions, o.twoFactor, o.clock)),
        },
        {
          provide: VerifyTwoFactor,
          ...from((o) => new VerifyTwoFactor(o.users, o.sessions, o.twoFactor, o.clock)),
        },
        {
          provide: IdentityOperations,
          ...from(
            (o) =>
              new IdentityOperations({
                unitOfWork: o.unitOfWork,
                repositories: o.repositories,
                hasher: o.hasher,
                tokens: o.tokens,
                twoFactor: o.twoFactor,
                clock: o.clock,
                ids: o.ids,
                limits: o.limits,
              }),
          ),
        },
        { provide: APP_GUARD, useClass: SessionGuard },
        { provide: APP_GUARD, useClass: PermissionsGuard },
      ],
      exports: [
        IdentityOperations,
        SignIn,
        SignOut,
        AuthenticateSession,
        RegisterUser,
        StartTwoFactorEnrolment,
        ConfirmTwoFactorEnrolment,
        VerifyTwoFactor,
      ],
    };
  }
}
