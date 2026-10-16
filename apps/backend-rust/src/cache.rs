//! Optional disposable Valkey storage. PostgreSQL remains authoritative.

use std::{
	future::Future,
	pin::Pin,
	sync::{
		Arc,
		atomic::{AtomicU64, Ordering},
	},
	time::{Duration, Instant},
};

use redis::{ConnectionAddr, IntoConnectionInfo, ProtocolVersion, RedisConnectionInfo};
use sha2::{Digest, Sha256};
use tokio::sync::{Mutex, Semaphore};

pub const MAX_VALUE_BYTES: usize = 4 << 20;
pub type CacheFuture<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;

pub trait Store: Send + Sync {
	fn get<'a>(&'a self, key: &'a str) -> CacheFuture<'a, Option<Vec<u8>>>;
	fn set<'a>(&'a self, key: &'a str, value: &'a [u8], ttl: Duration) -> CacheFuture<'a, ()>;
}

/// Hash byte lengths and values exactly like the Go cache. Keys contain no user text.
pub fn key(parts: &[&str]) -> String {
	let mut hash = Sha256::new();
	for part in parts {
		hash.update(format!("{}:", part.len()).as_bytes());
		hash.update(part.as_bytes());
	}
	format!("slidesage:cache:v1:{}", hex::encode(hash.finalize()))
}

/// Validate configuration without connecting. An absent address disables caching.
pub fn from_env() -> Result<Option<Arc<dyn Store>>, String> {
	configured(|name| std::env::var(name).unwrap_or_default())
		.map(|client| client.map(|client| Arc::new(client) as Arc<dyn Store>))
}

struct Client {
	client: redis::Client,
	connection: Mutex<Option<redis::aio::MultiplexedConnection>>,
	operations: Semaphore,
	timeout: Duration,
	started: Instant,
	retry_at: AtomicU64,
}

fn configured(env: impl Fn(&str) -> String) -> Result<Option<Client>, String> {
	let address = env("CACHE_VALKEY_ADDR").trim().to_owned();
	if address.is_empty() {
		return Ok(None);
	}
	let auth = env("CACHE_VALKEY_AUTH");
	if !matches!(auth.as_str(), "" | "password") {
		return Err("CACHE_VALKEY_AUTH must be empty or password".into());
	}
	let password = env("CACHE_VALKEY_PASSWORD");
	if auth == "password" && password.is_empty() {
		return Err("CACHE_VALKEY_AUTH=password requires CACHE_VALKEY_PASSWORD".into());
	}
	if env("NODE_ENV") == "production" && auth != "password" {
		return Err("production cache requires password authentication".into());
	}
	let raw_timeout = env("CACHE_TIMEOUT_MS");
	let millis = if raw_timeout.is_empty() {
		100
	} else {
		raw_timeout
			.parse::<u64>()
			.ok()
			.filter(|value| (1..=1000).contains(value))
			.ok_or("CACHE_TIMEOUT_MS must be between 1 and 1000")?
	};
	let (host, port) = address
		.rsplit_once(':')
		.and_then(|(host, port)| port.parse::<u16>().ok().map(|port| (host, port)))
		.ok_or("CACHE_VALKEY_ADDR must contain a host and port")?;
	let host = host
		.strip_prefix('[')
		.and_then(|host| host.strip_suffix(']'))
		.unwrap_or(host)
		.to_owned();
	let pem = env("CACHE_VALKEY_CA_PEM");
	let addr = if pem.is_empty() {
		ConnectionAddr::Tcp(host, port)
	} else {
		use rustls::pki_types::{CertificateDer, pem::PemObject};
		let mut roots = rustls::RootCertStore::empty();
		for certificate in CertificateDer::pem_slice_iter(pem.as_bytes()).flatten() {
			let _ = roots.add(certificate);
		}
		if roots.is_empty() {
			return Err("CACHE_VALKEY_CA_PEM contains no valid certificates".into());
		}
		ConnectionAddr::TcpTls {
			host,
			port,
			insecure: false,
			tls_params: None,
		}
	};
	let mut settings = RedisConnectionInfo::default().set_protocol(ProtocolVersion::RESP2);
	if auth == "password" {
		settings = settings.set_password(password);
	}
	let connection_info = addr
		.into_connection_info()
		.map_err(|_| "Invalid cache address")?
		.set_redis_settings(settings);
	let client = if pem.is_empty() {
		redis::Client::open(connection_info)
	} else {
		redis::Client::build_with_tls(
			connection_info,
			redis::TlsCertificates {
				client_tls: None,
				root_cert: Some(pem.into_bytes()),
			},
		)
	}
	.map_err(|_| "Invalid cache connection configuration")?;
	Ok(Some(Client {
		client,
		connection: Mutex::new(None),
		operations: Semaphore::new(8),
		timeout: Duration::from_millis(millis),
		started: Instant::now(),
		retry_at: AtomicU64::new(0),
	}))
}

impl Client {
	fn bypassed(&self) -> bool {
		self.started.elapsed().as_millis() < u128::from(self.retry_at.load(Ordering::Relaxed))
	}

	async fn connection(&self) -> redis::RedisResult<redis::aio::MultiplexedConnection> {
		let mut connection = self.connection.lock().await;
		if connection.is_none() {
			*connection = Some(self.client.get_multiplexed_async_connection().await?);
		}
		Ok(connection.as_ref().unwrap().clone())
	}

	fn failed(&self) {
		let now = self.started.elapsed().as_millis() as u64;
		let previous = self.retry_at.load(Ordering::Relaxed);
		if previous <= now
			&& self
				.retry_at
				.compare_exchange(previous, now + 5000, Ordering::Relaxed, Ordering::Relaxed)
				.is_ok()
		{
			eprintln!("cache unavailable; using PostgreSQL for the next five seconds");
		}
		// Another connection attempt must not extend this operation's timeout.
		if let Ok(mut connection) = self.connection.try_lock() {
			*connection = None;
		}
	}
}

impl Store for Client {
	fn get<'a>(&'a self, key: &'a str) -> CacheFuture<'a, Option<Vec<u8>>> {
		Box::pin(async move {
			if self.bypassed() {
				return None;
			}
			let result = tokio::time::timeout(self.timeout, async {
				let _permit = self.operations.acquire().await.unwrap();
				let mut connection = self.connection().await?;
				redis::cmd("GET")
					.arg(key)
					.query_async::<Option<Vec<u8>>>(&mut connection)
					.await
			})
			.await;
			match result {
				Ok(Ok(value)) => value.filter(|value| value.len() <= MAX_VALUE_BYTES),
				_ => {
					self.failed();
					None
				}
			}
		})
	}

	fn set<'a>(&'a self, key: &'a str, value: &'a [u8], ttl: Duration) -> CacheFuture<'a, ()> {
		Box::pin(async move {
			if value.len() > MAX_VALUE_BYTES || ttl.is_zero() || self.bypassed() {
				return;
			}
			let result = tokio::time::timeout(self.timeout, async {
				let _permit = self.operations.acquire().await.unwrap();
				let mut connection = self.connection().await?;
				redis::cmd("SET")
					.arg(key)
					.arg(value)
					.arg("PX")
					.arg(ttl.as_millis().max(1) as u64)
					.query_async::<()>(&mut connection)
					.await
			})
			.await;
			if !matches!(result, Ok(Ok(()))) {
				self.failed();
			}
		})
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	fn config(values: &[(&str, &str)]) -> Result<Option<Client>, String> {
		configured(|name| {
			values
				.iter()
				.find(|(key, _)| *key == name)
				.map(|(_, value)| value.to_string())
				.unwrap_or_default()
		})
	}

	#[test]
	fn disabled_configuration_and_password_requirements_match_go() {
		assert!(config(&[]).unwrap().is_none());
		for values in [
			vec![("NODE_ENV", "production")],
			vec![("CACHE_VALKEY_AUTH", "iam")],
			vec![("CACHE_VALKEY_AUTH", "password")],
			vec![("CACHE_TIMEOUT_MS", "0")],
			vec![("CACHE_TIMEOUT_MS", "1001")],
			vec![("CACHE_VALKEY_CA_PEM", "invalid")],
		] {
			let mut values = values;
			values.push(("CACHE_VALKEY_ADDR", "127.0.0.1:6379"));
			assert!(config(&values).is_err(), "{values:?}");
		}
		assert!(
			config(&[
				("CACHE_VALKEY_ADDR", "127.0.0.1:6379"),
				("NODE_ENV", "production"),
				("CACHE_VALKEY_AUTH", "password"),
				("CACHE_VALKEY_PASSWORD", "synthetic-password")
			])
			.unwrap()
			.is_some()
		);
	}

	#[test]
	fn keys_hash_byte_lengths_and_separate_identities() {
		assert_ne!(key(&["ab", "c"]), key(&["a", "bc"]));
		assert_ne!(key(&["list", "user-a", "1"]), key(&["list", "user-b", "1"]));
		let expected = Sha256::digest("2:é1:x".as_bytes());
		assert_eq!(
			key(&["é", "x"]),
			format!("slidesage:cache:v1:{}", hex::encode(expected))
		);
	}

	#[tokio::test]
	async fn hung_valkey_is_bounded_then_bypassed() {
		let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
		let address = listener.local_addr().unwrap().to_string();
		let server = tokio::spawn(async move {
			let (_stream, _) = listener.accept().await.unwrap();
			std::future::pending::<()>().await;
		});
		let client = config(&[("CACHE_VALKEY_ADDR", &address), ("CACHE_TIMEOUT_MS", "25")])
			.unwrap()
			.unwrap();
		let started = Instant::now();
		assert!(client.get("absent").await.is_none());
		assert!(started.elapsed() < Duration::from_millis(500));
		assert!(client.bypassed());
		client.set("key", b"value", Duration::from_secs(1)).await;
		assert!(client.get("absent").await.is_none());
		assert!(client.connection.lock().await.is_none());
		server.abort();
	}

	#[cfg(feature = "postgres-tests")]
	#[tokio::test]
	async fn native_valkey_round_trip_expiry_and_size_limit() {
		let address = std::env::var("TEST_VALKEY_ADDR")
			.expect("TEST_VALKEY_ADDR is required with postgres-tests");
		let password = std::env::var("TEST_VALKEY_PASSWORD").unwrap_or_default();
		let pem = std::env::var("TEST_VALKEY_CA_PEM").unwrap_or_default();
		let client = config(&[
			("CACHE_VALKEY_ADDR", &address),
			("CACHE_TIMEOUT_MS", "500"),
			(
				"CACHE_VALKEY_AUTH",
				if password.is_empty() { "" } else { "password" },
			),
			("CACHE_VALKEY_PASSWORD", &password),
			("CACHE_VALKEY_CA_PEM", &pem),
		])
		.unwrap()
		.unwrap();
		let key = key(&["rust-native-valkey", &uuid::Uuid::new_v4().to_string()]);
		client.set(&key, b"value", Duration::from_secs(1)).await;
		assert_eq!(client.get(&key).await.as_deref(), Some(&b"value"[..]));
		let mut connection = client.connection().await.unwrap();
		let ttl: i64 = redis::cmd("PTTL")
			.arg(&key)
			.query_async(&mut connection)
			.await
			.unwrap();
		assert!((1..=1000).contains(&ttl));
		redis::cmd("PEXPIRE")
			.arg(&key)
			.arg(1)
			.query_async::<i64>(&mut connection)
			.await
			.unwrap();
		tokio::time::sleep(Duration::from_millis(5)).await;
		assert!(client.get(&key).await.is_none());
		client
			.set(
				&key,
				&vec![0u8; MAX_VALUE_BYTES + 1],
				Duration::from_secs(1),
			)
			.await;
		assert!(client.get(&key).await.is_none());
		redis::cmd("SET")
			.arg(&key)
			.arg(vec![0u8; MAX_VALUE_BYTES + 1])
			.arg("PX")
			.arg(1000)
			.query_async::<()>(&mut connection)
			.await
			.unwrap();
		assert!(client.get(&key).await.is_none());
		redis::cmd("DEL")
			.arg(&key)
			.query_async::<i64>(&mut connection)
			.await
			.unwrap();
	}
}
