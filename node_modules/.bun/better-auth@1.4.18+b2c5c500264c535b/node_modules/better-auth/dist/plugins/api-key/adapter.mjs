import { safeJSONParse } from "@better-auth/core/utils";

//#region src/plugins/api-key/adapter.ts
/**
* Parses double-stringified metadata synchronously without updating the database.
* Use this for reading metadata, then call migrateLegacyMetadataInBackground for DB updates.
*
* @returns The properly parsed metadata object, or the original if already an object
*/
function parseDoubleStringifiedMetadata(metadata) {
	if (metadata == null) return null;
	if (typeof metadata === "object") return metadata;
	return safeJSONParse(metadata);
}
/**
* Checks if metadata needs migration (is a string instead of object)
*/
function needsMetadataMigration(metadata) {
	return metadata != null && typeof metadata === "string";
}
/**
* Batch migrates double-stringified metadata for multiple API keys.
* Runs all updates in parallel to avoid N sequential database calls.
*/
async function batchMigrateLegacyMetadata(ctx, apiKeys, opts) {
	if (opts.storage !== "database" && !opts.fallbackToDatabase) return;
	const keysToMigrate = apiKeys.filter((key) => needsMetadataMigration(key.metadata));
	if (keysToMigrate.length === 0) return;
	const migrationPromises = keysToMigrate.map(async (apiKey) => {
		const parsed = parseDoubleStringifiedMetadata(apiKey.metadata);
		try {
			await ctx.context.adapter.update({
				model: "apikey",
				where: [{
					field: "id",
					value: apiKey.id
				}],
				update: { metadata: parsed }
			});
		} catch (error) {
			ctx.context.logger.warn(`Failed to migrate double-stringified metadata for API key ${apiKey.id}:`, error);
		}
	});
	await Promise.all(migrationPromises);
}
/**
* Migrates double-stringified metadata to properly parsed object.
*
* This handles legacy data where metadata was incorrectly double-stringified.
* If metadata is a string (should be object after adapter's transform.output),
* it parses it and optionally updates the database.
*
* @returns The properly parsed metadata object
*/
async function migrateDoubleStringifiedMetadata(ctx, apiKey, opts) {
	const parsed = parseDoubleStringifiedMetadata(apiKey.metadata);
	if (needsMetadataMigration(apiKey.metadata) && (opts.storage === "database" || opts.fallbackToDatabase)) try {
		await ctx.context.adapter.update({
			model: "apikey",
			where: [{
				field: "id",
				value: apiKey.id
			}],
			update: { metadata: parsed }
		});
	} catch (error) {
		ctx.context.logger.warn(`Failed to migrate double-stringified metadata for API key ${apiKey.id}:`, error);
	}
	return parsed;
}
/**
* Generate storage key for API key by hashed key
*/
function getStorageKeyByHashedKey(hashedKey) {
	return `api-key:${hashedKey}`;
}
/**
* Generate storage key for API key by ID
*/
function getStorageKeyById(id) {
	return `api-key:by-id:${id}`;
}
/**
* Generate storage key for user's API key list
*/
function getStorageKeyByUserId(userId) {
	return `api-key:by-user:${userId}`;
}
/**
* Serialize API key for storage
*/
function serializeApiKey(apiKey) {
	return JSON.stringify({
		...apiKey,
		createdAt: apiKey.createdAt.toISOString(),
		updatedAt: apiKey.updatedAt.toISOString(),
		expiresAt: apiKey.expiresAt?.toISOString() ?? null,
		lastRefillAt: apiKey.lastRefillAt?.toISOString() ?? null,
		lastRequest: apiKey.lastRequest?.toISOString() ?? null
	});
}
/**
* Deserialize API key from storage
*/
function deserializeApiKey(data) {
	if (!data || typeof data !== "string") return null;
	try {
		const parsed = JSON.parse(data);
		return {
			...parsed,
			createdAt: new Date(parsed.createdAt),
			updatedAt: new Date(parsed.updatedAt),
			expiresAt: parsed.expiresAt ? new Date(parsed.expiresAt) : null,
			lastRefillAt: parsed.lastRefillAt ? new Date(parsed.lastRefillAt) : null,
			lastRequest: parsed.lastRequest ? new Date(parsed.lastRequest) : null
		};
	} catch {
		return null;
	}
}
/**
* Get the storage instance to use (custom methods take precedence)
*/
function getStorageInstance(ctx, opts) {
	if (opts.customStorage) return opts.customStorage;
	return ctx.context.secondaryStorage || null;
}
/**
* Calculate TTL in seconds for an API key
*/
function calculateTTL(apiKey) {
	if (apiKey.expiresAt) {
		const now = Date.now();
		const expiresAt = new Date(apiKey.expiresAt).getTime();
		const ttlSeconds = Math.floor((expiresAt - now) / 1e3);
		if (ttlSeconds > 0) return ttlSeconds;
	}
}
/**
* Get API key from secondary storage by hashed key
*/
async function getApiKeyFromStorage(ctx, hashedKey, storage) {
	const key = getStorageKeyByHashedKey(hashedKey);
	return deserializeApiKey(await storage.get(key));
}
/**
* Get API key from secondary storage by ID
*/
async function getApiKeyByIdFromStorage(ctx, id, storage) {
	const key = getStorageKeyById(id);
	return deserializeApiKey(await storage.get(key));
}
/**
* Store API key in secondary storage
*/
async function setApiKeyInStorage(ctx, apiKey, storage, ttl) {
	const serialized = serializeApiKey(apiKey);
	const hashedKey = apiKey.key;
	const id = apiKey.id;
	await storage.set(getStorageKeyByHashedKey(hashedKey), serialized, ttl);
	await storage.set(getStorageKeyById(id), serialized, ttl);
	const userKey = getStorageKeyByUserId(apiKey.userId);
	const userListData = await storage.get(userKey);
	let userIds = [];
	if (userListData && typeof userListData === "string") try {
		userIds = JSON.parse(userListData);
	} catch {
		userIds = [];
	}
	else if (Array.isArray(userListData)) userIds = userListData;
	if (!userIds.includes(id)) {
		userIds.push(id);
		await storage.set(userKey, JSON.stringify(userIds));
	}
}
/**
* Delete API key from secondary storage
*/
async function deleteApiKeyFromStorage(ctx, apiKey, storage) {
	const hashedKey = apiKey.key;
	const id = apiKey.id;
	const userId = apiKey.userId;
	await storage.delete(getStorageKeyByHashedKey(hashedKey));
	await storage.delete(getStorageKeyById(id));
	const userKey = getStorageKeyByUserId(userId);
	const userListData = await storage.get(userKey);
	let userIds = [];
	if (userListData && typeof userListData === "string") try {
		userIds = JSON.parse(userListData);
	} catch {
		userIds = [];
	}
	else if (Array.isArray(userListData)) userIds = userListData;
	const filteredIds = userIds.filter((keyId) => keyId !== id);
	if (filteredIds.length === 0) await storage.delete(userKey);
	else await storage.set(userKey, JSON.stringify(filteredIds));
}
/**
* Unified getter for API keys with support for all storage modes
*/
async function getApiKey(ctx, hashedKey, opts) {
	const storage = getStorageInstance(ctx, opts);
	if (opts.storage === "database") return await ctx.context.adapter.findOne({
		model: "apikey",
		where: [{
			field: "key",
			value: hashedKey
		}]
	});
	if (opts.storage === "secondary-storage" && opts.fallbackToDatabase) {
		if (storage) {
			const cached = await getApiKeyFromStorage(ctx, hashedKey, storage);
			if (cached) return cached;
		}
		const dbKey = await ctx.context.adapter.findOne({
			model: "apikey",
			where: [{
				field: "key",
				value: hashedKey
			}]
		});
		if (dbKey && storage) await setApiKeyInStorage(ctx, dbKey, storage, calculateTTL(dbKey));
		return dbKey;
	}
	if (opts.storage === "secondary-storage") {
		if (!storage) return null;
		return await getApiKeyFromStorage(ctx, hashedKey, storage);
	}
	return await ctx.context.adapter.findOne({
		model: "apikey",
		where: [{
			field: "key",
			value: hashedKey
		}]
	});
}
/**
* Unified getter for API keys by ID
*/
async function getApiKeyById(ctx, id, opts) {
	const storage = getStorageInstance(ctx, opts);
	if (opts.storage === "database") return await ctx.context.adapter.findOne({
		model: "apikey",
		where: [{
			field: "id",
			value: id
		}]
	});
	if (opts.storage === "secondary-storage" && opts.fallbackToDatabase) {
		if (storage) {
			const cached = await getApiKeyByIdFromStorage(ctx, id, storage);
			if (cached) return cached;
		}
		const dbKey = await ctx.context.adapter.findOne({
			model: "apikey",
			where: [{
				field: "id",
				value: id
			}]
		});
		if (dbKey && storage) await setApiKeyInStorage(ctx, dbKey, storage, calculateTTL(dbKey));
		return dbKey;
	}
	if (opts.storage === "secondary-storage") {
		if (!storage) return null;
		return await getApiKeyByIdFromStorage(ctx, id, storage);
	}
	return await ctx.context.adapter.findOne({
		model: "apikey",
		where: [{
			field: "id",
			value: id
		}]
	});
}
/**
* Unified setter for API keys with support for all storage modes
*/
async function setApiKey(ctx, apiKey, opts) {
	const storage = getStorageInstance(ctx, opts);
	const ttl = calculateTTL(apiKey);
	if (opts.storage === "database") return;
	if (opts.storage === "secondary-storage") {
		if (!storage) throw new Error("Secondary storage is required when storage mode is 'secondary-storage'");
		await setApiKeyInStorage(ctx, apiKey, storage, ttl);
		return;
	}
}
/**
* Unified deleter for API keys with support for all storage modes
*/
async function deleteApiKey(ctx, apiKey, opts) {
	const storage = getStorageInstance(ctx, opts);
	if (opts.storage === "database") return;
	if (opts.storage === "secondary-storage") {
		if (!storage) throw new Error("Secondary storage is required when storage mode is 'secondary-storage'");
		await deleteApiKeyFromStorage(ctx, apiKey, storage);
		return;
	}
}
/**
* List API keys for a user with support for all storage modes
*/
async function listApiKeys(ctx, userId, opts) {
	const storage = getStorageInstance(ctx, opts);
	if (opts.storage === "database") return await ctx.context.adapter.findMany({
		model: "apikey",
		where: [{
			field: "userId",
			value: userId
		}]
	});
	if (opts.storage === "secondary-storage" && opts.fallbackToDatabase) {
		const userKey = getStorageKeyByUserId(userId);
		if (storage) {
			const userListData = await storage.get(userKey);
			let userIds = [];
			if (userListData && typeof userListData === "string") try {
				userIds = JSON.parse(userListData);
			} catch {
				userIds = [];
			}
			else if (Array.isArray(userListData)) userIds = userListData;
			if (userIds.length > 0) {
				const apiKeys = [];
				for (const id of userIds) {
					const apiKey = await getApiKeyByIdFromStorage(ctx, id, storage);
					if (apiKey) apiKeys.push(apiKey);
				}
				return apiKeys;
			}
		}
		const dbKeys = await ctx.context.adapter.findMany({
			model: "apikey",
			where: [{
				field: "userId",
				value: userId
			}]
		});
		if (storage && dbKeys.length > 0) {
			const userIds = [];
			for (const apiKey of dbKeys) {
				await setApiKeyInStorage(ctx, apiKey, storage, calculateTTL(apiKey));
				userIds.push(apiKey.id);
			}
			await storage.set(userKey, JSON.stringify(userIds));
		}
		return dbKeys;
	}
	if (opts.storage === "secondary-storage") {
		if (!storage) return [];
		const userKey = getStorageKeyByUserId(userId);
		const userListData = await storage.get(userKey);
		let userIds = [];
		if (userListData && typeof userListData === "string") try {
			userIds = JSON.parse(userListData);
		} catch {
			return [];
		}
		else if (Array.isArray(userListData)) userIds = userListData;
		else return [];
		const apiKeys = [];
		for (const id of userIds) {
			const apiKey = await getApiKeyByIdFromStorage(ctx, id, storage);
			if (apiKey) apiKeys.push(apiKey);
		}
		return apiKeys;
	}
	return await ctx.context.adapter.findMany({
		model: "apikey",
		where: [{
			field: "userId",
			value: userId
		}]
	});
}

//#endregion
export { batchMigrateLegacyMetadata, deleteApiKey, getApiKey, getApiKeyById, listApiKeys, migrateDoubleStringifiedMetadata, parseDoubleStringifiedMetadata, setApiKey };
//# sourceMappingURL=adapter.mjs.map