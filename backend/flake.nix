{
  description = "Nix flake for SlideSage backend";

  inputs = {
    nixpkgs.url = "git+https://github.com/NixOS/nixpkgs.git?ref=nixos-unstable";
  };

  outputs = { self, nixpkgs }: 
  let
    system = "x86_64-linux";
    pkgs = import nixpkgs { inherit system; };
    python = pkgs.python310Full;
  in {
    devShells.${system}.default = pkgs.mkShell {
      name = "slidesage-backend-shell";
      buildInputs = [ 
        python
        pkgs.git
      ];
    };

    packages.${system}.uv = pkgs.writeShellScriptBin "uv" ''
      export FLASK_APP=main

      if [ -z "$FLASK_ENV" ]; then
        FLASK_ENV=development
      fi
      export FLASK_ENV

      if [ ! -d .venv ]; then
        echo "Initializing virtualenv with uv..."

        if command -v uv >/dev/null 2>&1; then
          uv init

          if [ -f requirements.txt ]; then
            echo "Installing dependencies with uv..."
            uv add -r requirements.txt
          fi
        fi
      fi

      echo "Starting Flask server on http://127.0.0.1:8000"

      if [ -d .venv ]; then
        . .venv/bin/activate
      fi

      flask run --host=0.0.0.0 --port=8000
    '';
  };
}
