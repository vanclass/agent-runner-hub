// Dedicated native-webdriver debug fixture. No product attachment or input state is written.
use std::{mem::{size_of, ManuallyDrop}, sync::{Arc, Mutex}};
use serde_json::{json, Value};
use tauri::{Manager, Runtime, State, WebviewWindow};
use windows::{core::{implement, BOOL, HRESULT, Ref}, Win32::{
    Foundation::{E_NOTIMPL, E_UNEXPECTED, HWND, POINT, S_OK, DV_E_FORMATETC,
        DRAGDROP_S_CANCEL, DRAGDROP_S_DROP, DRAGDROP_S_USEDEFAULTCURSORS},
    System::{Com::*, Memory::*, Ole::*, SystemServices::MODIFIERKEYS_FLAGS},
    UI::{Input::KeyboardAndMouse::*, Shell::{DROPFILES, SHCreateStdEnumFmtEtc}, WindowsAndMessaging::*},
}};

#[derive(Default)]
struct Probe(Arc<Mutex<Vec<Value>>>);
fn record(log: &Arc<Mutex<Vec<Value>>>, item: Value) { log.lock().unwrap().push(item); }
fn format() -> FORMATETC { FORMATETC { cfFormat: CF_HDROP.0, ptd: std::ptr::null_mut(),
    dwAspect: DVASPECT_CONTENT.0, lindex: -1, tymed: TYMED_HGLOBAL.0 as u32 } }

#[implement(IDataObject)]
struct FileObject { path: String, log: Arc<Mutex<Vec<Value>>> }
impl IDataObject_Impl for FileObject_Impl {
    fn GetData(&self, f: *const FORMATETC) -> windows::core::Result<STGMEDIUM> {
        self.QueryGetData(f).ok()?;
        let names: Vec<u16> = self.path.encode_utf16().chain([0, 0]).collect();
        unsafe {
            let memory = GlobalAlloc(GMEM_MOVEABLE | GMEM_ZEROINIT, size_of::<DROPFILES>() + names.len() * 2)?;
            let bytes = GlobalLock(memory) as *mut u8;
            if bytes.is_null() { let _ = windows::Win32::Foundation::GlobalFree(Some(memory)); return Err(E_UNEXPECTED.into()); }
            (bytes as *mut DROPFILES).write(DROPFILES { pFiles: size_of::<DROPFILES>() as u32,
                pt: POINT::default(), fNC: BOOL(0), fWide: BOOL(1) });
            std::ptr::copy_nonoverlapping(names.as_ptr(), bytes.add(size_of::<DROPFILES>()) as *mut u16, names.len());
            let _ = GlobalUnlock(memory);
            record(&self.log, json!({"stage":"GetData", "format":"CF_HDROP", "path":self.path}));
            Ok(STGMEDIUM { tymed: TYMED_HGLOBAL.0 as u32, u: STGMEDIUM_0 { hGlobal: memory },
                pUnkForRelease: ManuallyDrop::new(None) })
        }
    }
    fn QueryGetData(&self, f: *const FORMATETC) -> HRESULT {
        if !f.is_null() && unsafe { (*f).ptd.is_null() && (*f).cfFormat == CF_HDROP.0 && (*f).dwAspect == DVASPECT_CONTENT.0
            && (*f).lindex == -1 && (*f).tymed & TYMED_HGLOBAL.0 as u32 != 0 } { S_OK } else { DV_E_FORMATETC }
    }
    fn EnumFormatEtc(&self, direction: u32) -> windows::core::Result<IEnumFORMATETC> {
        if direction == DATADIR_GET.0 as u32 { unsafe { SHCreateStdEnumFmtEtc(&[format()]) } } else { Err(E_NOTIMPL.into()) }
    }
    fn GetDataHere(&self, _: *const FORMATETC, _: *mut STGMEDIUM) -> windows::core::Result<()> { Err(E_NOTIMPL.into()) }
    fn GetCanonicalFormatEtc(&self, _: *const FORMATETC, _: *mut FORMATETC) -> HRESULT { E_NOTIMPL }
    fn SetData(&self, _: *const FORMATETC, _: *const STGMEDIUM, _: BOOL) -> windows::core::Result<()> { Err(E_NOTIMPL.into()) }
    fn DAdvise(&self, _: *const FORMATETC, _: u32, _: Ref<IAdviseSink>) -> windows::core::Result<u32> { Err(E_NOTIMPL.into()) }
    fn DUnadvise(&self, _: u32) -> windows::core::Result<()> { Err(E_NOTIMPL.into()) }
    fn EnumDAdvise(&self) -> windows::core::Result<IEnumSTATDATA> { Err(E_NOTIMPL.into()) }
}

fn native_sample(root: HWND) -> Value {
    unsafe {
        let mut point = POINT::default();
        let _ = GetPhysicalCursorPos(&mut point);
        let recipient = WindowFromPhysicalPoint(point);
        let capture = GetCapture();
        let mut class = [0u16; 128];
        let n = GetClassNameW(capture, &mut class);
        json!({"root":root.0 as usize, "x":point.x, "y":point.y,
            "recipient":recipient.0 as usize, "recipientInside": recipient == root || IsChild(root, recipient).as_bool(),
            "capture":capture.0 as usize, "captureInside":capture == root || IsChild(root, capture).as_bool(),
            "captureClass":String::from_utf16_lossy(&class[..n as usize]),
            "leftDown":GetAsyncKeyState(VK_LBUTTON.0 as i32) < 0})
    }
}
#[implement(IDropSource)]
struct Source { root: usize, log: Arc<Mutex<Vec<Value>>> }
impl IDropSource_Impl for Source_Impl {
    fn QueryContinueDrag(&self, escape: BOOL, keys: MODIFIERKEYS_FLAGS) -> HRESULT {
        record(&self.log, json!({"stage":"QueryContinueDrag", "escape":escape.as_bool(), "keys":keys.0,
            "native":native_sample(HWND(self.root as *mut _))}));
        if escape.as_bool() { DRAGDROP_S_CANCEL }
        else if keys.0 & 1 == 0 { DRAGDROP_S_DROP } else { S_OK }
    }
    fn GiveFeedback(&self, _: DROPEFFECT) -> HRESULT { DRAGDROP_S_USEDEFAULTCURSORS }
}

#[tauri::command]
fn observations(state: State<'_, Probe>) -> Vec<Value> { state.0.lock().unwrap().clone() }
#[tauri::command]
fn start<R: Runtime>(window: WebviewWindow<R>, state: State<'_, Probe>, path: String) -> Result<(), String> {
    if !std::path::Path::new(&path).is_absolute() || !std::path::Path::new(&path).is_file()
        || !path.to_ascii_lowercase().ends_with(".png") { return Err("Expected original absolute PNG path".into()); }
    let log = state.0.clone();
    let root = window.hwnd().map_err(|e| e.to_string())?.0 as usize;
    window.run_on_main_thread(move || unsafe {
        let root_hwnd = HWND(root as *mut _);
        let initial = native_sample(root_hwnd);
        if initial["leftDown"] != true || initial["recipientInside"] != true {
            record(&log, json!({"stage":"not-started", "native":initial})); return;
        }
        record(&log, json!({"stage":"start", "path":path, "native":initial}));
        let data: IDataObject = FileObject { path, log:log.clone() }.into();
        let source: IDropSource = Source { root, log:log.clone() }.into();
        let mut effect = DROPEFFECT_NONE;
        let result = DoDragDrop(&data, &source, DROPEFFECT_COPY, &mut effect);
        record(&log, json!({"stage":"complete", "hresult":format!("0x{:08X}", result.0 as u32),
            "effect":effect.0, "native":native_sample(root_hwnd)}));
    }).map_err(|e| e.to_string())
}

pub fn plugin<R: Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri::plugin::Builder::new("ole-probe")
        .setup(|app, _| {
            app.manage(Probe::default());
            app.add_capability(tauri::ipc::CapabilityBuilder::new("native-ole-probe")
                .window("main").permission("ole-probe:allow-start")
                .permission("ole-probe:allow-observations"))?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![start, observations]).build()
}
