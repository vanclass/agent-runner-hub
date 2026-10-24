"""Executed macOS feasibility experiments; never a production containment helper.

The socket roster is an independent fixture oracle. Candidates receive only a
saved process group or a unique launchd service target, never that roster.
Every participant expires on the same absolute wall-clock deadline even if the
controller, candidate or parent disappears. No cleanup enumerates host processes.
"""
import errno
import json
import os
from pathlib import Path
import plistlib
import select
import selectors
import signal
import socket
import struct
import subprocess
import sys
import tempfile
import time
import uuid


def expiry(deadline):
    signal.signal(signal.SIGALRM, signal.SIG_DFL)
    signal.pthread_sigmask(signal.SIG_UNBLOCK, {signal.SIGALRM})
    signal.setitimer(signal.ITIMER_REAL, max(0.001, deadline - time.monotonic()))


def send(stream, value):
    stream.sendall(json.dumps(value).encode() + b"\n")


class Worker:
    def __init__(self, address, token, session, role, deadline):
        expiry(deadline)
        self.address, self.token, self.session = address, token, session
        self.role, self.deadline = role, deadline
        self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.sock.connect(address)
        self.reader = self.sock.makefile("rb")
        self.request("hello", pid=os.getpid(), ppid=os.getppid(),
                     pgid=os.getpgrp(), sid=os.getsid(0))

    def request(self, kind, **values):
        send(self.sock, dict(kind=kind, token=self.token, session=self.session,
                             role=self.role, **values))
        if self.reader.readline() != b"ok\n":
            os._exit(70)

    def fork(self, role, mode):
        read_gate, write_gate = os.pipe()
        pid = os.fork()
        if pid == 0:
            expiry(self.deadline)
            os.close(write_gate)
            self.reader.close()
            self.sock.close()
            if os.read(read_gate, 1) != b"g":
                os._exit(71)
            os.close(read_gate)
            run_worker(self.address, self.token, self.session, role,
                       self.deadline, mode)
            os._exit(0)
        os.close(read_gate)
        try:
            # Capture the exact PID returned by fork before releasing the child.
            self.request("created", child_role=role, child_pid=pid)
            os.write(write_gate, b"g")
        finally:
            os.close(write_gate)

    def loop(self):
        while True:
            line = self.reader.readline()
            if not line:
                os._exit(0)
            command = line.decode().strip()
            if command == "exit":
                os._exit(0)
            if command == "kill-self":
                os.kill(os.getpid(), signal.SIGKILL)
            if command == "fork":
                self.fork("after-root-exit", "setsid")
                send(self.sock, dict(kind="forked", session=self.session, role=self.role))
            if command == "ping":
                send(self.sock, dict(kind="pong", session=self.session, role=self.role,
                                     pid=os.getpid(), ppid=os.getppid(),
                                     pgid=os.getpgrp(), sid=os.getsid(0)))


def run_worker(address, token, session, role, deadline, mode):
    expiry(deadline)
    signal.signal(signal.SIGCHLD, signal.SIG_IGN)
    if mode in {"setsid", "intermediate", "closed"}:
        os.setsid()
    if mode == "regroup":
        os.setpgid(0, 0)
    if mode in {"ignore", "closed"}:
        signal.signal(signal.SIGTERM, signal.SIG_IGN)
        signal.signal(signal.SIGHUP, signal.SIG_IGN)
    if mode == "closed":
        for descriptor in (0, 1, 2):
            try:
                os.close(descriptor)
            except OSError:
                pass
    worker = Worker(address, token, session, role, deadline)
    if mode == "root":
        for child_role, child_mode in (("ordinary", "leaf"), ("ignore", "ignore"),
                                       ("setsid", "setsid"), ("regroup", "regroup"),
                                       ("closed", "closed"), ("intermediate", "intermediate"),
                                       ("late-parent", "setsid")):
            worker.fork(child_role, child_mode)
    if mode == "intermediate":
        worker.fork("orphan", "leaf")
        os._exit(0)
    send(worker.sock, dict(kind="ready", session=session, role=role))
    worker.loop()


def command(arguments, timeout=8):
    result = subprocess.run(arguments, capture_output=True, text=True, timeout=timeout)
    return dict(argv=[str(item) for item in arguments], code=result.returncode,
                stdout=result.stdout[-6000:], stderr=result.stderr[-2000:])


class Oracle:
    def __init__(self, directory, constants):
        self.address = str(directory / "oracle.sock")
        self.token = uuid.uuid4().hex
        self.constants = constants
        self.selector = selectors.DefaultSelector()
        self.listener = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.listener.bind(self.address)
        self.listener.listen(32)
        self.listener.setblocking(False)
        self.selector.register(self.listener, selectors.EVENT_READ)
        self.queue = select.kqueue()
        self.connections, self.nodes, self.expected = {}, {}, {}
        self.direct, self.services, self.operations = [], [], []
        self.launchd_roots = set()

    def poll(self, duration=0.02):
        for key, _ in self.selector.select(duration):
            stream = key.fileobj
            if stream is self.listener:
                accepted, _ = stream.accept()
                accepted.setblocking(False)
                self.connections[accepted] = bytearray()
                self.selector.register(accepted, selectors.EVENT_READ)
                continue
            data = stream.recv(8192)
            if not data:
                self.selector.unregister(stream)
                stream.close()
                continue
            buffer = self.connections[stream]
            buffer.extend(data)
            while b"\n" in buffer:
                raw, _, tail = buffer.partition(b"\n")
                buffer[:] = tail
                self.message(stream, json.loads(raw))
        for event in self.queue.control([], 128, 0):
            if event.flags & select.KQ_EV_ERROR:
                raise RuntimeError(f"exit observer error: {event.data}")
            assert event.fflags & select.KQ_NOTE_EXIT
            matches = [node for node in self.nodes.values() if node["pid"] == event.ident]
            assert len(matches) == 1, "ambiguous lifetime in oracle"
            matches[0]["exit_observed"] = True

    def message(self, stream, message):
        key = (message["session"], message["role"])
        kind = message["kind"]
        if kind in {"created", "hello"}:
            assert message["token"] == self.token
        if kind == "created":
            assert self.nodes[key]["stream"] is stream
            child = (key[0], message["child_role"])
            assert child not in self.expected
            self.expected[child] = message["child_pid"]
            stream.sendall(b"ok\n")
        elif kind == "hello":
            # Kernel-reported Unix peer PID binds the socket to this live process.
            peer = struct.unpack("i", stream.getsockopt(self.constants["SOL_LOCAL"],
                                                       self.constants["LOCAL_PEERPID"], 4))[0]
            assert peer == message["pid"] and peer > 1
            if key in self.launchd_roots:
                self.expected[key] = peer
            assert self.expected[key] == peer and key not in self.nodes
            change = select.kevent(peer, filter=select.KQ_FILTER_PROC,
                                   flags=select.KQ_EV_ADD | select.KQ_EV_ENABLE |
                                   self.constants["EV_RECEIPT"], fflags=select.KQ_NOTE_EXIT)
            receipts = self.queue.control([change], 1, 0)
            assert len(receipts) == 1 and receipts[0].flags & select.KQ_EV_ERROR
            assert receipts[0].data == 0, f"NOTE_EXIT attach failed: {receipts[0].data}"
            self.nodes[key] = dict(message, stream=stream, exit_observed=False,
                                   ready=False, pong=0)
            stream.sendall(b"ok\n")
        elif kind == "ready":
            self.nodes[key]["ready"] = True
        elif kind == "pong":
            node = self.nodes[key]
            assert node["stream"] is stream and node["pid"] == message["pid"]
            node["pong"] += 1
            node["current"] = message
        elif kind == "forked":
            self.nodes[key]["forked"] = True
        else:
            raise RuntimeError(f"unknown fixture message: {kind}")

    def until(self, predicate, seconds=6):
        deadline = time.monotonic() + seconds
        while not predicate():
            if time.monotonic() >= deadline:
                raise TimeoutError("fixture readiness/observation deadline")
            self.poll()

    def tell(self, key, value):
        node = self.nodes[key]
        assert not node["exit_observed"], f"command to ended lifetime: {key}"
        node["stream"].sendall(value.encode() + b"\n")

    def ping(self, keys):
        targets = {key: self.nodes[key]["pong"] for key in keys}
        for key in keys:
            self.tell(key, "ping")
        self.until(lambda: all(self.nodes[key]["pong"] > count
                               for key, count in targets.items()), 2)
        assert all(not self.nodes[key]["exit_observed"] for key in keys)

    def start(self, session, deadline, mode="root", candidate=None, domain=None):
        arguments = [sys.executable, str(Path(__file__).resolve()), "--worker",
                     self.address, self.token, session, "root", str(deadline), mode]
        root_key = (session, "root")
        if candidate and candidate.startswith("launchd"):
            label = "org.agent-runner-hub.fixture." + uuid.uuid4().hex
            target = domain + "/" + label
            self.launchd_roots.add(root_key)
            path = Path(self.address).parent / (label + ".plist")
            values = dict(Label=label, ProgramArguments=arguments, RunAtLoad=True,
                          KeepAlive=False, ExitTimeOut=1,
                          StandardOutPath="/dev/null", StandardErrorPath="/dev/null")
            if candidate != "launchd-omitted":
                values["AbandonProcessGroup"] = candidate == "launchd-true"
            path.write_bytes(plistlib.dumps(values))
            operation = command(["launchctl", "bootstrap", domain, str(path)])
            self.operations.append(operation)
            assert operation["code"] == 0, operation
            self.services.append(target)
        else:
            process = subprocess.Popen(arguments, start_new_session=True,
                                       stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                                       stderr=subprocess.DEVNULL)
            self.direct.append(process)
            self.expected[root_key] = process.pid
            target = None
        required = {"root"} if mode != "root" else {
            "root", "ordinary", "ignore", "setsid", "regroup", "closed",
            "intermediate", "orphan", "late-parent"}
        self.until(lambda: all((session, role) in self.nodes for role in required) and
                   all(self.nodes[(session, role)]["ready"] for role in required - {"intermediate"}))
        root = self.nodes[root_key]
        assert root["pgid"] == root["pid"] and root["pgid"] != os.getpgrp()
        if mode == "root":
            self.until(lambda: self.nodes[(session, "intermediate")]["exit_observed"])
            self.ping([(session, "orphan")])
            assert self.nodes[(session, "orphan")]["current"]["ppid"] == 1
            assert self.nodes[(session, "setsid")]["sid"] != root["sid"]
            assert self.nodes[(session, "regroup")]["pgid"] != root["pgid"]
        return dict(session=session, pgid=root["pgid"], target=target)

    def snapshot(self, session):
        return [dict(role=key[1], pid=node["pid"], initial_ppid=node["ppid"],
                     pgid=node["pgid"], sid=node["sid"],
                     exit_observed=node["exit_observed"], current=node.get("current"))
                for key, node in self.nodes.items() if key[0] == session]

    def group_signal(self, root, sig):
        self.poll(0)
        # Safety check only: the candidate still targets just its saved PGID.
        members = [node for key, node in self.nodes.items() if key[0] == root["session"]
                   and node["pgid"] == root["pgid"] and not node["exit_observed"]]
        assert members and all(os.getpgid(node["pid"]) == root["pgid"] for node in members)
        assert root["pgid"] > 1 and root["pgid"] != os.getpgrp()
        os.killpg(root["pgid"], sig)
        self.operations.append(dict(operation="killpg", pgid=root["pgid"], signal=int(sig)))

    def stop(self, roots, candidate, scenario):
        if scenario in {"early-exit", "root-kill"}:
            for root in roots:
                if scenario == "root-kill" and root["target"]:
                    operation = command(["launchctl", "kill", "SIGKILL", root["target"]])
                    self.operations.append(operation)
                    assert operation["code"] == 0, operation
                else:
                    self.tell((root["session"], "root"),
                              "exit" if scenario == "early-exit" else "kill-self")
            self.until(lambda: all(self.nodes[(root["session"], "root")]["exit_observed"]
                                   for root in roots))
            for root in roots:
                self.tell((root["session"], "late-parent"), "fork")
            self.until(lambda: all((root["session"], "after-root-exit") in self.nodes and
                                   self.nodes[(root["session"], "after-root-exit")]["ready"]
                                   for root in roots))
        if candidate == "process-group":
            for root in roots:
                self.group_signal(root, signal.SIGTERM)
            limit = time.monotonic() + 0.2
            while time.monotonic() < limit:
                self.poll()
            for root in roots:
                self.group_signal(root, signal.SIGKILL)
        elif scenario not in {"early-exit", "root-kill"}:
            processes = [(root, subprocess.Popen(["launchctl", "bootout", root["target"]],
                                                 stdout=subprocess.PIPE, stderr=subprocess.PIPE))
                         for root in roots]
            for root, process in processes:
                stdout, stderr = process.communicate(timeout=6)
                self.operations.append(dict(operation="bootout", target=root["target"],
                                            code=process.returncode,
                                            stdout=stdout.decode(), stderr=stderr.decode()))
                assert process.returncode == 0
                self.services.remove(root["target"])
        limit = time.monotonic() + (1 if candidate == "process-group" else 3)
        while time.monotonic() < limit:
            self.poll()

    def cleanup(self):
        # A separate cooperative channel, never candidate cleanup or stale-PID kill.
        for target in list(self.services):
            operation = command(["launchctl", "bootout", target])
            self.operations.append(operation)
            assert operation["code"] == 0, operation
            self.services.remove(target)
        for node in self.nodes.values():
            if not node["exit_observed"] and node["stream"].fileno() >= 0:
                try:
                    node["stream"].sendall(b"exit\n")
                except (BrokenPipeError, ConnectionResetError):
                    pass
        self.until(lambda: all(node["exit_observed"] for node in self.nodes.values()), 22)
        for process in self.direct:
            process.wait(timeout=2)
        absence = []
        for node in self.nodes.values():
            try:
                os.kill(node["pid"], 0)
                absent = False
            except ProcessLookupError:
                absent = True
            absence.append(dict(pid=node["pid"], original_lifetime_exited=node["exit_observed"],
                                numeric_pid_absent=absent))
        assert all(item["numeric_pid_absent"] for item in absence), absence
        return absence

    def close(self):
        for stream in self.connections:
            stream.close()
        self.listener.close()
        self.selector.close()
        self.queue.close()


def experiment(directory, constants, candidate, scenario, domain):
    oracle = Oracle(directory, constants)
    result = dict(candidate=candidate, scenario=scenario, accepted=False)
    try:
        deadline = time.monotonic() + 20
        first = oracle.start("A", deadline, candidate=candidate, domain=domain)
        second = oracle.start("B", deadline, candidate=candidate, domain=domain)
        oracle.start("unrelated", deadline, mode="leaf")
        untouched = [key for key, node in oracle.nodes.items()
                     if key[0] in {"B", "unrelated"} and not node["exit_observed"]]
        roots = [first, second] if scenario == "simultaneous" else [first]
        oracle.stop(roots, candidate, scenario)
        if candidate == "process-group":
            assert all(oracle.nodes[("A", role)]["exit_observed"]
                       for role in ("root", "ordinary", "ignore")), "same-group control survived"
        survivors = [key for key, node in oracle.nodes.items()
                     if key[0] == "A" and not node["exit_observed"]]
        assert survivors, "candidate behavior changed: investigate support before enabling"
        oracle.ping(survivors)
        assert any(key[1] in {"setsid", "orphan", "closed"} for key in survivors)
        if scenario != "simultaneous":
            oracle.ping(untouched)
            result["untouched_session_survived"] = True
            oracle.stop([second], candidate, scenario)
        second_survivors = [key for key, node in oracle.nodes.items()
                            if key[0] == "B" and not node["exit_observed"]]
        assert second_survivors
        oracle.ping(second_survivors)
        oracle.ping([("unrelated", "root")])
        result.update(owned_processes_absent=False, unrelated_survived=True,
                      same_group_control_absent={role: oracle.nodes[("A", role)]["exit_observed"]
                                                 for role in ("root", "ordinary", "ignore")},
                      surviving_roles=[key[1] for key in survivors],
                      observations=oracle.snapshot("A"), second_observations=oracle.snapshot("B"))
    except BaseException as error:
        result["fixture_error"] = repr(error)
    finally:
        result["before_independent_cleanup"] = {
            session: oracle.snapshot(session) for session in ("A", "B", "unrelated")}
        try:
            result["independent_cleanup"] = oracle.cleanup()
        except BaseException as error:
            result["cleanup_error"] = repr(error)
        finally:
            result["operations"] = oracle.operations
            oracle.close()
    return result


def calibration(directory, constants):
    oracle = Oracle(directory, constants)
    try:
        deadline = time.monotonic() + 4
        oracle.start("expiry", deadline)
        oracle.tell(("expiry", "root"), "exit")
        oracle.until(lambda: oracle.nodes[("expiry", "root")]["exit_observed"])
        oracle.ping([("expiry", "closed"), ("expiry", "orphan")])
        oracle.until(lambda: all(node["exit_observed"] for node in oracle.nodes.values()), 6)
        assert time.monotonic() >= deadline - 0.1
        return dict(candidate_cleanup_omitted=True, wall_clock_expiry_observed=True,
                    observations=oracle.snapshot("expiry"), absence=oracle.cleanup())
    finally:
        oracle.close()


def main():
    assert sys.platform == "darwin", "native macOS execution required"
    output = Path(sys.argv[1]).resolve()
    output.mkdir(parents=True, exist_ok=False)
    source = Path(__file__).with_name("macos_kqueue_probe.c").resolve()
    executable = output / "kqueue-probe"
    host = {name: command(args) for name, args in {
        "os": ["sw_vers"], "kernel": ["uname", "-a"],
        "compiler": ["clang", "--version"], "sdk": ["xcrun", "--show-sdk-version"],
        "launchctl": ["launchctl", "version"]}.items()}
    host["uid"] = os.getuid()
    for name in ("launchctl", "launchd.plist"):
        manual = subprocess.run(["man", name], capture_output=True, text=True,
                                timeout=8, env={**os.environ, "MANPAGER": "cat"})
        (output / (name + ".man.txt")).write_text(manual.stdout, encoding="utf-8")
        host[name + "_manual_code"] = manual.returncode
    build = command(["clang", "-std=c11", "-Wall", "-Wextra", "-Werror",
                     str(source), "-o", str(executable)], timeout=30)
    assert build["code"] == 0, build
    probe = command([str(executable)])
    assert probe["code"] == 0, probe
    constants = json.loads(probe["stdout"])
    assert constants["NOTE_EXIT_errno"] == 0
    for name in ("NOTE_TRACK", "NOTE_TRACKERR", "NOTE_CHILD"):
        assert constants[name + "_errno"] == constants["ENOTSUP"], constants
    assert constants["fork_event_data"] == 0
    domain = None
    for prefix in ("gui", "user"):
        candidate = f"{prefix}/{os.getuid()}"
        if command(["launchctl", "print", candidate])["code"] == 0:
            domain = candidate
            break
    assert domain, "no existing current-user launchd domain"
    evidence = dict(host=host, compilation=build, kqueue=constants, domain=domain,
                    experiments=[], production_macos_enabled=False,
                    installed_runner_acceptance="unverified: no authorized macOS installation",
                    gui_acceptance="unverified: no GUI interaction performed")
    try:
        # /tmp is used only for bounded one-shot Unix sockets and ephemeral job plists.
        with tempfile.TemporaryDirectory(prefix="hub-mac-") as temporary:
            root = Path(temporary)
            case = root / "expiry"
            case.mkdir()
            evidence["expiry_calibration"] = calibration(case, constants)
            for candidate in ("process-group", "launchd-omitted", "launchd-false", "launchd-true"):
                for scenario in ("normal", "early-exit", "root-kill", "simultaneous"):
                    case = root / uuid.uuid4().hex[:8]
                    case.mkdir()
                    result = experiment(case, constants, candidate, scenario, domain)
                    evidence["experiments"].append(result)
                    assert "fixture_error" not in result and "cleanup_error" not in result, result
                    print(json.dumps(dict(candidate=candidate, scenario=scenario,
                                          accepted=result["accepted"],
                                          surviving_roles=result["surviving_roles"],
                                          unrelated_survived=True, independent_cleanup=True)), flush=True)
        evidence["fixture_status"] = "passed: candidates rejected with detached survivors"
    except BaseException as error:
        evidence["fixture_status"] = "failed"
        evidence["failure"] = repr(error)
        raise
    finally:
        (output / "evidence.json").write_text(json.dumps(evidence, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(dict(fixture_status=evidence["fixture_status"], kqueue=constants,
                          production_macos_enabled=False)), flush=True)


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--worker":
        run_worker(sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5], float(sys.argv[6]), sys.argv[7])
    else:
        main()
