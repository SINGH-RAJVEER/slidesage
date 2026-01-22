{
  description = "SlideSage backend";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = import nixpkgs { inherit system; };
      in
      {
        devShells.default = pkgs.mkShell {
          buildInputs = [ 
            pkgs.uv 
            pkgs.postgresql 
            pkgs.stdenv.cc.cc.lib 
          ];

          shellHook = ''
            export FLASK_APP=main
            export FLASK_ENV=development
            export LD_LIBRARY_PATH=${pkgs.stdenv.cc.cc.lib}/lib:$LD_LIBRARY_PATH
            
            [ ! -d .venv ] && uv venv
            source .venv/bin/activate
            
            [ -f pyproject.toml ] && uv sync || [ -f requirements.txt ] && uv pip install -r requirements.txt
          '';
        };
      }
    );
}
