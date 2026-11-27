"""Stable module identities; content versions are measured during composition."""
from dataclasses import dataclass
from pathlib import Path

CONTRACT_VERSION = 1
PYTHON_REQUIRES = ">=3.11"

@dataclass(frozen=True)
class Module:
    identity: str
    label: str
    kind: str
    implementation: str
    hosts: tuple[str, ...]
    requirements: tuple[str, ...] = ()

MODULES = (
    Module("unity", "Unity", "builder", "unity_build_system", ("windows", "macos", "linux"),
           ("Unity Editor matching the source project", "google-auth[requests]>=2.0,<3 for optional Drive output")),
    Module("chrome-extension", "Chrome Extension", "builder", "chrome_extension_build_system",
           ("windows", "macos", "linux"), ("Node.js and npm", "project Vite build declarations")),
    Module("web-app", "Web App", "builder", "web_app_build_system", ("windows", "macos", "linux"),
           ("Node.js and npm", "selected platform toolchain required by the native target catalog")),
    Module("vercel", "Vercel", "release", "web_hosting.vercel", ("windows", "macos", "linux")),
    Module("cloudflare-pages", "Cloudflare Pages", "release", "web_hosting.cloudflare_pages", ("windows", "macos", "linux")),
    Module("netlify", "Netlify", "release", "web_hosting.netlify", ("windows", "macos", "linux")),
    Module("steam", "Steam", "release", "steam.adapter", ("windows", "macos", "linux"), ("SteamCMD",)),
    Module("google-play", "Google Play", "release", "google_play.adapter", ("windows", "macos", "linux"),
           ("JDK and bundletool", "protected service account and upload key references")),
    Module("apple", "Apple", "release", "apple.adapter", ("macos",),
           ("Xcode", "cryptography", "protected signing and App Store Connect references")),
)

def select(identities):
    names = tuple(identities)
    if not names or len(set(names)) != len(names):
        raise ValueError("Select at least one unique module.")
    unknown = set(names) - {m.identity for m in MODULES}
    if unknown:
        raise ValueError("Unknown modules: " + ", ".join(sorted(unknown)))
    return tuple(m for m in MODULES if m.identity in names)

def source_root():
    return Path(__file__).resolve().parent
