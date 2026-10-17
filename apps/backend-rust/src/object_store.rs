//! Reads existing presentation objects from the same local keys as the Go store.

use std::{
	io,
	path::{Path, PathBuf},
};

pub struct FileBlobStore {
	root: PathBuf,
}

impl FileBlobStore {
	pub fn new(root: impl AsRef<Path>) -> io::Result<Self> {
		let root = root.as_ref();
		if root.as_os_str().to_string_lossy().trim().is_empty() {
			return Err(io::Error::new(
				io::ErrorKind::InvalidInput,
				"storage directory is required",
			));
		}
		let root = std::path::absolute(root)?;
		let mut builder = std::fs::DirBuilder::new();
		builder.recursive(true);
		#[cfg(unix)]
		{
			use std::os::unix::fs::DirBuilderExt;
			builder.mode(0o750);
		}
		builder.create(&root)?;
		Ok(Self { root })
	}

	pub async fn open(&self, key: &str) -> io::Result<tokio::fs::File> {
		if !valid_key(key) {
			return Err(io::Error::new(
				io::ErrorKind::InvalidInput,
				"invalid object key",
			));
		}
		tokio::fs::File::open(self.root.join(key)).await
	}
}

fn valid_key(key: &str) -> bool {
	!key.is_empty()
		&& key.len() <= 1024
		&& !key.contains(['\\', '\r', '\n', '\0'])
		&& key.split('/').all(|part| !matches!(part, "" | "." | ".."))
		&& !key.rsplit('/').next().unwrap_or_default().starts_with('.')
}

#[cfg(test)]
mod tests {
	use super::*;

	#[tokio::test]
	async fn reads_existing_objects_and_rejects_unclean_keys() {
		use tokio::io::AsyncReadExt;
		let root = std::env::temp_dir().join(format!("slidesage-objects-{}", uuid::Uuid::new_v4()));
		let store = FileBlobStore::new(&root).unwrap();
		std::fs::create_dir_all(root.join(".cache/assets")).unwrap();
		std::fs::write(root.join(".cache/assets/image"), b"image bytes").unwrap();
		let mut bytes = Vec::new();
		store
			.open(".cache/assets/image")
			.await
			.unwrap()
			.read_to_end(&mut bytes)
			.await
			.unwrap();
		assert_eq!(bytes, b"image bytes");
		assert_eq!(
			store.open("missing").await.unwrap_err().kind(),
			io::ErrorKind::NotFound
		);
		for key in [
			"",
			".",
			"..",
			"../escape",
			"/abs",
			"a//b",
			"a/./b",
			"a/../b",
			"a/",
			"a/.hidden",
			"a\\b",
			"a\r",
			"a\n",
			"a\0",
		] {
			assert_eq!(
				store.open(key).await.unwrap_err().kind(),
				io::ErrorKind::InvalidInput,
				"{key:?}"
			);
		}
		assert!(!valid_key(&"a".repeat(1025)));
		assert!(valid_key(&"a".repeat(1024)));
		std::fs::remove_dir_all(root).unwrap();
	}
}
