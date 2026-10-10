{ pkgs, lib, ... }:
{
    dotenv.enable = true;

    packages = [
        pkgs.bun
        pkgs.go
		pkgs.watchexec
        pkgs.goose
        pkgs.just
        pkgs.fake-gcs-server
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
			after = [ "db:setup" "devenv:processes:storage@ready" ];
			exec = ''
				DATABASE_URL="postgresql://slidesage:slidesage@127.0.0.1:$PGPORT/slidesage" \
					go -C "$DEVENV_ROOT/apps/api" run ./cmd/migrate
			'';
		};
    };

	processes = {
		storage = {
			exec = ''
				mkdir -p "$DEVENV_STATE/gcs/$PRESENTATION_GCS_BUCKET"
				exec fake-gcs-server \
					-scheme http \
					-host 127.0.0.1 \
					-port 4443 \
					-backend filesystem \
					-filesystem-root "$DEVENV_STATE/gcs" \
					-public-host 127.0.0.1:4443
			'';
			cwd = ".";
			ready = {
				http.get = {
					host = "127.0.0.1";
					port = 4443;
					path = "/_internal/healthcheck";
				};
				initial_delay = 1;
				period = 1;
				probe_timeout = 3;
				success_threshold = 1;
				failure_threshold = 30;
			};
		};
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
			exec = "bun src/main.ts";
			cwd = "apps/converter";
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

		STORAGE_EMULATOR_HOST = "http://127.0.0.1:4443";
		# Image bucket; cmd/migrate also deletes retired document objects from it.
		PRESENTATION_GCS_BUCKET = "slidesage-dev-revisions";
		CARD_CONVERTER_URL = "http://127.0.0.1:8090";
    };
}
