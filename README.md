# CF Workers Private Raw Release

這是一個 Cloudflare Worker 專案，用自己的 Worker 網址代理 GitHub Raw 檔案與 GitHub Releases 下載連結。它可用於公開倉庫，也可透過 `GH_TOKEN` 讀取私有倉庫，避免把 GitHub Token 暴露在下載 URL 裡。

## 主要功能

- 代理 GitHub Raw 檔案。
- 代理 GitHub Releases asset，包括 `latest` 與指定 `tag`。
- 支援私有倉庫下載，GitHub Token 只保存在 Cloudflare Secret。
- 支援短連結，隱藏 GitHub owner、repo、branch。
- 支援根域名直接下載指定檔案。
- `TOKEN` 可選，可作為公開訪問密碼。
- 支援 `TOKEN_PATH`，可為不同路徑設定不同密碼。
- 支援 `STRICT_MODE`，只允許已配置的倉庫與檔案，避免被當成公開代理濫用。
- 首頁可設定為直接下載、nginx 偽裝頁、302 跳轉或代理指定 URL。

## Cloudflare 網頁部署

這是 Worker 專案，不是一般靜態網站。Cloudflare 後台入口可能顯示為 `Workers & Pages`，但部署時要使用 Worker 的 GitHub 部署流程。

1. 打開 `https://dash.cloudflare.com` 並登入。
2. 進入 `Workers & Pages`。
3. 點 `Create application` 或 `Create`。
4. 選擇 `Import a repository` 或 `Connect to Git`。
5. 選擇 GitHub，授權 Cloudflare 讀取你的專案倉庫。
6. 選擇這個 Worker 專案倉庫。
7. 按下表填寫部署設定。

| 欄位 | 建議填寫 |
| --- | --- |
| 專案名稱 | `cf-workers-private-raw-release` |
| 生產分支 | `main` |
| 建構命令 | 可留空 |
| 部署命令 | `npx wrangler deploy` |
| 路徑 | `/` |
| 非生產分支 | 可取消勾選 |
| Protect with Cloudflare Access | 關閉 |
| API 令牌 | 建立新令牌 |
| 令牌名稱 | `cf-workers-private-raw-release-build` |

點 `部署` 後，Cloudflare 會建立 Worker 網址，例如：

```text
https://cf-workers-private-raw-release.xxx.workers.dev
```

## Runtime Variables And Secrets

部署後進入：

```text
Workers & Pages -> 你的 Worker -> Settings -> Variables and Secrets
```

請填在 `Runtime variables and secrets`，不是只給建構流程使用的變數區塊。

### 變數更新後如何生效

在 Cloudflare 新增或修改 `Runtime variables and secrets` 後，不一定會立刻套用到目前正在承接流量的版本。Cloudflare 會建立一個新的版本 ID，你需要到部署頁把最新版本切到生產環境流量。

操作步驟：

1. 在 `Settings -> Variables and Secrets` 新增或修改變數。
2. Cloudflare 會自動建立一個包含新變數的版本 ID。
3. 回到 Worker 專案，打開 `Deployments` 或 `部署` 頁面。
4. 點 `查看所有部署`。
5. 找到最新的版本 ID，通常描述會顯示新增或修改了哪些變數。
6. 點該版本右側的 `...`。
7. 選擇 `Promote to Production`、`部署到生產環境`，或進入流量分配設定。
8. 確認最新版本的生產流量是 `100%`。

完成後再打開 Worker 網址測試。若最新版本不是 `100%` 流量，舊版本仍可能繼續顯示 nginx 或讀不到新變數。

| 名稱 | 是否必填 | 建議類型 | 說明 |
| --- | --- | --- | --- |
| `GH_TOKEN` | 私有倉庫建議填 | Secret / 機密 | GitHub Token，用來讀取私有倉庫。 |
| `GH_NAME` | 短連結需要 | Text / 文字 | 預設 GitHub owner。 |
| `GH_REPO` | 短連結需要 | Text / 文字 | 預設 GitHub repo。 |
| `GH_BRANCH` | Raw 短連結需要 | Text / 文字 | 預設 Raw 分支，例如 `main`。 |
| `GH_HOME_PATH` | 選填 | Text / 文字 | 根域名 `/` 的預設下載路徑，例如 `releases/latest/download/app.zip`。 |
| `GH_RELEASE_ASSET` | 選填 | Text / 文字 | 預設 Release 檔案名稱，例如 `app.zip`。 |
| `GH_RELEASE_PATH` | 選填 | Text / 文字 | 自訂 Release 下載路徑前綴，例如 `dl`。 |
| `GH_RELEASE_TAG` | 選填 | Text / 文字 | 固定指定 Release tag。不填時使用 latest release。 |
| `TOKEN` | 選填 | Secret / 機密 | 公開訪問密碼。填了以後下載 URL 必須帶 `?token=...`。 |
| `TOKEN_PATH` | 選填 | Secret / 機密 | 為不同路徑設定不同密碼，格式為 `token@path`。 |
| `STRICT_MODE` | 選填 | Text / 文字 | 嚴格模式。建議填 `true`，也支援 `1`、`on`、`yes`。 |
| `URL302` | 選填 | Text / 文字 | 首頁 302 跳轉地址，可填多個。 |
| `URL` | 選填 | Text / 文字 | 首頁代理地址，可填多個。 |
| `ERROR` | 選填 | Text / 文字 | 自訂錯誤提示。 |

## 常用配置

### 私有倉庫

```text
GH_TOKEN = 你的 GitHub Token
```

GitHub Token 建議使用 Fine-grained token，目標倉庫至少需要：

```text
Contents: Read-only
```

### 短連結

```text
GH_NAME = GitHub owner
GH_REPO = GitHub repo
```

Raw 檔案短連結再加：

```text
GH_BRANCH = main
```

### 根域名直接下載

```text
GH_NAME = GitHub owner
GH_REPO = GitHub repo
GH_HOME_PATH = releases/latest/download/app.zip
```

之後直接打開：

```text
https://你的-worker.workers.dev
```

### 固定單一 Release 檔案

```text
GH_NAME = GitHub owner
GH_REPO = GitHub repo
GH_RELEASE_ASSET = app.zip
```

可使用：

```text
https://你的-worker.workers.dev/download
https://你的-worker.workers.dev/latest
https://你的-worker.workers.dev/release
```

### 自訂 Release 路徑

```text
GH_NAME = GitHub owner
GH_REPO = GitHub repo
GH_RELEASE_PATH = dl
```

可使用：

```text
https://你的-worker.workers.dev/dl/app.zip
```

如果同時設定：

```text
GH_RELEASE_ASSET = app.zip
```

也可使用：

```text
https://你的-worker.workers.dev/dl
```

### 訪問密碼

`TOKEN` 可以不填。不填時，下載 URL 不需要 `?token=...`。

如果設定：

```text
TOKEN = 你的公開訪問密碼
```

下載時需要：

```text
https://你的-worker.workers.dev/download?token=你的公開訪問密碼
```

### 嚴格模式

如果不想讓 Worker 被拿去代理其他公開 GitHub 倉庫，設定：

```text
STRICT_MODE = true
GH_NAME = GitHub owner
GH_REPO = GitHub repo
```

嚴格模式下：

- 只允許 `GH_NAME` / `GH_REPO` 指定的倉庫。
- 若設定 `GH_BRANCH`，Raw 只允許該分支。
- 若設定 `GH_RELEASE_ASSET`，Release 只允許該檔案。
- 若設定 `GH_RELEASE_TAG`，Release 只允許該 tag。
- 其他 owner/repo、完整外部 Raw URL、完整外部 GitHub Release URL 都會被拒絕。

## 下載範例

### GitHub Raw

完整路徑：

```text
https://你的-worker.workers.dev/owner/repo/main/path/to/file.txt
```

短路徑，需要 `GH_NAME`、`GH_REPO`、`GH_BRANCH`：

```text
https://你的-worker.workers.dev/path/to/file.txt
```

完整 Raw URL：

```text
https://你的-worker.workers.dev/https://raw.githubusercontent.com/owner/repo/main/path/to/file.txt
```

### GitHub Releases

latest release：

```text
https://你的-worker.workers.dev/owner/repo/releases/latest/download/app.zip
```

指定 tag：

```text
https://你的-worker.workers.dev/owner/repo/releases/tags/v1.2.3/download/app.zip
```

短路徑，需要 `GH_NAME` 和 `GH_REPO`：

```text
https://你的-worker.workers.dev/releases/latest/download/app.zip
https://你的-worker.workers.dev/releases/tags/v1.2.3/download/app.zip
```

完整 GitHub Release URL：

```text
https://你的-worker.workers.dev/https://github.com/owner/repo/releases/latest/download/app.zip
```

## TOKEN_PATH

`TOKEN_PATH` 可以讓不同路徑使用不同訪問密碼。

```text
TOKEN_PATH = rawkey@config,releasekey@releases
GH_TOKEN = github_pat_xxx
```

對應：

```text
/config/app.yaml?token=rawkey
/releases/latest/download/app.zip?token=releasekey
```

匹配 `TOKEN_PATH` 後，Worker 會使用 `GH_TOKEN` 去請求 GitHub。

## 常見問題

### 打開根域名還是 nginx

通常代表 `GH_HOME_PATH` 沒有進入目前生產版本。請確認：

- `GH_HOME_PATH` 填在 `Runtime variables and secrets`。
- 修改變數後，Cloudflare 產生的新版本已被選中。
- 在 `Deployments -> 查看所有部署` 中，最新版本已被提升到生產環境。
- 最新版本的生產流量是 `100%`。

### 短連結無法下載

如果短連結失敗，但完整 owner/repo 連結成功，通常代表 Worker 沒有讀到：

```text
GH_NAME
GH_REPO
```

請在 `Runtime variables and secrets` 補上，再到 `Deployments` 頁面把 Cloudflare 自動產生的最新版本提升到生產環境。

### 私有倉庫無法下載

請檢查：

- `GH_TOKEN` 是否填在 `Runtime variables and secrets`。
- `GH_TOKEN` 是否為 `Secret / 機密`。
- GitHub Token 是否有目標私有倉庫的 `Contents: Read-only` 權限。
- Release 是否不是 draft。
- 檔案名稱是否完全一致，包括大小寫與副檔名。

### Runtime variables and secrets 與建構變數差在哪裡

Worker 執行時讀的是 `Runtime variables and secrets`，也就是程式碼裡的 `env.GH_NAME`、`env.GH_REPO`、`env.GH_TOKEN` 等。

建構流程的變數可以先不填。

## 本機開發

```bash
npm install
npm test
npm run dev
```

部署：

```bash
npm run deploy
```

設定機密：

```bash
npx wrangler secret put GH_TOKEN
npx wrangler secret put TOKEN
```

`TOKEN` 是選填。
