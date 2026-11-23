"""Compose the published Discussion test owners on the Hub's inherited handles."""
import json
import os
from dataclasses import replace
from pathlib import Path
import re
import threading
from unittest.mock import patch

REPLY = "Continue the same fixture Discussion."


def child_root(installation, session):
    assert re.fullmatch(r"[a-f0-9]{32}", session)
    return installation / "children" / session


def main():
    from runner.cli import build_parser
    from runner.session.local_control.launch import local_control_launch
    from runner.session.pipeline import SessionPipeline
    from runner.state import save_json
    from tests.support.issue_run.system_acceptance import (
        InteractiveDiscussionHarness, SystemAcceptanceRepository, SystemAcceptanceRoleProcess, role_profiles,
    )
    args = build_parser(run_only=True).parse_args()
    installation = Path(args.repo_root).resolve()
    assert installation == Path(__file__).resolve().parents[2]
    assert args.command == "run"
    os.environ.update(GIT_CONFIG_GLOBAL=os.devnull, GIT_CONFIG_NOSYSTEM="1",
                      GIT_ALLOW_PROTOCOL="file", GIT_TERMINAL_PROMPT="0")
    git = Path(json.loads((installation / "signals/toolchain.json").read_bytes())["git"])
    assert git.is_absolute() and git.is_file()
    os.environ["PATH"] = str(git.parent) + os.pathsep + os.environ["PATH"]
    root = child_root(installation, args.session_id)
    signals = root / "signals"
    signals.mkdir(parents=True)
    print("Hub fixture " + args.session_id, flush=True)
    repository = SystemAcceptanceRepository.create(root)
    harness = InteractiveDiscussionHarness(
        repository.root, target={"owner": "Workspace", "project": "agent-workspace"},
        semantic_outputs=SystemAcceptanceRoleProcess(), session_id=args.session_id)
    profile = role_profiles.selected_execution_profile(repository.root)
    SessionPipeline.update_configuration(harness.state, codex_profile_name=profile.name,
                                         codex_home=str(profile.home.resolve()))
    harness.runner._persist_runner_state(harness.state)
    controller = harness.runner._interactive_controller
    controller.retain_context(harness.state, None, None)
    harness.process.retain_history = True
    release = repository.root / "local/profiles/codex/accounts/selected-account/fixture-turn-release"
    execute = harness.process.adapter.execute

    def hold(request):
        if "IssueRun Issue Interpreter discussion Turn." in request.instruction_text:
            release.unlink(missing_ok=True)
            request = replace(request, turn_timeout_seconds=harness.watchdog_seconds)
        return execute(request)

    stop = threading.Event()
    errors = []

    def consume():
        try:
            while not stop.wait(0.002):
                controller.backend.input_pump.poll()
        except Exception as exc:
            errors.append(repr(exc))
            stop.set()

    with local_control_launch(args) as channel, patch.object(harness.process.adapter, "execute", side_effect=hold):
        assert channel is not None
        harness.runner.attach_local_control(channel)
        worker = threading.Thread(target=consume)
        worker.start()
        try:
            save_json(signals / "ready.json", {
                "pid": os.getpid(), "runnerSession": harness.state.identity.session_id,
                "root": repository.root.as_posix(), "remote": repository.remote.as_posix(),
                "base": repository.base_head, "release": release.as_posix(),
                "profile": release.parent.as_posix(), "peer": "registered scripted App Server peer",
                "workspaceLocal": (repository.root / "local").as_posix(),
                "workspaceRuns": (repository.root / "runs").as_posix(),
                "workspaceGit": (repository.root / ".git").as_posix(),
                "repoOwner": "SystemAcceptanceRepository", "inputOwner": "InteractiveDiscussionHarness.submit",
            })
            reply = signals / "reply.json"
            while not channel.closed and not stop.wait(0.05) and not (signals / "stop").exists():
                if reply.is_file():
                    expected = json.loads(reply.read_bytes())
                    reply.rename(signals / "reply-consumed.json")
                    continuation(harness, expected, signals, save_json)
                    break
            while not channel.closed and not stop.wait(0.05) and not (signals / "stop").exists():
                pass
        finally:
            stop.set()
            if release.parent.is_dir():
                release.touch()
            worker.join(5)
            harness.close()
            worker.join(10)
            assert not worker.is_alive()
            assert not errors, errors
        save_json(signals / "closed.json", {"pid": os.getpid(), "runnerStopped": True})


def continuation(harness, expected, signals, save_json):
    aggregate = harness.aggregate()
    assert aggregate.identity.issue_run_id == expected["issueRun"]
    assert aggregate.persistence.state_revision == expected["revision"]
    original = aggregate.front_end.discussion.turns[-1]
    assert original.thread_id == expected["thread"] and original.turn_id == expected["turn"]
    observation = harness.runner.local_control_observation(harness.state)["issue_run_user_action"]
    assert observation["status"] == "required"
    assert [item["kind"] for item in observation["requirements"]] == ["discussion"]
    save_json(signals / "reply-started.json", expected)
    harness.submit(REPLY)
    aggregate = harness.aggregate()
    committed = []
    for key, ref in aggregate.artifact_registry.artifacts.items():
        if key.startswith("discussion_input:"):
            payload = json.loads(Path(ref.path).read_bytes())
            if payload["prompt"] == REPLY:
                committed.append(key)
    final = aggregate.front_end.discussion.turns[-1]
    assert len(committed) == 1 and len(aggregate.front_end.discussion.turns) == expected["turnCount"] + 1
    assert final.thread_id == original.thread_id and final.turn_id != original.turn_id
    save_json(signals / "reply-committed.json", {
        "issueRun": aggregate.identity.issue_run_id, "revision": aggregate.persistence.state_revision,
        "thread": final.thread_id, "turn": final.turn_id, "exactText": REPLY, "inputArtifacts": committed,
    })


if __name__ == "__main__":
    try:
        main()
    except Exception:
        from traceback import format_exc
        import sys
        traceback = format_exc()
        if "--session-id" in sys.argv:
            root = child_root(Path(__file__).resolve().parents[2], sys.argv[sys.argv.index("--session-id") + 1])
            if (root / "signals").is_dir():
                (root / "signals/failure.json").write_text(json.dumps({"error": traceback}), encoding="utf-8")
        raise
