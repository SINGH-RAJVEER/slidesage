import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

const [source, identity, knownHosts, output = "infra/cloudflare/secrets.json"] =
	process.argv.slice(2);
if (!source || !identity || !knownHosts) {
	throw new Error(
		"Usage: bun infra/cloudflare/prepare-secrets.ts <api-env.json> <ssh-private-key> <known-hosts> [output]",
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
const databaseURL = config["DATABASE_URL"];
if (!databaseURL) throw new Error("DATABASE_URL is required");
const database = new URL(databaseURL);
database.hostname = "127.0.0.1";
database.port = "15432";
for (const override of ["host", "hostaddr", "port", "service", "servicefile"])
	database.searchParams.delete(override);
database.searchParams.set("sslmode", "disable");
config["DATABASE_URL"] = database.toString();
config["OPEN_ROUTER_MODEL"] = "openrouter/free";
const key = readFileSync(identity, "utf8");
if (!key.includes("PRIVATE KEY")) throw new Error("Expected an SSH private key");
const hosts = readFileSync(knownHosts, "utf8");
if (!hosts.includes("ssh-ed25519") && !hosts.includes("ecdsa-sha2-") && !hosts.includes("ssh-rsa"))
	throw new Error("Expected a pinned SSH host key");
writeFileSync(
	output,
	JSON.stringify(
		{
			APP_ENV: JSON.stringify(config),
			OBJECT_STORAGE_TOKEN: randomBytes(32).toString("hex"),
			DATABASE_SSH_PRIVATE_KEY: key,
			DATABASE_SSH_KNOWN_HOSTS: hosts,
		},
		null,
		"\t",
	) + "\n",
	{ mode: 0o600, flag: "wx" },
);
console.log(
	`Wrote ${output} with ${Object.keys(config).length} runtime settings. No secrets were printed.`,
);
