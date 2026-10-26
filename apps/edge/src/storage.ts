// Normalized PNGs can exceed the 15 MiB source upload limit. Stream these
// objects so their bytes do not consume the Worker's 128 MiB memory budget.
const MAX_BYTES = 96 << 20;
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
	const length = request.headers.get("Content-Length");
	if (!length) return new Response(null, { status: 411 });
	const size = Number(length);
	if (!Number.isSafeInteger(size) || size <= 0 || size > MAX_BYTES || !request.body) {
		return new Response(null, { status: 413 });
	}
	// R2 validates the supplied SHA-256 while consuming the known-length
	// request stream. A mismatched digest cannot create an object.
	const result = await bucket.put(key, request.body, {
		onlyIf: { etagDoesNotMatch: "*" },
		sha256: expected,
		httpMetadata: { contentType },
		customMetadata: { sha256: expected },
	});
	if (!result) {
		const previous = await bucket.head(key);
		if (previous?.size !== size || previous.customMetadata?.["sha256"] !== expected) {
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
