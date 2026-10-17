import {
	closeSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	openSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
if (args.includes("--help")) {
	console.log("Usage: bun apps/backend-rust/compatibility/run.ts [--converter-full]");
	console.log(
		"Creates fresh UTF-8 PostgreSQL and Valkey instances, applies unchanged migrations, and tests the implemented Rust subset.",
	);
	console.log(
		"--converter-full includes unported converter handler cases and currently exits unsuccessfully.",
	);
	console.log(
		"Requires bun, go, cargo, SQLx CLI 0.9, PostgreSQL with pgvector, valkey-server and valkey-cli on PATH. Run inside devenv shell.",
	);
	process.exit(0);
}
if (args.some((arg) => arg !== "--converter-full")) throw new Error("Unknown argument; use --help");

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const rustRoot = join(root, "apps/backend-rust");
const fullConverter = args.includes("--converter-full");
for (const executable of [
	"bun",
	"go",
	"cargo",
	"initdb",
	"pg_ctl",
	"createdb",
	"psql",
	"valkey-server",
	"valkey-cli",
]) {
	if (!Bun.which(executable)) throw new Error(`Missing ${executable}; run inside devenv shell`);
}
const artifacts = mkdtempSync(join(tmpdir(), "slidesage-rust-compat-"));
const postgresData = join(artifacts, "postgres");
const cacheData = join(artifacts, "valkey");
mkdirSync(cacheData);
const results: { name: string; exitCode: number; milliseconds: number }[] = [];
const active = new Set<ReturnType<typeof Bun.spawn>>();
const services: { process: ReturnType<typeof Bun.spawn>; log: string }[] = [];
let postgresStarted = false;
let cleanupTask: Promise<void> | undefined;
let failure: string | undefined;
let interrupted = false;
const groups = new Set<number>();
let step = 0;

async function ports(count: number): Promise<number[]> {
	const reservations = [];
	const assigned = [];
	try {
		for (let index = 0; index < count; index++) {
			const server = createServer();
			await new Promise<void>((accept, reject) => {
				server.once("error", reject);
				server.listen(0, "127.0.0.1", accept);
			});
			reservations.push(server);
			const address = server.address();
			if (!address || typeof address === "string") throw new Error("Could not allocate test port");
			assigned.push(address.port);
		}
	} finally {
		await Promise.all(
			reservations.map((server) => new Promise<void>((accept) => server.close(() => accept()))),
		);
	}
	return assigned;
}

const allocated = await ports(5);
const [postgresPort, cachePort, apiPort, securePort, converterPort] = allocated;
if (!postgresPort || !cachePort || !apiPort || !securePort || !converterPort)
	throw new Error("Missing allocated port");
const databaseURL = `postgresql://slidesage@127.0.0.1:${postgresPort}/rust_compat?sslmode=disable`;
const authSecret = `rust-compat-${crypto.randomUUID()}-${crypto.randomUUID()}`;
const env = {
	...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("PG"))),
	NODE_ENV: "development",
	CGO_ENABLED: "0",
	DATABASE_URL: databaseURL,
	TEST_DATABASE_URL: databaseURL,
	TEST_RUST_DISPOSABLE_DATABASE: "true",
	FEEDBACK_TEST_DATABASE_URL: databaseURL,
	PGUSER: "slidesage",
	PGHOST: "127.0.0.1",
	PGPORT: String(postgresPort),
	PGPASSWORD: "",
	AUTH_SECRET: authSecret,
	TEST_AUTH_SECRET: authSecret,
	RATE_LIMIT_HASH_SECRET: authSecret,
	TEST_RATE_LIMIT_HASH_SECRET: authSecret,
	TRUST_PROXY_HEADERS: "true",
	CORS_ORIGINS: "https://slidesage.app",
	BASE_URL: "http://localhost:8000",
	CACHE_VALKEY_ADDR: `127.0.0.1:${cachePort}`,
	TEST_VALKEY_ADDR: `127.0.0.1:${cachePort}`,
	TEST_VALKEY_PASSWORD: "",
	TEST_VALKEY_CA_PEM: "",
	CACHE_VALKEY_AUTH: "",
	CACHE_VALKEY_PASSWORD: "",
	CACHE_VALKEY_CA_PEM: "",
	CACHE_TIMEOUT_MS: "100",
	TEST_SECURE_COOKIES: "false",
	TEST_COOKIE_NAME: "slidesage_token",
	CARGO_TARGET_DIR: join(rustRoot, "target"),
	API_UNDER_TEST_URL: `http://127.0.0.1:${apiPort}`,
	CONVERTER_UNDER_TEST_URL: `http://127.0.0.1:${converterPort}`,
	RUST_AUTH_COMPAT_BIN: join(rustRoot, "target/debug/examples/auth_compat"),
};

async function run(
	name: string,
	command: string[],
	overrides: Record<string, string> = {},
	cwd = root,
): Promise<void> {
	if (interrupted) throw new Error("Compatibility run interrupted");
	console.log(`[compat] ${name}`);
	const began = Date.now();
	const child = Bun.spawn(command, {
		cwd,
		env: { ...env, ...overrides },
		stdin: "ignore",
		stdout: "pipe",
		stderr: "pipe",
		detached: true,
	});
	active.add(child);
	groups.add(child.pid);
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited,
	]);
	active.delete(child);
	results.push({ name, exitCode, milliseconds: Date.now() - began });
	const log = join(
		artifacts,
		`${String(++step).padStart(2, "0")}-${name.replace(/[^a-z0-9]+/gi, "-")}.log`,
	);
	writeFileSync(log, stdout + stderr, { mode: 0o600 });
	if (exitCode !== 0) {
		console.error((stdout + stderr).split("\n").slice(-70).join("\n"));
		throw new Error(`${name} failed (${exitCode}); log: ${log}`);
	}
}

function start(name: string, command: string[], overrides: Record<string, string> = {}) {
	if (interrupted) throw new Error("Compatibility run interrupted");
	const log = join(artifacts, `${name}.log`);
	const descriptor = openSync(log, "a", 0o600);
	try {
		const child = Bun.spawn(command, {
			cwd: root,
			env: { ...env, ...overrides },
			stdin: "ignore",
			stdout: descriptor,
			stderr: descriptor,
			detached: true,
		});
		active.add(child);
		groups.add(child.pid);
		const service = { process: child, log };
		services.push(service);
		return service;
	} finally {
		closeSync(descriptor);
	}
}

async function ready(service: (typeof services)[number], url: string): Promise<void> {
	const deadline = Date.now() + 15_000;
	while (Date.now() < deadline) {
		if (service.process.exitCode !== null)
			throw new Error(`Test service exited; log: ${service.log}`);
		try {
			const response = await fetch(url, { signal: AbortSignal.timeout(500) });
			if (response.ok) {
				await response.arrayBuffer();
				return;
			}
			await response.body?.cancel();
		} catch {
			/* The listener may not have bound yet. */
		}
		await Bun.sleep(50);
	}
	throw new Error(`Test service readiness timed out; log: ${service.log}`);
}

function signalGroup(pid: number, signal: NodeJS.Signals | 0): boolean {
	try {
		process.kill(-pid, signal);
		return true;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
		throw error;
	}
}

async function cleanupServices(): Promise<void> {
	for (const pid of groups) signalGroup(pid, "SIGTERM");
	const deadline = Date.now() + 3000;
	while ([...groups].some((pid) => signalGroup(pid, 0)) && Date.now() < deadline)
		await Bun.sleep(25);
	for (const pid of groups) {
		if (signalGroup(pid, 0)) signalGroup(pid, "SIGKILL");
	}
	await Promise.all([...active].map((child) => child.exited));
	active.clear();
	if (postgresStarted || existsSync(join(postgresData, "postmaster.pid"))) {
		const child = Bun.spawn(["pg_ctl", "-D", postgresData, "-m", "fast", "-w", "stop"], {
			env,
			stdout: "ignore",
			stderr: "inherit",
		});
		if ((await child.exited) !== 0)
			throw new Error(`Could not stop disposable PostgreSQL at ${postgresData}`);
	}
	// Only remove service data created by this invocation; keep logs and the result.
	rmSync(postgresData, { recursive: true, force: true });
	rmSync(cacheData, { recursive: true, force: true });
}

function cleanup(): Promise<void> {
	cleanupTask ??= cleanupServices();
	return cleanupTask;
}

async function readyValkey(service: (typeof services)[number]): Promise<void> {
	const deadline = Date.now() + 15_000;
	while (Date.now() < deadline) {
		if (service.process.exitCode !== null)
			throw new Error(`Test Valkey exited; log: ${service.log}`);
		const child = Bun.spawn(["valkey-cli", "-h", "127.0.0.1", "-p", String(cachePort), "PING"], {
			env,
			stdout: "pipe",
			stderr: "ignore",
			detached: true,
		});
		active.add(child);
		groups.add(child.pid);
		const [output, code] = await Promise.all([new Response(child.stdout).text(), child.exited]);
		active.delete(child);
		if (service.process.exitCode === null && code === 0 && output.trim() === "PONG") return;
		await Bun.sleep(50);
	}
	throw new Error(`Test Valkey readiness timed out; log: ${service.log}`);
}

function writeResults(): void {
	writeFileSync(
		join(artifacts, "results.json"),
		`${JSON.stringify({ scope: fullConverter ? "implemented-backend-and-full-converter-handler-suite" : "implemented-subset", release_ready: false, passed: failure === undefined, failure, results }, null, "\t")}\n`,
		{ mode: 0o600 },
	);
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
	process.on(signal, () => {
		interrupted = true;
		failure ??= `Interrupted by ${signal}`;
		void cleanup().finally(() => {
			writeResults();
			console.error(`[compat] interrupted; results: ${join(artifacts, "results.json")}`);
			process.exit(130);
		});
	});
}

try {
	await run("initialize disposable PostgreSQL", [
		"initdb",
		"-D",
		postgresData,
		"-U",
		"slidesage",
		"--encoding=UTF8",
		"--no-locale",
		"--auth=trust",
	]);
	// mkdtemp uses a private path without whitespace; disable the Unix socket to keep it portable.
	await run("start disposable PostgreSQL", [
		"pg_ctl",
		"-D",
		postgresData,
		"-l",
		join(artifacts, "postgres.log"),
		"-o",
		`-h 127.0.0.1 -p ${postgresPort} -c unix_socket_directories=''`,
		"-w",
		"start",
	]);
	postgresStarted = true;
	await run("create disposable database", [
		"createdb",
		"-h",
		"127.0.0.1",
		"-p",
		String(postgresPort),
		"-U",
		"slidesage",
		"rust_compat",
	]);
	await run("apply unchanged Goose and River migrations", [
		"go",
		"-C",
		"apps/api",
		"run",
		"./cmd/migrate",
	]);
	await run("seed feedback fixture", [
		"psql",
		databaseURL,
		"-v",
		"ON_ERROR_STOP=1",
		"-c",
		"INSERT INTO users(id,name,email) VALUES('user-1','Compatibility fixture','feedback@example.test')",
	]);
	const valkey = start("valkey", [
		"valkey-server",
		"--bind",
		"127.0.0.1",
		"--port",
		String(cachePort),
		"--dir",
		cacheData,
		"--save",
		"",
		"--appendonly",
		"no",
	]);
	await readyValkey(valkey);
	await run(
		"check SQLx metadata",
		["cargo", "sqlx", "prepare", "--check", "--", "--locked", "--all-targets", "--all-features"],
		{},
		rustRoot,
	);
	await run("Rust tests with PostgreSQL and Valkey", [
		"cargo",
		"test",
		"--manifest-path",
		"apps/backend-rust/Cargo.toml",
		"--locked",
		"--all-targets",
		"--all-features",
	]);
	await run("build compatibility servers", [
		"cargo",
		"build",
		"--manifest-path",
		"apps/backend-rust/Cargo.toml",
		"--locked",
		"--bins",
		"--example",
		"auth_compat",
	]);
	if (valkey.process.exitCode !== null) throw new Error(`Test Valkey exited; log: ${valkey.log}`);
	const api = start("rust-api", [join(rustRoot, "target/debug/api")], {
		HOST: "127.0.0.1",
		PORT: String(apiPort),
	});
	const secureApi = start("rust-api-secure-cookie", [join(rustRoot, "target/debug/api")], {
		HOST: "127.0.0.1",
		PORT: String(securePort),
		BASE_URL: "https://slidesage.app",
	});
	const converter = start("rust-converter", [join(rustRoot, "target/debug/conversion_worker")], {
		CARD_CONVERTER_HOST: "127.0.0.1",
		CARD_CONVERTER_PORT: String(converterPort),
	});
	await Promise.all([
		ready(api, `${env.API_UNDER_TEST_URL}/health`),
		ready(secureApi, `http://127.0.0.1:${securePort}/health`),
		ready(converter, `${env.CONVERTER_UNDER_TEST_URL}/health`),
	]);
	await run("Go assertions against Rust", [
		"go",
		"-C",
		"apps/api",
		"test",
		"-count=1",
		"-p",
		"1",
		"-tags",
		"rustcompat",
		"./internal/auth",
		"./internal/presentation",
		"./internal/carddocument",
		"./internal/integrations/billing",
		"./internal/feedback",
		"./internal/middleware",
		"./cmd/api",
	]);
	await run(
		"secure-cookie auth comparisons",
		[
			"go",
			"-C",
			"apps/api",
			"test",
			"-count=1",
			"-tags",
			"rustcompat",
			"-run",
			"^TestAuthReadRoutesMatchRust$|^TestPasswordSignInMatchesRust$|^TestSignInOptionsMatchesRust$",
			"./internal/auth",
		],
		{
			API_UNDER_TEST_URL: `http://127.0.0.1:${securePort}`,
			TEST_SECURE_COOKIES: "true",
			TEST_COOKIE_NAME: "__Secure-slidesage_token",
		},
	);
	await run(
		"Bun converter reference assertions",
		["bun", "test", "--isolate", "apps/converter/src/handler.test.ts"],
		{ CONVERTER_UNDER_TEST_URL: "" },
	);
	const converterTests = ["bun", "test", "--isolate", "apps/converter/src/handler.test.ts"];
	if (!fullConverter)
		converterTests.push(
			"-t",
			"reports health|serves the drafting schema|preserves schema routing|schema version|template|validates all starter decks|validates an edited document|document validation",
		);
	await run(
		fullConverter
			? "full converter assertions against Rust"
			: "implemented converter assertions against Rust",
		converterTests,
	);
} catch (error) {
	failure ??= error instanceof Error ? error.message : String(error);
	console.error(`[compat] ${failure}`);
} finally {
	try {
		await cleanup();
	} catch (error) {
		failure ??= String(error);
		console.error(error);
	}
	writeResults();
}
console.log(
	`[compat] ${failure ? "FAILED" : "PASSED implemented subset"}; results: ${join(artifacts, "results.json")}`,
);
if (failure) process.exitCode = 1;
