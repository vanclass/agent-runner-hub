// Compiled only by the existing debug native-webdriver feature on macOS.
// No command/IPC endpoint: presentation is selected once before application launch.
use std::ffi::{c_char, c_void};
use tauri::Manager;

#[link(name = "AppKit", kind = "framework")]
extern "C" {}
#[link(name = "objc")]
extern "C" {
    fn sel_registerName(name: *const c_char) -> *const c_void;
    fn objc_msgSend();
}
extern "C" { fn pthread_main_np() -> i32; }

// Objective-C signatures below match NSWindow's documented methods. All calls
// occur on Tauri's Ready/main thread, and the native pointer is borrowed only here.
unsafe fn integer(window: *mut c_void, selector: &std::ffi::CStr) -> isize {
    let call: unsafe extern "C" fn(*mut c_void, *const c_void) -> isize =
        std::mem::transmute(objc_msgSend as unsafe extern "C" fn());
    call(window, sel_registerName(selector.as_ptr()))
}
unsafe fn flag(window: *mut c_void, selector: &std::ffi::CStr) -> bool {
    let call: unsafe extern "C" fn(*mut c_void, *const c_void) -> bool =
        std::mem::transmute(objc_msgSend as unsafe extern "C" fn());
    call(window, sel_registerName(selector.as_ptr()))
}

pub fn ready(app: &tauri::AppHandle) {
    assert_eq!(unsafe { pthread_main_np() }, 1, "Native window operations require the main thread");
    let presentation = std::env::var("HUB_NATIVE_PRESENTATION").expect("Explicit native presentation required");
    assert!(presentation == "background" || presentation == "nonactivating");
    let window = app.get_webview_window("main").expect("Owned test main window");
    let native = window.ns_window().expect("Owned NSWindow");
    assert!(!native.is_null());
    unsafe {
        assert!(!flag(native, c"canBecomeKeyWindow") && !flag(native, c"canBecomeMainWindow"),
            "Test window must be unfocusable before ordering");
        if presentation == "nonactivating" {
            // No Tauri show(): Tao may use makeKeyAndOrderFront. Ready occurs after
            // its startup ordering; orderBack preserves the current key/main window.
            let order_back: unsafe extern "C" fn(*mut c_void, *const c_void, *mut c_void) =
                std::mem::transmute(objc_msgSend as unsafe extern "C" fn());
            order_back(native, sel_registerName(c"orderBack:".as_ptr()), std::ptr::null_mut());
        }
        println!("HUB_NATIVE_READY {}", integer(native, c"windowNumber"));
    }
}