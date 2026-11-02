import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

const [source, databaseFile, output = "infra/cloudflare/secrets.json"] = process.argv.slice(2);
if (!source || !databaseFile) {
	throw new Error(
		"Usage: bun infra/cloudflare/prepare-secrets.ts <api-env.json> <database-url-file> [output]",
	);
}
const input: unknown = JSON.parse(readFileSync(source, "utf8"));
if (
	!Array.isArray(input) ||
	input.some((value) => typeof value !== "string" || !value.includes("="))
) {
	throw new Error("Input must be the JSON array from docker inspect .Config.Env");
}
const config: Record<string, string> = {};
const allowed =
	/^(DATABASE_|WORKER_|AUTH_SECRET$|RATE_LIMIT_HASH_SECRET$|GOOGLE_|GITHUB_|RESEND_|EMAIL_|RAZORPAY_|AD_REWARD|OPEN_ROUTER_|EXA_|UNSPLASH_|BYOK_|OTEL_|GEN_AI_)/;
for (const value of input as string[]) {
	const split = value.indexOf("=");
	const key = value.slice(0, split);
	if (allowed.test(key)) config[key] = value.slice(split + 1);
}
for (const key of [
	"DATABASE_URL",
	"AUTH_SECRET",
	"RATE_LIMIT_HASH_SECRET",
	"BYOK_ENCRYPTION_KEY",
	"RAZORPAY_KEY_ID",
	"RAZORPAY_KEY_SECRET",
	"RAZORPAY_WEBHOOK_SECRET",
	"OPEN_ROUTER_API_KEY",
]) {
	if (!config[key]) throw new Error(`Missing required runtime setting ${key}`);
}
// The VPS address is replaced by the managed Neon database. Read it from a
// file so the credential never appears in shell history or process listings.
const database = new URL(readFileSync(databaseFile, "utf8").trim());
if (database.protocol !== "postgresql:" && database.protocol !== "postgres:")
	throw new Error("Expected a postgres database URL");
if (!["require", "verify-ca", "verify-full"].includes(database.searchParams.get("sslmode") ?? ""))
	throw new Error("The database URL must require TLS");
config["DATABASE_URL"] = database.toString();
config["OPEN_ROUTER_MODEL"] = "openrouter/free";
writeFileSync(
	output,
	JSON.stringify(
		{
			APP_ENV: JSON.stringify(config),
			OBJECT_STORAGE_TOKEN: randomBytes(32).toString("hex"),
		},
		null,
		"\t",
	) + "\n",
	{ mode: 0o600, flag: "wx" },
);
console.log(
	`Wrote ${output} with ${Object.keys(config).length} runtime settings. No secrets were printed.`,
);
