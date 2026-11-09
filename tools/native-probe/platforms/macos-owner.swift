import AppKit
import CoreGraphics
import Darwin
import Foundation

// One direct, unreaped POSIX child owns all signaling authority. The main thread
// serializes waitpid, AppKit observations, quit and force cleanup; no PID adoption.
enum OwnerError: Error { case capability(String) }
let args = CommandLine.arguments
guard args.count == 6, let port = Int(args[2]), let budget = Double(args[3]),
      ["background", "nonactivating"].contains(args[4]) else { exit(2) }
let executable = args[1], presentation = args[4], attempt = args[5]
let budgetSeconds = budget / 1000
var child: pid_t = 0
var live = false, finished = false, activationObserved = false
var ownershipLost = false
var exitCode: Int32 = -1, windowNumber = 0
var application: NSRunningApplication?
var outputFD: Int32 = -1, outputBuffer = ""

func emit(_ value: [String: Any]) {
    if let data = try? JSONSerialization.data(withJSONObject: value), let line = String(data: data, encoding: .utf8) {
        print(line)
        fflush(stdout)
    }
}
func pump() { _ = RunLoop.current.run(mode: .default, before: Date(timeIntervalSinceNow: 0.01)) }
func reap() {
    guard live else { return }
    var status: Int32 = 0
    let result = waitpid(child, &status, WNOHANG)
    if result == child {
        live = false
        exitCode = (status & 0x7f) == 0 ? (status >> 8) & 0xff : 128 + (status & 0x7f)
    } else if result == -1 && errno == ECHILD {
        // Unknown reaping is not settlement evidence and never permits signaling.
        live = false
        ownershipLost = true
    }
}
func consumeOutput() {
    guard outputFD >= 0 else { return }
    var bytes = [UInt8](repeating: 0, count: 4096)
    while true {
        let count = read(outputFD, &bytes, 4096)
        if count <= 0 { break }
        outputBuffer += String(decoding: bytes.prefix(count), as: UTF8.self)
        while let newline = outputBuffer.firstIndex(of: "\n") {
            let line = String(outputBuffer[..<newline])
            outputBuffer.removeSubrange(...newline)
            if line.hasPrefix("HUB_NATIVE_READY "), let number = Int(line.dropFirst("HUB_NATIVE_READY ".count)) {
                windowNumber = number
            }
        }
        if outputBuffer.utf8.count > 4096 { outputBuffer = "" }
    }
}
func lsof(_ ownedOnly: Bool) throws -> String {
    let command = Process()
    command.executableURL = URL(fileURLWithPath: "/usr/sbin/lsof")
    command.arguments = ["-n", "-P", "-a"] + (ownedOnly ? ["-p", String(child), "-iTCP"] : ["-iTCP:\(port)"])
        + ["-sTCP:LISTEN", "-F", "pftPnT"]
    command.environment = ["PATH": "/usr/bin:/bin:/usr/sbin:/sbin", "LC_ALL": "C"]
    let pipe = Pipe()
    command.standardOutput = pipe
    command.standardError = FileHandle.nullDevice
    try command.run()
    let deadline = Date(timeIntervalSinceNow: budgetSeconds)
    while command.isRunning && Date() < deadline { pump() }
    if command.isRunning {
        command.terminate()
        command.waitUntilExit()
        throw OwnerError.capability("Listener inspection timed out")
    }
    let data = pipe.fileHandleForReading.readDataToEndOfFile()
    guard command.terminationStatus == 0 || command.terminationStatus == 1 else {
        throw OwnerError.capability("lsof cannot inspect owned listener without privilege")
    }
    return String(decoding: data, as: UTF8.self)
}
func snapshot() throws -> [String: Any] {
    reap()
    consumeOutput()
    guard live else { throw OwnerError.capability("Owned Hub exited: \(exitCode)") }
    if application == nil { application = NSRunningApplication(processIdentifier: child) }
    let foreground = NSWorkspace.shared.frontmostApplication
    if let owned = application, foreground?.isEqual(owned) == true { activationObserved = true }
    guard let windows = CGWindowListCopyWindowInfo(.optionAll, kCGNullWindowID) as? [[String: Any]] else {
        throw OwnerError.capability("Native window observation unavailable")
    }
    let ownedIndex = windows.firstIndex { ($0[kCGWindowOwnerPID as String] as? Int) == Int(child)
        && ($0[kCGWindowNumber as String] as? Int) == windowNumber }
    let foregroundIndex = windows.firstIndex {
        ($0[kCGWindowOwnerPID as String] as? Int) == Int(foreground?.processIdentifier ?? 0)
            && ($0[kCGWindowIsOnscreen as String] as? Bool) == true
            && ($0[kCGWindowLayer as String] as? Int) == 0
    }
    let visible = ownedIndex.map { (windows[$0][kCGWindowIsOnscreen as String] as? Bool) == true } ?? false
    let behind = ownedIndex.flatMap { own in foregroundIndex.map { $0 < own } } ?? false
    return ["pid": Int(child), "hwnd": max(0, windowNumber), "visible": visible,
        "foreground": Int(foreground?.processIdentifier ?? 0), "foregroundAbove": behind,
        "activationObserved": activationObserved, "initialPresentation": presentation]
}
func stop() {
    guard !finished else { return }
    reap()
    var forced = false
    if live {
        if application == nil { application = NSRunningApplication(processIdentifier: child) }
        // Normal app quit, not raw NSWindow.close: retained app identity only.
        _ = application?.terminate()
        let deadline = Date(timeIntervalSinceNow: budgetSeconds)
        while live && Date() < deadline { pump(); consumeOutput(); reap() }
        if live {
            forced = true
            // An unreaped direct child cannot have a reused PID. Never signal after reap.
            _ = kill(child, SIGTERM)
            let forceDeadline = Date(timeIntervalSinceNow: budgetSeconds)
            while live && Date() < forceDeadline { pump(); consumeOutput(); reap() }
            if live {
                _ = kill(child, SIGKILL)
                var status: Int32 = 0
                if waitpid(child, &status, 0) != child { ownershipLost = true }
                live = false
                exitCode = 137
            }
        }
    }
    let released = (try? lsof(false).isEmpty) ?? false
    emit(["stopped": !live && !ownershipLost, "forced": forced, "exitCode": Int(exitCode), "listenerReleased": released,
        "activationObserved": activationObserved, "shutdown": "NSRunningApplication.terminate"])
    finished = true
}

do {
    guard NSWorkspace.shared.frontmostApplication != nil else {
        throw OwnerError.capability("An existing foreground application is required for nonactivation")
    }
    let observer = NSWorkspace.shared.notificationCenter.addObserver(
        forName: NSWorkspace.didActivateApplicationNotification, object: nil, queue: .main) { notification in
        guard live, let active = notification.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication else { return }
        if let owned = application {
            if active.isEqual(owned) { activationObserved = true }
        } else if active.processIdentifier == child { application = active; activationObserved = true }
    }
    defer { NSWorkspace.shared.notificationCenter.removeObserver(observer) }
    // Verify the observation utility before launching; no host grant or fallback.
    _ = try lsof(false)
    var descriptors: [Int32] = [0, 0]
    guard pipe(&descriptors) == 0 else { throw OwnerError.capability("Owned output pipe unavailable") }
    outputFD = descriptors[0]
    defer { close(descriptors[0]); close(descriptors[1]) }
    _ = fcntl(outputFD, F_SETFL, O_NONBLOCK)
    var actions: posix_spawn_file_actions_t?
    posix_spawn_file_actions_init(&actions)
    defer { posix_spawn_file_actions_destroy(&actions) }
    posix_spawn_file_actions_adddup2(&actions, descriptors[1], STDOUT_FILENO)
    posix_spawn_file_actions_addopen(&actions, STDIN_FILENO, "/dev/null", O_RDONLY, 0)
    posix_spawn_file_actions_addopen(&actions, STDERR_FILENO, attempt + "/tmp/hub.stderr", O_WRONLY | O_CREAT | O_TRUNC, 0o600)
    posix_spawn_file_actions_addclose(&actions, descriptors[0])
    posix_spawn_file_actions_addclose(&actions, descriptors[1])
    let argv = [strdup(executable), nil]
    let env = ProcessInfo.processInfo.environment.map { strdup("\($0.key)=\($0.value)") } + [nil]
    defer { argv.forEach { free($0) }; env.forEach { free($0) } }
    let result = executable.withCString { file in
        argv.withUnsafeBufferPointer { arguments in
            env.withUnsafeBufferPointer { environment in
                posix_spawn(&child, file, &actions, nil, arguments.baseAddress!, environment.baseAddress!)
            }
        }
    }
    guard result == 0 else { throw OwnerError.capability("Process creation failed: \(result)") }
    live = true
    emit(["started": true, "pid": Int(child), "initialPresentation": presentation])
    DispatchQueue.global().async {
        while let line = readLine() {
            DispatchQueue.main.async {
                guard !finished else { return }
                do {
                    guard let data = line.data(using: .utf8),
                          let request = try JSONSerialization.jsonObject(with: data) as? [String: String],
                          let action = request["action"] else { throw OwnerError.capability("Invalid owner request") }
                    if action == "stop" { stop(); return }
                    var state = try snapshot()
                    if action == "listener" { state["listenerRecords"] = try lsof(true) }
                    else if action == "show" {
                        guard presentation == "nonactivating", state["visible"] as? Bool == true else {
                            throw OwnerError.capability("Nonactivating presentation unavailable; no show/focus fallback")
                        }
                    } else if action != "snapshot" { throw OwnerError.capability("Unknown owner request") }
                    emit(state)
                } catch { emit(["error": String(describing: error), "kind": "blocked"]) }
            }
        }
        DispatchQueue.main.async { stop() }
    }
    while !finished { pump(); consumeOutput() }
} catch {
    emit(["error": String(describing: error), "stage": live ? "native-owner" : "process-creation", "kind": "blocked"])
    if live { stop() }
}
