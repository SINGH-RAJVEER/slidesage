import { BetterAuthDBSchema, ModelNames, SecondaryStorage } from "../db/type.mjs";
import { Session } from "../db/schema/session.mjs";
import { User } from "../db/schema/user.mjs";
import "../db/index.mjs";
import { Awaitable } from "../types/helper.mjs";
import { DBAdapter } from "../db/adapter/index.mjs";
import { createLogger } from "../env/logger.mjs";
import { OAuthProvider } from "../oauth2/oauth-provider.mjs";
import "../oauth2/index.mjs";
import { BetterAuthCookie, BetterAuthCookies } from "../types/cookie.mjs";
import { BetterAuthOptions, BetterAuthRateLimitOptions } from "../types/init-options.mjs";
import { AuthContext, GenericEndpointContext, InfoContext, InternalAdapter, PluginContext } from "../types/context.mjs";
import "../types/index.mjs";
import "../index.mjs";
import * as better_call0 from "better-call";
import { EndpointContext, EndpointOptions, StrictEndpoint } from "better-call";

//#region src/api/index.d.ts
declare const optionsMiddleware: <InputCtx extends better_call0.MiddlewareInputContext<better_call0.MiddlewareOptions>>(inputContext: InputCtx) => Promise<AuthContext>;
declare const createAuthMiddleware: {
  <Options extends better_call0.MiddlewareOptions, R>(options: Options, handler: (ctx: better_call0.MiddlewareContext<Options, {
    returned?: unknown | undefined;
    responseHeaders?: Headers | undefined;
  } & PluginContext & InfoContext & {
    options: BetterAuthOptions;
    appName: string;
    baseURL: string;
    trustedOrigins: string[];
    isTrustedOrigin: (url: string, settings?: {
      allowRelativePaths: boolean;
    }) => boolean;
    oauthConfig: {
      skipStateCookieCheck?: boolean | undefined;
      storeStateStrategy: "database" | "cookie";
    };
    newSession: {
      session: Session & Record<string, any>;
      user: User & Record<string, any>;
    } | null;
    session: {
      session: Session & Record<string, any>;
      user: User & Record<string, any>;
    } | null;
    setNewSession: (session: {
      session: Session & Record<string, any>;
      user: User & Record<string, any>;
    } | null) => void;
    socialProviders: OAuthProvider[];
    authCookies: BetterAuthCookies;
    logger: ReturnType<typeof createLogger>;
    rateLimit: {
      enabled: boolean;
      window: number;
      max: number;
      storage: "memory" | "database" | "secondary-storage";
    } & Omit<BetterAuthRateLimitOptions, "enabled" | "window" | "max" | "storage">;
    adapter: DBAdapter<BetterAuthOptions>;
    internalAdapter: InternalAdapter<BetterAuthOptions>;
    createAuthCookie: (cookieName: string, overrideAttributes?: Partial<better_call0.CookieOptions> | undefined) => BetterAuthCookie;
    secret: string;
    sessionConfig: {
      updateAge: number;
      expiresIn: number;
      freshAge: number;
      cookieRefreshCache: false | {
        enabled: true;
        updateAge: number;
      };
    };
    generateId: (options: {
      model: ModelNames;
      size?: number | undefined;
    }) => string | false;
    secondaryStorage: SecondaryStorage | undefined;
    password: {
      hash: (password: string) => Promise<string>;
      verify: (data: {
        password: string;
        hash: string;
      }) => Promise<boolean>;
      config: {
        minPasswordLength: number;
        maxPasswordLength: number;
      };
      checkPassword: (userId: string, ctx: GenericEndpointContext<BetterAuthOptions>) => Promise<boolean>;
    };
    tables: BetterAuthDBSchema;
    runMigrations: () => Promise<void>;
    publishTelemetry: (event: {
      type: string;
      anonymousId?: string | undefined;
      payload: Record<string, any>;
    }) => Promise<void>;
    skipOriginCheck: boolean | string[];
    skipCSRFCheck: boolean;
    runInBackground: (promise: Promise<unknown>) => void;
    runInBackgroundOrAwait: (promise: Promise<unknown> | void) => Awaitable<unknown>;
  }>) => Promise<R>): (inputContext: better_call0.MiddlewareInputContext<Options>) => Promise<R>;
  <Options extends better_call0.MiddlewareOptions, R_1>(handler: (ctx: better_call0.MiddlewareContext<Options, {
    returned?: unknown | undefined;
    responseHeaders?: Headers | undefined;
  } & PluginContext & InfoContext & {
    options: BetterAuthOptions;
    appName: string;
    baseURL: string;
    trustedOrigins: string[];
    isTrustedOrigin: (url: string, settings?: {
      allowRelativePaths: boolean;
    }) => boolean;
    oauthConfig: {
      skipStateCookieCheck?: boolean | undefined;
      storeStateStrategy: "database" | "cookie";
    };
    newSession: {
      session: Session & Record<string, any>;
      user: User & Record<string, any>;
    } | null;
    session: {
      session: Session & Record<string, any>;
      user: User & Record<string, any>;
    } | null;
    setNewSession: (session: {
      session: Session & Record<string, any>;
      user: User & Record<string, any>;
    } | null) => void;
    socialProviders: OAuthProvider[];
    authCookies: BetterAuthCookies;
    logger: ReturnType<typeof createLogger>;
    rateLimit: {
      enabled: boolean;
      window: number;
      max: number;
      storage: "memory" | "database" | "secondary-storage";
    } & Omit<BetterAuthRateLimitOptions, "enabled" | "window" | "max" | "storage">;
    adapter: DBAdapter<BetterAuthOptions>;
    internalAdapter: InternalAdapter<BetterAuthOptions>;
    createAuthCookie: (cookieName: string, overrideAttributes?: Partial<better_call0.CookieOptions> | undefined) => BetterAuthCookie;
    secret: string;
    sessionConfig: {
      updateAge: number;
      expiresIn: number;
      freshAge: number;
      cookieRefreshCache: false | {
        enabled: true;
        updateAge: number;
      };
    };
    generateId: (options: {
      model: ModelNames;
      size?: number | undefined;
    }) => string | false;
    secondaryStorage: SecondaryStorage | undefined;
    password: {
      hash: (password: string) => Promise<string>;
      verify: (data: {
        password: string;
        hash: string;
      }) => Promise<boolean>;
      config: {
        minPasswordLength: number;
        maxPasswordLength: number;
      };
      checkPassword: (userId: string, ctx: GenericEndpointContext<BetterAuthOptions>) => Promise<boolean>;
    };
    tables: BetterAuthDBSchema;
    runMigrations: () => Promise<void>;
    publishTelemetry: (event: {
      type: string;
      anonymousId?: string | undefined;
      payload: Record<string, any>;
    }) => Promise<void>;
    skipOriginCheck: boolean | string[];
    skipCSRFCheck: boolean;
    runInBackground: (promise: Promise<unknown>) => void;
    runInBackgroundOrAwait: (promise: Promise<unknown> | void) => Awaitable<unknown>;
  }>) => Promise<R_1>): (inputContext: better_call0.MiddlewareInputContext<Options>) => Promise<R_1>;
};
type EndpointHandler<Path extends string, Options extends EndpointOptions, R> = (context: EndpointContext<Path, Options, AuthContext>) => Promise<R>;
declare function createAuthEndpoint<Path extends string, Options extends EndpointOptions, R>(path: Path, options: Options, handler: EndpointHandler<Path, Options, R>): StrictEndpoint<Path, Options, R>;
declare function createAuthEndpoint<Path extends string, Options extends EndpointOptions, R>(options: Options, handler: EndpointHandler<Path, Options, R>): StrictEndpoint<Path, Options, R>;
type AuthEndpoint<Path extends string, Opts extends EndpointOptions, R> = ReturnType<typeof createAuthEndpoint<Path, Opts, R>>;
type AuthMiddleware = ReturnType<typeof createAuthMiddleware>;
//#endregion
export { AuthEndpoint, AuthMiddleware, createAuthEndpoint, createAuthMiddleware, optionsMiddleware };
//# sourceMappingURL=index.d.mts.map