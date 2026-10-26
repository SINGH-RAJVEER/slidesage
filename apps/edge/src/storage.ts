const MAX_BYTES = 15 << 20;
const KEY = /^presentations\/[A-Za-z0-9_-]+\/assets\/([0-9a-f]{64})\.(jpg|png)$/;

// The gateway is reachable by containers and the one-time migration tool.
// It never serves an image to a browser without the Go API's authorization.
export async function storage(
	request: Request,
	bucket: R2Bucket,
	token: string,
): Promise<Response> {
	if (!token || token.length < 32 || !(await authorized(request, token))) {
		return new Response(null, { status: 404 });
	}
	const key = new URL(request.url).pathname.slice("/__storage/".length);
	const match = KEY.exec(key);
	if (!match) return new Response(null, { status: 400 });
	if (request.method === "GET") {
		const object = await bucket.get(key);
		if (!object) return new Response(null, { status: 404 });
		return new Response(object.body, {
			headers: {
				"Content-Type": object.httpMetadata?.contentType ?? "application/octet-stream",
				"Cache-Control": "no-store",
			},
		});
	}
	if (request.method === "DELETE") {
		await bucket.delete(key);
		return new Response(null, { status: 204 });
	}
	if (request.method !== "PUT") return new Response(null, { status: 405 });
	const expected = request.headers.get("X-Object-SHA256");
	const contentType = match[2] === "png" ? "image/png" : "image/jpeg";
	if (expected !== match[1] || request.headers.get("Content-Type") !== contentType) {
		return new Response(null, { status: 400 });
	}
	const data = await boundedBody(request);
	if (!data?.length) return new Response(null, { status: 413 });
	const sum = await crypto.subtle.digest("SHA-256", data);
	const digest = Array.from(new Uint8Array(sum), (byte) => byte.toString(16).padStart(2, "0")).join(
		"",
	);
	if (digest !== expected) return new Response(null, { status: 400 });
	const result = await bucket.put(key, data, {
		onlyIf: { etagDoesNotMatch: "*" },
		httpMetadata: { contentType },
		customMetadata: { sha256: digest },
	});
	if (!result) {
		const previous = await bucket.head(key);
		if (previous?.size !== data.byteLength || previous.customMetadata?.["sha256"] !== digest) {
			return new Response(null, { status: 409 });
		}
	}
	return new Response(null, { status: 204 });
}

async function authorized(request: Request, token: string): Promise<boolean> {
	// Compare fixed-length digests instead of returning after the first mismatch.
	const encode = new TextEncoder();
	const [actual, expected] = await Promise.all([
		crypto.subtle.digest("SHA-256", encode.encode(request.headers.get("Authorization") ?? "")),
		crypto.subtle.digest("SHA-256", encode.encode(`Bearer ${token}`)),
	]);
	const a = new Uint8Array(actual);
	const b = new Uint8Array(expected);
	let difference = 0;
	for (let index = 0; index < a.length; index++) difference |= (a[index] ?? 0) ^ (b[index] ?? 0);
	return difference === 0;
}

async function boundedBody(request: Request): Promise<Uint8Array<ArrayBuffer> | null> {
	if (Number(request.headers.get("Content-Length")) > MAX_BYTES) return null;
	const reader = request.body?.getReader();
	if (!reader) return null;
	const chunks: Uint8Array[] = [];
	let size = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		size += value.length;
		if (size > MAX_BYTES) {
			await reader.cancel();
			return null;
		}
		chunks.push(value);
	}
	const result = new Uint8Array(size);
	let offset = 0;
	for (const chunk of chunks) {
		result.set(chunk, offset);
		offset += chunk.length;
	}
	return result;
}
