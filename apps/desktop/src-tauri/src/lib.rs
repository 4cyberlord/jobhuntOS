use argon2::{Argon2, PasswordHash, PasswordHasher, PasswordVerifier, password_hash::SaltString};
use rand_core::OsRng;
use keyring::Entry;
use serde::{Deserialize, Serialize};

const SERVICE: &str = "com.jobhuntos.desktop";
#[derive(Serialize, Deserialize)] struct AuthRecord { hash: String }
fn vault() -> Result<Entry, String> { Entry::new(SERVICE, "local-auth").map_err(|e| e.to_string()) }
#[tauri::command]
fn setup_account(password: String) -> Result<(), String> { if password.len() < 12 { return Err("Use at least 12 characters".into()) } let salt = SaltString::generate(&mut OsRng); let hash = Argon2::default().hash_password(password.as_bytes(), &salt).map_err(|e| e.to_string())?.to_string(); vault()?.set_password(&serde_json::to_string(&AuthRecord { hash }).map_err(|e| e.to_string())?).map_err(|e| e.to_string()) }
#[tauri::command]
fn verify_account(password: String) -> Result<bool, String> { let saved = vault()?.get_password().map_err(|_| "No local account configured".to_string())?; let record: AuthRecord = serde_json::from_str(&saved).map_err(|e| e.to_string())?; let hash = PasswordHash::new(&record.hash).map_err(|e| e.to_string())?; Ok(Argon2::default().verify_password(password.as_bytes(), &hash).is_ok()) }
#[tauri::command]
fn store_portal_secret(service: String, username: String, password: String) -> Result<(), String> { if service.trim().is_empty() || username.trim().is_empty() || password.is_empty() { return Err("Credential fields are required".into()) } Entry::new(SERVICE, &format!("portal:{service}:{username}")).map_err(|e| e.to_string())?.set_password(&password).map_err(|e| e.to_string()) }
/// Writes a document to a private temp folder and opens it with the macOS default app (Word for .docx, Preview for .pdf).
#[tauri::command]
fn open_document(app: tauri::AppHandle, file_name: String, bytes: Vec<u8>) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    let mut safe: String = file_name.chars().map(|c| if c.is_alphanumeric() || matches!(c, '.' | '-' | '_' | ' ') { c } else { '_' }).collect();
    if safe.is_empty() || safe.starts_with('.') { safe.insert(0, '_'); }
    let dir = std::env::temp_dir().join("job-hunt-os-docs");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join(safe);
    std::fs::write(&path, bytes).map_err(|e| e.to_string())?;
    app.opener().open_path(path.to_string_lossy().to_string(), None::<&str>).map_err(|e| e.to_string())
}
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() { tauri::Builder::default().plugin(tauri_plugin_notification::init()).plugin(tauri_plugin_opener::init()).invoke_handler(tauri::generate_handler![setup_account, verify_account, store_portal_secret, open_document]).run(tauri::generate_context!()).expect("tauri app error"); }
