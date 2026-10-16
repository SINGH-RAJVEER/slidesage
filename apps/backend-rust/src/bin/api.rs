#[tokio::main]
async fn main() -> std::io::Result<()> {
	if slidesage_backend::env_or("NODE_ENV", "") == "production"
		&& std::env::var("RATE_LIMIT_HASH_SECRET")
			.unwrap_or_default()
			.trim()
			.is_empty()
	{
		return Err(std::io::Error::other(
			"RATE_LIMIT_HASH_SECRET is required in production",
		));
	}
	let host = slidesage_backend::env_or("HOST", "127.0.0.1");
	let port = slidesage_backend::env_or("PORT", "8001")
		.parse::<u16>()
		.map_err(std::io::Error::other)?;
	let security = slidesage_backend::http::Security::from_env();
	let app = match std::env::var("DATABASE_URL") {
		Ok(url) if !url.trim().is_empty() => {
			let secret =
				slidesage_backend::env_or("AUTH_SECRET", "slidesage-local-development-secret");
			let secure = slidesage_backend::env_or("BASE_URL", "http://localhost:8000")
				.starts_with("https://");
			if secure
				&& (secret.len() < 32
					|| secret.starts_with("replace-")
					|| secret.starts_with("your-"))
			{
				return Err(std::io::Error::other(
					"AUTH_SECRET must be a non-placeholder secret of at least 32 characters for HTTPS",
				));
			}
			let database = sqlx::postgres::PgPoolOptions::new()
				.max_connections(5)
				.acquire_timeout(std::time::Duration::from_secs(10))
				.connect(&url)
				.await
				.map_err(std::io::Error::other)?;
			let state = slidesage_backend::http::ApiState {
				database,
				rate_limit_secret: slidesage_backend::env_or("RATE_LIMIT_HASH_SECRET", &secret),
				auth: slidesage_backend::auth::request::RequestAuth::new(
					secret.as_bytes(),
					if secure {
						"__Secure-slidesage_token"
					} else {
						"slidesage_token"
					},
				),
			};
			eprintln!(
				"development port: health/CORS, feedback, billing balance and presentation list/detail/delete; remaining endpoints are pending"
			);
			slidesage_backend::http::router_with_database(security, state)
		}
		_ => {
			eprintln!("development port without DATABASE_URL: health/CORS only");
			slidesage_backend::http::router(security)
		}
	};
	slidesage_backend::serve(app, &host, port).await
}
