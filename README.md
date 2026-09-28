# venera-configs

Configuration file repository for venera

## Create a new configuration

1. Download `_template_.js`, `_venera_.js`, put them in the same directory
2. Rename `_template_.js` to `your_config_name.js`
3. Edit `your_config_name.js` to your needs. 
    - The `_template_.js` file contains comments to help you with that. 
    - The `_venera_.js` is used for code completion in your IDE.

## 源健康检查

`.github/workflows/healthcheck.yml` 每 12 小时自动探测各漫画源站点（也支持手动触发：Actions → Manga Source Health Check → Run workflow）。

- 检查项配置在 `scripts/checks.json`（新增源时记得补一条）
- 站点挂了（域名失效/被售卖/Cloudflare 拦截）会自动开 `[source-down]` 标签的 issue，恢复后自动评论并关闭
- 已知失效的源在 `checks.json` 里加 `"status"` 字段声明，避免重复告警
- 自建服务（Komga/Kavita/Lanraragi）不参与检查

本地运行：

```bash
python scripts/healthcheck.py                 # 全量检查
python scripts/healthcheck.py --only jm,mh18  # 只检查指定源
```
