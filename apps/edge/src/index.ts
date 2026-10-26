import { DurableObject } from "cloudflare:workers";
import { storage } from "./storage";

interface Env {
	API: DurableObjectNamespace<ApiContainer>;
	GENERATION: DurableObjectNamespace<GenerationContainer>;
	OBJECTS: R2Bucket;
	VERSION: WorkerVersionMetadata;
	// JSON object of application variables, uploaded as one Worker secret.
	APP_ENV: string;
	OBJECT_STORAGE_TOKEN: string;
	OBJECT_STORAGE_URL: string;
	DATABASE_SSH_HOST: string;
	DATABASE_SSH_PORT: string;
	DATABASE_SSH_USER: string;
	DATABASE_SSH_TARGET: string;
	DATABASE_SSH_PRIVATE_KEY: string;
	DATABASE_SSH_KNOWN_HOSTS: string;
}

const INACTIVITY_MS = 5 * 60 * 1000;

class AppContainer extends DurableObject<Env> {
	protected role: "api" | "worker" = "api";
	private starting: Promise<void> | undefined;
	private monitoring: Promise<void> | undefined;

	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
		if (ctx.container?.running) {
			void ctx.blockConcurrencyWhile(() => ctx.container!.setInactivityTimeout(INACTIVITY_MS));
			this.observeExit();
		}
	}

	async ensureRunning(): Promise<void> {
		this.starting ??= this.startAndWait().finally(() => {
			this.starting = undefined;
		});
		return this.starting;
	}

	async fetch(request: Request): Promise<Response> {
		await this.ensureRunning();
		const url = new URL(request.url);
		url.protocol = "http:";
		url.host = "container";
		const forwarded = new Request(url, request);
		forwarded.headers.delete("host");
		return this.ctx.container!.getTcpPort(this.port).fetch(forwarded);
	}

	private get port(): number {
		return this.role === "api" ? 8000 : 8080;
	}

	private async startAndWait(): Promise<void> {
		const container = this.ctx.container!;
		const image = container.images["base"];
		if (!image) throw new Error("Container image is not configured");
		const previous = await this.ctx.storage.get<string>("release");
		const info = container.running ? await container.inspect() : null;
		// The direct API does not roll out new images to running instances for us.
		if (container.running && (info?.image !== image || previous !== this.env.VERSION.id)) {
			const exited = container.monitor().catch(() => {});
			container.signal(15);
			await Promise.race([exited, scheduler.wait(60_000)]);
			if (container.running) await container.destroy();
		}
		if (!container.running) {
			const config: unknown = JSON.parse(this.env.APP_ENV);
			if (
				!config ||
				typeof config !== "object" ||
				Array.isArray(config) ||
				Object.values(config).some((value) => typeof value !== "string")
			) {
				throw new Error("APP_ENV must be a JSON object of strings");
			}
			container.start({
				image,
				instance: "standard-1",
				enableInternet: true,
				env: {
					...(config as Record<string, string>),
					APP_ROLE: this.role,
					NODE_ENV: "production",
					HOST: "0.0.0.0",
					PORT: "8000",
					WORKER_HEALTH_PORT: "8080",
					BASE_URL: "https://api.slidesage.app",
					CORS_ORIGINS: "https://slidesage.app,https://www.slidesage.app",
					BETTER_AUTH_TRUSTED_ORIGINS: "https://slidesage.app,https://www.slidesage.app",
					TRUST_PROXY_HEADERS: "true",
					CARD_CONVERTER_URL: "http://127.0.0.1:8090",
					PRESENTATION_STORAGE_DIR: "",
					CACHE_VALKEY_ADDR: "",
					WORKER_MAINTENANCE_INTERVAL: "15m",
					WORKER_DRAIN_TIMEOUT: "45",
					OTEL_SERVICE_VERSION: this.env.VERSION.id,
					OBJECT_STORAGE_URL: this.env.OBJECT_STORAGE_URL,
					OBJECT_STORAGE_TOKEN: this.env.OBJECT_STORAGE_TOKEN,
					DATABASE_SSH_HOST: this.env.DATABASE_SSH_HOST,
					DATABASE_SSH_PORT: this.env.DATABASE_SSH_PORT,
					DATABASE_SSH_USER: this.env.DATABASE_SSH_USER,
					DATABASE_SSH_TARGET: this.env.DATABASE_SSH_TARGET,
					DATABASE_SSH_PRIVATE_KEY: this.env.DATABASE_SSH_PRIVATE_KEY,
					DATABASE_SSH_KNOWN_HOSTS: this.env.DATABASE_SSH_KNOWN_HOSTS,
				},
			});
			await this.ctx.storage.put("release", this.env.VERSION.id);
		}
		this.observeExit();
		await container.setInactivityTimeout(INACTIVITY_MS);
		const endpoint = this.role === "api" ? "/health" : "/ready";
		for (let attempt = 0; attempt < 100; attempt++) {
			try {
				const response = await container
					.getTcpPort(this.port)
					.fetch(`http://container${endpoint}`, { signal: AbortSignal.timeout(1_000) });
				await response.body?.cancel();
				if (response.ok) return;
			} catch {
				/* Startup includes establishing the database tunnel. */
			}
			await scheduler.wait(250);
		}
		throw new Error(`${this.role} container did not become ready`);
	}

	private observeExit(): void {
		if (this.monitoring) return;
		this.monitoring = this.ctx
			.container!.monitor()
			.catch(() => console.error(`${this.role} container exited with an error`))
			.finally(() => {
				this.monitoring = undefined;
			});
		this.ctx.waitUntil(this.monitoring);
	}
}

export class ApiContainer extends AppContainer {}
export class GenerationContainer extends AppContainer {
	protected override role = "worker" as const;
}

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		try {
			if (new URL(request.url).pathname.startsWith("/__storage/"))
				return await storage(request, env.OBJECTS, env.OBJECT_STORAGE_TOKEN);
			ctx.waitUntil(env.GENERATION.getByName("generation").ensureRunning());
			// Only the fixed API instance is public. No path can address a worker.
			return await env.API.getByName("api").fetch(request);
		} catch {
			console.error("Backend request failed");
			return Response.json(
				{ error: "The service is temporarily unavailable. Please try again." },
				{ status: 503 },
			);
		}
	},
	async scheduled(_controller: ScheduledController, env: Env): Promise<void> {
		// PostgreSQL polling does not renew the Container inactivity timeout.
		await Promise.all([
			env.GENERATION.getByName("generation").ensureRunning(),
			env.API.getByName("api").ensureRunning(),
		]);
	},
} satisfies ExportedHandler<Env>;
