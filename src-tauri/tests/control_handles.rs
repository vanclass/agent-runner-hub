#![cfg(windows)]
#[path = "../src/desktop_terminal/control.rs"] mod control;
#[path = "../src/desktop_terminal/job.rs"] mod job;
#[path = "../src/desktop_terminal/startup.rs"] mod startup;
use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use std::{io::{Read, Write}, os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle},
    thread, time::{Duration, Instant}};
use windows_sys::Win32::{Security::SECURITY_ATTRIBUTES, System::Threading::CreateEventW};

const CHILD: &str = r#"
import ctypes,json,os,sys,time,msvcrt,base64,hashlib,struct,zlib
from ctypes import wintypes
args=dict(zip(sys.argv[1::2],sys.argv[2::2]))
sentinel=int(os.environ['HUB_CONTROL_SENTINEL'])
flags=wintypes.DWORD()
kernel=ctypes.windll.kernel32
if kernel.GetHandleInformation(wintypes.HANDLE(sentinel),ctypes.byref(flags)):
    kernel.OpenEventW.restype=wintypes.HANDLE
    comparison=kernel.OpenEventW(0x100000,False,os.environ['HUB_CONTROL_EVENT'])
    assert comparison
    assert not ctypes.WinDLL('kernelbase').CompareObjectHandles(wintypes.HANDLE(sentinel),wintypes.HANDLE(comparison)), 'unlisted object inherited'
    kernel.CloseHandle(wintypes.HANDLE(comparison))
incoming=int(args['--local-control-input']); outgoing=int(args['--local-control-output'])
for handle in (incoming,outgoing):
    assert ctypes.windll.kernel32.GetHandleInformation(wintypes.HANDLE(handle),ctypes.byref(flags)), 'control handle absent'
key=os.environ.pop('AGENT_RUNNER_LOCAL_CONTROL_KEY')
reader=msvcrt.open_osfhandle(incoming,os.O_RDONLY|os.O_BINARY)
writer=msvcrt.open_osfhandle(outgoing,os.O_WRONLY|os.O_BINARY)
identity=dict(version=1,process_id=os.getpid(),session_id=args['--session-id'],connection_id='a'*32)
def send(**fields): os.write(writer,(json.dumps(dict(identity,**fields))+'\n').encode())
send(event='hello',operations=['observe','command'],interaction_owner='runner_terminal')
# Canonical protocol with synthetic media only, not genuine Codex generation.
def png_chunk(kind,data):
    return struct.pack('>I',len(data))+kind+data+struct.pack('>I',zlib.crc32(kind+data))
png=b'\x89PNG\r\n\x1a\n'+png_chunk(b'IHDR',struct.pack('>IIBBBBB',2,1,8,2,0,0,0))+png_chunk(b'IDAT',zlib.compress(b'\0\xff\0\0\0\xff\0'))+png_chunk(b'IEND',b'')
images=[dict(image_id=letter*32,source_sequence=sequence,output_index=0,source='codex.imageGeneration',mime_type='image/png',byte_length=len(png),sha256=hashlib.sha256(png).hexdigest() if letter=='a' else '0'*64,width=2,height=1) for letter,sequence in [('a',31),('b',17)]]
image_cap=dict(version=1,operations=['generated_images.list','generated_images.read'],mime_types=['image/png'],max_image_bytes=16777216,max_chunk_bytes=17,page_size=1,lifetime='owning_control_connection',read_only=True)
brief_cap=dict(version=1,operations=['brief.stage'],run_modes=['issue-run'],lifetime='process_session',automatic_retry=False)
run_cap=dict(version=1,operations=['run.invoke','run.status'],run_modes=['issue-run'],observation_lifetime='process_session',automatic_retry=False,receipt='request_accepted')
run=None
staged=0
buffer=b''
previous=0
while True:
    buffer+=os.read(reader,4096)
    if b'\n' not in buffer: continue
    line,_,buffer=buffer.partition(b'\n'); packet=json.loads(line)
    assert packet.pop('key')==key
    assert all(packet[name]==value for name,value in identity.items())
    request_id=packet['request_id']
    assert request_id>previous
    previous=request_id
    send(request_id=request_id,status='accepted',phase='queued')
    if packet['operation']=='brief.stage':
        assert packet['api_version']==1
        if packet['body']=='reject':
            send(request_id=request_id,status='rejected',phase='completed',staging_status='not_staged',outcome_unknown=False)
        elif packet['body']=='unknown':
            send(request_id=request_id,status='failure',phase='completed',staging_status='unknown',outcome_unknown=True)
            brief_cap['operations']=[]
        else:
            assert packet['body']=='  한글 🌍\n    second\t \n\n'
            staged+=1
            send(request_id=request_id,status='accepted',phase='completed',staging_status='staged',owner='brief_staging',count=staged,outcome_unknown=False)
        continue
    if packet['operation']=='run.invoke':
        assert staged==1
        assert run is None
        run=dict(invocation_request_id=request_id,request_status='accepted',initiation_status='pending',dispatch_status='dispatching',
            issue_run_id='',authority_digest='',state_revision=0,lifecycle_status='',lifecycle_terminal=False,
            terminal_reason='',outcome='',owner_status='',outcome_unknown=False)
        send(request_id=request_id,status='accepted',phase='completed',receipt='request_accepted',run=run)
        continue
    if packet['operation']=='run.status':
        assert run and packet['invocation_request_id']==run['invocation_request_id']
        run.update(initiation_status='started',issue_run_id='issue-pipe',authority_digest='a'*64,state_revision=1,lifecycle_status='running')
        send(request_id=request_id,status='accepted',phase='completed',run=run)
        continue
    if packet['operation']=='generated_images.list':
        offset=packet['offset']
        send(request_id=request_id,status='rejected',phase='completed',code='GENERATED_IMAGE_RESOLVER_UNAVAILABLE',images=images[offset:offset+1],total_count=2,offset=offset,next_offset=offset+1 if offset+1<2 else None)
        continue
    if packet['operation']=='generated_images.read':
        image=next((image for image in images if image['image_id']==packet['image_id']),None)
        assert image and 0<packet['length']<=17
        offset=packet['offset']; end=min(offset+packet['length'],len(png))
        send(request_id=request_id,status='accepted',phase='completed',**image,offset=offset,data_base64=base64.b64encode(png[offset:end]).decode(),next_offset=end if end<len(png) else None)
        continue
    if packet['operation']=='command':
        send(request_id=request_id,status='pending-interaction',phase='awaiting_interaction')
        time.sleep(.2)
        break
    observation=dict(run_mode='issue-run',target=dict(binding_state='unbound',owner='',project=''),
        selection=dict(account='',model='fixture',reasoning_effort='medium',service_tier='default',source='configuration',next_model='fixture',next_reasoning_effort='medium',next_service_tier='default'),
        execution=dict(lifecycle_state='INTERACTIVE_READY',owned_execution_alive=False,workflow_kind=''),
        attention=dict(foreground_interaction_active=False,restart_confirmation_required=False,termination_confirmation_active=False,account_setup_required=False,awaiting_user_command_reason='',suspension_status='',suspension_reason=''),commands=[])
    send(request_id=request_id,status='accepted',phase='completed',observation=observation,capabilities=dict(generated_images=image_cap,brief=brief_cap,run=run_cap))
"#;

#[test]
#[ignore = "Requires HUB_CONTROL_PYTHON pointing to a direct Python interpreter on Windows"]
fn exact_handle_allowlist_authenticated_roundtrip_and_eof_uncertainty() {
    let python = std::env::var("HUB_CONTROL_PYTHON").expect("absolute direct Python interpreter path");
    let security = SECURITY_ATTRIBUTES { nLength: std::mem::size_of::<SECURITY_ATTRIBUTES>() as u32,
        lpSecurityDescriptor: std::ptr::null_mut(), bInheritHandle: 1 };
    let event = format!("Local\\HubControlAllowlist-{}", std::process::id());
    let wide: Vec<u16> = event.encode_utf16().chain(Some(0)).collect();
    let sentinel = unsafe { CreateEventW(&security, 1, 0, wide.as_ptr()) };
    assert!(!sentinel.is_null());
    let sentinel = unsafe { OwnedHandle::from_raw_handle(sentinel) };
    let pair = native_pty_system().openpty(PtySize::default()).unwrap();
    let mut reader = pair.master.try_clone_reader().unwrap();
    let mut writer = pair.master.take_writer().unwrap();
    let output = thread::spawn(move || {
        let mut bytes = [0; 4096]; let mut cursor = startup::InitialCursor::new(true); let mut captured = Vec::new();
        while let Ok(count) = reader.read(&mut bytes) {
            if count == 0 { break; }
            let (answer, forwarded) = cursor.push(&bytes[..count]);
            if answer { writer.write_all(b"\x1b[1;1R").unwrap(); }
            captured.extend(forwarded);
        }
        captured
    });
    let job = job::Job::new().unwrap();
    let mut command = CommandBuilder::new(python);
    command.args(["-I", "-c", CHILD]);
    command.env("HUB_CONTROL_SENTINEL", format!("{}", sentinel.as_raw_handle() as usize));
    command.env("HUB_CONTROL_EVENT", event);
    job.configure(&mut command);
    let launch = control::Launch::new(&mut command).unwrap();
    let private_key = command.get_env("AGENT_RUNNER_LOCAL_CONTROL_KEY").unwrap().to_string_lossy().into_owned();
    let mut child = pair.slave.spawn_command(command).unwrap();
    let client: std::sync::Arc<control::Client> = launch.bind(child.process_id().unwrap());
    drop(pair.slave);
    let deadline = Instant::now() + Duration::from_secs(10);
    while client.snapshot().state == "connecting" && Instant::now() < deadline { thread::sleep(Duration::from_millis(10)); }
    let ready = client.snapshot();
    if ready.state != "ready" {
        client.close(); job.terminate().unwrap(); child.wait().unwrap(); drop(pair.master);
        let captured = output.join().unwrap();
        panic!("Control fixture failed: {:?}; {}", ready.detail, String::from_utf8_lossy(&captured));
    }
    let public = serde_json::to_string(&ready).unwrap();
    assert!(!public.contains(&private_key), "Private launch key reached public snapshot");
    for private in ["key", "process_id", "session_id", "connection_id"] { assert!(!public.contains(private)); }
    assert!(ready.generated_images_supported);
    let inventory = client.images_list().unwrap();
    assert!(inventory.incomplete.unwrap().detail.contains("GENERATED_IMAGE_RESOLVER_UNAVAILABLE"));
    let images = inventory.images;
    assert_eq!(images.iter().map(|image| image.source_sequence).collect::<Vec<_>>(), [31, 17]);
    let image = client.image_read(&images[0].image_id).unwrap();
    assert_eq!((image.image.width, image.image.height), (2, 1));
    assert!(image.png.starts_with(b"\x89PNG\r\n\x1a\n"));
    assert_eq!(client.image_read(&images[1].image_id).err().unwrap().state, "failed");
    assert_eq!(client.image_read(&"c".repeat(32)).err().unwrap().state, "unavailable");
    for (body, expected) in [("  한글 🌍\n    second\t \n\n", "accepted"), ("reject", "rejected"), ("unknown", "outcome-unknown")] {
        let admission = client.feature(control::features::Request::Brief(control::brief::Request::Stage { api_version:1, body:body.into() }));
        let (id, generation) = match admission { control::features::Admission::Submitted { id, generation } => (id, generation), other => panic!("{other:?}") };
        assert_eq!(generation, ready.features.generation);
        loop {
            let snapshot = client.snapshot();
            let receipt = snapshot.features.results.iter().find(|r| r.id == id).unwrap();
            if receipt.phase.as_deref() == Some("completed") { assert_eq!(receipt.state, expected); break; }
            assert!(Instant::now() < deadline); thread::sleep(Duration::from_millis(10));
        }
        if expected == "accepted" {
            let mut original = 0;
            for started in [false, true] {
                let request = if started { control::run::Request::Status { api_version:1, invocation_request_id:original } }
                    else { control::run::Request::Invoke { api_version:1 } };
                let run = client.feature(control::features::Request::Run(request));
                let id = match run { control::features::Admission::Submitted { id, generation } => {
                    assert_eq!(generation, ready.features.generation); id }, other => panic!("{other:?}") };
                if !started { original = id; }
                loop {
                    let snapshot = client.snapshot();
                    if let Some(r) = snapshot.features.results.iter().find(|r| r.id == id && r.phase.as_deref() == Some("completed")) {
                        let Some(control::features::Response::Run(reply)) = &r.reply else { panic!("{r:?}") };
                        let evidence = reply.run.as_ref().unwrap(); assert_eq!(evidence.invocation_request_id, original);
                        assert_eq!(evidence.initiation_status, if started { "started" } else { "pending" }); break;
                    }
                    assert!(Instant::now() < deadline); thread::sleep(Duration::from_millis(10));
                }
            }
        }
    }
    assert!(client.snapshot().results.is_empty());
    while client.snapshot().features.brief.is_some() {
        assert!(Instant::now() < deadline); thread::sleep(Duration::from_millis(10));
    }
    let stage = || control::features::Request::Brief(control::brief::Request::Stage { api_version:1, body:"unsupported".into() });
    assert!(matches!(client.feature(stage()), control::features::Admission::NotSent { .. }));
    client.command("/status".into()).unwrap();
    while client.snapshot().state != "disconnected" && Instant::now() < deadline { thread::sleep(Duration::from_millis(10)); }
    assert_eq!(client.snapshot().results.last().unwrap().state, "outcome-unknown");
    assert!(matches!(client.feature(stage()), control::features::Admission::NotSent { .. }));
    client.close(); job.terminate().unwrap(); child.wait().unwrap(); drop(pair.master);
    let terminal = String::from_utf8_lossy(&output.join().unwrap()).into_owned();
    assert!(!terminal.contains(&private_key), "Private launch key reached terminal output");
    assert!(!terminal.contains("Traceback"), "{terminal}");
}
