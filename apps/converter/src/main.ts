import { handle } from "./handler";

const port = Number(process.env["CARD_CONVERTER_PORT"] ?? process.env["PORT"] ?? "8090");
// Private by default: the generation worker is the only caller.
const hostname = process.env["CARD_CONVERTER_HOST"] ?? "127.0.0.1";

const server = Bun.serve({ port, hostname, fetch: handle });
console.log(`card converter listening on http://${server.hostname}:${server.port}`);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
	process.on(signal, () => {
		void server.stop().then(() => process.exit(0));
	});
}
