import { getAuthTables } from "@better-auth/core/db";
import { APIError } from "better-call";

//#region src/db/schema.ts
const cache = /* @__PURE__ */ new WeakMap();
function parseOutputData(data, schema) {
	const fields = schema.fields;
	const parsedData = {};
	for (const key in data) {
		const field = fields[key];
		if (!field) {
			parsedData[key] = data[key];
			continue;
		}
		if (field.returned === false && key !== "id") continue;
		parsedData[key] = data[key];
	}
	return parsedData;
}
function getFields(options, table, mode) {
	const cacheKey = `${table}:${mode}`;
	if (!cache.has(options)) cache.set(options, /* @__PURE__ */ new Map());
	const tableCache = cache.get(options);
	if (tableCache.has(cacheKey)) return tableCache.get(cacheKey);
	const coreSchema = mode === "output" ? getAuthTables(options)[table]?.fields ?? {} : {};
	const additionalFields = table === "user" || table === "session" || table === "account" ? options[table]?.additionalFields : void 0;
	let schema = {
		...coreSchema,
		...additionalFields ?? {}
	};
	for (const plugin of options.plugins || []) if (plugin.schema && plugin.schema[table]) schema = {
		...schema,
		...plugin.schema[table].fields
	};
	tableCache.set(cacheKey, schema);
	return schema;
}
function parseUserOutput(options, user) {
	return parseOutputData(user, { fields: getFields(options, "user", "output") });
}
function parseSessionOutput(options, session) {
	return parseOutputData(session, { fields: getFields(options, "session", "output") });
}
function parseAccountOutput(options, account) {
	const { accessToken: _accessToken, refreshToken: _refreshToken, idToken: _idToken, accessTokenExpiresAt: _accessTokenExpiresAt, refreshTokenExpiresAt: _refreshTokenExpiresAt, password: _password, ...rest } = parseOutputData(account, { fields: getFields(options, "account", "output") });
	return rest;
}
function parseInputData(data, schema) {
	const action = schema.action || "create";
	const fields = schema.fields;
	const parsedData = Object.assign(Object.create(null), null);
	for (const key in fields) {
		if (key in data) {
			if (fields[key].input === false) {
				if (fields[key].defaultValue !== void 0) {
					if (action !== "update") {
						parsedData[key] = fields[key].defaultValue;
						continue;
					}
				}
				if (data[key]) throw new APIError("BAD_REQUEST", { message: `${key} is not allowed to be set` });
				continue;
			}
			if (fields[key].validator?.input && data[key] !== void 0) {
				const result = fields[key].validator.input["~standard"].validate(data[key]);
				if (result instanceof Promise) throw new APIError("INTERNAL_SERVER_ERROR", { message: "Async validation is not supported for additional fields" });
				if ("issues" in result && result.issues) throw new APIError("BAD_REQUEST", { message: result.issues[0]?.message || "Validation Error" });
				parsedData[key] = result.value;
				continue;
			}
			if (fields[key].transform?.input && data[key] !== void 0) {
				parsedData[key] = fields[key].transform?.input(data[key]);
				continue;
			}
			parsedData[key] = data[key];
			continue;
		}
		if (fields[key].defaultValue !== void 0 && action === "create") {
			if (typeof fields[key].defaultValue === "function") {
				parsedData[key] = fields[key].defaultValue();
				continue;
			}
			parsedData[key] = fields[key].defaultValue;
			continue;
		}
		if (fields[key].required && action === "create") throw new APIError("BAD_REQUEST", { message: `${key} is required` });
	}
	return parsedData;
}
function parseUserInput(options, user = {}, action) {
	return parseInputData(user, {
		fields: getFields(options, "user", "input"),
		action
	});
}
function parseAdditionalUserInput(options, user) {
	const schema = getFields(options, "user", "input");
	return parseInputData(user || {}, { fields: schema });
}
function parseAccountInput(options, account) {
	return parseInputData(account, { fields: getFields(options, "account", "input") });
}
function parseSessionInput(options, session) {
	return parseInputData(session, { fields: getFields(options, "session", "input") });
}
function mergeSchema(schema, newSchema) {
	if (!newSchema) return schema;
	for (const table in newSchema) {
		const newModelName = newSchema[table]?.modelName;
		if (newModelName) schema[table].modelName = newModelName;
		for (const field in schema[table].fields) {
			const newField = newSchema[table]?.fields?.[field];
			if (!newField) continue;
			schema[table].fields[field].fieldName = newField;
		}
	}
	return schema;
}

//#endregion
export { mergeSchema, parseAccountInput, parseAccountOutput, parseAdditionalUserInput, parseInputData, parseSessionInput, parseSessionOutput, parseUserInput, parseUserOutput };
//# sourceMappingURL=schema.mjs.map