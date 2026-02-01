import { __export, __reExport } from "./_virtual/rolldown_runtime.mjs";
import { DeepPartial, Expand, HasRequiredKeys, LiteralNumber, LiteralUnion, OmitId, PreserveJSDoc, Prettify, PrettifyDeep, RequiredKeysOf, StripEmptyObjects, UnionToIntersection, WithoutEmpty } from "./types/helper.mjs";
import { AtomListener, BetterAuthClientOptions, BetterAuthClientPlugin, ClientAtomListener, ClientOptions, ClientStore, InferActions, InferAdditionalFromClient, InferClientAPI, InferErrorCodes, InferPluginsFromClient, InferSessionFromClient, InferUserFromClient, IsSignal, SessionQueryParams, Store } from "./client/types.mjs";
import { Adapter, AdapterInstance, AdapterSchemaCreation, DBAdapter, DBAdapterInstance, DBAdapterSchemaCreation, DBTransactionAdapter, JoinConfig, JoinOption, TransactionAdapter, Where } from "./types/adapter.mjs";
import { FilteredAPI, InferAPI, InferSessionAPI } from "./types/api.mjs";
import { Account, AdditionalSessionFieldsInput, AdditionalSessionFieldsOutput, AdditionalUserFieldsInput, AdditionalUserFieldsOutput, InferPluginTypes, InferSession, InferUser, RateLimit, Session, User, Verification } from "./types/models.mjs";
import { InferOptionSchema, InferPluginErrorCodes } from "./types/plugins.mjs";
import { Auth } from "./types/auth.mjs";
import { BetterAuthAdvancedOptions, BetterAuthCookies, BetterAuthOptions, BetterAuthPlugin, BetterAuthRateLimitOptions } from "./types/index.mjs";
import { betterAuth } from "./auth/full.mjs";
import { generateState, parseState } from "./oauth2/state.mjs";
import { StateData, generateGenericState, parseGenericState } from "./state.mjs";
import { HIDE_METADATA } from "./utils/hide-metadata.mjs";
import { generateId } from "./utils/index.mjs";
import { APIError } from "./api/index.mjs";
import { StandardSchemaV1 } from "@better-auth/core";
import { getCurrentAdapter } from "@better-auth/core/context";
import { TelemetryEvent, createTelemetry, getTelemetryAuthConfig } from "@better-auth/telemetry";
import { JSONWebKeySet, JWTPayload } from "jose";
export * from "@better-auth/core";
export * from "@better-auth/core/db";
export * from "@better-auth/core/env";
export * from "@better-auth/core/error";
export * from "@better-auth/core/oauth2";
export * from "@better-auth/core/utils";
export * from "better-call";
export * from "zod";
export * from "@better-auth/core/social-providers";
export * from "zod/v4/core";
export * from "zod/v4";

//#region src/index.d.ts
declare namespace index_d_exports {
  export { APIError, Account, Adapter, AdapterInstance, AdapterSchemaCreation, AdditionalSessionFieldsInput, AdditionalSessionFieldsOutput, AdditionalUserFieldsInput, AdditionalUserFieldsOutput, AtomListener, Auth, BetterAuthAdvancedOptions, BetterAuthClientOptions, BetterAuthClientPlugin, BetterAuthCookies, BetterAuthOptions, BetterAuthPlugin, BetterAuthRateLimitOptions, ClientAtomListener, ClientOptions, ClientStore, DBAdapter, DBAdapterInstance, DBAdapterSchemaCreation, DBTransactionAdapter, DeepPartial, Expand, FilteredAPI, HIDE_METADATA, HasRequiredKeys, InferAPI, InferActions, InferAdditionalFromClient, InferClientAPI, InferErrorCodes, InferOptionSchema, InferPluginErrorCodes, InferPluginTypes, InferPluginsFromClient, InferSession, InferSessionAPI, InferSessionFromClient, InferUser, InferUserFromClient, IsSignal, JSONWebKeySet, JWTPayload, JoinConfig, JoinOption, LiteralNumber, LiteralUnion, OmitId, PreserveJSDoc, Prettify, PrettifyDeep, RateLimit, RequiredKeysOf, Session, SessionQueryParams, StandardSchemaV1, StateData, Store, StripEmptyObjects, TelemetryEvent, TransactionAdapter, UnionToIntersection, User, Verification, Where, WithoutEmpty, betterAuth, createTelemetry, generateGenericState, generateId, generateState, getCurrentAdapter, getTelemetryAuthConfig, parseGenericState, parseState };
}
import * as import___better_auth_core from "@better-auth/core";
import * as import___better_auth_core_db from "@better-auth/core/db";
import * as import___better_auth_core_env from "@better-auth/core/env";
import * as import___better_auth_core_error from "@better-auth/core/error";
import * as import___better_auth_core_oauth2 from "@better-auth/core/oauth2";
import * as import___better_auth_core_utils from "@better-auth/core/utils";
import * as import_better_call from "better-call";
import * as import_zod from "zod";
import * as import_zod_v4 from "zod/v4";
import * as import_zod_v4_core from "zod/v4/core";
//#endregion
export { APIError, Account, Adapter, AdapterInstance, AdapterSchemaCreation, AdditionalSessionFieldsInput, AdditionalSessionFieldsOutput, AdditionalUserFieldsInput, AdditionalUserFieldsOutput, AtomListener, Auth, BetterAuthAdvancedOptions, BetterAuthClientOptions, BetterAuthClientPlugin, BetterAuthCookies, BetterAuthOptions, BetterAuthPlugin, BetterAuthRateLimitOptions, ClientAtomListener, ClientOptions, ClientStore, DBAdapter, DBAdapterInstance, DBAdapterSchemaCreation, DBTransactionAdapter, DeepPartial, Expand, FilteredAPI, HIDE_METADATA, HasRequiredKeys, InferAPI, InferActions, InferAdditionalFromClient, InferClientAPI, InferErrorCodes, InferOptionSchema, InferPluginErrorCodes, InferPluginTypes, InferPluginsFromClient, InferSession, InferSessionAPI, InferSessionFromClient, InferUser, InferUserFromClient, IsSignal, type JSONWebKeySet, type JWTPayload, JoinConfig, JoinOption, LiteralNumber, LiteralUnion, OmitId, PreserveJSDoc, Prettify, PrettifyDeep, RateLimit, RequiredKeysOf, Session, SessionQueryParams, type StandardSchemaV1, StateData, Store, StripEmptyObjects, type TelemetryEvent, TransactionAdapter, UnionToIntersection, User, Verification, Where, WithoutEmpty, betterAuth, createTelemetry, generateGenericState, generateId, generateState, getCurrentAdapter, getTelemetryAuthConfig, index_d_exports, parseGenericState, parseState };
//# sourceMappingURL=index.d.mts.map