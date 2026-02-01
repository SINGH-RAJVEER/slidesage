import { AnonymousOptions, AnonymousSession, UserWithAnonymous } from "./types.mjs";
import * as _better_auth_core2 from "@better-auth/core";
import * as better_call11 from "better-call";

//#region src/plugins/anonymous/index.d.ts
declare const anonymous: (options?: AnonymousOptions | undefined) => {
  id: "anonymous";
  endpoints: {
    signInAnonymous: better_call11.StrictEndpoint<"/sign-in/anonymous", {
      method: "POST";
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
                      user: {
                        $ref: string;
                      };
                      session: {
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
      token: string;
      user: Record<string, any> & {
        id: string;
        createdAt: Date;
        updatedAt: Date;
        email: string;
        emailVerified: boolean;
        name: string;
        image?: string | null | undefined;
      };
    } | null>;
    deleteAnonymousUser: better_call11.StrictEndpoint<"/delete-anonymous-user", {
      method: "POST";
      use: ((inputContext: better_call11.MiddlewareInputContext<better_call11.MiddlewareOptions>) => Promise<{
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
            200: {
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
            "400": {
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
                  required: string[];
                };
              };
            };
            "500": {
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
    }>;
  };
  hooks: {
    after: {
      matcher(ctx: _better_auth_core2.HookEndpointContext): boolean;
      handler: (inputContext: better_call11.MiddlewareInputContext<better_call11.MiddlewareOptions>) => Promise<void>;
    }[];
  };
  options: AnonymousOptions | undefined;
  schema: {
    user: {
      fields: {
        isAnonymous: {
          type: "boolean";
          required: false;
          input: false;
          defaultValue: false;
        };
      };
    };
  };
  $ERROR_CODES: {
    readonly INVALID_EMAIL_FORMAT: "Email was not generated in a valid format";
    readonly FAILED_TO_CREATE_USER: "Failed to create user";
    readonly COULD_NOT_CREATE_SESSION: "Could not create session";
    readonly ANONYMOUS_USERS_CANNOT_SIGN_IN_AGAIN_ANONYMOUSLY: "Anonymous users cannot sign in again anonymously";
    readonly FAILED_TO_DELETE_ANONYMOUS_USER: "Failed to delete anonymous user";
    readonly USER_IS_NOT_ANONYMOUS: "User is not anonymous";
    readonly DELETE_ANONYMOUS_USER_DISABLED: "Deleting anonymous users is disabled";
  };
};
//#endregion
export { AnonymousOptions, AnonymousSession, UserWithAnonymous, anonymous };
//# sourceMappingURL=index.d.mts.map