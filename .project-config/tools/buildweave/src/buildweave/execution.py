"""Invoke installed native owners and consume their verified result handoffs."""
import json
import hashlib
import os
from pathlib import Path
import shutil
import subprocess
import sys
from uuid import uuid4

TOOLS = {"unity": "unity_build_system", "chrome-extension": "chrome_extension_build_system",
         "web-app": "web_app_build_system"}

def selected(manifest, identity):
    return next((row for row in manifest["modules"] if row["id"] == identity), None)

def readiness(app, manifest, identity):
    module = selected(manifest, identity)
    if module is None:
        raise ValueError("Module is absent from this installation.")
    host = {"win32": "windows", "darwin": "macos", "linux": "linux"}.get(sys.platform)
    if host not in module["hosts"]:
        return "Unavailable", "This native module does not support this host."
    if module["kind"] == "release":
        return "Preparation required", "Use Runner to prepare the retained publication, destination and protected credential."
    tool = app.parent / TOOLS[identity]
    if identity == "unity":
        if not (tool / "local/binding.json").is_file():
            return "Preparation required", "Configure the Unity source and installed Editor in native settings."
    elif not shutil.which("node") or not shutil.which("npm"):
        return "Preparation required", "Install compatible Node.js and npm."
    elif not (app.parents[2] / "package.json").is_file():
        return "Preparation required", "The project has no native package.json build declarations."
    return "Check required", "Open native settings/readiness to check the selected target and dependencies."

def native_command(app, identity, args):
    tool = app.parent / TOOLS[identity]
    environment = dict(os.environ, PYTHONDONTWRITEBYTECODE="1")
    if identity == "web-app":
        node = shutil.which("node")
        if not node:
            raise ValueError("Node.js is missing. Install it and retry.")
        return [node, str(tool / "src/entry.mjs"), *args], environment
    environment["PYTHONPATH"] = str(tool / "src")
    return [sys.executable, "-B", "-m", TOOLS[identity], *args], environment

def native_menu(app, manifest, identity):
    module = selected(manifest, identity)
    if module is None or module["kind"] != "builder":
        raise ValueError("Select an installed builder.")
    command, environment = native_command(app, identity, [])
    return subprocess.call(command, cwd=app.parents[2], env=environment)

def _unity_input_scope(app):
    tool = app.parent / TOOLS["unity"]
    sys.path.insert(0, str(tool / "src"))
    try:
        from unity_build_system.settings import SettingsStore
        from unity_build_system.output_providers import publication_parent
        snapshot = SettingsStore(tool).build_snapshot()
        effective = snapshot.by_type[snapshot.current_type]
        destination = publication_parent({"project_root": str(app.parents[2]),
            "build_type": snapshot.current_type,
            "package_format": effective["platform"].get("package_format", "")}, effective["output"])
        excluded = [destination.relative_to(app.parents[2]).as_posix()] if (
            effective["output"]["provider"] == "local" and destination.is_relative_to(app.parents[2])) else []
        return snapshot, excluded
    finally:
        sys.path.pop(0)

def _web_input_exclusions(app):
    (node, entry), environment = native_command(app, "web-app", [])
    result = subprocess.run([node, str(Path(entry).with_name("foundation.mjs"))],
                            cwd=app.parents[2], env=environment, capture_output=True, encoding="utf-8")
    if result.returncode:
        raise ValueError(result.stderr.strip() or "Could not resolve Web App input exclusions.")
    return json.loads(result.stdout)

def build(app, manifest, identity, target="web"):
    from .output import source_digest, publish
    state, reason = readiness(app, manifest, identity)
    if state in ("Preparation required", "Unavailable"):
        raise ValueError(reason)
    print("Preparing build | " + selected(manifest, identity)["label"] + "\n  Checking project inputs...", flush=True)
    snapshot, excluded = _unity_input_scope(app) if identity == "unity" else (None, [])
    if identity == "web-app":
        excluded = _web_input_exclusions(app)
    source = source_digest(app.parents[2], excluded)
    native = _native_build(app, manifest, identity, target, snapshot=snapshot)
    native["input_exclusions"] = excluded
    return publish(app, manifest, selected(manifest, identity), native, source)

def _native_build(app, manifest, identity, target="web", *, snapshot=None):
    module = selected(manifest, identity)
    if module is None or module["kind"] != "builder":
        raise ValueError("Select an installed builder.")
    project = app.parents[2]
    tool = app.parent / TOOLS[identity]
    print("Building | " + module["label"] + "\n  Prepare > Build > Verify > Publish output\n  Ctrl+C cancels the native attempt.", flush=True)
    if identity == "unity":
        sys.path.insert(0, str(tool / "src"))
        try:
            from unity_build_system.settings import SettingsStore
            from unity_build_system.execution import execute
            result, artifact = execute(SettingsStore(tool), lambda p: print("  " + p.stage.value, flush=True),
                                       retain_product=True, expected_snapshot=snapshot)
            if result["status"] != "success":
                raise ValueError(str(result.get("reason", "Native build failed.")) + " | " + str(artifact))
            handoff = json.loads((tool / "output" / artifact.parent.name / "handoff.json").read_bytes())
            if (handoff["schema_version"] != 1 or handoff["execution_id"] != result["execution_id"]
                    or handoff["target"] != result["build_type"]):
                raise ValueError("Native Unity shipping identity mismatch.")
            return {"status": "verified", "result": str(artifact), "artifact": handoff["artifact"],
                    "target": result["build_type"], "format": result.get("package_format", result["build_type"]),
                    "product_files": handoff["product_files"], "directories": handoff["directories"],
                    "product_links": handoff["product_links"],
                    "result_sha256": handoff["result_sha256"]}
        finally:
            sys.path.pop(0)
    if identity == "chrome-extension":
        handoff = tool / ".local/invocations" / (uuid4().hex + ".json")
        args = ["--development", "--result-file", handoff.relative_to(tool).as_posix()]
        command, environment = native_command(app, identity, args)
        code = subprocess.call(command, cwd=project, env=environment)
        if not handoff.is_file():
            raise ValueError("Native build returned no invocation result. Exit: " + str(code))
        raw = handoff.read_bytes()
        receipt = json.loads(raw)
        if receipt.get("schema_version") != 1 or receipt.get("invocation") != handoff.stem:
            raise ValueError("Native Chrome invocation identity mismatch.")
        data = receipt["result"]
        if code or data["status"] != "SUCCESS":
            raise ValueError(data.get("stage", "Build") + ": " + data.get("cause", "Build failed.") + " | " + str(data.get("log")))
        return {"status": "verified", "result": str(handoff), "artifact": data["output"],
                "target": "chrome-extension", "format": "manifest-v3-directory",
                "product_files": data["product_files"], "result_sha256": hashlib.sha256(raw).hexdigest()}
    handoff = tool / "temp/invocations" / (uuid4().hex + ".json")
    command, environment = native_command(app, identity, ["--build", target, "--result-file", str(handoff)])
    code = subprocess.call(command, cwd=project, env=environment)
    if code or not handoff.is_file():
        raise ValueError("Native build returned no successful invocation result. Exit: " + str(code))
    receipt = json.loads(handoff.read_bytes())
    if receipt.get("schema") != 1 or receipt.get("invocation") != handoff.stem:
        raise ValueError("Native invocation identity mismatch.")
    result = Path(receipt["result"])
    if result.name != "result.json" or result.parent.parent != tool / "output" or result.resolve() != result:
        raise ValueError("Native invocation result escaped its output owner.")
    raw = result.read_bytes()
    data = json.loads(raw)
    if (data.get("schema") != 1 or data.get("id") != result.parent.name or data.get("target") != target
            or data.get("verificationStatus") != "verified" or data.get("product") != "app"):
        raise ValueError("Native output identity or verification mismatch.")
    handoff.unlink()
    return {"status": "verified", "result": str(result), "artifact": str(result.parent / "app"),
            "target": data["target"], "format": data["outputFormat"], "integrity": data["integrity"],
            "result_sha256": hashlib.sha256(raw).hexdigest()}
