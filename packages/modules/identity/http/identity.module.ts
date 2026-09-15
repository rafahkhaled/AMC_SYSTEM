import type { Clock, IdGenerator } from '@amc/kernel';
import {
  type DynamicModule,
  type InjectionToken,
  Module,
  type OptionalFactoryDependency,
} from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthenticateSession } from '../application/authenticate-session.js';
import type {
  PasswordHasher,
  SessionRepository,
  SessionTokenService,
  UserRepository,
} from '../application/ports.js';
import { RegisterUser } from '../application/register-user.js';
import { SignIn } from '../application/sign-in.js';
import { SignOut } from '../application/sign-out.js';
import type { SessionLimits } from '../domain/index.js';
import { AuthController } from './auth.controller.js';
import { PermissionsGuard } from './permissions.guard.js';
import { COOKIE_SETTINGS, type CookieSettings } from './session-cookie.js';
import { SessionGuard } from './session.guard.js';
import { SignInThrottle } from './sign-in-throttle.js';

export interface IdentityModuleOptions {
  readonly users: UserRepository;
  readonly sessions: SessionRepository;
  readonly hasher: PasswordHasher;
  readonly tokens: SessionTokenService;
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
      controllers: [AuthController],
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
        { provide: APP_GUARD, useClass: SessionGuard },
        { provide: APP_GUARD, useClass: PermissionsGuard },
      ],
      exports: [SignIn, SignOut, AuthenticateSession, RegisterUser],
    };
  }
}
