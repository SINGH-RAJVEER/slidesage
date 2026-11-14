{ pkgs, lib, config, ... }:
let
	# Pin Bun to the release CI uses until nixpkgs catches up.
	bunVersion = "1.4.4";
	bunReleases = {
		x86_64-linux = { asset = "linux-x64"; sha256 = "bf8ccbfb2b0b80159e0f9a6d15c55317add8077534dbc6130a3edb52fccb395c"; };
		aarch64-linux = { asset = "linux-aarch64"; sha256 = "baa6bb36f51d6e58561e02bbea825038a9df454f673d6d776e8bbf86f8c7850e"; };
		x86_64-darwin = { asset = "darwin-x64"; sha256 = "50a3491f73abc2fe81673171a85762d3bc2cc1680ccecadd983de99adf77977e"; };
		aarch64-darwin = { asset = "darwin-aarch64"; sha256 = "c240d7f0ccb90c263a849fcdb09b7ee62630d921348ed6aafda86b9d577bc510"; };
	};
	bunRelease = bunReleases.${pkgs.stdenv.hostPlatform.system};
	bun = pkgs.bun.overrideAttrs (_: {
		version = bunVersion;
		src = pkgs.fetchurl {
			url = "https://github.com/oven-sh/bun/releases/download/bun-v${bunVersion}/bun-${bunRelease.asset}.zip";
			inherit (bunRelease) sha256;
		};
	});
in
{
	dotenv.enable = true;

	packages = [
		bun
		pkgs.nodejs_24
		pkgs.openssh
		pkgs.docker-client
		pkgs.shellcheck
		pkgs.go
		pkgs.watchexec
		pkgs.goose
		pkgs.just
		pkgs.valkey
		pkgs.uv
	];

	services.postgres = {
		enable = true;
		package = pkgs.postgresql_18;
		extensions = extensions: [ extensions.pgvector ];
		createDatabase = false;
		listen_addresses = "127.0.0.1";
		port = 5432;
		initdbArgs = [
			"--username=postgres"
			"--encoding=UTF8"
			"--locale=C"
		];
		hbaConf = ''
			local all all trust
			host all all 127.0.0.1/32 trust
			host all all ::1/128 trust
		'';
	};

	tasks = {
		"db:setup" = {
			after = [ "devenv:processes:postgres@ready" ];
			exec = ''
				if ! psql -d postgres -tAc "SELECT 1 FROM pg_roles WHERE rolname = 'slidesage'" | grep -q 1; then
					psql -d postgres -c "CREATE USER slidesage WITH PASSWORD 'slidesage'"
				fi

				if ! psql -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname = 'slidesage'" | grep -q 1; then
					psql -d postgres -c "CREATE DATABASE slidesage OWNER slidesage"
				fi

				psql -d slidesage -c "CREATE EXTENSION IF NOT EXISTS vector"
				psql -d postgres -c "GRANT ALL PRIVILEGES ON DATABASE slidesage TO slidesage"
			'';
		};

		"db:migrate" = {
			after = [ "db:setup" ];
			exec = ''
				DATABASE_URL="postgresql://slidesage:slidesage@127.0.0.1:$PGPORT/slidesage" \
					go -C "$DEVENV_ROOT/apps/api" run ./cmd/migrate
			'';
		};
	};

	processes = {
		cache = {
			exec = ''
				mkdir -p "$DEVENV_STATE/valkey"
				exec valkey-server --bind 127.0.0.1 --port 6379 --dir "$DEVENV_STATE/valkey" \
					--save "" --appendonly no --maxmemory 256mb --maxmemory-policy allkeys-lru
			'';
			cwd = ".";
			ready = {
				exec = "valkey-cli -h 127.0.0.1 -p 6379 ping";
				initial_delay = 1;
				period = 1;
				probe_timeout = 3;
				success_threshold = 1;
				failure_threshold = 30;
			};
		};
		converter = {
			exec = "go run ./cmd/converter";
			cwd = "apps/api";
			ready = {
				http.get = {
					host = "127.0.0.1";
					port = 8090;
					path = "/health";
				};
				initial_delay = 1;
				period = 1;
				probe_timeout = 3;
				success_threshold = 1;
				failure_threshold = 30;
			};
		};
		api = {
			exec = ''
					mkdir -p "$DEVENV_STATE/go"
					export DATABASE_URL="postgresql://slidesage:slidesage@127.0.0.1:$PGPORT/slidesage"
					export CACHE_VALKEY_ADDR="127.0.0.1:6379"
					exec watchexec --restart --debounce 300ms --stop-signal SIGTERM --stop-timeout 20s \
						--watch . --exts go,mod,sum --shell bash -- \
						'go build -o "$DEVENV_STATE/go/api" ./cmd/api && exec "$DEVENV_STATE/go/api"'
			'';
			cwd = "apps/api";
			after = [ "db:migrate" "devenv:processes:converter" "devenv:processes:cache" ];
			ready = {
				http.get = {
					port = 8000;
					path = "/health";
				};
				initial_delay = 1;
				period = 1;
				probe_timeout = 3;
				success_threshold = 1;
				failure_threshold = 30;
			};
		};
		worker = {
			exec = ''
					mkdir -p "$DEVENV_STATE/go"
					export DATABASE_URL="postgresql://slidesage:slidesage@127.0.0.1:$PGPORT/slidesage"
					exec watchexec --restart --debounce 300ms --stop-signal SIGTERM --stop-timeout 20s \
						--watch . --exts go,mod,sum --shell bash -- \
						'go build -o "$DEVENV_STATE/go/worker" ./cmd/worker && exec "$DEVENV_STATE/go/worker"'
			'';
			cwd = "apps/api";
			after = [ "db:migrate" "devenv:processes:converter" ];
			ready = {
				http.get = {
					port = 8080;
					path = "/ready";
				};
				initial_delay = 1;
				period = 1;
				probe_timeout = 3;
				success_threshold = 1;
				failure_threshold = 30;
			};
		};
		web = {
			exec = "bun run dev:web";
			cwd = ".";
			after = [ "devenv:processes:api" "devenv:processes:worker" ];
			ready = {
				http.get = {
					host = "localhost";
					port = 5173;
					path = "/";
				};
				initial_delay = 1;
				period = 1;
				probe_timeout = 3;
				success_threshold = 1;
				failure_threshold = 30;
			};
		};
	};

	env = {
		PGUSER = "postgres";
		POSTGRES_USER = "slidesage";
		POSTGRES_PASSWORD = "slidesage";
		POSTGRES_DB = "slidesage";
		POSTGRES_PORT = toString 5432;
		DATABASE_URL = "postgresql://slidesage:slidesage@127.0.0.1:${toString 5432}/slidesage";
		NODE_ENV = "development";
		LOG_LEVEL = "debug";
		CGO_ENABLED = "0";
		WORKER_CONCURRENCY = "2";
		WORKER_DATABASE_POOL_MAX = "5";

		# Card image files; created on first use.
		PRESENTATION_STORAGE_DIR = "${config.devenv.state}/objects";
		CARD_CONVERTER_URL = "http://127.0.0.1:8090";
	};
}
