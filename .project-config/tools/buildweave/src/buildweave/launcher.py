"""Installed project terminal surface; native owners retain settings and effects."""
import argparse
import hashlib
import json
from pathlib import Path
import sys
from .execution import build, native_menu, readiness

def load(app):
    manifest = json.loads((app / "manifest.json").read_text(encoding="utf-8"))
    if manifest.get("schema_version") != "buildweave-install-v1" or manifest.get("contract_version") != 1:
        raise ValueError("Unsupported package contract. Update this installation through Runner.")
    project = app.parents[2]
    for name, digest in manifest["files"].items():
        path = project / name
        if not path.resolve().is_relative_to(project) or hashlib.sha256(path.read_bytes()).hexdigest() != digest:
            raise ValueError("Installed file changed: " + name + ". Reconcile through Runner; preserve user data.")
    return manifest

def render(app, manifest, focus=None):
    lines = ["BuildWeave  /  " + manifest["project_id"], "Project  " + str(app.parents[2]), ""]
    for number, row in enumerate(manifest["modules"], 1):
        state, reason = readiness(app, manifest, row["id"])
        marker = ">" if row["id"] == focus else " "
        lines.extend([f'{marker} {number}. {row["label"]}  |  {state}', "     " + reason])
    lines.extend(["", "Choose module number  |  Q Quit"])
    return "\n".join(lines)

def render_provider_settings(identity):
    from dataclasses import fields, is_dataclass
    from typing import get_args, get_type_hints
    from .adapters import provider_sections
    lines = ["Settings schema  |  Field / type (values managed in Runner)"]
    def visit(kind, path):
        if is_dataclass(kind):
            hints = get_type_hints(kind)
            for item in fields(kind):
                visit(hints[item.name], path + "." + item.name)
        else:
            lines.append("  " + path + "  |  " + getattr(kind, "__name__", str(kind)))
            for option in get_args(kind):
                if is_dataclass(option):
                    visit(option, path + " [" + option.__name__ + "]")
    for name, kind in provider_sections(identity):
        lines.append("\n" + name.capitalize())
        visit(kind, name)
    return "\n".join(lines)

def interact(app, manifest):
    focus = None
    while True:
        if sys.stdout.isatty():
            print("\033[2J\033[H", end="")
        print(render(app, manifest, focus))
        try:
            choice = input("> ").strip()
            if choice.lower() == "q":
                return 0
            row = manifest["modules"][int(choice) - 1]
            if int(choice) < 1:
                raise ValueError("Select a visible module number.")
            focus = row["id"]
            state, reason = readiness(app, manifest, focus)
            print("\n" + row["label"] + "  |  " + state + "\n  " + reason)
            if row["kind"] == "builder":
                print("S Native settings / target readiness   B Build   Enter Back")
                action = input("> ").lower().strip()
                if action == "s":
                    native_menu(app, manifest, focus)
                elif action == "b":
                    result = build(app, manifest, focus)
                    print("Verified output  " + str(result["artifact"]) + "\nResult  " + result["result"])
            else:
                print(render_provider_settings(focus))
                print("Prepare and authorize this provider in Runner. Retained release records stay in the project.")
            input("Enter to return to " + row["label"] + ": ")
        except (ValueError, IndexError, OSError) as error:
            print("Unable to continue  |  " + str(error))
            input("Enter to return to the selected module: ")
        except (EOFError, KeyboardInterrupt):
            return 0

def main(app, argv=None):
    parser = argparse.ArgumentParser(prog="BuildWeave")
    actions = parser.add_mutually_exclusive_group()
    actions.add_argument("--status", action="store_true")
    actions.add_argument("--build", metavar="MODULE")
    actions.add_argument("--native", metavar="MODULE")
    parser.add_argument("--target", default="web")
    args = parser.parse_args(argv)
    try:
        manifest = load(Path(app))
        if args.status:
            print(render(app, manifest))
            return 0
        if args.native:
            return native_menu(app, manifest, args.native)
        if args.build:
            result = build(app, manifest, args.build, args.target)
            print("Verified output  " + str(result["artifact"]) + "\nResult  " + result["result"])
            return 0
        return interact(app, manifest)
    except KeyboardInterrupt:
        print("Cancelled. Previous verified outputs are preserved.")
        return 130
    except (ValueError, OSError, KeyError) as error:
        print("BuildWeave failed  |  " + str(error), file=sys.stderr)
        return 1
