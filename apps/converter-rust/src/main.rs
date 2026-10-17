#![forbid(unsafe_code)]

#[tokio::main]
async fn main() -> std::io::Result<()> {
	let host = env_or("CARD_CONVERTER_HOST", "127.0.0.1");
	let port = env_or("CARD_CONVERTER_PORT", "8091")
		.parse::<u16>()
		.map_err(std::io::Error::other)?;
	eprintln!(
		"development port: converter health, schema, templates, card conversion, document validation, assembly and drafts; PPTX export is pending"
	);
	serve(slidesage_converter::router(), &host, port).await
}

use std::io;

async fn serve(app: axum::Router, host: &str, port: u16) -> io::Result<()> {
	let listener = tokio::net::TcpListener::bind((host, port)).await?;
	println!("listening on {}", listener.local_addr()?);
	axum::serve(
		listener,
		app.into_make_service_with_connect_info::<std::net::SocketAddr>(),
	)
	.with_graceful_shutdown(shutdown())
	.await
}

async fn shutdown() {
	#[cfg(unix)]
	{
		let mut terminate =
			tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
				.expect("could not register SIGTERM handler");
		tokio::select! {
			_ = tokio::signal::ctrl_c() => {},
			_ = terminate.recv() => {},
		}
	}
	#[cfg(not(unix))]
	let _ = tokio::signal::ctrl_c().await;
}

fn env_or(name: &str, fallback: &str) -> String {
	std::env::var(name)
		.ok()
		.filter(|value| !value.trim().is_empty())
		.map(|value| value.trim().to_owned())
		.unwrap_or_else(|| fallback.to_owned())
}
