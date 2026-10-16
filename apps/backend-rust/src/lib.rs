#![forbid(unsafe_code)]

pub mod auth;
pub mod billing;
pub mod conversion;
pub mod feedback;
pub mod http;

/// Go time.RFC3339Nano removes every trailing fractional zero.
pub fn rfc3339_nano(time: chrono::DateTime<chrono::Utc>) -> String {
	let text = time.to_rfc3339_opts(chrono::SecondsFormat::Nanos, true);
	format!(
		"{}Z",
		text.trim_end_matches('Z')
			.trim_end_matches('0')
			.trim_end_matches('.')
	)
}

use std::io;

/// Used by both standalone development servers. Production wiring is still pending.
pub async fn serve(app: axum::Router, host: &str, port: u16) -> io::Result<()> {
	let listener = tokio::net::TcpListener::bind((host, port)).await?;
	println!("listening on {}", listener.local_addr()?);
	axum::serve(listener, app)
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

pub fn env_or(name: &str, fallback: &str) -> String {
	std::env::var(name)
		.ok()
		.filter(|value| !value.trim().is_empty())
		.map(|value| value.trim().to_owned())
		.unwrap_or_else(|| fallback.to_owned())
}
