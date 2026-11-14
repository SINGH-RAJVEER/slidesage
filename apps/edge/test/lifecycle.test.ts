import { expect, mock, test } from "bun:test";

mock.module("cloudflare:workers", () => ({
	DurableObject: class {
		constructor(
			protected ctx: unknown,
			protected env: unknown,
		) {}
	},
}));

const { ApiContainer, GenerationContainer } = await import("../src/index");
(globalThis as unknown as { scheduler: unknown }).scheduler = { wait: () => new Promise(() => {}) };

function fixture(running = false, telemetry = false) {
	let release: string | undefined = running ? "old-release" : undefined;
	let finish: (() => void) | undefined;
	const calls: string[] = [];
	const environments: Record<string, string>[] = [];
	const container = {
		running,
		images: { base: "registry/image@sha256:new" },
		async inspect() {
			return { image: "registry/image@sha256:old" };
		},
		start(options: { env: Record<string, string> }) {
			environments.push(options.env);
			expect(options.env["PRESENTATION_STORAGE_DIR"]).toBe("");
			expect(options.env["CACHE_VALKEY_ADDR"]).toBe("");
			calls.push(`start:${options.env["APP_ROLE"]}`);
			this.running = true;
		},
		monitor() {
			return new Promise<void>((resolve) => {
				finish = resolve;
			});
		},
		signal(number: number) {
			expect(number).toBe(15);
			calls.push("drain");
			this.running = false;
			finish?.();
		},
		async destroy() {
			calls.push("destroy");
			this.running = false;
		},
		async setInactivityTimeout(milliseconds: number) {
			calls.push(`heartbeat:${milliseconds / 60_000}m`);
		},
		getTcpPort(port: number) {
			return {
				async fetch() {
					calls.push(`ready:${port}`);
					return new Response(null, { status: 204 });
				},
			};
		},
	};
	const waits: Promise<unknown>[] = [];
	const ctx = {
		container,
		storage: {
			async get() {
				return release;
			},
			async put(_key: string, value: string) {
				release = value;
			},
		},
		waitUntil(promise: Promise<unknown>) {
			waits.push(promise);
		},
		blockConcurrencyWhile(callback: () => Promise<unknown>) {
			return callback();
		},
	};
	const env = {
		APP_ENV: JSON.stringify({ DATABASE_URL: "postgresql://test@127.0.0.1:15432/db" }),
		VERSION: { id: "new-release" },
		OTEL_EXPORTER_OTLP_ENDPOINT: "https://otlp.us5.datadoghq.com",
		...(telemetry
			? {
					OTEL_EXPORTER_OTLP_HEADERS: "dd-api-key=test-key",
				}
			: {}),
	};
	return {
		ctx: ctx as unknown as DurableObjectState,
		env: env as never,
		calls,
		container,
		environments,
		exit: () => {
			container.running = false;
			finish?.();
		},
		// The exit monitor, then the restart it schedules.
		restarted: async () => {
			await waits[0];
			await waits[1];
		},
	};
}

test("passes telemetry configuration to both containers without replacing application settings", async () => {
	for (const Container of [ApiContainer, GenerationContainer]) {
		const f = fixture(false, true);
		await new Container(f.ctx, f.env).ensureRunning();
		expect(f.environments[0]?.DATABASE_URL).toBe("postgresql://test@127.0.0.1:15432/db");
		expect(f.environments[0]?.OTEL_EXPORTER_OTLP_ENDPOINT).toBe(
			"https://otlp.us5.datadoghq.com",
		);
		expect(f.environments[0]?.OTEL_EXPORTER_OTLP_HEADERS).toBe("dd-api-key=test-key");
		expect(f.environments[0]?.OTEL_EXPORTER_OTLP_PROTOCOL).toBe("http/protobuf");
	}
});

test("a worker starts on lite with an idle exit and a longer backstop timeout", async () => {
	const f = fixture();
	const worker = new GenerationContainer(f.ctx, f.env);
	await Promise.all([worker.ensureRunning(), worker.ensureRunning()]);
	expect(f.environments[0]?.OTEL_EXPORTER_OTLP_ENDPOINT).toBeUndefined();
	expect(f.environments[0]?.WORKER_IDLE_EXIT).toBe("5m");
	expect(f.calls.filter((call) => call.startsWith("start:"))).toEqual(["start:worker"]);
	expect(f.calls).toContain("heartbeat:15m");
	expect(f.calls).toContain("ready:8080");
});

test("a worker that exits right after a wake starts again", async () => {
	const f = fixture();
	await new GenerationContainer(f.ctx, f.env).ensureRunning();
	f.exit();
	await f.restarted();
	expect(f.calls.filter((call) => call.startsWith("start:"))).toEqual([
		"start:worker",
		"start:worker",
	]);
});

test("renewal keeps a running Container alive without starting a stopped one", async () => {
	const stopped = fixture();
	await new GenerationContainer(stopped.ctx, stopped.env).renew();
	expect(stopped.calls).toEqual([]);
	const running = fixture(true);
	await running.ctx.storage.put("release", "new-release");
	await new ApiContainer(running.ctx, running.env).renew();
	expect(running.calls).toContain("heartbeat:5m");
	expect(running.calls.some((call) => call.startsWith("start:"))).toBe(false);
});

test("renewal replaces a Container left running by an earlier release", async () => {
	const f = fixture(true);
	await new GenerationContainer(f.ctx, f.env).renew();
	expect(f.calls.indexOf("drain")).toBeLessThan(f.calls.indexOf("start:worker"));
});

test("an old running image drains before replacement", async () => {
	const f = fixture(true);
	const api = new ApiContainer(f.ctx, f.env);
	await api.ensureRunning();
	expect(f.calls.indexOf("drain")).toBeLessThan(f.calls.indexOf("start:api"));
	expect(f.calls).not.toContain("destroy");
	expect(f.calls).toContain("ready:8000");
});
