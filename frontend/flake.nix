{
  description = "Nix flake for SlideSage frontend";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils, ... }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = import nixpkgs { inherit system; };
      in {
        devShell = pkgs.mkShell {
          name = "slidesage-frontend-shell";

          buildInputs = with pkgs; [ 
            bun 
            git 
            curl 
          ];

          shellHook = ''
            export NODE_ENV=development
          '';
        };

        packages.default = pkgs.stdenv.mkDerivation {
          pname = "slidesage-frontend";
          version = "0.1.0";
          src = ./.;


        nativeBuildInputs = with pkgs; [ 
          bun
          coreutils
          findutils
        ];

          buildPhase = ''
            export BUN_INSTALL=$TMPDIR/.bun
            export PATH=$BUN_INSTALL/bin:${pkgs.bun}/bin:${pkgs.coreutils}/bin:$PATH
            export NODE_ENV=production

            if [ ! -f package.json ]; then
              echo "Error: package.json not found"
              exit 1
            fi

            bun install --no-cache --frozen-lockfile
            bun run build
          '';

          installPhase = ''
            mkdir -p $out
  
            if [ -d dist ]; then
              cp -r dist/* $out/
            else
              echo "Error: dist directory not found after build"
              ls -la
              exit 1
            fi
          '';
        };
      }
    );
}
