{ pkgs, lib, ... }:
{
    dotenv.enable = true;

    packages = [
        pkgs.bun
        pkgs.go
        pkgs.goose
        pkgs.just
        pkgs.terraform
        pkgs.chromium
        pkgs.fake-gcs-server
		pkgs.uv
    ];

    env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH = "${pkgs.chromium}/bin/chromium";

    env.FONTCONFIG_FILE = pkgs.makeFontsConf {
        fontDirectories = [
            pkgs.dejavu_fonts
            pkgs.liberation_ttf
            pkgs.noto-fonts
        ];
    };

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
		mlflow = {
			exec = ''
				mkdir -p "$DEVENV_STATE/mlflow-artifacts"
				exec env \
					UV_PROJECT_ENVIRONMENT="$DEVENV_STATE/mlflow-venv" \
					uv run --frozen --project infra/mlflow mlflow server \
						--backend-store-uri "sqlite:///$DEVENV_STATE/mlflow.db" \
						--artifacts-destination "$DEVENV_STATE/mlflow-artifacts" \
						--host 127.0.0.1 --port 5000
			'';
			cwd = ".";
			ready = {
				http.get = {
					host = "127.0.0.1";
					port = 5000;
					path = "/health";
				};
				initial_delay = 2;
				period = 2;
				probe_timeout = 3;
				success_threshold = 1;
				failure_threshold = 60;
			};
		};
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
        api = {
            exec = ''
                DATABASE_URL="postgresql://slidesage:slidesage@127.0.0.1:$PGPORT/slidesage" go run ./cmd/api
            '';
            cwd = "apps/api";
            after = [ "db:migrate" ];
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
				DATABASE_URL="postgresql://slidesage:slidesage@127.0.0.1:$PGPORT/slidesage" \
					MLFLOW_TRACKING_URI="http://127.0.0.1:5000" \
					MLFLOW_EXPERIMENT_ID="0" \
					go run ./cmd/worker
			'';
			cwd = "apps/api";
			after = [ "db:migrate" "devenv:processes:mlflow" ];
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
		PRESENTATION_GCS_BUCKET = "slidesage-dev-revisions";
		EDITOR_WHITE_LABEL = "true";
		EDITOR_CONNECTOR = "true";
    };
}
