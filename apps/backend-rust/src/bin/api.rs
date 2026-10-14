#[tokio::main]
async fn main() -> std::io::Result<()> {
	let host = slidesage_backend::env_or("HOST", "127.0.0.1");
	let port = slidesage_backend::env_or("PORT", "8001")
		.parse::<u16>()
		.map_err(std::io::Error::other)?;
	let security = slidesage_backend::http::Security::from_env();
	eprintln!("development port: API health/CORS only");
	slidesage_backend::serve(slidesage_backend::http::router(security), &host, port).await
}
