import { InferFieldsFromOptions, InferFieldsFromPlugins } from "../db/field.mjs";
import { Prettify as Prettify$1, StripEmptyObjects, UnionToIntersection } from "../types/helper.mjs";
import { AdditionalUserFieldsInput } from "../types/models.mjs";
import "../types/index.mjs";
import "../db/index.mjs";
import "../index.mjs";
import { getIp } from "../utils/get-request-ip.mjs";
import { getOAuthState } from "./middlewares/oauth.mjs";
import { formCsrfMiddleware, originCheck, originCheckMiddleware } from "./middlewares/origin-check.mjs";
import "./middlewares/index.mjs";
import { accountInfo, getAccessToken, linkSocialAccount, listUserAccounts, refreshToken, unlinkAccount } from "./routes/account.mjs";
import { callbackOAuth } from "./routes/callback.mjs";
import { createEmailVerificationToken, sendVerificationEmail, sendVerificationEmailFn, verifyEmail } from "./routes/email-verification.mjs";
import { error } from "./routes/error.mjs";
import { ok } from "./routes/ok.mjs";
import { requestPasswordReset, requestPasswordResetCallback, resetPassword, verifyPassword } from "./routes/password.mjs";
import { freshSessionMiddleware, getSession, getSessionFromCtx, listSessions, requestOnlySessionMiddleware, revokeOtherSessions, revokeSession, revokeSessions, sensitiveSessionMiddleware, sessionMiddleware } from "./routes/session.mjs";
import { signInEmail, signInSocial } from "./routes/sign-in.mjs";
import { signOut } from "./routes/sign-out.mjs";
import { signUpEmail } from "./routes/sign-up.mjs";
import { changeEmail, changePassword, deleteUser, deleteUserCallback, setPassword, updateUser } from "./routes/update-user.mjs";
import "./routes/index.mjs";
import { AuthContext, Awaitable, BetterAuthOptions, BetterAuthPlugin } from "@better-auth/core";
import { InternalLogger } from "@better-auth/core/env";
import * as _better_auth_core_oauth20 from "@better-auth/core/oauth2";
import * as better_call79 from "better-call";
import { APIError } from "better-call";
import * as zod46 from "zod";
import { AuthEndpoint, AuthMiddleware, createAuthEndpoint, createAuthMiddleware, optionsMiddleware } from "@better-auth/core/api";
import * as zod_v4_core13 from "zod/v4/core";

//#region src/api/index.d.ts
declare function checkEndpointConflicts(options: BetterAuthOptions, logger: InternalLogger): void;
declare function getEndpoints<Option extends BetterAuthOptions>(ctx: Awaitable<AuthContext>, options: Option): {
  api: {
    readonly ok: better_call79.StrictEndpoint<"/ok", {
      method: "GET";
      metadata: {
        openapi: {
          description: string;
          responses: {
            "200": {
              description: string;
              content: {
                "application/json": {
                  schema: {
                    type: "object";
                    properties: {
                      ok: {
                        type: string;
                        description: string;
                      };
                    };
                    required: string[];
                  };
                };
              };
            };
          };
        };
        scope: "server";
      };
    }, {
      ok: boolean;
    }>;
    readonly error: better_call79.StrictEndpoint<"/error", {
      method: "GET";
      metadata: {
        openapi: {
          description: string;
          responses: {
            "200": {
              description: string;
              content: {
                "text/html": {
                  schema: {
                    type: "string";
                    description: string;
                  };
                };
              };
            };
          };
        };
        scope: "server";
      };
    }, Response>;
    readonly signInSocial: better_call79.StrictEndpoint<"/sign-in/social", {
      method: "POST";
      operationId: string;
      body: zod46.ZodObject<{
        callbackURL: zod46.ZodOptional<zod46.ZodString>;
        newUserCallbackURL: zod46.ZodOptional<zod46.ZodString>;
        errorCallbackURL: zod46.ZodOptional<zod46.ZodString>;
        provider: zod46.ZodType<"github" | "apple" | "atlassian" | "cognito" | "discord" | "facebook" | "figma" | "microsoft" | "google" | "huggingface" | "slack" | "spotify" | "twitch" | "twitter" | "dropbox" | "kick" | "linear" | "linkedin" | "gitlab" | "tiktok" | "reddit" | "roblox" | "salesforce" | "vk" | "zoom" | "notion" | "kakao" | "naver" | "line" | "paybin" | "paypal" | "polar" | "vercel" | (string & {}), unknown, zod_v4_core13.$ZodTypeInternals<"github" | "apple" | "atlassian" | "cognito" | "discord" | "facebook" | "figma" | "microsoft" | "google" | "huggingface" | "slack" | "spotify" | "twitch" | "twitter" | "dropbox" | "kick" | "linear" | "linkedin" | "gitlab" | "tiktok" | "reddit" | "roblox" | "salesforce" | "vk" | "zoom" | "notion" | "kakao" | "naver" | "line" | "paybin" | "paypal" | "polar" | "vercel" | (string & {}), unknown>>;
        disableRedirect: zod46.ZodOptional<zod46.ZodBoolean>;
        idToken: zod46.ZodOptional<zod46.ZodObject<{
          token: zod46.ZodString;
          nonce: zod46.ZodOptional<zod46.ZodString>;
          accessToken: zod46.ZodOptional<zod46.ZodString>;
          refreshToken: zod46.ZodOptional<zod46.ZodString>;
          expiresAt: zod46.ZodOptional<zod46.ZodNumber>;
        }, zod_v4_core13.$strip>>;
        scopes: zod46.ZodOptional<zod46.ZodArray<zod46.ZodString>>;
        requestSignUp: zod46.ZodOptional<zod46.ZodBoolean>;
        loginHint: zod46.ZodOptional<zod46.ZodString>;
        additionalData: zod46.ZodOptional<zod46.ZodRecord<zod46.ZodString, zod46.ZodAny>>;
      }, zod_v4_core13.$strip>;
      metadata: {
        $Infer: {
          body: zod46.infer<zod46.ZodObject<{
            callbackURL: zod46.ZodOptional<zod46.ZodString>;
            newUserCallbackURL: zod46.ZodOptional<zod46.ZodString>;
            errorCallbackURL: zod46.ZodOptional<zod46.ZodString>;
            provider: zod46.ZodType<"github" | "apple" | "atlassian" | "cognito" | "discord" | "facebook" | "figma" | "microsoft" | "google" | "huggingface" | "slack" | "spotify" | "twitch" | "twitter" | "dropbox" | "kick" | "linear" | "linkedin" | "gitlab" | "tiktok" | "reddit" | "roblox" | "salesforce" | "vk" | "zoom" | "notion" | "kakao" | "naver" | "line" | "paybin" | "paypal" | "polar" | "vercel" | (string & {}), unknown, zod_v4_core13.$ZodTypeInternals<"github" | "apple" | "atlassian" | "cognito" | "discord" | "facebook" | "figma" | "microsoft" | "google" | "huggingface" | "slack" | "spotify" | "twitch" | "twitter" | "dropbox" | "kick" | "linear" | "linkedin" | "gitlab" | "tiktok" | "reddit" | "roblox" | "salesforce" | "vk" | "zoom" | "notion" | "kakao" | "naver" | "line" | "paybin" | "paypal" | "polar" | "vercel" | (string & {}), unknown>>;
            disableRedirect: zod46.ZodOptional<zod46.ZodBoolean>;
            idToken: zod46.ZodOptional<zod46.ZodObject<{
              token: zod46.ZodString;
              nonce: zod46.ZodOptional<zod46.ZodString>;
              accessToken: zod46.ZodOptional<zod46.ZodString>;
              refreshToken: zod46.ZodOptional<zod46.ZodString>;
              expiresAt: zod46.ZodOptional<zod46.ZodNumber>;
            }, zod_v4_core13.$strip>>;
            scopes: zod46.ZodOptional<zod46.ZodArray<zod46.ZodString>>;
            requestSignUp: zod46.ZodOptional<zod46.ZodBoolean>;
            loginHint: zod46.ZodOptional<zod46.ZodString>;
            additionalData: zod46.ZodOptional<zod46.ZodRecord<zod46.ZodString, zod46.ZodAny>>;
          }, zod_v4_core13.$strip>>;
          returned: {
            redirect: boolean;
            token?: string | undefined;
            url?: string | undefined;
            user?: UnionToIntersection<StripEmptyObjects<{
              id: string;
              createdAt: Date;
              updatedAt: Date;
              email: string;
              emailVerified: boolean;
              name: string;
              image?: string | null | undefined;
            } & InferFieldsFromPlugins<Option, "user", "output"> & InferFieldsFromOptions<Option, "user", "output">>> | undefined;
          };
        };
        openapi: {
          description: string;
          operationId: string;
          responses: {
            "200": {
              description: string;
              content: {
                "application/json": {
                  schema: {
                    type: "object";
                    description: string;
                    properties: {
                      token: {
                        type: string;
                      };
                      user: {
                        type: string;
                        $ref: string;
                      };
                      url: {
                        type: string;
                      };
                      redirect: {
                        type: string;
                        enum: boolean[];
                      };
                    };
                    required: string[];
                  };
                };
              };
            };
          };
        };
      };
    }, {
      redirect: boolean;
      url: string;
    } | {
      redirect: boolean;
      token: string;
      url: undefined;
      user: UnionToIntersection<StripEmptyObjects<{
        id: string;
        createdAt: Date;
        updatedAt: Date;
        email: string;
        emailVerified: boolean;
        name: string;
        image?: string | null | undefined;
      } & InferFieldsFromPlugins<Option, "user", "output"> & InferFieldsFromOptions<Option, "user", "output">>>;
    }>;
    readonly callbackOAuth: better_call79.StrictEndpoint<"/callback/:id", {
      method: ("GET" | "POST")[];
      operationId: string;
      body: zod46.ZodOptional<zod46.ZodObject<{
        code: zod46.ZodOptional<zod46.ZodString>;
        error: zod46.ZodOptional<zod46.ZodString>;
        device_id: zod46.ZodOptional<zod46.ZodString>;
        error_description: zod46.ZodOptional<zod46.ZodString>;
        state: zod46.ZodOptional<zod46.ZodString>;
        user: zod46.ZodOptional<zod46.ZodString>;
      }, zod_v4_core13.$strip>>;
      query: zod46.ZodOptional<zod46.ZodObject<{
        code: zod46.ZodOptional<zod46.ZodString>;
        error: zod46.ZodOptional<zod46.ZodString>;
        device_id: zod46.ZodOptional<zod46.ZodString>;
        error_description: zod46.ZodOptional<zod46.ZodString>;
        state: zod46.ZodOptional<zod46.ZodString>;
        user: zod46.ZodOptional<zod46.ZodString>;
      }, zod_v4_core13.$strip>>;
      metadata: {
        allowedMediaTypes: string[];
        scope: "server";
      };
    }, void>;
    readonly getSession: better_call79.StrictEndpoint<"/get-session", {
      method: "GET";
      operationId: string;
      query: zod46.ZodOptional<zod46.ZodObject<{
        disableCookieCache: zod46.ZodOptional<zod46.ZodCoercedBoolean<unknown>>;
        disableRefresh: zod46.ZodOptional<zod46.ZodCoercedBoolean<unknown>>;
      }, zod_v4_core13.$strip>>;
      requireHeaders: true;
      metadata: {
        openapi: {
          operationId: string;
          description: string;
          responses: {
            "200": {
              description: string;
              content: {
                "application/json": {
                  schema: {
                    type: "object";
                    nullable: boolean;
                    properties: {
                      session: {
                        $ref: string;
                      };
                      user: {
                        $ref: string;
                      };
                    };
                    required: string[];
                  };
                };
              };
            };
          };
        };
      };
    }, {
      session: UnionToIntersection<StripEmptyObjects<{
        id: string;
        createdAt: Date;
        updatedAt: Date;
        userId: string;
        expiresAt: Date;
        token: string;
        ipAddress?: string | null | undefined;
        userAgent?: string | null | undefined;
      } & InferFieldsFromPlugins<Option, "session", "output"> & InferFieldsFromOptions<Option, "session", "output">>>;
      user: UnionToIntersection<StripEmptyObjects<{
        id: string;
        createdAt: Date;
        updatedAt: Date;
        email: string;
        emailVerified: boolean;
        name: string;
        image?: string | null | undefined;
      } & InferFieldsFromPlugins<Option, "user", "output"> & InferFieldsFromOptions<Option, "user", "output">>>;
    } | null>;
    readonly signOut: better_call79.StrictEndpoint<"/sign-out", {
      method: "POST";
      operationId: string;
      requireHeaders: true;
      metadata: {
        openapi: {
          operationId: string;
          description: string;
          responses: {
            "200": {
              description: string;
              content: {
                "application/json": {
                  schema: {
                    type: "object";
                    properties: {
                      success: {
                        type: string;
                      };
                    };
                  };
                };
              };
            };
          };
        };
      };
    }, {
      success: boolean;
    }>;
    readonly signUpEmail: better_call79.StrictEndpoint<"/sign-up/email", {
      method: "POST";
      operationId: string;
      use: ((inputContext: better_call79.MiddlewareInputContext<better_call79.MiddlewareOptions>) => Promise<void>)[];
      body: zod46.ZodIntersection<zod46.ZodObject<{
        name: zod46.ZodString;
        email: zod46.ZodEmail;
        password: zod46.ZodString;
        image: zod46.ZodOptional<zod46.ZodString>;
        callbackURL: zod46.ZodOptional<zod46.ZodString>;
        rememberMe: zod46.ZodOptional<zod46.ZodBoolean>;
      }, zod_v4_core13.$strip>, zod46.ZodRecord<zod46.ZodString, zod46.ZodAny>>;
      metadata: {
        allowedMediaTypes: string[];
        $Infer: {
          body: {
            name: string;
            email: string;
            password: string;
            image?: string | undefined;
            callbackURL?: string | undefined;
            rememberMe?: boolean | undefined;
          } & InferFieldsFromPlugins<Option, "user", "input"> & InferFieldsFromOptions<Option, "user", "input">;
          returned: {
            token: string | null;
            user: UnionToIntersection<StripEmptyObjects<{
              id: string;
              createdAt: Date;
              updatedAt: Date;
              email: string;
              emailVerified: boolean;
              name: string;
              image?: string | null | undefined;
            } & InferFieldsFromPlugins<Option, "user", "output"> & InferFieldsFromOptions<Option, "user", "output">>>;
          };
        };
        openapi: {
          operationId: string;
          description: string;
          requestBody: {
            content: {
              "application/json": {
                schema: {
                  type: "object";
                  properties: {
                    name: {
                      type: string;
                      description: string;
                    };
                    email: {
                      type: string;
                      description: string;
                    };
                    password: {
                      type: string;
                      description: string;
                    };
                    image: {
                      type: string;
                      description: string;
                    };
                    callbackURL: {
                      type: string;
                      description: string;
                    };
                    rememberMe: {
                      type: string;
                      description: string;
                    };
                  };
                  required: string[];
                };
              };
            };
          };
          responses: {
            "200": {
              description: string;
              content: {
                "application/json": {
                  schema: {
                    type: "object";
                    properties: {
                      token: {
                        type: string;
                        nullable: boolean;
                        description: string;
                      };
                      user: {
                        type: string;
                        properties: {
                          id: {
                            type: string;
                            description: string;
                          };
                          email: {
                            type: string;
                            format: string;
                            description: string;
                          };
                          name: {
                            type: string;
                            description: string;
                          };
                          image: {
                            type: string;
                            format: string;
                            nullable: boolean;
                            description: string;
                          };
                          emailVerified: {
                            type: string;
                            description: string;
                          };
                          createdAt: {
                            type: string;
                            format: string;
                            description: string;
                          };
                          updatedAt: {
                            type: string;
                            format: string;
                            description: string;
                          };
                        };
                        required: string[];
                      };
                    };
                    required: string[];
                  };
                };
              };
            };
            "422": {
              description: string;
              content: {
                "application/json": {
                  schema: {
                    type: "object";
                    properties: {
                      message: {
                        type: string;
                      };
                    };
                  };
                };
              };
            };
          };
        };
      };
    }, {
      token: null;
      user: UnionToIntersection<StripEmptyObjects<{
        id: string;
        createdAt: Date;
        updatedAt: Date;
        email: string;
        emailVerified: boolean;
        name: string;
        image?: string | null | undefined;
      } & InferFieldsFromPlugins<Option, "user", "output"> & InferFieldsFromOptions<Option, "user", "output">>>;
    } | {
      token: string;
      user: UnionToIntersection<StripEmptyObjects<{
        id: string;
        createdAt: Date;
        updatedAt: Date;
        email: string;
        emailVerified: boolean;
        name: string;
        image?: string | null | undefined;
      } & InferFieldsFromPlugins<Option, "user", "output"> & InferFieldsFromOptions<Option, "user", "output">>>;
    }>;
    readonly signInEmail: better_call79.StrictEndpoint<"/sign-in/email", {
      method: "POST";
      operationId: string;
      use: ((inputContext: better_call79.MiddlewareInputContext<better_call79.MiddlewareOptions>) => Promise<void>)[];
      body: zod46.ZodObject<{
        email: zod46.ZodString;
        password: zod46.ZodString;
        callbackURL: zod46.ZodOptional<zod46.ZodString>;
        rememberMe: zod46.ZodOptional<zod46.ZodDefault<zod46.ZodBoolean>>;
      }, zod_v4_core13.$strip>;
      metadata: {
        allowedMediaTypes: string[];
        $Infer: {
          body: {
            email: string;
            password: string;
            callbackURL?: string | undefined;
            rememberMe?: boolean | undefined;
          };
          returned: {
            redirect: boolean;
            token: string;
            url?: string | undefined;
            user: UnionToIntersection<StripEmptyObjects<{
              id: string;
              createdAt: Date;
              updatedAt: Date;
              email: string;
              emailVerified: boolean;
              name: string;
              image?: string | null | undefined;
            } & InferFieldsFromPlugins<Option, "user", "output"> & InferFieldsFromOptions<Option, "user", "output">>>;
          };
        };
        openapi: {
          operationId: string;
          description: string;
          responses: {
            "200": {
              description: string;
              content: {
                "application/json": {
                  schema: {
                    type: "object";
                    description: string;
                    properties: {
                      redirect: {
                        type: string;
                        enum: boolean[];
                      };
                      token: {
                        type: string;
                        description: string;
                      };
                      url: {
                        type: string;
                        nullable: boolean;
                      };
                      user: {
                        type: string;
                        $ref: string;
                      };
                    };
                    required: string[];
                  };
                };
              };
            };
          };
        };
      };
    }, {
      redirect: boolean;
      token: string;
      url?: string | undefined;
      user: UnionToIntersection<StripEmptyObjects<{
        id: string;
        createdAt: Date;
        updatedAt: Date;
        email: string;
        emailVerified: boolean;
        name: string;
        image?: string | null | undefined;
      } & InferFieldsFromPlugins<Option, "user", "output"> & InferFieldsFromOptions<Option, "user", "output">>>;
    }>;
    readonly resetPassword: better_call79.StrictEndpoint<"/reset-password", {
      method: "POST";
      operationId: string;
      query: zod46.ZodOptional<zod46.ZodObject<{
        token: zod46.ZodOptional<zod46.ZodString>;
      }, zod_v4_core13.$strip>>;
      body: zod46.ZodObject<{
        newPassword: zod46.ZodString;
        token: zod46.ZodOptional<zod46.ZodString>;
      }, zod_v4_core13.$strip>;
      metadata: {
        openapi: {
          operationId: string;
          description: string;
          responses: {
            "200": {
              description: string;
              content: {
                "application/json": {
                  schema: {
                    type: "object";
                    properties: {
                      status: {
                        type: string;
                      };
                    };
                  };
                };
              };
            };
          };
        };
      };
    }, {
      status: boolean;
    }>;
    readonly verifyPassword: better_call79.StrictEndpoint<"/verify-password", {
      method: "POST";
      body: zod46.ZodObject<{
        password: zod46.ZodString;
      }, zod_v4_core13.$strip>;
      metadata: {
        scope: "server";
        openapi: {
          operationId: string;
          description: string;
          responses: {
            "200": {
              description: string;
              content: {
                "application/json": {
                  schema: {
                    type: "object";
                    properties: {
                      status: {
                        type: string;
                      };
                    };
                  };
                };
              };
            };
          };
        };
      };
      use: ((inputContext: better_call79.MiddlewareInputContext<better_call79.MiddlewareOptions>) => Promise<{
        session: {
          session: Record<string, any> & {
            id: string;
            createdAt: Date;
            updatedAt: Date;
            userId: string;
            expiresAt: Date;
            token: string;
            ipAddress?: string | null | undefined;
            userAgent?: string | null | undefined;
          };
          user: Record<string, any> & {
            id: string;
            createdAt: Date;
            updatedAt: Date;
            email: string;
            emailVerified: boolean;
            name: string;
            image?: string | null | undefined;
          };
        };
      }>)[];
    }, {
      status: boolean;
    }>;
    readonly verifyEmail: better_call79.StrictEndpoint<"/verify-email", {
      method: "GET";
      operationId: string;
      query: zod46.ZodObject<{
        token: zod46.ZodString;
        callbackURL: zod46.ZodOptional<zod46.ZodString>;
      }, zod_v4_core13.$strip>;
      use: ((inputContext: better_call79.MiddlewareInputContext<better_call79.MiddlewareOptions>) => Promise<void>)[];
      metadata: {
        openapi: {
          description: string;
          parameters: ({
            name: string;
            in: "query";
            description: string;
            required: true;
            schema: {
              type: "string";
            };
          } | {
            name: string;
            in: "query";
            description: string;
            required: false;
            schema: {
              type: "string";
            };
          })[];
          responses: {
            "200": {
              description: string;
              content: {
                "application/json": {
                  schema: {
                    type: "object";
                    properties: {
                      user: {
                        type: string;
                        $ref: string;
                      };
                      status: {
                        type: string;
                        description: string;
                      };
                    };
                    required: string[];
                  };
                };
              };
            };
          };
        };
      };
    }, void | {
      status: boolean;
    }>;
    readonly sendVerificationEmail: better_call79.StrictEndpoint<"/send-verification-email", {
      method: "POST";
      operationId: string;
      body: zod46.ZodObject<{
        email: zod46.ZodEmail;
        callbackURL: zod46.ZodOptional<zod46.ZodString>;
      }, zod_v4_core13.$strip>;
      metadata: {
        openapi: {
          operationId: string;
          description: string;
          requestBody: {
            content: {
              "application/json": {
                schema: {
                  type: "object";
                  properties: {
                    email: {
                      type: string;
                      description: string;
                      example: string;
                    };
                    callbackURL: {
                      type: string;
                      description: string;
                      example: string;
                      nullable: boolean;
                    };
                  };
                  required: string[];
                };
              };
            };
          };
          responses: {
            "200": {
              description: string;
              content: {
                "application/json": {
                  schema: {
                    type: "object";
                    properties: {
                      status: {
                        type: string;
                        description: string;
                        example: boolean;
                      };
                    };
                  };
                };
              };
            };
            "400": {
              description: string;
              content: {
                "application/json": {
                  schema: {
                    type: "object";
                    properties: {
                      message: {
                        type: string;
                        description: string;
                        example: string;
                      };
                    };
                  };
                };
              };
            };
          };
        };
      };
    }, {
      status: boolean;
    }>;
    readonly changeEmail: better_call79.StrictEndpoint<"/change-email", {
      method: "POST";
      body: zod46.ZodObject<{
        newEmail: zod46.ZodEmail;
        callbackURL: zod46.ZodOptional<zod46.ZodString>;
      }, zod_v4_core13.$strip>;
      use: ((inputContext: better_call79.MiddlewareInputContext<better_call79.MiddlewareOptions>) => Promise<{
        session: {
          session: Record<string, any> & {
            id: string;
            createdAt: Date;
            updatedAt: Date;
            userId: string;
            expiresAt: Date;
            token: string;
            ipAddress?: string | null | undefined;
            userAgent?: string | null | undefined;
          };
          user: Record<string, any> & {
            id: string;
            createdAt: Date;
            updatedAt: Date;
            email: string;
            emailVerified: boolean;
            name: string;
            image?: string | null | undefined;
          };
        };
      }>)[];
      metadata: {
        openapi: {
          operationId: string;
          responses: {
            "200": {
              description: string;
              content: {
                "application/json": {
                  schema: {
                    type: "object";
                    properties: {
                      user: {
                        type: string;
                        $ref: string;
                      };
                      status: {
                        type: string;
                        description: string;
                      };
                      message: {
                        type: string;
                        enum: string[];
                        description: string;
                        nullable: boolean;
                      };
                    };
                    required: string[];
                  };
                };
              };
            };
            "422": {
              description: string;
              content: {
                "application/json": {
                  schema: {
                    type: "object";
                    properties: {
                      message: {
                        type: string;
                      };
                    };
                  };
                };
              };
            };
          };
        };
      };
    }, {
      status: boolean;
    }>;
    readonly changePassword: better_call79.StrictEndpoint<"/change-password", {
      method: "POST";
      operationId: string;
      body: zod46.ZodObject<{
        newPassword: zod46.ZodString;
        currentPassword: zod46.ZodString;
        revokeOtherSessions: zod46.ZodOptional<zod46.ZodBoolean>;
      }, zod_v4_core13.$strip>;
      use: ((inputContext: better_call79.MiddlewareInputContext<better_call79.MiddlewareOptions>) => Promise<{
        session: {
          session: Record<string, any> & {
            id: string;
            createdAt: Date;
            updatedAt: Date;
            userId: string;
            expiresAt: Date;
            token: string;
            ipAddress?: string | null | undefined;
            userAgent?: string | null | undefined;
          };
          user: Record<string, any> & {
            id: string;
            createdAt: Date;
            updatedAt: Date;
            email: string;
            emailVerified: boolean;
            name: string;
            image?: string | null | undefined;
          };
        };
      }>)[];
      metadata: {
        openapi: {
          operationId: string;
          description: string;
          responses: {
            "200": {
              description: string;
              content: {
                "application/json": {
                  schema: {
                    type: "object";
                    properties: {
                      token: {
                        type: string;
                        nullable: boolean;
                        description: string;
                      };
                      user: {
                        type: string;
                        properties: {
                          id: {
                            type: string;
                            description: string;
                          };
                          email: {
                            type: string;
                            format: string;
                            description: string;
                          };
                          name: {
                            type: string;
                            description: string;
                          };
                          image: {
                            type: string;
                            format: string;
                            nullable: boolean;
                            description: string;
                          };
                          emailVerified: {
                            type: string;
                            description: string;
                          };
                          createdAt: {
                            type: string;
                            format: string;
                            description: string;
                          };
                          updatedAt: {
                            type: string;
                            format: string;
                            description: string;
                          };
                        };
                        required: string[];
                      };
                    };
                    required: string[];
                  };
                };
              };
            };
          };
        };
      };
    }, {
      token: string | null;
      user: {
        id: string;
        createdAt: Date;
        updatedAt: Date;
        email: string;
        emailVerified: boolean;
        name: string;
        image?: string | null | undefined;
      } & Record<string, any>;
    }>;
    readonly setPassword: better_call79.StrictEndpoint<string, {
      method: "POST";
      body: zod46.ZodObject<{
        newPassword: zod46.ZodString;
      }, zod_v4_core13.$strip>;
      use: ((inputContext: better_call79.MiddlewareInputContext<better_call79.MiddlewareOptions>) => Promise<{
        session: {
          session: Record<string, any> & {
            id: string;
            createdAt: Date;
            updatedAt: Date;
            userId: string;
            expiresAt: Date;
            token: string;
            ipAddress?: string | null | undefined;
            userAgent?: string | null | undefined;
          };
          user: Record<string, any> & {
            id: string;
            createdAt: Date;
            updatedAt: Date;
            email: string;
            emailVerified: boolean;
            name: string;
            image?: string | null | undefined;
          };
        };
      }>)[];
    }, {
      status: boolean;
    }>;
    readonly updateUser: better_call79.StrictEndpoint<"/update-user", {
      method: "POST";
      operationId: string;
      body: zod46.ZodRecord<zod46.ZodString, zod46.ZodAny>;
      use: ((inputContext: better_call79.MiddlewareInputContext<better_call79.MiddlewareOptions>) => Promise<{
        session: {
          session: Record<string, any> & {
            id: string;
            createdAt: Date;
            updatedAt: Date;
            userId: string;
            expiresAt: Date;
            token: string;
            ipAddress?: string | null | undefined;
            userAgent?: string | null | undefined;
          };
          user: Record<string, any> & {
            id: string;
            createdAt: Date;
            updatedAt: Date;
            email: string;
            emailVerified: boolean;
            name: string;
            image?: string | null | undefined;
          };
        };
      }>)[];
      metadata: {
        $Infer: {
          body: Partial<AdditionalUserFieldsInput<Option>> & {
            name?: string | undefined;
            image?: string | undefined | null;
          };
        };
        openapi: {
          operationId: string;
          description: string;
          requestBody: {
            content: {
              "application/json": {
                schema: {
                  type: "object";
                  properties: {
                    name: {
                      type: string;
                      description: string;
                    };
                    image: {
                      type: string;
                      description: string;
                      nullable: boolean;
                    };
                  };
                };
              };
            };
          };
          responses: {
            "200": {
              description: string;
              content: {
                "application/json": {
                  schema: {
                    type: "object";
                    properties: {
                      user: {
                        type: string;
                        $ref: string;
                      };
                    };
                  };
                };
              };
            };
          };
        };
      };
    }, {
      status: boolean;
    }>;
    readonly deleteUser: better_call79.StrictEndpoint<"/delete-user", {
      method: "POST";
      use: ((inputContext: better_call79.MiddlewareInputContext<better_call79.MiddlewareOptions>) => Promise<{
        session: {
          session: Record<string, any> & {
            id: string;
            createdAt: Date;
            updatedAt: Date;
            userId: string;
            expiresAt: Date;
            token: string;
            ipAddress?: string | null | undefined;
            userAgent?: string | null | undefined;
          };
          user: Record<string, any> & {
            id: string;
            createdAt: Date;
            updatedAt: Date;
            email: string;
            emailVerified: boolean;
            name: string;
            image?: string | null | undefined;
          };
        };
      }>)[];
      body: zod46.ZodObject<{
        callbackURL: zod46.ZodOptional<zod46.ZodString>;
        password: zod46.ZodOptional<zod46.ZodString>;
        token: zod46.ZodOptional<zod46.ZodString>;
      }, zod_v4_core13.$strip>;
      metadata: {
        openapi: {
          operationId: string;
          description: string;
          requestBody: {
            content: {
              "application/json": {
                schema: {
                  type: "object";
                  properties: {
                    callbackURL: {
                      type: string;
                      description: string;
                    };
                    password: {
                      type: string;
                      description: string;
                    };
                    token: {
                      type: string;
                      description: string;
                    };
                  };
                };
              };
            };
          };
          responses: {
            "200": {
              description: string;
              content: {
                "application/json": {
                  schema: {
                    type: "object";
                    properties: {
                      success: {
                        type: string;
                        description: string;
                      };
                      message: {
                        type: string;
                        enum: string[];
                        description: string;
                      };
                    };
                    required: string[];
                  };
                };
              };
            };
          };
        };
      };
    }, {
      success: boolean;
      message: string;
    }>;
    readonly requestPasswordReset: better_call79.StrictEndpoint<"/request-password-reset", {
      method: "POST";
      body: zod46.ZodObject<{
        email: zod46.ZodEmail;
        redirectTo: zod46.ZodOptional<zod46.ZodString>;
      }, zod_v4_core13.$strip>;
      metadata: {
        openapi: {
          operationId: string;
          description: string;
          responses: {
            "200": {
              description: string;
              content: {
                "application/json": {
                  schema: {
                    type: "object";
                    properties: {
                      status: {
                        type: string;
                      };
                      message: {
                        type: string;
                      };
                    };
                  };
                };
              };
            };
          };
        };
      };
    }, {
      status: boolean;
      message: string;
    }>;
    readonly requestPasswordResetCallback: better_call79.StrictEndpoint<"/reset-password/:token", {
      method: "GET";
      operationId: string;
      query: zod46.ZodObject<{
        callbackURL: zod46.ZodString;
      }, zod_v4_core13.$strip>;
      use: ((inputContext: better_call79.MiddlewareInputContext<better_call79.MiddlewareOptions>) => Promise<void>)[];
      metadata: {
        openapi: {
          operationId: string;
          description: string;
          parameters: ({
            name: string;
            in: "path";
            required: true;
            description: string;
            schema: {
              type: "string";
            };
          } | {
            name: string;
            in: "query";
            required: true;
            description: string;
            schema: {
              type: "string";
            };
          })[];
          responses: {
            "200": {
              description: string;
              content: {
                "application/json": {
                  schema: {
                    type: "object";
                    properties: {
                      token: {
                        type: string;
                      };
                    };
                  };
                };
              };
            };
          };
        };
      };
    }, never>;
    readonly listSessions: better_call79.StrictEndpoint<"/list-sessions", {
      method: "GET";
      operationId: string;
      use: ((inputContext: better_call79.MiddlewareInputContext<better_call79.MiddlewareOptions>) => Promise<{
        session: {
          session: Record<string, any> & {
            id: string;
            createdAt: Date;
            updatedAt: Date;
            userId: string;
            expiresAt: Date;
            token: string;
            ipAddress?: string | null | undefined;
            userAgent?: string | null | undefined;
          };
          user: Record<string, any> & {
            id: string;
            createdAt: Date;
            updatedAt: Date;
            email: string;
            emailVerified: boolean;
            name: string;
            image?: string | null | undefined;
          };
        };
      }>)[];
      requireHeaders: true;
      metadata: {
        openapi: {
          operationId: string;
          description: string;
          responses: {
            "200": {
              description: string;
              content: {
                "application/json": {
                  schema: {
                    type: "array";
                    items: {
                      $ref: string;
                    };
                  };
                };
              };
            };
          };
        };
      };
    }, Prettify$1<UnionToIntersection<StripEmptyObjects<{
      id: string;
      createdAt: Date;
      updatedAt: Date;
      userId: string;
      expiresAt: Date;
      token: string;
      ipAddress?: string | null | undefined;
      userAgent?: string | null | undefined;
    } & InferFieldsFromPlugins<Option, "session", "output"> & InferFieldsFromOptions<Option, "session", "output">>>>[]>;
    readonly revokeSession: better_call79.StrictEndpoint<"/revoke-session", {
      method: "POST";
      body: zod46.ZodObject<{
        token: zod46.ZodString;
      }, zod_v4_core13.$strip>;
      use: ((inputContext: better_call79.MiddlewareInputContext<better_call79.MiddlewareOptions>) => Promise<{
        session: {
          session: Record<string, any> & {
            id: string;
            createdAt: Date;
            updatedAt: Date;
            userId: string;
            expiresAt: Date;
            token: string;
            ipAddress?: string | null | undefined;
            userAgent?: string | null | undefined;
          };
          user: Record<string, any> & {
            id: string;
            createdAt: Date;
            updatedAt: Date;
            email: string;
            emailVerified: boolean;
            name: string;
            image?: string | null | undefined;
          };
        };
      }>)[];
      requireHeaders: true;
      metadata: {
        openapi: {
          description: string;
          requestBody: {
            content: {
              "application/json": {
                schema: {
                  type: "object";
                  properties: {
                    token: {
                      type: string;
                      description: string;
                    };
                  };
                  required: string[];
                };
              };
            };
          };
          responses: {
            "200": {
              description: string;
              content: {
                "application/json": {
                  schema: {
                    type: "object";
                    properties: {
                      status: {
                        type: string;
                        description: string;
                      };
                    };
                    required: string[];
                  };
                };
              };
            };
          };
        };
      };
    }, {
      status: boolean;
    }>;
    readonly revokeSessions: better_call79.StrictEndpoint<"/revoke-sessions", {
      method: "POST";
      use: ((inputContext: better_call79.MiddlewareInputContext<better_call79.MiddlewareOptions>) => Promise<{
        session: {
          session: Record<string, any> & {
            id: string;
            createdAt: Date;
            updatedAt: Date;
            userId: string;
            expiresAt: Date;
            token: string;
            ipAddress?: string | null | undefined;
            userAgent?: string | null | undefined;
          };
          user: Record<string, any> & {
            id: string;
            createdAt: Date;
            updatedAt: Date;
            email: string;
            emailVerified: boolean;
            name: string;
            image?: string | null | undefined;
          };
        };
      }>)[];
      requireHeaders: true;
      metadata: {
        openapi: {
          description: string;
          responses: {
            "200": {
              description: string;
              content: {
                "application/json": {
                  schema: {
                    type: "object";
                    properties: {
                      status: {
                        type: string;
                        description: string;
                      };
                    };
                    required: string[];
                  };
                };
              };
            };
          };
        };
      };
    }, {
      status: boolean;
    }>;
    readonly revokeOtherSessions: better_call79.StrictEndpoint<"/revoke-other-sessions", {
      method: "POST";
      requireHeaders: true;
      use: ((inputContext: better_call79.MiddlewareInputContext<better_call79.MiddlewareOptions>) => Promise<{
        session: {
          session: Record<string, any> & {
            id: string;
            createdAt: Date;
            updatedAt: Date;
            userId: string;
            expiresAt: Date;
            token: string;
            ipAddress?: string | null | undefined;
            userAgent?: string | null | undefined;
          };
          user: Record<string, any> & {
            id: string;
            createdAt: Date;
            updatedAt: Date;
            email: string;
            emailVerified: boolean;
            name: string;
            image?: string | null | undefined;
          };
        };
      }>)[];
      metadata: {
        openapi: {
          description: string;
          responses: {
            "200": {
              description: string;
              content: {
                "application/json": {
                  schema: {
                    type: "object";
                    properties: {
                      status: {
                        type: string;
                        description: string;
                      };
                    };
                    required: string[];
                  };
                };
              };
            };
          };
        };
      };
    }, {
      status: boolean;
    }>;
    readonly linkSocialAccount: better_call79.StrictEndpoint<"/link-social", {
      method: "POST";
      requireHeaders: true;
      body: zod46.ZodObject<{
        callbackURL: zod46.ZodOptional<zod46.ZodString>;
        provider: zod46.ZodType<"github" | "apple" | "atlassian" | "cognito" | "discord" | "facebook" | "figma" | "microsoft" | "google" | "huggingface" | "slack" | "spotify" | "twitch" | "twitter" | "dropbox" | "kick" | "linear" | "linkedin" | "gitlab" | "tiktok" | "reddit" | "roblox" | "salesforce" | "vk" | "zoom" | "notion" | "kakao" | "naver" | "line" | "paybin" | "paypal" | "polar" | "vercel" | (string & {}), unknown, zod_v4_core13.$ZodTypeInternals<"github" | "apple" | "atlassian" | "cognito" | "discord" | "facebook" | "figma" | "microsoft" | "google" | "huggingface" | "slack" | "spotify" | "twitch" | "twitter" | "dropbox" | "kick" | "linear" | "linkedin" | "gitlab" | "tiktok" | "reddit" | "roblox" | "salesforce" | "vk" | "zoom" | "notion" | "kakao" | "naver" | "line" | "paybin" | "paypal" | "polar" | "vercel" | (string & {}), unknown>>;
        idToken: zod46.ZodOptional<zod46.ZodObject<{
          token: zod46.ZodString;
          nonce: zod46.ZodOptional<zod46.ZodString>;
          accessToken: zod46.ZodOptional<zod46.ZodString>;
          refreshToken: zod46.ZodOptional<zod46.ZodString>;
          scopes: zod46.ZodOptional<zod46.ZodArray<zod46.ZodString>>;
        }, zod_v4_core13.$strip>>;
        requestSignUp: zod46.ZodOptional<zod46.ZodBoolean>;
        scopes: zod46.ZodOptional<zod46.ZodArray<zod46.ZodString>>;
        errorCallbackURL: zod46.ZodOptional<zod46.ZodString>;
        disableRedirect: zod46.ZodOptional<zod46.ZodBoolean>;
        additionalData: zod46.ZodOptional<zod46.ZodRecord<zod46.ZodString, zod46.ZodAny>>;
      }, zod_v4_core13.$strip>;
      use: ((inputContext: better_call79.MiddlewareInputContext<better_call79.MiddlewareOptions>) => Promise<{
        session: {
          session: Record<string, any> & {
            id: string;
            createdAt: Date;
            updatedAt: Date;
            userId: string;
            expiresAt: Date;
            token: string;
            ipAddress?: string | null | undefined;
            userAgent?: string | null | undefined;
          };
          user: Record<string, any> & {
            id: string;
            createdAt: Date;
            updatedAt: Date;
            email: string;
            emailVerified: boolean;
            name: string;
            image?: string | null | undefined;
          };
        };
      }>)[];
      metadata: {
        openapi: {
          description: string;
          operationId: string;
          responses: {
            "200": {
              description: string;
              content: {
                "application/json": {
                  schema: {
                    type: "object";
                    properties: {
                      url: {
                        type: string;
                        description: string;
                      };
                      redirect: {
                        type: string;
                        description: string;
                      };
                      status: {
                        type: string;
                      };
                    };
                    required: string[];
                  };
                };
              };
            };
          };
        };
      };
    }, {
      url: string;
      redirect: boolean;
    }>;
    readonly listUserAccounts: better_call79.StrictEndpoint<"/list-accounts", {
      method: "GET";
      use: ((inputContext: better_call79.MiddlewareInputContext<better_call79.MiddlewareOptions>) => Promise<{
        session: {
          session: Record<string, any> & {
            id: string;
            createdAt: Date;
            updatedAt: Date;
            userId: string;
            expiresAt: Date;
            token: string;
            ipAddress?: string | null | undefined;
            userAgent?: string | null | undefined;
          };
          user: Record<string, any> & {
            id: string;
            createdAt: Date;
            updatedAt: Date;
            email: string;
            emailVerified: boolean;
            name: string;
            image?: string | null | undefined;
          };
        };
      }>)[];
      metadata: {
        openapi: {
          operationId: string;
          description: string;
          responses: {
            "200": {
              description: string;
              content: {
                "application/json": {
                  schema: {
                    type: "array";
                    items: {
                      type: string;
                      properties: {
                        id: {
                          type: string;
                        };
                        providerId: {
                          type: string;
                        };
                        createdAt: {
                          type: string;
                          format: string;
                        };
                        updatedAt: {
                          type: string;
                          format: string;
                        };
                        accountId: {
                          type: string;
                        };
                        userId: {
                          type: string;
                        };
                        scopes: {
                          type: string;
                          items: {
                            type: string;
                          };
                        };
                      };
                      required: string[];
                    };
                  };
                };
              };
            };
          };
        };
      };
    }, {
      scopes: string[];
      id: string;
      createdAt: Date;
      updatedAt: Date;
      userId: string;
      providerId: string;
      accountId: string;
    }[]>;
    readonly deleteUserCallback: better_call79.StrictEndpoint<"/delete-user/callback", {
      method: "GET";
      query: zod46.ZodObject<{
        token: zod46.ZodString;
        callbackURL: zod46.ZodOptional<zod46.ZodString>;
      }, zod_v4_core13.$strip>;
      use: ((inputContext: better_call79.MiddlewareInputContext<better_call79.MiddlewareOptions>) => Promise<void>)[];
      metadata: {
        openapi: {
          description: string;
          responses: {
            "200": {
              description: string;
              content: {
                "application/json": {
                  schema: {
                    type: "object";
                    properties: {
                      success: {
                        type: string;
                        description: string;
                      };
                      message: {
                        type: string;
                        enum: string[];
                        description: string;
                      };
                    };
                    required: string[];
                  };
                };
              };
            };
          };
        };
      };
    }, {
      success: boolean;
      message: string;
    }>;
    readonly unlinkAccount: better_call79.StrictEndpoint<"/unlink-account", {
      method: "POST";
      body: zod46.ZodObject<{
        providerId: zod46.ZodString;
        accountId: zod46.ZodOptional<zod46.ZodString>;
      }, zod_v4_core13.$strip>;
      use: ((inputContext: better_call79.MiddlewareInputContext<better_call79.MiddlewareOptions>) => Promise<{
        session: {
          session: Record<string, any> & {
            id: string;
            createdAt: Date;
            updatedAt: Date;
            userId: string;
            expiresAt: Date;
            token: string;
            ipAddress?: string | null | undefined;
            userAgent?: string | null | undefined;
          };
          user: Record<string, any> & {
            id: string;
            createdAt: Date;
            updatedAt: Date;
            email: string;
            emailVerified: boolean;
            name: string;
            image?: string | null | undefined;
          };
        };
      }>)[];
      metadata: {
        openapi: {
          description: string;
          responses: {
            "200": {
              description: string;
              content: {
                "application/json": {
                  schema: {
                    type: "object";
                    properties: {
                      status: {
                        type: string;
                      };
                    };
                  };
                };
              };
            };
          };
        };
      };
    }, {
      status: boolean;
    }>;
    readonly refreshToken: better_call79.StrictEndpoint<"/refresh-token", {
      method: "POST";
      body: zod46.ZodObject<{
        providerId: zod46.ZodString;
        accountId: zod46.ZodOptional<zod46.ZodString>;
        userId: zod46.ZodOptional<zod46.ZodString>;
      }, zod_v4_core13.$strip>;
      metadata: {
        openapi: {
          description: string;
          responses: {
            200: {
              description: string;
              content: {
                "application/json": {
                  schema: {
                    type: "object";
                    properties: {
                      tokenType: {
                        type: string;
                      };
                      idToken: {
                        type: string;
                      };
                      accessToken: {
                        type: string;
                      };
                      refreshToken: {
                        type: string;
                      };
                      accessTokenExpiresAt: {
                        type: string;
                        format: string;
                      };
                      refreshTokenExpiresAt: {
                        type: string;
                        format: string;
                      };
                    };
                  };
                };
              };
            };
            400: {
              description: string;
            };
          };
        };
      };
    }, {
      accessToken: string | undefined;
      refreshToken: string | undefined;
      accessTokenExpiresAt: Date | undefined;
      refreshTokenExpiresAt: Date | undefined;
      scope: string | null | undefined;
      idToken: string | null | undefined;
      providerId: string;
      accountId: string;
    }>;
    readonly getAccessToken: better_call79.StrictEndpoint<"/get-access-token", {
      method: "POST";
      body: zod46.ZodObject<{
        providerId: zod46.ZodString;
        accountId: zod46.ZodOptional<zod46.ZodString>;
        userId: zod46.ZodOptional<zod46.ZodString>;
      }, zod_v4_core13.$strip>;
      metadata: {
        openapi: {
          description: string;
          responses: {
            200: {
              description: string;
              content: {
                "application/json": {
                  schema: {
                    type: "object";
                    properties: {
                      tokenType: {
                        type: string;
                      };
                      idToken: {
                        type: string;
                      };
                      accessToken: {
                        type: string;
                      };
                      accessTokenExpiresAt: {
                        type: string;
                        format: string;
                      };
                    };
                  };
                };
              };
            };
            400: {
              description: string;
            };
          };
        };
      };
    }, {
      accessToken: string;
      accessTokenExpiresAt: Date | undefined;
      scopes: string[];
      idToken: string | undefined;
    }>;
    readonly accountInfo: better_call79.StrictEndpoint<"/account-info", {
      method: "GET";
      use: ((inputContext: better_call79.MiddlewareInputContext<better_call79.MiddlewareOptions>) => Promise<{
        session: {
          session: Record<string, any> & {
            id: string;
            createdAt: Date;
            updatedAt: Date;
            userId: string;
            expiresAt: Date;
            token: string;
            ipAddress?: string | null | undefined;
            userAgent?: string | null | undefined;
          };
          user: Record<string, any> & {
            id: string;
            createdAt: Date;
            updatedAt: Date;
            email: string;
            emailVerified: boolean;
            name: string;
            image?: string | null | undefined;
          };
        };
      }>)[];
      metadata: {
        openapi: {
          description: string;
          responses: {
            "200": {
              description: string;
              content: {
                "application/json": {
                  schema: {
                    type: "object";
                    properties: {
                      user: {
                        type: string;
                        properties: {
                          id: {
                            type: string;
                          };
                          name: {
                            type: string;
                          };
                          email: {
                            type: string;
                          };
                          image: {
                            type: string;
                          };
                          emailVerified: {
                            type: string;
                          };
                        };
                        required: string[];
                      };
                      data: {
                        type: string;
                        properties: {};
                        additionalProperties: boolean;
                      };
                    };
                    required: string[];
                    additionalProperties: boolean;
                  };
                };
              };
            };
          };
        };
      };
      query: zod46.ZodOptional<zod46.ZodObject<{
        accountId: zod46.ZodOptional<zod46.ZodString>;
      }, zod_v4_core13.$strip>>;
    }, {
      user: _better_auth_core_oauth20.OAuth2UserInfo;
      data: Record<string, any>;
    } | null>;
  } & UnionToIntersection<Option["plugins"] extends (infer T)[] ? T extends BetterAuthPlugin ? T extends {
    endpoints: infer E;
  } ? E : {} : {} : {}>;
  middlewares: {
    path: string;
    middleware: any;
  }[];
};
declare const router: <Option extends BetterAuthOptions>(ctx: AuthContext, options: Option) => {
  handler: (request: Request) => Promise<Response>;
  endpoints: {
    readonly ok: better_call79.StrictEndpoint<"/ok", {
      method: "GET";
      metadata: {
        openapi: {
          description: string;
          responses: {
            "200": {
              description: string;
              content: {
                "application/json": {
                  schema: {
                    type: "object";
                    properties: {
                      ok: {
                        type: string;
                        description: string;
                      };
                    };
                    required: string[];
                  };
                };
              };
            };
          };
        };
        scope: "server";
      };
    }, {
      ok: boolean;
    }>;
    readonly error: better_call79.StrictEndpoint<"/error", {
      method: "GET";
      metadata: {
        openapi: {
          description: string;
          responses: {
            "200": {
              description: string;
              content: {
                "text/html": {
                  schema: {
                    type: "string";
                    description: string;
                  };
                };
              };
            };
          };
        };
        scope: "server";
      };
    }, Response>;
    readonly signInSocial: better_call79.StrictEndpoint<"/sign-in/social", {
      method: "POST";
      operationId: string;
      body: zod46.ZodObject<{
        callbackURL: zod46.ZodOptional<zod46.ZodString>;
        newUserCallbackURL: zod46.ZodOptional<zod46.ZodString>;
        errorCallbackURL: zod46.ZodOptional<zod46.ZodString>;
        provider: zod46.ZodType<"github" | "apple" | "atlassian" | "cognito" | "discord" | "facebook" | "figma" | "microsoft" | "google" | "huggingface" | "slack" | "spotify" | "twitch" | "twitter" | "dropbox" | "kick" | "linear" | "linkedin" | "gitlab" | "tiktok" | "reddit" | "roblox" | "salesforce" | "vk" | "zoom" | "notion" | "kakao" | "naver" | "line" | "paybin" | "paypal" | "polar" | "vercel" | (string & {}), unknown, zod_v4_core13.$ZodTypeInternals<"github" | "apple" | "atlassian" | "cognito" | "discord" | "facebook" | "figma" | "microsoft" | "google" | "huggingface" | "slack" | "spotify" | "twitch" | "twitter" | "dropbox" | "kick" | "linear" | "linkedin" | "gitlab" | "tiktok" | "reddit" | "roblox" | "salesforce" | "vk" | "zoom" | "notion" | "kakao" | "naver" | "line" | "paybin" | "paypal" | "polar" | "vercel" | (string & {}), unknown>>;
        disableRedirect: zod46.ZodOptional<zod46.ZodBoolean>;
        idToken: zod46.ZodOptional<zod46.ZodObject<{
          token: zod46.ZodString;
          nonce: zod46.ZodOptional<zod46.ZodString>;
          accessToken: zod46.ZodOptional<zod46.ZodString>;
          refreshToken: zod46.ZodOptional<zod46.ZodString>;
          expiresAt: zod46.ZodOptional<zod46.ZodNumber>;
        }, zod_v4_core13.$strip>>;
        scopes: zod46.ZodOptional<zod46.ZodArray<zod46.ZodString>>;
        requestSignUp: zod46.ZodOptional<zod46.ZodBoolean>;
        loginHint: zod46.ZodOptional<zod46.ZodString>;
        additionalData: zod46.ZodOptional<zod46.ZodRecord<zod46.ZodString, zod46.ZodAny>>;
      }, zod_v4_core13.$strip>;
      metadata: {
        $Infer: {
          body: zod46.infer<zod46.ZodObject<{
            callbackURL: zod46.ZodOptional<zod46.ZodString>;
            newUserCallbackURL: zod46.ZodOptional<zod46.ZodString>;
            errorCallbackURL: zod46.ZodOptional<zod46.ZodString>;
            provider: zod46.ZodType<"github" | "apple" | "atlassian" | "cognito" | "discord" | "facebook" | "figma" | "microsoft" | "google" | "huggingface" | "slack" | "spotify" | "twitch" | "twitter" | "dropbox" | "kick" | "linear" | "linkedin" | "gitlab" | "tiktok" | "reddit" | "roblox" | "salesforce" | "vk" | "zoom" | "notion" | "kakao" | "naver" | "line" | "paybin" | "paypal" | "polar" | "vercel" | (string & {}), unknown, zod_v4_core13.$ZodTypeInternals<"github" | "apple" | "atlassian" | "cognito" | "discord" | "facebook" | "figma" | "microsoft" | "google" | "huggingface" | "slack" | "spotify" | "twitch" | "twitter" | "dropbox" | "kick" | "linear" | "linkedin" | "gitlab" | "tiktok" | "reddit" | "roblox" | "salesforce" | "vk" | "zoom" | "notion" | "kakao" | "naver" | "line" | "paybin" | "paypal" | "polar" | "vercel" | (string & {}), unknown>>;
            disableRedirect: zod46.ZodOptional<zod46.ZodBoolean>;
            idToken: zod46.ZodOptional<zod46.ZodObject<{
              token: zod46.ZodString;
              nonce: zod46.ZodOptional<zod46.ZodString>;
              accessToken: zod46.ZodOptional<zod46.ZodString>;
              refreshToken: zod46.ZodOptional<zod46.ZodString>;
              expiresAt: zod46.ZodOptional<zod46.ZodNumber>;
            }, zod_v4_core13.$strip>>;
            scopes: zod46.ZodOptional<zod46.ZodArray<zod46.ZodString>>;
            requestSignUp: zod46.ZodOptional<zod46.ZodBoolean>;
            loginHint: zod46.ZodOptional<zod46.ZodString>;
            additionalData: zod46.ZodOptional<zod46.ZodRecord<zod46.ZodString, zod46.ZodAny>>;
          }, zod_v4_core13.$strip>>;
          returned: {
            redirect: boolean;
            token?: string | undefined;
            url?: string | undefined;
            user?: UnionToIntersection<StripEmptyObjects<{
              id: string;
              createdAt: Date;
              updatedAt: Date;
              email: string;
              emailVerified: boolean;
              name: string;
              image?: string | null | undefined;
            } & InferFieldsFromPlugins<Option, "user", "output"> & InferFieldsFromOptions<Option, "user", "output">>> | undefined;
          };
        };
        openapi: {
          description: string;
          operationId: string;
          responses: {
            "200": {
              description: string;
              content: {
                "application/json": {
                  schema: {
                    type: "object";
                    description: string;
                    properties: {
                      token: {
                        type: string;
                      };
                      user: {
                        type: string;
                        $ref: string;
                      };
                      url: {
                        type: string;
                      };
                      redirect: {
                        type: string;
                        enum: boolean[];
                      };
                    };
                    required: string[];
                  };
                };
              };
            };
          };
        };
      };
    }, {
      redirect: boolean;
      url: string;
    } | {
      redirect: boolean;
      token: string;
      url: undefined;
      user: UnionToIntersection<StripEmptyObjects<{
        id: string;
        createdAt: Date;
        updatedAt: Date;
        email: string;
        emailVerified: boolean;
        name: string;
        image?: string | null | undefined;
      } & InferFieldsFromPlugins<Option, "user", "output"> & InferFieldsFromOptions<Option, "user", "output">>>;
    }>;
    readonly callbackOAuth: better_call79.StrictEndpoint<"/callback/:id", {
      method: ("GET" | "POST")[];
      operationId: string;
      body: zod46.ZodOptional<zod46.ZodObject<{
        code: zod46.ZodOptional<zod46.ZodString>;
        error: zod46.ZodOptional<zod46.ZodString>;
        device_id: zod46.ZodOptional<zod46.ZodString>;
        error_description: zod46.ZodOptional<zod46.ZodString>;
        state: zod46.ZodOptional<zod46.ZodString>;
        user: zod46.ZodOptional<zod46.ZodString>;
      }, zod_v4_core13.$strip>>;
      query: zod46.ZodOptional<zod46.ZodObject<{
        code: zod46.ZodOptional<zod46.ZodString>;
        error: zod46.ZodOptional<zod46.ZodString>;
        device_id: zod46.ZodOptional<zod46.ZodString>;
        error_description: zod46.ZodOptional<zod46.ZodString>;
        state: zod46.ZodOptional<zod46.ZodString>;
        user: zod46.ZodOptional<zod46.ZodString>;
      }, zod_v4_core13.$strip>>;
      metadata: {
        allowedMediaTypes: string[];
        scope: "server";
      };
    }, void>;
    readonly getSession: better_call79.StrictEndpoint<"/get-session", {
      method: "GET";
      operationId: string;
      query: zod46.ZodOptional<zod46.ZodObject<{
        disableCookieCache: zod46.ZodOptional<zod46.ZodCoercedBoolean<unknown>>;
        disableRefresh: zod46.ZodOptional<zod46.ZodCoercedBoolean<unknown>>;
      }, zod_v4_core13.$strip>>;
      requireHeaders: true;
      metadata: {
        openapi: {
          operationId: string;
          description: string;
          responses: {
            "200": {
              description: string;
              content: {
                "application/json": {
                  schema: {
                    type: "object";
                    nullable: boolean;
                    properties: {
                      session: {
                        $ref: string;
                      };
                      user: {
                        $ref: string;
                      };
                    };
                    required: string[];
                  };
                };
              };
            };
          };
        };
      };
    }, {
      session: UnionToIntersection<StripEmptyObjects<{
        id: string;
        createdAt: Date;
        updatedAt: Date;
        userId: string;
        expiresAt: Date;
        token: string;
        ipAddress?: string | null | undefined;
        userAgent?: string | null | undefined;
      } & InferFieldsFromPlugins<Option, "session", "output"> & InferFieldsFromOptions<Option, "session", "output">>>;
      user: UnionToIntersection<StripEmptyObjects<{
        id: string;
        createdAt: Date;
        updatedAt: Date;
        email: string;
        emailVerified: boolean;
        name: string;
        image?: string | null | undefined;
      } & InferFieldsFromPlugins<Option, "user", "output"> & InferFieldsFromOptions<Option, "user", "output">>>;
    } | null>;
    readonly signOut: better_call79.StrictEndpoint<"/sign-out", {
      method: "POST";
      operationId: string;
      requireHeaders: true;
      metadata: {
        openapi: {
          operationId: string;
          description: string;
          responses: {
            "200": {
              description: string;
              content: {
                "application/json": {
                  schema: {
                    type: "object";
                    properties: {
                      success: {
                        type: string;
                      };
                    };
                  };
                };
              };
            };
          };
        };
      };
    }, {
      success: boolean;
    }>;
    readonly signUpEmail: better_call79.StrictEndpoint<"/sign-up/email", {
      method: "POST";
      operationId: string;
      use: ((inputContext: better_call79.MiddlewareInputContext<better_call79.MiddlewareOptions>) => Promise<void>)[];
      body: zod46.ZodIntersection<zod46.ZodObject<{
        name: zod46.ZodString;
        email: zod46.ZodEmail;
        password: zod46.ZodString;
        image: zod46.ZodOptional<zod46.ZodString>;
        callbackURL: zod46.ZodOptional<zod46.ZodString>;
        rememberMe: zod46.ZodOptional<zod46.ZodBoolean>;
      }, zod_v4_core13.$strip>, zod46.ZodRecord<zod46.ZodString, zod46.ZodAny>>;
      metadata: {
        allowedMediaTypes: string[];
        $Infer: {
          body: {
            name: string;
            email: string;
            password: string;
            image?: string | undefined;
            callbackURL?: string | undefined;
            rememberMe?: boolean | undefined;
          } & InferFieldsFromPlugins<Option, "user", "input"> & InferFieldsFromOptions<Option, "user", "input">;
          returned: {
            token: string | null;
            user: UnionToIntersection<StripEmptyObjects<{
              id: string;
              createdAt: Date;
              updatedAt: Date;
              email: string;
              emailVerified: boolean;
              name: string;
              image?: string | null | undefined;
            } & InferFieldsFromPlugins<Option, "user", "output"> & InferFieldsFromOptions<Option, "user", "output">>>;
          };
        };
        openapi: {
          operationId: string;
          description: string;
          requestBody: {
            content: {
              "application/json": {
                schema: {
                  type: "object";
                  properties: {
                    name: {
                      type: string;
                      description: string;
                    };
                    email: {
                      type: string;
                      description: string;
                    };
                    password: {
                      type: string;
                      description: string;
                    };
                    image: {
                      type: string;
                      description: string;
                    };
                    callbackURL: {
                      type: string;
                      description: string;
                    };
                    rememberMe: {
                      type: string;
                      description: string;
                    };
                  };
                  required: string[];
                };
              };
            };
          };
          responses: {
            "200": {
              description: string;
              content: {
                "application/json": {
                  schema: {
                    type: "object";
                    properties: {
                      token: {
                        type: string;
                        nullable: boolean;
                        description: string;
                      };
                      user: {
                        type: string;
                        properties: {
                          id: {
                            type: string;
                            description: string;
                          };
                          email: {
                            type: string;
                            format: string;
                            description: string;
                          };
                          name: {
                            type: string;
                            description: string;
                          };
                          image: {
                            type: string;
                            format: string;
                            nullable: boolean;
                            description: string;
                          };
                          emailVerified: {
                            type: string;
                            description: string;
                          };
                          createdAt: {
                            type: string;
                            format: string;
                            description: string;
                          };
                          updatedAt: {
                            type: string;
                            format: string;
                            description: string;
                          };
                        };
                        required: string[];
                      };
                    };
                    required: string[];
                  };
                };
              };
            };
            "422": {
              description: string;
              content: {
                "application/json": {
                  schema: {
                    type: "object";
                    properties: {
                      message: {
                        type: string;
                      };
                    };
                  };
                };
              };
            };
          };
        };
      };
    }, {
      token: null;
      user: UnionToIntersection<StripEmptyObjects<{
        id: string;
        createdAt: Date;
        updatedAt: Date;
        email: string;
        emailVerified: boolean;
        name: string;
        image?: string | null | undefined;
      } & InferFieldsFromPlugins<Option, "user", "output"> & InferFieldsFromOptions<Option, "user", "output">>>;
    } | {
      token: string;
      user: UnionToIntersection<StripEmptyObjects<{
        id: string;
        createdAt: Date;
        updatedAt: Date;
        email: string;
        emailVerified: boolean;
        name: string;
        image?: string | null | undefined;
      } & InferFieldsFromPlugins<Option, "user", "output"> & InferFieldsFromOptions<Option, "user", "output">>>;
    }>;
    readonly signInEmail: better_call79.StrictEndpoint<"/sign-in/email", {
      method: "POST";
      operationId: string;
      use: ((inputContext: better_call79.MiddlewareInputContext<better_call79.MiddlewareOptions>) => Promise<void>)[];
      body: zod46.ZodObject<{
        email: zod46.ZodString;
        password: zod46.ZodString;
        callbackURL: zod46.ZodOptional<zod46.ZodString>;
        rememberMe: zod46.ZodOptional<zod46.ZodDefault<zod46.ZodBoolean>>;
      }, zod_v4_core13.$strip>;
      metadata: {
        allowedMediaTypes: string[];
        $Infer: {
          body: {
            email: string;
            password: string;
            callbackURL?: string | undefined;
            rememberMe?: boolean | undefined;
          };
          returned: {
            redirect: boolean;
            token: string;
            url?: string | undefined;
            user: UnionToIntersection<StripEmptyObjects<{
              id: string;
              createdAt: Date;
              updatedAt: Date;
              email: string;
              emailVerified: boolean;
              name: string;
              image?: string | null | undefined;
            } & InferFieldsFromPlugins<Option, "user", "output"> & InferFieldsFromOptions<Option, "user", "output">>>;
          };
        };
        openapi: {
          operationId: string;
          description: string;
          responses: {
            "200": {
              description: string;
              content: {
                "application/json": {
                  schema: {
                    type: "object";
                    description: string;
                    properties: {
                      redirect: {
                        type: string;
                        enum: boolean[];
                      };
                      token: {
                        type: string;
                        description: string;
                      };
                      url: {
                        type: string;
                        nullable: boolean;
                      };
                      user: {
                        type: string;
                        $ref: string;
                      };
                    };
                    required: string[];
                  };
                };
              };
            };
          };
        };
      };
    }, {
      redirect: boolean;
      token: string;
      url?: string | undefined;
      user: UnionToIntersection<StripEmptyObjects<{
        id: string;
        createdAt: Date;
        updatedAt: Date;
        email: string;
        emailVerified: boolean;
        name: string;
        image?: string | null | undefined;
      } & InferFieldsFromPlugins<Option, "user", "output"> & InferFieldsFromOptions<Option, "user", "output">>>;
    }>;
    readonly resetPassword: better_call79.StrictEndpoint<"/reset-password", {
      method: "POST";
      operationId: string;
      query: zod46.ZodOptional<zod46.ZodObject<{
        token: zod46.ZodOptional<zod46.ZodString>;
      }, zod_v4_core13.$strip>>;
      body: zod46.ZodObject<{
        newPassword: zod46.ZodString;
        token: zod46.ZodOptional<zod46.ZodString>;
      }, zod_v4_core13.$strip>;
      metadata: {
        openapi: {
          operationId: string;
          description: string;
          responses: {
            "200": {
              description: string;
              content: {
                "application/json": {
                  schema: {
                    type: "object";
                    properties: {
                      status: {
                        type: string;
                      };
                    };
                  };
                };
              };
            };
          };
        };
      };
    }, {
      status: boolean;
    }>;
    readonly verifyPassword: better_call79.StrictEndpoint<"/verify-password", {
      method: "POST";
      body: zod46.ZodObject<{
        password: zod46.ZodString;
      }, zod_v4_core13.$strip>;
      metadata: {
        scope: "server";
        openapi: {
          operationId: string;
          description: string;
          responses: {
            "200": {
              description: string;
              content: {
                "application/json": {
                  schema: {
                    type: "object";
                    properties: {
                      status: {
                        type: string;
                      };
                    };
                  };
                };
              };
            };
          };
        };
      };
      use: ((inputContext: better_call79.MiddlewareInputContext<better_call79.MiddlewareOptions>) => Promise<{
        session: {
          session: Record<string, any> & {
            id: string;
            createdAt: Date;
            updatedAt: Date;
            userId: string;
            expiresAt: Date;
            token: string;
            ipAddress?: string | null | undefined;
            userAgent?: string | null | undefined;
          };
          user: Record<string, any> & {
            id: string;
            createdAt: Date;
            updatedAt: Date;
            email: string;
            emailVerified: boolean;
            name: string;
            image?: string | null | undefined;
          };
        };
      }>)[];
    }, {
      status: boolean;
    }>;
    readonly verifyEmail: better_call79.StrictEndpoint<"/verify-email", {
      method: "GET";
      operationId: string;
      query: zod46.ZodObject<{
        token: zod46.ZodString;
        callbackURL: zod46.ZodOptional<zod46.ZodString>;
      }, zod_v4_core13.$strip>;
      use: ((inputContext: better_call79.MiddlewareInputContext<better_call79.MiddlewareOptions>) => Promise<void>)[];
      metadata: {
        openapi: {
          description: string;
          parameters: ({
            name: string;
            in: "query";
            description: string;
            required: true;
            schema: {
              type: "string";
            };
          } | {
            name: string;
            in: "query";
            description: string;
            required: false;
            schema: {
              type: "string";
            };
          })[];
          responses: {
            "200": {
              description: string;
              content: {
                "application/json": {
                  schema: {
                    type: "object";
                    properties: {
                      user: {
                        type: string;
                        $ref: string;
                      };
                      status: {
                        type: string;
                        description: string;
                      };
                    };
                    required: string[];
                  };
                };
              };
            };
          };
        };
      };
    }, void | {
      status: boolean;
    }>;
    readonly sendVerificationEmail: better_call79.StrictEndpoint<"/send-verification-email", {
      method: "POST";
      operationId: string;
      body: zod46.ZodObject<{
        email: zod46.ZodEmail;
        callbackURL: zod46.ZodOptional<zod46.ZodString>;
      }, zod_v4_core13.$strip>;
      metadata: {
        openapi: {
          operationId: string;
          description: string;
          requestBody: {
            content: {
              "application/json": {
                schema: {
                  type: "object";
                  properties: {
                    email: {
                      type: string;
                      description: string;
                      example: string;
                    };
                    callbackURL: {
                      type: string;
                      description: string;
                      example: string;
                      nullable: boolean;
                    };
                  };
                  required: string[];
                };
              };
            };
          };
          responses: {
            "200": {
              description: string;
              content: {
                "application/json": {
                  schema: {
                    type: "object";
                    properties: {
                      status: {
                        type: string;
                        description: string;
                        example: boolean;
                      };
                    };
                  };
                };
              };
            };
            "400": {
              description: string;
              content: {
                "application/json": {
                  schema: {
                    type: "object";
                    properties: {
                      message: {
                        type: string;
                        description: string;
                        example: string;
                      };
                    };
                  };
                };
              };
            };
          };
        };
      };
    }, {
      status: boolean;
    }>;
    readonly changeEmail: better_call79.StrictEndpoint<"/change-email", {
      method: "POST";
      body: zod46.ZodObject<{
        newEmail: zod46.ZodEmail;
        callbackURL: zod46.ZodOptional<zod46.ZodString>;
      }, zod_v4_core13.$strip>;
      use: ((inputContext: better_call79.MiddlewareInputContext<better_call79.MiddlewareOptions>) => Promise<{
        session: {
          session: Record<string, any> & {
            id: string;
            createdAt: Date;
            updatedAt: Date;
            userId: string;
            expiresAt: Date;
            token: string;
            ipAddress?: string | null | undefined;
            userAgent?: string | null | undefined;
          };
          user: Record<string, any> & {
            id: string;
            createdAt: Date;
            updatedAt: Date;
            email: string;
            emailVerified: boolean;
            name: string;
            image?: string | null | undefined;
          };
        };
      }>)[];
      metadata: {
        openapi: {
          operationId: string;
          responses: {
            "200": {
              description: string;
              content: {
                "application/json": {
                  schema: {
                    type: "object";
                    properties: {
                      user: {
                        type: string;
                        $ref: string;
                      };
                      status: {
                        type: string;
                        description: string;
                      };
                      message: {
                        type: string;
                        enum: string[];
                        description: string;
                        nullable: boolean;
                      };
                    };
                    required: string[];
                  };
                };
              };
            };
            "422": {
              description: string;
              content: {
                "application/json": {
                  schema: {
                    type: "object";
                    properties: {
                      message: {
                        type: string;
                      };
                    };
                  };
                };
              };
            };
          };
        };
      };
    }, {
      status: boolean;
    }>;
    readonly changePassword: better_call79.StrictEndpoint<"/change-password", {
      method: "POST";
      operationId: string;
      body: zod46.ZodObject<{
        newPassword: zod46.ZodString;
        currentPassword: zod46.ZodString;
        revokeOtherSessions: zod46.ZodOptional<zod46.ZodBoolean>;
      }, zod_v4_core13.$strip>;
      use: ((inputContext: better_call79.MiddlewareInputContext<better_call79.MiddlewareOptions>) => Promise<{
        session: {
          session: Record<string, any> & {
            id: string;
            createdAt: Date;
            updatedAt: Date;
            userId: string;
            expiresAt: Date;
            token: string;
            ipAddress?: string | null | undefined;
            userAgent?: string | null | undefined;
          };
          user: Record<string, any> & {
            id: string;
            createdAt: Date;
            updatedAt: Date;
            email: string;
            emailVerified: boolean;
            name: string;
            image?: string | null | undefined;
          };
        };
      }>)[];
      metadata: {
        openapi: {
          operationId: string;
          description: string;
          responses: {
            "200": {
              description: string;
              content: {
                "application/json": {
                  schema: {
                    type: "object";
                    properties: {
                      token: {
                        type: string;
                        nullable: boolean;
                        description: string;
                      };
                      user: {
                        type: string;
                        properties: {
                          id: {
                            type: string;
                            description: string;
                          };
                          email: {
                            type: string;
                            format: string;
                            description: string;
                          };
                          name: {
                            type: string;
                            description: string;
                          };
                          image: {
                            type: string;
                            format: string;
                            nullable: boolean;
                            description: string;
                          };
                          emailVerified: {
                            type: string;
                            description: string;
                          };
                          createdAt: {
                            type: string;
                            format: string;
                            description: string;
                          };
                          updatedAt: {
                            type: string;
                            format: string;
                            description: string;
                          };
                        };
                        required: string[];
                      };
                    };
                    required: string[];
                  };
                };
              };
            };
          };
        };
      };
    }, {
      token: string | null;
      user: {
        id: string;
        createdAt: Date;
        updatedAt: Date;
        email: string;
        emailVerified: boolean;
        name: string;
        image?: string | null | undefined;
      } & Record<string, any>;
    }>;
    readonly setPassword: better_call79.StrictEndpoint<string, {
      method: "POST";
      body: zod46.ZodObject<{
        newPassword: zod46.ZodString;
      }, zod_v4_core13.$strip>;
      use: ((inputContext: better_call79.MiddlewareInputContext<better_call79.MiddlewareOptions>) => Promise<{
        session: {
          session: Record<string, any> & {
            id: string;
            createdAt: Date;
            updatedAt: Date;
            userId: string;
            expiresAt: Date;
            token: string;
            ipAddress?: string | null | undefined;
            userAgent?: string | null | undefined;
          };
          user: Record<string, any> & {
            id: string;
            createdAt: Date;
            updatedAt: Date;
            email: string;
            emailVerified: boolean;
            name: string;
            image?: string | null | undefined;
          };
        };
      }>)[];
    }, {
      status: boolean;
    }>;
    readonly updateUser: better_call79.StrictEndpoint<"/update-user", {
      method: "POST";
      operationId: string;
      body: zod46.ZodRecord<zod46.ZodString, zod46.ZodAny>;
      use: ((inputContext: better_call79.MiddlewareInputContext<better_call79.MiddlewareOptions>) => Promise<{
        session: {
          session: Record<string, any> & {
            id: string;
            createdAt: Date;
            updatedAt: Date;
            userId: string;
            expiresAt: Date;
            token: string;
            ipAddress?: string | null | undefined;
            userAgent?: string | null | undefined;
          };
          user: Record<string, any> & {
            id: string;
            createdAt: Date;
            updatedAt: Date;
            email: string;
            emailVerified: boolean;
            name: string;
            image?: string | null | undefined;
          };
        };
      }>)[];
      metadata: {
        $Infer: {
          body: Partial<AdditionalUserFieldsInput<Option>> & {
            name?: string | undefined;
            image?: string | undefined | null;
          };
        };
        openapi: {
          operationId: string;
          description: string;
          requestBody: {
            content: {
              "application/json": {
                schema: {
                  type: "object";
                  properties: {
                    name: {
                      type: string;
                      description: string;
                    };
                    image: {
                      type: string;
                      description: string;
                      nullable: boolean;
                    };
                  };
                };
              };
            };
          };
          responses: {
            "200": {
              description: string;
              content: {
                "application/json": {
                  schema: {
                    type: "object";
                    properties: {
                      user: {
                        type: string;
                        $ref: string;
                      };
                    };
                  };
                };
              };
            };
          };
        };
      };
    }, {
      status: boolean;
    }>;
    readonly deleteUser: better_call79.StrictEndpoint<"/delete-user", {
      method: "POST";
      use: ((inputContext: better_call79.MiddlewareInputContext<better_call79.MiddlewareOptions>) => Promise<{
        session: {
          session: Record<string, any> & {
            id: string;
            createdAt: Date;
            updatedAt: Date;
            userId: string;
            expiresAt: Date;
            token: string;
            ipAddress?: string | null | undefined;
            userAgent?: string | null | undefined;
          };
          user: Record<string, any> & {
            id: string;
            createdAt: Date;
            updatedAt: Date;
            email: string;
            emailVerified: boolean;
            name: string;
            image?: string | null | undefined;
          };
        };
      }>)[];
      body: zod46.ZodObject<{
        callbackURL: zod46.ZodOptional<zod46.ZodString>;
        password: zod46.ZodOptional<zod46.ZodString>;
        token: zod46.ZodOptional<zod46.ZodString>;
      }, zod_v4_core13.$strip>;
      metadata: {
        openapi: {
          operationId: string;
          description: string;
          requestBody: {
            content: {
              "application/json": {
                schema: {
                  type: "object";
                  properties: {
                    callbackURL: {
                      type: string;
                      description: string;
                    };
                    password: {
                      type: string;
                      description: string;
                    };
                    token: {
                      type: string;
                      description: string;
                    };
                  };
                };
              };
            };
          };
          responses: {
            "200": {
              description: string;
              content: {
                "application/json": {
                  schema: {
                    type: "object";
                    properties: {
                      success: {
                        type: string;
                        description: string;
                      };
                      message: {
                        type: string;
                        enum: string[];
                        description: string;
                      };
                    };
                    required: string[];
                  };
                };
              };
            };
          };
        };
      };
    }, {
      success: boolean;
      message: string;
    }>;
    readonly requestPasswordReset: better_call79.StrictEndpoint<"/request-password-reset", {
      method: "POST";
      body: zod46.ZodObject<{
        email: zod46.ZodEmail;
        redirectTo: zod46.ZodOptional<zod46.ZodString>;
      }, zod_v4_core13.$strip>;
      metadata: {
        openapi: {
          operationId: string;
          description: string;
          responses: {
            "200": {
              description: string;
              content: {
                "application/json": {
                  schema: {
                    type: "object";
                    properties: {
                      status: {
                        type: string;
                      };
                      message: {
                        type: string;
                      };
                    };
                  };
                };
              };
            };
          };
        };
      };
    }, {
      status: boolean;
      message: string;
    }>;
    readonly requestPasswordResetCallback: better_call79.StrictEndpoint<"/reset-password/:token", {
      method: "GET";
      operationId: string;
      query: zod46.ZodObject<{
        callbackURL: zod46.ZodString;
      }, zod_v4_core13.$strip>;
      use: ((inputContext: better_call79.MiddlewareInputContext<better_call79.MiddlewareOptions>) => Promise<void>)[];
      metadata: {
        openapi: {
          operationId: string;
          description: string;
          parameters: ({
            name: string;
            in: "path";
            required: true;
            description: string;
            schema: {
              type: "string";
            };
          } | {
            name: string;
            in: "query";
            required: true;
            description: string;
            schema: {
              type: "string";
            };
          })[];
          responses: {
            "200": {
              description: string;
              content: {
                "application/json": {
                  schema: {
                    type: "object";
                    properties: {
                      token: {
                        type: string;
                      };
                    };
                  };
                };
              };
            };
          };
        };
      };
    }, never>;
    readonly listSessions: better_call79.StrictEndpoint<"/list-sessions", {
      method: "GET";
      operationId: string;
      use: ((inputContext: better_call79.MiddlewareInputContext<better_call79.MiddlewareOptions>) => Promise<{
        session: {
          session: Record<string, any> & {
            id: string;
            createdAt: Date;
            updatedAt: Date;
            userId: string;
            expiresAt: Date;
            token: string;
            ipAddress?: string | null | undefined;
            userAgent?: string | null | undefined;
          };
          user: Record<string, any> & {
            id: string;
            createdAt: Date;
            updatedAt: Date;
            email: string;
            emailVerified: boolean;
            name: string;
            image?: string | null | undefined;
          };
        };
      }>)[];
      requireHeaders: true;
      metadata: {
        openapi: {
          operationId: string;
          description: string;
          responses: {
            "200": {
              description: string;
              content: {
                "application/json": {
                  schema: {
                    type: "array";
                    items: {
                      $ref: string;
                    };
                  };
                };
              };
            };
          };
        };
      };
    }, Prettify$1<UnionToIntersection<StripEmptyObjects<{
      id: string;
      createdAt: Date;
      updatedAt: Date;
      userId: string;
      expiresAt: Date;
      token: string;
      ipAddress?: string | null | undefined;
      userAgent?: string | null | undefined;
    } & InferFieldsFromPlugins<Option, "session", "output"> & InferFieldsFromOptions<Option, "session", "output">>>>[]>;
    readonly revokeSession: better_call79.StrictEndpoint<"/revoke-session", {
      method: "POST";
      body: zod46.ZodObject<{
        token: zod46.ZodString;
      }, zod_v4_core13.$strip>;
      use: ((inputContext: better_call79.MiddlewareInputContext<better_call79.MiddlewareOptions>) => Promise<{
        session: {
          session: Record<string, any> & {
            id: string;
            createdAt: Date;
            updatedAt: Date;
            userId: string;
            expiresAt: Date;
            token: string;
            ipAddress?: string | null | undefined;
            userAgent?: string | null | undefined;
          };
          user: Record<string, any> & {
            id: string;
            createdAt: Date;
            updatedAt: Date;
            email: string;
            emailVerified: boolean;
            name: string;
            image?: string | null | undefined;
          };
        };
      }>)[];
      requireHeaders: true;
      metadata: {
        openapi: {
          description: string;
          requestBody: {
            content: {
              "application/json": {
                schema: {
                  type: "object";
                  properties: {
                    token: {
                      type: string;
                      description: string;
                    };
                  };
                  required: string[];
                };
              };
            };
          };
          responses: {
            "200": {
              description: string;
              content: {
                "application/json": {
                  schema: {
                    type: "object";
                    properties: {
                      status: {
                        type: string;
                        description: string;
                      };
                    };
                    required: string[];
                  };
                };
              };
            };
          };
        };
      };
    }, {
      status: boolean;
    }>;
    readonly revokeSessions: better_call79.StrictEndpoint<"/revoke-sessions", {
      method: "POST";
      use: ((inputContext: better_call79.MiddlewareInputContext<better_call79.MiddlewareOptions>) => Promise<{
        session: {
          session: Record<string, any> & {
            id: string;
            createdAt: Date;
            updatedAt: Date;
            userId: string;
            expiresAt: Date;
            token: string;
            ipAddress?: string | null | undefined;
            userAgent?: string | null | undefined;
          };
          user: Record<string, any> & {
            id: string;
            createdAt: Date;
            updatedAt: Date;
            email: string;
            emailVerified: boolean;
            name: string;
            image?: string | null | undefined;
          };
        };
      }>)[];
      requireHeaders: true;
      metadata: {
        openapi: {
          description: string;
          responses: {
            "200": {
              description: string;
              content: {
                "application/json": {
                  schema: {
                    type: "object";
                    properties: {
                      status: {
                        type: string;
                        description: string;
                      };
                    };
                    required: string[];
                  };
                };
              };
            };
          };
        };
      };
    }, {
      status: boolean;
    }>;
    readonly revokeOtherSessions: better_call79.StrictEndpoint<"/revoke-other-sessions", {
      method: "POST";
      requireHeaders: true;
      use: ((inputContext: better_call79.MiddlewareInputContext<better_call79.MiddlewareOptions>) => Promise<{
        session: {
          session: Record<string, any> & {
            id: string;
            createdAt: Date;
            updatedAt: Date;
            userId: string;
            expiresAt: Date;
            token: string;
            ipAddress?: string | null | undefined;
            userAgent?: string | null | undefined;
          };
          user: Record<string, any> & {
            id: string;
            createdAt: Date;
            updatedAt: Date;
            email: string;
            emailVerified: boolean;
            name: string;
            image?: string | null | undefined;
          };
        };
      }>)[];
      metadata: {
        openapi: {
          description: string;
          responses: {
            "200": {
              description: string;
              content: {
                "application/json": {
                  schema: {
                    type: "object";
                    properties: {
                      status: {
                        type: string;
                        description: string;
                      };
                    };
                    required: string[];
                  };
                };
              };
            };
          };
        };
      };
    }, {
      status: boolean;
    }>;
    readonly linkSocialAccount: better_call79.StrictEndpoint<"/link-social", {
      method: "POST";
      requireHeaders: true;
      body: zod46.ZodObject<{
        callbackURL: zod46.ZodOptional<zod46.ZodString>;
        provider: zod46.ZodType<"github" | "apple" | "atlassian" | "cognito" | "discord" | "facebook" | "figma" | "microsoft" | "google" | "huggingface" | "slack" | "spotify" | "twitch" | "twitter" | "dropbox" | "kick" | "linear" | "linkedin" | "gitlab" | "tiktok" | "reddit" | "roblox" | "salesforce" | "vk" | "zoom" | "notion" | "kakao" | "naver" | "line" | "paybin" | "paypal" | "polar" | "vercel" | (string & {}), unknown, zod_v4_core13.$ZodTypeInternals<"github" | "apple" | "atlassian" | "cognito" | "discord" | "facebook" | "figma" | "microsoft" | "google" | "huggingface" | "slack" | "spotify" | "twitch" | "twitter" | "dropbox" | "kick" | "linear" | "linkedin" | "gitlab" | "tiktok" | "reddit" | "roblox" | "salesforce" | "vk" | "zoom" | "notion" | "kakao" | "naver" | "line" | "paybin" | "paypal" | "polar" | "vercel" | (string & {}), unknown>>;
        idToken: zod46.ZodOptional<zod46.ZodObject<{
          token: zod46.ZodString;
          nonce: zod46.ZodOptional<zod46.ZodString>;
          accessToken: zod46.ZodOptional<zod46.ZodString>;
          refreshToken: zod46.ZodOptional<zod46.ZodString>;
          scopes: zod46.ZodOptional<zod46.ZodArray<zod46.ZodString>>;
        }, zod_v4_core13.$strip>>;
        requestSignUp: zod46.ZodOptional<zod46.ZodBoolean>;
        scopes: zod46.ZodOptional<zod46.ZodArray<zod46.ZodString>>;
        errorCallbackURL: zod46.ZodOptional<zod46.ZodString>;
        disableRedirect: zod46.ZodOptional<zod46.ZodBoolean>;
        additionalData: zod46.ZodOptional<zod46.ZodRecord<zod46.ZodString, zod46.ZodAny>>;
      }, zod_v4_core13.$strip>;
      use: ((inputContext: better_call79.MiddlewareInputContext<better_call79.MiddlewareOptions>) => Promise<{
        session: {
          session: Record<string, any> & {
            id: string;
            createdAt: Date;
            updatedAt: Date;
            userId: string;
            expiresAt: Date;
            token: string;
            ipAddress?: string | null | undefined;
            userAgent?: string | null | undefined;
          };
          user: Record<string, any> & {
            id: string;
            createdAt: Date;
            updatedAt: Date;
            email: string;
            emailVerified: boolean;
            name: string;
            image?: string | null | undefined;
          };
        };
      }>)[];
      metadata: {
        openapi: {
          description: string;
          operationId: string;
          responses: {
            "200": {
              description: string;
              content: {
                "application/json": {
                  schema: {
                    type: "object";
                    properties: {
                      url: {
                        type: string;
                        description: string;
                      };
                      redirect: {
                        type: string;
                        description: string;
                      };
                      status: {
                        type: string;
                      };
                    };
                    required: string[];
                  };
                };
              };
            };
          };
        };
      };
    }, {
      url: string;
      redirect: boolean;
    }>;
    readonly listUserAccounts: better_call79.StrictEndpoint<"/list-accounts", {
      method: "GET";
      use: ((inputContext: better_call79.MiddlewareInputContext<better_call79.MiddlewareOptions>) => Promise<{
        session: {
          session: Record<string, any> & {
            id: string;
            createdAt: Date;
            updatedAt: Date;
            userId: string;
            expiresAt: Date;
            token: string;
            ipAddress?: string | null | undefined;
            userAgent?: string | null | undefined;
          };
          user: Record<string, any> & {
            id: string;
            createdAt: Date;
            updatedAt: Date;
            email: string;
            emailVerified: boolean;
            name: string;
            image?: string | null | undefined;
          };
        };
      }>)[];
      metadata: {
        openapi: {
          operationId: string;
          description: string;
          responses: {
            "200": {
              description: string;
              content: {
                "application/json": {
                  schema: {
                    type: "array";
                    items: {
                      type: string;
                      properties: {
                        id: {
                          type: string;
                        };
                        providerId: {
                          type: string;
                        };
                        createdAt: {
                          type: string;
                          format: string;
                        };
                        updatedAt: {
                          type: string;
                          format: string;
                        };
                        accountId: {
                          type: string;
                        };
                        userId: {
                          type: string;
                        };
                        scopes: {
                          type: string;
                          items: {
                            type: string;
                          };
                        };
                      };
                      required: string[];
                    };
                  };
                };
              };
            };
          };
        };
      };
    }, {
      scopes: string[];
      id: string;
      createdAt: Date;
      updatedAt: Date;
      userId: string;
      providerId: string;
      accountId: string;
    }[]>;
    readonly deleteUserCallback: better_call79.StrictEndpoint<"/delete-user/callback", {
      method: "GET";
      query: zod46.ZodObject<{
        token: zod46.ZodString;
        callbackURL: zod46.ZodOptional<zod46.ZodString>;
      }, zod_v4_core13.$strip>;
      use: ((inputContext: better_call79.MiddlewareInputContext<better_call79.MiddlewareOptions>) => Promise<void>)[];
      metadata: {
        openapi: {
          description: string;
          responses: {
            "200": {
              description: string;
              content: {
                "application/json": {
                  schema: {
                    type: "object";
                    properties: {
                      success: {
                        type: string;
                        description: string;
                      };
                      message: {
                        type: string;
                        enum: string[];
                        description: string;
                      };
                    };
                    required: string[];
                  };
                };
              };
            };
          };
        };
      };
    }, {
      success: boolean;
      message: string;
    }>;
    readonly unlinkAccount: better_call79.StrictEndpoint<"/unlink-account", {
      method: "POST";
      body: zod46.ZodObject<{
        providerId: zod46.ZodString;
        accountId: zod46.ZodOptional<zod46.ZodString>;
      }, zod_v4_core13.$strip>;
      use: ((inputContext: better_call79.MiddlewareInputContext<better_call79.MiddlewareOptions>) => Promise<{
        session: {
          session: Record<string, any> & {
            id: string;
            createdAt: Date;
            updatedAt: Date;
            userId: string;
            expiresAt: Date;
            token: string;
            ipAddress?: string | null | undefined;
            userAgent?: string | null | undefined;
          };
          user: Record<string, any> & {
            id: string;
            createdAt: Date;
            updatedAt: Date;
            email: string;
            emailVerified: boolean;
            name: string;
            image?: string | null | undefined;
          };
        };
      }>)[];
      metadata: {
        openapi: {
          description: string;
          responses: {
            "200": {
              description: string;
              content: {
                "application/json": {
                  schema: {
                    type: "object";
                    properties: {
                      status: {
                        type: string;
                      };
                    };
                  };
                };
              };
            };
          };
        };
      };
    }, {
      status: boolean;
    }>;
    readonly refreshToken: better_call79.StrictEndpoint<"/refresh-token", {
      method: "POST";
      body: zod46.ZodObject<{
        providerId: zod46.ZodString;
        accountId: zod46.ZodOptional<zod46.ZodString>;
        userId: zod46.ZodOptional<zod46.ZodString>;
      }, zod_v4_core13.$strip>;
      metadata: {
        openapi: {
          description: string;
          responses: {
            200: {
              description: string;
              content: {
                "application/json": {
                  schema: {
                    type: "object";
                    properties: {
                      tokenType: {
                        type: string;
                      };
                      idToken: {
                        type: string;
                      };
                      accessToken: {
                        type: string;
                      };
                      refreshToken: {
                        type: string;
                      };
                      accessTokenExpiresAt: {
                        type: string;
                        format: string;
                      };
                      refreshTokenExpiresAt: {
                        type: string;
                        format: string;
                      };
                    };
                  };
                };
              };
            };
            400: {
              description: string;
            };
          };
        };
      };
    }, {
      accessToken: string | undefined;
      refreshToken: string | undefined;
      accessTokenExpiresAt: Date | undefined;
      refreshTokenExpiresAt: Date | undefined;
      scope: string | null | undefined;
      idToken: string | null | undefined;
      providerId: string;
      accountId: string;
    }>;
    readonly getAccessToken: better_call79.StrictEndpoint<"/get-access-token", {
      method: "POST";
      body: zod46.ZodObject<{
        providerId: zod46.ZodString;
        accountId: zod46.ZodOptional<zod46.ZodString>;
        userId: zod46.ZodOptional<zod46.ZodString>;
      }, zod_v4_core13.$strip>;
      metadata: {
        openapi: {
          description: string;
          responses: {
            200: {
              description: string;
              content: {
                "application/json": {
                  schema: {
                    type: "object";
                    properties: {
                      tokenType: {
                        type: string;
                      };
                      idToken: {
                        type: string;
                      };
                      accessToken: {
                        type: string;
                      };
                      accessTokenExpiresAt: {
                        type: string;
                        format: string;
                      };
                    };
                  };
                };
              };
            };
            400: {
              description: string;
            };
          };
        };
      };
    }, {
      accessToken: string;
      accessTokenExpiresAt: Date | undefined;
      scopes: string[];
      idToken: string | undefined;
    }>;
    readonly accountInfo: better_call79.StrictEndpoint<"/account-info", {
      method: "GET";
      use: ((inputContext: better_call79.MiddlewareInputContext<better_call79.MiddlewareOptions>) => Promise<{
        session: {
          session: Record<string, any> & {
            id: string;
            createdAt: Date;
            updatedAt: Date;
            userId: string;
            expiresAt: Date;
            token: string;
            ipAddress?: string | null | undefined;
            userAgent?: string | null | undefined;
          };
          user: Record<string, any> & {
            id: string;
            createdAt: Date;
            updatedAt: Date;
            email: string;
            emailVerified: boolean;
            name: string;
            image?: string | null | undefined;
          };
        };
      }>)[];
      metadata: {
        openapi: {
          description: string;
          responses: {
            "200": {
              description: string;
              content: {
                "application/json": {
                  schema: {
                    type: "object";
                    properties: {
                      user: {
                        type: string;
                        properties: {
                          id: {
                            type: string;
                          };
                          name: {
                            type: string;
                          };
                          email: {
                            type: string;
                          };
                          image: {
                            type: string;
                          };
                          emailVerified: {
                            type: string;
                          };
                        };
                        required: string[];
                      };
                      data: {
                        type: string;
                        properties: {};
                        additionalProperties: boolean;
                      };
                    };
                    required: string[];
                    additionalProperties: boolean;
                  };
                };
              };
            };
          };
        };
      };
      query: zod46.ZodOptional<zod46.ZodObject<{
        accountId: zod46.ZodOptional<zod46.ZodString>;
      }, zod_v4_core13.$strip>>;
    }, {
      user: _better_auth_core_oauth20.OAuth2UserInfo;
      data: Record<string, any>;
    } | null>;
  } & UnionToIntersection<Option["plugins"] extends (infer T)[] ? T extends BetterAuthPlugin ? T extends {
    endpoints: infer E;
  } ? E : {} : {} : {}>;
};
//#endregion
export { APIError, type AuthEndpoint, type AuthMiddleware, accountInfo, callbackOAuth, changeEmail, changePassword, checkEndpointConflicts, createAuthEndpoint, createAuthMiddleware, createEmailVerificationToken, deleteUser, deleteUserCallback, error, formCsrfMiddleware, freshSessionMiddleware, getAccessToken, getEndpoints, getIp, getOAuthState, getSession, getSessionFromCtx, linkSocialAccount, listSessions, listUserAccounts, ok, optionsMiddleware, originCheck, originCheckMiddleware, refreshToken, requestOnlySessionMiddleware, requestPasswordReset, requestPasswordResetCallback, resetPassword, revokeOtherSessions, revokeSession, revokeSessions, router, sendVerificationEmail, sendVerificationEmailFn, sensitiveSessionMiddleware, sessionMiddleware, setPassword, signInEmail, signInSocial, signOut, signUpEmail, unlinkAccount, updateUser, verifyEmail, verifyPassword };
//# sourceMappingURL=index.d.mts.map