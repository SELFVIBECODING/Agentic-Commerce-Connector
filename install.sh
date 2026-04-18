#!/usr/bin/env sh
# shellcheck shell=sh
# ---------------------------------------------------------------------------
# acc installer — served at https://raw.githubusercontent.com/SELFVIBECODING/Agentic-Commerce-Connector/main/install.sh
#
#   curl -fsSL https://raw.githubusercontent.com/SELFVIBECODING/Agentic-Commerce-Connector/main/install.sh | sh
#
# Detects OS/arch, downloads the matching release tarball from GitHub, and
# installs the `acc` binary to ~/.acc/bin (overridable via ACC_INSTALL_DIR).
# Tries to append that directory to the user's shell rc if it isn't already
# on PATH. Never writes outside $HOME unless ACC_INSTALL_DIR is set to a
# system path — we won't sudo implicitly.
#
# Env overrides:
#   ACC_VERSION       Pin a specific release tag (e.g. v0.4.0). Default: latest.
#   ACC_INSTALL_DIR   Target directory. Default: $HOME/.acc/bin.
#   ACC_REPO          GitHub <owner>/<repo>. Default: SELFVIBECODING/Agentic-Commerce-Connector.
# ---------------------------------------------------------------------------

set -eu

REPO="${ACC_REPO:-SELFVIBECODING/Agentic-Commerce-Connector}"
INSTALL_DIR="${ACC_INSTALL_DIR:-$HOME/.acc/bin}"
VERSION="${ACC_VERSION:-latest}"

msg() { printf '%s\n' "$*" >&2; }
err() { msg "error: $*"; exit 1; }

have() { command -v "$1" >/dev/null 2>&1; }

# ── Platform detection ──────────────────────────────────────────────────────
detect_platform() {
    uname_s=$(uname -s 2>/dev/null || echo unknown)
    uname_m=$(uname -m 2>/dev/null || echo unknown)
    case "$uname_s" in
        Darwin) os=darwin ;;
        Linux)  os=linux ;;
        *)      err "unsupported OS: $uname_s (acc ships for macOS + Linux)" ;;
    esac
    case "$uname_m" in
        arm64|aarch64) arch=arm64 ;;
        x86_64|amd64)  arch=x64 ;;
        *)             err "unsupported architecture: $uname_m" ;;
    esac
    printf '%s-%s' "$os" "$arch"
}

# ── Resolve release version ─────────────────────────────────────────────────
resolve_version() {
    if [ "$VERSION" = "latest" ]; then
        api="https://api.github.com/repos/${REPO}/releases/latest"
        tag=$(curl -fsSL "$api" | sed -n 's/.*"tag_name": *"\([^"]*\)".*/\1/p' | head -n 1)
        [ -n "$tag" ] || err "could not resolve latest release from $api"
        printf '%s' "$tag"
    else
        printf '%s' "$VERSION"
    fi
}

# ── Download + install ──────────────────────────────────────────────────────
install_binary() {
    platform=$1
    tag=$2
    asset="acc-${platform}.tar.gz"
    url="https://github.com/${REPO}/releases/download/${tag}/${asset}"

    tmp=$(mktemp -d 2>/dev/null || mktemp -d -t acc-install)
    trap 'rm -rf "$tmp"' EXIT

    msg "↓ Downloading ${asset} (${tag})"
    if have curl; then
        curl -fsSL "$url" -o "$tmp/${asset}" || err "download failed from $url"
    elif have wget; then
        wget -qO "$tmp/${asset}" "$url" || err "download failed from $url"
    else
        err "neither curl nor wget is installed"
    fi

    msg "∗ Extracting to ${INSTALL_DIR}"
    mkdir -p "$INSTALL_DIR"
    tar -xzf "$tmp/${asset}" -C "$tmp"

    # Tarballs ship a single file named `acc`. Guard against layout drift.
    if [ ! -f "$tmp/acc" ]; then
        err "tarball did not contain a file named 'acc' — layout drift?"
    fi

    mv "$tmp/acc" "$INSTALL_DIR/acc"
    chmod +x "$INSTALL_DIR/acc"

    # macOS Gatekeeper flags curl-downloaded files with quarantine, which
    # can block the first run. Strip it. The binary is ad-hoc signed by
    # ldid in the release workflow, so no extra codesign step is needed
    # (and would in fact fail — `codesign --force` over Bun's compiled
    # single-file executable breaks with "invalid or unsupported format"
    # because the bundle payload appended after the Mach-O confuses
    # codesign's load-command walk).
    if [ "$(uname -s)" = "Darwin" ]; then
        xattr -d com.apple.quarantine "$INSTALL_DIR/acc" 2>/dev/null || true
    fi
}

# ── Ensure install dir is on PATH ───────────────────────────────────────────
# We can't mutate the parent shell's environment from a `curl | sh` subprocess,
# so the best we can do is:
#   1. Append an `export PATH=…` to the shell's init files so future sessions
#      see `acc`. We write both the interactive rc (.zshrc/.bashrc) AND the
#      login profile (.zprofile/.bash_profile) when the latter already exists,
#      because macOS Terminal launches login shells by default and those read
#      the profile file, not the rc file.
#   2. Print a single-line `export` the user can paste into their current
#      session to use `acc` immediately — no new terminal needed.
ensure_path() {
    export_line="export PATH=\"${INSTALL_DIR}:\$PATH\""
    fish_line="set -gx PATH \"${INSTALL_DIR}\" \$PATH"

    if on_path; then
        # Still print the one-liner; harmless if it's a no-op, useful if the
        # user ran the installer in a fresh terminal that will get a new rc
        # soon but they want to keep typing in the current one.
        msg ""
        msg "✓ ${INSTALL_DIR} is already on PATH."
        return 0
    fi

    # Candidate rc files to update, in priority order. The first existing
    # file (or the first entry if none exist) is the authoritative target
    # we'll create/append to. Additional existing files get updated too,
    # so login shells + non-login shells both see the export. Non-existing
    # secondary files are skipped so we don't shadow a user's profile chain
    # (e.g. creating .bash_profile on macOS silently disables .profile).
    case "${SHELL:-}" in
        */zsh)  candidates="$HOME/.zshrc $HOME/.zprofile" ;;
        */bash) candidates="$HOME/.bashrc $HOME/.bash_profile $HOME/.profile" ;;
        */fish) candidates="$HOME/.config/fish/config.fish" ;;
        *)      candidates="$HOME/.profile" ;;
    esac

    added_to=""
    already_in=""
    first=""
    for rc in $candidates; do
        if [ -z "$first" ]; then first=$rc; fi
        # Skip a non-existing secondary file to avoid shadowing the user's
        # profile chain. The primary (first candidate) is always created
        # if missing.
        if [ ! -f "$rc" ] && [ "$rc" != "$first" ]; then
            continue
        fi
        # Already injected in a previous run — record and skip.
        if [ -f "$rc" ] && grep -Fq "$INSTALL_DIR" "$rc" 2>/dev/null; then
            if [ -z "$already_in" ]; then
                already_in=$(display_path "$rc")
            else
                already_in="${already_in}, $(display_path "$rc")"
            fi
            continue
        fi
        if [ ! -w "$(dirname "$rc")" ]; then
            continue
        fi

        line=$export_line
        if [ "${rc##*/}" = "config.fish" ]; then
            line=$fish_line
        fi

        mkdir -p "$(dirname "$rc")"
        printf '\n# Added by acc installer\n%s\n' "$line" >> "$rc"
        if [ -z "$added_to" ]; then
            added_to=$(display_path "$rc")
        else
            added_to="${added_to}, $(display_path "$rc")"
        fi
    done

    msg ""
    if [ -n "$added_to" ]; then
        msg "✓ Added ${INSTALL_DIR} to PATH in ${added_to}"
    elif [ -n "$already_in" ]; then
        msg "✓ ${INSTALL_DIR} already wired into ${already_in} from a prior install."
    else
        msg "⚠ Could not write to any shell rc file."
    fi
    msg ""
    msg "  To use 'acc' in THIS shell right now, run:"
    msg "    ${export_line}"
    msg "  (New terminals pick it up automatically via your shell rc.)"
}

on_path() {
    case ":$PATH:" in
        *:"$INSTALL_DIR":*) return 0 ;;
    esac
    return 1
}

# Render $1 with $HOME collapsed to ~ for readability in messages.
display_path() {
    case "$1" in
        "$HOME"/*) printf '~/%s' "${1#"$HOME"/}" ;;
        *)         printf '%s' "$1" ;;
    esac
}

# ── Main ────────────────────────────────────────────────────────────────────
main() {
    platform=$(detect_platform)
    tag=$(resolve_version)

    msg "Installing acc ${tag} for ${platform} …"
    install_binary "$platform" "$tag"
    ensure_path

    msg ""
    msg "✓ Installed: $("$INSTALL_DIR/acc" version 2>/dev/null || printf 'acc (%s)\n' "$tag")"
    msg ""
    msg "Next:"
    msg "  acc init           # pick a platform from the menu"
    msg "  acc init shopify   # jump straight to the Shopify wizard"
    msg "  acc start          # boot the connector"
    msg "  acc doctor         # diagnose issues"
    msg "  acc help           # full command reference"
}

main "$@"
