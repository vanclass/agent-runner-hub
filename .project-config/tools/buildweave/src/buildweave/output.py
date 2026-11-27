"""Immutable BuildWeave deliverables with native compatibility locations retained."""
import hashlib
import json
import os
from pathlib import Path
import shutil
from uuid import uuid4

EXCLUDED = {".git", ".project-config", "node_modules", "local", "temp", "output", "dist", "__pycache__"}

def source_digest(project, excluded=()):
    digest = hashlib.sha256()
    paths = []
    excluded = [project / name for name in excluded if (project / name).is_dir()]
    for folder, directories, names in os.walk(project):
        directories[:] = sorted(name for name in directories if name not in EXCLUDED
                                and not any((Path(folder) / name).samefile(path) for path in excluded))
        paths.extend(Path(folder) / name for name in names if name not in EXCLUDED)
    for path in sorted(paths):
        if path.is_file():
            if path.is_symlink():
                raise ValueError("Build inputs must be plain project files.")
            name = path.relative_to(project).as_posix()
            digest.update(json.dumps([name, path.stat().st_size], separators=(",", ":")).encode())
            digest.update(path.read_bytes())
    return digest.hexdigest()

def native_tree_hash(folder):
    """Match the Web native owner's depth-first UTF-16 ordered tree digest."""
    digest = hashlib.sha256()
    def visit(directory, prefix=""):
        for child in sorted(directory.iterdir(), key=lambda p: p.name.encode("utf-16-be")):
            if child.is_symlink():
                raise ValueError("Verified output must contain plain files.")
            name = prefix + child.name
            if child.is_dir():
                visit(child, name + "/")
            else:
                raw = child.read_bytes()
                digest.update(json.dumps([name, len(raw)], ensure_ascii=False, separators=(",", ":")).encode())
                digest.update(raw)
    visit(folder)
    return digest.hexdigest()

def unity_links(folder):
    """Preserve native shipping links only within their complete shipping unit."""
    links = {}
    for path in sorted(folder.rglob("*")):
        if path.is_symlink():
            value = os.readlink(path)
            if Path(value).is_absolute() or not path.resolve().is_relative_to(folder.resolve()):
                raise ValueError("Native shipping link escapes its verified output.")
            links[path.relative_to(folder).as_posix()] = value
    return links

def publish(app, manifest, module, native, source):
    if source_digest(app.parents[2], native.get("input_exclusions", ())) != source:
        raise ValueError("Project inputs changed during the build. Native output is retained; repeat from stable inputs.")
    artifact = Path(native["artifact"])
    if not artifact.exists() or artifact.is_symlink():
        raise ValueError("Native verified artifact is unavailable.")
    identity = uuid4().hex
    staging = app / "temp" / identity
    destination = app / "output" / identity
    staging.mkdir(parents=True)
    try:
        native_bytes = Path(native["result"]).read_bytes()
        if hashlib.sha256(native_bytes).hexdigest() != native.get("result_sha256"):
            raise ValueError("Native verified result changed during handoff.")
        if module["id"] == "web-app":
            record = json.loads(native_bytes)
            if (hashlib.sha256(native_bytes).hexdigest() != native.get("result_sha256")
                    or record.get("integrity") != native.get("integrity")
                    or record.get("target") != native["target"] or record.get("outputFormat") != native["format"]
                    or record.get("verificationStatus") != "verified"):
                raise ValueError("Native verified result changed or mismatched during handoff.")
        links = unity_links(artifact) if module["id"] == "unity" else {}
        if module["id"] == "unity" and links != native.get("product_links"):
            raise ValueError("Native shipping links do not match the producing attempt.")
        original = {p.relative_to(artifact).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest()
                    for p in sorted(artifact.rglob("*")) if p.is_file()} if artifact.is_dir() else {
                        artifact.name: hashlib.sha256(artifact.read_bytes()).hexdigest()}
        target = staging / "artifact"
        if artifact.is_dir():
            for child in artifact.rglob("*"):
                if child.is_symlink() and module["id"] != "unity":
                    raise ValueError("Verified output must contain plain files.")
            shutil.copytree(artifact, target, symlinks=module["id"] == "unity")
        else:
            target.mkdir()
            shutil.copyfile(artifact, target / artifact.name)
        inventory = {p.relative_to(staging).as_posix(): {"bytes": p.stat().st_size,
                     "sha256": hashlib.sha256(p.read_bytes()).hexdigest()}
                     for p in sorted(target.rglob("*")) if p.is_file()}
        if not inventory:
            raise ValueError("Native output contains no verified files.")
        copied = {p.relative_to(target).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest()
                  for p in sorted(target.rglob("*")) if p.is_file()}
        if copied != original or native_bytes != Path(native["result"]).read_bytes():
            raise ValueError("Native output changed during handoff. Preserve native evidence and retry.")
        if module["id"] in ("unity", "chrome-extension") and copied != native.get("product_files"):
            raise ValueError("Copied output does not match native verified inventory.")
        if module["id"] == "unity":
            if unity_links(target) != links:
                raise ValueError("Copied output does not match native verified shipping links.")
            directories = sorted(p.relative_to(target).as_posix() for p in target.rglob("*") if p.is_dir())
            if directories != native.get("directories"):
                raise ValueError("Copied output does not match native verified directories.")
        if module["id"] == "web-app" and native_tree_hash(target) != native["integrity"]:
            raise ValueError("Copied output does not match native verified integrity.")
        (staging / "native-result.json").write_bytes(native_bytes)
        result = {"schema_version": "buildweave-output-v1", "status": "verified",
                  "project_id": manifest["project_id"], "module": module["id"],
                  "module_version": module["version"], "dependency_versions": module["dependency_versions"],
                  "source_sha256": source, "target": native["target"], "format": native["format"],
                  "native_result": native["result"], "native_result_sha256": hashlib.sha256(native_bytes).hexdigest(),
                  "native_artifact": str(artifact), "files": inventory}
        if module["id"] == "unity":
            result["links"] = {"artifact/" + name: value for name, value in links.items()}
        (staging / "result.json").write_bytes((json.dumps(result, sort_keys=True, indent=2) + "\n").encode())
        destination.parent.mkdir(parents=True, exist_ok=True)
        staging.rename(destination)
        return {"status": "verified", "result": str(destination / "result.json"),
                "artifact": str(destination / "artifact")}
    finally:
        if staging.exists():
            shutil.rmtree(staging)
