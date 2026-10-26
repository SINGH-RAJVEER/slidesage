import { describe, expect, test } from "bun:test";
import { storage } from "../src/storage";

const token = "test-storage-token-with-at-least-32-characters";
const data = new TextEncoder().encode("original image");
const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", data)), (b) =>
	b.toString(16).padStart(2, "0"),
).join("");
const url = `https://api.slidesage.app/__storage/presentations/deck/assets/${digest}.png`;

function fixture() {
	let object:
		| {
				body: Uint8Array;
				size: number;
				customMetadata: Record<string, string>;
				httpMetadata: { contentType: string };
		  }
		| undefined;
	const bucket = {
		async get() {
			return object;
		},
		async head() {
			return object;
		},
		async delete() {
			object = undefined;
		},
		async put(_key: string, body: Uint8Array, options: R2PutOptions) {
			expect(options.onlyIf).toEqual({ etagDoesNotMatch: "*" });
			if (object) return null;
			object = {
				body,
				size: body.length,
				customMetadata: options.customMetadata ?? {},
				httpMetadata: options.httpMetadata as { contentType: string },
			};
			return object;
		},
	} as unknown as R2Bucket;
	return bucket;
}

function request(method: string, body?: Uint8Array, authorized = true) {
	return new Request(url, {
		method,
		headers: {
			Authorization: authorized ? `Bearer ${token}` : "Bearer wrong",
			"Content-Type": "image/png",
			"X-Object-SHA256": digest,
		},
		body,
	});
}

describe("private immutable image gateway", () => {
	test("requires authorization for reads, writes, and deletes", async () => {
		const bucket = fixture();
		for (const method of ["GET", "PUT", "DELETE"]) {
			expect(
				(await storage(request(method, method === "PUT" ? data : undefined, false), bucket, token))
					.status,
			).toBe(404);
		}
	});
	test("keeps writes immutable and idempotent, then reads and deletes", async () => {
		const bucket = fixture();
		expect((await storage(request("PUT", data), bucket, token)).status).toBe(204);
		expect((await storage(request("PUT", data), bucket, token)).status).toBe(204);
		expect(
			(await storage(request("PUT", new TextEncoder().encode("changed")), bucket, token)).status,
		).toBe(400);
		const read = await storage(request("GET"), bucket, token);
		expect(await read.text()).toBe("original image");
		expect(read.headers.get("Cache-Control")).toBe("no-store");
		expect((await storage(request("DELETE"), bucket, token)).status).toBe(204);
		expect((await storage(request("GET"), bucket, token)).status).toBe(404);
	});
	test("rejects existing objects with conflicting metadata", async () => {
		const bucket = fixture();
		await bucket.put("ignored", data, {
			customMetadata: { sha256: "wrong" },
			onlyIf: { etagDoesNotMatch: "*" },
		});
		expect((await storage(request("PUT", data), bucket, token)).status).toBe(409);
	});
	test("bounds streaming uploads and restricts keys", async () => {
		const bucket = fixture();
		expect(
			(await storage(request("PUT", new Uint8Array((15 << 20) + 1)), bucket, token)).status,
		).toBe(413);
		const unsafe = new Request("https://api.slidesage.app/__storage/other/secret", {
			headers: { Authorization: `Bearer ${token}` },
		});
		expect((await storage(unsafe, bucket, token)).status).toBe(400);
	});
});
