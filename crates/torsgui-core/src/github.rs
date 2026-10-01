//! GitHub releases: API listing with fallbacks when rate-limited (the
//! `releases/latest` redirect and the HTML asset listing, pitfall 8),
//! downloads and archive extraction (zip / 7z / tar.gz / tar).
//! Only official repositories are used: never mirrors.

use anyhow::{anyhow, bail, Context, Result};
use once_cell::sync::Lazy;
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize, ts_rs::TS)]
#[ts(export)]
pub struct Asset {
    pub name: String,
    /// browser_download_url
    pub url: String,
    pub size: Option<u64>,
    /// "sha256:..." when GitHub publishes it.
    pub digest: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ts_rs::TS)]
#[ts(export)]
pub struct Release {
    pub tag: String,
    pub name: String,
    pub prerelease: bool,
    pub draft: bool,
    pub published_at: Option<String>,
    pub html_url: String,
    pub assets: Vec<Asset>,
    /// "api" | "redirect+html"
    pub via: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ts_rs::TS)]
#[ts(export)]
pub struct RepoRef {
    pub owner: String,
    pub repo: String,
    pub tag: Option<String>,
}

/// Accepts `owner/repo`, repository URLs and release URLs.
pub fn parse_repo(s: &str) -> Option<RepoRef> {
    static RE: Lazy<Regex> = Lazy::new(|| {
        Regex::new(r"^(?:https?://)?(?:www\.)?(?:github\.com/)?([A-Za-z0-9_.-]+)/([A-Za-z0-9_.-]+?)(?:\.git)?(?:/releases(?:/tag/([^/?#]+)|/latest)?)?/?(?:[?#].*)?$").unwrap()
    });
    let s = s.trim();
    let c = RE.captures(s)?;
    if !s.contains("github.com") && s.contains("://") {
        return None;
    }
    Some(RepoRef { owner: c[1].to_string(), repo: c[2].to_string(), tag: c.get(3).map(|m| m.as_str().to_string()) })
}

pub(crate) fn agent(follow_redirects: bool) -> ureq::Agent {
    let tls = ureq::tls::TlsConfig::builder().root_certs(ureq::tls::RootCerts::PlatformVerifier).build();
    ureq::Agent::config_builder()
        .proxy(ureq::Proxy::try_from_env())
        .tls_config(tls)
        .http_status_as_error(false)
        .max_redirects(if follow_redirects { 10 } else { 0 })
        .timeout_global(Some(std::time::Duration::from_secs(600)))
        .user_agent("TorsGUI (+https://github.com/Tors3/TorsGUI)")
        .build()
        .into()
}

/// A web page (not the GitHub API): browser-like headers, so sites that refuse unknown
/// clients (the CCRL pages) answer as they do in a browser.
pub fn get_page(url: &str) -> Result<(u16, String)> {
    let mut resp = agent(true)
        .get(url)
        .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36 TorsGUI")
        .header("Accept", "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8")
        .header("Accept-Language", "en-US,en;q=0.8")
        .call()
        .map_err(|e| anyhow!("GET {url}: {e}"))?;
    let status = resp.status().as_u16();
    let body = resp.body_mut().with_config().limit(64 * 1024 * 1024).read_to_string().unwrap_or_default();
    Ok((status, body))
}

pub fn get_text(url: &str, token: Option<&str>) -> Result<(u16, String)> {
    let mut req = agent(true).get(url).header("Accept", "application/vnd.github+json");
    if let Some(t) = token.filter(|t| !t.is_empty()) {
        if url.contains("api.github.com") {
            req = req.header("Authorization", &format!("Bearer {t}"));
        }
    }
    let mut resp = req.call().map_err(|e| anyhow!("GET {url}: {e}"))?;
    let status = resp.status().as_u16();
    let body = resp.body_mut().with_config().limit(64 * 1024 * 1024).read_to_string().unwrap_or_default();
    Ok((status, body))
}

fn parse_api_release(v: &serde_json::Value) -> Release {
    Release {
        tag: v["tag_name"].as_str().unwrap_or("").into(),
        name: v["name"].as_str().unwrap_or("").into(),
        prerelease: v["prerelease"].as_bool().unwrap_or(false),
        draft: v["draft"].as_bool().unwrap_or(false),
        published_at: v["published_at"].as_str().map(|s| s.into()),
        html_url: v["html_url"].as_str().unwrap_or("").into(),
        assets: v["assets"]
            .as_array()
            .map(|a| {
                a.iter()
                    .map(|x| Asset {
                        name: x["name"].as_str().unwrap_or("").into(),
                        url: x["browser_download_url"].as_str().unwrap_or("").into(),
                        size: x["size"].as_u64(),
                        digest: x["digest"].as_str().map(|s| s.into()),
                    })
                    .collect()
            })
            .unwrap_or_default(),
        via: "api".into(),
    }
}

/// `releases/latest` redirect -> tag (works without API quota).
pub fn latest_tag_via_redirect(owner: &str, repo: &str) -> Result<String> {
    let url = format!("https://github.com/{owner}/{repo}/releases/latest");
    let resp = agent(false).get(&url).call().map_err(|e| anyhow!("GET {url}: {e}"))?;
    let loc = resp.headers().get("location").and_then(|v| v.to_str().ok()).map(|s| s.to_string());
    match loc {
        Some(l) if l.contains("/releases/tag/") => Ok(l.rsplit("/releases/tag/").next().unwrap().to_string()),
        _ => bail!("no redirect from {url} (status {})", resp.status()),
    }
}

/// Asset names from the HTML listing `releases/expanded_assets/<tag>`.
pub fn parse_html_assets(owner: &str, repo: &str, tag: &str, html: &str) -> Vec<Asset> {
    let re = Regex::new(&format!(
        r#"href="(/{}/{}/releases/download/{}/([^"]+))""#,
        regex::escape(owner),
        regex::escape(repo),
        regex::escape(tag)
    ))
    .unwrap();
    let mut out: Vec<Asset> = Vec::new();
    for c in re.captures_iter(html) {
        let name = percent_decode(&c[2]);
        if !out.iter().any(|a| a.name == name) {
            out.push(Asset { name, url: format!("https://github.com{}", &c[1]), size: None, digest: None });
        }
    }
    out
}

fn percent_decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::new();
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' && i + 2 < b.len() {
            if let Ok(v) = u8::from_str_radix(&s[i + 1..i + 3], 16) {
                out.push(v);
                i += 3;
                continue;
            }
        }
        out.push(b[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).to_string()
}

fn html_release(owner: &str, repo: &str, tag: &str) -> Result<Release> {
    let (st, html) = get_text(&format!("https://github.com/{owner}/{repo}/releases/expanded_assets/{tag}"), None)?;
    if st != 200 {
        bail!("HTML asset listing returned {st}");
    }
    Ok(Release {
        tag: tag.into(),
        name: tag.into(),
        prerelease: false,
        draft: false,
        published_at: None,
        html_url: format!("https://github.com/{owner}/{repo}/releases/tag/{tag}"),
        assets: parse_html_assets(owner, repo, tag, &html),
        via: "redirect+html".into(),
    })
}

/// All releases (API), or just the latest stable one through the fallbacks.
pub fn list_releases(owner: &str, repo: &str, token: Option<&str>) -> Result<Vec<Release>> {
    let url = format!("https://api.github.com/repos/{owner}/{repo}/releases?per_page=30");
    match get_text(&url, token) {
        Ok((200, body)) => {
            let v: serde_json::Value = serde_json::from_str(&body)?;
            Ok(v.as_array().map(|a| a.iter().map(parse_api_release).collect()).unwrap_or_default())
        }
        Ok((st, body)) if st == 403 || st == 429 => {
            log::warn!("GitHub API rate-limited ({st}): {}", body.chars().take(120).collect::<String>());
            let tag = latest_tag_via_redirect(owner, repo)?;
            Ok(vec![html_release(owner, repo, &tag)?])
        }
        Ok((404, _)) => bail!("repository {owner}/{repo} not found or has no releases"),
        Ok((st, _)) => bail!("GitHub API returned {st}"),
        Err(e) => {
            // network/proxy trouble with the API host: try the web fallbacks
            let tag = latest_tag_via_redirect(owner, repo).map_err(|e2| anyhow!("{e}; fallback: {e2}"))?;
            Ok(vec![html_release(owner, repo, &tag)?])
        }
    }
}

pub fn latest_stable(releases: &[Release]) -> Option<&Release> {
    releases.iter().find(|r| !r.prerelease && !r.draft)
}

pub fn release_by_tag(owner: &str, repo: &str, tag: &str, token: Option<&str>) -> Result<Release> {
    let url = format!("https://api.github.com/repos/{owner}/{repo}/releases/tags/{tag}");
    match get_text(&url, token) {
        Ok((200, body)) => Ok(parse_api_release(&serde_json::from_str(&body)?)),
        _ => html_release(owner, repo, tag),
    }
}

/// Streams `url` to `dest` (through `<dest>.part`).
pub fn download(url: &str, dest: &Path, token: Option<&str>) -> Result<u64> {
    let mut req = agent(true).get(url).header("Accept", "application/octet-stream");
    if let Some(t) = token.filter(|t| !t.is_empty()) {
        if url.contains("api.github.com") {
            req = req.header("Authorization", &format!("Bearer {t}"));
        }
    }
    let resp = req.call().map_err(|e| anyhow!("GET {url}: {e}"))?;
    if resp.status() != 200 {
        bail!("download {url}: HTTP {}", resp.status());
    }
    let part = dest.with_extension("part");
    let mut f = std::fs::File::create(&part)?;
    let mut r = resp.into_body().into_reader();
    let mut buf = vec![0u8; 1 << 16];
    let mut n = 0u64;
    loop {
        let k = r.read(&mut buf)?;
        if k == 0 {
            break;
        }
        f.write_all(&buf[..k])?;
        n += k as u64;
    }
    f.flush()?;
    drop(f);
    std::fs::rename(&part, dest)?;
    Ok(n)
}

/// Extracts zip / 7z / tar.gz / tar archives into `dir`. Other files are left as is.
pub fn extract(file: &Path, dir: &Path) -> Result<Vec<PathBuf>> {
    let name = file.file_name().map(|s| s.to_string_lossy().to_lowercase()).unwrap_or_default();
    std::fs::create_dir_all(dir)?;
    let mut out = Vec::new();
    if name.ends_with(".zip") {
        let mut z = zip::ZipArchive::new(std::fs::File::open(file)?)?;
        for i in 0..z.len() {
            let mut e = z.by_index(i)?;
            let Some(rel) = e.enclosed_name() else { continue };
            let p = dir.join(rel);
            if e.is_dir() {
                std::fs::create_dir_all(&p)?;
                continue;
            }
            if let Some(pp) = p.parent() {
                std::fs::create_dir_all(pp)?;
            }
            let mut f = std::fs::File::create(&p)?;
            std::io::copy(&mut e, &mut f)?;
            #[cfg(unix)]
            if let Some(mode) = e.unix_mode() {
                use std::os::unix::fs::PermissionsExt;
                std::fs::set_permissions(&p, std::fs::Permissions::from_mode(mode))?;
            }
            out.push(p);
        }
    } else if name.ends_with(".7z") {
        sevenz_rust::decompress_file(file, dir).map_err(|e| anyhow!("7z: {e}"))?;
        out = walkdir::WalkDir::new(dir).into_iter().filter_map(|e| e.ok()).filter(|e| e.file_type().is_file()).map(|e| e.into_path()).collect();
    } else if name.ends_with(".tar.gz") || name.ends_with(".tgz") || name.ends_with(".tar") {
        let f = std::fs::File::open(file)?;
        let reader: Box<dyn Read> = if name.ends_with(".tar") { Box::new(f) } else { Box::new(flate2::read::GzDecoder::new(f)) };
        let mut a = tar::Archive::new(reader);
        a.unpack(dir).context("tar")?;
        out = walkdir::WalkDir::new(dir).into_iter().filter_map(|e| e.ok()).filter(|e| e.file_type().is_file()).map(|e| e.into_path()).collect();
    } else {
        out.push(file.to_path_buf());
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn repo_urls() {
        assert_eq!(parse_repo("Witek902/Caissa").unwrap().repo, "Caissa");
        let r = parse_repo("https://github.com/official-stockfish/Stockfish/releases/tag/sf_19").unwrap();
        assert_eq!((r.owner.as_str(), r.repo.as_str(), r.tag.as_deref()), ("official-stockfish", "Stockfish", Some("sf_19")));
        let r = parse_repo("https://github.com/Tors3/Triumviratus/releases/latest").unwrap();
        assert_eq!(r.tag, None);
        assert_eq!(parse_repo("https://github.com/aronpetko/integral.git").unwrap().repo, "integral");
        assert!(parse_repo("https://example.com/a/b").is_none());
    }
    #[test]
    fn html_listing() {
        let html = r#"<a href="/Witek902/Caissa/releases/download/2.0/caissa-2.0-x64-avx2.exe" rel="nofollow"><a href="/Witek902/Caissa/releases/download/2.0/caissa%202.0.zip"><a href="/Witek902/Caissa/archive/refs/tags/2.0.zip">"#;
        let a = parse_html_assets("Witek902", "Caissa", "2.0", html);
        assert_eq!(a.len(), 2);
        assert_eq!(a[0].name, "caissa-2.0-x64-avx2.exe");
        assert_eq!(a[1].name, "caissa 2.0.zip");
    }
    #[test]
    fn extract_zip_and_targz() {
        let d = tempfile::tempdir().unwrap();
        let zp = d.path().join("e.zip");
        {
            let mut z = zip::ZipWriter::new(std::fs::File::create(&zp).unwrap());
            z.start_file("bin/engine-avx2.exe", zip::write::SimpleFileOptions::default()).unwrap();
            z.write_all(b"MZ").unwrap();
            z.finish().unwrap();
        }
        let files = extract(&zp, &d.path().join("x")).unwrap();
        assert!(files[0].ends_with("bin/engine-avx2.exe"));
        let tp = d.path().join("e.tar.gz");
        {
            let gz = flate2::write::GzEncoder::new(std::fs::File::create(&tp).unwrap(), flate2::Compression::default());
            let mut t = tar::Builder::new(gz);
            let mut h = tar::Header::new_gnu();
            h.set_size(2);
            h.set_mode(0o755);
            h.set_cksum();
            t.append_data(&mut h, "engine", &b"\x7fE"[..]).unwrap();
            t.into_inner().unwrap().finish().unwrap();
        }
        let files = extract(&tp, &d.path().join("y")).unwrap();
        assert_eq!(files.len(), 1);
    }
}
