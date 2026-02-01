import { EmailOTPOptions } from "./types.mjs";
import * as _better_auth_core7 from "@better-auth/core";
import * as _better_auth_core_db0 from "@better-auth/core/db";
import * as better_call29 from "better-call";
import * as zod0 from "zod";
import * as zod_v4_core0 from "zod/v4/core";

//#region src/plugins/email-otp/index.d.ts
declare const emailOTP: (options: EmailOTPOptions) => {
  id: "email-otp";
  init(ctx: _better_auth_core7.AuthContext): {
    options: {
      emailVerification: {
        sendVerificationEmail(data: {
          user: _better_auth_core_db0.User;
          url: string;
          token: string;
        }, request: Request | undefined): Promise<void>;
      };
    };
  } | undefined;
  endpoints: {
    sendVerificationOTP: better_call29.StrictEndpoint<"/email-otp/send-verification-otp", {
      method: "POST";
      body: zod0.ZodObject<{
        email: zod0.ZodString;
        type: zod0.ZodEnum<{
          "sign-in": "sign-in";
          "email-verification": "email-verification";
          "forget-password": "forget-password";
        }>;
      }, zod_v4_core0.$strip>;
      metadata: {
        openapi: {
          operationId: string;
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
          };
        };
      };
    }, {
      success: boolean;
    }>;
    createVerificationOTP: better_call29.StrictEndpoint<string, {
      method: "POST";
      body: zod0.ZodObject<{
        email: zod0.ZodString;
        type: zod0.ZodEnum<{
          "sign-in": "sign-in";
          "email-verification": "email-verification";
          "forget-password": "forget-password";
        }>;
      }, zod_v4_core0.$strip>;
      metadata: {
        openapi: {
          operationId: string;
          description: string;
          responses: {
            200: {
              description: string;
              content: {
                "application/json": {
                  schema: {
                    type: "string";
                  };
                };
              };
            };
          };
        };
      };
    }, string>;
    getVerificationOTP: better_call29.StrictEndpoint<string, {
      method: "GET";
      query: zod0.ZodObject<{
        email: zod0.ZodString;
        type: zod0.ZodEnum<{
          "sign-in": "sign-in";
          "email-verification": "email-verification";
          "forget-password": "forget-password";
        }>;
      }, zod_v4_core0.$strip>;
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
                      otp: {
                        type: string;
                        nullable: boolean;
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
      otp: null;
    } | {
      otp: string;
    }>;
    checkVerificationOTP: better_call29.StrictEndpoint<"/email-otp/check-verification-otp", {
      method: "POST";
      body: zod0.ZodObject<{
        email: zod0.ZodString;
        type: zod0.ZodEnum<{
          "sign-in": "sign-in";
          "email-verification": "email-verification";
          "forget-password": "forget-password";
        }>;
        otp: zod0.ZodString;
      }, zod_v4_core0.$strip>;
      metadata: {
        openapi: {
          operationId: string;
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
          };
        };
      };
    }, {
      success: boolean;
    }>;
    verifyEmailOTP: better_call29.StrictEndpoint<"/email-otp/verify-email", {
      method: "POST";
      body: zod0.ZodObject<{
        email: zod0.ZodString;
        otp: zod0.ZodString;
      }, zod_v4_core0.$strip>;
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
                      status: {
                        type: string;
                        description: string;
                        enum: boolean[];
                      };
                      token: {
                        type: string;
                        nullable: boolean;
                        description: string;
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
      status: boolean;
      token: string;
      user: {
        id: string;
        createdAt: Date;
        updatedAt: Date;
        email: string;
        emailVerified: boolean;
        name: string;
        image?: string | null | undefined;
      } & Record<string, any>;
    } | {
      status: boolean;
      token: null;
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
    signInEmailOTP: better_call29.StrictEndpoint<"/sign-in/email-otp", {
      method: "POST";
      body: zod0.ZodObject<{
        email: zod0.ZodString;
        otp: zod0.ZodString;
      }, zod_v4_core0.$strip>;
      metadata: {
        openapi: {
          operationId: string;
          description: string;
          responses: {
            200: {
              description: string;
              content: {
                "application/json": {
                  schema: {
                    type: "object";
                    properties: {
                      token: {
                        type: string;
                        description: string;
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
      token: string;
      user: {
        id: string;
        createdAt: Date;
        updatedAt: Date;
        email: string;
        emailVerified: boolean;
        name: string;
        image?: string | null | undefined;
      };
    }>;
    requestPasswordResetEmailOTP: better_call29.StrictEndpoint<"/email-otp/request-password-reset", {
      method: "POST";
      body: zod0.ZodObject<{
        email: zod0.ZodString;
      }, zod_v4_core0.$strip>;
      metadata: {
        openapi: {
          operationId: string;
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
                        description: string;
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
    forgetPasswordEmailOTP: better_call29.StrictEndpoint<"/forget-password/email-otp", {
      method: "POST";
      body: zod0.ZodObject<{
        email: zod0.ZodString;
      }, zod_v4_core0.$strip>;
      metadata: {
        openapi: {
          operationId: string;
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
                        description: string;
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
    resetPasswordEmailOTP: better_call29.StrictEndpoint<"/email-otp/reset-password", {
      method: "POST";
      body: zod0.ZodObject<{
        email: zod0.ZodString;
        otp: zod0.ZodString;
        password: zod0.ZodString;
      }, zod_v4_core0.$strip>;
      metadata: {
        openapi: {
          operationId: string;
          description: string;
          responses: {
            200: {
              description: string;
              contnt: {
                "application/json": {
                  schema: {
                    type: string;
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
  };
  hooks: {
    after: {
      matcher(context: _better_auth_core7.HookEndpointContext): boolean;
      handler: (inputContext: better_call29.MiddlewareInputContext<better_call29.MiddlewareOptions>) => Promise<void>;
    }[];
  };
  $ERROR_CODES: {
    readonly OTP_EXPIRED: "OTP expired";
    readonly INVALID_OTP: "Invalid OTP";
    readonly TOO_MANY_ATTEMPTS: "Too many attempts";
  };
  rateLimit: ({
    pathMatcher(path: string): path is "/email-otp/send-verification-otp";
    window: number;
    max: number;
  } | {
    pathMatcher(path: string): path is "/email-otp/check-verification-otp";
    window: number;
    max: number;
  } | {
    pathMatcher(path: string): path is "/email-otp/verify-email";
    window: number;
    max: number;
  } | {
    pathMatcher(path: string): path is "/sign-in/email-otp";
    window: number;
    max: number;
  } | {
    pathMatcher(path: string): path is "/email-otp/request-password-reset";
    window: number;
    max: number;
  } | {
    pathMatcher(path: string): path is "/email-otp/reset-password";
    window: number;
    max: number;
  } | {
    pathMatcher(path: string): path is "/forget-password/email-otp";
    window: number;
    max: number;
  })[];
  options: EmailOTPOptions;
};
//#endregion
export { type EmailOTPOptions, emailOTP };
//# sourceMappingURL=index.d.mts.map