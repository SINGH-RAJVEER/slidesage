import { generateGenericState, parseGenericState } from "./state.mjs";
import { generateState, parseState } from "./oauth2/state.mjs";
import { HIDE_METADATA } from "./utils/hide-metadata.mjs";
import { generateId } from "./utils/index.mjs";
import { APIError } from "./api/index.mjs";
import { betterAuth } from "./auth/full.mjs";
import { getCurrentAdapter } from "@better-auth/core/context";
import { createTelemetry, getTelemetryAuthConfig } from "@better-auth/telemetry";

export * from "@better-auth/core"

export * from "@better-auth/core/db"

export * from "@better-auth/core/env"

export * from "@better-auth/core/error"

export * from "@better-auth/core/oauth2"

export * from "@better-auth/core/utils"

export { APIError, HIDE_METADATA, betterAuth, createTelemetry, generateGenericState, generateId, generateState, getCurrentAdapter, getTelemetryAuthConfig, parseGenericState, parseState };