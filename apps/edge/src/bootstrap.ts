import { storage } from "./storage";

// A temporary upload endpoint allows copying images before changing API DNS.
// It has no application containers, database access, or application secrets.
export default {
	async fetch(
		request: Request,
		env: { OBJECTS: R2Bucket; OBJECT_STORAGE_TOKEN: string },
	): Promise<Response> {
		if (!new URL(request.url).pathname.startsWith("/__storage/"))
			return new Response(null, { status: 404 });
		return storage(request, env.OBJECTS, env.OBJECT_STORAGE_TOKEN);
	},
} satisfies ExportedHandler<{ OBJECTS: R2Bucket; OBJECT_STORAGE_TOKEN: string }>;
