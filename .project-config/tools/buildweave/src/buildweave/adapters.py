"""Lazy selected provider composition over the unchanged v1 adapter boundary."""
from importlib import import_module
from dataclasses import dataclass

@dataclass(frozen=True)
class CloudflareOptions:
    token_kind: str = "user"

def provider_sections(identity):
    def kind(module, name):
        return getattr(import_module("buildweave." + module), name)
    if identity in ("vercel", "netlify", "cloudflare-pages"):
        folder, name = {"vercel": ("vercel", "Vercel"), "netlify": ("netlify", "Netlify"),
                        "cloudflare-pages": ("cloudflare_pages", "CloudflarePages")}[identity]
        credential = kind("web_hosting.transport", "EnvironmentCredential")
        if identity == "cloudflare-pages":
            credential = credential | kind("web_hosting.credentials", "ProtectedCredential")
        sections = (("destination", kind("web_hosting." + folder, name + "Destination")), ("credential", credential))
        return sections + (("options", CloudflareOptions),) if identity == "cloudflare-pages" else sections
    if identity == "steam":
        return (("destination", kind("steam.contracts", "SteamDestination")),
                ("steamcmd", kind("steam.process", "SteamCMD")),
                ("publisher", kind("steam.publisher", "PublisherAPI") | None))
    if identity == "google-play":
        return (("destination", kind("google_play.contracts", "PlayDestination")),
                ("tools", kind("google_play.contracts", "JdkToolchain")),
                ("upload_key", kind("google_play.contracts", "UploadKey")),
                ("credentials", kind("google_play.auth", "ServiceAccountConfig")))
    if identity == "apple":
        return tuple((key, kind("apple.contracts", value)) for key, value in (
            ("destination", "AppleDestination"), ("tools", "XcodeToolchain"),
            ("signing", "AppleSigning"), ("credentials", "AppleCredentials")))
    raise ValueError("Unknown provider: " + identity)

def load_provider(manifest, identity, root, values, cancellation):
    if not any(m["id"] == identity and m["kind"] == "release" for m in manifest["modules"]):
        raise ValueError("Provider is absent from this installation.")
    from .typed_inputs import decode, defaults
    sections = provider_sections(identity)
    if set(values) - {name for name, _ in sections}:
        raise ValueError("Unknown provider input section.")
    inputs = {name: decode(kind, values.get(name, defaults(kind))) for name, kind in sections}
    if identity in ("vercel", "netlify", "cloudflare-pages"):
        folder, name = {"vercel": ("vercel", "VercelAdapter"), "netlify": ("netlify", "NetlifyAdapter"),
                        "cloudflare-pages": ("cloudflare_pages", "CloudflarePagesAdapter")}[identity]
        adapter = getattr(import_module("buildweave.web_hosting." + folder), name)
        if identity == "cloudflare-pages":
            return adapter(root, inputs["destination"], inputs["credential"],
                           token_kind=inputs["options"].token_kind, cancellation=cancellation)
        return adapter(root, **inputs)
    folder, name = {"steam": ("steam", "SteamDeploymentAdapter"),
                    "google-play": ("google_play", "GooglePlayDeploymentAdapter"),
                    "apple": ("apple", "AppleDeploymentAdapter")}[identity]
    adapter = getattr(import_module("buildweave." + folder + ".adapter"), name)
    if identity == "steam":
        return adapter(root, inputs["destination"], inputs["steamcmd"],
                       publisher=inputs["publisher"], cancellation=cancellation)
    return adapter(root, **inputs, cancellation=cancellation)

def release_registry(manifest):
    """Read retained publications even when their native builder is switched off."""
    if not any(m["kind"] == "release" for m in manifest["modules"]):
        raise ValueError("Release is absent from this installation.")
    from .release_pipeline import AdapterRegistry
    from .builders.unity.release_adapter import UnityBuildAdapter
    from .builders.web_app.release_adapter import WebAppBuildAdapter
    registry = AdapterRegistry()
    registry.register_build(UnityBuildAdapter())
    registry.register_build(WebAppBuildAdapter())
    return registry

def describe_provider(identity):
    from .release_pipeline.contracts import VERSION
    from .typed_inputs import defaults
    sections = provider_sections(identity)
    if identity in ("vercel", "netlify", "cloudflare-pages"):
        from .web_hosting.delivery import FORMATS, PAGES_FORMATS
        formats = PAGES_FORMATS if identity == "cloudflare-pages" else FORMATS
        adapter_id = "hosting." + identity
    elif identity == "steam":
        from .steam.contracts import FORMATS
        formats, adapter_id = tuple(row[:3] for row in FORMATS), "steam.steampipe"
    else:
        folder, name = {"apple": ("apple", "AppleDeploymentAdapter"),
                        "google-play": ("google_play", "GooglePlayDeploymentAdapter")}[identity]
        adapter = getattr(import_module("buildweave." + folder + ".adapter"), name)
        formats, adapter_id = adapter.supported_formats, adapter.adapter_id
    return {"id": identity, "adapter_id": adapter_id, "contract_version": VERSION,
            "formats": formats, "input_defaults": {key: defaults(kind) for key, kind in sections}}
