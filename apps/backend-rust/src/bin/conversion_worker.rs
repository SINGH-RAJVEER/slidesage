#[tokio::main]
async fn main() -> std::io::Result<()> {
	let host = slidesage_backend::env_or("CARD_CONVERTER_HOST", "127.0.0.1");
	let port = slidesage_backend::env_or("CARD_CONVERTER_PORT", "8091")
		.parse::<u16>()
		.map_err(std::io::Error::other)?;
	eprintln!(
		"development port: converter health, schema, templates, card conversion, document validation, assembly and drafts; PPTX export is pending"
	);
	slidesage_backend::serve(slidesage_backend::conversion::router(), &host, port).await
}
